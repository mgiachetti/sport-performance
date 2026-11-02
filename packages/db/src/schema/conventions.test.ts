import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';

/**
 * Schema conventions checked on the Drizzle definitions (no database). The
 * same rules are checked against the migrated database in
 * `migrations.integration.test.ts`.
 */

const tables = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value as object, PgTable))
  .map((table) => getTableConfig(table));

/** Global tables: identity (ADR 0007) and the tenant root. */
const GLOBAL_TABLES = ['user', 'session', 'account', 'verification', 'club'];
const tenantTables = tables.filter((t) => !GLOBAL_TABLES.includes(t.name));
const tenantTableNames = new Set(tenantTables.map((t) => t.name));

describe('schema conventions', () => {
  it('defines the B-301 model and the B-306 reference tables', () => {
    const names = tables.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'account',
        'alert',
        'alert_rule',
        'anthro_measurement',
        'battery_config',
        'category',
        'club',
        'consent',
        'device',
        'drill',
        'external_metric',
        'guardian',
        'khamis_roche_coefficient',
        'khamis_roche_table',
        'gym_program',
        'gym_set',
        'membership',
        'metric_definition',
        'participation',
        'player',
        'player_category',
        'player_stage',
        'position',
        'reference_value',
        'season',
        'session',
        'speed_zone_config',
        'staff_assignment',
        'test_definition',
        'test_definition_metric',
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

  it.each(tenantTables.map((t) => [t.name, t] as const))(
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

  it.each(tenantTables.map((t) => [t.name, t] as const))(
    '%s references other club tables through (club_id, id)',
    (_name, table) => {
      for (const fk of table.foreignKeys) {
        const reference = fk.reference();
        const target = getTableConfig(reference.foreignTable).name;
        if (!tenantTableNames.has(target)) continue;
        expect(reference.columns.map((c) => c.name)[0], fk.getName()).toBe('club_id');
        expect(reference.foreignColumns.map((c) => c.name)).toEqual(['club_id', 'id']);
      }
    },
  );

  it('keeps every constraint and index name within the Postgres limit', () => {
    for (const table of tables) {
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
