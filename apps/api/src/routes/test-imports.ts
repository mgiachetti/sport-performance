import {
  createTestImport,
  getTestImport,
  listTestImports,
  previewTestImport,
  type TestImport,
  type TestImportBody,
  type TestImportRowInput,
  type TestImportWarning,
  type TestResult,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  player,
  testDefinition,
  testImport,
  testResult,
  testResultValue,
} from '@sport-performance/db/schema';
import {
  PermissionDeniedError,
  batteryIncludesTest,
  compareLocalDates,
  createPlausibilityChecker,
  decimalAgeYears,
  entryKindsOfTest,
  parseMetricCode,
  parseUuid,
  strengthAssessmentFor,
  strengthMetricAllowed,
  testApplicability,
  type BatteryRow,
  type StrengthAssessment,
  type ClubId,
  type LocalDate,
  type PlayerId,
  type Sex,
  type UserId,
  type Uuid,
} from '@sport-performance/domain';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { clubToday, type RequestPermissions } from '../http/permissions.js';
import { batchBodySha256, batchRowClientUuid, markReplay } from '../http/writes.js';
import {
  batteryRowsOf,
  clubStaffIds,
  derivableMetrics,
  deriveResultValues,
  derivedInputs,
  existingDeviceIds,
  invalid,
  issue,
  loadBodyMasses,
  loadDefinitions,
  loadPlayers,
  loadStageSources,
  readTestResultRows,
  scoreEntry,
  stageContextOn,
  testResultDtos,
  toConditions,
  type DefinitionInfo,
  type IssuePath,
  type PlayerContext,
  type StageSources,
} from './tests/model.js';

/**
 * Imports of historical results (B-331, ADR 0052): rows of a spreadsheet,
 * already parsed by the client, recorded as `historical` results of an
 * import with the entries and formulas of B-320. The preview runs the very
 * same import in a savepoint and rolls it back, so what it shows is what the
 * import would write. The stage rules of the battery are warnings here: a
 * historical result is what was measured then.
 */

const plausibility = createPlausibilityChecker();

const importColumns = {
  id: testImport.id,
  source: testImport.source,
  rowCount: testImport.rowCount,
  createdCount: testImport.createdCount,
  skippedCount: testImport.skippedCount,
  bodySha256: testImport.bodySha256,
  createdBy: testImport.createdBy,
  createdAt: testImport.createdAt,
};

interface ImportRow {
  id: string;
  source: string;
  rowCount: number;
  createdCount: number;
  skippedCount: number;
  bodySha256: string;
  createdBy: string | null;
  createdAt: Date;
}

function importDto(row: ImportRow): TestImport {
  return {
    id: row.id as TestImport['id'],
    source: row.source,
    rowCount: row.rowCount,
    createdCount: row.createdCount,
    skippedCount: row.skippedCount,
    createdBy: row.createdBy as TestImport['createdBy'],
    createdAt: row.createdAt.toISOString(),
  };
}

