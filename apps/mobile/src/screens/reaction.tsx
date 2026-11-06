import type {
  ReactionProtocol,
  ReactionSeriesSummary,
  ReactionTask,
  ReactionTrialRecord,
} from '@sport-performance/domain';
import { formatLocalDate, formatUnit } from '@sport-performance/i18n';
import type { LocalDate } from '@sport-performance/domain';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ReactionHistoryItem } from '../reaction/model.ts';
import type { ReactionProgress } from '../reaction/runner.ts';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  LoadingView,
  PendingMark,
  ScreenBody,
  ScreenHeader,
  StatusMessage,
  TextField,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

/**
 * Screens of the reaction test (B-606, ADR 0077): presentational, fed by the
 * route with the setup cached on the phone and the runner's state, so they
 * are tested without a device. While a player runs the test the screen
 * shows only the stimulus; the result shows only that player's own times
 * on this device.
 */

export type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: T };

const ms = (value: number) => formatUnit(value, 'msec');

export interface ReactionOption {
  readonly id: string;
  readonly name: string;
}

/** This phone as the screen tells it. */
export type DeviceStatus =
  | { readonly kind: 'registered'; readonly label: string }
  | { readonly kind: 'retired'; readonly label: string }
  | { readonly kind: 'unregistered' };

function OptionRow({
  label,
  selected,
  onPress,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={{
        minHeight: theme.sizes.touchTarget,
        justifyContent: 'center',
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused
          ? theme.colors.focus
          : selected
            ? theme.colors.brand.solid
            : theme.colors.border.subtle,
        backgroundColor: selected ? theme.colors.surfaceRaised : 'transparent',
      }}
    >
      <Text style={[theme.text.body, { color: theme.colors.text.primary }]}>
        {selected ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

export function ReactionNotAllowedScreen() {
  const { t } = useTranslator();
  return (
    <ScreenBody header={<ScreenHeader title={t('reaction.title')} />}>
      <StatusMessage level="warning">{t('reaction.notAllowed')}</StatusMessage>
    </ScreenBody>
  );
}

export function ReactionLoadFailedScreen({ onRetry }: { readonly onRetry: () => void }) {
  const { t } = useTranslator();
  return (
    <ScreenBody header={<ScreenHeader title={t('reaction.title')} />}>
      <StatusMessage level="critical">{t('reaction.loadFailed')}</StatusMessage>
      <Button label={t('reaction.retry')} variant="secondary" onPress={onRetry} />
    </ScreenBody>
  );
}

export function ReactionLoadingScreen() {
  const { t } = useTranslator();
  return <LoadingView label={t('reaction.loading')} />;
}

function DeviceCard({
  device,
  canManage,
  offline,
  label,
  onChangeLabel,
  onRegister,
  registering,
  registerFailed,
}: {
  readonly device: DeviceStatus;
  readonly canManage: boolean;
  readonly offline: boolean;
  readonly label: string;
  readonly onChangeLabel: (label: string) => void;
  readonly onRegister: () => void;
  readonly registering: boolean;
  readonly registerFailed: boolean;
}) {
  const { t } = useTranslator();
  const trimmed = label.trim();
  const labelError = trimmed.length === 0 || trimmed.length > 60;
  return (
    <Card title={t('reaction.device.title')}>
      {device.kind === 'registered' ? (
        <StatusMessage level="ok">
          {t('reaction.device.registered', { label: device.label })}
        </StatusMessage>
      ) : (
        <>
          <StatusMessage level="warning">
            {device.kind === 'retired'
              ? t('reaction.device.retired', { label: device.label })
              : t('reaction.device.notRegistered')}
          </StatusMessage>
          {!canManage ? (
            <AppText tone="secondary">{t('reaction.device.notAllowed')}</AppText>
          ) : (
            <>
              {device.kind === 'unregistered' ? (
                <TextField
                  label={t('reaction.device.label')}
                  hint={t('reaction.device.labelHint')}
                  value={label}
                  onChangeText={onChangeLabel}
                  error={labelError ? t('reaction.device.labelRequired') : null}
                  inputProps={{ maxLength: 60, autoCapitalize: 'sentences' }}
                />
              ) : null}
              {offline ? (
                <AppText role="bodySmall" tone="secondary">
                  {t('reaction.device.needsConnection')}
                </AppText>
              ) : null}
              {registerFailed ? (
                <StatusMessage level="critical">{t('reaction.device.failed')}</StatusMessage>
              ) : null}
              <Button
                label={
                  device.kind === 'retired'
                    ? t('reaction.device.restore')
                    : t('reaction.device.register')
                }
                onPress={onRegister}
                busy={registering}
                disabled={offline || (device.kind === 'unregistered' && labelError)}
              />
            </>
          )}
        </>
      )}
      <AppText role="bodySmall" tone="secondary">
        {t('reaction.device.why')}
      </AppText>
    </Card>
  );
}

export function ReactionSetupScreen({
  offline,
  fromCache,
  hasDefinition,
  device,
  canManageDevice,
  deviceLabel,
  onChangeDeviceLabel,
  onRegisterDevice,
  registering,
  registerFailed,
  categories,
  categoryId,
  onSelectCategory,
  players,
  onSelectPlayer,
  notice,
}: {
  readonly offline: boolean;
  /** What is shown comes from the phone (no answer from the API this time). */
  readonly fromCache: boolean;
  readonly hasDefinition: boolean;
  readonly device: DeviceStatus;
  readonly canManageDevice: boolean;
  readonly deviceLabel: string;
  readonly onChangeDeviceLabel: (label: string) => void;
  readonly onRegisterDevice: () => void;
  readonly registering: boolean;
  readonly registerFailed: boolean;
  readonly categories: readonly ReactionOption[];
  readonly categoryId: string | null;
  readonly onSelectCategory: (categoryId: string) => void;
  readonly players: LoadState<readonly ReactionOption[]> | null;
  readonly onSelectPlayer: (playerId: string) => void;
  /** A one-off message (a result saved, a series cut). */
  readonly notice: { readonly level: 'ok' | 'warning'; readonly text: string } | null;
}) {
  const { t } = useTranslator();
  const ready = hasDefinition && device.kind === 'registered';
  return (
    <ScreenBody header={<ScreenHeader title={t('reaction.title')} />}>
      {notice !== null ? <StatusMessage level={notice.level}>{notice.text}</StatusMessage> : null}
      {offline || fromCache ? (
        <StatusMessage level="warning">{t('reaction.offlineCopy')}</StatusMessage>
      ) : null}
      {!hasDefinition ? (
        <StatusMessage level="critical">{t('reaction.noDefinition')}</StatusMessage>
      ) : null}
      <DeviceCard
        device={device}
        canManage={canManageDevice}
        offline={offline}
        label={deviceLabel}
        onChangeLabel={onChangeDeviceLabel}
        onRegister={onRegisterDevice}
        registering={registering}
        registerFailed={registerFailed}
      />
      {ready ? (
        <>
          <Card title={t('reaction.category.title')}>
            {categories.length === 0 ? (
              <AppText tone="secondary">{t('reaction.category.none')}</AppText>
            ) : (
              <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
                {categories.map((category) => (
                  <OptionRow
                    key={category.id}
                    label={category.name}
                    selected={category.id === categoryId}
                    onPress={() => {
                      onSelectCategory(category.id);
                    }}
                  />
                ))}
              </View>
            )}
          </Card>
          {players !== null ? (
            <Card title={t('reaction.player.title')}>
              {players.status === 'loading' ? (
                <LoadingView label={t('reaction.loading')} />
              ) : players.status === 'error' ? (
                <StatusMessage level="critical">{players.message}</StatusMessage>
              ) : players.data.length === 0 ? (
                <AppText tone="secondary">{t('reaction.player.none')}</AppText>
              ) : (
                <>
                  <AppText tone="secondary">{t('reaction.player.choose')}</AppText>
                  {players.data.map((player) => (
                    <Button
                      key={player.id}
                      label={player.name}
                      variant="secondary"
                      onPress={() => {
                        onSelectPlayer(player.id);
                      }}
                    />
                  ))}
                </>
              )}
            </Card>
          ) : null}
        </>
      ) : null}
    </ScreenBody>
  );
}

/** Before a series: whose turn, what to do, and the practice rule. */
export function ReactionIntroScreen({
  playerName,
  task,
  taskIndex,
  taskCount,
  protocol,
  interrupted,
  onBegin,
  onCancel,
}: {
  readonly playerName: string;
  readonly task: ReactionTask;
  readonly taskIndex: number;
  readonly taskCount: number;
  readonly protocol: ReactionProtocol;
  readonly interrupted: boolean;
  readonly onBegin: () => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslator();
  return (
    <ScreenBody>
      <AppText role="overline" tone="secondary">
        {t('reaction.intro.series', { number: taskIndex + 1, total: taskCount })}
      </AppText>
      <AppText role="title" accessibilityRole="header">
        {t(`reaction.task.${task}`)}
      </AppText>
      {taskIndex === 0 ? (
        <AppText role="heading">{t('reaction.handOver', { name: playerName })}</AppText>
      ) : null}
      {interrupted ? (
        <StatusMessage level="warning">{t('reaction.interrupted')}</StatusMessage>
      ) : null}
      <AppText>{t(`reaction.intro.${task}`)}</AppText>
      <AppText tone="secondary">
        {t('reaction.intro.practice', {
          count: protocol.practiceTrials,
          valid: protocol.validTrials,
        })}
      </AppText>
      <Button label={t('reaction.begin')} onPress={onBegin} />
      <Button label={t('reaction.cancel')} variant="link" onPress={onCancel} />
    </ScreenBody>
  );
}

/** The response area: the whole screen, a stimulus with shape and words, never color alone. */
export function ReactionRunScreen({
  view,
  onTouch,
  onStimulusShown,
  now,
}: {
  readonly view:
    | { readonly phase: 'waiting'; readonly progress: ReactionProgress; readonly trial: number }
    | {
        readonly phase: 'stimulus';
        readonly stimulus: 'go' | 'no_go';
        readonly progress: ReactionProgress;
        readonly trial: number;
      }
    | {
        readonly phase: 'feedback';
        readonly record: ReactionTrialRecord;
        readonly progress: ReactionProgress;
      };
  readonly onTouch: (at: number) => void;
  readonly onStimulusShown: (at: number) => void;
  /** The monotonic clock the runner reads (`performance.now()`). */
  readonly now: () => number;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const stimulusTrial = view.phase === 'stimulus' ? view.trial : null;
  useEffect(() => {
    if (stimulusTrial === null) return undefined;
    // The first frame after the commit: the stimulus is on screen from then on.
    const handle = requestAnimationFrame(() => {
      onStimulusShown(now());
    });
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [stimulusTrial, onStimulusShown, now]);

  const progress = view.progress.practice
    ? t('reaction.progress.practice')
    : t('reaction.progress.valid', { valid: view.progress.valid, needed: view.progress.needed });

  let content;
  if (view.phase === 'waiting') {
    content = (
      <>
        <Text
          accessible={false}
          style={[theme.text.metricXl, { color: theme.colors.text.secondary }]}
        >
          +
        </Text>
        <AppText tone="secondary">{t('reaction.wait')}</AppText>
      </>
    );
  } else if (view.phase === 'stimulus') {
    const go = view.stimulus === 'go';
    const colors = theme.colors.status[go ? 'ok' : 'critical'];
    content = (
      <View
        accessibilityLiveRegion="assertive"
        style={{
          width: 220,
          height: 220,
          // Go is a circle, no-go a square: shape and words, never color alone.
          borderRadius: go ? 110 : theme.radius.md,
          backgroundColor: colors.solid,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[theme.text.display, { color: colors.onSolid, textAlign: 'center' }]}>
          {t(`reaction.stimulus.${view.stimulus}`)}
        </Text>
      </View>
    );
  } else {
    const { record } = view;
    const text =
      record.outcome === 'valid' && record.reactionMs !== null
        ? t('reaction.feedback.valid', { time: ms(record.reactionMs) })
        : t(`reaction.feedback.${record.outcome}`);
    const level =
      record.outcome === 'valid' || record.outcome === 'correct_rejection' ? 'ok' : 'warning';
    content = (
      <View style={{ minWidth: 240 }}>
        <StatusMessage level={level}>{text}</StatusMessage>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('reaction.area')}
      // The earliest event of a touch: `onPress` waits for the finger to lift.
      onPressIn={() => {
        onTouch(now());
      }}
      style={{
        flex: 1,
        backgroundColor: theme.colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.spacing.lg,
        padding: theme.spacing.xl,
      }}
    >
      <View style={{ position: 'absolute', top: theme.spacing.xl, right: theme.spacing.xl }}>
        <AppText role="overline" tone="secondary">
          {progress}
        </AppText>
      </View>
      {content}
    </Pressable>
  );
}

function SeriesResult({
  summary,
  history,
  validNeeded,
}: {
  readonly summary: ReactionSeriesSummary;
  readonly history: readonly ReactionHistoryItem[];
  readonly validNeeded: number;
}) {
  const { t } = useTranslator();
  const previous = history.at(-1);
  const best = history.length === 0 ? null : Math.min(...history.map((item) => item.valueMs));
  return (
    <Card title={t(`reaction.task.${summary.task}`)}>
      {summary.status === 'complete' && summary.meanMs !== null ? (
        <>
          <AppText role="metric">{t('reaction.result.mean', { time: ms(summary.meanMs) })}</AppText>
          {previous === undefined ? (
            <AppText tone="secondary">{t('reaction.result.firstOnDevice')}</AppText>
          ) : (
            <>
              <AppText tone="secondary">
                {t('reaction.result.previous', {
                  time: ms(previous.valueMs),
                  date: formatLocalDate(previous.measuredOn as LocalDate),
                })}
              </AppText>
              {best !== null ? (
                <AppText tone="secondary">{t('reaction.result.best', { time: ms(best) })}</AppText>
              ) : null}
            </>
          )}
        </>
      ) : (
        <StatusMessage level="warning">
          {t('reaction.result.incomplete', { valid: validNeeded })}
        </StatusMessage>
      )}
      <AppText role="bodySmall" tone="secondary">
        {t('reaction.result.errors', {
          anticipations: summary.anticipations,
          lapses: summary.lapses,
        })}
      </AppText>
      {summary.task === 'go_no_go' ? (
        <AppText role="bodySmall" tone="secondary">
          {t('reaction.result.commissions', {
            commissions: summary.commissions,
            noGo: summary.noGoTrials,
          })}
        </AppText>
      ) : null}
    </Card>
  );
}

function HistoryList({ items }: { readonly items: readonly ReactionHistoryItem[] }) {
  const { t } = useTranslator();
  const theme = useTheme();
  if (items.length === 0) return null;
  return (
    <Card title={t('reaction.result.historyTitle')}>
      <AppText role="bodySmall" tone="secondary">
        {t('reaction.result.historyHint')}
      </AppText>
      {[...items].reverse().map((item) => (
        <View key={item.key} style={{ gap: theme.spacing.xxs }}>
          <AppText role="tabular">
            {`${formatLocalDate(item.measuredOn as LocalDate)} · ${t(`reaction.task.${item.task}`)} · ${ms(item.valueMs)}`}
          </AppText>
          {item.pending ? <PendingMark /> : null}
        </View>
      ))}
    </Card>
  );
}

export function ReactionResultScreen({
  playerName,
  summaries,
  history,
  validNeeded,
  saving,
  saveFailed,
  onSave,
  onRepeat,
  onDiscard,
}: {
  readonly playerName: string;
  readonly summaries: readonly ReactionSeriesSummary[];
  readonly history: Record<ReactionTask, readonly ReactionHistoryItem[]> | null;
  readonly validNeeded: number;
  readonly saving: boolean;
  readonly saveFailed: boolean;
  readonly onSave: () => void;
  readonly onRepeat: () => void;
  readonly onDiscard: () => void;
}) {
  const { t } = useTranslator();
  const savable = summaries.some((summary) => summary.status === 'complete');
  const all = history === null ? [] : [...history.simple, ...history.go_no_go];
  return (
    <ScreenBody header={<ScreenHeader title={t('reaction.result.title', { name: playerName })} />}>
      {summaries.map((summary) => (
        <SeriesResult
          key={summary.task}
          summary={summary}
          history={history?.[summary.task] ?? []}
          validNeeded={validNeeded}
        />
      ))}
      <HistoryList items={[...all].sort((a, b) => a.measuredOn.localeCompare(b.measuredOn))} />
      {saveFailed ? (
        <StatusMessage level="critical">{t('reaction.saveFailed')}</StatusMessage>
      ) : null}
      {savable ? (
        <Button
          label={saving ? t('reaction.saving') : t('reaction.save')}
          onPress={onSave}
          busy={saving}
        />
      ) : (
        <StatusMessage level="warning">{t('reaction.result.nothingToSave')}</StatusMessage>
      )}
      <Button label={t('reaction.repeat')} variant="secondary" onPress={onRepeat} />
      <Button label={t('reaction.discard')} variant="link" onPress={onDiscard} />
    </ScreenBody>
  );
}
