import type { BatteryEntryDto } from '@sport-performance/contracts';
import { parseLocalDate, type Sex, type Sport, type Stage } from '@sport-performance/domain';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as config from '../test/configuration-fixtures';
import { apiError, type FakeHandlers, type FakeRequest } from '../test/fake-api';
import * as fixtures from '../test/fixtures';
import { renderApp, signedIn } from '../test/render-app';

/** 3 Nov 2026, 12:00 in Buenos Aires. */
const NOW = new Date('2026-11-03T15:00:00.000Z');
const TODAY = '2026-11-03';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const SPRINT_ALL = config.batteryEntry({ testCode: 'sprint_40', windows: [1, 2, 3, 4] });
const CMJ_PERFORMANCE = config.batteryEntry({
  testCode: 'cmj',
  stage: 'performance',
  windows: [1, 3],
  cadenceWeeks: { min: 1, max: 1 },
  validFrom: parseLocalDate('2026-03-01'),
});

function batteryHandlers(entries: readonly BatteryEntryDto[]): FakeHandlers {
  return {
    listCatalogTests: () =>
      fixtures.page([
        config.catalogTest('sprint_40'),
        config.catalogTest('cmj'),
        config.catalogTest('max_squat', { maximalLoad: true }),
      ]),
    getEffectiveBattery: (request: FakeRequest) => {
      const query = request.url.searchParams;
      const stage = query.get('stage') as Stage;
      const applying = entries.filter((entry) => entry.stage === null || entry.stage === stage);
      // The most specific entry per test wins.
      const byTest = new Map<string, BatteryEntryDto>();
      for (const entry of applying) {
        const previous = byTest.get(entry.testCode);
        if (previous === undefined || previous.stage === null) byTest.set(entry.testCode, entry);
      }
      return config.effectiveBattery(
        { sport: query.get('sport') as Sport, sex: query.get('sex') as Sex, stage },
        [...byTest.values()],
      );
    },
    listBatteryEntries: () => fixtures.page(entries),
  };
}

/** ORC by default: men's rugby only. */
const RUGBY_MALE_ONLY = [config.clubBranch('rugby', 'male')];

function as(role: 'coach' | 'sc' | 'admin', extra: FakeHandlers = {}) {
  return {
    ...signedIn({ memberships: [fixtures.membership(role)] }),
    listClubBranches: () => fixtures.page(RUGBY_MALE_ONLY),
    ...extra,
  };
}

