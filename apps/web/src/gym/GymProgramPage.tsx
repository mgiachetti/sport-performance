import { ApiError, type GymProgram } from '@sport-performance/contracts';
import { GYM_LOAD_KINDS, STAGES, localDateInTimeZone } from '@sport-performance/domain';
import type { MessageKey } from '@sport-performance/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, Page, TextField } from '../ui/components';
import { FieldGroup, SelectField, TextAreaField } from '../ui/fields';
import { Icon } from '../ui/icons';
import {
  CUSTOM_EXERCISE,
  canManageProgram,
  emptyDay,
  emptyExercise,
  emptyProgramForm,
  issuePaths,
  libraryOptions,
  manageableGymCategories,
  planInput,
  programForm,
  withChoice,
  type DayForm,
  type ExerciseForm,
  type ProgramForm,
} from './model';
import { categoryPlayersQuery, gymKey, gymProgramQuery } from './queries';

function BackLink() {
  const t = useT();
  return (
    <Link to="/gym" className="sp-button sp-button--ghost">
      {t('gym.web.back')}
    </Link>
  );
}

/** New program (`/gym/new`). */
export function NewGymProgramPage() {
  const t = useT();
  const active = useActiveClub();
  const scope = useScope();
  const categories = manageableGymCategories(active);
  const today = localDateInTimeZone(new Date(), active.club.timeZone);
  const initialCategory =
    scope.category !== null && categories.some((c) => c.id === scope.category?.id)
      ? scope.category.id
      : (categories[0]?.id ?? '');
  if (categories.length === 0) {
    return (
      <Page title={t('gym.web.new.title')} actions={<BackLink />}>
        <Notice level="warning" role="alert">
          <p>{t('error.forbidden')}</p>
        </Notice>
      </Page>
    );
  }
  return (
    <Page
      title={t('gym.web.new.title')}
      subtitle={t('gym.web.form.subtitle')}
      actions={<BackLink />}
    >
      <ProgramEditor initial={emptyProgramForm(initialCategory, today)} program={null} />
    </Page>
  );
}

/** An existing program (`/gym/$gymProgramId`): editable by who manages it, else read only. */
export function GymProgramPage() {
  const t = useT();
  const { api, selection } = useServices();
  const { gymProgramId } = useParams({ from: '/_authed/_club/gym/$gymProgramId' });
  const query = useQuery(gymProgramQuery(api, selection.get(), gymProgramId));
  if (query.isPending) {
    return (
      <Page title={t('gym.web.edit.title')} actions={<BackLink />}>
        <Loading />
      </Page>
    );
  }
  if (query.error !== null) {
    return (
      <Page title={t('gym.web.edit.title')} actions={<BackLink />}>
        {query.error instanceof ApiError && query.error.status === 404 ? (
          <Notice level="info">
            <p>{t('gym.web.notFound')}</p>
          </Notice>
        ) : (
          <ErrorNotice error={query.error} />
        )}
      </Page>
    );
  }
  return (
    <Page title={query.data.name} subtitle={t('gym.web.form.subtitle')} actions={<BackLink />}>
      <ProgramEditor
        key={query.data.version}
        initial={programForm(query.data)}
        program={query.data}
      />
    </Page>
  );
}

