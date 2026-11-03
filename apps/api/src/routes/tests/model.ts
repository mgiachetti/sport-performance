import { createHash, randomUUID } from 'node:crypto';
import type { TestEntryInputBody, TestResult, ValidationIssue } from '@sport-performance/contracts';
import {
  anthroMeasurement,
  batteryConfig,
  category,
  consent,
  device,
  membership,
  metricDefinition,
  player,
  playerCategory,
  playerStage,
  testDefinition,
  testDefinitionMetric,
  testResult,
  testResultValue,
  testSession,
  type TestConditions,
  type TestProtocol,
} from '@sport-performance/db/schema';
import {
  CONSENT_TYPES,
  DEFAULT_AGE_BANDS,
  compareLocalDates,
  DomainValidationError,
  RESULT_LEVEL_DERIVED_METRICS,
  deriveResultMetrics,
  e1rmSetIssues,
  isTestEntryKind,
  scoreResultMetrics,
  scoreTestEntry,
  strengthMetricAllowed,
  testScoringSettings,
  type AttemptAggregation,
  type BatteryRow,
  type CategoryId,
  type ClubId,
  type ConsentType,
  type E1rmSetIssue,
  type LocalDate,
  type MeasurementMethod,
  type MetricDirection,
  type PlayerFacts,
  type PlayerId,
  type Sex,
  type Sport,
  type Stage,
  type StrengthAssessment,
  type TestEntryInput,
  type TestEntryKind,
  type TestNotDoneReason,
  type UnitCode,
  type UserId,
} from '@sport-performance/domain';
import { and, asc, desc, eq, inArray, isNull, lte, or, gt, sql } from 'drizzle-orm';
import type { TenantDatabase } from '../../db/database.js';
import { HttpError } from '../../http/errors.js';
import { rowVersion } from '../../http/writes.js';
import { testSessionColumns, testSessionDto, type TestSessionRow } from '../calendar/shared.js';

/**
 * Shared model of the test endpoints (B-320): reading test days and results
 * as the contract shapes them, the facts the permission matrix needs about a
 * player, the stage context of a measurement (category, stage, age band,
 * battery) and writing entries with the scoring formulas of the domain.
 */

/** Path of a field in the request, for validation issues. */
export type IssuePath = (string | number)[];

export function issue(path: IssuePath, message: string, code = 'custom'): ValidationIssue {
  return { path, code, message };
}

/** Throws `validation_failed` with the issues. */
export function invalid(...issues: ValidationIssue[]): never {
  throw new HttpError('validation_failed', 'The request breaks a rule of the tests', {
    details: issues,
  });
}

/** Throws `validation_failed` with the issues, if any. */
export function throwIssues(issues: readonly ValidationIssue[]): void {
  if (issues.length > 0) invalid(...issues);
}

/** Collects the `validation_failed` issues of a step instead of stopping at the first. */
export async function collectIssues(
  issues: ValidationIssue[],
  step: () => Promise<void>,
): Promise<void> {
  try {
    await step();
  } catch (error) {
    if (error instanceof HttpError && error.code === 'validation_failed' && error.details) {
      issues.push(...error.details);
      return;
    }
    throw error;
  }
}

/** Conditions as stored: the keys that were sent (`exactOptionalPropertyTypes`). */
export function toConditions(input: Readonly<Record<string, unknown>>): TestConditions {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

// ─── Test days ───────────────────────────────────────────────────────────────────────

// One shape of a test day for the calendar (B-317) and the tests (B-320).
export { testSessionColumns, testSessionDto, type TestSessionRow };

export async function readTestSession(
  db: TenantDatabase,
  clubId: ClubId,
  testSessionId: string,
): Promise<TestSessionRow | undefined> {
  const [row] = await db
    .select(testSessionColumns)
    .from(testSession)
    .where(and(eq(testSession.clubId, clubId), eq(testSession.id, testSessionId)));
  return row;
}

/** Category facts of a test day, for the matrix (`test_session` targets a category). */
export function sessionTarget(row: Pick<TestSessionRow, 'categoryId' | 'sport'>) {
  return row.categoryId === null ? {} : { category: { id: row.categoryId, sport: row.sport } };
}

// ─── Players: facts for the matrix and stage context ─────────────────────────────────

const STAFF_ROLES = ['coach', 'sc', 'medical', 'admin'] as const;

/** `true` when the user is a current staff member of the club (evaluators). */
export async function isClubStaff(
  db: TenantDatabase,
  clubId: ClubId,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: membership.id })
    .from(membership)
    .where(
      and(
        eq(membership.clubId, clubId),
        eq(membership.userId, userId),
        inArray(membership.role, [...STAFF_ROLES]),
        lte(membership.startedAt, sql`now()`),
        or(isNull(membership.endedAt), gt(membership.endedAt, sql`now()`)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** The users among `userIds` that are current staff members of the club (one query). */
export async function clubStaffIds(
  db: TenantDatabase,
  clubId: ClubId,
  userIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ userId: membership.userId })
    .from(membership)
    .where(
      and(
        eq(membership.clubId, clubId),
        inArray(membership.userId, ids),
        inArray(membership.role, [...STAFF_ROLES]),
        lte(membership.startedAt, sql`now()`),
        or(isNull(membership.endedAt), gt(membership.endedAt, sql`now()`)),
      ),
    );
  return new Set(rows.map((row) => row.userId));
}

/** The devices among `deviceIds` that exist in the club (one query). */
export async function existingDeviceIds(
  db: TenantDatabase,
  clubId: ClubId,
  deviceIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(deviceIds)];
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: device.id })
    .from(device)
    .where(and(eq(device.clubId, clubId), inArray(device.id, ids)));
  return new Set(rows.map((row) => row.id));
}

