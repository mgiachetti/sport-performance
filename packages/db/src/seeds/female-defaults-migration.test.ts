/**
 * The data migration `female_defaults` (B-804, ADR 0087) writes the
 * domain's female defaults as SQL literals. ADR 0027 forbids writing a
 * threshold twice, so this test is what keeps both copies equal: it reads
 * the migration and compares every literal with the domain constant.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_ALERT_RULES,
  DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES,
  type AlertRule,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../migrate.js';
import { DEFAULT_SEED_VALID_FROM } from './bootstrap.js';

/** Found by its tag, so a renumbering at merge time does not break the test. */
function femaleDefaultsMigration(): string {
  const files = readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('_female_defaults.sql'));
  expect(files).toHaveLength(1);
  return join(MIGRATIONS_FOLDER, files[0] ?? '');
}

function jsonbLiterals(sql: string): unknown[] {
  return [...sql.matchAll(/'(\{[^']*\})'::jsonb/g)].map((match): unknown =>
    JSON.parse(match[1] ?? ''),
  );
}

function rule(code: string): AlertRule {
  const found = DEFAULT_ALERT_RULES.find((r) => r.code === code);
  if (found === undefined) throw new Error(code);
  return found;
}

describe('0045_female_defaults', () => {
  const sql = readFileSync(femaleDefaultsMigration(), 'utf8');

  it('narrows the growth rule seeded with the parameters the domain still has', () => {
    const [seededGrowth, femaleGrowth, femaleZones] = jsonbLiterals(sql);
    // The men's rule kept its parameters; only its scope changed.
    expect(seededGrowth).toEqual(rule('growth_peak').params);
    expect(rule('growth_peak').appliesTo).toEqual({ sexes: ['male'] });
    expect(femaleGrowth).toEqual(rule('growth_peak_female').params);
    expect(rule('growth_peak_female').appliesTo).toEqual({ sexes: ['female'] });
    expect(femaleZones).toEqual(DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES);
  });

  it('starts the women zones on the first day of the seeded ones', () => {
    expect(sql).toContain(`DATE '${DEFAULT_SEED_VALID_FROM}'`);
  });

  it('writes exactly the three literals it documents', () => {
    expect(jsonbLiterals(sql)).toHaveLength(3);
  });
});
