import type { TestResultInputBody, ValidationIssue } from '@sport-performance/contracts';
import { testResult } from '@sport-performance/db/schema';
import {
  batteryIncludesTest,
  compareLocalDates,
  entryKindsOfTest,
  strengthAssessmentFor,
  testApplicability,
  type ClubId,
  type LocalDate,
  type UserId,
} from '@sport-performance/domain';
import { and, eq } from 'drizzle-orm';
import type { TenantDatabase } from '../../db/database.js';
import { HttpError } from '../../http/errors.js';
import { withDefaultedFields, type DefaultedField } from '../../sync/defaults.js';
import type { RequestPermissions } from '../../http/permissions.js';
import {
  batteryRows,
  deviceExists,
  insertEntries,
  invalid,
  isClubStaff,
  issue,
  loadDefinition,
  loadPlayer,
  recomputeDerived,
  sameDeviceOnly,
  stageContext,
  throwIssues,
  toConditions,
  type DefinitionInfo,
  type IssuePath,
  type PlayerContext,
  type TestSessionRow,
} from './model.js';

/**
 * Recording one result (B-320), shared by `POST /v1/test-results` and the
 * batch of a test day: the permission matrix on the player (with their data
 * consent), the protocol version in effect, the stage rules of the battery
 * (principle 3), how it was measured (principle 4), and the entries scored
 * with the domain formulas.
 */

export interface RecordContext {
  readonly db: TenantDatabase;
  readonly permissions: RequestPermissions;
  readonly clubId: ClubId;
  readonly userId: UserId;
  readonly definitions: Map<string, DefinitionInfo | undefined>;
  readonly players: Map<string, PlayerContext | undefined>;
}