export async function deviceExists(
  db: TenantDatabase,
  clubId: ClubId,
  deviceId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: device.id })
    .from(device)
    .where(and(eq(device.clubId, clubId), eq(device.id, deviceId)));
  return row !== undefined;
}

export interface PlayerContext {
  readonly id: PlayerId;
  readonly sex: Sex;
  /** What the permission matrix needs (current categories, consents). */
  readonly facts: PlayerFacts;
}

/**
 * The player and the facts the matrix checks: current categories (today in
 * the club, like the staff assignments), the sport (of a current category,
 * else of the latest one) and the current consents. `undefined` when the
 * caller does not see the player (RLS) or it has never been in a category.
 */
export async function loadPlayer(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: string,
  cache?: Map<string, PlayerContext | undefined>,
): Promise<PlayerContext | undefined> {
  if (cache?.has(playerId)) return cache.get(playerId);
  const context = await loadPlayerUncached(db, clubId, playerId);
  cache?.set(playerId, context);
  return context;
}

async function loadPlayerUncached(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: string,
): Promise<PlayerContext | undefined> {
  return (await loadPlayers(db, clubId, [playerId])).get(playerId);
}

/**
 * {@link loadPlayer} for many players at once (three queries): the players
 * the caller sees and that have been in a category, by id.
 */
export async function loadPlayers(
  db: TenantDatabase,
  clubId: ClubId,
  playerIds: readonly string[],
): Promise<Map<string, PlayerContext>> {
  const contexts = new Map<string, PlayerContext>();
  const ids = [...new Set(playerIds)] as PlayerId[];
  if (ids.length === 0) return contexts;
  const rows = await db
    .select({ id: player.id, sex: player.sex })
    .from(player)
    .where(and(eq(player.clubId, clubId), inArray(player.id, ids)));
  if (rows.length === 0) return contexts;
  const visible = rows.map((row) => row.id);
  const categories = await db
    .select({
      playerId: playerCategory.playerId,
      categoryId: playerCategory.categoryId,
      sport: category.sport,
      current: sql<boolean>`${playerCategory.validFrom} <= app.club_today() and (${playerCategory.validTo} is null or ${playerCategory.validTo} > app.club_today())`,
    })
    .from(playerCategory)
    .innerJoin(
      category,
      and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
    )
    .where(and(eq(playerCategory.clubId, clubId), inArray(playerCategory.playerId, visible)))
    .orderBy(desc(playerCategory.validFrom));
  const consents = await db
    .selectDistinct({ playerId: consent.playerId, type: consent.type })
    .from(consent)
    .where(
      and(
        eq(consent.clubId, clubId),
        inArray(consent.playerId, visible),
        isNull(consent.revokedAt),
      ),
    );
  for (const row of rows) {
    const own = categories.filter((c) => c.playerId === row.id);
    const current = own.filter((c) => c.current);
    const sport = current[0]?.sport ?? own[0]?.sport;
    if (sport === undefined) continue;
    const signed = consents.filter((c) => c.playerId === row.id);
    contexts.set(row.id, {
      id: row.id,
      sex: row.sex,
      facts: {
        id: row.id,
        sport,
        categoryIds: current.map((c) => c.categoryId),
        consents: CONSENT_TYPES.filter((type: ConsentType) => signed.some((c) => c.type === type)),
      },
    });
  }
  return contexts;
}

export interface StageContext {
  readonly categoryId: CategoryId;
  readonly sport: Sport;
  readonly stage: Stage;
  readonly ageBand: (typeof DEFAULT_AGE_BANDS)[number];
}

/** What the stage of a player on a day is computed from (see {@link stageContextOn}). */
export interface StageSources {
  readonly categories: readonly {
    readonly playerId: PlayerId;
    readonly id: CategoryId;
    readonly sport: Sport;
    readonly ageBandCode: string;
    readonly defaultStage: Stage;
    readonly sortOrder: number;
    readonly validFrom: LocalDate;
    readonly validTo: LocalDate | null;
  }[];
  readonly stages: readonly {
    readonly playerId: PlayerId;
    readonly stage: Stage;
    readonly validFrom: LocalDate;
    readonly validTo: LocalDate | null;
  }[];
}

const validOn = (row: { validFrom: LocalDate; validTo: LocalDate | null }, on: LocalDate) =>
  compareLocalDates(row.validFrom, on) <= 0 &&
  (row.validTo === null || compareLocalDates(row.validTo, on) > 0);

