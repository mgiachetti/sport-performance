import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALERT_RULES,
  DEFAULT_ALERT_RULE_SOURCES,
  DomainValidationError,
  addDays,
  alertRuleAppliesTo,
  cmjRollingBaseline,
  evaluateAlertRules,
  highestAlertSeverity,
  meanWellnessScore,
  parseAlertRule,
  parseLocalDate,
  type AlertEvaluation,
  type AlertRule,
  type AlertRuleKind,
  type PlayerDailyState,
  type Sex,
  type WellnessDailyScore,
} from '../index.js';

const DAY = parseLocalDate('2026-06-15');

function defaultRule(kind: AlertRuleKind): AlertRule {
  const rule = DEFAULT_ALERT_RULES.find((r) => r.kind === kind);
  if (rule === undefined) throw new Error(kind);
  return rule;
}

function only(kind: AlertRuleKind, state: Omit<PlayerDailyState, 'date'>): AlertEvaluation {
  return evaluateAlertRules([defaultRule(kind)], { date: DAY, ...state });
}

function severityOf(evaluation: AlertEvaluation): string | null {
  return evaluation.alerts[0]?.severity ?? null;
}

function reasonOf(evaluation: AlertEvaluation): string | null {
  return evaluation.skipped[0]?.reason ?? null;
}

/** `scores[i]` is the mean score `scores.length - i` days before DAY. */
function wellnessBefore(scores: readonly number[]): WellnessDailyScore[] {
  return scores.map((meanScore, i) => ({ date: addDays(DAY, i - scores.length), meanScore }));
}

describe('ACWR rules', () => {
  const acwr = (ratio: number | null, historyDays = 40): Omit<PlayerDailyState, 'date'> => ({
    acwr: { ratio, historyDays },
  });

  it.each([
    [1.3, null],
    [1.31, 'warning'],
    [1.4, 'warning'],
    [1.41, 'critical'],
    [2.5, 'critical'],
    [1.0, null],
  ])('acwr_high at %s → %s', (ratio, severity) => {
    expect(severityOf(only('acwr_high', acwr(ratio)))).toBe(severity);
  });

  it.each([
    [0.8, null],
    [0.79, 'warning'],
    [0.1, 'warning'],
    [1.5, null],
  ])('acwr_low at %s → %s', (ratio, severity) => {
    expect(severityOf(only('acwr_low', acwr(ratio)))).toBe(severity);
  });

  it('stays silent with insufficient history (< 28 days)', () => {
    for (const kind of ['acwr_high', 'acwr_low'] as const) {
      const evaluation = only(kind, acwr(kind === 'acwr_high' ? 3 : 0.1, 27));
      expect(evaluation.alerts).toEqual([]);
      expect(reasonOf(evaluation)).toBe('insufficient_history');
    }
    expect(severityOf(only('acwr_high', acwr(3, 28)))).toBe('critical');
  });

  it('skips when the ratio cannot be computed or is missing', () => {
    expect(reasonOf(only('acwr_high', acwr(null)))).toBe('no_data');
    expect(reasonOf(only('acwr_high', {}))).toBe('no_data');
    expect(reasonOf(only('acwr_high', { acwr: null }))).toBe('no_data');
  });

  it('builds the alert with keys and values, no UI text', () => {
    const { alerts, skipped } = only('acwr_high', acwr(1.5, 35));
    expect(skipped).toEqual([]);
    expect(alerts).toEqual([
      {
        ruleCode: 'acwr_high',
        kind: 'acwr_high',
        severity: 'critical',
        date: DAY,
        observedOn: DAY,
        messageKey: 'alert.acwr_high.message',
        suggestionKey: 'alert.acwr_high.suggestion',
        values: { acwrRatio: 1.5, thresholdRatio: 1.4, historyDays: 35 },
      },
    ]);
  });
});