function ProgramEditor(props: { initial: ProgramForm; program: GymProgram | null }) {
  const t = useT();
  const { api, selection } = useServices();
  const active = useActiveClub();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState<ProgramForm>(props.initial);
  const [playerId, setPlayerId] = useState<string>(props.program?.playerId ?? '');
  const [clientUuid] = useState(() => crypto.randomUUID());
  const [localIssues, setLocalIssues] = useState<Map<string, string>>(new Map());
  const editable = props.program === null || canManageProgram(active, props.program);
  const categories = manageableGymCategories(active);
  const players = useQuery({
    ...categoryPlayersQuery(api, selection.get(), form.categoryId),
    enabled: props.program === null && form.categoryId !== '',
  });

  const save = useMutation({
    mutationFn: async (plan: Parameters<typeof api.createGymProgram>[0]['body']['plan']) => {
      const common = {
        name: form.name.trim(),
        plan,
        notes: form.notes.trim() === '' ? null : form.notes.trim(),
        validFrom: form.validFrom as never,
        validTo: form.validTo === '' ? null : (form.validTo as never),
      };
      if (props.program === null) {
        const forPlayer = playerId !== '';
        return api.createGymProgram({
          body: {
            clientUuid,
            ...common,
            ...(forPlayer
              ? { playerId: playerId }
              : {
                  categoryId: form.categoryId,
                  stage: form.stage === '' ? null : form.stage,
                }),
          },
        });
      }
      return api.updateGymProgram({
        params: { gymProgramId: props.program.id },
        body: {
          version: props.program.version,
          ...common,
          ...(props.program.categoryId === null
            ? {}
            : { stage: form.stage === '' ? null : form.stage }),
        },
      });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: gymKey(selection.get()) });
      if (props.program === null) {
        await navigate({ to: '/gym/$gymProgramId', params: { gymProgramId: saved.id } });
      }
    },
  });

  const serverIssues = save.error instanceof ApiError ? issuePaths(save.error.details) : new Map();
  const errorAt = (path: string): string | null =>
    localIssues.get(path) ?? (serverIssues.get(path) as string | undefined) ?? null;

  const submit = () => {
    const local = new Map<string, string>();
    if (form.name.trim() === '') local.set('name', t('gym.web.error.required'));
    const parsed = planInput(form);
    if ('issues' in parsed) {
      for (const issue of parsed.issues) {
        local.set(issue.path, t(`gym.web.error.${issue.code}` as MessageKey));
      }
    }
    setLocalIssues(local);
    if (local.size > 0 || 'issues' in parsed) return;
    save.mutate(parsed.plan);
  };

  const setDay = (index: number, day: DayForm) => {
    setForm({ ...form, days: form.days.map((d, i) => (i === index ? day : d)) });
  };

  return (
    <form
      className="sp-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {!editable ? (
        <Notice level="info">
          <p>{t('gym.web.readOnly')}</p>
        </Notice>
      ) : null}
      <fieldset className="sp-form__grid" disabled={!editable}>
        <TextField
          label={t('gym.web.field.name')}
          value={form.name}
          maxLength={80}
          error={errorAt('name')}
          onChange={(event) => {
            setForm({ ...form, name: event.target.value });
          }}
        />
        {props.program === null ? (
          <>
            <SelectField
              label={t('gym.web.field.category')}
              value={form.categoryId}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              onChange={(event) => {
                setForm({ ...form, categoryId: event.target.value });
                setPlayerId('');
              }}
            />
            <SelectField
              label={t('gym.web.field.player')}
              help={t('gym.web.field.player.help')}
              value={playerId}
              error={errorAt('playerId')}
              options={[
                { value: '', label: t('gym.web.field.player.all') },
                ...(players.data ?? []).map((p) => ({
                  value: p.id,
                  label: `${p.lastName}, ${p.firstName}`,
                })),
              ]}
              onChange={(event) => {
                setPlayerId(event.target.value);
              }}
            />
          </>
        ) : null}
        {playerId === '' && props.program?.categoryId !== null ? (
          <SelectField
            label={t('gym.web.field.stage')}
            help={t('gym.web.field.stage.help')}
            value={form.stage}
            error={errorAt('stage')}
            options={[
              { value: '', label: t('gym.web.field.stage.all') },
              ...STAGES.map((stage) => ({ value: stage, label: t(`gym.web.stage.${stage}`) })),
            ]}
            onChange={(event) => {
              const value = event.target.value;
              setForm({ ...form, stage: STAGES.find((s) => s === value) ?? '' });
            }}
          />
        ) : null}
        <TextField
          type="date"
          label={t('gym.web.field.validFrom')}
          value={form.validFrom}
          error={errorAt('validFrom')}
          onChange={(event) => {
            setForm({ ...form, validFrom: event.target.value });
          }}
        />
        <TextField
          type="date"
          label={t('gym.web.field.validTo')}
          help={t('gym.web.field.validTo.help')}
          value={form.validTo}
          error={errorAt('validTo')}
          onChange={(event) => {
            setForm({ ...form, validTo: event.target.value });
          }}
        />
        <TextAreaField
          label={t('gym.web.field.notes')}
          value={form.notes}
          maxLength={500}
          onChange={(event) => {
            setForm({ ...form, notes: event.target.value });
          }}
        />
      </fieldset>
      {form.days.map((day, index) => (
        <DayEditor
          key={day.key}
          day={day}
          index={index}
          editable={editable}
          errorAt={errorAt}
          canRemove={form.days.length > 1}
          onChange={(next) => {
            setDay(index, next);
          }}
          onRemove={() => {
            setForm({ ...form, days: form.days.filter((_, i) => i !== index) });
          }}
        />
      ))}
      {editable ? (
        <div className="sp-form__actions">
          <Button
            variant="secondary"
            disabled={form.days.length >= 7}
            onClick={() => {
              setForm({ ...form, days: [...form.days, emptyDay(nextDayIndex(form.days))] });
            }}
          >
            <Icon name="plus" />
            <span>{t('gym.web.day.add')}</span>
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      ) : null}
      {save.error !== null && serverIssues.size === 0 ? <ErrorNotice error={save.error} /> : null}
      {save.error !== null && serverIssues.size > 0 ? (
        <Notice level="critical" role="alert">
          <p>{t('gym.web.error.stage')}</p>
        </Notice>
      ) : null}
      {save.isSuccess && props.program !== null ? (
        <Notice level="ok" role="status">
          <p>{t('gym.web.saved')}</p>
        </Notice>
      ) : null}
    </form>
  );
}

