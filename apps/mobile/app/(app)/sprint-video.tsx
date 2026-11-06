import {
  SPRINT_VIDEO_MIN_FPS,
  localDate,
  type LocalDate,
  type SprintVideoLayout,
} from '@sport-performance/domain';
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { errorMessage } from '../../src/api/error-message.ts';
import {
  NativeSprintCamera,
  createNativeSprintFrameSource,
} from '../../src/platform/sprint-video.tsx';
import { discardPickedVideo, pickSlowMotionVideo } from '../../src/platform/video-import.ts';
import {
  SprintVideoDaysScreen,
  SprintVideoMarkScreen,
  SprintVideoPlayersScreen,
  SprintVideoRecordScreen,
  SprintVideoSetupScreen,
  type RecordedSprintVideo,
  type SprintCameraState,
} from '../../src/screens/sprint-video.tsx';
import {
  canFilmSprint,
  nextAttemptNumber,
  playerSprintAttempts,
  sprintVideoDayOf,
  sprintVideoPlayersOf,
  type SprintVideoPlayer,
} from '../../src/sprint-video/attempt.ts';
import { SPRINT_VIDEO_MAX_DURATION_S } from '../../src/sprint-video/camera.ts';
import {
  DEFAULT_CAMERA_DISTANCE_M,
  DEFAULT_POLE_OFFSET_M,
  mainCameraMinDistanceM,
  parseLayoutDraft,
  type LayoutDraft,
} from '../../src/sprint-video/layout.ts';
import {
  frameTimeMs,
  initialSprintMarking,
  sprintMarkingReducer,
} from '../../src/sprint-video/marking.ts';
import { saveSprintAttempt, type SprintMarks } from '../../src/sprint-video/save.ts';
import { useApi, useServices, useSession, useSyncStatus } from '../../src/state/app-context.tsx';
import { useTranslator } from '../../src/ui/i18n.tsx';
import {
  Button,
  LoadingView,
  ScreenBody,
  ScreenHeader,
  StatusMessage,
} from '../../src/ui/primitives.tsx';
import {
  importStateOf,
  importVideo,
  type ImportLimits,
  type VideoImportState,
} from '../../src/video/imported.ts';

/**
 * What a video from the gallery must be (ADR 0102): fast enough. It never
 * leaves the phone, so any format the frame extractor reads will do.
 */
const IMPORT_LIMITS: ImportLimits = {
  minFps: SPRINT_VIDEO_MIN_FPS,
  maxSizeBytes: null,
  contentTypes: null,
};

/** A recording taken into the directory of the sprint videos. */
interface Recording extends RecordedSprintVideo {
  /** When the recording stopped (ms since the epoch). */
  readonly stoppedAtMs: number;
}

type Step =
  | { readonly kind: 'days' }
  | { readonly kind: 'setup'; readonly testSessionId: string }
  | { readonly kind: 'players'; readonly testSessionId: string }
  | { readonly kind: 'record'; readonly testSessionId: string; readonly playerId: string }
  | {
      readonly kind: 'mark';
      readonly testSessionId: string;
      readonly playerId: string;
      readonly video: Recording;
    };

/**
 * Days from yesterday on, by the phone's calendar: a filter of the list
 * only (a day that started yesterday in the club's time zone still shows).
 */
function fromDay(nowMs: number): LocalDate {
  const day = new Date(nowMs - 24 * 60 * 60_000);
  return localDate(day.getFullYear(), day.getMonth() + 1, day.getDate());
}

const DEFAULT_DRAFT: LayoutDraft = {
  cameraDistance: String(DEFAULT_CAMERA_DISTANCE_M),
  poleOffset: String(DEFAULT_POLE_OFFSET_M),
};

/**
 * Sprint by video (B-605, ADR 0082): the evaluator picks the day (from the
 * phone's synced test days), sets up the field (where each cone goes), picks
 * the player, films the 40 m from the side at high speed and marks the
 * crossing of each line frame by frame. Saving writes the attempt through
 * the offline queue and deletes the video. Opening the sheet of a day needs
 * signal once (who may be filmed comes from it); the field test day (B-505)
 * can open this screen with the day (`?testSessionId=`).
 */
