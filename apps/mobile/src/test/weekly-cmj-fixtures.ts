import type {
  AlertRuleDto,
  CatalogTest,
  Category,
  Club,
  PanelPlayer,
  SyncChange,
  TestResult,
  WeeklyPanel,
} from '@sport-performance/contracts';
import { DEFAULT_ALERT_RULES, cmjHeightCmFromFlightTimeS } from '@sport-performance/domain';
import type { FakeApi } from './fake-api.ts';
import { uuid } from './fake-sync-server.ts';

/**
 * Valid payloads of the weekly CMJ (B-506): they go through the client's
 * response validation like every fixture.
 */

export const AT = '2026-11-03T12:00:00.000Z';
export const VERSION = 'v1';
export const TODAY = '2026-11-03';
export const CMJ_DEFINITION_ID = 'd1111111-1111-4111-8111-111111111111';
export const M17_ID = 'e1111111-1111-4111-8111-111111111117';
export const M15_ID = 'e1111111-1111-4111-8111-111111111115';
export const ANA_ID = 'b2222222-2222-4222-8222-222222222221';
export const BRUNO_ID = 'b2222222-2222-4222-8222-222222222222';
export const CARLA_ID = 'b2222222-2222-4222-8222-222222222223';

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

export function categoryDto(id: string, name: string, overrides: Partial<Category> = {}): Category {
  return {
    id,
    sport: 'rugby',
    sex: 'male',
    ageBandCode: 'm17',
    name,
    defaultStage: 'performance',
    sortOrder: 0,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  } as Category;
}

export function cmjCatalogTest(overrides: Partial<CatalogTest> = {}): CatalogTest {
  return {
    code: 'cmj',
    testDefinitionId: CMJ_DEFINITION_ID,
    protocolVersion: 2,
    inForce: true,
    sports: null,
    maximalLoad: false,
    attemptCount: 3,
    attemptAggregation: 'best',
    metricCodes: ['cmj_height_cm'],
    validFrom: '2000-01-01',
    validTo: null,
    ...overrides,
  } as CatalogTest;
}

/** The seeded `cmj_drop` rule as the API lists it. */
export function cmjDropRule(overrides: Partial<AlertRuleDto> = {}): AlertRuleDto {
  const rule = DEFAULT_ALERT_RULES.find((candidate) => candidate.kind === 'cmj_drop');
  if (rule === undefined) throw new Error('cmj_drop');
  return {
    id: uuid(),
    code: rule.code,
    kind: rule.kind,
    enabled: rule.enabled,
    appliesTo: {},
    params: { ...rule.params },
    isDefault: true,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  } as AlertRuleDto;
}

export function panelPlayer(
  playerId: string,
  firstName: string,
  overrides: Partial<PanelPlayer> = {},
): PanelPlayer {
  return {
    playerId,
    firstName,
    lastName: 'Pérez',
    sex: 'male',
    sport: 'rugby',
    birthDate: '2009-05-04',
    categoryIds: [M17_ID],
    position: null,
    stage: 'performance',
    maturity: null,
    wellness: {
      submittedToday: false,
      weekEntries: 0,
      weekMeanScore: null,
      latestOn: null,
      latestMeanScore: null,
      latestZScore: null,
    },
    load: {
      weekLoadAu: 0,
      pendingRpeN: 0,
      asOf: null,
      historyDays: 0,
      acwr: null,
      acwrStatus: 'insufficient_history',
      acuteEwmaAu: null,
      chronicEwmaAu: null,
      monotony: null,
      strainAu: null,
      monotonyStatus: 'insufficient_history',
      weeks: [0, 1, 2, 3].map(() => ({ loadAu: 0, hasData: false, chronicWeeklyAu: null })),
    },
    availability: { training: 'available', match: 'available', overall: 'available' },
    alerts: [],
    ...overrides,
  } as PanelPlayer;
}

export function weeklyPanel(players: readonly PanelPlayer[]): WeeklyPanel {
  const weeks = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'].map((from, index) => ({
    from,
    to: ['2026-10-18', '2026-10-25', '2026-11-01', '2026-11-08'][index],
  }));
  return {
    today: TODAY,
    week: { from: '2026-11-02', to: '2026-11-08' },
    referenceDate: TODAY,
    weeks,
    players: [...players],
  } as WeeklyPanel;
}

/** A scored CMJ result as the server serves it: one attempt per height, the best counted. */
export function cmjResultDto(input: {
  readonly playerId: string;
  readonly measuredOn: string;
  readonly heightsCm: readonly number[];
  readonly method?: TestResult['method'];
  readonly clientUuid?: string;
  readonly id?: string;
  readonly flightTimesS?: readonly number[];
}): TestResult {
  const heights =
    input.flightTimesS?.map((flightTimeS) => cmjHeightCmFromFlightTimeS(flightTimeS)) ??
    input.heightsCm;
  const entries = heights.map((heightCm, index) => {
    const id = uuid();
    const flightTimeS = input.flightTimesS?.[index];
    return {
      id,
      kind: flightTimeS === undefined ? 'value' : 'cmj_flight_time',
      attemptNumber: index + 1,
      recordedAt: AT,
      inputs: flightTimeS === undefined ? null : { kind: 'cmj_flight_time', flightTimeS },
      values: [
        {
          id: uuid(),
          metricCode: 'cmj_height_cm',
          unit: 'cm',
          value: heightCm,
          computed: flightTimeS !== undefined,
        },
      ],
      issues: [],
      voided: null,
    };
  });
  return {
    id: input.id ?? uuid(),
    playerId: input.playerId,
    testDefinitionId: CMJ_DEFINITION_ID,
    testCode: 'cmj',
    protocolVersion: 2,
    testSessionId: null,
    measuredOn: input.measuredOn,
    status: 'done',
    notDoneReason: null,
    notDoneNote: null,
    method: input.method ?? 'app',
    evaluatorId: null,
    deviceId: null,
    exercise: null,
    conditions: {},
    notes: null,
    importId: null,
    entries,
    scores: [
      {
        metricCode: 'cmj_height_cm',
        unit: 'cm',
        value: Math.max(...heights),
        aggregation: 'best',
        attemptCount: heights.length,
        derived: false,
      },
    ],
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

/** The answers of the setup and of the M17 panel. */
export function weeklyCmjRoutes(
  api: FakeApi,
  options: {
    readonly players?: readonly PanelPlayer[];
    readonly rules?: readonly AlertRuleDto[];
    readonly test?: CatalogTest | null;
  } = {},
): void {
  api.on('GET /v1/club', { status: 200, body: clubDto() });
  api.on('GET /v1/categories', {
    status: 200,
    body: {
      items: [
        categoryDto(M17_ID, 'M17'),
        categoryDto(M15_ID, 'M15', { defaultStage: 'development', sortOrder: 1 }),
      ],
      nextCursor: null,
    },
  });
  api.on('GET /v1/catalog/tests', {
    status: 200,
    body: {
      items: options.test === null ? [] : [options.test ?? cmjCatalogTest()],
      nextCursor: null,
    },
  });
  api.on('GET /v1/configuration/alert-rules', {
    status: 200,
    body: { items: options.rules ?? [cmjDropRule()], nextCursor: null },
  });
  api.on('GET /v1/panel/weekly', {
    status: 200,
    body: weeklyPanel(
      options.players ?? [
        panelPlayer(ANA_ID, 'Ana'),
        panelPlayer(BRUNO_ID, 'Bruno'),
        panelPlayer(CARLA_ID, 'Carla', { stage: 'development' }),
      ],
    ),
  });
}
