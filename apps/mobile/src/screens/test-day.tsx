import {
  STAFF_METHODS,
  entryModesOf,
  fieldAllowed,
  fieldsOf,
  notDoneReasonView,
  type FieldPlausibilityWarning,
  type FieldSpec,
  type NotDoneReasonView,
  type TestDayPreviousResult,
  type TestDaySheet,
  type TestDaySheetStation,
  type TestSession,
} from '@sport-performance/contracts';
import {
  UNIT_CODES,
  type MeasurementMethod,
  type Role,
  type TestNotDoneReason,
  type TimeZone,
  type UnitCode,
} from '@sport-performance/domain';
import {
  formatDateTime,
  formatLocalDate,
  formatNumber,
  formatUnit,
  isMessageKey,
  unitLabelEsAr,
  type Translator,
} from '@sport-performance/i18n';
import { useRef, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import {
  FIELD_NOT_DONE_REASONS,
  nextPendingPlayer,
  planAttempt,
  planIftStages,
  notApplicableCount,
  planNotApplicable,
  planNotDone,
  planVoid,
  type FieldWrite,
  type PlannedWrites,
  type PlayerStation,
  type ShownAttempt,
  type StationSettings,
  type WriteContext,
  type WriteProblem,
} from '../test-day/model.ts';
import type { IftRunForDay } from '../test-day/ift.ts';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  PendingMark,
  ScreenBody,
  StatusMessage,
  TextField,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';
import { restLabel, testLabel } from './protocols.tsx';

/**
 * The field test day (B-505): the days, the stations of a day and the
 * loading of each player at a station, on the phone and without signal.
 * Presentation only: data and writes come by props (the route reads the
 * local database and queues through the sync engine).
 */

type T = Translator['t'];
const anyT = (t: T) => t as (key: string, values?: Record<string, unknown>) => string;

function messageOr({ t }: Translator, key: string, fallback: string): string {
  return isMessageKey(key) ? anyT(t)(key) : fallback;
}

/** Label of a typed field or a metric (`testDay.field.*`, `testDay.metric.*`). */
export function fieldLabel(translator: Translator, key: string): string {
  const field = `testDay.field.${key}`;
  if (isMessageKey(field)) return anyT(translator.t)(field);
  return messageOr(translator, `testDay.metric.${key}`, key);
}

function isUnit(unit: string | null): unit is UnitCode {
  return unit !== null && (UNIT_CODES as readonly string[]).includes(unit);
}

function formatValue(value: number, unit: string | null): string {
  return isUnit(unit) ? formatUnit(value, unit) : formatNumber(value);
}

function unitOf(station: TestDaySheetStation, metricCode: string): string | null {
  return station.definition.metrics.find((m) => m.code === metricCode)?.unit ?? null;
}

function metricValue(
  translator: Translator,
  station: TestDaySheetStation,
  metricCode: string,
  value: number,
): string {
  return translator.t('testDay.metric.value', {
    metric: fieldLabel(translator, metricCode),
    value: formatValue(value, unitOf(station, metricCode)),
  });
}

function inputLabel(translator: Translator, field: FieldSpec, mode: string): string {
  const label = fieldLabel(translator, field.key);
  // Raw fields carry their unit in the label; plain metric values get it here.
  if (mode !== 'value' || field.unit === null) return label;
  const unit = unitLabelEsAr(field.unit);
  return unit === '' ? label : `${label} (${unit})`;
}

function playerName(player: { firstName: string; lastName: string }): string {
  return `${player.firstName} ${player.lastName}`;
}

/** A row of options; the chosen one says so to screen readers and with a check mark. */
function Choices<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  readonly label: string;
  readonly options: readonly { readonly value: V; readonly label: string }[];
  readonly value: V | null;
  readonly onChange: (value: V) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{ gap: theme.spacing.xs }}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      <AppText role="bodyStrong">{label}</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => {
                onChange(option.value);
              }}
              style={{
                minHeight: theme.sizes.touchTarget,
                paddingHorizontal: theme.spacing.md,
                justifyContent: 'center',
                borderRadius: theme.radius.md,
                borderWidth: theme.borderWidth.thick,
                borderColor: selected ? theme.colors.brand.solid : theme.colors.border.strong,
                backgroundColor: selected ? theme.colors.brand.solid : theme.colors.surfaceRaised,
              }}
            >
              <AppText tone={selected ? 'primary' : 'secondary'}>
                {selected ? `✓ ${option.label}` : option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function OpenRow({
  label,
  title,
  detail,
  children,
  onPress,
}: {
  readonly label: string;
  readonly title: string;
  readonly detail?: string;
  readonly children?: ReactNode;
  readonly onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        minHeight: theme.sizes.touchTarget,
        padding: theme.spacing.md,
        gap: theme.spacing.xs,
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.hairline,
        borderColor: theme.colors.border.subtle,
        backgroundColor: theme.colors.surface,
      }}
    >
      <AppText role="heading">{title}</AppText>
      {detail === undefined ? null : <AppText tone="secondary">{detail}</AppText>}
      {children}
    </Pressable>
  );
}

// ─── Days ───────────────────────────────────────────────────────────────────────────

