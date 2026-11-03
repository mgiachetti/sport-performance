import {
  CALENDAR_NOTES_MAX_LENGTH,
  CALENDAR_TEXT_MAX_LENGTH,
  type Category,
  type Fixture,
} from '@sport-performance/contracts';
import {
  FIXTURE_STATUSES,
  FIXTURE_VENUES,
  isLocalTime,
  type CategoryId,
  type FixtureStatus,
  type FixtureVenue,
  type LocalDate,
} from '@sport-performance/domain';
import { formatLocalDate } from '@sport-performance/i18n';
import { useMutation } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useT } from '../i18n/i18n';
import { Button, Notice, TextField } from '../ui/components';
import { SelectField, TextAreaField } from '../ui/fields';
import { dateInput, optionalText } from './model';
import { FixtureStatusLabel, useCategoryName } from './parts';
import { EditorFrame, SaveError, isConflict, useRefreshCalendar } from './shared';

interface Errors {
  readonly categoryId?: string;
  readonly opponent?: string;
  readonly date?: string;
  readonly kickoffTime?: string;
  readonly competition?: string;
  readonly location?: string;
  readonly notes?: string;
}

/**
 * A match of the fixture (B-317, B-406): the coach of the category and the
 * administration add it, edit it (postponing or suspending it is its status)
 * and archive one loaded by mistake. Day and kick-off are the club's wall
 * clock. Everyone else who sees the category reads it.
 */
