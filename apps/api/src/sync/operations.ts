import {
  addTestResultEntries,
  archiveExternalLoad,
  correctExternalLoad,
  correctGymSet,
  correctWellness,
  createTestResult,
  recordParticipations,
  recordTestSessionResults,
  reportExternalLoad,
  submitPainReport,
  submitSessionRpe,
  submitWellness,
  updateParticipation,
  updateTestResult,
  voidGymSet,
  voidTestResultEntries,
  logGymSets,
  recordAnthroMeasurements,
  updateAnthroMeasurement,
  type EndpointDefinition,
  type SyncOperationInput,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  anthroMeasurement,
  externalLoad,
  gymSet,
  participation,
  syncChange,
  testResult,
  wellness,
} from '@sport-performance/db/schema';
import {
  WELLNESS_ITEMS,
  compareHlc,
  participationCarriesLoad,
  type ClubId,
  type ParticipationStatus,
  type SyncFieldColumn,
  type SyncFieldTable,
  type SyncOperation,
} from '@sport-performance/domain';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { TenantDatabase } from '../db/database.js';
import { HttpError } from '../http/errors.js';
import type { RequestPermissions } from '../http/permissions.js';
import { rowVersion } from '../http/writes.js';
import { lockKeys, participationKey } from './locks.js';

/**
 * How each sync operation becomes a call of its online endpoint (ADR 0050):
 * which endpoint, with which params and body, after resolving the target row
 * (by id or by the `clientUuid` it was created with) and, for edits, the
 * fields whose clock wins. The handler of the endpoint does the rest, as
 * online.
 */

/** One call of an online endpoint, with the raw input its contract validates. */
export interface EndpointCall {
  readonly endpoint: EndpointDefinition;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
}

/** Winning fields of an existing row: stamped with the mutation's clock after the call. */
export interface FieldStamp {
  readonly collection: SyncFieldTable;
  readonly rowId: string;
  readonly columns: readonly string[];
}

/** What a call wrote, as the push stamps and reports it. */
export interface Settlement {
  readonly stamps: readonly FieldStamp[];
  readonly appliedFields: readonly string[];
  readonly supersededFields: readonly string[];
  /** The handler replayed every row by its `clientUuid` and wrote nothing. */
  readonly replayed: boolean;
}

export interface Resolution {
  readonly call: EndpointCall;
  /**
   * Every field lost against a later clock (superseded, nothing to write):
   * the call carries the edit as if it won and runs only to answer what the
   * endpoint would online (permissions, consents, validation), then it is
   * rolled back.
   */
  readonly checkOnly: boolean;
  readonly stamps: readonly FieldStamp[];
  readonly appliedFields: readonly string[];
  readonly supersededFields: readonly string[];
  /**
   * What the call actually wrote, from the handler's output: only those rows
   * are stamped and reported (a row the handler replayed by its `clientUuid`
   * wrote nothing). Without it, the resolution is taken as is.
   */
  readonly settle?: (output: unknown) => Settlement;
}

export interface ResolveContext {
  readonly db: TenantDatabase;
  readonly clubId: ClubId;
  /** The mutation's clock, already clamped to the server's time. */
  readonly hlc: string;
  readonly permissions: RequestPermissions;
  /** Where the mutation is in the push body (`['body', 'mutations', i]`), for the issues. */
  readonly path: readonly (string | number)[];
}

type Resolver<Op extends SyncOperation> = (
  input: SyncOperationInput<Op>,
  ctx: ResolveContext,
) => Promise<Resolution>;

function invalid(path: (string | number)[], message: string): never {
  throw new HttpError('validation_failed', 'The mutation does not match the contract', {
    details: [{ path, code: 'custom', message } satisfies ValidationIssue],
  });
}

function create(call: EndpointCall): Resolution {
  return { call, checkOnly: false, stamps: [], appliedFields: [], supersededFields: [] };
}

/**
 * Locks rows with field clocks (`FOR NO KEY UPDATE`, in id order) before the
 * resolver reads their version, values and clocks: a concurrent push or
 * online edit commits before, or waits until this push ends.
 */
async function lockRows(db: TenantDatabase, collection: SyncFieldTable, ids: readonly string[]) {
  if (ids.length === 0) return;
  await db.execute(
    sql`select app.sync_lock_rows(${collection}, ${`{${[...ids].sort().join(',')}}`}::uuid[])`,
  );
}

