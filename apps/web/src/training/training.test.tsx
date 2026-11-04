import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, reply } from '../test/fake-api';
import * as fixtures from '../test/fixtures';
import { renderApp, signedIn } from '../test/render-app';
import {
  P1,
  P2,
  P3,
  SESSION_ID,
  drill,
  participation,
  rosterEntry,
  sessionDetail,
  trainingSession,
} from '../test/training-fixtures';

const P4 = '0192e7a0-5555-7000-8000-000000000004';

function roster() {
  return [
    rosterEntry(
      P1,
      { first: 'Juan', last: 'Álvarez' },
      {
        participation: participation(P1, { minutes: 90, contactsN: 4, rpe: 6, srpeAu: 540 }),
        availability: { status: 'limited', staffNotes: ['Sin contacto'] },
      },
    ),
    rosterEntry(P2, { first: 'Tomás', last: 'Benítez' }),
    rosterEntry(
      P3,
      { first: 'Lucas', last: 'Castro' },
      { availability: { status: 'unavailable', staffNotes: [] } },
    ),
    rosterEntry(P4, { first: 'Mateo', last: 'Díaz' }, { hasDataConsent: false, canRecord: false }),
  ];
}

function detailHandlers(overrides: Parameters<typeof sessionDetail>[0] = {}) {
  return {
    getTrainingSession: () =>
      sessionDetail(overrides, [
        drill('0192e7a0-7777-7000-8000-000000000001', 'Entrada en calor', {
          sortOrder: 0,
          durationMin: 15,
        }),
        drill('0192e7a0-7777-7000-8000-000000000002', 'Tackle', {
          sortOrder: 1,
          durationMin: 20,
          contactLevel: 'controlled',
        }),
      ]),
    listTrainingSessionRoster: () => fixtures.page(roster()),
  } as const;
}

