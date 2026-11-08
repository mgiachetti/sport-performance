import type {
  PodAssignment,
  SessionPodPlayer,
  TrainingSessionDetail,
} from '@sport-performance/contracts';
import { CHANGE_REASON_MAX_LENGTH, can } from '@sport-performance/domain';
import { formatTime } from '@sport-performance/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub, type ActiveClub } from '../club/active-club';
import { useT } from '../i18n/i18n';
import { Button, Card, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel, TextAreaField } from '../ui/fields';
import { fromLocalStart, toLocalStart } from '../training/local-time';
import {
  assignmentErrorKey,
  fleetQuery,
  isReasonError,
  podsKey,
  sessionPodsQuery,
} from './queries';

type SessionScope = Pick<TrainingSessionDetail, 'categoryId' | 'sport'>;

function resourceFor(active: ActiveClub, session: SessionScope) {
  return {
    kind: 'pod_assignment' as const,
    clubId: active.club.id,
    ...(session.categoryId === null
      ? {}
      : { category: { id: session.categoryId, sport: session.sport } }),
  };
}

/** Whether the caller reads the pod assignments of the session's players (staff only). */
export function canReadSessionPods(active: ActiveClub, session: SessionScope): boolean {
  if (active.role === 'player' || active.role === 'parent') return false;
  return can(active.subject, 'read', resourceFor(active, session));
}

/**
 * The pods of a session (B-912, ADR 0106): which pod each player of the
 * category wears, their location consent (icon + text), and the actions of
 * the staff of the category: assign an active pod not taken in the session,
 * end, correct the range with a reason (ADR 0030) or void with a reason. The
 * API decides overlaps (`409`) and consents (`consent_required`); the panel
 * explains them.
 */