describe('wellness_low', () => {
  const today = (meanScore: number): Omit<PlayerDailyState, 'date'> => ({
    wellness: [{ date: DAY, meanScore }],
  });

  it.each([
    [3.3, null],
    [3.29, 'warning'],
    [3.0, 'warning'],
    [2.99, 'critical'],
    [1, 'critical'],
    [4.5, null],
  ])('at %s → %s', (score, severity) => {
    expect(severityOf(only('wellness_low', today(score)))).toBe(severity);
  });

  it('uses only the evaluated day', () => {
    const evaluation = only('wellness_low', { wellness: wellnessBefore([1, 1, 1]) });
    expect(reasonOf(evaluation)).toBe('no_data');
  });

  it('works with the mean of the answered items', () => {
    // 3 items (M13/M14): (3 + 3 + 4) / 3 = 3.33 → no alert.
    const score3 = meanWellnessScore({ sleep: 3, fatigue: 3, mood: 4 });
    expect(severityOf(only('wellness_low', today(score3)))).toBeNull();
    // 5 items: (3 + 3 + 3 + 4 + 3) / 5 = 3.2 → warning.
    const score5 = meanWellnessScore({ sleep: 3, fatigue: 3, soreness: 3, stress: 4, mood: 3 });
    expect(severityOf(only('wellness_low', today(score5)))).toBe('warning');
  });
});

describe('meanWellnessScore', () => {
  it('ignores unanswered items', () => {
    expect(meanWellnessScore({ sleep: 5, fatigue: null, mood: 3 })).toBe(4);
  });

  it('rejects empty answers and out-of-scale scores', () => {
    expect(() => meanWellnessScore({})).toThrow(DomainValidationError);
    expect(() => meanWellnessScore({ sleep: 0 })).toThrow(DomainValidationError);
    expect(() => meanWellnessScore({ sleep: 6 })).toThrow(DomainValidationError);
    expect(() => meanWellnessScore({ sleep: Number.NaN })).toThrow(DomainValidationError);
  });
});

describe('wellness_zscore_low', () => {
  // Alternating 4 / 5 over 28 days: mean 4.5, sample SD = sqrt(28 · 0.25 / 27) ≈ 0.509.
  const history = wellnessBefore(Array.from({ length: 28 }, (_, i) => (i % 2 === 0 ? 4 : 5)));
  const sd = Math.sqrt((28 * 0.25) / 27);

  it('alerts below −1.5 SD of the own rolling mean, even when the absolute score is fine', () => {
    const score = 4.5 - 1.6 * sd; // ≈ 3.69, above the absolute 3.3 threshold
    const evaluation = evaluateAlertRules(DEFAULT_ALERT_RULES, {
      date: DAY,
      wellness: [...history, { date: DAY, meanScore: score }],
    });
    expect(evaluation.alerts.map((a) => a.ruleCode)).toEqual(['wellness_zscore_low']);
    const alert = evaluation.alerts[0];
    expect(alert?.severity).toBe('warning');
    expect(alert?.values.zScore).toBeCloseTo(-1.6, 9);
    expect(alert?.values.meanScore).toBeCloseTo(4.5, 9);
    expect(alert?.values.sdScore).toBeCloseTo(sd, 9);
    expect(alert?.values.samples).toBe(28);
  });

  it('does not alert at exactly −1.5 SD', () => {
    const score = 4.5 - 1.5 * sd;
    const evaluation = only('wellness_zscore_low', {
      wellness: [...history, { date: DAY, meanScore: score }],
    });
    expect(evaluation.alerts).toEqual([]);
    expect(evaluation.skipped).toEqual([]);
  });

  it('excludes the evaluated day and days outside the window', () => {
    // A very low day 29 days ago is outside the 28-day window and must not change the mean.
    const old = { date: addDays(DAY, -29), meanScore: 1 };
    const evaluation = only('wellness_zscore_low', {
      wellness: [old, ...history, { date: DAY, meanScore: 4 }],
    });
    expect(evaluation.alerts).toEqual([]);
  });

  it('needs minSamples days of history', () => {
    const evaluation = only('wellness_zscore_low', {
      wellness: [...wellnessBefore([4, 5, 4, 5, 4, 5, 4, 5, 4]), { date: DAY, meanScore: 1 }],
    });
    expect(reasonOf(evaluation)).toBe('insufficient_history');
  });

  it('skips when the history has no variation', () => {
    const evaluation = only('wellness_zscore_low', {
      wellness: [...wellnessBefore(Array<number>(14).fill(4)), { date: DAY, meanScore: 2 }],
    });
    expect(reasonOf(evaluation)).toBe('no_variance');
  });

  it('skips without wellness for the day', () => {
    expect(reasonOf(only('wellness_zscore_low', { wellness: history }))).toBe('no_data');
  });

  it('supports a critical level', () => {
    const rule = parseAlertRule({
      code: 'wellness_z',
      kind: 'wellness_zscore_low',
      enabled: true,
      params: { warningBelowZScore: -1, criticalBelowZScore: -2, windowDays: 28, minSamples: 10 },
    });
    const state = (z: number): PlayerDailyState => ({
      date: DAY,
      wellness: [...history, { date: DAY, meanScore: 4.5 + z * sd }],
    });
    expect(severityOf(evaluateAlertRules([rule], state(-2.1)))).toBe('critical');
    expect(severityOf(evaluateAlertRules([rule], state(-1.1)))).toBe('warning');
  });
});

