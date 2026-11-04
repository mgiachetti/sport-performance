import type { CategoryReportColumn, PlayerFirstTeamReference } from '@sport-performance/contracts';
import type { LocalDate, MeasurementMethod } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  batteryCompliance,
  groupEvolution,
  responseCounts,
  responsePeriod,
  type GroupScore,
  type WindowResultRow,
} from './category-report-content.js';

const day = (value: string) => value as LocalDate;
const order = (a: string, b: string) => a.localeCompare(b);

describe('battery compliance of a category report (B-603)', () => {
  const result = (
    playerId: string,
    testCode: string,
    measuredOn: string,
    status: 'done' | 'not_done',
    reason: WindowResultRow['reason'] = null,
  ): WindowResultRow => ({ playerId, testCode, measuredOn: day(measuredOn), status, reason });

  it('counts each scheduled player once per test, by what happened last', () => {
    const expected = new Map([
      ['p1', ['cmj', 'sprint_40']],
      ['p2', ['cmj', 'sprint_40']],
      ['p3', ['cmj']],
      ['p4', ['cmj']],
      ['p5', ['cmj']],
    ]);
    const rows = [
      result('p1', 'cmj', '2026-04-02', 'done'),
      // Absent first, then done: done.
      result('p2', 'cmj', '2026-04-02', 'not_done', 'absent'),
      result('p2', 'cmj', '2026-04-09', 'done'),
      // The latest not-done reason wins.
      result('p3', 'cmj', '2026-04-02', 'not_done', 'absent'),
      result('p3', 'cmj', '2026-04-09', 'not_done', 'unavailable'),
      result('p4', 'cmj', '2026-04-02', 'not_done', 'not_applicable_to_stage'),
      result('p1', 'sprint_40', '2026-04-02', 'not_done', 'other'),
      // A result of a test the battery does not schedule for them is not counted.
      result('p5', 'sprint_40', '2026-04-02', 'done'),
    ];
    expect(batteryCompliance(expected, rows, order)).toEqual([
      {
        testCode: 'cmj',
        expected: 5,
        done: 2,
        notDone: { absent: 0, unavailable: 1, notApplicableToStage: 1, other: 0 },
        noRecord: 1,
      },
      {
        testCode: 'sprint_40',
        expected: 2,
        done: 0,
        notDone: { absent: 0, unavailable: 0, notApplicableToStage: 0, other: 1 },
        noRecord: 1,
      },
    ]);
  });

  it('never tells an injury apart from "not available"', () => {
    const counted = batteryCompliance(
      new Map([['p1', ['cmj']]]),
      [result('p1', 'cmj', '2026-04-02', 'not_done', 'injured')],
      order,
    );
    expect(counted[0]?.notDone).toEqual({
      absent: 0,
      unavailable: 1,
      notApplicableToStage: 0,
      other: 0,
    });
  });
});

