import type { AlertDto, EndpointOutput, ApiEndpoints, Player } from '@sport-performance/contracts';
import {
  addDays,
  localDateInTimeZone,
  parsePlayerId,
  parseTimeZone,
  parseUuid,
  type LocalDate,
} from '@sport-performance/domain';
import { cleanup, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { apiError, type FakeHandlers } from '../../test/fake-api';
import * as fixtures from '../../test/fixtures';
import { renderApp, signedIn } from '../../test/render-app';
import { forgetRememberedTabs } from '../../ui/tab-memory';
import { alertMessageValues, formatAlertValue } from './format';

const AT = '2026-11-01T12:00:00.000Z';
const VERSION = '1793586338688123';
const PLAYER_ID = parsePlayerId('0192e7a0-4444-7000-8000-000000000001');
const WINDOW_V1 = parseUuid('0192e7a0-5555-7000-8000-000000000001');
const WINDOW_V2 = parseUuid('0192e7a0-5555-7000-8000-000000000002');
const TODAY = localDateInTimeZone(new Date(), parseTimeZone('America/Argentina/Buenos_Aires'));

type Output<K extends keyof ApiEndpoints> = EndpointOutput<ApiEndpoints[K]>;

function player(overrides: Partial<Player> = {}): Player {
  return {
    id: PLAYER_ID,
    firstName: 'Tomás',
    lastName: 'Pérez',
    birthDate: '2011-05-01' as LocalDate,
    sex: 'male',
    sport: 'rugby',
    dominantSide: 'right',
    positionIds: [],
    currentCategoryIds: [fixtures.M15_RUGBY.id],
    joinedOn: '2020-01-01' as LocalDate,
    leftOn: null,
    leftReason: null,
    leftNote: null,
    hasAccount: true,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

function dailyMonitoring(): Output<'getPlayerDailyMonitoring'> {
  const from = addDays(TODAY, -27);
  return {
    playerId: PLAYER_ID,
    from,
    to: TODAY,
    today: TODAY,
    refreshPending: false,
    load: Array.from({ length: 28 }, (_, index) => ({
      date: addDays(from, index),
      loadAu: index % 2 === 0 ? 420 : 0,
      hasData: index % 2 === 0,
      sessions: index % 2 === 0 ? 1 : 0,
      externalLoadAu: index === 26 ? 120 : 0,
      externalActivities: index === 26 ? 1 : 0,
      pendingRpe: index === 27 ? 1 : 0,
      historyDays: 40 + index,
      acuteEwmaAu: 300,
      chronicEwmaAu: 250,
      acwr: 1.45,
      acwrStatus: 'ok' as const,
      missingDaysAcute: 0,
      missingDaysChronic: 0,
      weekLoadAu: 1680,
      monotony: 1.25,
      strainAu: 2100,
      monotonyStatus: 'ok' as const,
    })),
    wellness: [
      {
        date: TODAY,
        itemCount: 5,
        meanScore: 3.2,
        baselineSamples: 14,
        baselineMeanScore: 4,
        baselineSdScore: 0.4,
        zScore: -2,
      },
    ],
  };
}

function maturation(): Output<'getPlayerMaturation'> {
  return {
    playerId: PLAYER_ID,
    today: TODAY,
    stage: { stage: 'development', basis: 'maturation', categoryId: fixtures.M15_RUGBY.id },
    refreshPending: false,
    peakZone: {
      inZone: true,
      offset: 'met',
      growthVelocity: 'disabled',
      measuredOn: '2026-10-01' as LocalDate,
    },
    measurements: [
      {
        id: parseUuid('0192e7a0-6666-7000-8000-000000000001'),
        measuredOn: '2026-10-01' as LocalDate,
        heightCm: 168,
        sittingHeightCm: 86,
        weightKg: 58,
        skinfoldsSumMm: null,
        method: 'manual',
        phvOffsetYears: 0.4,
        maturityOffsetEquation: 'moore_2015',
        predictedAdultHeightCm: 182,
        adultHeightPct: 92.3,
        growthVelocityCmYear: 8.6,
        derivedAt: AT,
      },
    ],
  };
}

function availability(): Output<'getPlayerAvailability'> {
  return {
    playerId: PLAYER_ID,
    today: TODAY,
    from: addDays(TODAY, -89),
    to: TODAY,
    current: {
      training: 'limited',
      match: 'unavailable',
      overall: 'unavailable',
      staffNotes: ['Sin contacto'],
    },
    periods: [
      {
        from: addDays(TODAY, -89),
        to: addDays(TODAY, -6),
        training: 'available',
        match: 'available',
        overall: 'available',
      },
      {
        from: addDays(TODAY, -5),
        to: TODAY,
        training: 'limited',
        match: 'unavailable',
        overall: 'unavailable',
      },
    ],
  };
}

function percentiles(): Output<'getPlayerPercentiles'> {
  return {
    playerId: PLAYER_ID,
    asOf: TODAY,
    minSampleSize: 10,
    items: [
      {
        metricCode: 'cmj_height_cm',
        testCode: 'cmj',
        exercise: null,
        unit: 'cm',
        direction: 'higher_is_better',
        value: 42,
        measuredOn: '2026-04-10' as LocalDate,
        method: 'manual',
        protocolVersion: 1,
        status: 'ok',
        percentile: 95,
        sampleSize: 24,
        grouping: { dimensions: ['sex', 'category'], seasonsAccumulated: 3 },
        seasonFrom: 2024,
        seasonTo: 2026,
        median: 35,
        mixedMethods: false,
      },
      {
        metricCode: 'vift_kmh',
        testCode: 'ift_3015',
        exercise: null,
        unit: 'kmh',
        direction: 'higher_is_better',
        value: 18.5,
        measuredOn: '2026-02-12' as LocalDate,
        method: 'app',
        protocolVersion: 1,
        status: 'insufficient_sample',
        percentile: null,
        sampleSize: null,
        grouping: null,
        seasonFrom: null,
        seasonTo: null,
        median: null,
        mixedMethods: false,
      },
    ],
  };
}

function evolution(): Output<'getPlayerTestEvolution'> {
  return {
    playerId: PLAYER_ID,
    columns: [
      {
        key: `w:${WINDOW_V1}`,
        testWindowId: WINDOW_V1,
        seasonName: '2026',
        number: 1,
        startsOn: '2026-02-01' as LocalDate,
        endsOn: '2026-02-28' as LocalDate,
      },
      {
        key: `w:${WINDOW_V2}`,
        testWindowId: WINDOW_V2,
        seasonName: '2026',
        number: 2,
        startsOn: '2026-04-01' as LocalDate,
        endsOn: '2026-04-30' as LocalDate,
      },
    ],
    metrics: [
      {
        metricCode: 'cmj_height_cm',
        testCode: 'cmj',
        exercise: null,
        unit: 'cm',
        direction: 'higher_is_better',
        warnings: ['mixed_methods'],
        points: [
          {
            columnKey: `w:${WINDOW_V1}`,
            value: 40,
            measuredOn: '2026-02-10' as LocalDate,
            methods: ['manual'],
            protocolVersion: 1,
            categoryAverage: 34.6,
            categorySize: 10,
            categoryMixedMethods: false,
            categoryMixedProtocolVersions: false,
          },
          {
            columnKey: `w:${WINDOW_V2}`,
            value: 42,
            measuredOn: '2026-04-10' as LocalDate,
            methods: ['video'],
            protocolVersion: 1,
            categoryAverage: null,
            categorySize: null,
            categoryMixedMethods: false,
            categoryMixedProtocolVersions: false,
          },
        ],
      },
      {
        metricCode: 'sprint_40_s',
        testCode: 'sprint_40',
        exercise: null,
        unit: 's',
        direction: 'lower_is_better',
        warnings: [],
        points: [
          {
            columnKey: `w:${WINDOW_V1}`,
            value: 5.62,
            measuredOn: '2026-02-10' as LocalDate,
            methods: ['photocell'],
            protocolVersion: 1,
            categoryAverage: 5.8,
            categorySize: 12,
            categoryMixedMethods: false,
            categoryMixedProtocolVersions: false,
          },
        ],
      },
    ],
  };
}

function alert(overrides: Partial<AlertDto>): AlertDto {
  return {
    id: parseUuid('0192e7a0-7777-7000-8000-000000000001'),
    playerId: PLAYER_ID,
    ruleId: parseUuid('0192e7a0-8888-7000-8000-000000000001'),
    ruleCode: 'acwr_high',
    kind: 'acwr_high',
    severity: 'critical',
    currentSeverity: 'critical',
    raisedOn: addDays(TODAY, -2),
    lastSeenOn: TODAY,
    resolvedOn: null,
    observedOn: TODAY,
    messageKey: 'alert.acwr_high.message',
    suggestionKey: 'alert.acwr_high.suggestion',
    values: { acwrRatio: 1.4512, thresholdRatio: 1.4 },
    status: 'open',
    acknowledgedAt: null,
    acknowledgedBy: null,
    acknowledgementNote: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

function profileHandlers(overrides: FakeHandlers = {}): FakeHandlers {
  return {
    getPlayer: () => player(),
    listPositions: () => fixtures.page([]),
    getPlayerGymSummary: () => ({
      playerId: PLAYER_ID,
      from: '2025-11-03' as LocalDate,
      to: '2026-11-03' as LocalDate,
      exercises: [],
    }),
    listGymSets: () => fixtures.page([]),
    getPlayerDailyMonitoring: () => dailyMonitoring(),
    getPlayerMaturation: () => maturation(),
    getPlayerAvailability: () => availability(),
    getPlayerPercentiles: () => percentiles(),
    getPlayerTestEvolution: () => evolution(),
    getPlayerFirstTeamReferences: () => ({
      playerId: PLAYER_ID,
      asOf: TODAY,
      sport: 'rugby',
      sex: 'male',
      positionCode: null,
      lineCode: null,
      items: [
        {
          metricCode: 'cmj_height_cm',
          unit: 'cm',
          direction: 'higher_is_better',
          scope: 'squad',
          value: 45.5,
          method: null,
          validFrom: '2026-02-01' as LocalDate,
          source: 'Primera 2026',
        },
      ],
    }),
    listAlerts: () =>
      fixtures.page([
        alert({}),
        alert({
          id: parseUuid('0192e7a0-7777-7000-8000-000000000002'),
          kind: 'growth_peak',
          ruleCode: 'growth_peak',
          severity: 'warning',
          currentSeverity: 'warning',
          messageKey: 'alert.growth_peak.message',
          suggestionKey: 'alert.growth_peak.suggestion',
          values: { velocityCmYear: 8.6, thresholdCmYear: 8 },
        }),
        alert({
          id: parseUuid('0192e7a0-7777-7000-8000-000000000003'),
          kind: 'wellness_low',
          ruleCode: 'wellness_low',
          severity: 'warning',
          currentSeverity: 'warning',
          raisedOn: '2026-09-01' as LocalDate,
          resolvedOn: '2026-09-03' as LocalDate,
          status: 'acknowledged',
          messageKey: 'alert.wellness_low.message',
          suggestionKey: 'alert.wellness_low.suggestion',
          values: { wellnessScore: 2.8, thresholdScore: 3 },
        }),
      ]),
    ...overrides,
  };
}

const PROFILE_PATH = `/players/${PLAYER_ID}`;

describe('player profile (B-404)', () => {
  beforeEach(() => {
    forgetRememberedTabs();
  });

  it('shows every block of the profile to the S&C of the category', async () => {
    const { api, user } = renderApp({
      path: PROFILE_PATH,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...profileHandlers(),
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Tomás Pérez' })).toBeVisible();

    // Header: today's availability as icon + text.
    const header = screen.getByRole('region', { name: 'Ficha del jugador' });
    expect(
      await within(header).findByRole('listitem', { name: 'Disponibilidad de hoy' }),
    ).toHaveTextContent('No disponible');

    // Availability: status as icon + text, the staff note, the history; never a cause.
    const availabilityCard = await screen.findByRole('region', { name: 'Disponibilidad' });
    expect(await within(availabilityCard).findByText('Partido: No disponible')).toBeVisible();
    expect(within(availabilityCard).getByText('Entrenamiento: Limitado')).toBeVisible();
    expect(within(availabilityCard).getByText('Sin contacto')).toBeVisible();
    expect(within(availabilityCard).getAllByText('No disponible').length).toBeGreaterThan(0);

    // Maturation.
    const maturationCard = screen.getByRole('region', { name: 'Maduración' });
    expect(await within(maturationCard).findByText('+0,4 años desde el PHV')).toBeVisible();
    expect(
      within(maturationCard).getByText('92,3 % de la talla adulta estimada (182 cm)'),
    ).toBeVisible();
    expect(within(maturationCard).getByText(/Etapa de desarrollo/)).toBeVisible();
    expect(await within(maturationCard).findByText(/En zona de pico de crecimiento/)).toBeVisible();

    // Alerts: text interpolated in es-AR, severity and review status.
    const alertsCard = screen.getByRole('region', { name: 'Historial de alertas' });
    expect(
      await within(alertsCard).findByText(
        'Carga aguda alta respecto de la crónica: ACWR 1,45 (umbral 1,40).',
      ),
    ).toBeVisible();
    expect(within(alertsCard).getByText('Bienestar bajo: 2,8 de 5 (umbral 3,0).')).toBeVisible();
    expect(within(alertsCard).getByText('Vista')).toBeVisible();

    // Load: ACWR with the severity of its active alert, week load, wellness of today.
    const loadCard = await screen.findByRole('region', { name: 'Carga de los últimos 28 días' });
    expect(await within(loadCard).findByText('1,45')).toBeVisible();
    expect(within(loadCard).getByText('Crítico')).toBeVisible();
    // Each tile reads its figure and unit together ("3,2 de 5").
    const wellnessTile = within(loadCard).getByText('Bienestar de hoy').closest('.sp-kpi');
    expect(wellnessTile?.querySelector('.sp-kpi__value')).toHaveTextContent('3,2 de 5');
    expect(within(loadCard).getByText('1 sesión sin RPE en el período.')).toBeVisible();
    expect(
      within(loadCard).getByText(/informadas por el jugador fuera del club \(1 actividad:/),
    ).toBeVisible();
    expect(within(loadCard).getByRole('figure', { name: /sRPE del día/ })).toBeVisible();

    // The long blocks are tabs below the status cards; load is the first.
    const tabs = screen.getByRole('navigation', { name: 'Secciones de la ficha' });
    expect(within(tabs).getByRole('link', { name: /^Carga,\s*Crítico$/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.queryByRole('region', { name: 'Evolución por ventana' })).toBeNull();

    // Evolution: the chart of the first metric, its warning, and the metric selector.
    await user.click(within(tabs).getByRole('link', { name: 'Evolución' }));
    const evolutionCard = await screen.findByRole('region', { name: 'Evolución por ventana' });
    // The alerts stay in sight on every tab.
    expect(screen.getByRole('region', { name: 'Historial de alertas' })).toBeVisible();
    expect(await within(evolutionCard).findByRole('figure', { name: /CMJ/ })).toBeVisible();
    expect(
      within(evolutionCard).getByText(
        'Ojo: la serie mezcla métodos de medición y puede no ser comparable.',
      ),
    ).toBeVisible();
    expect(within(evolutionCard).getByRole('combobox', { name: 'Métrica' })).toHaveValue(
      'cmj_height_cm|',
    );

    // Percentiles.
    await user.click(within(tabs).getByRole('link', { name: 'Percentiles' }));
    const percentilesCard = await screen.findByRole('region', { name: 'Percentiles en su grupo' });
    expect(await within(percentilesCard).findByText('Percentil 95')).toBeVisible();
    expect(
      within(percentilesCard).getByText('Muestra insuficiente: hacen falta al menos 10 jugadores.'),
    ).toBeVisible();

    expect(api.callsTo('listAlerts')[0]?.url.searchParams.get('playerId')).toBe(PLAYER_ID);
    expect(api.unhandled).toEqual([]);
  });

  it('switches the evolution chart to another metric', async () => {
    const { user } = renderApp({
      path: `${PROFILE_PATH}?tab=evolution`,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...profileHandlers(),
      },
    });
    const select = await screen.findByRole('combobox', { name: 'Métrica' });
    await user.selectOptions(select, 'sprint_40_s|');
    expect(await screen.findByRole('figure', { name: /Sprint 40 m/ })).toBeVisible();
  });

  it('keeps the coach to what the matrix gives them: availability, never the cause', async () => {
    const { api } = renderApp({
      path: PROFILE_PATH,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('coach')] }),
        ...profileHandlers(),
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Tomás Pérez' })).toBeVisible();
    const availabilityCard = screen.getByRole('region', { name: 'Disponibilidad' });
    expect(await within(availabilityCard).findByText('Partido: No disponible')).toBeVisible();
    expect(screen.queryByText(/diagn/i)).toBeNull();
    // Coach is staff: every block is in the matrix for an assigned category.
    const tabs = screen.getByRole('navigation', { name: 'Secciones de la ficha' });
    expect(within(tabs).getByRole('link', { name: 'Percentiles' })).toBeVisible();
    // A block behind a tab loads only when it opens.
    expect(api.callsTo('getPlayerPercentiles')).toHaveLength(0);
  });

  it('reopens the tab the user was on in the next profile, and links to each tab', async () => {
    renderApp({
      path: `${PROFILE_PATH}?tab=percentiles`,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...profileHandlers(),
      },
    });
    expect(await screen.findByRole('region', { name: 'Percentiles en su grupo' })).toBeVisible();
    cleanup();

    const { user, api } = renderApp({
      path: PROFILE_PATH,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...profileHandlers(),
      },
    });
    expect(await screen.findByRole('region', { name: 'Percentiles en su grupo' })).toBeVisible();
    const tabs = screen.getByRole('navigation', { name: 'Secciones de la ficha' });
    const gym = within(tabs).getByRole('link', { name: 'Gimnasio' });
    expect(gym.getAttribute('href')).toContain('tab=gym');
    expect(api.callsTo('getPlayerGymSummary')).toHaveLength(0);
    await user.click(gym);
    expect(await screen.findByRole('region', { name: 'Gimnasio' })).toBeVisible();
    expect(gym).toHaveAttribute('aria-current', 'page');
    expect(api.callsTo('getPlayerGymSummary')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Percentiles en su grupo' })).toBeNull();
  });

  it('goes back to the previous tab, also from a link without a tab', async () => {
    const { user, app } = renderApp({
      path: PROFILE_PATH,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...profileHandlers(),
      },
    });
    expect(
      await screen.findByRole('region', { name: 'Carga de los últimos 28 días' }),
    ).toBeVisible();
    const tabs = screen.getByRole('navigation', { name: 'Secciones de la ficha' });
    await user.click(within(tabs).getByRole('link', { name: 'Evolución' }));
    expect(await screen.findByRole('region', { name: 'Evolución por ventana' })).toBeVisible();

    app.router.history.back();
    expect(
      await screen.findByRole('region', { name: 'Carga de los últimos 28 días' }),
    ).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Evolución por ventana' })).toBeNull();
  });

  it('does not remember the tab it falls back to when the role cannot see the chosen one', async () => {
    // The S&C chooses the gym; the medical staff (same membership here) cannot read it.
    const first = renderApp({
      path: PROFILE_PATH,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...profileHandlers(),
      },
    });
    const tabs = await screen.findByRole('navigation', { name: 'Secciones de la ficha' });
    await first.user.click(within(tabs).getByRole('link', { name: 'Gimnasio' }));
    expect(await screen.findByRole('region', { name: 'Gimnasio' })).toBeVisible();
    cleanup();

    renderApp({
      path: PROFILE_PATH,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('medical')] }),
        ...profileHandlers(),
      },
    });
    expect(
      await screen.findByRole('region', { name: 'Carga de los últimos 28 días' }),
    ).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Gimnasio' })).toBeNull();
    cleanup();

    renderApp({
      path: PROFILE_PATH,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...profileHandlers(),
      },
    });
    expect(await screen.findByRole('region', { name: 'Gimnasio' })).toBeVisible();
  });

  it('shows no tab bar to staff who see none of the long blocks', async () => {
    renderApp({
      path: PROFILE_PATH,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('coach')], assignedTo: [] }),
        ...profileHandlers(),
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Tomás Pérez' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Secciones de la ficha' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Carga de los últimos 28 días' })).toBeNull();
  });

  it('shows a block error without taking the rest of the profile down', async () => {
    renderApp({
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...profileHandlers({
          getPlayerPercentiles: () => apiError(503, 'service_unavailable', { requestId: 'req-1' }),
        }),
      },
      path: `${PROFILE_PATH}?tab=percentiles`,
    });
    const percentilesCard = await screen.findByRole('region', { name: 'Percentiles en su grupo' });
    expect(await within(percentilesCard).findByRole('alert')).toBeVisible();
    const maturationCard = screen.getByRole('region', { name: 'Maduración' });
    expect(await within(maturationCard).findByText('+0,4 años desde el PHV')).toBeVisible();
  });

  it('says so when the player is not found in what the user sees', async () => {
    renderApp({
      path: PROFILE_PATH,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...profileHandlers({ getPlayer: () => apiError(404, 'not_found') }),
      },
    });
    expect(await screen.findByText('No encontramos a este jugador en lo que ves.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Volver a jugadores' })).toBeVisible();
  });

  it('explains missing maturation data and an empty history', async () => {
    renderApp({
      path: `${PROFILE_PATH}?tab=evolution`,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...profileHandlers({
          getPlayerMaturation: () => ({ ...maturation(), stage: null, measurements: [] }),
          getPlayerTestEvolution: () => ({ playerId: PLAYER_ID, columns: [], metrics: [] }),
          listAlerts: () => fixtures.page([]),
        }),
      },
    });
    expect(await screen.findByText('Todavía no tiene mediciones antropométricas.')).toBeVisible();
    expect(await screen.findByText('Todavía no tiene resultados de tests.')).toBeVisible();
    expect(await screen.findByText('Sin alertas.')).toBeVisible();
  });

  it('warns of the peak zone from the maturation itself, without an alert', async () => {
    renderApp({
      path: PROFILE_PATH,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...profileHandlers({ listAlerts: () => fixtures.page([]) }),
      },
    });
    const maturationCard = await screen.findByRole('region', { name: 'Maduración' });
    expect(await within(maturationCard).findByText(/En zona de pico de crecimiento/)).toBeVisible();
  });
});

