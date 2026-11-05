import { localDate, type LocalDate } from '@sport-performance/domain';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useState, useSyncExternalStore } from 'react';
import { errorMessage } from '../../src/api/error-message.ts';
import {
  canFilmCmj,
  cmjVideoDayOf,
  cmjVideoPlayersOf,
  playerCmjAttempts,
  nextAttemptNumber,
} from '../../src/cmj-video/attempt.ts';
import { CMJ_VIDEO_MAX_DURATION_S } from '../../src/cmj-video/camera.ts';
import { frameTimeMs, initialMarking, markingReducer } from '../../src/cmj-video/marking.ts';
import type { RecordedVideo } from '../../src/cmj-video/service.ts';
import { NativeCmjCamera, createNativeFrameSource } from '../../src/platform/cmj-video.tsx';
import {
  CmjVideoDaysScreen,
  CmjVideoMarkScreen,
  CmjVideoPlayersScreen,
  CmjVideoRecordScreen,
  CmjVideoUploadsList,
  type CameraState,
} from '../../src/screens/cmj-video.tsx';
import { useApi, useServices, useSession, useSyncStatus } from '../../src/state/app-context.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';
import {
  Button,
  LoadingView,
  ScreenBody,
  ScreenHeader,
  StatusMessage,
} from '../../src/ui/primitives.tsx';

type Step =
  | { readonly kind: 'days' }
  | { readonly kind: 'players'; readonly testSessionId: string }
  | { readonly kind: 'record'; readonly testSessionId: string; readonly playerId: string }
  | {
      readonly kind: 'mark';
      readonly testSessionId: string;
      readonly playerId: string;
      readonly video: RecordedVideo & { readonly frameRateFps: number };
    };

/**
 * Days from yesterday on, by the phone's calendar: a filter of the list
 * only (a day that started yesterday in the club's time zone still shows).
 */
function fromDay(nowMs: number): LocalDate {
  const day = new Date(nowMs - 24 * 60 * 60_000);
  return localDate(day.getFullYear(), day.getMonth() + 1, day.getDate());
}

/**
 * CMJ by video (B-604, ADR 0085): the evaluator picks the day (from the
 * phone's synced test days) and the player, films the jump at high speed
 * and marks take-off and landing frame by frame. Saving writes the attempt
 * through the offline queue and keeps the video until it goes up. Opening
 * the sheet of a day needs signal once (who may be filmed comes from it);
 * B-505 keeps the sheets on the phone and its CMJ station opens this screen
 * with the day (`?testSessionId=`).
 */
