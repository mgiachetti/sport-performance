import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ABSOLUTE_SPEED_ZONES,
  DEFAULT_POD_METRIC_PARAMS,
  appendLiveSample,
  evaluateLiveSignals,
  liveCounterSample,
  liveEfforts,
  liveHsrDistanceM,
  livePaceMMin,
  livePeakPaceMMin,
  livePlayedS,
  liveRecentMaxSpeedMs,
  liveSprintEfforts,
  matchAveragePct,
  repeatedHighIntensityBouts,
  type LiveContext,
  type LiveCounterSample,
} from '../../index.js';

const T0 = Date.UTC(2026, 9, 3, 18, 0, 0);

interface Second {
  /** m/s that second. */
  speedMs: number;
  accel?: boolean;
  impact?: boolean;
}

/** A packet every 2 s from per-second speeds; counters cumulative like the pod's. */
function series(seconds: readonly Second[]): LiveCounterSample[] {
  const out: LiveCounterSample[] = [];
  let dist = 0;
  let hsr = 0;
  let acc = 0;
  let impacts = 0;
  for (let s = 1; s < seconds.length; s += 2) {
    const pair = [seconds[s - 1], seconds[s]] as const;
    for (const sec of pair) {
      if (sec === undefined) continue;
      dist += sec.speedMs;
      if (sec.speedMs >= 5.5) hsr += sec.speedMs;
      if (sec.accel === true) acc += 1;
      if (sec.impact === true) impacts += 1;
    }
    out.push({
      atMs: T0 + s * 1000,
      vestOn: true,
      sessionDistanceM: dist,
      speedBandDistancesM: [0, 0, hsr, 0],
      accelerationsN: acc,
      decelerationsN: 0,
      accelLoadAu: 0,
      impactsN: impacts,
      seconds: [
        { vmaxMs: pair[0]?.speedMs ?? null, distanceM: pair[0]?.speedMs ?? null },
        { vmaxMs: pair[1]?.speedMs ?? null, distanceM: pair[1]?.speedMs ?? null },
      ],
    });
  }
  return out;
}

const constant = (n: number, speedMs: number): Second[] =>
  Array.from({ length: n }, () => ({ speedMs }));

function ctx(overrides: Partial<LiveContext> = {}): LiveContext {
  return {
    sport: 'rugby',
    params: DEFAULT_POD_METRIC_PARAMS,
    absoluteZones: DEFAULT_ABSOLUTE_SPEED_ZONES,
    referenceVmaxMs: 8,
    matchHistory: [],
    ...overrides,
  };
}

describe('live counters', () => {
  it('converts the protocol units', () => {
    const s = liveCounterSample(
      {
        vestOn: true,
        sessionDistanceDm: 12_345,
        speedBandDistancesM: [1, 2, 3, 4],
        accelerationsN: 5,
        decelerationsN: 6,
        accelLoadCentiAu: 1_234,
        impactsN: 7,
        seconds: [
          { vmaxCmS: 712, distanceDm: 70 },
          { vmaxCmS: null, distanceDm: null },
        ],
      },
      T0,
    );
    expect(s.sessionDistanceM).toBe(1234.5);
    expect(s.accelLoadAu).toBe(12.34);
    expect(s.seconds).toEqual([
      { vmaxMs: 7.12, distanceM: 7 },
      { vmaxMs: null, distanceM: null },
    ]);
  });

  it('keeps the series sorted and replaces a re-sent packet', () => {
    const [a, b, c] = series(constant(6, 3));
    if (a === undefined || b === undefined || c === undefined) throw new Error('series');
    let s = appendLiveSample([], c);
    s = appendLiveSample(s, a);
    s = appendLiveSample(s, b);
    s = appendLiveSample(s, { ...b, vestOn: false });
    expect(s.map((x) => x.atMs)).toEqual([a.atMs, b.atMs, c.atMs]);
    expect(s[1]?.vestOn).toBe(false);
  });

  it('pace over 5 minutes, its peak and the time played', () => {
    const s = series([...constant(900, 5), ...constant(300, 2)]);
    const last = s.at(-1);
    expect(livePlayedS(s)).toBe(1198);
    expect(livePaceMMin(s, last?.atMs ?? 0, 300)).toBeCloseTo(120, 6);
    expect(livePeakPaceMMin(s, 300)).toBeCloseTo(300, 6);
    // Not a whole window yet.
    expect(livePaceMMin(s, T0 + 100_000, 300)).toBeNull();
  });

  it('recent max speed and sprints from the per-second maxima', () => {
    const s = series([
      ...constant(10, 3),
      ...constant(3, 7.5),
      ...constant(10, 3),
      { speedMs: 7.4 },
      ...constant(9, 3),
    ]);
    expect(liveRecentMaxSpeedMs(s, 60)).toBe(7.5);
    expect(liveRecentMaxSpeedMs(s, 9)).toBe(7.4);
    // 3 s at 7.5 m/s is a sprint; 1 s at 7.4 is not (dwell 1 s on a 1 s resolution).
    expect(liveSprintEfforts(s, 7, 1)).toHaveLength(1);
    expect(liveSprintEfforts(s, 7, 0)).toHaveLength(2);
  });

  it('live HSR from the bands at and above the high-speed zone', () => {
    const [sample] = series(constant(2, 6));
    if (sample === undefined) throw new Error('series');
    expect(
      liveHsrDistanceM(
        { ...sample, speedBandDistancesM: [10, 20, 30, 40] },
        DEFAULT_POD_METRIC_PARAMS.live.bandZoneCodes,
        DEFAULT_ABSOLUTE_SPEED_ZONES,
      ),
    ).toBe(70);
    expect(liveHsrDistanceM(sample, ['a', 'b', 'c', 'd'], DEFAULT_ABSOLUTE_SPEED_ZONES)).toBeNull();
  });
});

