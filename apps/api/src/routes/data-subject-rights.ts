import {
  cancelDataSubjectRequest,
  deleteMyAccount,
  executeErasure,
  exportPlayerData,
  getDataSubjectRequest,
  listDataSubjectRequests,
  rejectDataSubjectRequest,
  requestPlayerErasure,
  type AccountDeletion,
  type DataSubjectRequest,
  type PlayerDataExport,
} from '@sport-performance/contracts';
import {
  club,
  dataSubjectRequest,
  player,
  user,
  type ErasedRows,
} from '@sport-performance/db/schema';
import {
  ACCOUNT_DELETION_FRESH_SESSION_S,
  PLAYER_DATA_EXPORT_FORMAT,
  PLAYER_DATA_EXPORT_FORMAT_VERSION,
  can,
  erasureDueOn,
  isTestNotDoneReason,
  notDoneReasonForViewer,
  parseLocalDate,
  type AccountDeletionOutcome,
  type ClubId,
  type DataSubjectRequestKind,
  type DataSubjectRequestStatus,
  type PlayerFacts,
  type PlayerId,
  type Role,
  type UserId,
} from '@sport-performance/domain';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { requirePlayerFacts } from '../http/consents.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError, databaseErrorOf } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { insertIdempotent, markReplay } from '../http/writes.js';

/**
 * Rights of the data subject (Ley 25.326, arts. 14 to 16; B-329, ADR 0051):
 * the export of every datum of a player, the erasure requests the club's
 * administration executes, and the deletion of the caller's account (Apple
 * App Store Review Guideline 5.1.1(v)). The database does the work
 * (`app.export_player_data`, `app.erase_player`, `app.delete_own_account`);
 * these handlers authorize with the permission matrix first.
 */

// ─── Requests ───────────────────────────────────────────────────────────────

const requestColumns = {
  id: dataSubjectRequest.id,
  clientUuid: dataSubjectRequest.clientUuid,
  playerId: dataSubjectRequest.playerId,
  firstName: player.firstName,
  lastName: player.lastName,
  kind: dataSubjectRequest.kind,
  status: dataSubjectRequest.status,
  requestedBy: dataSubjectRequest.requestedBy,
  requesterRole: dataSubjectRequest.requesterRole,
  note: dataSubjectRequest.note,
  createdAt: dataSubjectRequest.createdAt,
  // The club's day of the request, for the legal due day.
  requestedOn: sql<string>`(${dataSubjectRequest.createdAt} at time zone ${club.timeZone})::date::text`,
  resolvedAt: dataSubjectRequest.resolvedAt,
  resolvedBy: dataSubjectRequest.resolvedBy,
  resolutionNote: dataSubjectRequest.resolutionNote,
  erasedRows: dataSubjectRequest.erasedRows,
};

interface RequestRow {
  id: string;
  clientUuid: string;
  playerId: PlayerId;
  firstName: string | null;
  lastName: string | null;
  kind: DataSubjectRequestKind;
  status: DataSubjectRequestStatus;
  requestedBy: string | null;
  requesterRole: Role;
  note: string | null;
  createdAt: Date;
  requestedOn: string;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  erasedRows: ErasedRows | null;
}

function requestDto(row: RequestRow): DataSubjectRequest {
  if (
    row.requesterRole !== 'player' &&
    row.requesterRole !== 'parent' &&
    row.requesterRole !== 'admin'
  ) {
    throw new Error(`data_subject_request: unexpected requester role ${row.requesterRole}`);
  }
  return {
    id: row.id as DataSubjectRequest['id'],
    playerId: row.playerId,
    player:
      row.firstName === null || row.lastName === null
        ? null
        : { firstName: row.firstName, lastName: row.lastName },
    kind: row.kind,
    status: row.status,
    requestedBy: row.requestedBy as UserId | null,
    requesterRole: row.requesterRole,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    dueOn: row.kind === 'erasure' ? erasureDueOn(parseLocalDate(row.requestedOn)) : null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedBy: row.resolvedBy as UserId | null,
    resolutionNote: row.resolutionNote,
    erasedRows: row.erasedRows,
  };
}

