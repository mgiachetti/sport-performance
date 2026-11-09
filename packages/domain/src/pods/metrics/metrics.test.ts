import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ABSOLUTE_SPEED_ZONES,
  DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES,
  DEFAULT_POD_METRIC_PARAMS,
  DEFAULT_RELATIVE_SPEED_ZONES,
  DomainValidationError,
  accelLoadAu,
  canonicalJson,
  computePodSessionMetrics,
  effortsAtOrAbove,
  filterSpeedSamples,
  impactTimesMs,
  parseClubId,
  parseLocalDate,
  parsePodMetricParams,
  resolvePodMetricConfig,
  resolvePodMetricParams,
  resolveReferenceVmax,
  type AbsoluteSpeedZoneSet,
  type PodMetricConfig,
  type PodMetricParams,
  type PodSessionInput,
  type PodSpeedSample,
  type ReferenceVmax,
} from '../../index.js';

const P = DEFAULT_POD_METRIC_PARAMS;
const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);
const d = parseLocalDate;

/** 10 Hz epochs from `fromS` to `toS` (excluded) with speed `v(t)` (t in s). */
function epochs(fromS: number, toS: number, v: (tS: number) => number): PodSpeedSample[] {
  const out: PodSpeedSample[] = [];
  for (let k = Math.round(fromS * 10); k < Math.round(toS * 10); k += 1) {
    const tS = k / 10;
    out.push({
      timeMs: T0 + k * 100,
      speedMs: v(tS),
      fixQuality: 'fix_3d',
      horizontalAccuracyM: 1.4,
      speedAccuracyMs: 0.12,
    });
  }
  return out;
}

const NO_REFERENCE = (): ReferenceVmax => ({ vmaxMs: null, source: null });

function session(
  speed: PodSpeedSample[],
  overrides: Partial<PodSessionInput> = {},
): ReturnType<typeof computePodSessionMetrics> {
  return computePodSessionMetrics({
    params: P,
    sport: 'rugby',
    absoluteZones: DEFAULT_ABSOLUTE_SPEED_ZONES,
    relativeZones: DEFAULT_RELATIVE_SPEED_ZONES,
    windows: [{ startMs: T0, endMs: T0 + 3_600_000 }],
    speed,
    accel: null,
    highG: null,
    referenceVmax: NO_REFERENCE,
    ...overrides,
  });
}

/** Speed of a sprint: 0 → `peak` at `accel` m/s², hold `holdS`, back to 0 at `accel`. */
function sprintProfile(startS: number, peak: number, accel: number, holdS: number) {
  const up = peak / accel;
  return (tS: number): number => {
    const t = tS - startS;
    if (t < 0) return 0;
    if (t < up) return accel * t;
    if (t < up + holdS) return peak;
    if (t < 2 * up + holdS) return peak - accel * (t - up - holdS);
    return 0;
  };
}

