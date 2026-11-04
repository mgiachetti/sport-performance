import { randomUUID } from 'node:crypto';
import {
  getMenarche,
  reportMenarche,
  type MenarcheRecord,
  type MenarcheReport,
  type ValidationIssue,
} from '@sport-performance/contracts';
import { anthroMeasurement, club, player } from '@sport-performance/db/schema';
import {
  MENARCHE_REFERENCE_PROVENANCE,
  ageAtMenarcheYears,
  checkOffsetAgainstMenarche,
  decide,
  isMenarcheReporter,
  menarcheApplies,
  menarcheReportIssues,
  resolveClubModules,
  resolveDerivedParameters,
  truncateMenarcheDate,
  type ClubId,
  type LocalDate,
  type MenarcheDatePrecision,
  type MenarcheReference,
  type MenarcheReportProblem,
  type MenarcheReporter,
  type MenarcheStatus,
  type PlayerFacts,
  type PlayerId,
} from '@sport-performance/domain';
import { and, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { requirePlayerFacts } from '../http/consents.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import type { RequestPermissions } from '../http/permissions.js';
import { markReplay } from '../http/writes.js';
import { lockKeys } from '../sync/locks.js';

/**
 * Menarche of a girl (B-805, ADR 0089). Health data in the `medical` schema:
 * plain INSERTs under the RLS of migration `0045_menarche` (column grants,
 * no `RETURNING`), every read through `medical.read_menarche_reports`, which
 * logs it. The record validates the girl's somatic maturity offset for the
 * ones who read it; the offset the rest of the staff sees never changes.
 */

/** How many reports the record shows (the latest counts; the rest is its history). */
const HISTORY_SIZE = 20;

/** A row of `medical.read_menarche_reports`. */
interface EntryRow extends Record<string, unknown> {
  id: string;
  client_uuid: string;
  player_id: PlayerId;
  status: MenarcheStatus;
  occurred_on: string | null;
  precision: MenarcheDatePrecision | null;
  reported_on: string;
  reported_by: MenarcheReporter;
  created_at: string;
  created_by: string | null;
}

interface ReadOptions {
  readonly playerIds?: readonly string[] | null;
  readonly maxRows?: number;
  readonly clientUuids?: readonly string[] | null;
  readonly ids?: readonly string[] | null;
}

const uuidArray = (values: readonly string[] | null | undefined): SQL =>
  values === null || values === undefined
    ? sql`null::uuid[]`
    : sql`${`{${values.join(',')}}`}::uuid[]`;

/** The logged read of the medical schema, newest first. */
async function readReports(db: TenantDatabase, options: ReadOptions = {}): Promise<EntryRow[]> {
  const { rows } = await db.execute<EntryRow>(sql`
    select r.id, r.client_uuid, r.player_id, r.status::text as status,
           r.occurred_on::text as occurred_on, r.precision::text as precision,
           r.reported_on::text as reported_on, r.reported_by::text as reported_by,
           to_json(r.created_at)#>>'{}' as created_at, r.created_by
      from medical.read_menarche_reports(
        ${uuidArray(options.playerIds)},
        null::timestamptz,
        null::uuid,
        ${options.maxRows ?? 101}::integer,
        ${uuidArray(options.clientUuids)},
        ${uuidArray(options.ids)}
      ) r`);
  return rows;
}

function reportDto(row: EntryRow, birthDate: LocalDate): MenarcheReport {
  const occurredOn = row.occurred_on as LocalDate | null;
  return {
    id: row.id as MenarcheReport['id'],
    clientUuid: row.client_uuid as MenarcheReport['clientUuid'],
    playerId: row.player_id,
    status: row.status,
    occurredOn,
    precision: row.precision,
    reportedOn: row.reported_on as LocalDate,
    reportedBy: row.reported_by,
    reportedByUserId: row.created_by as MenarcheReport['reportedByUserId'],
    reportedAt: new Date(row.created_at).toISOString(),
    ageAtMenarcheYears:
      occurredOn === null || row.precision === null
        ? null
        : ageAtMenarcheYears(birthDate, occurredOn, row.precision).ageYears,
  };
}

interface ClubMenarcheSettings {
  readonly maturationOn: boolean;
  readonly reference: MenarcheReference;
}

async function clubSettings(db: TenantDatabase, clubId: ClubId): Promise<ClubMenarcheSettings> {
  const [row] = await db.select({ settings: club.settings }).from(club).where(eq(club.id, clubId));
  if (row === undefined) throw new HttpError('forbidden', 'The club of the request is not visible');
  return {
    maturationOn: resolveClubModules(row.settings.modules).maturation,
    reference: resolveDerivedParameters(row.settings.derived).maturation.menarche,
  };
}

/** Whether the caller may report the girl's menarche now (no throw). */
async function mayReport(
  permissions: RequestPermissions,
  clubId: ClubId,
  facts: PlayerFacts,
): Promise<boolean> {
  const subject = await permissions.subject();
  return decide(subject, 'report', { kind: 'menarche', clubId, player: facts }).allowed;
}

/** Whether the caller reads the girl's anthropometry (the guardian does not, matrix). */
async function readsAnthropometry(
  permissions: RequestPermissions,
  clubId: ClubId,
  facts: PlayerFacts,
): Promise<boolean> {
  const subject = await permissions.subject();
  return decide(subject, 'read', { kind: 'anthropometry', clubId, player: facts }).allowed;
}

const PROBLEM_MESSAGES: Readonly<Record<MenarcheReportProblem, string>> = {
  date_required: 'An occurred menarche needs its date',
  precision_required: 'An occurred menarche needs the precision of its date',
  date_without_menarche: 'Only an occurred menarche has a date and a precision',
  date_after_report: 'Not after today',
  date_before_birth: 'Not before the birth date',
  age_implausible: 'The age at menarche is outside the plausible range',
  not_yet_implausible: 'The player is older than the plausible age at menarche',
};

/** The last offset of the girl against the latest report, for those who read both. */
async function offsetCheck(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
  birthDate: LocalDate,
  latest: EntryRow,
  reference: MenarcheReference,
): Promise<MenarcheRecord['offsetCheck']> {
  const [measurement] = await db
    .select({
      measuredOn: anthroMeasurement.measuredOn,
      phvOffsetYears: anthroMeasurement.phvOffsetYears,
      equation: anthroMeasurement.maturityOffsetEquation,
    })
    .from(anthroMeasurement)
    .where(
      and(
        eq(anthroMeasurement.clubId, clubId),
        eq(anthroMeasurement.playerId, playerId),
        isNotNull(anthroMeasurement.phvOffsetYears),
      ),
    )
    .orderBy(desc(anthroMeasurement.measuredOn), desc(anthroMeasurement.createdAt))
    .limit(1);
  if (
    measurement === undefined ||
    measurement.phvOffsetYears === null ||
    measurement.equation === null
  ) {
    return null;
  }
  const check = checkOffsetAgainstMenarche(
    {
      birthDate,
      report: {
        status: latest.status,
        occurredOn: latest.occurred_on as LocalDate | null,
        precision: latest.precision,
        reportedOn: latest.reported_on as LocalDate,
      },
      measuredOn: measurement.measuredOn,
      phvOffsetYears: measurement.phvOffsetYears,
    },
    reference,
  );
  return {
    measuredOn: measurement.measuredOn,
    phvOffsetYears: measurement.phvOffsetYears,
    maturityOffsetEquation: measurement.equation,
    impliedPhvOffsetYears: check.impliedPhvOffsetYears,
    impliedMinPhvOffsetYears: check.impliedMinPhvOffsetYears,
    impliedMaxPhvOffsetYears: check.impliedMaxPhvOffsetYears,
    verdict: check.verdict,
    referenceVerification: MENARCHE_REFERENCE_PROVENANCE.verification,
  };
}

export function registerMenarcheRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getMenarche, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }): Promise<MenarcheRecord> => {
      const { clubId } = caller.membership;
      const girl = await loadGirl(db, clubId, params.playerId);
      await permissions.authorize('menarche', 'read', { player: girl.facts });
      assertGirl(girl.sex);
      const settings = await clubSettings(db, clubId);
      const rows = await readReports(db, { playerIds: [girl.facts.id], maxRows: HISTORY_SIZE });
      const latest = rows[0] ?? null;
      const canReport = settings.maturationOn && (await mayReport(permissions, clubId, girl.facts));
      const check =
        latest !== null &&
        settings.maturationOn &&
        (await readsAnthropometry(permissions, clubId, girl.facts))
          ? await offsetCheck(db, clubId, girl.facts.id, girl.birthDate, latest, settings.reference)
          : null;
      return {
        playerId: girl.facts.id,
        canReport,
        latest: latest === null ? null : reportDto(latest, girl.birthDate),
        history: rows.map((row) => reportDto(row, girl.birthDate)),
        offsetCheck: check,
      };
    },
  });

  registerEndpoint(app, reportMenarche, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      const girl = await loadGirl(db, clubId, params.playerId);
      await permissions.authorize('menarche', 'report', { player: girl.facts });
      assertGirl(girl.sex);
      const clientUuid = body.clientUuid ?? randomUUID();
      if (body.clientUuid !== undefined) {
        // Two sends of the same report wait for each other: the second one finds the first.
        await lockKeys(db, [`menarche_report:${body.clientUuid}`]);
        const [replay] = await readReports(db, {
          playerIds: [girl.facts.id],
          clientUuids: [body.clientUuid],
          maxRows: 1,
        });
        if (replay !== undefined) {
          markReplay(reply);
          return reportDto(replay, girl.birthDate);
        }
      }
      const settings = await clubSettings(db, clubId);
      if (!settings.maturationOn) {
        throw new HttpError('forbidden', 'The club has the maturation module off');
      }
      const precision = body.precision ?? null;
      const occurredOn =
        body.occurredOn === undefined || body.occurredOn === null
          ? null
          : precision === null
            ? body.occurredOn
            : truncateMenarcheDate(body.occurredOn, precision);
      const issues: ValidationIssue[] = menarcheReportIssues(
        { status: body.status, occurredOn, precision, reportedOn: girl.today },
        girl.birthDate,
        settings.reference,
      ).map(({ path, problem }) => ({
        path: ['body', ...path],
        code: 'custom',
        message: PROBLEM_MESSAGES[problem],
      }));
      if (issues.length > 0) {
        throw new HttpError('validation_failed', 'The menarche report is not valid', {
          details: issues,
        });
      }
      const reporter = (await permissions.subject()).role;
      if (!isMenarcheReporter(reporter)) {
        // The matrix lets only the player, the guardian and the medical staff through.
        throw new HttpError('forbidden', 'You are not allowed to do this');
      }

      const id = randomUUID();
      // A plain INSERT (column grants, no RETURNING): the API cannot read the row back.
      await db.execute(sql`
        insert into medical.menarche_report
          (id, club_id, client_uuid, player_id, status, occurred_on, precision, reported_on,
           reported_by, created_by, updated_by)
        values (${id}::uuid, ${clubId}::uuid, ${clientUuid}::uuid, ${girl.facts.id}::uuid,
                ${body.status}::medical.menarche_status, ${occurredOn}::date,
                ${precision}::medical.menarche_date_precision, ${girl.today}::date,
                ${reporter}::medical.menarche_reporter, ${caller.userId}, ${caller.userId})`);
      const [row] = await readReports(db, { playerIds: [girl.facts.id], ids: [id], maxRows: 1 });
      if (row === undefined)
        throw new Error(`menarche report ${id}: not readable after its insert`);
      return reportDto(row, girl.birthDate);
    },
  });
}

interface LoadedGirl {
  readonly facts: PlayerFacts;
  readonly birthDate: LocalDate;
  readonly today: LocalDate;
  readonly sex: 'male' | 'female';
}

/** The player of the route, visible to the caller (`404` otherwise), with her sex. */
async function loadGirl(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
): Promise<LoadedGirl> {
  const loaded = await requirePlayerFacts(db, clubId, playerId);
  const [row] = await db
    .select({ sex: player.sex })
    .from(player)
    .where(and(eq(player.clubId, clubId), eq(player.id, playerId)));
  if (row === undefined) throw new HttpError('not_found', 'Player not found');
  return { facts: loaded.facts, birthDate: loaded.birthDate, today: loaded.today, sex: row.sex };
}

/** After the matrix (so a caller without access learns nothing of the player's sex). */
function assertGirl(sex: 'male' | 'female'): void {
  if (!menarcheApplies(sex)) {
    throw new HttpError('conflict', 'The menarche record is only for girls');
  }
}
