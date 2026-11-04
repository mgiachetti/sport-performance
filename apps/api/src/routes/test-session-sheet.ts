import {
  getTestSessionSheet,
  type TestDaySheet,
  type TestDaySheetPlayer,
  type TestDefinition,
} from '@sport-performance/contracts';
import {
  batteryConfig,
  device,
  player,
  playerCategory,
  testDefinition,
  testResult,
  testResultValue,
  testWindow,
} from '@sport-performance/db/schema';
import {
  CANONICAL_TEST_CODES,
  batteryIncludesTest,
  can,
  decide,
  entryKindsOfTest,
  resolveBattery,
  strengthAssessmentFor,
  testApplicability,
  type BatteryEntry,
  type BatteryRow,
  type ClubId,
  type LocalDate,
  type PlayerId,
  type Sport,
  type TestWindowNumber,
} from '@sport-performance/domain';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import {
  loadDefinitions,
  loadPlayers,
  loadStageSources,
  readTestSession,
  sameDeviceOnly,
  sessionTarget,
  stageContextOn,
  testResultColumns,
  testResultDtos,
  testSessionDto,
  type DefinitionInfo,
  type StageContext,
  type TestSessionRow,
} from './tests/model.js';

/**
 * The sheet of a test day (B-405, ADR 0068): one read with the stations,
 * the roster with the stage rules and the previous results, so the web and
 * the field app never assemble it from many calls. Recording stays in the
 * endpoints of B-320.
 */

const TEST_ORDER: readonly string[] = CANONICAL_TEST_CODES;

