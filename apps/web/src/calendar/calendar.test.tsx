import { parseLocalDate } from '@sport-performance/domain';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as cal from '../test/calendar-fixtures';
import { apiError } from '../test/fake-api';
import * as fixtures from '../test/fixtures';
import { renderApp, signedIn } from '../test/render-app';

const { M15_RUGBY, M17_RUGBY, F15_HOCKEY } = fixtures;

const SEASON = cal.season('rugby', '2027', '2027-02-01', '2027-11-30', (id) => [
  cal.testWindow(id, 1, '2027-02-01', '2027-02-28'),
  cal.testWindow(id, 2, '2027-04-01', '2027-04-30'),
  cal.testWindow(id, 3, '2027-07-01', '2027-07-31'),
]);
const V2 = SEASON.testWindows[1];
if (V2 === undefined) throw new Error('fixture');

const TEST_DAY = cal.testSession(M15_RUGBY, '2027-04-10', {
  testWindowId: V2.id,
  location: 'Cancha 2',
});
const MATCH = cal.fixture(M15_RUGBY, '2027-04-17', 'CASI', {
  venue: 'away',
  kickoffTime: '15:30',
  competition: 'Torneo URBA M15',
});
const M15_EVENTS = cal.calendarEvents({
  seasons: [{ ...SEASON, testWindows: [V2] }],
  testSessions: [TEST_DAY],
  fixtures: [MATCH],
});

function staff(role: 'coach' | 'sc' | 'admin' | 'medical', categories = [M15_RUGBY, M17_RUGBY]) {
  return signedIn({ memberships: [fixtures.membership(role)], categories });
}

/** The version a row has after someone else changed it. */
const NEXT_VERSION = '1793586338688999';

const M15_PATH = `/calendar?month=2027-04&category=${M15_RUGBY.id}`;

