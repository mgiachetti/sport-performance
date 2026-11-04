import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';

/**
 * Schema conventions checked on the Drizzle definitions (no database). The
 * same rules are checked against the migrated database in
 * `migrations.integration.test.ts`.
 */

const allTables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value as object, PgTable))
  .map((table) => getTableConfig(table));
/** Tables of the `public` schema; the `medical` schema (ADR 0029) is checked below. */
const tables = allTables.filter((t) => t.schema === undefined);
const medicalTables = allTables.filter((t) => t.schema === 'medical');
const qualified = (t: { schema?: string | undefined; name: string }) =>
  t.schema === undefined ? t.name : `${t.schema}.${t.name}`;

/** Global tables: identity (ADR 0007), sign-in attempt counters and the tenant root. */
const GLOBAL_TABLES = [
  'user',
  'session',
  'account',
  'verification',
  'auth_rate_limit',
  'known_device',
  'push_token',
  'club',
];
/** Append-only audit logs: club scoped, but not club tables in the ADR 0023 sense. */
const LOG_TABLES = ['medical.access_log'];
const tenantTables = allTables
  .filter((t) => !GLOBAL_TABLES.includes(t.name) || t.schema !== undefined)
  .filter((t) => !LOG_TABLES.includes(qualified(t)));
const tenantTableNames = new Set(tenantTables.map(qualified));

describe('schema conventions', () => {
  it('defines the B-301 model, the B-306 reference tables, the B-309 access tables, the B-305 history, the B-315 roster and the B-316 season change and the B-327 alert tables', () => {
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'account',
        'alert',
        'alert_event',
        'alert_rule',
        'anthro_measurement',
        'auth_rate_limit',
        'battery_config',
        'category',
        'category_report',
        'change_history',
        'club',
        'club_branch',
        'club_data_export',
        'consent',
        'consent_document',
        'derived_refresh',
        'data_subject_request',
        'device',
        'drill',
        'external_load',
        'external_metric',
        'fixture',
        'file',
        'guardian',
        'khamis_roche_coefficient',
        'khamis_roche_table',
        'known_device',
        'gym_program',
        'gym_set',
        'invitation',
        'invitation_category',
        'membership',
        'metric_definition',
        'notification',
        'notification_preference',
        'participation',
        'player',
        'player_access_code',
        'player_alert_evaluation',
        'player_category',
        'player_load_daily',
        'player_parent_height',
        'player_position',
        'player_report',
        'player_stage',
        'player_wellness_daily',
        'position',
        'push_ticket',
        'push_token',
        'reference_value',
        'roster_import',
        'season',
        'season_rollover',
        'season_rollover_item',
        'session',
        'speed_zone_config',
        'staff_assignment',
        'sync_change',
        'sync_mutation',
        'test_definition',
        'test_definition_metric',
        'test_import',
        'test_protocol_media',
        'test_result',
        'test_result_value',
        'test_session',
        'test_window',
        'training_session',
        'user',
        'verification',
        'wellness',
      ].sort(),
    );
  });

  it('defines the medical tables (B-304, B-609, B-805, B-806) in their own schema', () => {
    expect(medicalTables.map((t) => t.name).sort()).toEqual([
      'access_log',
      'concussion',
      'concussion_stage',
      'hold',
      'injury',
      'menarche_report',
      'menstrual_cycle_enrollment',
      'menstrual_cycle_log',
      'menstrual_cycle_share',
      'note',
      'pain_report',
      'pain_report_area',
    ]);
  });

  it.each(tenantTables.map((t) => [qualified(t), t] as const))(
    '%s has club_id, a uuid id and the audit columns',
    (_name, table) => {
      const columns = new Map(table.columns.map((c) => [c.name, c]));
      expect(columns.get('club_id')?.notNull).toBe(true);
      expect(columns.get('club_id')?.getSQLType()).toBe('uuid');
      expect(columns.get('id')?.primary).toBe(true);
      expect(columns.get('id')?.getSQLType()).toBe('uuid');
      for (const audit of ['created_at', 'updated_at', 'client_uuid']) {
        expect(columns.get(audit)?.notNull, audit).toBe(true);
      }
      expect(columns.has('created_by')).toBe(true);
      expect(columns.has('updated_by')).toBe(true);

      const uniques = table.uniqueConstraints.map((u) => u.columns.map((c) => c.name).join(','));
      expect(uniques).toContain('club_id,id');
      expect(uniques).toContain('club_id,client_uuid');
    },
  );

  it.each(tenantTables.map((t) => [qualified(t), t] as const))(
    '%s references other club tables through (club_id, id)',
    (_name, table) => {
      for (const fk of table.foreignKeys) {
        const reference = fk.reference();
        const target = qualified(getTableConfig(reference.foreignTable));
        if (!tenantTableNames.has(target)) continue;
        expect(reference.columns.map((c) => c.name)[0], fk.getName()).toBe('club_id');
        const foreign = reference.foreignColumns.map((c) => c.name);
        // A category hangs from its branch by the branch's natural key (B-313, ADR 0032):
        // its `sport` and `sex` are the branch, so no `branch_id` can disagree with them.
        if (target === 'club_branch') {
          expect(foreign, fk.getName()).toEqual(['club_id', 'sport', 'sex']);
          continue;
        }
        // Medical rows also carry the player: (club_id, id, player_id), ADR 0029.
        expect(foreign.slice(0, 2), fk.getName()).toEqual(['club_id', 'id']);
        if (foreign.length > 2)
          expect(foreign, fk.getName()).toEqual(['club_id', 'id', 'player_id']);
      }
    },
  );

  it('keeps every constraint and index name within the Postgres limit', () => {
    for (const table of allTables) {
      const names = [
        ...table.foreignKeys.map((fk) => fk.getName()),
        ...table.uniqueConstraints.map((u) => u.getName() ?? ''),
        ...table.checks.map((c) => c.name),
        ...table.indexes.map((i) => i.config.name ?? ''),
      ];
      for (const name of names) expect(name.length, name).toBeLessThanOrEqual(63);
    }
  });

  it('keeps identity tables global (no club_id)', () => {
    for (const name of ['user', 'session', 'account', 'verification']) {
      const table = tables.find((t) => t.name === name);
      expect(table?.columns.some((c) => c.name === 'club_id')).toBe(false);
    }
  });
});