/** Tests in the order of the battery of CLAUDE.md, then by code. */
export function byBatteryOrder(a: string, b: string): number {
  const ia = TEST_ORDER.indexOf(a);
  const ib = TEST_ORDER.indexOf(b);
  if (ia !== ib) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Battery entries of the sport (with windows and cadence), never the withdrawn ones. */
export async function batteryEntries(
  db: TenantDatabase,
  clubId: ClubId,
  sport: Sport,
): Promise<(BatteryEntry & BatteryRow)[]> {
  const rows = await db
    .select({
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
    })
    .from(batteryConfig)
    .where(
      and(
        eq(batteryConfig.clubId, clubId),
        eq(batteryConfig.sport, sport),
        isNull(batteryConfig.archivedAt),
      ),
    );
  return rows.map((row) => ({
    clubId,
    sport: row.sport,
    sex: row.sex,
    stage: row.stage,
    categoryId: row.categoryId,
    testCode: row.testCode,
    windows: row.windows as TestWindowNumber[],
    cadenceWeeks:
      row.cadenceWeeksMin === null || row.cadenceWeeksMax === null
        ? null
        : { min: row.cadenceWeeksMin, max: row.cadenceWeeksMax },
    validFrom: row.validFrom,
    validTo: row.validTo,
  }));
}

/**
 * Tests the battery schedules for a player on the day: the most specific
 * entry of each test that applies, in the day's window (any window without
 * one). Anthropometry is a measurement, never a station.
 */
export function scheduledTests(
  entries: readonly (BatteryEntry & BatteryRow)[],
  clubId: ClubId,
  sex: 'male' | 'female',
  stage: StageContext,
  on: LocalDate,
  windowNumber: number | null,
): string[] {
  const query = {
    clubId,
    sport: stage.sport,
    sex,
    stage: stage.stage,
    categoryId: stage.categoryId,
    onDate: on,
  };
  let resolved: readonly BatteryEntry[];
  try {
    resolved = resolveBattery(entries, query);
  } catch {
    // Two equally specific entries (a data error the battery endpoints prevent):
    // fall back to every entry that applies, as recording does.
    resolved = entries.filter((entry) => batteryIncludesTest([entry], entry.testCode, query, on));
  }
  return resolved
    .filter((entry) => entryKindsOfTest(entry.testCode).length > 0)
    .filter(
      (entry) =>
        windowNumber === null || (entry.windows as readonly number[]).includes(windowNumber),
    )
    .map((entry) => entry.testCode);
}

/** The protocol version of each test in effect on the day for the sport (the latest if several). */
async function definitionsInEffect(
  db: TenantDatabase,
  clubId: ClubId,
  testCodes: readonly string[],
  sport: Sport,
  on: LocalDate,
): Promise<Map<string, DefinitionInfo>> {
  const result = new Map<string, DefinitionInfo>();
  if (testCodes.length === 0) return result;
  const rows = await db
    .select({ id: testDefinition.id, code: testDefinition.code })
    .from(testDefinition)
    .where(
      and(
        eq(testDefinition.clubId, clubId),
        inArray(testDefinition.code, [...testCodes]),
        lte(testDefinition.validFrom, on),
        or(isNull(testDefinition.validTo), gt(testDefinition.validTo, on)),
        sql`(${testDefinition.sports} is null or ${sport} = any(${testDefinition.sports}))`,
      ),
    )
    .orderBy(asc(testDefinition.code), desc(testDefinition.version));
  const chosen = new Map<string, string>();
  for (const row of rows) if (!chosen.has(row.code)) chosen.set(row.code, row.id);
  const cache = new Map<string, DefinitionInfo | undefined>();
  await loadDefinitions(db, clubId, [...chosen.values()], cache);
  for (const [code, id] of chosen) {
    const definition = cache.get(id);
    if (definition !== undefined) result.set(code, definition);
  }
  return result;
}

function definitionDto(definition: DefinitionInfo): TestDefinition {
  const { protocol } = definition;
  return {
    id: definition.id as TestDefinition['id'],
    code: definition.code,
    version: definition.version,
    sports: definition.sports === null ? null : [...definition.sports],
    attemptCount: definition.attemptCount,
    attemptAggregation: definition.attemptAggregation,
    maximalLoad: definition.maximalLoad,
    sameDeviceOnly: sameDeviceOnly(definition),
    entryKinds: [...entryKindsOfTest(definition.code)],
    protocol: {
      summary: protocol.summary ?? null,
      steps: [...(protocol.steps ?? [])],
      restBetweenAttemptsS: protocol.restBetweenAttemptsS ?? null,
      equipment: [...(protocol.equipment ?? [])],
      parameters: { ...(protocol.parameters ?? {}) },
    },
    metrics: [...definition.metrics.values()].map((metric) => ({
      code: metric.code,
      unit: metric.unit,
      direction: metric.direction,
      derived: metric.isDerived,
    })),
    validFrom: definition.validFrom,
    validTo: definition.validTo,
  };
}

async function windowOf(
  db: TenantDatabase,
  clubId: ClubId,
  session: TestSessionRow,
): Promise<TestDaySheet['testWindow']> {
  if (session.testWindowId === null) return null;
  const [row] = await db
    .select({ id: testWindow.id, number: testWindow.number })
    .from(testWindow)
    .where(and(eq(testWindow.clubId, clubId), eq(testWindow.id, session.testWindowId)));
  if (row === undefined) return null;
  const number = row.number as TestWindowNumber;
  return {
    id: row.id as NonNullable<TestDaySheet['testWindow']>['id'],
    number,
    label: `V${String(number)}` as NonNullable<TestDaySheet['testWindow']>['label'],
  };
}

/** Players in the category on the day, plus those with results of the day (RLS applies). */
async function rosterIds(
  db: TenantDatabase,
  clubId: ClubId,
  session: TestSessionRow,
): Promise<{ inCategory: Set<string>; withResults: Map<string, Set<string>> }> {
  const inCategory = new Set<string>();
  if (session.categoryId !== null) {
    const rows = await db
      .select({ playerId: playerCategory.playerId })
      .from(playerCategory)
      .where(
        and(
          eq(playerCategory.clubId, clubId),
          eq(playerCategory.categoryId, session.categoryId),
          lte(playerCategory.validFrom, session.scheduledOn),
          or(isNull(playerCategory.validTo), gt(playerCategory.validTo, session.scheduledOn)),
        ),
      );
    for (const row of rows) inCategory.add(row.playerId);
  }
  const results = await db
    .select({ playerId: testResult.playerId, testCode: testDefinition.code })
    .from(testResult)
    .innerJoin(
      testDefinition,
      and(
        eq(testDefinition.clubId, testResult.clubId),
        eq(testDefinition.id, testResult.testDefinitionId),
      ),
    )
    .where(and(eq(testResult.clubId, clubId), eq(testResult.testSessionId, session.id)));
  const withResults = new Map<string, Set<string>>();
  for (const row of results) {
    const codes = withResults.get(row.playerId) ?? new Set<string>();
    codes.add(row.testCode);
    withResults.set(row.playerId, codes);
  }
  return { inCategory, withResults };
}

/** The latest done result of each player and test before the day, outside the day itself. */
async function previousResults(
  db: TenantDatabase,
  clubId: ClubId,
  session: TestSessionRow,
  playerIds: readonly string[],
  testCodes: readonly string[],
): Promise<Map<string, TestDaySheetPlayer['previous']>> {
  const byPlayer = new Map<string, TestDaySheetPlayer['previous']>();
  if (playerIds.length === 0 || testCodes.length === 0) return byPlayer;
  const rows = await db
    .selectDistinctOn([testResult.playerId, testDefinition.code], testResultColumns)
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
        inArray(testResult.playerId, [...playerIds] as PlayerId[]),
        inArray(testDefinition.code, [...testCodes]),
        eq(testResult.status, 'done'),
        lt(testResult.measuredOn, session.scheduledOn),
        or(isNull(testResult.testSessionId), ne(testResult.testSessionId, session.id)),
        // Only results with something to compare: a method and at least one
        // valid value (the scores come from them). Filtering here, before
        // DISTINCT ON, falls back to an earlier result when the latest has none.
        isNotNull(testResult.method),
        exists(
          db
            .select({ one: sql`1` })
            .from(testResultValue)
            .where(
              and(
                eq(testResultValue.clubId, testResult.clubId),
                eq(testResultValue.testResultId, testResult.id),
                isNull(testResultValue.voidedAt),
              ),
            ),
        ),
      ),
    )
    .orderBy(
      testResult.playerId,
      testDefinition.code,
      desc(testResult.measuredOn),
      desc(testResult.createdAt),
    );
  const dtos = await testResultDtos(db, clubId, rows);
  for (const dto of dtos) {
    // The query keeps only results with a method and valid values.
    if (dto.method === null || dto.scores.length === 0) continue;
    const list = byPlayer.get(dto.playerId) ?? [];
    list.push({
      testCode: dto.testCode,
      testResultId: dto.id,
      measuredOn: dto.measuredOn,
      method: dto.method,
      protocolVersion: dto.protocolVersion,
      deviceId: dto.deviceId,
      exercise: dto.exercise,
      scores: dto.scores,
    });
    byPlayer.set(dto.playerId, list);
  }
  return byPlayer;
}

