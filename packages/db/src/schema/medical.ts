import {
  AVAILABILITY_STATUSES,
  CONCUSSION_STAGE_OUTCOMES,
  INJURY_BODY_REGIONS,
  INJURY_CONTEXTS,
  INJURY_MECHANISMS,
  INJURY_ONSETS,
  INJURY_SIDES,
  MEDICAL_ACCESS_ACTIONS,
  MEDICAL_NOTE_VISIBILITIES,
  MENARCHE_DATE_PRECISIONS,
  MENARCHE_REPORTERS,
  MENARCHE_STATUSES,
  CENTRAL_PAIN_REGIONS,
  PAIN_COMMENT_MAX_LENGTH,
  PAIN_INTENSITY_MAX,
  PAIN_INTENSITY_MIN,
  PAIN_SIDES,
  MENSTRUAL_FLOWS,
  MENSTRUAL_NOTE_MAX_LENGTH,
  MENSTRUAL_SYMPTOMS,
  type ClubId,
  type PlayerId,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgSchema,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { validityCheck } from './checks.js';
import { localDate, timestamptz } from './columns.js';
import { membership } from './organization.js';
import { player } from './players.js';
import {
  club,
  tenantColumns,
  tenantConstraints,
  tenantReference,
  tenantReferenceIndex,
} from './tenant.js';
import { trainingSession } from './training.js';

/**
 * Health data (B-304, ADR 0008, ADR 0029), in its own Postgres schema so it
 * can be granted, backed up, exported or erased apart from the rest.
 *
 * Same conventions as every club table (ADR 0023): `club_id`, audit columns,
 * `client_uuid`, composite foreign keys. On top, references between medical
 * rows carry the player, `(club_id, x_id, player_id)`, so a note or a block
 * can never point to another player's injury.
 *
 * Access (hand-written part of migration `0007_medical_schema`): the connection roles
 * have no `SELECT` on the clinical columns. Reads go through the logged
 * `medical.read_*()` functions and `medical.availability()`; writes are plain
 * INSERT/UPDATE under forced RLS (the `medical` role, assigned players) and a
 * trigger logs each row. Every access lands in {@link medicalAccessLog}.
 */
export const medicalSchema = pgSchema('medical');

export const availabilityStatusEnum = medicalSchema.enum(
  'availability_status',
  AVAILABILITY_STATUSES,
);
export const injuryContextEnum = medicalSchema.enum('injury_context', INJURY_CONTEXTS);
export const injuryBodyRegionEnum = medicalSchema.enum('injury_body_region', INJURY_BODY_REGIONS);
export const injurySideEnum = medicalSchema.enum('injury_side', INJURY_SIDES);
export const injuryOnsetEnum = medicalSchema.enum('injury_onset', INJURY_ONSETS);
export const injuryMechanismEnum = medicalSchema.enum('injury_mechanism', INJURY_MECHANISMS);
export const concussionStageOutcomeEnum = medicalSchema.enum(
  'concussion_stage_outcome',
  CONCUSSION_STAGE_OUTCOMES,
);
export const noteVisibilityEnum = medicalSchema.enum('note_visibility', MEDICAL_NOTE_VISIBILITIES);
export const accessActionEnum = medicalSchema.enum('access_action', MEDICAL_ACCESS_ACTIONS);
export const menarcheStatusEnum = medicalSchema.enum('menarche_status', MENARCHE_STATUSES);
export const menarcheDatePrecisionEnum = medicalSchema.enum(
  'menarche_date_precision',
  MENARCHE_DATE_PRECISIONS,
);
export const menarcheReporterEnum = medicalSchema.enum('menarche_reporter', MENARCHE_REPORTERS);
export const menstrualFlowEnum = medicalSchema.enum('menstrual_flow', MENSTRUAL_FLOWS);
export const menstrualSymptomEnum = medicalSchema.enum('menstrual_symptom', MENSTRUAL_SYMPTOMS);

/** `(club_id, column, player_id) → target (club_id, id, player_id)`: same club and same player. */
function samePlayerReference(
  table: string,
  t: { readonly clubId: AnyPgColumn; readonly playerId: AnyPgColumn },
  column: AnyPgColumn,
  target: {
    readonly clubId: AnyPgColumn;
    readonly id: AnyPgColumn;
    readonly playerId: AnyPgColumn;
  },
) {
  return foreignKey({
    name: `${table}_${column.name}_fkey`,
    columns: [t.clubId, column, t.playerId],
    foreignColumns: [target.clubId, target.id, target.playerId],
  }).onDelete('restrict');
}

function samePlayerIndex(
  table: string,
  t: { readonly clubId: AnyPgColumn; readonly playerId: AnyPgColumn },
  column: AnyPgColumn,
) {
  return index(`${table}_${column.name}_idx`)
    .on(t.clubId, column, t.playerId)
    .where(sql`${column} is not null`);
}

/**
 * An injury as the medical staff records it. `onset_on`, `context` and
 * `returned_on` are what the incidence statistics need (`InjuryRecord`,
 * B-210); the rest is clinical.
 */
export const medicalInjury = medicalSchema.table(
  'injury',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    /** Club day the injury happened. */
    onsetOn: localDate('onset_on').notNull(),
    context: injuryContextEnum('context').notNull(),
    /** The session or match it happened in, when it was a club activity. */
    trainingSessionId: uuid('training_session_id'),
    bodyRegion: injuryBodyRegionEnum('body_region').notNull(),
    side: injurySideEnum('side').notNull(),
    onset: injuryOnsetEnum('onset').notNull(),
    mechanism: injuryMechanismEnum('mechanism').notNull(),
    /** Clinical diagnosis, free text. Only ever visible through the medical functions. */
    diagnosis: text('diagnosis'),
    /** OSIICS code (Orchard Sports Injury and Illness Classification), when used. */
    osiicsCode: text('osiics_code'),
    isRecurrence: boolean('is_recurrence').notNull().default(false),
    expectedReturnOn: localDate('expected_return_on'),
    /** Club day of the return to full participation; `NULL` while the injury is open. */
    returnedOn: localDate('returned_on'),
  },
  (t) => [
    ...tenantConstraints('injury', t),
    unique('injury_club_id_id_player_id_key').on(t.clubId, t.id, t.playerId),
    tenantReference('injury', t.clubId, t.playerId, player),
    tenantReference('injury', t.clubId, t.trainingSessionId, trainingSession),
    tenantReferenceIndex('injury', t.clubId, t.trainingSessionId),
    index('injury_player_idx').on(t.clubId, t.playerId, t.onsetOn),
    check(
      'injury_returned_after_onset',
      sql`${t.returnedOn} is null or ${t.returnedOn} >= ${t.onsetOn}`,
    ),
    check(
      'injury_expected_after_onset',
      sql`${t.expectedReturnOn} is null or ${t.expectedReturnOn} >= ${t.onsetOn}`,
    ),
    check(
      'injury_session_is_club_activity',
      sql`${t.trainingSessionId} is null or ${t.context} <> 'other'`,
    ),
    check(
      'injury_osiics_code_format',
      sql`${t.osiicsCode} is null or ${t.osiicsCode} ~ '^[A-Z0-9.]{1,16}$'`,
    ),
  ],
);

