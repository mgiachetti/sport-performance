import type {
  AlertRule,
  AlertRuleKind,
  AlertSkipReason,
  PlayerId,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { codeCheck } from './checks.js';
import { localDate, timestamptz } from './columns.js';
import {
  alertEventTypeEnum,
  alertRuleKindEnum,
  alertSeverityEnum,
  alertStatusEnum,
  sexEnum,
  sportEnum,
  stageEnum,
} from './enums.js';
import { player } from './players.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';

/**
 * Declarative alert rules (B-207, ADR 0022) and the alerts they produce
 * (B-327, ADR 0053). A row of `alert_rule` is the domain's `AlertRule`: the
 * scope (`AlertRuleScope`) is split into array columns so it can be queried;
 * `NULL` means "everyone" for that dimension. `params` is validated by the
 * domain (`parseAlertRule`) before it is written.
 */
export const alertRule = pgTable(
  'alert_rule',
  {
    ...tenantColumns(),
    code: text('code').notNull(),
    kind: alertRuleKindEnum('kind').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    sports: sportEnum('sports').array(),
    sexes: sexEnum('sexes').array(),
    stages: stageEnum('stages').array(),
    params: jsonb('params').notNull().$type<AlertRule['params']>(),
  },
  (t) => [
    ...tenantConstraints('alert_rule', t),
    unique('alert_rule_club_id_code_key').on(t.clubId, t.code),
    codeCheck('alert_rule_code_format', t.code),
    check(
      'alert_rule_scope_not_empty',
      sql`(${t.sports} is null or cardinality(${t.sports}) > 0) and (${t.sexes} is null or cardinality(${t.sexes}) > 0) and (${t.stages} is null or cardinality(${t.stages}) > 0)`,
    ),
    check('alert_rule_params_object', sql`jsonb_typeof(${t.params}) = 'object'`),
  ],
);

/**
 * An alert **episode** (B-327, ADR 0053): one rule for one player from the
 * first club day it fired (`local_date`) through the latest one it fired
 * (`last_seen_on`) until the first day it stopped firing (`resolved_on`). At
 * most one active (unresolved) episode per rule and player. The worker
 * writes it from the domain's `nextAlertEpisode`; the API only reviews it
 * (`status` and the acknowledgement columns, migration 0028). `kind`,
 * `severity` and `values` are copied from the evaluation so the history
 * survives later edits of the rule. Every change leaves an `alert_event`.
 */
export const alert = pgTable(
  'alert',
  {
    ...tenantColumns(),
    alertRuleId: uuid('alert_rule_id').notNull(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    kind: alertRuleKindEnum('kind').notNull(),
    /** Highest severity reached in the episode: never lowered. */
    severity: alertSeverityEnum('severity').notNull(),
    /** Severity of the latest day the rule fired. */
    currentSeverity: alertSeverityEnum('current_severity').notNull(),
    /** The club day the episode was raised. */
    localDate: localDate('local_date').notNull(),
    /** The latest club day the rule fired. */
    lastSeenOn: localDate('last_seen_on').notNull(),
    /** The first club day the rule stopped firing; `NULL` while active. */
    resolvedOn: localDate('resolved_on'),
    /** Day of the underlying data of the latest firing (wellness, CMJ, height). */
    observedOn: localDate('observed_on').notNull(),
    /** Observed value, threshold and context of the latest firing, for the i18n message. */
    values: jsonb('values').notNull().default({}).$type<Readonly<Record<string, number>>>(),
    status: alertStatusEnum('status').notNull().default('open'),
    acknowledgedAt: timestamptz('acknowledged_at'),
    acknowledgedBy: text('acknowledged_by').references(() => user.id, { onDelete: 'set null' }),
    acknowledgementNote: text('acknowledgement_note'),
  },
  (t) => [
    ...tenantConstraints('alert', t),
    tenantReference('alert', t.clubId, t.alertRuleId, alertRule),
    tenantReference('alert', t.clubId, t.playerId, player),
    unique('alert_club_id_rule_player_day_key').on(
      t.clubId,
      t.alertRuleId,
      t.playerId,
      t.localDate,
    ),
    uniqueIndex('alert_active_key')
      .on(t.clubId, t.alertRuleId, t.playerId)
      .where(sql`${t.resolvedOn} is null`),
    index('alert_status_idx').on(t.clubId, t.status, t.localDate),
    index('alert_player_idx').on(t.clubId, t.playerId, t.localDate),
    check('alert_acknowledgement', sql`(${t.status} = 'open') = (${t.acknowledgedAt} is null)`),
    check(
      'alert_acknowledgement_note',
      sql`${t.acknowledgementNote} is null or (${t.status} <> 'open' and char_length(${t.acknowledgementNote}) between 1 and 1000 and ${t.acknowledgementNote} = btrim(${t.acknowledgementNote}))`,
    ),
    check(
      'alert_episode_days',
      sql`${t.lastSeenOn} >= ${t.localDate} and ${t.observedOn} <= ${t.lastSeenOn} and (${t.resolvedOn} is null or ${t.resolvedOn} >= ${t.lastSeenOn})`,
    ),
    check('alert_current_severity', sql`${t.currentSeverity} <= ${t.severity}`),
    check('alert_values_object', sql`jsonb_typeof(${t.values}) = 'object'`),
  ],
);

/**
 * What happened to an alert, in order (B-327, ADR 0053): raised, escalated,
 * resolved, reopened, acknowledged or dismissed, with the club day, the
 * severity after the event, the review note and its author (`NULL` for the
 * worker). Append-only, written only by the trigger `alert_event_record` on
 * `alert` in the transaction of the change: no connection role inserts,
 * updates or deletes it. `seq` orders the events of the club; notifications
 * (#59) consume them after the last `seq` they processed.
 */
export const alertEvent = pgTable(
  'alert_event',
  {
    ...tenantColumns(),
    seq: bigint('seq', { mode: 'number' }).notNull().generatedByDefaultAsIdentity(),
    alertId: uuid('alert_id').notNull(),
    /** The alert's player, for the row-level scope and the player's history. */
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    type: alertEventTypeEnum('type').notNull(),
    /** Club day of the event. */
    localDate: localDate('local_date').notNull(),
    /** Severity of the alert after the event (its highest so far). */
    severity: alertSeverityEnum('severity').notNull(),
    /** The note of an acknowledgement or a dismissal. */
    note: text('note'),
    /** Who reviewed it; `NULL` for the worker's events (or a deleted account). */
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    ...tenantConstraints('alert_event', t),
    tenantReference('alert_event', t.clubId, t.alertId, alert).onDelete('cascade'),
    tenantReference('alert_event', t.clubId, t.playerId, player).onDelete('cascade'),
    unique('alert_event_club_id_seq_key').on(t.clubId, t.seq),
    index('alert_event_alert_idx').on(t.clubId, t.alertId, t.seq),
    index('alert_event_player_idx').on(t.clubId, t.playerId, t.seq),
  ],
);

/** A rule the engine could not evaluate for a player, with why (ADR 0022). */
export interface StoredSkippedAlertRule {
  readonly ruleCode: string;
  readonly kind: AlertRuleKind;
  readonly reason: AlertSkipReason;
}

/**
 * The latest club day the worker evaluated a player's alerts (one row per
 * player) and the rules it could not evaluate, with the reason
 * (`insufficient_history`, `no_data`, `stale_data`…), so the panel can say
 * "historia insuficiente" instead of "sin alertas". The daily pass evaluates
 * every player whose `evaluated_on` is before the club's today.
 */
export const playerAlertEvaluation = pgTable(
  'player_alert_evaluation',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    evaluatedOn: localDate('evaluated_on').notNull(),
    evaluatedAt: timestamptz('evaluated_at').notNull().defaultNow(),
    skipped: jsonb('skipped').notNull().default([]).$type<readonly StoredSkippedAlertRule[]>(),
  },
  (t) => [
    ...tenantConstraints('player_alert_evaluation', t),
    tenantReference('player_alert_evaluation', t.clubId, t.playerId, player).onDelete('cascade'),
    unique('player_alert_evaluation_player_key').on(t.clubId, t.playerId),
    index('player_alert_evaluation_day_idx').on(t.clubId, t.evaluatedOn),
    check('player_alert_evaluation_skipped', sql`jsonb_typeof(${t.skipped}) = 'array'`),
  ],
);
