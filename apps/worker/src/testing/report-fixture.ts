import type { CategoryReportContent, PlayerReportContent } from '@sport-performance/contracts';

/**
 * A report snapshot as the API freezes it (B-602), for the renderer's and
 * the job's tests: a closed V2 with a CMJ against V1, a sprint, a test not
 * done for an injury (already `unavailable`) and a measurement in the peak
 * zone.
 */
export function sampleReportContent(
  overrides: Partial<PlayerReportContent> = {},
): PlayerReportContent {
  return {
    formatVersion: 1,
    locale: 'es-AR',
    timeZone: 'America/Argentina/Buenos_Aires',
    generatedOn: '2026-05-04' as PlayerReportContent['generatedOn'],
    club: {
      name: 'Olivos Rugby Club',
      shortName: 'ORC',
      primaryColor: '#f1882a',
      secondaryColor: '#050505',
      logoFileId: null,
    },
    player: {
      firstName: 'Martín',
      lastName: 'Núñez',
      birthDate: '2011-05-01' as PlayerReportContent['player']['birthDate'],
      sex: 'male',
      sport: 'rugby',
      ageYears: 14,
      categories: ['M15'],
    },
    window: {
      id: '00000000-0000-4000-8000-0000000000a2' as PlayerReportContent['window']['id'],
      seasonName: 'Temporada 2026',
      number: 2,
      startsOn: '2026-04-01' as PlayerReportContent['window']['startsOn'],
      endsOn: '2026-04-30' as PlayerReportContent['window']['endsOn'],
      closed: true,
    },
    tests: [
      {
        testCode: 'cmj',
        metricCode: 'cmj_height_cm',
        exercise: null,
        unit: 'cm',
        direction: 'higher_is_better',
        value: 42.5,
        measuredOn: '2026-04-10' as PlayerReportContent['generatedOn'],
        methods: ['video'],
        protocolVersion: 2,
        previous: {
          seasonName: 'Temporada 2026',
          number: 1,
          startsOn: '2026-02-01' as PlayerReportContent['generatedOn'],
          value: 40,
          methods: ['manual'],
          protocolVersion: 1,
        },
        categoryAverage: 36.25,
        categoryMixedMethods: false,
        categoryMixedProtocolVersions: false,
        firstTeam: { value: 52, unit: 'cm', scope: 'squad' },
        warnings: ['mixed_methods'],
      },
      {
        testCode: 'sprint_40',
        metricCode: 'sprint_40_s',
        exercise: null,
        unit: 's',
        direction: 'lower_is_better',
        value: 5.84,
        measuredOn: '2026-04-10' as PlayerReportContent['generatedOn'],
        methods: ['photocell'],
        protocolVersion: 1,
        previous: null,
        categoryAverage: null,
        categoryMixedMethods: false,
        categoryMixedProtocolVersions: false,
        firstTeam: null,
        warnings: [],
      },
    ],
    notDone: [
      {
        testCode: 'cod_505',
        measuredOn: '2026-04-12' as PlayerReportContent['generatedOn'],
        reason: 'unavailable',
      },
    ],
    evolution: {
      columns: [
        {
          key: 'w:00000000-0000-4000-8000-0000000000a1',
          testWindowId: '00000000-0000-4000-8000-0000000000a1' as never,
          seasonName: 'Temporada 2026',
          number: 1,
          startsOn: '2026-02-01' as PlayerReportContent['generatedOn'],
          endsOn: '2026-02-28' as PlayerReportContent['generatedOn'],
        },
        {
          key: 'w:00000000-0000-4000-8000-0000000000a2',
          testWindowId: '00000000-0000-4000-8000-0000000000a2' as never,
          seasonName: 'Temporada 2026',
          number: 2,
          startsOn: '2026-04-01' as PlayerReportContent['generatedOn'],
          endsOn: '2026-04-30' as PlayerReportContent['generatedOn'],
        },
      ],
      metrics: [
        {
          metricCode: 'cmj_height_cm',
          testCode: 'cmj',
          exercise: null,
          unit: 'cm',
          direction: 'higher_is_better',
          points: [
            {
              columnKey: 'w:00000000-0000-4000-8000-0000000000a1',
              value: 40,
              measuredOn: '2026-02-10' as PlayerReportContent['generatedOn'],
              methods: ['manual'],
              categoryAverage: 34.1,
              categoryMixedMethods: false,
              categoryMixedProtocolVersions: false,
            },
            {
              columnKey: 'w:00000000-0000-4000-8000-0000000000a2',
              value: 42.5,
              measuredOn: '2026-04-10' as PlayerReportContent['generatedOn'],
              methods: ['video'],
              categoryAverage: 36.25,
              categoryMixedMethods: false,
              categoryMixedProtocolVersions: false,
            },
          ],
          warnings: ['mixed_methods'],
        },
      ],
    },
    maturation: {
      measuredOn: '2026-04-05' as PlayerReportContent['generatedOn'],
      heightCm: 168.4,
      sittingHeightCm: 86,
      weightKg: 58.2,
      phvOffsetYears: 0.12,
      maturityOffsetEquation: 'moore_2015',
      predictedAdultHeightCm: 182.3,
      adultHeightPct: 92.4,
      growthVelocityCmYear: 8.4,
      inPeakZone: true,
    },
    ...overrides,
  };
}