/**
 * A (suspected or confirmed) concussion and its mandatory clearance. The
 * graduated return to play goes in {@link medicalConcussionStage}; `cleared_*` is
 * stage 6, which needs stage 5 passed (trigger). Until then the player is
 * never available for a match.
 */
export const medicalConcussion = medicalSchema.table(
  'concussion',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    /** The injury row of the same event, for the statistics. */
    injuryId: uuid('injury_id'),
    occurredOn: localDate('occurred_on').notNull(),
    context: injuryContextEnum('context').notNull(),
    trainingSessionId: uuid('training_session_id'),
    /** Removed from the field or session right away. */
    removedFromPlay: boolean('removed_from_play').notNull().default(true),
    /** Protocol followed, e.g. `world_rugby_grtp`, and its version. */
    protocol: text('protocol').notNull().default('world_rugby_grtp'),
    protocolVersion: text('protocol_version').notNull(),
    /** Return to play (GRTP stage 6): club day of the clearance and the doctor who gave it. */
    clearedOn: localDate('cleared_on'),
    clearedBy: text('cleared_by').references(() => user.id, { onDelete: 'restrict' }),
  },
  (t) => [
    ...tenantConstraints('concussion', t),
    unique('concussion_club_id_id_player_id_key').on(t.clubId, t.id, t.playerId),
    tenantReference('concussion', t.clubId, t.playerId, player),
    tenantReference('concussion', t.clubId, t.trainingSessionId, trainingSession),
    tenantReferenceIndex('concussion', t.clubId, t.trainingSessionId),
    samePlayerReference('concussion', t, t.injuryId, medicalInjury),
    samePlayerIndex('concussion', t, t.injuryId),
    index('concussion_player_idx').on(t.clubId, t.playerId, t.occurredOn),
    check('concussion_clearance', sql`(${t.clearedOn} is null) = (${t.clearedBy} is null)`),
    check(
      'concussion_cleared_after',
      sql`${t.clearedOn} is null or ${t.clearedOn} >= ${t.occurredOn}`,
    ),
    check(
      'concussion_session_is_club_activity',
      sql`${t.trainingSessionId} is null or ${t.context} <> 'other'`,
    ),
  ],
);

