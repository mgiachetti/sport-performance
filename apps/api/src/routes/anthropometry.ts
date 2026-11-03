import {
  ANTHRO_FIELDS,
  getAnthroMeasurement,
  listAnthroMeasurements,
  previewAnthroMeasurements,
  recordAnthroMeasurements,
  updateAnthroMeasurement,
  type AnthroMeasurement,
  type AnthroMeasurementInput,
  type AnthroPreview,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  anthroMeasurement,
  category,
  club,
  derivedRefresh,
  player,
  playerCategory,
  playerParentHeight,
  type TestConditions,
} from '@sport-performance/db/schema';
import { loadKhamisRocheTable } from '@sport-performance/db/seeds';
import {
  PermissionDeniedError,
  compareLocalDates,
  createPlausibilityChecker,
  daysBetween,
  decimalAgeYears,
  deriveMaturation,
  maturationGaps,
  maturityOffsetModel,
  parseMetricCode,
  resolveDerivedParameters,
  type AnthropometryInput,
  type ClubId,
  type KhamisRocheTable,
  type LocalDate,
  type MaturityOffsetEquation,
  type MeasurementMethod,
  type PlayerId,
  type Sex,
  type UserId,
} from '@sport-performance/domain';
import { and, asc, eq, exists, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { clubToday, type RequestPermissions } from '../http/permissions.js';
import { rowVersion, updateAtVersion, versionMatches } from '../http/writes.js';
import {
  clubStaffIds,
  invalid,
  issue,
  loadPlayer,
  loadPlayers,
  loadStageSources,
  readTestSession,
  stageContextOn,
  throwIssues,
  toConditions,
  type IssuePath,
  type PlayerContext,
  type StageSources,
  type TestSessionRow,
} from './tests/model.js';

/**
 * Anthropometry (B-412): the batch of a measurement day, its list and
 * corrections, and the preview of the maturation while the staff types.
 * The stored maturation is the worker's (B-326, outbox trigger on
 * `anthro_measurement` and `player_parent_height`); the preview runs the
 * same domain function with the same club parameters and seeded table.
 */

const pendingMaturation = sql<boolean>`exists (
  select 1 from ${derivedRefresh}
   where ${derivedRefresh.clubId} = ${anthroMeasurement.clubId}
     and ${derivedRefresh.playerId} = ${anthroMeasurement.playerId}
     and ${derivedRefresh.maturation})`;

const measurementColumns = {
  id: anthroMeasurement.id,
  playerId: anthroMeasurement.playerId,
  testSessionId: anthroMeasurement.testSessionId,
  measuredOn: anthroMeasurement.measuredOn,
  heightCm: anthroMeasurement.heightCm,
  sittingHeightCm: anthroMeasurement.sittingHeightCm,
  weightKg: anthroMeasurement.weightKg,
  skinfoldsSumMm: anthroMeasurement.skinfoldsSumMm,
  method: anthroMeasurement.method,
  evaluatorId: anthroMeasurement.evaluatorId,
  conditions: anthroMeasurement.conditions,
  notes: anthroMeasurement.notes,
  phvOffsetYears: anthroMeasurement.phvOffsetYears,
  maturityOffsetEquation: anthroMeasurement.maturityOffsetEquation,
  predictedAdultHeightCm: anthroMeasurement.predictedAdultHeightCm,
  adultHeightPct: anthroMeasurement.adultHeightPct,
  growthVelocityCmYear: anthroMeasurement.growthVelocityCmYear,
  derivedAt: anthroMeasurement.derivedAt,
  pending: pendingMaturation,
  createdAt: anthroMeasurement.createdAt,
  updatedAt: anthroMeasurement.updatedAt,
  version: rowVersion(anthroMeasurement.updatedAt),
};

interface MeasurementRow {
  id: string;
  playerId: PlayerId;
  testSessionId: string | null;
  measuredOn: LocalDate;
  heightCm: number | null;
  sittingHeightCm: number | null;
  weightKg: number | null;
  skinfoldsSumMm: number | null;
  method: MeasurementMethod;
  evaluatorId: string | null;
  conditions: TestConditions;
  notes: string | null;
  phvOffsetYears: number | null;
  maturityOffsetEquation: MaturityOffsetEquation | null;
  predictedAdultHeightCm: number | null;
  adultHeightPct: number | null;
  growthVelocityCmYear: number | null;
  derivedAt: Date | null;
  pending: boolean;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function measurementDto(row: MeasurementRow): AnthroMeasurement {
  return {
    id: row.id as AnthroMeasurement['id'],
    playerId: row.playerId,
    testSessionId: row.testSessionId as AnthroMeasurement['testSessionId'],
    measuredOn: row.measuredOn,
    heightCm: row.heightCm,
    sittingHeightCm: row.sittingHeightCm,
    weightKg: row.weightKg,
    skinfoldsSumMm: row.skinfoldsSumMm,
    method: row.method,
    evaluatorId: row.evaluatorId as AnthroMeasurement['evaluatorId'],
    conditions: row.conditions,
    notes: row.notes,
    maturation: {
      phvOffsetYears: row.phvOffsetYears,
      maturityOffsetEquation: row.maturityOffsetEquation,
      predictedAdultHeightCm: row.predictedAdultHeightCm,
      adultHeightPct: row.adultHeightPct,
      growthVelocityCmYear: row.growthVelocityCmYear,
      // A recalculation pending in the outbox: what is stored is from before the last change.
      derivedAt: row.pending || row.derivedAt === null ? null : row.derivedAt.toISOString(),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const MEASUREMENT_KEYS: KeysetSpec<MeasurementRow, 'measuredOn' | 'createdAt'> = {
  fields: {
    // `YYYY-MM-DD` sorts as text in calendar order.
    measuredOn: {
      column: sql`${anthroMeasurement.measuredOn}::text`,
      type: 'text',
      value: (row) => row.measuredOn,
    },
    createdAt: {
      column: anthroMeasurement.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: anthroMeasurement.id, value: (row) => row.id },
};

async function readMeasurements(
  db: TenantDatabase,
  clubId: ClubId,
  ids: readonly string[],
): Promise<MeasurementRow[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select(measurementColumns)
    .from(anthroMeasurement)
    .where(and(eq(anthroMeasurement.clubId, clubId), inArray(anthroMeasurement.id, [...ids])));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    if (row === undefined) throw new Error(`anthro_measurement ${id}: not readable after write`);
    return row;
  });
}

/** The measurement and its player, after the matrix allowed `action` on the player. */
async function authorizedMeasurement(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  id: string,
  action: 'read' | 'record',
): Promise<{ row: MeasurementRow; player: PlayerContext }> {
  const [row] = await db
    .select(measurementColumns)
    .from(anthroMeasurement)
    .where(and(eq(anthroMeasurement.clubId, clubId), eq(anthroMeasurement.id, id)));
  if (row === undefined) throw new HttpError('not_found', 'Measurement not found');
  const context = await loadPlayer(db, clubId, row.playerId);
  if (context === undefined) throw new HttpError('not_found', 'Measurement not found');
  await permissions.authorize('anthropometry', action, { player: context.facts });
  return { row, player: context };
}

/** `assigned` scope of a list: players currently in an assigned category or sport. */
function assignedPlayers(
  db: TenantDatabase,
  categoryIds: readonly string[],
  sports: readonly string[],
): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(playerCategory)
      .innerJoin(
        category,
        and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
      )
      .where(
        and(
          eq(playerCategory.clubId, anthroMeasurement.clubId),
          eq(playerCategory.playerId, anthroMeasurement.playerId),
          sql`${playerCategory.validFrom} <= app.club_today()`,
          sql`(${playerCategory.validTo} is null or ${playerCategory.validTo} > app.club_today())`,
          or(
            categoryIds.length > 0
              ? inArray(playerCategory.categoryId, categoryIds as never[])
              : undefined,
            sports.length > 0 ? inArray(category.sport, sports as never[]) : undefined,
          ),
        ),
      ),
  );
}

/** Measurements whose player was in `categoryId` on the day of the measurement. */
function inCategoryOnTheDay(categoryId: string): SQL {
  return sql`exists (
    select 1 from ${playerCategory}
     where ${playerCategory.clubId} = ${anthroMeasurement.clubId}
       and ${playerCategory.playerId} = ${anthroMeasurement.playerId}
       and ${playerCategory.categoryId} = ${categoryId}
       and ${playerCategory.validFrom} <= ${anthroMeasurement.measuredOn}
       and (${playerCategory.validTo} is null or ${playerCategory.validTo} > ${anthroMeasurement.measuredOn}))`;
}

async function birthDates(
  db: TenantDatabase,
  clubId: ClubId,
  playerIds: readonly PlayerId[],
): Promise<Map<PlayerId, LocalDate>> {
  if (playerIds.length === 0) return new Map();
  const rows = await db
    .select({ id: player.id, birthDate: player.birthDate })
    .from(player)
    .where(and(eq(player.clubId, clubId), inArray(player.id, [...new Set(playerIds)])));
  return new Map(rows.map((row) => [row.id, row.birthDate]));
}

/**
 * `anthropometry.record` on one player of a batch. A missing data consent
 * is the row's problem (`consent_required`, as in the imports): the rest of
 * the squad is still recorded or previewed. Any other denial is the whole
 * request's `403`.
 */
async function authorizeRow(
  permissions: RequestPermissions,
  context: PlayerContext,
): Promise<'ok' | 'consent_required'> {
  try {
    await permissions.authorize('anthropometry', 'record', { player: context.facts });
    return 'ok';
  } catch (error) {
    if (error instanceof PermissionDeniedError && error.reason === 'missing_consent') {
      return 'consent_required';
    }
    throw error;
  }
}

// ─── Validation of the values of a measurement ──────────────────────────────────────

interface MeasurementValues {
  readonly heightCm: number | null;
  readonly sittingHeightCm: number | null;
  readonly weightKg: number | null;
  readonly skinfoldsSumMm: number | null;
}

interface ValueCheck {
  readonly values: MeasurementValues;
  readonly measuredOn: LocalDate;
  readonly today: LocalDate;
  readonly birthDate: LocalDate | undefined;
  readonly stage: ReturnType<typeof stageContextOn>;
}

/** The rules of the values on their day (VALUES_RULES of the contract). */
function valueIssues(check: ValueCheck, path: IssuePath): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { values } = check;
  if (ANTHRO_FIELDS.every((field) => values[field] === null)) {
    issues.push(issue([...path, 'heightCm'], 'At least one value is required'));
  }
  if (
    values.heightCm !== null &&
    values.sittingHeightCm !== null &&
    values.sittingHeightCm >= values.heightCm
  ) {
    issues.push(issue([...path, 'sittingHeightCm'], 'The sitting height is below the height'));
  }
  if (compareLocalDates(check.measuredOn, check.today) > 0) {
    issues.push(issue([...path, 'measuredOn'], 'A measurement is not in the future'));
  }
  if (check.birthDate !== undefined && daysBetween(check.birthDate, check.measuredOn) <= 0) {
    issues.push(issue([...path, 'measuredOn'], 'Before the birth date of the player'));
  }
  if (check.stage === undefined) {
    issues.push(issue([...path, 'playerId'], 'The player is in no category on measuredOn'));
  } else if (values.skinfoldsSumMm !== null && check.stage.stage !== 'performance') {
    // CLAUDE.md, stages: ISAK skinfolds only in the performance stage (M17/M19).
    issues.push(
      issue([...path, 'skinfoldsSumMm'], 'Skinfolds are measured only in the performance stage'),
    );
  }
  return issues;
}

// ─── Recording a batch ──────────────────────────────────────────────────────────────

/** A measurement of a test day is on its date: the day is the context of the measurement. */
const SESSION_DATE_MESSAGE = 'A measurement of a test day is on the date of the day';

interface PlannedInsert {
  readonly index: number;
  readonly values: typeof anthroMeasurement.$inferInsert;
}

interface BatchContext {
  readonly db: TenantDatabase;
  readonly permissions: RequestPermissions;
  readonly clubId: ClubId;
  readonly userId: UserId;
  readonly today: LocalDate;
  readonly players: Map<string, PlayerContext>;
  readonly births: Map<PlayerId, LocalDate>;
  readonly stages: StageSources;
  readonly sessions: Map<string, TestSessionRow | undefined>;
  readonly staff: Set<string>;
  readonly callerIsStaff: boolean;
}

async function planInsert(
  ctx: BatchContext,
  input: AnthroMeasurementInput,
  path: IssuePath,
): Promise<{ issues: ValidationIssue[]; values?: PlannedInsert['values'] }> {
  const context = ctx.players.get(input.playerId);
  if (context === undefined) return { issues: [issue([...path, 'playerId'], 'Player not found')] };
  if ((await authorizeRow(ctx.permissions, context)) === 'consent_required') {
    return {
      issues: [
        issue([...path, 'playerId'], 'The player has no current data consent', 'consent_required'),
      ],
    };
  }

  const issues: ValidationIssue[] = [];
  let session: TestSessionRow | null = null;
  if (input.testSessionId !== undefined) {
    session = ctx.sessions.get(input.testSessionId) ?? null;
    if (session === null) {
      return { issues: [issue([...path, 'testSessionId'], 'Test day not found')] };
    }
    if (session.status === 'cancelled') {
      throw new HttpError('conflict', 'The test day is cancelled: restore it to record on it');
    }
  }
  const measuredOn = input.measuredOn ?? session?.scheduledOn;
  if (measuredOn === undefined) {
    return { issues: [issue([...path, 'measuredOn'], 'Required outside a test day')] };
  }
  if (session !== null && measuredOn !== session.scheduledOn) {
    issues.push(issue([...path, 'measuredOn'], SESSION_DATE_MESSAGE));
  }
  const stage = stageContextOn(ctx.stages, context.id, measuredOn, session?.categoryId ?? null);
  const values: MeasurementValues = {
    heightCm: input.heightCm ?? null,
    sittingHeightCm: input.sittingHeightCm ?? null,
    weightKg: input.weightKg ?? null,
    skinfoldsSumMm: input.skinfoldsSumMm ?? null,
  };
  issues.push(
    ...valueIssues(
      { values, measuredOn, today: ctx.today, birthDate: ctx.births.get(context.id), stage },
      path,
    ),
  );
  if (session !== null && stage !== undefined) {
    if (session.sport !== stage.sport) {
      issues.push(issue([...path, 'playerId'], 'The player is not in the sport of the test day'));
    } else if (session.categoryId !== null && session.categoryId !== stage.categoryId) {
      issues.push(
        issue([...path, 'playerId'], 'The player is not in the category of the test day'),
      );
    }
  }

  let evaluatorId: string | null;
  if (input.evaluatorId !== undefined) {
    evaluatorId = input.evaluatorId;
    if (!ctx.staff.has(input.evaluatorId)) {
      issues.push(issue([...path, 'evaluatorId'], 'The evaluator is not on the staff of the club'));
    }
  } else {
    // A superadmin supporting the club is not on its staff: no default evaluator then.
    evaluatorId = session?.evaluatorId ?? (ctx.callerIsStaff ? ctx.userId : null);
  }
  if (issues.length > 0) return { issues };
  return {
    issues,
    values: {
      clubId: ctx.clubId,
      ...(input.clientUuid !== undefined && { clientUuid: input.clientUuid }),
      playerId: context.id,
      testSessionId: session?.id ?? null,
      measuredOn,
      ...values,
      method: input.method ?? 'manual',
      evaluatorId,
      conditions:
        input.conditions === undefined
          ? (session?.conditions ?? {})
          : toConditions(input.conditions),
      notes: input.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    },
  };
}

// ─── Preview ────────────────────────────────────────────────────────────────────────

const plausibility = createPlausibilityChecker();

const PLAUSIBILITY_METRICS = {
  heightCm: 'height_cm',
  sittingHeightCm: 'sitting_height_cm',
  weightKg: 'weight_kg',
  skinfoldsSumMm: 'skinfolds_sum_mm',
} as const satisfies Record<(typeof ANTHRO_FIELDS)[number], string>;

interface ClubMaturationReference {
  readonly params: ReturnType<typeof resolveDerivedParameters>['maturation'];
  readonly table: KhamisRocheTable | null;
}

/** The club's maturation parameters and seeded Khamis-Roche table, as the worker reads them. */
async function clubMaturationReference(
  db: TenantDatabase,
  clubId: ClubId,
): Promise<ClubMaturationReference> {
  const [row] = await db.select({ settings: club.settings }).from(club).where(eq(club.id, clubId));
  if (row === undefined) throw new HttpError('forbidden', 'The club of the request is not visible');
  const params = resolveDerivedParameters(row.settings.derived).maturation;
  const table = (await loadKhamisRocheTable(db, clubId, params.khamisRocheTableCode)) ?? null;
  return { params, table };
}

interface PlayerMaturationInputs {
  readonly sex: Sex;
  readonly birthDate: LocalDate;
  readonly motherHeightCm: number | null;
  readonly fatherHeightCm: number | null;
  readonly history: AnthropometryInput[];
}

async function maturationInputs(
  db: TenantDatabase,
  clubId: ClubId,
  playerIds: readonly PlayerId[],
): Promise<Map<PlayerId, PlayerMaturationInputs>> {
  const ids = [...new Set(playerIds)];
  const result = new Map<PlayerId, PlayerMaturationInputs>();
  if (ids.length === 0) return result;
  const players = await db
    .select({ id: player.id, sex: player.sex, birthDate: player.birthDate })
    .from(player)
    .where(and(eq(player.clubId, clubId), inArray(player.id, ids)));
  const parents = await db
    .select({
      playerId: playerParentHeight.playerId,
      parent: playerParentHeight.parent,
      heightCm: playerParentHeight.heightCm,
    })
    .from(playerParentHeight)
    .where(and(eq(playerParentHeight.clubId, clubId), inArray(playerParentHeight.playerId, ids)));
  // Same order as the worker: by day, then creation (the later one of a day wins).
  const history = await db
    .select({
      id: anthroMeasurement.id,
      playerId: anthroMeasurement.playerId,
      date: anthroMeasurement.measuredOn,
      heightCm: anthroMeasurement.heightCm,
      sittingHeightCm: anthroMeasurement.sittingHeightCm,
      weightKg: anthroMeasurement.weightKg,
    })
    .from(anthroMeasurement)
    .where(and(eq(anthroMeasurement.clubId, clubId), inArray(anthroMeasurement.playerId, ids)))
    .orderBy(asc(anthroMeasurement.measuredOn), asc(anthroMeasurement.createdAt));
  for (const row of players) {
    const parentHeight = (kind: 'mother' | 'father') =>
      parents.find((p) => p.playerId === row.id && p.parent === kind)?.heightCm ?? null;
    result.set(row.id, {
      sex: row.sex,
      birthDate: row.birthDate,
      motherHeightCm: parentHeight('mother'),
      fatherHeightCm: parentHeight('father'),
      history: history
        .filter((m) => m.playerId === row.id)
        .map((m) => ({
          id: m.id,
          date: m.date,
          heightCm: m.heightCm,
          sittingHeightCm: m.sittingHeightCm,
          weightKg: m.weightKg,
        })),
    });
  }
  return result;
}

const PREVIEW_ID = 'preview';

export function registerAnthropometryRoutes(app: FastifyInstance): void {
  registerEndpoint(app, recordAnthroMeasurements, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      // Role first: a role that never records gets 403 before any lookup.
      await permissions.listScope('anthropometry', 'record');
      const today = await clubToday(db);
      const inputs = body.measurements;
      const playerIds = inputs.map((m) => m.playerId);
      const sessionIds = [
        ...new Set(inputs.flatMap((m) => (m.testSessionId === undefined ? [] : [m.testSessionId]))),
      ];
      const sessions = new Map<string, TestSessionRow | undefined>();
      for (const id of sessionIds) sessions.set(id, await readTestSession(db, clubId, id));
      const evaluators = inputs.flatMap((m) =>
        m.evaluatorId === undefined ? [] : [m.evaluatorId],
      );
      const staff = await clubStaffIds(db, clubId, [...evaluators, caller.userId]);
      const ctx: BatchContext = {
        db,
        permissions,
        clubId,
        userId: caller.userId,
        today,
        players: await loadPlayers(db, clubId, playerIds),
        births: await birthDates(db, clubId, playerIds),
        stages: await loadStageSources(db, clubId, playerIds),
        sessions,
        staff,
        callerIsStaff: staff.has(caller.userId),
      };

      // Replays of the offline queue or a retry answer what they created, unchecked again.
      const clientUuids = inputs.flatMap((m) => (m.clientUuid === undefined ? [] : [m.clientUuid]));
      const replays =
        clientUuids.length === 0
          ? []
          : await db
              .select({
                id: anthroMeasurement.id,
                clientUuid: anthroMeasurement.clientUuid,
                playerId: anthroMeasurement.playerId,
              })
              .from(anthroMeasurement)
              .where(
                and(
                  eq(anthroMeasurement.clubId, clubId),
                  inArray(anthroMeasurement.clientUuid, clientUuids),
                ),
              );

      const issues: ValidationIssue[] = [];
      const seen = new Set<string>();
      const outcome: ({ id: string; replayed: true } | { insert: PlannedInsert })[] = [];
      for (const [index, input] of inputs.entries()) {
        const path = ['body', 'measurements', index];
        if (input.clientUuid !== undefined) {
          if (seen.has(input.clientUuid)) {
            issues.push(issue([...path, 'clientUuid'], 'Repeated clientUuid in the batch'));
            continue;
          }
          seen.add(input.clientUuid);
          const replay = replays.find((r) => r.clientUuid === input.clientUuid);
          if (replay !== undefined) {
            if (replay.playerId !== input.playerId) {
              throw new HttpError('conflict', 'This clientUuid was already used');
            }
            const context = ctx.players.get(replay.playerId);
            if (context === undefined) {
              throw new HttpError('conflict', 'This clientUuid was already used');
            }
            if ((await authorizeRow(permissions, context)) === 'consent_required') {
              issues.push(
                issue(
                  [...path, 'playerId'],
                  'The player has no current data consent',
                  'consent_required',
                ),
              );
              continue;
            }
            outcome.push({ id: replay.id, replayed: true });
            continue;
          }
        }
        const planned = await planInsert(ctx, input, path);
        issues.push(...planned.issues);
        if (planned.values !== undefined)
          outcome.push({ insert: { index, values: planned.values } });
      }
      throwIssues(issues);

      const recorded: { id: string; replayed: boolean }[] = [];
      for (const item of outcome) {
        if ('id' in item) {
          recorded.push(item);
          continue;
        }
        const [inserted] = await db
          .insert(anthroMeasurement)
          .values(item.insert.values)
          .onConflictDoNothing({ target: [anthroMeasurement.clubId, anthroMeasurement.clientUuid] })
          .returning({ id: anthroMeasurement.id });
        if (inserted === undefined) {
          // Same clientUuid inserted by a concurrent request, or invisible to the caller.
          throw new HttpError('conflict', 'This clientUuid was already used');
        }
        recorded.push({ id: inserted.id, replayed: false });
      }
      const rows = await readMeasurements(
        db,
        clubId,
        recorded.map((r) => r.id),
      );
      return {
        measurements: rows.map((row, index) => ({
          measurement: measurementDto(row),
          replayed: recorded[index]?.replayed ?? false,
        })),
      };
    },
  });

  registerEndpoint(app, previewAnthroMeasurements, {
    transaction: true,
    // A POST only for the size of the squad: it writes nothing, so it spends the read budget.
    rateLimit: 'read',
    handler: async ({ body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      await permissions.listScope('anthropometry', 'record');
      const playerIds = body.measurements.map((m) => m.playerId);
      const players = await loadPlayers(db, clubId, playerIds);
      const issues: ValidationIssue[] = [];
      const blocked = new Set<string>();
      for (const [index, input] of body.measurements.entries()) {
        const context = players.get(input.playerId);
        if (context === undefined) {
          issues.push(issue(['body', 'measurements', index, 'playerId'], 'Player not found'));
          continue;
        }
        if ((await authorizeRow(permissions, context)) === 'consent_required') {
          blocked.add(context.id);
        }
      }
      throwIssues(issues);

      const allowed = playerIds.filter((id) => !blocked.has(id));
      const reference = await clubMaturationReference(db, clubId);
      // Without a data consent nothing of the player is processed, not even their history.
      const inputs = await maturationInputs(db, clubId, allowed);
      const stages = await loadStageSources(db, clubId, allowed);
      const items = body.measurements.map((input): AnthroPreview => {
        if (blocked.has(input.playerId)) {
          return {
            playerId: input.playerId,
            measuredOn: input.measuredOn,
            blockedBy: 'consent_required',
            ageYears: null,
            stage: null,
            phvOffsetYears: null,
            maturityOffsetEquation: null,
            maturityOffsetVerification: null,
            predictedAdultHeightCm: null,
            adultHeightPct: null,
            growthVelocityCmYear: null,
            gaps: { phvOffset: [], adultHeight: [] },
            plausibility: [],
          };
        }
        const own = inputs.get(input.playerId);
        if (own === undefined) throw new Error('previewAnthroMeasurements: player not loaded');
        const measurement: AnthropometryInput = {
          id: PREVIEW_ID,
          date: input.measuredOn,
          heightCm: input.heightCm ?? null,
          sittingHeightCm: input.sittingHeightCm ?? null,
          weightKg: input.weightKg ?? null,
        };
        const playerInputs = {
          sex: own.sex,
          birthDate: own.birthDate,
          motherHeightCm: own.motherHeightCm,
          fatherHeightCm: own.fatherHeightCm,
          khamisRocheTable: reference.table,
          params: reference.params,
        };
        // The new measurement goes last: on a day already measured, it is the one that wins.
        const result = deriveMaturation({
          ...playerInputs,
          measurements: [...own.history, measurement],
        }).at(-1);
        if (result === undefined) throw new Error('previewAnthroMeasurements: no result');
        const gaps = maturationGaps(playerInputs, measurement, result);
        const validAge = daysBetween(own.birthDate, input.measuredOn) > 0;
        const ageYears = validAge ? decimalAgeYears(own.birthDate, input.measuredOn) : null;
        const plausibilityWarnings: AnthroPreview['plausibility'] = [];
        for (const field of ANTHRO_FIELDS) {
          const value = input[field];
          if (value === undefined) continue;
          const check = plausibility({
            metricCode: parseMetricCode(PLAUSIBILITY_METRICS[field]),
            value,
            sex: own.sex,
            ageYears,
          });
          if (check.status === 'below' || check.status === 'above') {
            plausibilityWarnings.push({
              field,
              status: check.status,
              minValue: check.bounds.minValue,
              maxValue: check.bounds.maxValue,
              suggestedValues: [...check.suggestedValues],
            });
          }
        }
        return {
          playerId: input.playerId,
          measuredOn: input.measuredOn,
          blockedBy: null,
          ageYears,
          stage: stageContextOn(stages, input.playerId, input.measuredOn, null)?.stage ?? null,
          phvOffsetYears: result.phvOffsetYears,
          maturityOffsetEquation: result.maturityOffsetEquation,
          maturityOffsetVerification:
            result.maturityOffsetEquation === null
              ? null
              : maturityOffsetModel(result.maturityOffsetEquation, own.sex).provenance.verification,
          predictedAdultHeightCm: result.predictedAdultHeightCm,
          adultHeightPct: result.adultHeightPct,
          growthVelocityCmYear: result.growthVelocityCmYear,
          gaps: {
            phvOffset: [...gaps.phvOffset],
            adultHeight: [...gaps.adultHeight],
          },
          plausibility: plausibilityWarnings,
        };
      });
      return {
        reference:
          reference.table === null
            ? null
            : {
                code: reference.table.code,
                verification: reference.table.provenance.verification,
              },
        items,
      };
    },
  });

  registerEndpoint(app, listAnthroMeasurements, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('anthropometry', 'read');
      const plan = keysetPage(MEASUREMENT_KEYS, query, {
        playerId: query.playerId,
        categoryId: query.categoryId,
        testSessionId: query.testSessionId,
        from: query.from,
        to: query.to,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };
      if (scope.rowCheck) {
        // `anthropometry.read` has no consent or condition today; a new one needs a row check.
        throw new Error('listAnthroMeasurements: the matrix asks for a row check');
      }
      let inScope: SQL | undefined;
      switch (scope.kind) {
        case 'club':
          break;
        case 'assigned':
          inScope = assignedPlayers(db, scope.categoryIds, scope.sports);
          break;
        case 'players':
          inScope = inArray(anthroMeasurement.playerId, [...scope.playerIds]);
          break;
        case 'platform':
          return { items: [], nextCursor: null };
      }
      const rows = await db
        .select(measurementColumns)
        .from(anthroMeasurement)
        .where(
          and(
            eq(anthroMeasurement.clubId, caller.membership.clubId),
            inScope,
            query.playerId === undefined
              ? undefined
              : eq(anthroMeasurement.playerId, query.playerId),
            query.categoryId === undefined ? undefined : inCategoryOnTheDay(query.categoryId),
            query.testSessionId === undefined
              ? undefined
              : eq(anthroMeasurement.testSessionId, query.testSessionId),
            query.from === undefined ? undefined : gte(anthroMeasurement.measuredOn, query.from),
            query.to === undefined ? undefined : lte(anthroMeasurement.measuredOn, query.to),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, measurementDto);
    },
  });

  registerEndpoint(app, getAnthroMeasurement, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { row } = await authorizedMeasurement(
        db,
        permissions,
        caller.membership.clubId,
        params.anthroMeasurementId,
        'read',
      );
      return measurementDto(row);
    },
  });

  registerEndpoint(app, updateAnthroMeasurement, {
    transaction: true,
    changeReason: ({ body }) => body.changeReason,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { row, player: context } = await authorizedMeasurement(
        db,
        permissions,
        clubId,
        params.anthroMeasurementId,
        'record',
      );
      const measuredOn = body.measuredOn ?? row.measuredOn;
      const values: MeasurementValues = {
        heightCm: body.heightCm === undefined ? row.heightCm : body.heightCm,
        sittingHeightCm:
          body.sittingHeightCm === undefined ? row.sittingHeightCm : body.sittingHeightCm,
        weightKg: body.weightKg === undefined ? row.weightKg : body.weightKg,
        skinfoldsSumMm:
          body.skinfoldsSumMm === undefined ? row.skinfoldsSumMm : body.skinfoldsSumMm,
      };
      const session =
        row.testSessionId === null ? null : await readTestSession(db, clubId, row.testSessionId);
      const stages = await loadStageSources(db, clubId, [context.id]);
      const issues = valueIssues(
        {
          values,
          measuredOn,
          today: await clubToday(db),
          birthDate: (await birthDates(db, clubId, [context.id])).get(context.id),
          stage: stageContextOn(stages, context.id, measuredOn, session?.categoryId ?? null),
        },
        ['body'],
      );
      // Moving the date of a measurement of a test day takes it out of its day.
      if (
        session?.scheduledOn !== undefined &&
        measuredOn !== row.measuredOn &&
        measuredOn !== session.scheduledOn
      ) {
        issues.push(issue(['body', 'measuredOn'], SESSION_DATE_MESSAGE));
      }
      if (body.evaluatorId !== undefined && body.evaluatorId !== null) {
        if (!(await clubStaffIds(db, clubId, [body.evaluatorId])).has(body.evaluatorId)) {
          issues.push(
            issue(['body', 'evaluatorId'], 'The evaluator is not on the staff of the club'),
          );
        }
      }
      if (issues.length > 0) invalid(...issues);
      const updated = await updateAtVersion({
        resource: 'Measurement',
        update: async () =>
          (
            await db
              .update(anthroMeasurement)
              .set({
                measuredOn,
                ...values,
                ...(body.method !== undefined && { method: body.method }),
                ...(body.evaluatorId !== undefined && { evaluatorId: body.evaluatorId }),
                ...(body.conditions !== undefined && { conditions: toConditions(body.conditions) }),
                ...(body.notes !== undefined && { notes: body.notes }),
                updatedBy: caller.userId,
              })
              .where(
                and(
                  eq(anthroMeasurement.clubId, clubId),
                  eq(anthroMeasurement.id, row.id),
                  versionMatches(anthroMeasurement.updatedAt, body.version),
                ),
              )
              .returning({ id: anthroMeasurement.id })
          )[0],
        exists: async () =>
          (
            await db
              .select({ id: anthroMeasurement.id })
              .from(anthroMeasurement)
              .where(and(eq(anthroMeasurement.clubId, clubId), eq(anthroMeasurement.id, row.id)))
          ).length > 0,
      });
      const [fresh] = await readMeasurements(db, clubId, [updated.id]);
      if (fresh === undefined) throw new Error('updateAnthroMeasurement: not readable');
      return measurementDto(fresh);
    },
  });
}
