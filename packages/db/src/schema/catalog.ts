import {
  PROTOCOL_MEDIA_CAPTION_MAX_LENGTH,
  type CategoryId,
  type PlayerId,
  type SpeedZoneSet,
} from '@sport-performance/domain';
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
import { file } from './files.js';
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
  /**
   * Numeric and categorical settings the scoring depends on (the 30-15 IFT
   * speed progression, the e1RM rep and RIR range, the sprint Vmax gates),
   * copied from the domain defaults when seeded (B-306). Part of the version:
   * changing one means a new protocol version.
   */
  readonly parameters?: Readonly<Record<string, TestProtocolParameter>>;
}

/** A protocol setting: a number, a code, a flag or a small nested record of them. */
export type TestProtocolParameter =
  number | string | boolean | Readonly<Record<string, number | string | boolean>>;

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

/**
 * Images and videos that show how a protocol version is done (B-415, ADR
 * 0067): a `protocol_media` file of the club attached to a test version, with
 * its caption (the text alternative of the image, the description of the
 * video) and its place in the protocol. Removing it archives the row
 * (`archived_at`); the file is kept while an active row points at it, then
 * expires like an unused crest. Staff only (RLS): a video may show a person.
 */
export const testProtocolMedia = pgTable(
  'test_protocol_media',
  {
    ...tenantColumns(),
    testDefinitionId: uuid('test_definition_id').notNull(),
    fileId: uuid('file_id').notNull(),
    caption: text('caption').notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    ...tenantConstraints('test_protocol_media', t),
    tenantReference('test_protocol_media', t.clubId, t.testDefinitionId, testDefinition),
    tenantReference('test_protocol_media', t.clubId, t.fileId, file),
    // A file is shown once per protocol version; the same clip may illustrate several.
    unique('test_protocol_media_file_key').on(t.clubId, t.testDefinitionId, t.fileId),
    index('test_protocol_media_order_idx').on(t.clubId, t.testDefinitionId, t.sortOrder),
    index('test_protocol_media_file_id_idx').on(t.clubId, t.fileId),
    check(
      'test_protocol_media_caption_format',
      sql`${t.caption} = btrim(${t.caption}) and char_length(${t.caption}) between 1 and ${sql.raw(String(PROTOCOL_MEDIA_CAPTION_MAX_LENGTH))}`,
    ),
    check('test_protocol_media_sort_order', sql`${t.sortOrder} between 0 and 999`),
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
    /**
     * Withdrawn before it ever applied (B-322, ADR 0041): ignored when the
     * battery is resolved. An entry in force is closed (`valid_to`) instead.
     */
    archivedAt: timestamptz('archived_at'),
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

/** Longest `reference_value.source` (the contract allows the same). */
export const REFERENCE_SOURCE_MAX_LENGTH = 200;

/**
 * First-team reference values (B-321, `FirstTeamReference` in the domain):
 * position-specific, line-specific or for the whole squad. A new period is a
 * new row (new `valid_from`); a typo is corrected in place and a wrong row is
 * archived (ADR 0040). At most one active reference per metric, sport, sex,
 * scope and `valid_from`.
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
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    ...tenantConstraints('reference_value', t),
    tenantReference('reference_value', t.clubId, t.metricDefinitionId, metricDefinition),
    tenantReference('reference_value', t.clubId, t.positionId, position),
    tenantReferenceIndex('reference_value', t.clubId, t.positionId),
    index('reference_value_lookup_idx').on(t.clubId, t.metricDefinitionId, t.sport, t.sex),
    check('reference_value_value_finite', finite(t.value)),
    check('reference_value_one_scope', sql`num_nonnulls(${t.positionId}, ${t.lineCode}) <= 1`),
    check(
      'reference_value_line_code_format',
      sql`${t.lineCode} is null or ${t.lineCode} ~ '^[a-z][a-z0-9_]*$'`,
    ),
    check(
      'reference_value_source_format',
      sql`${t.source} = btrim(${t.source}) and ${t.source} <> '' and char_length(${t.source}) <= ${sql.raw(String(REFERENCE_SOURCE_MAX_LENGTH))}`,
    ),
    // One active reference per metric, sport, sex, scope and start date (ADR 0040).
    uniqueIndex('reference_value_active_key')
      .on(
        t.clubId,
        t.metricDefinitionId,
        t.sport,
        t.sex,
        sql`coalesce(${t.positionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        sql`coalesce(${t.lineCode}, '')`,
        t.validFrom,
      )
      .where(sql`${t.archivedAt} is null`),
  ],
);

/**
 * Speed zones with scope and validity (B-209, `SpeedZoneConfig` in the
 * domain). `zone_set` is a `SpeedZoneSet`, validated by the domain before it
 * is written. Changing zones in force closes the row and opens a new one.
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
    /** Withdrawn before it ever applied (ADR 0041); a config in force is closed instead. */
    archivedAt: timestamptz('archived_at'),
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