describe('match average', () => {
  const history = [1, 2, 3].map(() => ({ playedS: 4800, values: { hsr_abs_m: 400 } }));

  it('compares paces, so minute 30 is compared with 30 minutes of a usual match', () => {
    const cmp = matchAveragePct({
      metric: 'hsr_abs_m',
      current: 300,
      playedS: 1800,
      history,
      minMatches: 3,
    });
    expect(cmp.status).toBe('ok');
    if (cmp.status === 'ok') expect(cmp.pct).toBeCloseTo(200, 6);
  });

  it('historia insuficiente below the minimum of matches', () => {
    expect(
      matchAveragePct({
        metric: 'hsr_abs_m',
        current: 300,
        playedS: 1800,
        history: history.slice(0, 2),
        minMatches: 3,
      }),
    ).toEqual({ status: 'insufficient_history', matchesN: 2 });
    expect(
      matchAveragePct({ metric: 'acc_n', current: 3, playedS: 1800, history, minMatches: 3 }),
    ).toEqual({ status: 'insufficient_history', matchesN: 0 });
  });
});

describe('repeated high-intensity efforts', () => {
  /** sprint (3 s) → contact → sprint, recoveries of `gapS`. */
  const bout = (gapS: number): Second[] => [
    ...constant(3, 7.5),
    ...constant(gapS, 2),
    { speedMs: 2, impact: true },
    ...constant(gapS, 2),
    ...constant(3, 7.5),
  ];

  it('rugby: sprint → contact → sprint with short recovery is a bout', () => {
    const s = series([...constant(20, 2), ...bout(8), ...constant(40, 2)]);
    const efforts = liveEfforts(s, {
      sprintThresholdMs: 7,
      sprintMinDwellS: 1,
      withContacts: true,
    });
    expect(efforts.map((e) => e.kind)).toEqual(['sprint', 'contact', 'sprint']);
    const bouts = repeatedHighIntensityBouts(efforts, {
      minEfforts: 3,
      maxRecoveryS: 21,
      requireContact: true,
    });
    expect(bouts).toHaveLength(1);
  });

  it('a long recovery breaks the bout; without the contact it is no rugby bout', () => {
    const long = series([...constant(20, 2), ...bout(30), ...constant(40, 2)]);
    const efforts = liveEfforts(long, {
      sprintThresholdMs: 7,
      sprintMinDwellS: 1,
      withContacts: true,
    });
    expect(
      repeatedHighIntensityBouts(efforts, {
        minEfforts: 3,
        maxRecoveryS: 21,
        requireContact: true,
      }),
    ).toHaveLength(0);
    const runs = series([
      ...constant(3, 7.5),
      ...constant(5, 2),
      ...constant(3, 7.5),
      ...constant(5, 2),
      ...constant(3, 7.5),
      ...constant(10, 2),
    ]);
    const runEfforts = liveEfforts(runs, {
      sprintThresholdMs: 7,
      sprintMinDwellS: 1,
      withContacts: true,
    });
    expect(
      repeatedHighIntensityBouts(runEfforts, {
        minEfforts: 3,
        maxRecoveryS: 21,
        requireContact: true,
      }),
    ).toHaveLength(0);
    expect(
      repeatedHighIntensityBouts(runEfforts, {
        minEfforts: 3,
        maxRecoveryS: 21,
        requireContact: false,
      }),
    ).toHaveLength(1);
  });

  it('an acceleration that opens a sprint is that sprint', () => {
    const s = series([
      ...constant(4, 2),
      { speedMs: 7.5, accel: true },
      ...constant(3, 7.5),
      ...constant(8, 2),
    ]);
    const efforts = liveEfforts(s, {
      sprintThresholdMs: 7,
      sprintMinDwellS: 1,
      withContacts: false,
    });
    expect(efforts.map((e) => e.kind)).toEqual(['sprint']);
  });
});