export type TestDayListState =
  | { readonly status: 'loading' }
  | {
      readonly status: 'ready';
      readonly upcoming: readonly TestSession[];
      readonly recent: readonly TestSession[];
    };

function windowLabel(t: T, sheet: Pick<TestDaySheet, 'testWindow'>): string {
  return sheet.testWindow === null ? t('testDay.window.none') : sheet.testWindow.label;
}

export function TestDayListScreen({
  state,
  categoryName,
  windowName,
  savedSheets,
  sync,
  onOpen,
}: {
  readonly state: TestDayListState;
  readonly categoryName: (categoryId: string | null) => string;
  /** The label of a window (V1 to V4), or «Sin ventana». */
  readonly windowName: (testWindowId: string | null) => string;
  /** When the sheet of each day saved on the phone was downloaded (epoch ms), by day. */
  readonly savedSheets: ReadonlyMap<string, number>;
  readonly sync?: ReactNode;
  readonly onOpen: (testSessionId: string) => void;
}) {
  const { t } = useTranslator();
  // Quiet like the sync status (ADR 0103): a saved sheet says nothing; only an
  // upcoming day not downloaded yet gets a small mark, so it is opened with signal.
  const day = (session: TestSession, upcoming: boolean) => {
    const category = categoryName(session.categoryId);
    const window = windowName(session.testWindowId);
    const date = formatLocalDate(session.scheduledOn);
    // A cancelled day is never prefetched: it would carry the mark forever.
    const notDownloaded =
      upcoming && session.status !== 'cancelled' && savedSheets.get(session.id) === undefined;
    const open = t('fieldTest.day.open', { date, category, window });
    return (
      <OpenRow
        key={session.id}
        // The row is one element for a screen reader: the mark goes in its label.
        label={notDownloaded ? `${open}. ${t('fieldTest.day.notDownloaded')}` : open}
        title={`${date} · ${category}`}
        detail={`${window} · ${t(`testDay.status.${session.status}`)}`}
        onPress={() => {
          onOpen(session.id);
        }}
      >
        {notDownloaded ? <PendingMark text={t('fieldTest.day.notDownloadedShort')} /> : null}
      </OpenRow>
    );
  };
  return (
    <ScreenBody>
      <AppText role="title" accessibilityRole="header">
        {t('testDay.list.title')}
      </AppText>
      <AppText tone="secondary">{t('fieldTest.list.intro')}</AppText>
      {sync}
      {state.status === 'loading' ? (
        <AppText tone="secondary">{t('fieldTest.list.loading')}</AppText>
      ) : (
        <>
          <AppText role="overline" tone="secondary" accessibilityRole="header">
            {t('testDay.list.upcoming')}
          </AppText>
          {state.upcoming.length === 0 ? (
            <AppText tone="secondary">{t('testDay.list.emptyUpcoming')}</AppText>
          ) : (
            state.upcoming.map((session) => day(session, true))
          )}
          <AppText role="overline" tone="secondary" accessibilityRole="header">
            {t('testDay.list.past')}
          </AppText>
          {state.recent.length === 0 ? (
            <AppText tone="secondary">{t('testDay.list.emptyPast')}</AppText>
          ) : (
            state.recent.map((session) => day(session, false))
          )}
        </>
      )}
    </ScreenBody>
  );
}

// ─── A day: its stations ────────────────────────────────────────────────────────────

export type TestDayState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly sheet: TestDaySheet;
      /** When the sheet on the phone was downloaded (epoch ms). */
      readonly savedAt: number;
      readonly refreshing: boolean;
      readonly refreshFailed: boolean;
      readonly progress: ReadonlyMap<string, { readonly recorded: number; readonly total: number }>;
    };