describe('computePodSessionMetrics', () => {
  it('constant speed: distance, pace, peak and no efforts', () => {
    const m = session(
      epochs(0, 60, () => 4),
      {
        windows: [{ startMs: T0, endMs: T0 + 60_000 }],
      },
    );
    // Epochs from 0 to 59.9 s: 59.9 s of trapezoids at 4 m/s.
    expect(m.values.dist_m).toBeCloseTo(239.6, 6);
    expect(m.values.dist_m_min).toBeCloseTo(239.6, 6);
    expect(m.values.hsr_abs_m).toBe(0);
    expect(m.values.vmax_ms).toBeCloseTo(4, 9);
    expect(m.values.acc_n).toBe(0);
    expect(m.values.dec_n).toBe(0);
    expect(m.values.sprints_n).toBe(0);
    expect(m.values.sprint_dist_m).toBe(0);
    expect(m.stats.durationS).toBe(60);
    expect(m.omitted.hsr_rel_m).toBe('reference_vmax_missing');
    expect(m.omitted.vmax_pct).toBe('reference_vmax_missing');
    expect(m.omitted.accel_load_au).toBe('no_imu_data');
  });

  it('absolute HSR uses the sex-specific zones (5.5 m/s men, 5.28 m/s women)', () => {
    const speed = epochs(0, 30, () => 5.4);
    expect(session(speed).values.hsr_abs_m).toBe(0);
    const female = session(speed, { absoluteZones: DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES });
    expect(female.values.hsr_abs_m).toBeCloseTo(5.4 * 29.9, 6);
    expect(female.thresholds.hsrAbsMs).toBe(5.28);
  });

  it('counts HSR from the crossing of the threshold', () => {
    // 5 → 6 m/s linearly over 1 s, then 6 m/s: above 5.5 from 0.5 s.
    const m = session(
      epochs(0, 3, (t) => (t < 1 ? 5 + t : 6)),
      {
        params: { ...P, speedFilterS: 0 },
      },
    );
    // 0.5 s from 5.5 to 6 (2.875 m) plus 1.9 s at 6 m/s (11.4 m).
    expect(m.values.hsr_abs_m).toBeCloseTo(2.875 + 11.4, 6);
  });

  it('a sprint: one sprint, one acceleration and one deceleration', () => {
    const m = session(epochs(0, 20, sprintProfile(2, 8, 4, 3)));
    expect(m.values.sprints_n).toBe(1);
    expect(m.values.acc_n).toBe(1);
    expect(m.values.dec_n).toBe(1);
    expect(m.values.vmax_ms).toBeCloseTo(8, 1);
    // Above 7 m/s: 0.25 s up, 3 s at 8, 0.25 s down ≈ 1.875 + 24 + 1.875 m.
    expect(m.values.sprint_dist_m).toBeGreaterThan(26.5);
    expect(m.values.sprint_dist_m).toBeLessThan(28.5);
    expect(m.efforts.sprints).toHaveLength(1);
  });

  it('sprints need the dwell time and the sprint zone of the sex', () => {
    // 7.5 m/s for 0.5 s only: under the 1 s dwell.
    const short = session(epochs(0, 20, sprintProfile(2, 7.5, 7.5, 0.4)), {
      params: { ...P, speedFilterS: 0 },
    });
    expect(short.values.sprints_n).toBe(0);
    // Women sprint from 6.25 m/s: a 6.5 m/s run of 2 s counts.
    const run = epochs(0, 20, sprintProfile(2, 6.5, 4, 2));
    expect(session(run).values.sprints_n).toBe(0);
    expect(
      session(run, { absoluteZones: DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES }).values.sprints_n,
    ).toBe(1);
  });

  it('acceleration efforts need the threshold and the dwell time', () => {
    const accelThenHold = (accel: number, durS: number) => (t: number) =>
      t < 2 ? 0 : t < 2 + durS ? accel * (t - 2) : accel * durS;
    // 3 m/s² for 1 s: one effort; for 0.3 s: none (dwell 0.5 s); 1.8 m/s² for 2 s: none.
    expect(session(epochs(0, 10, accelThenHold(3, 1))).values.acc_n).toBe(1);
    expect(session(epochs(0, 10, accelThenHold(3, 0.3))).values.acc_n).toBe(0);
    expect(session(epochs(0, 10, accelThenHold(1.8, 2))).values.acc_n).toBe(0);
    // A club with a 1.5 m/s² threshold counts the last one.
    const lower: PodMetricParams = { ...P, accelerations: { thresholdMs2: 1.5, minDwellS: 0.5 } };
    expect(session(epochs(0, 10, accelThenHold(1.8, 2)), { params: lower }).values.acc_n).toBe(1);
  });

  it('drops multipath spikes and impossible speeds, keeps the rest', () => {
    const speed = epochs(0, 10, () => 3).map((s, i) =>
      i === 50 ? { ...s, speedMs: 11 } : i === 70 ? { ...s, speedMs: 14 } : s,
    );
    const m = session(speed);
    expect(m.stats.speed.rejected.spike).toBe(1);
    expect(m.stats.speed.rejected.range).toBe(1);
    expect(m.values.vmax_ms).toBeCloseTo(3, 9);
    expect(m.values.sprints_n).toBe(0);
    expect(m.values.acc_n).toBe(0);
  });

  it('drops epochs without a good fix or with poor accuracy', () => {
    const speed = epochs(0, 10, () => 3).map((s, i) =>
      i < 10
        ? { ...s, fixQuality: 'fix_2d' as const }
        : i < 20
          ? { ...s, horizontalAccuracyM: 12 }
          : i < 25
            ? { ...s, speedMs: null }
            : s,
    );
    const m = session(speed);
    expect(m.stats.speed.rejected.fix).toBe(15);
    expect(m.stats.speed.rejected.accuracy).toBe(10);
    expect(m.values.dist_m).toBeCloseTo(3 * 7.4, 6);
  });

  it('never integrates across a gap nor outside the windows', () => {
    const speed = [
      ...epochs(0, 10, () => 4),
      ...epochs(20, 30, () => 4),
      ...epochs(40, 50, () => 4),
    ];
    const m = session(speed, {
      windows: [
        { startMs: T0, endMs: T0 + 30_000 },
        // The third stretch is outside the player's windows.
      ],
    });
    expect(m.stats.runsN).toBe(2);
    expect(m.values.dist_m).toBeCloseTo(2 * 4 * 9.9, 6);
    expect(m.values.dist_m_min).toBeCloseTo((2 * 4 * 9.9) / 0.5, 6);
  });

  it('relative HSR and vmax_pct with the reference Vmax', () => {
    let seen: number | null = -1;
    const m = session(
      epochs(0, 30, () => 5),
      {
        referenceVmax: (own) => {
          seen = own;
          return { vmaxMs: 8, source: 'pod_rolling_max', sessionsN: 4 };
        },
      },
    );
    expect(seen).toBeCloseTo(5, 9);
    // 60 % of 8 m/s = 4.8 m/s.
    expect(m.thresholds.hsrRelMs).toBeCloseTo(4.8, 9);
    expect(m.values.hsr_rel_m).toBeCloseTo(m.values.dist_m ?? 0, 9);
    expect(m.values.vmax_pct).toBeCloseTo(62.5, 6);
    expect(m.reference.source).toBe('pod_rolling_max');
  });

  it('without speed data nothing of the speed is written, not even 0', () => {
    const m = session([]);
    expect(m.values).toEqual({});
    expect(m.omitted.dist_m).toBe('no_speed_data');
    expect(m.omitted.hsr_rel_m).toBe('no_speed_data');
  });

  it('a sprint zone the club does not have leaves the sprints out', () => {
    const zones: AbsoluteSpeedZoneSet = {
      kind: 'absolute',
      zones: [
        { code: 'low', minSpeedMs: 0 },
        { code: 'hsr', minSpeedMs: 5.5 },
      ],
      highSpeedZoneCode: 'hsr',
    };
    const m = session(
      epochs(0, 10, () => 6),
      { absoluteZones: zones },
    );
    expect(m.omitted.sprints_n).toBe('sprint_zone_missing');
    expect(m.values.hsr_abs_m).toBeGreaterThan(0);
  });

  it('accelerometer load inside the windows and impacts only in rugby', () => {
    const n = 101;
    const timeMs = Array.from({ length: n }, (_, i) => T0 + i * 10);
    const xG = timeMs.map((_, i) => (i % 2 === 0 ? 0 : 0.1));
    const zeros = timeMs.map(() => 0);
    const highG = {
      timeMs,
      normG: timeMs.map((_, i) => (i === 10 || i === 11 || i === 60 ? 12 : 1)),
    };
    const input = {
      windows: [{ startMs: T0, endMs: T0 + 2000 }],
      accel: { timeMs, xG, yG: zeros, zG: zeros },
      highG,
    };
    const rugby = session([], input);
    expect(rugby.values.accel_load_au).toBeCloseTo(100 * 0.1 * 0.01, 9);
    // Two crossings 0.5 s apart are one impact (1 s of separation).
    expect(rugby.stats.impactsN).toBe(1);
    const hockey = session([], { ...input, sport: 'hockey' });
    expect(hockey.stats.impactsN).toBeNull();
    expect(hockey.efforts.impactsMs).toEqual([]);
  });
});