describe('cmj_drop', () => {
  const baseline = [
    { date: addDays(DAY, -21), heightCm: 39 },
    { date: addDays(DAY, -14), heightCm: 41 },
    { date: addDays(DAY, -7), heightCm: 40 },
  ];

  it('alerts when more than 7 % below the rolling baseline', () => {
    const evaluation = only('cmj_drop', {
      cmj: { measurements: [...baseline, { date: DAY, heightCm: 37 }] },
    });
    expect(evaluation.alerts).toHaveLength(1);
    const alert = evaluation.alerts[0];
    expect(alert?.severity).toBe('warning');
    expect(alert?.observedOn).toBe(DAY);
    expect(alert?.values).toEqual({
      heightCm: 37,
      baselineHeightCm: 40,
      dropPct: 7.5,
      thresholdPct: 7,
      baselineSamples: 3,
    });
  });

  it('does not alert at exactly 7 % (despite floating-point error)', () => {
    // (40 − 37.2) / 40 · 100 = 7.000000000000001 in floating point.
    const evaluation = only('cmj_drop', {
      cmj: { measurements: [...baseline, { date: DAY, heightCm: 37.2 }] },
    });
    expect(evaluation.alerts).toEqual([]);
  });

  it('takes the best result of each day', () => {
    const evaluation = only('cmj_drop', {
      cmj: {
        measurements: [
          ...baseline,
          { date: addDays(DAY, -7), heightCm: 30 },
          { date: DAY, heightCm: 30 },
          { date: DAY, heightCm: 38 },
        ],
      },
    });
    expect(evaluation.alerts).toEqual([]);
  });

  it('prefers a baseline pinned by staff', () => {
    const evaluation = only('cmj_drop', {
      cmj: { measurements: [{ date: DAY, heightCm: 40 }], baselineHeightCm: 45 },
    });
    expect(evaluation.alerts[0]?.values).toMatchObject({
      baselineHeightCm: 45,
      baselineSamples: 0,
    });
  });

  it('keeps alerting for a recent CMJ and stops once it is stale', () => {
    const latest = [...baseline, { date: addDays(DAY, -3), heightCm: 36 }];
    const alert = only('cmj_drop', { cmj: { measurements: latest } }).alerts[0];
    expect(alert?.observedOn).toBe(addDays(DAY, -3));
    const stale = [
      { date: addDays(DAY, -40), heightCm: 40 },
      { date: addDays(DAY, -30), heightCm: 40 },
      { date: addDays(DAY, -20), heightCm: 40 },
      { date: addDays(DAY, -8), heightCm: 30 },
    ];
    expect(reasonOf(only('cmj_drop', { cmj: { measurements: stale } }))).toBe('stale_data');
  });

  it('needs enough baseline measurements', () => {
    const evaluation = only('cmj_drop', {
      cmj: { measurements: [...baseline.slice(1), { date: DAY, heightCm: 30 }] },
    });
    expect(reasonOf(evaluation)).toBe('insufficient_history');
  });

  it('ignores measurements after the evaluated day', () => {
    const evaluation = only('cmj_drop', {
      cmj: {
        measurements: [...baseline, { date: addDays(DAY, 1), heightCm: 20 }],
        baselineHeightCm: 40,
      },
    });
    expect(evaluation.alerts).toEqual([]);
    expect(evaluation.skipped).toEqual([]);
  });

  it('skips without CMJ data', () => {
    expect(reasonOf(only('cmj_drop', {}))).toBe('no_data');
    expect(reasonOf(only('cmj_drop', { cmj: { measurements: [] } }))).toBe('no_data');
  });
});