const REQUEST_KEYS: KeysetSpec<RequestRow, 'createdAt'> = {
  fields: {
    createdAt: {
      column: dataSubjectRequest.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: dataSubjectRequest.id, value: (row) => row.id },
};

/** Requests of the club with their player (if not erased) and the club's zone, under RLS. */
function selectRequests(db: TenantDatabase, clubId: ClubId, where: SQL | undefined) {
  return db
    .select(requestColumns)
    .from(dataSubjectRequest)
    .innerJoin(club, eq(club.id, dataSubjectRequest.clubId))
    .leftJoin(
      player,
      and(eq(player.clubId, dataSubjectRequest.clubId), eq(player.id, dataSubjectRequest.playerId)),
    )
    .where(and(eq(dataSubjectRequest.clubId, clubId), where));
}

async function readRequest(
  db: TenantDatabase,
  clubId: ClubId,
  requestId: string,
): Promise<RequestRow | undefined> {
  const [row] = await selectRequests(db, clubId, eq(dataSubjectRequest.id, requestId));
  return row;
}

async function requireRequest(
  db: TenantDatabase,
  clubId: ClubId,
  requestId: string,
): Promise<RequestRow> {
  const row = await readRequest(db, clubId, requestId);
  if (row === undefined) throw new HttpError('not_found', 'Request not found');
  return row;
}

/** Roles that ask in their own name: the holder or the administration (`requester_role`). */
function requesterRoleOf(role: Role): 'player' | 'parent' | 'admin' {
  if (role === 'player' || role === 'parent' || role === 'admin') return role;
  // The matrix only lets these roles export or ask for an erasure.
  throw new Error(`data subject request: the matrix let ${role} ask`);
}

/**
 * Resolves a pending request as the caller (`cancelled` or `rejected`). The
 * RLS update policy lets only whoever asked cancel and the administration
 * reject; a request that is no longer pending is `409`.
 */
async function resolveRequest(
  db: TenantDatabase,
  clubId: ClubId,
  requestId: string,
  caller: UserId,
  status: 'cancelled' | 'rejected',
  reason: string | null,
): Promise<RequestRow> {
  const current = await requireRequest(db, clubId, requestId);
  if (current.status !== 'pending') {
    throw new HttpError('conflict', 'The request is no longer pending');
  }
  const updated = await db
    .update(dataSubjectRequest)
    .set({
      status,
      resolvedAt: sql`now()`,
      resolvedBy: caller,
      resolutionNote: reason,
      updatedBy: caller,
    })
    .where(
      and(
        eq(dataSubjectRequest.clubId, clubId),
        eq(dataSubjectRequest.id, requestId),
        eq(dataSubjectRequest.status, 'pending'),
      ),
    )
    .returning({ id: dataSubjectRequest.id });
  if (updated.length === 0) throw new HttpError('conflict', 'The request is no longer pending');
  return requireRequest(db, clubId, requestId);
}

// ─── Export ─────────────────────────────────────────────────────────────────

type ExportedRow = Record<string, unknown>;
type ExportedTables = Record<string, ExportedRow[]>;

/**
 * `injured` as a not-done reason reveals a health condition: everyone but the
 * medical staff sees `unavailable` (ADR 0029), in the results and in their
 * change history alike.
 */
function projectNotDoneReasons(tables: ExportedTables, viewer: Role): ExportedTables {
  const project = (values: unknown): unknown => {
    if (values === null || typeof values !== 'object' || !('not_done_reason' in values)) {
      return values;
    }
    const reason = values.not_done_reason;
    if (!isTestNotDoneReason(reason)) return values;
    return { ...values, not_done_reason: notDoneReasonForViewer(reason, viewer) };
  };
  const results = tables['public.test_result'];
  const history = tables['public.change_history'];
  return {
    ...tables,
    ...(results !== undefined && {
      'public.test_result': results.map((row) => project(row) as ExportedRow),
    }),
    ...(history !== undefined && {
      'public.change_history': history.map((row) =>
        row.table_name === 'test_result'
          ? { ...row, old_values: project(row.old_values), new_values: project(row.new_values) }
          : row,
      ),
    }),
  };
}

/**
 * The rows of one clinical table. `once` shares a read between the tables it
 * feeds (the pain reports and their areas): one audited call, one log row.
 */
type MedicalReader = (
  db: TenantDatabase,
  playerId: PlayerId,
  once: <T>(key: string, read: () => Promise<T>) => Promise<T>,
) => Promise<ExportedRow[]>;

/** A clinical table read by one call of its audited function (ADR 0029). */
const readAll =
  (reader: string): MedicalReader =>
  async (db, playerId) => {
    const { rows } = await db.execute<{ rows: ExportedRow[] }>(
      sql`select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as rows
            from ${sql.raw(reader)}(array[${playerId}]::uuid[]) x`,
    );
    return rows[0]?.rows ?? [];
  };

/**
 * The pain reports of the wellness (B-609, ADR 0078), all of them: the
 * audited read answers pages of at most 101, newest first, by keyset.
 */
async function readPainReports(db: TenantDatabase, playerId: PlayerId): Promise<ExportedRow[]> {
  const all: ExportedRow[] = [];
  let before: { us: string; id: string } | null = null;
  for (;;) {
    const page: { rows: (ExportedRow & { created_us: string; id: string })[] } = await db.execute(
      sql`select to_jsonb(x) - 'areas' as row, x.areas, x.id::text as id,
                 (extract(epoch from x.created_at) * 1000000)::bigint::text as created_us
            from medical.read_pain_reports(
              array[${playerId}]::uuid[], null::date, null::date, false,
              ${before === null ? sql`null::timestamptz` : sql`timestamptz 'epoch' + ${before.us}::bigint * interval '1 microsecond'`},
              ${before === null ? null : before.id}::uuid, 101, null::uuid[], null::uuid[]) x`,
    );
    all.push(...page.rows);
    const last = page.rows.at(-1);
    if (page.rows.length < 101 || last === undefined) return all;
    before = { us: last.created_us, id: last.id };
  }
}

const painReports: MedicalReader = async (db, playerId, once) =>
  (await once('pain_report', () => readPainReports(db, playerId))).map(
    (entry) => entry.row as ExportedRow,
  );

const painReportAreas: MedicalReader = async (db, playerId, once) =>
  (await once('pain_report', () => readPainReports(db, playerId))).flatMap((entry) =>
    (entry.areas as { region: string; side: string; intensity: number }[]).map((area) => ({
      report_id: entry.id,
      body_region: area.region,
      side: area.side,
      intensity: area.intensity,
    })),
  );

/**
 * The menarche reports of a girl (B-805, ADR 0087), all of them: the audited
 * read answers pages of at most 101, newest first, by keyset.
 */
const menarcheReports: MedicalReader = async (db, playerId) => {
  const all: ExportedRow[] = [];
  let before: { us: string; id: string } | null = null;
  for (;;) {
    const page: { rows: { row: ExportedRow; id: string; created_us: string }[] } = await db.execute(
      sql`select to_jsonb(x) as row, x.id::text as id,
                   (extract(epoch from x.created_at) * 1000000)::bigint::text as created_us
              from medical.read_menarche_reports(
                array[${playerId}]::uuid[],
                ${before === null ? sql`null::timestamptz` : sql`timestamptz 'epoch' + ${before.us}::bigint * interval '1 microsecond'`},
                ${before === null ? null : before.id}::uuid, 101, null::uuid[], null::uuid[]) x`,
    );
    all.push(...page.rows.map((entry) => entry.row));
    const last = page.rows.at(-1);
    if (page.rows.length < 101 || last === undefined) return all;
    before = { us: last.created_us, id: last.id };
  }
};

/** Clinical tables read through the audited functions of the `medical` schema (ADR 0029). */
export const MEDICAL_READS: Readonly<Record<string, MedicalReader>> = {
  'medical.injury': readAll('medical.read_injuries'),
  'medical.concussion': readAll('medical.read_concussions'),
  'medical.concussion_stage': readAll('medical.read_concussion_stages'),
  'medical.note': readAll('medical.read_notes'),
  'medical.pain_report': painReports,
  'medical.pain_report_area': painReportAreas,
  'medical.menarche_report': menarcheReports,
};

async function readMedical(db: TenantDatabase, playerId: PlayerId): Promise<ExportedTables> {
  const tables: ExportedTables = {};
  const shared = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, read: () => Promise<T>): Promise<T> => {
    let pending = shared.get(key) as Promise<T> | undefined;
    if (pending === undefined) {
      pending = read();
      shared.set(key, pending);
    }
    return pending;
  };
  for (const [table, read] of Object.entries(MEDICAL_READS)) {
    tables[table] = await read(db, playerId, once);
  }
  return tables;
}

