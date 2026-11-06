import type { LocalDate } from '@sport-performance/domain';
import { formatLocalDate, formatUnit, type MessageKey } from '@sport-performance/i18n';
import { useState, type ReactNode } from 'react';
import { Image, View } from 'react-native';
import { filmingBlock, type CmjVideoPlayer } from '../cmj-video/attempt.ts';
import type { CmjVideoCapture } from '../cmj-video/captures.ts';
import { heightPlausibility, markingResult, type MarkingState } from '../cmj-video/marking.ts';
import type { RecordedVideo } from '../cmj-video/service.ts';
import type { VideoImportState } from '../video/imported.ts';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  LoadingView,
  ScreenBody,
  ScreenHeader,
  StatusMessage,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * Screens of the CMJ by video (B-604, ADR 0085): presentational, fed by the
 * route, so they are tested without a camera. The camera is a slot (the
 * route passes the native one) and the frames come as image URIs.
 */

/** What the camera reports to the screen. */
export type CameraState =
  | { readonly status: 'preparing' }
  | { readonly status: 'ready'; readonly frameRateFps: number }
  | { readonly status: 'no_permission' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'error'; readonly error: unknown };

export interface CmjCameraProps {
  /** `true` to record, `false` to stop (the recording also stops alone). */
  readonly recording: boolean;
  readonly onRecorded: (video: CmjVideo) => void;
  readonly onState: (state: CameraState) => void;
}

/** A video to mark: recorded by the app or taken from the gallery (ADR 0102). */
export type CmjVideo = RecordedVideo & {
  /** The capture rate: what the frames are counted at. */
  readonly frameRateFps: number;
  /**
   * Seconds of the file's timeline per capture second: 1 for the app's own
   * recordings, 8 for a 240 fps capture the phone saved for 30 fps playback.
   */
  readonly timelineScale?: number;
};

/** The image of each frame of a recording (`modules/cmj-frames` on the phone). */
export interface FrameSource {
  /** URI of the image of the video at `timeMs`. */
  frameAt(videoPath: string, timeMs: number): Promise<string>;
  /** Deletes the images it wrote. */
  release(): Promise<void>;
}

export interface CmjVideoDayItem {
  readonly id: string;
  readonly scheduledOn: LocalDate;
  readonly location: string | null;
}

export function CmjVideoDaysScreen({
  days,
  onPick,
  uploads,
}: {
  readonly days: readonly CmjVideoDayItem[];
  readonly onPick: (id: string) => void;
  readonly uploads: ReactNode;
}) {
  const { t } = useTranslator();
  return (
    <ScreenBody header={<ScreenHeader title={t('cmjVideo.title')} />}>
      <AppText role="heading" accessibilityRole="header">
        {t('cmjVideo.days.title')}
      </AppText>
      {days.length === 0 ? <AppText tone="secondary">{t('cmjVideo.days.empty')}</AppText> : null}
      {days.map((day) => (
        <Button
          key={day.id}
          variant="secondary"
          label={t('cmjVideo.days.item', {
            date: formatLocalDate(day.scheduledOn),
            place: day.location ?? 'none',
          })}
          onPress={() => {
            onPick(day.id);
          }}
        />
      ))}
      {uploads}
    </ScreenBody>
  );
}

export interface CmjVideoPlayerRow {
  readonly player: CmjVideoPlayer;
  readonly attempts: number;
}

export function CmjVideoPlayersScreen({
  rows,
  plannedAttempts,
  offline,
  notice,
  onFilm,
  onBack,
  uploads,
}: {
  readonly rows: readonly CmjVideoPlayerRow[];
  readonly plannedAttempts: number;
  readonly offline: boolean;
  readonly notice: string | null;
  readonly onFilm: (playerId: string) => void;
  readonly onBack: () => void;
  readonly uploads: ReactNode;
}) {
  const { t } = useTranslator();
  return (
    <ScreenBody header={<ScreenHeader title={t('cmjVideo.players.title')} />}>
      {offline ? <StatusMessage level="warning">{t('sync.offline')}</StatusMessage> : null}
      {notice === null ? null : <StatusMessage level="ok">{notice}</StatusMessage>}
      {rows.map(({ player, attempts }) => {
        const block = filmingBlock(player);
        return (
          <Card key={player.id}>
            <AppText role="bodyStrong">{player.name}</AppText>
            <AppText tone="secondary">
              {t('cmjVideo.player.attempts', { count: attempts, planned: plannedAttempts })}
            </AppText>
            {block === null ? (
              <Button
                label={t('cmjVideo.record.start')}
                accessibilityLabel={t('cmjVideo.player.film', { name: player.name })}
                onPress={() => {
                  onFilm(player.id);
                }}
              />
            ) : (
              <StatusMessage level="warning">{t(`cmjVideo.block.${block}`)}</StatusMessage>
            )}
          </Card>
        );
      })}
      {uploads}
      <Button variant="link" label={t('common.back')} onPress={onBack} />
    </ScreenBody>
  );
}

