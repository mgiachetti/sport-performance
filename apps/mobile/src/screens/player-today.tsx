import type { MyTestDay } from '@sport-performance/contracts';
import {
  RPE_CR10_MAX,
  RPE_CR10_MIN,
  WELLNESS_SCORE_MAX,
  WELLNESS_SCORE_MIN,
  localDateInTimeZone,
  wellnessMeanScore,
  type LocalDate,
  type TimeZone,
  type WellnessItem,
} from '@sport-performance/domain';
import {
  formatLocalDateLong,
  formatNumber,
  formatTime,
  type Translator,
} from '@sport-performance/i18n';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, Pressable, Text, View } from 'react-native';
import { rpeLabel, testLabel, wellnessItemLabel } from '../player/format.ts';
import type { WellnessStreak } from '../player/streak.ts';
import {
  sectionKey,
  todaySections,
  type DoneItem,
  type SecondaryRow,
} from '../player/today-sections.ts';
import type { RpeSession, TodayWellness } from '../player/today.ts';
import { ListRow, StatusChip } from '../ui/blocks.tsx';
import { ChoiceButton, ChoiceGroup, Face } from '../ui/choices.tsx';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  LoadingView,
  PendingMark,
  ScreenBody,
  ScreenHeader,
  StatusIcon,
  StatusMessage,
  TextField,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

type Translate = Translator['t'];
type Scores = Partial<Record<WellnessItem, number | undefined>>;
const LEVELS = [1, 2, 3, 4, 5] as const;
const RPE_VALUES = Array.from(
  { length: RPE_CR10_MAX - RPE_CR10_MIN + 1 },
  (_, index) => RPE_CR10_MIN + index,
);

export type WellnessSection =
  | { readonly kind: 'unavailable'; readonly reason: 'no_consent' | 'no_stage' }
  | {
      readonly kind: 'form';
      readonly itemCount: 3 | 5;
      readonly items: readonly WellnessItem[];
      readonly entry: TodayWellness | null;
    };

export interface PlayerTodayData {
  readonly today: LocalDate;
  readonly timeZone: TimeZone;
  readonly wellness: WellnessSection;
  readonly rpe: { readonly allowed: boolean; readonly sessions: readonly RpeSession[] };
  readonly streak: WellnessStreak;
  readonly nextTestDay: MyTestDay | null;
}

export type PlayerTodayState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly data: PlayerTodayData };

export interface PlayerTodayActions {
  /** Queues the check-in; rejects only on a bug (the contract refused it). */
  readonly onSubmitWellness: (scores: Scores) => Promise<void>;
  readonly onCorrectWellness: (
    target: TodayWellness['target'],
    scores: Scores,
    reason: string,
  ) => Promise<void>;
  readonly onSubmitRpe: (sessionId: string, rpe: number, reason: string | null) => Promise<void>;
  readonly onRetry: () => void;
  /**
   * "¿Te duele algo?" (B-609): a row of the secondary list once today's
   * check-in is loaded, only when the club asks it and the player has the
   * health consent; `null` (or absent) hides it.
   */
  readonly onOpenPainReport?: (() => void) | null;
  /** "Otra actividad" (B-511): a load outside the club, also offline; `null` hides it. */
  readonly onOpenExternalLoad?: (() => void) | null;
  /**
   * "Mi ciclo" (B-806): only when the club offers it to the player (module on,
   * a female player); `null` (or absent) hides it. Never says whether she uses it.
   */
  readonly onOpenMenstrualCycle?: (() => void) | null;
}

/** The reason of a correction, as the contract wants it (1–500 chars, trimmed). */
function cleanReason(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, 500);
}

