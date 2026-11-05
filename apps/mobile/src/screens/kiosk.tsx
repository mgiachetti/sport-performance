import {
  RPE_CR10_MAX,
  RPE_CR10_MIN,
  WELLNESS_SCORE_MAX,
  WELLNESS_SCORE_MIN,
  type TimeZone,
  type WellnessItem,
} from '@sport-performance/domain';
import { formatDate, formatTime, type MessageKey } from '@sport-performance/i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { KioskExitResult } from '../kiosk/controller.ts';
import { kioskPinProblem, KIOSK_PIN_MAX_LENGTH } from '../kiosk/pin.ts';
import { searchKioskPlayers, type KioskPlayer, type KioskSessionTask } from '../kiosk/roster.ts';
import { ChoiceButton, ChoiceGroup, Face } from '../ui/choices.tsx';
import { useTranslator } from '../ui/i18n.tsx';
import {
  AppText,
  Button,
  Card,
  LoadingView,
  ScreenBody,
  ScreenHeader,
  StatusMessage,
  TextField,
} from '../ui/primitives.tsx';
import { useTheme } from '../ui/theme.tsx';
import { CheckRow, type LoadState } from './ift-3015.tsx';

/**
 * The kiosk mode (B-504, ADR 0086): presentation only, data and callbacks
 * by props. Nothing here ever shows a loaded value: the list shows names,
 * the turn of a player asks and thanks.
 */

/** A turn left alone this long goes back to the list, dropping what was answered. */
export const KIOSK_IDLE_MS = 60_000;
/** How long "Listo" stays before the list comes back. */
export const KIOSK_DONE_MS = 4_000;

type Scores = Partial<Record<WellnessItem, number>>;
const LEVELS = [1, 2, 3, 4, 5] as const;
const RPE_VALUES = Array.from(
  { length: RPE_CR10_MAX - RPE_CR10_MIN + 1 },
  (_, index) => RPE_CR10_MIN + index,
);
/** CR-10 anchors with a word (Borg): the other values are between two of them. */
const RPE_ANCHORS = new Set([0, 1, 2, 3, 4, 5, 7, 10]);

function rpeWord(t: ReturnType<typeof useTranslator>['t'], value: number): string | null {
  return RPE_ANCHORS.has(value) ? t(`rpe.scale.${String(value)}` as MessageKey) : null;
}

const itemKey = (item: WellnessItem) => `wellness.item.${item}` as const;

// ─── Setup (staff) ─────────────────────────────────────────────────────────────────────

export function KioskSetupScreen({
  categories,
  starting,
  error,
  onStart,
  onCancel,
}: {
  readonly categories: LoadState<readonly { readonly id: string; readonly name: string }[]>;
  readonly starting: boolean;
  /** Why the last start failed (no signal, the rosters did not come). */
  readonly error: string | null;
  readonly onStart: (categoryIds: readonly string[], pin: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const start = () => {
    if (selected.size === 0) {
      setProblem(t('kiosk.setup.pickCategory'));
      return;
    }
    const pinProblem = kioskPinProblem(pin, confirmation);
    if (pinProblem !== null) {
      setProblem(t(`kiosk.setup.pin.${pinProblem}`));
      return;
    }
    setProblem(null);
    onStart([...selected], pin);
  };
  const pinInput = {
    keyboardType: 'number-pad' as const,
    secureTextEntry: true,
    maxLength: KIOSK_PIN_MAX_LENGTH,
    autoComplete: 'off' as const,
    textContentType: 'oneTimeCode' as const,
  };

  return (
    <ScreenBody
      header={<ScreenHeader title={t('kiosk.setup.title')} subtitle={t('kiosk.setup.body')} />}
    >
      <Card title={t('kiosk.setup.categories')}>
        {categories.status === 'loading' ? (
          <LoadingView label={t('common.loading')} />
        ) : categories.status === 'error' ? (
          <StatusMessage level="critical">{categories.message}</StatusMessage>
        ) : categories.data.length === 0 ? (
          <StatusMessage level="warning">{t('kiosk.setup.noCategories')}</StatusMessage>
        ) : (
          <View accessibilityRole="list" style={{ gap: theme.spacing.xs }}>
            {categories.data.map((category) => (
              <CheckRow
                key={category.id}
                label={category.name}
                checked={selected.has(category.id)}
                onPress={() => {
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(category.id)) next.delete(category.id);
                    else next.add(category.id);
                    return next;
                  });
                }}
              />
            ))}
          </View>
        )}
      </Card>
      <Card>
        <TextField
          label={t('kiosk.setup.pin')}
          value={pin}
          onChangeText={setPin}
          inputProps={pinInput}
        />
        <TextField
          label={t('kiosk.setup.pinConfirm')}
          value={confirmation}
          onChangeText={setConfirmation}
          inputProps={pinInput}
        />
      </Card>
      <StatusMessage level="warning">{t('kiosk.setup.pinning')}</StatusMessage>
      {problem !== null ? <StatusMessage level="critical">{problem}</StatusMessage> : null}
      {error !== null ? <StatusMessage level="critical">{error}</StatusMessage> : null}
      <Button
        size="lg"
        label={starting ? t('kiosk.setup.starting') : t('kiosk.setup.start')}
        busy={starting}
        disabled={categories.status !== 'ready' || categories.data.length === 0}
        onPress={start}
      />
      <Button variant="link" label={t('common.cancel')} onPress={onCancel} />
    </ScreenBody>
  );
}