describe('season calendar: reading', () => {
  it('is in the navigation of the staff', async () => {
    const { user, app } = renderApp({
      path: '/',
      handlers: {
        ...staff('coach'),
        listSeasons: () => fixtures.page([]),
        listTestSessions: () => fixtures.page([]),
        listFixtures: () => fixtures.page([]),
      },
    });
    await user.click(await screen.findByRole('link', { name: 'Calendario' }));
    expect(await screen.findByRole('heading', { name: 'Calendario de temporada' })).toBeVisible();
    expect(app.router.state.location.pathname).toBe('/calendar');
  });

  it('shows windows, test days and matches of a category in the month grid', async () => {
    const { api } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('sc'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () => fixtures.page(M15_EVENTS),
      },
    });
    expect(await screen.findByRole('heading', { name: 'abril de 2027' })).toBeVisible();
    expect(screen.getByText('Ventanas de tests, días de test y partidos de M15.')).toBeVisible();
    const grid = await screen.findByRole('table', { name: 'Calendario de abril de 2027' });

    // Each test day names its own window.
    const testDay = within(grid).getByRole('button', { name: 'Día de test · V2' });
    expect(within(testDay).queryByText('Programado')).toBeNull();
    expect(within(grid).getByRole('button', { name: '15:30 vs. CASI · Visitante' })).toBeVisible();
    // Every day of April is in V2, and says so in text.
    expect(within(grid).getAllByText('Ventana V2')).toHaveLength(30);
    expect(within(grid).getByText('sábado 10 de abril de 2027')).toBeInTheDocument();

    const [call] = api.callsTo('getCategoryCalendar');
    expect(Object.fromEntries(call?.url.searchParams ?? [])).toMatchObject({
      categoryId: M15_RUGBY.id,
      from: '2027-03-29',
      to: '2027-05-02',
    });
    expect(api.unhandled).toEqual([]);
  });

  it('joins test days and matches of every category of the sport without a category', async () => {
    const { api } = renderApp({
      path: '/calendar?month=2027-04',
      handlers: {
        ...staff('coach'),
        listSeasons: () => fixtures.page([SEASON]),
        listTestSessions: () => fixtures.page([TEST_DAY]),
        listFixtures: () =>
          fixtures.page([
            MATCH,
            cal.fixture(M17_RUGBY, '2027-04-17', 'SIC', { status: 'postponed' }),
          ]),
      },
    });
    const grid = await screen.findByRole('table', { name: 'Calendario de abril de 2027' });
    expect(within(grid).getByRole('button', { name: 'Día de test · M15 · V2' })).toBeVisible();
    expect(
      within(grid).getByRole('button', { name: '15:30 vs. CASI · M15 · Visitante' }),
    ).toBeVisible();
    // A status other than scheduled is shown in the grid, with its text.
    expect(
      within(grid).getByRole('button', { name: 'vs. SIC · M17 · Local Postergado' }),
    ).toBeVisible();

    for (const operation of ['listTestSessions', 'listFixtures'] as const) {
      const [call] = api.callsTo(operation);
      expect(Object.fromEntries(call?.url.searchParams ?? [])).toMatchObject({
        sport: 'rugby',
        from: '2027-03-29',
        to: '2027-05-02',
      });
    }
    expect(api.callsTo('getCategoryCalendar')).toHaveLength(0);
    expect(api.unhandled).toEqual([]);
  });

  it('moves between months and switches to the list', async () => {
    const { user, api, app } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('sc'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: (request) =>
          fixtures.page(request.url.searchParams.get('from') === '2027-03-29' ? M15_EVENTS : []),
      },
    });
    await screen.findByRole('table', { name: 'Calendario de abril de 2027' });

    await user.click(screen.getByRole('button', { name: 'Mes siguiente' }));
    expect(await screen.findByRole('heading', { name: 'mayo de 2027' })).toBeVisible();
    expect(app.router.state.location.search).toMatchObject({
      month: '2027-05',
      category: M15_RUGBY.id,
    });
    expect(
      await screen.findByText('No hay ventanas, días de test ni partidos en este mes.'),
    ).toBeVisible();
    expect(api.callsTo('getCategoryCalendar').at(-1)?.url.searchParams.get('from')).toBe(
      '2027-04-26',
    );

    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));
    await screen.findByRole('heading', { name: 'abril de 2027' });
    await user.click(screen.getByRole('radio', { name: 'Lista' }));
    expect(app.router.state.location.search).toMatchObject({ view: 'list' });
    expect(await screen.findByText('V2 · 2027: del 01/04/2027 al 30/04/2027')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'sábado 10 de abril de 2027' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Día de test · V2 · Cancha 2 Programado' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', {
        name: '15:30 vs. CASI · Visitante · Torneo URBA M15 Programado',
      }),
    ).toBeVisible();
    expect(screen.queryByRole('table', { name: /Calendario de/ })).toBeNull();
  });

  it('shows the error envelope with the request id', async () => {
    renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('sc'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () => apiError(503, 'service_unavailable', { requestId: 'req-91' }),
      },
    });
    const alert = await screen.findByText('Código para soporte: req-91');
    expect(alert).toBeVisible();
  });
});

