import { randomUUID } from 'node:crypto';
import {
  authorizeMenstrualCycleViewer,
  endMenstrualCycleTracking,
  getMenstrualCycleDays,
  getMenstrualCycleStatus,
  listMenstrualCycleSharedWithMe,
  logMenstrualCycleDay,
  revokeMenstrualCycleViewer,
  startMenstrualCycleTracking,
  type MenstrualCycleDay,
  type MenstrualCycleStatus,
  type MenstrualCycleViewer,
  type ValidationIssue,
} from '@sport-performance/contracts';
import { player } from '@sport-performance/db/schema';
import {
  MENSTRUAL_CYCLE_VIEWERS_MAX,
  MENSTRUAL_LOG_WINDOW_DAYS,
  MENSTRUAL_READ_MAX_DAYS,
  addDays,
  compareLocalDates,
  daysBetween,
  isMenstrualCycleViewerRole,
  isWithinMenstrualLogWindow,
  latestMenstrualEntryPerDay,
  menstrualCycleDayIssues,
  menstrualCycleUnavailableReason,
  menstrualSummaryReadFrom,
  normalizeMenstrualSymptoms,
  PermissionDeniedError,
  summarizeMenstrualCycle,
  type ClubId,
  type LocalDate,
  type MenstrualCycleDayProblem,
  type MenstrualFlow,
  type MenstrualSymptom,
  type PlayerFacts,
  type PlayerId,
  type Sex,
} from '@sport-performance/domain';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { clubModules } from '../http/club-modules.js';
import { requirePlayerFacts } from '../http/consents.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import type { RequestPermissions } from '../http/permissions.js';
import { markReplay } from '../http/writes.js';
import { lockKeys } from '../sync/locks.js';

/**
 * Menstrual cycle tracking (B-806, ADR 0092). Health data in the `medical`
 * schema (migration `0049_menstrual_cycle`): only the player writes (plain
 * INSERTs and UPDATEs by id under the RLS, without `RETURNING`, which would
 * read the row); every read goes through a `medical.*` function that checks
 * the three keys (module, consents, opt-in) and the player's authorization of
 * the reader, and logs it. The handlers authorize with the matrix first, so a
 * role that never reads it gets `403`, never an empty answer that hides the
 * rule.
 */

// ─── Logged reads ────────────────────────────────────────────────────────────────────

const uuidArray = (values: readonly string[] | null | undefined): SQL =>
  values === null || values === undefined
    ? sql`null::uuid[]`
    : sql`${`{${values.join(',')}}`}::uuid[]`;

interface DayRow extends Record<string, unknown> {
  id: string;
  client_uuid: string;
  player_id: PlayerId;
  local_date: string;
  flow: MenstrualFlow;
  symptoms: MenstrualSymptom[];
  note: string | null;
  created_at: string;
}

async function readDays(
  db: TenantDatabase,
  options: {
    readonly playerIds: readonly string[];
    readonly from?: LocalDate | null;
    readonly to?: LocalDate | null;
    readonly clientUuids?: readonly string[] | null;
    readonly ids?: readonly string[] | null;
  },
): Promise<DayRow[]> {
  const { rows } = await db.execute<DayRow>(sql`
    select l.id, l.client_uuid, l.player_id, l.local_date::text as local_date, l.flow,
           l.symptoms, l.note, to_json(l.created_at)#>>'{}' as created_at
      from medical.read_menstrual_cycle_logs(
        ${uuidArray(options.playerIds)},
        ${options.from ?? null}::date,
        ${options.to ?? null}::date,
        ${uuidArray(options.clientUuids)},
        ${uuidArray(options.ids)}
      ) l`);
  return rows;
}

function dayDto(row: DayRow): MenstrualCycleDay {
  return {
    id: row.id as MenstrualCycleDay['id'],
    clientUuid: row.client_uuid as MenstrualCycleDay['clientUuid'],
    playerId: row.player_id,
    localDate: row.local_date as LocalDate,
    flow: row.flow,
    symptoms: normalizeMenstrualSymptoms(row.symptoms),
    note: row.note,
    loggedAt: new Date(row.created_at).toISOString(),
  };
}

interface EnrollmentRow extends Record<string, unknown> {
  id: string;
  client_uuid: string;
  created_at: string;
  ended_at: string | null;
}

async function readEnrollments(db: TenantDatabase, playerId: PlayerId): Promise<EnrollmentRow[]> {
  const { rows } = await db.execute<EnrollmentRow>(sql`
    select e.id, e.client_uuid, to_json(e.created_at)#>>'{}' as created_at,
           to_json(e.ended_at)#>>'{}' as ended_at
      from medical.read_menstrual_cycle_enrollments(array[${playerId}]::uuid[]) e`);
  return rows;
}

