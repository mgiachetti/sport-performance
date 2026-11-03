import type {
  PlayerFirstTeamReference,
  TestEvolutionColumn,
  TestEvolutionMetric,
} from '@sport-performance/contracts';
import type { LocalDate } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { reportNotDone, reportTests } from './player-report-content.js';

const day = (value: string) => value as LocalDate;

function column(n: number): TestEvolutionColumn {
  const month = String(n * 2).padStart(2, '0');
  return {
    key: `w:w${String(n)}`,
    testWindowId: `w${String(n)}` as TestEvolutionColumn['testWindowId'],
    seasonName: 'Temporada 2026',
    number: ((n - 1) % 4) + 1,
    startsOn: day(`2026-${month}-01`),
    endsOn: day(`2026-${month}-28`),
  };
}

function point(n: number, value: number, categoryAverage: number | null = null) {
  return {
    columnKey: `w:w${String(n)}`,
    value,
    measuredOn: day(`2026-${String(n * 2).padStart(2, '0')}-10`),
    methods: ['manual' as const],
    categoryAverage,
    categorySize: categoryAverage === null ? null : 6,
    categoryMixedMethods: false,
    categoryMixedProtocolVersions: false,
  };
}

const cmj: TestEvolutionMetric = {
  metricCode: 'cmj_height_cm',
  testCode: 'cmj',
  exercise: null,
  unit: 'cm',
  direction: 'higher_is_better',
  points: [point(1, 38, 33), point(3, 40, 34), point(4, 42)],
  warnings: [],
};
const sprint: TestEvolutionMetric = {
  metricCode: 'sprint_40_s',
  testCode: 'sprint_40',
  exercise: null,
  unit: 's',
  direction: 'lower_is_better',
  points: [point(1, 6.1)],
  warnings: [],
};
const reference: PlayerFirstTeamReference = {
  metricCode: 'cmj_height_cm',
  unit: 'cm',
  direction: 'higher_is_better',
  scope: 'line',
  value: 52,
  method: null,
  validFrom: day('2025-01-01'),
  source: 'Primera',
};

describe('player report snapshot (B-602)', () => {
  const series = { columns: [1, 2, 3, 4].map(column), metrics: [cmj, sprint] };

  it('takes the tests of the window with their previous column and references', () => {
    const { tests } = reportTests(series, 'w4', [reference]);
    expect(tests).toEqual([
      expect.objectContaining({
        metricCode: 'cmj_height_cm',
        value: 42,
        // The previous column with a value (V3), not the window right before.
        previous: expect.objectContaining({ number: 3, value: 40 }) as unknown,
        categoryAverage: null,
        firstTeam: { value: 52, unit: 'cm', scope: 'line' },
      }),
    ]);
    // The sprint was not done in the window: not a test of the report.
    expect(reportTests(series, 'w1', []).tests.map((t) => t.metricCode)).toEqual([
      'cmj_height_cm',
      'sprint_40_s',
    ]);
    expect(reportTests(series, 'w1', []).tests[0]?.previous).toBeNull();
  });

  it('keeps the evolution up to the window, never after it', () => {
    const { evolution } = reportTests(series, 'w3', []);
    expect(evolution.columns.map((c) => c.key)).toEqual(['w:w1', 'w:w2', 'w:w3']);
    expect(evolution.metrics.find((m) => m.metricCode === 'cmj_height_cm')?.points).toHaveLength(2);
    // A window without the player's results has no tests nor evolution.
    expect(reportTests(series, 'w9', [])).toEqual({
      tests: [],
      evolution: { columns: [], metrics: [] },
    });
  });

  it('keeps at most six columns of evolution', () => {
    const columns = Array.from({ length: 9 }, (_, i) => column(i + 1));
    const many = {
      columns,
      metrics: [{ ...cmj, points: columns.map((_, i) => point(i + 1, 30 + i)) }],
    };
    const { evolution } = reportTests(many, 'w9', []);
    expect(evolution.columns.map((c) => c.key)).toEqual([
      'w:w4',
      'w:w5',
      'w:w6',
      'w:w7',
      'w:w8',
      'w:w9',
    ]);
  });

  it('ignores a reference of a strength exercise or of another unit', () => {
    const strength = { ...cmj, exercise: 'bench_press' };
    expect(
      reportTests({ ...series, metrics: [strength] }, 'w4', [reference]).tests[0]?.firstTeam,
    ).toBeNull();
    expect(
      reportTests(series, 'w4', [{ ...reference, unit: 'mm' }]).tests[0]?.firstTeam,
    ).toBeNull();
  });

  it('lists the tests not done without a later done one, an injury as unavailable', () => {
    expect(
      reportNotDone([
        {
          testCode: 'cod_505',
          measuredOn: day('2026-04-10'),
          status: 'not_done',
          reason: 'injured',
        },
        { testCode: 'cmj', measuredOn: day('2026-04-10'), status: 'not_done', reason: 'absent' },
        { testCode: 'cmj', measuredOn: day('2026-04-20'), status: 'done', reason: null },
        {
          testCode: 'ift_3015',
          measuredOn: day('2026-04-02'),
          status: 'not_done',
          reason: 'other',
        },
        {
          testCode: 'ift_3015',
          measuredOn: day('2026-04-22'),
          status: 'not_done',
          reason: 'absent',
        },
      ]),
    ).toEqual([
      { testCode: 'cod_505', measuredOn: '2026-04-10', reason: 'unavailable' },
      { testCode: 'ift_3015', measuredOn: '2026-04-22', reason: 'absent' },
    ]);
  });
});