/** Creates carry their `clientUuid`: the row comes back in a pull and is reconciled by it. */
function requireClientUuid(body: { clientUuid?: string | undefined }, path: (string | number)[]) {
  if (body.clientUuid === undefined) {
    invalid([...path, 'clientUuid'], 'A create of the offline queue carries its clientUuid');
  }
}

/** Tables whose rows the offline queue edits. */
type EditedTable =
  | typeof wellness
  | typeof participation
  | typeof testResult
  | typeof gymSet
  | typeof anthroMeasurement
  | typeof externalLoad;

/**
 * The id of the row a mutation edits, visible to the caller (RLS): by `id`
 * or by the `clientUuid` it was created with. Not visible: `404`, as online.
 */
async function targetId(
  db: TenantDatabase,
  table: EditedTable,
  clubId: ClubId,
  target: { id: string } | { clientUuid: string },
  resource: string,
): Promise<string> {
  const rows = await db
    .select({ id: sql<string>`${table.id}` })
    .from(table)
    .where(
      and(
        eq(table.clubId, clubId),
        'id' in target ? eq(table.id, target.id) : eq(table.clientUuid, target.clientUuid),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new HttpError('not_found', `${resource} not found`);
  return row.id;
}

/**
 * Clocks of the fields of rows, by row id (`{}` for a row without clocks yet):
 * from the live entry of each row (the marks of scopes it left are not read).
 */
async function fieldClocks(
  db: TenantDatabase,
  clubId: ClubId,
  collection: SyncFieldTable,
  rowIds: readonly string[],
): Promise<Map<string, Readonly<Record<string, string>>>> {
  if (rowIds.length === 0) return new Map();
  const rows = await db
    .select({ rowId: syncChange.rowId, fieldHlc: syncChange.fieldHlc })
    .from(syncChange)
    .where(
      and(
        eq(syncChange.clubId, clubId),
        eq(syncChange.collection, collection),
        inArray(syncChange.rowId, [...rowIds]),
        eq(syncChange.deleted, false),
      ),
    );
  return new Map(rows.map((row) => [row.rowId, row.fieldHlc]));
}

/** Whether a field edited at `hlc` wins against its stored clock (none: it wins). */
function wins(clocks: Readonly<Record<string, string>> | undefined, column: string, hlc: string) {
  const stored = clocks?.[column];
  return stored === undefined || compareHlc(hlc, stored) > 0;
}

interface FieldSplit<Key extends string> {
  readonly winners: Key[];
  readonly losers: Key[];
}

/** Splits the edited fields (API names) into those whose clock wins and those that lose. */
function splitFields<T extends SyncFieldTable, Key extends string>(
  clocks: Readonly<Record<string, string>> | undefined,
  hlc: string,
  edited: readonly Key[],
  columnOf: (key: Key) => SyncFieldColumn<T>,
): FieldSplit<Key> {
  const winners: Key[] = [];
  const losers: Key[] = [];
  for (const key of edited) (wins(clocks, columnOf(key), hlc) ? winners : losers).push(key);
  return { winners, losers };
}

/** Keys of `body` that are set (`undefined` is "not edited"; `null` is a value). */
function editedKeys<Key extends string>(body: Partial<Record<Key, unknown>>, keys: readonly Key[]) {
  return keys.filter((key) => body[key] !== undefined);
}

// ─── Wellness ────────────────────────────────────────────────────────────────────────

const wellnessSubmit: Resolver<'wellness.submit'> = async ({ body }, ctx) => {
  requireClientUuid(body, [...ctx.path, 'body']);
  return Promise.resolve(create({ endpoint: submitWellness, body }));
};

const wellnessCorrect: Resolver<'wellness.correct'> = async ({ target, body }, ctx) => {
  const id = await targetId(ctx.db, wellness, ctx.clubId, target, 'Wellness entry');
  await lockRows(ctx.db, 'wellness', [id]);
  const [current] = await ctx.db
    .select({
      version: rowVersion(wellness.updatedAt),
      sleep: wellness.sleep,
      fatigue: wellness.fatigue,
      soreness: wellness.soreness,
      stress: wellness.stress,
      mood: wellness.mood,
    })
    .from(wellness)
    .where(and(eq(wellness.clubId, ctx.clubId), eq(wellness.id, id)));
  if (current === undefined) throw new HttpError('not_found', 'Wellness entry not found');
  const clocks = (await fieldClocks(ctx.db, ctx.clubId, 'wellness', [id])).get(id);
  const edited = editedKeys(body.scores, WELLNESS_ITEMS);
  const { winners, losers } = splitFields<'wellness', (typeof edited)[number]>(
    clocks,
    ctx.hlc,
    edited,
    (item) => item,
  );
  const superseded = losers.map((item) => `scores.${item}`);
  const checkOnly = winners.length === 0;
  // The answer as stored, with the winning items of the mutation on top (all of them to check).
  const scores: Partial<Record<(typeof WELLNESS_ITEMS)[number], number>> = {};
  for (const item of WELLNESS_ITEMS) {
    const stored = current[item];
    if (stored !== null) scores[item] = stored;
  }
  for (const item of checkOnly ? edited : winners) {
    const value = body.scores[item];
    if (value !== undefined) scores[item] = value;
  }
  return {
    call: {
      endpoint: correctWellness,
      params: { wellnessId: id },
      body: {
        version: current.version,
        ...(body.changeReason !== undefined && { changeReason: body.changeReason }),
        scores,
      },
    },
    checkOnly,
    stamps: checkOnly ? [] : [{ collection: 'wellness', rowId: id, columns: winners }],
    appliedFields: winners.map((item) => `scores.${item}`),
    supersededFields: superseded,
  };
};

// ─── Training: RPE and participation ─────────────────────────────────────────────────

const PARTICIPATION_FIELDS = ['status', 'minutes', 'contactsN'] as const;
type ParticipationField = (typeof PARTICIPATION_FIELDS)[number];
const participationColumn = (field: ParticipationField): SyncFieldColumn<'participation'> =>
  field === 'contactsN' ? 'contacts_n' : field;

/** Fields of a participation that only a status with load carries (ADR 0037). */
const LOAD_FIELDS: readonly ParticipationField[] = ['minutes', 'contactsN'];

/**
 * A status without load (`absent`, `unavailable`) that stays (the stored one,
 * because the mutation's lost or did not come) takes the load fields of the
 * mutation down with it: they lose too, whatever their clocks (ADR 0050). A
 * stored `absent` has its minutes and contacts empty and without a clock (an
 * empty field of an insert is not a write), so on their own they would win
 * and leave a row that is `absent` with minutes, which the endpoint rejects.
 * Superseded, like the status: the device learns the row stays as it is.
 */
function loadFollowsStatus(
  split: FieldSplit<ParticipationField>,
  storedStatus: ParticipationStatus,
): FieldSplit<ParticipationField> {
  if (split.winners.includes('status') || participationCarriesLoad(storedStatus)) return split;
  const dropped = split.winners.filter((field) => LOAD_FIELDS.includes(field));
  if (dropped.length === 0) return split;
  return {
    winners: split.winners.filter((field) => !LOAD_FIELDS.includes(field)),
    // In the order of the fields, as `splitFields` answers them.
    losers: PARTICIPATION_FIELDS.filter(
      (field) => split.losers.includes(field) || dropped.includes(field),
    ),
  };
}

const rpeSubmit: Resolver<'rpe.submit'> = async ({ params, body }, ctx) => {
  const subject = await ctx.permissions.subject();
  const playerId = subject.playerId ?? null;
  const call: EndpointCall = { endpoint: submitSessionRpe, params, body };
  // Not a player: the handler answers what the matrix says.
  if (playerId === null) return create(call);
  // Also when it does not exist yet: a concurrent push of the same RPE waits.
  await lockKeys(ctx.db, [participationKey(params.trainingSessionId, playerId)]);
  const [existing] = await ctx.db
    .select({ id: participation.id, clientUuid: participation.clientUuid })
    .from(participation)
    .where(
      and(
        eq(participation.clubId, ctx.clubId),
        eq(participation.trainingSessionId, params.trainingSessionId),
        eq(participation.playerId, playerId),
      ),
    );
  // Not loaded yet: the handler creates it, and its insert stamps the fields.
  if (existing === undefined) return create(call);
  await lockRows(ctx.db, 'participation', [existing.id]);
  // The device reuses the clientUuid the participation was created with: online that is a
  // replay of the create and writes nothing, but here it is another mutation (a resend has
  // the same mutationId and never gets here), so an edit of the row, resolved by its clock.
  const { clientUuid, ...edit } = body;
  const editCall: EndpointCall =
    clientUuid !== undefined && clientUuid === existing.clientUuid
      ? { endpoint: submitSessionRpe, params, body: edit }
      : call;
  const clocks = (await fieldClocks(ctx.db, ctx.clubId, 'participation', [existing.id])).get(
    existing.id,
  );
  if (!wins(clocks, 'rpe', ctx.hlc)) {
    return {
      call: editCall,
      checkOnly: true,
      stamps: [],
      appliedFields: [],
      supersededFields: ['rpe'],
    };
  }
  return {
    call: editCall,
    checkOnly: false,
    stamps: [{ collection: 'participation', rowId: existing.id, columns: ['rpe'] }],
    appliedFields: ['rpe'],
    supersededFields: [],
  };
};

const participationUpdate: Resolver<'participation.update'> = async ({ target, body }, ctx) => {
  const id = await targetId(ctx.db, participation, ctx.clubId, target, 'Participation');
  await lockRows(ctx.db, 'participation', [id]);
  const [current] = await ctx.db
    .select({ version: rowVersion(participation.updatedAt), status: participation.status })
    .from(participation)
    .where(and(eq(participation.clubId, ctx.clubId), eq(participation.id, id)));
  if (current === undefined) throw new HttpError('not_found', 'Participation not found');
  const clocks = (await fieldClocks(ctx.db, ctx.clubId, 'participation', [id])).get(id);
  const edited = editedKeys(body, PARTICIPATION_FIELDS);
  const { winners, losers } = loadFollowsStatus(
    splitFields<'participation', ParticipationField>(clocks, ctx.hlc, edited, participationColumn),
    current.status,
  );
  const checkOnly = winners.length === 0;
  const sent = checkOnly ? edited : winners;
  const fields = Object.fromEntries(sent.map((field) => [field, body[field]]));
  return {
    checkOnly,
    call: {
      endpoint: updateParticipation,
      params: { participationId: id },
      body: {
        version: current.version,
        ...(body.changeReason !== undefined && { changeReason: body.changeReason }),
        ...fields,
      },
    },
    stamps: checkOnly
      ? []
      : [{ collection: 'participation', rowId: id, columns: winners.map(participationColumn) }],
    appliedFields: winners,
    supersededFields: losers,
  };
};

const participationRecord: Resolver<'participation.record'> = async ({ params, body }, ctx) => {
  const playerIds = body.rows.map((row) => row.playerId);
  // The rows of the batch, existing or not, before reading them: a concurrent batch waits.
  await lockKeys(
    ctx.db,
    playerIds.map((playerId) => participationKey(params.trainingSessionId, playerId)),
  );
  const ofSession = and(
    eq(participation.clubId, ctx.clubId),
    eq(participation.trainingSessionId, params.trainingSessionId),
    inArray(participation.playerId, playerIds),
  );
  const ids = await ctx.db.select({ id: participation.id }).from(participation).where(ofSession);
  await lockRows(
    ctx.db,
    'participation',
    ids.map((row) => row.id),
  );
  const existing = await ctx.db
    .select({
      id: participation.id,
      clientUuid: participation.clientUuid,
      playerId: participation.playerId,
      status: participation.status,
    })
    .from(participation)
    .where(ofSession);
  const byPlayer = new Map(existing.map((row) => [row.playerId, row]));
  const clocks = await fieldClocks(
    ctx.db,
    ctx.clubId,
    'participation',
    existing.map((row) => row.id),
  );
  // By row of the batch, so the rows the handler did not write can be dropped after the call.
  const appliedFields: { index: number; field: string }[] = [];
  const supersededFields: string[] = [];
  const stamps: { index: number; stamp: FieldStamp }[] = [];
  const resolved = body.rows.map((row, index) => {
    // The clock replaces the version precondition of the online batch: no `version`.
    const fields = {
      clientUuid: row.clientUuid,
      playerId: row.playerId,
      status: row.status,
      ...(row.minutes !== undefined && { minutes: row.minutes }),
      ...(row.contactsN !== undefined && { contactsN: row.contactsN }),
    };
    const current = byPlayer.get(row.playerId);
    if (current === undefined) {
      // A new participation: its insert stamps every field.
      appliedFields.push({ index, field: `rows.${String(index)}` });
      return { fields, current, edited: PARTICIPATION_FIELDS, winners: PARTICIPATION_FIELDS };
    }
    const edited = editedKeys(fields, PARTICIPATION_FIELDS);
    const { winners, losers } = loadFollowsStatus(
      splitFields<'participation', ParticipationField>(
        clocks.get(current.id),
        ctx.hlc,
        edited,
        participationColumn,
      ),
      current.status,
    );
    appliedFields.push(
      ...winners.map((field) => ({ index, field: `rows.${String(index)}.${field}` })),
    );
    supersededFields.push(...losers.map((field) => `rows.${String(index)}.${field}`));
    if (winners.length > 0) {
      stamps.push({
        index,
        stamp: {
          collection: 'participation',
          rowId: current.id,
          columns: winners.map(participationColumn),
        },
      });
    }
    return { fields, current, edited, winners };
  });
  // Nothing new and every edited field lost: superseded, the whole batch only checked.
  const checkOnly = appliedFields.length === 0;
  const rows = resolved.map(({ fields, current, edited, winners }) => {
    if (current === undefined) return fields;
    const sent: readonly ParticipationField[] = checkOnly ? edited : winners;
    // A row keeps its status (required by the contract) and only its winning fields.
    return {
      // The clientUuid the row was created with, reused by the device: online a replay of the
      // create that writes nothing; here an edit (a resend has the same mutationId and never
      // gets here). A fresh one, which the update of an existing row does not store.
      clientUuid: fields.clientUuid === current.clientUuid ? randomUUID() : fields.clientUuid,
      playerId: fields.playerId,
      status: sent.includes('status') ? fields.status : current.status,
      ...(sent.includes('minutes') && { minutes: fields.minutes }),
      ...(sent.includes('contactsN') && { contactsN: fields.contactsN }),
    };
  });
  return {
    checkOnly,
    call: {
      endpoint: recordParticipations,
      params,
      body: {
        ...(body.changeReason !== undefined && { changeReason: body.changeReason }),
        rows,
      },
    },
    stamps: stamps.map(({ stamp }) => stamp),
    appliedFields: appliedFields.map(({ field }) => field),
    supersededFields,
    settle: (output) => {
      // Defense in depth: a row the handler replayed by its clientUuid wrote nothing.
      const items = (output as { items: readonly { outcome: string }[] }).items;
      const replayedRows = new Set(
        items.flatMap((item, index) => (item.outcome === 'replayed' ? [index] : [])),
      );
      return {
        stamps: stamps.filter(({ index }) => !replayedRows.has(index)).map(({ stamp }) => stamp),
        appliedFields: appliedFields
          .filter(({ index }) => !replayedRows.has(index))
          .map(({ field }) => field),
        supersededFields,
        replayed: items.length > 0 && replayedRows.size === items.length,
      };
    },
  };
};

// ─── Tests ───────────────────────────────────────────────────────────────────────────

const RESULT_FIELDS = [
  'measuredOn',
  'status',
  'notDoneReason',
  'notDoneNote',
  'method',
  'evaluatorId',
  'deviceId',
  'exercise',
  'conditions',
  'notes',
] as const;
type ResultField = (typeof RESULT_FIELDS)[number];
const RESULT_COLUMNS: Record<ResultField, SyncFieldColumn<'test_result'>> = {
  measuredOn: 'measured_on',
  status: 'status',
  notDoneReason: 'not_done_reason',
  notDoneNote: 'not_done_note',
  method: 'method',
  evaluatorId: 'evaluator_id',
  deviceId: 'device_id',
  exercise: 'exercise',
  conditions: 'conditions',
  notes: 'notes',
};

const resultTarget = (ctx: ResolveContext, target: { id: string } | { clientUuid: string }) =>
  targetId(ctx.db, testResult, ctx.clubId, target, 'Test result');

const testResultCreate: Resolver<'test_result.create'> = async ({ body }, ctx) => {
  requireClientUuid(body, [...ctx.path, 'body']);
  return Promise.resolve(create({ endpoint: createTestResult, body }));
};

const testSessionRecordResults: Resolver<'test_session.record_results'> = async (
  { params, body },
  ctx,
) => {
  body.results.forEach((result, index) => {
    requireClientUuid(result, [...ctx.path, 'body', 'results', index]);
  });
  return Promise.resolve(create({ endpoint: recordTestSessionResults, params, body }));
};

const testResultUpdate: Resolver<'test_result.update'> = async ({ target, body }, ctx) => {
  const id = await resultTarget(ctx, target);
  await lockRows(ctx.db, 'test_result', [id]);
  const [current] = await ctx.db
    .select({ version: rowVersion(testResult.updatedAt) })
    .from(testResult)
    .where(and(eq(testResult.clubId, ctx.clubId), eq(testResult.id, id)));
  if (current === undefined) throw new HttpError('not_found', 'Test result not found');
  const clocks = (await fieldClocks(ctx.db, ctx.clubId, 'test_result', [id])).get(id);
  const edited = editedKeys(body, RESULT_FIELDS);
  const { winners, losers } = splitFields<'test_result', ResultField>(
    clocks,
    ctx.hlc,
    edited,
    (field) => RESULT_COLUMNS[field],
  );
  const checkOnly = winners.length === 0;
  const sent = checkOnly ? edited : winners;
  const fields = Object.fromEntries(sent.map((field) => [field, body[field]]));
  return {
    checkOnly,
    call: {
      endpoint: updateTestResult,
      params: { testResultId: id },
      body: {
        version: current.version,
        ...(body.changeReason !== undefined && { changeReason: body.changeReason }),
        ...fields,
      },
    },
    stamps: checkOnly
      ? []
      : [{ collection: 'test_result', rowId: id, columns: winners.map((f) => RESULT_COLUMNS[f]) }],
    appliedFields: winners,
    supersededFields: losers,
  };
};

const testResultAddEntries: Resolver<'test_result.add_entries'> = async ({ target, body }, ctx) => {
  const id = await resultTarget(ctx, target);
  // Attempts are only appended (ADR 0015): never in conflict.
  return create({ endpoint: addTestResultEntries, params: { testResultId: id }, body });
};

const testResultVoidEntries: Resolver<'test_result.void_entries'> = async (
  { target, body },
  ctx,
) => {
  const id = await resultTarget(ctx, target);
  // A void is final and idempotent: never in conflict either.
  return create({ endpoint: voidTestResultEntries, params: { testResultId: id }, body });
};

// ─── Gym ─────────────────────────────────────────────────────────────────────────────

const GYM_SET_FIELDS = ['reps', 'loadKg', 'rir', 'techniqueScore', 'durationS', 'notes'] as const;
type GymSetField = (typeof GYM_SET_FIELDS)[number];
const GYM_SET_COLUMNS: Record<GymSetField, SyncFieldColumn<'gym_set'>> = {
  reps: 'reps',
  loadKg: 'load_kg',
  rir: 'rir',
  techniqueScore: 'technique_score',
  durationS: 'duration_s',
  notes: 'notes',
};

const gymSetLog: Resolver<'gym_set.log'> = async ({ body }, ctx) => {
  body.sets.forEach((set, index) => {
    requireClientUuid(set, [...ctx.path, 'body', 'sets', index]);
  });
  return Promise.resolve({
    ...create({ endpoint: logGymSets, body }),
    settle: (output) => {
      const items = (output as { items: readonly { outcome: string }[] }).items;
      return {
        stamps: [],
        appliedFields: [],
        supersededFields: [],
        replayed: items.length > 0 && items.every((item) => item.outcome === 'replayed'),
      };
    },
  });
};

const gymSetCorrect: Resolver<'gym_set.correct'> = async ({ target, body }, ctx) => {
  const id = await targetId(ctx.db, gymSet, ctx.clubId, target, 'Gym set');
  await lockRows(ctx.db, 'gym_set', [id]);
  const [current] = await ctx.db
    .select({ version: rowVersion(gymSet.updatedAt) })
    .from(gymSet)
    .where(and(eq(gymSet.clubId, ctx.clubId), eq(gymSet.id, id)));
  if (current === undefined) throw new HttpError('not_found', 'Gym set not found');
  const clocks = (await fieldClocks(ctx.db, ctx.clubId, 'gym_set', [id])).get(id);
  const edited = editedKeys(body, GYM_SET_FIELDS);
  const { winners, losers } = splitFields<'gym_set', GymSetField>(
    clocks,
    ctx.hlc,
    edited,
    (field) => GYM_SET_COLUMNS[field],
  );
  const checkOnly = winners.length === 0;
  const sent = checkOnly ? edited : winners;
  const fields = Object.fromEntries(sent.map((field) => [field, body[field]]));
  return {
    checkOnly,
    call: {
      endpoint: correctGymSet,
      params: { gymSetId: id },
      body: { version: current.version, changeReason: body.changeReason, ...fields },
    },
    stamps: checkOnly
      ? []
      : [{ collection: 'gym_set', rowId: id, columns: winners.map((f) => GYM_SET_COLUMNS[f]) }],
    appliedFields: winners,
    supersededFields: losers,
  };
};

const gymSetVoid: Resolver<'gym_set.void'> = async ({ target, body }, ctx) => {
  const id = await targetId(ctx.db, gymSet, ctx.clubId, target, 'Gym set');
  // A void is final and idempotent: never in conflict.
  return create({ endpoint: voidGymSet, params: { gymSetId: id }, body });
};

// ─── Pain report (B-609, ADR 0078) ───────────────────────────────────────────────────

const painReportSubmit: Resolver<'pain_report.submit'> = async ({ body }, ctx) => {
  requireClientUuid(body, [...ctx.path, 'body']);
  // Append-only: a create, never in conflict. Replayed by its clientUuid.
  return Promise.resolve(create({ endpoint: submitPainReport, body }));
};

// ─── Anthropometry ───────────────────────────────────────────────────────────────────

const anthroRecord: Resolver<'anthro.record'> = async ({ body }, ctx) => {
  body.measurements.forEach((measurement, index) => {
    requireClientUuid(measurement, [...ctx.path, 'body', 'measurements', index]);
  });
  return Promise.resolve({
    ...create({ endpoint: recordAnthroMeasurements, body }),
    // The batch answers, per measurement, whether it was already there by its clientUuid.
    settle: (output) => {
      const measurements = (output as { measurements: readonly { replayed: boolean }[] })
        .measurements;
      return {
        stamps: [],
        appliedFields: [],
        supersededFields: [],
        replayed: measurements.length > 0 && measurements.every((item) => item.replayed),
      };
    },
  });
};

const ANTHRO_FIELDS = [
  'measuredOn',
  'heightCm',
  'sittingHeightCm',
  'weightKg',
  'skinfoldsSumMm',
  'method',
  'evaluatorId',
  'conditions',
  'notes',
] as const;
type AnthroField = (typeof ANTHRO_FIELDS)[number];
const ANTHRO_COLUMNS: Record<AnthroField, SyncFieldColumn<'anthro_measurement'>> = {
  measuredOn: 'measured_on',
  heightCm: 'height_cm',
  sittingHeightCm: 'sitting_height_cm',
  weightKg: 'weight_kg',
  skinfoldsSumMm: 'skinfolds_sum_mm',
  method: 'method',
  evaluatorId: 'evaluator_id',
  conditions: 'conditions',
  notes: 'notes',
};

const anthroUpdate: Resolver<'anthro.update'> = async ({ target, body }, ctx) => {
  const id = await targetId(ctx.db, anthroMeasurement, ctx.clubId, target, 'Measurement');
  await lockRows(ctx.db, 'anthro_measurement', [id]);
  const [current] = await ctx.db
    .select({ version: rowVersion(anthroMeasurement.updatedAt) })
    .from(anthroMeasurement)
    .where(and(eq(anthroMeasurement.clubId, ctx.clubId), eq(anthroMeasurement.id, id)));
  if (current === undefined) throw new HttpError('not_found', 'Measurement not found');
  const clocks = (await fieldClocks(ctx.db, ctx.clubId, 'anthro_measurement', [id])).get(id);
  const edited = editedKeys(body, ANTHRO_FIELDS);
  const { winners, losers } = splitFields<'anthro_measurement', AnthroField>(
    clocks,
    ctx.hlc,
    edited,
    (field) => ANTHRO_COLUMNS[field],
  );
  const checkOnly = winners.length === 0;
  const sent = checkOnly ? edited : winners;
  const fields = Object.fromEntries(sent.map((field) => [field, body[field]]));
  return {
    checkOnly,
    call: {
      endpoint: updateAnthroMeasurement,
      params: { anthroMeasurementId: id },
      // The reason is required online and offline: a correction of a loaded value (ADR 0030).
      body: { version: current.version, changeReason: body.changeReason, ...fields },
    },
    stamps: checkOnly
      ? []
      : [
          {
            collection: 'anthro_measurement',
            rowId: id,
            columns: winners.map((field) => ANTHRO_COLUMNS[field]),
          },
        ],
    appliedFields: winners,
    supersededFields: losers,
  };
};

// ─── External load (B-511) ───────────────────────────────────────────────────────────

const externalLoadReport: Resolver<'external_load.report'> = async ({ body }, ctx) => {
  requireClientUuid(body, [...ctx.path, 'body']);
  return Promise.resolve(create({ endpoint: reportExternalLoad, body }));
};

const EXTERNAL_LOAD_FIELDS = ['localDate', 'activity', 'detail', 'minutes', 'rpe'] as const;
type ExternalLoadField = (typeof EXTERNAL_LOAD_FIELDS)[number];
const EXTERNAL_LOAD_COLUMNS: Record<ExternalLoadField, SyncFieldColumn<'external_load'>> = {
  localDate: 'local_date',
  activity: 'activity',
  detail: 'detail',
  minutes: 'minutes',
  rpe: 'rpe',
};

const externalLoadTarget = (ctx: ResolveContext, target: { id: string } | { clientUuid: string }) =>
  targetId(ctx.db, externalLoad, ctx.clubId, target, 'External load');

const externalLoadCorrect: Resolver<'external_load.correct'> = async ({ target, body }, ctx) => {
  const id = await externalLoadTarget(ctx, target);
  await lockRows(ctx.db, 'external_load', [id]);
  const [current] = await ctx.db
    .select({ version: rowVersion(externalLoad.updatedAt) })
    .from(externalLoad)
    .where(and(eq(externalLoad.clubId, ctx.clubId), eq(externalLoad.id, id)));
  if (current === undefined) throw new HttpError('not_found', 'External load not found');
  const clocks = (await fieldClocks(ctx.db, ctx.clubId, 'external_load', [id])).get(id);
  const edited = editedKeys(body, EXTERNAL_LOAD_FIELDS);
  const { winners, losers } = splitFields<'external_load', ExternalLoadField>(
    clocks,
    ctx.hlc,
    edited,
    (field) => EXTERNAL_LOAD_COLUMNS[field],
  );
  const checkOnly = winners.length === 0;
  const sent = checkOnly ? edited : winners;
  const fields = Object.fromEntries(sent.map((field) => [field, body[field]]));
  return {
    checkOnly,
    call: {
      endpoint: correctExternalLoad,
      params: { externalLoadId: id },
      // The reason is required online and offline: a correction of a reported value (ADR 0030).
      body: { version: current.version, changeReason: body.changeReason, ...fields },
    },
    stamps: checkOnly
      ? []
      : [
          {
            collection: 'external_load',
            rowId: id,
            columns: winners.map((field) => EXTERNAL_LOAD_COLUMNS[field]),
          },
        ],
    appliedFields: winners,
    supersededFields: losers,
  };
};

const externalLoadArchive: Resolver<'external_load.archive'> = async ({ target }, ctx) => {
  const id = await externalLoadTarget(ctx, target);
  // Archiving is final and idempotent: never in conflict, no clock.
  return create({ endpoint: archiveExternalLoad, params: { externalLoadId: id } });
};

/** The resolver of each operation. */
export const SYNC_RESOLVERS: { readonly [Op in SyncOperation]: Resolver<Op> } = {
  'wellness.submit': wellnessSubmit,
  'wellness.correct': wellnessCorrect,
  'rpe.submit': rpeSubmit,
  'participation.record': participationRecord,
  'participation.update': participationUpdate,
  'test_result.create': testResultCreate,
  'test_session.record_results': testSessionRecordResults,
  'test_result.update': testResultUpdate,
  'test_result.add_entries': testResultAddEntries,
  'test_result.void_entries': testResultVoidEntries,
  'gym_set.log': gymSetLog,
  'gym_set.correct': gymSetCorrect,
  'gym_set.void': gymSetVoid,
  'pain_report.submit': painReportSubmit,
  'anthro.record': anthroRecord,
  'anthro.update': anthroUpdate,
  'external_load.report': externalLoadReport,
  'external_load.correct': externalLoadCorrect,
  'external_load.archive': externalLoadArchive,
};

/** Every endpoint a sync operation may call (all must be registered transactional routes). */
export const SYNC_ENDPOINTS: readonly EndpointDefinition[] = [
  submitWellness,
  correctWellness,
  submitSessionRpe,
  recordParticipations,
  updateParticipation,
  createTestResult,
  recordTestSessionResults,
  updateTestResult,
  addTestResultEntries,
  voidTestResultEntries,
  logGymSets,
  correctGymSet,
  voidGymSet,
  submitPainReport,
  recordAnthroMeasurements,
  updateAnthroMeasurement,
  reportExternalLoad,
  correctExternalLoad,
  archiveExternalLoad,
];