async function devicesOf(db: TenantDatabase, clubId: ClubId): Promise<TestDaySheet['devices']> {
  const rows = await db
    .select({ id: device.id, kind: device.kind, label: device.label })
    .from(device)
    .where(and(eq(device.clubId, clubId), isNull(device.retiredAt)))
    .orderBy(asc(device.label), asc(device.id));
  return rows.map((row) => ({
    id: row.id as TestDaySheet['devices'][number]['id'],
    kind: row.kind,
    label: row.label,
  }));
}

export function registerTestSessionSheetRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getTestSessionSheet, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const session = await readTestSession(db, clubId, params.testSessionId);
      if (session === undefined) throw new HttpError('not_found', 'Test day not found');
      await permissions.authorize('test_session', 'read', sessionTarget(session));
      const subject = await permissions.subject();
      const day = session.scheduledOn;

      const { inCategory, withResults } = await rosterIds(db, clubId, session);
      const candidates = [...new Set([...inCategory, ...withResults.keys()])];
      const facts = await loadPlayers(db, clubId, candidates);
      const visible = candidates.filter((id) => {
        const context = facts.get(id);
        return (
          context !== undefined &&
          can(subject, 'read', { kind: 'test_result', clubId, player: context.facts })
        );
      }) as PlayerId[];
      const people =
        visible.length === 0
          ? []
          : await db
              .select({
                id: player.id,
                firstName: player.firstName,
                lastName: player.lastName,
                sex: player.sex,
                birthDate: player.birthDate,
              })
              .from(player)
              .where(and(eq(player.clubId, clubId), inArray(player.id, visible)))
              .orderBy(asc(player.lastName), asc(player.firstName), asc(player.id));

      const stageSources = await loadStageSources(db, clubId, visible);
      const stages = new Map(
        people.map((p) => [p.id, stageContextOn(stageSources, p.id, day, session.categoryId)]),
      );
      const entries = await batteryEntries(db, clubId, session.sport);
      const testWindowDto = await windowOf(db, clubId, session);
      const windowNumber = testWindowDto?.number ?? null;

      const scheduled = new Set<string>();
      for (const p of people) {
        const stage = stages.get(p.id);
        if (stage === undefined || !inCategory.has(p.id)) continue;
        for (const code of scheduledTests(entries, clubId, p.sex, stage, day, windowNumber)) {
          scheduled.add(code);
        }
      }
      const recorded = new Set<string>();
      for (const id of visible) for (const code of withResults.get(id) ?? []) recorded.add(code);
      const codes = [...new Set([...scheduled, ...recorded])].sort(byBatteryOrder);
      const definitions = await definitionsInEffect(db, clubId, codes, session.sport, day);
      const stations = codes.flatMap((code) => {
        const definition = definitions.get(code);
        return definition === undefined
          ? []
          : [
              {
                testCode: code,
                definition: definitionDto(definition),
                scheduled: scheduled.has(code),
              },
            ];
      });
      const stationCodes = stations.map((station) => station.testCode);
      const previous = await previousResults(db, clubId, session, visible, stationCodes);

      const recordingOf = (id: PlayerId): TestDaySheetPlayer['recording'] => {
        const context = facts.get(id);
        if (context === undefined) return 'forbidden';
        const decision = decide(subject, 'record', {
          kind: 'test_result',
          clubId,
          player: context.facts,
        });
        if (decision.allowed) return 'allowed';
        return decision.reason === 'missing_consent' ? 'missing_consent' : 'forbidden';
      };
      // Filming a player (the sprint by video, B-605; the CMJ video, B-604): who may, with their
      // image consent (ADR 0044).
      const videoOf = (id: PlayerId): TestDaySheetPlayer['video'] => {
        const context = facts.get(id);
        if (context === undefined) return 'forbidden';
        const decision = decide(subject, 'upload', {
          kind: 'media',
          clubId,
          player: context.facts,
        });
        if (decision.allowed) return 'allowed';
        return decision.reason === 'missing_consent' ? 'missing_consent' : 'forbidden';
      };
      const players: TestDaySheetPlayer[] = people.map((p) => {
        const stage = stages.get(p.id);
        return {
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          sex: p.sex,
          birthDate: p.birthDate,
          inCategory: inCategory.has(p.id),
          recording: recordingOf(p.id),
          video: videoOf(p.id),
          stage: stage?.stage ?? null,
          strengthAssessment:
            stage === undefined ? null : strengthAssessmentFor(stage.stage, stage.ageBand),
          tests: stations.map(({ testCode, definition }) => {
            if (stage === undefined) {
              return { testCode, applicable: false, reason: 'not_in_battery' as const };
            }
            const applicability = testApplicability({
              inBattery: batteryIncludesTest(
                entries,
                testCode,
                {
                  sport: stage.sport,
                  sex: p.sex,
                  stage: stage.stage,
                  categoryId: stage.categoryId,
                },
                day,
              ),
              maximalLoad: definition.maximalLoad,
              stage: stage.stage,
              ageBand: stage.ageBand,
            });
            return applicability.applicable
              ? { testCode, applicable: true, reason: null }
              : { testCode, applicable: false, reason: applicability.reason };
          }),
          previous: previous.get(p.id) ?? [],
        };
      });

      return {
        testSession: testSessionDto(session),
        testWindow: testWindowDto,
        stations,
        players,
        devices: await devicesOf(db, clubId),
      };
    },
  });
}
