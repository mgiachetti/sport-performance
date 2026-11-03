import {
  listClubSupportAccess,
  listSupportAccess,
  type Page,
  type SupportAccessEntry,
} from '@sport-performance/contracts';
import { parseClubId, parseTimeZone, parseUserId, type ClubId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { filtersFingerprint } from '../http/pagination.js';

/**
 * The superadmin's support accesses (B-414, ADR 0066): the registry reads
 * every club (`club_registry.read`), the administration of a club the
 * accesses to its own (`support_access.read`). Both read through
 * `app.support_access_entries`, the only way into `support.access_log`
 * (SECURITY DEFINER, ADR 0029): the database decides the scope again from
 * the validated context, so the handler's filter is never the only barrier.
 *
 * Always newest first: the cursor carries the exact start (microseconds) and
 * id of the last entry, plus a fingerprint of the filters.
 */

interface EntryRow extends Record<string, unknown> {
  id: string;
  started_at: Date | string;
  started_at_key: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  club_id: string | null;
  club_name: string | null;
  club_slug: string | null;
  club_time_zone: string | null;
  reason: string;
  request_id: string;
}

interface EntryFilters {
  readonly clubId: ClubId | null;
  readonly operatorId: string | undefined;
  readonly from: string | undefined;
  readonly to: string | undefined;
}

interface CursorPayload {
  readonly v: 1;
  readonly f: string;
  readonly k: readonly [string, string];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function invalidCursor(): never {
  throw new HttpError('bad_request', 'Invalid cursor');
}

function decodeCursor(cursor: string, fingerprint: string): readonly [string, string] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return invalidCursor();
  }
  if (typeof parsed !== 'object' || parsed === null) return invalidCursor();
  const { v, f, k } = parsed as Partial<Record<keyof CursorPayload, unknown>>;
  if (v !== 1 || !Array.isArray(k) || k.length !== 2) return invalidCursor();
  if (f !== fingerprint) {
    throw new HttpError('bad_request', 'The cursor belongs to other filters');
  }
  const [at, id] = k as [unknown, unknown];
  if (typeof at !== 'string' || !KEY_TIME.test(at)) return invalidCursor();
  if (typeof id !== 'string' || !UUID.test(id)) return invalidCursor();
  return [at, id];
}

function encodeCursor(fingerprint: string, row: EntryRow): string {
  const payload: CursorPayload = { v: 1, f: fingerprint, k: [row.started_at_key, row.id] };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function entryDto(row: EntryRow): SupportAccessEntry {
  const club =
    row.club_id === null || row.club_name === null || row.club_slug === null
      ? null
      : {
          id: parseClubId(row.club_id),
          name: row.club_name,
          slug: row.club_slug,
          timeZone: parseTimeZone(row.club_time_zone),
        };
  return {
    id: row.id,
    startedAt: new Date(row.started_at).toISOString(),
    operator: {
      userId: parseUserId(row.user_id),
      name: row.user_name,
      email: row.user_email,
    },
    club,
    reason: row.reason,
    requestId: row.request_id,
  };
}

async function readEntries(
  db: TenantDatabase,
  filters: EntryFilters,
  page: { cursor?: string | undefined; limit: number },
): Promise<Page<SupportAccessEntry>> {
  const fingerprint = filtersFingerprint({
    clubId: filters.clubId ?? undefined,
    operatorId: filters.operatorId,
    from: filters.from,
    to: filters.to,
  });
  const [beforeAt, beforeId] =
    page.cursor === undefined ? [null, null] : decodeCursor(page.cursor, fingerprint);
  const { rows } = await db.execute<EntryRow>(
    sql`select * from app.support_access_entries(
      ${filters.clubId}::uuid,
      ${filters.operatorId ?? null}::text,
      ${filters.from ?? null}::timestamptz,
      ${filters.to ?? null}::timestamptz,
      ${beforeAt}::timestamptz,
      ${beforeId}::uuid,
      ${page.limit + 1}::integer
    )`,
  );
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items: items.map(entryDto),
    nextCursor:
      rows.length > page.limit && last !== undefined ? encodeCursor(fingerprint, last) : null,
  };
}

export function registerSupportAccessRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listSupportAccess, {
    transaction: true,
    scope: 'registry',
    handler: async ({ query }, { db, permissions }) => {
      await permissions.authorize('club_registry', 'read');
      return readEntries(
        db,
        {
          clubId: query.clubId ?? null,
          operatorId: query.operatorId,
          from: query.from,
          to: query.to,
        },
        query,
      );
    },
  });

  registerEndpoint(app, listClubSupportAccess, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('support_access', 'read');
      return readEntries(
        db,
        {
          clubId: caller.membership.clubId,
          operatorId: query.operatorId,
          from: query.from,
          to: query.to,
        },
        query,
      );
    },
  });
}