export function CmjVideoRecordScreen({
  playerName,
  camera,
  cameraState,
  recording,
  maxDurationS,
  attemptCount,
  importState,
  onStart,
  onStop,
  onImport,
  onCancel,
}: {
  readonly playerName: string;
  readonly camera: ReactNode;
  readonly cameraState: CameraState;
  readonly recording: boolean;
  readonly maxDurationS: number;
  /** Attempts of the protocol (from the test definition). */
  readonly attemptCount: number;
  /** A slow-motion video taken from the gallery (ADR 0102). */
  readonly importState: VideoImportState;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onImport: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View style={{ flex: 1, minHeight: 320 }}>{camera}</View>
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.sm }}>
        <AppText role="heading" accessibilityRole="header">
          {playerName}
        </AppText>
        <AppText tone="secondary">{t('cmjVideo.record.protocol', { count: attemptCount })}</AppText>
        {cameraState.status === 'preparing' ? (
          <AppText tone="secondary">{t('cmjVideo.record.preparing')}</AppText>
        ) : null}
        {cameraState.status === 'ready' ? (
          <AppText tone="secondary">
            {t('cmjVideo.record.fps', { fps: cameraState.frameRateFps })}
          </AppText>
        ) : null}
        {cameraState.status === 'no_permission' ? (
          <StatusMessage level="critical">{t('cmjVideo.record.noPermission')}</StatusMessage>
        ) : null}
        {cameraState.status === 'unsupported' ? (
          <StatusMessage level="critical">{t('cmjVideo.record.unsupported')}</StatusMessage>
        ) : null}
        {cameraState.status === 'error' ? (
          <StatusMessage level="critical">{t('cmjVideo.record.failed')}</StatusMessage>
        ) : null}
        {recording ? (
          <StatusMessage level="warning">
            {t('cmjVideo.record.recording', { seconds: maxDurationS })}
          </StatusMessage>
        ) : null}
        {recording ? (
          <Button label={t('cmjVideo.record.stop')} onPress={onStop} />
        ) : (
          <Button
            label={t('cmjVideo.record.start')}
            disabled={cameraState.status !== 'ready'}
            onPress={onStart}
          />
        )}
        <CmjVideoImport state={importState} disabled={recording} onImport={onImport} />
        <Button variant="link" label={t('common.cancel')} disabled={recording} onPress={onCancel} />
      </View>
    </View>
  );
}

/** Picking a slow-motion video from the gallery, and why one was refused. */
function CmjVideoImport({
  state,
  disabled,
  onImport,
}: {
  readonly state: VideoImportState;
  readonly disabled: boolean;
  readonly onImport: () => void;
}) {
  const { t } = useTranslator();
  return (
    <>
      <AppText tone="secondary">{t('cmjVideo.import.hint')}</AppText>
      {state.status === 'reading' ? (
        <AppText tone="secondary">{t('cmjVideo.import.reading')}</AppText>
      ) : null}
      {state.status === 'rejected' ? (
        <StatusMessage level="warning">
          {state.rejection.reason === 'too_slow'
            ? t('cmjVideo.import.too_slow', { fps: state.rejection.fps })
            : t(`cmjVideo.import.${state.rejection.reason}`)}
        </StatusMessage>
      ) : null}
      {state.status === 'failed' ? (
        <StatusMessage level="critical">{t('cmjVideo.import.failed')}</StatusMessage>
      ) : null}
      <Button
        variant="secondary"
        label={t('cmjVideo.import.pick')}
        disabled={disabled || state.status === 'reading'}
        onPress={onImport}
      />
    </>
  );
}

function MarkLine({
  text,
  marked,
  goToLabel,
  onGoTo,
}: {
  readonly text: string;
  readonly marked: boolean;
  readonly goToLabel: string;
  readonly onGoTo: () => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
      <View style={{ flex: 1 }}>
        <AppText>{text}</AppText>
      </View>
      {marked ? (
        <Button
          variant="link"
          label={t('cmjVideo.mark.goTo')}
          accessibilityLabel={goToLabel}
          onPress={onGoTo}
        />
      ) : null}
    </View>
  );
}

