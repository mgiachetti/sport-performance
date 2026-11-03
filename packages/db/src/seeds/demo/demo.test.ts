import {
  DEFAULT_AGE_BANDS,
  DEFAULT_ALERT_RULES,
  STRENGTH_METRICS_BY_ASSESSMENT,
  addDays,
  computeLoadSeries,
  evaluateAlertRules,
  latestGrowthVelocity,
  meanWellnessScore,
  parseLocalDate,
  type AlertRuleKind,
  type LocalDate,
  type PlayerDailyState,
  type Stage,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  DEMO_SEED_ENVIRONMENTS,
  DemoOptionsError,
  DemoSeedRefusedError,
  assertDemoSeedAllowed,
  demoSeasonYear,
  demoSeedRefusals,
  generateDemoDataset,
  type DemoDataset,
  type DemoPlayer,
} from './index.js';
import { randomFor, stableUuid } from './random.js';

const d = (value: string): LocalDate => parseLocalDate(value);
const SMALL = { playersPerCohort: { rugby: 6, hockey: 6 }, historyDays: 35 } as const;

/** Every id and client uuid of a dataset, by table. */
function allIds(data: DemoDataset): string[] {
  const out: string[] = [];
  for (const [table, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Record<string, unknown>[]) {
      if (typeof row.id === 'string') out.push(`${table}:${row.id}`);
      if (typeof row.clientUuid === 'string') out.push(`${table}:client:${row.clientUuid}`);
    }
  }
  return out;
}

function rowsById(data: DemoDataset): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [table, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows as Record<string, unknown>[]) {
      if (typeof row.id === 'string') out.set(`${table}:${row.id}`, row);
    }
  }
  return out;
}