export function SessionPodsSection(props: { session: TrainingSessionDetail; editable: boolean }) {
  const t = useT();
  const { api } = useServices();
  const active = useActiveClub();
  const { session } = props;
  const pods = useQuery(sessionPodsQuery(api, active.selection, session.id));
  const manage = props.editable && can(active.subject, 'manage', resourceFor(active, session));
  const fleet = useQuery({
    ...fleetQuery(api, active.selection),
    enabled: props.editable && pods.data?.podsEnabled === true,
  });

  let content;
  if (pods.isPending) content = <Loading />;
  else if (pods.isError) content = <ErrorNotice error={pods.error} />;
  else if (!pods.data.podsEnabled) {
    content = (
      <Notice level="info">
        <p>{t('pods.session.notEnabled')}</p>
      </Notice>
    );
  } else if (pods.data.players.length === 0) {
    content = <p className="sp-admin__meta">{t('pods.session.empty')}</p>;
  } else {
    const taken = new Set(
      pods.data.players.flatMap((p) => (p.assignment === null ? [] : [p.assignment.podId])),
    );
    const free = (fleet.data ?? []).filter((pod) => pod.status === 'active' && !taken.has(pod.id));
    content = (
      <div className="sp-table-wrap">
        <table className="sp-table">
          <caption className="sp-visually-hidden">{t('pods.session.title')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('pods.session.player')}</th>
              <th scope="col">{t('pods.session.consent')}</th>
              <th scope="col">{t('pods.session.assignment')}</th>
              <th scope="col">{t('pods.session.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {pods.data.players.map((player) => (
              <PodPlayerRow
                key={player.playerId}
                session={session}
                player={player}
                freePods={free.map((pod) => ({ id: pod.id, number: pod.number }))}
                editable={props.editable}
                manage={manage}
              />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <Card id="session-pods" title={t('pods.session.title')} subtitle={t('pods.session.intro')}>
      {content}
    </Card>
  );
}

function ConsentState(props: { player: SessionPodPlayer }) {
  const t = useT();
  if (props.player.missingConsents.length === 0) {
    return <StatusLabel level="ok">{t('pods.session.consentOk')}</StatusLabel>;
  }
  return (
    <>
      {props.player.missingConsents.map((type) => (
        <StatusLabel key={type} level="warning">
          {t(`pods.session.missing.${type}`)}
        </StatusLabel>
      ))}
    </>
  );
}

function AssignmentText(props: { assignment: PodAssignment | null }) {
  const t = useT();
  const { club } = useActiveClub();
  const { assignment } = props;
  if (assignment === null) return <>{t('pods.session.none')}</>;
  const time = (iso: string) => formatTime(new Date(iso), { timeZone: club.timeZone });
  return (
    <>
      <strong>
        {assignment.podNumber === null
          ? t('pods.session.assignment')
          : t('pods.session.podNumber', { number: assignment.podNumber })}
      </strong>{' '}
      {assignment.endsAt === null
        ? t('pods.session.since', { time: time(assignment.startsAt) })
        : t('pods.session.range', {
            start: time(assignment.startsAt),
            end: time(assignment.endsAt),
          })}
      {assignment.reprocessRequestedAt === null ? null : (
        <>
          {' '}
          <StatusLabel level="info">{t('pods.session.reprocess')}</StatusLabel>
        </>
      )}
    </>
  );
}

function AssignmentError(props: { error: unknown }) {
  const t = useT();
  if (props.error === null || props.error === undefined) return null;
  const key = assignmentErrorKey(props.error);
  if (key === null) return <ErrorNotice error={props.error} />;
  return (
    <Notice level="warning" role="alert">
      <p>{t(key)}</p>
    </Notice>
  );
}

function useRefreshSessionPods() {
  const { queryClient } = useServices();
  const { selection } = useActiveClub();
  return () => queryClient.invalidateQueries({ queryKey: podsKey(selection) });
}

type Mode = 'idle' | 'correct' | 'void';

function PodPlayerRow(props: {
  session: TrainingSessionDetail;
  player: SessionPodPlayer;
  freePods: readonly { id: string; number: number }[];
  editable: boolean;
  manage: boolean;
}) {
  const t = useT();
  const { api } = useServices();
  const refresh = useRefreshSessionPods();
  const { player, session } = props;
  const name = `${player.lastName}, ${player.firstName}`;
  const [podId, setPodId] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const assignment = player.assignment;

  const assign = useMutation({
    mutationFn: () =>
      api.createPodAssignment({
        body: { clientUuid, podId, playerId: player.playerId, trainingSessionId: session.id },
      }),
    onSuccess: () => {
      setPodId('');
      setClientUuid(crypto.randomUUID());
    },
    onSettled: refresh,
  });
  const end = useMutation({
    mutationFn: (id: string) => api.endPodAssignment({ params: { podAssignmentId: id }, body: {} }),
    onSettled: refresh,
  });

  return (
    <tr>
      <th scope="row">{name}</th>
      <td>
        <ConsentState player={player} />
      </td>
      <td>
        <AssignmentText assignment={assignment} />
      </td>
      <td>
        {!props.editable ? null : assignment === null ? (
          player.canAssign ? (
            <div className="sp-admin__row-actions">
              {props.freePods.length === 0 ? (
                <span className="sp-admin__meta">{t('pods.session.noPods')}</span>
              ) : (
                <>
                  <SelectField
                    label={t('pods.session.pickPod', { player: name })}
                    hideLabel
                    value={podId}
                    options={[
                      { value: '', label: t('pods.session.choosePod') },
                      ...props.freePods.map((pod) => ({
                        value: pod.id,
                        label: t('pods.session.podNumber', { number: pod.number }),
                      })),
                    ]}
                    onChange={(event) => {
                      setPodId(event.target.value);
                      setClientUuid(crypto.randomUUID());
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={podId === '' || assign.isPending}
                    aria-label={`${t('pods.session.assign')} ${name}`}
                    onClick={() => {
                      assign.mutate();
                    }}
                  >
                    {t('pods.session.assign')}
                  </Button>
                </>
              )}
            </div>
          ) : null
        ) : props.manage && assignment.archivedAt === null ? (
          <>
            {mode === 'idle' ? (
              <div className="sp-admin__row-actions">
                {assignment.endsAt === null ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={end.isPending}
                    aria-label={`${t('pods.session.end')} ${name}`}
                    onClick={() => {
                      end.mutate(assignment.id);
                    }}
                  >
                    {t('pods.session.end')}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${t('pods.session.correct')} ${name}`}
                  onClick={() => {
                    setMode('correct');
                  }}
                >
                  {t('pods.session.correct')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${t('pods.session.void')} ${name}`}
                  onClick={() => {
                    setMode('void');
                  }}
                >
                  {t('pods.session.void')}
                </Button>
              </div>
            ) : (
              <CorrectionForm
                assignment={assignment}
                mode={mode}
                onDone={() => {
                  setMode('idle');
                }}
              />
            )}
          </>
        ) : null}
        <AssignmentError error={assign.error ?? end.error} />
      </td>
    </tr>
  );
}

/**
 * Correcting the range of an assignment (start and end in the club's day and
 * time) or voiding it: both ask for the reason, which goes to the change
 * history (ADR 0030).
 */
function CorrectionForm(props: {
  assignment: PodAssignment;
  mode: 'correct' | 'void';
  onDone: () => void;
}) {
  const t = useT();
  const { api } = useServices();
  const { club } = useActiveClub();
  const queryClient = useQueryClient();
  const { selection } = useActiveClub();
  const { assignment } = props;
  const start = toLocalStart(assignment.startsAt, club.timeZone);
  const endAt = assignment.endsAt === null ? null : toLocalStart(assignment.endsAt, club.timeZone);
  const [startDate, setStartDate] = useState(start.date);
  const [startTime, setStartTime] = useState(start.time);
  const [endDate, setEndDate] = useState(endAt?.date ?? '');
  const [endTime, setEndTime] = useState(endAt?.time ?? '');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const startsAt = fromLocalStart({ date: startDate, time: startTime }, club.timeZone);
  const open = endDate === '' && endTime === '';
  const endsAt = open ? null : fromLocalStart({ date: endDate, time: endTime }, club.timeZone);
  const timeInvalid = startsAt === null || (!open && endsAt === null);
  const trimmed = reason.trim();
  const reasonMissing = trimmed === '';

  const save = useMutation({
    mutationFn: () => {
      const params = { params: { podAssignmentId: assignment.id } };
      if (props.mode === 'void') {
        return api.voidPodAssignment({
          ...params,
          body: { version: assignment.version, changeReason: trimmed },
        });
      }
      return api.correctPodAssignment({
        ...params,
        body: {
          version: assignment.version,
          changeReason: trimmed,
          ...(startsAt === null || startsAt === assignment.startsAt ? {} : { startsAt }),
          ...(endsAt === assignment.endsAt ? {} : { endsAt }),
        },
      });
    },
    onSuccess: props.onDone,
    onSettled: () => queryClient.invalidateQueries({ queryKey: podsKey(selection) }),
  });

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (reasonMissing || (props.mode === 'correct' && timeInvalid)) return;
    save.mutate();
  };

  const reasonError =
    (submitted && reasonMissing) || isReasonError(save.error)
      ? t('pods.session.reasonRequired')
      : null;
  return (
    <form className="sp-form" onSubmit={submit} noValidate>
      {props.mode === 'void' ? (
        <p>{t('pods.session.voidQuestion')}</p>
      ) : (
        <div className="sp-form__row">
          <TextField
            type="date"
            label={t('pods.session.startDate')}
            value={startDate}
            onChange={(event) => {
              setStartDate(event.target.value);
            }}
          />
          <TextField
            type="time"
            label={t('pods.session.startTime')}
            value={startTime}
            error={submitted && startsAt === null ? t('pods.session.invalidTime') : null}
            onChange={(event) => {
              setStartTime(event.target.value);
            }}
          />
          <TextField
            type="date"
            label={t('pods.session.endDate')}
            help={t('pods.session.endHelp')}
            value={endDate}
            onChange={(event) => {
              setEndDate(event.target.value);
            }}
          />
          <TextField
            type="time"
            label={t('pods.session.endTime')}
            value={endTime}
            error={submitted && !open && endsAt === null ? t('pods.session.invalidTime') : null}
            onChange={(event) => {
              setEndTime(event.target.value);
            }}
          />
        </div>
      )}
      <TextAreaField
        label={t('pods.session.reason')}
        help={t('pods.session.reasonHelp')}
        maxLength={CHANGE_REASON_MAX_LENGTH}
        value={reason}
        error={reasonError}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      {isReasonError(save.error) ? null : <AssignmentError error={save.error} />}
      <div className="sp-form__actions">
        <Button type="submit" disabled={save.isPending}>
          {props.mode === 'void' ? t('pods.session.confirmVoid') : t('pods.session.save')}
        </Button>
        <Button variant="ghost" onClick={props.onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