describe('sessions list', () => {
  it('shows the sessions of the scope, in the club time zone, from the navigation', async () => {
    const { api, user } = renderApp({
      path: `/?category=${fixtures.M15_RUGBY.id}`,
      handlers: {
        ...signedIn(),
        listTrainingSessions: () =>
          fixtures.page([
            trainingSession(),
            trainingSession({
              id: '0192e7a0-4444-7000-8000-000000000002' as never,
              kind: 'match',
              opponent: 'CASI',
              plannedDurationMin: null,
            }),
          ]),
      },
    });
    await user.click(await screen.findByRole('link', { name: 'Sesiones' }));
    expect(await screen.findByRole('heading', { name: 'Sesiones y partidos' })).toBeVisible();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('03/11/2026 18:30')).toHaveLength(2);
    expect(within(table).getByRole('link', { name: 'Entrenamiento M15' })).toHaveAttribute(
      'href',
      expect.stringContaining(`/sessions/${SESSION_ID}`),
    );
    expect(within(table).getByRole('link', { name: 'Partido contra CASI' })).toBeVisible();
    expect(within(table).getAllByText('Activa')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Nueva sesión' })).toBeVisible();
    const query = api.callsTo('listTrainingSessions')[0]?.url.searchParams;
    expect(query?.get('categoryId')).toBe(fixtures.M15_RUGBY.id);
    expect(query?.get('status')).toBe('active');
    expect(api.unhandled).toEqual([]);
  });

  it('filters by kind and archived in the URL, and pages with "Ver más"', async () => {
    let calls = 0;
    const { api, user, app } = renderApp({
      path: '/sessions',
      handlers: {
        ...signedIn(),
        listTrainingSessions: () => {
          calls += 1;
          return calls === 1
            ? { items: [trainingSession()], nextCursor: 'next' }
            : fixtures.page([]);
        },
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Ver más' }));
    await waitFor(() => {
      expect(api.callsTo('listTrainingSessions')[1]?.url.searchParams.get('cursor')).toBe('next');
    });
    await user.selectOptions(screen.getByLabelText('Tipo'), 'Solo partidos');
    await user.selectOptions(screen.getByLabelText('Mostrar'), 'Archivadas');
    await waitFor(() => {
      expect(app.router.state.location.search).toMatchObject({ kind: 'match', archived: true });
    });
    const last = api.callsTo('listTrainingSessions').at(-1)?.url.searchParams;
    expect(last?.get('kind')).toBe('match');
    expect(last?.get('status')).toBe('archived');
    expect(await screen.findByText('No hay sesiones con estos filtros.')).toBeVisible();
  });

  it('is read only for the S&C staff: no new session', async () => {
    renderApp({
      path: '/sessions',
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        listTrainingSessions: () => fixtures.page([trainingSession()]),
      },
    });
    expect(await screen.findByRole('table')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Nueva sesión' })).toBeNull();
  });
});

describe('new session', () => {
  it('creates a match with its drills, the start in the club time zone, idempotently', async () => {
    const { api, user, app } = renderApp({
      path: `/sessions/new?category=${fixtures.M15_RUGBY.id}`,
      handlers: {
        ...signedIn(),
        createTrainingSession: () => sessionDetail({ kind: 'match', opponent: 'CASI' }),
        ...detailHandlers({ kind: 'match', opponent: 'CASI' }),
      },
    });
    const form = within(await screen.findByRole('form', { name: 'Nueva sesión' }));
    await user.selectOptions(form.getByLabelText('Tipo'), 'Partido');
    expect(form.getByLabelText('Categoría')).toHaveValue(fixtures.M15_RUGBY.id);
    fireEvent.change(form.getByLabelText('Día'), { target: { value: '2026-11-07' } });
    fireEvent.change(form.getByLabelText('Hora de inicio'), { target: { value: '15:30' } });
    await user.type(form.getByLabelText('Duración planificada (min)'), '80');
    await user.type(form.getByLabelText('Rival'), 'CASI');
    await user.click(form.getByRole('button', { name: 'Agregar bloque' }));
    await user.type(form.getByLabelText('Nombre del bloque'), 'Line-out');
    await user.selectOptions(form.getByLabelText('Contacto'), 'Contacto controlado');
    await user.click(form.getByRole('button', { name: 'Crear sesión' }));

    await waitFor(() => {
      expect(app.router.state.location.pathname).toBe(`/sessions/${SESSION_ID}`);
    });
    const body = api.callsTo('createTrainingSession')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      kind: 'match',
      categoryId: fixtures.M15_RUGBY.id,
      startsAt: '2026-11-07T18:30:00.000Z',
      plannedDurationMin: 80,
      opponent: 'CASI',
      drills: [{ name: 'Line-out', contactLevel: 'controlled' }],
    });
    expect(body.clientUuid).toEqual(expect.any(String));
    expect(await screen.findByRole('heading', { name: 'Partido contra CASI' })).toBeVisible();
  });

  it('validates before calling the API and shows its field errors', async () => {
    const { api, user } = renderApp({
      path: '/sessions/new',
      handlers: {
        ...signedIn(),
        createTrainingSession: () =>
          reply(400, {
            error: {
              code: 'validation_failed',
              message: 'x',
              details: [{ path: ['body', 'title'], code: 'custom', message: 'x' }],
            },
          }),
      },
    });
    const form = within(await screen.findByRole('form', { name: 'Nueva sesión' }));
    await user.type(form.getByLabelText('Duración planificada (min)'), '0');
    await user.click(form.getByRole('button', { name: 'Crear sesión' }));
    expect(await form.findByText('Completá este dato.')).toBeVisible();
    expect(form.getByText('Un número entero de 1 a 1440 minutos.')).toBeVisible();
    expect(api.callsTo('createTrainingSession')).toHaveLength(0);

    await user.selectOptions(form.getByLabelText('Categoría'), 'M17');
    await user.clear(form.getByLabelText('Duración planificada (min)'));
    await user.type(form.getByLabelText('Título'), 'Defensa');
    await user.click(form.getByRole('button', { name: 'Crear sesión' }));
    expect(await form.findByText('Revisá este dato.')).toBeVisible();
    expect(form.getByLabelText('Título')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('session detail', () => {
  it('shows availability without the cause and saves only what changed, in one batch', async () => {
    const { api, user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: {
        ...signedIn(),
        ...detailHandlers(),
        recordParticipations: (request) => {
          const rows = (request.body as { rows: { playerId: string }[] }).rows;
          return {
            items: rows.map((row) => ({
              outcome: 'created' as const,
              participation: participation(row.playerId),
            })),
          };
        },
      },
    });
    const table = await screen.findByRole('table', { name: /Participación de la sesión/ });
    const p1 = within(table).getByRole('row', { name: /Álvarez, Juan/ });
    expect(within(p1).getByText('Con restricciones')).toBeVisible();
    expect(within(p1).getByText('Sin contacto')).toBeVisible();
    expect(within(p1).getByText('540')).toBeVisible();
    const p4 = within(table).getByRole('row', { name: /Díaz, Mateo/ });
    expect(within(p4).getByText('Sin consentimiento de datos: no se puede cargar.')).toBeVisible();
    expect(within(p4).queryByRole('combobox')).toBeNull();
    // The medical staff marked Castro unavailable: suggested, pending until saved.
    expect(screen.getByLabelText('Estado de Castro, Lucas')).toHaveValue('unavailable');
    expect(screen.getByLabelText('Minutos de Castro, Lucas')).toBeDisabled();
    expect(screen.getByText('1 cambio sin guardar')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Todos presentes (90 min)' }));
    expect(screen.getByLabelText('Estado de Benítez, Tomás')).toHaveValue('full');
    expect(screen.getByLabelText('Minutos de Benítez, Tomás')).toHaveValue('90');
    await user.type(screen.getByLabelText('Contactos de Benítez, Tomás'), '7');
    await user.click(screen.getByRole('button', { name: 'Guardar participación' }));

    expect(await screen.findByText('Guardamos la participación de 2 jugadores.')).toBeVisible();
    const body = api.callsTo('recordParticipations')[0]?.body as {
      rows: Record<string, unknown>[];
      changeReason?: string;
    };
    expect(body.changeReason).toBeUndefined();
    expect(body.rows).toEqual([
      expect.objectContaining({ playerId: P2, status: 'full', minutes: 90, contactsN: 7 }),
      expect.objectContaining({ playerId: P3, status: 'unavailable', minutes: null }),
    ]);
    expect(body.rows.every((row) => typeof row.clientUuid === 'string')).toBe(true);
    expect(api.unhandled).toEqual([]);
  });

  it('loads a hockey match by period, without contacts (B-803)', async () => {
    const hockeyMatch = {
      sport: 'hockey',
      kind: 'match',
      categoryId: fixtures.F15_HOCKEY.id,
      opponent: 'San Fernando',
      plannedDurationMin: 60,
    } as const;
    const { api, user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: {
        ...signedIn(),
        getTrainingSession: () =>
          sessionDetail(hockeyMatch, [
            drill('0192e7a0-7777-7000-8000-000000000001', 'Salida de bola', { durationMin: 15 }),
          ]),
        listTrainingSessionRoster: () =>
          fixtures.page([
            rosterEntry(
              P1,
              { first: 'Ana', last: 'Álvarez' },
              {
                participation: participation(P1, {
                  status: 'partial',
                  minutes: 42,
                  periodMinutes: [12, 9, 15, 6],
                }),
              },
            ),
            rosterEntry(P2, { first: 'Bea', last: 'Benítez' }),
          ]),
        recordParticipations: (request) => {
          const rows = (request.body as { rows: { playerId: string }[] }).rows;
          return {
            items: rows.map((row) => ({
              outcome: 'created' as const,
              participation: participation(row.playerId),
            })),
          };
        },
      },
    });
    const table = await screen.findByRole('table', { name: /Participación de la sesión/ });
    expect(within(table).getByRole('columnheader', { name: 'Tramo 4' })).toBeVisible();
    expect(within(table).queryByRole('columnheader', { name: 'Contactos' })).toBeNull();
    expect(screen.queryByLabelText('Contacto')).toBeNull();
    const ana = within(table).getByRole('row', { name: /Álvarez, Ana/ });
    expect(within(ana).getByText('42')).toBeVisible();
    expect(screen.getByLabelText('Minutos de Álvarez, Ana en el tramo 3')).toHaveValue('15');

    await user.selectOptions(screen.getByLabelText('Estado de Benítez, Bea'), 'partial');
    await user.type(screen.getByLabelText('Minutos de Benítez, Bea en el tramo 1'), '10');
    await user.type(screen.getByLabelText('Minutos de Benítez, Bea en el tramo 3'), '8');
    const bea = within(table).getByRole('row', { name: /Benítez, Bea/ });
    expect(within(bea).getByText('18')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Guardar participación' }));

    expect(await screen.findByText('Guardamos la participación de 1 jugador.')).toBeVisible();
    const body = api.callsTo('recordParticipations')[0]?.body as {
      rows: Record<string, unknown>[];
    };
    expect(body.rows).toEqual([
      expect.objectContaining({ playerId: P2, status: 'partial', periodMinutes: [10, 0, 8, 0] }),
    ]);
    expect(body.rows[0]).not.toHaveProperty('contactsN');
    expect(body.rows[0]).not.toHaveProperty('minutes');
  });

  it('asks for the reason to correct minutes already recorded, with the version', async () => {
    const { api, user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: {
        ...signedIn(),
        ...detailHandlers(),
        recordParticipations: () => ({
          items: [{ outcome: 'updated', participation: participation(P1, { minutes: 80 }) }],
        }),
      },
    });
    const minutes = await screen.findByLabelText('Minutos de Álvarez, Juan');
    // Castro's suggestion is not part of this test.
    await user.selectOptions(screen.getByLabelText('Estado de Castro, Lucas'), 'Presente');
    await user.selectOptions(screen.getByLabelText('Estado de Castro, Lucas'), 'No disponible');
    await user.clear(minutes);
    await user.type(minutes, '80');
    expect(screen.getByLabelText('Motivo de la corrección')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Guardar participación' }));
    expect(await screen.findByText('Escribí el motivo de la corrección.')).toBeVisible();
    expect(api.callsTo('recordParticipations')).toHaveLength(0);

    await user.type(screen.getByLabelText('Motivo de la corrección'), 'Salió a los 80');
    await user.click(screen.getByRole('button', { name: 'Guardar participación' }));
    await waitFor(() => {
      expect(api.callsTo('recordParticipations')).toHaveLength(1);
    });
    const body = api.callsTo('recordParticipations')[0]?.body as {
      rows: Record<string, unknown>[];
      changeReason?: string;
    };
    expect(body.changeReason).toBe('Salió a los 80');
    expect(body.rows).toContainEqual(
      expect.objectContaining({ playerId: P1, minutes: 80, version: '1793586338688123' }),
    );
  });

  it('flags minutes out of range without calling the API', async () => {
    const { api, user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: { ...signedIn(), ...detailHandlers() },
    });
    await user.selectOptions(await screen.findByLabelText('Estado de Benítez, Tomás'), 'Limitado');
    await user.type(screen.getByLabelText('Minutos de Benítez, Tomás'), '700');
    await user.click(screen.getByRole('button', { name: 'Guardar participación' }));
    expect(
      await screen.findByText(
        'Hay minutos o contactos que no son válidos: revisá las filas marcadas.',
      ),
    ).toBeVisible();
    expect(screen.getByLabelText('Minutos de Benítez, Tomás')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(api.callsTo('recordParticipations')).toHaveLength(0);
  });

  it('is read only for the S&C staff', async () => {
    renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...detailHandlers(),
        listTrainingSessionRoster: () =>
          fixtures.page(roster().map((entry) => ({ ...entry, canRecord: false }))),
      },
    });
    expect(
      await screen.findByText(
        'Ves la participación en modo lectura: la cargan el entrenador de la categoría o la administración.',
      ),
    ).toBeVisible();
    const table = screen.getByRole('table', { name: /Participación de la sesión/ });
    expect(within(table).queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar sesión' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agregar bloque' })).toBeNull();
    expect(screen.getByText('Tackle')).toBeVisible();
  });

  it('adds and reorders drills', async () => {
    const { api, user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: {
        ...signedIn(),
        ...detailHandlers(),
        createDrill: () => drill('0192e7a0-7777-7000-8000-000000000003', 'Scrum'),
        updateDrill: (request) => drill(request.params.drillId ?? '', 'x'),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Bajar Entrada en calor' }));
    await waitFor(() => {
      expect(api.callsTo('updateDrill')).toHaveLength(2);
    });
    expect(api.callsTo('updateDrill').map((call) => call.body)).toEqual([
      { version: '1793586338688123', sortOrder: 1 },
      { version: '1793586338688123', sortOrder: 0 },
    ]);

    const name = screen.getByLabelText('Nombre del bloque');
    await user.type(name, 'Scrum');
    await user.selectOptions(screen.getByLabelText('Contacto'), 'Contacto pleno');
    await user.click(screen.getByRole('button', { name: 'Agregar bloque' }));
    await waitFor(() => {
      expect(api.callsTo('createDrill')[0]?.body).toMatchObject({
        name: 'Scrum',
        contactLevel: 'full',
      });
    });
  });

  it('edits the session: moving the start is a correction with a reason', async () => {
    const { api, user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: {
        ...signedIn(),
        ...detailHandlers(),
        updateTrainingSession: () => trainingSession({ startsAt: '2026-11-03T22:00:00.000Z' }),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Editar sesión' }));
    expect(screen.getByLabelText('Hora de inicio')).toHaveValue('18:30');
    fireEvent.change(screen.getByLabelText('Hora de inicio'), { target: { value: '19:00' } });
    await user.type(screen.getByLabelText('Motivo de la corrección'), 'Se pasó de horario');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      expect(api.callsTo('updateTrainingSession')[0]?.body).toEqual({
        version: '1793586338688123',
        startsAt: '2026-11-03T22:00:00.000Z',
        changeReason: 'Se pasó de horario',
      });
    });
  });

  it('says when someone else changed the session, and archives', async () => {
    const { api, user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: {
        ...signedIn(),
        ...detailHandlers(),
        updateTrainingSession: () => apiError(409, 'conflict'),
        archiveTrainingSession: () => trainingSession({ archivedAt: '2026-11-03T23:00:00.000Z' }),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Editar sesión' }));
    await user.type(screen.getByLabelText('Título'), 'Defensa');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(
      await screen.findByText(
        'Alguien cambió esto mientras lo editabas. Recargá para ver los datos actuales y volvé a intentar.',
      ),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Recargar datos' }));

    await user.click(await screen.findByRole('button', { name: 'Archivar' }));
    await user.click(screen.getByRole('button', { name: 'Sí, archivar' }));
    await waitFor(() => {
      expect(api.callsTo('archiveTrainingSession')).toHaveLength(1);
    });
  });

  it('shows an archived session without loading anything new', async () => {
    renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: {
        ...signedIn(),
        ...detailHandlers({ archivedAt: '2026-11-03T23:00:00.000Z' }),
      },
    });
    expect(
      await screen.findByText(
        'Esta sesión está archivada: no acepta cambios de bloques ni de participación. Restaurala para cargar.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Restaurar' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Guardar participación' })).toBeNull();
    const table = await screen.findByRole('table', { name: /Participación de la sesión/ });
    expect(within(table).getByText('Álvarez, Juan')).toBeVisible();
    expect(within(table).queryByRole('combobox')).toBeNull();
  });
});
