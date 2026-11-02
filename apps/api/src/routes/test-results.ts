import {
  addTestResultEntries,
  createTestResult,
  getTestResult,
  listPlayerTestMetric,
  listTestResults,
  updateTestResult,
  voidTestResultEntries,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  category,
  metricDefinition,
  playerCategory,
  testDefinition,
  testResult,
  testResultValue,
} from '@sport-performance/db/schema';
import {
  batteryIncludesTest,
  compareLocalDates,
  scoreResultMetrics,
  strengthAssessmentFor,
  strengthMetricAllowed,
  testApplicability,
  testComparisonWarnings,
  type ClubId,
} from '@sport-performance/domain';
import { and, eq, exists, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import { markReplay, updateAtVersion, versionMatches } from '../http/writes.js';
import {
  batteryRows,
  deviceExists,
  insertEntries,
  invalid,
  isClubStaff,
  issue,
  loadDefinition,
  loadPlayer,
  readTestResultRow,
  readTestSession,
  recomputeDerived,
  sameDeviceOnly,
  stageContext,
  testResultColumns,
  testResultDto,
  testResultDtos,
  throwIssues,
  toConditions,
  type DefinitionInfo,
  type PlayerContext,
  type TestResultRow,
  VALUE_ORDER,
} from './tests/model.js';
import { recordContext, recordResult } from './tests/record.js';

/**
 * Test results (B-320): one player in one protocol version, how it was
 * measured and its entries (append-only, corrected by voiding), with the
 * metric values computed by the domain formulas; and the series of a
 * player's metric with the warnings when methods, protocol versions or
 * devices are mixed (principle 4).
 */

const RESULT_KEYS: KeysetSpec<TestResultRow, 'measuredOn' | 'createdAt'> = {
  fields: {
    measuredOn: {
      column: sql`${testResult.measuredOn}::text`,
      type: 'text',
      value: (row) => row.measuredOn,
    },
    createdAt: { column: testResult.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: testResult.id, value: (row) => row.id },
};

/** The result and its player, after the matrix allowed `action` on the player. */
async function authorizedResult(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  testResultId: string,
  action: 'read' | 'record' | 'correct',
): Promise<{ row: TestResultRow; player: PlayerContext }> {
  const row = await readTestResultRow(db, clubId, testResultId);
  if (row === undefined) throw new HttpError('not_found', 'Test result not found');
  const player = await loadPlayer(db, clubId, row.playerId);
  if (player === undefined) throw new HttpError('not_found', 'Test result not found');
  await permissions.authorize('test_result', action, { player: player.facts });
  return { row, player };
}

async function requireDefinition(
  db: TenantDatabase,
  clubId: ClubId,
  definitionId: string,
): Promise<DefinitionInfo> {
  const definition = await loadDefinition(db, clubId, definitionId, new Map());
  if (definition === undefined) throw new Error('test result without its test definition');
  return definition;
}

/** `assigned` scope of a list: players currently in an assigned category or sport. */
function assignedPlayers(
  db: TenantDatabase,
  playerId: SQL | typeof testResult.playerId,
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
          eq(playerCategory.clubId, testResult.clubId),
          eq(playerCategory.playerId, playerId),
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

export function registerTestResultRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listTestResults, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const scope = await permissions.listScope('test_result', 'read');
      const plan = keysetPage(RESULT_KEYS, query, {
        playerId: query.playerId,
        testSessionId: query.testSessionId,
        testCode: query.testCode,
        testDefinitionId: query.testDefinitionId,
        status: query.status,
        from: query.from,
        to: query.to,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };
      let inScope: SQL | undefined;
      switch (scope.kind) {
        case 'club':
          break;
        case 'assigned':
          inScope = assignedPlayers(db, testResult.playerId, scope.categoryIds, scope.sports);
          break;
        case 'players':
          inScope = inArray(testResult.playerId, [...scope.playerIds]);
          break;
        case 'platform':
          return { items: [], nextCursor: null };
      }
      const rows = await db
        .select(testResultColumns)
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
            inScope,
            query.playerId === undefined ? undefined : eq(testResult.playerId, query.playerId),
            query.testSessionId === undefined
              ? undefined
              : eq(testResult.testSessionId, query.testSessionId),
            query.testCode === undefined ? undefined : eq(testDefinition.code, query.testCode),
            query.testDefinitionId === undefined
              ? undefined
              : eq(testResult.testDefinitionId, query.testDefinitionId),
            query.status === undefined ? undefined : eq(testResult.status, query.status),
            query.from === undefined ? undefined : gte(testResult.measuredOn, query.from),
            query.to === undefined ? undefined : lte(testResult.measuredOn, query.to),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      const page = plan.page(rows, (row) => row);
      return { items: await testResultDtos(db, clubId, page.items), nextCursor: page.nextCursor };
    },
  });

  registerEndpoint(app, getTestResult, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { row } = await authorizedResult(db, permissions, clubId, params.testResultId, 'read');
      const [dto] = await testResultDtos(db, clubId, [row]);
      if (dto === undefined) throw new Error('getTestResult: no result');
      return dto;
    },
  });

  registerEndpoint(app, createTestResult, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      const { clubId } = caller.membership;
      await permissions.listScope('test_result', 'record');
      let session = null;
      if (body.testSessionId !== undefined) {
        session = (await readTestSession(db, clubId, body.testSessionId)) ?? null;
        if (session === null) invalid(issue(['body', 'testSessionId'], 'Test day not found'));
      }
      const ctx = recordContext(db, permissions, clubId, caller.userId);
      const { id, replayed } = await recordResult(ctx, body, session, ['body']);
      if (replayed) markReplay(reply);
      return testResultDto(db, clubId, id);
    },
  });

  registerEndpoint(app, updateTestResult, {
    transaction: true,
    changeReason: ({ body }) => body.changeReason,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { row, player } = await authorizedResult(
        db,
        permissions,
        clubId,
        params.testResultId,
        'correct',
      );
      // The stored reason and note (the row is projected for the viewer).
      const [stored] = await db
        .select({ reason: testResult.notDoneReason, note: testResult.notDoneNote })
        .from(testResult)
        .where(and(eq(testResult.clubId, clubId), eq(testResult.id, row.id)));
      if (stored === undefined) throw new HttpError('not_found', 'Test result not found');
      const definition = await requireDefinition(db, clubId, row.testDefinitionId);
      const issues: ValidationIssue[] = [];
      const status = body.status ?? row.status;
      const measuredOn = body.measuredOn ?? row.measuredOn;
      const method = body.method === undefined ? row.method : body.method;
      const exercise = body.exercise === undefined ? row.exercise : body.exercise;
      const deviceId = body.deviceId === undefined ? row.deviceId : body.deviceId;
      let reason = body.notDoneReason === undefined ? stored.reason : body.notDoneReason;
      let note = body.notDoneNote === undefined ? stored.note : body.notDoneNote;

      if (status === 'done') {
        if ((body.notDoneReason ?? null) !== null || (body.notDoneNote ?? null) !== null) {
          issues.push(issue(['body', 'notDoneReason'], 'A done result has no not-done reason'));
        }
        reason = null;
        note = null;
        if (method === null) issues.push(issue(['body', 'method'], 'Required for a done result'));
      } else {
        if (reason === null) {
          issues.push(issue(['body', 'notDoneReason'], 'Required for a not-done result'));
        }
        if (reason === 'other' && (note === null || note.trim() === '')) {
          issues.push(issue(['body', 'notDoneNote'], 'Required when the reason is other'));
        }
      }
      if (body.measuredOn !== undefined) {
        const inEffect =
          compareLocalDates(definition.validFrom, measuredOn) <= 0 &&
          (definition.validTo === null || compareLocalDates(measuredOn, definition.validTo) < 0);
        if (!inEffect) {
          issues.push(
            issue(['body', 'measuredOn'], 'The protocol version is not in effect that day'),
          );
        }
      }
      if (status === 'done' && (row.status !== 'done' || body.measuredOn !== undefined)) {
        const session =
          row.testSessionId === null
            ? undefined
            : await readTestSession(db, clubId, row.testSessionId);
        const stage = await stageContext(
          db,
          clubId,
          player.id,
          measuredOn,
          session?.categoryId ?? null,
        );
        if (stage === undefined) {
          issues.push(issue(['body', 'measuredOn'], 'The player is in no category that day'));
        } else {
          const applicability = testApplicability({
            inBattery: batteryIncludesTest(
              await batteryRows(db, clubId, stage.sport, definition.code),
              definition.code,
              {
                sport: stage.sport,
                sex: player.sex,
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
            issues.push(
              issue(
                ['body', 'status'],
                `The test does not apply to the stage of the player (${applicability.reason})`,
                applicability.reason,
              ),
            );
          }
          if (definition.code === 'strength') {
            // The stored attempts must still be allowed in the stage of the new day.
            const assessment = strengthAssessmentFor(stage.stage, stage.ageBand);
            const stored = await db
              .selectDistinct({ code: metricDefinition.code })
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
                  eq(testResultValue.clubId, clubId),
                  eq(testResultValue.testResultId, row.id),
                  isNull(testResultValue.voidedAt),
                  sql`coalesce(${testResultValue.inputs} ->> 'kind', '') <> 'derived'`,
                ),
              );
            const disallowed = stored
              .map((m) => m.code)
              .filter((code) => !strengthMetricAllowed(code, assessment))
              .sort();
            if (disallowed.length > 0) {
              issues.push(
                issue(
                  ['body', 'measuredOn'],
                  `${disallowed.join(', ')} is not recorded in the stage of the player that day (${assessment}): void those entries first`,
                ),
              );
            }
          }
        }
      }
      if (status === 'not_done' && row.status === 'done') {
        const [valid] = await db
          .select({ id: testResultValue.id })
          .from(testResultValue)
          .where(
            and(
              eq(testResultValue.clubId, clubId),
              eq(testResultValue.testResultId, row.id),
              isNull(testResultValue.voidedAt),
            ),
          )
          .limit(1);
        if (valid !== undefined) {
          throw new HttpError(
            'conflict',
            'Void the entries of the result before marking it not done',
          );
        }
      }
      if ((body.exercise ?? null) !== null && definition.code !== 'strength') {
        issues.push(issue(['body', 'exercise'], 'Only strength results have an exercise'));
      }
      if (exercise === null && definition.code === 'strength' && status === 'done') {
        issues.push(issue(['body', 'exercise'], 'Required for a strength result'));
      }
      if (deviceId === null && sameDeviceOnly(definition) && status === 'done') {
        issues.push(
          issue(['body', 'deviceId'], 'This test is compared only on the same device: record it'),
        );
      }
      if (body.evaluatorId === null && method !== 'historical') {
        issues.push(
          issue(['body', 'evaluatorId'], 'Only a historical result may have an unknown evaluator'),
        );
      }
      if (
        body.evaluatorId !== undefined &&
        body.evaluatorId !== null &&
        !(await isClubStaff(db, clubId, body.evaluatorId))
      ) {
        issues.push(
          issue(['body', 'evaluatorId'], 'The evaluator is not on the staff of the club'),
        );
      }
      if (
        body.deviceId !== undefined &&
        body.deviceId !== null &&
        !(await deviceExists(db, clubId, body.deviceId))
      ) {
        issues.push(issue(['body', 'deviceId'], 'Device not found'));
      }
      throwIssues(issues);

      const where = and(eq(testResult.clubId, clubId), eq(testResult.id, row.id));
      await updateAtVersion({
        resource: 'Test result',
        update: async () =>
          (
            await db
              .update(testResult)
              .set({
                ...(body.measuredOn !== undefined && { measuredOn: body.measuredOn }),
                status,
                notDoneReason: reason,
                notDoneNote: note,
                ...(body.method !== undefined && { method: body.method }),
                ...(body.evaluatorId !== undefined && { evaluatorId: body.evaluatorId }),
                ...(body.deviceId !== undefined && { deviceId: body.deviceId }),
                ...(body.exercise !== undefined && { exercise: body.exercise }),
                ...(body.conditions !== undefined && { conditions: toConditions(body.conditions) }),
                ...(body.notes !== undefined && { notes: body.notes }),
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(testResult.updatedAt, body.version)))
              .returning({ id: testResult.id })
          )[0],
        exists: async () =>
          (await db.select({ id: testResult.id }).from(testResult).where(where)).length > 0,
      });
      if (body.measuredOn !== undefined && status === 'done') {
        await recomputeDerived(
          db,
          { clubId, userId: caller.userId, definition },
          { id: row.id, playerId: player.id, measuredOn },
        );
      }
      return testResultDto(db, clubId, row.id);
    },
  });

  registerEndpoint(app, addTestResultEntries, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { row, player } = await authorizedResult(
        db,
        permissions,
        clubId,
        params.testResultId,
        'record',
      );
      if (row.status !== 'done') {
        throw new HttpError('conflict', 'A not-done result has no entries: mark it done first');
      }
      const session =
        row.testSessionId === null
          ? undefined
          : await readTestSession(db, clubId, row.testSessionId);
      if (session?.status === 'cancelled') {
        throw new HttpError('conflict', 'The test day is cancelled: restore it to record results');
      }
      const definition = await requireDefinition(db, clubId, row.testDefinitionId);
      let strengthAssessment = null;
      if (definition.code === 'strength') {
        const stage = await stageContext(
          db,
          clubId,
          player.id,
          row.measuredOn,
          session?.categoryId ?? null,
        );
        if (stage === undefined)
          invalid(issue(['body', 'entries'], 'The player is in no category that day'));
        strengthAssessment = strengthAssessmentFor(stage.stage, stage.ageBand);
      }
      const ctx = {
        clubId,
        userId: caller.userId,
        resultId: row.id,
        definition,
        strengthAssessment,
      };
      await insertEntries(db, ctx, body.entries, ['body', 'entries']);
      await recomputeDerived(db, ctx, {
        id: row.id,
        playerId: player.id,
        measuredOn: row.measuredOn,
      });
      await db
        .update(testResult)
        .set({ updatedBy: caller.userId })
        .where(and(eq(testResult.clubId, clubId), eq(testResult.id, row.id)));
      return testResultDto(db, clubId, row.id);
    },
  });

  registerEndpoint(app, voidTestResultEntries, {
    transaction: true,
    changeReason: ({ body }) => body.reason,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { row, player } = await authorizedResult(
        db,
        permissions,
        clubId,
        params.testResultId,
        'correct',
      );
      const entries = await db
        .select({
          entryId: testResultValue.entryId,
          kind: sql<string | null>`${testResultValue.inputs} ->> 'kind'`,
        })
        .from(testResultValue)
        .where(
          and(
            eq(testResultValue.clubId, clubId),
            eq(testResultValue.testResultId, row.id),
            inArray(testResultValue.entryId, body.entryIds),
          ),
        );
      const issues: ValidationIssue[] = [];
      body.entryIds.forEach((entryId, index) => {
        const found = entries.filter((e) => e.entryId === entryId);
        if (found.length === 0) {
          issues.push(issue(['body', 'entryIds', index], 'Entry not found in this result'));
        } else if (found.some((e) => e.kind === 'derived')) {
          issues.push(
            issue(
              ['body', 'entryIds', index],
              'Derived values are recalculated by the server, never voided by hand',
            ),
          );
        }
      });
      throwIssues(issues);
      await db
        .update(testResultValue)
        .set({
          voidedAt: sql`now()`,
          voidedBy: caller.userId,
          voidReason: body.reason,
          updatedBy: caller.userId,
        })
        .where(
          and(
            eq(testResultValue.clubId, clubId),
            eq(testResultValue.testResultId, row.id),
            inArray(testResultValue.entryId, body.entryIds),
            isNull(testResultValue.voidedAt),
          ),
        );
      const definition = await requireDefinition(db, clubId, row.testDefinitionId);
      await recomputeDerived(
        db,
        { clubId, userId: caller.userId, definition },
        { id: row.id, playerId: player.id, measuredOn: row.measuredOn },
      );
      return testResultDto(db, clubId, row.id);
    },
  });

  registerEndpoint(app, listPlayerTestMetric, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      await permissions.listScope('test_result', 'read');
      const player = await loadPlayer(db, clubId, params.playerId);
      if (player === undefined) throw new HttpError('not_found', 'Player not found');
      await permissions.authorize('test_result', 'read', { player: player.facts });
      const [metric] = await db
        .select({ id: metricDefinition.id, direction: metricDefinition.direction })
        .from(metricDefinition)
        .where(
          and(eq(metricDefinition.clubId, clubId), eq(metricDefinition.code, params.metricCode)),
        );
      if (metric === undefined) throw new HttpError('not_found', 'Metric not found');

      const plan = keysetPage(RESULT_KEYS, query, {
        playerId: params.playerId,
        metricCode: params.metricCode,
        from: query.from,
        to: query.to,
        method: query.method,
        exercise: query.exercise,
      });
      const hasValue = exists(
        db
          .select({ one: sql`1` })
          .from(testResultValue)
          .where(
            and(
              eq(testResultValue.clubId, testResult.clubId),
              eq(testResultValue.testResultId, testResult.id),
              eq(testResultValue.metricDefinitionId, metric.id),
              isNull(testResultValue.voidedAt),
            ),
          ),
      );
      const filters = and(
        eq(testResult.clubId, clubId),
        eq(testResult.playerId, player.id),
        eq(testResult.status, 'done'),
        query.from === undefined ? undefined : gte(testResult.measuredOn, query.from),
        query.to === undefined ? undefined : lte(testResult.measuredOn, query.to),
        query.method === undefined ? undefined : eq(testResult.method, query.method),
        query.exercise === undefined ? undefined : eq(testResult.exercise, query.exercise),
        hasValue,
      );
      const joinDefinition = and(
        eq(testDefinition.clubId, testResult.clubId),
        eq(testDefinition.id, testResult.testDefinitionId),
      );
      const rows = await db
        .select(testResultColumns)
        .from(testResult)
        .innerJoin(testDefinition, joinDefinition)
        .where(and(filters, plan.where))
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      const page = plan.page(rows, (row) => row);

      const values =
        page.items.length === 0
          ? []
          : await db
              .select({
                testResultId: testResultValue.testResultId,
                value: testResultValue.value,
                unit: testResultValue.unit,
                attemptNumber: testResultValue.attemptNumber,
              })
              .from(testResultValue)
              .where(
                and(
                  eq(testResultValue.clubId, clubId),
                  eq(testResultValue.metricDefinitionId, metric.id),
                  isNull(testResultValue.voidedAt),
                  inArray(
                    testResultValue.testResultId,
                    page.items.map((r) => r.id),
                  ),
                ),
              )
              .orderBy(...VALUE_ORDER);

      const items = page.items.map((row) => {
        const own = values.filter((v) => v.testResultId === row.id);
        const [score] = scoreResultMetrics(
          own.map((v) => ({
            metricCode: params.metricCode,
            value: v.value,
            attemptNumber: v.attemptNumber,
          })),
          () => ({ aggregation: row.attemptAggregation, direction: metric.direction }),
        );
        if (score === undefined || row.method === null) {
          throw new Error('listPlayerTestMetric: a listed result has no valid value');
        }
        return {
          testResultId: row.id as never,
          testSessionId: row.testSessionId as never,
          testDefinitionId: row.testDefinitionId as never,
          protocolVersion: row.protocolVersion,
          measuredOn: row.measuredOn,
          value: score.value,
          unit: own[0]?.unit ?? 'n',
          aggregation: score.aggregation,
          attemptCount: score.attemptCount,
          method: row.method,
          deviceId: row.deviceId as never,
          exercise: row.exercise,
        };
      });

      // The comparison covers the whole filtered range, not only the page.
      const measured = await db
        .selectDistinct({
          method: testResult.method,
          protocolVersion: testDefinition.version,
          deviceId: testResult.deviceId,
          exercise: testResult.exercise,
          sameDeviceOnly: sql<boolean>`coalesce((${testDefinition.protocol} -> 'parameters' ->> 'sameDeviceOnly')::boolean, false)`,
        })
        .from(testResult)
        .innerJoin(testDefinition, joinDefinition)
        .where(filters);
      const compared = measured.flatMap((m) =>
        m.method === null
          ? []
          : [
              {
                method: m.method,
                protocolVersion: m.protocolVersion,
                deviceId: m.deviceId,
                exercise: m.exercise,
              },
            ],
      );
      const unique = <T>(list: readonly T[]) => [...new Set(list)];
      return {
        items,
        nextCursor: page.nextCursor,
        comparison: {
          methods: unique(compared.map((m) => m.method)).sort(),
          protocolVersions: unique(compared.map((m) => m.protocolVersion)).sort((a, b) => a - b),
          deviceIds: unique(compared.map((m) => m.deviceId)),
          exercises: unique(compared.map((m) => m.exercise)),
          warnings: testComparisonWarnings(compared, {
            sameDeviceOnly: measured.some((m) => m.sameDeviceOnly),
          }),
        },
      };
    },
  });
}