describe('season calendar: test days', () => {
  it('lets the S&C schedule a day, with the window suggested by the date', async () => {
    const created = cal.testSession(M15_RUGBY, '2027-04-20', { testWindowId: V2.id });
    const { user, api } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('sc'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () => fixtures.page(M15_EVENTS),
        createTestSession: () => created,
      },
    });
    await screen.findByRole('table', { name: 'Calendario de abril de 2027' });
    // The S&C schedules test days but does not add matches.
    expect(screen.queryByRole('button', { name: 'Agregar partido' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Programar día de test' }));

    const editor = await screen.findByRole('region', { name: 'Programar un día de test' });
    expect(within(editor).getByRole('heading', { name: 'Programar un día de test' })).toHaveFocus();
    expect(within(editor).getByLabelText('Categoría')).toHaveValue(M15_RUGBY.id);
    fireEvent.change(within(editor).getByLabelText('Fecha'), { target: { value: '2027-05-03' } });
    expect(within(editor).getByLabelText('Ventana')).toHaveValue('none');
    expect(within(editor).getByText('Ninguna ventana activa contiene esta fecha.')).toBeVisible();
    fireEvent.change(within(editor).getByLabelText('Fecha'), { target: { value: '2027-04-20' } });
    expect(within(editor).getByLabelText('Ventana')).toHaveValue(V2.id);
    await user.type(within(editor).getByLabelText('Lugar'), '  Cancha 1 ');
    await user.click(within(editor).getByRole('button', { name: 'Guardar día de test' }));

    expect(await screen.findByText('Día de test guardado.')).toBeVisible();
    const [call] = api.callsTo('createTestSession');
    expect(call?.body).toEqual({
      clientUuid: expect.any(String) as unknown,
      categoryId: M15_RUGBY.id,
      scheduledOn: '2027-04-20',
      testWindowId: V2.id,
      location: 'Cancha 1',
    });
    await waitFor(() => {
      expect(api.callsTo('getCategoryCalendar').length).toBeGreaterThan(1);
    });
    expect(screen.queryByRole('region', { name: 'Programar un día de test' })).toBeNull();
  });

  it('reschedules a scheduled day with the reason the change history asks for', async () => {
    const { user, api } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('sc'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () => fixtures.page(M15_EVENTS),
        // Like the API: changing a value already set without a reason is a 400 (ADR 0030).
        updateTestSession: (request) =>
          (request.body as { changeReason?: string }).changeReason === undefined
            ? apiError(400, 'validation_failed')
            : cal.testSession(M15_RUGBY, '2027-04-12', { id: TEST_DAY.id }),
        cancelTestSession: () => ({ ...TEST_DAY, status: 'cancelled' }),
      },
    });
    const grid = await screen.findByRole('table', { name: 'Calendario de abril de 2027' });
    await user.click(within(grid).getByRole('button', { name: 'Día de test · V2' }));
    let editor = await screen.findByRole('region', { name: 'Día de test de M15' });
    expect(within(editor).getByText('Programado')).toBeVisible();
    // Nothing changed yet: no reason to ask for.
    expect(within(editor).queryByLabelText('Motivo del cambio')).toBeNull();
    fireEvent.change(within(editor).getByLabelText('Fecha'), { target: { value: '2027-04-12' } });
    await user.click(within(editor).getByRole('button', { name: 'Guardar día de test' }));
    expect(await within(editor).findByText('Contá por qué lo cambiás.')).toBeVisible();
    expect(api.callsTo('updateTestSession')).toHaveLength(0);

    await user.type(
      within(editor).getByLabelText('Motivo del cambio'),
      ' Lluvia: se pasa al lunes ',
    );
    await user.click(within(editor).getByRole('button', { name: 'Guardar día de test' }));
    expect(await screen.findByText('Día de test guardado.')).toBeVisible();
    // Only what changed, with the version it was read at (ADR 0032) and the reason.
    expect(api.callsTo('updateTestSession')[0]?.body).toEqual({
      version: TEST_DAY.version,
      scheduledOn: '2027-04-12',
      changeReason: 'Lluvia: se pasa al lunes',
    });

    await user.click(within(grid).getByRole('button', { name: 'Día de test · V2' }));
    editor = await screen.findByRole('region', { name: 'Día de test de M15' });
    await user.click(within(editor).getByRole('button', { name: 'Suspender el día' }));
    // Suspending asks first.
    expect(within(editor).getByText(/Suspender el día lo saca del calendario/)).toBeVisible();
    expect(api.callsTo('cancelTestSession')).toHaveLength(0);
    await user.click(within(editor).getByRole('button', { name: 'Sí, suspenderlo' }));
    expect(await screen.findByText('Día de test suspendido.')).toBeVisible();
    expect(api.callsTo('cancelTestSession')[0]?.params).toEqual({ testSessionId: TEST_DAY.id });
  });

  it('keeps the window of a day that is no longer offered when the date is not touched', async () => {
    // V2 was archived after the day was scheduled: the seasons do not offer it.
    const { user, api } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('sc'),
        listSeasons: () => fixtures.page([{ ...SEASON, testWindows: [] }]),
        getCategoryCalendar: () => fixtures.page(cal.calendarEvents({ testSessions: [TEST_DAY] })),
        updateTestSession: () => ({ ...TEST_DAY, notes: 'Llevar conos' }),
      },
    });
    const grid = await screen.findByRole('table', { name: 'Calendario de abril de 2027' });
    await user.click(within(grid).getByRole('button', { name: 'Día de test' }));
    const editor = await screen.findByRole('region', { name: 'Día de test de M15' });
    expect(within(editor).getByLabelText('Ventana')).toHaveValue(V2.id);
    expect(
      within(editor).getByRole('option', { name: 'La ventana actual (ya no está activa)' }),
    ).toBeInTheDocument();
    // Filling an empty value is not a correction: no reason.
    await user.type(within(editor).getByLabelText('Notas'), 'Llevar conos');
    expect(within(editor).queryByLabelText('Motivo del cambio')).toBeNull();
    await user.click(within(editor).getByRole('button', { name: 'Guardar día de test' }));
    expect(await screen.findByText('Día de test guardado.')).toBeVisible();
    expect(api.callsTo('updateTestSession')[0]?.body).toEqual({
      version: TEST_DAY.version,
      notes: 'Llevar conos',
    });
  });

  it('refetches the calendar when suspending a day collides with a change', async () => {
    const { user, api } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('sc'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () => fixtures.page(M15_EVENTS),
        cancelTestSession: () => apiError(409, 'conflict'),
      },
    });
    const grid = await screen.findByRole('table', { name: 'Calendario de abril de 2027' });
    await user.click(within(grid).getByRole('button', { name: 'Día de test · V2' }));
    const editor = await screen.findByRole('region', { name: 'Día de test de M15' });
    await user.click(within(editor).getByRole('button', { name: 'Suspender el día' }));
    await user.click(within(editor).getByRole('button', { name: 'Sí, suspenderlo' }));
    expect(await within(editor).findByText(/Alguien lo cambió mientras lo editabas/)).toBeVisible();
    await waitFor(() => {
      expect(api.callsTo('getCategoryCalendar').length).toBeGreaterThan(1);
    });
  });

  it('shows a day that already ran, or to someone who cannot schedule, read-only', async () => {
    const ran = { ...TEST_DAY, status: 'completed' as const };
    const { user } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('coach'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () =>
          fixtures.page(cal.calendarEvents({ testSessions: [ran], fixtures: [MATCH] })),
      },
    });
    const grid = await screen.findByRole('table', { name: 'Calendario de abril de 2027' });
    // The coach adds matches but does not schedule test days.
    expect(screen.queryByRole('button', { name: 'Programar día de test' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Agregar partido' })).toBeVisible();
    await user.click(within(grid).getByRole('button', { name: 'Día de test Cerrado' }));
    const editor = await screen.findByRole('region', { name: 'Día de test de M15' });
    expect(within(editor).getByText('Solo lectura: no podés editarlo con tu rol.')).toBeVisible();
    expect(within(editor).getByText('V2 · 2027')).toBeVisible();
    expect(within(editor).queryByRole('button', { name: 'Guardar día de test' })).toBeNull();
  });
});

