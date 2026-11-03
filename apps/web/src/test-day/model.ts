import {
  attemptMetricValues,
  attemptPlausibilityWarnings,
  notDoneReasonView,
  parseAttempt,
  scoreAttemptValues,
  STAFF_METHODS,
  type EntryMode,
  type FieldPlausibilityWarning,
  type FieldProblem,
  type NotDoneReasonView,
  type ParsedAttempt,
  type PreviewScore,
  type TestDaySheetPlayer,
  type TestDaySheetStation,
  type TestEntryInputPayload,
  type TestResult,
  type TestSessionResultInput,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  TEST_NOT_DONE_REASONS,
  type LocalDate,
  type MeasurementMethod,
  type Role,
  type TestNotDoneReason,
} from '@sport-performance/domain';

/**
 * The test day sheet as the staff types it (B-405): how each station is
 * entered (fields per attempt), the draft of each row, its parsing into the
 * entries of the API (ADR 0039), the preview of the scores with the same
 * domain formulas the server uses, the best attempt, the plausibility
 * warnings and the batch of a station. Pure functions, no React.
 */

// The rules of each entry mode are shared with the field app (B-505):
// `@sport-performance/contracts` (`test-day/entry.ts`).
export {
  defaultMethodOf,
  entryModesOf,
  fieldAllowed,
  fieldsOf,
  notDoneReasonView,
  parseAttempt,
  valueMetricsOf,
  type EntryMode,
  type FieldProblem,
  type FieldSpec,
  type NotDoneReasonView,
  type ParsedAttempt,
  type PreviewScore,
} from '@sport-performance/contracts';

// ─── Not-done reasons of a row ───────────────────────────────────────────────────────

/** One option of the not-done reason of a row: what is sent and how the viewer reads it. */
export interface NotDoneReasonOption {
  readonly reason: TestNotDoneReason;
  readonly view: NotDoneReasonView;
}

/**
 * The not-done reasons a row offers, in order, with the label the viewer
 * reads (`notDoneReasonView`): a player outside the battery of their stage
 * only takes `not_applicable_to_stage`; otherwise every reason, `injured`
 * labelled «No disponible» for all but medical (and still sent as `injured`).
 */
export function notDoneReasonOptions(
  applicable: boolean,
  viewer: Role,
): readonly NotDoneReasonOption[] {
  const reasons: readonly TestNotDoneReason[] = applicable
    ? TEST_NOT_DONE_REASONS
    : ['not_applicable_to_stage'];
  return reasons.map((reason) => ({ reason, view: notDoneReasonView(reason, viewer) }));
}

// ─── Drafts ──────────────────────────────────────────────────────────────────────────

/** Methods the staff picks on the web (`historical` is only for imports). */
export const WEB_METHODS = STAFF_METHODS;

export interface RowDraft {
  /** `clientUuid` of the result: the same on every retry, so the batch never duplicates. */
  readonly clientUuid: string;
  readonly status: 'done' | 'not_done';
  /** Typed text per attempt and field key (es-AR, decimal comma). */
  readonly attempts: readonly Readonly<Record<string, string>>[];
  /** `clientUuid` of each entry, per attempt and field key (or `entry` for raw kinds). */
  readonly entryUuids: readonly Readonly<Record<string, string>>[];
  readonly method: MeasurementMethod;
  readonly reason: TestNotDoneReason | null;
  readonly note: string;
  /**
   * The batch input of the row the first time it was sent (JSON), kept while
   * unconfirmed: a retry that comes back `replayed` with a different input
   * means the saved result lacks the edits made since.
   */
  readonly firstSent: string | null;
}

export function emptyDraft(
  attemptCount: number,
  method: MeasurementMethod,
  uuid: () => string = () => crypto.randomUUID(),
): RowDraft {
  return {
    clientUuid: uuid(),
    status: 'done',
    attempts: Array.from({ length: attemptCount }, () => ({})),
    entryUuids: Array.from({ length: attemptCount }, () => ({})),
    method,
    reason: null,
    note: '',
    firstSent: null,
  };
}

