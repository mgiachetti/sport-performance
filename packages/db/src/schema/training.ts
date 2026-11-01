import type { CategoryId, PlayerId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
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
import { codeCheck, finite, rangeCheck, validityCheck } from './checks.js';
import { localDate, timestamptz } from './columns.js';
import {
  contactLevelEnum,
  externalMetricSourceEnum,
  participationStatusEnum,
  sessionKindEnum,
  sportEnum,
  stageEnum,
  unitEnum,
} from './enums.js';
import { device, metricDefinition } from './catalog.js';
import { category } from './organization.js';
import { player } from './players.js';
import {
  tenantColumns,
  tenantConstraints,
  tenantReference,
  tenantReferenceIndex,
} from './tenant.js';

/**
 * Training load: sessions and matches, drills, participation and RPE
 * (B-318), wellness (B-319), field metrics (B-601, F3) and the gym (B-6xx).
 * Derived load (EWMA, ACWR, monotony) is computed by the worker into its own
 * `*_daily` tables (B-326), not stored here.
 */

/** A training session or a match (`kind`, which drives exposure hours, B-210). */
export const trainingSession = pgTable(
  'training_session',
  {
    ...tenantColumns(),
    sport: sportEnum('sport').notNull(),
    kind: sessionKindEnum('kind').notNull(),
    categoryId: uuid('category_id').$type<CategoryId>(),
    title: text('title'),
    startsAt: timestamptz('starts_at').notNull(),
    /** The club's day of `starts_at`, computed with the club's time zone. */
    localDate: localDate('local_date').notNull(),
    plannedDurationMin: smallint('planned_duration_min'),
    location: text('location'),
    /** Matches only. */
    opponent: text('opponent'),
    notes: text('notes'),
  },
  (t) => [
    ...tenantConstraints('training_session', t),
    tenantReference('training_session', t.clubId, t.categoryId, category),
    index('training_session_local_date_idx').on(t.clubId, t.localDate),
    index('training_session_category_idx').on(t.clubId, t.categoryId, t.localDate),
    check(
      'training_session_planned_duration',
      sql`${t.plannedDurationMin} is null or ${t.plannedDurationMin} > 0`,
    ),
  ],
);

/** A block of a session, with its contact level (B-318). */
export const drill = pgTable(
  'drill',
  {
    ...tenantColumns(),
    trainingSessionId: uuid('training_session_id').notNull(),
    name: text('name').notNull(),
    sortOrder: smallint('sort_order').notNull().default(0),
    durationMin: smallint('duration_min'),
    contactLevel: contactLevelEnum('contact_level').notNull().default('none'),
    notes: text('notes'),
  },
  (t) => [
    ...tenantConstraints('drill', t),
    tenantReference('drill', t.clubId, t.trainingSessionId, trainingSession).onDelete('cascade'),
    index('drill_session_idx').on(t.clubId, t.trainingSessionId),
    check('drill_duration', sql`${t.durationMin} is null or ${t.durationMin} > 0`),
  ],
);

/**
 * A player in a session: status, minutes, contacts and session RPE (CR-10).
 * `srpe_au` = RPE × minutes is a generated column, so it can never drift.
 */
export const participation = pgTable(
  'participation',
  {
    ...tenantColumns(),
    trainingSessionId: uuid('training_session_id').notNull(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    status: participationStatusEnum('status').notNull(),
    minutes: smallint('minutes'),
    contactsN: smallint('contacts_n'),
    /** CR-10, reported by the player 15–30 min after the session or the next morning. */
    rpe: smallint('rpe'),
    rpeReportedAt: timestamptz('rpe_reported_at'),
    srpeAu: integer('srpe_au').generatedAlwaysAs(sql`"rpe"::integer * "minutes"`),
  },
  (t) => [
    ...tenantConstraints('participation', t),
    tenantReference('participation', t.clubId, t.trainingSessionId, trainingSession).onDelete(
      'cascade',
    ),
    tenantReference('participation', t.clubId, t.playerId, player),
    unique('participation_club_id_session_player_key').on(
      t.clubId,
      t.trainingSessionId,
      t.playerId,
    ),
    index('participation_player_idx').on(t.clubId, t.playerId),
    rangeCheck('participation_rpe', t.rpe, 0, 10),
    rangeCheck('participation_minutes', t.minutes, 0, 600),
    check('participation_contacts', sql`${t.contactsN} is null or ${t.contactsN} >= 0`),
    check(
      'participation_absent_has_no_load',
      sql`${t.status} not in ('absent', 'unavailable') or (coalesce(${t.minutes}, 0) = 0 and ${t.rpe} is null)`,
    ),
    check('participation_rpe_reported', sql`(${t.rpe} is null) = (${t.rpeReportedAt} is null)`),
  ],
);

/**
 * Pre-training wellness, one per player and club day (B-319). `item_count`
 * is the item set of the player's stage (3 with faces in M13/M14, otherwise
 * 5); exactly that many items are answered, each 1–5.
 */
export const wellness = pgTable(
  'wellness',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    localDate: localDate('local_date').notNull(),
    itemCount: smallint('item_count').notNull(),
    sleep: smallint('sleep'),
    fatigue: smallint('fatigue'),
    soreness: smallint('soreness'),
    stress: smallint('stress'),
    mood: smallint('mood'),
    submittedAt: timestamptz('submitted_at').notNull().defaultNow(),
  },
  (t) => [
    ...tenantConstraints('wellness', t),
    tenantReference('wellness', t.clubId, t.playerId, player),
    unique('wellness_club_id_player_id_local_date_key').on(t.clubId, t.playerId, t.localDate),
    check('wellness_item_count', sql`${t.itemCount} in (3, 5)`),
    check(
      'wellness_answered_items',
      sql`num_nonnulls(${t.sleep}, ${t.fatigue}, ${t.soreness}, ${t.stress}, ${t.mood}) = ${t.itemCount}`,
    ),
    rangeCheck('wellness_sleep', t.sleep, 1, 5),
    rangeCheck('wellness_fatigue', t.fatigue, 1, 5),
    rangeCheck('wellness_soreness', t.soreness, 1, 5),
    rangeCheck('wellness_stress', t.stress, 1, 5),
    rangeCheck('wellness_mood', t.mood, 1, 5),
  ],
);

/**
 * Field metric values per player and session: Catapult imports (B-601),
 * heart-rate bands (Phase 2) and the pod's derived metrics (Phase 3; the raw
 * stream goes to storage, ADR 0005). `external_ref` identifies the source row
 * (OpenField activity and period) so re-importing a file is idempotent.
 */
export const externalMetric = pgTable(
  'external_metric',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    trainingSessionId: uuid('training_session_id'),
    drillId: uuid('drill_id'),
    metricDefinitionId: uuid('metric_definition_id').notNull(),
    localDate: localDate('local_date').notNull(),
    value: doublePrecision('value').notNull(),
    unit: unitEnum('unit').notNull(),
    source: externalMetricSourceEnum('source').notNull(),
    deviceId: uuid('device_id'),
    externalRef: text('external_ref'),
    /** Import that produced it (B-601 adds the import table and its foreign key). */
    importId: uuid('import_id'),
  },
  (t) => [
    ...tenantConstraints('external_metric', t),
    tenantReference('external_metric', t.clubId, t.playerId, player),
    tenantReference('external_metric', t.clubId, t.trainingSessionId, trainingSession),
    tenantReference('external_metric', t.clubId, t.drillId, drill),
    tenantReferenceIndex('external_metric', t.clubId, t.drillId),
    tenantReference('external_metric', t.clubId, t.metricDefinitionId, metricDefinition),
    tenantReferenceIndex('external_metric', t.clubId, t.metricDefinitionId),
    tenantReference('external_metric', t.clubId, t.deviceId, device),
    tenantReferenceIndex('external_metric', t.clubId, t.deviceId),
    index('external_metric_player_idx').on(t.clubId, t.playerId, t.localDate),
    index('external_metric_session_idx').on(t.clubId, t.trainingSessionId),
    uniqueIndex('external_metric_source_ref_key')
      .on(t.clubId, t.source, t.externalRef, t.playerId, t.metricDefinitionId)
      .where(sql`${t.externalRef} is not null`),
    check('external_metric_value_finite', finite(t.value)),
  ],
);