interface ShareRow extends Record<string, unknown> {
  id: string;
  client_uuid: string;
  viewer_membership_id: string;
  viewer_role: string;
  viewer_name: string;
  created_at: string;
  revoked_at: string | null;
}

async function readShares(
  db: TenantDatabase,
  playerId: PlayerId,
  options: {
    readonly includeRevoked?: boolean;
    readonly ids?: readonly string[] | null;
    readonly clientUuids?: readonly string[] | null;
  } = {},
): Promise<ShareRow[]> {
  const { rows } = await db.execute<ShareRow>(sql`
    select s.id, s.client_uuid, s.viewer_membership_id, s.viewer_role, s.viewer_name,
           to_json(s.created_at)#>>'{}' as created_at, to_json(s.revoked_at)#>>'{}' as revoked_at
      from medical.read_menstrual_cycle_shares(
        array[${playerId}]::uuid[], ${options.includeRevoked ?? false},
        ${uuidArray(options.ids)}, ${uuidArray(options.clientUuids)}) s`);
  return rows;
}

function viewerDto(row: ShareRow): MenstrualCycleViewer {
  if (!isMenstrualCycleViewerRole(row.viewer_role)) {
    throw new Error(`menstrual cycle share ${row.id}: unexpected role ${row.viewer_role}`);
  }
  return {
    id: row.id as MenstrualCycleViewer['id'],
    membershipId: row.viewer_membership_id as MenstrualCycleViewer['membershipId'],
    role: row.viewer_role,
    name: row.viewer_name,
    authorizedAt: new Date(row.created_at).toISOString(),
  };
}

interface CandidateRow extends Record<string, unknown> {
  membership_id: string;
  role: string;
  name: string;
}

async function readCandidates(db: TenantDatabase, playerId: PlayerId): Promise<CandidateRow[]> {
  const { rows } = await db.execute<CandidateRow>(sql`
    select c.membership_id, c.role, c.name
      from medical.menstrual_cycle_viewer_candidates(${playerId}::uuid) c`);
  return rows;
}

// ─── The player herself ──────────────────────────────────────────────────────────────

interface OwnPlayer {
  readonly facts: PlayerFacts;
  readonly sex: Sex;
  readonly today: LocalDate;
}

/** The caller's own player: only she tracks her cycle. */
async function ownPlayer(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
): Promise<OwnPlayer> {
  const subject = await permissions.subject();
  const playerId = subject.playerId ?? null;
  if (subject.role !== 'player' || playerId === null) {
    // Not a player (or a player without a profile): the matrix answers.
    await permissions.authorize('menstrual_cycle', 'enroll');
    throw new HttpError('forbidden', 'You are not allowed to do this');
  }
  const { facts, today } = await requirePlayerFacts(db, clubId, playerId);
  const [row] = await db
    .select({ sex: player.sex })
    .from(player)
    .where(and(eq(player.clubId, clubId), eq(player.id, playerId)));
  if (row === undefined) throw new HttpError('forbidden', 'The player is not visible');
  return { facts, sex: row.sex, today };
}

async function statusOf(
  db: TenantDatabase,
  clubId: ClubId,
  own: OwnPlayer,
): Promise<MenstrualCycleStatus> {
  const reason = menstrualCycleUnavailableReason(
    await clubModules(db, clubId),
    own.sex,
    own.facts.consents ?? [],
  );
  const active = (await readEnrollments(db, own.facts.id)).find((row) => row.ended_at === null);
  const viewers = active === undefined ? [] : (await readShares(db, own.facts.id)).map(viewerDto);
  const candidates =
    active === undefined || reason !== null
      ? []
      : (await readCandidates(db, own.facts.id)).flatMap((row) =>
          isMenstrualCycleViewerRole(row.role)
            ? [
                {
                  membershipId: row.membership_id as MenstrualCycleViewer['membershipId'],
                  role: row.role,
                  name: row.name,
                  authorized: viewers.some((viewer) => viewer.membershipId === row.membership_id),
                },
              ]
            : [],
        );
  return {
    playerId: own.facts.id,
    localDate: own.today,
    available: reason === null,
    unavailableReason: reason,
    tracking: active !== undefined,
    trackingSince: active === undefined ? null : new Date(active.created_at).toISOString(),
    viewers,
    candidates,
  };
}

