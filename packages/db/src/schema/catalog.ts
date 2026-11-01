import type { CategoryId, PlayerId, SpeedZoneSet } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { codeCheck, finite, validityCheck } from './checks.js';
import { localDate, timestamptz } from './columns.js';
import {
  attemptAggregationEnum,
  deviceKindEnum,
  measurementMethodEnum,
  metricDirectionEnum,
  metricSourceEnum,
  sexEnum,
  speedZoneKindEnum,
  sportEnum,
  stageEnum,
  unitEnum,
} from './enums.js';
import { category, position } from './organization.js';
import { player } from './players.js';
import {
  tenantColumns,
  tenantConstraints,
  tenantReference,
  tenantReferenceIndex,
} from './tenant.js';

/**
 * Per-club configuration and dictionaries. Defaults are seeded per club
 * (B-306) from the domain (`CANONICAL_METRICS`, `DEFAULT_ALERT_RULES`,
 * `DEFAULT_SPEED_ZONE_SETS`) and edited by the club (B-322); nothing here is
 * hardcoded in application code.
 */

/**
 * Metric dictionary (principle 1). `code` is the canonical code
 * (`hsr_abs_m`); `catapult_aliases` maps OpenField column names
 * ("Total Distance", "HSR Distance") to it for imports (B-601).
 */
export const metricDefinition = pgTable(
  'metric_definition',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    unit: unitEnum('unit').notNull(),
    source: metricSourceEnum('source').notNull(),
    direction: metricDirectionEnum('direction').notNull(),
    /** Test that produces it, for `source = 'test'`. */
    testCode: text('test_code'),
    /** Sports where it applies; `NULL` means every sport. */
    sports: sportEnum('sports').array(),
    /** Short definition for the staff glossary. UI labels live in i18n. */
    description: text('description'),
    catapultAliases: text('catapult_aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Seeded from `CANONICAL_METRICS`; canonical codes keep their definition. */
    isCanonical: boolean('is_canonical').notNull().default(false),
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    ...tenantConstraints('metric_definition', t),
    unique('metric_definition_club_id_code_key').on(t.clubId, t.code),
    codeCheck('metric_definition_code_format', t.code),
    check('metric_definition_test_code', sql`(${t.source} = 'test') = (${t.testCode} is not null)`),
    check(
      'metric_definition_sports_not_empty',
      sql`${t.sports} is null or cardinality(${t.sports}) > 0`,
    ),
  ],
);

/** Protocol text and settings of a test version, shown to the evaluator. */
export interface TestProtocol {
  /** Summary of the protocol (warm-up, attempts, rest). */
  readonly summary?: string;
  readonly steps?: readonly string[];
  /** Rest between attempts, in seconds. */
  readonly restBetweenAttemptsS?: number;
  readonly equipment?: readonly string[];
}

/**
 * One **version** of a test protocol (principle 4: the protocol version is
 * stored with every result). Changing a protocol adds a version; results
 * keep pointing to the version they were measured with.
 */
export const testDefinition = pgTable(
  'test_definition',
  {
    ...tenantColumns(),
    /** Test code (`cmj`, `sprint_40`), shared by every version. */
    code: text('code').notNull(),
    version: integer('version').notNull(),
    /** Sports where it applies; `NULL` means every sport. */
    sports: sportEnum('sports').array(),
    attemptCount: smallint('attempt_count').notNull().default(1),
    attemptAggregation: attemptAggregationEnum('attempt_aggregation').notNull().default('best'),
    /** Maximal loaded test: never for M13/M14 (`maximalLoadTestsAllowed`, principle 3). */
    maximalLoad: boolean('maximal_load').notNull().default(false),
    protocol: jsonb('protocol').notNull().default({}).$type<TestProtocol>(),
    validFrom: localDate('valid_from').notNull(),
    validTo: localDate('valid_to'),
  },
  (t) => [
    ...tenantConstraints('test_definition', t),
    unique('test_definition_club_id_code_version_key').on(t.clubId, t.code, t.version),
    codeCheck('test_definition_code_format', t.code),
    check('test_definition_version_positive', sql`${t.version} >= 1`),
    check('test_definition_attempt_count_positive', sql`${t.attemptCount} >= 1`),
    check(
      'test_definition_sports_not_empty',
      sql`${t.sports} is null or cardinality(${t.sports}) > 0`,
    ),
    validityCheck('test_definition_validity', t.validFrom, t.validTo),
  ],
);

/** Metrics a test version produces (a sprint gives t10, t20, t40 and Vmax). */
export const testDefinitionMetric = pgTable(
  'test_definition_metric',
  {
    ...tenantColumns(),
    testDefinitionId: uuid('test_definition_id').notNull(),
    metricDefinitionId: uuid('metric_definition_id').notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    /** Computed from other metrics of the result (Vmax, asymmetry), not entered. */
    isDerived: boolean('is_derived').notNull().default(false),
  },
  (t) => [
    ...tenantConstraints('test_definition_metric', t),
    tenantReference(
      'test_definition_metric',
      t.clubId,
      t.testDefinitionId,
      testDefinition,
    ).onDelete('cascade'),
    tenantReference('test_definition_metric', t.clubId, t.metricDefinitionId, metricDefinition),
    tenantReferenceIndex('test_definition_metric', t.clubId, t.metricDefinitionId),
    unique('test_definition_metric_key').on(t.clubId, t.testDefinitionId, t.metricDefinitionId),
  ],
);

