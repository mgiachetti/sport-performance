import type { CategoryId, PlayerId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { finite } from './checks.js';
import { localDate, timestamptz } from './columns.js';
import {
  maturityOffsetEquationEnum,
  measurementMethodEnum,
  sportEnum,
  testNotDoneReasonEnum,
  testResultStatusEnum,
  testSessionStatusEnum,
  unitEnum,
} from './enums.js';
import { device, metricDefinition, testDefinition } from './catalog.js';
import { category, season } from './organization.js';
import { player } from './players.js';
import {
  tenantColumns,
  tenantConstraints,
  tenantReference,
  tenantReferenceIndex,
} from './tenant.js';

/**
 * Test windows, test days, results and anthropometry (B-317, B-320).
 *
 * Principle 4: every result stores how it was measured (method, evaluator,
 * device, conditions and protocol version through `test_definition_id`).
 */

/** Conditions recorded with a test day or a single result. */
export interface TestConditions {
  readonly surface?: string;
  readonly footwear?: string;
  readonly weather?: string;
  readonly temperatureC?: number;
  readonly standardizedWarmUp?: boolean;
  readonly notes?: string;
}

/** A testing window of a season (V1 February … V4 November), dates set by the club. */
export const testWindow = pgTable(
  'test_window',
  {
    ...tenantColumns(),
    seasonId: uuid('season_id').notNull(),
    /** 1 = V1 … 4 = V4. */
    number: smallint('number').notNull(),
    startsOn: localDate('starts_on').notNull(),
    endsOn: localDate('ends_on').notNull(),
  },
  (t) => [
    ...tenantConstraints('test_window', t),
    tenantReference('test_window', t.clubId, t.seasonId, season).onDelete('cascade'),
    unique('test_window_club_id_season_id_number_key').on(t.clubId, t.seasonId, t.number),
    check('test_window_number', sql`${t.number} between 1 and 4`),
    check('test_window_span', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/** A scheduled test day (offline capable, ADR 0015). */
export const testSession = pgTable(
  'test_session',
  {
    ...tenantColumns(),
    sport: sportEnum('sport').notNull(),
    testWindowId: uuid('test_window_id'),
    categoryId: uuid('category_id').$type<CategoryId>(),
    scheduledOn: localDate('scheduled_on').notNull(),
    status: testSessionStatusEnum('status').notNull().default('scheduled'),
    location: text('location'),
    conditions: jsonb('conditions').notNull().default({}).$type<TestConditions>(),
    notes: text('notes'),
    startedAt: timestamptz('started_at'),
    completedAt: timestamptz('completed_at'),
  },
  (t) => [
    ...tenantConstraints('test_session', t),
    tenantReference('test_session', t.clubId, t.testWindowId, testWindow),
    tenantReferenceIndex('test_session', t.clubId, t.testWindowId),
    tenantReference('test_session', t.clubId, t.categoryId, category),
    tenantReferenceIndex('test_session', t.clubId, t.categoryId),
    index('test_session_scheduled_on_idx').on(t.clubId, t.scheduledOn),
    check(
      'test_session_completion',
      sql`${t.completedAt} is null or (${t.startedAt} is not null and ${t.completedAt} >= ${t.startedAt})`,
    ),
  ],
);

/**
 * A player's result in one test version. `not_done` is a result too, with
 * its reason (B-320): absent, injured (never the diagnosis), not applicable to
 * the stage, or other with a note. The measured values live in
 * `test_result_value`.
 */
export const testResult = pgTable(
  'test_result',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    /** The protocol version (principle 4). */
    testDefinitionId: uuid('test_definition_id').notNull(),
    /** `NULL` for results outside a test day, such as historical imports (B-331). */
    testSessionId: uuid('test_session_id'),
    measuredOn: localDate('measured_on').notNull(),
    status: testResultStatusEnum('status').notNull(),
    /**
     * `injured` is health-adjacent (ADR 0008): the policies and views of #33
     * should show it to coaches as a generic "unavailable", like the
     * availability of `medical`, and keep the exact reason for medical staff.
     */
    notDoneReason: testNotDoneReasonEnum('not_done_reason'),
    notDoneNote: text('not_done_note'),
    /** Required when done; results with different methods are never compared silently. */
    method: measurementMethodEnum('method'),
    /** `NULL` only when unknown (historical imports). */
    evaluatorId: text('evaluator_id').references(() => user.id, { onDelete: 'set null' }),
    deviceId: uuid('device_id'),
    conditions: jsonb('conditions').notNull().default({}).$type<TestConditions>(),
    notes: text('notes'),
  },
  (t) => [
    ...tenantConstraints('test_result', t),
    tenantReference('test_result', t.clubId, t.playerId, player),
    tenantReference('test_result', t.clubId, t.testDefinitionId, testDefinition),
    tenantReference('test_result', t.clubId, t.testSessionId, testSession),
    tenantReference('test_result', t.clubId, t.deviceId, device),
    tenantReferenceIndex('test_result', t.clubId, t.deviceId),
    index('test_result_player_idx').on(t.clubId, t.playerId, t.measuredOn),
    index('test_result_session_idx').on(t.clubId, t.testSessionId),
    index('test_result_definition_idx').on(t.clubId, t.testDefinitionId, t.measuredOn),
    check(
      'test_result_status',
      sql`(${t.status} = 'done' and ${t.notDoneReason} is null and ${t.method} is not null) or (${t.status} = 'not_done' and ${t.notDoneReason} is not null)`,
    ),
    check(
      'test_result_other_reason_note',
      sql`${t.notDoneReason} is distinct from 'other' or char_length(btrim(coalesce(${t.notDoneNote}, ''))) > 0`,
    ),
  ],
);

/**
 * A measured value of a result: several metrics per result (t10, t20, t40)
 * and several attempts per metric. Append-only (ADR 0015): a wrong value is
 * voided (`voided_*`) and a new one added, never edited, so two evaluators
 * offline never conflict and "best of 3" is computed over every valid attempt.
 *
 * `attempt_number` is `NULL` for a result-level value (a single measurement,
 * a derived value such as Vmax, or a historical import); at most one valid
 * result-level value per metric.
 *
 * Duplicate attempt numbers for the same result and metric are allowed on
 * purpose: two evaluators offline may both record "attempt 2", and a unique
 * key would turn that into a sync conflict. Attempts are ordered by
 * `recorded_at`; `attempt_number` is the evaluator's label.
 *
 * Enforced in the database (migration `0003`): after the insert only
 * `voided_*` and `updated_*` can change, a void is final and needs its author
 * (`voided_by` may become `NULL` later only because the author's account is
 * deleted), and `unit` must be the metric's unit when the row is written.
 */
export const testResultValue = pgTable(
  'test_result_value',
  {
    ...tenantColumns(),
    testResultId: uuid('test_result_id').notNull(),
    metricDefinitionId: uuid('metric_definition_id').notNull(),
    attemptNumber: smallint('attempt_number'),
    value: doublePrecision('value').notNull(),
    /** Unit the value was recorded in; equal to `metric_definition.unit` when inserted. */
    unit: unitEnum('unit').notNull(),
    /** When the evaluator recorded it (orders attempts from several devices). */
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
    voidedAt: timestamptz('voided_at'),
    voidedBy: text('voided_by').references(() => user.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
  },
  (t) => [
    ...tenantConstraints('test_result_value', t),
    tenantReference('test_result_value', t.clubId, t.testResultId, testResult).onDelete('cascade'),
    tenantReference('test_result_value', t.clubId, t.metricDefinitionId, metricDefinition),
    index('test_result_value_result_idx').on(t.clubId, t.testResultId),
    index('test_result_value_metric_idx').on(t.clubId, t.metricDefinitionId),
    uniqueIndex('test_result_value_result_level_key')
      .on(t.clubId, t.testResultId, t.metricDefinitionId)
      .where(sql`${t.attemptNumber} is null and ${t.voidedAt} is null`),
    check('test_result_value_value_finite', finite(t.value)),
    check(
      'test_result_value_attempt_number',
      sql`${t.attemptNumber} is null or ${t.attemptNumber} >= 1`,
    ),
    check('test_result_value_void', sql`(${t.voidedAt} is null) = (${t.voidReason} is null)`),
    check('test_result_value_voided_by', sql`${t.voidedAt} is not null or ${t.voidedBy} is null`),
  ],
);

/**
 * Anthropometry (`anthro`). Every value is optional (a day may only weigh),
 * at least one is present. Maturation (offset, % of adult height) is derived
 * by the worker (B-326) with the domain formulas and stored with the equation
 * used, so a recalculation is traceable.
 */
export const anthroMeasurement = pgTable(
  'anthro_measurement',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    testSessionId: uuid('test_session_id'),
    measuredOn: localDate('measured_on').notNull(),
    heightCm: doublePrecision('height_cm'),
    sittingHeightCm: doublePrecision('sitting_height_cm'),
    weightKg: doublePrecision('weight_kg'),
    /** Sum of ISAK skinfolds (performance stage). */
    skinfoldsSumMm: doublePrecision('skinfolds_sum_mm'),
    method: measurementMethodEnum('method').notNull().default('manual'),
    evaluatorId: text('evaluator_id').references(() => user.id, { onDelete: 'set null' }),
    conditions: jsonb('conditions').notNull().default({}).$type<TestConditions>(),
    notes: text('notes'),
    phvOffsetYears: doublePrecision('phv_offset_years'),
    maturityOffsetEquation: maturityOffsetEquationEnum('maturity_offset_equation'),
    /**
     * % of the predicted adult height (Khamis-Roche). Positive, but no upper
     * bound: a late measurement can exceed a low prediction (> 100 %), and
     * how far is a plausibility warning of the domain, not an invariant.
     */
    adultHeightPct: doublePrecision('adult_height_pct'),
    derivedAt: timestamptz('derived_at'),
  },
  (t) => [
    ...tenantConstraints('anthro_measurement', t),
    tenantReference('anthro_measurement', t.clubId, t.playerId, player),
    tenantReference('anthro_measurement', t.clubId, t.testSessionId, testSession),
    tenantReferenceIndex('anthro_measurement', t.clubId, t.testSessionId),
    index('anthro_measurement_player_idx').on(t.clubId, t.playerId, t.measuredOn),
    check(
      'anthro_measurement_has_value',
      sql`num_nonnulls(${t.heightCm}, ${t.sittingHeightCm}, ${t.weightKg}, ${t.skinfoldsSumMm}) >= 1`,
    ),
    check(
      'anthro_measurement_positive',
      sql`(${t.heightCm} is null or (${finite(t.heightCm)} and ${t.heightCm} > 0)) and (${t.sittingHeightCm} is null or (${finite(t.sittingHeightCm)} and ${t.sittingHeightCm} > 0)) and (${t.weightKg} is null or (${finite(t.weightKg)} and ${t.weightKg} > 0)) and (${t.skinfoldsSumMm} is null or (${finite(t.skinfoldsSumMm)} and ${t.skinfoldsSumMm} > 0))`,
    ),
    check(
      'anthro_measurement_sitting_below_height',
      sql`${t.heightCm} is null or ${t.sittingHeightCm} is null or ${t.sittingHeightCm} < ${t.heightCm}`,
    ),
    check(
      'anthro_measurement_maturation',
      sql`(${t.phvOffsetYears} is null) = (${t.maturityOffsetEquation} is null)`,
    ),
    check(
      'anthro_measurement_derived_finite',
      sql`(${t.phvOffsetYears} is null or ${finite(t.phvOffsetYears)}) and (${t.adultHeightPct} is null or (${finite(t.adultHeightPct)} and ${t.adultHeightPct} > 0))`,
    ),
  ],
);
