import {
  CALENDAR_NOTES_MAX_LENGTH,
  CALENDAR_TEXT_MAX_LENGTH,
  type Category,
  type Season,
  type TestSession,
} from '@sport-performance/contracts';
import {
  CHANGE_REASON_MAX_LENGTH,
  type CategoryId,
  type LocalDate,
} from '@sport-performance/domain';
import { formatLocalDate } from '@sport-performance/i18n';
import { useMutation } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useT } from '../i18n/i18n';
import { Button, Notice, TextField } from '../ui/components';
import { SelectField, TextAreaField } from '../ui/fields';
import { dateInput, optionalText, windowLabel, windowsForDate } from './model';
import { TestSessionStatusLabel, useCategoryName } from './parts';
import { EditorFrame, SaveError, isConflict, useRefreshCalendar } from './shared';

type TestWindowId = NonNullable<TestSession['testWindowId']>;

/** `auto`: the first active window that contains the date (or none). */
type WindowChoice = 'auto' | 'none' | TestWindowId;

interface Errors {
  readonly categoryId?: string;
  readonly scheduledOn?: string;
  readonly location?: string;
  readonly notes?: string;
  readonly changeReason?: string;
}

/**
 * Scheduling a test day of a category (B-317, B-406): category, date, window
 * (suggested by the date among the active windows of the sport), place and
 * notes. A scheduled day is rescheduled, suspended or put back here; one in
 * progress or closed is run from the test day screen (B-405), so it shows
 * read-only. `canManage` is the matrix's answer for its category.
 */