/** The categories and stages of the players over time (two queries), for {@link stageContextOn}. */
export async function loadStageSources(
  db: TenantDatabase,
  clubId: ClubId,
  playerIds: readonly PlayerId[],
): Promise<StageSources> {
  const ids = [...new Set(playerIds)];
  if (ids.length === 0) return { categories: [], stages: [] };
  const categories = await db
    .select({
      playerId: playerCategory.playerId,
      id: category.id,
      sport: category.sport,
      ageBandCode: category.ageBandCode,
      defaultStage: category.defaultStage,
      sortOrder: category.sortOrder,
      validFrom: playerCategory.validFrom,
      validTo: playerCategory.validTo,
    })
    .from(playerCategory)
    .innerJoin(
      category,
      and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
    )
    .where(and(eq(playerCategory.clubId, clubId), inArray(playerCategory.playerId, ids)))
    .orderBy(asc(category.sortOrder));
  const stages = await db
    .select({
      playerId: playerStage.playerId,
      stage: playerStage.stage,
      validFrom: playerStage.validFrom,
      validTo: playerStage.validTo,
    })
    .from(playerStage)
    .where(and(eq(playerStage.clubId, clubId), inArray(playerStage.playerId, ids)))
    .orderBy(desc(playerStage.validFrom));
  return { categories, stages };
}

/**
 * Category, stage and age band of a player on a day: the category valid that
 * day (the test day's category if the player is in it), the stage valid that
 * day (`player_stage`, by maturation or pinned) or else the category's.
 */
export function stageContextOn(
  sources: StageSources,
  playerId: PlayerId,
  on: LocalDate,
  preferredCategoryId: CategoryId | null,
): StageContext | undefined {
  const categories = sources.categories.filter((c) => c.playerId === playerId && validOn(c, on));
  const chosen = categories.find((c) => c.id === preferredCategoryId) ?? categories[0];
  if (chosen === undefined) return undefined;
  const ageBand = DEFAULT_AGE_BANDS.find((band) => band.code === chosen.ageBandCode);
  if (ageBand === undefined) return undefined;
  const pinned = sources.stages.find((s) => s.playerId === playerId && validOn(s, on));
  return {
    categoryId: chosen.id,
    sport: chosen.sport,
    stage: pinned?.stage ?? chosen.defaultStage,
    ageBand,
  };
}

/** {@link stageContextOn} of one player, read for the request. */
export async function stageContext(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
  on: LocalDate,
  preferredCategoryId: CategoryId | null,
): Promise<StageContext | undefined> {
  return stageContextOn(
    await loadStageSources(db, clubId, [playerId]),
    playerId,
    on,
    preferredCategoryId,
  );
}

/** Battery rows of a sport and test (the domain filters scope and validity). */
export async function batteryRows(
  db: TenantDatabase,
  clubId: ClubId,
  sport: Sport,
  testCode: string,
): Promise<BatteryRow[]> {
  return batteryRowsOf(db, clubId, [testCode], sport);
}

/** Battery rows of some tests, of every sport or of one (the domain filters scope and validity). */
export async function batteryRowsOf(
  db: TenantDatabase,
  clubId: ClubId,
  testCodes: readonly string[],
  sport?: Sport,
): Promise<BatteryRow[]> {
  if (testCodes.length === 0) return [];
  return db
    .select({
      sport: batteryConfig.sport,
      sex: batteryConfig.sex,
      stage: batteryConfig.stage,
      categoryId: batteryConfig.categoryId,
      testCode: batteryConfig.testCode,
      validFrom: batteryConfig.validFrom,
      validTo: batteryConfig.validTo,
    })
    .from(batteryConfig)
    .where(
      and(
        eq(batteryConfig.clubId, clubId),
        sport === undefined ? undefined : eq(batteryConfig.sport, sport),
        inArray(batteryConfig.testCode, [...testCodes]),
        // A withdrawn entry never applied (B-322, ADR 0041).
        isNull(batteryConfig.archivedAt),
      ),
    );
}

/** Body mass measured last on or before the day, for relative strength. */
export async function bodyMassKgOn(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
  on: LocalDate,
): Promise<number | null> {
  return (await loadBodyMasses(db, clubId, [playerId]))(playerId, on);
}

/**
 * The body masses of the players (one query), as a function of a player and
 * a day: the one measured last on or before it, for relative strength.
 */
export async function loadBodyMasses(
  db: TenantDatabase,
  clubId: ClubId,
  playerIds: readonly PlayerId[],
): Promise<(playerId: PlayerId, on: LocalDate) => number | null> {
  const ids = [...new Set(playerIds)];
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            playerId: anthroMeasurement.playerId,
            measuredOn: anthroMeasurement.measuredOn,
            weightKg: anthroMeasurement.weightKg,
          })
          .from(anthroMeasurement)
          .where(
            and(
              eq(anthroMeasurement.clubId, clubId),
              inArray(anthroMeasurement.playerId, ids),
              sql`${anthroMeasurement.weightKg} is not null`,
            ),
          )
          .orderBy(desc(anthroMeasurement.measuredOn), desc(anthroMeasurement.createdAt));
  return (playerId, on) =>
    rows.find((row) => row.playerId === playerId && compareLocalDates(row.measuredOn, on) <= 0)
      ?.weightKg ?? null;
}

// ─── Test definitions (protocol versions) ────────────────────────────────────────────

export interface DefinitionMetric {
  readonly id: string;
  readonly code: string;
  readonly unit: UnitCode;
  readonly direction: MetricDirection;
  readonly isDerived: boolean;
}

export interface DefinitionInfo {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly sports: readonly Sport[] | null;
  readonly attemptAggregation: AttemptAggregation;
  readonly maximalLoad: boolean;
  readonly protocol: TestProtocol;
  readonly validFrom: LocalDate;
  readonly validTo: LocalDate | null;
  readonly metrics: ReadonlyMap<string, DefinitionMetric>;
}