describe('growth_peak', () => {
  const growth = (velocityCmYear: number | null, ageDays = 10): Omit<PlayerDailyState, 'date'> => ({
    sex: 'male',
    growth: { velocityCmYear, measuredOn: addDays(DAY, -ageDays) },
  });

  it.each([
    [7.1, null],
    [7.2, 'warning'],
    [10, 'warning'],
    [3, null],
  ])('at %s cm/year → %s', (velocity, severity) => {
    expect(severityOf(only('growth_peak', growth(velocity)))).toBe(severity);
  });

  it('reports the measurement date', () => {
    expect(only('growth_peak', growth(9, 30)).alerts[0]).toMatchObject({
      observedOn: addDays(DAY, -30),
      messageKey: 'alert.growth_peak.message',
      suggestionKey: 'alert.growth_peak.suggestion',
      values: { velocityCmYear: 9, thresholdCmYear: 7.2 },
    });
  });

  it('skips stale, missing or future measurements', () => {
    expect(severityOf(only('growth_peak', growth(9, 120)))).toBe('warning');
    expect(reasonOf(only('growth_peak', growth(9, 121)))).toBe('stale_data');
    expect(reasonOf(only('growth_peak', growth(null)))).toBe('no_data');
    expect(reasonOf(only('growth_peak', growth(9, -1)))).toBe('no_data');
    expect(reasonOf(only('growth_peak', { sex: 'male' }))).toBe('no_data');
  });
});

describe('growth peak by sex (B-804)', () => {
  const growthOf = (sex: Sex, velocityCmYear: number): PlayerDailyState => ({
    date: DAY,
    sport: 'hockey',
    sex,
    growth: { velocityCmYear, measuredOn: addDays(DAY, -10) },
  });
  const growthRules = DEFAULT_ALERT_RULES.filter((rule) => rule.kind === 'growth_peak');

  it('has one default growth rule per sex', () => {
    expect(growthRules.map((rule) => [rule.code, rule.appliesTo?.sexes])).toEqual([
      ['growth_peak', ['male']],
      ['growth_peak_female', ['female']],
    ]);
  });

  it.each([
    ['female', 5.9, []],
    ['female', 6, [['growth_peak_female', 6]]],
    ['female', 9, [['growth_peak_female', 6]]],
    ['male', 6.5, []],
    ['male', 7.2, [['growth_peak', 7.2]]],
  ] as const)('a %s player at %s cm/year raises %j', (sex, velocity, expected) => {
    const evaluation = evaluateAlertRules(growthRules, growthOf(sex, velocity));
    expect(evaluation.alerts.map((a) => [a.ruleCode, a.values.thresholdCmYear])).toEqual(expected);
    // The rule of the other sex never reaches the player.
    expect(evaluation.skipped).toContainEqual({
      ruleCode: sex === 'female' ? 'growth_peak' : 'growth_peak_female',
      kind: 'growth_peak',
      reason: 'not_applicable',
    });
  });

  it('skips both growth rules when the sex is unknown', () => {
    const evaluation = evaluateAlertRules(growthRules, {
      date: DAY,
      growth: { velocityCmYear: 9, measuredOn: addDays(DAY, -10) },
    });
    expect(evaluation.alerts).toEqual([]);
    expect(evaluation.skipped.map((s) => s.reason)).toEqual(['not_applicable', 'not_applicable']);
  });

  it('cites the source of every sex-specific default, unverified until checked', () => {
    const scoped = DEFAULT_ALERT_RULES.filter((rule) => rule.appliesTo?.sexes !== undefined);
    expect(scoped.map((rule) => rule.code).sort()).toEqual(
      Object.keys(DEFAULT_ALERT_RULE_SOURCES).sort(),
    );
    for (const source of Object.values(DEFAULT_ALERT_RULE_SOURCES)) {
      expect(source.citation.length).toBeGreaterThan(20);
      expect(source.verification).toBe('unverified');
      expect(source.verificationNotes).toMatch(/before production/);
    }
  });
});