describe('group evolution of a category report (B-603)', () => {
  const columns: CategoryReportColumn[] = [
    {
      key: 'w:v1',
      testWindowId: '00000000-0000-4000-8000-0000000000a1' as CategoryReportColumn['testWindowId'],
      seasonName: 'Temporada 2026',
      number: 1,
      startsOn: day('2026-02-01'),
      endsOn: day('2026-02-28'),
    },
    {
      key: 'w:v2',
      testWindowId: '00000000-0000-4000-8000-0000000000a2' as CategoryReportColumn['testWindowId'],
      seasonName: 'Temporada 2026',
      number: 2,
      startsOn: day('2026-04-01'),
      endsOn: day('2026-04-30'),
    },
  ];
  const metrics = new Map([
    ['cmj_height_cm', { unit: 'cm' as const, direction: 'higher_is_better' as const }],
    ['sprint_40_s', { unit: 's' as const, direction: 'lower_is_better' as const }],
  ]);
  const score = (
    playerId: string,
    columnKey: string,
    value: number,
    options: {
      metricCode?: string;
      testCode?: string;
      protocolVersion?: number;
      method?: MeasurementMethod;
      measuredOn?: string;
    } = {},
  ): GroupScore => ({
    playerId,
    columnKey,
    testCode: options.testCode ?? 'cmj',
    metricCode: options.metricCode ?? 'cmj_height_cm',
    exercise: null,
    measuredOn: day(options.measuredOn ?? (columnKey === 'w:v1' ? '2026-02-10' : '2026-04-10')),
    method: options.method ?? 'video',
    protocolVersion: options.protocolVersion ?? 1,
    value,
  });
  const reference: PlayerFirstTeamReference = {
    metricCode: 'cmj_height_cm',
    unit: 'cm',
    direction: 'higher_is_better',
    scope: 'squad',
    value: 52,
    method: null,
    validFrom: day('2026-01-01'),
    source: 'Primera 2025',
  };

  it('averages one value per player from the minimum, and counts the changes', () => {
    const scores = [
      ...['p1', 'p2', 'p3', 'p4', 'p5'].map((id, i) => score(id, 'w:v1', 30 + i)),
      score('p6', 'w:v1', 40),
      // p1 jumps twice in V2: the best counts.
      score('p1', 'w:v2', 29),
      score('p1', 'w:v2', 33, { measuredOn: '2026-04-20' }),
      score('p2', 'w:v2', 31),
      score('p3', 'w:v2', 31),
      score('p4', 'w:v2', 36),
      score('p5', 'w:v2', 35),
      // Measured by hand in V2 after a video in V1: in the average, never in a pair.
      score('p6', 'w:v2', 41, { method: 'manual' }),
    ];
    const [cmj] = groupEvolution(columns, scores, metrics, [reference], order);
    expect(cmj?.points).toEqual([
      {
        columnKey: 'w:v1',
        average: (30 + 31 + 32 + 33 + 34 + 40) / 6,
        players: 6,
        methods: ['video'],
        protocolVersions: [1],
      },
      {
        columnKey: 'w:v2',
        average: (33 + 31 + 31 + 36 + 35 + 41) / 6,
        players: 6,
        methods: ['manual', 'video'],
        protocolVersions: [1],
      },
    ]);
    // p1 30→33, p2 31→31, p3 32→31, p4 33→36, p5 34→35; p6 changed method.
    expect(cmj?.change).toEqual({
      fromColumnKey: 'w:v1',
      paired: 5,
      improved: 3,
      worsened: 1,
      unchanged: 1,
    });
    expect(cmj?.firstTeam).toEqual({ value: 52, unit: 'cm', scope: 'squad' });
  });

  it('tells neither the average nor the size below the minimum, nor pairs across protocols', () => {
    const scores = [
      ...['p1', 'p2', 'p3', 'p4', 'p5'].map((id) =>
        score(id, 'w:v1', 5.6, { metricCode: 'sprint_40_s', testCode: 'sprint_40' }),
      ),
      ...['p1', 'p2', 'p3', 'p4'].map((id) =>
        score(id, 'w:v2', 5.5, { metricCode: 'sprint_40_s', testCode: 'sprint_40' }),
      ),
      score('p5', 'w:v2', 5.4, {
        metricCode: 'sprint_40_s',
        testCode: 'sprint_40',
        protocolVersion: 2,
      }),
    ];
    const [t40] = groupEvolution(columns, scores, metrics, [], order);
    expect(t40?.points[1]).toMatchObject({ players: 5, protocolVersions: [1, 2] });
    expect(t40?.points[1]?.average).toBeCloseTo(5.48);
    // Only four pairs share a protocol version.
    expect(t40?.change).toBeNull();
    expect(t40?.firstTeam).toBeNull();

    const few = groupEvolution(
      columns,
      ['p1', 'p2', 'p3', 'p4'].map((id) => score(id, 'w:v2', 40)),
      metrics,
      [],
      order,
    );
    expect(few[0]?.points).toEqual([
      {
        columnKey: 'w:v2',
        average: null,
        players: null,
        methods: ['video'],
        protocolVersions: [1],
      },
    ]);
    expect(few[0]?.change).toBeNull();
  });

  it('never pairs across measurement methods, even when no column mixes them', () => {
    const scores = [
      ...['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => score(id, 'w:v1', 30, { method: 'manual' })),
      ...['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => score(id, 'w:v2', 35, { method: 'photocell' })),
    ];
    const [cmj] = groupEvolution(columns, scores, metrics, [], order);
    expect(cmj?.points.map((p) => p.methods)).toEqual([['manual'], ['photocell']]);
    expect(cmj?.change).toBeNull();
  });

  it('has no change when the report window has no results of the metric', () => {
    const withPrevious: CategoryReportColumn[] = [
      {
        key: 'w:v3-2025',
        testWindowId:
          '00000000-0000-4000-8000-0000000000a0' as CategoryReportColumn['testWindowId'],
        seasonName: 'Temporada 2025',
        number: 3,
        startsOn: day('2025-07-01'),
        endsOn: day('2025-07-31'),
      },
      ...columns,
    ];
    const players = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const scores = [
      ...players.map((id) => score(id, 'w:v3-2025', 30, { measuredOn: '2025-07-10' })),
      ...players.map((id) => score(id, 'w:v1', 33)),
    ];
    const [cmj] = groupEvolution(withPrevious, scores, metrics, [], order);
    expect(cmj?.points.map((p) => p.columnKey)).toEqual(['w:v3-2025', 'w:v1']);
    // V3 → V1 is not a change up to V2, the report's window.
    expect(cmj?.change).toBeNull();
  });

  it('keeps apart the series of two tests that share a metric code', () => {
    const scores = [
      ...['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => score(id, 'w:v2', 30, { testCode: 'zz_cmj' })),
      ...['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => score(id, 'w:v2', 40, { testCode: 'cmj' })),
    ];
    const series = groupEvolution(columns, scores, metrics, [], order);
    expect(series.map((m) => [m.testCode, m.points[0]?.average])).toEqual([
      ['cmj', 40],
      ['zz_cmj', 30],
    ]);
  });

  it('leaves out metrics outside the catalog and carries no player ids', () => {
    const scores = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) =>
      score(id, 'w:v1', 1, { metricCode: 'unknown_metric' }),
    );
    expect(groupEvolution(columns, scores, metrics, [], order)).toEqual([]);
    const content = JSON.stringify(
      groupEvolution(
        columns,
        ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => score(id, 'w:v1', 30)),
        metrics,
        [],
        order,
      ),
    );
    expect(content).not.toMatch(/p[1-5]/);
  });
});

describe('response rate of a category report (B-603)', () => {
  it('expects wellness on session days and RPE for each participation', () => {
    const counted = responseCounts({
      memberships: [
        { playerId: 'p1', validFrom: day('2026-01-01'), validTo: null },
        { playerId: 'p2', validFrom: day('2026-01-01'), validTo: null },
        // Joined on Wednesday: not expected on Monday.
        { playerId: 'p3', validFrom: day('2026-03-04'), validTo: null },
      ],
      // Monday 2 and Wednesday 4 of March 2026, then Monday 9.
      sessionDays: [day('2026-03-02'), day('2026-03-04'), day('2026-03-04'), day('2026-03-09')],
      participations: [
        { playerId: 'p1', localDate: day('2026-03-02'), status: 'full', rpeReported: true },
        { playerId: 'p2', localDate: day('2026-03-02'), status: 'absent', rpeReported: false },
        { playerId: 'p1', localDate: day('2026-03-04'), status: 'partial', rpeReported: false },
        { playerId: 'p3', localDate: day('2026-03-04'), status: 'unavailable', rpeReported: false },
        { playerId: 'p2', localDate: day('2026-03-09'), status: 'full', rpeReported: true },
      ],
      wellnessDays: [
        { playerId: 'p1', localDate: day('2026-03-02') },
        { playerId: 'p2', localDate: day('2026-03-04') },
        { playerId: 'p2', localDate: day('2026-03-09') },
        // A day without a session is not counted.
        { playerId: 'p1', localDate: day('2026-03-03') },
      ],
    });
    expect(counted).toEqual({
      sessionDays: 3,
      // 02: p1 (yes), p2 absent (not expected); 04: p1 (no), p2 (yes), p3 unavailable;
      // 09: p1 (no), p2 (yes), p3 (no).
      wellness: { expected: 6, answered: 3 },
      rpe: { expected: 3, answered: 2 },
      weeks: [
        {
          weekStart: day('2026-03-02'),
          wellness: { expected: 3, answered: 2 },
          rpe: { expected: 2, answered: 1 },
        },
        {
          weekStart: day('2026-03-09'),
          wellness: { expected: 3, answered: 1 },
          rpe: { expected: 1, answered: 1 },
        },
      ],
    });
  });

  it('covers the days since the previous window of the season', () => {
    const window = { seasonStartsOn: day('2026-02-01'), startsOn: day('2026-04-01') };
    expect(responsePeriod(window, day('2026-02-28'), day('2026-04-30'))).toEqual({
      from: day('2026-03-01'),
      to: day('2026-04-30'),
    });
    expect(responsePeriod(window, null, day('2026-04-15'))).toEqual({
      from: day('2026-02-01'),
      to: day('2026-04-15'),
    });
    expect(
      responsePeriod(
        { seasonStartsOn: day('2026-05-01'), startsOn: day('2026-04-01') },
        null,
        day('2026-04-30'),
      ),
    ).toEqual({ from: day('2026-04-01'), to: day('2026-04-30') });
  });
});
