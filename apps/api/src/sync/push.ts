import {
  IDEMPOTENT_REPLAY_HEADER,
  SYNC_OPERATION_INPUTS,
  toValidationIssues,
  type EndpointDefinition,
  type ErrorBody,
  type SyncMutation,
  type SyncMutationResult,
  type SyncOperationInput,
} from '@sport-performance/contracts';
import { participation, syncMutation } from '@sport-performance/db/schema';
import {
  SYNC_RECORDED_AT_MAX_AGE_DAYS,
  clampHlc,
  formatHlc,
  isSyncOperation,
  parseHlc,
  recordedAtMs,
  type ClubId,
  type SyncOperation,
} from '@sport-performance/domain';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import {
  checkResponse,
  parseEndpointInput,
  transactionalRouteOf,
  type ClubAuthContext,
  type EndpointResult,
  type TransactionalHandlerContext,
} from '../http/endpoint.js';
import { HttpError, classifyError } from '../http/errors.js';
import { lockKeys, participationKey } from './locks.js';
import {
  SYNC_RESOLVERS,
  type EndpointCall,
  type Resolution,
  type Settlement,
} from './operations.js';

/**
 * The push of the offline queue (B-323, ADR 0050). Each mutation runs in a
 * savepoint of the request transaction, through the handler of its online
 * endpoint, with its clock in `app.sync_hlc` (the triggers stamp the fields
 * it changes with it) and its change reason in `app.change_reason`. A
 * mutation the API rejects (4xx) rolls back alone and the next ones go on;
 * anything else fails the whole push, so the device retries it.
 */

export interface PushContext extends Omit<TransactionalHandlerContext<EndpointDefinition>, 'auth'> {
  auth: ClubAuthContext;
  app: FastifyInstance;
}

/**
 * A reply that only records what a handler says about the response: the
 * idempotent replay header. The sync answers its own response.
 */
function capturingReply(): { reply: FastifyReply; replayed: () => boolean } {
  const headers = new Map<string, string>();
  const reply = {
    header(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
      return reply;
    },
  };
  return {
    reply: reply as unknown as FastifyReply,
    replayed: () => headers.get(IDEMPOTENT_REPLAY_HEADER) === 'true',
  };
}

async function setLocal(db: TenantDatabase, name: string, value: string | null): Promise<void> {
  await db.execute(sql`select set_config(${name}, ${value ?? ''}, true)`);
}

function result(
  mutation: SyncMutation,
  fields: Omit<SyncMutationResult, 'mutationId' | 'op'>,
): SyncMutationResult {
  return { mutationId: mutation.mutationId, op: mutation.op, ...fields };
}

function rejected(mutation: SyncMutation, error: ErrorBody): SyncMutationResult {
  return result(mutation, {
    status: 'rejected',
    hlc: null,
    clamped: false,
    appliedFields: [],
    supersededFields: [],
    firstOutcome: null,
    error,
  });
}

/** The parts of a mutation that travel: a key the operation does not take is an error of the contract. */
function operationParts(mutation: SyncMutation): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      params: mutation.params,
      target: mutation.target,
      body: mutation.body,
    }).filter(([, value]) => value !== undefined),
  );
}

/** The operation part of a mutation, validated by its schema; issues located in the push body. */
function operationInput(mutation: SyncMutation, index: number, op: SyncOperation): unknown {
  const parsed = SYNC_OPERATION_INPUTS[op].safeParse(operationParts(mutation));
  if (!parsed.success) {
    throw new HttpError('validation_failed', 'The mutation does not match the contract', {
      details: toValidationIssues(parsed.error.issues, ['body', 'mutations', index]),
    });
  }
  return parsed.data;
}

/** The input of a mutation of `op`, or `undefined` when it is another operation or invalid. */
function inputOf<Op extends SyncOperation>(
  mutation: SyncMutation,
  op: Op,
): SyncOperationInput<Op> | undefined {
  if (mutation.op !== op) return undefined;
  const parsed = SYNC_OPERATION_INPUTS[op].safeParse(operationParts(mutation));
  return parsed.success ? (parsed.data as SyncOperationInput<Op>) : undefined;
}

/**
 * Takes, before the first mutation runs, the advisory locks every mutation
 * of the push takes on its own: its `mutationId` and the participations it
 * writes (by session and player, existing or not). All at once and in key
 * order (`app.sync_lock_keys`), so two pushes that write the same
 * participations in a different order wait for each other instead of
 * deadlocking: every write of a participation, online or offline, takes its
 * key before its row. The mutations take them again (re-entrant) when they
 * run. A mutation that does not parse locks nothing more; it is rejected
 * when it runs.
 */