/** One protocol version with its metrics, cached for the request. */
export async function loadDefinition(
  db: TenantDatabase,
  clubId: ClubId,
  definitionId: string,
  cache: Map<string, DefinitionInfo | undefined>,
): Promise<DefinitionInfo | undefined> {
  if (!cache.has(definitionId)) await loadDefinitions(db, clubId, [definitionId], cache);
  return cache.get(definitionId);
}

/** {@link loadDefinition} for many protocol versions at once (two queries), into `cache`. */
export async function loadDefinitions(
  db: TenantDatabase,
  clubId: ClubId,
  definitionIds: readonly string[],
  cache: Map<string, DefinitionInfo | undefined>,
): Promise<void> {
  const ids = [...new Set(definitionIds)].filter((id) => !cache.has(id));
  if (ids.length === 0) return;
  const rows = await db
    .select({
      id: testDefinition.id,
      code: testDefinition.code,
      version: testDefinition.version,
      sports: testDefinition.sports,
      attemptAggregation: testDefinition.attemptAggregation,
      maximalLoad: testDefinition.maximalLoad,
      protocol: testDefinition.protocol,
      validFrom: testDefinition.validFrom,
      validTo: testDefinition.validTo,
    })
    .from(testDefinition)
    .where(and(eq(testDefinition.clubId, clubId), inArray(testDefinition.id, ids)));
  const metrics =
    rows.length === 0
      ? []
      : await db
          .select({
            testDefinitionId: testDefinitionMetric.testDefinitionId,
            id: metricDefinition.id,
            code: metricDefinition.code,
            unit: metricDefinition.unit,
            direction: metricDefinition.direction,
            isDerived: testDefinitionMetric.isDerived,
          })
          .from(testDefinitionMetric)
          .innerJoin(
            metricDefinition,
            and(
              eq(metricDefinition.clubId, testDefinitionMetric.clubId),
              eq(metricDefinition.id, testDefinitionMetric.metricDefinitionId),
            ),
          )
          .where(
            and(
              eq(testDefinitionMetric.clubId, clubId),
              inArray(
                testDefinitionMetric.testDefinitionId,
                rows.map((row) => row.id),
              ),
            ),
          )
          .orderBy(asc(testDefinitionMetric.sortOrder));
  for (const id of ids) cache.set(id, undefined);
  for (const row of rows) {
    cache.set(row.id, {
      ...row,
      metrics: new Map(
        metrics
          .filter((m) => m.testDefinitionId === row.id)
          .map((m) => [
            m.code,
            {
              id: m.id,
              code: m.code,
              unit: m.unit,
              direction: m.direction,
              isDerived: m.isDerived,
            },
          ]),
      ),
    });
  }
}

export function sameDeviceOnly(definition: DefinitionInfo): boolean {
  return definition.protocol.parameters?.sameDeviceOnly === true;
}

// ─── Entries ─────────────────────────────────────────────────────────────────────────

/**
 * `client_uuid` of a value: derived from its entry and metric, so resending
 * an entry (offline queue, retries) hits the unique key of the club instead
 * of duplicating it, even under concurrent requests.
 */
export function valueClientUuid(entryId: string, metricCode: string): string {
  const hex = createHash('sha256').update(`${entryId}:${metricCode}`).digest('hex');
  // RFC 9562 version 8 (custom), variant 10.
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The domain entry of a contract entry (without its client fields). */
function domainEntry(entry: TestEntryInputBody): TestEntryInput {
  switch (entry.kind) {
    case 'value':
      return { kind: 'value', metricCode: entry.metricCode, value: entry.value };
    case 'sprint_splits':
      return {
        kind: 'sprint_splits',
        split10S: entry.split10S,
        split20S: entry.split20S,
        split40S: entry.split40S,
      };
    case 'cmj_flight_time':
      return { kind: 'cmj_flight_time', flightTimeS: entry.flightTimeS };
    case 'cmj_video_frames':
      return {
        kind: 'cmj_video_frames',
        takeoffFrame: entry.takeoffFrame,
        landingFrame: entry.landingFrame,
        frameRateFps: entry.frameRateFps,
      };
    case 'ift_stage':
      return { kind: 'ift_stage', lastCompletedStage: entry.lastCompletedStage };
    case 'strength_set':
      return { kind: 'strength_set', loadKg: entry.loadKg, reps: entry.reps, rir: entry.rir };
  }
}

/** What the evaluator typed, stored with the computed values (`inputs`). */
function rawInputs(entry: TestEntryInput): Record<string, unknown> | null {
  if (entry.kind === 'value') return null;
  return Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined));
}

export interface EntryWriteContext {
  readonly clubId: ClubId;
  readonly userId: UserId;
  readonly resultId: string;
  readonly definition: DefinitionInfo;
  /** Strength assessment of the player on the day (`strengthAssessmentFor`), for strength. */
  readonly strengthAssessment: StrengthAssessment | null;
}

/**
 * Scores one entry into the values to insert (pure: no query). Issues go to
 * `issues`; `resultLevel` holds the metrics with a result-level value of the
 * result (stored or earlier in the request) and is updated.
 */
