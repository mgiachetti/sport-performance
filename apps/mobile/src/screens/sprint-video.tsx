import type { LocalDate, Sex, SprintVideoLayout } from '@sport-performance/domain';
import { formatLocalDate, formatNumber, formatUnit } from '@sport-performance/i18n';
import type { ReactNode } from 'react';
import { Image, View } from 'react-native';
import { filmingBlock, type SprintVideoPlayer } from '../sprint-video/attempt.ts';
import type { LayoutDraft, LayoutParse } from '../sprint-video/layout.ts';
import {
  SPRINT_FRAME_STEPS,
  SPRINT_MARKS,
  SPRINT_MARK_LINE_M,
  implausibleSprintValues,
  sprintMarkingResult,
  type SprintMark,
  type SprintMarkingState,
} from '../sprint-video/marking.ts';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  LoadingView,
  ScreenBody,
  StatusMessage,
  TextField,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * Screens of the sprint by video (B-605, ADR 0082): presentational, fed by
 * the route, so they are tested without a camera. The camera is a slot (the
 * route passes the native one) and the frames come as image URIs.
 */

/** A recording, as the camera hands it over. */
export interface RecordedSprintVideo {
  readonly path: string;
  readonly durationMs: number;
  /** The frame rate the camera session settled on. */
  readonly frameRateFps: number;
}

/** What the camera reports to the screen. */
export type SprintCameraState =
  | { readonly status: 'preparing' }
  | { readonly status: 'ready'; readonly frameRateFps: number }
  | { readonly status: 'no_permission' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'error'; readonly error: unknown };

export interface SprintCameraProps {
  /** `true` to record, `false` to stop (the recording also stops alone). */
  readonly recording: boolean;
  readonly onRecorded: (video: RecordedSprintVideo) => void;
  readonly onState: (state: SprintCameraState) => void;
}

/** The image of each frame of a recording (`expo-video-thumbnails` on the phone). */
export interface SprintFrameSource {
  /** URI of the image of the video at `timeMs`. */
  frameAt(videoPath: string, timeMs: number): Promise<string>;
  /** Deletes the images it wrote. */
  release(): Promise<void>;
}

function Title({ children }: { readonly children: string }) {
  return (
    <AppText role="title" accessibilityRole="header">
      {children}
    </AppText>
  );
}

// ─── Days ────────────────────────────────────────────────────────────────────────────

export interface SprintVideoDayItem {
  readonly id: string;
  readonly scheduledOn: LocalDate;
  readonly location: string | null;
}

export function SprintVideoDaysScreen({
  days,
  onPick,
}: {
  readonly days: readonly SprintVideoDayItem[];
  readonly onPick: (id: string) => void;
}) {
  const { t } = useTranslator();
  return (
    <ScreenBody>
      <Title>{t('sprintVideo.title')}</Title>
      <AppText tone="secondary">{t('sprintVideo.intro')}</AppText>
      <AppText role="heading" accessibilityRole="header">
        {t('sprintVideo.days.title')}
      </AppText>
      {days.length === 0 ? <AppText tone="secondary">{t('sprintVideo.days.empty')}</AppText> : null}
      {days.map((day) => (
        <Button
          key={day.id}
          variant="secondary"
          label={t('sprintVideo.days.item', {
            date: formatLocalDate(day.scheduledOn),
            place: day.location ?? 'none',
          })}
          onPress={() => {
            onPick(day.id);
          }}
        />
      ))}
    </ScreenBody>
  );
}

// ─── Layout of the field ─────────────────────────────────────────────────────────────

function metres(value: number): string {
  return formatUnit(value, 'm', { maxDecimals: 1, minDecimals: 0 });
}

