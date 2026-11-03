import type { Category } from '@sport-performance/contracts';
import { MAX_SESSION_DURATION_MIN, type TimeZone } from '@sport-performance/domain';
import type { Translator } from '@sport-performance/i18n';
import { TRAINING_NOTES_MAX_LENGTH, TRAINING_TEXT_MAX_LENGTH } from '@sport-performance/contracts';
import { useT } from '../i18n/i18n';
import { TextField } from '../ui/components';
import { SelectField, TextAreaField } from '../ui/fields';
import type {
  FieldError,
  SessionField,
  SessionFormErrors,
  SessionFormValues,
} from './session-form';

export function fieldErrorText(t: Translator['t'], error: FieldError | undefined): string | null {
  switch (error) {
    case undefined:
      return null;
    case 'required':
      return t('training.form.error.required');
    case 'start':
      return t('training.form.error.start');
    case 'duration':
      return t('training.form.error.duration', { max: MAX_SESSION_DURATION_MIN });
    case 'invalid':
      return t('training.form.error.invalid');
  }
}

/**
 * The fields of a session (create and edit): kind, category, the club's
 * day and time, planned duration, title, place, opponent (matches only)
 * and notes. Controlled: the page keeps the values and the errors.
 */
export function SessionFields(props: {
  values: SessionFormValues;
  errors: SessionFormErrors;
  categories: readonly Category[];
  timeZone: TimeZone;
  onChange: (values: SessionFormValues) => void;
}) {
  const t = useT();
  const { values, errors } = props;
  const set = <K extends SessionField>(field: K, value: SessionFormValues[K]) => {
    props.onChange({ ...values, [field]: value });
  };
  const error = (field: SessionField) => fieldErrorText(t, errors[field]);

  return (
    <>
      <div className="sp-form__row">
        <SelectField
          label={t('training.form.kind')}
          name="kind"
          value={values.kind}
          options={[
            { value: 'training', label: t('training.kind.training') },
            { value: 'match', label: t('training.kind.match') },
          ]}
          onChange={(event) => {
            set('kind', event.target.value === 'match' ? 'match' : 'training');
          }}
        />
        <SelectField
          label={t('training.form.category')}
          name="categoryId"
          required
          value={values.categoryId}
          error={error('categoryId')}
          options={[
            { value: '', label: t('training.form.categoryPick'), disabled: true },
            ...props.categories.map((category) => ({ value: category.id, label: category.name })),
          ]}
          onChange={(event) => {
            set('categoryId', event.target.value);
          }}
        />
      </div>
      <div className="sp-form__row">
        <TextField
          label={t('training.form.date')}
          name="date"
          type="date"
          required
          value={values.date}
          error={error('date')}
          onChange={(event) => {
            set('date', event.target.value);
          }}
        />
        <TextField
          label={t('training.form.time')}
          name="time"
          type="time"
          required
          help={t('training.form.timeHelp', { timeZone: props.timeZone })}
          value={values.time}
          error={error('time')}
          onChange={(event) => {
            set('time', event.target.value);
          }}
        />
        <TextField
          label={t('training.form.duration')}
          name="plannedDurationMin"
          inputMode="numeric"
          help={t('training.form.durationHelp')}
          value={values.plannedDurationMin}
          error={error('plannedDurationMin')}
          onChange={(event) => {
            set('plannedDurationMin', event.target.value);
          }}
        />
      </div>
      <TextField
        label={t('training.form.title')}
        name="title"
        maxLength={TRAINING_TEXT_MAX_LENGTH}
        help={t('training.form.titleHelp')}
        value={values.title}
        error={error('title')}
        onChange={(event) => {
          set('title', event.target.value);
        }}
      />
      <div className="sp-form__row">
        <TextField
          label={t('training.form.location')}
          name="location"
          maxLength={TRAINING_TEXT_MAX_LENGTH}
          value={values.location}
          error={error('location')}
          onChange={(event) => {
            set('location', event.target.value);
          }}
        />
        {values.kind === 'match' ? (
          <TextField
            label={t('training.form.opponent')}
            name="opponent"
            maxLength={TRAINING_TEXT_MAX_LENGTH}
            value={values.opponent}
            error={error('opponent')}
            onChange={(event) => {
              set('opponent', event.target.value);
            }}
          />
        ) : null}
      </div>
      <TextAreaField
        label={t('training.form.notes')}
        name="notes"
        rows={3}
        maxLength={TRAINING_NOTES_MAX_LENGTH}
        value={values.notes}
        error={error('notes')}
        onChange={(event) => {
          set('notes', event.target.value);
        }}
      />
    </>
  );
}
