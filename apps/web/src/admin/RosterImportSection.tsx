import {
  ApiError,
  type RosterImport,
  type RosterImportPreview,
  type RosterImportResolution,
  type RosterInvitationToSend,
} from '@sport-performance/contracts';
import {
  SPORTS,
  type RosterTable,
  type RosterTableIssue,
  type Sport,
} from '@sport-performance/domain';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ChangeEvent } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { translate, useT } from '../i18n/i18n';
import { Button, ErrorNotice, Loading, Notice, TextField } from '../ui/components';
import { SelectField, StatusLabel } from '../ui/fields';
import { ActionError, AdminSection, LoadMore, useClubFormat } from './parts';
import { adminKey, branchesQuery, rosterImportsQuery } from './queries';
import { ROSTER_FILE_MAX_BYTES, readRosterFile, type RosterFileProblem } from './roster-file';
import {
  canImport,
  issueField,
  issueMessageKey,
  needsBatchSport,
  rosterBatch,
  rowNeedsAttention,
  sendableRows,
  unreadableRows,
  type SendableRow,
} from './roster-model';

interface LoadedFile {
  readonly name: string;
  readonly table: RosterTable;
  readonly rows: readonly SendableRow[];
}

/**
 * Roster import (padrón, B-411 over B-330, ADR 0047): the staff picks the
 * club's spreadsheet, sees what the sheet says and what the club would do
 * with each row (duplicates included), decides the doubtful ones and
 * imports everything or nothing; then sends the guardians' invitations.
 */
export function RosterImportSection() {
  const t = useT();
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [problem, setProblem] = useState<RosterFileProblem | 'too_large' | null>(null);
  const [reading, setReading] = useState(false);
  const [result, setResult] = useState<{
    import: RosterImport;
    invitationsToSend: RosterInvitationToSend[];
  } | null>(null);
  // Picking the same file again must read it again.
  const [inputKey, setInputKey] = useState(0);

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setLoaded(null);
    setProblem(null);
    setResult(null);
    if (file === undefined) return;
    if (file.size > ROSTER_FILE_MAX_BYTES) {
      setProblem('too_large');
      return;
    }
    setReading(true);
    try {
      const read = await readRosterFile(file);
      if (!read.ok) setProblem(read.problem);
      else setLoaded({ name: file.name, table: read.table, rows: sendableRows(read.table) });
    } finally {
      setReading(false);
    }
  };

  const reset = () => {
    setLoaded(null);
    setResult(null);
    setProblem(null);
    setInputKey((key) => key + 1);
  };

  return (
    <>
      <AdminSection
        id="admin-roster"
        title={t('admin.roster.title')}
        intro={t('admin.roster.intro')}
      >
        <details className="sp-admin__help">
          <summary>{t('admin.roster.columnsTitle')}</summary>
          <p>{t('admin.roster.columnsRequired')}</p>
          <p>{t('admin.roster.columnsOptional')}</p>
          <p>{t('admin.roster.columnsValues')}</p>
        </details>
        <TextField
          key={inputKey}
          label={t('admin.roster.file')}
          help={t('admin.roster.fileHelp')}
          type="file"
          accept=".csv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => void pick(event)}
        />
        {reading ? <Loading label={t('admin.roster.reading')} /> : null}
        {problem === null ? null : (
          <Notice level="critical" role="alert">
            <p>
              {problem === 'too_large'
                ? t('admin.roster.problem.too_large', {
                    maxMiB: ROSTER_FILE_MAX_BYTES / (1024 * 1024),
                  })
                : problem.code === 'csv_syntax'
                  ? t('admin.roster.problem.csv_syntax', { line: problem.line })
                  : translate(t, `admin.roster.problem.${problem.code}`)}
            </p>
          </Notice>
        )}
      </AdminSection>
      {result !== null ? (
        <ImportResult result={result} onAnother={reset} />
      ) : loaded === null ? null : (
        <LoadedRoster
          key={`${loaded.name}:${String(inputKey)}`}
          loaded={loaded}
          onImported={setResult}
        />
      )}
      <ImportHistory />
    </>
  );
}

/** `Campo: problema.`, or the problem alone, capitalized. */
function issueText(field: string | null, message: string): string {
  if (field !== null) return `${field}: ${message}`;
  return message.charAt(0).toUpperCase() + message.slice(1);
}

