import {
  ApiError,
  type TestDayPreviousResult,
  type TestDaySheet,
  type TestDaySheetPlayer,
  type TestDaySheetStation,
  type TestResult,
} from '@sport-performance/contracts';
import {
  UNIT_CODES,
  isWellFormedCode,
  type MeasurementMethod,
  type TestNotDoneReason,
  type UnitCode,
} from '@sport-performance/domain';
import {
  formatDuration,
  formatLocalDate,
  formatNumber,
  formatUnit,
  type MessageKey,
} from '@sport-performance/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { useServices } from '../app/services';
import { useActiveClub } from '../club/active-club';
import { translate, useT } from '../i18n/i18n';
import { Button, ErrorNotice, Notice, TextField } from '../ui/components';
import { Icon } from '../ui/icons';
import {
  WEB_METHODS,
  buildAddedAttempt,
  buildRow,
  defaultMethodOf,
  emptyDraft,
  entryModesOf,
  fieldAllowed,
  fieldsOf,
  isDirty,
  issuesByPlayer,
  notDoneReasonOptions,
  notDoneReasonView,
  nextAttemptNumber,
  previewRow,
  type EntryMode,
  type FieldSpec,
  type RowIssue,
  type RowDraft,
  type RowPreview,
  type RowProblem,
  type StationContext,
} from './model';
import { fieldLabel, testLabel } from './parts';
import { testDaysKey } from './queries';

/** What the staff set up and typed in one station; kept by the page across stations. */
export interface StationState {
  readonly mode: EntryMode;
  readonly method: MeasurementMethod;
  readonly exercise: string;
  readonly deviceId: string | null;
  readonly drafts: Readonly<Record<string, RowDraft>>;
  readonly methods: Readonly<Record<string, MeasurementMethod>>;
  readonly problems: Readonly<Record<string, readonly RowProblem[]>>;
  readonly issues: Readonly<Record<string, readonly RowIssue[]>>;
  readonly notice: 'saved' | 'nothing' | 'problems' | 'rejected' | null;
  readonly savedCount: number;
  /**
   * Players whose row came back `replayed` (an earlier send had already saved
   * it, its answer was lost) but with what was sent first, not with the edits
   * made since: the saved result does not have them.
   */
  readonly replayedStale: readonly string[];
}

export function initialStationState(station: TestDaySheetStation): StationState {
  return {
    mode: entryModesOf(station)[0] ?? 'value',
    method: defaultMethodOf(station.testCode),
    exercise: '',
    deviceId: null,
    drafts: {},
    methods: {},
    problems: {},
    issues: {},
    notice: null,
    savedCount: 0,
    replayedStale: [],
  };
}

type Update = (update: (state: StationState) => StationState) => void;