// ─── The list of players ───────────────────────────────────────────────────────────────

export function KioskPickScreen({
  title,
  players,
  keptAt,
  timeZone,
  sync,
  onPick,
  onExit,
}: {
  readonly title: string;
  readonly players: LoadState<readonly KioskPlayer[]>;
  /** When the shown roster was fetched, if it is the one kept without signal. */
  readonly keptAt: number | null;
  readonly timeZone: TimeZone;
  /** The sync indicator: the staff sees that the queue goes out. */
  readonly sync?: ReactNode;
  readonly onPick: (playerId: string) => void;
  readonly onExit: () => void;
}) {
  const { t } = useTranslator();
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const shown = players.status === 'ready' ? searchKioskPlayers(players.data, query) : [];
  return (
    <ScreenBody header={<ScreenHeader title={title} subtitle={t('kiosk.pick')} />}>
      <TextField
        label={t('kiosk.search')}
        hint={t('kiosk.search.hint')}
        value={query}
        onChangeText={setQuery}
        inputProps={{ autoCorrect: false, autoComplete: 'off', autoCapitalize: 'words' }}
      />
      {players.status === 'loading' ? (
        <LoadingView label={t('common.loading')} />
      ) : players.status === 'error' ? (
        <StatusMessage level="critical">{players.message}</StatusMessage>
      ) : players.data.length === 0 ? (
        <StatusMessage level="warning">{t('kiosk.empty')}</StatusMessage>
      ) : shown.length === 0 ? (
        <StatusMessage level="warning">{t('kiosk.noMatch')}</StatusMessage>
      ) : (
        <View
          accessibilityRole="list"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}
        >
          {shown.map((player) => (
            <View key={player.id} style={{ flexGrow: 1, flexBasis: 160 }}>
              <Button
                variant="secondary"
                size="lg"
                label={player.displayName}
                onPress={() => {
                  onPick(player.id);
                }}
              />
            </View>
          ))}
        </View>
      )}
      {keptAt !== null ? (
        <AppText role="caption" tone="muted">
          {t('kiosk.kept', {
            date: formatDate(keptAt, { timeZone }),
            time: formatTime(keptAt, { timeZone }),
          })}
        </AppText>
      ) : null}
      {sync}
      <Button variant="link" label={t('kiosk.exit')} onPress={onExit} />
    </ScreenBody>
  );
}

// ─── The turn of a player ──────────────────────────────────────────────────────────────

type Step =
  | { readonly kind: 'confirm' }
  | { readonly kind: 'wellness' }
  | { readonly kind: 'rpe'; readonly session: KioskSessionTask }
  | { readonly kind: 'done' };

/** What the turn asks, in order, after the player confirms their name. */
export function kioskSteps(player: KioskPlayer): Step[] {
  const steps: Step[] = [];
  if (player.wellness !== null) steps.push({ kind: 'wellness' });
  for (const session of player.rpe) steps.push({ kind: 'rpe', session });
  return steps;
}

export interface KioskTurnActions {
  /** Queues the check-in on the device; rejects only when the device could not save it. */
  readonly onSubmitWellness: (scores: Scores) => Promise<void>;
  readonly onSubmitRpe: (sessionId: string, rpe: number) => Promise<void>;
  /** Back to the list: the turn is over (done, cancelled or left alone). */
  readonly onFinish: () => void;
}

/**
 * One player's turn. Mount it with `key` = the turn: everything answered
 * lives in its state and is gone when it unmounts. The steps are taken from
 * the player as the turn starts: what the player loads here does not make
 * the turn change under their finger.
 */