export default function CmjVideo() {
  const services = useServices();
  const api = useApi();
  const translator = useTranslator();
  const { t } = translator;
  const session = useSession();
  const syncStatus = useSyncStatus();
  const membership = session.status === 'signedIn' ? session.activeMembership : null;
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const membershipId = membership?.id ?? null;
  const allowed = membership !== null && canFilmCmj(membership.role);
  const offline = session.status === 'signedIn' && session.offline;
  const videos = services.cmjVideos;
  const videosVersion = useSyncExternalStore(
    videos.subscribe,
    videos.getVersion,
    videos.getVersion,
  );

  const params = useLocalSearchParams<{ testSessionId?: string }>();
  const [step, setStep] = useState<Step>(
    typeof params.testSessionId === 'string' && params.testSessionId !== ''
      ? { kind: 'players', testSessionId: params.testSessionId }
      : { kind: 'days' },
  );
  const [notice, setNotice] = useState<string | null>(null);
  const testSessionId = step.kind === 'days' ? null : step.testSessionId;

  const days = useQuery({
    queryKey: [membershipId, 'cmj-video', 'days', syncStatus.lastSyncedAt],
    enabled: allowed && membershipId !== null,
    queryFn: async () =>
      (
        await services.sync.store.list(membershipId ?? '', 'test_session', {
          from: fromDay(Date.now()),
        })
      )
        .filter((row) => row.data.status !== 'cancelled')
        .map((row) => ({
          id: row.id,
          scheduledOn: row.data.scheduledOn,
          location: row.data.location,
        })),
  });
  const sheet = useQuery({
    queryKey: [membershipId, 'test-day-sheet', testSessionId],
    enabled: allowed && testSessionId !== null,
    // Kept for the whole visit: the phone films and marks without signal once it is open.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) =>
      api.getTestSessionSheet({ params: { testSessionId: testSessionId ?? '' } }, { signal }),
  });
  const day = useMemo(
    () => (sheet.data === undefined ? null : cmjVideoDayOf(sheet.data)),
    [sheet.data],
  );
  const players = useMemo(
    () => (sheet.data === undefined ? [] : cmjVideoPlayersOf(sheet.data)),
    [sheet.data],
  );
  const names = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);

  const attempts = useQuery({
    queryKey: [
      membershipId,
      'cmj-video',
      'attempts',
      testSessionId,
      syncStatus.lastSyncedAt,
      syncStatus.pendingCount,
      videosVersion,
    ],
    enabled: day !== null && membershipId !== null,
    queryFn: async () => {
      const counts = new Map<string, number[]>();
      for (const player of players) {
        if (day === null || membershipId === null) break;
        counts.set(player.id, [
          ...(await playerCmjAttempts(services.sync.store, membershipId, day, player.id))
            .attemptNumbers,
        ]);
      }
      return counts;
    },
  });
  const captures = useQuery({
    queryKey: [membershipId, 'cmj-video', 'captures', videosVersion],
    enabled: allowed && membershipId !== null && userId !== null,
    queryFn: () => videos.list({ userId: userId ?? '', membershipId: membershipId ?? '' }),
  });
  useEffect(() => {
    videos.requestUpload();
  }, [videos]);

  const uploads = (
    <CmjVideoUploadsList
      captures={captures.data ?? []}
      playerNames={names}
      onDismiss={(capture) => {
        videos.dismiss(capture).catch(services.reportError);
      }}
    />
  );

  if (membership === null || userId === null) return null;
  if (!allowed) {
    return (
      <ScreenBody header={<ScreenHeader title={t('cmjVideo.title')} />}>
        <StatusMessage level="warning">{t('cmjVideo.notAllowed')}</StatusMessage>
      </ScreenBody>
    );
  }
  const scope = { userId, membershipId: membership.id };
  const back = () => {
    setNotice(null);
    setStep({ kind: 'days' });
  };

  switch (step.kind) {
    case 'days':
      return (
        <CmjVideoDaysScreen
          days={days.data ?? []}
          onPick={(id) => {
            setStep({ kind: 'players', testSessionId: id });
          }}
          uploads={uploads}
        />
      );
    case 'players': {
      if (sheet.isPending) return <LoadingView label={t('common.loading')} />;
      if (sheet.isError) {
        return (
          <ScreenBody>
            <StatusMessage level="warning">
              {offline
                ? t('cmjVideo.day.needsSignal')
                : `${t('cmjVideo.day.loadFailed')} ${errorMessage(sheet.error, 'generic', translator)}`}
            </StatusMessage>
            <Button variant="link" label={t('common.back')} onPress={back} />
          </ScreenBody>
        );
      }
      if (day === null) {
        return (
          <ScreenBody>
            <StatusMessage level="warning">{t('cmjVideo.day.noCmj')}</StatusMessage>
            <Button variant="link" label={t('common.back')} onPress={back} />
          </ScreenBody>
        );
      }
      return (
        <CmjVideoPlayersScreen
          rows={players.map((player) => ({
            player,
            attempts: attempts.data?.get(player.id)?.length ?? 0,
          }))}
          plannedAttempts={day.attemptCount}
          offline={offline}
          notice={notice}
          onFilm={(playerId) => {
            setNotice(null);
            setStep({ kind: 'record', testSessionId: step.testSessionId, playerId });
          }}
          onBack={back}
          uploads={uploads}
        />
      );
    }
    case 'record':
      if (day === null) return null;
      return (
        <RecordStep
          playerName={names.get(step.playerId) ?? ''}
          attemptCount={day.attemptCount}
          onRecorded={(video) => {
            setStep({ ...step, kind: 'mark', video });
          }}
          onCancel={() => {
            setStep({ kind: 'players', testSessionId: step.testSessionId });
          }}
        />
      );
    case 'mark': {
      const player = players.find((p) => p.id === step.playerId);
      if (day === null || player === undefined) return null;
      return (
        <MarkStep
          playerName={player.name}
          sex={player.sex}
          ageYears={player.ageYears}
          video={step.video}
          gravityMs2={day.gravityMs2}
          attemptNumber={nextAttemptNumber(attempts.data?.get(player.id) ?? [])}
          onSave={async (marks) => {
            const saved = await videos.saveJump({
              scope,
              day,
              playerId: player.id,
              jump: {
                ...marks,
                frameRateFps: step.video.frameRateFps,
                recordedAt: new Date(Date.now() - step.video.durationMs).toISOString(),
              },
              video: step.video,
            });
            setNotice(t('cmjVideo.mark.saved', { number: saved.attemptNumber }));
            setStep({ kind: 'players', testSessionId: step.testSessionId });
          }}
          onDiscard={() => {
            videos.discardRecording(step.video.path).catch(services.reportError);
            setStep({ kind: 'players', testSessionId: step.testSessionId });
          }}
        />
      );
    }
  }
}