describe('evaluateAlertRules', () => {
  const badDay: PlayerDailyState = {
    date: DAY,
    sport: 'rugby',
    sex: 'male',
    stage: 'development',
    acwr: { ratio: 1.35, historyDays: 60 },
    wellness: [{ date: DAY, meanScore: 2.8 }],
    cmj: {
      measurements: [
        { date: addDays(DAY, -14), heightCm: 40 },
        { date: addDays(DAY, -10), heightCm: 40 },
        { date: addDays(DAY, -7), heightCm: 40 },
        { date: DAY, heightCm: 36 },
      ],
    },
    growth: { velocityCmYear: 8, measuredOn: addDays(DAY, -20) },
  };

  it('evaluates the default rule set, most severe first then rule order', () => {
    const evaluation = evaluateAlertRules(DEFAULT_ALERT_RULES, badDay);
    expect(evaluation.date).toBe(DAY);
    expect(evaluation.alerts.map((a) => [a.ruleCode, a.severity])).toEqual([
      ['wellness_low', 'critical'],
      ['acwr_high', 'warning'],
      ['cmj_drop', 'warning'],
      ['growth_peak', 'warning'],
    ]);
    expect(evaluation.skipped).toEqual([
      {
        ruleCode: 'wellness_zscore_low',
        kind: 'wellness_zscore_low',
        reason: 'insufficient_history',
      },
      { ruleCode: 'growth_peak_female', kind: 'growth_peak', reason: 'not_applicable' },
    ]);
    expect(highestAlertSeverity(evaluation.alerts)).toBe('critical');
  });

  it('raises nothing on an empty state', () => {
    const evaluation = evaluateAlertRules(DEFAULT_ALERT_RULES, { date: DAY });
    expect(evaluation.alerts).toEqual([]);
    // Without a sex the growth rules (one per sex) do not apply.
    expect(evaluation.skipped.map((s) => s.reason)).toEqual([
      ...Array<string>(5).fill('no_data'),
      'not_applicable',
      'not_applicable',
    ]);
    expect(highestAlertSeverity(evaluation.alerts)).toBeNull();
  });

  it('skips disabled rules', () => {
    const rules = DEFAULT_ALERT_RULES.map((r) =>
      r.kind === 'wellness_low' ? { ...r, enabled: false } : r,
    );
    const evaluation = evaluateAlertRules(rules, badDay);
    expect(evaluation.alerts.map((a) => a.ruleCode)).not.toContain('wellness_low');
    expect(evaluation.skipped).toContainEqual({
      ruleCode: 'wellness_low',
      kind: 'wellness_low',
      reason: 'disabled',
    });
  });

  it('applies rules only within their scope', () => {
    const female = parseAlertRule({
      code: 'acwr_high_female',
      kind: 'acwr_high',
      enabled: true,
      appliesTo: { sexes: ['female'], sports: ['hockey'] },
      params: { warningAboveRatio: 1.2, criticalAboveRatio: null, minHistoryDays: 28 },
    });
    const hockeyPlayer: PlayerDailyState = {
      date: DAY,
      sport: 'hockey',
      sex: 'female',
      acwr: { ratio: 1.25, historyDays: 40 },
    };
    expect(severityOf(evaluateAlertRules([female], hockeyPlayer))).toBe('warning');
    expect(reasonOf(evaluateAlertRules([female], { ...hockeyPlayer, sex: 'male' }))).toBe(
      'not_applicable',
    );
    const unknownSex: PlayerDailyState = {
      date: DAY,
      sport: 'hockey',
      acwr: hockeyPlayer.acwr ?? null,
    };
    expect(reasonOf(evaluateAlertRules([female], unknownSex))).toBe('not_applicable');
    const byStage = parseAlertRule({ ...female, code: 's', appliesTo: { stages: ['foundation'] } });
    expect(reasonOf(evaluateAlertRules([byStage], { ...hockeyPlayer, stage: 'performance' }))).toBe(
      'not_applicable',
    );
  });

  it('can re-evaluate a past day with the full history', () => {
    const history = wellnessBefore([4, 2.5, 4]); // 2.5 was two days before DAY
    const past = addDays(DAY, -2);
    const evaluation = evaluateAlertRules([defaultRule('wellness_low')], {
      date: past,
      wellness: history,
    });
    expect(evaluation.alerts[0]).toMatchObject({
      date: past,
      observedOn: past,
      severity: 'critical',
    });
  });

  it('rejects malformed state', () => {
    const rules = DEFAULT_ALERT_RULES;
    const bad: unknown[] = [
      { date: '2026-13-01' },
      { date: DAY, acwr: { ratio: Number.POSITIVE_INFINITY, historyDays: 30 } },
      { date: DAY, acwr: { ratio: -1, historyDays: 30 } },
      { date: DAY, acwr: { ratio: 1, historyDays: 1.5 } },
      { date: DAY, wellness: [{ date: DAY, meanScore: 7 }] },
      {
        date: DAY,
        wellness: [
          { date: DAY, meanScore: 3 },
          { date: DAY, meanScore: 4 },
        ],
      },
      { date: DAY, cmj: { measurements: [{ date: DAY, heightCm: 0 }] } },
      { date: DAY, cmj: { measurements: [], baselineHeightCm: -3 } },
      { date: DAY, growth: { velocityCmYear: Number.NaN, measuredOn: DAY } },
      { date: DAY, growth: { velocityCmYear: 8, measuredOn: 'yesterday' } },
    ];
    for (const state of bad) {
      expect(() => evaluateAlertRules(rules, state as PlayerDailyState)).toThrow(
        DomainValidationError,
      );
    }
  });

  it('is pure: the inputs are not mutated', () => {
    const wellness = [
      { date: DAY, meanScore: 2 },
      { date: addDays(DAY, -1), meanScore: 4 },
    ];
    const frozen = Object.freeze(wellness.map((w) => Object.freeze(w)));
    expect(() =>
      evaluateAlertRules(Object.freeze([...DEFAULT_ALERT_RULES]), { date: DAY, wellness: frozen }),
    ).not.toThrow();
    expect(frozen[0]?.date).toBe(DAY);
  });
});

