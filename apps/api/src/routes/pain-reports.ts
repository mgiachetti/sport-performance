import { randomUUID } from 'node:crypto';
import {
  getPainReportForm,
  listPainReports,
  reviewPainReport,
  submitPainReport,
  type PainReport,
  type PainReportForm,
  type ValidationIssue,
} from '@sport-performance/contracts';
import { playerCategory } from '@sport-performance/db/schema';
import {
  isWithinWellnessWindow,
  maxPainIntensity,
  painReportIssues,
  painReportModuleOn,
  painReportUnavailableReason,
  type ClubId,
  type LocalDate,
  type PainArea,
  type PainReportProblem,
  type PlayerFacts,
  type PlayerId,
} from '@sport-performance/domain';
import { and, eq, isNull, gt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { clubModules } from '../http/club-modules.js';
import { requirePlayerFacts } from '../http/consents.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { filtersFingerprint } from '../http/pagination.js';
import { clubToday, type RequestPermissions } from '../http/permissions.js';
import { markReplay } from '../http/writes.js';
import { lockKeys } from '../sync/locks.js';

/**
 * Pain reports of the wellness (B-609, ADR 0078). Health data in the
 * `medical` schema: the player writes their own answer (plain INSERTs under
 * the RLS of migration `0040_pain_reports`, without `RETURNING`, which would
 * read it), everyone reads through `medical.read_pain_reports`, which logs
 * the access; the assigned medical staff reviews. The wellness the coach
 * reads is untouched: no trace of the pain report in it.
 */

/** A row of `medical.read_pain_reports`, with `created_at` exact to the microsecond. */
interface EntryRow extends Record<string, unknown> {
  id: string;
  client_uuid: string;
  player_id: PlayerId;
  local_date: string;
  has_pain: boolean;
  comment: string | null;
  created_at: string;
  created_us: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  areas: PainArea[];
}

interface ReadOptions {
  readonly playerIds?: readonly string[] | null;
  readonly from?: LocalDate | null;
  readonly to?: LocalDate | null;
  readonly onlyPending?: boolean;
  /** `(created_at in µs since 1970, id)` of the last row of the previous page. */
  readonly before?: readonly [string, string] | null;
  readonly maxRows?: number;
  readonly clientUuids?: readonly string[] | null;
  readonly ids?: readonly string[] | null;
}

const uuidArray = (values: readonly string[] | null | undefined): SQL =>
  values === null || values === undefined
    ? sql`null::uuid[]`
    : sql`${`{${values.join(',')}}`}::uuid[]`;

/** The logged read of the medical schema. */
async function readReports(db: TenantDatabase, options: ReadOptions = {}): Promise<EntryRow[]> {
  const before = options.before ?? null;
  const { rows } = await db.execute<EntryRow>(sql`
    select r.id, r.client_uuid, r.player_id, r.local_date::text as local_date, r.has_pain,
           r.comment, to_json(r.created_at)#>>'{}' as created_at,
           (extract(epoch from r.created_at) * 1000000)::bigint::text as created_us,
           to_json(r.reviewed_at)#>>'{}' as reviewed_at, r.reviewed_by, r.areas
      from medical.read_pain_reports(
        ${uuidArray(options.playerIds)},
        ${options.from ?? null}::date,
        ${options.to ?? null}::date,
        ${options.onlyPending ?? false},
        ${before === null ? sql`null::timestamptz` : sql`timestamptz 'epoch' + ${before[0]}::bigint * interval '1 microsecond'`},
        ${before === null ? null : before[1]}::uuid,
        ${options.maxRows ?? 101}::integer,
        ${uuidArray(options.clientUuids)},
        ${uuidArray(options.ids)}
      ) r`);
  return rows;
}

function painReportDto(row: EntryRow): PainReport {
  const areas = row.areas.map(({ region, side, intensity }) => ({ region, side, intensity }));
  return {
    id: row.id as PainReport['id'],
    clientUuid: row.client_uuid as PainReport['clientUuid'],
    playerId: row.player_id,
    localDate: row.local_date as LocalDate,
    hasPain: row.has_pain,
    areas,
    comment: row.comment,
    maxIntensity: maxPainIntensity(areas),
    submittedAt: new Date(row.created_at).toISOString(),
    reviewedAt: row.reviewed_at === null ? null : new Date(row.reviewed_at).toISOString(),
    reviewedBy: row.reviewed_by as PainReport['reviewedBy'],
  };
}

/** The caller's own player: only a player answers, about themselves. */
async function ownPlayer(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
): Promise<PlayerFacts> {
  const subject = await permissions.subject();
  const playerId = subject.playerId ?? null;
  if (playerId === null) {
    // Not a player (or a player without a profile): the matrix answers.
    await permissions.authorize('pain_report', 'submit');
    throw new HttpError('forbidden', 'You are not allowed to do this');
  }
  return (await requirePlayerFacts(db, clubId, playerId)).facts;
}

const PROBLEM_MESSAGES: Readonly<Record<PainReportProblem, string>> = {
  areas_required: 'An answer with pain marks at least one area',
  areas_without_pain: 'An answer without pain has no areas',
  too_many_areas: 'Too many areas',
  side_not_for_region: 'Not a side of this area (left or right for limbs, central for the trunk)',
  intensity_out_of_range: 'An integer from 1 to 10',
  duplicate_area: 'The same area and side twice',
  comment_without_pain: 'A comment goes only with pain',
  comment_blank: 'An empty comment',
  comment_too_long: 'Too long',
};

function assertAnswer(answer: Parameters<typeof painReportIssues>[0]): void {
  const issues: ValidationIssue[] = painReportIssues(answer).map(({ path, problem }) => ({
    path: ['body', ...path],
    code: 'custom',
    message: PROBLEM_MESSAGES[problem],
  }));
  if (issues.length > 0) {
    throw new HttpError('validation_failed', 'The answer is not valid', { details: issues });
  }
}

// ─── Cursor of the list (newest first by created_at, exact to the µs, and id) ────────

interface CursorPayload {
  readonly v: 1;
  readonly f: string;
  readonly k: readonly [string, string];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function encodeCursor(fingerprint: string, row: EntryRow): string {
  const payload: CursorPayload = { v: 1, f: fingerprint, k: [row.created_us, row.id] };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, fingerprint: string): readonly [string, string] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError('bad_request', 'Invalid cursor');
  }
  const { v, f, k } = (parsed ?? {}) as Partial<Record<keyof CursorPayload, unknown>>;
  if (v !== 1 || !Array.isArray(k) || k.length !== 2) {
    throw new HttpError('bad_request', 'Invalid cursor');
  }
  if (f !== fingerprint) {
    throw new HttpError('bad_request', 'The cursor belongs to other filters');
  }
  const [us, id] = k as [unknown, unknown];
  if (
    typeof us !== 'string' ||
    !/^\d{1,19}$/.test(us) ||
    typeof id !== 'string' ||
    !UUID.test(id)
  ) {
    throw new HttpError('bad_request', 'Invalid cursor');
  }
  return [us, id];
}