function ItemScale({
  item,
  faces,
  value,
  onChange,
}: {
  readonly item: WellnessItem;
  readonly faces: boolean;
  readonly value: number | undefined;
  readonly onChange: (score: number) => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const name = wellnessItemLabel(t, item);
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <AppText role="cardTitle">{name}</AppText>
      <ChoiceGroup label={name}>
        {LEVELS.map((level) => {
          const word = t(`playerApp.wellness.face.${String(level) as '1'}`);
          return faces ? (
            <ChoiceButton
              key={level}
              accessibilityLabel={t('playerApp.wellness.faceChoice', { item: name, label: word })}
              selected={value === level}
              onPress={() => {
                onChange(level);
              }}
            >
              {(ink: string) => (
                <>
                  <Face level={level} color={ink} />
                  <Text style={[theme.text.caption, { color: ink }]}>{word}</Text>
                </>
              )}
            </ChoiceButton>
          ) : (
            <ChoiceButton
              key={level}
              label={String(level)}
              accessibilityLabel={t('playerApp.wellness.scoreChoice', { item: name, score: level })}
              selected={value === level}
              onPress={() => {
                onChange(level);
              }}
            />
          );
        })}
      </ChoiceGroup>
      {faces ? null : (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <AppText role="caption" tone="secondary">
            {`${String(WELLNESS_SCORE_MIN)} · ${t(`playerApp.wellness.low.${item}`)}`}
          </AppText>
          <AppText role="caption" tone="secondary">
            {`${t(`playerApp.wellness.high.${item}`)} · ${String(WELLNESS_SCORE_MAX)}`}
          </AppText>
        </View>
      )}
    </View>
  );
}

function SentState({ pending }: { readonly pending: boolean }) {
  const { t } = useTranslator();
  // Sent shows nothing: silence means the server has it (ADR 0103).
  return pending ? <PendingMark accessibilityLabel={t('playerApp.pending')} /> : null;
}

type WellnessForm = Extract<WellnessSection, { kind: 'form' }>;

/** Whether the correction under a done line is open; stable, keyed by the line. */
type EditingChange = (key: string, editing: boolean) => void;

/** Tells the parent whether a correction is open (and that it closed, on unmount). */
function useReportEditing(
  editing: boolean,
  editingKey: string | undefined,
  onEditingChange: EditingChange | undefined,
): void {
  useEffect(() => {
    if (onEditingChange === undefined || editingKey === undefined) return;
    onEditingChange(editingKey, editing);
    return () => {
      onEditingChange(editingKey, false);
    };
  }, [editing, editingKey, onEditingChange]);
}

/**
 * Today's check-in: the open form while it is not loaded (the card the
 * screen asks first); once loaded, the answers and "Corregir", shown under
 * its collapsed line when the player opens it.
 */