/**
 * One GRTP stage (1–5) of a concussion. Stages are only added: the next one
 * is at most the last passed + 1, one in progress at a time, and symptoms
 * close a stage as `symptomatic` so the player drops back (trigger).
 */
export const medicalConcussionStage = medicalSchema.table(
  'concussion_stage',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    concussionId: uuid('concussion_id').notNull(),
    stage: smallint('stage').notNull(),
    startedOn: localDate('started_on').notNull(),
    endedOn: localDate('ended_on'),
    outcome: concussionStageOutcomeEnum('outcome').notNull().default('in_progress'),
  },
  (t) => [
    ...tenantConstraints('concussion_stage', t),
    samePlayerReference('concussion_stage', t, t.concussionId, medicalConcussion),
    index('concussion_stage_concussion_idx').on(t.clubId, t.concussionId, t.playerId, t.startedOn),
    uniqueIndex('concussion_stage_one_in_progress_key')
      .on(t.clubId, t.concussionId)
      .where(sql`${t.outcome} = 'in_progress'`),
    check('concussion_stage_range', sql`${t.stage} between 1 and 5`),
    check(
      'concussion_stage_end',
      sql`(${t.outcome} = 'in_progress') = (${t.endedOn} is null) and (${t.endedOn} is null or ${t.endedOn} >= ${t.startedOn})`,
    ),
  ],
);

/**
 * A medical block: what the player may do, for training and for matches,
 * over `[valid_from, valid_to)`. `staff_note` is the only text the rest of
 * the staff sees ("sin contacto"), written by the medical staff without a
 * diagnosis. Lifting closes `valid_to` and records who and when; a block no
 * longer counts from the club day it was lifted on (`medical.availability`),
 * so one recorded today and lifted today does not block today.
 */
export const medicalHold = medicalSchema.table(
  'hold',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    training: availabilityStatusEnum('training').notNull(),
    match: availabilityStatusEnum('match').notNull(),
    validFrom: localDate('valid_from').notNull(),
    validTo: localDate('valid_to'),
    staffNote: text('staff_note'),
    injuryId: uuid('injury_id'),
    concussionId: uuid('concussion_id'),
    liftedAt: timestamptz('lifted_at'),
    liftedBy: text('lifted_by').references(() => user.id, { onDelete: 'restrict' }),
  },
  (t) => [
    ...tenantConstraints('hold', t),
    tenantReference('hold', t.clubId, t.playerId, player),
    samePlayerReference('hold', t, t.injuryId, medicalInjury),
    samePlayerIndex('hold', t, t.injuryId),
    samePlayerReference('hold', t, t.concussionId, medicalConcussion),
    samePlayerIndex('hold', t, t.concussionId),
    index('hold_player_idx').on(t.clubId, t.playerId, t.validFrom),
    validityCheck('hold_validity', t.validFrom, t.validTo),
    check('hold_restricts', sql`${t.training} <> 'available' or ${t.match} <> 'available'`),
    check(
      'hold_lift',
      sql`(${t.liftedAt} is null) = (${t.liftedBy} is null) and (${t.liftedAt} is null or ${t.validTo} is not null)`,
    ),
  ],
);