describe('season calendar: fixture', () => {
  it('lets the coach add a match, checking it before calling the API', async () => {
    const { user, api } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('coach'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () => fixtures.page(M15_EVENTS),
        createFixture: () => cal.fixture(M15_RUGBY, '2027-04-24', 'Hindú'),
      },
    });
    await screen.findByRole('table', { name: 'Calendario de abril de 2027' });
    await user.click(screen.getByRole('button', { name: 'Agregar partido' }));
    const editor = await screen.findByRole('region', { name: 'Agregar un partido' });

    fireEvent.change(within(editor).getByLabelText('Hora de inicio'), {
      target: { value: '' },
    });
    await user.click(within(editor).getByRole('button', { name: 'Guardar partido' }));
    expect(await within(editor).findByText('Completá este dato.')).toBeVisible();
    expect(within(editor).getByLabelText('Rival')).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('createFixture')).toHaveLength(0);

    await user.type(within(editor).getByLabelText('Rival'), 'Hindú');
    await user.selectOptions(within(editor).getByLabelText('Condición'), 'away');
    fireEvent.change(within(editor).getByLabelText('Fecha'), { target: { value: '2027-04-24' } });
    fireEvent.change(within(editor).getByLabelText('Hora de inicio'), {
      target: { value: '16:00' },
    });
    await user.click(within(editor).getByRole('button', { name: 'Guardar partido' }));

    expect(await screen.findByText('Partido guardado.')).toBeVisible();
    expect(api.callsTo('createFixture')[0]?.body).toEqual({
      clientUuid: expect.any(String) as unknown,
      categoryId: M15_RUGBY.id,
      opponent: 'Hindú',
      venue: 'away',
      date: '2027-04-24',
      kickoffTime: '16:00',
      status: 'scheduled',
    });
  });

  it('postpones a match and explains a conflict', async () => {
    const { user, api } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('coach'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () => fixtures.page(M15_EVENTS),
        updateFixture: () => apiError(409, 'conflict'),
      },
    });
    const grid = await screen.findByRole('table', { name: 'Calendario de abril de 2027' });
    await user.click(within(grid).getByRole('button', { name: '15:30 vs. CASI · Visitante' }));
    const editor = await screen.findByRole('region', { name: 'Partido de M15' });
    await user.selectOptions(within(editor).getByLabelText('Estado'), 'postponed');
    await user.click(within(editor).getByRole('button', { name: 'Guardar partido' }));

    expect(await within(editor).findByText(/Alguien lo cambió mientras lo editabas/)).toBeVisible();
    expect(api.callsTo('updateFixture')[0]?.body).toEqual({
      version: MATCH.version,
      status: 'postponed',
    });
    // The calendar was refetched so the next try starts from fresh data.
    await waitFor(() => {
      expect(api.callsTo('getCategoryCalendar').length).toBeGreaterThan(1);
    });
  });

  it('retries a match after a conflict with the version refetched', async () => {
    // Someone else changed the match meanwhile: the refetch brings a new version.
    const changed = { ...MATCH, version: NEXT_VERSION, location: 'Cancha CASI' };
    let changedMeanwhile = false;
    const { user, api } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('coach'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () =>
          fixtures.page(
            changedMeanwhile
              ? cal.calendarEvents({ testSessions: [TEST_DAY], fixtures: [changed] })
              : M15_EVENTS,
          ),
        updateFixture: () => {
          if (changedMeanwhile) return { ...changed, status: 'postponed' as const };
          changedMeanwhile = true;
          return apiError(409, 'conflict');
        },
      },
    });
    const grid = await screen.findByRole('table', { name: 'Calendario de abril de 2027' });
    await user.click(within(grid).getByRole('button', { name: '15:30 vs. CASI · Visitante' }));
    let editor = await screen.findByRole('region', { name: 'Partido de M15' });
    await user.selectOptions(within(editor).getByLabelText('Estado'), 'postponed');
    await user.click(within(editor).getByRole('button', { name: 'Guardar partido' }));

    // The editor opens again on the refetched match and still explains why.
    await waitFor(() => {
      expect(screen.getByLabelText('Lugar')).toHaveValue('Cancha CASI');
    });
    editor = screen.getByRole('region', { name: 'Partido de M15' });
    expect(within(editor).getByText(/Alguien lo cambió mientras lo editabas/)).toBeVisible();
    await user.selectOptions(within(editor).getByLabelText('Estado'), 'postponed');
    await user.click(within(editor).getByRole('button', { name: 'Guardar partido' }));
    expect(await screen.findByText('Partido guardado.')).toBeVisible();
    expect(api.callsTo('updateFixture')[1]?.body).toEqual({
      version: NEXT_VERSION,
      status: 'postponed',
    });
  });

  it('archives a match only after confirming', async () => {
    const { user, api } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('coach'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () => fixtures.page(M15_EVENTS),
        archiveFixture: () => ({ ...MATCH, archivedAt: '2027-04-01T00:00:00.000Z' }),
      },
    });
    const grid = await screen.findByRole('table', { name: 'Calendario de abril de 2027' });
    await user.click(within(grid).getByRole('button', { name: '15:30 vs. CASI · Visitante' }));
    const editor = await screen.findByRole('region', { name: 'Partido de M15' });
    await user.click(within(editor).getByRole('button', { name: 'Archivar el partido' }));
    expect(api.callsTo('archiveFixture')).toHaveLength(0);
    await user.click(within(editor).getByRole('button', { name: 'Sí, archivarlo' }));
    expect(await screen.findByText('Partido archivado.')).toBeVisible();
    expect(api.callsTo('archiveFixture')[0]?.params).toEqual({ fixtureId: MATCH.id });
  });
});