export function scoreEntry(
  ctx: EntryWriteContext,
  entry: TestEntryInputBody,
  entryId: string,
  at: IssuePath,
  resultLevel: Set<string>,
  issues: ValidationIssue[],
): (typeof testResultValue.$inferInsert)[] {
  const settings = testScoringSettings(ctx.definition.protocol.parameters);
  const input = domainEntry(entry);
  let scored;
  try {
    scored = scoreTestEntry(ctx.definition.code, input, settings);
  } catch (error) {
    if (error instanceof DomainValidationError) {
      issues.push(issue(at, error.message));
      return [];
    }
    throw error;
  }
  const inputs = rawInputs(input);
  const entryRows: (typeof testResultValue.$inferInsert)[] = [];
  let entryHasIssues = false;
  for (const value of scored.values) {
    const metric = ctx.definition.metrics.get(value.metricCode);
    if (metric === undefined) {
      // A computed metric the club's protocol version does not keep is not stored.
      if (value.computed && entry.kind !== 'value') continue;
      entryHasIssues = true;
      issues.push(
        issue(
          entry.kind === 'value' ? [...at, 'metricCode'] : at,
          `The metric ${value.metricCode} is not part of this protocol version`,
        ),
      );
      continue;
    }
    if (entry.kind === 'value' && metric.isDerived) {
      entryHasIssues = true;
      issues.push(
        issue([...at, 'metricCode'], `${metric.code} is computed by the server, never typed in`),
      );
      continue;
    }
    if (
      ctx.strengthAssessment !== null &&
      !strengthMetricAllowed(metric.code, ctx.strengthAssessment)
    ) {
      entryHasIssues = true;
      issues.push(
        issue(
          at,
          `${metric.code} is not recorded in the stage of the player (${ctx.strengthAssessment}): record the test as not_done with not_applicable_to_stage`,
        ),
      );
      continue;
    }
    if (entry.attemptNumber === undefined) {
      if (resultLevel.has(metric.id)) {
        entryHasIssues = true;
        issues.push(
          issue(
            [...at, 'attemptNumber'],
            `The result already has a value of ${metric.code} without attempt number: void it first or number the attempts`,
          ),
        );
        continue;
      }
      resultLevel.add(metric.id);
    }
    entryRows.push({
      clubId: ctx.clubId,
      clientUuid: valueClientUuid(entryId, metric.code),
      testResultId: ctx.resultId,
      metricDefinitionId: metric.id,
      attemptNumber: entry.attemptNumber ?? null,
      entryId,
      inputs,
      value: value.value,
      unit: metric.unit,
      ...(entry.recordedAt !== undefined && { recordedAt: new Date(entry.recordedAt) }),
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
  }
  if (entryRows.length === 0 && !entryHasIssues) {
    issues.push(issue(at, 'None of the metrics of this entry are part of this protocol version'));
  }
  return entryRows;
}

/**
 * Scores and inserts entries (append-only). An entry whose `clientUuid` is
 * already recorded in this result is skipped (a replay); in another result
 * (or in one the caller cannot see) it is a `conflict`. Invalid entries are
 * reported together as `validation_failed` under `path`: among them an entry
 * none of whose metrics the protocol version keeps, and a second value of a
 * metric without `attemptNumber` (the result keeps one result-level value
 * per metric: void the stored one first, or number the attempts).
 */
export async function insertEntries(
  db: TenantDatabase,
  ctx: EntryWriteContext,
  entries: readonly TestEntryInputBody[],
  path: IssuePath,
): Promise<void> {
  const issues: ValidationIssue[] = [];
  const rows: (typeof testResultValue.$inferInsert)[] = [];
  const seen = new Set<string>();
  // Metrics with a valid result-level value (no attempt number), stored or in this request.
  const resultLevel = new Set(
    (
      await db
        .select({ metricDefinitionId: testResultValue.metricDefinitionId })
        .from(testResultValue)
        .where(
          and(
            eq(testResultValue.clubId, ctx.clubId),
            eq(testResultValue.testResultId, ctx.resultId),
            isNull(testResultValue.attemptNumber),
            isNull(testResultValue.voidedAt),
          ),
        )
    ).map((v) => v.metricDefinitionId),
  );
  for (const [index, entry] of entries.entries()) {
    const at = [...path, index];
    const entryId = entry.clientUuid ?? randomUUID();
    if (seen.has(entryId)) {
      issues.push(issue([...at, 'clientUuid'], 'Repeated entry clientUuid in the request'));
      continue;
    }
    seen.add(entryId);
    if (entry.clientUuid !== undefined) {
      const [existing] = await db
        .select({ testResultId: testResultValue.testResultId })
        .from(testResultValue)
        .where(and(eq(testResultValue.clubId, ctx.clubId), eq(testResultValue.entryId, entryId)))
        .limit(1);
      if (existing !== undefined) {
        if (existing.testResultId === ctx.resultId) continue;
        throw new HttpError('conflict', 'This entry clientUuid was already used');
      }
    }
    rows.push(...scoreEntry(ctx, entry, entryId, at, resultLevel, issues));
  }
  throwIssues(issues);
  if (rows.length === 0) return;
  const inserted = await db
    .insert(testResultValue)
    .values(rows)
    .onConflictDoNothing({ target: [testResultValue.clubId, testResultValue.clientUuid] })
    .returning({ clientUuid: testResultValue.clientUuid });
  if (inserted.length === rows.length) return;
  // A value already there: a concurrent replay into this result is fine; a value of
  // another result, or of one the caller cannot see, is never revealed nor dropped.
  const insertedUuids = new Set(inserted.map((v) => v.clientUuid));
  const skipped = rows.flatMap((r) =>
    r.clientUuid === undefined || insertedUuids.has(r.clientUuid) ? [] : [r.clientUuid],
  );
  const visible = await db
    .select({ clientUuid: testResultValue.clientUuid })
    .from(testResultValue)
    .where(
      and(
        eq(testResultValue.clubId, ctx.clubId),
        eq(testResultValue.testResultId, ctx.resultId),
        inArray(testResultValue.clientUuid, skipped),
      ),
    );
  if (visible.length < skipped.length) {
    throw new HttpError('conflict', 'This entry clientUuid was already used');
  }
}

/**
 * Order of the values of a result: as recorded, attempts by number within
 * the same instant (one request records several), result-level values last,
 * the values of one entry together.
 */
export const VALUE_ORDER = [
  asc(testResultValue.recordedAt),
  sql`${testResultValue.attemptNumber} asc nulls last`,
  asc(testResultValue.entryId),
  asc(testResultValue.id),
];

/** Reason recorded when the server voids a derived value it recalculates. */
export const DERIVED_RECALCULATION_REASON = 'Recalculado: cambiaron los intentos del resultado';

/** The metrics derived at result level (505 asymmetry, relative strength) the version keeps. */
export function derivableMetrics(definition: DefinitionInfo): string[] {
  return (RESULT_LEVEL_DERIVED_METRICS[definition.code] ?? []).filter(
    (code) => definition.metrics.get(code)?.isDerived === true,
  );
}

/**
 * The result-level derived values of a result from its valid values (pure):
 * `next` by metric code, and the metrics they come from (`from`).
 */
export function deriveResultValues(
  definition: DefinitionInfo,
  values: readonly { metricCode: string; value: number; attemptNumber: number | null }[],
  bodyMassKg: number | null,
): { next: Map<string, number>; from: string[] } {
  const derivedSet = new Set<string>(derivableMetrics(definition));
  const inputs = values.filter((v) => !derivedSet.has(v.metricCode));
  const scores = new Map(
    scoreResultMetrics(inputs, (code) => scoringRule(definition, code)).map((s) => [
      s.metricCode,
      s.value,
    ]),
  );
  const next = new Map(
    deriveResultMetrics(definition.code, scores, { bodyMassKg }).map((d) => [
      d.metricCode as string,
      d.value,
    ]),
  );
  return { next, from: [...scores.keys()] };
}

/**
 * `inputs` of a derived value: the metrics it comes from, sorted by code, so
 * the same result stores the same `from` whatever the order its entries were
 * recorded in (a new result, a recalculation or an import, issue #175).
 * Values stored before are append-only and keep their order: read `from` as
 * a set.
 */
export function derivedInputs(from: readonly string[], code: string): Record<string, unknown> {
  return {
    kind: 'derived',
    from: [...new Set(from)].filter((k) => k !== code).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}

/**
 * Recomputes the result-level derived metrics (505 asymmetry, relative
 * strength) from the valid values: an outdated one is voided and the new one
 * inserted, in the request transaction.
 */
export async function recomputeDerived(
  db: TenantDatabase,
  ctx: { clubId: ClubId; userId: UserId; definition: DefinitionInfo },
  result: { id: string; playerId: PlayerId; measuredOn: LocalDate },
): Promise<void> {
  const derivable = derivableMetrics(ctx.definition);
  if (derivable.length === 0) return;
  const values = await db
    .select({
      id: testResultValue.id,
      metricCode: metricDefinition.code,
      value: testResultValue.value,
      attemptNumber: testResultValue.attemptNumber,
    })
    .from(testResultValue)
    .innerJoin(
      metricDefinition,
      and(
        eq(metricDefinition.clubId, testResultValue.clubId),
        eq(metricDefinition.id, testResultValue.metricDefinitionId),
      ),
    )
    .where(
      and(
        eq(testResultValue.clubId, ctx.clubId),
        eq(testResultValue.testResultId, result.id),
        isNull(testResultValue.voidedAt),
      ),
    )
    .orderBy(...VALUE_ORDER);
  const bodyMassKg =
    ctx.definition.code === 'strength'
      ? await bodyMassKgOn(db, ctx.clubId, result.playerId, result.measuredOn)
      : null;
  const { next, from } = deriveResultValues(ctx.definition, values, bodyMassKg);
  for (const code of derivable) {
    const metric = ctx.definition.metrics.get(code);
    if (metric === undefined) continue;
    const current = values.filter((v) => v.metricCode === code && v.attemptNumber === null);
    const value = next.get(code);
    const unchanged =
      value !== undefined &&
      current.length === 1 &&
      Math.abs((current[0]?.value ?? 0) - value) < 1e-9;
    if (unchanged) continue;
    if (current.length > 0) {
      await db
        .update(testResultValue)
        .set({
          voidedAt: sql`now()`,
          voidedBy: ctx.userId,
          voidReason: DERIVED_RECALCULATION_REASON,
          updatedBy: ctx.userId,
        })
        .where(
          and(
            eq(testResultValue.clubId, ctx.clubId),
            inArray(
              testResultValue.id,
              current.map((c) => c.id),
            ),
          ),
        );
    }
    if (value !== undefined) {
      await db.insert(testResultValue).values({
        clubId: ctx.clubId,
        testResultId: result.id,
        metricDefinitionId: metric.id,
        attemptNumber: null,
        inputs: derivedInputs(from, code),
        value,
        unit: metric.unit,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
    }
  }
}

function scoringRule(definition: DefinitionInfo, metricCode: string) {
  return {
    aggregation: definition.attemptAggregation,
    direction: definition.metrics.get(metricCode)?.direction ?? 'neutral',
  };
}

// ─── Reading results ─────────────────────────────────────────────────────────────────

/**
 * Result columns as the caller may see them: `injured` is `unavailable`
 * (and its note hidden) for every role but `medical` (ADR 0029), with the
 * same database function the change history uses.
 */
export const testResultColumns = {
  id: testResult.id,
  playerId: testResult.playerId,
  testDefinitionId: testResult.testDefinitionId,
  testCode: testDefinition.code,
  protocolVersion: testDefinition.version,
  attemptAggregation: testDefinition.attemptAggregation,
  protocol: testDefinition.protocol,
  testSessionId: testResult.testSessionId,
  measuredOn: testResult.measuredOn,
  status: testResult.status,
  notDoneReason: sql<
    TestNotDoneReason | 'unavailable' | null
  >`app.not_done_reason_for_viewer(${testResult.notDoneReason})`,
  notDoneNote: sql<
    string | null
  >`case when app.not_done_reason_for_viewer(${testResult.notDoneReason}) = 'unavailable' then null else ${testResult.notDoneNote} end`,
  method: testResult.method,
  evaluatorId: testResult.evaluatorId,
  deviceId: testResult.deviceId,
  exercise: testResult.exercise,
  conditions: testResult.conditions,
  notes: testResult.notes,
  importId: testResult.importId,
  createdAt: testResult.createdAt,
  updatedAt: testResult.updatedAt,
  version: rowVersion(testResult.updatedAt),
};

export interface TestResultRow {
  id: string;
  playerId: PlayerId;
  testDefinitionId: string;
  testCode: string;
  protocolVersion: number;
  attemptAggregation: AttemptAggregation;
  protocol: TestProtocol;
  testSessionId: string | null;
  measuredOn: LocalDate;
  status: 'done' | 'not_done';
  notDoneReason: TestNotDoneReason | 'unavailable' | null;
  notDoneNote: string | null;
  method: MeasurementMethod | null;
  evaluatorId: string | null;
  deviceId: string | null;
  exercise: string | null;
  conditions: TestConditions;
  notes: string | null;
  importId: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

/** Result rows (visible to the caller) with their protocol version, in no order. */
export async function readTestResultRows(
  db: TenantDatabase,
  clubId: ClubId,
  testResultIds: readonly string[],
): Promise<TestResultRow[]> {
  if (testResultIds.length === 0) return [];
  return db
    .select(testResultColumns)
    .from(testResult)
    .innerJoin(
      testDefinition,
      and(
        eq(testDefinition.clubId, testResult.clubId),
        eq(testDefinition.id, testResult.testDefinitionId),
      ),
    )
    .where(and(eq(testResult.clubId, clubId), inArray(testResult.id, [...testResultIds])));
}

/** The result row (visible to the caller), joined with its protocol version. */
export async function readTestResultRow(
  db: TenantDatabase,
  clubId: ClubId,
  testResultId: string,
): Promise<TestResultRow | undefined> {
  const [row] = await db
    .select(testResultColumns)
    .from(testResult)
    .innerJoin(
      testDefinition,
      and(
        eq(testDefinition.clubId, testResult.clubId),
        eq(testDefinition.id, testResult.testDefinitionId),
      ),
    )
    .where(and(eq(testResult.clubId, clubId), eq(testResult.id, testResultId)));
  return row;
}

interface ValueRow {
  id: string;
  testResultId: string;
  entryId: string;
  metricCode: string;
  direction: MetricDirection;
  isDerived: boolean | null;
  attemptNumber: number | null;
  inputs: Readonly<Record<string, unknown>> | null;
  value: number;
  unit: UnitCode;
  recordedAt: Date;
  voidedAt: Date | null;
  voidedBy: string | null;
  voidReason: string | null;
}

async function valuesOf(
  db: TenantDatabase,
  clubId: ClubId,
  resultIds: readonly string[],
): Promise<ValueRow[]> {
  if (resultIds.length === 0) return [];
  return db
    .select({
      id: testResultValue.id,
      testResultId: testResultValue.testResultId,
      entryId: testResultValue.entryId,
      metricCode: metricDefinition.code,
      direction: metricDefinition.direction,
      isDerived: testDefinitionMetric.isDerived,
      attemptNumber: testResultValue.attemptNumber,
      inputs: testResultValue.inputs,
      value: testResultValue.value,
      unit: testResultValue.unit,
      recordedAt: testResultValue.recordedAt,
      voidedAt: testResultValue.voidedAt,
      voidedBy: testResultValue.voidedBy,
      voidReason: testResultValue.voidReason,
    })
    .from(testResultValue)
    .innerJoin(
      testResult,
      and(
        eq(testResult.clubId, testResultValue.clubId),
        eq(testResult.id, testResultValue.testResultId),
      ),
    )
    .innerJoin(
      metricDefinition,
      and(
        eq(metricDefinition.clubId, testResultValue.clubId),
        eq(metricDefinition.id, testResultValue.metricDefinitionId),
      ),
    )
    .leftJoin(
      testDefinitionMetric,
      and(
        eq(testDefinitionMetric.clubId, testResultValue.clubId),
        eq(testDefinitionMetric.testDefinitionId, testResult.testDefinitionId),
        eq(testDefinitionMetric.metricDefinitionId, testResultValue.metricDefinitionId),
      ),
    )
    .where(
      and(
        eq(testResultValue.clubId, clubId),
        inArray(testResultValue.testResultId, [...resultIds]),
      ),
    )
    .orderBy(
      ...VALUE_ORDER.slice(0, 3),
      asc(testDefinitionMetric.sortOrder),
      asc(testResultValue.id),
    );
}

function entryKindOf(inputs: Readonly<Record<string, unknown>> | null): TestEntryKind | 'derived' {
  const kind = inputs?.kind;
  if (kind === 'derived') return 'derived';
  return isTestEntryKind(kind) ? kind : 'value';
}

function entryIssues(
  kind: TestEntryKind | 'derived',
  inputs: Readonly<Record<string, unknown>> | null,
  protocol: TestProtocol,
): E1rmSetIssue[] {
  if (kind !== 'strength_set' || inputs === null) return [];
  const { loadKg, reps, rir } = inputs as { loadKg?: unknown; reps?: unknown; rir?: unknown };
  if (typeof loadKg !== 'number' || typeof reps !== 'number' || typeof rir !== 'number') return [];
  try {
    return e1rmSetIssues({ loadKg, reps, rir }, testScoringSettings(protocol.parameters).e1rm);
  } catch {
    return [];
  }
}

function resultDto(row: TestResultRow, values: readonly ValueRow[]): TestResult {
  const entries = new Map<string, ValueRow[]>();
  for (const value of values) {
    const list = entries.get(value.entryId);
    if (list === undefined) entries.set(value.entryId, [value]);
    else list.push(value);
  }
  const valid = values.filter((v) => v.voidedAt === null);
  const rules = new Map(valid.map((v) => [v.metricCode, v]));
  const scores = scoreResultMetrics(valid, (code) => ({
    aggregation: row.attemptAggregation,
    direction: rules.get(code)?.direction ?? 'neutral',
  }));
  return {
    id: row.id as TestResult['id'],
    playerId: row.playerId,
    testDefinitionId: row.testDefinitionId as TestResult['testDefinitionId'],
    testCode: row.testCode,
    protocolVersion: row.protocolVersion,
    testSessionId: row.testSessionId as TestResult['testSessionId'],
    measuredOn: row.measuredOn,
    status: row.status,
    notDoneReason: row.notDoneReason,
    notDoneNote: row.notDoneNote,
    method: row.method,
    evaluatorId: row.evaluatorId as TestResult['evaluatorId'],
    deviceId: row.deviceId as TestResult['deviceId'],
    exercise: row.exercise,
    conditions: row.conditions,
    notes: row.notes,
    importId: row.importId as TestResult['importId'],
    entries: [...entries].flatMap(([entryId, rows]) => {
      const first = rows[0];
      if (first === undefined) return [];
      const kind = entryKindOf(first.inputs);
      return {
        id: entryId as TestResult['entries'][number]['id'],
        kind,
        attemptNumber: first.attemptNumber,
        recordedAt: first.recordedAt.toISOString(),
        inputs: kind === 'value' ? null : { ...first.inputs },
        values: rows.map((v) => ({
          id: v.id as TestResult['entries'][number]['values'][number]['id'],
          metricCode: v.metricCode,
          unit: v.unit,
          value: v.value,
          computed: kind !== 'value',
        })),
        issues: entryIssues(kind, first.inputs, row.protocol),
        voided:
          first.voidedAt === null
            ? null
            : {
                at: first.voidedAt.toISOString(),
                by: first.voidedBy as UserId | null,
                reason: first.voidReason ?? '',
              },
      };
    }),
    scores: scores.map((score) => {
      const sample = rules.get(score.metricCode);
      return {
        metricCode: score.metricCode,
        unit: sample?.unit ?? 'n',
        value: score.value,
        aggregation: score.aggregation,
        attemptCount: score.attemptCount,
        derived: sample?.isDerived ?? false,
      };
    }),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

/** Results with their entries and scores, in the order of `rows`. */
export async function testResultDtos(
  db: TenantDatabase,
  clubId: ClubId,
  rows: readonly TestResultRow[],
): Promise<TestResult[]> {
  const values = await valuesOf(
    db,
    clubId,
    rows.map((r) => r.id),
  );
  const byResult = new Map<string, ValueRow[]>();
  for (const value of values) {
    const list = byResult.get(value.testResultId);
    if (list === undefined) byResult.set(value.testResultId, [value]);
    else list.push(value);
  }
  return rows.map((row) => resultDto(row, byResult.get(row.id) ?? []));
}

export async function testResultDto(
  db: TenantDatabase,
  clubId: ClubId,
  testResultId: string,
): Promise<TestResult> {
  const row = await readTestResultRow(db, clubId, testResultId);
  if (row === undefined) throw new HttpError('not_found', 'Test result not found');
  const [dto] = await testResultDtos(db, clubId, [row]);
  if (dto === undefined) throw new Error('testResultDto: no result');
  return dto;
}
