import {
  ApiError,
  type TrainingSession,
  type TrainingSessionDetail,
} from '@sport-performance/contracts';
import { CHANGE_REASON_MAX_LENGTH, sportRecordsContacts } from '@sport-performance/domain';
import { formatDateTime } from '@sport-performance/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { BackLink } from '../ui/back-link';
import { Button, Card, ErrorNotice, Loading, Notice, Page } from '../ui/components';
import { TextAreaField } from '../ui/fields';
import { DrillsSection } from './DrillsSection';
import { categoryName, sessionName } from './labels';
import { ParticipationSection } from './ParticipationSection';
import { SessionPodsSection, canReadSessionPods } from '../pods/SessionPodsSection';
import { canManageSession, manageableCategories } from './permissions';
import { trainingKey, trainingSessionQuery } from './queries';
import { SessionFields } from './SessionFields';
import {
  apiFieldErrors,
  editPatch,
  parseSessionForm,
  sessionFormFrom,
  type SessionFormErrors,
  type SessionFormValues,
  type UpdateSessionBody,
} from './session-form';

const route = getRouteApi('/_authed/_club/sessions/$trainingSessionId');

function isReasonError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code === 'validation_failed' &&
    error.details.some((issue) => issue.path[0] === 'body' && issue.path[1] === 'changeReason')
  );
}