async function exportMedical(
  db: TenantDatabase,
  role: Role,
  allowed: boolean,
  facts: PlayerFacts,
): Promise<PlayerDataExport['medical']> {
  if (allowed) return { included: true, reason: null, tables: await readMedical(db, facts.id) };
  const reason = role === 'admin' ? 'not_holder' : 'no_health_consent';
  return { included: false, reason, tables: {} };
}

/** The player's own account: for the player and the administration (never the guardian). */
async function exportAccount(
  db: TenantDatabase,
  role: Role,
  clubId: ClubId,
  playerId: PlayerId,
): Promise<PlayerDataExport['account']> {
  if (role !== 'player' && role !== 'admin') return null;
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(player)
    .innerJoin(user, eq(user.id, player.userId))
    .where(and(eq(player.clubId, clubId), eq(player.id, playerId)));
  return row === undefined ? null : { id: row.id as UserId, name: row.name, email: row.email };
}

function attachmentName(playerId: PlayerId, generatedAt: Date): string {
  return `datos-${playerId}-${generatedAt.toISOString().slice(0, 10)}.json`;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export function registerDataSubjectRightsRoutes(app: FastifyInstance): void {
  registerEndpoint(app, exportPlayerData, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      const { clubId, role } = caller.membership;
      const { facts } = await requirePlayerFacts(db, clubId, params.playerId);
      await permissions.authorize('data_export', 'export', { player: facts });
      const requesterRole = requesterRoleOf(role);

      const byClientUuid = async (clientUuid: string) =>
        (
          await db
            .select({
              id: dataSubjectRequest.id,
              playerId: dataSubjectRequest.playerId,
              kind: dataSubjectRequest.kind,
            })
            .from(dataSubjectRequest)
            .where(
              and(
                eq(dataSubjectRequest.clubId, clubId),
                eq(dataSubjectRequest.clientUuid, clientUuid),
              ),
            )
        )[0];
      const { row: request } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(dataSubjectRequest)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                playerId: facts.id,
                kind: 'access',
                status: 'completed',
                requestedBy: caller.userId,
                requesterRole,
                resolvedAt: sql`now()`,
                resolvedBy: caller.userId,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({
                target: [dataSubjectRequest.clubId, dataSubjectRequest.clientUuid],
              })
              .returning({
                id: dataSubjectRequest.id,
                playerId: dataSubjectRequest.playerId,
                kind: dataSubjectRequest.kind,
              })
          )[0],
        findByClientUuid: byClientUuid,
      });
      if (request.playerId !== facts.id || request.kind !== 'access') {
        throw new HttpError('conflict', 'This clientUuid was already used');
      }

      const { rows } = await db.execute<{ data: ExportedTables | null; now: Date }>(
        sql`select app.export_player_data(${facts.id}::uuid) as data, now() as now`,
      );
      const exported = rows[0]?.data;
      if (exported === null || exported === undefined) {
        throw new HttpError('not_found', 'Player not found');
      }
      const generatedAt = new Date(rows[0]?.now ?? Date.now());
      const [clubRow] = await db
        .select({ id: club.id, name: club.name })
        .from(club)
        .where(eq(club.id, clubId));
      if (clubRow === undefined) throw new HttpError('not_found', 'Club not found');

      const subject = await permissions.subject();
      const medicalAllowed = can(subject, 'read', {
        kind: 'medical_record',
        clubId,
        player: facts,
      });
      void reply.header('cache-control', 'no-store');
      void reply.header(
        'content-disposition',
        `attachment; filename="${attachmentName(facts.id, generatedAt)}"`,
      );
      return {
        format: PLAYER_DATA_EXPORT_FORMAT,
        formatVersion: PLAYER_DATA_EXPORT_FORMAT_VERSION,
        generatedAt: generatedAt.toISOString(),
        requestId: request.id,
        club: { id: clubRow.id, name: clubRow.name },
        playerId: facts.id,
        account: await exportAccount(db, role, clubId, facts.id),
        tables: projectNotDoneReasons(exported, role),
        medical: await exportMedical(db, role, medicalAllowed, facts),
      };
    },
  });

  registerEndpoint(app, requestPlayerErasure, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      const { clubId, role } = caller.membership;
      const byClientUuid = async (clientUuid: string) =>
        (
          await db
            .select({
              id: dataSubjectRequest.id,
              playerId: dataSubjectRequest.playerId,
              kind: dataSubjectRequest.kind,
            })
            .from(dataSubjectRequest)
            .where(
              and(
                eq(dataSubjectRequest.clubId, clubId),
                eq(dataSubjectRequest.clientUuid, clientUuid),
              ),
            )
        )[0];
      // A retry of a request that went through answers the same, even once executed (the
      // player may be gone by then).
      if (body.clientUuid !== undefined) {
        const previous = await byClientUuid(body.clientUuid);
        if (previous !== undefined) {
          if (previous.playerId !== params.playerId || previous.kind !== 'erasure') {
            throw new HttpError('conflict', 'This clientUuid was already used');
          }
          markReplay(reply);
          return requestDto(await requireRequest(db, clubId, previous.id));
        }
      }
      const { facts } = await requirePlayerFacts(db, clubId, params.playerId);
      await permissions.authorize('data_erasure', 'request', { player: facts });
      const [pending] = await db
        .select({ id: dataSubjectRequest.id })
        .from(dataSubjectRequest)
        .where(
          and(
            eq(dataSubjectRequest.clubId, clubId),
            eq(dataSubjectRequest.playerId, facts.id),
            eq(dataSubjectRequest.kind, 'erasure'),
            eq(dataSubjectRequest.status, 'pending'),
          ),
        );
      if (pending !== undefined) {
        throw new HttpError('conflict', 'The player already has a pending erasure request');
      }
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(dataSubjectRequest)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                playerId: facts.id,
                kind: 'erasure',
                status: 'pending',
                requestedBy: caller.userId,
                requesterRole: requesterRoleOf(role),
                note: body.note ?? null,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({
                target: [dataSubjectRequest.clubId, dataSubjectRequest.clientUuid],
              })
              .returning({ id: dataSubjectRequest.id })
          )[0],
        findByClientUuid: async (clientUuid) => {
          const found = await byClientUuid(clientUuid);
          return found === undefined ? undefined : { id: found.id };
        },
      });
      return requestDto(await requireRequest(db, clubId, row.id));
    },
  });

  registerEndpoint(app, listDataSubjectRequests, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const { clubId, role } = caller.membership;
      // Denied roles answer 403; the holder lists what they asked for (RLS too), also once
      // the player is gone and no longer in their scope.
      await permissions.listScope('data_erasure', 'read');
      const plan = keysetPage(REQUEST_KEYS, query, {
        kind: query.kind,
        status: query.status,
        playerId: query.playerId,
      });
      const rows = await selectRequests(
        db,
        clubId,
        and(
          role === 'admin' ? undefined : eq(dataSubjectRequest.requestedBy, caller.userId),
          query.kind === undefined ? undefined : eq(dataSubjectRequest.kind, query.kind),
          query.status === undefined ? undefined : eq(dataSubjectRequest.status, query.status),
          query.playerId === undefined
            ? undefined
            : eq(dataSubjectRequest.playerId, query.playerId),
          plan.where,
        ),
      )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, requestDto);
    },
  });

  registerEndpoint(app, getDataSubjectRequest, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId, role } = caller.membership;
      await permissions.listScope('data_erasure', 'read');
      const row = await requireRequest(db, clubId, params.requestId);
      if (role !== 'admin' && row.requestedBy !== caller.userId) {
        throw new HttpError('not_found', 'Request not found');
      }
      return requestDto(row);
    },
  });

  registerEndpoint(app, cancelDataSubjectRequest, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId, role } = caller.membership;
      await permissions.listScope('data_erasure', 'request');
      const row = await requireRequest(db, clubId, params.requestId);
      if (role !== 'admin' && row.requestedBy !== caller.userId) {
        throw new HttpError('not_found', 'Request not found');
      }
      return requestDto(
        await resolveRequest(db, clubId, row.id, caller.userId, 'cancelled', body.reason ?? null),
      );
    },
  });

  registerEndpoint(app, rejectDataSubjectRequest, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      await permissions.authorize('data_erasure', 'execute', {});
      const row = await requireRequest(db, clubId, params.requestId);
      return requestDto(
        await resolveRequest(db, clubId, row.id, caller.userId, 'rejected', body.reason),
      );
    },
  });

  registerEndpoint(app, executeErasure, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply, log }) => {
      const { clubId } = caller.membership;
      // Only the administration, before anything about the request is told.
      await permissions.authorize('data_erasure', 'execute', {});
      requireFreshSession(caller, 'Sign in again (a new code) to erase a player');
      const row = await requireRequest(db, clubId, params.requestId);
      if (body.playerId !== row.playerId) {
        throw new HttpError('conflict', 'The request is about another player');
      }
      // A retry of an erasure that went through answers the same (the player is gone by then).
      if (row.kind === 'erasure' && row.status === 'completed') {
        markReplay(reply);
        return requestDto(row);
      }
      if (row.kind !== 'erasure' || row.status !== 'pending') {
        throw new HttpError('conflict', 'The request is no longer pending');
      }
      const { facts } = await requirePlayerFacts(db, clubId, row.playerId).catch(
        (error: unknown) => {
          // A pending request of a player that is gone (cannot happen through the API, which
          // erases and completes in one transaction) is not executable.
          if (error instanceof HttpError && error.code === 'not_found') {
            throw new HttpError('conflict', 'The request is no longer pending');
          }
          throw error;
        },
      );
      await permissions.authorize('data_erasure', 'execute', { player: facts });
      const counts = await db
        .execute<{ counts: ErasedRows }>(sql`select app.erase_player(${row.id}::uuid) as counts`)
        .catch((error: unknown) => {
          if (databaseErrorOf(error)?.constraint === ERASURE_BLOCKED_CONSTRAINT) {
            // A row that is not the player's points at their data: nothing was erased.
            throw new HttpError(
              'conflict',
              'A record that is not part of the player points at their data; resolve it first',
            );
          }
          throw error;
        });
      // Ids and counts only (ADR 0016).
      log.info(
        {
          dataSubjectRequestId: row.id,
          playerId: row.playerId,
          erasedRows: counts.rows[0]?.counts,
        },
        'player erased',
      );
      return requestDto(await requireRequest(db, clubId, row.id));
    },
  });
}