function RecordStep({
  playerName,
  attemptCount,
  onRecorded,
  onCancel,
}: {
  readonly playerName: string;
  readonly attemptCount: number;
  readonly onRecorded: (video: RecordedVideo & { readonly frameRateFps: number }) => void;
  readonly onCancel: () => void;
}) {
  const [cameraState, setCameraState] = useState<CameraState>({ status: 'preparing' });
  const [recording, setRecording] = useState(false);
  const onState = useCallback((state: CameraState) => {
    setCameraState(state);
    if (state.status === 'error') setRecording(false);
  }, []);
  return (
    <CmjVideoRecordScreen
      playerName={playerName}
      cameraState={cameraState}
      recording={recording}
      maxDurationS={CMJ_VIDEO_MAX_DURATION_S}
      attemptCount={attemptCount}
      camera={
        <NativeCmjCamera
          recording={recording}
          onState={onState}
          onRecorded={(video) => {
            setRecording(false);
            onRecorded(video);
          }}
        />
      }
      onStart={() => {
        setRecording(true);
      }}
      onStop={() => {
        setRecording(false);
      }}
      onCancel={onCancel}
    />
  );
}

function MarkStep({
  playerName,
  sex,
  ageYears,
  video,
  gravityMs2,
  attemptNumber,
  onSave,
  onDiscard,
}: {
  readonly playerName: string;
  readonly sex: Parameters<typeof CmjVideoMarkScreen>[0]['sex'];
  readonly ageYears: Parameters<typeof CmjVideoMarkScreen>[0]['ageYears'];
  readonly video: RecordedVideo & { readonly frameRateFps: number };
  readonly gravityMs2: number;
  readonly attemptNumber: number;
  readonly onSave: (marks: { takeoffFrame: number; landingFrame: number }) => Promise<void>;
  readonly onDiscard: () => void;
}) {
  const services = useServices();
  const frames = useMemo(() => createNativeFrameSource(), []);
  const [marking, dispatch] = useReducer(
    markingReducer,
    initialMarking(video.durationMs, video.frameRateFps),
  );
  const [loaded, setLoaded] = useState<{ frame: number; uri: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const timeMs = frameTimeMs(marking);

  useEffect(
    () => () => {
      frames.release().catch(services.reportError);
    },
    [frames, services.reportError],
  );
  useEffect(() => {
    // The image follows the frame on screen: an answer for another frame is dropped.
    let current = true;
    const frame = marking.frame;
    frames
      .frameAt(video.path, timeMs)
      .then((uri) => {
        if (current) setLoaded({ frame, uri });
      })
      .catch(() => {
        if (current) setLoaded({ frame, uri: null });
      });
    return () => {
      current = false;
    };
  }, [frames, video.path, marking.frame, timeMs]);
  const shown = loaded?.frame === marking.frame ? loaded : null;
  const frameUri = shown?.uri ?? null;
  const frameFailed = shown !== null && shown.uri === null;

  return (
    <CmjVideoMarkScreen
      playerName={playerName}
      sex={sex}
      ageYears={ageYears}
      marking={marking}
      gravityMs2={gravityMs2}
      attemptNumber={attemptNumber}
      frameUri={frameUri}
      frameFailed={frameFailed}
      saving={saving}
      saveFailed={saveFailed}
      onStep={(delta) => {
        dispatch({ type: 'step', delta });
      }}
      onMarkTakeoff={() => {
        dispatch({ type: 'mark_takeoff' });
      }}
      onMarkLanding={() => {
        dispatch({ type: 'mark_landing' });
      }}
      onGoTo={(mark) => {
        dispatch({ type: 'go_to', mark });
      }}
      onSave={() => {
        if (marking.takeoffFrame === null || marking.landingFrame === null) return;
        setSaving(true);
        setSaveFailed(false);
        onSave({ takeoffFrame: marking.takeoffFrame, landingFrame: marking.landingFrame })
          .catch((error: unknown) => {
            services.reportError(error);
            setSaveFailed(true);
          })
          .finally(() => {
            setSaving(false);
          });
      }}
      onDiscard={onDiscard}
    />
  );
}