/**
 * A category report snapshot as the API freezes it (B-603): a closed V2 of
 * M15 with its battery (one unavailable), the CMJ of the group against V1
 * with the change counted, a sprint below the minimum and two weeks of
 * responses.
 */
export function sampleCategoryReportContent(
  overrides: Partial<CategoryReportContent> = {},
): CategoryReportContent {
  const v1 = 'w:00000000-0000-4000-8000-0000000000a1';
  const v2 = 'w:00000000-0000-4000-8000-0000000000a2';
  const day = (value: string) => value as CategoryReportContent['generatedOn'];
  return {
    formatVersion: 1,
    locale: 'es-AR',
    timeZone: 'America/Argentina/Buenos_Aires',
    generatedOn: day('2026-05-04'),
    club: {
      name: 'Olivos Rugby Club',
      shortName: 'ORC',
      primaryColor: '#f1882a',
      secondaryColor: '#050505',
      logoFileId: null,
    },
    category: {
      id: '00000000-0000-4000-8000-0000000000c5' as CategoryReportContent['category']['id'],
      name: 'M15',
      sport: 'rugby',
      sex: 'male',
      ageBandCode: 'm15',
    },
    window: {
      id: '00000000-0000-4000-8000-0000000000a2' as CategoryReportContent['window']['id'],
      seasonName: 'Temporada 2026',
      number: 2,
      startsOn: day('2026-04-01'),
      endsOn: day('2026-04-30'),
      closed: true,
    },
    roster: {
      players: 24,
      byStage: [
        { stage: 'foundation', players: 4 },
        { stage: 'development', players: 20 },
      ],
    },
    battery: [
      {
        testCode: 'sprint_40',
        expected: 24,
        done: 20,
        notDone: { absent: 2, unavailable: 1, notApplicableToStage: 0, other: 0 },
        noRecord: 1,
      },
      {
        testCode: 'cmj',
        expected: 24,
        done: 22,
        notDone: { absent: 1, unavailable: 0, notApplicableToStage: 0, other: 0 },
        noRecord: 1,
      },
    ],
    evolution: {
      columns: [
        {
          key: v1,
          testWindowId:
            '00000000-0000-4000-8000-0000000000a1' as CategoryReportContent['window']['id'],
          seasonName: 'Temporada 2026',
          number: 1,
          startsOn: day('2026-02-01'),
          endsOn: day('2026-02-28'),
        },
        {
          key: v2,
          testWindowId:
            '00000000-0000-4000-8000-0000000000a2' as CategoryReportContent['window']['id'],
          seasonName: 'Temporada 2026',
          number: 2,
          startsOn: day('2026-04-01'),
          endsOn: day('2026-04-30'),
        },
      ],
      metrics: [
        {
          testCode: 'cmj',
          metricCode: 'cmj_height_cm',
          exercise: null,
          unit: 'cm',
          direction: 'higher_is_better',
          points: [
            {
              columnKey: v1,
              average: 34.2,
              players: 21,
              methods: ['video'],
              protocolVersions: [1],
            },
            {
              columnKey: v2,
              average: 36.1,
              players: 22,
              methods: ['manual', 'video'],
              protocolVersions: [1],
            },
          ],
          change: { fromColumnKey: v1, paired: 20, improved: 14, worsened: 4, unchanged: 2 },
          firstTeam: { value: 52, unit: 'cm', scope: 'squad' },
        },
        {
          testCode: 'sprint_40',
          metricCode: 'sprint_40_s',
          exercise: null,
          unit: 's',
          direction: 'lower_is_better',
          points: [
            {
              columnKey: v2,
              average: null,
              players: null,
              methods: ['photocell'],
              protocolVersions: [1],
            },
          ],
          change: null,
          firstTeam: null,
        },
      ],
    },
    responses: {
      from: day('2026-03-01'),
      to: day('2026-04-30'),
      sessionDays: 6,
      wellness: { expected: 120, answered: 96 },
      rpe: { expected: 100, answered: 70 },
      weeks: [
        {
          weekStart: day('2026-04-20'),
          wellness: { expected: 60, answered: 51 },
          rpe: { expected: 50, answered: 40 },
        },
        {
          weekStart: day('2026-04-27'),
          wellness: { expected: 60, answered: 45 },
          rpe: { expected: 50, answered: 30 },
        },
      ],
    },
    ...overrides,
  };
}