describe('season calendar: seasons and windows', () => {
  it('lets the administration create a season', async () => {
    const { user, api } = renderApp({
      path: '/calendar?month=2027-04',
      handlers: {
        ...staff('admin', [M15_RUGBY, F15_HOCKEY]),
        listSeasons: () => fixtures.page([SEASON]),
        listTestSessions: () => fixtures.page([]),
        listFixtures: () => fixtures.page([]),
        createSeason: () => cal.season('hockey', '2028', '2028-02-01', '2028-11-30'),
      },
    });
    const seasons = await screen.findByRole('region', { name: 'Temporadas y ventanas' });
    // Two sports in view: each season says its sport.
    expect(await within(seasons).findByRole('heading', { name: '2027 · Rugby' })).toBeVisible();
    await user.click(within(seasons).getByRole('button', { name: 'Nueva temporada' }));
    const editor = await within(seasons).findByRole('region', { name: 'Nueva temporada' });
    await user.selectOptions(within(editor).getByLabelText('Deporte'), 'hockey');
    await user.clear(within(editor).getByLabelText('Nombre'));
    await user.type(within(editor).getByLabelText('Nombre'), '2028');
    fireEvent.change(within(editor).getByLabelText('Desde'), { target: { value: '2028-02-01' } });
    fireEvent.change(within(editor).getByLabelText('Hasta'), { target: { value: '2028-01-15' } });
    await user.click(within(editor).getByRole('button', { name: 'Guardar temporada' }));
    expect(
      await within(editor).findByText('La fecha de fin es anterior a la de inicio.'),
    ).toBeVisible();
    expect(api.callsTo('createSeason')).toHaveLength(0);

    fireEvent.change(within(editor).getByLabelText('Hasta'), { target: { value: '2028-11-30' } });
    await user.click(within(editor).getByRole('button', { name: 'Guardar temporada' }));
    expect(await screen.findByText('Temporada guardada.')).toBeVisible();
    expect(api.callsTo('createSeason')[0]?.body).toEqual({
      clientUuid: expect.any(String) as unknown,
      sport: 'hockey',
      name: '2028',
      startsOn: '2028-02-01',
      endsOn: '2028-11-30',
    });
  });

  it('lets the S&C plan a window with the reference dates, checked against the others', async () => {
    const { user, api } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('sc'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () => fixtures.page(M15_EVENTS),
        createTestWindow: () => cal.testWindow(SEASON.id, 4, '2027-11-01', '2027-11-30'),
      },
    });
    const seasons = await screen.findByRole('region', { name: 'Temporadas y ventanas' });
    const windows = await within(seasons).findByRole('table', {
      name: 'Ventanas de la temporada 2027',
    });
    // The S&C plans windows but does not manage seasons.
    expect(within(seasons).queryByRole('button', { name: 'Nueva temporada' })).toBeNull();
    expect(within(seasons).queryByRole('button', { name: 'Archivar la temporada' })).toBeNull();
    expect(within(windows).getByText('Sin planificar')).toBeVisible();

    await user.click(within(windows).getByRole('button', { name: 'Planificar V4' }));
    const editor = await within(seasons).findByRole('region', {
      name: 'Planificar V4 de la temporada 2027',
    });
    expect(within(editor).getByLabelText('Desde')).toHaveValue('2027-11-01');
    expect(within(editor).getByLabelText('Hasta')).toHaveValue('2027-11-30');
    fireEvent.change(within(editor).getByLabelText('Desde'), { target: { value: '2027-07-20' } });
    await user.click(within(editor).getByRole('button', { name: 'Guardar ventana' }));
    expect(await within(editor).findByText('Se superpone con V3.')).toBeVisible();
    expect(api.callsTo('createTestWindow')).toHaveLength(0);

    fireEvent.change(within(editor).getByLabelText('Desde'), { target: { value: '2027-11-02' } });
    await user.click(within(editor).getByRole('button', { name: 'Guardar ventana' }));
    expect(await screen.findByText('Ventana guardada.')).toBeVisible();
    const [call] = api.callsTo('createTestWindow');
    expect(call?.params).toEqual({ seasonId: SEASON.id });
    expect(call?.body).toEqual({
      clientUuid: expect.any(String) as unknown,
      number: 4,
      startsOn: '2027-11-02',
      endsOn: '2027-11-30',
    });
  });

  it('retries a season after a conflict with the version refetched, checking the current one', async () => {
    // Someone planned V4 meanwhile: the season comes back with a new version.
    const v4 = cal.testWindow(SEASON.id, 4, '2027-11-01', '2027-11-30');
    const changed = {
      ...SEASON,
      version: NEXT_VERSION,
      testWindows: [...SEASON.testWindows, v4],
    };
    let changedMeanwhile = false;
    const { user, api } = renderApp({
      path: '/calendar?month=2027-04',
      handlers: {
        ...staff('admin'),
        listSeasons: () => fixtures.page([changedMeanwhile ? changed : SEASON]),
        listTestSessions: () => fixtures.page([]),
        listFixtures: () => fixtures.page([]),
        updateSeason: () => {
          if (changedMeanwhile) return { ...changed, endsOn: parseLocalDate('2027-12-15') };
          changedMeanwhile = true;
          return apiError(409, 'conflict');
        },
      },
    });
    const seasons = await screen.findByRole('region', { name: 'Temporadas y ventanas' });
    await user.click(await within(seasons).findByRole('button', { name: 'Editar la temporada' }));
    let editor = await within(seasons).findByRole('region', { name: 'Editar la temporada 2027' });
    fireEvent.change(within(editor).getByLabelText('Hasta'), { target: { value: '2027-11-15' } });
    await user.click(within(editor).getByRole('button', { name: 'Guardar temporada' }));
    expect(api.callsTo('updateSeason')[0]?.body).toEqual({
      version: SEASON.version,
      endsOn: '2027-11-15',
    });

    // Opened again on the refetched season: its new V4 no longer fits that end.
    await waitFor(() => {
      expect(
        within(seasons).getByRole('table', { name: 'Ventanas de la temporada 2027' }),
      ).toHaveTextContent('Del 01/11/2027 al 30/11/2027');
    });
    editor = within(seasons).getByRole('region', { name: 'Editar la temporada 2027' });
    expect(within(editor).getByText(/Alguien lo cambió mientras lo editabas/)).toBeVisible();
    fireEvent.change(within(editor).getByLabelText('Hasta'), { target: { value: '2027-11-15' } });
    await user.click(within(editor).getByRole('button', { name: 'Guardar temporada' }));
    expect(
      await within(editor).findByText(
        'Sus ventanas activas tienen que quedar adentro de las fechas nuevas.',
      ),
    ).toBeVisible();
    expect(api.callsTo('updateSeason')).toHaveLength(1);

    fireEvent.change(within(editor).getByLabelText('Hasta'), { target: { value: '2027-12-15' } });
    await user.click(within(editor).getByRole('button', { name: 'Guardar temporada' }));
    expect(await screen.findByText('Temporada guardada.')).toBeVisible();
    expect(api.callsTo('updateSeason')[1]?.body).toEqual({
      version: NEXT_VERSION,
      endsOn: '2027-12-15',
    });
  });

  it('archives a window for whoever plans them', async () => {
    const { user, api } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('sc'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () => fixtures.page(M15_EVENTS),
        archiveTestWindow: () => ({ ...V2, archivedAt: '2027-01-01T00:00:00.000Z' }),
      },
    });
    const windows = await screen.findByRole('table', { name: 'Ventanas de la temporada 2027' });
    await user.click(within(windows).getByRole('button', { name: 'Archivar V2' }));
    expect(api.callsTo('archiveTestWindow')).toHaveLength(0);
    const seasons = screen.getByRole('region', { name: 'Temporadas y ventanas' });
    expect(within(seasons).getByText(/Archivar V2 de la temporada 2027/)).toBeVisible();
    await user.click(within(seasons).getByRole('button', { name: 'Sí, archivarla' }));
    expect(await screen.findByText('Ventana archivada.')).toBeVisible();
    expect(api.callsTo('archiveTestWindow')[0]?.params).toEqual({ testWindowId: V2.id });
  });

  it('archives a season only after confirming', async () => {
    const { user, api } = renderApp({
      path: '/calendar?month=2027-04',
      handlers: {
        ...staff('admin'),
        listSeasons: () => fixtures.page([SEASON]),
        listTestSessions: () => fixtures.page([]),
        listFixtures: () => fixtures.page([]),
        archiveSeason: () => ({ ...SEASON, archivedAt: '2027-01-01T00:00:00.000Z' }),
      },
    });
    const seasons = await screen.findByRole('region', { name: 'Temporadas y ventanas' });
    await user.click(await within(seasons).findByRole('button', { name: 'Archivar la temporada' }));
    expect(within(seasons).getByText(/Archivar la temporada 2027 saca/)).toBeVisible();
    await user.click(within(seasons).getByRole('button', { name: 'Cancelar' }));
    expect(within(seasons).queryByText(/Archivar la temporada 2027 saca/)).toBeNull();
    expect(api.callsTo('archiveSeason')).toHaveLength(0);

    await user.click(within(seasons).getByRole('button', { name: 'Archivar la temporada' }));
    await user.click(within(seasons).getByRole('button', { name: 'Sí, archivarla' }));
    expect(await screen.findByText('Temporada archivada.')).toBeVisible();
    expect(api.callsTo('archiveSeason')[0]?.params).toEqual({ seasonId: SEASON.id });
  });

  it('hides the archived windows of a season until asked to see them', async () => {
    const withArchived = {
      ...SEASON,
      testWindows: SEASON.testWindows.map((window) =>
        window.number === 3 ? { ...window, archivedAt: '2027-01-01T00:00:00.000Z' } : window,
      ),
    };
    const { user } = renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('sc'),
        listSeasons: () => fixtures.page([withArchived]),
        getCategoryCalendar: () => fixtures.page(M15_EVENTS),
      },
    });
    const windows = await screen.findByRole('table', { name: 'Ventanas de la temporada 2027' });
    expect(within(windows).queryByRole('rowheader', { name: 'V3' })).toBeNull();
    // Its number is taken: it is not offered to plan again.
    expect(within(windows).queryByRole('button', { name: 'Planificar V3' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Ver archivadas' }));
    const shown = await screen.findByRole('table', { name: 'Ventanas de la temporada 2027' });
    expect(await within(shown).findByRole('button', { name: 'Restaurar V3' })).toBeVisible();
  });

  it('shows seasons read-only to the coach', async () => {
    renderApp({
      path: M15_PATH,
      handlers: {
        ...staff('coach'),
        listSeasons: () => fixtures.page([SEASON]),
        getCategoryCalendar: () => fixtures.page(M15_EVENTS),
      },
    });
    const windows = await screen.findByRole('table', { name: 'Ventanas de la temporada 2027' });
    expect(within(windows).queryByRole('button')).toBeNull();
    expect(within(windows).getByText('Del 01/04/2027 al 30/04/2027')).toBeVisible();
  });
});
