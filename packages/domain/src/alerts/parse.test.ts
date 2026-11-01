import { describe, expect, it } from 'vitest';
import {
  ALERT_RULE_KINDS,
  AlertRuleValidationError,
  DEFAULT_ALERT_RULES,
  DomainValidationError,
  parseAlertRule,
  parseAlertRuleSet,
} from '../index.js';

const acwrHigh = {
  code: 'acwr_high',
  kind: 'acwr_high',
  enabled: true,
  params: { warningAboveRatio: 1.3, criticalAboveRatio: 1.4, minHistoryDays: 28 },
};

function expectInvalid(value: unknown, path: string): void {
  let error: unknown;
  try {
    parseAlertRuleSet(value);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(AlertRuleValidationError);
  expect(error).toBeInstanceOf(DomainValidationError);
  expect((error as AlertRuleValidationError).code).toBe('invalid_argument');
  expect((error as AlertRuleValidationError).path).toBe(path);
}

function withParams(params: Record<string, unknown>): unknown {
  return [{ ...acwrHigh, params: { ...acwrHigh.params, ...params } }];
}

describe('DEFAULT_ALERT_RULES', () => {
  it('survives a JSON round trip unchanged (ready for the seed)', () => {
    const json: unknown = JSON.parse(JSON.stringify(DEFAULT_ALERT_RULES));
    expect(parseAlertRuleSet(json)).toEqual(DEFAULT_ALERT_RULES);
  });

  it('covers every rule kind once', () => {
    expect(DEFAULT_ALERT_RULES.map((r) => r.kind).sort()).toEqual([...ALERT_RULE_KINDS].sort());
  });

  it('carries the thresholds of CLAUDE.md', () => {
    const byCode = new Map(DEFAULT_ALERT_RULES.map((r) => [r.code, r.params]));
    expect(byCode.get('acwr_high')).toMatchObject({
      warningAboveRatio: 1.3,
      criticalAboveRatio: 1.4,
      minHistoryDays: 28,
    });
    expect(byCode.get('acwr_low')).toMatchObject({ warningBelowRatio: 0.8, minHistoryDays: 28 });
    expect(byCode.get('wellness_low')).toMatchObject({
      warningBelowScore: 3.3,
      criticalBelowScore: 3.0,
    });
    expect(byCode.get('cmj_drop')).toMatchObject({ warningDropPct: 7 });
    expect(DEFAULT_ALERT_RULES.every((r) => r.enabled)).toBe(true);
  });
});

describe('parseAlertRule', () => {
  it('returns a normalised copy', () => {
    const input = { ...acwrHigh, appliesTo: { sexes: ['female', 'female'], sports: ['hockey'] } };
    const rule = parseAlertRule(input);
    expect(rule).toEqual({ ...acwrHigh, appliesTo: { sexes: ['female'], sports: ['hockey'] } });
    expect(rule).not.toBe(input);
    expect(rule.params).not.toBe(input.params);
  });

  it('accepts a rule with a single severity', () => {
    expect(
      parseAlertRule({ ...acwrHigh, params: { ...acwrHigh.params, warningAboveRatio: null } }),
    ).toMatchObject({ params: { warningAboveRatio: null, criticalAboveRatio: 1.4 } });
  });

  it('reports the path of the invalid field', () => {
    let error: unknown;
    try {
      parseAlertRule({ ...acwrHigh, params: { ...acwrHigh.params, criticalAboveRatio: 'x' } });
    } catch (e) {
      error = e;
    }
    expect((error as AlertRuleValidationError).path).toBe('params.criticalAboveRatio');
    expect((error as Error).message).toContain('params.criticalAboveRatio');
  });
});

describe('parseAlertRuleSet rejects', () => {
  it.each([
    ['a non-array', {}, ''],
    ['a non-object rule', [1], '[0]'],
    ['an unknown rule field', [{ ...acwrHigh, severity: 'critical' }], '[0].severity'],
    ['a bad code', [{ ...acwrHigh, code: 'ACWR High' }], '[0].code'],
    ['an unknown kind', [{ ...acwrHigh, kind: 'hrv_low' }], '[0].kind'],
    ['a non-boolean enabled', [{ ...acwrHigh, enabled: 'yes' }], '[0].enabled'],
    ['missing params', [{ ...acwrHigh, params: undefined }], '[0].params'],
    ['a typo in params', withParams({ warningAbove: 1.3 }), '[0].params.warningAbove'],
    [
      'a missing threshold key',
      [{ ...acwrHigh, params: { criticalAboveRatio: 1.4, minHistoryDays: 28 } }],
      '[0].params.warningAboveRatio',
    ],
    [
      'a non-finite threshold',
      withParams({ warningAboveRatio: Number.NaN }),
      '[0].params.warningAboveRatio',
    ],
    ['a non-positive ratio', withParams({ warningAboveRatio: 0 }), '[0].params.warningAboveRatio'],
    [
      'no threshold at all',
      withParams({ warningAboveRatio: null, criticalAboveRatio: null }),
      '[0].params',
    ],
    [
      'critical milder than warning',
      withParams({ criticalAboveRatio: 1.2 }),
      '[0].params.criticalAboveRatio',
    ],
    ['a fractional history', withParams({ minHistoryDays: 27.5 }), '[0].params.minHistoryDays'],
    ['a negative history', withParams({ minHistoryDays: -1 }), '[0].params.minHistoryDays'],
    ['duplicate codes', [acwrHigh, acwrHigh], '[1].code'],
    ['an empty scope list', [{ ...acwrHigh, appliesTo: { sports: [] } }], '[0].appliesTo.sports'],
    [
      'an unknown scope value',
      [{ ...acwrHigh, appliesTo: { stages: ['elite'] } }],
      '[0].appliesTo.stages[0]',
    ],
    [
      'an unknown scope field',
      [{ ...acwrHigh, appliesTo: { positions: ['hooker'] } }],
      '[0].appliesTo.positions',
    ],
  ])('%s', (_label, value, path) => {
    expectInvalid(value, path);
  });

  it('validates per-kind ranges and orderings', () => {
    const rule = (kind: string, params: Record<string, unknown>): unknown => [
      { code: 'r', kind, enabled: true, params },
    ];
    expectInvalid(
      rule('acwr_low', { warningBelowRatio: 0.8, criticalBelowRatio: 0.9, minHistoryDays: 28 }),
      '[0].params.criticalBelowRatio',
    );
    expectInvalid(
      rule('wellness_low', { warningBelowScore: 6, criticalBelowScore: null }),
      '[0].params.warningBelowScore',
    );
    expectInvalid(
      rule('wellness_low', { warningBelowScore: 3, criticalBelowScore: 3.3 }),
      '[0].params.criticalBelowScore',
    );
    expectInvalid(
      rule('wellness_zscore_low', {
        warningBelowZScore: 1,
        criticalBelowZScore: null,
        windowDays: 28,
        minSamples: 10,
      }),
      '[0].params.warningBelowZScore',
    );
    expectInvalid(
      rule('wellness_zscore_low', {
        warningBelowZScore: -1.5,
        criticalBelowZScore: null,
        windowDays: 7,
        minSamples: 10,
      }),
      '[0].params.minSamples',
    );
    expectInvalid(
      rule('wellness_zscore_low', {
        warningBelowZScore: -1.5,
        criticalBelowZScore: null,
        windowDays: 28,
        minSamples: 1,
      }),
      '[0].params.minSamples',
    );
    expectInvalid(
      rule('cmj_drop', {
        warningDropPct: 100,
        criticalDropPct: null,
        baselineWindowDays: 42,
        minBaselineSamples: 3,
        maxMeasurementAgeDays: 7,
      }),
      '[0].params.warningDropPct',
    );
    expectInvalid(
      rule('cmj_drop', {
        warningDropPct: 7,
        criticalDropPct: 5,
        baselineWindowDays: 42,
        minBaselineSamples: 3,
        maxMeasurementAgeDays: 7,
      }),
      '[0].params.criticalDropPct',
    );
    expectInvalid(
      rule('cmj_drop', {
        warningDropPct: 7,
        criticalDropPct: null,
        baselineWindowDays: 2,
        minBaselineSamples: 3,
        maxMeasurementAgeDays: 7,
      }),
      '[0].params.minBaselineSamples',
    );
    expectInvalid(
      rule('growth_peak', {
        warningAtOrAboveCmYear: 8,
        criticalAtOrAboveCmYear: 7,
        maxMeasurementAgeDays: 120,
      }),
      '[0].params.criticalAtOrAboveCmYear',
    );
    expectInvalid(
      rule('growth_peak', {
        warningAtOrAboveCmYear: 7.2,
        criticalAtOrAboveCmYear: null,
        maxMeasurementAgeDays: -1,
      }),
      '[0].params.maxMeasurementAgeDays',
    );
  });
});
