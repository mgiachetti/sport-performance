import {
  archiveBatteryEntry,
  createBatteryEntry,
  getBatteryEntry,
  getEffectiveBattery,
  listBatteryEntries,
  restoreBatteryEntry,
  updateBatteryEntry,
  type BatteryEntryDto,
} from '@sport-performance/contracts';
import { batteryConfig, category, testDefinition } from '@sport-performance/db/schema';
import {
  BatteryEntryValidationError,
  DEFAULT_AGE_BANDS,
  findBatteryEntryConflicts,
  resolveBattery,
  validateBatterySchedule,
  validateBatteryStage,
  type AgeBand,
  type BatteryCadenceWeeks,
  type BatteryEntry,
  type CategoryId,
  type ClubId,
  type LocalDate,
  type Sex,
  type Sport,
  type Stage,
  type TestWindowNumber,
} from '@sport-performance/domain';
import { and, desc, eq, gt, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import {
  archiveStatusFilter,
  insertIdempotent,
  markReplay,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';
import {
  assertValidRange,
  clubToday,
  lockConfiguration,
  plannedValidity,
  rowsToClose,
  validationError,
  validityPhase,
} from './configuration-shared.js';

/**
 * Test battery of the club (B-322): which tests each group does and when.
 * Every write goes through the domain (`validateBatterySchedule`,
 * `validateBatteryStage`, `findBatteryEntryConflicts`); the effective
 * battery of a group is `resolveBattery`.
 */

const batteryColumns = {
  id: batteryConfig.id,
  clubId: batteryConfig.clubId,
  sport: batteryConfig.sport,
  sex: batteryConfig.sex,
  stage: batteryConfig.stage,
  categoryId: batteryConfig.categoryId,
  testCode: batteryConfig.testCode,
  windows: batteryConfig.windows,
  cadenceWeeksMin: batteryConfig.cadenceWeeksMin,
  cadenceWeeksMax: batteryConfig.cadenceWeeksMax,
  validFrom: batteryConfig.validFrom,
  validTo: batteryConfig.validTo,
  archivedAt: batteryConfig.archivedAt,
  createdAt: batteryConfig.createdAt,
  updatedAt: batteryConfig.updatedAt,
  version: rowVersion(batteryConfig.updatedAt),
};

interface BatteryRow {
  id: string;
  clubId: ClubId;
  sport: Sport;
  sex: Sex | null;
  stage: Stage | null;
  categoryId: CategoryId | null;
  testCode: string;
  windows: number[];
  cadenceWeeksMin: number | null;
  cadenceWeeksMax: number | null;
  validFrom: LocalDate;
  validTo: LocalDate | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

type BatteryRowEntry = BatteryEntry & { readonly row: BatteryRow };

function cadenceOf(row: BatteryRow): BatteryCadenceWeeks | null {
  return row.cadenceWeeksMin === null || row.cadenceWeeksMax === null
    ? null
    : { min: row.cadenceWeeksMin, max: row.cadenceWeeksMax };
}

function sortedWindows(windows: readonly number[]): TestWindowNumber[] {
  return [...windows].sort((a, b) => a - b) as TestWindowNumber[];
}

function toEntry(row: BatteryRow): BatteryRowEntry {
  return {
    clubId: row.clubId,
    sport: row.sport,
    sex: row.sex,
    stage: row.stage,
    categoryId: row.categoryId,
    testCode: row.testCode,
    windows: sortedWindows(row.windows),
    cadenceWeeks: cadenceOf(row),
    validFrom: row.validFrom,
    validTo: row.validTo,
    row,
  };
}

function batteryDto(row: BatteryRow): BatteryEntryDto {
  return {
    id: row.id as BatteryEntryDto['id'],
    sport: row.sport,
    sex: row.sex,
    stage: row.stage,
    categoryId: row.categoryId,
    testCode: row.testCode,
    windows: sortedWindows(row.windows),
    cadenceWeeks: cadenceOf(row),
    validFrom: row.validFrom,
    validTo: row.validTo,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const BATTERY_KEYS: KeysetSpec<BatteryRow, 'testCode' | 'validFrom' | 'createdAt'> = {
  fields: {
    testCode: { column: batteryConfig.testCode, type: 'text', value: (row) => row.testCode },
    // `YYYY-MM-DD` sorts as text in date order.
    validFrom: {
      column: sql`${batteryConfig.validFrom}::text`,
      type: 'text',
      value: (row) => row.validFrom,
    },
    createdAt: {
      column: batteryConfig.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: batteryConfig.id, value: (row) => row.id },
};

function validOn(onDate: LocalDate | undefined): SQL | undefined {
  if (onDate === undefined) return undefined;
  return and(
    lte(batteryConfig.validFrom, onDate),
    or(isNull(batteryConfig.validTo), gt(batteryConfig.validTo, onDate)),
  );
}

async function readEntry(db: TenantDatabase, clubId: ClubId, id: string): Promise<BatteryRow> {
  const [row] = await db
    .select(batteryColumns)
    .from(batteryConfig)
    .where(and(eq(batteryConfig.clubId, clubId), eq(batteryConfig.id, id)));
  if (row === undefined) throw new HttpError('not_found', 'Battery entry not found');
  return row;
}

/** Domain validation of a battery entry, as `400` on the body field it is about. */
function domainChecked(run: () => void): void {
  try {
    run();
  } catch (error) {
    if (error instanceof BatteryEntryValidationError) {
      throw validationError(error.message, ['body', error.field], error.message);
    }
    throw error;
  }
}

interface CategoryFacts {
  id: CategoryId;
  sport: Sport;
  sex: Sex;
  ageBand: AgeBand | null;
  archived: boolean;
}

async function categoryFacts(
  db: TenantDatabase,
  clubId: ClubId,
  categoryId: CategoryId,
): Promise<CategoryFacts | undefined> {
  const [row] = await db
    .select({
      id: category.id,
      sport: category.sport,
      sex: category.sex,
      ageBandCode: category.ageBandCode,
      archivedAt: category.archivedAt,
    })
    .from(category)
    .where(and(eq(category.clubId, clubId), eq(category.id, categoryId)));
  if (row === undefined) return undefined;
  return {
    id: row.id,
    sport: row.sport,
    sex: row.sex,
    ageBand: DEFAULT_AGE_BANDS.find((band) => band.code === row.ageBandCode) ?? null,
    archived: row.archivedAt !== null,
  };
}

/**
 * The checks of a battery entry against the club's data: the category
 * (active, same sport and sex), the test (in the catalog, for the sport)
 * and the stage rule of maximal loads (principle 3).
 */
async function checkScope(
  db: TenantDatabase,
  clubId: ClubId,
  entry: {
    sport: Sport;
    sex: Sex | null;
    stage: Stage | null;
    categoryId: CategoryId | null;
    testCode: string;
    validFrom: LocalDate;
  },
  context: 'create' | 'restore',
): Promise<void> {
  let ageBand: AgeBand | null = null;
  if (entry.categoryId !== null) {
    const facts = await categoryFacts(db, clubId, entry.categoryId);
    if (facts === undefined) {
      throw validationError('Unknown category', ['body', 'categoryId']);
    }
    if (facts.archived) {
      if (context === 'restore') {
        throw new HttpError('conflict', 'The category of the entry is archived: restore it first');
      }
      throw validationError('The category is archived', ['body', 'categoryId']);
    }
    if (facts.sport !== entry.sport) {
      throw validationError('The category is of another sport', ['body', 'categoryId']);
    }
    if (entry.sex !== null && facts.sex !== entry.sex) {
      throw validationError('The category is of the other sex', ['body', 'sex']);
    }
    ageBand = facts.ageBand;
  }
  if (context === 'restore') return;
  const versions = await db
    .select({
      sports: testDefinition.sports,
      maximalLoad: testDefinition.maximalLoad,
      validFrom: testDefinition.validFrom,
      validTo: testDefinition.validTo,
    })
    .from(testDefinition)
    .where(and(eq(testDefinition.clubId, clubId), eq(testDefinition.code, entry.testCode)))
    .orderBy(desc(testDefinition.version));
  if (versions.length === 0) {
    throw validationError('The test is not in the catalog of the club', ['body', 'testCode']);
  }
  // The protocol version in force on the first day, or the latest one.
  const version =
    versions.find(
      (v) => v.validFrom <= entry.validFrom && (v.validTo === null || v.validTo > entry.validFrom),
    ) ?? versions[0];
  if (version === undefined) throw new Error('checkScope: no test version');
  if (version.sports !== null && !version.sports.includes(entry.sport)) {
    throw validationError('The test does not apply to the sport', ['body', 'testCode']);
  }
  domainChecked(() => {
    validateBatteryStage({ stage: entry.stage, maximalLoad: version.maximalLoad, ageBand });
  });
}

/** The other active entries of the same scope and test (for the overlap check). */
async function sameScopeEntries(
  db: TenantDatabase,
  clubId: ClubId,
  scope: BatteryEntry,
  excludeId: string | null,
): Promise<BatteryRowEntry[]> {
  const rows = await db
    .select(batteryColumns)
    .from(batteryConfig)
    .where(
      and(
        eq(batteryConfig.clubId, clubId),
        eq(batteryConfig.sport, scope.sport),
        eq(batteryConfig.testCode, scope.testCode),
        scope.sex === null ? isNull(batteryConfig.sex) : eq(batteryConfig.sex, scope.sex),
        scope.stage === null ? isNull(batteryConfig.stage) : eq(batteryConfig.stage, scope.stage),
        scope.categoryId === null
          ? isNull(batteryConfig.categoryId)
          : eq(batteryConfig.categoryId, scope.categoryId),
        isNull(batteryConfig.archivedAt),
        excludeId === null ? undefined : ne(batteryConfig.id, excludeId),
      ),
    );
  return rows.map(toEntry);
}

function conflictsWith(candidate: BatteryEntry, others: readonly BatteryRowEntry[]) {
  return findBatteryEntryConflicts<BatteryEntry>([candidate, ...others])
    .filter(([a, b]) => a === candidate || b === candidate)
    .map(([a, b]) => (a === candidate ? b : a) as BatteryRowEntry);
}

async function authorizedEntry(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  id: string,
  action: 'read' | 'update',
): Promise<BatteryRow> {
  await permissions.authorize('configuration', action);
  return readEntry(db, clubId, id);
}

export function registerBatteryRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listBatteryEntries, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'read');
      const plan = keysetPage(BATTERY_KEYS, query, {
        sport: query.sport,
        sex: query.sex,
        stage: query.stage,
        categoryId: query.categoryId,
        testCode: query.testCode,
        validOn: query.validOn,
        status: query.status,
      });
      const rows = await db
        .select(batteryColumns)
        .from(batteryConfig)
        .where(
          and(
            eq(batteryConfig.clubId, caller.membership.clubId),
            query.sport === undefined ? undefined : eq(batteryConfig.sport, query.sport),
            query.sex === undefined ? undefined : eq(batteryConfig.sex, query.sex),
            query.stage === undefined ? undefined : eq(batteryConfig.stage, query.stage),
            query.categoryId === undefined
              ? undefined
              : eq(batteryConfig.categoryId, query.categoryId),
            query.testCode === undefined ? undefined : eq(batteryConfig.testCode, query.testCode),
            validOn(query.validOn),
            archiveStatusFilter(batteryConfig.archivedAt, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, batteryDto);
    },
  });

  registerEndpoint(app, getEffectiveBattery, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'read');
      const { clubId } = caller.membership;
      const categoryId = query.categoryId ?? null;
      if (categoryId !== null && (await categoryFacts(db, clubId, categoryId)) === undefined) {
        throw new HttpError('not_found', 'Category not found');
      }
      const onDate = query.onDate ?? (await clubToday(db));
      const rows = await db
        .select(batteryColumns)
        .from(batteryConfig)
        .where(
          and(
            eq(batteryConfig.clubId, clubId),
            eq(batteryConfig.sport, query.sport),
            isNull(batteryConfig.archivedAt),
            validOn(onDate),
          ),
        );
      const resolved = resolveBattery(rows.map(toEntry), {
        clubId,
        sport: query.sport,
        sex: query.sex,
        stage: query.stage,
        categoryId,
        onDate,
      });
      return {
        sport: query.sport,
        sex: query.sex,
        stage: query.stage,
        categoryId,
        onDate,
        tests: resolved.map((entry) => ({
          testCode: entry.testCode,
          windows: [...entry.windows],
          cadenceWeeks: entry.cadenceWeeks,
          entry: batteryDto(entry.row),
        })),
      };
    },
  });

  registerEndpoint(app, getBatteryEntry, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) =>
      batteryDto(
        await authorizedEntry(
          db,
          permissions,
          caller.membership.clubId,
          params.batteryEntryId,
          'read',
        ),
      ),
  });

  registerEndpoint(app, createBatteryEntry, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      await lockConfiguration(db, 'battery_config', clubId);
      if (body.clientUuid !== undefined) {
        const [replay] = await db
          .select(batteryColumns)
          .from(batteryConfig)
          .where(
            and(eq(batteryConfig.clubId, clubId), eq(batteryConfig.clientUuid, body.clientUuid)),
          );
        if (replay !== undefined) {
          // The same create again: the row it made, without re-running the checks.
          markReplay(reply);
          return batteryDto(replay);
        }
      }
      const today = await clubToday(db);
      const windows = body.windows ?? [];
      const cadenceWeeks = body.cadenceWeeks ?? null;
      const validFrom = body.validFrom ?? today;
      const validTo = body.validTo ?? null;
      domainChecked(() => {
        validateBatterySchedule(windows, cadenceWeeks);
      });
      assertValidRange(validFrom, validTo);
      const candidate: BatteryEntry = {
        clubId,
        sport: body.sport,
        sex: body.sex ?? null,
        stage: body.stage ?? null,
        categoryId: body.categoryId ?? null,
        testCode: body.testCode,
        windows: sortedWindows(windows),
        cadenceWeeks,
        validFrom,
        validTo,
      };
      await checkScope(db, clubId, candidate, 'create');
      const toClose = rowsToClose({
        conflicts: conflictsWith(candidate, await sameScopeEntries(db, clubId, candidate, null)),
        closePrevious: body.closePrevious ?? false,
        validFrom,
        today,
        resource: 'battery entry',
      });
      for (const previous of toClose) {
        await db
          .update(batteryConfig)
          .set({ validTo: validFrom, updatedBy: caller.userId })
          .where(and(eq(batteryConfig.clubId, clubId), eq(batteryConfig.id, previous.row.id)));
      }
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(batteryConfig)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                sport: candidate.sport,
                sex: candidate.sex,
                stage: candidate.stage,
                categoryId: candidate.categoryId,
                testCode: candidate.testCode,
                windows: [...candidate.windows],
                cadenceWeeksMin: cadenceWeeks?.min ?? null,
                cadenceWeeksMax: cadenceWeeks?.max ?? null,
                validFrom,
                validTo,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [batteryConfig.clubId, batteryConfig.clientUuid] })
              .returning(batteryColumns)
          )[0],
        findByClientUuid: async (clientUuid) =>
          (
            await db
              .select(batteryColumns)
              .from(batteryConfig)
              .where(
                and(eq(batteryConfig.clubId, clubId), eq(batteryConfig.clientUuid, clientUuid)),
              )
          )[0],
      });
      return batteryDto(row);
    },
  });

  registerEndpoint(app, updateBatteryEntry, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const current = await authorizedEntry(
        db,
        permissions,
        clubId,
        params.batteryEntryId,
        'update',
      );
      await lockConfiguration(db, 'battery_config', clubId);
      if (current.archivedAt !== null) {
        throw new HttpError('conflict', 'The battery entry is archived: restore it first');
      }
      const today = await clubToday(db);
      const windows =
        body.windows === undefined ? sortedWindows(current.windows) : sortedWindows(body.windows);
      const cadenceWeeks = body.cadenceWeeks === undefined ? cadenceOf(current) : body.cadenceWeeks;
      const currentCadence = cadenceOf(current);
      const contentChanged =
        windows.join(',') !== sortedWindows(current.windows).join(',') ||
        cadenceWeeks?.min !== currentCadence?.min ||
        cadenceWeeks?.max !== currentCadence?.max;
      const validity = plannedValidity({
        row: current,
        today,
        validFrom: body.validFrom,
        validTo: body.validTo,
        contentChanged,
        resource: 'battery entry',
      });
      domainChecked(() => {
        validateBatterySchedule(windows, cadenceWeeks);
      });
      const candidate: BatteryEntry = { ...toEntry(current), windows, cadenceWeeks, ...validity };
      if (
        conflictsWith(candidate, await sameScopeEntries(db, clubId, candidate, current.id)).length >
        0
      ) {
        throw new HttpError(
          'conflict',
          'Another battery entry with the same scope is valid on overlapping days',
        );
      }
      const where = and(eq(batteryConfig.clubId, clubId), eq(batteryConfig.id, current.id));
      const row = await updateAtVersion({
        resource: 'Battery entry',
        update: async () =>
          (
            await db
              .update(batteryConfig)
              .set({
                windows: [...windows],
                cadenceWeeksMin: cadenceWeeks?.min ?? null,
                cadenceWeeksMax: cadenceWeeks?.max ?? null,
                validFrom: validity.validFrom,
                validTo: validity.validTo,
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(batteryConfig.updatedAt, body.version)))
              .returning(batteryColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: batteryConfig.id }).from(batteryConfig).where(where)).length > 0,
      });
      return batteryDto(row);
    },
  });

  registerEndpoint(app, archiveBatteryEntry, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await authorizedEntry(db, permissions, clubId, params.batteryEntryId, 'update');
      if (row.archivedAt !== null) return batteryDto(row);
      if (validityPhase(row, await clubToday(db)) !== 'planned') {
        throw new HttpError(
          'conflict',
          'The battery entry already applied: close it (validTo) instead of archiving it',
        );
      }
      await db
        .update(batteryConfig)
        .set({ archivedAt: sql`now()`, updatedBy: caller.userId })
        .where(and(eq(batteryConfig.clubId, clubId), eq(batteryConfig.id, row.id)));
      return batteryDto(await readEntry(db, clubId, row.id));
    },
  });

  registerEndpoint(app, restoreBatteryEntry, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await authorizedEntry(db, permissions, clubId, params.batteryEntryId, 'update');
      if (row.archivedAt === null) return batteryDto(row);
      await lockConfiguration(db, 'battery_config', clubId);
      if (validityPhase(row, await clubToday(db)) !== 'planned') {
        throw new HttpError(
          'conflict',
          'The start of the archived entry already passed: create a new one instead',
        );
      }
      const entry = toEntry(row);
      await checkScope(db, clubId, entry, 'restore');
      if (conflictsWith(entry, await sameScopeEntries(db, clubId, entry, row.id)).length > 0) {
        throw new HttpError(
          'conflict',
          'Another battery entry with the same scope is valid on overlapping days',
        );
      }
      await db
        .update(batteryConfig)
        .set({ archivedAt: null, updatedBy: caller.userId })
        .where(and(eq(batteryConfig.clubId, clubId), eq(batteryConfig.id, row.id)));
      return batteryDto(await readEntry(db, clubId, row.id));
    },
  });
}