describe('roster (B-404)', () => {
  it('lists the players of the scope and opens a profile', async () => {
    const { user, api } = renderApp({
      path: '/players',
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('coach')] }),
        ...profileHandlers(),
        listPlayers: () => fixtures.page([player()]),
      },
    });
    const link = await screen.findByRole('link', { name: 'Pérez, Tomás' });
    expect(screen.getByRole('link', { name: 'Jugadores' })).toBeVisible();
    await user.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'Tomás Pérez' })).toBeVisible();
    expect(api.callsTo('listPlayers')[0]?.url.searchParams.get('limit')).toBe('50');
  });

  it('searches by name', async () => {
    const { user, api } = renderApp({
      path: '/players',
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('coach')] }),
        listPlayers: (request) =>
          fixtures.page(request.url.searchParams.get('q') === 'zz' ? [] : [player()]),
      },
    });
    await screen.findByRole('link', { name: 'Pérez, Tomás' });
    await user.type(screen.getByLabelText('Buscar por nombre o apellido'), 'zz');
    expect(await screen.findByText('No hay jugadores con ese filtro en lo que ves.')).toBeVisible();
    expect(api.callsTo('listPlayers').at(-1)?.url.searchParams.get('q')).toBe('zz');
  });
});

describe('alert values', () => {
  it('formats each value by its name, in es-AR', () => {
    expect(formatAlertValue('acwrRatio', 1.4512)).toBe('1,45');
    expect(formatAlertValue('zScore', -2.345)).toBe('-2,35');
    expect(formatAlertValue('wellnessScore', 2.84)).toBe('2,8');
    expect(formatAlertValue('dropPct', 8.26)).toMatch(/^8,3\s?%$/);
    expect(formatAlertValue('heightCm', 38.25)).toMatch(/^38,3\scm$/);
    expect(formatAlertValue('velocityCmYear', 8.62)).toMatch(/^8,6\scm\/año$/);
    expect(alertMessageValues({ historyDays: 40 })).toEqual({ historyDays: '40' });
  });
});