export function FixtureEditor(props: {
  fixture: Fixture | null;
  /** Categories where the user may add matches (for a new one). */
  categories: readonly Category[];
  defaultCategoryId: CategoryId | null;
  defaultDate: LocalDate;
  canManage: boolean;
  /** Opened again on refetched data after a `409`: the explanation stays. */
  reloaded: boolean;
  /** A `409`: the parent reopens the editor on the refetched match. */
  onConflict: () => void;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { api } = useServices();
  const refresh = useRefreshCalendar();
  const categoryName = useCategoryName();
  const fixture = props.fixture;
  const [clientUuid] = useState(() => crypto.randomUUID());
  const [categoryId, setCategoryId] = useState<string>(
    fixture?.categoryId ?? props.defaultCategoryId ?? props.categories[0]?.id ?? '',
  );
  const [opponent, setOpponent] = useState(fixture?.opponent ?? '');
  const [venue, setVenue] = useState<FixtureVenue>(fixture?.venue ?? 'home');
  const [competition, setCompetition] = useState(fixture?.competition ?? '');
  const [date, setDate] = useState<string>(fixture?.date ?? props.defaultDate);
  const [kickoffTime, setKickoffTime] = useState(fixture?.kickoffTime ?? '');
  const [location, setLocation] = useState(fixture?.location ?? '');
  const [status, setStatus] = useState<FixtureStatus>(fixture?.status ?? 'scheduled');
  const [notes, setNotes] = useState(fixture?.notes ?? '');
  const [errors, setErrors] = useState<Errors>({});
  const [confirmingArchive, setConfirmingArchive] = useState(false);

  const save = useMutation({
    mutationFn: async (day: LocalDate) => {
      const values = {
        opponent: opponent.trim(),
        competition: optionalText(competition),
        date: day,
        kickoffTime: optionalText(kickoffTime),
        location: optionalText(location),
        notes: optionalText(notes),
      };
      if (fixture === null) {
        return api.createFixture({
          body: {
            clientUuid,
            categoryId,
            opponent: values.opponent,
            venue,
            date: values.date,
            status,
            ...(values.competition === null ? {} : { competition: values.competition }),
            ...(values.kickoffTime === null ? {} : { kickoffTime: values.kickoffTime }),
            ...(values.location === null ? {} : { location: values.location }),
            ...(values.notes === null ? {} : { notes: values.notes }),
          },
        });
      }
      return api.updateFixture({
        params: { fixtureId: fixture.id },
        body: {
          version: fixture.version,
          ...(values.opponent === fixture.opponent ? {} : { opponent: values.opponent }),
          ...(venue === fixture.venue ? {} : { venue }),
          ...(values.competition === fixture.competition
            ? {}
            : { competition: values.competition }),
          ...(values.date === fixture.date ? {} : { date: values.date }),
          ...(values.kickoffTime === fixture.kickoffTime
            ? {}
            : { kickoffTime: values.kickoffTime }),
          ...(values.location === fixture.location ? {} : { location: values.location }),
          ...(status === fixture.status ? {} : { status }),
          ...(values.notes === fixture.notes ? {} : { notes: values.notes }),
        },
      });
    },
    onSuccess: async () => {
      props.onDone(t('calendar.fixture.saved'));
      await refresh();
    },
    onError: async (error) => {
      if (!isConflict(error)) return;
      props.onConflict();
      await refresh();
    },
  });

  const archive = useMutation({
    mutationFn: (target: Fixture) => api.archiveFixture({ params: { fixtureId: target.id } }),
    onSuccess: async () => {
      props.onDone(t('calendar.fixture.archived'));
      await refresh();
    },
    onError: async (error) => {
      setConfirmingArchive(false);
      if (!isConflict(error)) return;
      props.onConflict();
      await refresh();
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    const tooLong = (value: string, max: number) => value.trim().length > max;
    if (categoryId === '') next.categoryId = t('calendar.field.required');
    if (opponent.trim() === '') next.opponent = t('calendar.field.required');
    else if (tooLong(opponent, CALENDAR_TEXT_MAX_LENGTH)) {
      next.opponent = t('calendar.field.tooLong', { max: CALENDAR_TEXT_MAX_LENGTH });
    }
    if (dateInput(date) === null) next.date = t('calendar.field.invalidDate');
    if (kickoffTime.trim() !== '' && !isLocalTime(kickoffTime.trim())) {
      next.kickoffTime = t('calendar.field.invalidTime');
    }
    if (tooLong(competition, CALENDAR_TEXT_MAX_LENGTH)) {
      next.competition = t('calendar.field.tooLong', { max: CALENDAR_TEXT_MAX_LENGTH });
    }
    if (tooLong(location, CALENDAR_TEXT_MAX_LENGTH)) {
      next.location = t('calendar.field.tooLong', { max: CALENDAR_TEXT_MAX_LENGTH });
    }
    if (tooLong(notes, CALENDAR_NOTES_MAX_LENGTH)) {
      next.notes = t('calendar.field.tooLong', { max: CALENDAR_NOTES_MAX_LENGTH });
    }
    setErrors(next);
    const day = dateInput(date);
    if (Object.keys(next).length === 0 && day !== null) save.mutate(day);
  };

  const title =
    fixture === null
      ? t('calendar.fixture.newTitle')
      : t('calendar.fixture.title', { category: categoryName(fixture.categoryId) });
  const busy = save.isPending || archive.isPending;

  if (fixture !== null && !props.canManage) {
    return (
      <EditorFrame id="calendar-editor-fixture" title={title} onClose={props.onClose}>
        <p>
          <FixtureStatusLabel status={fixture.status} />
        </p>
        <Notice level="info">
          <p>{t('calendar.editor.readOnly')}</p>
        </Notice>
        <dl className="sp-cal__details">
          <dt>{t('calendar.fixture.opponent')}</dt>
          <dd>{fixture.opponent}</dd>
          <dt>{t('calendar.fixture.venue')}</dt>
          <dd>{t(`calendar.fixture.venue.${fixture.venue}`)}</dd>
          <dt>{t('calendar.fixture.competition')}</dt>
          <dd>{fixture.competition ?? '—'}</dd>
          <dt>{t('calendar.fixture.date')}</dt>
          <dd>{formatLocalDate(fixture.date)}</dd>
          <dt>{t('calendar.fixture.kickoff')}</dt>
          <dd>{fixture.kickoffTime ?? t('calendar.event.noTime')}</dd>
          <dt>{t('calendar.fixture.location')}</dt>
          <dd>{fixture.location ?? '—'}</dd>
          <dt>{t('calendar.fixture.notes')}</dt>
          <dd>{fixture.notes ?? '—'}</dd>
        </dl>
      </EditorFrame>
    );
  }

  return (
    <EditorFrame id="calendar-editor-fixture" title={title} onClose={props.onClose}>
      <form className="sp-form" noValidate onSubmit={submit}>
        {fixture === null ? (
          <SelectField
            label={t('calendar.fixture.category')}
            value={categoryId}
            error={errors.categoryId}
            options={props.categories.map((category) => ({
              value: category.id,
              label: category.name,
            }))}
            onChange={(event) => {
              setCategoryId(event.target.value);
            }}
          />
        ) : null}
        <div className="sp-form__row">
          <TextField
            label={t('calendar.fixture.opponent')}
            required
            value={opponent}
            maxLength={CALENDAR_TEXT_MAX_LENGTH}
            error={errors.opponent}
            onChange={(event) => {
              setOpponent(event.target.value);
            }}
          />
          <SelectField
            label={t('calendar.fixture.venue')}
            value={venue}
            options={FIXTURE_VENUES.map((value) => ({
              value,
              label: t(`calendar.fixture.venue.${value}`),
            }))}
            onChange={(event) => {
              setVenue(event.target.value as FixtureVenue);
            }}
          />
          <TextField
            label={t('calendar.fixture.competition')}
            value={competition}
            maxLength={CALENDAR_TEXT_MAX_LENGTH}
            error={errors.competition}
            onChange={(event) => {
              setCompetition(event.target.value);
            }}
          />
        </div>
        <div className="sp-form__row">
          <TextField
            label={t('calendar.fixture.date')}
            type="date"
            required
            value={date}
            error={errors.date}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
          <TextField
            label={t('calendar.fixture.kickoff')}
            type="time"
            help={t('calendar.fixture.kickoff.help')}
            value={kickoffTime}
            error={errors.kickoffTime}
            onChange={(event) => {
              setKickoffTime(event.target.value);
            }}
          />
          <SelectField
            label={t('calendar.fixture.status')}
            value={status}
            options={FIXTURE_STATUSES.map((value) => ({
              value,
              label: t(`calendar.fixture.status.${value}`),
            }))}
            onChange={(event) => {
              setStatus(event.target.value as FixtureStatus);
            }}
          />
        </div>
        <TextField
          label={t('calendar.fixture.location')}
          value={location}
          maxLength={CALENDAR_TEXT_MAX_LENGTH}
          error={errors.location}
          onChange={(event) => {
            setLocation(event.target.value);
          }}
        />
        <TextAreaField
          label={t('calendar.fixture.notes')}
          value={notes}
          rows={3}
          maxLength={CALENDAR_NOTES_MAX_LENGTH}
          error={errors.notes}
          onChange={(event) => {
            setNotes(event.target.value);
          }}
        />
        <SaveError error={save.error ?? archive.error} reloaded={props.reloaded && !busy} />
        {confirmingArchive && fixture !== null ? (
          <Notice
            level="warning"
            role="alert"
            action={
              <div className="sp-form__actions">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    archive.mutate(fixture);
                  }}
                >
                  {t('calendar.fixture.archiveYes')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setConfirmingArchive(false);
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            }
          >
            <p>{t('calendar.fixture.archiveConfirm')}</p>
          </Notice>
        ) : null}
        <div className="sp-form__actions">
          <Button type="submit" disabled={busy}>
            {t('calendar.fixture.save')}
          </Button>
          {fixture === null || confirmingArchive ? null : (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setConfirmingArchive(true);
              }}
            >
              {t('calendar.fixture.archive')}
            </Button>
          )}
        </div>
      </form>
    </EditorFrame>
  );
}
