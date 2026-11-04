import type { GymProgram } from '@sport-performance/contracts';
import type { GymExerciseSummary } from '@sport-performance/domain';
import {
  formatDuration,
  formatLocalDate,
  formatUnit,
  type Translator,
} from '@sport-performance/i18n';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import {
  exerciseName,
  nextSetNumber,
  parseSetForm,
  prefilledForm,
  type GymPlanExerciseDto,
  type GymSetView,
  type ParsedSet,
  type SetForm,
  type SetFormField,
} from '../gym/model.ts';
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
 * The gym on the phone (B-607, ADR 0075): presentational, fed by the route
 * with what the local database holds, so it works without signal and is
 * tested without a device. The player picks the program and the day, sees
 * what is prescribed and logs each set (reps × kg × RIR, or seconds).
 */

export interface GymData {
  readonly programs: readonly GymProgram[];
  readonly sets: readonly GymSetView[];
  readonly best: readonly GymExerciseSummary[];
}

export type GymLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly data: GymData };

export type LogOutcome = 'logged' | 'failed';

function prescription(exercise: GymPlanExerciseDto, { t }: Translator): string {
  const parts: string[] = [];
  if (exercise.measure === 'duration' && exercise.durationS !== null) {
    parts.push(
      t('gym.prescription.duration', {
        sets: exercise.sets,
        duration: formatDuration(exercise.durationS),
      }),
    );
  } else if (exercise.repsMin !== null && exercise.repsMax !== null) {
    parts.push(
      exercise.repsMin === exercise.repsMax
        ? t('gym.prescription.repsExact', { sets: exercise.sets, reps: exercise.repsMin })
        : t('gym.prescription.reps', {
            sets: exercise.sets,
            min: exercise.repsMin,
            max: exercise.repsMax,
          }),
    );
  }
  if (exercise.targetRir !== null)
    parts.push(t('gym.prescription.rir', { rir: exercise.targetRir }));
  if (exercise.loadKg !== null) {
    parts.push(
      t('gym.prescription.load', { load: formatUnit(exercise.loadKg, 'kg', { maxDecimals: 1 }) }),
    );
  }
  if (exercise.restS !== null && exercise.restS > 0) {
    parts.push(t('gym.prescription.rest', { rest: formatDuration(exercise.restS) }));
  }
  return parts.join(' · ');
}

function setText(set: GymSetView, translator: Translator): string {
  const { t } = translator;
  const parts: string[] = [t('gym.set.number', { number: set.setNumber })];
  if (set.durationS !== null) parts.push(formatDuration(set.durationS));
  else if (set.loadKg !== null) {
    parts.push(
      t('gym.set.repsLoad', {
        reps: String(set.reps ?? 0),
        load: formatUnit(set.loadKg, 'kg', { maxDecimals: 1 }),
      }),
    );
  } else parts.push(t('gym.set.reps', { reps: set.reps ?? 0 }));
  if (set.rir !== null) parts.push(t('gym.set.rir', { rir: set.rir }));
  if (set.techniqueScore !== null)
    parts.push(t('gym.set.technique', { score: set.techniqueScore }));
  if (set.e1rmKg !== null) {
    parts.push(t('gym.mobile.set.e1rm', { value: formatUnit(set.e1rmKg, 'kg', { decimals: 1 }) }));
  }
  return parts.join(' · ');
}