/** Raised by `app.erase_player` when a row that is not the player's points at theirs. */
const ERASURE_BLOCKED_CONSTRAINT = 'erasure_blocked';

/**
 * Irreversible operations ask for a session opened in the last minutes
 * (`ACCOUNT_DELETION_FRESH_SESSION_S`): a forgotten unlocked phone is not enough.
 */
function requireFreshSession(caller: { session: { createdAt: Date } }, message: string): void {
  const ageMs = Date.now() - caller.session.createdAt.getTime();
  if (ageMs > ACCOUNT_DELETION_FRESH_SESSION_S * 1000) {
    throw new HttpError('reauthentication_required', message);
  }
}

export function registerAccountDeletionRoute(app: FastifyInstance): void {
  registerEndpoint(app, deleteMyAccount, {
    transaction: true,
    handler: async ({ body }, { db, auth: caller, reply, log }) => {
      if (caller.isSuperadmin) {
        throw new HttpError('conflict', 'A superadmin account is deleted by an operator');
      }
      requireFreshSession(caller, 'Sign in again (a new code) to delete the account');
      // The requests it files are in every club of the caller, not only the selected one: the
      // function returns them (RLS would hide them once their author is gone).
      const { rows } = await db.execute<{
        outcome: AccountDeletionOutcome;
        erasure_requests: AccountDeletion['erasureRequests'];
      }>(sql`select outcome, erasure_requests from app.delete_own_account(${body.requestErasure})`);
      const result = rows[0];
      if (result === undefined) throw new Error('deleteMyAccount: no outcome');
      // Ids only (ADR 0016).
      log.info(
        {
          userId: caller.userId,
          outcome: result.outcome,
          erasureRequestIds: result.erasure_requests.map((r) => r.id),
        },
        'account deleted',
      );
      // The sessions are gone with the account: the browser forgets the cookie too.
      void reply.header('clear-site-data', '"cookies"');
      void reply.header('cache-control', 'no-store');
      return { outcome: result.outcome, erasureRequests: result.erasure_requests };
    },
  });
}