/** The next free day key: after the last one used. */
function nextDayIndex(days: readonly DayForm[]): number {
  const used = days.map((day) => day.key.charCodeAt(0) - 97).filter((i) => i >= 0 && i < 26);
  return used.length === 0 ? 0 : Math.max(...used) + 1;
}

function DayEditor(props: {
  day: DayForm;
  index: number;
  editable: boolean;
  canRemove: boolean;
  errorAt: (path: string) => string | null;
  onChange: (day: DayForm) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { day, index } = props;
  const base = `plan.days.${String(index)}`;
  const setExercise = (e: number, exercise: ExerciseForm) => {
    props.onChange({
      ...day,
      exercises: day.exercises.map((x, i) => (i === e ? exercise : x)),
    });
  };
  return (
    <section className="sp-card" aria-label={t('gym.web.day.label', { number: index + 1 })}>
      <fieldset className="sp-form__grid" disabled={!props.editable}>
        <TextField
          label={t('gym.web.day.name', { number: index + 1 })}
          value={day.name}
          maxLength={80}
          error={props.errorAt(`${base}.name`)}
          onChange={(event) => {
            props.onChange({ ...day, name: event.target.value });
          }}
        />
        {day.exercises.map((exercise, e) => (
          <ExerciseEditor
            key={exercise.key}
            exercise={exercise}
            path={`${base}.exercises.${String(e)}`}
            number={e + 1}
            errorAt={props.errorAt}
            canRemove={day.exercises.length > 1}
            onChange={(next) => {
              setExercise(e, next);
            }}
            onRemove={() => {
              props.onChange({ ...day, exercises: day.exercises.filter((_, i) => i !== e) });
            }}
          />
        ))}
      </fieldset>
      {props.editable ? (
        <div className="sp-form__actions">
          <Button
            variant="secondary"
            disabled={day.exercises.length >= 20}
            onClick={() => {
              props.onChange({ ...day, exercises: [...day.exercises, emptyExercise()] });
            }}
          >
            <Icon name="plus" />
            <span>{t('gym.web.exercise.add')}</span>
          </Button>
          {props.canRemove ? (
            <Button variant="ghost" onClick={props.onRemove}>
              <Icon name="trash" />
              <span>{t('gym.web.day.remove', { number: index + 1 })}</span>
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ExerciseEditor(props: {
  exercise: ExerciseForm;
  path: string;
  number: number;
  canRemove: boolean;
  errorAt: (path: string) => string | null;
  onChange: (exercise: ExerciseForm) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { exercise, path } = props;
  const custom = exercise.choice === CUSTOM_EXERCISE;
  const loaded = exercise.loadKind !== 'bodyweight';
  const field = (name: keyof ExerciseForm, labelKey: MessageKey, inputMode = 'numeric') => (
    <TextField
      label={t(labelKey)}
      value={exercise[name]}
      inputMode={inputMode as 'numeric'}
      error={props.errorAt(`${path}.${name}`)}
      onChange={(event) => {
        props.onChange({ ...exercise, [name]: event.target.value });
      }}
    />
  );
  return (
    <FieldGroup
      legend={t('gym.web.exercise.label', { number: props.number })}
      error={props.errorAt(`${path}.exerciseCode`)}
    >
      <SelectField
        label={t('gym.web.exercise.choice')}
        value={exercise.choice}
        options={[
          ...libraryOptions().map((o) => ({ value: o.code, label: t(o.labelKey) })),
          { value: CUSTOM_EXERCISE, label: t('gym.web.exercise.custom') },
        ]}
        onChange={(event) => {
          props.onChange(withChoice(exercise, event.target.value));
        }}
      />
      {custom ? (
        <>
          <TextField
            label={t('gym.web.exercise.code')}
            help={t('gym.web.exercise.code.help')}
            value={exercise.customCode}
            onChange={(event) => {
              props.onChange({ ...exercise, customCode: event.target.value });
            }}
          />
          <TextField
            label={t('gym.web.exercise.name')}
            value={exercise.customName}
            error={props.errorAt(`${path}.name`)}
            onChange={(event) => {
              props.onChange({ ...exercise, customName: event.target.value });
            }}
          />
          <SelectField
            label={t('gym.web.exercise.loadKind')}
            value={exercise.loadKind}
            error={props.errorAt(`${path}.loadKind`)}
            options={GYM_LOAD_KINDS.map((kind) => ({
              value: kind,
              label: t(`gym.loadKind.${kind}`),
            }))}
            onChange={(event) => {
              const kind = GYM_LOAD_KINDS.find((k) => k === event.target.value) ?? 'bodyweight';
              props.onChange({ ...exercise, loadKind: kind });
            }}
          />
          <SelectField
            label={t('gym.web.exercise.measure')}
            value={exercise.measure}
            options={[
              { value: 'reps', label: t('gym.measure.reps') },
              { value: 'duration', label: t('gym.measure.duration') },
            ]}
            onChange={(event) => {
              props.onChange({
                ...exercise,
                measure: event.target.value === 'duration' ? 'duration' : 'reps',
              });
            }}
          />
        </>
      ) : null}
      {props.errorAt(`${path}.loadKind`) !== null && !custom ? (
        <Notice level="critical">
          <p>{props.errorAt(`${path}.loadKind`)}</p>
        </Notice>
      ) : null}
      {field('sets', 'gym.web.exercise.sets')}
      {exercise.measure === 'reps' ? (
        <>
          {field('repsMin', 'gym.web.exercise.repsMin')}
          {field('repsMax', 'gym.web.exercise.repsMax')}
        </>
      ) : (
        field('durationS', 'gym.web.exercise.durationS')
      )}
      {field('targetRir', 'gym.web.exercise.targetRir')}
      {loaded ? field('loadKg', 'gym.web.exercise.loadKg', 'decimal') : null}
      {field('restS', 'gym.web.exercise.restS')}
      <TextField
        label={t('gym.web.exercise.notes')}
        value={exercise.notes}
        maxLength={500}
        onChange={(event) => {
          props.onChange({ ...exercise, notes: event.target.value });
        }}
      />
      {props.canRemove ? (
        <Button variant="ghost" onClick={props.onRemove}>
          <Icon name="trash" />
          <span>{t('gym.web.exercise.remove', { number: props.number })}</span>
        </Button>
      ) : null}
    </FieldGroup>
  );
}