describe('evaluateLiveSignals', () => {
  it('pace drop after 15 minutes, with icon and text keys', () => {
    const s = series([...constant(900, 5), ...constant(300, 2)]);
    const { signals, readings } = evaluateLiveSignals(s, ctx());
    const drop = signals.find((x) => x.kind === 'pace_drop');
    expect(drop).toMatchObject({
      ruleCode: 'pace_drop',
      severity: 'info',
      icon: 'trend_down',
      messageKey: 'podLive.signal.pace_drop',
      suggestionKey: 'podLive.signal.pace_drop.suggestion',
    });
    expect(readings.pace_drop).toEqual({ status: 'ok', value: 40 });
  });

  it('not before the minimum play, and historia insuficiente for the match average', () => {
    const s = series(constant(300, 6));
    const { signals, readings } = evaluateLiveSignals(s, ctx());
    expect(signals.find((x) => x.kind === 'pace_drop')).toBeUndefined();
    expect(readings.pace_drop).toEqual({ status: 'not_enough_play' });
    expect(readings.match_average_high).toEqual({ status: 'not_enough_play' });
    const later = series(constant(700, 6));
    expect(evaluateLiveSignals(later, ctx()).readings.match_average_high).toEqual({
      status: 'insufficient_history',
    });
  });

  it('match average high against the player’s own matches', () => {
    const s = series(constant(700, 6));
    const history = [1, 2, 3].map(() => ({
      playedS: 4800,
      values: { hsr_abs_m: 400, acc_n: 40, sprints_n: 10 },
    }));
    const { signals } = evaluateLiveSignals(s, ctx({ matchHistory: history }));
    const high = signals.find((x) => x.kind === 'match_average_high');
    expect(high?.values.metric).toBe('hsr_abs_m');
    expect(high?.severity).toBe('warning');
  });

  it('a tablet that joins late compares only what happened in its series (review B3)', () => {
    const history = [1, 2, 3].map(() => ({
      playedS: 4800,
      values: { hsr_abs_m: 400, acc_n: 40, sprints_n: 10 },
    }));
    const s = series(constant(700, 6));
    // The pod's session started an hour before the tablet's first packet: the counters arrive
    // already high.
    const late = s.map((x) => ({
      ...x,
      sessionDistanceM: x.sessionDistanceM + 9000,
      speedBandDistancesM: [0, 0, x.speedBandDistancesM[2] + 900, 0] as const,
      accelerationsN: x.accelerationsN + 60,
    }));
    const onTime = evaluateLiveSignals(s, ctx({ matchHistory: history }));
    const joined = evaluateLiveSignals(late, ctx({ matchHistory: history }));
    expect(joined.readings.match_average_high).toEqual(onTime.readings.match_average_high);
    expect(joined.readings.pace_drop).toEqual(onTime.readings.pace_drop);
  });

  it('speed near the own Vmax, and without a reference no signal', () => {
    const s = series([...constant(20, 3), ...constant(2, 7.8)]);
    expect(evaluateLiveSignals(s, ctx()).signals.map((x) => x.kind)).toContain('speed_near_vmax');
    const none = evaluateLiveSignals(s, ctx({ referenceVmaxMs: null }));
    expect(none.signals.map((x) => x.kind)).not.toContain('speed_near_vmax');
    expect(none.readings.speed_near_vmax).toEqual({ status: 'insufficient_history' });
  });

  it('RHIE: rugby counts contacts, hockey never does', () => {
    const bout = [
      ...constant(3, 7.5),
      ...constant(6, 2),
      { speedMs: 2, impact: true },
      ...constant(6, 2),
      ...constant(3, 7.5),
      ...constant(40, 2),
    ];
    const s = series([...bout, ...bout]);
    const rugby = evaluateLiveSignals(s, ctx());
    expect(rugby.readings.rhie_rugby).toEqual({ status: 'ok', value: 2 });
    expect(rugby.signals.map((x) => x.ruleCode)).toContain('rhie_rugby');
    expect(rugby.readings.rhie_hockey).toBeUndefined();
    const hockey = evaluateLiveSignals(s, ctx({ sport: 'hockey' }));
    // Two sprints and no contact per bout: no hockey bout of 3 efforts.
    expect(hockey.readings.rhie_hockey).toEqual({ status: 'ok', value: 0 });
    expect(hockey.readings.rhie_rugby).toBeUndefined();
  });

  it('an empty series gives no signal', () => {
    const { signals, readings } = evaluateLiveSignals([], ctx());
    expect(signals).toEqual([]);
    expect(readings.pace_drop).toEqual({ status: 'no_data' });
  });
});