describe('cmjRollingBaseline', () => {
  const params = { baselineWindowDays: 42, minBaselineSamples: 3 };

  it('is the mean of the best jump per day before the day, inside the window', () => {
    const baseline = cmjRollingBaseline(
      [
        { date: addDays(DAY, -50), heightCm: 60 }, // outside the window
        { date: addDays(DAY, -21), heightCm: 38 },
        { date: addDays(DAY, -21), heightCm: 39 }, // same day: the best counts
        { date: addDays(DAY, -14), heightCm: 41 },
        { date: addDays(DAY, -7), heightCm: 40 },
        { date: DAY, heightCm: 30 }, // the day itself is not its own baseline
        { date: addDays(DAY, 3), heightCm: 10 }, // after the day: ignored
      ],
      DAY,
      params,
    );
    expect(baseline).toEqual({ heightCm: 40, samples: 3, minSamples: 3, from: addDays(DAY, -42) });
  });

  it('has no height with fewer days than the rule needs', () => {
    expect(
      cmjRollingBaseline(
        [
          { date: addDays(DAY, -14), heightCm: 41 },
          { date: addDays(DAY, -7), heightCm: 40 },
        ],
        DAY,
        params,
      ),
    ).toMatchObject({ heightCm: null, samples: 2, minSamples: 3 });
    expect(cmjRollingBaseline([], DAY, params)).toMatchObject({ heightCm: null, samples: 0 });
  });

  it('is the baseline the cmj_drop rule compares with', () => {
    const measurements = [
      { date: addDays(DAY, -30), heightCm: 42.5 },
      { date: addDays(DAY, -20), heightCm: 41 },
      { date: addDays(DAY, -10), heightCm: 43 },
      { date: DAY, heightCm: 38 },
    ];
    const alert = only('cmj_drop', { cmj: { measurements } }).alerts[0];
    expect(alert?.values.baselineHeightCm).toBe(
      cmjRollingBaseline(measurements, DAY, params).heightCm,
    );
  });

  it('refuses malformed jumps', () => {
    expect(() => cmjRollingBaseline([{ date: DAY, heightCm: 0 }], DAY, params)).toThrow(
      DomainValidationError,
    );
  });
});

describe('alertRuleAppliesTo', () => {
  it('matches every dimension present in the scope', () => {
    const rule = parseAlertRule({
      ...defaultRule('cmj_drop'),
      appliesTo: { stages: ['performance'], sexes: ['male'] },
    });
    expect(alertRuleAppliesTo(rule, { stage: 'performance', sex: 'male', sport: 'rugby' })).toBe(
      true,
    );
    expect(alertRuleAppliesTo(rule, { stage: 'performance', sex: 'female' })).toBe(false);
    expect(alertRuleAppliesTo(rule, { sex: 'male' })).toBe(false);
    expect(alertRuleAppliesTo(defaultRule('cmj_drop'), {})).toBe(true);
  });
});