const IMPORT_KEYS: KeysetSpec<ImportRow, 'createdAt'> = {
  fields: {
    createdAt: { column: testImport.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: testImport.id, value: (row) => row.id },
};

// ─── Resolving the rows ──────────────────────────────────────────────────────────────

/** A name as compared: no accents, lowercase, single spaces. */
export function normalizedName(name: string): string {
  return name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

interface PlayerRow {
  id: PlayerId;
  firstName: string;
  lastName: string;
  birthDate: LocalDate;
  sex: Sex;
}

interface DefinitionRow {
  id: string;
  code: string;
  version: number;
  validFrom: LocalDate;
  validTo: LocalDate | null;
}

/** What the batch needs from the database, read once for every row. */
interface BatchLookups {
  readonly today: LocalDate;
  readonly playersById: ReadonlyMap<string, PlayerRow>;
  readonly playersByName: ReadonlyMap<string, readonly PlayerRow[]>;
  readonly definitions: ReadonlyMap<string, readonly DefinitionRow[]>;
}

const nameKey = (lastName: string, firstName: string, birthDate: string) =>
  `${normalizedName(lastName)}|${normalizedName(firstName)}|${birthDate}`;

async function loadLookups(
  db: TenantDatabase,
  clubId: ClubId,
  body: TestImportBody,
): Promise<BatchLookups> {
  const ids = new Set<string>();
  const birthDates = new Set<string>();
  for (const row of body.rows) {
    if ('playerId' in row.player) ids.add(row.player.playerId);
    else birthDates.add(row.player.birthDate);
  }
  const playerColumns = {
    id: player.id,
    firstName: player.firstName,
    lastName: player.lastName,
    birthDate: player.birthDate,
    sex: player.sex,
  };
  // RLS: only the players the caller sees can be matched.
  const players: PlayerRow[] =
    ids.size + birthDates.size === 0
      ? []
      : await db
          .select(playerColumns)
          .from(player)
          .where(
            and(
              eq(player.clubId, clubId),
              sql`(${ids.size > 0 ? inArray(player.id, [...ids] as PlayerId[]) : sql`false`} or ${
                birthDates.size > 0
                  ? inArray(player.birthDate, [...birthDates] as LocalDate[])
                  : sql`false`
              })`,
            ),
          );
  const playersByName = new Map<string, PlayerRow[]>();
  for (const row of players) {
    const key = nameKey(row.lastName, row.firstName, row.birthDate);
    playersByName.set(key, [...(playersByName.get(key) ?? []), row]);
  }
  const codes = [...new Set(body.rows.map((row) => row.testCode))];
  const definitionRows = await db
    .select({
      id: testDefinition.id,
      code: testDefinition.code,
      version: testDefinition.version,
      validFrom: testDefinition.validFrom,
      validTo: testDefinition.validTo,
    })
    .from(testDefinition)
    .where(and(eq(testDefinition.clubId, clubId), inArray(testDefinition.code, codes)));
  const definitions = new Map<string, DefinitionRow[]>();
  for (const row of definitionRows) {
    definitions.set(row.code, [...(definitions.get(row.code) ?? []), row]);
  }
  return {
    today: await clubToday(db),
    playersById: new Map(players.map((row) => [row.id, row])),
    playersByName,
    definitions,
  };
}

function inEffect(definition: Pick<DefinitionRow, 'validFrom' | 'validTo'>, on: LocalDate) {
  return (
    compareLocalDates(definition.validFrom, on) <= 0 &&
    (definition.validTo === null || compareLocalDates(on, definition.validTo) < 0)
  );
}

/** Same player, test, day and exercise: the key of a duplicate. */
const duplicateKey = (
  playerId: string,
  testCode: string,
  measuredOn: string,
  exercise: string | null,
) => `${playerId}|${testCode}|${measuredOn}|${exercise ?? ''}`;

/** Results already recorded (done, any method) with the key of some row of the batch. */
async function recordedKeys(
  db: TenantDatabase,
  clubId: ClubId,
  playerIds: readonly string[],
  codes: readonly string[],
  days: readonly string[],
): Promise<Map<string, Uuid[]>> {
  const keys = new Map<string, Uuid[]>();
  if (playerIds.length === 0 || codes.length === 0 || days.length === 0) return keys;
  const rows = await db
    .select({
      id: testResult.id,
      playerId: testResult.playerId,
      code: testDefinition.code,
      measuredOn: testResult.measuredOn,
      exercise: testResult.exercise,
    })
    .from(testResult)
    .innerJoin(
      testDefinition,
      and(
        eq(testDefinition.clubId, testResult.clubId),
        eq(testDefinition.id, testResult.testDefinitionId),
      ),
    )
    .where(
      and(
        eq(testResult.clubId, clubId),
        eq(testResult.status, 'done'),
        inArray(testResult.playerId, playerIds as PlayerId[]),
        inArray(testDefinition.code, codes as string[]),
        inArray(testResult.measuredOn, days as LocalDate[]),
      ),
    );
  for (const row of rows) {
    const key = duplicateKey(row.playerId, row.code, row.measuredOn, row.exercise);
    keys.set(key, [...(keys.get(key) ?? []), parseUuid(row.id)]);
  }
  return keys;
}

// ─── Running the import ──────────────────────────────────────────────────────────────

/** The batch's clientUuid is already taken (by a concurrent import, or another batch). */
class ImportClientUuidTaken extends HttpError {
  constructor() {
    super('conflict', 'This clientUuid was already used for another import');
  }
}

interface RowPlan {
  readonly index: number;
  readonly path: IssuePath;
  playerId: PlayerId | null;
  definition: DefinitionInfo | null;
  measuredOn: LocalDate | null;
  outcome: 'create' | 'skip_duplicate' | 'invalid';
  testResultId: Uuid | null;
  scores: TestResult['scores'];
  warnings: TestImportWarning[];
}

interface ImportRun {
  readonly importId: string;
  readonly rows: RowPlan[];
  readonly issues: ValidationIssue[];
}

interface RunContext {
  readonly db: TenantDatabase;
  readonly permissions: RequestPermissions;
  readonly clubId: ClubId;
  readonly userId: UserId;
  readonly body: TestImportBody;
  readonly lookups: BatchLookups;
}

/** What a row names, resolved against the lookups (no query). */
interface RowResolution {
  readonly measuredOn: LocalDate;
  readonly player: PlayerRow | ValidationIssue;
  readonly definition: DefinitionRow | ValidationIssue;
}

/** What the batch reads once, after resolving its rows: a few queries for any size. */
interface BatchData {
  readonly players: ReadonlyMap<string, PlayerContext>;
  readonly definitions: ReadonlyMap<string, DefinitionInfo | undefined>;
  readonly stages: StageSources;
  /** Battery rows by `sport|testCode`. */
  readonly battery: ReadonlyMap<string, BatteryRow[]>;
  readonly staff: ReadonlySet<string>;
  readonly devices: ReadonlySet<string>;
  /** Results already recorded, by {@link duplicateKey}. */
  readonly recorded: ReadonlyMap<string, Uuid[]>;
  readonly bodyMassKg: (playerId: PlayerId, on: LocalDate) => number | null;
}

/** A valid row, ready to be written. */
interface RowWrite {
  readonly plan: RowPlan;
  readonly row: TestImportRowInput;
  readonly player: PlayerRow;
  readonly context: PlayerContext;
  readonly definition: DefinitionInfo;
  readonly measuredOn: LocalDate;
  readonly clientUuid: string;
  /** The scored values of its entries, without their result (not inserted yet). */
  readonly values: (typeof testResultValue.$inferInsert)[];
  readonly strengthAssessment: StrengthAssessment | null;
}

function resolvePlayer(
  ctx: RunContext,
  row: TestImportRowInput,
  path: IssuePath,
): PlayerRow | ValidationIssue {
  const at = [...path, 'player'];
  if ('playerId' in row.player) {
    return ctx.lookups.playersById.get(row.player.playerId) ?? issue(at, 'Player not found');
  }
  const { lastName, firstName, birthDate } = row.player;
  const matches = ctx.lookups.playersByName.get(nameKey(lastName, firstName, birthDate)) ?? [];
  if (matches.length === 1 && matches[0] !== undefined) return matches[0];
  return matches.length === 0
    ? issue(at, `No player is ${lastName}, ${firstName}, born ${birthDate}`)
    : issue(
        at,
        `${String(matches.length)} players are ${lastName}, ${firstName}, born ${birthDate}: name them by playerId`,
      );
}

function resolveDefinitionRow(
  ctx: RunContext,
  row: TestImportRowInput,
  measuredOn: LocalDate,
  path: IssuePath,
): DefinitionRow | ValidationIssue {
  const versions = ctx.lookups.definitions.get(row.testCode) ?? [];
  if (versions.length === 0) return issue([...path, 'testCode'], 'Test not found');
  if (row.protocolVersion !== undefined) {
    const chosen = versions.find((v) => v.version === row.protocolVersion);
    if (chosen === undefined) {
      return issue([...path, 'protocolVersion'], 'This test has no such protocol version');
    }
    if (!inEffect(chosen, measuredOn)) {
      return issue(
        [...path, 'protocolVersion'],
        'This protocol version is not in effect on measuredOn',
      );
    }
    return chosen;
  }
  const current = versions.find((v) => inEffect(v, measuredOn));
  return current ?? issue([...path, 'testCode'], 'No protocol version in effect on measuredOn');
}

const isIssue = (value: object): value is ValidationIssue => 'path' in value;

function resolveRow(ctx: RunContext, row: TestImportRowInput, path: IssuePath): RowResolution {
  const measuredOn = (row.measuredOn ?? ctx.body.measuredOn) as LocalDate | undefined;
  // The contract rejects a row without a day and without a default of the batch.
  if (measuredOn === undefined) throw new Error('test import: a row without measuredOn');
  return {
    measuredOn,
    player: resolvePlayer(ctx, row, path),
    definition: resolveDefinitionRow(ctx, row, measuredOn, path),
  };
}

async function loadBatch(
  ctx: RunContext,
  resolutions: readonly RowResolution[],
): Promise<BatchData> {
  const { db, clubId, body } = ctx;
  const players = resolutions.flatMap((r) => (isIssue(r.player) ? [] : [r.player]));
  const definitionRows = resolutions.flatMap((r) => (isIssue(r.definition) ? [] : [r.definition]));
  const contexts = await loadPlayers(
    db,
    clubId,
    players.map((p) => p.id),
  );
  const definitions = new Map<string, DefinitionInfo | undefined>();
  await loadDefinitions(
    db,
    clubId,
    definitionRows.map((d) => d.id),
    definitions,
  );
  const codes = [...new Set(definitionRows.map((d) => d.code))];
  const battery = new Map<string, BatteryRow[]>();
  for (const row of await batteryRowsOf(db, clubId, codes)) {
    const key = `${row.sport}|${row.testCode}`;
    battery.set(key, [...(battery.get(key) ?? []), row]);
  }
  const known = resolutions.flatMap((r, index) =>
    isIssue(r.player) || isIssue(r.definition)
      ? []
      : [
          {
            playerId: r.player.id,
            code: r.definition.code,
            day: r.measuredOn,
            exercise: body.rows[index]?.exercise ?? null,
          },
        ],
  );
  const strengthPlayers = known.filter((k) => k.code === 'strength').map((k) => k.playerId);
  return {
    players: contexts,
    definitions,
    stages: await loadStageSources(db, clubId, [...contexts.keys()] as PlayerId[]),
    battery,
    staff: await clubStaffIds(
      db,
      clubId,
      body.rows.flatMap((row) => (row.evaluatorId ? [row.evaluatorId] : [])),
    ),
    devices: await existingDeviceIds(
      db,
      clubId,
      body.rows.flatMap((row) => (row.deviceId === undefined ? [] : [row.deviceId])),
    ),
    recorded: await recordedKeys(
      db,
      clubId,
      [...new Set(known.map((k) => k.playerId))],
      [...new Set(known.map((k) => k.code))],
      [...new Set(known.map((k) => k.day))],
    ),
    bodyMassKg: await loadBodyMasses(db, clubId, strengthPlayers),
  };
}

/** Turns a denial of the matrix on one player into an issue of its row. */
async function authorizeRow(
  ctx: RunContext,
  facts: PlayerContext['facts'],
  path: IssuePath,
): Promise<ValidationIssue | undefined> {
  try {
    await ctx.permissions.authorize('test_result', 'record', { player: facts });
    return undefined;
  } catch (error) {
    if (!(error instanceof PermissionDeniedError)) throw error;
    return error.reason === 'missing_consent'
      ? issue(
          [...path, 'player'],
          `The player has no current ${error.missingConsents.join(', ')} consent`,
          'consent_required',
        )
      : issue([...path, 'player'], 'You may not record results of this player', 'forbidden');
  }
}

/**
 * Validates one row against what the batch read (no query): its issues are
 * returned, its warnings go to `plan`. A valid row to create is returned as
 * a write; a valid duplicate to skip is marked in `plan`.
 */
async function validateRow(
  ctx: RunContext,
  data: BatchData,
  row: TestImportRowInput,
  resolution: RowResolution,
  plan: RowPlan,
  seen: Map<string, number>,
): Promise<{ issues: ValidationIssue[]; write?: RowWrite }> {
  const { body, clubId } = ctx;
  const { path } = plan;
  const { measuredOn } = resolution;
  const issues: ValidationIssue[] = [];
  plan.measuredOn = measuredOn;
  if (compareLocalDates(measuredOn, ctx.lookups.today) > 0) {
    issues.push(issue([...path, 'measuredOn'], 'A historical result is not in the future'));
  }

  const found = isIssue(resolution.player) ? undefined : resolution.player;
  if (isIssue(resolution.player)) issues.push(resolution.player);
  const context = found === undefined ? undefined : data.players.get(found.id);
  if (found !== undefined && compareLocalDates(measuredOn, found.birthDate) < 0) {
    issues.push(issue([...path, 'measuredOn'], 'The player was not born yet on measuredOn'));
  }
  if (found !== undefined && context === undefined) {
    issues.push(issue([...path, 'player'], 'The player has never been in a category'));
  }
  if (context !== undefined) {
    plan.playerId = context.id;
    const denied = await authorizeRow(ctx, context.facts, path);
    if (denied !== undefined) issues.push(denied);
  }

  const definition = isIssue(resolution.definition)
    ? undefined
    : data.definitions.get(resolution.definition.id);
  if (isIssue(resolution.definition)) issues.push(resolution.definition);
  if (definition !== undefined) {
    plan.definition = definition;
    const isStrength = definition.code === 'strength';
    if (entryKindsOfTest(definition.code).length === 0) {
      issues.push(
        issue(
          [...path, 'testCode'],
          'Anthropometry is recorded as a measurement, not as a test result',
        ),
      );
    }
    if (isStrength && row.exercise === undefined) {
      issues.push(issue([...path, 'exercise'], 'Required for a strength result'));
    }
    if (!isStrength && row.exercise !== undefined) {
      issues.push(issue([...path, 'exercise'], 'Only strength results have an exercise'));
    }
  }
  if (row.evaluatorId !== undefined && row.evaluatorId !== null) {
    if (!data.staff.has(row.evaluatorId)) {
      issues.push(issue([...path, 'evaluatorId'], 'The evaluator is not on the staff of the club'));
    }
  }
  if (row.deviceId !== undefined && !data.devices.has(row.deviceId)) {
    issues.push(issue([...path, 'deviceId'], 'Device not found'));
  }

  // Stage rules of the battery (principle 3): warnings for what was measured then.
  let strengthAssessment: StrengthAssessment | null = null;
  if (context !== undefined && definition !== undefined) {
    const stage = stageContextOn(data.stages, context.id, measuredOn, null);
    const sport = stage?.sport ?? context.facts.sport;
    if (definition.sports !== null && !definition.sports.includes(sport)) {
      issues.push(issue([...path, 'testCode'], `This test is not part of ${sport}`));
    }
    if (stage === undefined) {
      plan.warnings.push({
        code: 'no_category_on_day',
        message: 'The player was in no category that day: the stage rules were not checked',
      });
    } else {
      const applicability = testApplicability({
        inBattery: batteryIncludesTest(
          data.battery.get(`${stage.sport}|${definition.code}`) ?? [],
          definition.code,
          {
            sport: stage.sport,
            sex: context.sex,
            stage: stage.stage,
            categoryId: stage.categoryId,
          },
          measuredOn,
        ),
        maximalLoad: definition.maximalLoad,
        stage: stage.stage,
        ageBand: stage.ageBand,
      });
      if (!applicability.applicable) {
        plan.warnings.push({
          code: applicability.reason,
          message: `The test did not apply to the stage of the player that day (${applicability.reason})`,
        });
      }
      if (definition.code === 'strength') {
        strengthAssessment = strengthAssessmentFor(stage.stage, stage.ageBand);
      }
    }
  }

  // The entries, scored as on a new result. They carry no clientUuid: derived from the
  // batch's, so that a re-sent batch finds the same entries and no entry meets another one.
  const clientUuid = batchRowClientUuid(body.clientUuid, 'test_result', plan.index);
  const values: (typeof testResultValue.$inferInsert)[] = [];
  if (definition !== undefined) {
    // Stage rules do not block a historical strength metric: checked later as a warning.
    const entryContext = {
      clubId,
      userId: ctx.userId,
      resultId: clientUuid,
      definition,
      strengthAssessment: null,
    };
    const resultLevel = new Set<string>();
    for (const [entryIndex, entry] of row.entries.entries()) {
      const entryId = batchRowClientUuid(
        body.clientUuid,
        `test_result_entry:${String(plan.index)}`,
        entryIndex,
      );
      values.push(
        ...scoreEntry(
          entryContext,
          { ...entry, clientUuid: parseUuid(entryId) },
          entryId,
          [...path, 'entries', entryIndex],
          resultLevel,
          issues,
        ),
      );
    }
  }

  // Duplicates: within the batch always an error; against what is recorded, by the mode.
  if (context !== undefined && definition !== undefined) {
    const key = duplicateKey(context.id, definition.code, measuredOn, row.exercise ?? null);
    const first = seen.get(key);
    if (first !== undefined) {
      issues.push(
        issue(path, `Same player, test, day and exercise as row ${String(first)}`, 'duplicate'),
      );
    } else {
      seen.set(key, plan.index);
    }
    const existing = data.recorded.get(key);
    if (existing !== undefined) {
      plan.warnings.push({
        code: 'duplicate',
        message: 'A result of the same player, test, day and exercise is already recorded',
        testResultIds: existing,
      });
      if (body.onDuplicate === 'reject') {
        issues.push(
          issue(
            path,
            'A result of the same player, test, day and exercise is already recorded: fix the row or import with onDuplicate "skip"',
            'duplicate',
          ),
        );
      } else if (issues.length === 0) {
        // Skipped, once the row is valid: the import counts it as skipped.
        plan.outcome = 'skip_duplicate';
        return { issues };
      }
    }
  }
  if (issues.length > 0) return { issues };
  if (context === undefined || definition === undefined || found === undefined) {
    throw new Error('test import: a valid row without its player or definition');
  }
  return {
    issues,
    write: {
      plan,
      row,
      player: found,
      context,
      definition,
      measuredOn,
      clientUuid,
      values,
      strengthAssessment,
    },
  };
}

/** Rows per `INSERT`: well under the 65535 parameters of a statement. */
const INSERT_CHUNK = 500;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += INSERT_CHUNK) {
    out.push(items.slice(start, start + INSERT_CHUNK));
  }
  return out;
}

