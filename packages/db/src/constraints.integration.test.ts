import type { ClubId, LocalDate, PlayerId } from '@sport-performance/domain';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alert,
  alertRule,
  anthroMeasurement,
  category,
  clubBranch,
  club,
  membership,
  metricDefinition,
  participation,
  player,
  playerCategory,
  referenceValue,
  speedZoneConfig,
  staffAssignment,
  testDefinition,
  testResult,
  testResultValue,
  trainingSession,
  user,
  wellness,
} from './schema/index.js';
import {
  createMigratedDatabase,
  hasDatabase,
  pgErrorOf,
  type MigratedTestDatabase,
  must,
} from './testing/database.js';

const day = (value: string) => value as LocalDate;

describe.skipIf(!hasDatabase)('schema constraints (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let clubA: ClubId;
  let clubB: ClubId;
  let playerA: PlayerId;
  let playerB: PlayerId;
  let cmjA: string;
  let cmjHeightA: string;
  const evaluatorId = 'user-evaluator';

  beforeAll(async () => {
    t = await createMigratedDatabase();
    const { db } = t;
    await db.insert(user).values({ id: evaluatorId, name: 'Evaluadora', email: 'eva@example.com' });
    const clubs = await db
      .insert(club)
      .values([
        { slug: 'orc', name: 'Olivos Rugby Club', shortName: 'ORC' },
        { slug: 'other-club', name: 'Otro club', shortName: 'OC' },
      ])
      .returning({ id: club.id });
    clubA = must(clubs[0]).id;
    clubB = must(clubs[1]).id;
    // Every category hangs from a branch of its club (B-313).
    await db.insert(clubBranch).values([
      { clubId: clubA, sport: 'rugby', sex: 'male' },
      { clubId: clubB, sport: 'rugby', sex: 'male' },
    ]);

    const players = await db
      .insert(player)
      .values([
        {
          clubId: clubA,
          firstName: 'Juan',
          lastName: 'Pérez',
          birthDate: day('2011-05-04'),
          sex: 'male',
          sport: 'rugby',
          joinedOn: day('2024-03-01'),
        },
        {
          clubId: clubB,
          firstName: 'Ana',
          lastName: 'Gómez',
          birthDate: day('2010-01-20'),
          sex: 'female',
          sport: 'rugby',
          joinedOn: day('2024-03-01'),
        },
      ])
      .returning({ id: player.id });
    playerA = must(players[0]).id;
    playerB = must(players[1]).id;

    const [definition] = await db
      .insert(testDefinition)
      .values({
        clubId: clubA,
        code: 'cmj',
        version: 1,
        attemptCount: 3,
        validFrom: day('2026-01-01'),
      })
      .returning({ id: testDefinition.id });
    cmjA = must(definition).id;
    const [metric] = await db
      .insert(metricDefinition)
      .values({
        clubId: clubA,
        code: 'cmj_height_cm',
        unit: 'cm',
        source: 'test',
        direction: 'higher_is_better',
        testCode: 'cmj',
        isCanonical: true,
      })
      .returning({ id: metricDefinition.id });
    cmjHeightA = must(metric).id;
  });

  afterAll(async () => {
    await t.close();
  });

  it('round-trips local dates as strings and instants as Dates', async () => {
    const [row] = await t.db
      .select({ birthDate: player.birthDate, createdAt: player.createdAt })
      .from(player)
      .where(eq(player.id, playerA));
    expect(row?.birthDate).toBe('2011-05-04');
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it('rejects a reference to another club through the composite foreign keys', async () => {
    const error = await pgErrorOf(
      t.db.insert(testResult).values({
        clubId: clubA,
        playerId: playerB,
        testDefinitionId: cmjA,
        measuredOn: day('2026-02-10'),
        status: 'done',
        method: 'video',
      }),
    );
    expect(error).toEqual({ code: '23503', constraint: 'test_result_player_id_fkey' });
  });

  it('requires club_id on club tables', async () => {
    const error = await pgErrorOf(
      t.pool.query(
        `insert into player (first_name, last_name, birth_date, sex, sport, joined_on)
         values ('Sin', 'Club', '2011-01-01', 'male', 'rugby', '2024-01-01')`,
      ),
    );
    expect(error.code).toBe('23502');
  });

  it('keeps client_uuid unique per club, not globally', async () => {
    const clientUuid = '0b8a6a8e-4f37-4a43-9d9a-7f9a4a7f2c11';
    const base = {
      sport: 'rugby' as const,
      sex: 'male' as const,
      ageBandCode: 'm15',
      defaultStage: 'development' as const,
      clientUuid,
    };
    await t.db.insert(category).values({ ...base, clubId: clubA, name: 'M15 A' });
    await t.db.insert(category).values({ ...base, clubId: clubB, name: 'M15 B' });
    const error = await pgErrorOf(
      t.db.insert(category).values({ ...base, clubId: clubA, name: 'M15 C' }),
    );
    expect(error).toEqual({ code: '23505', constraint: 'category_club_id_client_uuid_key' });
  });

  describe('test results', () => {
    const base = () => ({
      clubId: clubA,
      playerId: playerA,
      testDefinitionId: cmjA,
      measuredOn: day('2026-02-10'),
    });

    it('stores a done result with method, evaluator and several attempts', async () => {
      const [result] = await t.db
        .insert(testResult)
        .values({
          ...base(),
          status: 'done',
          method: 'video',
          evaluatorId,
          conditions: { surface: 'grass', standardizedWarmUp: true },
        })
        .returning({ id: testResult.id });
      const attempts = [41.2, 43.5, 42.1].map((value, index) => ({
        clubId: clubA,
        testResultId: must(result).id,
        metricDefinitionId: cmjHeightA,
        attemptNumber: index + 1,
        value,
        unit: 'cm' as const,
      }));
      await t.db.insert(testResultValue).values(attempts);
      const stored = await t.db
        .select({ value: testResultValue.value })
        .from(testResultValue)
        .where(eq(testResultValue.testResultId, must(result).id));
      expect(stored.map((s) => s.value).sort()).toEqual([41.2, 42.1, 43.5]);

      // At most one valid result-level value per metric; voided ones do not count.
      const resultLevel = {
        clubId: clubA,
        testResultId: must(result).id,
        metricDefinitionId: cmjHeightA,
        value: 43.5,
        unit: 'cm' as const,
      };
      const [first] = await t.db
        .insert(testResultValue)
        .values(resultLevel)
        .returning({ id: testResultValue.id });
      const duplicate = await pgErrorOf(t.db.insert(testResultValue).values(resultLevel));
      expect(duplicate.constraint).toBe('test_result_value_result_level_key');
      await t.db
        .update(testResultValue)
        .set({ voidedAt: new Date(), voidedBy: evaluatorId, voidReason: 'typo' })
        .where(eq(testResultValue.id, must(first).id));
      await t.db.insert(testResultValue).values(resultLevel);
    });

    it('rejects NaN values', async () => {
      const [result] = await t.db
        .insert(testResult)
        .values({ ...base(), status: 'done', method: 'manual' })
        .returning({ id: testResult.id });
      const error = await pgErrorOf(
        t.db.insert(testResultValue).values({
          clubId: clubA,
          testResultId: must(result).id,
          metricDefinitionId: cmjHeightA,
          value: Number.NaN,
          unit: 'cm',
        }),
      );
      expect(error.constraint).toBe('test_result_value_value_finite');
    });

    describe('append-only values (ADR 0015)', () => {
      const insertValue = async () => {
        const [result] = await t.db
          .insert(testResult)
          .values({ ...base(), status: 'done', method: 'manual' })
          .returning({ id: testResult.id });
        const [row] = await t.db
          .insert(testResultValue)
          .values({
            clubId: clubA,
            testResultId: must(result).id,
            metricDefinitionId: cmjHeightA,
            attemptNumber: 1,
            value: 40,
            unit: 'cm',
            createdBy: evaluatorId,
          })
          .returning({ id: testResultValue.id });
        return must(row).id;
      };

      it.each([
        ['value', `value = 41`],
        ['unit', `unit = 'mm'`],
        ['metric', `metric_definition_id = gen_random_uuid()`],
        ['attempt number', `attempt_number = 2`],
        ['author', `created_by = 'someone-else'`],
      ])('rejects changing the %s', async (_label, assignment) => {
        const id = await insertValue();
        const error = await pgErrorOf(
          t.pool.query(`update test_result_value set ${assignment} where id = $1`, [id]),
        );
        expect(error).toEqual({ code: '23514', constraint: 'test_result_value_append_only' });
      });

      it('allows voiding once, with its author, and never restoring', async () => {
        const id = await insertValue();
        const noAuthor = await pgErrorOf(
          t.pool.query(
            `update test_result_value set voided_at = now(), void_reason = 'typo' where id = $1`,
            [id],
          ),
        );
        expect(noAuthor).toEqual({ code: '23514', constraint: 'test_result_value_void_author' });
        await t.pool.query(
          `update test_result_value set voided_at = now(), voided_by = $2, void_reason = 'typo',
             updated_by = $2 where id = $1`,
          [id, evaluatorId],
        );
        const restore = await pgErrorOf(
          t.pool.query(
            `update test_result_value set voided_at = null, voided_by = null, void_reason = null
             where id = $1`,
            [id],
          ),
        );
        expect(restore.constraint).toBe('test_result_value_void_final');
        const reword = await pgErrorOf(
          t.pool.query(`update test_result_value set void_reason = 'other' where id = $1`, [id]),
        );
        expect(reword.constraint).toBe('test_result_value_void_final');
      });

      it('keeps voided_by NULL on valid values', async () => {
        const id = await insertValue();
        const error = await pgErrorOf(
          t.pool.query(`update test_result_value set voided_by = $2 where id = $1`, [
            id,
            evaluatorId,
          ]),
        );
        expect(error.constraint).toBe('test_result_value_voided_by');
      });

      it('lets a user account be deleted after authoring and voiding values', async () => {
        await t.db
          .insert(user)
          .values({ id: 'user-leaving', name: 'Se va', email: 'leaving@example.com' });
        const id = await insertValue();
        await t.pool.query(`update test_result_value set created_by = null where id = $1`, [id]);
        await t.pool.query(
          `update test_result_value set voided_at = now(), voided_by = 'user-leaving',
             void_reason = 'typo', updated_by = 'user-leaving' where id = $1`,
          [id],
        );
        await t.db.delete(user).where(eq(user.id, 'user-leaving'));
        const [row] = await t.db
          .select({ voidedBy: testResultValue.voidedBy, voidedAt: testResultValue.voidedAt })
          .from(testResultValue)
          .where(eq(testResultValue.id, id));
        expect(row?.voidedBy).toBeNull();
        expect(row?.voidedAt).toBeInstanceOf(Date);
      });

      it('allows two attempts with the same number (two evaluators offline)', async () => {
        const id = await insertValue();
        const [first] = await t.db.select().from(testResultValue).where(eq(testResultValue.id, id));
        await t.db.insert(testResultValue).values({
          clubId: clubA,
          testResultId: must(first).testResultId,
          metricDefinitionId: cmjHeightA,
          attemptNumber: 1,
          value: 40.5,
          unit: 'cm',
        });
      });
    });

    it('requires the unit of the metric when a value is written', async () => {
      const [result] = await t.db
        .insert(testResult)
        .values({ ...base(), status: 'done', method: 'manual' })
        .returning({ id: testResult.id });
      const value = await pgErrorOf(
        t.db.insert(testResultValue).values({
          clubId: clubA,
          testResultId: must(result).id,
          metricDefinitionId: cmjHeightA,
          value: 400,
          unit: 'mm',
        }),
      );
      expect(value).toEqual({
        code: '23514',
        constraint: 'test_result_value_unit_matches_metric',
      });
      const reference = await pgErrorOf(
        t.db.insert(referenceValue).values({
          clubId: clubA,
          metricDefinitionId: cmjHeightA,
          sport: 'rugby',
          sex: 'male',
          value: 0.45,
          unit: 'm',
          validFrom: day('2026-01-01'),
          source: 'test',
        }),
      );
      expect(reference.constraint).toBe('reference_value_unit_matches_metric');
    });

    it('stores a not-done result with its reason', async () => {
      await t.db
        .insert(testResult)
        .values({ ...base(), status: 'not_done', notDoneReason: 'not_applicable_to_stage' });
    });

    it.each([
      ['done without method', { status: 'done' as const }, 'test_result_status'],
      [
        'done with a not-done reason',
        { status: 'done' as const, method: 'video' as const, notDoneReason: 'absent' as const },
        'test_result_status',
      ],
      ['not done without reason', { status: 'not_done' as const }, 'test_result_status'],
      [
        'other without a note',
        { status: 'not_done' as const, notDoneReason: 'other' as const, notDoneNote: '  ' },
        'test_result_other_reason_note',
      ],
    ])('rejects %s', async (_label, values, constraint) => {
      const error = await pgErrorOf(t.db.insert(testResult).values({ ...base(), ...values }));
      expect(error).toEqual({ code: '23514', constraint });
    });
  });

  it('enforces wellness items: 1–5, exactly item_count answered, one per day', async () => {
    const row = {
      clubId: clubA,
      playerId: playerA,
      localDate: day('2026-03-02'),
      itemCount: 3,
      sleep: 4,
      fatigue: 3,
      mood: 5,
    };
    await t.db.insert(wellness).values(row);
    expect((await pgErrorOf(t.db.insert(wellness).values(row))).code).toBe('23505');
    const outOfRange = await pgErrorOf(
      t.db.insert(wellness).values({ ...row, localDate: day('2026-03-03'), sleep: 6 }),
    );
    expect(outOfRange.constraint).toBe('wellness_sleep');
    const missing = await pgErrorOf(
      t.db.insert(wellness).values({ ...row, localDate: day('2026-03-04'), itemCount: 5 }),
    );
    expect(missing.constraint).toBe('wellness_answered_items');
  });

  it('computes sRPE as RPE × minutes and rejects load for absent players', async () => {
    const [session] = await t.db
      .insert(trainingSession)
      .values({
        clubId: clubA,
        sport: 'rugby',
        kind: 'training',
        startsAt: new Date('2026-03-02T21:00:00Z'),
        localDate: day('2026-03-02'),
      })
      .returning({ id: trainingSession.id });
    const [row] = await t.db
      .insert(participation)
      .values({
        clubId: clubA,
        trainingSessionId: must(session).id,
        playerId: playerA,
        status: 'full',
        minutes: 75,
        rpe: 7,
        rpeReportedAt: new Date(),
      })
      .returning({ srpeAu: participation.srpeAu });
    expect(row?.srpeAu).toBe(525);

    const error = await pgErrorOf(
      t.db
        .update(participation)
        .set({ status: 'absent' })
        .where(eq(participation.trainingSessionId, must(session).id)),
    );
    expect(error.constraint).toBe('participation_absent_has_no_load');
  });

  it('bumps updated_at on every update through the trigger', async () => {
    const [before] = await t.db
      .select({ updatedAt: player.updatedAt })
      .from(player)
      .where(eq(player.id, playerA));
    await t.pool.query(`select pg_sleep(0.01)`);
    await t.pool.query(`update player set last_name = 'Pérez García' where id = $1`, [playerA]);
    const [after] = await t.db
      .select({ updatedAt: player.updatedAt })
      .from(player)
      .where(eq(player.id, playerA));
    expect(must(after).updatedAt.getTime()).toBeGreaterThan(must(before).updatedAt.getTime());
  });

  it('rejects non-finite or non-positive derived maturation values', async () => {
    const row = {
      clubId: clubA,
      playerId: playerA,
      measuredOn: day('2026-02-10'),
      heightCm: 160,
    };
    for (const values of [
      { phvOffsetYears: Number.POSITIVE_INFINITY, maturityOffsetEquation: 'mirwald_2002' as const },
      { adultHeightPct: Number.NaN },
      { adultHeightPct: 0 },
    ]) {
      const error = await pgErrorOf(t.db.insert(anthroMeasurement).values({ ...row, ...values }));
      expect(error.constraint).toBe('anthro_measurement_derived_finite');
    }
    // A late measurement may exceed a low prediction.
    await t.db.insert(anthroMeasurement).values({ ...row, adultHeightPct: 101.2 });
  });

  it('keeps emails unique regardless of case', async () => {
    await t.db.insert(user).values({ id: 'user-case-1', name: 'Ana', email: 'ana@example.com' });
    const error = await pgErrorOf(
      t.db.insert(user).values({ id: 'user-case-2', name: 'Ana', email: 'Ana@Example.com' }),
    );
    expect(error).toEqual({ code: '23505', constraint: 'user_email_lower_key' });
  });

  it('allows one active membership per user, club and role', async () => {
    await t.db.insert(user).values({ id: 'user-coach', name: 'Coach', email: 'coach@example.com' });
    const row = { clubId: clubA, userId: 'user-coach', role: 'coach' as const };
    const [first] = await t.db.insert(membership).values(row).returning({ id: membership.id });
    // Another role in the same club is fine (a coach who is also a parent).
    await t.db.insert(membership).values({ ...row, role: 'parent' });
    expect((await pgErrorOf(t.db.insert(membership).values(row))).constraint).toBe(
      'membership_active_role_key',
    );
    // Once the membership is closed, the user can be invited again.
    await t.db
      .update(membership)
      .set({ endedAt: sql`now() + interval '1 second'` })
      .where(eq(membership.id, must(first).id));
    await t.db.insert(membership).values(row);

    const assignment = await pgErrorOf(
      t.db.insert(staffAssignment).values({
        clubId: clubA,
        membershipId: must(first).id,
        validFrom: day('2026-03-01'),
      }),
    );
    expect(assignment.constraint).toBe('staff_assignment_one_target');

    // An assignment ended before it started keeps an empty range (ADR 0034); an inverted one is rejected.
    const target = { clubId: clubA, membershipId: must(first).id, sport: 'rugby' as const };
    await t.db
      .insert(staffAssignment)
      .values({ ...target, validFrom: day('2026-03-01'), validTo: day('2026-03-01') });
    const inverted = await pgErrorOf(
      t.db
        .insert(staffAssignment)
        .values({ ...target, validFrom: day('2026-03-02'), validTo: day('2026-03-01') }),
    );
    expect(inverted.constraint).toBe('staff_assignment_validity');
  });

  it('rejects inverted validity ranges', async () => {
    const [cat] = await t.db
      .insert(category)
      .values({
        clubId: clubA,
        sport: 'rugby',
        sex: 'male',
        ageBandCode: 'm14',
        name: 'M14',
        defaultStage: 'foundation',
      })
      .returning({ id: category.id });
    const error = await pgErrorOf(
      t.db.insert(playerCategory).values({
        clubId: clubA,
        playerId: playerA,
        categoryId: must(cat).id,
        validFrom: day('2026-03-01'),
        validTo: day('2026-03-01'),
      }),
    );
    expect(error.constraint).toBe('player_category_validity');
  });

  it('keeps the speed zone kind consistent with the zone set', async () => {
    const error = await pgErrorOf(
      t.db.insert(speedZoneConfig).values({
        clubId: clubA,
        kind: 'relative',
        zoneSet: {
          kind: 'absolute',
          highSpeedZoneCode: 'hsr',
          zones: [
            { code: 'low', minSpeedMs: 0 },
            { code: 'hsr', minSpeedMs: 5.5 },
          ],
        },
        validFrom: day('2026-01-01'),
      }),
    );
    expect(error.constraint).toBe('speed_zone_config_kind_matches');
  });

  it('stores alert rules as data and one alert per rule, player and day', async () => {
    const [rule] = await t.db
      .insert(alertRule)
      .values({
        clubId: clubA,
        code: 'wellness_low',
        kind: 'wellness_low',
        sports: ['rugby'],
        params: { warningBelowScore: 3.3, criticalBelowScore: 3.0 },
      })
      .returning({ id: alertRule.id });
    const row = {
      clubId: clubA,
      alertRuleId: must(rule).id,
      playerId: playerA,
      kind: 'wellness_low' as const,
      severity: 'warning' as const,
      localDate: day('2026-03-02'),
      observedOn: day('2026-03-02'),
      values: { score: 3.2, threshold: 3.3 },
    };
    await t.db.insert(alert).values(row);
    expect((await pgErrorOf(t.db.insert(alert).values(row))).code).toBe('23505');
    const badCode = await pgErrorOf(
      t.db.insert(alertRule).values({
        clubId: clubA,
        code: 'Player Load',
        kind: 'acwr_high',
        params: { warningAboveRatio: 1.3, criticalAboveRatio: 1.4, minHistoryDays: 28 },
      }),
    );
    expect(badCode.constraint).toBe('alert_rule_code_format');
  });

  it('rejects metric codes named after "PlayerLoad"', async () => {
    const error = await pgErrorOf(
      t.db.insert(metricDefinition).values({
        clubId: clubA,
        code: 'player_load_au',
        unit: 'au',
        source: 'field',
        direction: 'neutral',
      }),
    );
    expect(error.constraint).toBe('metric_definition_code_format');
  });
});
