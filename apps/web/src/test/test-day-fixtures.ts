import type {
  TestDaySheet,
  TestDaySheetPlayer,
  TestDaySheetStation,
  TestResult,
  TestSession,
} from '@sport-performance/contracts';
import { parsePlayerId, parseUuid } from '@sport-performance/domain';
import { M15_RUGBY, USER } from './fixtures';

/** Valid payloads of the test day endpoints (B-405), for the web tests. */

const AT = '2026-04-14T12:00:00.000Z';
const VERSION = '1793586338688123';

export const SESSION_ID = parseUuid('0192e7a0-4444-7000-8000-000000000001');
export const WINDOW_ID = parseUuid('0192e7a0-4444-7000-8000-0000000000f2');
export const DEVICE_ID = parseUuid('0192e7a0-4444-7000-8000-0000000000d1');

export function testSession(overrides: Partial<TestSession> = {}): TestSession {
  return {
    id: SESSION_ID,
    sport: 'rugby',
    categoryId: M15_RUGBY.id,
    testWindowId: WINDOW_ID,
    scheduledOn: '2026-04-14' as TestSession['scheduledOn'],
    status: 'in_progress',
    location: 'Cancha 2',
    conditions: { surface: 'césped natural', footwear: 'botines', standardizedWarmUp: true },
    notes: null,
    evaluatorId: USER.id,
    startedAt: AT,
    completedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

type Definition = TestDaySheetStation['definition'];

function definition(
  code: string,
  id: string,
  overrides: Partial<Definition> & Pick<Definition, 'metrics' | 'entryKinds'>,
): Definition {
  return {
    id: parseUuid(id),
    code,
    version: 1,
    sports: null,
    attemptCount: 3,
    attemptAggregation: 'best',
    maximalLoad: false,
    sameDeviceOnly: false,
    protocol: {
      summary: `Protocolo de ${code}.`,
      steps: ['Entrada en calor estandarizada antes del test.'],
      restBetweenAttemptsS: 180,
      equipment: ['conos'],
      parameters: {},
    },
    validFrom: '2026-01-01' as Definition['validFrom'],
    validTo: null,
    ...overrides,
  };
}

const metric = (
  code: string,
  unit: string,
  direction: 'higher_is_better' | 'lower_is_better' | 'neutral',
  derived = false,
) => ({ code, unit, direction, derived });

export const SPRINT: TestDaySheetStation = {
  testCode: 'sprint_40',
  scheduled: true,
  definition: definition('sprint_40', '0192e7a0-5555-7000-8000-000000000001', {
    entryKinds: ['sprint_splits', 'value'],
    metrics: [
      metric('sprint_10_s', 's', 'lower_is_better'),
      metric('sprint_20_s', 's', 'lower_is_better'),
      metric('sprint_40_s', 's', 'lower_is_better'),
      metric('sprint_vmax_ms', 'ms', 'higher_is_better', true),
    ],
  }),
};

export const CMJ: TestDaySheetStation = {
  testCode: 'cmj',
  scheduled: true,
  definition: definition('cmj', '0192e7a0-5555-7000-8000-000000000002', {
    entryKinds: ['cmj_flight_time', 'cmj_video_frames', 'value'],
    metrics: [metric('cmj_height_cm', 'cm', 'higher_is_better')],
    protocol: {
      summary: 'Salto con contramovimiento, manos en la cintura.',
      steps: [],
      restBetweenAttemptsS: 60,
      equipment: [],
      parameters: { gravityMs2: 9.81 },
    },
  }),
};

export const COD_505: TestDaySheetStation = {
  testCode: 'cod_505',
  scheduled: true,
  definition: definition('cod_505', '0192e7a0-5555-7000-8000-000000000003', {
    attemptCount: 2,
    entryKinds: ['value'],
    metrics: [
      metric('cod505_left_s', 's', 'lower_is_better'),
      metric('cod505_right_s', 's', 'lower_is_better'),
      metric('cod505_asymmetry_pct', 'pct', 'lower_is_better', true),
    ],
  }),
};

export const STRENGTH: TestDaySheetStation = {
  testCode: 'strength',
  scheduled: true,
  definition: definition('strength', '0192e7a0-5555-7000-8000-000000000004', {
    attemptCount: 1,
    entryKinds: ['strength_set', 'value'],
    metrics: [
      metric('pushups_n', 'n', 'higher_is_better'),
      metric('pullups_n', 'n', 'higher_is_better'),
      metric('plank_s', 's', 'higher_is_better'),
      metric('technique_score', 'score', 'higher_is_better'),
      metric('e1rm_kg', 'kg', 'higher_is_better', true),
      metric('rm1_kg', 'kg', 'higher_is_better'),
      metric('rm3_kg', 'kg', 'higher_is_better'),
      metric('relative_strength_kg_kg', 'kg_kg', 'higher_is_better', true),
    ],
  }),
};

export const REACTION: TestDaySheetStation = {
  testCode: 'reaction',
  scheduled: true,
  definition: definition('reaction', '0192e7a0-5555-7000-8000-000000000005', {
    attemptCount: 5,
    attemptAggregation: 'mean',
    sameDeviceOnly: true,
    entryKinds: ['value'],
    metrics: [
      metric('reaction_simple_msec', 'msec', 'lower_is_better'),
      metric('reaction_go_no_go_msec', 'msec', 'lower_is_better'),
    ],
  }),
};

export const ANA_ID = parsePlayerId('0192e7a0-6666-7000-8000-000000000001');
export const BRUNO_ID = parsePlayerId('0192e7a0-6666-7000-8000-000000000002');
export const DIEGO_ID = parsePlayerId('0192e7a0-6666-7000-8000-000000000003');

export function sheetPlayer(
  overrides: Partial<TestDaySheetPlayer> & Pick<TestDaySheetPlayer, 'id' | 'lastName'>,
  stations: readonly TestDaySheetStation[],
): TestDaySheetPlayer {
  return {
    firstName: 'Juan',
    sex: 'male',
    birthDate: '2011-05-01' as TestDaySheetPlayer['birthDate'],
    inCategory: true,
    recording: 'allowed',
    video: 'allowed',
    stage: 'development',
    strengthAssessment: 'estimated_rm',
    tests: stations.map((s) => ({ testCode: s.testCode, applicable: true, reason: null })),
    previous: [],
    ...overrides,
  };
}

export function sheet(overrides: Partial<TestDaySheet> = {}): TestDaySheet {
  const stations = overrides.stations ?? [SPRINT, CMJ, COD_505];
  return {
    testSession: testSession(),
    testWindow: { id: WINDOW_ID, number: 2, label: 'V2' },
    stations,
    players: [
      sheetPlayer(
        {
          id: ANA_ID,
          lastName: 'Álvarez',
          previous: [
            {
              testCode: 'sprint_40',
              testResultId: parseUuid('0192e7a0-7777-7000-8000-000000000001'),
              measuredOn: '2026-02-10' as TestDaySheetPlayer['birthDate'],
              method: 'manual',
              protocolVersion: 1,
              deviceId: null,
              exercise: null,
              scores: [
                {
                  metricCode: 'sprint_40_s',
                  unit: 's',
                  value: 5.6,
                  aggregation: 'best',
                  attemptCount: 3,
                  derived: false,
                },
              ],
            },
          ],
        },
        stations,
      ),
      sheetPlayer({ id: BRUNO_ID, lastName: 'Benítez' }, stations),
      sheetPlayer({ id: DIEGO_ID, lastName: 'Díaz', recording: 'missing_consent' }, stations),
    ],
    devices: [{ id: DEVICE_ID, kind: 'tablet', label: 'Tablet 1' }],
    ...overrides,
  };
}

/** A recorded sprint result of a player on the day, with one attempt. */
export function sprintResult(playerId: string, overrides: Partial<TestResult> = {}): TestResult {
  const resultId = parseUuid('0192e7a0-8888-7000-8000-000000000001');
  return {
    id: resultId,
    playerId: parsePlayerId(playerId),
    testDefinitionId: SPRINT.definition.id,
    testCode: 'sprint_40',
    protocolVersion: 1,
    testSessionId: SESSION_ID,
    measuredOn: '2026-04-14' as TestResult['measuredOn'],
    status: 'done',
    notDoneReason: null,
    notDoneNote: null,
    method: 'photocell',
    evaluatorId: USER.id,
    deviceId: null,
    exercise: null,
    conditions: {},
    notes: null,
    importId: null,
    entries: [
      {
        id: parseUuid('0192e7a0-9999-7000-8000-000000000001'),
        kind: 'sprint_splits',
        attemptNumber: 1,
        recordedAt: AT,
        inputs: { split20S: 3.1, split40S: 5.4 },
        values: [
          {
            id: parseUuid('0192e7a0-9999-7000-8000-0000000000a1'),
            metricCode: 'sprint_20_s',
            unit: 's',
            value: 3.1,
            computed: false,
          },
          {
            id: parseUuid('0192e7a0-9999-7000-8000-0000000000a2'),
            metricCode: 'sprint_40_s',
            unit: 's',
            value: 5.4,
            computed: false,
          },
        ],
        issues: [],
        voided: null,
        videoFileId: null,
      },
    ],
    scores: [
      {
        metricCode: 'sprint_40_s',
        unit: 's',
        value: 5.4,
        aggregation: 'best',
        attemptCount: 1,
        derived: false,
      },
    ],
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}