/** A gym program for a category, a stage or one player. `plan` holds its structure. */
export const gymProgram = pgTable(
  'gym_program',
  {
    ...tenantColumns(),
    name: text('name').notNull(),
    categoryId: uuid('category_id').$type<CategoryId>(),
    playerId: uuid('player_id').$type<PlayerId>(),
    stage: stageEnum('stage'),
    plan: jsonb('plan').notNull().default({}).$type<Readonly<Record<string, unknown>>>(),
    notes: text('notes'),
    validFrom: localDate('valid_from').notNull(),
    validTo: localDate('valid_to'),
  },
  (t) => [
    ...tenantConstraints('gym_program', t),
    tenantReference('gym_program', t.clubId, t.categoryId, category),
    tenantReference('gym_program', t.clubId, t.playerId, player),
    index('gym_program_category_idx').on(t.clubId, t.categoryId),
    index('gym_program_player_idx').on(t.clubId, t.playerId),
    validityCheck('gym_program_validity', t.validFrom, t.validTo),
  ],
);

/**
 * A performed set. M15/M16 log submaximal sets with RIR for the e1RM
 * (never to failure); M13/M14 log reps and a 1–3 technique score.
 */
export const gymSet = pgTable(
  'gym_set',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    gymProgramId: uuid('gym_program_id'),
    performedOn: localDate('performed_on').notNull(),
    /** Exercise code (`goblet_squat`, `trap_bar_deadlift`). */
    exerciseCode: text('exercise_code').notNull(),
    setNumber: smallint('set_number').notNull(),
    reps: smallint('reps'),
    loadKg: doublePrecision('load_kg'),
    /** Reps in reserve. */
    rir: smallint('rir'),
    techniqueScore: smallint('technique_score'),
    durationS: integer('duration_s'),
    notes: text('notes'),
  },
  (t) => [
    ...tenantConstraints('gym_set', t),
    tenantReference('gym_set', t.clubId, t.playerId, player),
    tenantReference('gym_set', t.clubId, t.gymProgramId, gymProgram),
    tenantReferenceIndex('gym_set', t.clubId, t.gymProgramId),
    index('gym_set_player_idx').on(t.clubId, t.playerId, t.performedOn),
    codeCheck('gym_set_exercise_code_format', t.exerciseCode),
    check('gym_set_set_number', sql`${t.setNumber} >= 1`),
    check('gym_set_reps', sql`${t.reps} is null or ${t.reps} >= 0`),
    check('gym_set_load', sql`${t.loadKg} is null or (${finite(t.loadKg)} and ${t.loadKg} >= 0)`),
    rangeCheck('gym_set_rir', t.rir, 0, 10),
    rangeCheck('gym_set_technique_score', t.techniqueScore, 1, 3),
    check('gym_set_duration', sql`${t.durationS} is null or ${t.durationS} > 0`),
    check('gym_set_has_value', sql`num_nonnulls(${t.reps}, ${t.durationS}) >= 1`),
  ],
);