/** Something was typed or chosen in the row (worth saving or warning about). */
export function isDirty(draft: RowDraft): boolean {
  if (draft.status === 'not_done') return true;
  return draft.attempts.some((attempt) => Object.values(attempt).some((v) => v.trim() !== ''));
}

// ─── Preview: scores, best attempt, plausibility ─────────────────────────────────────

export interface RowPreview {
  readonly attempts: readonly ParsedAttempt[];
  readonly scores: readonly PreviewScore[];
  /** Best attempt (index) of each metric scored by `best`; absent for `mean`. */
  readonly bestAttempt: ReadonlyMap<string, number>;
  /** Advisory warnings: out of the plausible range, by attempt and field key. */
  readonly warnings: readonly PlausibilityWarning[];
}

export interface PlausibilityWarning extends FieldPlausibilityWarning {
  readonly attempt: number;
}

/**
 * The preview of a row with the domain formulas: every attempt parsed, the
 * score of each metric (with the result-level derived ones, such as the 505
 * asymmetry), the best attempt of each metric and the plausibility warnings
 * for the player's sex and age on the day. Never blocks: the server decides.
 */
export function previewRow(
  station: TestDaySheetStation,
  mode: EntryMode,
  draft: RowDraft,
  player: Pick<TestDaySheetPlayer, 'sex' | 'birthDate' | 'strengthAssessment'>,
  day: LocalDate,
): RowPreview {
  const attempts = draft.attempts.map((values) =>
    parseAttempt(station, mode, values, player.strengthAssessment),
  );
  const values = attempts.flatMap((parsed, index) =>
    parsed.status === 'ok'
      ? attemptMetricValues(station, parsed).map((value) => ({
          ...value,
          attemptNumber: index + 1,
        }))
      : [],
  );
  const scored = scoreAttemptValues(station, values);
  const bestAttempt = new Map(
    [...scored.bestAttempt].map(([metricCode, attemptNumber]) => [metricCode, attemptNumber - 1]),
  );
  const warnings = attempts.flatMap((parsed, index) =>
    attemptPlausibilityWarnings(station, mode, parsed, player, day).map((warning) => ({
      ...warning,
      attempt: index,
    })),
  );
  return { attempts, scores: scored.scores, bestAttempt, warnings };
}

// ─── The batch of a station ──────────────────────────────────────────────────────────

export interface StationContext {
  readonly station: TestDaySheetStation;
  readonly mode: EntryMode;
  /** Strength exercise of the station (`snake_case`), required by the API for strength. */
  readonly exercise: string | null;
  readonly deviceId: string | null;
}

export type RowProblem =
  | {
      readonly kind: 'attempt';
      readonly attempt: number;
      readonly fieldKey: string | null;
      readonly problem: FieldProblem | 'domain';
    }
  | { readonly kind: 'note' }
  | { readonly kind: 'reason' }
  | { readonly kind: 'exercise' }
  | { readonly kind: 'device' };

/** Draft entries of one attempt with their stable `clientUuid`s. */
function entriesOf(
  parsed: Extract<ParsedAttempt, { status: 'ok' }>,
  attempt: number,
  uuids: Readonly<Record<string, string>>,
  uuid: () => string,
): { entries: TestEntryInputPayload[]; uuids: Record<string, string> } {
  const next: Record<string, string> = { ...uuids };
  const entries = parsed.entries.map(({ key, entry }) => {
    const clientUuid = (next[key] ??= uuid());
    return { ...entry, clientUuid, attemptNumber: attempt + 1 };
  });
  return { entries, uuids: next };
}

export type BuiltRow =
  | { readonly kind: 'skip' }
  | { readonly kind: 'problems'; readonly problems: readonly RowProblem[] }
  | {
      readonly kind: 'result';
      readonly input: TestSessionResultInput;
      /** The draft with the `clientUuid`s it used (kept for a retry). */
      readonly draft: RowDraft;
    };