export function TestDayScreen({
  state,
  categoryName,
  timeZone,
  sync,
  onBack,
  onRefresh,
  onOpenStation,
}: {
  readonly state: TestDayState;
  readonly categoryName: (categoryId: string | null) => string;
  readonly timeZone: TimeZone;
  readonly sync?: ReactNode;
  readonly onBack: () => void;
  readonly onRefresh: () => void;
  readonly onOpenStation: (testCode: string) => void;
}) {
  const translator = useTranslator();
  const { t } = translator;
  return (
    <ScreenBody>
      <Button variant="link" label={t('fieldTest.day.back')} onPress={onBack} />
      {state.status === 'loading' ? (
        <AppText tone="secondary">{t('fieldTest.day.loading')}</AppText>
      ) : state.status === 'unavailable' ? (
        <>
          <StatusMessage level="warning">{state.message}</StatusMessage>
          <Button variant="secondary" label={t('common.retry')} onPress={onRefresh} />
        </>
      ) : (
        <>
          <AppText role="title" accessibilityRole="header">
            {state.sheet.testSession.categoryId === null
              ? t('testDay.titleNoCategory')
              : t('testDay.title', { category: categoryName(state.sheet.testSession.categoryId) })}
          </AppText>
          <AppText tone="secondary">
            {t('testDay.subtitle', {
              window: windowLabel(t, state.sheet),
              date: formatLocalDate(state.sheet.testSession.scheduledOn),
            })}
          </AppText>
          {state.sheet.testSession.location === null ? null : (
            <AppText tone="secondary">
              {t('testDay.location', { location: state.sheet.testSession.location })}
            </AppText>
          )}
          {state.sheet.testSession.status === 'cancelled' ? (
            <StatusMessage level="critical">{t('testDay.cancelled')}</StatusMessage>
          ) : null}
          {sync}
          <AppText role="caption" tone="muted">
            {t('fieldTest.day.savedAt', {
              date: formatDateTime(state.savedAt, { timeZone }),
            })}
          </AppText>
          {state.refreshFailed ? (
            <StatusMessage level="warning">{t('fieldTest.day.refreshFailed')}</StatusMessage>
          ) : null}
          <Button
            variant="secondary"
            label={t('fieldTest.day.refresh')}
            busy={state.refreshing}
            onPress={onRefresh}
          />
          <AppText role="overline" tone="secondary" accessibilityRole="header">
            {t('testDay.stations')}
          </AppText>
          {state.sheet.stations.length === 0 ? (
            <AppText tone="secondary">{t('testDay.noStations')}</AppText>
          ) : (
            state.sheet.stations.map((station) => {
              const name = testLabel(translator, station.testCode);
              const progress = state.progress.get(station.testCode) ?? { recorded: 0, total: 0 };
              return (
                <OpenRow
                  key={station.testCode}
                  label={t('fieldTest.station.open', { station: name })}
                  title={name}
                  detail={t('testDay.station.progress', {
                    done: progress.recorded,
                    total: progress.total,
                  })}
                  onPress={() => {
                    onOpenStation(station.testCode);
                  }}
                >
                  {station.scheduled ? null : (
                    <AppText role="caption" tone="muted">
                      {t('testDay.station.extra')}
                    </AppText>
                  )}
                </OpenRow>
              );
            })
          )}
        </>
      )}
    </ScreenBody>
  );
}

// ─── A station ──────────────────────────────────────────────────────────────────────

function ProtocolCard({ station }: { readonly station: TestDaySheetStation }) {
  const translator = useTranslator();
  const { t } = translator;
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const { definition } = station;
  const { protocol } = definition;
  return (
    <Card>
      <AppText role="overline" tone="secondary" accessibilityRole="header">
        {t('testDay.protocol.show', { version: definition.version })}
      </AppText>
      {protocol.summary === null ? null : <AppText>{protocol.summary}</AppText>}
      <AppText>
        {t('testDay.protocol.attempts', {
          count: definition.attemptCount,
          aggregation: definition.attemptAggregation,
        })}
      </AppText>
      {protocol.restBetweenAttemptsS === null ? null : (
        <AppText>{restLabel(translator, protocol.restBetweenAttemptsS)}</AppText>
      )}
      {definition.maximalLoad ? (
        <StatusMessage level="warning">{t('protocol.maximalLoad')}</StatusMessage>
      ) : null}
      {open ? (
        <>
          <AppText role="bodyStrong">{t('protocol.steps')}</AppText>
          {protocol.steps.length === 0 ? (
            <AppText tone="secondary">{t('protocol.noSteps')}</AppText>
          ) : (
            protocol.steps.map((step, index) => (
              <View
                key={`${String(index)}-${step}`}
                style={{ flexDirection: 'row', gap: theme.spacing.sm }}
              >
                <AppText role="bodyStrong">{`${String(index + 1)}.`}</AppText>
                <View style={{ flex: 1 }}>
                  <AppText>{step}</AppText>
                </View>
              </View>
            ))
          )}
          {protocol.equipment.length === 0 ? null : (
            <AppText tone="secondary">
              {t('testDay.protocol.equipment', { equipment: protocol.equipment.join(', ') })}
            </AppText>
          )}
        </>
      ) : null}
      <Button
        variant="link"
        label={open ? t('fieldTest.protocol.hide') : t('fieldTest.protocol.show')}
        onPress={() => {
          setOpen(!open);
        }}
      />
    </Card>
  );
}

function SettingsCard({
  sheet,
  station,
  settings,
  onChange,
}: {
  readonly sheet: TestDaySheet;
  readonly station: TestDaySheetStation;
  readonly settings: StationSettings;
  readonly onChange: (settings: StationSettings) => void;
}) {
  const { t } = useTranslator();
  const modes = entryModesOf(station);
  const [exercise, setExercise] = useState(settings.exercise ?? '');
  return (
    <Card>
      <AppText role="overline" tone="secondary" accessibilityRole="header">
        {t('fieldTest.station.settings')}
      </AppText>
      <AppText role="caption" tone="muted">
        {t('fieldTest.station.settingsHint')}
      </AppText>
      {modes.length > 1 ? (
        <Choices
          label={t('testDay.mode.label')}
          options={modes.map((mode) => ({ value: mode, label: t(`testDay.mode.${mode}`) }))}
          value={settings.mode}
          onChange={(mode) => {
            onChange({ ...settings, mode });
          }}
        />
      ) : null}
      <Choices
        label={t('testDay.method.station')}
        options={STAFF_METHODS.map((method) => ({ value: method, label: t(`method.${method}`) }))}
        value={settings.method}
        onChange={(method) => {
          onChange({ ...settings, method });
        }}
      />
      {station.definition.sameDeviceOnly ? (
        sheet.devices.length === 0 ? (
          <StatusMessage level="warning">{t('fieldTest.device.empty')}</StatusMessage>
        ) : (
          <>
            <Choices
              label={t('testDay.device.label')}
              options={sheet.devices.map((device) => ({ value: device.id, label: device.label }))}
              value={settings.deviceId}
              onChange={(deviceId) => {
                onChange({ ...settings, deviceId });
              }}
            />
            <AppText role="caption" tone="secondary">
              {t('testDay.device.help')}
            </AppText>
          </>
        )
      ) : null}
      {station.testCode === 'strength' ? (
        <TextField
          label={t('testDay.exercise.label')}
          hint={t('testDay.exercise.help')}
          value={exercise}
          onChangeText={(value) => {
            setExercise(value);
            const code = value.trim();
            onChange({ ...settings, exercise: code === '' ? null : code });
          }}
          inputProps={{ autoCapitalize: 'none', autoCorrect: false }}
        />
      ) : null}
    </Card>
  );
}

