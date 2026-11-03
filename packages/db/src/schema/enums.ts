import {
  ACWR_STATUSES,
  ALERT_EVENT_TYPES,
  ALERT_RULE_KINDS,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ATTEMPT_AGGREGATIONS,
  COEFFICIENT_VERIFICATION_STATUSES,
  CONSENT_SIGNERS,
  CONSENT_TYPES,
  DEVICE_BROWSERS,
  DEVICE_OPERATING_SYSTEMS,
  DOMINANT_SIDES,
  CONTACT_LEVELS,
  EXPOSURE_CONTEXTS,
  FIELD_METRIC_SOURCES,
  HEIGHT_SOURCES,
  FIXTURE_STATUSES,
  FIXTURE_VENUES,
  GUARDIAN_RELATIONSHIPS,
  FILE_KINDS,
  FILE_STATUSES,
  MATURITY_OFFSET_EQUATIONS,
  MEASUREMENT_METHODS,
  MEMBERSHIP_ROLES,
  MONOTONY_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_SKIP_REASONS,
  NOTIFICATION_STATUSES,
  PUSH_PLATFORMS,
  PUSH_TICKET_STATUSES,
  SESSION_CLIENT_TYPES,
  PARENTS,
  PLAYER_LEAVE_REASONS,
  PARTICIPATION_STATUSES,
  SEASON_ROLLOVER_DECISIONS,
  SEASON_ROLLOVER_OUTCOMES,
  SEASON_ROLLOVER_PROPOSALS,
  SEASON_ROLLOVER_STATUSES,
  SEXES,
  SPEED_ZONE_KINDS,
  SPORTS,
  STAGES,
  STAGE_BASES,
  STAGE_REASONS,
  TEST_NOT_DONE_REASONS,
  TEST_RESULT_STATUSES,
  TEST_SESSION_STATUSES,
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
/** How far published coefficients were checked (Khamis-Roche tables, B-203). */
export const coefficientVerificationEnum = pgEnum(
  'coefficient_verification',
  COEFFICIENT_VERIFICATION_STATUSES,
);
/** What an uploaded file is (B-325, ADR 0044). */
export const fileKindEnum = pgEnum('file_kind', FILE_KINDS);
/** Life of an uploaded file: pending upload, ready, deleted (B-325). */
export const fileStatusEnum = pgEnum('file_status', FILE_STATUSES);
/** Training or match (`EXPOSURE_CONTEXTS`): drives exposure hours (B-210). */
export const sessionKindEnum = pgEnum('session_kind', EXPOSURE_CONTEXTS);

/** How a sign-in session travels: cookie (web) or bearer token (mobile app), ADR 0033. */
export const sessionClientTypeEnum = pgEnum('session_client_type', SESSION_CLIENT_TYPES);
/** Coarse device of a session, derived from the `User-Agent` (never stored raw), ADR 0033. */
export const deviceOsEnum = pgEnum('device_os', DEVICE_OPERATING_SYSTEMS);
export const deviceBrowserEnum = pgEnum('device_browser', DEVICE_BROWSERS);
/** Lifecycle of a scheduled test day (B-317 schedules it, B-320 runs it). */
export const testSessionStatusEnum = pgEnum('test_session_status', TEST_SESSION_STATUSES);
/** Where a match of the fixture is played (B-317). */
export const fixtureVenueEnum = pgEnum('fixture_venue', FIXTURE_VENUES);
/** State of a match of the fixture (B-317). */
export const fixtureStatusEnum = pgEnum('fixture_status', FIXTURE_STATUSES);

/** Contact level of a drill (B-318), for contact load and return-to-play planning. */
export const contactLevelEnum = pgEnum('contact_level', CONTACT_LEVELS);

/**
 * Participation of a player in a session (B-318). `unavailable` is what the
 * coach sees for a medically blocked player: never the cause (ADR 0008).
 */
export const participationStatusEnum = pgEnum('participation_status', PARTICIPATION_STATUSES);

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
/** Whether a parent's height was measured by staff or reported (B-315, Khamis-Roche). */
export const heightSourceEnum = pgEnum('height_source', HEIGHT_SOURCES);
/** Dominant side of a player (foot in rugby, hand in hockey). */
export const dominantSideEnum = pgEnum('dominant_side', DOMINANT_SIDES);
/** Mother or father, for the parents' heights (Khamis-Roche, B-315). */
export const parentKindEnum = pgEnum('parent_kind', PARENTS);
/** Why a player left the club (baja, B-315). */
export const playerLeaveReasonEnum = pgEnum('player_leave_reason', PLAYER_LEAVE_REASONS);
/** Life cycle of a season change (B-316, ADR 0049). */
export const seasonRolloverStatusEnum = pgEnum('season_rollover_status', SEASON_ROLLOVER_STATUSES);
/** Why the season change proposes what it proposes for a player (B-316). */
export const seasonRolloverProposalEnum = pgEnum(
  'season_rollover_proposal',
  SEASON_ROLLOVER_PROPOSALS,
);
/** Move the player to a category, or leave them as they are (B-316). */
export const seasonRolloverDecisionEnum = pgEnum(
  'season_rollover_decision',
  SEASON_ROLLOVER_DECISIONS,
);
/** What applying the season change did with a player (B-316). */
export const seasonRolloverOutcomeEnum = pgEnum(
  'season_rollover_outcome',
  SEASON_ROLLOVER_OUTCOMES,
);
/** Notifications (B-328, ADR 0054): kind, channel, delivery state and why it was skipped. */
export const notificationKindEnum = pgEnum('notification_kind', NOTIFICATION_KINDS);
export const notificationChannelEnum = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const notificationStatusEnum = pgEnum('notification_status', NOTIFICATION_STATUSES);
export const notificationSkipReasonEnum = pgEnum(
  'notification_skip_reason',
  NOTIFICATION_SKIP_REASONS,
);
/** Platform of a device with a push token. */
export const pushPlatformEnum = pgEnum('push_platform', PUSH_PLATFORMS);
/** A push ticket until its receipt is read (Expo). */
export const pushTicketStatusEnum = pgEnum('push_ticket_status', PUSH_TICKET_STATUSES);

// ---------------------------------------------------------------------------
// Vocabularies that only exist in the database for now.
// ---------------------------------------------------------------------------

/** Relationship of a guardian with the player (B-310); the domain's vocabulary since B-310. */
export { GUARDIAN_RELATIONSHIPS };
export const guardianRelationshipEnum = pgEnum('guardian_relationship', GUARDIAN_RELATIONSHIPS);

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
export const EXTERNAL_METRIC_SOURCES = FIELD_METRIC_SOURCES;
export const externalMetricSourceEnum = pgEnum('external_metric_source', EXTERNAL_METRIC_SOURCES);

/** Lifecycle of a generated alert (B-327). */
export { ALERT_STATUSES };
export const alertStatusEnum = pgEnum('alert_status', ALERT_STATUSES);
/** What happened to an alert (B-327, `alert_event`). */
export const alertEventTypeEnum = pgEnum('alert_event_type', ALERT_EVENT_TYPES);

/** Status of the ACWR and of Foster's monotony of a day (B-202, `player_load_daily`). */
export const acwrStatusEnum = pgEnum('acwr_status', ACWR_STATUSES);
export const monotonyStatusEnum = pgEnum('monotony_status', MONOTONY_STATUSES);