function SheetIssue(props: { issue: RosterTableIssue }) {
  const t = useT();
  const { issue } = props;
  const where = [
    issue.sourceRow === undefined ? null : t('admin.roster.row', { row: issue.sourceRow }),
    issue.column === undefined ? null : t('admin.roster.column', { column: issue.column }),
    issue.value === undefined ? null : t('admin.roster.value', { value: issue.value }),
  ].filter((part): part is string => part !== null);
  return (
    <li>
      <span>{translate(t, `admin.roster.sheet.${issue.code}`)}</span>
      {where.length === 0 ? null : <span className="sp-admin__meta"> {where.join(' · ')}</span>}
    </li>
  );
}

function LoadedRoster(props: {
  loaded: LoadedFile;
  onImported: (result: {
    import: RosterImport;
    invitationsToSend: RosterInvitationToSend[];
  }) => void;
}) {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const branches = useQuery(branchesQuery(api, selection));
  const { table, rows } = props.loaded;
  const unreadable = unreadableRows(table);
  const unknownColumns = table.columns.filter((c) => c.field === null);
  const recognized = table.columns.filter((c) => c.field !== null);

  const sports = useMemo(
    () =>
      SPORTS.filter((sport) =>
        (branches.data ?? []).some((b) => b.sport === sport && b.archivedAt === null),
      ),
    [branches.data],
  );
  const [chosenSport, setChosenSport] = useState<Sport | null>(null);
  const sport = chosenSport ?? (sports.length === 1 ? (sports[0] ?? null) : null);
  const [resolutions, setResolutions] = useState<ReadonlyMap<number, RosterImportResolution>>(
    new Map(),
  );
  const [skipUnreadable, setSkipUnreadable] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // One idempotency key per body: a new decision or sport is another import.
  const [revision, setRevision] = useState(0);
  const [clientUuid, setClientUuid] = useState(() => crypto.randomUUID());
  const bump = () => {
    setRevision((value) => value + 1);
    setClientUuid(crypto.randomUUID());
  };

  const sportMissing = needsBatchSport(rows) && sport === null;
  const body = rosterBatch(rows, sport, resolutions);
  const ready = rows.length > 0 && !sportMissing && table.issues.length === 0;

  const preview = useQuery({
    queryKey: adminKey(selection, 'rosterPreview', props.loaded.name, revision, sport),
    queryFn: ({ signal }) => api.previewRosterImport({ body }, { signal }),
    enabled: ready,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    placeholderData: keepPreviousData,
  });

  const run = useMutation({
    mutationFn: () => api.importRoster({ body: { clientUuid, ...body } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: adminKey(selection, 'rosterImports') });
      props.onImported(result);
    },
    // The club changed since the preview (a player, a category): read the preview again.
    onError: (error) => {
      if (
        error instanceof ApiError &&
        (error.code === 'validation_failed' || error.code === 'conflict')
      ) {
        bump();
      }
    },
  });

  const resolve = (index: number, resolution: RosterImportResolution | null) => {
    setResolutions((current) => {
      const next = new Map(current);
      if (resolution === null) next.delete(index);
      else next.set(index, resolution);
      return next;
    });
    bump();
  };

  const data = preview.data;
  const blockedByUnreadable = unreadable.length > 0 && !skipUnreadable;
  const visible =
    data === undefined ? [] : showAll ? data.rows : data.rows.filter(rowNeedsAttention);

  return (
    <AdminSection
      id="admin-roster-review"
      title={t('admin.roster.review', { file: props.loaded.name })}
    >
      <p>
        {t('admin.roster.readSummary', {
          rows: table.entries.length,
          valid: rows.length,
          invalid: unreadable.length,
        })}
      </p>
      {recognized.length === 0 ? null : (
        <p className="sp-admin__meta">
          {t('admin.roster.recognized', {
            columns: recognized.map((c) => c.header).join(', '),
          })}
        </p>
      )}
      {unknownColumns.length === 0 ? null : (
        <Notice level="info">
          <p>
            {t('admin.roster.unknownColumns', {
              columns: unknownColumns.map((c) => c.header).join(', '),
            })}
          </p>
        </Notice>
      )}
      {table.issues.length === 0 ? null : (
        <Notice level="critical" role="alert">
          <p>{t('admin.roster.sheetBlocked')}</p>
          <ul>
            {table.issues.map((issue, at) => (
              <SheetIssue key={at} issue={issue} />
            ))}
          </ul>
        </Notice>
      )}
      {unreadable.length === 0 ? null : (
        <Notice level="warning">
          <p>{t('admin.roster.unreadable', { count: unreadable.length })}</p>
          <ul>
            {unreadable.flatMap((entry) =>
              entry.issues.map((issue, at) => (
                <SheetIssue key={`${String(entry.sourceRow)}-${String(at)}`} issue={issue} />
              )),
            )}
          </ul>
          <label className="sp-admin__check">
            <input
              type="checkbox"
              checked={skipUnreadable}
              onChange={(event) => {
                setSkipUnreadable(event.target.checked);
              }}
            />
            <span>{t('admin.roster.skipUnreadable', { count: unreadable.length })}</span>
          </label>
        </Notice>
      )}

      {needsBatchSport(rows) && sports.length > 1 ? (
        <div className="sp-filters">
          <SelectField
            label={t('admin.roster.sport')}
            help={t('admin.roster.sportHelp')}
            value={sport ?? ''}
            error={sportMissing ? t('error.validation.required') : null}
            options={[
              { value: '', label: t('admin.roster.pickSport') },
              ...sports.map((value) => ({ value, label: t(`sport.${value}`) })),
            ]}
            onChange={(event) => {
              const value = event.target.value;
              setChosenSport(value === '' ? null : (value as Sport));
              bump();
            }}
          />
        </div>
      ) : null}
      {branches.isError ? <ErrorNotice error={branches.error} /> : null}

      {ready && preview.isPending ? <Loading label={t('admin.roster.checking')} /> : null}
      {preview.isError ? <ErrorNotice error={preview.error} /> : null}
      {data === undefined ? null : (
        <>
          <PreviewSummary preview={data} />
          <div className="sp-filters">
            <label className="sp-admin__check">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => {
                  setShowAll(event.target.checked);
                }}
              />
              <span>{t('admin.roster.showAll', { count: data.rowCount })}</span>
            </label>
          </div>
          {visible.length === 0 ? (
            <Notice level="ok" role="status">
              <p>{t('admin.roster.allClear')}</p>
            </Notice>
          ) : (
            <div className="sp-table-wrap">
              <table className="sp-table">
                <caption className="sp-visually-hidden">
                  {t('admin.roster.review', { file: props.loaded.name })}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{t('admin.roster.rowHeader')}</th>
                    <th scope="col">{t('admin.rollover.player')}</th>
                    <th scope="col">{t('admin.roster.what')}</th>
                    <th scope="col">{t('admin.roster.guardians')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <PreviewRow
                      key={row.index}
                      row={row}
                      sent={rows}
                      resolution={resolutions.get(row.index) ?? null}
                      onResolve={(resolution) => {
                        resolve(row.index, resolution);
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {canImport(data) ? null : (
            <Notice level="warning">
              <p>{t('admin.roster.fixFirst')}</p>
            </Notice>
          )}
          <ActionError error={run.error} conflictText={t('admin.roster.conflict')} />
          {run.error instanceof ApiError && run.error.code === 'validation_failed' ? (
            <Notice level="info">
              <p>{t('admin.roster.changedMeanwhile')}</p>
            </Notice>
          ) : null}
          <div className="sp-form__actions">
            <Button
              disabled={
                !canImport(data) || blockedByUnreadable || preview.isFetching || run.isPending
              }
              onClick={() => {
                run.mutate();
              }}
            >
              {run.isPending
                ? t('admin.roster.importing')
                : t('admin.roster.import', { count: data.rowCount })}
            </Button>
          </div>
        </>
      )}
    </AdminSection>
  );
}

function PreviewSummary(props: { preview: RosterImportPreview }) {
  const t = useT();
  const p = props.preview;
  const cells: [string, number][] = [
    [t('admin.roster.count.create'), p.createCount],
    [t('admin.roster.count.update'), p.updateCount],
    [t('admin.roster.count.skip'), p.skipCount],
    [t('admin.roster.count.invalid'), p.invalidCount],
    [t('admin.roster.count.resolution'), p.resolutionRequiredCount],
    [t('admin.roster.count.link'), p.guardiansToLinkCount],
    [t('admin.roster.count.invite'), p.invitationsToSendCount],
  ];
  return (
    <dl className="sp-summary">
      {cells.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PreviewRow(props: {
  row: RosterImportPreview['rows'][number];
  sent: readonly SendableRow[];
  resolution: RosterImportResolution | null;
  onResolve: (resolution: RosterImportResolution | null) => void;
}) {
  const t = useT();
  const format = useClubFormat();
  const { row } = props;
  const source = props.sent[row.index];
  const duplicateOf =
    row.duplicateOfIndex === null ? undefined : props.sent[row.duplicateOfIndex]?.sourceRow;
  const decision =
    props.resolution === null
      ? ''
      : props.resolution.action === 'update'
        ? `update:${props.resolution.playerId}`
        : props.resolution.action;
  const groupName = `roster-row-${String(row.index)}`;

  return (
    <tr>
      <th scope="row" className="sp-table__number">
        {row.sourceRow ?? row.index + 1}
      </th>
      <td>
        {source === undefined ? null : (
          <>
            <span className="sp-admin__name">
              {source.row.lastName}, {source.row.firstName}
            </span>
            <span className="sp-admin__meta">
              {format.date(source.row.birthDate)} · {t(`sex.${source.row.sex}`)}
              {source.row.category === undefined ? '' : ` · ${source.row.category}`}
            </span>
          </>
        )}
      </td>
      <td>
        {row.action === null ? null : (
          <StatusLabel level="ok">{t(`admin.roster.action.${row.action}`)}</StatusLabel>
        )}
        {row.issues.length === 0 ? null : (
          <ul className="sp-admin__issues">
            {row.issues.map((issue, at) => {
              const field = issueField(issue);
              return (
                <li key={at}>
                  <StatusLabel
                    level={issue.code === 'resolution_required' ? 'warning' : 'critical'}
                  >
                    {issueText(
                      field === null ? null : t(`admin.roster.field.${field}`),
                      translate(t, issueMessageKey(issue), { row: duplicateOf ?? '' }),
                    )}
                  </StatusLabel>
                </li>
              );
            })}
          </ul>
        )}
        {row.matches.length === 0 ? null : (
          <fieldset className="sp-fieldset sp-fieldset--nested">
            <legend className="sp-field__label">{t('admin.roster.decide')}</legend>
            <label className="sp-admin__check">
              <input
                type="radio"
                name={groupName}
                checked={decision === ''}
                onChange={() => {
                  props.onResolve(null);
                }}
              />
              <span>{t('admin.roster.decision.default')}</span>
            </label>
            <label className="sp-admin__check">
              <input
                type="radio"
                name={groupName}
                checked={decision === 'create'}
                onChange={() => {
                  props.onResolve({ action: 'create' });
                }}
              />
              <span>{t('admin.roster.decision.create')}</span>
            </label>
            <label className="sp-admin__check">
              <input
                type="radio"
                name={groupName}
                checked={decision === 'skip'}
                onChange={() => {
                  props.onResolve({ action: 'skip' });
                }}
              />
              <span>{t('admin.roster.decision.skip')}</span>
            </label>
            {row.matches.map((match) => (
              <label key={match.playerId} className="sp-admin__check">
                <input
                  type="radio"
                  name={groupName}
                  disabled={match.archived}
                  checked={decision === `update:${match.playerId}`}
                  onChange={() => {
                    props.onResolve({
                      action: 'update',
                      playerId: match.playerId,
                      version: match.version,
                    });
                  }}
                />
                <span>
                  {t('admin.roster.decision.update', {
                    name: `${match.lastName}, ${match.firstName}`,
                    birthDate: format.date(match.birthDate),
                  })}
                  <span className="sp-admin__meta">
                    {' '}
                    {t(`admin.roster.match.${match.kind}`)} ·{' '}
                    {t(`admin.roster.reason.${match.reason}`)}
                    {match.archived ? ` · ${t('admin.roster.archivedPlayer')}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </td>
      <td>
        {row.guardians.length === 0 ? (
          <span className="sp-admin__meta">{t('admin.roster.noGuardians')}</span>
        ) : (
          <ul className="sp-admin__issues">
            {row.guardians.map((guardian) => (
              <li key={guardian.email}>
                {guardian.email} · {t(`admin.guardian.${guardian.relationship}`)}
                <span className="sp-admin__meta">
                  {' '}
                  {t(`admin.roster.guardian.${guardian.outcome}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

type InviteState = 'pending' | 'sent' | 'failed';

function ImportResult(props: {
  result: { import: RosterImport; invitationsToSend: RosterInvitationToSend[] };
  onAnother: () => void;
}) {
  const t = useT();
  const { api, queryClient } = useServices();
  const { selection } = useActiveClub();
  const { import: done, invitationsToSend } = props.result;
  const [states, setStates] = useState<ReadonlyMap<string, InviteState>>(new Map());
  const [lastError, setLastError] = useState<unknown>(null);
  const keyOf = (i: RosterInvitationToSend) => `${String(i.rowIndex)}:${String(i.guardianIndex)}`;

  const send = useMutation({
    mutationFn: async () => {
      setLastError(null);
      for (const invitation of invitationsToSend) {
        const key = keyOf(invitation);
        if (states.get(key) === 'sent') continue;
        try {
          await api.createInvitation({
            body: {
              email: invitation.email,
              role: 'parent',
              playerId: invitation.playerId,
              relationship: invitation.relationship,
            },
          });
          setStates((current) => new Map(current).set(key, 'sent'));
        } catch (error) {
          setLastError(error);
          setStates((current) => new Map(current).set(key, 'failed'));
        }
      }
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: adminKey(selection, 'invitations') }),
  });
  const sentCount = [...states.values()].filter((s) => s === 'sent').length;
  const allSent = invitationsToSend.length > 0 && sentCount === invitationsToSend.length;

  return (
    <AdminSection id="admin-roster-result" title={t('admin.roster.done')}>
      <Notice level="ok" role="status">
        <p>
          {t('admin.roster.doneSummary', {
            created: done.createdCount,
            updated: done.updatedCount,
            skipped: done.skippedCount,
            linked: done.guardiansLinkedCount,
          })}
        </p>
      </Notice>
      {invitationsToSend.length === 0 ? (
        <p>{t('admin.roster.noInvitations')}</p>
      ) : (
        <>
          <p>{t('admin.roster.invitationsIntro', { count: invitationsToSend.length })}</p>
          <ul className="sp-admin__issues">
            {invitationsToSend.map((invitation) => {
              const state = states.get(keyOf(invitation)) ?? 'pending';
              return (
                <li key={keyOf(invitation)}>
                  {invitation.email} · {t(`admin.guardian.${invitation.relationship}`)}{' '}
                  <StatusLabel
                    level={state === 'sent' ? 'ok' : state === 'failed' ? 'critical' : 'info'}
                  >
                    {t(`admin.roster.invite.${state}`)}
                  </StatusLabel>
                </li>
              );
            })}
          </ul>
          {lastError === null ? null : <ErrorNotice error={lastError} />}
          <div className="sp-form__actions">
            <Button
              disabled={send.isPending || allSent}
              onClick={() => {
                send.mutate();
              }}
            >
              {send.isPending
                ? t('admin.roster.sending')
                : t('admin.roster.sendInvitations', {
                    count: invitationsToSend.length - sentCount,
                  })}
            </Button>
          </div>
        </>
      )}
      <div className="sp-form__actions">
        <Button variant="secondary" onClick={props.onAnother}>
          {t('admin.roster.another')}
        </Button>
      </div>
    </AdminSection>
  );
}

function ImportHistory() {
  const t = useT();
  const { api } = useServices();
  const { selection } = useActiveClub();
  const format = useClubFormat();
  const imports = useInfiniteQuery(rosterImportsQuery(api, selection));
  const items = imports.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <AdminSection id="admin-roster-history" title={t('admin.roster.history')}>
      {imports.isPending ? <Loading /> : null}
      {imports.isError ? <ErrorNotice error={imports.error} /> : null}
      {imports.isSuccess && items.length === 0 ? (
        <p className="sp-admin__meta">{t('admin.roster.historyEmpty')}</p>
      ) : null}
      {items.length === 0 ? null : (
        <div className="sp-table-wrap">
          <table className="sp-table">
            <caption className="sp-visually-hidden">{t('admin.roster.history')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.roster.when')}</th>
                <th scope="col" className="sp-table__number">
                  {t('admin.roster.rowsHeader')}
                </th>
                <th scope="col" className="sp-table__number">
                  {t('admin.roster.count.created')}
                </th>
                <th scope="col" className="sp-table__number">
                  {t('admin.roster.count.updated')}
                </th>
                <th scope="col" className="sp-table__number">
                  {t('admin.roster.count.skipped')}
                </th>
                <th scope="col" className="sp-table__number">
                  {t('admin.roster.count.linked')}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <th scope="row">{format.dateTime(item.createdAt)}</th>
                  <td className="sp-table__number">{item.rowCount}</td>
                  <td className="sp-table__number">{item.createdCount}</td>
                  <td className="sp-table__number">{item.updatedCount}</td>
                  <td className="sp-table__number">{item.skippedCount}</td>
                  <td className="sp-table__number">{item.guardiansLinkedCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore
        hasNextPage={imports.hasNextPage}
        isFetchingNextPage={imports.isFetchingNextPage}
        fetchNextPage={imports.fetchNextPage}
      />
    </AdminSection>
  );
}