/** Refuses unless the module is offered to her (module, female, consents) and, when asked, on. */
async function requireTracking(
  db: TenantDatabase,
  clubId: ClubId,
  own: OwnPlayer,
  tracking: boolean,
): Promise<void> {
  const reason = menstrualCycleUnavailableReason(
    await clubModules(db, clubId),
    own.sex,
    own.facts.consents ?? [],
  );
  if (reason === 'module_off') {
    throw new HttpError('forbidden', 'The club does not offer menstrual cycle tracking');
  }
  if (reason === 'not_female') {
    throw new HttpError('forbidden', 'Menstrual cycle tracking is for female players');
  }
  // `missing_consent` was answered by the matrix (`consent_required`).
  if (tracking && !(await readEnrollments(db, own.facts.id)).some((row) => row.ended_at === null)) {
    throw new HttpError('forbidden', 'Turn menstrual cycle tracking on first');
  }
}

const PROBLEM_MESSAGES: Readonly<Record<MenstrualCycleDayProblem, string>> = {
  duplicate_symptom: 'The same symptom twice',
  note_blank: 'An empty note',
  note_too_long: 'Too long',
};

const DEFAULT_READ_DAYS = 90;

/** What a member that may not read the range gets: the same as a range without days. */
function emptyDays(playerId: PlayerId, from: LocalDate, to: LocalDate) {
  return {
    playerId,
    from,
    to,
    days: [],
    summary: summarizeMenstrualCycle([], { from, to }),
  };
}