/** `none` or the 1-based frame, for the `select` of the mark messages. */
function markArg(frame: number | null): string {
  return frame === null ? 'none' : String(frame + 1);
}

export function CmjVideoMarkScreen({
  playerName,
  sex,
  ageYears,
  marking,
  gravityMs2,
  attemptNumber,
  frameUri,
  frameFailed,
  saving,
  saveFailed,
  onStep,
  onMarkTakeoff,
  onMarkLanding,
  onGoTo,
  onSave,
  onDiscard,
}: {
  readonly playerName: string;
  readonly sex: CmjVideoPlayer['sex'];
  readonly ageYears: CmjVideoPlayer['ageYears'];
  readonly marking: MarkingState;
  readonly gravityMs2: number;
  readonly attemptNumber: number;
  /** Image of the frame on screen; `null` while it loads. */
  readonly frameUri: string | null;
  readonly frameFailed: boolean;
  readonly saving: boolean;
  readonly saveFailed: boolean;
  readonly onStep: (delta: number) => void;
  readonly onMarkTakeoff: () => void;
  readonly onMarkLanding: () => void;
  readonly onGoTo: (mark: 'takeoff' | 'landing') => void;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  // "Guardar igual" holds for the marks it was asked for: moving a mark asks again.
  const marks = `${String(marking.takeoffFrame)}:${String(marking.landingFrame)}`;
  const [confirmedMarks, setConfirmedMarks] = useState<string | null>(null);
  const confirmImplausible = confirmedMarks === marks;
  const result = markingResult(marking, gravityMs2);
  const plausibility =
    result.status === 'measured'
      ? heightPlausibility(result.heightCm, { sex, ageYears })
      : 'within';
  const steps: readonly { delta: number; key: MessageKey; label: MessageKey }[] = [
    { delta: -10, key: 'cmjVideo.mark.back10', label: 'cmjVideo.mark.back10.label' },
    { delta: -1, key: 'cmjVideo.mark.back1', label: 'cmjVideo.mark.back1.label' },
    { delta: 1, key: 'cmjVideo.mark.forward1', label: 'cmjVideo.mark.forward1.label' },
    { delta: 10, key: 'cmjVideo.mark.forward10', label: 'cmjVideo.mark.forward10.label' },
  ];
  const frameNumber = marking.frame + 1;
  return (
    <ScreenBody
      header={
        <ScreenHeader
          title={t('cmjVideo.mark.title', { name: playerName })}
          subtitle={t('cmjVideo.mark.help')}
        />
      }
    >
      <View
        style={{
          aspectRatio: 9 / 16,
          maxHeight: 420,
          alignSelf: 'center',
          width: '100%',
          backgroundColor: theme.colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {frameUri === null ? (
          frameFailed ? (
            <StatusMessage level="warning">{t('cmjVideo.mark.frameFailed')}</StatusMessage>
          ) : (
            <LoadingView label={t('cmjVideo.mark.frameLoading')} />
          )
        ) : (
          <Image
            source={{ uri: frameUri }}
            resizeMode="contain"
            style={{ width: '100%', height: '100%' }}
            accessibilityLabel={t('cmjVideo.mark.frameImage', { frame: frameNumber })}
          />
        )}
      </View>
      <AppText role="bodyStrong">
        {t('cmjVideo.mark.frame', { frame: frameNumber, count: marking.frameCount })}
      </AppText>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {steps.map((step) => (
          <View key={step.delta} style={{ flex: 1 }}>
            <Button
              variant="secondary"
              label={t(step.key)}
              accessibilityLabel={t(step.label)}
              disabled={
                (step.delta < 0 && marking.frame === 0) ||
                (step.delta > 0 && marking.frame === marking.frameCount - 1)
              }
              onPress={() => {
                onStep(step.delta);
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" label={t('cmjVideo.mark.takeoff')} onPress={onMarkTakeoff} />
        </View>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" label={t('cmjVideo.mark.landing')} onPress={onMarkLanding} />
        </View>
      </View>
      <MarkLine
        text={t('cmjVideo.mark.takeoffAt', { frame: markArg(marking.takeoffFrame) })}
        marked={marking.takeoffFrame !== null}
        goToLabel={t('cmjVideo.mark.goTo.takeoff')}
        onGoTo={() => {
          onGoTo('takeoff');
        }}
      />
      <MarkLine
        text={t('cmjVideo.mark.landingAt', { frame: markArg(marking.landingFrame) })}
        marked={marking.landingFrame !== null}
        goToLabel={t('cmjVideo.mark.goTo.landing')}
        onGoTo={() => {
          onGoTo('landing');
        }}
      />
      {result.status === 'incomplete' ? (
        <AppText tone="secondary">{t('cmjVideo.mark.incomplete')}</AppText>
      ) : null}
      {result.status === 'invalid' ? (
        <StatusMessage level="critical">{t('cmjVideo.mark.invalid')}</StatusMessage>
      ) : null}
      {result.status === 'measured' ? (
        <StatusMessage level={plausibility === 'within' ? 'ok' : 'warning'}>
          {t('cmjVideo.mark.result', {
            flight: formatUnit(result.flightTimeS, 's', { decimals: 3 }),
            height: formatUnit(result.heightCm, 'cm', { decimals: 1 }),
            precision: formatUnit(result.precisionCm, 'cm', { decimals: 1 }),
          })}
        </StatusMessage>
      ) : null}
      {result.status === 'measured' && plausibility !== 'within' ? (
        <StatusMessage level="warning">{t('cmjVideo.mark.implausible')}</StatusMessage>
      ) : null}
      {saveFailed ? (
        <StatusMessage level="critical">{t('cmjVideo.mark.saveFailed')}</StatusMessage>
      ) : null}
      <Button
        label={
          plausibility !== 'within' && confirmImplausible
            ? t('cmjVideo.mark.saveAnyway')
            : t('cmjVideo.mark.save', { number: attemptNumber })
        }
        busy={saving}
        disabled={result.status !== 'measured'}
        onPress={() => {
          if (plausibility !== 'within' && !confirmImplausible) {
            setConfirmedMarks(marks);
            return;
          }
          onSave();
        }}
      />
      <Button
        variant="link"
        label={t('cmjVideo.mark.discard')}
        disabled={saving}
        onPress={onDiscard}
      />
    </ScreenBody>
  );
}

const FAILURE_KEYS = {
  consent: 'cmjVideo.uploads.failed.consent',
  voided: 'cmjVideo.uploads.failed.voided',
  rejected: 'cmjVideo.uploads.failed.rejected',
  too_large: 'cmjVideo.uploads.failed.too_large',
  missing_file: 'cmjVideo.uploads.failed.missing_file',
} as const satisfies Record<NonNullable<CmjVideoCapture['failure']>, MessageKey>;

/** The videos of the phone that still have to go up, or that will not (with why). */
export function CmjVideoUploadsList({
  captures,
  playerNames,
  onDismiss,
}: {
  readonly captures: readonly CmjVideoCapture[];
  readonly playerNames: ReadonlyMap<string, string>;
  readonly onDismiss: (capture: CmjVideoCapture) => void;
}) {
  const { t } = useTranslator();
  const waiting = captures.filter((capture) => capture.state === 'waiting').length;
  return (
    <View style={{ gap: 8 }}>
      <AppText role="heading" accessibilityRole="header">
        {t('cmjVideo.uploads.title')}
      </AppText>
      {captures.length === 0 ? (
        <AppText tone="secondary">{t('cmjVideo.uploads.empty')}</AppText>
      ) : null}
      {waiting > 0 ? (
        <AppText tone="secondary">{t('cmjVideo.uploads.count', { count: waiting })}</AppText>
      ) : null}
      {captures.map((capture) => (
        <Card key={capture.id}>
          <AppText role="bodyStrong">
            {playerNames.get(capture.playerId) ?? t('common.notAvailable')}
          </AppText>
          <AppText tone="secondary">
            {t('cmjVideo.uploads.item', { number: capture.attemptNumber })}
          </AppText>
          {capture.state === 'waiting' ? (
            <StatusMessage level={capture.tries > 0 ? 'warning' : 'ok'}>
              {capture.tries > 0 ? t('cmjVideo.uploads.retrying') : t('cmjVideo.uploads.waiting')}
            </StatusMessage>
          ) : (
            <>
              <StatusMessage level="critical">
                {t(FAILURE_KEYS[capture.failure ?? 'rejected'])}
              </StatusMessage>
              <Button
                variant="secondary"
                label={t('cmjVideo.uploads.dismiss')}
                onPress={() => {
                  onDismiss(capture);
                }}
              />
            </>
          )}
        </Card>
      ))}
    </View>
  );
}