/**
 * A clinical note. Append-only (no UPDATE grant): a correction is a new note
 * that `amends` the previous one. `shared` notes are also readable by the
 * player and their guardian (ADR 0029).
 */
export const medicalNote = medicalSchema.table(
  'note',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    body: text('body').notNull(),
    visibility: noteVisibilityEnum('visibility').notNull().default('medical'),
    injuryId: uuid('injury_id'),
    concussionId: uuid('concussion_id'),
    amendsNoteId: uuid('amends_note_id'),
  },
  (t) => [
    ...tenantConstraints('note', t),
    unique('note_club_id_id_player_id_key').on(t.clubId, t.id, t.playerId),
    tenantReference('note', t.clubId, t.playerId, player),
    samePlayerReference('note', t, t.injuryId, medicalInjury),
    samePlayerIndex('note', t, t.injuryId),
    samePlayerReference('note', t, t.concussionId, medicalConcussion),
    samePlayerIndex('note', t, t.concussionId),
    foreignKey({
      name: 'note_amends_note_id_fkey',
      columns: [t.clubId, t.amendsNoteId, t.playerId],
      foreignColumns: [t.clubId, t.id, t.playerId],
    }).onDelete('restrict'),
    samePlayerIndex('note', t, t.amendsNoteId),
    index('note_player_idx').on(t.clubId, t.playerId, t.createdAt),
    check('note_body_not_blank', sql`btrim(${t.body}) <> ''`),
  ],
);

/** `'a', 'b'`: a closed list of the domain as SQL literals (all of them are plain codes). */
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * The answer of a player to "¿te duele algo?" in the wellness (B-609, ADR
 * 0078). Written by the player themselves (not by the medical staff) with a
 * data and a health consent, and append-only: a new answer of the same day
 * is another row, the latest one counts. Only the review by the medical
 * staff (`reviewed_*`) is written later, once. `has_pain` with its
 * {@link medicalPainReportArea} rows (at least one, deferred trigger).
 */
export const medicalPainReport = medicalSchema.table(
  'pain_report',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    /** Club day the answer is about (today or yesterday, as the wellness). */
    localDate: localDate('local_date').notNull(),
    hasPain: boolean('has_pain').notNull(),
    /** What the player adds, only with pain. Only ever visible through the medical functions. */
    comment: text('comment'),
    /** The medical staff saw it: when and who. Once, never undone. */
    reviewedAt: timestamptz('reviewed_at'),
    reviewedBy: text('reviewed_by').references(() => user.id, { onDelete: 'restrict' }),
  },
  (t) => [
    ...tenantConstraints('pain_report', t),
    unique('pain_report_club_id_id_player_id_key').on(t.clubId, t.id, t.playerId),
    tenantReference('pain_report', t.clubId, t.playerId, player),
    index('pain_report_player_idx').on(t.clubId, t.playerId, t.localDate),
    index('pain_report_recent_idx').on(t.clubId, t.createdAt, t.id),
    check(
      'pain_report_comment',
      sql`${t.comment} is null or (${t.hasPain} and btrim(${t.comment}) <> '' and char_length(${t.comment}) <= ${sql.raw(String(PAIN_COMMENT_MAX_LENGTH))})`,
    ),
    check('pain_report_review', sql`(${t.reviewedAt} is null) = (${t.reviewedBy} is null)`),
  ],
);

/**
 * One area of the body map in a pain report: the region (the injury
 * vocabulary without `other`), its side and the intensity on the 0–10 scale
 * (an area that hurts is at least 1). Added only with its report, in the
 * same transaction; never changed.
 */