function WellnessCard({
  section,
  actions,
  onEditingChange,
  editingKey,
}: {
  readonly section: WellnessForm;
  readonly actions: PlayerTodayActions;
  /** Whether a correction is open, so its line is not closed under the draft. */
  readonly onEditingChange?: EditingChange;
  /** The done line this card opens under. */
  readonly editingKey?: string;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [answers, setAnswers] = useState<Scores>({});
  const [correcting, setCorrecting] = useState(false);
  useReportEditing(correcting, editingKey, onEditingChange);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const faces = section.itemCount === 3;
  const { entry } = section;

  if (entry !== null && !correcting) {
    // The pending mark and "¿Te duele algo?" live on the line and in the rows below.
    return (
      <View style={{ gap: theme.spacing.md }}>
        <View>
          {section.items.map((item, index) => (
            <ListRow
              key={item}
              first={index === 0}
              title={wellnessItemLabel(t, item)}
              // Read as one sentence ("Sueño: 4 de 5"); the figure is drawn apart, at the right.
              accessibilityLabel={t('playerApp.wellness.answer', {
                item: wellnessItemLabel(t, item),
                score: entry.scores[item] ?? '—',
              })}
              trailing={
                <View
                  style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.xs }}
                >
                  <AppText role="metricSmall">{String(entry.scores[item] ?? '—')}</AppText>
                  <AppText role="unit" tone="secondary">
                    {`/ ${String(WELLNESS_SCORE_MAX)}`}
                  </AppText>
                </View>
              }
            />
          ))}
        </View>
        <Button
          variant="secondary"
          label={t('playerApp.wellness.correct')}
          onPress={() => {
            setAnswers({ ...entry.scores });
            setCorrecting(true);
            setProblem(null);
          }}
        />
      </View>
    );
  }

  const missing = section.items.filter((item) => answers[item] === undefined);
  const send = () => {
    if (missing.length > 0) {
      setProblem(
        t('playerApp.wellness.missing', {
          items: missing.map((item) => wellnessItemLabel(t, item)).join(', '),
        }),
      );
      return;
    }
    const scores: Scores = {};
    for (const item of section.items) scores[item] = answers[item];
    let task: Promise<void>;
    if (entry !== null) {
      const why = cleanReason(reason);
      if (why === null) {
        setProblem(t('playerApp.reason.required'));
        return;
      }
      // Only what changed: each item is resolved on its own on the server.
      const changed: Scores = {};
      for (const item of section.items) {
        if (scores[item] !== entry.scores[item]) changed[item] = scores[item];
      }
      if (Object.keys(changed).length === 0) {
        setCorrecting(false);
        return;
      }
      task = actions.onCorrectWellness(entry.target, changed, why);
    } else {
      task = actions.onSubmitWellness(scores);
    }
    setBusy(true);
    setProblem(null);
    task
      .then(() => {
        setCorrecting(false);
        setReason('');
      })
      .catch(() => {
        setProblem(t('error.generic'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const form = (
    <>
      {section.items.map((item) => (
        <ItemScale
          key={item}
          item={item}
          faces={faces}
          value={answers[item]}
          onChange={(score) => {
            setAnswers((current) => ({ ...current, [item]: score }));
          }}
        />
      ))}
      {entry !== null ? (
        <TextField
          label={t('playerApp.reason.label')}
          hint={t('playerApp.reason.hint')}
          value={reason}
          onChangeText={setReason}
        />
      ) : null}
      {problem !== null ? <StatusMessage level="critical">{problem}</StatusMessage> : null}
      <Button
        size="lg"
        label={
          entry !== null ? t('playerApp.wellness.saveCorrection') : t('playerApp.wellness.send')
        }
        onPress={send}
        busy={busy}
      />
      {entry !== null ? (
        <Button
          variant="link"
          label={t('common.cancel')}
          onPress={() => {
            setCorrecting(false);
            setProblem(null);
          }}
        />
      ) : null}
    </>
  );
  // A correction opens under its line, inside the card of what is done.
  return entry !== null ? (
    <View style={{ gap: theme.spacing.md }}>{form}</View>
  ) : (
    <Card
      variant="highlight"
      title={t('wellness.prompt')}
      subtitle={t(faces ? 'playerApp.wellness.hintFaces' : 'playerApp.wellness.hintScale')}
    >
      {form}
    </Card>
  );
}

function RpeScale({
  value,
  onChange,
}: {
  readonly value: number | null;
  readonly onChange: (value: number) => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const label = value === null ? null : rpeLabel(t, value);
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <ChoiceGroup label={t('rpe.prompt')}>
        {RPE_VALUES.map((option) => {
          const name = rpeLabel(t, option);
          return (
            <ChoiceButton
              key={option}
              label={String(option)}
              minWidth={theme.sizes.touchTarget}
              accessibilityLabel={
                name === null
                  ? t('playerApp.rpe.choice', { value: option })
                  : t('playerApp.rpe.choiceLabelled', { value: option, label: name })
              }
              selected={value === option}
              onPress={() => {
                onChange(option);
              }}
            />
          );
        })}
      </ChoiceGroup>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText role="caption" tone="secondary">{`0 · ${t('rpe.scale.0')}`}</AppText>
        <AppText role="caption" tone="secondary">{`${t('rpe.scale.10')} · 10`}</AppText>
      </View>
      {value !== null ? (
        <AppText role="cardTitle" tone="accent">
          {label === null
            ? t('playerApp.rpe.selected', { value })
            : t('playerApp.rpe.selectedLabelled', { value, label })}
        </AppText>
      ) : null}
    </View>
  );
}

/** The session's name in the RPE card and on its collapsed line. */
function rpeSessionTitle(t: Translate, item: RpeSession, timeZone: TimeZone): string {
  return t('playerApp.rpe.session', {
    kind: item.session.kind,
    date: formatLocalDateLong(item.session.localDate, { year: false }),
    time: formatTime(Date.parse(item.session.startsAt), { timeZone }),
  });
}

/**
 * One session to rate: the scale while it has no RPE; once rated, under its
 * collapsed line (`inline`: the line already names it, says the RPE and
 * whether it is sent), the load and "Corregir" while the window is open.
 */
function RpeSessionCard({
  item,
  timeZone,
  onSubmit,
  inline = false,
  onEditingChange,
  editingKey,
}: {
  readonly item: RpeSession;
  readonly timeZone: TimeZone;
  readonly onSubmit: PlayerTodayActions['onSubmitRpe'];
  readonly inline?: boolean;
  /** Whether a correction is open, so its line is not closed under the draft. */
  readonly onEditingChange?: EditingChange;
  /** The done line this card opens under. */
  readonly editingKey?: string;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  useReportEditing(editing, editingKey, onEditingChange);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = rpeSessionTitle(t, item, timeZone);
  const closes = {
    // The window closes at the end of a club day: name the day of the instant just before.
    date: formatLocalDateLong(localDateInTimeZone(Date.parse(item.closesAt) - 1, timeZone), {
      year: false,
    }),
    time: formatTime(Date.parse(item.closesAt) - 1, { timeZone }),
  };
  const correcting = item.rpe !== null;
  const showScale = item.canSubmit && (item.rpe === null || editing);
  const load = item.rpe !== null && item.minutes !== null ? String(item.rpe * item.minutes) : null;

  const send = () => {
    if (selected === null) return;
    const why = correcting ? cleanReason(reason) : null;
    if (correcting && why === null) {
      setProblem(t('playerApp.reason.required'));
      return;
    }
    setBusy(true);
    setProblem(null);
    onSubmit(item.session.id, selected, why)
      .then(() => {
        setEditing(false);
        setSelected(null);
        setReason('');
      })
      .catch(() => {
        setProblem(t('error.generic'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <View
      style={
        inline
          ? { gap: theme.spacing.sm }
          : {
              gap: theme.spacing.sm,
              paddingTop: theme.spacing.sm,
              borderTopWidth: theme.borderWidth.hairline,
              borderTopColor: theme.colors.border.subtle,
            }
      }
    >
      {inline ? null : <AppText role="bodyStrong">{title}</AppText>}
      {item.rpe !== null && !editing ? (
        <>
          {inline ? null : (
            <AppText role="metric">{t('playerApp.rpe.value', { value: item.rpe })}</AppText>
          )}
          {load !== null ? (
            <AppText tone="secondary">{t('rpe.sessionLoad', { load })}</AppText>
          ) : null}
          {inline ? null : <SentState pending={item.pending} />}
        </>
      ) : null}
      {showScale ? (
        <>
          <AppText tone="secondary">{t('rpe.prompt')}</AppText>
          <RpeScale value={selected} onChange={setSelected} />
          {correcting ? (
            <TextField
              label={t('playerApp.reason.label')}
              hint={t('playerApp.reason.hint')}
              value={reason}
              onChangeText={setReason}
            />
          ) : null}
          {problem !== null ? <StatusMessage level="critical">{problem}</StatusMessage> : null}
          <Button
            size="lg"
            label={t('playerApp.rpe.send')}
            onPress={send}
            disabled={selected === null}
            busy={busy}
          />
          {editing ? (
            <Button
              variant="link"
              label={t('common.cancel')}
              onPress={() => {
                setEditing(false);
                setProblem(null);
              }}
            />
          ) : null}
        </>
      ) : null}
      {item.canSubmit && item.rpe !== null && !editing ? (
        <Button
          variant="secondary"
          label={t('playerApp.wellness.correct')}
          onPress={() => {
            setSelected(item.rpe);
            setEditing(true);
          }}
        />
      ) : null}
      <AppText role="caption" tone="muted">
        {item.canSubmit ? t('playerApp.rpe.closesAt', closes) : t('playerApp.rpe.closed')}
      </AppText>
    </View>
  );
}

/** One upcoming test day: date, window and place, and the tests the battery schedules. */
export function TestDaySummary({ day }: { readonly day: MyTestDay }) {
  const { t } = useTranslator();
  const theme = useTheme();
  const where = [day.testWindow?.label, day.location].filter(
    (part): part is string => part !== null && part !== undefined,
  );
  return (
    <View style={{ gap: theme.spacing.xxs }}>
      <AppText role="cardTitle">{formatLocalDateLong(day.scheduledOn, { year: false })}</AppText>
      {where.length > 0 ? <AppText tone="secondary">{where.join(' · ')}</AppText> : null}
      {day.status === 'in_progress' ? (
        <StatusChip level="warning" label={t('playerApp.testDays.inProgress')} />
      ) : null}
      <AppText role="bodySmall" tone="secondary">
        {day.testCodes.length === 0
          ? t('playerApp.testDays.noTests')
          : t('playerApp.testDays.tests', {
              tests: day.testCodes.map((code) => testLabel(t, code)).join(', '),
            })}
      </AppText>
    </View>
  );
}

/**
 * What is done, in one line: the check icon and its text (never color alone),
 * what was loaded, and the pending mark while it waits for signal. The line
 * is a button that opens what is under it (to see or correct the entry).
 */
function DoneLine({
  title,
  subtitle,
  pending,
  expanded,
  hint,
  onToggle,
}: {
  readonly title: string;
  readonly subtitle: string | null;
  readonly pending: boolean;
  readonly expanded: boolean;
  readonly hint: string;
  readonly onToggle: () => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      // Read as one sentence: a screen reader does not reach the texts inside a button.
      accessibilityLabel={[title, subtitle, pending ? t('playerApp.pending') : null]
        .filter(Boolean)
        .join('. ')}
      accessibilityHint={hint}
      aria-expanded={expanded}
      onPress={onToggle}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: theme.sizes.touchTarget,
        paddingVertical: theme.spacing.xs,
        marginHorizontal: -theme.spacing.sm,
        paddingHorizontal: theme.spacing.sm,
        borderRadius: theme.radius.md,
        borderWidth: theme.borderWidth.thick,
        borderColor: focused ? theme.colors.focus : 'transparent',
        backgroundColor: pressed ? theme.colors.brand.subtle : 'transparent',
      })}
    >
      <StatusIcon level="ok" />
      <View style={{ flex: 1, gap: theme.spacing.xxs }}>
        <AppText role="bodyStrong">{title}</AppText>
        {subtitle !== null ? (
          <AppText role="bodySmall" tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
        <SentState pending={pending} />
      </View>
      <Text
        accessible={false}
        importantForAccessibility="no"
        style={[theme.text.title, { color: theme.colors.text.muted }]}
      >
        {expanded ? '−' : '+'}
      </Text>
    </Pressable>
  );
}

/** A row of what is done, with its divider and, opened, what is under it. */
function DoneRow({ first, children }: { readonly first: boolean; readonly children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: theme.spacing.sm,
        paddingTop: first ? 0 : theme.spacing.sm,
        borderTopWidth: first ? 0 : theme.borderWidth.hairline,
        borderTopColor: theme.colors.border.subtle,
      }}
    >
      {children}
    </View>
  );
}

function DoneCard({
  items,
  data,
  actions,
  onToggle,
  onEditingChange,
}: {
  readonly items: readonly DoneItem[];
  readonly data: PlayerTodayData;
  readonly actions: PlayerTodayActions;
  readonly onToggle: (key: string) => void;
  /** Stable (a `useCallback` of the parent), so the cards' effect does not run on every render. */
  readonly onEditingChange: EditingChange;
}) {
  const { t } = useTranslator();
  const { wellness } = data;
  return (
    <Card>
      {items.map((item, index) => {
        const first = index === 0;
        if (item.kind === 'rpeNone') {
          return (
            <DoneRow key={item.key} first={first}>
              <AppText role="bodySmall" tone="muted">
                {t('playerApp.rpe.none')}
              </AppText>
            </DoneRow>
          );
        }
        if (item.kind === 'wellness') {
          if (wellness.kind !== 'form' || wellness.entry === null) return null;
          const { scores } = wellness.entry;
          // The mean the alert rules evaluate; a check-in always has an answer, but never throw here.
          const mean = wellness.items.some((entry) => scores[entry] !== undefined)
            ? wellnessMeanScore(scores)
            : null;
          return (
            <DoneRow key={item.key} first={first}>
              <DoneLine
                title={t('playerApp.today.wellnessDone')}
                subtitle={
                  mean === null
                    ? null
                    : t('playerApp.today.wellnessMean', {
                        mean: formatNumber(mean, { maxDecimals: 1 }),
                      })
                }
                pending={wellness.entry.pending}
                expanded={item.expanded}
                hint={t('playerApp.today.openHint')}
                onToggle={() => {
                  onToggle(item.key);
                }}
              />
              {item.expanded ? (
                <WellnessCard
                  section={wellness}
                  actions={actions}
                  editingKey={item.key}
                  onEditingChange={onEditingChange}
                />
              ) : null}
            </DoneRow>
          );
        }
        const session = data.rpe.sessions.find((entry) => entry.session.id === item.sessionId);
        if (session === undefined || session.rpe === null) return null;
        return (
          <DoneRow key={item.key} first={first}>
            <DoneLine
              title={t('playerApp.today.rpeDone', { value: session.rpe })}
              subtitle={rpeSessionTitle(t, session, data.timeZone)}
              pending={session.pending}
              expanded={item.expanded}
              hint={t(session.canSubmit ? 'playerApp.today.openHint' : 'playerApp.today.viewHint')}
              onToggle={() => {
                onToggle(item.key);
              }}
            />
            {item.expanded ? (
              <RpeSessionCard
                item={session}
                timeZone={data.timeZone}
                onSubmit={actions.onSubmitRpe}
                inline
                editingKey={item.key}
                onEditingChange={onEditingChange}
              />
            ) : null}
          </DoneRow>
        );
      })}
    </Card>
  );
}

function StreakRow({
  streak,
  first,
}: {
  readonly streak: WellnessStreak;
  readonly first: boolean;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const title = t('playerApp.streak.title');
  const caption =
    streak.days === 0
      ? t('playerApp.streak.none')
      : streak.includesToday
        ? null
        : t('playerApp.streak.keepAlive');
  return (
    <ListRow
      first={first}
      title={title}
      subtitle={caption}
      accessibilityLabel={[`${title}: ${t('wellness.streak', { days: streak.days })}`, caption]
        .filter(Boolean)
        .join('. ')}
      trailing={
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing.xs }}>
          {/* The streak alive today is the reward: its figure in the club accent. */}
          <AppText role="metricSmall" tone={streak.includesToday ? 'accent' : 'primary'}>
            {String(streak.days)}
          </AppText>
          <AppText role="unit" tone="secondary">
            {t('playerApp.streak.unit', { days: streak.days })}
          </AppText>
        </View>
      }
    />
  );
}

function NextTestDayRow({ day, first }: { readonly day: MyTestDay; readonly first: boolean }) {
  const { t } = useTranslator();
  const subtitle = [
    formatLocalDateLong(day.scheduledOn, { year: false }),
    day.testWindow?.label,
    day.location,
  ]
    .filter((part): part is string => part !== null && part !== undefined)
    .join(' · ');
  return (
    <ListRow first={first} title={t('playerApp.testDays.next')} subtitle={subtitle}>
      {day.status === 'in_progress' ? (
        <StatusChip level="warning" label={t('playerApp.testDays.inProgress')} />
      ) : null}
      <AppText role="bodySmall" tone="secondary">
        {day.testCodes.length === 0
          ? t('playerApp.testDays.noTests')
          : t('playerApp.testDays.tests', {
              tests: day.testCodes.map((code) => testLabel(t, code)).join(', '),
            })}
      </AppText>
    </ListRow>
  );
}

/** The secondary items, below what is pending and done: compact rows, not cards. */
function SecondaryCard({
  rows,
  data,
  actions,
}: {
  readonly rows: readonly SecondaryRow[];
  readonly data: PlayerTodayData | null;
  readonly actions: PlayerTodayActions;
}) {
  const { t } = useTranslator();
  // Only the rows that draw something: never an empty "Además" card.
  const shown = rows.filter((row) => {
    switch (row) {
      case 'streak':
        return data !== null;
      case 'nextTestDay':
        return Boolean(data?.nextTestDay);
      case 'painReport':
        return Boolean(actions.onOpenPainReport);
      case 'externalLoad':
        return Boolean(actions.onOpenExternalLoad);
      case 'menstrualCycle':
        return Boolean(actions.onOpenMenstrualCycle);
    }
  });
  if (shown.length === 0) return null;
  return (
    <Card title={t('playerApp.today.more')}>
      <View>
        {shown.map((row, index) => {
          const first = index === 0;
          switch (row) {
            case 'streak':
              return data === null ? null : (
                <StreakRow key={row} streak={data.streak} first={first} />
              );
            case 'nextTestDay':
              return data?.nextTestDay ? (
                <NextTestDayRow key={row} day={data.nextTestDay} first={first} />
              ) : null;
            case 'painReport':
              return actions.onOpenPainReport ? (
                <ListRow
                  key={row}
                  first={first}
                  title={t('pain.title')}
                  accessibilityHint={t('pain.privacy')}
                  onPress={actions.onOpenPainReport}
                />
              ) : null;
            case 'externalLoad':
              return actions.onOpenExternalLoad ? (
                <ListRow
                  key={row}
                  first={first}
                  title={t('externalLoad.open')}
                  subtitle={t('externalLoad.open.hint')}
                  onPress={actions.onOpenExternalLoad}
                />
              ) : null;
            case 'menstrualCycle':
              return actions.onOpenMenstrualCycle ? (
                <ListRow
                  key={row}
                  first={first}
                  title={t('cycle.title')}
                  subtitle={t('cycle.open.hint')}
                  onPress={actions.onOpenMenstrualCycle}
                />
              ) : null;
          }
        })}
      </View>
    </Card>
  );
}

/** The sections of a ready "Hoy", in the order `todaySections` gives. */
function TodaySections({
  data,
  actions,
}: {
  readonly data: PlayerTodayData;
  readonly actions: PlayerTodayActions;
}) {
  const { t } = useTranslator();
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  // Lines with a correction open: tapping them keeps them open, so the draft is not lost.
  const editing = useRef(new Set<string>());
  const setEditing = useCallback((key: string, value: boolean) => {
    if (value) editing.current.add(key);
    else editing.current.delete(key);
  }, []);
  const toggle = (key: string) => {
    if (editing.current.has(key)) return;
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const sections = todaySections({
    wellness: data.wellness,
    rpe: data.rpe,
    hasNextTestDay: data.nextTestDay !== null,
    offers: {
      painReport: Boolean(actions.onOpenPainReport),
      externalLoad: Boolean(actions.onOpenExternalLoad),
      menstrualCycle: Boolean(actions.onOpenMenstrualCycle),
    },
    opened,
  });

  // A form that was pending and is now a done line unmounts (focus goes with
  // it): say it was saved, out loud and on screen, as the old card did.
  const pendingKeys = sections
    .flatMap((section) =>
      section.kind === 'wellnessForm'
        ? [sectionKey({ kind: 'wellness' })]
        : section.kind === 'rpeForm'
          ? section.sessionIds.map((sessionId) => sectionKey({ kind: 'rpe', sessionId }))
          : [],
    )
    .join('|');
  const doneKeys = sections
    .flatMap((section) => (section.kind === 'done' ? section.items.map((item) => item.key) : []))
    .join('|');
  const previousPending = useRef(pendingKeys);
  // Only what the player sent from these forms: a check-in that arrives with a
  // sync pull (or loaded on a kiosk) never says "Gracias por cargar…".
  const sentHere = useRef(new Set<string>());
  const [justSaved, setJustSaved] = useState<'wellness' | 'rpe' | null>(null);
  useEffect(() => {
    const before = previousPending.current;
    previousPending.current = pendingKeys;
    const done = new Set(doneKeys.split('|'));
    const saved = before
      .split('|')
      .filter((key) => key !== '' && done.has(key) && sentHere.current.has(key));
    for (const key of saved) sentHere.current.delete(key);
    if (saved.length === 0) return;
    const kind = saved.includes(sectionKey({ kind: 'wellness' })) ? 'wellness' : 'rpe';
    setJustSaved(kind);
    // iOS reads only what is announced; Android already reads the polite live region.
    if (Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibility(
        t(kind === 'wellness' ? 'wellness.submitted' : 'playerApp.today.rpeSubmitted'),
      );
    }
  }, [pendingKeys, doneKeys, t]);
  const remember = (key: string, task: Promise<void>): Promise<void> => {
    sentHere.current.add(key);
    return task.catch((error: unknown) => {
      sentHere.current.delete(key);
      throw error;
    });
  };
  // The pending forms send through these, so their save is the one said "¡Listo!".
  const formActions: PlayerTodayActions = {
    ...actions,
    onSubmitWellness: (scores) =>
      remember(sectionKey({ kind: 'wellness' }), actions.onSubmitWellness(scores)),
    onSubmitRpe: (sessionId, rpe, reason) =>
      remember(sectionKey({ kind: 'rpe', sessionId }), actions.onSubmitRpe(sessionId, rpe, reason)),
  };
  // With "Todo listo por hoy" on top, a "¡Listo!" over it says the same twice.
  const allDone = sections.some((section) => section.kind === 'allDone');

  return (
    <>
      {justSaved !== null && !allDone ? (
        <StatusMessage level="ok">
          {t(justSaved === 'wellness' ? 'wellness.submitted' : 'playerApp.today.rpeSubmitted')}
        </StatusMessage>
      ) : null}
      {sections.map((section) => {
        switch (section.kind) {
          case 'allDone':
            return (
              <StatusMessage key="allDone" level="ok">
                {t('playerApp.today.allDone')}
              </StatusMessage>
            );
          case 'wellnessForm':
            return data.wellness.kind === 'form' ? (
              <WellnessCard key="wellnessForm" section={data.wellness} actions={formActions} />
            ) : null;
          case 'rpeForm':
            return (
              <Card key="rpeForm" variant="highlight" title={t('rpe.title')}>
                {data.rpe.sessions
                  .filter((item) => section.sessionIds.includes(item.session.id))
                  .map((item) => (
                    <RpeSessionCard
                      key={item.session.id}
                      item={item}
                      timeZone={data.timeZone}
                      onSubmit={formActions.onSubmitRpe}
                    />
                  ))}
              </Card>
            );
          case 'wellnessBlocked':
            return (
              <Card key="wellnessBlocked" title={t('wellness.title')}>
                <StatusMessage level="warning">
                  {t(
                    section.reason === 'no_consent'
                      ? 'playerApp.wellness.noConsent'
                      : 'playerApp.wellness.noStage',
                  )}
                </StatusMessage>
              </Card>
            );
          case 'rpeBlocked':
            return (
              <Card key="rpeBlocked" title={t('rpe.title')}>
                <StatusMessage level="warning">{t('playerApp.rpe.noConsent')}</StatusMessage>
              </Card>
            );
          case 'done':
            return (
              <DoneCard
                key="done"
                items={section.items}
                data={data}
                actions={actions}
                onToggle={toggle}
                onEditingChange={setEditing}
              />
            );
          case 'secondary':
            return (
              <SecondaryCard key="secondary" rows={section.rows} data={data} actions={actions} />
            );
        }
      })}
    </>
  );
}

/**
 * "Hoy" of the player (B-503), ordered by status (ADR 0104): what is pending
 * today first and open, so wellness and RPE take under 20 seconds; what is
 * done in one line each (tap to see or correct); the streak, the next test
 * day and the entry points below as rows. Everything here reads the phone
 * first and writes to the offline queue.
 */
export function PlayerTodayScreen({
  greeting,
  state,
  notice,
  sync,
  actions,
}: {
  readonly greeting: string;
  readonly state: PlayerTodayState;
  /** "Without signal: what was kept on…" when the shown data is not fresh. */
  readonly notice: string | null;
  readonly sync?: ReactNode;
  readonly actions: PlayerTodayActions;
}) {
  const { t } = useTranslator();
  if (state.status === 'loading') return <LoadingView label={t('common.loading')} />;
  return (
    <ScreenBody
      header={
        <ScreenHeader
          title={greeting}
          subtitle={
            state.status === 'ready' ? formatLocalDateLong(state.data.today, { year: false }) : null
          }
        />
      }
    >
      {notice !== null ? <StatusMessage level="warning">{notice}</StatusMessage> : null}
      {sync}
      {state.status === 'error' ? (
        <>
          <StatusMessage level="critical">{state.message}</StatusMessage>
          <Button variant="secondary" label={t('common.retry')} onPress={actions.onRetry} />
          {/* What does not need today's data stays at hand. */}
          <SecondaryCard
            rows={[
              ...(actions.onOpenExternalLoad ? (['externalLoad'] as const) : []),
              ...(actions.onOpenMenstrualCycle ? (['menstrualCycle'] as const) : []),
            ]}
            data={null}
            actions={actions}
          />
        </>
      ) : (
        <TodaySections data={state.data} actions={actions} />
      )}
      <AppText role="caption" tone="muted">
        {t('legal.notMedicalDevice')}
      </AppText>
    </ScreenBody>
  );
}