/**
 * Writes the valid rows in bulk: the results, their values and the derived
 * values computed from them (as `recomputeDerived` does for one result).
 */
async function writeRows(
  ctx: RunContext,
  data: BatchData,
  importId: string,
  writes: readonly RowWrite[],
): Promise<void> {
  const { db, clubId, userId } = ctx;
  const ids = new Map<string, string>();
  for (const chunk of chunks(writes)) {
    const inserted = await db
      .insert(testResult)
      .values(
        chunk.map((w) => ({
          clubId,
          clientUuid: w.clientUuid,
          playerId: w.context.id,
          testDefinitionId: w.definition.id,
          testSessionId: null,
          measuredOn: w.measuredOn,
          status: 'done' as const,
          method: 'historical' as const,
          evaluatorId: w.row.evaluatorId ?? null,
          deviceId: w.row.deviceId ?? null,
          exercise: w.row.exercise ?? null,
          conditions: w.row.conditions === undefined ? {} : toConditions(w.row.conditions),
          notes: w.row.notes ?? null,
          importId,
          createdBy: userId,
          updatedBy: userId,
        })),
      )
      .returning({ id: testResult.id, clientUuid: testResult.clientUuid });
    for (const row of inserted) ids.set(row.clientUuid, row.id);
  }
  const values: (typeof testResultValue.$inferInsert)[] = [];
  for (const write of writes) {
    const resultId = ids.get(write.clientUuid);
    if (resultId === undefined) throw new Error('test import: a result was not inserted');
    write.plan.testResultId = parseUuid(resultId);
    values.push(...write.values.map((value) => ({ ...value, testResultId: resultId })));
    const derivable = derivableMetrics(write.definition);
    if (derivable.length === 0) continue;
    const codes = new Map([...write.definition.metrics.values()].map((m) => [m.id, m.code]));
    const { next, from } = deriveResultValues(
      write.definition,
      write.values
        .map((v) => ({
          metricCode: codes.get(v.metricDefinitionId) ?? '',
          value: v.value,
          attemptNumber: v.attemptNumber ?? null,
        }))
        .sort((a, b) => (a.attemptNumber ?? Infinity) - (b.attemptNumber ?? Infinity)),
      write.definition.code === 'strength'
        ? data.bodyMassKg(write.context.id, write.measuredOn)
        : null,
    );
    for (const code of derivable) {
      const metric = write.definition.metrics.get(code);
      const value = next.get(code);
      if (metric === undefined || value === undefined) continue;
      values.push({
        clubId,
        testResultId: resultId,
        metricDefinitionId: metric.id,
        attemptNumber: null,
        inputs: derivedInputs(from, code),
        value,
        unit: metric.unit,
        createdBy: userId,
        updatedBy: userId,
      });
    }
  }
  for (const chunk of chunks(values)) await db.insert(testResultValue).values(chunk);
}