function ExerciseCard({
  exercise,
  sets,
  onLog,
}: {
  readonly exercise: GymPlanExerciseDto;
  readonly sets: readonly GymSetView[];
  readonly onLog: (exerciseCode: string, setNumber: number, set: ParsedSet) => Promise<LogOutcome>;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const theme = useTheme();
  const [form, setForm] = useState<SetForm>(() => prefilledForm(exercise));
  const [errors, setErrors] = useState<Partial<Record<SetFormField, string>>>({});
  const [outcome, setOutcome] = useState<LogOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = sets.filter((set) => set.exerciseCode === exercise.exerciseCode);
  const number = nextSetNumber(sets, exercise.exerciseCode);
  const name = exerciseName(exercise.exerciseCode, exercise.name, translator);
  const field = (key: SetFormField, label: string, keyboard: 'number-pad' | 'decimal-pad') => (
    <TextField
      label={label}
      value={form[key]}
      error={errors[key] ?? null}
      inputProps={{ keyboardType: keyboard }}
      onChangeText={(value) => {
        setForm({ ...form, [key]: value });
        setOutcome(null);
      }}
    />
  );
  const log = async () => {
    const parsed = parseSetForm(form, exercise);
    if ('errors' in parsed) {
      setErrors(
        Object.fromEntries(
          Object.entries(parsed.errors).map(([key, code]) => [key, t(`gym.mobile.error.${code}`)]),
        ),
      );
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      setOutcome(await onLog(exercise.exerciseCode, number, parsed.set));
    } finally {
      setBusy(false);
    }
  };
  const rir = form.rir.trim();
  return (
    <Card>
      <AppText role="heading" accessibilityRole="header">
        {name}
      </AppText>
      <AppText tone="secondary">
        {t('gym.mobile.prescription', { text: prescription(exercise, translator) })}
      </AppText>
      {exercise.notes === null ? null : <AppText tone="secondary">{exercise.notes}</AppText>}
      {mine.length === 0 ? (
        <AppText tone="muted">{t('gym.mobile.sets.none')}</AppText>
      ) : (
        <View style={{ gap: theme.spacing.xs }}>
          {mine.map((set) => (
            <View key={set.key} style={{ gap: theme.spacing.xs }}>
              <AppText>{setText(set, translator)}</AppText>
              {set.pending ? (
                <StatusMessage level="warning">{t('gym.mobile.set.pending')}</StatusMessage>
              ) : null}
              {set.warnings.map((warning) => (
                <StatusMessage key={warning} level="warning">
                  {t(`gym.warning.${warning}`)}
                </StatusMessage>
              ))}
            </View>
          ))}
        </View>
      )}
      {exercise.measure === 'duration'
        ? field('durationS', t('gym.mobile.field.durationS'), 'number-pad')
        : field('reps', t('gym.mobile.field.reps'), 'number-pad')}
      {exercise.loadKind === 'bodyweight'
        ? null
        : field(
            'loadKg',
            exercise.loadKind === 'bodyweight_plus'
              ? t('gym.mobile.field.addedKg')
              : t('gym.mobile.field.loadKg'),
            'decimal-pad',
          )}
      {field('rir', t('gym.mobile.field.rir'), 'number-pad')}
      {rir === '0' ? (
        <StatusMessage level="warning">{t('gym.mobile.toFailure')}</StatusMessage>
      ) : null}
      <Button
        label={t('gym.mobile.log', { number })}
        busy={busy}
        onPress={() => {
          void log();
        }}
      />
      {outcome === 'logged' ? (
        <StatusMessage level="ok">{t('gym.mobile.logged')}</StatusMessage>
      ) : outcome === 'failed' ? (
        <StatusMessage level="critical">{t('gym.mobile.logFailed')}</StatusMessage>
      ) : null}
    </Card>
  );
}

export function GymScreen({
  moduleOn,
  allowed,
  state,
  offline,
  sync,
  programId,
  dayKey,
  onPickProgram,
  onPickDay,
  onLog,
}: {
  /** Whether the club has the `gym` module on (issue #215): off, nothing is read or logged. */
  readonly moduleOn: boolean;
  readonly allowed: boolean;
  readonly state: GymLoadState;
  readonly offline: boolean;
  readonly sync?: ReactNode;
  readonly programId: string | null;
  readonly dayKey: string | null;
  readonly onPickProgram: (programId: string) => void;
  readonly onPickDay: (dayKey: string) => void;
  /** Queues the set; answers whether it was stored on the phone. */
  readonly onLog: (
    program: GymProgram,
    dayKey: string,
    exerciseCode: string,
    setNumber: number,
    set: ParsedSet,
  ) => Promise<LogOutcome>;
}) {
  const translator = useTranslator();
  const { t } = translator;
  const header = (
    <>
      <AppText role="title" accessibilityRole="header">
        {t('gym.mobile.title')}
      </AppText>
      {offline ? <StatusMessage level="warning">{t('sync.offline')}</StatusMessage> : null}
      {sync}
    </>
  );
  if (!moduleOn) {
    return (
      <ScreenBody>
        <AppText role="title" accessibilityRole="header">
          {t('gym.mobile.title')}
        </AppText>
        <StatusMessage level="warning">{t('gym.mobile.moduleOff')}</StatusMessage>
      </ScreenBody>
    );
  }
  if (!allowed) {
    return (
      <ScreenBody>
        {header}
        <StatusMessage level="warning">{t('gym.mobile.staffOnWeb')}</StatusMessage>
      </ScreenBody>
    );
  }
  if (state.status === 'loading') return <LoadingView label={t('gym.mobile.loading')} />;
  if (state.status === 'error') {
    return (
      <ScreenBody>
        {header}
        <StatusMessage level="critical">{t('gym.mobile.loadError')}</StatusMessage>
      </ScreenBody>
    );
  }
  const { programs, sets, best } = state.data;
  const program = programs.find((p) => p.id === programId) ?? programs[0];
  const day = program?.plan.days.find((d) => d.key === dayKey) ?? program?.plan.days[0];
  return (
    <ScreenBody>
      {header}
      {program === undefined || day === undefined ? (
        <StatusMessage level="warning">{t('gym.mobile.noProgram')}</StatusMessage>
      ) : (
        <>
          <Card>
            <AppText tone="secondary">{t('gym.mobile.program')}</AppText>
            <AppText role="heading">{program.name}</AppText>
            {programs.length > 1
              ? programs
                  .filter((p) => p.id !== program.id)
                  .map((p) => (
                    <Button
                      key={p.id}
                      variant="secondary"
                      label={t('gym.mobile.pickProgram', { name: p.name })}
                      onPress={() => {
                        onPickProgram(p.id);
                      }}
                    />
                  ))
              : null}
            <AppText tone="secondary">{t('gym.mobile.day')}</AppText>
            <AppText role="heading">{day.name}</AppText>
            {program.plan.days
              .filter((d) => d.key !== day.key)
              .map((d) => (
                <Button
                  key={d.key}
                  variant="secondary"
                  label={t('gym.mobile.pickDay', { name: d.name })}
                  onPress={() => {
                    onPickDay(d.key);
                  }}
                />
              ))}
          </Card>
          {day.exercises.map((exercise) => (
            <ExerciseCard
              // A new day or program starts the forms over.
              key={`${program.id}:${day.key}:${exercise.exerciseCode}`}
              exercise={exercise}
              sets={sets}
              onLog={(exerciseCode, setNumber, set) =>
                onLog(program, day.key, exerciseCode, setNumber, set)
              }
            />
          ))}
        </>
      )}
      <Card>
        <AppText role="heading" accessibilityRole="header">
          {t('gym.mobile.best.title')}
        </AppText>
        {best.length === 0 ? (
          <AppText tone="muted">{t('gym.mobile.best.none')}</AppText>
        ) : (
          best.map((summary) => (
            <AppText key={summary.exerciseCode}>
              {t('gym.mobile.best.row', {
                exercise: exerciseName(summary.exerciseCode, null, translator),
                value: formatUnit(summary.bestE1rmKg, 'kg', { decimals: 1 }),
                date: summary.bestOn === null ? '' : formatLocalDate(summary.bestOn),
              })}
            </AppText>
          ))
        )}
      </Card>
    </ScreenBody>
  );
}