export function SprintVideoSetupScreen({
  draft,
  parsed,
  mainCameraMinDistanceM,
  onChange,
  onContinue,
  onBack,
}: {
  readonly draft: LayoutDraft;
  readonly parsed: LayoutParse;
  /** Shortest distance at which the main camera sees the four lines. */
  readonly mainCameraMinDistanceM: number;
  readonly onChange: (draft: LayoutDraft) => void;
  readonly onContinue: (layout: SprintVideoLayout) => void;
  readonly onBack: () => void;
}) {
  const { t } = useTranslator();
  const problem = (field: 'cameraDistance' | 'poleOffset') => {
    if (parsed.status === 'ok') return null;
    const kind = parsed[field];
    return kind === null ? null : t(`sprintVideo.setup.${field}.${kind}`);
  };
  const layout = parsed.status === 'ok' ? parsed.layout : null;
  const oblique = layout?.poles.some((pole) => pole.oblique) ?? false;
  return (
    <ScreenBody>
      <Title>{t('sprintVideo.setup.title')}</Title>
      <AppText tone="secondary">{t('sprintVideo.setup.body')}</AppText>
      <TextField
        label={t('sprintVideo.setup.cameraDistance')}
        hint={t('sprintVideo.setup.cameraDistance.hint', {
          distance: metres(mainCameraMinDistanceM),
        })}
        value={draft.cameraDistance}
        error={problem('cameraDistance')}
        onChangeText={(cameraDistance) => {
          onChange({ ...draft, cameraDistance });
        }}
        inputProps={{ keyboardType: 'decimal-pad' }}
      />
      <TextField
        label={t('sprintVideo.setup.poleOffset')}
        hint={t('sprintVideo.setup.poleOffset.hint')}
        value={draft.poleOffset}
        error={problem('poleOffset')}
        onChangeText={(poleOffset) => {
          onChange({ ...draft, poleOffset });
        }}
        inputProps={{ keyboardType: 'decimal-pad' }}
      />
      {layout === null ? null : (
        <Card>
          <AppText role="overline" tone="secondary" accessibilityRole="header">
            {t('sprintVideo.setup.cones')}
          </AppText>
          <AppText>
            {t('sprintVideo.setup.camera', {
              at: metres(layout.cameraAtM),
              distance: metres(layout.cameraDistanceM),
            })}
          </AppText>
          {layout.poles.map((pole) => (
            <AppText key={pole.lineM}>
              {pole.poleAtM < 0
                ? t('sprintVideo.setup.coneBefore', {
                    line: metres(pole.lineM),
                    before: metres(-pole.poleAtM),
                    behind: metres(layout.poleOffsetM),
                  })
                : t('sprintVideo.setup.cone', {
                    line: metres(pole.lineM),
                    at: metres(pole.poleAtM),
                    behind: metres(layout.poleOffsetM),
                  })}
            </AppText>
          ))}
          <AppText tone="secondary">
            {t('sprintVideo.setup.fieldOfView', {
              angle: formatNumber(Math.ceil(layout.fieldOfViewDeg), { decimals: 0 }),
            })}
          </AppText>
        </Card>
      )}
      {oblique ? (
        <StatusMessage level="warning">{t('sprintVideo.setup.oblique')}</StatusMessage>
      ) : null}
      <StatusMessage level="ok">{t('sprintVideo.setup.check')}</StatusMessage>
      <Button
        label={t('sprintVideo.setup.continue')}
        disabled={layout === null}
        onPress={() => {
          if (layout !== null) onContinue(layout);
        }}
      />
      <Button variant="link" label={t('common.back')} onPress={onBack} />
    </ScreenBody>
  );
}

// ─── Players ─────────────────────────────────────────────────────────────────────────

export interface SprintVideoPlayerRow {
  readonly player: SprintVideoPlayer;
  readonly attempts: number;
}

export function SprintVideoPlayersScreen({
  rows,
  plannedAttempts,
  offline,
  notice,
  onFilm,
  onLayout,
  onBack,
}: {
  readonly rows: readonly SprintVideoPlayerRow[];
  readonly plannedAttempts: number;
  readonly offline: boolean;
  readonly notice: string | null;
  readonly onFilm: (playerId: string) => void;
  readonly onLayout: () => void;
  readonly onBack: () => void;
}) {
  const { t } = useTranslator();
  return (
    <ScreenBody>
      <Title>{t('sprintVideo.players.title')}</Title>
      {offline ? <StatusMessage level="warning">{t('sync.offline')}</StatusMessage> : null}
      {notice === null ? null : <StatusMessage level="ok">{notice}</StatusMessage>}
      {rows.map(({ player, attempts }) => {
        const block = filmingBlock(player);
        return (
          <Card key={player.id}>
            <AppText role="bodyStrong">{player.name}</AppText>
            <AppText tone="secondary">
              {t('sprintVideo.player.attempts', { count: attempts, planned: plannedAttempts })}
            </AppText>
            {block === null ? (
              <Button
                label={t('sprintVideo.player.film')}
                accessibilityLabel={t('sprintVideo.player.filmName', { name: player.name })}
                onPress={() => {
                  onFilm(player.id);
                }}
              />
            ) : (
              <StatusMessage level="warning">{t(`sprintVideo.block.${block}`)}</StatusMessage>
            )}
          </Card>
        );
      })}
      <Button variant="secondary" label={t('sprintVideo.players.layout')} onPress={onLayout} />
      <Button variant="link" label={t('common.back')} onPress={onBack} />
    </ScreenBody>
  );
}

// ─── Recording ───────────────────────────────────────────────────────────────────────