export function recordContext(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  userId: UserId,
): RecordContext {
  return { db, permissions, clubId, userId, definitions: new Map(), players: new Map() };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A result to record; the test day comes apart (the path of a batch, or the body). */
export type ResultInput = DistributiveOmit<TestResultInputBody, 'testSessionId'>;

function inEffect(definition: DefinitionInfo, on: LocalDate): boolean {
  return (
    compareLocalDates(definition.validFrom, on) <= 0 &&
    (definition.validTo === null || compareLocalDates(on, definition.validTo) < 0)
  );
}

/**
 * Validates and inserts one result with its entries. Idempotent by
 * `clientUuid`: a replay returns the result created the first time, without
 * touching its entries.
 */
export async function recordResult(
  ctx: RecordContext,
  input: ResultInput,
  session: TestSessionRow | null,
  path: IssuePath,
): Promise<{ id: string; replayed: boolean }> {
  const { db, clubId } = ctx;
  if (session?.status === 'cancelled') {
    throw new HttpError('conflict', 'The test day is cancelled: restore it to record results');
  }
  const player = await loadPlayer(db, clubId, input.playerId, ctx.players);
  if (player === undefined) {
    invalid(issue([...path, 'playerId'], 'Player not found'));
  }
  await ctx.permissions.authorize('test_result', 'record', { player: player.facts });

  const issues: ValidationIssue[] = [];
  const definition = await loadDefinition(db, clubId, input.testDefinitionId, ctx.definitions);
  if (definition === undefined) {
    invalid(issue([...path, 'testDefinitionId'], 'Test definition not found'));
  }
  const measuredOn = input.measuredOn ?? session?.scheduledOn;
  if (measuredOn === undefined) {
    invalid(issue([...path, 'measuredOn'], 'Required for a result outside a test day'));
  }
  if (!inEffect(definition, measuredOn)) {
    issues.push(
      issue(
        [...path, 'testDefinitionId'],
        'This protocol version is not in effect on measuredOn: use the version of that day',
      ),
    );
  }
  const stage = await stageContext(db, clubId, player.id, measuredOn, session?.categoryId ?? null);
  if (stage === undefined) {
    invalid(...issues, issue([...path, 'playerId'], 'The player is in no category on measuredOn'));
  }
  if (definition.sports !== null && !definition.sports.includes(stage.sport)) {
    issues.push(issue([...path, 'testDefinitionId'], `This test is not part of ${stage.sport}`));
  }
  if (session !== null && session.sport !== stage.sport) {
    issues.push(issue([...path, 'playerId'], 'The player is not in the sport of the test day'));
  }

  const isStrength = definition.code === 'strength';
  if (input.status === 'done') {
    if (entryKindsOfTest(definition.code).length === 0) {
      issues.push(
        issue(
          [...path, 'testDefinitionId'],
          'Anthropometry is recorded as a measurement, not as a test result',
        ),
      );
    } else {
      const inBattery = batteryIncludesTest(
        await batteryRows(db, clubId, stage.sport, definition.code),
        definition.code,
        { sport: stage.sport, sex: player.sex, stage: stage.stage, categoryId: stage.categoryId },
        measuredOn,
      );
      const applicability = testApplicability({
        inBattery,
        maximalLoad: definition.maximalLoad,
        stage: stage.stage,
        ageBand: stage.ageBand,
      });
      if (!applicability.applicable) {
        issues.push(
          issue(
            [...path, 'status'],
            `The test does not apply to the stage of the player (${applicability.reason}): record it as not_done with not_applicable_to_stage`,
            applicability.reason,
          ),
        );
      }
    }
    if (isStrength && input.exercise === undefined) {
      issues.push(issue([...path, 'exercise'], 'Required for a strength result'));
    }
    if (sameDeviceOnly(definition) && input.deviceId === undefined) {
      issues.push(
        issue([...path, 'deviceId'], 'This test is compared only on the same device: record it'),
      );
    }
  } else if (input.notDoneReason === 'other' && input.notDoneNote === undefined) {
    issues.push(issue([...path, 'notDoneNote'], 'Required when the reason is other'));
  }
  if (!isStrength && input.exercise !== undefined) {
    issues.push(issue([...path, 'exercise'], 'Only strength results have an exercise'));
  }

  let evaluatorId: string | null =
    input.evaluatorId === undefined ? (session?.evaluatorId ?? ctx.userId) : input.evaluatorId;
  if (input.evaluatorId === null && input.method !== 'historical') {
    issues.push(
      issue([...path, 'evaluatorId'], 'Only a historical result may have an unknown evaluator'),
    );
  }
  if (input.evaluatorId !== undefined && input.evaluatorId !== null) {
    if (!(await isClubStaff(db, clubId, input.evaluatorId))) {
      issues.push(issue([...path, 'evaluatorId'], 'The evaluator is not on the staff of the club'));
    }
  }
  if (input.evaluatorId === undefined && evaluatorId === ctx.userId) {
    // The caller (a superadmin supporting the club) may not be on the staff: no default.
    if (!(await isClubStaff(db, clubId, ctx.userId))) evaluatorId = null;
  }
  if (input.deviceId !== undefined && !(await deviceExists(db, clubId, input.deviceId))) {
    issues.push(issue([...path, 'deviceId'], 'Device not found'));
  }
  throwIssues(issues);

  const values = {
    clubId,
    ...(input.clientUuid !== undefined && { clientUuid: input.clientUuid }),
    playerId: player.id,
    testDefinitionId: definition.id,
    testSessionId: session?.id ?? null,
    measuredOn,
    status: input.status,
    notDoneReason: input.status === 'not_done' ? input.notDoneReason : null,
    notDoneNote: input.status === 'not_done' ? (input.notDoneNote ?? null) : null,
    method: input.method ?? null,
    evaluatorId,
    deviceId: input.deviceId ?? null,
    exercise: input.exercise ?? null,
    conditions:
      input.conditions === undefined ? (session?.conditions ?? {}) : toConditions(input.conditions),
    notes: input.notes ?? null,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  };
  // Values the caller did not send (the day of the test day, its evaluator, its conditions)
  // are defaults: no clock, so a correction of the result wins over them (ADR 0050).
  const defaulted: DefaultedField[] = [
    ...(input.measuredOn === undefined ? (['test_result.measured_on'] as const) : []),
    ...(input.evaluatorId === undefined ? (['test_result.evaluator_id'] as const) : []),
    ...(input.conditions === undefined ? (['test_result.conditions'] as const) : []),
  ];
  const [inserted] = await withDefaultedFields(db, defaulted, () =>
    db
      .insert(testResult)
      .values(values)
      .onConflictDoNothing({ target: [testResult.clubId, testResult.clientUuid] })
      .returning({ id: testResult.id }),
  );
  if (inserted === undefined) {
    if (input.clientUuid === undefined) {
      throw new Error('recordResult: the insert returned no row without a clientUuid');
    }
    const [existing] = await db
      .select({ id: testResult.id })
      .from(testResult)
      .where(and(eq(testResult.clubId, clubId), eq(testResult.clientUuid, input.clientUuid)));
    // Same client_uuid but invisible to the caller: never reveal it, never duplicate it.
    if (existing === undefined) throw new HttpError('conflict', 'This clientUuid was already used');
    return { id: existing.id, replayed: true };
  }

  if (input.status === 'done') {
    const entryContext = {
      clubId,
      userId: ctx.userId,
      resultId: inserted.id,
      definition,
      strengthAssessment: isStrength ? strengthAssessmentFor(stage.stage, stage.ageBand) : null,
    };
    await insertEntries(db, entryContext, input.entries, [...path, 'entries']);
    await recomputeDerived(db, entryContext, {
      id: inserted.id,
      playerId: player.id,
      measuredOn,
    });
  }
  return { id: inserted.id, replayed: false };
}