describe('kinematics', () => {
  it('accel load does not depend on the sensor rate (resampled to 100 Hz)', () => {
    const ramp = (hz: number) => {
      const n = hz + 1;
      const timeMs = Array.from({ length: n }, (_, i) => (i * 1000) / hz);
      const zeros = timeMs.map(() => 0);
      return { timeMs, xG: timeMs.map((t) => t / 1000), yG: zeros, zG: zeros };
    };
    const at100 = accelLoadAu(ramp(100), P.accelLoad);
    const at208 = accelLoadAu(ramp(208), P.accelLoad);
    expect(at100.loadAu).toBeCloseTo(0.01, 9);
    expect(at208.loadAu).toBeCloseTo(0.01, 4);
  });

  it('accel load breaks at a gap', () => {
    const timeMs = [0, 10, 20, 500, 510];
    const xG = [0, 1, 0, 5, 4];
    const zeros = [0, 0, 0, 0, 0];
    // |1| + |−1| in the first stretch, |−1| in the second; never the jump 0 → 5 across the gap.
    expect(accelLoadAu({ timeMs, xG, yG: zeros, zG: zeros }, P.accelLoad).loadAu).toBeCloseTo(
      0.03,
      9,
    );
  });

  it('efforts interpolate the crossings', () => {
    const efforts = effortsAtOrAbove([0, 1000, 2000, 3000], [0, 4, 4, 0], 2, 1);
    expect(efforts).toEqual([{ startMs: 500, endMs: 2500, peak: 4 }]);
    expect(effortsAtOrAbove([0, 1000, 2000], [0, 4, 0], 2, 1.5)).toEqual([]);
  });

  it('impacts are separated by the minimum time', () => {
    expect(
      impactTimesMs({ timeMs: [0, 100, 200, 300, 1500], normG: [9, 1, 9, 1, 9] }, 8, 1),
    ).toEqual([0, 1500]);
  });

  it('a new run after a gap even when the last kept epoch was a spike', () => {
    const samples = epochs(0, 1, () => 3);
    const later = epochs(3, 4, () => 9);
    const { runs } = filterSpeedSamples([...samples, ...later], P.plausibility);
    expect(runs).toHaveLength(2);
  });
});