export function KioskTurn({
  player,
  timeZone,
  actions,
  idleMs = KIOSK_IDLE_MS,
  doneMs = KIOSK_DONE_MS,
}: {
  readonly player: KioskPlayer;
  readonly timeZone: TimeZone;
  readonly actions: KioskTurnActions;
  readonly idleMs?: number;
  readonly doneMs?: number;
}) {
  const { t } = useTranslator();
  const [steps] = useState(() => kioskSteps(player));
  const [step, setStep] = useState<Step>({ kind: 'confirm' });
  const [confirmed, setConfirmed] = useState(false);
  const [scores, setScores] = useState<Scores>({});
  const [rpe, setRpe] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const finish = useRef(actions.onFinish);
  useEffect(() => {
    finish.current = actions.onFinish;
  });

  // Left alone: back to the list. Any answer, or the next step, starts the minute again.
  useEffect(() => {
    if (busy) return undefined;
    const handle = setTimeout(
      () => {
        finish.current();
      },
      // "Listo" and the messages of a turn with nothing to ask stay a few seconds.
      step.kind === 'done' || (step.kind === 'confirm' && confirmed) ? doneMs : idleMs,
    );
    return () => {
      clearTimeout(handle);
    };
  }, [step, confirmed, scores, rpe, busy, idleMs, doneMs]);

  const index = step.kind === 'confirm' || step.kind === 'done' ? -1 : steps.indexOf(step);
  const advance = () => {
    const next = steps[index + 1];
    setStep(next ?? { kind: 'done' });
    setRpe(null);
    setProblem(null);
  };
  const run = (task: Promise<void>) => {
    setBusy(true);
    setProblem(null);
    task
      .then(advance)
      .catch(() => {
        setProblem(t('kiosk.turn.saveError'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const cancel = (
    <Button variant="ghost" label={t('kiosk.turn.notMe')} onPress={actions.onFinish} />
  );
  const progress =
    index >= 0 && steps.length > 1
      ? t('kiosk.turn.step', { step: index + 1, total: steps.length })
      : null;

  if (step.kind === 'confirm') {
    if (confirmed) {
      // Confirmed, and nothing to ask or not allowed: the message, then back.
      return (
        <ScreenBody header={<ScreenHeader title={player.displayName} />}>
          <StatusMessage level={player.canReport ? 'ok' : 'warning'}>
            {player.canReport ? t('kiosk.turn.nothingLeft') : t('kiosk.turn.unavailable')}
          </StatusMessage>
          <Button label={t('kiosk.turn.back')} onPress={actions.onFinish} />
        </ScreenBody>
      );
    }
    return (
      <ScreenBody
        header={<ScreenHeader title={t('kiosk.turn.confirm', { name: player.displayName })} />}
      >
        <Button
          size="lg"
          label={t('kiosk.turn.yes')}
          onPress={() => {
            setConfirmed(true);
            const [first] = steps;
            if (player.canReport && first !== undefined) setStep(first);
          }}
        />
        {cancel}
      </ScreenBody>
    );
  }

  if (step.kind === 'done') {
    return (
      <ScreenBody
        header={<ScreenHeader title={t('kiosk.turn.done', { name: player.firstName })} />}
      >
        <StatusMessage level="ok">{t('kiosk.turn.doneHint')}</StatusMessage>
        <Button label={t('kiosk.turn.back')} onPress={actions.onFinish} />
      </ScreenBody>
    );
  }

  if (step.kind === 'wellness') {
    const wellness = player.wellness;
    if (wellness === null) return null;
    const faces = wellness.itemCount === 3;
    const missing = wellness.items.filter((item) => scores[item] === undefined);
    return (
      <ScreenBody
        header={
          <ScreenHeader
            eyebrow={progress}
            title={t('wellness.prompt')}
            subtitle={player.displayName}
          />
        }
      >
        {wellness.items.map((item) => (
          <WellnessScale
            key={item}
            item={item}
            faces={faces}
            value={scores[item]}
            onChange={(score) => {
              setScores((current) => ({ ...current, [item]: score }));
            }}
          />
        ))}
        {problem !== null ? <StatusMessage level="critical">{problem}</StatusMessage> : null}
        <Button
          size="lg"
          label={steps.length > 1 ? t('kiosk.turn.next') : t('kiosk.turn.send')}
          busy={busy}
          onPress={() => {
            if (missing.length > 0) {
              setProblem(
                t('kiosk.turn.missing', {
                  items: missing.map((item) => t(itemKey(item))).join(', '),
                }),
              );
              return;
            }
            const answer: Scores = {};
            for (const item of wellness.items) {
              const score = scores[item];
              if (score !== undefined) answer[item] = score;
            }
            run(actions.onSubmitWellness(answer));
          }}
        />
        {cancel}
      </ScreenBody>
    );
  }

  const { session } = step;
  const time = formatTime(Date.parse(session.startsAt), { timeZone });
  const sessionName =
    session.title === null
      ? t(`kiosk.turn.sessionUntitled.${session.kind}`, { time })
      : t('kiosk.turn.session', { title: session.title, time });
  const word = rpe === null ? null : rpeWord(t, rpe);
  return (
    <ScreenBody
      header={<ScreenHeader eyebrow={progress} title={t('rpe.prompt')} subtitle={sessionName} />}
    >
      <ChoiceGroup label={t('rpe.prompt')}>
        {RPE_VALUES.map((value) => {
          const name = rpeWord(t, value);
          return (
            <ChoiceButton
              key={value}
              label={String(value)}
              accessibilityLabel={
                name === null
                  ? t('kiosk.choice.rpe', { value })
                  : t('kiosk.choice.rpeLabelled', { value, label: name })
              }
              selected={rpe === value}
              onPress={() => {
                setRpe(value);
              }}
            />
          );
        })}
      </ChoiceGroup>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <AppText role="caption" tone="secondary">{`0 · ${t('rpe.scale.0')}`}</AppText>
        <AppText role="caption" tone="secondary">{`${t('rpe.scale.10')} · 10`}</AppText>
      </View>
      {rpe !== null ? (
        <AppText role="metric" tone="accent">
          {word === null ? String(rpe) : `${String(rpe)} · ${word}`}
        </AppText>
      ) : null}
      {problem !== null ? <StatusMessage level="critical">{problem}</StatusMessage> : null}
      <Button
        size="lg"
        label={index + 1 < steps.length ? t('kiosk.turn.next') : t('kiosk.turn.send')}
        busy={busy}
        onPress={() => {
          if (rpe === null) {
            setProblem(t('kiosk.turn.pickRpe'));
            return;
          }
          run(actions.onSubmitRpe(session.sessionId, rpe));
        }}
      />
      {cancel}
    </ScreenBody>
  );
}

function WellnessScale({
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
  const name = t(itemKey(item));
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <AppText role="cardTitle">{name}</AppText>
      <ChoiceGroup label={name}>
        {LEVELS.map((level) => {
          const word = t(`kiosk.face.${String(level) as '1'}`);
          return faces ? (
            <ChoiceButton
              key={level}
              accessibilityLabel={t('kiosk.choice.face', { item: name, label: word })}
              selected={value === level}
              onPress={() => {
                onChange(level);
              }}
            >
              {(ink: string) => (
                <>
                  <Face level={level} size={48} color={ink} />
                  <Text style={[theme.text.caption, { color: ink }]}>{word}</Text>
                </>
              )}
            </ChoiceButton>
          ) : (
            <ChoiceButton
              key={level}
              label={String(level)}
              accessibilityLabel={t('kiosk.choice.score', { item: name, score: level })}
              selected={value === level}
              onPress={() => {
                onChange(level);
              }}
            />
          );
        })}
      </ChoiceGroup>
      {faces ? null : (
        <AppText role="caption" tone="secondary">
          {`${String(WELLNESS_SCORE_MIN)}–${String(WELLNESS_SCORE_MAX)} · ${t('kiosk.scale.best')}`}
        </AppText>
      )}
    </View>
  );
}

// ─── Exit (staff) ──────────────────────────────────────────────────────────────────────

export function KioskExitScreen({
  timeZone,
  onSubmit,
  onCancel,
}: {
  readonly timeZone: TimeZone;
  readonly onSubmit: (pin: string) => Promise<KioskExitResult>;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslator();
  const [pin, setPin] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    setBusy(true);
    onSubmit(pin)
      .then((result) => {
        if (result.ok) return;
        setPin('');
        setProblem(
          result.lockedUntilMs === null
            ? t('kiosk.exit.wrong')
            : t('kiosk.exit.locked', { time: formatTime(result.lockedUntilMs, { timeZone }) }),
        );
      })
      .catch(() => {
        setProblem(t('error.generic'));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  return (
    <ScreenBody
      header={<ScreenHeader title={t('kiosk.exit.title')} subtitle={t('kiosk.exit.body')} />}
    >
      <TextField
        label={t('kiosk.exit.pin')}
        value={pin}
        onChangeText={setPin}
        inputProps={{
          keyboardType: 'number-pad',
          secureTextEntry: true,
          maxLength: KIOSK_PIN_MAX_LENGTH,
          autoComplete: 'off',
          onSubmitEditing: submit,
        }}
      />
      {problem !== null ? <StatusMessage level="critical">{problem}</StatusMessage> : null}
      <Button
        size="lg"
        label={t('kiosk.exit.confirm')}
        busy={busy}
        disabled={pin.length === 0}
        onPress={submit}
      />
      <Button variant="link" label={t('common.cancel')} onPress={onCancel} />
      <AppText role="caption" tone="muted">
        {t('kiosk.exit.forgot')}
      </AppText>
    </ScreenBody>
  );
}