/** The scores and the warnings of the written rows, from the results as stored (two queries). */
async function readWritten(ctx: RunContext, writes: readonly RowWrite[]): Promise<void> {
  const { db, clubId } = ctx;
  const rows = await readTestResultRows(
    db,
    clubId,
    writes.flatMap((w) => (w.plan.testResultId === null ? [] : [w.plan.testResultId])),
  );
  const dtos = new Map((await testResultDtos(db, clubId, rows)).map((dto) => [dto.id, dto]));
  for (const write of writes) {
    const { plan } = write;
    const dto = plan.testResultId === null ? undefined : dtos.get(plan.testResultId);
    if (dto === undefined) throw new Error('test import: a written result is not readable');
    plan.scores = dto.scores;
    const derived = new Set(dto.scores.filter((s) => s.derived).map((s) => s.metricCode));
    if (write.strengthAssessment !== null) {
      // The metrics of the entries (not the result-level derived ones), as `insertEntries`
      // checks them for a new result.
      const metricCodes = new Set(
        dto.entries
          .filter((e) => e.kind !== 'derived')
          .flatMap((e) => e.values.map((v) => v.metricCode)),
      );
      for (const metricCode of metricCodes) {
        if (strengthMetricAllowed(metricCode, write.strengthAssessment)) continue;
        plan.warnings.push({
          code: 'strength_metric_not_in_stage',
          message: `${metricCode} is not recorded in the stage of the player that day (${write.strengthAssessment})`,
          metricCode,
        });
      }
    }
    const ageYears = decimalAgeYears(write.player.birthDate, write.measuredOn);
    for (const entry of dto.entries) {
      if (entry.issues.length > 0) {
        plan.warnings.push({
          code: 'protocol_issue',
          message: `The set breaks the protocol (${entry.issues.join(', ')})`,
          issues: [...entry.issues],
        });
      }
      for (const value of entry.values) {
        if (derived.has(value.metricCode)) continue;
        const check = plausibility({
          metricCode: parseMetricCode(value.metricCode),
          value: value.value,
          sex: write.context.sex,
          ageYears,
        });
        if (check.status === 'below' || check.status === 'above') {
          plan.warnings.push({
            code: 'implausible_value',
            message: `${value.metricCode} = ${String(value.value)} is ${check.status} the plausible range`,
            metricCode: value.metricCode,
            value: value.value,
            bounds: { min: check.bounds.minValue, max: check.bounds.maxValue },
            suggestedValues: [...check.suggestedValues],
          });
        }
      }
    }
  }
}