export const medicalPainReportArea = medicalSchema.table(
  'pain_report_area',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    reportId: uuid('report_id').notNull(),
    bodyRegion: injuryBodyRegionEnum('body_region').notNull(),
    side: injurySideEnum('side').notNull(),
    intensity: smallint('intensity').notNull(),
  },
  (t) => [
    ...tenantConstraints('pain_report_area', t),
    samePlayerReference('pain_report_area', t, t.reportId, medicalPainReport),
    unique('pain_report_area_key').on(t.clubId, t.reportId, t.bodyRegion, t.side),
    check('pain_report_area_region', sql`${t.bodyRegion} <> 'other'`),
    check('pain_report_area_side', sql`${t.side} in (${sqlList(PAIN_SIDES)})`),
    check(
      'pain_report_area_side_of_region',
      sql`(${t.side} = 'central') = (${t.bodyRegion} in (${sqlList(CENTRAL_PAIN_REGIONS)}))`,
    ),
    check(
      'pain_report_area_intensity',
      sql`${t.intensity} between ${sql.raw(String(PAIN_INTENSITY_MIN))} and ${sql.raw(String(PAIN_INTENSITY_MAX))}`,
    ),
  ],
);

/**
 * The menarche of a girl (B-805, ADR 0089), optional: "not yet" as of the
 * report day, or the date it happened with its precision (stored truncated
 * to the first day of the month or the year). Told by the player, her
 * guardian while she is a minor, or the assigned medical staff, all with a
 * health consent (`medical.may_report_menarche`), and append-only: a new
 * report supersedes the previous one, the latest counts. Only for girls
 * (trigger). Read only through `medical.read_menarche_reports`, with a
 * health consent for every reader.
 */
export const medicalMenarcheReport = medicalSchema.table(
  'menarche_report',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    status: menarcheStatusEnum('status').notNull(),
    occurredOn: localDate('occurred_on'),
    precision: menarcheDatePrecisionEnum('precision'),
    /** Club day of the report: the "as of" date of `not_yet`. */
    reportedOn: localDate('reported_on').notNull(),
    /** Validated role of who told it (`app.current_role()`, policy). */
    reportedBy: menarcheReporterEnum('reported_by').notNull(),
  },
  (t) => [
    ...tenantConstraints('menarche_report', t),
    tenantReference('menarche_report', t.clubId, t.playerId, player),
    index('menarche_report_player_idx').on(t.clubId, t.playerId, t.createdAt),
    check(
      'menarche_report_date',
      sql`(${t.status} = 'occurred') = (${t.occurredOn} is not null) and (${t.occurredOn} is null) = (${t.precision} is null)`,
    ),
    check(
      'menarche_report_date_truncated',
      sql`${t.precision} is null or ${t.precision} = 'day' or (extract(day from ${t.occurredOn}) = 1 and (${t.precision} = 'month' or extract(month from ${t.occurredOn}) = 1))`,
    ),
    check(
      'menarche_report_date_not_after_report',
      sql`${t.occurredOn} is null or ${t.occurredOn} <= ${t.reportedOn}`,
    ),
  ],
);

/**
 * The player's own opt-in to menstrual cycle tracking (B-806, ADR 0092): one
 * row per period she had it on. Only she turns it on (with the module of the
 * club and the `data`, `health` and `menstrual_cycle` consents) and off
 * (`ended_*`, once, at the time she does it). Turning it off revokes every
 * authorization of that period (trigger): turning it on again starts with
 * nobody authorized.
 */
export const medicalMenstrualCycleEnrollment = medicalSchema.table(
  'menstrual_cycle_enrollment',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    endedAt: timestamptz('ended_at'),
    endedBy: text('ended_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    ...tenantConstraints('menstrual_cycle_enrollment', t),
    tenantReference('menstrual_cycle_enrollment', t.clubId, t.playerId, player),
    uniqueIndex('menstrual_cycle_enrollment_active_key')
      .on(t.clubId, t.playerId)
      .where(sql`${t.endedAt} is null`),
    index('menstrual_cycle_enrollment_player_idx').on(t.clubId, t.playerId, t.createdAt),
    check(
      'menstrual_cycle_enrollment_ended',
      sql`${t.endedBy} is null or ${t.endedAt} is not null`,
    ),
  ],
);

/**
 * A day of the cycle as the player logs it: bleeding, symptoms of a closed
 * vocabulary and an optional note. Append-only: a correction is a new row of
 * the same day, the latest one counts. Only the player writes it, while she
 * has the tracking on; nobody updates or deletes it.
 */
