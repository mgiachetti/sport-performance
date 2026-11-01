import {
  ALERT_RULE_KINDS,
  ALERT_SEVERITIES,
  ATTEMPT_AGGREGATIONS,
  CONSENT_SIGNERS,
  CONSENT_TYPES,
  EXPOSURE_CONTEXTS,
  MATURITY_OFFSET_EQUATIONS,
  MEASUREMENT_METHODS,
  MEMBERSHIP_ROLES,
  SEXES,
  SPEED_ZONE_KINDS,
  SPORTS,
  STAGES,
  STAGE_BASES,
  STAGE_REASONS,
  TEST_NOT_DONE_REASONS,
  TEST_RESULT_STATUSES,
  UNIT_CODES,
  type MetricDirection,
  type MetricSource,
  type UnitCode,
} from '@sport-performance/domain';
import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Postgres enums (ADR 0017: closed enumerations, extended by migration).
 *
 * **Single source of truth.** Every vocabulary that exists in
 * `@sport-performance/domain` is built from the domain constant, so adding a
 * value there and running `pnpm --filter @sport-performance/db db:generate`
 * produces the `ALTER TYPE … ADD VALUE` migration; an integration test checks
 * that the migrated database matches the domain.
 *
 * The vocabularies at the end of this file only exist in the database for now
 * (no domain logic depends on them). Their constants are exported so the API
 * can reuse them; when the domain needs one, move the constant to the domain
 * and import it here: the values, and therefore the migrations, stay the same.
 */

/** Asserts at compile time that a tuple lists every member of a union. */
type Exhaustive<Union extends string, Tuple extends readonly string[]> = [
  Exclude<Union, Tuple[number]>,
] extends [never]
  ? Tuple
  : never;

function exhaustive<Union extends string>() {
  return <const Tuple extends readonly [Union, ...Union[]]>(
    values: Tuple & Exhaustive<Union, Tuple>,
  ): Tuple => values;
}

// ---------------------------------------------------------------------------
// Vocabularies owned by @sport-performance/domain.
// ---------------------------------------------------------------------------

export const sportEnum = pgEnum('sport', SPORTS);
export const sexEnum = pgEnum('sex', SEXES);
export const stageEnum = pgEnum('stage', STAGES);
export const membershipRoleEnum = pgEnum('membership_role', MEMBERSHIP_ROLES);
export const measurementMethodEnum = pgEnum('measurement_method', MEASUREMENT_METHODS);
export const testResultStatusEnum = pgEnum('test_result_status', TEST_RESULT_STATUSES);
export const testNotDoneReasonEnum = pgEnum('test_not_done_reason', TEST_NOT_DONE_REASONS);
export const attemptAggregationEnum = pgEnum('attempt_aggregation', ATTEMPT_AGGREGATIONS);
export const alertSeverityEnum = pgEnum('alert_severity', ALERT_SEVERITIES);
export const alertRuleKindEnum = pgEnum('alert_rule_kind', ALERT_RULE_KINDS);
export const speedZoneKindEnum = pgEnum('speed_zone_kind', SPEED_ZONE_KINDS);
export const stageBasisEnum = pgEnum('stage_basis', STAGE_BASES);
export const stageReasonEnum = pgEnum('stage_reason', STAGE_REASONS);
/** Kinds of consent (B-312): personal data, image (CMJ videos, photos) and health. */
export const consentTypeEnum = pgEnum('consent_type', CONSENT_TYPES);
/** Who signed a consent: a guardian, or the player once of age (B-311). */
export const consentSignerEnum = pgEnum('consent_signer', CONSENT_SIGNERS);
export const maturityOffsetEquationEnum = pgEnum(
  'maturity_offset_equation',
  MATURITY_OFFSET_EQUATIONS,
);
/** Training or match (`EXPOSURE_CONTEXTS`): drives exposure hours (B-210). */
export const sessionKindEnum = pgEnum('session_kind', EXPOSURE_CONTEXTS);

/** `UNIT_CODES` is derived from the `UNITS` record, hence the tuple cast. */
export const unitEnum = pgEnum('unit', UNIT_CODES as unknown as readonly [UnitCode, ...UnitCode[]]);

/** The domain declares these as union types; the tuples are checked against them. */
export const METRIC_SOURCES = exhaustive<MetricSource>()(['field', 'test', 'load']);
export const metricSourceEnum = pgEnum('metric_source', METRIC_SOURCES);

export const METRIC_DIRECTIONS = exhaustive<MetricDirection>()([
  'higher_is_better',
  'lower_is_better',
  'neutral',
]);
export const metricDirectionEnum = pgEnum('metric_direction', METRIC_DIRECTIONS);

// ---------------------------------------------------------------------------
// Vocabularies that only exist in the database for now.
// ---------------------------------------------------------------------------

/** Relationship of a guardian with the player (B-310). */
export const GUARDIAN_RELATIONSHIPS = ['mother', 'father', 'legal_guardian', 'other'] as const;
export const guardianRelationshipEnum = pgEnum('guardian_relationship', GUARDIAN_RELATIONSHIPS);

/** Whether a parent's height was measured by staff or reported (B-315, Khamis-Roche). */
export const HEIGHT_SOURCES = ['measured', 'reported'] as const;
export const heightSourceEnum = pgEnum('height_source', HEIGHT_SOURCES);

/** Dominant side of a player (foot in rugby, hand in hockey). */
export const DOMINANT_SIDES = ['left', 'right', 'both'] as const;
export const dominantSideEnum = pgEnum('dominant_side', DOMINANT_SIDES);

/** Lifecycle of a scheduled test day. */
export const TEST_SESSION_STATUSES = [
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export const testSessionStatusEnum = pgEnum('test_session_status', TEST_SESSION_STATUSES);

/** Contact level of a drill (B-318), for contact load and return-to-play planning. */
export const CONTACT_LEVELS = ['none', 'controlled', 'full'] as const;
export const contactLevelEnum = pgEnum('contact_level', CONTACT_LEVELS);

/**
 * Participation of a player in a session (B-318). `unavailable` is what the
 * coach sees for a medically blocked player: never the cause (ADR 0008).
 */
export const PARTICIPATION_STATUSES = ['full', 'partial', 'absent', 'unavailable'] as const;
export const participationStatusEnum = pgEnum('participation_status', PARTICIPATION_STATUSES);

/** Shared hardware (Phase 2) and the player pod (Phase 3). */
export const DEVICE_KINDS = [
  'phone',
  'tablet',
  'hr_band',
  'photocell',
  'reaction_lights',
  'dynamometer',
  'pod',
  'gps_vest',
] as const;
export const deviceKindEnum = pgEnum('device_kind', DEVICE_KINDS);

/** Where a field metric value comes from (B-601, F3). */
export const EXTERNAL_METRIC_SOURCES = ['catapult', 'pod', 'hr_band', 'manual'] as const;
export const externalMetricSourceEnum = pgEnum('external_metric_source', EXTERNAL_METRIC_SOURCES);

/** Lifecycle of a generated alert (B-327). */
export const ALERT_STATUSES = ['open', 'acknowledged', 'dismissed'] as const;
export const alertStatusEnum = pgEnum('alert_status', ALERT_STATUSES);
