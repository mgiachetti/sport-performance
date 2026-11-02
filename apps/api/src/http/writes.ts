import { createHash } from 'node:crypto';
import { IDEMPOTENT_REPLAY_HEADER } from '@sport-performance/contracts';
import type { ArchiveStatus } from '@sport-performance/contracts';
import { isNotNull, isNull, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { HttpError } from './errors.js';

/**
 * Write conventions of the endpoints (ADR 0032): idempotent creates by
 * `client_uuid`, optimistic concurrency by row version, archive instead of
 * delete.
 */

/**
 * The version of a row: `updated_at` in microseconds since the epoch, as
 * text (the `set_updated_at` trigger bumps it on every `UPDATE`, also for
 * raw SQL). Opaque to clients; full precision, unlike an ISO timestamp.
 */
export function rowVersion(updatedAt: AnyColumn): SQL<string> {
  return sql<string>`((extract(epoch from ${updatedAt}) * 1000000)::bigint)::text`;
}

/** Condition "the row is still at `version`", for the `WHERE` of an `UPDATE`. */
export function versionMatches(updatedAt: AnyColumn, version: string): SQL {
  return sql`${rowVersion(updatedAt)} = ${version}`;
}

/**
 * Runs a versioned `UPDATE … WHERE id = … AND <versionMatches> RETURNING …`
 * and tells apart what an empty result means: the row is not there (or not
 * visible: `404`) or it changed since the client read it (`409 conflict`).
 */
export async function updateAtVersion<Row>(options: {
  /** The `UPDATE` with {@link versionMatches} in its `WHERE`; resolves the returned row. */
  update: () => Promise<Row | undefined>;
  /** Whether the row exists for the caller (same visibility as the update). */
  exists: () => Promise<boolean>;
  /** Name for the error messages (`Category`). */
  resource: string;
}): Promise<Row> {
  const row = await options.update();
  if (row !== undefined) return row;
  if (await options.exists()) {
    throw new HttpError(
      'conflict',
      `The ${options.resource.toLowerCase()} changed since it was read: read it again`,
    );
  }
  throw new HttpError('not_found', `${options.resource} not found`);
}

/**
 * An idempotent create (offline queue, retries; ADR 0015, ADR 0032). The
 * insert must use `onConflictDoNothing({ target: [table.clubId,
 * table.clientUuid] })` (the unique key of every club table) and return the
 * row; when it inserts nothing, a previous request with the same
 * `clientUuid` already created it and that row is returned, with
 * `X-Idempotent-Replay: true`. The status is the same as the first time.
 * Other unique keys still answer `409 conflict` (a different create).
 */
export async function insertIdempotent<Row>(options: {
  clientUuid: string | undefined;
  insert: () => Promise<Row | undefined>;
  findByClientUuid: (clientUuid: string) => Promise<Row | undefined>;
  reply: FastifyReply;
}): Promise<{ row: Row; replayed: boolean }> {
  const inserted = await options.insert();
  if (inserted !== undefined) return { row: inserted, replayed: false };
  if (options.clientUuid === undefined) {
    throw new Error('insertIdempotent: the insert returned no row without a clientUuid');
  }
  const existing = await options.findByClientUuid(options.clientUuid);
  // Same client_uuid but invisible to the caller: never reveal it, never duplicate it.
  if (existing === undefined) {
    throw new HttpError('conflict', 'This clientUuid was already used');
  }
  markReplay(options.reply);
  return { row: existing, replayed: true };
}

/**
 * Filter of the `status` query of archivable resources (ADR 0032): the
 * application archives (`archived_at`) instead of deleting, and lists hide
 * archived rows unless asked.
 */
export function archiveStatusFilter(archivedAt: AnyColumn, status: ArchiveStatus): SQL | undefined {
  switch (status) {
    case 'active':
      return isNull(archivedAt);
    case 'archived':
      return isNotNull(archivedAt);
    case 'all':
      return undefined;
  }
}

/** Marks a response that returns what an earlier, identical request created. */
export function markReplay(reply: FastifyReply): void {
  void reply.header(IDEMPOTENT_REPLAY_HEADER, 'true');
}

/**
 * `client_uuid` of row `index` of a batch (an import): a UUIDv8 (RFC 9562,
 * custom) from the SHA-256 of the batch's `clientUuid`, `kind` (the table
 * the rows go to, or a finer key) and the index. Re-sending the same batch
 * finds the same rows; two kinds never collide.
 */
export function batchRowClientUuid(batchClientUuid: string, kind: string, index: number): string {
  const hex = createHash('sha256')
    .update(`${batchClientUuid.toLowerCase()}:${kind}:${String(index)}`)
    .digest('hex');
  // RFC 9562 version 8 (custom), variant 10.
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** JSON with the keys of every object sorted: the same value, the same text. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * SHA-256 (hex) of a batch as parsed, in canonical JSON: stored with the batch
 * so that re-sending its `clientUuid` with another body is told apart from a
 * replay of the same one.
 */
export function batchBodySha256(body: unknown): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}