function problemText(translator: Translator, p: WriteProblem, attemptNumber: number): string {
  const { t } = translator;
  switch (p.kind) {
    case 'attempt':
      if (p.problem === 'domain') return t('testDay.problem.domain', { number: attemptNumber });
      if (p.problem === 'required') {
        return t('testDay.problem.required', {
          field: p.fieldKey === null ? '' : fieldLabel(translator, p.fieldKey),
        });
      }
      return t(`testDay.problem.${p.problem}`);
    case 'empty':
      return t('fieldTest.problem.empty');
    case 'exercise':
      return t('testDay.problem.exercise');
    case 'device':
      return t('testDay.problem.device');
    case 'reason':
      return t('testDay.problem.reason');
    case 'note':
      return t('testDay.problem.note');
    case 'changeReason':
      return t('fieldTest.problem.changeReason');
    case 'notApplicable':
      return t('fieldTest.problem.notApplicable');
    case 'recording':
      return t('testDay.row.forbidden');
    case 'cancelled':
      return t('testDay.cancelled');
    case 'hasAttempts':
      return t('fieldTest.problem.hasAttempts');
  }
}

function warningText(
  translator: Translator,
  w: FieldPlausibilityWarning,
  station: TestDaySheetStation,
) {
  const unit = unitOf(station, w.metricCode);
  const text = translator.t('fieldTest.plausibility', {
    field: fieldLabel(translator, w.fieldKey),
    value: formatValue(w.value, unit),
    min: formatValue(w.result.bounds.minValue, unit),
    max: formatValue(w.result.bounds.maxValue, unit),
  });
  const suggestion = w.result.suggestedValues[0];
  return suggestion === undefined
    ? text
    : `${text} ${translator.t('testDay.plausibility.suggestion', { value: formatValue(suggestion, unit) })}`;
}

function Previous({
  previous,
  station,
  method,
}: {
  readonly previous: TestDayPreviousResult | null;
  readonly station: TestDaySheetStation;
  readonly method: MeasurementMethod | null;
}) {
  const translator = useTranslator();
  const { t } = translator;
  if (previous === null) return <AppText tone="secondary">{t('testDay.previous.none')}</AppText>;
  const value = t('testDay.previous.on', {
    value: previous.scores
      .slice(0, 3)
      .map((s) => metricValue(translator, station, s.metricCode, s.value))
      .join(' · '),
    date: formatLocalDate(previous.measuredOn),
  });
  return (
    <>
      <AppText tone="secondary">{t('fieldTest.previous.label', { value })}</AppText>
      {method !== null && previous.method !== method ? (
        <StatusMessage level="warning">
          {t('testDay.previous.otherMethod', { method: t(`method.${previous.method}`) })}
        </StatusMessage>
      ) : null}
      {previous.protocolVersion === station.definition.version ? null : (
        <StatusMessage level="warning">
          {t('testDay.previous.otherVersion', { version: previous.protocolVersion })}
        </StatusMessage>
      )}
    </>
  );
}

/** Only a result still on the phone is marked: saved or sent, the server has it (ADR 0103). */
function SyncState({ row }: { readonly row: PlayerStation }) {
  const { t } = useTranslator();
  if (row.state === 'empty' || row.sync !== 'queued') return null;
  return <PendingMark accessibilityLabel={t('fieldTest.sync.queued')} />;
}

