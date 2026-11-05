import type {
  Ift3015Moment,
  Ift3015PlayerMarks,
  Ift3015PlayerResult,
  Ift3015SignalProtocol,
} from '@sport-performance/domain';
import { formatNumber, formatUnit } from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
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
 * Screens of the 30-15 IFT signals (B-507, ADR 0070): presentational, fed by
 * the route with the runner's state, so they are tested without a device.
 */

export interface IftRosterPlayer {
  readonly id: string;
  readonly name: string;
}

export type LoadState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: T };

function speed(speedKmh: number): string {
  return formatUnit(speedKmh, 'kmh', { decimals: 1 });
}

function secondsLeft(ms: number): number {
  return Math.max(0, Math.ceil(ms / 1000));
}

/** Icon and text, never color alone (CLAUDE.md). */
function StatusTag({
  level,
  children,
}: {
  readonly level: StatusLevel;
  readonly children: string;
}) {
  const theme = useTheme();
  const colors = theme.colors.status[level];
  const glyph = { ok: '✓', warning: '!', critical: '✕' }[level];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.xs }}>
      <View
        accessible={false}
        style={{
          width: theme.sizes.statusIcon,
          height: theme.sizes.statusIcon,
          borderRadius: theme.sizes.statusIcon / 2,
          backgroundColor: colors.solid,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={[theme.text.caption, { color: colors.onSolid, fontWeight: '700' }]}>
          {glyph}
        </Text>
      </View>
      <Text style={[theme.text.bodySmall, { color: theme.colors.text.secondary, flexShrink: 1 }]}>
        {children}
      </Text>
    </View>
  );
}

function ProtocolSummary({ protocol }: { readonly protocol: Ift3015SignalProtocol }) {
  const { t } = useTranslator();
  return (
    <AppText role="bodySmall" tone="secondary">
      {t('ift.setup.protocol', {
        speed: speed(protocol.initialSpeedKmh),
        increment: speed(protocol.stageIncrementKmh),
        work: formatNumber(protocol.workDurationS),
        recovery: formatNumber(protocol.recoveryDurationS),
        shuttle: formatNumber(protocol.shuttleLengthM),
        zone: formatNumber(protocol.toleranceZoneM),
        misses: protocol.missesToStop,
      })}
    </AppText>
  );
}