/**
 * One result of the batch from a row: `skip` when nothing was typed, the
 * problems to fix, or the result with stable `clientUuid`s.
 */
export function buildRow(
  context: StationContext,
  player: Pick<TestDaySheetPlayer, 'id' | 'strengthAssessment'>,
  draft: RowDraft,
  uuid: () => string = () => crypto.randomUUID(),
): BuiltRow {
  const { station, mode } = context;
  const definitionId = station.definition.id;
  if (draft.status === 'not_done') {
    if (draft.reason === null) return { kind: 'problems', problems: [{ kind: 'reason' }] };
    // The note is only typed (and shown) for «Otro motivo»: one left in the
    // draft after switching to another reason is hidden, so it is never sent.
    const note = draft.reason === 'other' ? draft.note.trim() : '';
    if (draft.reason === 'other' && note === '')
      return { kind: 'problems', problems: [{ kind: 'note' }] };
    return {
      kind: 'result',
      draft,
      input: {
        clientUuid: draft.clientUuid,
        status: 'not_done',
        playerId: player.id,
        testDefinitionId: definitionId,
        notDoneReason: draft.reason,
        ...(note === '' ? {} : { notDoneNote: note }),
      },
    };
  }
  const problems: RowProblem[] = [];
  const entries: TestEntryInputPayload[] = [];
  const entryUuids: Record<string, string>[] = [];
  draft.attempts.forEach((values, attempt) => {
    const parsed = parseAttempt(station, mode, values, player.strengthAssessment);
    const uuids = draft.entryUuids[attempt] ?? {};
    if (parsed.status === 'invalid') {
      problems.push({
        kind: 'attempt',
        attempt,
        fieldKey: parsed.fieldKey,
        problem: parsed.problem,
      });
      entryUuids.push({ ...uuids });
      return;
    }
    if (parsed.status === 'empty') {
      entryUuids.push({ ...uuids });
      return;
    }
    const built = entriesOf(parsed, attempt, uuids, uuid);
    entries.push(...built.entries);
    entryUuids.push(built.uuids);
  });
  if (problems.length > 0) return { kind: 'problems', problems };
  if (entries.length === 0) return { kind: 'skip' };
  if (station.testCode === 'strength' && context.exercise === null)
    problems.push({ kind: 'exercise' });
  if (station.definition.sameDeviceOnly && context.deviceId === null)
    problems.push({ kind: 'device' });
  if (problems.length > 0) return { kind: 'problems', problems };
  return {
    kind: 'result',
    draft: { ...draft, entryUuids },
    input: {
      clientUuid: draft.clientUuid,
      status: 'done',
      playerId: player.id,
      testDefinitionId: definitionId,
      method: draft.method,
      entries,
      ...(context.exercise === null || station.testCode !== 'strength'
        ? {}
        : { exercise: context.exercise }),
      ...(station.definition.sameDeviceOnly && context.deviceId !== null
        ? { deviceId: context.deviceId }
        : {}),
    },
  };
}

/** Entries to add to a recorded result (one more attempt), with their `clientUuid`s. */
export function buildAddedAttempt(
  context: StationContext,
  player: Pick<TestDaySheetPlayer, 'strengthAssessment'>,
  values: Readonly<Record<string, string>>,
  attemptNumber: number,
  uuids: Readonly<Record<string, string>>,
  uuid: () => string = () => crypto.randomUUID(),
):
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'invalid';
      readonly fieldKey: string | null;
      readonly problem: FieldProblem | 'domain';
    }
  | {
      readonly kind: 'entries';
      readonly entries: TestEntryInputPayload[];
      readonly uuids: Record<string, string>;
    } {
  const parsed = parseAttempt(context.station, context.mode, values, player.strengthAssessment);
  if (parsed.status === 'empty') return { kind: 'empty' };
  if (parsed.status === 'invalid')
    return { kind: 'invalid', fieldKey: parsed.fieldKey, problem: parsed.problem };
  const built = entriesOf(parsed, attemptNumber - 1, uuids, uuid);
  return { kind: 'entries', ...built };
}

