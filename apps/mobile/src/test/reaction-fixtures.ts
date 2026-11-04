import type {
  Category,
  Club,
  Device,
  Player,
  SyncChange,
  TestDefinitionDto,
  TestResult,
} from '@sport-performance/contracts';
import type { FakeApi } from './fake-api.ts';
import { uuid } from './fake-sync-server.ts';

/**
 * Valid payloads of the reaction test (B-606): they go through the client's
 * response validation like every fixture.
 */

export const AT = '2026-11-03T12:00:00.000Z';
export const VERSION = 'v1';
export const REACTION_DEFINITION_ID = 'd2222222-2222-4222-8222-222222222222';
export const M15_ID = 'e2222222-2222-4222-8222-222222222215';
export const ANA_ID = 'b3333333-3333-4333-8333-333333333331';
export const BRUNO_ID = 'b3333333-3333-4333-8333-333333333332';
export const THIS_DEVICE_ID = 'c4444444-4444-4444-8444-444444444441';
export const OTHER_DEVICE_ID = 'c4444444-4444-4444-8444-444444444442';
export const INSTALLATION_ID = 'f5555555-5555-4555-8555-555555555555';

export function clubDto(): Club {
  return {
    id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
    slug: 'orc',
    name: 'Olivos Rugby Club',
    shortName: 'ORC',
    timeZone: 'America/Argentina/Buenos_Aires',
    locale: 'es-AR',
    colors: { primary: '#f1882a', secondary: '#050505' },
    logoFileId: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
  } as Club;
}

export function categoryDto(id: string, name: string, sortOrder = 0): Category {
  return {
    id,
    sport: 'rugby',
    sex: 'male',
    ageBandCode: 'm15',
    name,
    defaultStage: 'development',
    sortOrder,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
  } as Category;
}

export function reactionDefinitionDto(
  parameters: Record<string, string | number | boolean> = { sameDeviceOnly: true },
): TestDefinitionDto {
  return {
    id: REACTION_DEFINITION_ID,
    code: 'reaction',
    version: 1,
    sports: null,
    attemptCount: 5,
    attemptAggregation: 'mean',
    maximalLoad: false,
    protocol: {
      summary: 'Reacción simple y go/no-go en la app.',
      steps: ['Siempre el mismo celular o tablet.'],
      restBetweenAttemptsS: null,
      equipment: [],
      parameters,
    },
    metrics: [
      { code: 'reaction_simple_msec', unit: 'msec', isDerived: false },
      { code: 'reaction_go_no_go_msec', unit: 'msec', isDerived: false },
    ],
    validFrom: '2026-01-01',
    validTo: null,
    createdAt: AT,
    updatedAt: AT,
  } as unknown as TestDefinitionDto;
}

export function deviceDto(overrides: Partial<Device> = {}): Device {
  return {
    id: THIS_DEVICE_ID,
    kind: 'phone',
    label: 'Celular de la PF',
    model: 'Pixel 9',
    serialNumber: INSTALLATION_ID,
    firmwareVersion: 'Android 16',
    retiredAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  } as Device;
}

export function playerDto(id: string, firstName: string, lastName: string): Player {
  return {
    id,
    firstName,
    lastName,
    birthDate: '2011-05-04',
    sex: 'male',
    sport: 'rugby',
    dominantSide: null,
    positionIds: [],
    currentCategoryIds: [M15_ID],
    joinedOn: '2020-03-01',
    leftOn: null,
    leftReason: null,
    leftNote: null,
    hasAccount: false,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
  } as unknown as Player;
}

/** A scored reaction result as the server serves it. */
export function reactionResultDto(input: {
  readonly playerId: string;
  readonly deviceId: string | null;
  readonly measuredOn: string;
  readonly simpleMs?: number;
  readonly goNoGoMs?: number;
  readonly id?: string;
}): TestResult {
  const scores = [
    ...(input.simpleMs === undefined
      ? []
      : [{ metricCode: 'reaction_simple_msec', value: input.simpleMs }]),
    ...(input.goNoGoMs === undefined
      ? []
      : [{ metricCode: 'reaction_go_no_go_msec', value: input.goNoGoMs }]),
  ];
  return {
    id: input.id ?? uuid(),
    playerId: input.playerId,
    testDefinitionId: REACTION_DEFINITION_ID,
    testCode: 'reaction',
    protocolVersion: 1,
    testSessionId: null,
    measuredOn: input.measuredOn,
    status: 'done',
    notDoneReason: null,
    notDoneNote: null,
    method: 'app',
    evaluatorId: null,
    deviceId: input.deviceId,
    exercise: null,
    conditions: {},
    notes: null,
    importId: null,
    entries: scores.map((score, index) => ({
      id: uuid(),
      kind: 'value',
      attemptNumber: index + 1,
      recordedAt: AT,
      inputs: null,
      values: [
        {
          id: uuid(),
          metricCode: score.metricCode,
          unit: 'msec',
          value: score.value,
          computed: false,
        },
      ],
      issues: [],
      voided: null,
      videoFileId: null,
    })),
    scores: scores.map((score) => ({
      metricCode: score.metricCode,
      unit: 'msec',
      value: score.value,
      aggregation: 'mean',
      attemptCount: 5,
      derived: false,
    })),
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
  } as unknown as TestResult;
}

export function resultChange(result: TestResult, clientUuid: string | null = null): SyncChange {
  return {
    collection: 'test_result',
    op: 'upsert',
    id: result.id,
    clientUuid,
    data: result,
  } as SyncChange;
}

/** The answers of the setup and of the M15 roster; `device: null` is a phone not registered. */
export function reactionRoutes(
  api: FakeApi,
  options: { readonly device?: Device | null; readonly definition?: TestDefinitionDto | null } = {},
): void {
  api.on('GET /v1/club', { status: 200, body: clubDto() });
  api.on('GET /v1/categories', {
    status: 200,
    body: { items: [categoryDto(M15_ID, 'M15')], nextCursor: null },
  });
  api.on('GET /v1/test-definitions', {
    status: 200,
    body: {
      items: options.definition === null ? [] : [options.definition ?? reactionDefinitionDto()],
      nextCursor: null,
    },
  });
  const device = options.device === undefined ? deviceDto() : options.device;
  api.on('GET /v1/devices', {
    status: 200,
    body: { items: device === null ? [] : [device], nextCursor: null },
  });
  api.on('GET /v1/players', {
    status: 200,
    body: {
      items: [playerDto(ANA_ID, 'Ana', 'Acosta'), playerDto(BRUNO_ID, 'Bruno', 'Benítez')],
      nextCursor: null,
    },
  });
}