describe('configuration: access and navigation', () => {
  it('shows the entry to the staff and the battery matrix read-only to a coach', async () => {
    const { api } = renderApp({
      path: '/configuration',
      handlers: as('coach', batteryHandlers([SPRINT_ALL, CMJ_PERFORMANCE])),
    });
    expect(await screen.findByRole('heading', { name: 'Configuración del club' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Configuración' })).toBeVisible();
    expect(
      screen.getByText(
        'Podés ver la configuración del club. La cambian la preparación física y la administración.',
      ),
    ).toBeVisible();

    const matrix = await screen.findByRole('table', { name: 'Batería de tests' });
    const sprint = within(matrix).getByRole('row', { name: /Sprint 10\/20\/40 m/ });
    expect(within(sprint).getAllByText('V1 · V2 · V3 · V4')).toHaveLength(3);
    const cmj = within(matrix).getByRole('row', { name: /Salto con contramovimiento/ });
    expect(within(cmj).getByText('V1 · V3 + Semanal')).toBeVisible();
    expect(within(cmj).getAllByText('No se hace')).toHaveLength(2);
    expect(within(cmj).getByText('Para la etapa')).toBeVisible();
    // No editing controls for the coach.
    expect(within(matrix).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull();

    const stages = api
      .callsTo('getEffectiveBattery')
      .map((call) => call.url.searchParams.get('stage'));
    expect(stages.sort()).toEqual(['development', 'foundation', 'performance']);
    for (const call of api.callsTo('getEffectiveBattery')) {
      expect(call.url.searchParams.get('sport')).toBe('rugby');
      expect(call.url.searchParams.get('sex')).toBe('male');
    }
    expect(api.unhandled).toEqual([]);
  });

  it('asks for a sport when the user sees more than one', async () => {
    renderApp({
      path: '/configuration',
      handlers: {
        ...signedIn({
          memberships: [fixtures.membership('admin')],
          categories: [fixtures.M15_RUGBY, fixtures.F15_HOCKEY],
        }),
      },
    });
    expect(
      await screen.findByText('Elegí un deporte arriba para ver su configuración.'),
    ).toBeVisible();
  });
});

describe('configuration: battery', () => {
  it('gives a stage its own schedule when the cell inherits a broader entry', async () => {
    const { user, api } = renderApp({
      path: '/configuration',
      handlers: as('sc', {
        ...batteryHandlers([SPRINT_ALL]),
        createBatteryEntry: (request) =>
          config.batteryEntry(request.body as Partial<BatteryEntryDto>),
      }),
    });
    const matrix = await screen.findByRole('table', { name: 'Batería de tests' });
    await user.click(
      within(matrix).getByRole('button', { name: /Cambiar Sprint 10\/20\/40 m en M13 \/ M14/ }),
    );
    const editor = screen.getByRole('region', { name: 'Sprint 10/20/40 m · M13 / M14' });
    expect(
      within(editor).getByText(/sale de una entrada más general \(Todo el deporte\)/),
    ).toBeVisible();
    await user.click(within(editor).getByRole('checkbox', { name: 'V2' }));
    await user.click(within(editor).getByRole('checkbox', { name: 'V4' }));
    await user.click(within(editor).getByRole('button', { name: 'Guardar programación' }));

    expect(await screen.findByText('Listo, se guardó el cambio.')).toBeVisible();
    const body = api.callsTo('createBatteryEntry')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      sport: 'rugby',
      sex: null,
      stage: 'foundation',
      categoryId: null,
      testCode: 'sprint_40',
      windows: [1, 3],
      cadenceWeeks: null,
      validFrom: TODAY,
    });
    expect(body).not.toHaveProperty('closePrevious');
    expect(typeof body.clientUuid).toBe('string');
  });

  it('changes a current entry from a date and stops it on another', async () => {
    const { user, api } = renderApp({
      path: '/configuration',
      handlers: as('sc', {
        ...batteryHandlers([SPRINT_ALL, CMJ_PERFORMANCE]),
        createBatteryEntry: (request) =>
          config.batteryEntry(request.body as Partial<BatteryEntryDto>),
        updateBatteryEntry: () => ({ ...CMJ_PERFORMANCE, validTo: parseLocalDate('2026-12-01') }),
      }),
    });
    const matrix = await screen.findByRole('table', { name: 'Batería de tests' });
    const cell = within(matrix).getByRole('button', {
      name: /Cambiar Salto con contramovimiento \(CMJ\) en M17 \/ M19/,
    });
    await user.click(cell);
    let editor = screen.getByRole('region', { name: /Salto con contramovimiento \(CMJ\) · M17/ });
    expect(within(editor).getByText(/Esta entrada está vigente/)).toBeVisible();
    // Validation before the API: neither windows nor a cadence.
    await user.click(within(editor).getByRole('checkbox', { name: 'V1' }));
    await user.click(within(editor).getByRole('checkbox', { name: 'V3' }));
    await user.click(within(editor).getByRole('checkbox', { name: 'Programación continua' }));
    await user.click(within(editor).getByRole('button', { name: 'Guardar programación' }));
    expect(
      within(editor).getByText('Elegí al menos una ventana o una programación continua.'),
    ).toBeVisible();
    expect(api.callsTo('createBatteryEntry')).toHaveLength(0);

    await user.click(within(editor).getByRole('checkbox', { name: 'Programación continua' }));
    const min = within(editor).getByLabelText('Cada (mínimo, semanas)');
    await user.clear(min);
    await user.type(min, '2');
    const max = within(editor).getByLabelText('Cada (máximo, semanas)');
    await user.clear(max);
    await user.type(max, '3');
    const from = within(editor).getByLabelText('Desde');
    await user.clear(from);
    await user.type(from, '2026-11-10');
    await user.click(within(editor).getByRole('button', { name: 'Guardar programación' }));
    await screen.findByText('Listo, se guardó el cambio.');
    expect(api.callsTo('createBatteryEntry')[0]?.body).toMatchObject({
      stage: 'performance',
      testCode: 'cmj',
      windows: [],
      cadenceWeeks: { min: 2, max: 3 },
      validFrom: '2026-11-10',
      closePrevious: true,
    });

    await user.click(cell);
    editor = screen.getByRole('region', { name: /Salto con contramovimiento \(CMJ\) · M17/ });
    const stopAt = within(editor).getByLabelText('Dejar de hacerlo desde');
    await user.clear(stopAt);
    await user.type(stopAt, '2026-12-01');
    await user.click(within(editor).getByRole('button', { name: 'Dejar de hacerlo' }));
    await waitFor(() => {
      expect(api.callsTo('updateBatteryEntry')).toHaveLength(1);
    });
    expect(api.callsTo('updateBatteryEntry')[0]).toMatchObject({
      params: { batteryEntryId: CMJ_PERFORMANCE.id },
      body: { version: CMJ_PERFORMANCE.version, validTo: '2026-12-01' },
    });
  });

  it('never offers a maximal-load test below the performance stage', async () => {
    renderApp({ path: '/configuration', handlers: as('sc', batteryHandlers([])) });
    const matrix = await screen.findByRole('table', { name: 'Batería de tests' });
    const row = within(matrix).getByRole('row', { name: /max_squat/ });
    expect(within(row).getByText('Cargas máximas')).toBeVisible();
    expect(within(row).getAllByText('No permitido en esta etapa')).toHaveLength(2);
    expect(within(row).getAllByRole('button')).toHaveLength(1);
  });

  it('never edits the other branch from a sport-wide stage entry (two-branch sport)', async () => {
    // A club with both hockey branches; the sc is assigned to the women's one only.
    const F17_HOCKEY = fixtures.category(
      '0192e7a0-2222-7000-8000-000000000117',
      'Sub 17',
      'hockey',
      {
        ageBandCode: 'm17',
        defaultStage: 'performance',
      },
    );
    const sportWide = config.batteryEntry({
      sport: 'hockey',
      testCode: 'cmj',
      stage: 'performance',
      windows: [1, 3],
    });
    const { user, api } = renderApp({
      path: '/configuration',
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')], categories: [F17_HOCKEY] }),
        ...batteryHandlers([sportWide]),
        listClubBranches: () =>
          fixtures.page([
            config.clubBranch('hockey', 'female'),
            config.clubBranch('hockey', 'male'),
          ]),
        createBatteryEntry: (request) =>
          config.batteryEntry(request.body as Partial<BatteryEntryDto>),
      },
    });
    const matrix = await screen.findByRole('table', { name: 'Batería de tests' });
    await user.click(
      within(matrix).getByRole('button', {
        name: /Cambiar Salto con contramovimiento \(CMJ\) en M17 \/ M19/,
      }),
    );
    const editor = screen.getByRole('region', { name: /Salto con contramovimiento \(CMJ\) · M17/ });
    // The sport-wide entry is inherited, not the cell's own: saving adds a women's entry.
    expect(within(editor).getByText(/sale de una entrada más general/)).toBeVisible();
    await user.click(within(editor).getByRole('checkbox', { name: 'V2' }));
    await user.click(within(editor).getByRole('button', { name: 'Guardar programación' }));
    await screen.findByText('Listo, se guardó el cambio.');
    const body = api.callsTo('createBatteryEntry')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      sport: 'hockey',
      sex: 'female',
      stage: 'performance',
      categoryId: null,
      testCode: 'cmj',
      windows: [1, 2, 3],
    });
    expect(body).not.toHaveProperty('closePrevious');
    for (const call of api.callsTo('getEffectiveBattery')) {
      expect(call.url.searchParams.get('sex')).toBe('female');
    }
  });

  it('edits the planned entry of a cell that has no current one of its own', async () => {
    const planned = config.batteryEntry({
      testCode: 'cmj',
      stage: 'development',
      windows: [2],
      validFrom: parseLocalDate('2027-02-01'),
    });
    const { user, api } = renderApp({
      path: '/configuration',
      handlers: as('sc', {
        ...batteryHandlers([SPRINT_ALL, planned]),
        updateBatteryEntry: () => ({ ...planned, windows: [2, 4] }),
      }),
    });
    const matrix = await screen.findByRole('table', { name: 'Batería de tests' });
    await user.click(
      within(matrix).getByRole('button', {
        name: /Cambiar Salto con contramovimiento \(CMJ\) en M15 \/ M16/,
      }),
    );
    const editor = screen.getByRole('region', { name: /Salto con contramovimiento \(CMJ\) · M15/ });
    expect(within(editor).getByRole('checkbox', { name: 'V2' })).toBeChecked();
    await user.click(within(editor).getByRole('checkbox', { name: 'V4' }));
    await user.click(within(editor).getByRole('button', { name: 'Guardar programación' }));
    await screen.findByText('Listo, se guardó el cambio.');
    expect(api.callsTo('createBatteryEntry')).toHaveLength(0);
    expect(api.callsTo('updateBatteryEntry')[0]).toMatchObject({
      params: { batteryEntryId: planned.id },
      body: { version: planned.version, windows: [2, 4], validFrom: '2027-02-01' },
    });
  });

  it('follows the age band of the category for maximal-load tests', async () => {
    // An M13 never does maximal loads, not even matured into the performance stage.
    const M13_RUGBY = fixtures.category('0192e7a0-2222-7000-8000-000000000013', 'M13', 'rugby', {
      ageBandCode: 'm13',
      defaultStage: 'foundation',
    });
    renderApp({
      path: `/configuration?category=${M13_RUGBY.id}`,
      handlers: {
        ...as('sc', batteryHandlers([])),
        ...signedIn({
          memberships: [fixtures.membership('sc')],
          categories: [M13_RUGBY, fixtures.M15_RUGBY],
        }),
      },
    });
    const matrix = await screen.findByRole('table', { name: 'Batería de tests' });
    const row = within(matrix).getByRole('row', { name: /max_squat/ });
    expect(within(row).getAllByText('No permitido en esta etapa')).toHaveLength(3);
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('edits or withdraws a planned entry from the list and explains a conflict', async () => {
    const planned = config.batteryEntry({
      testCode: 'cmj',
      stage: 'development',
      windows: [2],
      validFrom: parseLocalDate('2027-02-01'),
    });
    const { user, api } = renderApp({
      path: '/configuration',
      handlers: as('sc', {
        ...batteryHandlers([SPRINT_ALL, planned]),
        updateBatteryEntry: () => apiError(409, 'conflict', { requestId: 'req-9' }),
        archiveBatteryEntry: () => ({ ...planned, archivedAt: '2026-11-03T15:00:00.000Z' }),
      }),
    });
    const list = await screen.findByRole('table', { name: 'Entradas de la batería' });
    const row = within(list).getByRole('row', { name: /M15 \/ M16/ });
    expect(within(row).getByText('Planificada')).toBeVisible();
    await user.click(within(row).getByRole('button', { name: /Editar/ }));
    const editor = screen.getByRole('region', { name: /Salto con contramovimiento \(CMJ\) · M15/ });
    await user.click(within(editor).getByRole('checkbox', { name: 'V4' }));
    await user.click(within(editor).getByRole('button', { name: 'Guardar programación' }));
    expect(await within(editor).findByRole('alert')).toHaveTextContent('req-9');
    expect(api.callsTo('updateBatteryEntry')[0]?.body).toMatchObject({
      version: planned.version,
      windows: [2, 4],
      validFrom: '2027-02-01',
    });

    await user.click(within(editor).getByRole('button', { name: 'Retirar entrada' }));
    await screen.findByText('Listo, se guardó el cambio.');
    expect(api.callsTo('archiveBatteryEntry')[0]?.params).toEqual({ batteryEntryId: planned.id });
  });
});

describe('configuration: speed zones', () => {
  it('shows the defaults and saves new zones validated by the domain', async () => {
    const { user, api } = renderApp({
      path: '/configuration?section=speed-zones',
      handlers: as('sc', {
        getEffectiveSpeedZones: (request) =>
          config.defaultZones(request.url.searchParams.get('kind') as 'absolute' | 'relative'),
        listSpeedZoneConfigs: () => fixtures.page([]),
        createSpeedZoneConfig: () => config.speedZoneConfig({ validFrom: parseLocalDate(TODAY) }),
      }),
    });
    const card = await screen.findByRole('region', { name: 'Zonas de velocidad absolutas' });
    expect(await within(card).findByText('Zonas por defecto')).toBeVisible();
    const table = within(card).getByRole('table');
    const hsr = within(table).getByRole('row', { name: /Alta velocidad \(HSR\)/ });
    expect(within(hsr).getByText('5,5 m/s')).toBeVisible();
    expect(within(hsr).getByText('7 m/s')).toBeVisible();

    await user.click(within(card).getByRole('button', { name: /Editar zonas/ }));
    const second = within(card).getByLabelText('Desde (m/s) 2');
    await user.clear(second);
    await user.type(second, '0');
    await user.click(within(card).getByRole('button', { name: 'Guardar zonas' }));
    expect(within(card).getByText(/Revisá las zonas/)).toBeVisible();
    expect(api.callsTo('createSpeedZoneConfig')).toHaveLength(0);

    await user.clear(second);
    await user.type(second, '2,5');
    await user.click(within(card).getByRole('button', { name: 'Guardar zonas' }));
    expect(await within(card).findByText('Listo, se guardó el cambio.')).toBeVisible();
    const body = api.callsTo('createSpeedZoneConfig')[0]?.body as {
      zoneSet: { zones: { code: string; minSpeedMs: number }[] };
    };
    expect(body).toMatchObject({
      sport: 'rugby',
      sex: 'male',
      validFrom: TODAY,
      zoneSet: { kind: 'absolute', highSpeedZoneCode: 'high_speed_running' },
    });
    expect(body).not.toHaveProperty('closePrevious');
    expect(body.zoneSet.zones[1]).toEqual({ code: 'jogging', minSpeedMs: 2.5 });
  });

  it('closes the current configuration of the branch when the new one starts', async () => {
    const current = config.speedZoneConfig();
    const { user, api } = renderApp({
      path: '/configuration?section=speed-zones',
      handlers: as('admin', {
        getEffectiveSpeedZones: (request) =>
          request.url.searchParams.get('kind') === 'absolute'
            ? {
                ...config.defaultZones('absolute'),
                source: 'club' as const,
                config: current,
                zoneSet: current.zoneSet,
              }
            : config.defaultZones('relative'),
        listSpeedZoneConfigs: (request) =>
          fixtures.page(request.url.searchParams.get('kind') === 'absolute' ? [current] : []),
        createSpeedZoneConfig: () => current,
      }),
    });
    const card = await screen.findByRole('region', { name: 'Zonas de velocidad absolutas' });
    expect(
      await within(card).findByText('Configuración del club · Desde el 01/03/2026'),
    ).toBeVisible();
    expect(within(card).getByText('Vigente')).toBeVisible();
    await user.click(within(card).getByRole('button', { name: /Editar zonas/ }));
    await user.click(within(card).getByRole('button', { name: 'Guardar zonas' }));
    await within(card).findByText('Listo, se guardó el cambio.');
    expect(api.callsTo('createSpeedZoneConfig')[0]?.body).toMatchObject({ closePrevious: true });
  });
});

describe('configuration: alert rules', () => {
  it('lists the rules with their state and edits one checked by the domain', async () => {
    const rules = config.defaultAlertRules();
    const acwr = rules.find((rule) => rule.code === 'acwr_high');
    if (acwr === undefined) throw new Error('acwr_high is a default rule');
    const { user, api } = renderApp({
      path: '/configuration?section=alert-rules',
      handlers: as('sc', {
        listAlertRules: () => fixtures.page(rules),
        updateAlertRule: () => acwr,
      }),
    });
    expect(
      await screen.findByText(
        'Son heurísticas de monitoreo de carga: avisan para mirar, no predicen lesiones ni diagnostican.',
      ),
    ).toBeVisible();
    const table = await screen.findByRole('table', { name: 'Reglas de alerta' });
    const row = within(table).getByRole('row', { name: /ACWR alto/ });
    expect(within(row).getByText('1,3')).toBeVisible();
    expect(within(row).getByText('1,4')).toBeVisible();
    expect(within(row).getByText('Activa')).toBeVisible();
    expect(within(row).getByText('Todos')).toBeVisible();

    await user.click(within(row).getByRole('button', { name: /Editar/ }));
    const editor = screen.getByRole('region', { name: /Regla ACWR alto/ });
    const warning = within(editor).getByLabelText('Amarillo si el ACWR supera');
    await user.clear(warning);
    await user.type(warning, '1,5');
    await user.click(within(editor).getByRole('button', { name: 'Guardar regla' }));
    expect(
      within(editor).getAllByText(/el rojo tiene que ser al menos tan estricto/).length,
    ).toBeGreaterThan(0);
    expect(api.callsTo('updateAlertRule')).toHaveLength(0);

    await user.clear(warning);
    await user.type(warning, '1,25');
    await user.click(within(editor).getByRole('checkbox', { name: 'M17 / M19' }));
    await user.click(within(editor).getByRole('checkbox', { name: 'Regla activa' }));
    await user.click(within(editor).getByRole('button', { name: 'Guardar regla' }));
    await screen.findByText('Listo, se guardó el cambio.');
    expect(api.callsTo('updateAlertRule')[0]).toMatchObject({
      params: { alertRuleId: acwr.id },
      body: {
        version: acwr.version,
        enabled: false,
        appliesTo: { stages: ['performance'] },
        params: { warningAboveRatio: 1.25, criticalAboveRatio: 1.4, minHistoryDays: 28 },
      },
    });
  });

  it('creates a rule from the defaults of its kind', async () => {
    const { user, api } = renderApp({
      path: '/configuration?section=alert-rules',
      handlers: as('admin', {
        listAlertRules: () => fixtures.page(config.defaultAlertRules()),
        createAlertRule: () => {
          const [rule] = config.defaultAlertRules().filter((r) => r.kind === 'wellness_low');
          if (rule === undefined) throw new Error('wellness_low is a default rule');
          return rule;
        },
      }),
    });
    await screen.findByRole('table', { name: 'Reglas de alerta' });
    await user.click(screen.getByRole('button', { name: 'Nueva regla' }));
    const editor = screen.getByRole('region', { name: 'Nueva regla' });
    await user.selectOptions(within(editor).getByLabelText('Qué evalúa'), 'wellness_low');
    expect(within(editor).getByLabelText('Amarillo con bienestar por debajo de (1–5)')).toHaveValue(
      '3,3',
    );
    await user.type(within(editor).getByLabelText('Código'), 'Bienestar M15');
    await user.click(within(editor).getByRole('button', { name: 'Crear regla' }));
    expect(
      within(editor).getByText('Usá minúsculas, números y guion bajo, empezando por una letra.'),
    ).toBeVisible();
    await user.clear(within(editor).getByLabelText('Código'));
    await user.type(within(editor).getByLabelText('Código'), 'wellness_low_m15');
    await user.click(within(editor).getByRole('checkbox', { name: 'M15 / M16' }));
    await user.click(within(editor).getByRole('button', { name: 'Crear regla' }));
    await screen.findByText('Listo, se guardó el cambio.');
    const body = api.callsTo('createAlertRule')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      code: 'wellness_low_m15',
      kind: 'wellness_low',
      enabled: true,
      appliesTo: { stages: ['development'] },
      params: { warningBelowScore: 3.3, criticalBelowScore: 3 },
    });
    expect(typeof body.clientUuid).toBe('string');
  });
});