async function lockPushKeys(ctx: PushContext, mutations: readonly SyncMutation[]): Promise<void> {
  const { clubId } = ctx.auth.membership;
  const keys = mutations.map((mutation) => `mutation:${mutation.mutationId}`);
  const targetIds: string[] = [];
  const targetClientUuids: string[] = [];
  let ownPlayerId: string | null | undefined;
  for (const mutation of mutations) {
    const record = inputOf(mutation, 'participation.record');
    if (record !== undefined) {
      for (const row of record.body.rows) {
        keys.push(participationKey(record.params.trainingSessionId, row.playerId));
      }
      continue;
    }
    const rpe = inputOf(mutation, 'rpe.submit');
    if (rpe !== undefined) {
      ownPlayerId ??= (await ctx.permissions.subject()).playerId ?? null;
      if (ownPlayerId !== null)
        keys.push(participationKey(rpe.params.trainingSessionId, ownPlayerId));
      continue;
    }
    const update = inputOf(mutation, 'participation.update');
    if (update !== undefined) {
      if ('id' in update.target) targetIds.push(update.target.id);
      else targetClientUuids.push(update.target.clientUuid);
    }
  }
  if (targetIds.length > 0 || targetClientUuids.length > 0) {
    // Under RLS: a participation the caller does not see locks nothing (its mutation is `404`).
    const targets = await ctx.db
      .select({
        trainingSessionId: participation.trainingSessionId,
        playerId: participation.playerId,
      })
      .from(participation)
      .where(
        and(
          eq(participation.clubId, clubId),
          or(
            targetIds.length > 0 ? inArray(participation.id, targetIds) : undefined,
            targetClientUuids.length > 0
              ? inArray(participation.clientUuid, targetClientUuids)
              : undefined,
          ),
        ),
      );
    for (const row of targets) keys.push(participationKey(row.trainingSessionId, row.playerId));
  }
  await lockKeys(ctx.db, keys);
}

/**
 * The time of the database (`clock_timestamp()`, in ms): the clock the
 * triggers stamp online writes with, so a device clock is clamped to the
 * same clock it is compared against, whatever the skew of the API host.
 */
export async function databaseNowMs(db: TenantDatabase): Promise<number> {
  const { rows } = await db.execute<{ ms: string }>(
    sql`select floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text as ms`,
  );
  const ms = Number(rows[0]?.ms);
  if (!Number.isSafeInteger(ms)) throw new Error('databaseNowMs: no time from the database');
  return ms;
}

/** Thrown inside the savepoint of a check-only call to roll it back. */
class CheckOnlyRollback extends Error {}

/** Runs one call of an online endpoint inside the current transaction, as its route does. */
async function runCall(
  ctx: PushContext,
  call: EndpointCall,
  prefix: (string | number)[],
  recordedAt: Date,
) {
  const route = transactionalRouteOf(ctx.app, call.endpoint);
  const input = parseEndpointInput(call.endpoint, { params: call.params, body: call.body }, prefix);
  const capture = capturingReply();
  const reason = route.changeReason?.(input) ?? null;
  await setLocal(ctx.db, 'app.change_reason', reason);
  const handlerContext: TransactionalHandlerContext<EndpointDefinition> = {
    ...ctx,
    reply: capture.reply,
    recordedAt,
  };
  // `unknown`: the result of an endpoint without a response body is `void`.
  const output = await (route.handler(input, handlerContext) as Promise<unknown>);
  // Same guarantee as online: a result outside the contract fails the request.
  checkResponse(call.endpoint, output as EndpointResult<EndpointDefinition>);
  await setLocal(ctx.db, 'app.change_reason', null);
  return { replayed: capture.replayed(), output };
}

/**
 * What a call wrote: nothing when the handler replayed the create by its
 * `clientUuid` (its replay header), else what the resolution says of the
 * handler's output. Only that is stamped and reported, so a replay never
 * moves a clock past a value it did not write.
 */
function settle(resolution: Resolution, replayed: boolean, output: unknown): Settlement {
  if (replayed) return { stamps: [], appliedFields: [], supersededFields: [], replayed: true };
  return (
    resolution.settle?.(output) ?? {
      stamps: resolution.stamps,
      appliedFields: resolution.appliedFields,
      supersededFields: resolution.supersededFields,
      replayed: false,
    }
  );
}

async function storedOutcome(db: TenantDatabase, clubId: ClubId, mutationId: string) {
  const [row] = await db
    .select({ outcome: syncMutation.outcome, hlc: syncMutation.hlc })
    .from(syncMutation)
    .where(and(eq(syncMutation.clubId, clubId), eq(syncMutation.clientUuid, mutationId)));
  return row;
}

