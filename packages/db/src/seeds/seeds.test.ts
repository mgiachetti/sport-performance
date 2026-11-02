import {
  CANONICAL_METRICS,
  CANONICAL_METRIC_CODES,
  CANONICAL_TEST_CODES,
  DEFAULT_ATTEMPT_SCORING,
  DEFAULT_IFT_3015_PROTOCOL,
  KHAMIS_ROCHE_1994_TABLE,
  STAGE_PROFILES,
  isCanonicalMetricCode,
  isWellFormedCode,
  type CanonicalTestCode,
  type Stage,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { batterySeeds, type BatterySeed } from './battery.js';
import { DEFAULT_CATAPULT_ALIASES, normalizeCatapultAlias } from './catapult-aliases.js';
import { khamisRocheCoefficientSeeds, khamisRocheTableSeed } from './khamis-roche.js';
import { metricDefinitionSeeds } from './metrics.js';
import { ORC_TENANT } from './tenant.js';
import { DERIVED_TEST_METRIC_CODES, testDefinitionSeeds } from './test-definitions.js';

describe('metric dictionary seed', () => {
  const metrics = metricDefinitionSeeds();

  it('has every canonical metric once, with the domain definition', () => {
    expect(metrics.map((m) => m.code)).toEqual(CANONICAL_METRIC_CODES);
    for (const m of metrics) {
      const code = m.code;
      if (!isCanonicalMetricCode(code)) throw new Error(`not canonical: ${code}`);
      const canonical = CANONICAL_METRICS[code];
      expect(m.unit).toBe(canonical.unit);
      expect(m.source).toBe(canonical.source);
      expect(m.direction).toBe(canonical.direction);
      expect(m.isCanonical).toBe(true);
      expect(isWellFormedCode(m.code)).toBe(true);
      expect(m.testCode === null, code).toBe(m.source !== 'test');
    }
  });

  it('maps OpenField columns to field metrics, never one alias to two metrics', () => {
    const seen = new Map<string, string>();
    for (const [code, aliases] of Object.entries(DEFAULT_CATAPULT_ALIASES)) {
      expect(isCanonicalMetricCode(code), code).toBe(true);
      for (const alias of aliases) {
        const key = normalizeCatapultAlias(alias);
        expect(seen.get(key), `${alias} → ${code}`).toBeUndefined();
        seen.set(key, code);
      }
    }
    const byCode = new Map(metrics.map((m) => [m.code, m.catapultAliases]));
    expect(byCode.get('dist_m')).toContain('Total Distance');
    expect(byCode.get('vmax_ms')).toContain('Maximum Velocity');
    expect(byCode.get('accel_load_au')).toContain('Total Player Load');
    expect(byCode.get('cmj_height_cm')).toEqual([]);
  });

  it('normalizes aliases for matching', () => {
    expect(normalizeCatapultAlias('  Total   distance ')).toBe('total distance');
  });
});

describe('test definitions seed', () => {
  const tests = testDefinitionSeeds();

  it('defines version 1 of every test of the battery', () => {
    expect(tests.map((t) => t.code)).toEqual([...CANONICAL_TEST_CODES]);
    for (const t of tests) {
      expect(t.metrics.length, t.code).toBeGreaterThan(0);
      expect(t.protocol.summary, t.code).toBeTruthy();
      expect(t.attemptCount).toBeGreaterThanOrEqual(1);
    }
  });

  it('takes attempts and settings from the domain scoring', () => {
    const byCode = new Map(tests.map((t) => [t.code, t]));
    expect(byCode.get('sprint_40')?.attemptCount).toBe(
      DEFAULT_ATTEMPT_SCORING.sprint_40_s.plannedAttempts,
    );
    expect(byCode.get('cmj')?.attemptCount).toBe(
      DEFAULT_ATTEMPT_SCORING.cmj_height_cm.plannedAttempts,
    );
    expect(byCode.get('cmj')?.protocol.parameters?.gravityMs2).toBe(9.81);
    expect(byCode.get('sprint_40')?.protocol.parameters).toMatchObject({
      vmaxFromM: 20,
      vmaxToM: 40,
    });
    expect(byCode.get('ift_3015')?.protocol.parameters).toEqual({ ...DEFAULT_IFT_3015_PROTOCOL });
    expect(byCode.get('anthro')?.protocol.parameters?.adultHeightTableCode).toBe(
      KHAMIS_ROCHE_1994_TABLE.code,
    );
  });

  it('marks derived metrics, and only metrics of the test', () => {
    const all = tests.flatMap((t) => t.metrics);
    for (const code of DERIVED_TEST_METRIC_CODES) expect(all).toContain(code);
  });

  it('keeps bronco and neck to rugby', () => {
    const sportsOf = (code: CanonicalTestCode) => tests.find((t) => t.code === code)?.sports;
    expect(sportsOf('bronco')).toEqual(['rugby']);
    expect(sportsOf('neck')).toEqual(['rugby']);
    expect(sportsOf('cmj')).toBeNull();
  });
});

describe('battery seed (CLAUDE.md 3.2)', () => {
  const rugby = batterySeeds('rugby', 'male');
  const hockey = batterySeeds('hockey', 'female');
  const row = (rows: BatterySeed[], test: CanonicalTestCode, stage: Stage) =>
    rows.find((r) => r.testCode === test && r.stage === stage);

  it('schedules windows per stage', () => {
    expect(row(rugby, 'sprint_40', 'foundation')?.windows).toEqual([1, 2, 3, 4]);
    expect(row(rugby, 'cod_505', 'foundation')?.windows).toEqual([1, 3]);
    expect(row(rugby, 'cod_505', 'development')?.windows).toEqual([1, 2, 3, 4]);
    expect(row(rugby, 'ift_3015', 'foundation')?.windows).toEqual([1, 3]);
    expect(row(rugby, 'mobility', 'performance')?.windows).toEqual([1, 3]);
    expect(row(rugby, 'reaction', 'development')?.windows).toEqual([1, 3]);
    expect(row(rugby, 'strength', 'foundation')?.windows).toEqual([1, 2, 3, 4]);
  });

  it('runs anthropometry continuously at the stage cadence and adds a weekly CMJ in performance', () => {
    for (const stage of ['foundation', 'development', 'performance'] as const) {
      const anthro = row(rugby, 'anthro', stage);
      expect(anthro?.windows).toEqual([]);
      expect(anthro?.cadenceWeeksMin).toBe(STAGE_PROFILES[stage].anthropometryEveryWeeks.min);
      expect(anthro?.cadenceWeeksMax).toBe(STAGE_PROFILES[stage].anthropometryEveryWeeks.max);
    }
    expect(row(rugby, 'cmj', 'performance')).toMatchObject({
      windows: [1, 2, 3, 4],
      cadenceWeeksMin: 1,
      cadenceWeeksMax: 1,
    });
    expect(row(rugby, 'cmj', 'development')?.cadenceWeeksMin).toBeNull();
  });

  it('does bronco only in performance and neck from development, in rugby only', () => {
    expect(rugby.filter((r) => r.testCode === 'bronco').map((r) => r.stage)).toEqual([
      'performance',
    ]);
    expect(row(rugby, 'neck', 'foundation')).toBeUndefined();
    expect(row(rugby, 'neck', 'development')?.windows).toEqual([1, 3]);
    expect(row(rugby, 'neck', 'performance')?.windows).toEqual([1, 2, 3, 4]);
    expect(hockey.some((r) => r.testCode === 'bronco' || r.testCode === 'neck')).toBe(false);
    expect(hockey.every((r) => r.sport === 'hockey' && r.sex === 'female')).toBe(true);
  });

  it('never seeds an unscheduled row', () => {
    for (const r of [...rugby, ...hockey]) {
      expect(r.windows.length > 0 || r.cadenceWeeksMin !== null).toBe(true);
    }
  });
});

describe('Khamis-Roche seed', () => {
  it('copies the domain table row by row', () => {
    const header = khamisRocheTableSeed(KHAMIS_ROCHE_1994_TABLE);
    expect(header.code).toBe('khamis_roche_1994');
    expect(header.verification).toBe(KHAMIS_ROCHE_1994_TABLE.provenance.verification);
    const rows = khamisRocheCoefficientSeeds(KHAMIS_ROCHE_1994_TABLE);
    expect(rows).toHaveLength(
      KHAMIS_ROCHE_1994_TABLE.rows.male.length + KHAMIS_ROCHE_1994_TABLE.rows.female.length,
    );
    expect(
      rows
        .filter((r) => r.sex === 'male')
        .map(({ ageYears, interceptIn, heightInCoef, weightLbCoef, midparentHeightInCoef }) => ({
          ageYears,
          interceptIn,
          heightInCoef,
          weightLbCoef,
          midparentHeightInCoef,
        })),
    ).toEqual(KHAMIS_ROCHE_1994_TABLE.rows.male);
  });
});

describe('ORC tenant', () => {
  it('has men’s rugby and women’s hockey with the ORC brand', () => {
    expect(ORC_TENANT.slug).toBe('orc');
    expect(ORC_TENANT.branches).toEqual([
      { sport: 'rugby', sex: 'male' },
      { sport: 'hockey', sex: 'female' },
    ]);
    expect(ORC_TENANT.branding.primaryColor?.toLowerCase()).toBe('#f1882a');
    expect(ORC_TENANT.timeZone).toBe('America/Argentina/Buenos_Aires');
  });
});
