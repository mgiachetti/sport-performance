import type { Season } from '@sport-performance/contracts';
import { parseUuid } from '@sport-performance/domain';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { reply, type FakeHandlers } from '../test/fake-api';
import * as fixtures from '../test/fixtures';
import { renderApp, signedIn } from '../test/render-app';
import {
  ANA_ID,
  BRUNO_ID,
  SESSION_ID,
  SPRINT,
  WINDOW_ID,
  sheet,
  sprintResult,
  testSession,
} from '../test/test-day-fixtures';

const OTHER_METHOD = 'Medido con otro método (Manual): no es comparable directo.';

const AT = '2026-04-14T12:00:00.000Z';

const SEASON: Season = {
  id: parseUuid('0192e7a0-4444-7000-8000-0000000000aa'),
  sport: 'rugby',
  name: '2026',
  startsOn: '2026-02-01' as Season['startsOn'],
  endsOn: '2026-11-30' as Season['endsOn'],
  testWindows: [
    {
      id: WINDOW_ID,
      seasonId: parseUuid('0192e7a0-4444-7000-8000-0000000000aa'),
      number: 2,
      label: 'V2',
      startsOn: '2026-04-01' as Season['startsOn'],
      endsOn: '2026-04-30' as Season['endsOn'],
      archivedAt: null,
      createdAt: AT,
      updatedAt: AT,
      version: '1793586338688123',
    },
  ],
  archivedAt: null,
  createdAt: AT,
  updatedAt: AT,
  version: '1793586338688123',
};

function staff(role: 'sc' | 'coach' | 'medical' = 'sc', extra: FakeHandlers = {}): FakeHandlers {
  return {
    ...signedIn({ memberships: [fixtures.membership(role)], categories: [fixtures.M15_RUGBY] }),
    listSeasons: () => fixtures.page([SEASON]),
    getTestSessionSheet: () => sheet(),
    listTestResults: () => fixtures.page([]),
    ...extra,
  };
}

const DAY_PATH = `/test-days/${SESSION_ID}`;

describe('test days list', () => {
  it('is in the navigation of the staff and lists upcoming and past days', async () => {
    const { user, api, app } = renderApp({
      path: '/',
      handlers: staff('sc', {
        listTestSessions: (request) =>
          request.url.searchParams.has('from')
            ? fixtures.page([testSession({ status: 'scheduled' })])
            : fixtures.page([]),
      }),
    });
    await user.click(await screen.findByRole('link', { name: 'Días de test' }));
    expect(await screen.findByRole('heading', { name: 'Días de test', level: 1 })).toBeVisible();
    const upcoming = screen.getByRole('region', { name: 'Hoy y próximos' });
    const row = await within(upcoming).findByRole('row', { name: /martes 14 de abril de 2026/ });
    expect(within(row).getByText('M15')).toBeVisible();
    expect(within(row).getByText('Cancha 2')).toBeVisible();
    expect(within(row).getByText('Programado')).toBeVisible();
    expect(await within(row).findByText('V2')).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: 'Anteriores' })).getByText(
        'Todavía no hubo días de test.',
      ),
    ).toBeVisible();
    const [first, second] = api.callsTo('listTestSessions');
    expect(first?.url.searchParams.get('sort') ?? second?.url.searchParams.get('sort')).toMatch(
      /scheduledOn/,
    );

    await user.click(within(row).getByRole('link', { name: 'martes 14 de abril de 2026' }));
    expect(await screen.findByRole('heading', { name: 'Día de test M15' })).toBeVisible();
    expect(app.router.state.location.pathname).toBe(DAY_PATH);
    expect(api.unhandled).toEqual([]);
  });

  it('keeps players out of the staff screens', async () => {
    const { api } = renderApp({
      path: '/test-days',
      handlers: signedIn({ memberships: [fixtures.membership('player')] }),
    });
    expect(await screen.findByRole('heading', { name: 'La web es para el staff' })).toBeVisible();
    expect(api.callsTo('listTestSessions')).toHaveLength(0);
  });
});

