import {
  ApiError,
  PARTICIPATION_CONTACTS_MAX,
  PARTICIPATION_MINUTES_MAX,
  type SessionRosterEntry,
  type TrainingSessionDetail,
} from '@sport-performance/contracts';
import {
  CHANGE_REASON_MAX_LENGTH,
  PARTICIPATION_STATUSES,
  participationCarriesLoad,
} from '@sport-performance/domain';
import { formatNumber } from '@sport-performance/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useServices } from '../app/services';
import { useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice } from '../ui/components';
import { StatusLabel, TextAreaField } from '../ui/fields';
import { AVAILABILITY_LEVELS } from './labels';
import {
  fillPresent,
  initialDraft,
  isDirty,
  planSave,
  sessionTotals,
  withStatus,
  type DraftRow,
  type DraftStatus,
  type ParticipationRow,
  type RowError,
} from './participation';
import { sessionRosterQuery, trainingKey } from './queries';

function playerName(entry: SessionRosterEntry): string {
  return `${entry.player.lastName}, ${entry.player.firstName}`;
}

/** The player's RPE; "Pendiente" while a player who took part has not reported it. */
function useRpeText() {
  const t = useT();
  return (entry: SessionRosterEntry): string => {
    const participation = entry.participation;
    if (participation === null) return formatNumber(null);
    if (participation.rpe !== null) return formatNumber(participation.rpe);
    return participationCarriesLoad(participation.status)
      ? t('training.participation.rpePending')
      : formatNumber(null);
  };
}

function isReasonError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.code === 'validation_failed' &&
    error.details.some((issue) => issue.path[0] === 'body' && issue.path[1] === 'changeReason')
  );
}

/**
 * The participation sheet of a session (B-407): every player of the roster
 * with their derived availability (never the cause), status, minutes and
 * contacts, and the player's RPE and sRPE (read only: the player reports
 * the RPE, the database computes the load). One batch saves what changed;
 * correcting values already submitted asks for the reason (ADR 0030).
 */