/**
 * Which tests a group does and when (B-322, "Batería de tests"): in which
 * windows (`windows`, 1 = V1 … 4 = V4) and/or continuously every N weeks
 * (anthropometry every 4–6 weeks, weekly CMJ). Scope narrows by `sex`,
 * `stage` and `category_id`; `NULL` means any.
 */
export const batteryConfig = pgTable(
  'battery_config',
  {
    ...tenantColumns(),
    sport: sportEnum('sport').notNull(),
    sex: sexEnum('sex'),
    stage: stageEnum('stage'),
    categoryId: uuid('category_id').$type<CategoryId>(),
    testCode: text('test_code').notNull(),
    windows: smallint('windows')
      .array()
      .notNull()
      .default(sql`'{}'::smallint[]`),
    cadenceWeeksMin: smallint('cadence_weeks_min'),
    cadenceWeeksMax: smallint('cadence_weeks_max'),
    validFrom: localDate('valid_from').notNull(),
    validTo: localDate('valid_to'),
  },
  (t) => [
    ...tenantConstraints('battery_config', t),
    tenantReference('battery_config', t.clubId, t.categoryId, category),
    tenantReferenceIndex('battery_config', t.clubId, t.categoryId),
    index('battery_config_scope_idx').on(t.clubId, t.sport, t.testCode),
    codeCheck('battery_config_test_code_format', t.testCode),
    check(
      'battery_config_windows',
      sql`${t.windows} <@ '{1,2,3,4}'::smallint[] and array_position(${t.windows}, null) is null`,
    ),
    check(
      'battery_config_cadence',
      sql`(${t.cadenceWeeksMin} is null) = (${t.cadenceWeeksMax} is null) and (${t.cadenceWeeksMin} is null or (${t.cadenceWeeksMin} >= 1 and ${t.cadenceWeeksMax} >= ${t.cadenceWeeksMin}))`,
    ),
    check(
      'battery_config_scheduled',
      sql`cardinality(${t.windows}) > 0 or ${t.cadenceWeeksMin} is not null`,
    ),
    validityCheck('battery_config_validity', t.validFrom, t.validTo),
  ],
);

/**
 * First-team reference values (B-321, `FirstTeamReference` in the domain):
 * position-specific, line-specific or for the whole squad. References are
 * replaced (new `valid_from`), never edited.
 */
export const referenceValue = pgTable(
  'reference_value',
  {
    ...tenantColumns(),
    metricDefinitionId: uuid('metric_definition_id').notNull(),
    sport: sportEnum('sport').notNull(),
    sex: sexEnum('sex').notNull(),
    positionId: uuid('position_id'),
    lineCode: text('line_code'),
    value: doublePrecision('value').notNull(),
    /** Equal to `metric_definition.unit` when written (trigger, migration `0003`). */
    unit: unitEnum('unit').notNull(),
    method: measurementMethodEnum('method'),
    validFrom: localDate('valid_from').notNull(),
    /** Where it comes from ("Catapult 2026 preseason"), shown in the tooltip. */
    source: text('source').notNull(),
  },
  (t) => [
    ...tenantConstraints('reference_value', t),
    tenantReference('reference_value', t.clubId, t.metricDefinitionId, metricDefinition),
    tenantReference('reference_value', t.clubId, t.positionId, position),
    tenantReferenceIndex('reference_value', t.clubId, t.positionId),
    index('reference_value_lookup_idx').on(t.clubId, t.metricDefinitionId, t.sport, t.sex),
    check('reference_value_value_finite', finite(t.value)),
    check('reference_value_one_scope', sql`num_nonnulls(${t.positionId}, ${t.lineCode}) <= 1`),
  ],
);

/**
 * Speed zones with scope and validity (B-209, `SpeedZoneConfig` in the
 * domain). `zone_set` is a `SpeedZoneSet`, validated by the domain before it
 * is written. Changing zones closes the row and opens a new one.
 */
export const speedZoneConfig = pgTable(
  'speed_zone_config',
  {
    ...tenantColumns(),
    sport: sportEnum('sport'),
    sex: sexEnum('sex'),
    playerId: uuid('player_id').$type<PlayerId>(),
    kind: speedZoneKindEnum('kind').notNull(),
    zoneSet: jsonb('zone_set').notNull().$type<SpeedZoneSet>(),
    validFrom: localDate('valid_from').notNull(),
    validTo: localDate('valid_to'),
  },
  (t) => [
    ...tenantConstraints('speed_zone_config', t),
    tenantReference('speed_zone_config', t.clubId, t.playerId, player),
    tenantReferenceIndex('speed_zone_config', t.clubId, t.playerId),
    index('speed_zone_config_lookup_idx').on(t.clubId, t.kind, t.validFrom),
    check('speed_zone_config_kind_matches', sql`${t.zoneSet} ->> 'kind' = ${t.kind}::text`),
    validityCheck('speed_zone_config_validity', t.validFrom, t.validTo),
  ],
);

/**
 * Club devices: phones and tablets used to measure (the reaction test is only
 * compared on the same device), shared hardware (Phase 2) and pods (Phase 3).
 */
export const device = pgTable(
  'device',
  {
    ...tenantColumns(),
    kind: deviceKindEnum('kind').notNull(),
    label: text('label').notNull(),
    model: text('model'),
    serialNumber: text('serial_number'),
    firmwareVersion: text('firmware_version'),
    retiredAt: timestamptz('retired_at'),
  },
  (t) => [
    ...tenantConstraints('device', t),
    uniqueIndex('device_serial_number_key')
      .on(t.clubId, t.kind, t.serialNumber)
      .where(sql`${t.serialNumber} is not null`),
  ],
);
