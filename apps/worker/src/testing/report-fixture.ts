import type { PlayerReportContent } from '@sport-performance/contracts';

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
