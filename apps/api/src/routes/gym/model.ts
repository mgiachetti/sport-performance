import type { GymProgram, GymSet, ValidationIssue } from '@sport-performance/contracts';
import {
  category,
  club,
  gymProgram,
  gymSet,
  playerCategory,
  testDefinition,
} from '@sport-performance/db/schema';
import {
  DEFAULT_AGE_BANDS,
  compareLocalDates,
  gymLibraryExercise,
  gymSetE1rmKg,
  gymSetWarnings,
  parseLocalDate,
  planExerciseSpec,
  findPlanExercise,
  strengthAssessmentFor,
  testScoringSettings,
  type CategoryFacts,
  type CategoryId,
  type ClubId,
  type E1rmProtocol,
  type GymExerciseSpec,
  type GymLoadKind,
  type GymPlan,
  type LocalDate,
  type PlayerId,
  type Sport,
  type Stage,
  type StrengthAssessment,
} from '@sport-performance/domain';
import { and, desc, eq, inArray, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { TenantDatabase } from '../../db/database.js';
import { HttpError } from '../../http/errors.js';
import { rowVersion } from '../../http/writes.js';
import {
  loadBodyMasses,
  loadStageSources,
  stageContextOn,
  type StageContext,
  type StageSources,
} from '../tests/model.js';

/**
 * Shared model of the gym endpoints (B-607, ADR 0075): how programs and sets
 * are read and rendered (the sets with the e1RM and the warnings of the
 * stage the player was in that day), which programs apply to a player on a
 * day, and the e1RM protocol of the club's strength test.
 */

// ─── Programs ────────────────────────────────────────────────────────────────────────

export const gymProgramColumns = {
  id: gymProgram.id,
  clientUuid: gymProgram.clientUuid,
  name: gymProgram.name,
  categoryId: gymProgram.categoryId,
  playerId: gymProgram.playerId,
  stage: gymProgram.stage,
  plan: gymProgram.plan,
  notes: gymProgram.notes,
  validFrom: gymProgram.validFrom,
  validTo: gymProgram.validTo,
  archivedAt: gymProgram.archivedAt,
  createdAt: gymProgram.createdAt,
  updatedAt: gymProgram.updatedAt,
  version: rowVersion(gymProgram.updatedAt),
};

export interface GymProgramRow {
  id: string;
  clientUuid: string;
  name: string;
  categoryId: CategoryId | null;
  playerId: PlayerId | null;
  stage: Stage | null;
  plan: Readonly<Record<string, unknown>>;
  notes: string | null;
  validFrom: LocalDate;
  validTo: LocalDate | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

/** The plan as stored: the API only writes plans its contract accepted. */
export function planOf(row: Pick<GymProgramRow, 'plan'>): GymPlan {
  const days = (row.plan as { days?: unknown }).days;
  return { days: Array.isArray(days) ? (days as GymPlan['days']) : [] };
}

export function gymProgramDto(row: GymProgramRow): GymProgram {
  return {
    id: row.id as GymProgram['id'],
    name: row.name,
    categoryId: row.categoryId,
    playerId: row.playerId,
    stage: row.stage,
    plan: planOf(row) as GymProgram['plan'],
    notes: row.notes,
    validFrom: row.validFrom,
    validTo: row.validTo,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export async function readGymProgram(
  db: TenantDatabase,
  clubId: ClubId,
  id: string,
): Promise<GymProgramRow> {
  const [row] = await db
    .select(gymProgramColumns)
    .from(gymProgram)
    .where(and(eq(gymProgram.clubId, clubId), eq(gymProgram.id, id)));
  if (row === undefined) throw new HttpError('not_found', 'Gym program not found');
  return row;
}

/** `valid_from <= day < valid_to` of a program. */
export function programValidOn(day: LocalDate): SQL {
  return sql`(${gymProgram.validFrom} <= ${day}::date and (${gymProgram.validTo} is null or ${gymProgram.validTo} > ${day}::date))`;
}

/** A category of the player on a day, and what of its programs reach the player. */
export interface PlayerCategoryDay {
  readonly id: CategoryId;
  /** The player's stage in the category that day (pinned, else the category's default). */
  readonly stage: Stage;
  /**
   * Whether the category's programs without a stage reach the player: they
   * were validated against the category's default stage (ADR 0075), so they
   * reach only a player whose strength assessment in the category is the
   * same (a late or early maturer pinned to another stage gets the programs
   * of their own stage).
   */
  readonly stageLessApplies: boolean;
}

/** What decides which category programs apply to a player on a day. */
export interface PlayerDay {
  readonly playerId: PlayerId;
  /** Categories of the player that day, with the player's stage in each. */
  readonly categories: readonly PlayerCategoryDay[];
  /** Stage of the player that day (pinned or by maturation, else the category's). */
  readonly stage: Stage | null;
}

/** The categories and stage of a player on a day, from the stage sources. */
export function playerDayOf(sources: StageSources, playerId: PlayerId, on: LocalDate): PlayerDay {
  const validOn = (row: { validFrom: LocalDate; validTo: LocalDate | null }) =>
    compareLocalDates(row.validFrom, on) <= 0 &&
    (row.validTo === null || compareLocalDates(row.validTo, on) > 0);
  const pinned = sources.stages.find((s) => s.playerId === playerId && validOn(s));
  const categories = sources.categories
    .filter((c) => c.playerId === playerId && validOn(c))
    .map((c): PlayerCategoryDay => {
      const stage = pinned?.stage ?? c.defaultStage;
      return {
        id: c.id,
        stage,
        stageLessApplies: categoryAssessment(c, stage) === categoryAssessment(c, null),
      };
    });
  return {
    playerId,
    categories,
    stage: stageContextOn(sources, playerId, on, null)?.stage ?? null,
  };
}

/**
 * Programs that apply to the player that day: their own, or of one of their
 * categories at the player's stage in it (one without a stage only when the
 * player is assessed as at the category's default stage).
 */
export function appliesTo(day: PlayerDay): SQL {
  const ofCategories = day.categories.map((c) =>
    and(
      eq(gymProgram.categoryId, c.id),
      c.stageLessApplies
        ? or(isNull(gymProgram.stage), eq(gymProgram.stage, c.stage))
        : eq(gymProgram.stage, c.stage),
    ),
  );
  return or(eq(gymProgram.playerId, day.playerId), ...ofCategories) ?? sql`false`;
}

/** Whether a program row applies to the player that day (same rule as {@link appliesTo}). */
export function programAppliesTo(
  row: Pick<GymProgramRow, 'playerId' | 'categoryId' | 'stage'>,
  day: PlayerDay,
): boolean {
  if (row.playerId !== null) return row.playerId === day.playerId;
  const category = day.categories.find((c) => c.id === row.categoryId);
  if (category === undefined) return false;
  return row.stage === null ? category.stageLessApplies : row.stage === category.stage;
}

/** The category of each program (`null` for a player's own), for the stage of its sets. */
export async function programCategories(
  db: TenantDatabase,
  clubId: ClubId,
  programIds: readonly string[],
): Promise<ReadonlyMap<string, CategoryId | null>> {
  const ids = [...new Set(programIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: gymProgram.id, categoryId: gymProgram.categoryId })
    .from(gymProgram)
    .where(and(eq(gymProgram.clubId, clubId), inArray(gymProgram.id, ids)));
  return new Map(rows.map((row) => [row.id, row.categoryId]));
}

/** Programs of the assigned categories or sports, or of the assigned players. */
export function assignedPrograms(
  today: LocalDate,
  categoryIds: readonly CategoryId[],
  sports: readonly Sport[],
): SQL {
  const target = or(
    categoryIds.length > 0 ? inArray(category.id, [...categoryIds]) : undefined,
    sports.length > 0 ? inArray(category.sport, [...sports]) : undefined,
  );
  if (target === undefined) return sql`false`;
  return sql`(exists (
      select 1 from ${category}
       where ${category.clubId} = ${gymProgram.clubId}
         and ${category.id} = ${gymProgram.categoryId}
         and ${target})
    or exists (
      select 1 from ${playerCategory}
        join ${category} on ${category.clubId} = ${playerCategory.clubId}
                        and ${category.id} = ${playerCategory.categoryId}
       where ${playerCategory.clubId} = ${gymProgram.clubId}
         and ${playerCategory.playerId} = ${gymProgram.playerId}
         and ${playerCategory.validFrom} <= ${today}::date
         and (${playerCategory.validTo} is null or ${playerCategory.validTo} > ${today}::date)
         and ${target}))`;
}

export async function categoryFacts(
  db: TenantDatabase,
  clubId: ClubId,
  categoryId: CategoryId,
): Promise<CategoryFacts & { defaultStage: Stage; ageBandCode: string }> {
  const [row] = await db
    .select({
      id: category.id,
      sport: category.sport,
      defaultStage: category.defaultStage,
      ageBandCode: category.ageBandCode,
    })
    .from(category)
    .where(and(eq(category.clubId, clubId), eq(category.id, categoryId)));
  if (row === undefined) throw new HttpError('not_found', 'Category not found');
  return row;
}

/** How strength is assessed in a category for a stage (its own default when `null`). */
export function categoryAssessment(
  facts: { defaultStage: Stage; ageBandCode: string },
  stage: Stage | null,
): StrengthAssessment {
  const band = DEFAULT_AGE_BANDS.find((b) => b.code === facts.ageBandCode);
  // An unknown band (a club's own) is treated as the strictest about maximal loads.
  return strengthAssessmentFor(stage ?? facts.defaultStage, {
    maximalLoadTestsForPlayers: band?.maximalLoadTestsForPlayers ?? false,
  });
}

/** How strength is assessed for a player that day (`null` without a category that day). */
export function assessmentOf(context: StageContext | undefined): StrengthAssessment | null {
  if (context === undefined) return null;
  return strengthAssessmentFor(context.stage, context.ageBand);
}

// ─── Strength protocol ───────────────────────────────────────────────────────────────

/**
 * The e1RM protocol of the club's strength test (B-322: configurable per
 * club), per sport and day: the version valid that day for the sport (the
 * highest), else the defaults. Loaded once per request.
 */
export async function loadE1rmProtocols(
  db: TenantDatabase,
  clubId: ClubId,
): Promise<(sport: Sport | null, on: LocalDate) => E1rmProtocol> {
  const rows = await db
    .select({
      sports: testDefinition.sports,
      version: testDefinition.version,
      protocol: testDefinition.protocol,
      validFrom: testDefinition.validFrom,
      validTo: testDefinition.validTo,
    })
    .from(testDefinition)
    .where(and(eq(testDefinition.clubId, clubId), eq(testDefinition.code, 'strength')))
    .orderBy(desc(testDefinition.version));
  return (sport, on) => {
    const row = rows.find(
      (r) =>
        compareLocalDates(r.validFrom, on) <= 0 &&
        (r.validTo === null || compareLocalDates(r.validTo, on) > 0) &&
        (r.sports === null || sport === null || r.sports.includes(sport)),
    );
    return testScoringSettings(row?.protocol.parameters).e1rm;
  };
}

// ─── Exercises ───────────────────────────────────────────────────────────────────────

/** The spec of an exercise: as the program prescribes it, else the library's. */
export function exerciseSpecOf(
  exerciseCode: string,
  program: Pick<GymProgramRow, 'plan'> | null,
  dayKey: string | null,
): GymExerciseSpec | undefined {
  if (program !== null) {
    const prescribed = findPlanExercise(planOf(program), exerciseCode, dayKey);
    if (prescribed !== undefined) return planExerciseSpec(prescribed);
  }
  return gymLibraryExercise(exerciseCode);
}

// ─── Sets ────────────────────────────────────────────────────────────────────────────

export const gymSetColumns = {
  id: gymSet.id,
  clientUuid: gymSet.clientUuid,
  playerId: gymSet.playerId,
  gymProgramId: gymSet.gymProgramId,
  dayKey: gymSet.dayKey,
  performedOn: gymSet.performedOn,
  exerciseCode: gymSet.exerciseCode,
  loadKind: gymSet.loadKind,
  setNumber: gymSet.setNumber,
  reps: gymSet.reps,
  loadKg: gymSet.loadKg,
  rir: gymSet.rir,
  techniqueScore: gymSet.techniqueScore,
  durationS: gymSet.durationS,
  notes: gymSet.notes,
  voidedAt: gymSet.voidedAt,
  voidReason: gymSet.voidReason,
  createdAt: gymSet.createdAt,
  updatedAt: gymSet.updatedAt,
  version: rowVersion(gymSet.updatedAt),
};

export interface GymSetRow {
  id: string;
  clientUuid: string;
  playerId: PlayerId;
  gymProgramId: string | null;
  dayKey: string | null;
  performedOn: LocalDate;
  exerciseCode: string;
  loadKind: GymLoadKind;
  setNumber: number;
  reps: number | null;
  loadKg: number | null;
  rir: number | null;
  techniqueScore: number | null;
  durationS: number | null;
  notes: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

/** The spec a stored set was logged with: its load kind, and reps or a time. */
export function storedSpec(row: Pick<GymSetRow, 'loadKind' | 'durationS'>): GymExerciseSpec {
  return { loadKind: row.loadKind, measure: row.durationS === null ? 'reps' : 'duration' };
}

/**
 * The sets as the contract renders them, with what the server derives: the
 * strength assessment of the player that day, the e1RM (Epley with RIR,
 * the club's protocol, body mass for an added load) and the warnings. A
 * voided set keeps its values but gives no e1RM. Five queries for any
 * number of sets.
 */
export async function gymSetDtos(
  db: TenantDatabase,
  clubId: ClubId,
  rows: readonly GymSetRow[],
): Promise<GymSet[]> {
  if (rows.length === 0) return [];
  const players = [...new Set(rows.map((row) => row.playerId))];
  const [sources, bodyMass, protocols, categoryOf] = [
    await loadStageSources(db, clubId, players),
    await loadBodyMasses(db, clubId, players),
    await loadE1rmProtocols(db, clubId),
    await programCategories(
      db,
      clubId,
      rows.flatMap((row) => (row.gymProgramId === null ? [] : [row.gymProgramId])),
    ),
  ];
  return rows.map((row) => {
    // Logged against a category program: the stage in that category (a player in two).
    const preferred = row.gymProgramId === null ? null : (categoryOf.get(row.gymProgramId) ?? null);
    const context = stageContextOn(sources, row.playerId, row.performedOn, preferred);
    const assessment = assessmentOf(context);
    const spec = storedSpec(row);
    const protocol = protocols(context?.sport ?? null, row.performedOn);
    const values = {
      reps: row.reps,
      loadKg: row.loadKg,
      rir: row.rir,
      techniqueScore: row.techniqueScore,
      durationS: row.durationS,
    };
    const e1rmKg =
      assessment === null || row.voidedAt !== null
        ? null
        : gymSetE1rmKg(values, spec, assessment, {
            protocol,
            bodyMassKg: bodyMass(row.playerId, row.performedOn),
          });
    return {
      id: row.id as GymSet['id'],
      playerId: row.playerId,
      gymProgramId: row.gymProgramId as GymSet['gymProgramId'],
      dayKey: row.dayKey,
      performedOn: row.performedOn,
      exerciseCode: row.exerciseCode,
      loadKind: row.loadKind,
      setNumber: row.setNumber,
      reps: row.reps,
      loadKg: row.loadKg,
      rir: row.rir,
      techniqueScore: row.techniqueScore,
      durationS: row.durationS,
      notes: row.notes,
      strengthAssessment: assessment,
      e1rmKg: e1rmKg === null ? null : Math.round(e1rmKg * 10) / 10,
      warnings: assessment === null ? [] : gymSetWarnings(values, spec, assessment, protocol),
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidReason: row.voidReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    };
  });
}

/** {@link gymSetDtos} of one set. */
export async function gymSetDto(
  db: TenantDatabase,
  clubId: ClubId,
  row: GymSetRow,
): Promise<GymSet> {
  const [dto] = await gymSetDtos(db, clubId, [row]);
  if (dto === undefined) throw new Error('gymSetDto: no DTO for the set');
  return dto;
}

export async function readGymSet(
  db: TenantDatabase,
  clubId: ClubId,
  id: string,
): Promise<GymSetRow> {
  const [row] = await db
    .select(gymSetColumns)
    .from(gymSet)
    .where(and(eq(gymSet.clubId, clubId), eq(gymSet.id, id)));
  if (row === undefined) throw new HttpError('not_found', 'Gym set not found');
  return row;
}

/** The player's sets visible to the caller (`assigned` scope), by the categories today. */
export function assignedSetPlayers(
  playerId: AnyColumn,
  clubId: AnyColumn,
  today: LocalDate,
  categoryIds: readonly CategoryId[],
  sports: readonly Sport[],
): SQL {
  const target = or(
    categoryIds.length > 0 ? inArray(category.id, [...categoryIds]) : undefined,
    sports.length > 0 ? inArray(category.sport, [...sports]) : undefined,
  );
  if (target === undefined) return sql`false`;
  return sql`exists (
    select 1 from ${playerCategory}
      join ${category} on ${category.clubId} = ${playerCategory.clubId}
                      and ${category.id} = ${playerCategory.categoryId}
     where ${playerCategory.clubId} = ${clubId}
       and ${playerCategory.playerId} = ${playerId}
       and ${playerCategory.validFrom} <= ${today}::date
       and (${playerCategory.validTo} is null or ${playerCategory.validTo} > ${today}::date)
       and ${target})`;
}

/**
 * The club day of an instant (the offline queue checks windows at the time
 * the device recorded the mutation, ADR 0050).
 */
export async function clubDayOf(db: TenantDatabase, clubId: ClubId, at: Date): Promise<LocalDate> {
  const [row] = await db
    .select({
      day: sql<string>`((${at.toISOString()}::timestamptz) at time zone ${club.timeZone})::date::text`,
    })
    .from(club)
    .where(eq(club.id, clubId));
  if (row === undefined) throw new HttpError('forbidden', 'The club of the request is not visible');
  return parseLocalDate(row.day);
}

export function issue(path: (string | number)[], message: string): ValidationIssue {
  return { path, code: 'custom', message };
}

export function throwIssues(issues: readonly ValidationIssue[], message: string): void {
  if (issues.length > 0) {
    throw new HttpError('validation_failed', message, { details: [...issues] });
  }
}