export const medicalMenstrualCycleLog = medicalSchema.table(
  'menstrual_cycle_log',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    /** Club day the entry is about (the last 14 days, `MENSTRUAL_LOG_WINDOW_DAYS`). */
    localDate: localDate('local_date').notNull(),
    flow: menstrualFlowEnum('flow').notNull(),
    symptoms: menstrualSymptomEnum('symptoms')
      .array()
      .notNull()
      .default(sql`'{}'`),
    note: text('note'),
  },
  (t) => [
    ...tenantConstraints('menstrual_cycle_log', t),
    tenantReference('menstrual_cycle_log', t.clubId, t.playerId, player),
    index('menstrual_cycle_log_player_idx').on(t.clubId, t.playerId, t.localDate, t.createdAt),
    check(
      'menstrual_cycle_log_note',
      sql`${t.note} is null or (btrim(${t.note}) <> '' and char_length(${t.note}) <= ${sql.raw(String(MENSTRUAL_NOTE_MAX_LENGTH))})`,
    ),
    check(
      'menstrual_cycle_log_symptoms',
      sql`cardinality(${t.symptoms}) <= ${sql.raw(String(MENSTRUAL_SYMPTOMS.length))} and array_position(${t.symptoms}, null) is null`,
    ),
  ],
);

/**
 * A member the player authorizes to read her cycle (B-806): an assigned
 * `medical` or `sc` membership, checked when she adds it and again on every
 * read. Revoked once (`revoked_*`), by her; ending the tracking revokes all of
 * them. The membership going away (account deleted) takes the row with it.
 */
export const medicalMenstrualCycleShare = medicalSchema.table(
  'menstrual_cycle_share',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    viewerMembershipId: uuid('viewer_membership_id').notNull(),
    revokedAt: timestamptz('revoked_at'),
    revokedBy: text('revoked_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    ...tenantConstraints('menstrual_cycle_share', t),
    tenantReference('menstrual_cycle_share', t.clubId, t.playerId, player),
    foreignKey({
      name: 'menstrual_cycle_share_viewer_membership_id_fkey',
      columns: [t.clubId, t.viewerMembershipId],
      foreignColumns: [membership.clubId, membership.id],
    }).onDelete('cascade'),
    uniqueIndex('menstrual_cycle_share_active_key')
      .on(t.clubId, t.playerId, t.viewerMembershipId)
      .where(sql`${t.revokedAt} is null`),
    index('menstrual_cycle_share_viewer_idx').on(t.clubId, t.viewerMembershipId),
    check(
      'menstrual_cycle_share_revoked',
      sql`${t.revokedBy} is null or ${t.revokedAt} is not null`,
    ),
  ],
);

/**
 * Append-only audit of every read and write of medical data (ADR 0008):
 * who (user, validated role, database login), what (action, resource, rows,
 * changed column names, never values), whose (player), when and in which
 * request and transaction. Nobody can update or delete it, not even the
 * owner (trigger). It is not a club table in the ADR 0023 sense: no
 * `client_uuid` or `updated_*`, and no foreign keys to the player or the user
 * so the evidence survives them.
 */
export const medicalAccessLog = medicalSchema.table(
  'access_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => club.id, { onDelete: 'restrict' })
      .$type<ClubId>(),
    occurredAt: timestamptz('occurred_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    actorUserId: text('actor_user_id'),
    /** Role validated by `app.current_role()`; `NULL` for the owner's maintenance writes. */
    actorRole: text('actor_role'),
    /** Database login (`session_user`). */
    dbRole: text('db_role').notNull(),
    action: accessActionEnum('action').notNull(),
    /** Table (`injury`, `note`…) or derived view (`availability`) accessed. */
    resource: text('resource').notNull(),
    playerId: uuid('player_id').$type<PlayerId>(),
    recordIds: uuid('record_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Names of the columns an update changed. */
    changedColumns: text('changed_columns').array(),
    requestId: text('request_id'),
    transactionId: bigint('transaction_id', { mode: 'bigint' })
      .notNull()
      .default(sql`(pg_current_xact_id()::text)::bigint`),
  },
  (t) => [
    index('access_log_player_idx').on(t.clubId, t.playerId, t.occurredAt),
    index('access_log_occurred_idx').on(t.clubId, t.occurredAt),
    index('access_log_request_idx').on(t.requestId),
  ],
);
