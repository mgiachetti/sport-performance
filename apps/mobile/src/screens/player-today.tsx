import type { MyTestDay } from '@sport-performance/contracts';
import {
  RPE_CR10_MAX,
  RPE_CR10_MIN,
  WELLNESS_SCORE_MAX,
  WELLNESS_SCORE_MIN,
  localDateInTimeZone,
  type LocalDate,
  type TimeZone,
  type WellnessItem,
} from '@sport-performance/domain';
import { formatLocalDateLong, formatTime } from '@sport-performance/i18n';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { rpeLabel, testLabel, wellnessItemLabel } from '../player/format.ts';
import type { WellnessStreak } from '../player/streak.ts';
import type { RpeSession, TodayWellness } from '../player/today.ts';
import { KpiRow, KpiTile, ListRow, StatusChip } from '../ui/blocks.tsx';
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
  StatusMessage,
  TextField,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';

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
   * "¿Te duele algo?" after the check-in (B-609): only when the club asks it
   * and the player has the health consent; `null` (or absent) hides it.
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

function WellnessCard({
  section,
  actions,
}: {
  readonly section: WellnessSection;
  readonly actions: PlayerTodayActions;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [answers, setAnswers] = useState<Scores>({});
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (section.kind === 'unavailable') {
    return (
      <Card title={t('wellness.title')}>
        <StatusMessage level="warning">
          {t(
            section.reason === 'no_consent'
              ? 'playerApp.wellness.noConsent'
              : 'playerApp.wellness.noStage',
          )}
        </StatusMessage>
      </Card>
    );
  }
  const faces = section.itemCount === 3;
  const { entry } = section;

  if (entry !== null && !correcting) {
    return (
      <Card title={t('playerApp.wellness.today')}>
        <StatusMessage level="ok">{t('wellness.submitted')}</StatusMessage>
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
        <SentState pending={entry.pending} />
        {actions.onOpenPainReport ? (
          <Button
            label={t('pain.title')}
            accessibilityHint={t('pain.privacy')}
            onPress={actions.onOpenPainReport}
          />
        ) : null}
        <Button
          variant="secondary"
          label={t('playerApp.wellness.correct')}
          onPress={() => {
            setAnswers({ ...entry.scores });
            setCorrecting(true);
            setProblem(null);
          }}
        />
      </Card>
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

  return (
    <Card
      variant="highlight"
      title={t('wellness.prompt')}
      subtitle={t(faces ? 'playerApp.wellness.hintFaces' : 'playerApp.wellness.hintScale')}
    >
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

function RpeSessionCard({
  item,
  timeZone,
  onSubmit,
}: {
  readonly item: RpeSession;
  readonly timeZone: TimeZone;
  readonly onSubmit: PlayerTodayActions['onSubmitRpe'];
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = t('playerApp.rpe.session', {
    kind: item.session.kind,
    date: formatLocalDateLong(item.session.localDate, { year: false }),
    time: formatTime(Date.parse(item.session.startsAt), { timeZone }),
  });
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
      style={{
        gap: theme.spacing.sm,
        paddingTop: theme.spacing.sm,
        borderTopWidth: theme.borderWidth.hairline,
        borderTopColor: theme.colors.border.subtle,
      }}
    >
      <AppText role="bodyStrong">{title}</AppText>
      {item.rpe !== null && !editing ? (
        <>
          <AppText role="metric">{t('playerApp.rpe.value', { value: item.rpe })}</AppText>
          {load !== null ? (
            <AppText tone="secondary">{t('rpe.sessionLoad', { load })}</AppText>
          ) : null}
          <SentState pending={item.pending} />
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

function RpeCard({
  data,
  onSubmit,
}: {
  readonly data: PlayerTodayData;
  readonly onSubmit: PlayerTodayActions['onSubmitRpe'];
}) {
  const { t } = useTranslator();
  return (
    <Card title={t('rpe.title')}>
      {!data.rpe.allowed ? (
        <StatusMessage level="warning">{t('playerApp.rpe.noConsent')}</StatusMessage>
      ) : data.rpe.sessions.length === 0 ? (
        <AppText tone="secondary">{t('playerApp.rpe.none')}</AppText>
      ) : (
        data.rpe.sessions.map((item) => (
          <RpeSessionCard
            key={item.session.id}
            item={item}
            timeZone={data.timeZone}
            onSubmit={onSubmit}
          />
        ))
      )}
    </Card>
  );
}

function StreakTile({ streak }: { readonly streak: WellnessStreak }) {
  const { t } = useTranslator();
  const title = t('playerApp.streak.title');
  if (streak.days === 0) {
    return <KpiTile label={title} value="0" caption={t('playerApp.streak.none')} />;
  }
  const caption = streak.includesToday ? null : t('playerApp.streak.keepAlive');
  return (
    <KpiTile
      label={title}
      value={String(streak.days)}
      unit={t('playerApp.streak.unit', { days: streak.days })}
      caption={caption}
      // The streak alive today is the reward: outlined in the club color, and said in the caption.
      highlighted={streak.includesToday}
      accessibilityLabel={[`${title}: ${t('wellness.streak', { days: streak.days })}`, caption]
        .filter(Boolean)
        .join('. ')}
    />
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
 * "Hoy" of the player (B-503): wellness and RPE on one screen, so both take
 * under 20 seconds; then the streak and the next test day. Everything here
 * reads the phone first and writes to the offline queue.
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
        </>
      ) : (
        <>
          <WellnessCard section={state.data.wellness} actions={actions} />
          <RpeCard data={state.data} onSubmit={actions.onSubmitRpe} />
          <KpiRow>
            <StreakTile streak={state.data.streak} />
          </KpiRow>
          <Card title={t('playerApp.testDays.next')}>
            {state.data.nextTestDay === null ? (
              <AppText tone="secondary">{t('playerApp.testDays.none')}</AppText>
            ) : (
              <TestDaySummary day={state.data.nextTestDay} />
            )}
          </Card>
        </>
      )}
      {actions.onOpenExternalLoad || actions.onOpenMenstrualCycle ? (
        <Card>
          {actions.onOpenExternalLoad ? (
            <ListRow
              first
              title={t('externalLoad.open')}
              subtitle={t('externalLoad.open.hint')}
              onPress={actions.onOpenExternalLoad}
            />
          ) : null}
          {actions.onOpenMenstrualCycle ? (
            <ListRow
              first={!actions.onOpenExternalLoad}
              title={t('cycle.title')}
              subtitle={t('cycle.open.hint')}
              onPress={actions.onOpenMenstrualCycle}
            />
          ) : null}
        </Card>
      ) : null}
      <AppText role="caption" tone="muted">
        {t('legal.notMedicalDevice')}
      </AppText>
    </ScreenBody>
  );
}