export function SprintVideoRecordScreen({
  playerName,
  cameraState,
  recording,
  maxDurationS,
  camera,
  onStart,
  onStop,
  onCancel,
}: {
  readonly playerName: string;
  readonly cameraState: SprintCameraState;
  readonly recording: boolean;
  readonly maxDurationS: number;
  /** The camera preview (the native one on the phone). */
  readonly camera: ReactNode;
  readonly onStart: () => void;
  readonly onStop: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const state = (() => {
    switch (cameraState.status) {
      case 'preparing':
        return <LoadingView label={t('sprintVideo.record.preparing')} />;
      case 'ready':
        return (
          <AppText tone="secondary">
            {t('sprintVideo.record.ready', {
              fps: formatNumber(cameraState.frameRateFps, { decimals: 0 }),
              seconds: maxDurationS,
            })}
          </AppText>
        );
      case 'no_permission':
        return (
          <StatusMessage level="warning">{t('sprintVideo.record.noPermission')}</StatusMessage>
        );
      case 'unsupported':
        return <StatusMessage level="warning">{t('sprintVideo.record.unsupported')}</StatusMessage>;
      case 'error':
        return <StatusMessage level="critical">{t('sprintVideo.record.error')}</StatusMessage>;
    }
  })();
  return (
    <ScreenBody>
      <Title>{playerName}</Title>
      <AppText tone="secondary">{t('sprintVideo.record.how')}</AppText>
      <View
        style={{
          aspectRatio: 16 / 9,
          borderRadius: theme.radius.md,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceRaised,
        }}
      >
        {camera}
      </View>
      {state}
      {recording ? (
        <StatusMessage level="warning">{t('sprintVideo.record.recording')}</StatusMessage>
      ) : null}
      {recording ? (
        <Button label={t('sprintVideo.record.stop')} onPress={onStop} />
      ) : (
        <Button
          label={t('sprintVideo.record.start')}
          disabled={cameraState.status !== 'ready'}
          onPress={onStart}
        />
      )}
      <Button variant="link" label={t('common.cancel')} disabled={recording} onPress={onCancel} />
    </ScreenBody>
  );
}

// ─── Marking ─────────────────────────────────────────────────────────────────────────

function seconds(value: number | undefined): string {
  return formatUnit(value, 's');
}

export function SprintVideoMarkScreen({
  playerName,
  sex,
  marking,
  attemptNumber,
  frameUri,
  frameFailed,
  saving,
  saveFailed,
  onStep,
  onSelect,
  onMark,
  onGoTo,
  onClear,
  onSave,
  onDiscard,
}: {
  readonly playerName: string;
  readonly sex: Sex;
  readonly marking: SprintMarkingState;
  readonly attemptNumber: number;
  /** The image of the frame on screen; `null` while it loads. */
  readonly frameUri: string | null;
  readonly frameFailed: boolean;
  readonly saving: boolean;
  readonly saveFailed: boolean;
  readonly onStep: (delta: number) => void;
  readonly onSelect: (mark: SprintMark) => void;
  readonly onMark: () => void;
  readonly onGoTo: (mark: SprintMark) => void;
  readonly onClear: (mark: SprintMark) => void;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const result = sprintMarkingResult(marking);
  const implausible = result.status === 'measured' ? implausibleSprintValues(result, sex) : [];
  const lineLabel = (mark: SprintMark) =>
    t(`sprintVideo.mark.line.${mark}`, { line: metres(SPRINT_MARK_LINE_M[mark]) });
  const timeS = marking.frame / marking.frameRateFps;
  return (
    <ScreenBody>
      <Title>{t('sprintVideo.mark.title', { name: playerName, number: attemptNumber })}</Title>
      <AppText tone="secondary">{t('sprintVideo.mark.how')}</AppText>
      <View
        style={{
          aspectRatio: 16 / 9,
          borderRadius: theme.radius.md,
          overflow: 'hidden',
          backgroundColor: theme.colors.surfaceRaised,
          justifyContent: 'center',
        }}
      >
        {frameUri === null ? (
          frameFailed ? (
            <StatusMessage level="warning">{t('sprintVideo.mark.frameFailed')}</StatusMessage>
          ) : (
            <LoadingView label={t('sprintVideo.mark.loadingFrame')} />
          )
        ) : (
          <Image
            source={{ uri: frameUri }}
            style={{ width: '100%', height: '100%' }}
            resizeMode="contain"
            accessibilityLabel={t('sprintVideo.mark.frameImage', {
              frame: marking.frame + 1,
              total: marking.frameCount,
            })}
          />
        )}
      </View>
      <AppText role="bodyStrong">
        {t('sprintVideo.mark.frame', {
          frame: marking.frame + 1,
          total: marking.frameCount,
          time: seconds(timeS),
        })}
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {SPRINT_FRAME_STEPS.map((delta) => (
          <Button
            key={delta}
            variant="secondary"
            label={formatNumber(delta, { decimals: 0, sign: 'always' })}
            accessibilityLabel={t(
              delta < 0 ? 'sprintVideo.mark.back' : 'sprintVideo.mark.forward',
              {
                count: Math.abs(delta),
              },
            )}
            onPress={() => {
              onStep(delta);
            }}
          />
        ))}
      </View>
      <Button
        label={t('sprintVideo.mark.markCurrent', { line: lineLabel(marking.current) })}
        onPress={onMark}
      />
      <Card>
        {SPRINT_MARKS.map((mark) => {
          const frame = marking.marks[mark];
          const selected = marking.current === mark;
          return (
            <View
              key={mark}
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: theme.spacing.sm,
              }}
            >
              <View style={{ flex: 1, minWidth: 160 }}>
                <AppText
                  role={selected ? 'bodyStrong' : 'body'}
                  tone={selected ? 'accent' : 'primary'}
                >
                  {`${selected ? '▸ ' : ''}${lineLabel(mark)}`}
                </AppText>
                <AppText tone="secondary">
                  {frame === null
                    ? t(
                        mark === 'line10'
                          ? 'sprintVideo.mark.optional'
                          : 'sprintVideo.mark.unmarked',
                      )
                    : t('sprintVideo.mark.atFrame', { frame: frame + 1 })}
                </AppText>
              </View>
              {selected ? null : (
                <Button
                  variant="link"
                  label={t('sprintVideo.mark.select')}
                  accessibilityLabel={t('sprintVideo.mark.selectLine', { line: lineLabel(mark) })}
                  onPress={() => {
                    onSelect(mark);
                  }}
                />
              )}
              {frame === null ? null : (
                <>
                  <Button
                    variant="link"
                    label={t('sprintVideo.mark.goTo')}
                    accessibilityLabel={t('sprintVideo.mark.goToLine', { line: lineLabel(mark) })}
                    onPress={() => {
                      onGoTo(mark);
                    }}
                  />
                  <Button
                    variant="link"
                    label={t('sprintVideo.mark.clear')}
                    accessibilityLabel={t('sprintVideo.mark.clearLine', { line: lineLabel(mark) })}
                    onPress={() => {
                      onClear(mark);
                    }}
                  />
                </>
              )}
            </View>
          );
        })}
      </Card>
      {result.status === 'invalid' ? (
        <StatusMessage level="warning">{t('sprintVideo.mark.invalid')}</StatusMessage>
      ) : null}
      {result.status === 'measured' ? (
        <Card>
          <AppText role="overline" tone="secondary" accessibilityRole="header">
            {t('sprintVideo.mark.result')}
          </AppText>
          {result.splits.split10S === undefined ? null : (
            <AppText>
              {t('sprintVideo.mark.split', {
                line: metres(10),
                time: seconds(result.splits.split10S),
              })}
            </AppText>
          )}
          <AppText>
            {t('sprintVideo.mark.split', {
              line: metres(20),
              time: seconds(result.splits.split20S),
            })}
          </AppText>
          <AppText>
            {t('sprintVideo.mark.split', {
              line: metres(40),
              time: seconds(result.splits.split40S),
            })}
          </AppText>
          <AppText role="bodyStrong">
            {t('sprintVideo.mark.vmax', { speed: formatUnit(result.vmaxMs, 'ms') })}
          </AppText>
          <AppText tone="secondary">
            {t('sprintVideo.mark.precision', {
              split: formatUnit(result.splitPrecisionS * 1000, 'msec'),
              speed: formatUnit(result.vmaxPrecisionMs, 'ms'),
            })}
          </AppText>
        </Card>
      ) : null}
      {implausible.length > 0 ? (
        <StatusMessage level="warning">{t('sprintVideo.mark.implausible')}</StatusMessage>
      ) : null}
      {saveFailed ? (
        <StatusMessage level="critical">{t('sprintVideo.mark.saveFailed')}</StatusMessage>
      ) : null}
      <Button
        // Out of range is a warning, never a block: the button says it saves anyway.
        label={t(implausible.length > 0 ? 'sprintVideo.mark.saveAnyway' : 'sprintVideo.mark.save')}
        disabled={result.status !== 'measured'}
        busy={saving}
        onPress={onSave}
      />
      <Button
        variant="link"
        label={t('sprintVideo.mark.discard')}
        disabled={saving}
        onPress={onDiscard}
      />
    </ScreenBody>
  );
}