/** Next attempt number of a recorded result. */
export function nextAttemptNumber(result: Pick<TestResult, 'entries'>): number {
  return result.entries.reduce((max, entry) => Math.max(max, entry.attemptNumber ?? 0), 0) + 1;
}

// ─── Errors of a batch, back to its rows ─────────────────────────────────────────────

/** What a validation issue of the batch is about, for the row's message. */
export type IssueTopic =
  | 'stage'
  | 'entries'
  | 'method'
  | 'device'
  | 'exercise'
  | 'note'
  | 'player'
  | 'definition'
  | 'other';

export function issueTopic(issue: ValidationIssue): IssueTopic {
  const field = issue.path[3];
  if (
    field === 'status' &&
    (issue.code === 'not_in_battery' || issue.code === 'maximal_load_not_allowed')
  ) {
    return 'stage';
  }
  switch (field) {
    case 'entries':
      return 'entries';
    case 'method':
      return 'method';
    case 'deviceId':
      return 'device';
    case 'exercise':
      return 'exercise';
    case 'notDoneNote':
      return 'note';
    case 'playerId':
      return 'player';
    case 'testDefinitionId':
      return 'definition';
    default:
      return 'other';
  }
}

/** A validation issue of the batch on its row: the topic and, for an entry, its attempt and field. */
export interface RowIssue {
  readonly topic: IssueTopic;
  /** Attempt (1-based) of the entry the issue is about, when it is about one. */
  readonly attemptNumber: number | null;
  /** Field key of the sheet (a metric code in value mode, a raw field otherwise). */
  readonly fieldKey: string | null;
}

/** Field key of the sheet for a property of a raw entry (the flight time is typed in ms). */
function sheetFieldKey(property: string | number | undefined): string | null {
  if (typeof property !== 'string') return null;
  return property === 'flightTimeS' ? 'flightTimeMsec' : property;
}

function rowIssueOf(issue: ValidationIssue, sent: TestSessionResultInput | undefined): RowIssue {
  const topic = issueTopic(issue);
  const entryIndex = issue.path[4];
  if (topic !== 'entries' || typeof entryIndex !== 'number' || sent?.status !== 'done') {
    return { topic, attemptNumber: null, fieldKey: null };
  }
  const entry = sent.entries[entryIndex];
  if (entry === undefined) return { topic, attemptNumber: null, fieldKey: null };
  const property = issue.path[5];
  return {
    topic,
    attemptNumber: entry.attemptNumber ?? null,
    fieldKey:
      entry.kind === 'value'
        ? entry.metricCode
        : property === 'kind'
          ? null
          : sheetFieldKey(property),
  };
}

/**
 * The issues of `POST …/results`, by player of the batch (`body.results[i]`
 * is the i-th row sent); an issue of an entry (`…entries[j]`) goes back to
 * its attempt and field through the entry sent. Issues of the request itself
 * go under `null`.
 */
export function issuesByPlayer(
  issues: readonly ValidationIssue[],
  sent: readonly { readonly playerId: string; readonly input: TestSessionResultInput }[],
): Map<string | null, RowIssue[]> {
  const result = new Map<string | null, RowIssue[]>();
  for (const issue of issues) {
    const [root, list, index] = issue.path;
    const row =
      root === 'body' && list === 'results' && typeof index === 'number' ? sent[index] : undefined;
    const playerId = row?.playerId ?? null;
    const rowIssues = result.get(playerId) ?? [];
    const next = rowIssueOf(issue, row?.input);
    if (
      !rowIssues.some(
        (other) =>
          other.topic === next.topic &&
          other.attemptNumber === next.attemptNumber &&
          other.fieldKey === next.fieldKey,
      )
    ) {
      rowIssues.push(next);
    }
    result.set(playerId, rowIssues);
  }
  return result;
}