describe('resolveReferenceVmax', () => {
  const params = P.referenceVmax;
  const on = d('2026-06-15');
  const startsAt = Date.UTC(2026, 5, 15, 21);
  const peak = (date: string, vmaxMs: number, startsAtMs = Date.parse(`${date}T21:00:00Z`)) => ({
    localDate: d(date),
    vmaxMs,
    startsAtMs,
  });
  const base = { params, onDate: on, sessionStartsAtMs: startsAt };

  it('the pod rolling max of earlier sessions, with enough sessions', () => {
    const r = resolveReferenceVmax({
      ...base,
      sessionVmaxMs: 7.6,
      podHistory: [
        peak('2026-06-01', 8.1),
        peak('2026-05-20', 7.9),
        // Out of the window (180 days), later the same day and after the session: never counted.
        peak('2025-12-01', 9.5),
        peak('2026-06-15', 9.1, startsAt + 3_600_000),
        peak('2026-06-20', 9.2),
      ],
      sprint40: [{ localDate: d('2026-02-10'), vmaxMs: 8.9 }],
    });
    expect(r).toEqual({ vmaxMs: 8.1, source: 'pod_rolling_max', sessionsN: 3 });
  });

  it('a session earlier the same day counts', () => {
    const r = resolveReferenceVmax({
      ...base,
      sessionVmaxMs: 7.6,
      podHistory: [peak('2026-06-01', 8.1), peak('2026-06-15', 8.3, startsAt - 3_600_000)],
      sprint40: [],
    });
    expect(r).toEqual({ vmaxMs: 8.3, source: 'pod_rolling_max', sessionsN: 3 });
  });

  it('falls back to the latest 40 m sprint, never mixed with a pod peak', () => {
    const r = resolveReferenceVmax({
      ...base,
      sessionVmaxMs: 7.6,
      podHistory: [peak('2026-06-01', 8.1)],
      sprint40: [
        { localDate: d('2026-02-10'), vmaxMs: 8.4 },
        { localDate: d('2025-11-10'), vmaxMs: 8.9 },
      ],
    });
    expect(r).toEqual({ vmaxMs: 8.4, source: 'sprint_40', testedOn: d('2026-02-10') });
  });

  it('a pod max out of the sanity band of the 40 m sprint is no reference', () => {
    const r = resolveReferenceVmax({
      ...base,
      sessionVmaxMs: 7.6,
      // 10.5 m/s is 25 % above the 8.4 m/s of the sprint (band: 15 %).
      podHistory: [peak('2026-06-01', 10.5), peak('2026-05-20', 7.9)],
      sprint40: [{ localDate: d('2026-02-10'), vmaxMs: 8.4 }],
    });
    expect(r.source).toBe('sprint_40');
    const noBand = resolveReferenceVmax({
      ...base,
      params: { ...params, podMaxAboveSprint40Pct: null },
      sessionVmaxMs: 7.6,
      podHistory: [peak('2026-06-01', 10.5), peak('2026-05-20', 7.9)],
      sprint40: [{ localDate: d('2026-02-10'), vmaxMs: 8.4 }],
    });
    expect(noBand).toMatchObject({ vmaxMs: 10.5, source: 'pod_rolling_max' });
  });

  it('none when no rule has data', () => {
    expect(
      resolveReferenceVmax({
        ...base,
        sessionVmaxMs: null,
        podHistory: [],
        sprint40: [{ localDate: d('2024-01-01'), vmaxMs: 8 }],
      }),
    ).toEqual({ vmaxMs: null, source: null });
  });

  it('follows the club order', () => {
    const r = resolveReferenceVmax({
      ...base,
      params: { ...params, sources: ['sprint_40', 'pod_rolling_max'] },
      sessionVmaxMs: 7.6,
      podHistory: [peak('2026-06-01', 8.1), peak('2026-05-20', 7.9)],
      sprint40: [{ localDate: d('2026-02-10'), vmaxMs: 8.4 }],
    });
    expect(r.source).toBe('sprint_40');
  });
});