describe('configuration: first-team references', () => {
  const metrics = [
    config.catalogMetric('cmj_height_cm', 'cm'),
    config.catalogMetric('sprint_vmax_ms', 'ms', { testCode: 'sprint_40' }),
  ];
  const positions = [
    config.position('hooker', 'forwards'),
    config.position('fly_half', 'backs', 1),
  ];

  it('lists, creates with the metric unit, corrects and archives', async () => {
    const existing = config.referenceValue({
      scope: 'position',
      positionCode: 'hooker',
      positionId: positions[0]?.id ?? null,
    });
    const { user, api } = renderApp({
      path: '/configuration?section=references',
      handlers: as('sc', {
        listReferenceValues: () => fixtures.page([existing]),
        listCatalogMetrics: () => fixtures.page(metrics),
        listPositions: () => fixtures.page(positions),
        createReferenceValue: () => config.referenceValue(),
        updateReferenceValue: () => existing,
        archiveReferenceValue: () => ({ ...existing, archivedAt: '2026-11-03T15:00:00.000Z' }),
      }),
    });
    const table = await screen.findByRole('table', { name: 'Referencias de primera' });
    const row = within(table).getByRole('row', { name: /CMJ/ });
    expect(within(row).getByText('Posición: Hooker')).toBeVisible();
    expect(within(row).getByText('45,5 cm')).toBeVisible();
    expect(within(row).getByText('Video')).toBeVisible();
    expect(within(row).getByText('01/02/2026')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Cargar referencia' }));
    const form = screen.getByRole('region', { name: 'Cargar referencia' });
    await user.selectOptions(within(form).getByLabelText('Métrica'), 'sprint_vmax_ms');
    await user.selectOptions(within(form).getByLabelText('Alcance'), 'line');
    await user.click(within(form).getByRole('button', { name: 'Guardar referencia' }));
    expect(within(form).getByText('Elegí la línea.')).toBeVisible();
    expect(within(form).getByText('Contá de dónde sale el valor.')).toBeVisible();
    await user.selectOptions(within(form).getByLabelText('Línea'), 'backs');
    await user.type(within(form).getByLabelText('Valor (m/s)'), '9,1');
    await user.selectOptions(within(form).getByLabelText('Método'), 'photocell');
    await user.type(within(form).getByLabelText('Fuente'), 'Catapult, pretemporada 2026');
    await user.click(within(form).getByRole('button', { name: 'Guardar referencia' }));
    await screen.findByText('Listo, se guardó el cambio.');
    const body = api.callsTo('createReferenceValue')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      metricCode: 'sprint_vmax_ms',
      sport: 'rugby',
      sex: 'male',
      lineCode: 'backs',
      value: 9.1,
      unit: 'ms',
      method: 'photocell',
      validFrom: TODAY,
      source: 'Catapult, pretemporada 2026',
    });
    expect(body).not.toHaveProperty('positionCode');

    await user.click(within(row).getByRole('button', { name: 'Corregir CMJ' }));
    const editor = screen.getByRole('region', { name: 'Corregir la referencia de CMJ' });
    const value = within(editor).getByLabelText('Valor (cm)');
    expect(value).toHaveValue('45,5');
    await user.clear(value);
    await user.type(value, '46');
    await user.click(within(editor).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      expect(api.callsTo('updateReferenceValue')).toHaveLength(1);
    });
    expect(api.callsTo('updateReferenceValue')[0]?.body).toEqual({
      version: existing.version,
      value: 46,
      validFrom: '2026-02-01',
      source: 'Primera, pretemporada 2026',
      method: 'video',
    });

    await user.click(within(row).getByRole('button', { name: 'Archivar CMJ' }));
    await waitFor(() => {
      expect(api.callsTo('archiveReferenceValue')).toHaveLength(1);
    });
  });

  it('is read-only for a coach', async () => {
    renderApp({
      path: '/configuration?section=references',
      handlers: as('coach', {
        listReferenceValues: () => fixtures.page([config.referenceValue()]),
        listCatalogMetrics: () => fixtures.page(metrics),
        listPositions: () => fixtures.page(positions),
      }),
    });
    const table = await screen.findByRole('table', { name: 'Referencias de primera' });
    expect(within(table).getByText('Plantel')).toBeVisible();
    expect(within(table).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cargar referencia' })).toBeNull();
  });
});
