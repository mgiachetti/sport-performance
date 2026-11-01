import type { AlertRule, PlayerId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { codeCheck } from './checks.js';
import { localDate, timestamptz } from './columns.js';
import {
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
 * (B-327). A row of `alert_rule` is the domain's `AlertRule`: the scope
 * (`AlertRuleScope`) is split into array columns so it can be queried;
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
 * One alert per rule, player and evaluated club day (the worker re-evaluates
 * idempotently). `kind`, `severity` and `values` are copied from the
 * evaluation so the history survives later edits of the rule.
 */
export const alert = pgTable(
  'alert',
  {
    ...tenantColumns(),
    alertRuleId: uuid('alert_rule_id').notNull(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    kind: alertRuleKindEnum('kind').notNull(),
    severity: alertSeverityEnum('severity').notNull(),
    /** The evaluated club day. */
    localDate: localDate('local_date').notNull(),
    /** Day of the underlying data (wellness, CMJ, height). */
    observedOn: localDate('observed_on').notNull(),
    /** Observed value, threshold and context, for the i18n message. */
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
    index('alert_status_idx').on(t.clubId, t.status, t.localDate),
    index('alert_player_idx').on(t.clubId, t.playerId, t.localDate),
    check('alert_acknowledgement', sql`(${t.status} = 'open') = (${t.acknowledgedAt} is null)`),
  ],
);
