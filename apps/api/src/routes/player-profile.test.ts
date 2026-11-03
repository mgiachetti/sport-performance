import type { LocalDate } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  availabilityPeriods,
  evolution,
  groupSpan,
  peakZoneOf,
  percentileItems,
  playerValue,
  type ScoredSample,
  type WindowInfo,
} from './player-profile.js';
import { DEFAULT_PERCENTILE_SETTINGS, type PlayerFacts } from '@sport-performance/domain';

const d = (value: string) => value as LocalDate;

describe('availabilityPeriods', () => {
  it('joins consecutive days with the same statuses and splits on a change or a gap', () => {
    const day = (on: string, status: 'available' | 'limited') => ({
      on_date: d(on),
      training: status,
      match: status,
      overall: status,
    });
    expect(
      availabilityPeriods([
        day('2026-03-01', 'available'),
        day('2026-03-02', 'available'),
        day('2026-03-03', 'limited'),
        day('2026-03-05', 'limited'),
      ]),
    ).toEqual([
      {
        from: '2026-03-01',
        to: '2026-03-02',
        training: 'available',
        match: 'available',
        overall: 'available',
      },
      {
        from: '2026-03-03',
        to: '2026-03-03',
        training: 'limited',
        match: 'limited',
        overall: 'limited',
      },
      {
        from: '2026-03-05',
        to: '2026-03-05',
        training: 'limited',
        match: 'limited',
        overall: 'limited',
      },
    ]);
    expect(availabilityPeriods([])).toEqual([]);
  });
});

describe('playerValue', () => {
  const sample = (value: number, measuredOn: string): ScoredSample => ({
    playerKey: 1,
    isSubject: true,
    testCode: 'sprint_40',
    protocolVersion: 1,
    exercise: null,
    metricCode: 'sprint_40_s',
    direction: 'lower_is_better',
    sex: 'male',
    ageBandCode: 'm15',
    positionCode: null,
    lineCode: null,
    measuredOn: d(measuredOn),
    seasonYear: 2026,
    testWindowId: null,
    method: 'manual',
    value,
  });

  it('takes the best by the direction, and the latest day for neutral metrics', () => {
    const samples = [
      sample(5.6, '2026-02-01'),
      sample(5.4, '2026-02-02'),
      sample(5.5, '2026-02-02'),
    ];
    expect(playerValue(samples, 'lower_is_better')).toBe(5.4);
    expect(playerValue(samples, 'higher_is_better')).toBe(5.6);
    expect(playerValue(samples, 'neutral')).toBeCloseTo(5.45, 10);
  });
});