export default function SprintVideo() {
  const services = useServices();
  const api = useApi();
  const translator = useTranslator();
  const { t } = translator;
  const session = useSession();
  const syncStatus = useSyncStatus();
  const membership = session.status === 'signedIn' ? session.activeMembership : null;
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const membershipId = membership?.id ?? null;
  const allowed = membership !== null && canFilmSprint(membership.role);
  const offline = session.status === 'signedIn' && session.offline;
  const recordings = services.sprintRecordings;

  const params = useLocalSearchParams<{ testSessionId?: string }>();
  const [step, setStep] = useState<Step>(
    typeof params.testSessionId === 'string' && params.testSessionId !== ''
      ? { kind: 'setup', testSessionId: params.testSessionId }
      : { kind: 'days' },
  );
  const [draft, setDraft] = useState<LayoutDraft>(DEFAULT_DRAFT);
  const [layout, setLayout] = useState<SprintVideoLayout | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const testSessionId = step.kind === 'days' ? null : step.testSessionId;

  // A video being marked never outlives the screen (leaving it, signing out).
  const marking = step.kind === 'mark' ? step.video.path : null;
  const markingRef = useRef<string | null>(null);
  useEffect(() => {
    markingRef.current = marking;
  }, [marking]);
  useEffect(
    () => () => {
      if (markingRef.current !== null) {
        recordings.discard(markingRef.current).catch(services.reportError);
      }
    },
    [recordings, services.reportError],
  );

  const days = useQuery({
    queryKey: [membershipId, 'sprint-video', 'days', syncStatus.lastSyncedAt],
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
    () => (sheet.data === undefined ? null : sprintVideoDayOf(sheet.data)),
    [sheet.data],
  );
  const players = useMemo(
    () => (sheet.data === undefined ? [] : sprintVideoPlayersOf(sheet.data)),
    [sheet.data],
  );

  const attempts = useQuery({
    queryKey: [
      membershipId,
      'sprint-video',
      'attempts',
      testSessionId,
      syncStatus.lastSyncedAt,
      syncStatus.pendingCount,
    ],
    enabled: day !== null && membershipId !== null,
    queryFn: async () => {
      const numbers = new Map<string, readonly number[]>();
      for (const player of players) {
        if (day === null || membershipId === null) break;
        numbers.set(
          player.id,
          (await playerSprintAttempts(services.sync.store, membershipId, day, player.id))
            .attemptNumbers,
        );
      }
      return numbers;
    },
  });

  const parsed = useMemo(() => parseLayoutDraft(draft), [draft]);
  const minDistanceM = useMemo(() => mainCameraMinDistanceM(), []);

  if (membership === null || userId === null) return null;
  if (!allowed) {
    return (
      <ScreenBody header={<ScreenHeader title={t('sprintVideo.title')} />}>
        <StatusMessage level="warning">{t('sprintVideo.notAllowed')}</StatusMessage>
      </ScreenBody>
    );
  }
  const back = () => {
    setNotice(null);
    setStep({ kind: 'days' });
  };

  if (step.kind === 'days') {
    return (
      <SprintVideoDaysScreen
        days={days.data ?? []}
        onPick={(id) => {
          setStep(
            layout === null
              ? { kind: 'setup', testSessionId: id }
              : { kind: 'players', testSessionId: id },
          );
        }}
      />
    );
  }
  if (sheet.isPending) return <LoadingView label={t('common.loading')} />;
  if (sheet.isError) {
    return (
      <ScreenBody>
        <StatusMessage level="warning">
          {offline
            ? t('sprintVideo.day.needsSignal')
            : `${t('sprintVideo.day.loadFailed')} ${errorMessage(sheet.error, 'generic', translator)}`}
        </StatusMessage>
        <Button variant="link" label={t('common.back')} onPress={back} />
      </ScreenBody>
    );
  }
  if (day === null) {
    return (
      <ScreenBody>
        <StatusMessage level="warning">{t('sprintVideo.day.noSprint')}</StatusMessage>
        <Button variant="link" label={t('common.back')} onPress={back} />
      </ScreenBody>
    );
  }

  switch (step.kind) {
    case 'setup':
      return (
        <SprintVideoSetupScreen
          draft={draft}
          parsed={parsed}
          mainCameraMinDistanceM={minDistanceM}
          onChange={setDraft}
          onContinue={(next) => {
            setLayout(next);
            setStep({ kind: 'players', testSessionId: step.testSessionId });
          }}
          onBack={back}
        />
      );
    case 'players':
      return (
        <SprintVideoPlayersScreen
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
          onLayout={() => {
            setStep({ kind: 'setup', testSessionId: step.testSessionId });
          }}
          onBack={back}
        />
      );
    case 'record': {
      const player = players.find((p) => p.id === step.playerId);
      if (player === undefined) return null;
      return (
        <RecordStep
          playerName={player.name}
          onRecorded={(video) => {
            const stoppedAtMs = Date.now();
            recordings
              .adopt(video.path, randomUUID())
              .then((path) => {
                setStep({ ...step, kind: 'mark', video: { ...video, path, stoppedAtMs } });
              })
              .catch((error: unknown) => {
                services.reportError(error);
                setStep({ kind: 'players', testSessionId: step.testSessionId });
              });
          }}
          onCancel={() => {
            setStep({ kind: 'players', testSessionId: step.testSessionId });
          }}
        />
      );
    }
    case 'mark': {
      const player = players.find((p) => p.id === step.playerId);
      if (player === undefined) return null;
      const toPlayers = () => {
        setStep({ kind: 'players', testSessionId: step.testSessionId });
      };
      return (
        <MarkStep
          player={player}
          video={step.video}
          attemptNumber={nextAttemptNumber(attempts.data?.get(player.id) ?? [])}
          onSave={async (marks) => {
            const number = await saveSprintAttempt({
              sync: services.sync,
              recordings,
              membershipId: membership.id,
              evaluatorId: userId,
              day,
              playerId: player.id,
              video: step.video,
              marks,
              recordedUntilMs: step.video.stoppedAtMs,
              randomUUID,
              reportError: services.reportError,
            });
            setNotice(t('sprintVideo.mark.saved', { number }));
            toPlayers();
          }}
          onDiscard={() => {
            recordings.discard(step.video.path).catch(services.reportError);
            toPlayers();
          }}
        />
      );
    }
  }
}

function RecordStep({
  playerName,
  onRecorded,
  onCancel,
}: {
  readonly playerName: string;
  readonly onRecorded: (video: RecordedSprintVideo) => void;
  readonly onCancel: () => void;
}) {
  const services = useServices();
  const [cameraState, setCameraState] = useState<SprintCameraState>({ status: 'preparing' });
  const [importState, setImportState] = useState<VideoImportState>({ status: 'idle' });
  const [recording, setRecording] = useState(false);
  const onState = useCallback((state: SprintCameraState) => {
    setCameraState(state);
    if (state.status === 'error') setRecording(false);
  }, []);
  return (
    <SprintVideoRecordScreen
      playerName={playerName}
      cameraState={cameraState}
      recording={recording}
      maxDurationS={SPRINT_VIDEO_MAX_DURATION_S}
      camera={
        <NativeSprintCamera
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
      importState={importState}
      onImport={() => {
        setImportState({ status: 'reading' });
        importVideo(pickSlowMotionVideo, discardPickedVideo, IMPORT_LIMITS)
          .then((outcome) => {
            if (outcome.kind !== 'accepted') {
              setImportState(importStateOf(outcome) ?? { status: 'idle' });
              return;
            }
            setImportState({ status: 'idle' });
            onRecorded({
              path: outcome.path,
              durationMs: outcome.timing.durationMs,
              frameRateFps: outcome.timing.captureFps,
              timelineScale: outcome.timing.timelineScale,
            });
          })
          .catch((error: unknown) => {
            services.reportError(error);
            setImportState({ status: 'failed' });
          });
      }}
      onCancel={onCancel}
    />
  );
}

function MarkStep({
  player,
  video,
  attemptNumber,
  onSave,
  onDiscard,
}: {
  readonly player: SprintVideoPlayer;
  readonly video: RecordedSprintVideo;
  readonly attemptNumber: number;
  readonly onSave: (marks: SprintMarks) => Promise<void>;
  readonly onDiscard: () => void;
}) {
  const services = useServices();
  const frames = useMemo(() => createNativeSprintFrameSource(), []);
  const [marking, dispatch] = useReducer(
    sprintMarkingReducer,
    initialSprintMarking(video.durationMs, video.frameRateFps),
  );
  const [loaded, setLoaded] = useState<{ frame: number; uri: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  // Capture time on the file's timeline (stretched when the phone saved it for slow playback).
  const timeMs = frameTimeMs(marking) * (video.timelineScale ?? 1);

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

  return (
    <SprintVideoMarkScreen
      playerName={player.name}
      sex={player.sex}
      marking={marking}
      attemptNumber={attemptNumber}
      frameUri={shown?.uri ?? null}
      frameFailed={shown !== null && shown.uri === null}
      saving={saving}
      saveFailed={saveFailed}
      onStep={(delta) => {
        dispatch({ type: 'step', delta });
      }}
      onSelect={(mark) => {
        dispatch({ type: 'select', mark });
      }}
      onMark={() => {
        dispatch({ type: 'mark' });
      }}
      onGoTo={(mark) => {
        dispatch({ type: 'go_to', mark });
      }}
      onClear={(mark) => {
        dispatch({ type: 'clear', mark });
      }}
      onSave={() => {
        const { start, line10, line20, line40 } = marking.marks;
        if (start === null || line20 === null || line40 === null) return;
        setSaving(true);
        setSaveFailed(false);
        onSave({ startFrame: start, frame10: line10, frame20: line20, frame40: line40 })
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