export function registerMenstrualCycleRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getMenstrualCycleStatus, {
    transaction: true,
    handler: async (_input, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const own = await ownPlayer(db, permissions, clubId);
      await permissions.authorize('menstrual_cycle', 'read', { player: own.facts });
      return statusOf(db, clubId, own);
    },
  });

  registerEndpoint(app, startMenstrualCycleTracking, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const own = await ownPlayer(db, permissions, clubId);
      await permissions.authorize('menstrual_cycle', 'enroll', { player: own.facts });
      await requireTracking(db, clubId, own, false);
      // Two opt-ins of the same player wait for each other: the second one finds the first.
      await lockKeys(db, [`menstrual_cycle_enrollment:${own.facts.id}`]);
      const enrollments = await readEnrollments(db, own.facts.id);
      if (
        body.clientUuid !== undefined &&
        enrollments.some((row) => row.client_uuid === body.clientUuid)
      ) {
        markReplay(reply);
        return statusOf(db, clubId, own);
      }
      if (!enrollments.some((row) => row.ended_at === null)) {
        await db.execute(sql`
          insert into medical.menstrual_cycle_enrollment
            (id, club_id, client_uuid, player_id, created_by, updated_by)
          values (${randomUUID()}::uuid, ${clubId}::uuid, ${body.clientUuid ?? randomUUID()}::uuid,
                  ${own.facts.id}::uuid, ${caller.userId}, ${caller.userId})`);
      }
      return statusOf(db, clubId, own);
    },
  });

  registerEndpoint(app, endMenstrualCycleTracking, {
    transaction: true,
    handler: async (_input, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const own = await ownPlayer(db, permissions, clubId);
      // Always possible: turning it off needs no consent.
      await permissions.authorize('menstrual_cycle', 'withdraw', { player: own.facts });
      await lockKeys(db, [`menstrual_cycle_enrollment:${own.facts.id}`]);
      const active = (await readEnrollments(db, own.facts.id)).find((row) => row.ended_at === null);
      if (active !== undefined) {
        // By id only; ending it revokes every authorization (trigger).
        await db.execute(sql`
          update medical.menstrual_cycle_enrollment
             set ended_at = now(), ended_by = ${caller.userId}, updated_by = ${caller.userId}
           where id = ${active.id}::uuid`);
      }
      return statusOf(db, clubId, own);
    },
  });

  registerEndpoint(app, logMenstrualCycleDay, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const own = await ownPlayer(db, permissions, clubId);
      await permissions.authorize('menstrual_cycle', 'log', { player: own.facts });
      const clientUuid = body.clientUuid ?? randomUUID();
      if (body.clientUuid !== undefined) {
        // Two sends of the same day wait for each other: the second one finds the first.
        await lockKeys(db, [`menstrual_cycle_log:${body.clientUuid}`]);
        // A replay of the offline queue answers what it created, even after the window closed.
        const [replay] = await readDays(db, {
          playerIds: [own.facts.id],
          clientUuids: [body.clientUuid],
        });
        if (replay !== undefined) {
          markReplay(reply);
          return dayDto(replay);
        }
      }
      await requireTracking(db, clubId, own, true);
      const day = body.localDate ?? own.today;
      if (!isWithinMenstrualLogWindow(day, own.today)) {
        throw new HttpError('validation_failed', 'A day of the cycle is today or yesterday', {
          details: [
            {
              path: ['body', 'localDate'],
              code: 'custom',
              message: `A club day from ${addDays(own.today, -(MENSTRUAL_LOG_WINDOW_DAYS - 1))} to today (${own.today})`,
            },
          ],
        });
      }
      const note = body.note ?? null;
      const issues: ValidationIssue[] = menstrualCycleDayIssues({
        flow: body.flow,
        symptoms: body.symptoms,
        note,
      }).map(({ path, problem }) => ({
        path: ['body', ...path],
        code: 'custom',
        message: PROBLEM_MESSAGES[problem],
      }));
      if (issues.length > 0) {
        throw new HttpError('validation_failed', 'The day is not valid', { details: issues });
      }
      const symptoms = normalizeMenstrualSymptoms(body.symptoms);
      const id = randomUUID();
      // A plain INSERT (column grants, no RETURNING): the API cannot read the row back.
      await db.execute(sql`
        insert into medical.menstrual_cycle_log
          (id, club_id, client_uuid, player_id, local_date, flow, symptoms, note, created_by, updated_by)
        values (${id}::uuid, ${clubId}::uuid, ${clientUuid}::uuid, ${own.facts.id}::uuid,
                ${day}::date, ${body.flow}::medical.menstrual_flow,
                ${`{${symptoms.join(',')}}`}::medical.menstrual_symptom[], ${note},
                ${caller.userId}, ${caller.userId})`);
      const [row] = await readDays(db, { playerIds: [own.facts.id], ids: [id] });
      if (row === undefined)
        throw new Error(`menstrual cycle day ${id}: not readable after insert`);
      return dayDto(row);
    },
  });

  registerEndpoint(app, getMenstrualCycleDays, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId, role } = caller.membership;
      const { facts, today } = await requirePlayerFacts(db, clubId, params.playerId);
      const to = query.to ?? today;
      const from = query.from ?? addDays(to, -(DEFAULT_READ_DAYS - 1));
      if (compareLocalDates(from, to) > 0 || daysBetween(from, to) + 1 > MENSTRUAL_READ_MAX_DAYS) {
        throw new HttpError(
          'bad_request',
          `A range from \`from\` to \`to\` of at most ${String(MENSTRUAL_READ_MAX_DAYS)} days`,
        );
      }
      // The coach, the administration and the guardian never read it (`403`); the assigned
      // medical and S&C staff read it only with the consents, and the database only when
      // the player authorized this very member (else, nothing comes back).
      try {
        await permissions.authorize('menstrual_cycle', 'read', { player: facts });
      } catch (error) {
        // For the staff, a missing consent answers as a missing authorization (an empty
        // range): the `403 consent_required` would tell whether the player signed it.
        if (
          error instanceof PermissionDeniedError &&
          error.reason === 'missing_consent' &&
          isMenstrualCycleViewerRole(role)
        ) {
          return emptyDays(facts.id, from, to);
        }
        throw error;
      }
      if (role !== 'player') {
        // Only a female player is ever read by the staff (the database checks it too).
        const [row] = await db
          .select({ sex: player.sex })
          .from(player)
          .where(and(eq(player.clubId, clubId), eq(player.id, facts.id)));
        if (row?.sex !== 'female') return emptyDays(facts.id, from, to);
      }
      // One day before `from`: whether a period on `from` starts there or comes from before.
      const rows = latestMenstrualEntryPerDay(
        (
          await readDays(db, {
            playerIds: [facts.id],
            from: menstrualSummaryReadFrom({ from, to }),
            to,
          })
        ).map((row) => ({
          ...row,
          localDate: row.local_date as LocalDate,
          loggedAt: new Date(row.created_at),
        })),
      );
      return {
        playerId: facts.id,
        from,
        to,
        days: rows.filter((row) => compareLocalDates(row.localDate, from) >= 0).map(dayDto),
        // The cycle day on the range's last day, never on a day still to come.
        summary: summarizeMenstrualCycle(rows, {
          from,
          to: compareLocalDates(to, today) > 0 ? today : to,
        }),
      };
    },
  });

  registerEndpoint(app, authorizeMenstrualCycleViewer, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const own = await ownPlayer(db, permissions, clubId);
      await permissions.authorize('menstrual_cycle', 'share', { player: own.facts });
      await requireTracking(db, clubId, own, true);
      // The authorizations of a player are decided one at a time (and counted by the trigger).
      await lockKeys(db, [`menstrual_cycle_share:${own.facts.id}`]);
      if (body.clientUuid !== undefined) {
        const [replay] = await readShares(db, own.facts.id, {
          includeRevoked: true,
          clientUuids: [body.clientUuid],
        });
        if (replay !== undefined) {
          markReplay(reply);
          return viewerDto(replay);
        }
      }
      const current = await readShares(db, own.facts.id);
      const existing = current.find((row) => row.viewer_membership_id === body.membershipId);
      if (existing !== undefined) {
        markReplay(reply);
        return viewerDto(existing);
      }
      const candidates = await readCandidates(db, own.facts.id);
      const problem = !candidates.some((row) => row.membership_id === body.membershipId)
        ? 'Only an assigned medical or S&C member can be authorized'
        : current.length >= MENSTRUAL_CYCLE_VIEWERS_MAX
          ? `At most ${String(MENSTRUAL_CYCLE_VIEWERS_MAX)} members at once`
          : null;
      if (problem !== null) {
        throw new HttpError('validation_failed', 'The member cannot be authorized', {
          details: [{ path: ['body', 'membershipId'], code: 'custom', message: problem }],
        });
      }
      const id = randomUUID();
      await db.execute(sql`
        insert into medical.menstrual_cycle_share
          (id, club_id, client_uuid, player_id, viewer_membership_id, created_by, updated_by)
        values (${id}::uuid, ${clubId}::uuid, ${body.clientUuid ?? randomUUID()}::uuid,
                ${own.facts.id}::uuid, ${body.membershipId}::uuid, ${caller.userId}, ${caller.userId})`);
      const [row] = await readShares(db, own.facts.id, { ids: [id] });
      if (row === undefined)
        throw new Error(`menstrual cycle share ${id}: not readable after insert`);
      return viewerDto(row);
    },
  });

  registerEndpoint(app, revokeMenstrualCycleViewer, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const own = await ownPlayer(db, permissions, clubId);
      // Always possible: taking an authorization back needs no consent.
      await permissions.authorize('menstrual_cycle', 'withdraw', { player: own.facts });
      await lockKeys(db, [`menstrual_cycle_share:${own.facts.id}`]);
      const [share] = await readShares(db, own.facts.id, {
        includeRevoked: true,
        ids: [params.shareId],
      });
      if (share === undefined) throw new HttpError('not_found', 'Authorization not found');
      // Already revoked (a retry): the same answer, nothing to write.
      if (share.revoked_at !== null) return statusOf(db, clubId, own);
      await db.execute(sql`
        update medical.menstrual_cycle_share
           set revoked_at = now(), revoked_by = ${caller.userId}, updated_by = ${caller.userId}
         where id = ${share.id}::uuid`);
      return statusOf(db, clubId, own);
    },
  });

  registerEndpoint(app, listMenstrualCycleSharedWithMe, {
    transaction: true,
    handler: async (_input, { db, permissions, auth: caller }) => {
      const { clubId, role } = caller.membership;
      // The matrix first (ADR 0032): the roles that never read it get `403`, a member
      // without assignments today reads nobody.
      const scope = await permissions.listScope('menstrual_cycle', 'read');
      if (!isMenstrualCycleViewerRole(role)) {
        // A player reads her own, never a list of others.
        throw new HttpError('forbidden', 'Only the medical and S&C staff are authorized');
      }
      if (scope.kind === 'none') return { items: [] };
      const { rows } = await db.execute<{ player_id: PlayerId; shared_at: string }>(sql`
        select s.player_id, to_json(s.shared_at)#>>'{}' as shared_at
          from medical.menstrual_cycle_shared_with_me() s`);
      if (rows.length === 0) return { items: [] };
      const names = await db
        .select({ id: player.id, firstName: player.firstName, lastName: player.lastName })
        .from(player)
        .where(
          and(
            eq(player.clubId, clubId),
            inArray(
              player.id,
              rows.map((row) => row.player_id),
            ),
          ),
        );
      return {
        items: rows.flatMap((row) => {
          const named = names.find((n) => n.id === row.player_id);
          return named === undefined
            ? []
            : [
                {
                  playerId: row.player_id,
                  firstName: named.firstName,
                  lastName: named.lastName,
                  authorizedAt: new Date(row.shared_at).toISOString(),
                },
              ];
        }),
      };
    },
  });
}
