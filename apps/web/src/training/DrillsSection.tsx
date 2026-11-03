import { TRAINING_TEXT_MAX_LENGTH, type Drill } from '@sport-performance/contracts';
import {
  CONTACT_LEVELS,
  MAX_SESSION_DURATION_MIN,
  type ContactLevel,
} from '@sport-performance/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, TextField } from '../ui/components';
import { SelectField } from '../ui/fields';
import { Icon } from '../ui/icons';
import { trainingKey } from './queries';
import { parseMinutes } from './session-form';

/**
 * The plan of a session (B-407): its drills in order, with their contact
 * level. The caller who manages the session adds, edits, reorders and
 * removes them (the plan is the one table where rows are deleted, ADR 0032).
 */

interface DrillValues {
  name: string;
  durationMin: string;
  contactLevel: ContactLevel;
}

const EMPTY: DrillValues = { name: '', durationMin: '', contactLevel: 'none' };

function valuesOf(drill: Drill): DrillValues {
  return {
    name: drill.name,
    durationMin: drill.durationMin === null ? '' : String(drill.durationMin),
    contactLevel: drill.contactLevel,
  };
}

function DrillForm(props: {
  initial: DrillValues;
  submitLabel: string;
  pending: boolean;
  onSubmit: (values: {
    name: string;
    durationMin: number | null;
    contactLevel: ContactLevel;
  }) => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const [values, setValues] = useState(props.initial);
  const [errors, setErrors] = useState<{ name?: boolean; durationMin?: boolean }>({});

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = values.name.trim();
    const durationMin = parseMinutes(values.durationMin);
    const next = { name: name === '', durationMin: durationMin === 'invalid' };
    setErrors(next);
    if (next.name || durationMin === 'invalid') return;
    props.onSubmit({ name, durationMin, contactLevel: values.contactLevel });
  };

  return (
    <form className="sp-form sp-form--inline" onSubmit={submit} noValidate>
      <div className="sp-form__row">
        <TextField
          label={t('training.drill.name')}
          maxLength={TRAINING_TEXT_MAX_LENGTH}
          value={values.name}
          error={errors.name === true ? t('training.form.error.required') : null}
          onChange={(event) => {
            setValues({ ...values, name: event.target.value });
          }}
        />
        <TextField
          label={t('training.drill.duration')}
          inputMode="numeric"
          value={values.durationMin}
          error={
            errors.durationMin === true
              ? t('training.form.error.duration', { max: MAX_SESSION_DURATION_MIN })
              : null
          }
          onChange={(event) => {
            setValues({ ...values, durationMin: event.target.value });
          }}
        />
        <SelectField
          label={t('training.drill.contactLevel')}
          value={values.contactLevel}
          options={CONTACT_LEVELS.map((level) => ({
            value: level,
            label: t(`training.contact.${level}`),
          }))}
          onChange={(event) => {
            setValues({ ...values, contactLevel: event.target.value as ContactLevel });
          }}
        />
      </div>
      <div className="sp-form__actions">
        <Button type="submit" variant="secondary" disabled={props.pending}>
          {props.submitLabel}
        </Button>
        {props.onCancel === undefined ? null : (
          <Button variant="ghost" onClick={props.onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

export function DrillsSection(props: {
  trainingSessionId: string;
  drills: readonly Drill[];
  editable: boolean;
}) {
  const t = useT();
  const { api, selection } = useServices();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [addKey, setAddKey] = useState(() => crypto.randomUUID());
  const drills = [...props.drills].sort((a, b) => a.sortOrder - b.sortOrder);
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: trainingKey(selection.get(), 'session', props.trainingSessionId),
    });

  const add = useMutation({
    mutationFn: (values: {
      name: string;
      durationMin: number | null;
      contactLevel: ContactLevel;
    }) =>
      api.createDrill({
        params: { trainingSessionId: props.trainingSessionId },
        body: {
          clientUuid: addKey,
          name: values.name,
          contactLevel: values.contactLevel,
          ...(values.durationMin === null ? {} : { durationMin: values.durationMin }),
        },
      }),
    onSuccess: async () => {
      setAddKey(crypto.randomUUID());
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: async (
      changes: readonly {
        drill: Drill;
        body: Partial<{
          name: string;
          durationMin: number | null;
          contactLevel: ContactLevel;
          sortOrder: number;
        }>;
      }[],
    ) => {
      for (const change of changes) {
        await api.updateDrill({
          params: { drillId: change.drill.id },
          body: { version: change.drill.version, ...change.body },
        });
      }
    },
    onSuccess: () => {
      setEditing(null);
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (drill: Drill) => api.deleteDrill({ params: { drillId: drill.id } }),
    onSuccess: () => {
      setConfirming(null);
    },
    onSettled: refresh,
  });

  const move = (index: number, offset: -1 | 1) => {
    const order = [...drills];
    const [moved] = order.splice(index, 1);
    if (moved === undefined) return;
    order.splice(index + offset, 0, moved);
    const other = drills[index + offset];
    if (other === undefined) return;
    // Swapping two distinct positions is two edits; equal positions renumber the plan.
    const changes =
      moved.sortOrder !== other.sortOrder
        ? [
            { drill: moved, body: { sortOrder: other.sortOrder } },
            { drill: other, body: { sortOrder: moved.sortOrder } },
          ]
        : order.flatMap((drill, position) =>
            drill.sortOrder === position ? [] : [{ drill, body: { sortOrder: position } }],
          );
    update.mutate(changes);
  };

  const totalMin = drills.reduce((sum, drill) => sum + (drill.durationMin ?? 0), 0);
  const error = add.error ?? update.error ?? remove.error;

  return (
    <section className="sp-card" aria-labelledby="drills-title">
      <h2 id="drills-title" className="sp-card__title">
        {t('training.drills.title')}
      </h2>
      {drills.length === 0 ? (
        <p>{t('training.drills.empty')}</p>
      ) : (
        <ol className="sp-drill-list">
          {drills.map((drill, index) => {
            const name = drill.name;
            return (
              <li key={drill.id} className="sp-drill">
                {editing === drill.id ? (
                  <DrillForm
                    initial={valuesOf(drill)}
                    submitLabel={t('common.save')}
                    pending={update.isPending}
                    onSubmit={(values) => {
                      update.mutate([{ drill, body: values }]);
                    }}
                    onCancel={() => {
                      setEditing(null);
                    }}
                  />
                ) : (
                  <>
                    <div className="sp-drill__body">
                      <span className="sp-drill__name">{name}</span>
                      <span className="sp-drill__meta">
                        {drill.durationMin === null
                          ? null
                          : t('training.session.minutes', { minutes: drill.durationMin })}
                        {drill.durationMin === null ? null : ' · '}
                        {t(`training.contact.${drill.contactLevel}`)}
                      </span>
                    </div>
                    {props.editable ? (
                      <div className="sp-drill__actions">
                        <Button
                          variant="ghost"
                          aria-label={t('training.drill.moveUp', { name })}
                          disabled={index === 0 || update.isPending}
                          onClick={() => {
                            move(index, -1);
                          }}
                        >
                          <Icon name="arrowUp" />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={t('training.drill.moveDown', { name })}
                          disabled={index === drills.length - 1 || update.isPending}
                          onClick={() => {
                            move(index, 1);
                          }}
                        >
                          <Icon name="arrowDown" />
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={t('training.drill.edit', { name })}
                          onClick={() => {
                            setEditing(drill.id);
                          }}
                        >
                          {t('common.edit')}
                        </Button>
                        {confirming === drill.id ? (
                          <Button
                            variant="secondary"
                            disabled={remove.isPending}
                            onClick={() => {
                              remove.mutate(drill);
                            }}
                          >
                            {t('training.drill.removeConfirm', { name })}
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            aria-label={t('training.drill.remove', { name })}
                            onClick={() => {
                              setConfirming(drill.id);
                            }}
                          >
                            <Icon name="trash" />
                          </Button>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {totalMin > 0 ? <p>{t('training.drills.total', { minutes: totalMin })}</p> : null}
      {error === null ? null : <ErrorNotice error={error} />}
      {props.editable ? (
        <DrillForm
          key={addKey}
          initial={EMPTY}
          submitLabel={t('training.drill.add')}
          pending={add.isPending}
          onSubmit={(values) => {
            add.mutate(values);
          }}
        />
      ) : null}
    </section>
  );
}