describe('deterministic primitives', () => {
  it('derive the same values and ids from the same key, and different ones otherwise', () => {
    const a = randomFor('k', 1);
    const b = randomFor('k', 1);
    const seq = (r: ReturnType<typeof randomFor>) => Array.from({ length: 5 }, () => r.next());
    expect(seq(a)).toEqual(seq(b));
    expect(seq(randomFor('k', 2))).not.toEqual(seq(randomFor('k', 1)));
    expect(stableUuid('x', 'y')).toBe(stableUuid('x', 'y'));
    expect(stableUuid('x', 'y')).not.toBe(stableUuid('xy'));
    expect(stableUuid('x')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const values = Array.from({ length: 2000 }, () => a.next());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});

describe('demo options', () => {
  it('rejects slugs that do not look like a demo, bad dates and tiny rosters', () => {
    const asOf = d('2026-11-02');
    expect(() => generateDemoDataset({ asOf, slug: 'orc' })).toThrow(DemoOptionsError);
    expect(() => generateDemoDataset({ asOf, slug: 'demo_x' })).toThrow(DemoOptionsError);
    expect(() => generateDemoDataset({ asOf: d('2024-06-01') })).toThrow(DemoOptionsError);
    expect(() => generateDemoDataset({ asOf, playersPerCohort: { rugby: 3 } })).toThrow(
      DemoOptionsError,
    );
    expect(() => generateDemoDataset({ asOf, emailDomain: 'not a domain' })).toThrow(
      DemoOptionsError,
    );
    expect(() => generateDemoDataset({ asOf, historyDays: 0 })).toThrow(DemoOptionsError);
  });

  it('puts December and January in the season that ended', () => {
    expect(demoSeasonYear(d('2026-01-31'))).toBe(2025);
    expect(demoSeasonYear(d('2026-02-01'))).toBe(2026);
    expect(demoSeasonYear(d('2026-12-15'))).toBe(2026);
  });
});

describe('the demo dataset', () => {
  const asOf = d('2026-11-02');
  const data = generateDemoDataset({ asOf, ...SMALL });

  it('is a pure function of its options', () => {
    expect(generateDemoDataset({ asOf, ...SMALL })).toEqual(data);
    const other = generateDemoDataset({ asOf, ...SMALL, seed: 'otra' });
    expect(other.players.map((p) => p.id)).not.toEqual(data.players.map((p) => p.id));
    expect(other.players.map((p) => p.firstName)).not.toEqual(data.players.map((p) => p.firstName));
  });

  it('has unique ids, and ids that depend on the slug', () => {
    const ids = allIds(data).map((key) => key.slice(key.indexOf(':') + 1));
    expect(new Set(ids).size).toBe(ids.length);
    const e2e = generateDemoDataset({ asOf, ...SMALL, slug: 'demo-e2e' });
    const shared = new Set(ids);
    expect(allIds(e2e).some((key) => shared.has(key.slice(key.indexOf(':') + 1)))).toBe(false);
  });

  it('is clearly fictitious', () => {
    expect(data.club).toMatchObject({
      slug: 'demo',
      name: 'Club Atlético Demo',
      shortName: 'DEMO',
    });
    for (const u of data.users) expect(u.email).toMatch(/^demo\.[a-z0-9.]+@example\.com$/);
    expect(new Set(data.users.map((u) => u.email)).size).toBe(data.users.length);
    for (const i of data.injuries) expect(i.diagnosis).toMatch(/ficticio/);
    for (const r of data.referenceValues) expect(r.source).toMatch(/ficticios/);
    const e2e = generateDemoDataset({ asOf, ...SMALL, slug: 'demo-e2e', emailDomain: 'demo.test' });
    expect(e2e.club.name).toBe('Club Atlético Demo (e2e)');
    for (const u of e2e.users) expect(u.email).toMatch(/^demo-e2e\.[a-z0-9.]+@demo\.test$/);
  });

  it('covers both sports and both sexes, every category of each branch', () => {
    expect(data.branches).toEqual([
      { sport: 'rugby', sex: 'male' },
      { sport: 'hockey', sex: 'female' },
    ]);
    for (const p of data.players) expect(p.sex).toBe(p.sport === 'rugby' ? 'male' : 'female');
    const current = data.playerCategories.filter((c) => c.validTo === null);
    for (const branch of data.branches) {
      for (const band of DEFAULT_AGE_BANDS) {
        expect(
          current.some(
            (c) => c.category.sport === branch.sport && c.category.ageBandCode === band.code,
          ),
        ).toBe(true);
      }
    }
    for (const sport of ['rugby', 'hockey'] as const) {
      expect(data.seasons.filter((s) => s.sport === sport).map((s) => s.name)).toEqual([
        '2025',
        '2026',
      ]);
      expect(data.testWindows.filter((w) => w.sport === sport)).toHaveLength(8);
    }
  });

  it('gives every player a guardian, consents and a category history without gaps', () => {
    const players = new Map(data.players.map((p) => [p.id, p]));
    for (const p of data.players) {
      expect(data.guardians.some((g) => g.playerId === p.id)).toBe(true);
      const types = data.consents.filter((c) => c.playerId === p.id && c.signerKind === 'guardian');
      expect(types.map((c) => c.type)).toEqual(expect.arrayContaining(['data', 'health']));
      const history = data.playerCategories
        .filter((c) => c.playerId === p.id)
        .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
      for (let i = 1; i < history.length; i++) {
        expect(history[i - 1]?.validTo).toBe(history[i]?.validFrom);
      }
      const last = history.at(-1);
      if (p.leftOn === null) expect(last?.validTo).toBeNull();
      else expect(last?.validTo).toBe(addDays(p.leftOn, 1));
    }
    // Adults sign their own consents (B-311) with their own account.
    const adultSigned = data.consents.filter((c) => c.signerKind === 'player');
    expect(adultSigned.length).toBeGreaterThan(0);
    for (const c of adultSigned) expect(c.signedBy).toBe(players.get(c.playerId)?.userId);
    // M19 players of 2025 graduated at the end of their season.
    const graduated = data.players.filter((p) => p.leftOn !== null);
    expect(graduated.length).toBeGreaterThan(0);
    for (const p of graduated) {
      expect(p).toMatchObject({ leftOn: '2025-11-30', leftReason: 'graduated' });
    }
  });

  it('follows the stage rules: wellness items, strength assessment, no load without participation', () => {
    const stageOfCategory = new Map<string, Stage>(
      DEFAULT_AGE_BANDS.map((b) => [b.code, b.defaultStage]),
    );
    const categoryOn = (playerId: string, date: LocalDate) =>
      data.playerCategories.find(
        (c) =>
          c.playerId === playerId &&
          c.validFrom <= date &&
          (c.validTo === null || date < c.validTo),
      );
    for (const w of data.wellness) {
      const stage = stageOfCategory.get(
        categoryOn(w.playerId, w.localDate)?.category.ageBandCode ?? '',
      );
      expect(w.itemCount).toBe(stage === 'foundation' ? 3 : 5);
      expect(w.stress === null).toBe(w.itemCount === 3);
    }
    for (const p of data.participations) {
      if (p.status === 'absent' || p.status === 'unavailable') {
        expect(p.minutes).toBeNull();
        expect(p.rpe).toBeNull();
      }
      expect(p.rpe === null).toBe(p.rpeReportedAt === null);
      expect(p.localDate < asOf).toBe(true);
    }
    const resultById = new Map(data.testResults.map((r) => [r.id, r]));
    const allowed: Record<Stage, readonly string[]> = {
      foundation: STRENGTH_METRICS_BY_ASSESSMENT.technique_reps,
      development: STRENGTH_METRICS_BY_ASSESSMENT.estimated_rm,
      performance: STRENGTH_METRICS_BY_ASSESSMENT.direct_rm,
    };
    for (const v of data.testValues) {
      expect(Number.isFinite(v.value)).toBe(true);
      const result = resultById.get(v.testResultId);
      expect(result?.status).toBe('done');
      if (result?.testCode !== 'strength') continue;
      const stage = stageOfCategory.get(
        categoryOn(result.playerId, result.measuredOn)?.category.ageBandCode ?? '',
      );
      expect(allowed[stage ?? 'foundation']).toContain(v.metricCode);
    }
    for (const r of data.testResults) {
      expect(r.exercise !== null).toBe(r.testCode === 'strength');
      if (r.status === 'done') expect(r.method).not.toBeNull();
      if (r.status === 'done' && r.testCode === 'reaction') expect(r.deviceId).not.toBeNull();
      expect(r.measuredOn < asOf).toBe(true);
    }
    // Every value of one entry shares its id, and Vmax comes from the splits of its attempt.
    const sprint = data.testValues.filter((v) => v.metricCode.startsWith('sprint_'));
    const byEntry = new Map<string, typeof sprint>();
    for (const v of sprint) byEntry.set(v.entryId, [...(byEntry.get(v.entryId) ?? []), v]);
    for (const values of byEntry.values()) {
      const get = (code: string) => values.find((v) => v.metricCode === code)?.value ?? Number.NaN;
      expect(get('sprint_10_s')).toBeLessThan(get('sprint_20_s'));
      expect(get('sprint_vmax_ms')).toBeCloseTo(20 / (get('sprint_40_s') - get('sprint_20_s')), 9);
    }
  });

  it('only describes the past, with today’s wellness and sessions but no RPE yet', () => {
    expect(data.wellness.some((w) => w.localDate === asOf)).toBe(true);
    expect(data.trainingSessions.every((s) => s.localDate <= asOf)).toBe(true);
    expect(data.anthropometry.every((a) => a.measuredOn <= asOf)).toBe(true);
    expect(
      data.testSessions.filter((s) => s.status === 'scheduled').every((s) => s.scheduledOn >= asOf),
    ).toBe(true);
    expect(data.testSessions.some((s) => s.status === 'scheduled')).toBe(true);
  });

  it('only adds rows when it reaches a later day, and moves a few of them forward', () => {
    const later = generateDemoDataset({ asOf: addDays(asOf, 10), ...SMALL, historyDays: 45 });
    const before = rowsById(data);
    const after = rowsById(later);
    const moving: Record<string, readonly string[]> = {
      players: ['leftOn', 'leftReason', 'archivedAt', 'userId'],
      playerCategories: ['validTo'],
      injuries: ['returnedOn'],
      testSessions: ['status', 'startedAt', 'completedAt'],
    };
    let compared = 0;
    for (const [key, row] of before) {
      const table = key.slice(0, key.indexOf(':'));
      const next = after.get(key);
      expect(next, key).toBeDefined();
      const fields = moving[table] ?? [];
      const strip = (r: unknown) =>
        Object.fromEntries(Object.entries(r as object).filter(([k]) => !fields.includes(k)));
      expect(strip(next), key).toEqual(strip(row));
      compared += 1;
    }
    expect(compared).toBe(before.size);
    expect(after.size).toBeGreaterThan(before.size);
  });

  it('closes the categories of a season and graduates its M19 when the next one starts', () => {
    const november = generateDemoDataset({ asOf: d('2026-11-25'), ...SMALL, historyDays: 7 });
    const february = generateDemoDataset({ asOf: d('2027-02-10'), ...SMALL, historyDays: 7 });
    const open2026 = november.playerCategories.filter((c) => c.validTo === null);
    const closed = new Map(february.playerCategories.map((c) => [c.id, c.validTo]));
    for (const c of open2026) expect(closed.get(c.id)).not.toBeNull();
    const leavers = february.players.filter((p) => p.leftOn === '2026-11-30');
    expect(leavers.length).toBeGreaterThan(0);
    for (const p of leavers) {
      expect(november.players.find((x) => x.id === p.id)?.leftOn).toBeNull();
    }
  });
});

/**
 * The state the alert engine sees for a player on a day, built from the
 * dataset. The load of a day is complete only after its sessions (RPE comes
 * 15–30 minutes later), so the ACWR is the one at the end of the day before.
 */
function dailyState(data: DemoDataset, player: DemoPlayer, date: LocalDate): PlayerDailyState {
  const loads = data.participations
    .filter((p) => p.playerId === player.id && p.rpe !== null && p.minutes !== null)
    .map((p) => ({ date: p.localDate, loadAu: (p.rpe ?? 0) * (p.minutes ?? 0) }));
  const series = loads.length === 0 ? [] : computeLoadSeries({ loads, to: addDays(date, -1) });
  const today = series.at(-1);
  const cmjResults = new Set(
    data.testResults
      .filter((r) => r.playerId === player.id && r.testCode === 'cmj' && r.status === 'done')
      .map((r) => r.id),
  );
  const cmjByResult = new Map<string, { date: LocalDate; heightCm: number }>();
  const resultDate = new Map(data.testResults.map((r) => [r.id, r.measuredOn]));
  for (const v of data.testValues) {
    if (!cmjResults.has(v.testResultId)) continue;
    const prev = cmjByResult.get(v.testResultId);
    if (prev === undefined || v.value > prev.heightCm) {
      cmjByResult.set(v.testResultId, {
        date: resultDate.get(v.testResultId) ?? date,
        heightCm: v.value,
      });
    }
  }
  const heights = data.anthropometry
    .filter((a) => a.playerId === player.id)
    .map((a) => ({ date: a.measuredOn, heightCm: a.heightCm }));
  const velocity = latestGrowthVelocity(heights);
  const category = data.playerCategories.find(
    (c) => c.playerId === player.id && c.validTo === null,
  );
  const stage = DEFAULT_AGE_BANDS.find(
    (b) => b.code === category?.category.ageBandCode,
  )?.defaultStage;
  return {
    date,
    sport: player.sport,
    sex: player.sex,
    ...(stage !== undefined && { stage }),
    acwr: today === undefined ? null : { ratio: today.acwr, historyDays: today.historyDays },
    wellness: data.wellness
      .filter((w) => w.playerId === player.id)
      .map((w) => ({ date: w.localDate, meanScore: meanWellnessScore(w) })),
    cmj: { measurements: [...cmjByResult.values()] },
    growth:
      velocity === null
        ? null
        : { velocityCmYear: velocity.growthVelocityCmYear, measuredOn: velocity.to.date },
  };
}

describe('scenarios for the panel and the alerts (#58)', () => {
  // Days of different weeks, weekdays and months: the scenarios recur on calendar cycles.
  for (const day of ['2026-05-19', '2026-06-08', '2026-09-03', '2026-11-02']) {
    it(`on ${day} the club has a player in each scenario`, () => {
      const asOf = d(day);
      const data = generateDemoDataset({
        asOf,
        historyDays: 56,
        playersPerCohort: { rugby: 6, hockey: 6 },
      });
      const kinds = new Set<AlertRuleKind>();
      let alerting = 0;
      let critical = 0;
      const active = data.players.filter((p) => p.leftOn === null && p.joinedOn <= asOf);
      let insufficient = 0;
      for (const player of active) {
        const state = dailyState(data, player, asOf);
        const evaluation = evaluateAlertRules(DEFAULT_ALERT_RULES, state);
        for (const a of evaluation.alerts) kinds.add(a.kind);
        if (evaluation.alerts.length > 0) alerting += 1;
        if (evaluation.alerts.some((a) => a.severity === 'critical')) critical += 1;
        if (state.acwr !== null && state.acwr !== undefined && state.acwr.historyDays < 28) {
          insufficient += 1;
        }
      }
      expect([...kinds].sort()).toEqual(
        [
          'acwr_high',
          'acwr_low',
          'cmj_drop',
          'growth_peak',
          'wellness_low',
          'wellness_zscore_low',
        ].sort(),
      );
      expect(insufficient).toBeGreaterThan(0);
      // Alerts stand out: critical ones are the exception and a good part of the squad has
      // none (the default ACWR < 0.8 rule is noisy after rest days: that is the rule, #58).
      expect(critical / active.length).toBeLessThan(0.15);
      expect(1 - alerting / active.length).toBeGreaterThan(0.4);
      // Someone is out with a medical block, and the coach only sees a generic note.
      const out = data.holds.filter((h) => h.validFrom <= asOf && asOf < h.validTo);
      expect(out.length).toBeGreaterThan(0);
      for (const h of out) expect(h.staffNote).not.toMatch(/ficticia|lesión/i);
    });
  }
});

describe('the production guard', () => {
  it('runs only in demo environments, confirmed, on a database that agrees', () => {
    expect(assertDemoSeedAllowed({ NODE_ENV: 'test', DEMO_SEED_CONFIRM: 'test' }, null)).toBe(
      'test',
    );
    expect(
      assertDemoSeedAllowed(
        {
          RAILWAY_ENVIRONMENT_NAME: 'staging',
          NODE_ENV: 'production',
          DEMO_SEED_CONFIRM: 'staging',
        },
        'staging',
      ),
    ).toBe('staging');
    expect(assertDemoSeedAllowed({ DEMO_SEED_CONFIRM: 'development' }, null)).toBe('development');
    expect(DEMO_SEED_ENVIRONMENTS).not.toContain('production');
  });

  it('refuses production, a missing or wrong confirmation, and a production database', () => {
    expect(() =>
      assertDemoSeedAllowed(
        { RAILWAY_ENVIRONMENT_NAME: 'production', DEMO_SEED_CONFIRM: 'production' },
        null,
      ),
    ).toThrow(DemoSeedRefusedError);
    expect(() =>
      assertDemoSeedAllowed({ NODE_ENV: 'production', DEMO_SEED_CONFIRM: 'production' }, null),
    ).toThrow(/does not run in "production"/);
    expect(demoSeedRefusals({ RAILWAY_ENVIRONMENT_NAME: 'staging' }, null)).toEqual([
      'Set DEMO_SEED_CONFIRM=staging (or --confirm=staging) to write demo data.',
    ]);
    expect(
      demoSeedRefusals(
        { RAILWAY_ENVIRONMENT_NAME: 'staging', DEMO_SEED_CONFIRM: 'development' },
        null,
      ),
    ).toHaveLength(1);
    expect(() =>
      assertDemoSeedAllowed(
        { NODE_ENV: 'development', DEMO_SEED_CONFIRM: 'development' },
        'production',
      ),
    ).toThrow(/declares itself "production"/);
    expect(() =>
      assertDemoSeedAllowed(
        { NODE_ENV: 'development', DEMO_SEED_CONFIRM: 'development' },
        'staging',
      ),
    ).toThrow(/declares itself "staging" but the environment is "development"/);
    expect(() =>
      assertDemoSeedAllowed(
        { RAILWAY_ENVIRONMENT_NAME: 'Prod-EU', DEMO_SEED_CONFIRM: 'prod-eu' },
        null,
      ),
    ).toThrow(DemoSeedRefusedError);
  });
});