/** Players in the category on the club's day, under RLS (the caller sees them). */
async function playersInCategory(
  db: TenantDatabase,
  clubId: ClubId,
  categoryId: string,
  today: LocalDate,
): Promise<string[]> {
  const rows = await db
    .select({ playerId: playerCategory.playerId })
    .from(playerCategory)
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        eq(playerCategory.categoryId, categoryId as never),
        lte(playerCategory.validFrom, today),
        or(isNull(playerCategory.validTo), gt(playerCategory.validTo, today)),
      ),
    );
  return rows.map((row) => row.playerId);
}

export function registerPainReportRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getPainReportForm, {
    transaction: true,
    handler: async (_input, { db, permissions, auth: caller }): Promise<PainReportForm> => {
      const { clubId } = caller.membership;
      const today = await clubToday(db);
      const facts = await ownPlayer(db, permissions, clubId);
      const reason = painReportUnavailableReason(
        await clubModules(db, clubId),
        facts.consents ?? [],
      );
      let latest: PainReport | null = null;
      if (reason === null) {
        await permissions.authorize('pain_report', 'submit', { player: facts });
        const [row] = await readReports(db, {
          playerIds: [facts.id],
          from: today,
          to: today,
          maxRows: 1,
        });
        latest = row === undefined ? null : painReportDto(row);
      }
      return {
        playerId: facts.id,
        localDate: today,
        enabled: reason === null,
        unavailableReason: reason,
        latest,
      };
    },
  });

  registerEndpoint(app, submitPainReport, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const today = await clubToday(db);
      const facts = await ownPlayer(db, permissions, clubId);
      await permissions.authorize('pain_report', 'submit', { player: facts });
      const clientUuid = body.clientUuid ?? randomUUID();
      if (body.clientUuid !== undefined) {
        // Two sends of the same answer wait for each other: the second one finds the first.
        await lockKeys(db, [`pain_report:${body.clientUuid}`]);
        // A replay of the offline queue answers what it created, even after the window closed.
        const [replay] = await readReports(db, {
          playerIds: [facts.id],
          clientUuids: [body.clientUuid],
          maxRows: 1,
        });
        if (replay !== undefined) {
          markReplay(reply);
          return painReportDto(replay);
        }
      }
      if (!painReportModuleOn(await clubModules(db, clubId))) {
        throw new HttpError('forbidden', 'The club does not ask for pain reports');
      }
      const day = body.localDate ?? today;
      if (!isWithinWellnessWindow(day, today)) {
        throw new HttpError('validation_failed', 'A pain report is for today or yesterday', {
          details: [
            {
              path: ['body', 'localDate'],
              code: 'custom',
              message: `A club day from yesterday to today (${today})`,
            },
          ],
        });
      }
      const comment = body.comment ?? null;
      assertAnswer({ hasPain: body.hasPain, areas: body.areas, comment });

      const id = randomUUID();
      // Plain INSERTs (column grants, no RETURNING): the API cannot read the row back.
      await db.execute(sql`
        insert into medical.pain_report
          (id, club_id, client_uuid, player_id, local_date, has_pain, comment, created_by, updated_by)
        values (${id}::uuid, ${clubId}::uuid, ${clientUuid}::uuid, ${facts.id}::uuid, ${day}::date,
                ${body.hasPain}, ${comment}, ${caller.userId}, ${caller.userId})`);
      for (const area of body.areas) {
        await db.execute(sql`
          insert into medical.pain_report_area
            (id, club_id, client_uuid, player_id, report_id, body_region, side, intensity,
             created_by, updated_by)
          values (${randomUUID()}::uuid, ${clubId}::uuid, ${randomUUID()}::uuid,
                  ${facts.id}::uuid, ${id}::uuid, ${area.region}::medical.injury_body_region,
                  ${area.side}::medical.injury_side, ${area.intensity}::smallint,
                  ${caller.userId}, ${caller.userId})`);
      }
      const [row] = await readReports(db, { playerIds: [facts.id], ids: [id], maxRows: 1 });
      if (row === undefined) throw new Error(`pain report ${id}: not readable after its insert`);
      return painReportDto(row);
    },
  });

  registerEndpoint(app, listPainReports, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('pain_report', 'read');
      if (scope.kind === 'none' || scope.kind === 'platform') {
        // Nobody else reads health data: a `403`, never an empty page that hides the rule.
        await permissions.authorize('pain_report', 'read');
        throw new HttpError('forbidden', 'You are not allowed to do this');
      }
      // The scope (assigned, own, guardian) and the health consent of the holder are the
      // database's (`medical.readable_players`); the filters narrow it down.
      const fingerprint = filtersFingerprint({
        playerId: query.playerId,
        categoryId: query.categoryId,
        from: query.from,
        to: query.to,
        status: query.status,
      });
      const before = query.cursor === undefined ? null : decodeCursor(query.cursor, fingerprint);
      let playerIds: string[] | null = query.playerId === undefined ? null : [query.playerId];
      if (query.categoryId !== undefined) {
        const inCategory = await playersInCategory(
          db,
          caller.membership.clubId,
          query.categoryId,
          await clubToday(db),
        );
        playerIds =
          playerIds === null ? inCategory : playerIds.filter((id) => inCategory.includes(id));
        if (playerIds.length === 0) return { items: [], nextCursor: null };
      }
      const rows = await readReports(db, {
        playerIds,
        from: query.from ?? null,
        to: query.to ?? null,
        onlyPending: query.status === 'pending',
        before,
        maxRows: query.limit + 1,
      });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map(painReportDto),
        nextCursor:
          rows.length > query.limit && last !== undefined ? encodeCursor(fingerprint, last) : null,
      };
    },
  });

  registerEndpoint(app, reviewPainReport, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const scope = await permissions.listScope('pain_report', 'review');
      if (scope.kind === 'none') {
        await permissions.authorize('pain_report', 'review');
        throw new HttpError('forbidden', 'You are not allowed to do this');
      }
      // Two reviews of the same report wait for each other: the second one sees the first.
      await lockKeys(db, [`pain_report_review:${params.painReportId}`]);
      const [entry] = await readReports(db, { ids: [params.painReportId], maxRows: 1 });
      if (entry === undefined) throw new HttpError('not_found', 'Pain report not found');
      const { facts } = await requirePlayerFacts(db, clubId, entry.player_id);
      await permissions.authorize('pain_report', 'review', { player: facts });
      if (entry.reviewed_at !== null) {
        throw new HttpError('conflict', 'The pain report was already reviewed');
      }
      // By id only: the API reads no other column (the club is the RLS's restrictive policy).
      await db.execute(sql`
        update medical.pain_report
           set reviewed_at = now(), reviewed_by = ${caller.userId}, updated_by = ${caller.userId}
         where id = ${entry.id}::uuid`);
      const [row] = await readReports(db, { ids: [entry.id], maxRows: 1 });
      if (row === undefined) throw new Error(`pain report ${entry.id}: gone after its review`);
      return painReportDto(row);
    },
  });
}