async function applyMutation(
  ctx: PushContext,
  mutation: SyncMutation,
  index: number,
  nowMs: number,
): Promise<SyncMutationResult> {
  const { clubId } = ctx.auth.membership;
  const path = ['body', 'mutations', index];
  if (!isSyncOperation(mutation.op)) {
    throw new HttpError('validation_failed', 'Unknown sync operation', {
      details: [{ path: [...path, 'op'], code: 'custom', message: 'Not a sync operation' }],
    });
  }
  const op = mutation.op;
  // The contract checked the form; the parts (a node id, the ranges) are checked here.
  let parsed;
  try {
    parsed = parseHlc(mutation.hlc);
  } catch {
    throw new HttpError('validation_failed', 'Not a hybrid logical clock', {
      details: [{ path: [...path, 'hlc'], code: 'custom', message: 'Not a hybrid logical clock' }],
    });
  }
  const { hlc: applied, clamped } = clampHlc(parsed, nowMs);
  const hlc = formatHlc(applied);
  // Windows are measured when it was recorded, but not further back than the limit (ADR 0050).
  const recordedAt = new Date(recordedAtMs(applied, nowMs, SYNC_RECORDED_AT_MAX_AGE_DAYS));

  // Until the push ends: the same mutation in a concurrent push (a retry after a timeout)
  // waits here and then finds it stored, so it is answered `replayed`, not `conflict`.
  await lockKeys(ctx.db, [`mutation:${mutation.mutationId}`]);
  const previous = await storedOutcome(ctx.db, clubId, mutation.mutationId);
  if (previous !== undefined) {
    return result(mutation, {
      status: 'replayed',
      hlc: previous.hlc,
      clamped: false,
      appliedFields: [],
      supersededFields: [],
      firstOutcome: previous.outcome,
      error: null,
    });
  }

  const input = operationInput(mutation, index, op);
  return ctx.db.transaction(async (db) => {
    await setLocal(db, 'app.sync_hlc', hlc);
    const resolver = SYNC_RESOLVERS[op] as (
      input: unknown,
      context: Parameters<(typeof SYNC_RESOLVERS)[SyncOperation]>[1],
    ) => Promise<Resolution>;
    const resolution = await resolver(input, {
      db,
      clubId,
      hlc,
      permissions: ctx.permissions,
      path,
    });
    let settled: Settlement;
    if (resolution.checkOnly) {
      // Superseded: answered as online would (permissions, consents, validation), not written.
      try {
        await db.transaction(async (check) => {
          await runCall({ ...ctx, db: check }, resolution.call, path, recordedAt);
          throw new CheckOnlyRollback();
        });
      } catch (error) {
        if (!(error instanceof CheckOnlyRollback)) throw error;
      }
      settled = { ...resolution, replayed: false };
    } else {
      const { replayed, output } = await runCall({ ...ctx, db }, resolution.call, path, recordedAt);
      settled = settle(resolution, replayed, output);
      for (const stamp of settled.stamps) {
        await db.execute(
          sql`select app.sync_stamp_fields(${stamp.collection}, ${stamp.rowId}::uuid, ${`{${stamp.columns.join(',')}}`}::text[], ${hlc})`,
        );
      }
    }
    // What happened, as answered: a call the handler replayed by `clientUuid` wrote nothing.
    const outcome = resolution.checkOnly ? 'superseded' : settled.replayed ? 'replayed' : 'applied';
    // Another user's mutation with the same id: the unique key answers `409 conflict`.
    await db.insert(syncMutation).values({
      clubId,
      clientUuid: mutation.mutationId,
      operation: op,
      hlc,
      receivedHlc: mutation.hlc,
      outcome,
      createdBy: ctx.auth.userId,
      updatedBy: ctx.auth.userId,
    });
    await setLocal(db, 'app.sync_hlc', null);
    return result(mutation, {
      status: outcome,
      hlc,
      clamped,
      appliedFields: [...settled.appliedFields],
      supersededFields: [...settled.supersededFields],
      firstOutcome: null,
      error: null,
    });
  });
}

/** Applies the mutations of a push in order; one rejected never stops the next ones. */
export async function pushMutations(
  ctx: PushContext,
  mutations: readonly SyncMutation[],
  nowMs: number,
): Promise<SyncMutationResult[]> {
  const results: SyncMutationResult[] = [];
  await lockPushKeys(ctx, mutations);
  for (const [index, mutation] of mutations.entries()) {
    try {
      results.push(await applyMutation(ctx, mutation, index, nowMs));
    } catch (error) {
      const { code, message, details, unexpected } = classifyError(error);
      // A failure of the server, or a deadlock with a concurrent push (`503`, retryable), is
      // not an answer about the mutation: the whole push fails and the device sends it again.
      if (unexpected || code === 'service_unavailable') throw error;
      ctx.log.info({ code, op: mutation.op, index }, 'sync mutation rejected');
      results.push(
        rejected(mutation, {
          code,
          message,
          requestId: ctx.request.id,
          ...(details !== undefined && { details }),
        }),
      );
    }
  }
  return results;
}