function withoutKey<V>(record: Readonly<Record<string, V>>, key: string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

function isUnit(unit: string): unit is UnitCode {
  return (UNIT_CODES as readonly string[]).includes(unit);
}

function formatValue(value: number, unit: string): string {
  return isUnit(unit) ? formatUnit(value, unit) : formatNumber(value);
}

/**
 * One station of the day: its protocol and settings (how it is entered, the
 * method, the strength exercise, the device), and the sheet of the roster —
 * attempts, best attempt, previous result, not done, problems and warnings —
 * saved as one batch (`POST /v1/test-sessions/{id}/results`).
 */
export function StationPanel(props: {
  sheet: TestDaySheet;
  station: TestDaySheetStation;
  results: readonly TestResult[];
  resultsLoaded: boolean;
  state: StationState;
  onStateChange: Update;
}) {
  const t = useT();
  const { api } = useServices();
  const queryClient = useQueryClient();
  const active = useActiveClub();
  const { sheet, station, state, onStateChange: update } = props;
  const session = sheet.testSession;
  const day = session.scheduledOn;
  const definition = station.definition;
  const modes = entryModesOf(station);
  const fields = fieldsOf(station, state.mode);
  const writable = session.status !== 'cancelled';
  const anyRecordable = writable && sheet.players.some((p) => p.recording === 'allowed');
  const exercise = state.exercise.trim();
  const context: StationContext = {
    station,
    mode: state.mode,
    exercise: exercise !== '' && isWellFormedCode(exercise) ? exercise : null,
    deviceId: state.deviceId,
  };
  const headingId = useId();
  const resultsOf = (playerId: string) => props.results.filter((r) => r.playerId === playerId);

  const applicable = (player: TestDaySheetPlayer) =>
    applicabilityOf(player, station)?.applicable ?? false;
  const draftOf = (player: TestDaySheetPlayer): RowDraft => {
    const existing = state.drafts[player.id];
    const method = state.methods[player.id] ?? state.method;
    if (existing !== undefined) return { ...existing, method };
    const draft = emptyDraft(definition.attemptCount, method);
    // A test that does not apply is recorded as such (principle 3), never left as a gap.
    return applicable(player)
      ? draft
      : { ...draft, status: 'not_done', reason: 'not_applicable_to_stage' };
  };
  const pending = (player: TestDaySheetPlayer) =>
    player.recording === 'allowed' &&
    props.resultsLoaded &&
    resultsOf(player.id).length === 0 &&
    (state.drafts[player.id] !== undefined || !applicable(player));

  const dirtyCount = writable
    ? sheet.players.filter((p) => pending(p) && isDirty(draftOf(p))).length
    : 0;
  // Rows nobody touched that the save records as not applicable to the stage (principle 3).
  const autoNotApplicableCount = writable
    ? sheet.players.filter((p) => pending(p) && state.drafts[p.id] === undefined).length
    : 0;

  const editDraft = (player: TestDaySheetPlayer, edit: (draft: RowDraft) => RowDraft) => {
    update((s) => {
      const current = s.drafts[player.id] ?? draftOf(player);
      const problems = withoutKey(s.problems, player.id);
      const issues = withoutKey(s.issues, player.id);
      return {
        ...s,
        drafts: { ...s.drafts, [player.id]: edit(current) },
        problems,
        issues,
        notice: null,
      };
    });
  };

  const save = useMutation({
    mutationFn: (input: {
      players: string[];
      results: Parameters<typeof api.recordTestSessionResults>[0]['body']['results'];
    }) =>
      api.recordTestSessionResults({
        params: { testSessionId: session.id },
        body: { results: input.results },
      }),
    onSuccess: (response, input) => {
      update((s) => {
        const sent = new Set(input.players);
        // A replay returns the result of the first send: if the row changed since, say so.
        const replayedStale = response.results.flatMap((item, index) => {
          const playerId = input.players[index];
          if (!item.replayed || playerId === undefined) return [];
          const first = s.drafts[playerId]?.firstSent ?? null;
          return first !== null && first !== JSON.stringify(input.results[index]) ? [playerId] : [];
        });
        const drafts = Object.fromEntries(Object.entries(s.drafts).filter(([id]) => !sent.has(id)));
        return {
          ...s,
          drafts,
          problems: {},
          issues: {},
          notice: 'saved',
          savedCount: response.results.length,
          replayedStale,
        };
      });
    },
    onError: (error, input) => {
      if (error instanceof ApiError && error.code === 'validation_failed') {
        const sent = input.players.flatMap((playerId, index) => {
          const result = input.results[index];
          return result === undefined ? [] : [{ playerId, input: result }];
        });
        const byPlayer = issuesByPlayer(error.details, sent);
        update((s) => ({
          ...s,
          issues: Object.fromEntries(
            [...byPlayer].map(([id, rowIssues]) => [id ?? '', rowIssues] as const),
          ),
          notice: 'rejected',
        }));
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: testDaysKey(active.selection) }),
  });

  const submit = () => {
    const problems: Record<string, RowProblem[]> = {};
    const players: string[] = [];
    const inputs: Parameters<typeof api.recordTestSessionResults>[0]['body']['results'] = [];
    const drafts: Record<string, RowDraft> = { ...state.drafts };
    for (const player of sheet.players) {
      if (!pending(player)) continue;
      const built = buildRow(context, player, draftOf(player));
      if (built.kind === 'problems') problems[player.id] = [...built.problems];
      if (built.kind === 'result') {
        players.push(player.id);
        inputs.push(built.input);
        drafts[player.id] = {
          ...built.draft,
          firstSent: built.draft.firstSent ?? JSON.stringify(built.input),
        };
      }
    }
    if (Object.keys(problems).length > 0) {
      update((s) => ({ ...s, problems, issues: {}, notice: 'problems', replayedStale: [] }));
      return;
    }
    if (inputs.length === 0) {
      update((s) => ({ ...s, notice: 'nothing', replayedStale: [] }));
      return;
    }
    // Keep the clientUuids the batch used: a retry after no answer sends the same ones.
    update((s) => ({ ...s, drafts, problems: {}, issues: {}, notice: null, replayedStale: [] }));
    save.mutate({ players, results: inputs });
  };

  // A send not yet confirmed keeps its rows and their clientUuids for the retry:
  // changing the mode would drop them and a retry could duplicate the first send.
  const unconfirmed = Object.values(state.drafts).some((draft) => draft.firstSent !== null);

  const attemptColumns = Array.from({ length: definition.attemptCount }, (_, i) => i);

  return (
    <section className="sp-card" aria-labelledby={headingId}>
      <h2 id={headingId} className="sp-card__title">
        {testLabel(t, station.testCode)}
      </h2>
      <details className="sp-td-protocol">
        <summary>{t('testDay.protocol.show', { version: definition.version })}</summary>
        {definition.protocol.summary === null ? null : <p>{definition.protocol.summary}</p>}
        <p>
          {t('testDay.protocol.attempts', {
            count: definition.attemptCount,
            aggregation: definition.attemptAggregation,
          })}
        </p>
        {definition.protocol.restBetweenAttemptsS === null ? null : (
          <p>
            {t('testDay.protocol.rest', {
              duration: formatDuration(definition.protocol.restBetweenAttemptsS),
            })}
          </p>
        )}
        {definition.protocol.steps.length === 0 ? null : (
          <ol>
            {definition.protocol.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        )}
        {definition.protocol.equipment.length === 0 ? null : (
          <p>
            {t('testDay.protocol.equipment', {
              equipment: definition.protocol.equipment.join(', '),
            })}
          </p>
        )}
      </details>

      {anyRecordable ? (
        <div className="sp-td-settings">
          {modes.length > 1 ? (
            <SelectField
              label={t('testDay.mode.label')}
              value={state.mode}
              disabled={unconfirmed || save.isPending}
              help={
                unconfirmed || save.isPending
                  ? t('testDay.mode.unconfirmed')
                  : dirtyCount > 0
                    ? t('testDay.mode.changeLosesDrafts')
                    : undefined
              }
              onChange={(value) => {
                update((s) => ({
                  ...s,
                  mode: value as EntryMode,
                  drafts: {},
                  problems: {},
                  issues: {},
                  notice: null,
                }));
              }}
              options={modes.map((mode) => ({ value: mode, label: t(`testDay.mode.${mode}`) }))}
            />
          ) : null}
          <SelectField
            label={t('testDay.method.station')}
            value={state.method}
            onChange={(value) => {
              update((s) => ({ ...s, method: value as MeasurementMethod }));
            }}
            options={WEB_METHODS.map((method) => ({ value: method, label: t(`method.${method}`) }))}
          />
          {station.testCode === 'strength' ? (
            <TextField
              label={t('testDay.exercise.label')}
              help={t('testDay.exercise.help')}
              value={state.exercise}
              autoComplete="off"
              list="sp-td-exercises"
              error={
                state.exercise.trim() !== '' && context.exercise === null
                  ? t('testDay.problem.exercise')
                  : null
              }
              onChange={(event) => {
                const value = event.currentTarget.value;
                update((s) => ({ ...s, exercise: value }));
              }}
            />
          ) : null}
          {station.testCode === 'strength' ? (
            <datalist id="sp-td-exercises">
              {[
                'goblet_squat',
                'trap_bar_deadlift',
                'bench_press',
                'pull_up',
                'push_up',
                'back_squat',
              ].map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>
          ) : null}
          {definition.sameDeviceOnly ? (
            sheet.devices.length === 0 ? (
              <Notice level="warning">
                <p>{t('testDay.device.empty')}</p>
              </Notice>
            ) : (
              <SelectField
                label={t('testDay.device.label')}
                help={t('testDay.device.help')}
                value={state.deviceId ?? ''}
                onChange={(value) => {
                  update((s) => ({ ...s, deviceId: value === '' ? null : value }));
                }}
                options={[
                  { value: '', label: t('testDay.device.choose') },
                  ...sheet.devices.map((device) => ({ value: device.id, label: device.label })),
                ]}
              />
            )
          ) : null}
        </div>
      ) : writable ? (
        <Notice level="info">
          <p>{t('testDay.readOnly')}</p>
        </Notice>
      ) : null}

      {sheet.players.length === 0 ? (
        <p>{t('testDay.noPlayers')}</p>
      ) : (
        <div className="sp-td-scroll">
          <table className="sp-td-table sp-td-sheet">
            <caption className="sp-visually-hidden">
              {t('testDay.table.caption', { station: testLabel(t, station.testCode) })}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('testDay.table.player')}</th>
                <th scope="col">{t('testDay.table.state')}</th>
                {attemptColumns.map((i) => (
                  <th key={i} scope="col">
                    {definition.attemptCount === 1
                      ? t('testDay.table.result')
                      : t('testDay.table.attempt', { number: i + 1 })}
                  </th>
                ))}
                <th scope="col">{t('testDay.table.best')}</th>
                <th scope="col">{t('testDay.table.previous')}</th>
                <th scope="col">{t('testDay.table.method')}</th>
              </tr>
            </thead>
            <tbody>
              {sheet.players.map((player) => (
                <PlayerRows
                  key={player.id}
                  player={player}
                  station={station}
                  fields={fields}
                  context={context}
                  draft={draftOf(player)}
                  state={state}
                  results={resultsOf(player.id)}
                  resultsLoaded={props.resultsLoaded}
                  writable={writable}
                  day={day}
                  onEdit={(edit) => {
                    editDraft(player, edit);
                  }}
                  onMethod={(method) => {
                    update((s) => ({ ...s, methods: { ...s.methods, [player.id]: method } }));
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {anyRecordable ? (
        <div className="sp-td-save">
          {dirtyCount === 0 ? null : <p>{t('testDay.unsaved', { count: dirtyCount })}</p>}
          {autoNotApplicableCount === 0 ? null : (
            <p className="sp-td-msg">
              <Icon name="info" />
              <span>{t('testDay.save.notApplicable', { count: autoNotApplicableCount })}</span>
            </p>
          )}
          <Button disabled={save.isPending} onClick={submit}>
            {save.isPending ? t('testDay.saving') : t('testDay.save', { count: dirtyCount })}
          </Button>
        </div>
      ) : null}
      <StationNotice state={state} />
      {state.replayedStale.length === 0 ? null : (
        <Notice level="warning" role="alert">
          <p>
            {t('testDay.save.replayedStale', {
              players: sheet.players
                .filter((p) => state.replayedStale.includes(p.id))
                .map(playerName)
                .join('; '),
            })}
          </p>
        </Notice>
      )}
      {save.error === null ||
      (save.error instanceof ApiError && save.error.code === 'validation_failed') ? null : (
        <ErrorNotice error={save.error} />
      )}
      {state.issues[''] === undefined ? null : (
        <Notice level="critical" role="alert">
          {state.issues[''].map((issue) => {
            const text = issueText(t, issue);
            return <p key={text}>{text}</p>;
          })}
        </Notice>
      )}
    </section>
  );
}

function StationNotice(props: { state: StationState }) {
  const t = useT();
  switch (props.state.notice) {
    case null:
      return null;
    case 'saved':
      return (
        <Notice level="ok" role="status">
          <p>{t('testDay.saved', { count: props.state.savedCount })}</p>
        </Notice>
      );
    case 'nothing':
      return (
        <Notice level="info" role="status">
          <p>{t('testDay.save.nothing')}</p>
        </Notice>
      );
    case 'problems':
      return (
        <Notice level="critical" role="alert">
          <p>{t('testDay.save.problems')}</p>
        </Notice>
      );
    case 'rejected':
      return (
        <Notice level="critical" role="alert">
          <p>{t('testDay.save.rejected')}</p>
        </Notice>
      );
  }
}

function SelectField(props: {
  label: string;
  value: string;
  help?: string | undefined;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="sp-field">
      <label htmlFor={id} className="sp-field__label">
        {props.label}
      </label>
      <select
        id={id}
        value={props.value}
        disabled={props.disabled}
        aria-describedby={props.help === undefined ? undefined : `${id}-help`}
        onChange={(event) => {
          props.onChange(event.currentTarget.value);
        }}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {props.help === undefined ? null : (
        <p id={`${id}-help`} className="sp-field__help">
          {props.help}
        </p>
      )}
    </div>
  );
}

/** Whether the station's test applies to the player, by test code (not by station order). */
function applicabilityOf(player: TestDaySheetPlayer, station: TestDaySheetStation) {
  return player.tests.find((test) => test.testCode === station.testCode);
}

/** Text of an issue of the API on its row: the attempt and field of an entry when known. */
function issueText(t: ReturnType<typeof useT>, issue: RowIssue): string {
  const topic = t(`testDay.issue.${issue.topic}`);
  if (issue.attemptNumber === null) return topic;
  return issue.fieldKey === null
    ? t('testDay.issue.attempt', { number: issue.attemptNumber, problem: topic })
    : t('testDay.issue.attemptField', {
        number: issue.attemptNumber,
        field: fieldLabel(t, issue.fieldKey),
      });
}

function playerName(player: Pick<TestDaySheetPlayer, 'firstName' | 'lastName'>): string {
  return `${player.lastName}, ${player.firstName}`;
}

function problemText(t: ReturnType<typeof useT>, problem: RowProblem): string {
  switch (problem.kind) {
    case 'reason':
      return t('testDay.problem.reason');
    case 'note':
      return t('testDay.problem.note');
    case 'exercise':
      return t('testDay.problem.exercise');
    case 'device':
      return t('testDay.problem.device');
    case 'attempt': {
      const number = problem.attempt + 1;
      if (problem.problem === 'domain') return t('testDay.problem.domain', { number });
      const text =
        problem.problem === 'required'
          ? t('testDay.problem.required', {
              field: problem.fieldKey === null ? '' : fieldLabel(t, problem.fieldKey),
            })
          : translate(t, `testDay.problem.${problem.problem}` as MessageKey);
      return t('testDay.problem.attempt', { number, problem: text });
    }
  }
}

/** The rows of one player: the sheet row and, when there is something to say, its messages. */
function PlayerRows(props: {
  player: TestDaySheetPlayer;
  station: TestDaySheetStation;
  fields: readonly FieldSpec[];
  context: StationContext;
  draft: RowDraft;
  state: StationState;
  results: readonly TestResult[];
  resultsLoaded: boolean;
  writable: boolean;
  day: TestDaySheet['testSession']['scheduledOn'];
  onEdit: (edit: (draft: RowDraft) => RowDraft) => void;
  onMethod: (method: MeasurementMethod) => void;
}) {
  const t = useT();
  const { player, station, draft, fields, state } = props;
  const name = playerName(player);
  const columns = station.definition.attemptCount;
  const applicability = applicabilityOf(player, station);
  const applicable = applicability?.applicable ?? false;
  const previous = player.previous.find((p) => p.testCode === station.testCode) ?? null;
  const recorded = props.results;
  const editable =
    props.writable &&
    player.recording === 'allowed' &&
    props.resultsLoaded &&
    recorded.length === 0;
  const preview: RowPreview | null =
    editable && draft.status === 'done'
      ? previewRow(station, state.mode, draft, player, props.day)
      : null;
  const problems = state.problems[player.id] ?? [];
  const issues = state.issues[player.id] ?? [];

  const messages: ReactNode[] = [];
  if (!applicable && applicability?.reason !== null && applicability?.reason !== undefined) {
    messages.push(
      <p key="na" className="sp-td-msg">
        <Icon name="info" />
        <span>{t(`testDay.row.notApplicable.${applicability.reason}`)}</span>
      </p>,
    );
  }
  if (player.recording === 'missing_consent' && recorded.length === 0) {
    messages.push(
      <p key="consent" className="sp-td-msg">
        <Icon name="warning" />
        <span>{t('testDay.row.missingConsent')}</span>
      </p>,
    );
  }
  for (const problem of problems) {
    const text = problemText(t, problem);
    messages.push(
      <p key={`p-${text}`} className="sp-td-msg sp-td-msg--critical">
        <Icon name="critical" />
        <span>{text}</span>
      </p>,
    );
  }
  for (const issue of issues) {
    const text = issueText(t, issue);
    messages.push(
      <p key={`i-${text}`} className="sp-td-msg sp-td-msg--critical">
        <Icon name="critical" />
        <span>{text}</span>
      </p>,
    );
  }
  for (const warning of preview?.warnings ?? []) {
    const unit = fields.find((f) => f.key === warning.fieldKey)?.unit ?? null;
    const show = (value: number) => (unit === null ? formatNumber(value) : formatUnit(value, unit));
    const suggestion = warning.result.suggestedValues[0];
    messages.push(
      <p
        key={`w-${String(warning.attempt)}-${warning.fieldKey}`}
        className="sp-td-msg sp-td-msg--warning"
      >
        <Icon name="warning" />
        <span>
          {t('testDay.plausibility.outOfRange', {
            number: warning.attempt + 1,
            value: show(warning.value),
            min: show(warning.result.bounds.minValue),
            max: show(warning.result.bounds.maxValue),
          })}
          {suggestion === undefined
            ? null
            : ` ${t('testDay.plausibility.suggestion', { value: show(suggestion) })}`}
        </span>
      </p>,
    );
  }

  return (
    <>
      <tr className={messages.length > 0 ? 'sp-td-row has-messages' : 'sp-td-row'}>
        <th scope="row">
          <span className="sp-td-name">{name}</span>
          {player.stage === null ? null : (
            <span className="sp-td-meta">{t(`testDay.stage.${player.stage}`)}</span>
          )}
          {player.inCategory ? null : (
            <span className="sp-td-meta">{t('testDay.row.notInCategory')}</span>
          )}
        </th>
        {recorded.length > 0 ? (
          <RecordedCells
            player={player}
            station={station}
            results={recorded}
            columns={columns}
            context={props.context}
            canWrite={props.writable && player.recording === 'allowed'}
          />
        ) : !editable ? (
          <>
            <td>
              {player.recording === 'allowed' && props.writable && !props.resultsLoaded ? null : (
                <span className="sp-td-meta">{t('testDay.row.pending')}</span>
              )}
            </td>
            <td colSpan={columns + 1} />
          </>
        ) : (
          <>
            <td>
              <StateCell
                player={player}
                name={name}
                draft={draft}
                applicable={applicable}
                onEdit={props.onEdit}
              />
            </td>
            {draft.status === 'not_done' ? (
              <td colSpan={columns + 1} />
            ) : (
              <>
                {Array.from({ length: columns }, (_, attempt) => (
                  <td key={attempt}>
                    <AttemptInputs
                      fields={fields}
                      mode={state.mode}
                      player={player}
                      name={name}
                      attempt={attempt}
                      values={draft.attempts[attempt] ?? {}}
                      preview={preview}
                      onChange={(key, value) => {
                        props.onEdit((d) => ({
                          ...d,
                          attempts: d.attempts.map((values, i) =>
                            i === attempt ? { ...values, [key]: value } : values,
                          ),
                        }));
                      }}
                    />
                  </td>
                ))}
                <td>
                  <Scores scores={preview?.scores ?? []} station={station} />
                </td>
              </>
            )}
          </>
        )}
        <td>
          <Previous
            previous={previous}
            station={station}
            method={recorded.length > 0 ? (recorded[0]?.method ?? null) : draft.method}
          />
        </td>
        <td>
          {editable && draft.status === 'done' ? (
            <select
              aria-label={t('testDay.method.row', { player: name })}
              value={draft.method}
              onChange={(event) => {
                props.onMethod(event.currentTarget.value as MeasurementMethod);
              }}
            >
              {WEB_METHODS.map((method) => (
                <option key={method} value={method}>
                  {t(`method.${method}`)}
                </option>
              ))}
            </select>
          ) : recorded[0]?.method !== null && recorded[0]?.method !== undefined ? (
            t(`method.${recorded[0].method}`)
          ) : (
            '—'
          )}
        </td>
      </tr>
      {messages.length === 0 ? null : (
        <tr className="sp-td-messages">
          <td colSpan={columns + 5}>{messages}</td>
        </tr>
      )}
    </>
  );
}

function StateCell(props: {
  player: TestDaySheetPlayer;
  name: string;
  draft: RowDraft;
  applicable: boolean;
  onEdit: (edit: (draft: RowDraft) => RowDraft) => void;
}) {
  const t = useT();
  const { role } = useActiveClub();
  const { draft, name } = props;
  const reasons = notDoneReasonOptions(props.applicable, role);
  return (
    <div className="sp-td-state">
      <select
        aria-label={t('testDay.row.stateLabel', { player: name })}
        value={draft.status}
        disabled={!props.applicable}
        onChange={(event) => {
          const status = event.currentTarget.value === 'not_done' ? 'not_done' : 'done';
          props.onEdit((d) => ({ ...d, status }));
        }}
      >
        <option value="done">{t('testDay.row.done')}</option>
        <option value="not_done">{t('testDay.row.notDone')}</option>
      </select>
      {draft.status === 'not_done' ? (
        <>
          <select
            aria-label={t('testDay.reason.label', { player: name })}
            value={draft.reason ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              props.onEdit((d) => ({
                ...d,
                reason: value === '' ? null : (value as TestNotDoneReason),
              }));
            }}
          >
            {props.applicable ? <option value="">{t('testDay.reason.choose')}</option> : null}
            {reasons.map(({ reason, view }) => (
              <option key={reason} value={reason}>
                {t(`testDay.reason.${view}`)}
              </option>
            ))}
          </select>
          {draft.reason === 'other' ? (
            <input
              className="sp-td-input sp-td-input--wide"
              aria-label={t('testDay.note.label', { player: name })}
              value={draft.note}
              maxLength={1000}
              onChange={(event) => {
                const note = event.currentTarget.value;
                props.onEdit((d) => ({ ...d, note }));
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function AttemptInputs(props: {
  fields: readonly FieldSpec[];
  mode: EntryMode;
  player: TestDaySheetPlayer;
  name: string;
  attempt: number;
  values: Readonly<Record<string, string>>;
  preview: RowPreview | null;
  onChange: (key: string, value: string) => void;
}) {
  const t = useT();
  const id = useId();
  const parsed = props.preview?.attempts[props.attempt];
  const invalidKey =
    parsed?.status === 'invalid' ? (parsed.fieldKey ?? props.fields[0]?.key ?? null) : null;
  return (
    <div className="sp-td-attempt">
      {props.fields
        .filter((field) => fieldAllowed(field, props.mode, props.player.strengthAssessment))
        .map((field) => {
          const label = fieldLabel(t, field.key);
          const best = props.preview?.bestAttempt.get(field.metricCode) === props.attempt;
          // A raw set or a computed metric highlights the whole attempt, once.
          const showMarker =
            best && props.fields.find((f) => f.metricCode === field.metricCode)?.key === field.key;
          const markerId = `${id}-${field.key}-best`;
          return (
            <div key={field.key} className="sp-td-cell">
              {props.fields.length > 1 ? (
                <span className="sp-td-cell__label" aria-hidden="true">
                  {label}
                </span>
              ) : null}
              <input
                className={best ? 'sp-td-input is-best' : 'sp-td-input'}
                inputMode={field.integer ? 'numeric' : 'decimal'}
                autoComplete="off"
                aria-label={t('testDay.input.label', {
                  field: label,
                  number: props.attempt + 1,
                  player: props.name,
                })}
                aria-invalid={invalidKey === field.key ? true : undefined}
                aria-describedby={showMarker ? markerId : undefined}
                value={props.values[field.key] ?? ''}
                onChange={(event) => {
                  props.onChange(field.key, event.currentTarget.value);
                }}
              />
              {showMarker ? (
                <span id={markerId} className="sp-td-best">
                  <Icon name="ok" />
                  <span>{t('testDay.best.marker')}</span>
                </span>
              ) : null}
            </div>
          );
        })}
    </div>
  );
}

function Scores(props: {
  scores: readonly { metricCode: string; value: number; aggregation: string }[];
  station: TestDaySheetStation;
}) {
  const t = useT();
  if (props.scores.length === 0) return <span className="sp-td-meta">—</span>;
  const unitOf = (code: string) =>
    props.station.definition.metrics.find((m) => m.code === code)?.unit ?? '';
  return (
    <ul className="sp-td-scores">
      {props.scores.map((score) => (
        <li key={score.metricCode}>
          {t('testDay.metric.value', {
            metric: fieldLabel(t, score.metricCode),
            value: formatValue(score.value, unitOf(score.metricCode)),
          })}
          {score.aggregation === 'mean' ? ` (${t('testDay.best.mean')})` : null}
        </li>
      ))}
    </ul>
  );
}

function Previous(props: {
  previous: TestDayPreviousResult | null;
  station: TestDaySheetStation;
  /** The method of the saved result, or of the row being typed; `null` when not done. */
  method: MeasurementMethod | null;
}) {
  const t = useT();
  const { previous, station } = props;
  if (previous === null) return <span className="sp-td-meta">{t('testDay.previous.none')}</span>;
  const unitOf = (code: string) =>
    station.definition.metrics.find((m) => m.code === code)?.unit ?? '';
  const shown = previous.scores.slice(0, 3);
  return (
    <div className="sp-td-previous">
      <span>
        {t('testDay.previous.on', {
          value: shown
            .map((score) =>
              t('testDay.metric.value', {
                metric: fieldLabel(t, score.metricCode),
                value: formatValue(score.value, unitOf(score.metricCode)),
              }),
            )
            .join(' · '),
          date: formatLocalDate(previous.measuredOn),
        })}
      </span>
      {props.method === null || previous.method === props.method ? null : (
        <span className="sp-td-msg sp-td-msg--warning">
          <Icon name="warning" />
          <span>
            {t('testDay.previous.otherMethod', { method: t(`method.${previous.method}`) })}
          </span>
        </span>
      )}
      {previous.protocolVersion === station.definition.version ? null : (
        <span className="sp-td-msg sp-td-msg--warning">
          <Icon name="warning" />
          <span>{t('testDay.previous.otherVersion', { version: previous.protocolVersion })}</span>
        </span>
      )}
    </div>
  );
}

/** A player with results of this station on the day: their attempts, voiding and adding one. */
function RecordedCells(props: {
  player: TestDaySheetPlayer;
  station: TestDaySheetStation;
  results: readonly TestResult[];
  columns: number;
  context: StationContext;
  canWrite: boolean;
}) {
  const t = useT();
  const { role } = useActiveClub();
  const { results } = props;
  const first = results[0];
  if (first === undefined) return null;
  return (
    <>
      <td>
        {first.status === 'done' ? (
          <span className="sp-td-status sp-td-status--completed">
            <Icon name="ok" />
            <span>{t('testDay.row.done')}</span>
          </span>
        ) : (
          <span className="sp-td-status">
            <Icon name="info" />
            <span>
              {t('testDay.recorded.notDone', {
                reason:
                  first.notDoneReason === null
                    ? '—'
                    : t(`testDay.reason.${notDoneReasonView(first.notDoneReason, role)}`),
              })}
            </span>
          </span>
        )}
        {first.notDoneNote === null ? null : (
          <span className="sp-td-meta">
            {t('testDay.recorded.note', { note: first.notDoneNote })}
          </span>
        )}
      </td>
      <td colSpan={props.columns}>
        {results.map((result) => (
          <RecordedResult
            key={result.id}
            result={result}
            player={props.player}
            station={props.station}
            context={props.context}
            canWrite={props.canWrite}
          />
        ))}
      </td>
      <td>
        <Scores scores={first.scores} station={props.station} />
      </td>
    </>
  );
}

function RecordedResult(props: {
  result: TestResult;
  player: TestDaySheetPlayer;
  station: TestDaySheetStation;
  context: StationContext;
  canWrite: boolean;
}) {
  const t = useT();
  const { api } = useServices();
  const queryClient = useQueryClient();
  const active = useActiveClub();
  const { result, player } = props;
  const name = playerName(player);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [uuids, setUuids] = useState<Record<string, string>>({});
  const [addProblem, setAddProblem] = useState<string | null>(null);
  const [done, setDone] = useState<'voided' | 'added' | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: testDaysKey(active.selection) });

  const voidEntry = useMutation({
    mutationFn: (input: { entryId: string; reason: string }) =>
      api.voidTestResultEntries({
        params: { testResultId: result.id },
        body: { entryIds: [input.entryId], reason: input.reason },
      }),
    onSuccess: () => {
      setVoiding(null);
      setReason('');
      setDone('voided');
    },
    onSettled: refresh,
  });
  const addEntries = useMutation({
    mutationFn: (entries: Parameters<typeof api.addTestResultEntries>[0]['body']['entries']) =>
      api.addTestResultEntries({ params: { testResultId: result.id }, body: { entries } }),
    onSuccess: () => {
      setAdding(false);
      setValues({});
      setUuids({});
      setDone('added');
    },
    onSettled: refresh,
  });

  const attemptNumber = nextAttemptNumber(result);
  const entries = result.entries.filter((entry) => entry.kind !== 'derived');
  const fields = fieldsOf(props.station, props.context.mode);
  const unitOf = (code: string) =>
    props.station.definition.metrics.find((m) => m.code === code)?.unit ?? '';

  const submitAttempt = () => {
    const built = buildAddedAttempt(props.context, player, values, attemptNumber, uuids);
    if (built.kind === 'empty') return;
    if (built.kind === 'invalid') {
      setAddProblem(
        built.problem === 'domain'
          ? t('testDay.problem.domain', { number: attemptNumber })
          : built.problem === 'required'
            ? t('testDay.problem.required', {
                field: built.fieldKey === null ? '' : fieldLabel(t, built.fieldKey),
              })
            : translate(t, `testDay.problem.${built.problem}` as MessageKey),
      );
      return;
    }
    setAddProblem(null);
    setUuids(built.uuids);
    addEntries.mutate(built.entries);
  };

  return (
    <div className="sp-td-recorded">
      {result.status === 'done' ? (
        <ul className="sp-td-entries">
          {entries.map((entry) => (
            <li key={entry.id} className={entry.voided === null ? undefined : 'is-voided'}>
              <span>
                {entry.attemptNumber === null
                  ? null
                  : `${t('testDay.table.attempt', { number: entry.attemptNumber })}: `}
                {entry.values
                  .map((value) =>
                    t('testDay.metric.value', {
                      metric: fieldLabel(t, value.metricCode),
                      value: formatValue(value.value, value.unit || unitOf(value.metricCode)),
                    }),
                  )
                  .join(' · ')}
              </span>
              {entry.issues.map((issue) => (
                <span key={issue} className="sp-td-msg sp-td-msg--warning">
                  <Icon name="warning" />
                  <span>{t(`testDay.protocolIssue.${issue}`)}</span>
                </span>
              ))}
              {entry.voided === null ? (
                props.canWrite ? (
                  <Button
                    variant="ghost"
                    aria-label={t('testDay.entry.voidLabel', {
                      number: entry.attemptNumber ?? 1,
                      player: name,
                    })}
                    onClick={() => {
                      setVoiding(entry.id);
                      setDone(null);
                    }}
                  >
                    {t('testDay.entry.void')}
                  </Button>
                ) : null
              ) : (
                <span className="sp-td-meta">
                  {t('testDay.entry.voided', { reason: entry.voided.reason })}
                </span>
              )}
              {voiding === entry.id ? (
                <form
                  className="sp-td-inline-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const text = reason.trim();
                    if (text === '') return;
                    voidEntry.mutate({ entryId: entry.id, reason: text });
                  }}
                >
                  <TextField
                    label={t('testDay.void.reason')}
                    value={reason}
                    maxLength={500}
                    required
                    onChange={(event) => {
                      setReason(event.currentTarget.value);
                    }}
                  />
                  <Button type="submit" variant="secondary" disabled={voidEntry.isPending}>
                    {t('testDay.void.confirm')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setVoiding(null);
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {voidEntry.error === null ? null : <ErrorNotice error={voidEntry.error} />}
      {addEntries.error === null ? null : <ErrorNotice error={addEntries.error} />}
      {done === null ? null : (
        <p className="sp-td-msg" role="status">
          <Icon name="ok" />
          <span>{t(done === 'voided' ? 'testDay.void.done' : 'testDay.addAttempt.done')}</span>
        </p>
      )}
      {result.status === 'done' && props.canWrite ? (
        adding ? (
          <form
            className="sp-td-inline-form"
            aria-label={t('testDay.addAttempt.label', { number: attemptNumber, player: name })}
            onSubmit={(event) => {
              event.preventDefault();
              submitAttempt();
            }}
          >
            {fields
              .filter((field) => fieldAllowed(field, props.context.mode, player.strengthAssessment))
              .map((field) => (
                <label key={field.key} className="sp-td-cell">
                  <span className="sp-td-cell__label">{fieldLabel(t, field.key)}</span>
                  <input
                    className="sp-td-input"
                    inputMode={field.integer ? 'numeric' : 'decimal'}
                    autoComplete="off"
                    value={values[field.key] ?? ''}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setValues((v) => ({ ...v, [field.key]: value }));
                    }}
                  />
                </label>
              ))}
            <Button type="submit" variant="secondary" disabled={addEntries.isPending}>
              {t('testDay.addAttempt.save')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
              }}
            >
              {t('common.cancel')}
            </Button>
            {addProblem === null ? null : (
              <p className="sp-td-msg sp-td-msg--critical" role="alert">
                <Icon name="critical" />
                <span>{addProblem}</span>
              </p>
            )}
          </form>
        ) : (
          <Button
            variant="ghost"
            aria-label={t('testDay.addAttempt.label', { number: attemptNumber, player: name })}
            onClick={() => {
              setAdding(true);
              setDone(null);
            }}
          >
            {t('testDay.addAttempt')}
          </Button>
        )
      ) : null}
    </div>
  );
}