describe('the sheet of a test day', () => {
  it('says the user has no permission when the API forbids the day', async () => {
    renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        getTestSessionSheet: () => reply(403, { error: { code: 'forbidden', message: 'fake' } }),
      }),
    });
    expect((await screen.findAllByText('No tenés permiso para ver esto.')).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole('heading', { name: 'Día de test M15' })).toBeNull();
  });

  it('compares the previous result with the method of the saved result', async () => {
    renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        listTestResults: () => fixtures.page([sprintResult(ANA_ID, { method: 'manual' })]),
      }),
    });
    const ana = await screen.findByRole('row', { name: /Álvarez, Juan/ });
    expect(await within(ana).findByText('Intento 1: 20 m: 3,10 s · 40 m: 5,40 s')).toBeVisible();
    // The station is by photocell, but the saved result and the previous one are manual.
    expect(within(ana).queryByText(OTHER_METHOD)).toBeNull();
  });

  it('says before saving how many players are recorded as not applicable', async () => {
    let sent: { results: { playerId: string; notDoneReason?: string }[] } | undefined;
    const { user } = renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        getTestSessionSheet: () => {
          const base = sheet();
          return {
            ...base,
            players: base.players.map((p) =>
              p.id === BRUNO_ID
                ? {
                    ...p,
                    tests: p.tests.map((x) => ({
                      ...x,
                      applicable: false,
                      reason: 'not_in_battery' as const,
                    })),
                  }
                : p,
            ),
          };
        },
        recordTestSessionResults: (request) => {
          sent = request.body as typeof sent;
          return { results: [] };
        },
      }),
    });
    expect(
      await screen.findByText(
        'Al guardar, 1 jugador sin cargar queda como «No corresponde a la etapa».',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Guardar 1 resultado' }));
    await waitFor(() => {
      expect(sent?.results).toEqual([
        expect.objectContaining({ playerId: BRUNO_ID, notDoneReason: 'not_applicable_to_stage' }),
      ]);
    });
  });

  it('warns when a retry is replayed without the edits made since the first send', async () => {
    let calls = 0;
    const { user } = renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        recordTestSessionResults: () => {
          calls += 1;
          // The first send is saved but its answer is lost behind a proxy timeout;
          // the retry finds the result it had saved.
          if (calls === 1) return reply(504, { error: { code: 'internal', message: 'fake' } });
          return { results: [{ result: sprintResult(ANA_ID), replayed: true }] };
        },
      }),
    });
    await user.type(await screen.findByLabelText('20 m (s), intento 1, Álvarez, Juan'), '3,10');
    await user.type(screen.getByLabelText('40 m (s), intento 1, Álvarez, Juan'), '5,40');
    await user.click(screen.getByRole('button', { name: 'Guardar 1 resultado' }));
    await waitFor(() => {
      expect(calls).toBe(1);
    });
    await user.type(screen.getByLabelText('20 m (s), intento 2, Álvarez, Juan'), '3,00');
    await user.type(screen.getByLabelText('40 m (s), intento 2, Álvarez, Juan'), '5,30');
    await user.click(await screen.findByRole('button', { name: 'Guardar 1 resultado' }));
    expect(
      await screen.findByText(/Estas filas ya se habían guardado .*: Álvarez, Juan\./),
    ).toBeVisible();
  });

  it('does not warn when a retry is replayed with what was sent first', async () => {
    let calls = 0;
    const { user } = renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        recordTestSessionResults: () => {
          calls += 1;
          if (calls === 1) return reply(504, { error: { code: 'internal', message: 'fake' } });
          return { results: [{ result: sprintResult(ANA_ID), replayed: true }] };
        },
      }),
    });
    await user.type(await screen.findByLabelText('20 m (s), intento 1, Álvarez, Juan'), '3,10');
    await user.type(screen.getByLabelText('40 m (s), intento 1, Álvarez, Juan'), '5,40');
    await user.click(screen.getByRole('button', { name: 'Guardar 1 resultado' }));
    await waitFor(() => {
      expect(calls).toBe(1);
    });
    await user.click(await screen.findByRole('button', { name: 'Guardar 1 resultado' }));
    expect(await screen.findByText('Se guardó 1 resultado.')).toBeVisible();
    expect(screen.queryByText(/Estas filas ya se habían guardado/)).toBeNull();
  });

  it('shows the day, its stations, the protocol and the previous result', async () => {
    const { api } = renderApp({ path: DAY_PATH, handlers: staff() });
    expect(await screen.findByRole('heading', { name: 'Día de test M15' })).toBeVisible();
    expect(screen.getByText('V2 · martes 14 de abril de 2026')).toBeVisible();
    expect(screen.getByText('Lugar: Cancha 2')).toBeVisible();
    expect(screen.getByText('Superficie: césped natural')).toBeVisible();
    expect(screen.getByText('En curso')).toBeVisible();
    const stations = screen.getByRole('navigation', { name: 'Estaciones' });
    expect(within(stations).getByRole('button', { name: /Sprint 10\/20\/40 m/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Protocolo, versión 1')).toBeVisible();
    // Previous sprint: measured by hand, today's station by photocell.
    const ana = screen.getByRole('row', { name: /Álvarez, Juan/ });
    expect(within(ana).getByText('40 m: 5,60 s, 10/02/2026')).toBeVisible();
    expect(within(ana).getByText(OTHER_METHOD)).toBeVisible();
    expect(api.callsTo('listTestResults')[0]?.url.searchParams.get('testSessionId')).toBe(
      SESSION_ID,
    );
    expect(api.unhandled).toEqual([]);
  });

  it('marks the best attempt and saves the station as one batch', async () => {
    let sent: unknown;
    const { user, api } = renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        recordTestSessionResults: (request) => {
          sent = request.body;
          return { results: [{ result: sprintResult(ANA_ID), replayed: false }] };
        },
      }),
    });
    const t20 = await screen.findByLabelText('20 m (s), intento 1, Álvarez, Juan');
    await user.type(t20, '3,20');
    await user.type(screen.getByLabelText('40 m (s), intento 1, Álvarez, Juan'), '5,60');
    await user.type(screen.getByLabelText('20 m (s), intento 2, Álvarez, Juan'), '3,10');
    await user.type(screen.getByLabelText('40 m (s), intento 2, Álvarez, Juan'), '5,40');

    const best = screen.getByLabelText('40 m (s), intento 2, Álvarez, Juan');
    expect(best).toHaveClass('is-best');
    expect(best).toHaveAccessibleDescription('Mejor intento');
    const ana = screen.getByRole('row', { name: /Álvarez, Juan/ });
    expect(within(ana).getByText('40 m: 5,40 s')).toBeVisible();
    expect(within(ana).getByText('Vmax: 8,70 m/s')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Guardar 1 resultado' }));
    expect(await screen.findByText('Se guardó 1 resultado.')).toBeVisible();
    expect(sent).toMatchObject({
      results: [
        {
          status: 'done',
          playerId: ANA_ID,
          testDefinitionId: SPRINT.definition.id,
          method: 'photocell',
          entries: [
            { kind: 'sprint_splits', split20S: 3.2, split40S: 5.6, attemptNumber: 1 },
            { kind: 'sprint_splits', split20S: 3.1, split40S: 5.4, attemptNumber: 2 },
          ],
        },
      ],
    });
    expect(api.callsTo('recordTestSessionResults')[0]?.url.pathname).toBe(
      `/v1/test-sessions/${SESSION_ID}/results`,
    );
  });

  it('records a player as not done with the reason', async () => {
    let sent: { results: unknown[] } | undefined;
    const { user } = renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        recordTestSessionResults: (request) => {
          sent = request.body as { results: unknown[] };
          return { results: [] };
        },
      }),
    });
    await user.selectOptions(
      await screen.findByLabelText('Estado de Benítez, Juan'),
      'No realizado',
    );
    await user.click(screen.getByRole('button', { name: 'Guardar 1 resultado' }));
    expect(await screen.findByText('Elegí el motivo.')).toBeVisible();
    expect(
      screen.getByText('Hay filas para revisar antes de guardar. No se mandó nada.'),
    ).toBeVisible();

    await user.selectOptions(screen.getByLabelText('Motivo de Benítez, Juan'), 'Ausente');
    await user.click(screen.getByRole('button', { name: 'Guardar 1 resultado' }));
    await waitFor(() => {
      expect(sent?.results).toEqual([
        expect.objectContaining({
          status: 'not_done',
          playerId: BRUNO_ID,
          notDoneReason: 'absent',
        }),
      ]);
    });
  });

  it('offers injured as «No disponible» to the non-medical staff, and sends injured', async () => {
    let sent: { results: unknown[] } | undefined;
    const { user } = renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        recordTestSessionResults: (request) => {
          sent = request.body as { results: unknown[] };
          return { results: [] };
        },
      }),
    });
    await user.selectOptions(
      await screen.findByLabelText('Estado de Benítez, Juan'),
      'No realizado',
    );
    const reason = screen.getByLabelText('Motivo de Benítez, Juan');
    expect(within(reason).getByRole('option', { name: 'No disponible' })).toBeVisible();
    expect(within(reason).queryByRole('option', { name: 'Lesionado/a' })).toBeNull();
    await user.selectOptions(reason, 'No disponible');
    await user.click(screen.getByRole('button', { name: 'Guardar 1 resultado' }));
    await waitFor(() => {
      expect(sent?.results).toEqual([
        expect.objectContaining({
          status: 'not_done',
          playerId: BRUNO_ID,
          notDoneReason: 'injured',
        }),
      ]);
    });
  });

  it.each([['unavailable' as const], ['injured' as const]])(
    'shows a saved injured result to the coach as «No disponible» (API sends %s)',
    async (notDoneReason) => {
      renderApp({
        path: DAY_PATH,
        handlers: staff('coach', {
          listTestResults: () =>
            fixtures.page([
              sprintResult(ANA_ID, {
                status: 'not_done',
                notDoneReason,
                notDoneNote: null,
                method: null,
                entries: [],
                scores: [],
              }),
            ]),
        }),
      });
      const ana = await screen.findByRole('row', { name: /Álvarez, Juan/ });
      expect(await within(ana).findByText('No realizado: No disponible')).toBeVisible();
      expect(within(ana).queryByText(/Lesionado/)).toBeNull();
    },
  );

  it('shows a saved injured result as such to the medical staff', async () => {
    renderApp({
      path: DAY_PATH,
      handlers: staff('medical', {
        listTestResults: () =>
          fixtures.page([
            sprintResult(ANA_ID, {
              status: 'not_done',
              notDoneReason: 'injured',
              notDoneNote: null,
              method: null,
              entries: [],
              scores: [],
            }),
          ]),
      }),
    });
    const ana = await screen.findByRole('row', { name: /Álvarez, Juan/ });
    expect(await within(ana).findByText('No realizado: Lesionado/a')).toBeVisible();
  });

  it('shows what the API rejected on the row that caused it', async () => {
    const { user } = renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        recordTestSessionResults: () =>
          reply(400, {
            error: {
              code: 'validation_failed',
              message: 'fake',
              details: [
                { path: ['body', 'results', 0, 'status'], code: 'not_in_battery', message: 'x' },
              ],
            },
          }),
      }),
    });
    await user.type(await screen.findByLabelText('20 m (s), intento 1, Benítez, Juan'), '3,1');
    await user.type(screen.getByLabelText('40 m (s), intento 1, Benítez, Juan'), '5,4');
    await user.click(screen.getByRole('button', { name: 'Guardar 1 resultado' }));
    expect(
      await screen.findByText(
        'No le corresponde a su etapa: cargalo como «No corresponde a la etapa».',
      ),
    ).toBeVisible();
    expect(screen.getByText('No se guardó nada: la API marcó filas para revisar.')).toBeVisible();
  });

  it('warns about a value out of range without blocking it', async () => {
    const { user } = renderApp({ path: DAY_PATH, handlers: staff() });
    await user.type(await screen.findByLabelText('20 m (s), intento 1, Álvarez, Juan'), '3,1');
    await user.type(screen.getByLabelText('40 m (s), intento 1, Álvarez, Juan'), '54');
    expect(
      await screen.findByText(
        /Intento 1: 54,00 s está fuera del rango habitual \(4,40 s a 9,00 s\)\. Se puede guardar igual\. ¿Quisiste decir 5,40 s\?/,
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Guardar 1 resultado' })).toBeEnabled();
  });

  it('never offers recording for a player without data consent', async () => {
    renderApp({ path: DAY_PATH, handlers: staff() });
    const diego = await screen.findByRole('row', { name: /Díaz, Juan/ });
    expect(within(diego).queryByRole('textbox')).toBeNull();
    expect(
      screen.getByText('Sin consentimiento de datos vigente: no se le pueden cargar resultados.'),
    ).toBeVisible();
  });

  it('shows a recorded result with its attempts and voids one with a reason', async () => {
    let voided: unknown;
    const { user } = renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        listTestResults: () => fixtures.page([sprintResult(ANA_ID)]),
        voidTestResultEntries: (request) => {
          voided = request.body;
          return sprintResult(ANA_ID);
        },
      }),
    });
    const ana = await screen.findByRole('row', { name: /Álvarez, Juan/ });
    expect(await within(ana).findByText('Intento 1: 20 m: 3,10 s · 40 m: 5,40 s')).toBeVisible();
    expect(within(ana).queryByLabelText(/intento 1, Álvarez/)).toBeNull();
    await user.click(
      within(ana).getByRole('button', { name: 'Anular el intento 1 de Álvarez, Juan' }),
    );
    await user.type(
      within(ana).getByLabelText('Motivo de la anulación'),
      'Fotocélula mal calibrada',
    );
    await user.click(within(ana).getByRole('button', { name: 'Anular el intento' }));
    expect(
      await screen.findByText('Intento anulado. Queda en el historial con su motivo.'),
    ).toBeVisible();
    expect(voided).toEqual({
      entryIds: ['0192e7a0-9999-7000-8000-000000000001'],
      reason: 'Fotocélula mal calibrada',
    });
  });

  it('runs the day with its version', async () => {
    let body: unknown;
    const { user } = renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        updateTestSession: (request) => {
          body = request.body;
          return testSession({ status: 'completed' });
        },
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Cerrar el día' }));
    await waitFor(() => {
      expect(body).toEqual({ version: '1793586338688123', status: 'completed' });
    });
  });

  it('explains a stale version when running the day', async () => {
    const { user } = renderApp({
      path: DAY_PATH,
      handlers: staff('sc', {
        updateTestSession: () => reply(409, { error: { code: 'conflict', message: 'fake' } }),
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Cerrar el día' }));
    expect(
      await screen.findByText(
        'Alguien cambió este día mientras lo mirabas. Ya lo actualizamos: revisalo y probá de nuevo.',
      ),
    ).toBeVisible();
  });

  it('is read-only for the coach', async () => {
    renderApp({
      path: DAY_PATH,
      handlers: staff('coach', {
        getTestSessionSheet: () => {
          const base = sheet();
          return {
            ...base,
            players: base.players.map((p) => ({ ...p, recording: 'forbidden' as const })),
          };
        },
      }),
    });
    expect(
      await screen.findByText(
        'Ves la planilla en modo lectura: los resultados los carga el preparador físico de la categoría.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Guardar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cerrar el día' })).toBeNull();
  });

  it('opens the station of the link and keeps a suspended day read-only', async () => {
    renderApp({
      path: `${DAY_PATH}?station=cmj`,
      handlers: staff('sc', {
        getTestSessionSheet: () => sheet({ testSession: testSession({ status: 'cancelled' }) }),
      }),
    });
    expect(
      await screen.findByText(
        'Este día está suspendido y no recibe resultados. Para volver a programarlo, usá el calendario.',
      ),
    ).toBeVisible();
    expect(
      within(screen.getByRole('navigation', { name: 'Estaciones' })).getByRole('button', {
        name: /Salto con contramovimiento/,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
