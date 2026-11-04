import {
  CONTACT_LEVELS,
  MAX_SESSION_DURATION_MIN,
  localDateInTimeZone,
  sportRecordsContacts,
  type ContactLevel,
} from '@sport-performance/domain';
import { TRAINING_TEXT_MAX_LENGTH } from '@sport-performance/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useScope } from '../club/use-scope';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Notice, Page, TextField } from '../ui/components';
import { SelectField } from '../ui/fields';
import { Icon } from '../ui/icons';
import { manageableCategories } from './permissions';
import { trainingKey } from './queries';
import { SessionFields, fieldErrorText } from './SessionFields';
import {
  apiFieldErrors,
  createBody,
  emptySessionForm,
  parseDrills,
  parseSessionForm,
  type DrillDraft,
  type DrillErrors,
  type SessionFormErrors,
} from './session-form';

function newDrill(): DrillDraft {
  return { key: crypto.randomUUID(), name: '', durationMin: '', contactLevel: 'none' };
}

/**
 * Create a session or a match (B-407): only in the categories the caller
 * may manage (`training_session.manage`), the start typed in the club's
 * time zone, the drills in the same create. Idempotent by `clientUuid`.
 */
export function NewSessionPage() {
  const t = useT();
  const { api, selection } = useServices();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const active = useActiveClub();
  const scope = useScope();
  const timeZone = active.club.timeZone;
  const categories = manageableCategories(active);
  const preselected =
    categories.find((category) => category.id === scope.category?.id) ??
    (categories.length === 1 ? categories[0] : undefined);

  const [values, setValues] = useState(() =>
    emptySessionForm({
      categoryId: preselected?.id ?? '',
      date: localDateInTimeZone(new Date(), timeZone),
    }),
  );
  const [drills, setDrills] = useState<DrillDraft[]>([]);
  const [errors, setErrors] = useState<SessionFormErrors>({});
  const [drillErrors, setDrillErrors] = useState<DrillErrors>(new Map());
  const [clientUuid] = useState(() => crypto.randomUUID());

  const create = useMutation({
    mutationFn: (body: ReturnType<typeof createBody>) => api.createTrainingSession({ body }),
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: trainingKey(selection.get()) });
      await navigate({
        to: '/sessions/$trainingSessionId',
        params: { trainingSessionId: session.id },
      });
    },
    onError: (error) => {
      setErrors(apiFieldErrors(error));
    },
  });

  if (categories.length === 0) {
    return (
      <Page title={t('training.new.title')}>
        <Notice level="warning" role="alert">
          <p>{t('training.form.noCategories')}</p>
        </Notice>
      </Page>
    );
  }

  const selectedSport = categories.find((category) => category.id === values.categoryId)?.sport;
  // The contact level of a drill only exists in sports with contacts (B-803).
  const contacts = selectedSport === undefined || sportRecordsContacts(selectedSport);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const session = parseSessionForm(values, timeZone);
    const parsedDrills = parseDrills(drills, contacts);
    setErrors(session.ok ? {} : session.errors);
    setDrillErrors(parsedDrills.ok ? new Map() : parsedDrills.errors);
    if (!session.ok || !parsedDrills.ok) return;
    create.mutate(createBody(session.session, parsedDrills.drills, clientUuid));
  };

  const setDrill = (key: string, change: Partial<DrillDraft>) => {
    setDrills((current) =>
      current.map((drill) => (drill.key === key ? { ...drill, ...change } : drill)),
    );
  };

  return (
    <Page title={t('training.new.title')} subtitle={t('training.new.subtitle')}>
      <p>
        <Link to="/sessions">{t('training.detail.back')}</Link>
      </p>
      <form className="sp-form" aria-label={t('training.new.title')} onSubmit={submit} noValidate>
        <SessionFields
          values={values}
          errors={errors}
          categories={categories}
          timeZone={timeZone}
          onChange={setValues}
        />

        <fieldset className="sp-fieldset">
          <legend className="sp-card__title">{t('training.drills.title')}</legend>
          <p className="sp-field__help">{t('training.new.drillsHelp')}</p>
          {drills.map((drill, index) => {
            const rowErrors = drillErrors.get(drill.key) ?? {};
            const name = drill.name.trim() === '' ? t('training.drill.untitled') : drill.name;
            return (
              <fieldset key={drill.key} className="sp-fieldset sp-fieldset--nested">
                <legend>{t('training.drill.legend', { number: index + 1 })}</legend>
                <div className="sp-form__row">
                  <TextField
                    label={t('training.drill.name')}
                    maxLength={TRAINING_TEXT_MAX_LENGTH}
                    value={drill.name}
                    error={fieldErrorText(t, rowErrors.name)}
                    onChange={(event) => {
                      setDrill(drill.key, { name: event.target.value });
                    }}
                  />
                  <TextField
                    label={t('training.drill.duration')}
                    inputMode="numeric"
                    value={drill.durationMin}
                    error={
                      rowErrors.durationMin === undefined
                        ? null
                        : t('training.form.error.duration', { max: MAX_SESSION_DURATION_MIN })
                    }
                    onChange={(event) => {
                      setDrill(drill.key, { durationMin: event.target.value });
                    }}
                  />
                  {contacts ? (
                    <SelectField
                      label={t('training.drill.contactLevel')}
                      value={drill.contactLevel}
                      options={CONTACT_LEVELS.map((level) => ({
                        value: level,
                        label: t(`training.contact.${level}`),
                      }))}
                      onChange={(event) => {
                        setDrill(drill.key, { contactLevel: event.target.value as ContactLevel });
                      }}
                    />
                  ) : null}
                </div>
                <div>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDrills((current) => current.filter((item) => item.key !== drill.key));
                    }}
                  >
                    <Icon name="trash" />
                    <span>{t('training.drill.remove', { name })}</span>
                  </Button>
                </div>
              </fieldset>
            );
          })}
          <div>
            <Button
              variant="secondary"
              onClick={() => {
                setDrills((current) => [...current, newDrill()]);
              }}
            >
              <Icon name="plus" />
              <span>{t('training.drill.add')}</span>
            </Button>
          </div>
        </fieldset>

        {create.isError ? <ErrorNotice error={create.error} /> : null}
        <div>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? t('common.loading') : t('training.new.submit')}
          </Button>
        </div>
      </form>
    </Page>
  );
}