describe('plausibility at the start of a stretch (review B1)', () => {
  it('a spike as the first epoch does not start the stretch nor reach vmax', () => {
    // 11.5 m/s, then 3 m/s steady: the first epoch is the spike.
    const speed = epochs(0, 10, (t) => (t === 0 ? 11.5 : 3));
    const m = session(speed);
    expect(m.values.vmax_ms).toBeCloseTo(3, 9);
    expect(m.stats.speed.rejected.spike).toBe(1);
    expect(m.values.sprints_n).toBe(0);
    expect(m.values.hsr_abs_m).toBe(0);
  });

  it('nor after a gap', () => {
    const speed = [...epochs(0, 5, () => 3), ...epochs(8, 15, (t) => (t === 8 ? 11.5 : 3))];
    const m = session(speed);
    expect(m.values.vmax_ms).toBeCloseTo(3, 9);
    expect(m.stats.runsN).toBe(2);
  });

  it.each([1, 2, 3])(
    'a spike of %i consistent epochs is never bridged to good data (review)',
    (n) => {
      // Jogging at 3 m/s with a multipath stretch of n epochs at 11 m/s in the middle and at
      // the start: the spike epochs agree with each other, never with the jog.
      const spikeAt = (t: number, from: number) => t >= from && t < from + n / 10 - 1e-9;
      const middle = session(epochs(0, 20, (t) => (spikeAt(t, 10) ? 11 : 3)));
      expect(middle.values.vmax_ms).toBeCloseTo(3, 9);
      expect(middle.values.sprints_n).toBe(0);
      expect(middle.stats.speed.rejected.spike).toBe(n);
      // Joined across the dropped stretch: one run, no distance lost but the spike's.
      expect(middle.stats.runsN).toBe(1);
      const start = session(epochs(0, 20, (t) => (spikeAt(t, 0) ? 11 : 3)));
      expect(start.values.vmax_ms).toBeCloseTo(3, 9);
      const afterGap = session([
        ...epochs(0, 5, () => 3),
        ...epochs(8, 20, (t) => (spikeAt(t, 8) ? 11 : 3)),
      ]);
      expect(afterGap.values.vmax_ms).toBeCloseTo(3, 9);
      expect(afterGap.stats.runsN).toBe(2);
    },
  );

  it('a real acceleration is one chain, never cut as a spike', () => {
    const m = session(epochs(0, 20, (t) => (t < 5 ? 3 : t < 6 ? 3 + 5 * (t - 5) : 8)));
    expect(m.stats.speed.rejected.spike).toBe(0);
    expect(m.values.vmax_ms).toBeCloseTo(8, 6);
  });

  it('a lone epoch without a consistent partner is dropped', () => {
    const speed = [
      ...epochs(0, 5, () => 3),
      ...epochs(8, 8.1, () => 9),
      ...epochs(12, 15, () => 3),
    ];
    const { runs, report } = filterSpeedSamples(speed, P.plausibility);
    expect(runs).toHaveLength(2);
    expect(report.rejected.isolated).toBe(1);
  });

  it('an unknown speed accuracy is rejected like an unknown horizontal one', () => {
    const speed = epochs(0, 5, () => 3).map((s, i) =>
      i < 10 ? { ...s, speedAccuracyMs: null } : s,
    );
    expect(session(speed).stats.speed.rejected.accuracy).toBe(10);
  });

  it('impacts: each high-g burst starts below the threshold', () => {
    // Two bursts 2 s apart, each recorded while above the threshold from its first sample.
    expect(impactTimesMs({ timeMs: [0, 10, 2000, 2010], normG: [12, 12, 12, 12] }, 8, 1)).toEqual([
      0, 2000,
    ]);
  });
});