function EditSession(props: { session: TrainingSessionDetail; onDone: () => void }) {
  const t = useT();
  const { api, selection } = useServices();
  const queryClient = useQueryClient();
  const active = useActiveClub();
  const timeZone = active.club.timeZone;
  const { session } = props;
  const [values, setValues] = useState<SessionFormValues>(() => sessionFormFrom(session, timeZone));
  const [errors, setErrors] = useState<SessionFormErrors>({});
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  // The current category stays selectable even if it is no longer one the caller manages.
  const categories = manageableCategories(active);
  const options = categories.some((category) => category.id === session.categoryId)
    ? categories
    : [
        ...active.categories.filter((category) => category.id === session.categoryId),
        ...categories,
      ];

  const parsed = parseSessionForm(values, timeZone);
  const patch = parsed.ok ? editPatch(parsed.session, session) : null;

  const update = useMutation({
    mutationFn: (body: UpdateSessionBody) =>
      api.updateTrainingSession({ params: { trainingSessionId: session.id }, body }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: trainingKey(selection.get()) });
      props.onDone();
    },
    onError: (error) => {
      setErrors(apiFieldErrors(error));
      if (isReasonError(error)) setReasonMissing(true);
    },
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!parsed.ok || patch === null) {
      setErrors(parsed.ok ? {} : parsed.errors);
      return;
    }
    setErrors({});
    if (Object.keys(patch.changes).length === 0) {
      props.onDone();
      return;
    }
    const changeReason = reason.trim();
    if (patch.isCorrection && changeReason === '') {
      setReasonMissing(true);
      return;
    }
    setReasonMissing(false);
    update.mutate({
      version: session.version,
      ...patch.changes,
      ...(patch.isCorrection ? { changeReason } : {}),
    });
  };

  const conflict = update.error instanceof ApiError && update.error.code === 'conflict';

  return (
    <form className="sp-form sp-card" onSubmit={submit} noValidate>
      <h2 className="sp-card__title">{t('training.detail.edit')}</h2>
      <SessionFields
        values={values}
        errors={errors}
        categories={options}
        timeZone={timeZone}
        onChange={setValues}
      />
      {patch?.isCorrection === true ? (
        <TextAreaField
          label={t('training.reason.label')}
          help={t('training.reason.help')}
          required
          rows={2}
          maxLength={CHANGE_REASON_MAX_LENGTH}
          value={reason}
          error={reasonMissing ? t('training.reason.required') : null}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      ) : null}
      {conflict ? (
        <Notice
          level="warning"
          role="alert"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                void queryClient.invalidateQueries({
                  queryKey: trainingKey(selection.get(), 'session', session.id),
                });
                props.onDone();
              }}
            >
              {t('training.detail.reload')}
            </Button>
          }
        >
          <p>{t('training.detail.conflict')}</p>
        </Notice>
      ) : update.isError && !isReasonError(update.error) ? (
        <ErrorNotice error={update.error} />
      ) : null}
      <div className="sp-form__actions">
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? t('common.loading') : t('common.save')}
        </Button>
        <Button variant="ghost" onClick={props.onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

function SessionData(props: { session: TrainingSession }) {
  const t = useT();
  const active = useActiveClub();
  const { session } = props;
  const rows: [string, string][] = [
    [t('training.form.kind'), t(`training.kind.${session.kind}`)],
    [t('training.form.category'), categoryName(active.categories, session.categoryId, t)],
    [
      t('training.detail.start'),
      formatDateTime(new Date(session.startsAt), { timeZone: active.club.timeZone }),
    ],
    [
      t('training.form.duration'),
      session.plannedDurationMin === null
        ? t('common.noData')
        : t('training.session.minutes', { minutes: session.plannedDurationMin }),
    ],
  ];
  if (session.location !== null) rows.push([t('training.form.location'), session.location]);
  if (session.opponent !== null) rows.push([t('training.form.opponent'), session.opponent]);
  if (session.notes !== null) rows.push([t('training.form.notes'), session.notes]);
  return (
    <Card title={t('training.detail.data')}>
      <dl className="sp-details">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/**
 * One session (B-407): its data (edited with the version, corrections with
 * a reason), archive and restore, its drills and the participation sheet.
 * The caller who cannot manage it (S&C, medical) reads it.
 */
export function SessionDetailPage() {
  const t = useT();
  const { trainingSessionId } = route.useParams();
  const { api, selection } = useServices();
  const queryClient = useQueryClient();
  const active = useActiveClub();
  const query = useQuery(trainingSessionQuery(api, selection.get(), trainingSessionId));
  const [editing, setEditing] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      archived
        ? api.archiveTrainingSession({ params: { trainingSessionId } })
        : api.restoreTrainingSession({ params: { trainingSessionId } }),
    onSuccess: async () => {
      setConfirmArchive(false);
      await queryClient.invalidateQueries({ queryKey: trainingKey(selection.get()) });
    },
  });

  if (query.isPending) return <Loading />;
  if (query.isError) {
    return (
      <Page
        title={t('training.list.title')}
        back={<BackLink to="/sessions">{t('training.detail.back')}</BackLink>}
      >
        <ErrorNotice error={query.error} />
      </Page>
    );
  }

  const session = query.data;
  const manage = canManageSession(active, session);
  const archived = session.archivedAt !== null;
  const title = sessionName(session, active.categories, t);

  return (
    <Page
      title={title}
      back={<BackLink to="/sessions">{t('training.detail.back')}</BackLink>}
      subtitle={`${t(`training.kind.${session.kind}`)} · ${formatDateTime(
        new Date(session.startsAt),
        {
          timeZone: active.club.timeZone,
        },
      )}`}
      actions={
        manage && !editing ? (
          <>
            {archived ? null : (
              <Button
                variant="secondary"
                onClick={() => {
                  setEditing(true);
                }}
              >
                {t('training.detail.edit')}
              </Button>
            )}
            {archived ? (
              <Button
                variant="secondary"
                disabled={archive.isPending}
                onClick={() => {
                  archive.mutate(false);
                }}
              >
                {t('training.detail.restore')}
              </Button>
            ) : confirmArchive ? (
              <Button
                variant="secondary"
                disabled={archive.isPending}
                onClick={() => {
                  archive.mutate(true);
                }}
              >
                {t('training.detail.archiveConfirm')}
              </Button>
            ) : (
              <Button
                variant="ghost"
                title={t('training.detail.archiveHelp')}
                onClick={() => {
                  setConfirmArchive(true);
                }}
              >
                {t('training.detail.archive')}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {confirmArchive && !archived ? (
        <Notice level="info" role="status">
          <p>{t('training.detail.archiveHelp')}</p>
        </Notice>
      ) : null}
      {archived ? (
        <Notice level="warning" role="status">
          <p>{t('training.detail.archivedNotice')}</p>
        </Notice>
      ) : null}
      {archive.isError ? <ErrorNotice error={archive.error} /> : null}

      <div className="sp-columns sp-columns--stretch">
        {editing ? (
          <EditSession
            session={session}
            onDone={() => {
              setEditing(false);
            }}
          />
        ) : (
          <SessionData session={session} />
        )}
        <DrillsSection
          trainingSessionId={session.id}
          drills={session.drills}
          editable={manage && !archived}
          contacts={sportRecordsContacts(session.sport)}
        />
      </div>
      <ParticipationSection session={session} editable={!archived} />
      {canReadSessionPods(active, session) ? (
        <SessionPodsSection session={session} editable={!archived} />
      ) : null}
    </Page>
  );
}