/**
 * Runs the whole batch: reads what every row needs once, validates every row
 * (each checked even if another failed, so the staff fixes the spreadsheet at
 * once), writes the import record and then, in bulk, the valid rows. Returns
 * the issues instead of throwing them; the caller decides. An import with
 * issues writes no row (the request fails anyway); a preview writes the valid
 * ones to show their scores, and rolls everything back.
 */
async function runImport(ctx: RunContext, mode: 'preview' | 'import'): Promise<ImportRun> {
  const { db, clubId, body } = ctx;
  const plans: RowPlan[] = body.rows.map((_, index) => ({
    index,
    path: ['body', 'rows', index],
    playerId: null,
    definition: null,
    measuredOn: null,
    outcome: 'create',
    testResultId: null,
    scores: [],
    warnings: [],
  }));
  const resolutions = body.rows.map((row, index) => resolveRow(ctx, row, ['body', 'rows', index]));
  const data = await loadBatch(ctx, resolutions);

  const issues: ValidationIssue[] = [];
  const writes: RowWrite[] = [];
  const seen = new Map<string, number>();
  for (const [index, row] of body.rows.entries()) {
    const plan = plans[index];
    const resolution = resolutions[index];
    if (plan === undefined || resolution === undefined) continue;
    const checked = await validateRow(ctx, data, row, resolution, plan, seen);
    if (checked.issues.length > 0) {
      plan.outcome = 'invalid';
      issues.push(...checked.issues);
    } else if (checked.write !== undefined) {
      writes.push(checked.write);
    }
  }

  // The counts are final once every row is valid (otherwise nothing is kept), so the
  // record is written once, before its results.
  const skippedCount = plans.filter((p) => p.outcome === 'skip_duplicate').length;
  const [created] = await db
    .insert(testImport)
    .values({
      clubId,
      clientUuid: body.clientUuid,
      source: body.source,
      rowCount: body.rows.length,
      createdCount: body.rows.length - skippedCount,
      skippedCount,
      bodySha256: batchBodySha256(body),
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .onConflictDoNothing({ target: [testImport.clubId, testImport.clientUuid] })
    .returning({ id: testImport.id });
  if (created === undefined) throw new ImportClientUuidTaken();
  if (mode === 'import' && issues.length > 0) return { importId: created.id, rows: plans, issues };

  await writeRows(ctx, data, created.id, writes);
  await readWritten(ctx, writes);
  return { importId: created.id, rows: plans, issues };
}

/** Thrown to roll the preview's savepoint back with what it computed. */
class PreviewRollback extends Error {
  constructor(readonly run: ImportRun) {
    super('preview rollback');
  }
}

async function readImport(
  db: TenantDatabase,
  clubId: ClubId,
  where: { id: string } | { clientUuid: string },
): Promise<ImportRow | undefined> {
  const [row] = await db
    .select(importColumns)
    .from(testImport)
    .where(
      and(
        eq(testImport.clubId, clubId),
        'id' in where ? eq(testImport.id, where.id) : eq(testImport.clientUuid, where.clientUuid),
      ),
    );
  return row;
}

export function registerTestImportRoutes(app: FastifyInstance): void {
  const context = (
    db: TenantDatabase,
    permissions: RequestPermissions,
    clubId: ClubId,
    userId: UserId,
    body: TestImportBody,
    lookups: BatchLookups,
  ): RunContext => ({ db, permissions, clubId, userId, body, lookups });

  registerEndpoint(app, previewTestImport, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller }) => {
      await permissions.listScope('data_import', 'run');
      const { clubId } = caller.membership;
      if ((await readImport(db, clubId, { clientUuid: body.clientUuid })) !== undefined) {
        throw new HttpError('conflict', 'This batch was already imported');
      }
      const lookups = await loadLookups(db, clubId, body);
      const ctx = context(db, permissions, clubId, caller.userId, body, lookups);
      let run: ImportRun;
      try {
        await db.transaction(async () => {
          throw new PreviewRollback(await runImport(ctx, 'preview'));
        });
        throw new Error('previewTestImport: the savepoint was not rolled back');
      } catch (error) {
        if (!(error instanceof PreviewRollback)) throw error;
        run = error.run;
      }
      const rows = run.rows.map((plan) => ({
        index: plan.index,
        playerId: plan.playerId,
        testDefinitionId: plan.definition === null ? null : parseUuid(plan.definition.id),
        protocolVersion: plan.definition?.version ?? null,
        measuredOn: plan.measuredOn,
        outcome: plan.outcome,
        scores: plan.scores,
        warnings: plan.warnings,
      }));
      return {
        rows,
        issues: run.issues,
        summary: {
          rowCount: rows.length,
          createCount: rows.filter((r) => r.outcome === 'create').length,
          skipCount: rows.filter((r) => r.outcome === 'skip_duplicate').length,
          invalidCount: rows.filter((r) => r.outcome === 'invalid').length,
          warningCount: rows.reduce((sum, r) => sum + r.warnings.length, 0),
        },
      };
    },
  });

  registerEndpoint(app, createTestImport, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.listScope('data_import', 'run');
      const { clubId } = caller.membership;
      // One import of the club at a time (until the transaction ends): two concurrent batches
      // cannot both miss each other's results in the duplicate check, and a concurrent
      // identical batch waits and is then a replay.
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`test_import:${clubId}`}, 0))`,
      );
      const replay = async () => {
        const previous = await readImport(db, clubId, { clientUuid: body.clientUuid });
        if (previous === undefined) return undefined;
        // The same clientUuid with another batch (even of as many rows) is not a replay.
        if (previous.bodySha256 !== batchBodySha256(body)) {
          throw new HttpError('conflict', 'This clientUuid was already used for another import');
        }
        const uuids = body.rows.map((_, index) =>
          batchRowClientUuid(body.clientUuid, 'test_result', index),
        );
        const results = await db
          .select({ id: testResult.id, clientUuid: testResult.clientUuid })
          .from(testResult)
          .where(
            and(
              eq(testResult.clubId, clubId),
              eq(testResult.importId, previous.id),
              inArray(testResult.clientUuid, uuids),
            ),
          );
        // The same hash is the same batch. The results are read through the RLS of
        // test_result: fewer than created means the caller does not see some of its players
        // (an sc replaying an import of the administration), who could not have run this
        // import either (every row needs test_result.record), so it is forbidden, not a
        // conflict, and never a replay that would show those rows as skipped.
        if (results.length !== previous.createdCount) {
          throw new HttpError('forbidden', 'Some results of this import are not visible to you');
        }
        const byUuid = new Map(results.map((r) => [r.clientUuid, r.id]));
        markReplay(reply);
        // The warnings of the first time are not stored: none on a replay.
        return {
          import: importDto(previous),
          rows: uuids.map((uuid, index) => {
            const id = byUuid.get(uuid);
            return {
              index,
              outcome: id === undefined ? ('skipped_duplicate' as const) : ('created' as const),
              testResultId: id === undefined ? null : parseUuid(id),
              warnings: [],
            };
          }),
        };
      };
      const replayed = await replay();
      if (replayed !== undefined) return replayed;

      const lookups = await loadLookups(db, clubId, body);
      const ctx = context(db, permissions, clubId, caller.userId, body, lookups);
      let run: ImportRun;
      try {
        run = await runImport(ctx, 'import');
      } catch (error) {
        // A concurrent identical import committed first. Only the import's own clientUuid:
        // any other conflict is not a replay.
        if (error instanceof ImportClientUuidTaken) {
          const concurrent = await replay();
          if (concurrent !== undefined) return concurrent;
        }
        throw error;
      }
      if (run.issues.length > 0) invalid(...run.issues);
      const stored = await readImport(db, clubId, { id: run.importId });
      if (stored === undefined) throw new Error('createTestImport: the import is not readable');
      return {
        import: importDto(stored),
        rows: run.rows.map((plan) => ({
          index: plan.index,
          outcome:
            plan.outcome === 'skip_duplicate'
              ? ('skipped_duplicate' as const)
              : ('created' as const),
          testResultId: plan.testResultId,
          warnings: plan.warnings,
        })),
      };
    },
  });

  registerEndpoint(app, listTestImports, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.listScope('data_import', 'run');
      const { clubId } = caller.membership;
      const plan = keysetPage(IMPORT_KEYS, query, {});
      const rows = await db
        .select(importColumns)
        .from(testImport)
        .where(and(eq(testImport.clubId, clubId), plan.where))
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      const page = plan.page(rows, (row) => row);
      return { items: page.items.map(importDto), nextCursor: page.nextCursor };
    },
  });

  registerEndpoint(app, getTestImport, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.listScope('data_import', 'run');
      const { clubId } = caller.membership;
      const row = await readImport(db, clubId, { id: params.testImportId });
      if (row === undefined) throw new HttpError('not_found', 'Test import not found');
      return importDto(row);
    },
  });
}