describe('evolution', () => {
  const base: ScoredSample = {
    playerKey: 1,
    isSubject: true,
    testCode: 'cmj',
    protocolVersion: 1,
    exercise: null,
    metricCode: 'cmj_height_cm',
    direction: 'higher_is_better',
    sex: 'male',
    ageBandCode: 'm15',
    positionCode: null,
    lineCode: null,
    measuredOn: d('2026-02-10'),
    seasonYear: 2026,
    testWindowId: 'w1',
    method: 'manual',
    value: 40,
  };
  const at = (playerKey: number, value: number, measuredOn: string, extra = {}): ScoredSample => ({
    ...base,
    playerKey,
    isSubject: playerKey === 1,
    value,
    measuredOn: d(measuredOn),
    ...extra,
  });
  const windows = new Map<string, WindowInfo>([
    [
      'w1',
      {
        id: 'w1',
        seasonName: 'Temporada 2026',
        number: 1,
        startsOn: d('2026-02-01'),
        endsOn: d('2026-02-28'),
      },
    ],
  ]);
  const metrics = new Map([
    ['cmj_height_cm', { unit: 'cm' as const, direction: 'higher_is_better' as const }],
  ]);
  const closedDay = d('2026-03-01');
  const group = [
    at(1, 40, '2026-02-10'),
    at(2, 30, '2026-02-10'),
    at(3, 32, '2026-02-10'),
    at(4, 34, '2026-02-10'),
    at(5, 36, '2026-02-20'),
    // Outside the window's days: never in its group, whatever the range.
    at(6, 90, '2026-03-05'),
  ];

  it('reads the group over the whole window, not the asked range', () => {
    expect(groupSpan([at(1, 40, '2026-02-10')], windows)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    const point = evolution([at(1, 40, '2026-02-10')], group, metrics, windows, closedDay)
      .metrics[0]?.points[0];
    expect(point).toMatchObject({ value: 40, categorySize: 5, categoryAverage: 34.4 });
  });

  it('hides the size below the minimum', () => {
    const small = evolution(
      [at(1, 40, '2026-02-10')],
      group.slice(0, 4),
      metrics,
      windows,
      closedDay,
    ).metrics[0]?.points[0];
    expect(small).toMatchObject({ categoryAverage: null, categorySize: null });
  });

  it('averages only peers of the player protocol version, and flags the player mixing two', () => {
    // A peer of another version is another measurement: four players left, no average.
    const otherVersion = evolution(
      [at(1, 40, '2026-02-10')],
      [...group.slice(0, 4), at(5, 36, '2026-02-20', { protocolVersion: 2 })],
      metrics,
      windows,
      closedDay,
    ).metrics[0]?.points[0];
    expect(otherVersion).toMatchObject({ categoryAverage: null, categorySize: null });
    // The player's latest result in the window is version 2: the peers of version 2 count.
    const own = [at(1, 38, '2026-02-05'), at(1, 40, '2026-02-25', { protocolVersion: 2 })];
    const v2 = (key: number, value: number) => at(key, value, '2026-02-10', { protocolVersion: 2 });
    const mixed = evolution(
      own,
      [...own, v2(2, 30), v2(3, 32), v2(4, 34), v2(5, 36), at(6, 90, '2026-02-10')],
      metrics,
      windows,
      closedDay,
    ).metrics[0]?.points[0];
    expect(mixed).toMatchObject({
      categorySize: 5,
      categoryAverage: 34.4,
      categoryMixedProtocolVersions: true,
    });
  });

  it('gives no average while the window is open', () => {
    // A peer loaded later would move the average: polling before and after gives their value.
    for (const today of ['2026-02-20', '2026-02-28']) {
      const open = evolution([at(1, 40, '2026-02-10')], group, metrics, windows, d(today))
        .metrics[0]?.points[0];
      expect(open, today).toMatchObject({ value: 40, categoryAverage: null, categorySize: null });
    }
  });
});

describe('percentileItems', () => {
  it('compares only results of the protocol version of the player latest one', () => {
    const facts: PlayerFacts = { id: 'p' as never, sport: 'rugby', categoryIds: [], ofAge: false };
    const sample = (playerKey: number, value: number, protocolVersion: number): ScoredSample => ({
      playerKey,
      isSubject: playerKey === 0,
      testCode: 'cmj',
      protocolVersion,
      exercise: null,
      metricCode: 'cmj_height_cm',
      direction: 'higher_is_better',
      sex: 'male',
      ageBandCode: 'm15',
      positionCode: null,
      lineCode: null,
      measuredOn: d('2026-02-10'),
      seasonYear: 2026,
      testWindowId: null,
      method: 'manual',
      value,
    });
    const samples = [
      sample(0, 40, 2),
      ...Array.from({ length: 12 }, (_, i) => sample(i + 1, 30 + i, 1)),
    ];
    const [item] = percentileItems(
      samples,
      { facts },
      new Map([['cmj_height_cm', { unit: 'cm', direction: 'higher_is_better' }]]),
      d('2026-03-01'),
      DEFAULT_PERCENTILE_SETTINGS,
    );
    expect(item).toMatchObject({
      protocolVersion: 2,
      status: 'insufficient_sample',
      sampleSize: null,
    });
  });
});

describe('peakZoneOf', () => {
  const m = (measuredOn: string, phvOffsetYears: number | null) => ({
    measuredOn: d(measuredOn),
    phvOffsetYears,
    growthVelocityCmYear: null,
  });

  it('evaluates the newest derived measurement of the last 120 days', () => {
    expect(peakZoneOf([m('2026-10-01', null), m('2026-09-01', 0.4)], d('2026-11-03'))).toEqual({
      inZone: true,
      offset: 'met',
      growthVelocity: 'disabled',
      measuredOn: '2026-09-01',
    });
    expect(peakZoneOf([m('2026-09-01', 1.6)], d('2026-11-03'))?.inZone).toBe(false);
    expect(peakZoneOf([m('2026-03-01', 0.4)], d('2026-11-03'))).toBeNull();
    expect(peakZoneOf([], d('2026-11-03'))).toBeNull();
  });
});