function AttemptLine({
  attempt,
  station,
  canVoid,
  playerLabel,
  onVoid,
}: {
  readonly attempt: ShownAttempt;
  readonly station: TestDaySheetStation;
  readonly canVoid: boolean;
  readonly playerLabel: string;
  readonly onVoid: (reason: string) => Promise<PlannedWrites>;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const theme = useTheme();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const number = attempt.attemptNumber ?? 1;
  const values = attempt.entries
    .flatMap((e) => e.values)
    .filter((v) => station.definition.metrics.some((m) => m.code === v.metricCode))
    .map((v) => metricValue(translator, station, v.metricCode, v.value))
    .join(' · ');
  const issues = attempt.entries.flatMap((e) => e.issues);
  return (
    <View
      style={{
        gap: theme.spacing.xs,
        paddingVertical: theme.spacing.xs,
        borderTopWidth: theme.borderWidth.hairline,
        borderTopColor: theme.colors.border.subtle,
      }}
    >
      <AppText role={attempt.bestOf.length > 0 ? 'bodyStrong' : 'body'}>
        {`${t('testDay.table.attempt', { number })}: ${values === '' ? '—' : values}`}
      </AppText>
      {attempt.bestOf.length > 0 && !attempt.voided ? (
        <StatusMessage level="ok">{t('testDay.best.marker')}</StatusMessage>
      ) : null}
      {attempt.voided ? (
        <AppText tone="muted">
          {t('testDay.entry.voided', { reason: attempt.voidReason ?? '' })}
        </AppText>
      ) : null}
      {attempt.pending ? <PendingMark /> : null}
      {issues.map((issue) => (
        <StatusMessage key={issue} level="warning">
          {t(`testDay.protocolIssue.${issue}`)}
        </StatusMessage>
      ))}
      {canVoid && !attempt.voided ? (
        voiding ? (
          <>
            <TextField
              label={t('testDay.void.reason')}
              value={reason}
              onChangeText={setReason}
              error={error}
            />
            <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
              <Button
                label={t('testDay.void.confirm')}
                onPress={() => {
                  void onVoid(reason).then((planned) => {
                    if (planned.kind === 'problem') {
                      setError(problemText(translator, planned.problem, number));
                    } else {
                      setVoiding(false);
                      setReason('');
                      setError(null);
                    }
                  });
                }}
              />
              <Button
                variant="secondary"
                label={t('common.cancel')}
                onPress={() => {
                  setVoiding(false);
                  setError(null);
                }}
              />
            </View>
          </>
        ) : (
          <Button
            variant="link"
            label={t('testDay.entry.voidLabel', { number, player: playerLabel })}
            onPress={() => {
              setVoiding(true);
            }}
          />
        )
      ) : null}
    </View>
  );
}

const REASON_ORDER: readonly TestNotDoneReason[] = FIELD_NOT_DONE_REASONS;

function reasonLabel(t: T, reason: NotDoneReasonView): string {
  return t(`testDay.reason.${reason}`);
}

interface PlayerActions {
  /** Plans and, when there is nothing to fix, queues; answers what was planned. */
  readonly submit: (
    plan: (context: WriteContext) => PlannedWrites,
    confirmed: boolean,
  ) => Promise<PlannedWrites>;
}

function PlayerCard({
  row,
  station,
  settings,
  viewer,
  cancelled,
  open,
  onToggle,
  actions,
}: {
  readonly row: PlayerStation;
  readonly station: TestDaySheetStation;
  readonly settings: StationSettings;
  readonly viewer: Role;
  readonly cancelled: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly actions: PlayerActions;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const theme = useTheme();
  const name = playerName(row.player);
  const [values, setValues] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<MeasurementMethod | null>(null);
  const [changeReason, setChangeReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // The warnings, with the attempt they were raised for: «Guardar igual»
  // confirms only that attempt, never values edited after it.
  const [warned, setWarned] = useState<{
    readonly key: string;
    readonly warnings: readonly FieldPlausibilityWarning[];
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notDoneOpen, setNotDoneOpen] = useState(false);
  const [reason, setReason] = useState<TestNotDoneReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const canRecord = !cancelled && row.player.recording === 'allowed';
  const rowMethod = row.primary?.method ?? method ?? settings.method;
  const attemptKey = JSON.stringify([settings.mode, rowMethod, row.nextAttemptNumber, values]);
  const warnings = warned?.key === attemptKey ? warned.warnings : [];
  const setWarnings = (next: readonly FieldPlausibilityWarning[], key = attemptKey) => {
    setWarned(next.length === 0 ? null : { key, warnings: next });
  };
  const fields = fieldsOf(station, settings.mode).filter((f) =>
    fieldAllowed(f, settings.mode, row.player.strengthAssessment),
  );
  const best = row.scores
    .slice(0, 2)
    .map((s) => metricValue(translator, station, s.metricCode, s.value));
  const notDoneReason = row.state === 'not_done' ? (row.notDone?.notDoneReason ?? null) : null;
  const notDoneNote = row.state === 'not_done' ? (row.notDone?.notDoneNote ?? null) : null;
  const savedMethod = row.primary?.method ?? null;
  const summary =
    notDoneReason !== null
      ? t('testDay.recorded.notDone', {
          reason: reasonLabel(t, notDoneReasonView(notDoneReason, viewer)),
        })
      : [t('fieldTest.player.summary', { count: row.validAttemptCount }), ...best].join(' · ');

  const run = async (
    plan: (context: WriteContext) => PlannedWrites,
    confirmed: boolean,
    done: string,
  ) => {
    const key = attemptKey;
    setBusy(true);
    try {
      const planned = await actions.submit(plan, confirmed);
      if (planned.kind === 'problem') {
        setProblem(problemText(translator, planned.problem, row.nextAttemptNumber));
        setWarnings([]);
        return planned;
      }
      if (planned.warnings.length > 0 && !confirmed) {
        setWarnings(planned.warnings, key);
        setProblem(null);
        return planned;
      }
      setProblem(null);
      setWarnings([]);
      setNotice(done);
      return planned;
    } finally {
      setBusy(false);
    }
  };

  const saveAttempt = (confirmed: boolean) => {
    const number = row.nextAttemptNumber;
    void run(
      (context) =>
        planAttempt(context, row, values, {
          // A new result, or a not done one turned into done: the method chosen on the row.
          ...(row.primary === null ? { method: rowMethod } : {}),
          changeReason,
        }),
      confirmed,
      t('fieldTest.attempt.saved', { number }),
    ).then((planned) => {
      if (planned.kind === 'writes' && (confirmed || planned.warnings.length === 0)) {
        setValues({});
        setChangeReason('');
      }
    });
  };

  const reasons = REASON_ORDER.map((r) => ({
    value: r,
    label: reasonLabel(t, notDoneReasonView(r, viewer)),
  }));

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          open
            ? t('fieldTest.player.close', { player: name })
            : t('fieldTest.player.open', { player: name })
        }
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={{ minHeight: theme.sizes.touchTarget, gap: theme.spacing.xs }}
      >
        <AppText role="heading">{name}</AppText>
        <AppText tone="secondary">{summary}</AppText>
      </Pressable>
      <SyncState row={row} />
      {open ? (
        <View style={{ gap: theme.spacing.sm }}>
          {row.player.stage === null ? null : (
            <AppText role="caption" tone="secondary">
              {t(`testDay.stage.${row.player.stage}`)}
            </AppText>
          )}
          {row.player.inCategory ? null : (
            <StatusMessage level="warning">{t('testDay.row.notInCategory')}</StatusMessage>
          )}
          {row.player.recording === 'missing_consent' ? (
            <StatusMessage level="warning">{t('testDay.row.missingConsent')}</StatusMessage>
          ) : row.player.recording === 'forbidden' ? (
            <StatusMessage level="warning">{t('testDay.row.forbidden')}</StatusMessage>
          ) : null}
          {!row.applicable ? (
            <StatusMessage level="warning">
              {t(`testDay.row.notApplicable.${row.notApplicableReason ?? 'not_in_battery'}`)}
            </StatusMessage>
          ) : null}
          <Previous
            previous={row.previous}
            station={station}
            method={row.state === 'not_done' ? null : rowMethod}
          />
          {row.multipleResults ? (
            <StatusMessage level="warning">{t('fieldTest.multipleResults')}</StatusMessage>
          ) : null}
          {notDoneNote !== null ? (
            <AppText tone="secondary">{t('testDay.recorded.note', { note: notDoneNote })}</AppText>
          ) : null}
          {row.attempts.length === 0 ? (
            row.state === 'not_done' ? null : (
              <AppText tone="secondary">{t('fieldTest.attempts.none')}</AppText>
            )
          ) : (
            <>
              {row.attempts.map((attempt) => (
                <AttemptLine
                  key={attempt.key}
                  attempt={attempt}
                  station={station}
                  canVoid={canRecord}
                  playerLabel={name}
                  onVoid={(text) =>
                    run(
                      (context) => planVoid(context, row, attempt, text),
                      true,
                      t('fieldTest.void.saved'),
                    )
                  }
                />
              ))}
              <AppText role="caption" tone="secondary">
                {t('fieldTest.attempts.protocol', {
                  done: row.validAttemptCount,
                  count: station.definition.attemptCount,
                })}
              </AppText>
            </>
          )}
          {notice === null ? null : <StatusMessage level="ok">{notice}</StatusMessage>}
          {canRecord && !row.applicable && row.state === 'empty' ? (
            <Button
              variant="secondary"
              label={t('fieldTest.notApplicable.one')}
              busy={busy}
              onPress={() => {
                void run(
                  (context) => planNotDone(context, row, 'not_applicable_to_stage', ''),
                  true,
                  t('fieldTest.notDone.saved'),
                );
              }}
            />
          ) : null}
          {canRecord && row.applicable ? (
            <View style={{ gap: theme.spacing.sm }}>
              <AppText role="bodyStrong" accessibilityRole="header">
                {t('fieldTest.attempt.form', { number: row.nextAttemptNumber })}
              </AppText>
              {row.primary === null ? (
                <Choices
                  label={t('testDay.method.row', { player: name })}
                  options={STAFF_METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))}
                  value={rowMethod}
                  onChange={(next) => {
                    setMethod(next);
                    setWarnings([]);
                  }}
                />
              ) : savedMethod !== null ? (
                <AppText tone="secondary">{`${t('testDay.table.method')}: ${t(`method.${savedMethod}`)}`}</AppText>
              ) : null}
              {fields.map((field) => (
                <TextField
                  key={field.key}
                  label={inputLabel(translator, field, settings.mode)}
                  value={values[field.key] ?? ''}
                  onChangeText={(text) => {
                    setValues((current) => ({ ...current, [field.key]: text }));
                    setWarnings([]);
                    setNotice(null);
                  }}
                  inputProps={{ keyboardType: field.integer ? 'number-pad' : 'decimal-pad' }}
                />
              ))}
              {row.state === 'not_done' ? (
                <>
                  <AppText tone="secondary">{t('fieldTest.notDone.toDone')}</AppText>
                  <TextField
                    label={t('fieldTest.changeReason.label')}
                    hint={t('fieldTest.changeReason.hint')}
                    value={changeReason}
                    onChangeText={setChangeReason}
                  />
                </>
              ) : null}
              {problem === null ? null : <StatusMessage level="critical">{problem}</StatusMessage>}
              {warnings.map((w) => (
                <StatusMessage key={`${w.fieldKey}-${String(w.value)}`} level="warning">
                  {warningText(translator, w, station)}
                </StatusMessage>
              ))}
              <Button
                label={
                  warnings.length > 0
                    ? t('fieldTest.attempt.saveAnyway')
                    : t('fieldTest.attempt.save', { number: row.nextAttemptNumber })
                }
                busy={busy}
                onPress={() => {
                  saveAttempt(warnings.length > 0);
                }}
              />
              {row.state === 'not_done' ? null : notDoneOpen ? (
                <View style={{ gap: theme.spacing.sm }}>
                  <Choices
                    label={t('testDay.reason.label', { player: name })}
                    options={reasons}
                    value={reason}
                    onChange={setReason}
                  />
                  {reason === 'other' ? (
                    <TextField
                      label={t('testDay.note.label', { player: name })}
                      value={note}
                      onChangeText={setNote}
                    />
                  ) : null}
                  {row.primary !== null ? (
                    <TextField
                      label={t('fieldTest.changeReason.label')}
                      hint={t('fieldTest.changeReason.hint')}
                      value={changeReason}
                      onChangeText={setChangeReason}
                    />
                  ) : null}
                  <View style={{ flexDirection: 'row', gap: theme.spacing.sm, flexWrap: 'wrap' }}>
                    <Button
                      label={t('fieldTest.notDone.save')}
                      busy={busy}
                      onPress={() => {
                        void run(
                          (context) => planNotDone(context, row, reason, note, changeReason),
                          true,
                          t('fieldTest.notDone.saved'),
                        ).then((planned) => {
                          if (planned.kind === 'writes') {
                            setNotDoneOpen(false);
                            setReason(null);
                            setNote('');
                            setChangeReason('');
                          }
                        });
                      }}
                    />
                    <Button
                      variant="secondary"
                      label={t('common.cancel')}
                      onPress={() => {
                        setNotDoneOpen(false);
                      }}
                    />
                  </View>
                </View>
              ) : row.validAttemptCount === 0 ? (
                <Button
                  variant="secondary"
                  label={t('fieldTest.notDone.open')}
                  onPress={() => {
                    setNotDoneOpen(true);
                  }}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

export function StationScreen({
  sheet,
  station,
  rows,
  settings,
  viewer,
  sync,
  writeContext,
  onSubmit,
  onChangeSettings,
  onBack,
  ift,
}: {
  readonly sheet: TestDaySheet;
  readonly station: TestDaySheetStation;
  readonly rows: readonly PlayerStation[];
  readonly settings: StationSettings;
  readonly viewer: Role;
  readonly sync?: ReactNode;
  /** The context of a write, built when it is planned (fresh time and ids). */
  readonly writeContext: () => WriteContext;
  /** Queues the writes (the sync engine). */
  readonly onSubmit: (writes: readonly FieldWrite[]) => Promise<void>;
  readonly onChangeSettings: (settings: StationSettings) => void;
  readonly onBack: () => void;
  /** The 30-15 station: the signals of B-507 and the stages its run left on the phone. */
  readonly ift?: {
    readonly run: IftRunForDay;
    readonly onOpenRunner: () => void;
    /** The stages of these players were queued: never offered again. */
    readonly onMarkSaved: (playerIds: readonly string[]) => void;
    /** Forgets the run: every stage was queued, or the staff dismissed it. */
    readonly onDiscard: () => Promise<void>;
  };
}) {
  const translator = useTranslator();
  const { t } = translator;
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [savingIft, setSavingIft] = useState(false);
  const [savingNotApplicable, setSavingNotApplicable] = useState(false);
  // A second tap before the rows are read again would plan the same writes twice.
  const iftInFlight = useRef(false);
  const notApplicableInFlight = useRef(false);
  const cancelled = sheet.testSession.status === 'cancelled';
  const recorded = rows.filter((r) => r.state !== 'empty').length;
  const notApplicable = notApplicableCount(sheet, rows);
  // What the 30-15 run left that this station cannot record (planned without drawing ids).
  const iftStages = ift?.run.status === 'finished' ? ift.run.stages : [];
  const iftBlocked =
    iftStages.length === 0
      ? []
      : planIftStages({ ...writeContext(), uuid: () => '' }, rows, iftStages).skipped;
  const iftRecordable = iftStages.length - iftBlocked.length;
  const nameOf = (playerId: string) => {
    const player = sheet.players.find((p) => p.id === playerId);
    return player === undefined ? '—' : playerName(player);
  };

  const saveIft = async () => {
    if (ift?.run.status !== 'finished' || iftInFlight.current) return;
    const planned = planIftStages(writeContext(), rows, ift.run.stages);
    iftInFlight.current = true;
    setSavingIft(true);
    setFailure(null);
    let saved = 0;
    try {
      // Step by step: whatever was queued is marked on the run before the next
      // one, so a retry after a failure never queues a stage twice.
      for (const step of planned.steps) {
        await onSubmit(step.writes);
        ift.onMarkSaved(step.playerIds);
        saved += step.playerIds.length;
      }
      // The run is forgotten only when nothing is left to load by hand.
      if (planned.skipped.length === 0) await ift.onDiscard();
      setNotice(
        planned.skipped.length === 0
          ? t('fieldTest.ift.saved', { count: saved })
          : `${t('fieldTest.ift.saved', { count: saved })} ${t('fieldTest.ift.skipped', { count: planned.skipped.length })}`,
      );
    } catch {
      setNotice(null);
      setFailure(t('fieldTest.ift.saveFailed'));
    } finally {
      iftInFlight.current = false;
      setSavingIft(false);
    }
  };

  const saveNotApplicable = async () => {
    if (notApplicableInFlight.current) return;
    const planned = planNotApplicable(writeContext(), rows);
    if (planned.count === 0) return;
    notApplicableInFlight.current = true;
    setSavingNotApplicable(true);
    setFailure(null);
    try {
      await onSubmit(planned.writes);
      setNotice(t('fieldTest.notApplicable.saved', { count: planned.count }));
    } catch {
      setFailure(t('fieldTest.saveFailed'));
    } finally {
      notApplicableInFlight.current = false;
      setSavingNotApplicable(false);
    }
  };

  const actions: PlayerActions = {
    submit: async (plan, confirmed) => {
      const planned = plan(writeContext());
      if (planned.kind === 'writes' && (confirmed || planned.warnings.length === 0)) {
        await onSubmit(planned.writes);
      }
      return planned;
    },
  };

  const next = nextPendingPlayer(rows, openId);
  return (
    <ScreenBody>
      <Button variant="link" label={t('fieldTest.station.back')} onPress={onBack} />
      <AppText role="title" accessibilityRole="header">
        {testLabel(translator, station.testCode)}
      </AppText>
      <AppText tone="secondary">
        {t('testDay.station.progress', { done: recorded, total: rows.length })}
      </AppText>
      {cancelled ? <StatusMessage level="critical">{t('testDay.cancelled')}</StatusMessage> : null}
      {sync}
      <ProtocolCard station={station} />
      {cancelled ? null : (
        <SettingsCard
          sheet={sheet}
          station={station}
          settings={settings}
          onChange={onChangeSettings}
        />
      )}
      {ift === undefined || cancelled ? null : (
        <Card>
          <AppText role="overline" tone="secondary" accessibilityRole="header">
            {t('ift.title')}
          </AppText>
          {ift.run.status === 'running' ? (
            <StatusMessage level="warning">{t('fieldTest.ift.running')}</StatusMessage>
          ) : ift.run.status === 'finished' ? (
            <>
              <AppText>{t('fieldTest.ift.pending', { count: ift.run.stages.length })}</AppText>
              {iftRecordable > 0 ? (
                <Button
                  label={t('fieldTest.ift.save')}
                  busy={savingIft}
                  onPress={() => {
                    void saveIft();
                  }}
                />
              ) : null}
              {iftBlocked.length === 0 ? null : (
                <>
                  <StatusMessage level="warning">
                    {t('fieldTest.ift.skippedList', { count: iftBlocked.length })}
                  </StatusMessage>
                  {iftBlocked.map((stage) => (
                    <AppText key={stage.playerId}>
                      {t('fieldTest.ift.skippedPlayer', {
                        player: nameOf(stage.playerId),
                        stage: stage.lastCompletedStage,
                      })}
                    </AppText>
                  ))}
                </>
              )}
              {iftRecordable > 0 ? null : (
                <Button
                  variant="secondary"
                  label={t('fieldTest.ift.discard')}
                  busy={savingIft}
                  onPress={() => {
                    setSavingIft(true);
                    ift
                      .onDiscard()
                      .catch(() => {
                        setFailure(t('fieldTest.saveFailed'));
                      })
                      .finally(() => {
                        setSavingIft(false);
                      });
                  }}
                />
              )}
            </>
          ) : (
            <AppText tone="secondary">{t('fieldTest.ift.hint')}</AppText>
          )}
          {ift.run.status === 'finished' ? null : (
            <Button variant="secondary" label={t('fieldTest.ift.run')} onPress={ift.onOpenRunner} />
          )}
        </Card>
      )}
      {notice === null ? null : <StatusMessage level="ok">{notice}</StatusMessage>}
      {failure === null ? null : <StatusMessage level="critical">{failure}</StatusMessage>}
      {notApplicable > 0 ? (
        <Button
          variant="secondary"
          label={t('fieldTest.notApplicable.all', { count: notApplicable })}
          busy={savingNotApplicable}
          onPress={() => {
            void saveNotApplicable();
          }}
        />
      ) : null}
      {rows.length === 0 ? (
        <AppText tone="secondary">{t('testDay.noPlayers')}</AppText>
      ) : (
        rows.map((row) => (
          <PlayerCard
            key={row.player.id}
            row={row}
            station={station}
            settings={settings}
            viewer={viewer}
            cancelled={cancelled}
            open={openId === row.player.id}
            onToggle={() => {
              setOpenId(openId === row.player.id ? null : row.player.id);
            }}
            actions={actions}
          />
        ))
      )}
      {cancelled ? null : next === null ? (
        <StatusMessage level="ok">{t('fieldTest.allDone')}</StatusMessage>
      ) : (
        <Button
          variant="secondary"
          label={t('fieldTest.next')}
          onPress={() => {
            setOpenId(next);
          }}
        />
      )}
    </ScreenBody>
  );
}