export function CheckRow({
  label,
  checked,
  onPress,
  role = 'checkbox',
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onPress: () => void;
  readonly role?: 'checkbox' | 'radio';
}) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      aria-checked={checked}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={{
        minHeight: theme.sizes.touchTarget,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        paddingHorizontal: theme.spacing.md,
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused ? theme.colors.focus : theme.colors.border.subtle,
        backgroundColor: checked ? theme.colors.surfaceRaised : 'transparent',
      }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: role === 'radio' ? 12 : theme.radius.sm,
          borderWidth: theme.borderWidth.thick,
          borderColor: checked ? theme.colors.brand.solid : theme.colors.border.strong,
          backgroundColor: checked ? theme.colors.brand.solid : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? (
          <Text style={[theme.text.caption, { color: theme.colors.brand.onSolid }]}>✓</Text>
        ) : null}
      </View>
      <Text style={[theme.text.body, { color: theme.colors.text.primary, flex: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export function IftSetupScreen({
  protocol,
  categories,
  categoryId,
  onSelectCategory,
  players,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
  onStart,
  preparing,
  audioError,
  offline,
}: {
  readonly protocol: Ift3015SignalProtocol;
  readonly categories: LoadState<readonly { readonly id: string; readonly name: string }[]>;
  readonly categoryId: string | null;
  readonly onSelectCategory: (categoryId: string) => void;
  readonly players: LoadState<readonly IftRosterPlayer[]> | null;
  readonly selected: ReadonlySet<string>;
  readonly onToggle: (playerId: string) => void;
  readonly onSelectAll: () => void;
  readonly onSelectNone: () => void;
  readonly onStart: () => void;
  readonly preparing: boolean;
  readonly audioError: boolean;
  readonly offline: boolean;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const roster = players?.status === 'ready' ? players.data : [];
  const chosen = roster.filter((player) => selected.has(player.id)).length;
  return (
    <ScreenBody header={<ScreenHeader title={t('ift.title')} subtitle={t('ift.setup.body')} />}>
      <ProtocolSummary protocol={protocol} />
      {offline ? <StatusMessage level="warning">{t('sync.offline')}</StatusMessage> : null}

      <Card title={t('ift.setup.category')}>
        {categories.status === 'loading' ? (
          <AppText tone="secondary">{t('common.loading')}</AppText>
        ) : categories.status === 'error' ? (
          <StatusMessage level="critical">{categories.message}</StatusMessage>
        ) : categories.data.length === 0 ? (
          <StatusMessage level="warning">{t('ift.setup.noCategories')}</StatusMessage>
        ) : (
          <View accessibilityRole="radiogroup" style={{ gap: theme.spacing.sm }}>
            {categoryId === null ? (
              <AppText role="bodySmall" tone="secondary">
                {t('ift.setup.chooseCategory')}
              </AppText>
            ) : null}
            {categories.data.map((category) => (
              <CheckRow
                key={category.id}
                role="radio"
                label={category.name}
                checked={category.id === categoryId}
                onPress={() => {
                  onSelectCategory(category.id);
                }}
              />
            ))}
          </View>
        )}
      </Card>

      {players === null ? null : (
        <Card>
          {players.status === 'loading' ? (
            <AppText tone="secondary">{t('common.loading')}</AppText>
          ) : players.status === 'error' ? (
            <StatusMessage level="critical">{players.message}</StatusMessage>
          ) : roster.length === 0 ? (
            <StatusMessage level="warning">{t('ift.setup.noPlayers')}</StatusMessage>
          ) : (
            <>
              <AppText role="overline" tone="secondary" accessibilityRole="header">
                {t('ift.setup.players', { selected: chosen, total: roster.length })}
              </AppText>
              <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                <Button variant="link" label={t('ift.setup.selectAll')} onPress={onSelectAll} />
                <Button variant="link" label={t('ift.setup.selectNone')} onPress={onSelectNone} />
              </View>
              <View style={{ gap: theme.spacing.sm }}>
                {roster.map((player) => (
                  <CheckRow
                    key={player.id}
                    label={player.name}
                    checked={selected.has(player.id)}
                    onPress={() => {
                      onToggle(player.id);
                    }}
                  />
                ))}
              </View>
            </>
          )}
        </Card>
      )}

      {audioError ? (
        <StatusMessage level="critical">{t('ift.setup.audioError')}</StatusMessage>
      ) : null}
      <Button
        label={preparing ? t('ift.setup.preparing') : t('ift.setup.start')}
        onPress={onStart}
        disabled={chosen === 0}
        busy={preparing}
      />
    </ScreenBody>
  );
}

/** Phase, stage, speed and the seconds left, big enough to read from the field. */
function StageBoard({ moment }: { readonly moment: Ift3015Moment }) {
  const { t } = useTranslator();
  const theme = useTheme();
  const seconds = secondsLeft(moment.phaseRemainingMs);
  const phase = t(`ift.phase.${moment.phase}`);
  const accent = moment.phase === 'run' ? theme.colors.brand.accent : theme.colors.text.primary;
  return (
    <View
      accessible
      accessibilityLabel={t('ift.run.status', {
        phase,
        stage: moment.stage,
        speed: speed(moment.speedKmh),
        seconds,
      })}
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: moment.phase === 'run' ? theme.colors.brand.solid : theme.colors.border.subtle,
        borderWidth: theme.borderWidth.thick,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        gap: theme.spacing.xs,
        alignItems: 'center',
      }}
    >
      <Text style={[theme.text.overline, { color: accent }]}>{phase}</Text>
      <Text style={[theme.text.metricXl, { color: theme.colors.text.primary }]}>
        {t('ift.run.remaining', { seconds })}
      </Text>
      <Text style={[theme.text.heading, { color: theme.colors.text.primary }]}>
        {t('ift.run.stage', { stage: moment.stage })} · {speed(moment.speedKmh)}
      </Text>
      {moment.nextSpeedKmh !== null && moment.phase !== 'lead_in' ? (
        <Text style={[theme.text.bodySmall, { color: theme.colors.text.secondary }]}>
          {t('ift.run.next', { speed: speed(moment.nextSpeedKmh) })}
        </Text>
      ) : null}
    </View>
  );
}

export interface IftRunRow {
  readonly player: IftRosterPlayer;
  readonly marks: Ift3015PlayerMarks;
  /** Consecutive misses that still count (`ift3015MissStreak`). */
  readonly streak: number;
}

function RunRow({
  row,
  missesToStop,
  onMiss,
  onStop,
  onUndo,
}: {
  readonly row: IftRunRow;
  readonly missesToStop: number;
  readonly onMiss: () => void;
  readonly onStop: () => void;
  readonly onUndo: () => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const { player, marks, streak } = row;
  const running = marks.outcome === 'running';
  const canUndo = !running || marks.misses.length > 0;
  return (
    <View
      style={{
        borderColor: theme.colors.border.subtle,
        borderBottomWidth: theme.borderWidth.hairline,
        paddingVertical: theme.spacing.sm,
        gap: theme.spacing.sm,
        opacity: running ? 1 : 0.75,
      }}
    >
      <View style={{ gap: theme.spacing.xs }}>
        <AppText role="bodyStrong">{player.name}</AppText>
        {running ? (
          streak > 0 ? (
            <StatusTag level="warning">
              {t('ift.run.misses', { count: streak, max: missesToStop })}
            </StatusTag>
          ) : (
            <StatusTag level="ok">{t('ift.run.running')}</StatusTag>
          )
        ) : (
          <StatusTag level="critical">
            {t('ift.run.out', { stage: marks.adjustedStage ?? marks.lastCompletedStage ?? 0 })}
          </StatusTag>
        )}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        {running ? (
          <>
            <View style={{ flex: 1 }}>
              <Button
                variant="secondary"
                label={t('ift.run.miss')}
                accessibilityLabel={t('ift.run.miss.a11y', { name: player.name })}
                onPress={onMiss}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={t('ift.run.stop')}
                accessibilityLabel={t('ift.run.stop.a11y', { name: player.name })}
                onPress={onStop}
              />
            </View>
          </>
        ) : null}
        {canUndo ? (
          <Button
            variant="link"
            label={t('ift.run.undo')}
            accessibilityLabel={t('ift.run.undo.a11y', { name: player.name })}
            onPress={onUndo}
          />
        ) : null}
      </View>
    </View>
  );
}

export function IftRunScreen({
  moment,
  protocol,
  rows,
  skippedCues,
  allOut,
  onMiss,
  onStop,
  onUndo,
  onFinish,
}: {
  readonly moment: Ift3015Moment;
  readonly protocol: Ift3015SignalProtocol;
  readonly rows: readonly IftRunRow[];
  readonly skippedCues: number;
  /** Nobody is running: ending needs no confirmation, a wrong mark can still be undone. */
  readonly allOut: boolean;
  readonly onMiss: (playerId: string) => void;
  readonly onStop: (playerId: string) => void;
  readonly onUndo: (playerId: string) => void;
  readonly onFinish: () => void;
}) {
  const { t } = useTranslator();
  const [confirming, setConfirming] = useState(false);
  // Running players first, in roster order; then the ones already out.
  const ordered = [
    ...rows.filter((row) => row.marks.outcome === 'running'),
    ...rows.filter((row) => row.marks.outcome !== 'running'),
  ];
  return (
    <ScreenBody stripes={false}>
      <StageBoard moment={moment} />
      {skippedCues > 0 ? (
        <StatusMessage level="warning">
          {t('ift.run.skipped', { count: skippedCues })}
        </StatusMessage>
      ) : null}
      <Card>
        {ordered.map((row) => (
          <RunRow
            key={row.player.id}
            row={row}
            missesToStop={protocol.missesToStop}
            onMiss={() => {
              onMiss(row.player.id);
            }}
            onStop={() => {
              onStop(row.player.id);
            }}
            onUndo={() => {
              onUndo(row.player.id);
            }}
          />
        ))}
      </Card>
      {allOut ? (
        <Card>
          <StatusMessage level="ok">{t('ift.run.allOut')}</StatusMessage>
          <Button label={t('ift.run.finish')} onPress={onFinish} />
        </Card>
      ) : confirming ? (
        <Card>
          <StatusMessage level="warning">{t('ift.run.finishConfirm')}</StatusMessage>
          <Button
            label={t('ift.run.finishYes')}
            onPress={() => {
              setConfirming(false);
              onFinish();
            }}
          />
          <Button
            variant="secondary"
            label={t('ift.run.keepGoing')}
            onPress={() => {
              setConfirming(false);
            }}
          />
        </Card>
      ) : (
        <Button
          variant="secondary"
          label={t('ift.run.finish')}
          onPress={() => {
            setConfirming(true);
          }}
        />
      )}
    </ScreenBody>
  );
}

export function IftInterruptedScreen({
  moment,
  resumable,
  resuming,
  audioError,
  onResume,
  onFinish,
}: {
  /** Where the test was when the app died. */
  readonly moment: Ift3015Moment;
  /** Short gap: it can still be picked up at the stage under way now. */
  readonly resumable: boolean;
  readonly resuming: boolean;
  readonly audioError: boolean;
  readonly onResume: () => void;
  readonly onFinish: () => void;
}) {
  const { t } = useTranslator();
  return (
    <ScreenBody header={<ScreenHeader title={t('ift.interrupted.title')} />}>
      <StatusMessage level="warning">
        {t('ift.interrupted.body', {
          stage: moment.stage,
          phase: t(`ift.phase.${moment.phase}`),
        })}
      </StatusMessage>
      <AppText role="body" tone="secondary">
        {t(resumable ? 'ift.interrupted.resumable' : 'ift.interrupted.tooLate')}
      </AppText>
      {audioError ? (
        <StatusMessage level="critical">{t('ift.setup.audioError')}</StatusMessage>
      ) : null}
      {resumable ? (
        <Button label={t('ift.interrupted.resume')} onPress={onResume} busy={resuming} />
      ) : null}
      <Button
        variant={resumable ? 'secondary' : 'primary'}
        label={t('ift.interrupted.finish')}
        onPress={onFinish}
        disabled={resuming}
      />
    </ScreenBody>
  );
}

export interface IftResultRow {
  readonly player: IftRosterPlayer;
  readonly result: Ift3015PlayerResult;
  /** Consecutive misses that ended the test (`missed_lines`). */
  readonly misses: number;
  /** Still running when the app died: the stage needs a check by the staff. */
  readonly cutShort: boolean;
}

function ResultRow({
  row,
  maxStages,
  onAdjust,
}: {
  readonly row: IftResultRow;
  readonly maxStages: number;
  readonly onAdjust: (lastCompletedStage: number) => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const { player, result } = row;
  const stage = result.lastCompletedStage;
  const outcome =
    result.outcome === 'missed_lines'
      ? t('ift.results.outcome.missed_lines', { count: row.misses })
      : t(`ift.results.outcome.${result.outcome}`);
  return (
    <View
      style={{
        borderColor: theme.colors.border.subtle,
        borderBottomWidth: theme.borderWidth.hairline,
        paddingVertical: theme.spacing.sm,
        gap: theme.spacing.xs,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <AppText role="bodyStrong">{player.name}</AppText>
          <AppText role="bodySmall" tone="secondary">
            {outcome}
          </AppText>
        </View>
        <Button
          variant="secondary"
          label={t('ift.results.stageDown.label')}
          accessibilityLabel={t('ift.results.stageDown', { name: player.name })}
          disabled={stage <= 0}
          onPress={() => {
            onAdjust(stage - 1);
          }}
        />
        <View style={{ minWidth: 96, alignItems: 'center' }}>
          <AppText role="heading">{t('ift.results.stage', { stage })}</AppText>
        </View>
        <Button
          variant="secondary"
          label={t('ift.results.stageUp.label')}
          accessibilityLabel={t('ift.results.stageUp', { name: player.name })}
          disabled={stage >= maxStages}
          onPress={() => {
            onAdjust(stage + 1);
          }}
        />
      </View>
      {result.viftKmh === null ? (
        <StatusTag level="warning">{t('ift.results.noStage')}</StatusTag>
      ) : (
        <AppText role="bodyStrong" tone="accent">
          {t('ift.results.vift', { vift: speed(result.viftKmh) })}
        </AppText>
      )}
      {result.adjusted ? <StatusTag level="warning">{t('ift.results.adjusted')}</StatusTag> : null}
      {row.cutShort && !result.adjusted ? (
        <StatusTag level="warning">{t('ift.results.cutShort')}</StatusTag>
      ) : null}
    </View>
  );
}

export function IftResultsScreen({
  protocol,
  rows,
  interrupted,
  onAdjust,
  onDiscard,
}: {
  readonly protocol: Ift3015SignalProtocol;
  readonly rows: readonly IftResultRow[];
  /** Ended after the app was killed (`endedBy: 'interrupted'`). */
  readonly interrupted: boolean;
  readonly onAdjust: (playerId: string, lastCompletedStage: number) => void;
  readonly onDiscard: () => void;
}) {
  const { t } = useTranslator();
  const [confirming, setConfirming] = useState(false);
  return (
    <ScreenBody header={<ScreenHeader title={t('ift.results.title')} />}>
      {interrupted ? (
        <StatusMessage level="warning">{t('ift.results.interrupted')}</StatusMessage>
      ) : null}
      <Card>
        {rows.map((row) => (
          <ResultRow
            key={row.player.id}
            row={row}
            maxStages={protocol.maxStages}
            onAdjust={(stage) => {
              onAdjust(row.player.id, stage);
            }}
          />
        ))}
      </Card>
      <AppText role="bodySmall" tone="secondary">
        {t('ift.results.saveHint')}
      </AppText>
      {confirming ? (
        <Card>
          <StatusMessage level="warning">{t('ift.results.discardConfirm')}</StatusMessage>
          <Button
            label={t('ift.results.discardYes')}
            onPress={() => {
              setConfirming(false);
              onDiscard();
            }}
          />
          <Button
            variant="secondary"
            label={t('common.cancel')}
            onPress={() => {
              setConfirming(false);
            }}
          />
        </Card>
      ) : (
        <Button
          variant="secondary"
          label={t('ift.results.discard')}
          onPress={() => {
            setConfirming(true);
          }}
        />
      )}
    </ScreenBody>
  );
}

export function IftPreparingScreen() {
  const { t } = useTranslator();
  return <LoadingView label={t('ift.setup.preparing')} />;
}