export function TestSessionEditor(props: {
  session: TestSession | null;
  /** Categories where the user may schedule (for a new day). */
  categories: readonly Category[];
  defaultCategoryId: CategoryId | null;
  defaultDate: LocalDate;
  seasons: readonly Season[];
  canManage: boolean;
  /** Opened again on refetched data after a `409`: the explanation stays. */
  reloaded: boolean;
  /** A `409`: the parent reopens the editor on the refetched day. */
  onConflict: () => void;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const { api } = useServices();
  const refresh = useRefreshCalendar();
  const categoryName = useCategoryName();
  const session = props.session;
  const [clientUuid] = useState(() => crypto.randomUUID());
  const [categoryId, setCategoryId] = useState<string>(
    session?.categoryId ?? props.defaultCategoryId ?? props.categories[0]?.id ?? '',
  );
  const [scheduledOn, setScheduledOn] = useState<string>(session?.scheduledOn ?? props.defaultDate);
  const [windowChoice, setWindowChoice] = useState<WindowChoice>(
    session === null ? 'auto' : (session.testWindowId ?? 'none'),
  );
  const [location, setLocation] = useState(session?.location ?? '');
  const [notes, setNotes] = useState(session?.notes ?? '');
  const [changeReason, setChangeReason] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const editable = props.canManage && (session === null || session.status === 'scheduled');
  const sport =
    session?.sport ?? props.categories.find((category) => category.id === categoryId)?.sport;
  const date = dateInput(scheduledOn);
  const windowOptions =
    sport === undefined || date === null ? [] : windowsForDate(props.seasons, sport, date);
  const offered = (id: TestWindowId) => windowOptions.some((o) => o.testWindow.id === id);
  // The day's own window stays while neither the date nor the window is
  // touched, even when it is no longer offered (archived, or the seasons
  // still loading): saving a note must not move the day out of its window.
  const keptWindow: TestWindowId | null =
    session !== null &&
    session.testWindowId !== null &&
    windowChoice === session.testWindowId &&
    scheduledOn === session.scheduledOn
      ? session.testWindowId
      : null;
  // Otherwise a window that no longer contains the date falls back to the suggestion.
  const resolvedWindow: TestWindowId | null =
    keptWindow ??
    (windowChoice === 'none'
      ? null
      : windowChoice !== 'auto' && offered(windowChoice)
        ? windowChoice
        : (windowOptions[0]?.testWindow.id ?? null));
  const keptWindowOption =
    keptWindow === null || offered(keptWindow)
      ? []
      : [
          {
            value: keptWindow,
            label:
              windowLabel(props.seasons, keptWindow) ?? t('calendar.testSession.window.current'),
          },
        ];

  // Changing a value that was already set is a correction: the change
  // history asks for its reason (ADR 0030). Filling an empty one is not.
  const nextLocation = optionalText(location);
  const nextNotes = optionalText(notes);
  const corrects = (previous: string | null, next: string | null) =>
    previous !== null && previous !== next;
  const needsReason =
    session !== null &&
    (corrects(session.scheduledOn, date ?? session.scheduledOn) ||
      corrects(session.testWindowId, resolvedWindow) ||
      corrects(session.location, nextLocation) ||
      corrects(session.notes, nextNotes));

  const save = useMutation({
    mutationFn: async (scheduledOn: LocalDate) => {
      if (session === null) {
        return api.createTestSession({
          body: {
            clientUuid,
            categoryId,
            scheduledOn,
            ...(resolvedWindow === null ? {} : { testWindowId: resolvedWindow }),
            ...(nextLocation === null ? {} : { location: nextLocation }),
            ...(nextNotes === null ? {} : { notes: nextNotes }),
          },
        });
      }
      return api.updateTestSession({
        params: { testSessionId: session.id },
        body: {
          version: session.version,
          ...(scheduledOn === session.scheduledOn ? {} : { scheduledOn }),
          ...(resolvedWindow === session.testWindowId ? {} : { testWindowId: resolvedWindow }),
          ...(nextLocation === session.location ? {} : { location: nextLocation }),
          ...(nextNotes === session.notes ? {} : { notes: nextNotes }),
          ...(needsReason ? { changeReason: changeReason.trim() } : {}),
        },
      });
    },
    onSuccess: async () => {
      props.onDone(t('calendar.testSession.saved'));
      await refresh();
    },
    onError: async (error) => {
      if (!isConflict(error)) return;
      props.onConflict();
      await refresh();
    },
  });

  const cancel = useMutation({
    mutationFn: (target: TestSession) =>
      api.cancelTestSession({ params: { testSessionId: target.id } }),
    onSuccess: async () => {
      props.onDone(t('calendar.testSession.cancelled'));
      await refresh();
    },
    onError: async (error) => {
      setConfirmingCancel(false);
      if (!isConflict(error)) return;
      props.onConflict();
      await refresh();
    },
  });
  const restore = useMutation({
    mutationFn: (target: TestSession) =>
      api.restoreTestSession({ params: { testSessionId: target.id } }),
    onSuccess: async () => {
      props.onDone(t('calendar.testSession.restored'));
      await refresh();
    },
    onError: async (error) => {
      if (!isConflict(error)) return;
      props.onConflict();
      await refresh();
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: {
      categoryId?: string;
      scheduledOn?: string;
      location?: string;
      notes?: string;
      changeReason?: string;
    } = {};
    if (categoryId === '') next.categoryId = t('calendar.field.required');
    if (date === null) next.scheduledOn = t('calendar.field.invalidDate');
    if (location.trim().length > CALENDAR_TEXT_MAX_LENGTH) {
      next.location = t('calendar.field.tooLong', { max: CALENDAR_TEXT_MAX_LENGTH });
    }
    if (notes.trim().length > CALENDAR_NOTES_MAX_LENGTH) {
      next.notes = t('calendar.field.tooLong', { max: CALENDAR_NOTES_MAX_LENGTH });
    }
    if (needsReason) {
      const reason = changeReason.trim();
      if (reason === '') next.changeReason = t('calendar.field.reasonRequired');
      else if (reason.length > CHANGE_REASON_MAX_LENGTH) {
        next.changeReason = t('calendar.field.tooLong', { max: CHANGE_REASON_MAX_LENGTH });
      }
    }
    setErrors(next);
    if (Object.keys(next).length === 0 && date !== null) save.mutate(date);
  };

  const title =
    session === null
      ? t('calendar.testSession.newTitle')
      : t('calendar.testSession.title', { category: categoryName(session.categoryId) });
  const busy = save.isPending || cancel.isPending || restore.isPending;

  return (
    <EditorFrame id="calendar-editor-test-session" title={title} onClose={props.onClose}>
      {session === null ? null : (
        <p>
          <TestSessionStatusLabel status={session.status} />
        </p>
      )}
      {session !== null && !props.canManage ? (
        <Notice level="info">
          <p>{t('calendar.editor.readOnly')}</p>
        </Notice>
      ) : null}
      {session !== null && props.canManage && session.status === 'cancelled' ? (
        <Notice level="info">
          <p>{t('calendar.testSession.readOnlyCancelled')}</p>
        </Notice>
      ) : null}
      {session !== null &&
      props.canManage &&
      (session.status === 'in_progress' || session.status === 'completed') ? (
        <Notice level="info">
          <p>{t('calendar.testSession.readOnlyRun')}</p>
        </Notice>
      ) : null}

      {editable ? (
        <form className="sp-form" noValidate onSubmit={submit}>
          {session === null ? (
            <SelectField
              label={t('calendar.testSession.category')}
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
          <TextField
            label={t('calendar.testSession.date')}
            type="date"
            required
            value={scheduledOn}
            error={errors.scheduledOn}
            onChange={(event) => {
              setScheduledOn(event.target.value);
            }}
          />
          <SelectField
            label={t('calendar.testSession.window')}
            help={
              windowOptions.length === 0
                ? t('calendar.testSession.window.noneForDate')
                : t('calendar.testSession.window.help')
            }
            value={resolvedWindow ?? 'none'}
            options={[
              { value: 'none', label: t('calendar.testSession.window.none') },
              ...keptWindowOption,
              ...windowOptions.map((option) => ({
                value: option.testWindow.id,
                label: `${option.testWindow.label} · ${option.season.name} (${formatLocalDate(option.testWindow.startsOn)} – ${formatLocalDate(option.testWindow.endsOn)})`,
              })),
            ]}
            onChange={(event) => {
              setWindowChoice(event.target.value as WindowChoice);
            }}
          />
          <TextField
            label={t('calendar.testSession.location')}
            value={location}
            maxLength={CALENDAR_TEXT_MAX_LENGTH}
            error={errors.location}
            onChange={(event) => {
              setLocation(event.target.value);
            }}
          />
          <TextAreaField
            label={t('calendar.testSession.notes')}
            value={notes}
            rows={3}
            maxLength={CALENDAR_NOTES_MAX_LENGTH}
            error={errors.notes}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
          />
          {needsReason ? (
            <TextField
              label={t('calendar.testSession.reason')}
              help={t('calendar.testSession.reason.help')}
              required
              value={changeReason}
              maxLength={CHANGE_REASON_MAX_LENGTH}
              error={errors.changeReason}
              onChange={(event) => {
                setChangeReason(event.target.value);
              }}
            />
          ) : null}
          <SaveError error={save.error ?? cancel.error} reloaded={props.reloaded && !busy} />
          {confirmingCancel && session !== null ? (
            <Notice
              level="warning"
              role="alert"
              action={
                <div className="sp-form__actions">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      cancel.mutate(session);
                    }}
                  >
                    {t('calendar.testSession.cancelYes')}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setConfirmingCancel(false);
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </div>
              }
            >
              <p>{t('calendar.testSession.cancelConfirm')}</p>
            </Notice>
          ) : null}
          <div className="sp-form__actions">
            <Button type="submit" disabled={busy}>
              {t('calendar.testSession.save')}
            </Button>
            {session === null || confirmingCancel ? null : (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  cancel.reset();
                  setConfirmingCancel(true);
                }}
              >
                {t('calendar.testSession.cancel')}
              </Button>
            )}
          </div>
        </form>
      ) : session === null ? null : (
        <>
          <dl className="sp-cal__details">
            <dt>{t('calendar.testSession.date')}</dt>
            <dd>{formatLocalDate(session.scheduledOn)}</dd>
            <dt>{t('calendar.testSession.window')}</dt>
            <dd>
              {session.testWindowId === null
                ? t('calendar.testSession.window.none')
                : (windowLabel(props.seasons, session.testWindowId) ?? '—')}
            </dd>
            <dt>{t('calendar.testSession.location')}</dt>
            <dd>{session.location ?? '—'}</dd>
            <dt>{t('calendar.testSession.notes')}</dt>
            <dd>{session.notes ?? '—'}</dd>
          </dl>
          {props.canManage && session.status === 'cancelled' ? (
            <>
              <SaveError error={restore.error} reloaded={props.reloaded && !busy} />
              <div className="sp-form__actions">
                <Button
                  disabled={busy}
                  onClick={() => {
                    restore.mutate(session);
                  }}
                >
                  {t('calendar.testSession.restore')}
                </Button>
              </div>
            </>
          ) : null}
        </>
      )}
    </EditorFrame>
  );
}
