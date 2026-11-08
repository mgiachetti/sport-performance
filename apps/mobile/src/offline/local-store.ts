import type {
  GymProgram,
  GymSet,
  AnthroMeasurement,
  ExternalLoad,
  Participation,
  PodAssignment,
  SyncChange,
  SyncOperationInput,
  TestResult,
  TestSession,
  TrainingSession,
  Wellness,
} from '@sport-performance/contracts';
import type { SyncCollection, SyncOperation } from '@sport-performance/domain';
import { and, asc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import type { LocalDatabase, LocalDb } from './db/database.ts';
import { mutation, syncedRow, type MutationState } from './db/schema.ts';
import { matchesTarget, type MutationTarget, type TargetableRow } from './operations.ts';
import { applyOverlay } from './overlay.ts';

/** The DTO each collection keeps: the one of its read endpoint (ADR 0050). */
export interface CollectionData {
  readonly wellness: Wellness;
  readonly participation: Participation;
  readonly training_session: TrainingSession;
  readonly test_session: TestSession;
  readonly test_result: TestResult;
  readonly gym_program: GymProgram;
  readonly gym_set: GymSet;
  readonly anthro_measurement: AnthroMeasurement;
  readonly external_load: ExternalLoad;
  readonly pod_assignment: PodAssignment;
}

interface IndexColumns {
  readonly playerId: string | null;
  readonly parentId: string | null;
  readonly categoryId: string | null;
  readonly localDate: string | null;
}

const INDEX_COLUMNS: { readonly [C in SyncCollection]: (data: CollectionData[C]) => IndexColumns } =
  {
    wellness: (row) => ({
      playerId: row.playerId,
      parentId: null,
      categoryId: null,
      localDate: row.localDate,
    }),
    participation: (row) => ({
      playerId: row.playerId,
      parentId: row.trainingSessionId,
      categoryId: null,
      localDate: null,
    }),
    training_session: (row) => ({
      playerId: null,
      parentId: null,
      categoryId: row.categoryId,
      localDate: row.localDate,
    }),
    test_session: (row) => ({
      playerId: null,
      parentId: null,
      categoryId: row.categoryId,
      localDate: row.scheduledOn,
    }),
    test_result: (row) => ({
      playerId: row.playerId,
      parentId: row.testSessionId,
      categoryId: null,
      localDate: row.measuredOn,
    }),
    gym_program: (row) => ({
      playerId: row.playerId,
      parentId: null,
      categoryId: row.categoryId,
      localDate: row.validFrom,
    }),
    gym_set: (row) => ({
      playerId: row.playerId,
      parentId: row.gymProgramId,
      categoryId: null,
      localDate: row.performedOn,
    }),
    anthro_measurement: (row) => ({
      playerId: row.playerId,
      parentId: row.testSessionId,
      categoryId: null,
      localDate: row.measuredOn,
    }),
    external_load: (row) => ({
      playerId: row.playerId,
      parentId: null,
      categoryId: null,
      localDate: row.localDate,
    }),
    pod_assignment: (row) => ({
      playerId: row.playerId,
      parentId: row.trainingSessionId,
      categoryId: null,
      localDate: null,
    }),
  };

export function indexColumnsOf<C extends SyncCollection>(
  collection: C,
  data: CollectionData[C],
): IndexColumns {
  return INDEX_COLUMNS[collection](data);
}

/** A target as stored with its mutation: `seen` once a pull brought its row. */
export interface StoredTarget extends MutationTarget {
  readonly seen?: true;
}

/** A mutation of the queue, as screens and the engine read it. */
export interface QueuedMutation<Op extends SyncOperation = SyncOperation> {
  readonly seq: number;
  readonly mutationId: string;
  readonly op: Op;
  readonly hlc: string;
  readonly input: SyncOperationInput<Op>;
  readonly targets: readonly StoredTarget[];
  readonly state: MutationState;
  readonly attempts: number;
  readonly createdAt: number;
  readonly ackedAt: number | null;
}

export function toQueuedMutation(row: typeof mutation.$inferSelect): QueuedMutation {
  return {
    seq: row.seq,
    mutationId: row.mutationId,
    op: row.op,
    hlc: row.hlc,
    input: JSON.parse(row.input) as SyncOperationInput<SyncOperation>,
    targets: JSON.parse(row.targets) as StoredTarget[],
    state: row.state,
    attempts: row.attempts,
    createdAt: row.createdAt,
    ackedAt: row.ackedAt,
  };
}

/** A row as screens read it: the server's DTO with the queued edits laid over. */
export interface LocalRow<C extends SyncCollection> {
  readonly id: string;
  readonly clientUuid: string | null;
  readonly data: CollectionData[C];
  /** A mutation of the queue writes it and the server has not served the result yet. */
  readonly pending: boolean;
}

export interface LocalRowFilter {
  readonly playerId?: string;
  readonly parentId?: string;
  readonly categoryId?: string;
  /** Club days, inclusive (`aaaa-mm-dd`). */
  readonly from?: string;
  readonly to?: string;
}

export interface LocalStore {
  /** Rows of a collection of the membership, ordered by club day and id. */
  list<C extends SyncCollection>(
    membershipId: string,
    collection: C,
    filter?: LocalRowFilter,
  ): Promise<LocalRow<C>[]>;
  /** One row by its id or by the `clientUuid` it was created with. */
  get<C extends SyncCollection>(
    membershipId: string,
    collection: C,
    key: { id: string } | { clientUuid: string },
  ): Promise<LocalRow<C> | null>;
  /** Queued mutations of the membership, in queue order (creates not served yet included). */
  pending<Op extends SyncOperation>(
    membershipId: string,
    ops?: readonly Op[],
  ): Promise<QueuedMutation<Op>[]>;
}

type SyncedRowRecord = typeof syncedRow.$inferSelect;

function targetable(row: SyncedRowRecord): TargetableRow {
  return {
    collection: row.collection,
    id: row.id,
    clientUuid: row.clientUuid,
    parentId: row.parentId,
    playerId: row.playerId,
  };
}

function overlaid<C extends SyncCollection>(
  row: SyncedRowRecord,
  queue: readonly QueuedMutation[],
): LocalRow<C> {
  const key = targetable(row);
  let data = JSON.parse(row.data) as unknown;
  let pending = false;
  for (const queued of queue) {
    if (!queued.targets.some((target) => matchesTarget(target, key))) continue;
    pending = true;
    data = applyOverlay(queued.op, data, queued.input, { enqueuedAt: queued.createdAt });
  }
  return { id: row.id, clientUuid: row.clientUuid, data: data as CollectionData[C], pending };
}

async function queueOf(db: LocalDb, membershipId: string): Promise<QueuedMutation[]> {
  const rows = await db
    .select()
    .from(mutation)
    .where(eq(mutation.membershipId, membershipId))
    .orderBy(asc(mutation.seq));
  return rows.map(toQueuedMutation);
}

export function createLocalStore(database: LocalDatabase): LocalStore {
  return {
    list(membershipId, collection, filter = {}) {
      return database.read(async (db) => {
        const conditions: SQL[] = [
          eq(syncedRow.membershipId, membershipId),
          eq(syncedRow.collection, collection),
        ];
        if (filter.playerId !== undefined) conditions.push(eq(syncedRow.playerId, filter.playerId));
        if (filter.parentId !== undefined) conditions.push(eq(syncedRow.parentId, filter.parentId));
        if (filter.categoryId !== undefined) {
          conditions.push(eq(syncedRow.categoryId, filter.categoryId));
        }
        if (filter.from !== undefined) conditions.push(gte(syncedRow.localDate, filter.from));
        if (filter.to !== undefined) conditions.push(lte(syncedRow.localDate, filter.to));
        const rows = await db
          .select()
          .from(syncedRow)
          .where(and(...conditions))
          .orderBy(asc(syncedRow.localDate), asc(syncedRow.id));
        const queue = await queueOf(db, membershipId);
        return rows.map((row) => overlaid(row, queue));
      });
    },
    get(membershipId, collection, key) {
      return database.read(async (db) => {
        const [row] = await db
          .select()
          .from(syncedRow)
          .where(
            and(
              eq(syncedRow.membershipId, membershipId),
              eq(syncedRow.collection, collection),
              'id' in key ? eq(syncedRow.id, key.id) : eq(syncedRow.clientUuid, key.clientUuid),
            ),
          )
          .limit(1);
        if (row === undefined) return null;
        return overlaid(row, await queueOf(db, membershipId));
      });
    },
    pending(membershipId, ops) {
      return database.read(async (db) => {
        const rows = await db
          .select()
          .from(mutation)
          .where(
            and(
              eq(mutation.membershipId, membershipId),
              ...(ops === undefined ? [] : [inArray(mutation.op, [...ops])]),
            ),
          )
          .orderBy(asc(mutation.seq));
        return rows.map(toQueuedMutation) as QueuedMutation<never>[];
      });
    },
  };
}

/**
 * Applies one change of a pull to the synced rows (inside the page's
 * transaction): an upsert replaces the row by id (a row created offline is
 * the same id the server answered); a delete removes it, also when the
 * device never had it. Answers the row, for clearing the mutations it serves.
 */
export async function applyChange(
  db: LocalDb,
  membershipId: string,
  change: SyncChange,
  now: number,
): Promise<TargetableRow> {
  if (change.op === 'delete') {
    await db
      .delete(syncedRow)
      .where(
        and(
          eq(syncedRow.membershipId, membershipId),
          eq(syncedRow.collection, change.collection),
          eq(syncedRow.id, change.id),
        ),
      );
    return {
      collection: change.collection,
      id: change.id,
      clientUuid: null,
      parentId: null,
      playerId: null,
    };
  }
  const columns = indexColumnsOf(change.collection, change.data as never);
  const values = {
    membershipId,
    collection: change.collection,
    id: change.id,
    clientUuid: change.clientUuid,
    ...columns,
    data: JSON.stringify(change.data),
    pulledAt: now,
  };
  await db
    .insert(syncedRow)
    .values(values)
    .onConflictDoUpdate({
      target: [syncedRow.membershipId, syncedRow.collection, syncedRow.id],
      set: {
        clientUuid: values.clientUuid,
        ...columns,
        data: values.data,
        pulledAt: now,
      },
    });
  return {
    collection: change.collection,
    id: change.id,
    clientUuid: change.clientUuid,
    parentId: columns.parentId,
    playerId: columns.playerId,
  };
}

export async function deleteCollections(
  db: LocalDb,
  membershipId: string,
  collections: readonly SyncCollection[],
): Promise<void> {
  if (collections.length === 0) return;
  await db
    .delete(syncedRow)
    .where(
      and(
        eq(syncedRow.membershipId, membershipId),
        inArray(syncedRow.collection, [...collections]),
      ),
    );
}