export function ParticipationSection(props: { session: TrainingSessionDetail; editable: boolean }) {
  const t = useT();
  const { api, selection } = useServices();
  const queryClient = useQueryClient();
  const { session } = props;
  const roster = useQuery(sessionRosterQuery(api, selection.get(), session.id));
  const rpeText = useRpeText();
  const [edits, setEdits] = useState<ReadonlyMap<string, DraftRow>>(new Map());
  const [reason, setReason] = useState('');
  const [reasonMissing, setReasonMissing] = useState(false);
  const [forceReason, setForceReason] = useState(false);
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, RowError[]>>(new Map());
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const save = useMutation({
    mutationFn: (body: { rows: ParticipationRow[]; changeReason?: string }) =>
      api.recordParticipations({ params: { trainingSessionId: session.id }, body }),
    onSuccess: async (result) => {
      setEdits(new Map());
      setReason('');
      setForceReason(false);
      setSavedCount(result.items.length);
      await queryClient.invalidateQueries({
        queryKey: trainingKey(selection.get(), 'session', session.id, 'roster'),
      });
    },
    onError: (error) => {
      if (isReasonError(error)) setForceReason(true);
    },
  });

  if (roster.isPending) return <Loading />;
  if (roster.isError) return <ErrorNotice error={roster.error} />;

  const entries = roster.data;
  const anyRecordable = entries.some((entry) => entry.canRecord);
  const editableRow = (entry: SessionRosterEntry) => props.editable && entry.canRecord;
  const draftOf = (entry: SessionRosterEntry) => edits.get(entry.player.id) ?? initialDraft(entry);
  const drafts = new Map(entries.map((entry) => [entry.player.id, draftOf(entry)]));
  const plan = planSave(entries, drafts, () => crypto.randomUUID());
  const pending = entries.filter(
    (entry) => editableRow(entry) && isDirty(draftOf(entry), entry.participation),
  ).length;
  const askReason = plan.needsReason || forceReason;
  const totals = sessionTotals(entries);

  const setDraft = (playerId: string, row: DraftRow) => {
    setSavedCount(null);
    setEdits((current) => new Map(current).set(playerId, row));
  };

  const fillAll = () => {
    const editable = new Set(entries.filter(editableRow).map((entry) => entry.player.id));
    const filled = fillPresent(drafts, editable, session.plannedDurationMin);
    setSavedCount(null);
    setEdits((current) => {
      const next = new Map(current);
      for (const [playerId, row] of filled) {
        if (row !== drafts.get(playerId)) next.set(playerId, row);
      }
      return next;
    });
  };

  const submit = () => {
    setRowErrors(plan.errors);
    if (plan.errors.size > 0) return;
    if (plan.rows.length === 0) {
      setSavedCount(0);
      return;
    }
    const changeReason = reason.trim();
    if (askReason && changeReason === '') {
      setReasonMissing(true);
      return;
    }
    setReasonMissing(false);
    save.mutate({
      rows: plan.rows,
      ...(askReason ? { changeReason } : {}),
    });
  };

  const statusOptions = (entry: SessionRosterEntry): DraftStatus[] =>
    entry.participation === null ? ['', ...PARTICIPATION_STATUSES] : [...PARTICIPATION_STATUSES];

  return (
    <section className="sp-card" aria-labelledby="participation-title">
      <h2 id="participation-title" className="sp-card__title">
        {t('training.participation.title')}
      </h2>

      <dl className="sp-summary" aria-label={t('training.summary.title')}>
        <div>
          <dt>{t('training.summary.present')}</dt>
          <dd>{formatNumber(totals.present)}</dd>
        </div>
        <div>
          <dt>{t('training.summary.absent')}</dt>
          <dd>{formatNumber(totals.absent)}</dd>
        </div>
        <div>
          <dt>{t('training.summary.unavailable')}</dt>
          <dd>{formatNumber(totals.unavailable)}</dd>
        </div>
        <div>
          <dt>{t('training.summary.minutes')}</dt>
          <dd>{formatNumber(totals.minutes)}</dd>
        </div>
        <div>
          <dt>{t('training.summary.rpe')}</dt>
          <dd>
            {t('training.summary.rpeValue', {
              reported: formatNumber(totals.rpeReported),
              present: formatNumber(totals.present),
            })}
          </dd>
        </div>
        <div>
          <dt>{t('training.summary.load')}</dt>
          <dd>{t('training.summary.loadValue', { value: formatNumber(totals.srpeAu) })}</dd>
        </div>
      </dl>

      {props.editable && !anyRecordable && entries.length > 0 ? (
        <Notice level="info" role="status">
          <p>{t('training.participation.readOnly')}</p>
        </Notice>
      ) : null}
      {entries.length === 0 ? <p>{t('training.participation.empty')}</p> : null}

      {entries.length === 0 ? null : (
        <div className="sp-table-wrap">
          <table className="sp-table sp-table--sheet">
            <caption className="sp-visually-hidden">{t('training.participation.caption')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('training.participation.player')}</th>
                <th scope="col">{t('training.participation.availability')}</th>
                <th scope="col">{t('training.participation.status')}</th>
                <th scope="col" className="sp-table__number">
                  {t('training.participation.minutes')}
                </th>
                <th scope="col" className="sp-table__number">
                  {t('training.participation.contacts')}
                </th>
                <th scope="col" className="sp-table__number">
                  {t('training.participation.rpe')}
                </th>
                <th scope="col" className="sp-table__number">
                  {t('training.participation.srpe')}
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const name = playerName(entry);
                const draft = draftOf(entry);
                const editable = editableRow(entry);
                const carriesLoad = draft.status !== '' && participationCarriesLoad(draft.status);
                const errors = rowErrors.get(entry.player.id) ?? [];
                const dirty = editable && isDirty(draft, entry.participation);
                return (
                  <tr key={entry.player.id} className={dirty ? 'is-dirty' : undefined}>
                    <th scope="row">
                      <span className="sp-sheet__name">{name}</span>
                      {entry.inCategory ? null : (
                        <span className="sp-tag">{t('training.participation.calledUp')}</span>
                      )}
                      {entry.player.archivedAt === null ? null : (
                        <span className="sp-tag">{t('training.participation.leftClub')}</span>
                      )}
                      {entry.hasDataConsent ? null : (
                        <StatusLabel level="warning">
                          {t('training.participation.noConsent')}
                        </StatusLabel>
                      )}
                    </th>
                    <td>
                      {entry.availability === null ? (
                        t('training.availability.unknown')
                      ) : (
                        <>
                          <StatusLabel level={AVAILABILITY_LEVELS[entry.availability.status]}>
                            {t(`training.availability.${entry.availability.status}`)}
                          </StatusLabel>
                          {entry.availability.staffNotes.map((note) => (
                            <span key={note} className="sp-sheet__note">
                              {note}
                            </span>
                          ))}
                        </>
                      )}
                    </td>
                    <td>
                      {editable ? (
                        <select
                          className="sp-field__input"
                          aria-label={t('training.participation.statusOf', { name })}
                          value={draft.status}
                          disabled={save.isPending}
                          onChange={(event) => {
                            setDraft(
                              entry.player.id,
                              withStatus(draft, event.target.value as DraftStatus),
                            );
                          }}
                        >
                          {statusOptions(entry).map((status) => (
                            <option key={status} value={status} disabled={status === ''}>
                              {status === ''
                                ? t('training.status.none')
                                : t(`training.status.${status}`)}
                            </option>
                          ))}
                        </select>
                      ) : draft.status === '' ? (
                        t('training.status.none')
                      ) : (
                        t(`training.status.${draft.status}`)
                      )}
                    </td>
                    <td className="sp-table__number">
                      {editable ? (
                        <input
                          className="sp-field__input sp-sheet__count"
                          inputMode="numeric"
                          aria-label={t('training.participation.minutesOf', { name })}
                          aria-invalid={errors.includes('minutes') ? true : undefined}
                          title={
                            errors.includes('minutes')
                              ? t('training.participation.error.minutes', {
                                  max: PARTICIPATION_MINUTES_MAX,
                                })
                              : undefined
                          }
                          value={draft.minutes}
                          disabled={!carriesLoad || save.isPending}
                          onChange={(event) => {
                            setDraft(entry.player.id, { ...draft, minutes: event.target.value });
                          }}
                        />
                      ) : (
                        formatNumber(entry.participation?.minutes)
                      )}
                    </td>
                    <td className="sp-table__number">
                      {editable ? (
                        <input
                          className="sp-field__input sp-sheet__count"
                          inputMode="numeric"
                          aria-label={t('training.participation.contactsOf', { name })}
                          aria-invalid={errors.includes('contacts') ? true : undefined}
                          title={
                            errors.includes('contacts')
                              ? t('training.participation.error.contacts', {
                                  max: PARTICIPATION_CONTACTS_MAX,
                                })
                              : undefined
                          }
                          value={draft.contacts}
                          disabled={!carriesLoad || save.isPending}
                          onChange={(event) => {
                            setDraft(entry.player.id, { ...draft, contacts: event.target.value });
                          }}
                        />
                      ) : (
                        formatNumber(entry.participation?.contactsN)
                      )}
                    </td>
                    <td className="sp-table__number">{rpeText(entry)}</td>
                    <td className="sp-table__number">
                      {formatNumber(entry.participation?.srpeAu)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {props.editable && anyRecordable ? (
        <div className="sp-sheet__footer">
          {rowErrors.size > 0 ? (
            <Notice level="critical" role="alert">
              <p>{t('training.participation.invalidRows')}</p>
            </Notice>
          ) : null}
          {askReason ? (
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
          {save.isError && !isReasonError(save.error) ? (
            <ErrorNotice
              error={save.error}
              action={
                save.error instanceof ApiError && save.error.code === 'conflict' ? (
                  <Button variant="secondary" onClick={() => void roster.refetch()}>
                    {t('training.detail.reload')}
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {savedCount === null ? null : (
            <Notice level="ok" role="status">
              <p>{t('training.participation.saved', { count: savedCount })}</p>
            </Notice>
          )}
          <div className="sp-form__actions">
            <Button variant="secondary" disabled={save.isPending} onClick={fillAll}>
              {session.plannedDurationMin === null
                ? t('training.participation.fillPresentNoMinutes')
                : t('training.participation.fillPresent', {
                    minutes: session.plannedDurationMin,
                  })}
            </Button>
            <Button disabled={save.isPending} onClick={submit}>
              {save.isPending ? t('common.loading') : t('training.participation.save')}
            </Button>
            {pending > 0 ? (
              <>
                <span className="sp-sheet__pending" role="status">
                  {t('training.participation.pending', { count: pending })}
                </span>
                <Button
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => {
                    setEdits(new Map());
                    setRowErrors(new Map());
                    setForceReason(false);
                    void roster.refetch();
                  }}
                >
                  {t('training.participation.discard')}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
