import {
  SYNC_OPERATION_INPUTS,
  type SyncOperationInput,
  type SyncOperationRequest,
} from '@sport-performance/contracts';
import type { SyncCollection, SyncOperation } from '@sport-performance/domain';

/**
 * A row a queued mutation writes (ADR 0065). It matches a row of a pull
 * by its `id`, by the `clientUuid` it was created with, or by its session
 * and player (a participation the staff already created keeps its own
 * `clientUuid` when the batch or the RPE of the device updates it).
 */
export interface MutationTarget {
  readonly collection: SyncCollection;
  readonly id?: string;
  readonly clientUuid?: string;
  readonly parentId?: string;
  readonly playerId?: string;
}

/** The fields of a local row a target is matched against. */
export interface TargetableRow {
  readonly collection: SyncCollection;
  readonly id: string;
  readonly clientUuid: string | null;
  readonly parentId: string | null;
  readonly playerId: string | null;
}

export function matchesTarget(target: MutationTarget, row: TargetableRow): boolean {
  if (target.collection !== row.collection) return false;
  if (target.id !== undefined && target.id === row.id) return true;
  if (target.clientUuid !== undefined && target.clientUuid === row.clientUuid) return true;
  return (
    target.parentId !== undefined &&
    target.parentId === row.parentId &&
    (target.playerId === undefined || target.playerId === row.playerId)
  );
}

/** An input the operation's contract refuses (`SYNC_OPERATION_INPUTS`): a bug of the screen. */
export class InvalidMutationError extends Error {
  readonly op: SyncOperation;
  readonly paths: readonly string[];

  constructor(op: SyncOperation, paths: readonly string[]) {
    super(`${op}: invalid input at ${paths.join(', ')}`);
    this.name = 'InvalidMutationError';
    this.op = op;
    this.paths = paths;
  }
}

/** A create without the `clientUuid` the device reconciles it by. */
export class MissingClientUuidError extends Error {
  readonly op: SyncOperation;
  readonly path: readonly (string | number)[];

  constructor(op: SyncOperation, path: readonly (string | number)[]) {
    super(`${op}: ${path.join('.')} must carry a clientUuid`);
    this.name = 'MissingClientUuidError';
    this.op = op;
    this.path = path;
  }
}

interface OperationSpec<Op extends SyncOperation> {
  /**
   * `create`: new rows, reconciled by their `clientUuid`. `edit`: fields of an
   * existing row, resolved per field by HLC on the server. `append`: attempts
   * of a result, added or voided, never edited (ADR 0015).
   */
  readonly kind: 'create' | 'edit' | 'append';
  readonly targets: (input: SyncOperationInput<Op>) => MutationTarget[];
  /** Paths that must carry a `clientUuid` (the queue refuses the mutation otherwise). */
  readonly clientUuidPaths: (input: SyncOperationInput<Op>) => {
    path: (string | number)[];
    value: string | undefined;
  }[];
}

type Target = { id: string } | { clientUuid: string };
const toTarget = (collection: SyncCollection, target: Target): MutationTarget => ({
  collection,
  ...target,
});

const none = () => [];

export const OPERATION_SPECS: { readonly [Op in SyncOperation]: OperationSpec<Op> } = {
  'wellness.submit': {
    kind: 'create',
    targets: ({ body }) => [
      {
        collection: 'wellness',
        ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
      },
    ],
    clientUuidPaths: ({ body }) => [{ path: ['body', 'clientUuid'], value: body.clientUuid }],
  },
  'wellness.correct': {
    kind: 'edit',
    targets: ({ target }) => [toTarget('wellness', target)],
    clientUuidPaths: none,
  },
  'rpe.submit': {
    kind: 'create',
    // A player's device holds only their own participations: the session names the row.
    targets: ({ params, body }) => [
      {
        collection: 'participation',
        parentId: params.trainingSessionId,
        ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
      },
    ],
    clientUuidPaths: ({ body }) => [{ path: ['body', 'clientUuid'], value: body.clientUuid }],
  },
  'participation.record': {
    kind: 'create',
    targets: ({ params, body }) =>
      body.rows.map((row) => ({
        collection: 'participation',
        clientUuid: row.clientUuid,
        parentId: params.trainingSessionId,
        playerId: row.playerId,
      })),
    clientUuidPaths: ({ body }) =>
      body.rows.map((row, index) => ({
        path: ['body', 'rows', index, 'clientUuid'],
        value: row.clientUuid,
      })),
  },
  'participation.update': {
    kind: 'edit',
    targets: ({ target }) => [toTarget('participation', target)],
    clientUuidPaths: none,
  },
  'test_result.create': {
    kind: 'create',
    targets: ({ body }) => [
      {
        collection: 'test_result',
        ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
      },
    ],
    clientUuidPaths: ({ body }) => [{ path: ['body', 'clientUuid'], value: body.clientUuid }],
  },
  'test_session.record_results': {
    kind: 'create',
    targets: ({ body }) =>
      body.results.map((result) => ({
        collection: 'test_result',
        ...(result.clientUuid !== undefined && { clientUuid: result.clientUuid }),
      })),
    clientUuidPaths: ({ body }) =>
      body.results.map((result, index) => ({
        path: ['body', 'results', index, 'clientUuid'],
        value: result.clientUuid,
      })),
  },
  'test_result.update': {
    kind: 'edit',
    targets: ({ target }) => [toTarget('test_result', target)],
    clientUuidPaths: none,
  },
  'test_result.add_entries': {
    kind: 'append',
    targets: ({ target }) => [toTarget('test_result', target)],
    // Each attempt is idempotent by its own id, also when it is pushed by a later mutation.
    clientUuidPaths: ({ body }) =>
      body.entries.map((entry, index) => ({
        path: ['body', 'entries', index, 'clientUuid'],
        value: entry.clientUuid,
      })),
  },
  'test_result.void_entries': {
    kind: 'append',
    targets: ({ target }) => [toTarget('test_result', target)],
    clientUuidPaths: none,
  },
};

export interface PreparedMutation<Op extends SyncOperation = SyncOperation> {
  readonly op: Op;
  readonly input: SyncOperationInput<Op>;
  readonly targets: MutationTarget[];
}

/**
 * Validates the input of an operation with the same contract the server
 * checks (`SYNC_OPERATION_INPUTS`) and the rows it writes. A mutation the
 * contract refuses never enters the queue: it would only come back rejected.
 */
export function prepareMutation<Op extends SyncOperation>(
  op: Op,
  input: SyncOperationRequest<Op>,
): PreparedMutation<Op> {
  const schema = SYNC_OPERATION_INPUTS[op];
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new InvalidMutationError(
      op,
      result.error.issues.map((issue) => issue.path.map(String).join('.')),
    );
  }
  const parsed = result.data as SyncOperationInput<Op>;
  const spec = OPERATION_SPECS[op] as OperationSpec<Op>;
  for (const { path, value } of spec.clientUuidPaths(parsed)) {
    if (value === undefined) throw new MissingClientUuidError(op, path);
  }
  return { op, input: parsed, targets: spec.targets(parsed) };
}