describe('parsePodMetricParams', () => {
  it('round-trips the defaults through JSON', () => {
    const parsed = parsePodMetricParams(JSON.parse(JSON.stringify(P)));
    expect(parsed).toEqual(P);
  });

  it('rejects unknown fields and values out of range, with the path', () => {
    const bad = (mutate: (p: Record<string, unknown>) => void, path: RegExp) => {
      const copy = JSON.parse(JSON.stringify(P)) as Record<string, unknown>;
      mutate(copy);
      try {
        parsePodMetricParams(copy);
        expect.fail('expected an error');
      } catch (error) {
        expect(error).toBeInstanceOf(DomainValidationError);
        expect((error as Error).message).toMatch(path);
      }
    };
    bad((p) => {
      p.extra = 1;
    }, /params\.extra/);
    bad((p) => {
      (p.accelerations as Record<string, unknown>).thresholdMs2 = 0;
    }, /params\.accelerations\.thresholdMs2/);
    bad((p) => {
      (p.plausibility as Record<string, unknown>).acceptedFixQualities = ['fix_9d'];
    }, /acceptedFixQualities\[0\]/);
    bad((p) => {
      const rules = (p.live as Record<string, unknown[]>).rules ?? [];
      (rules[0] as Record<string, unknown>).severity = 'critical';
    }, /rules\[0\]\.severity/);
    bad((p) => {
      (p.live as Record<string, unknown>).bandZoneCodes = ['a', 'a', 'b', 'c'];
    }, /bandZoneCodes repeats/);
    bad((p) => {
      (p.impacts as Record<string, unknown>).sports = ['rugby', 'hockey'];
    }, /hockey has no contacts/);
  });

  it('never names a metric after the trademark, the formula is the published form', () => {
    expect(JSON.stringify(P).toLowerCase()).not.toContain('playerload');
    expect(P.accelLoad).toEqual({ sampleRateHz: 100, scale: 0.01, maxGapS: 0.05 });
  });
});

describe('canonicalJson', () => {
  it('sorts keys at every level and keeps arrays in order', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}',
    );
  });
});

describe('resolvePodMetricConfig', () => {
  const club = parseClubId('00000000-0000-4000-8000-000000000001');
  const row = (overrides: Partial<PodMetricConfig>): PodMetricConfig => ({
    clubId: club,
    sport: null,
    sex: null,
    validFrom: d('2000-01-01'),
    validTo: null,
    params: P,
    ...overrides,
  });
  const query = {
    clubId: club,
    sport: 'hockey' as const,
    sex: 'female' as const,
    onDate: d('2026-06-01'),
  };

  it('picks the most specific in force, sport over sex', () => {
    const configs = [
      row({}),
      row({ sex: 'female' }),
      row({ sport: 'hockey' }),
      row({ sport: 'hockey', validFrom: d('2026-07-01') }),
    ];
    expect(resolvePodMetricConfig(configs, query)).toBe(configs[2]);
    expect(resolvePodMetricConfig(configs, { ...query, sport: 'rugby' })).toBe(configs[1]);
  });

  it('past sessions keep the definitions they had', () => {
    const before = row({ validTo: d('2026-05-01') });
    const after = row({
      validFrom: d('2026-05-01'),
      params: { ...P, accelerations: { thresholdMs2: 3, minDwellS: 0.5 } },
    });
    expect(resolvePodMetricParams([before, after], { ...query, onDate: d('2026-04-30') })).toBe(P);
    expect(resolvePodMetricParams([before, after], query).accelerations.thresholdMs2).toBe(3);
    expect(resolvePodMetricParams([], query)).toBe(P);
  });

  it('throws on two equally specific ones', () => {
    expect(() => resolvePodMetricConfig([row({}), row({})], query)).toThrow(DomainValidationError);
  });
});
