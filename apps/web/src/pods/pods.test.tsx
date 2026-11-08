import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { reply, type FakeHandlers } from '../test/fake-api';
import * as fixtures from '../test/fixtures';
import { pod, podAssignment, sessionPodPlayer } from '../test/pod-fixtures';
import { renderApp, signedIn } from '../test/render-app';
import { P1, P2, P3, SESSION_ID, sessionDetail } from '../test/training-fixtures';

const ADMIN = fixtures.membership('admin');

function conflict(code: string) {
  return reply(409, {
    error: {
      code: 'conflict',
      message: 'fake conflict',
      details: [{ path: ['body', 'podId'], code, message: 'overlap' }],
    },
  });
}

describe('pods: the fleet in the administration', () => {
  function asAdmin(handlers: FakeHandlers = {}): FakeHandlers {
    return {
      ...signedIn({ memberships: [ADMIN] }),
      listPods: () =>
        fixtures.page([
          pod(7, {
            health: {
              ...pod(7).health,
              lastSeenAt: '2026-11-03T21:30:00.000Z',
              batteryCapacityPct: 87.4,
            },
          }),
          pod(9, { status: 'lost', keysRevokedAt: '2026-11-02T12:00:00.000Z' }),
        ]),
      listPodCategories: () => ({
        items: [
          { categoryId: fixtures.M15_RUGBY.id, podsEnabled: false, version: '1' },
          { categoryId: fixtures.M17_RUGBY.id, podsEnabled: true, version: '2' },
        ],
      }),
      ...handlers,
    };
  }

  it('lists the pods with number, serial, status as icon + text and last health', async () => {
    const { api } = renderApp({ path: '/admin/pods', handlers: asAdmin() });
    const table = await screen.findByRole('table', { name: 'Flota de pods' });
    const [, first, second] = within(table).getAllByRole('row');
    if (first === undefined || second === undefined) throw new Error('two pods');
    expect(within(first).getByText('SPP-0007')).toBeVisible();
    expect(within(first).getByText('Activo')).toBeVisible();
    expect(within(first).getByText('03/11/2026 18:30')).toBeVisible();
    expect(within(first).getByText('87 %')).toBeVisible();
    expect(within(second).getByText('Perdido')).toBeVisible();
    expect(within(second).getByRole('button', { name: 'Recuperar' })).toBeVisible();
    // The categories with pods, for the administration.
    const categories = await screen.findByRole('table', { name: 'Categorías con pods' });
    expect(within(categories).getByText('Sin pods')).toBeVisible();
    expect(within(categories).getByText('Con pods')).toBeVisible();
    expect(api.unhandled).toEqual([]);
  });

  it('registers a pod by its serial (normalized) and number', async () => {
    const { api, user } = renderApp({
      path: '/admin/pods',
      handlers: asAdmin({ registerPod: () => reply(201, pod(12)) }),
    });
    await screen.findByRole('table', { name: 'Flota de pods' });
    await user.click(screen.getByRole('button', { name: 'Sumar a la flota' }));
    expect(
      screen.getByText('Revisá el número de serie: de 4 a 32 letras, números y guiones.'),
    ).toBeVisible();
    expect(api.callsTo('registerPod')).toHaveLength(0);
    await user.type(screen.getByLabelText('Número de serie (QR)'), ' spp-0012 ');
    await user.type(screen.getByLabelText('Número del pod y del chaleco'), '12');
    await user.click(screen.getByRole('button', { name: 'Sumar a la flota' }));
    expect(await screen.findByText('El pod 12 ya está en la flota.')).toBeVisible();
    expect(api.callsTo('registerPod')[0]?.body).toMatchObject({
      serialNumber: 'SPP-0012',
      number: 12,
    });
  });

  it('explains a serial that is not of the club', async () => {
    const { user } = renderApp({
      path: '/admin/pods',
      handlers: asAdmin({
        registerPod: () => reply(404, { error: { code: 'not_found', message: 'fake' } }),
      }),
    });
    await screen.findByRole('table', { name: 'Flota de pods' });
    await user.type(screen.getByLabelText('Número de serie (QR)'), 'SPP-0099');
    await user.type(screen.getByLabelText('Número del pod y del chaleco'), '99');
    await user.click(screen.getByRole('button', { name: 'Sumar a la flota' }));
    expect(await screen.findByText('Ese número de serie no es de un pod del club.')).toBeVisible();
  });

  it('marks a pod lost in two steps', async () => {
    const { api, user } = renderApp({
      path: '/admin/pods',
      handlers: asAdmin({ markPodMissing: () => pod(7, { status: 'lost' }) }),
    });
    const table = await screen.findByRole('table', { name: 'Flota de pods' });
    await user.click(within(table).getByRole('button', { name: 'Marcar perdido' }));
    expect(
      screen.getByText(
        'El pod 7 queda perdido: se revocan sus claves y termina su asignación en curso.',
      ),
    ).toBeVisible();
    const confirm = screen.getByRole('group', { name: 'Marcar perdido' });
    await user.click(within(confirm).getByRole('button', { name: 'Marcar perdido' }));
    await waitFor(() => {
      expect(api.callsTo('markPodMissing')).toHaveLength(1);
    });
    expect(api.callsTo('markPodMissing')[0]?.body).toEqual({
      version: pod(7).version,
      status: 'lost',
    });
    expect(api.callsTo('markPodMissing')[0]?.params).toEqual({ podId: pod(7).id });
  });

  it('is a section for S&C too, but not for the coach', async () => {
    renderApp({
      path: '/admin/pods',
      handlers: {
        ...asAdmin(),
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
      },
    });
    expect(await screen.findByRole('table', { name: 'Flota de pods' })).toBeVisible();
    // S&C does not configure the categories.
    expect(screen.queryByRole('table', { name: 'Categorías con pods' })).toBeNull();
  });
});

describe('pods: assignments on a session', () => {
  const FREE = pod(7);
  const TAKEN = pod(9);

  function handlers(overrides: FakeHandlers = {}): FakeHandlers {
    return {
      ...signedIn(),
      getTrainingSession: () => sessionDetail(),
      listTrainingSessionRoster: () => fixtures.page([]),
      listPods: () => fixtures.page([FREE, TAKEN, pod(11, { status: 'lost' })]),
      getSessionPods: () => ({
        podsEnabled: true,
        players: [
          sessionPodPlayer(P1, { first: 'Juan', last: 'Álvarez' }),
          sessionPodPlayer(
            P2,
            { first: 'Tomás', last: 'Benítez' },
            { missingConsents: ['location'], canAssign: false },
          ),
          sessionPodPlayer(
            P3,
            { first: 'Lucas', last: 'Castro' },
            { assignment: podAssignment(P3, TAKEN) },
          ),
        ],
      }),
      ...overrides,
    };
  }

  async function podsTable() {
    return within(await screen.findByRole('table', { name: 'Pods' }));
  }

  it('assigns a free active pod to a player with the consent', async () => {
    const { api, user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: handlers({
        createPodAssignment: () => reply(201, podAssignment(P1, FREE)),
      }),
    });
    const table = await podsTable();
    const select = await table.findByLabelText('Pod para Álvarez, Juan');
    // Only active pods not taken in the session.
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Elegí un pod', 'Pod 7']);
    expect(table.getAllByText('Ubicación vigente', { selector: 'span' })).toHaveLength(2);
    await user.selectOptions(select, 'Pod 7');
    await user.click(table.getByRole('button', { name: 'Asignar Álvarez, Juan' }));
    await waitFor(() => {
      expect(api.callsTo('createPodAssignment')).toHaveLength(1);
    });
    expect(api.callsTo('createPodAssignment')[0]?.body).toMatchObject({
      podId: FREE.id,
      playerId: P1,
      trainingSessionId: SESSION_ID,
    });
    expect(api.unhandled).toEqual([]);
  });

  it('a player without the location consent cannot be assigned', async () => {
    renderApp({ path: `/sessions/${SESSION_ID}`, handlers: handlers() });
    const table = await podsTable();
    expect(
      await table.findByText('Falta el consentimiento de ubicación', { selector: 'span' }),
    ).toBeVisible();
    expect(table.queryByLabelText('Pod para Benítez, Tomás')).toBeNull();
    expect(table.queryByRole('button', { name: 'Asignar Benítez, Tomás' })).toBeNull();
  });

  it('explains an overlap the server answers with a conflict', async () => {
    const { user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: handlers({ createPodAssignment: () => conflict('pod_overlap') }),
    });
    const table = await podsTable();
    await user.selectOptions(await table.findByLabelText('Pod para Álvarez, Juan'), 'Pod 7');
    await user.click(table.getByRole('button', { name: 'Asignar Álvarez, Juan' }));
    expect(
      await screen.findByText(
        'Ese pod ya lo tiene otro jugador en ese horario. Elegí otro pod o corregí la otra asignación.',
      ),
    ).toBeVisible();
  });

  it('ends an open assignment', async () => {
    const { api, user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: handlers({
        endPodAssignment: () => podAssignment(P3, TAKEN, { endsAt: '2026-11-03T23:00:00.000Z' }),
      }),
    });
    const table = await podsTable();
    expect(table.getByText('Pod 9')).toBeVisible();
    await user.click(table.getByRole('button', { name: 'Terminar Castro, Lucas' }));
    await waitFor(() => {
      expect(api.callsTo('endPodAssignment')).toHaveLength(1);
    });
  });

  it('a correction asks for the reason before it is sent', async () => {
    const { api, user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: handlers({
        correctPodAssignment: () =>
          podAssignment(P3, TAKEN, {
            startsAt: '2026-11-03T21:45:00.000Z',
            reprocessRequestedAt: '2026-11-03T23:00:00.000Z',
          }),
      }),
    });
    const table = await podsTable();
    await user.click(table.getByRole('button', { name: 'Corregir Castro, Lucas' }));
    const time = table.getByLabelText('Hora de inicio');
    expect(time).toHaveValue('18:30');
    await user.clear(time);
    await user.type(time, '18:45');
    await user.click(table.getByRole('button', { name: 'Guardar corrección' }));
    expect(table.getByText('Contá por qué se corrige: queda en el historial.')).toBeVisible();
    expect(api.callsTo('correctPodAssignment')).toHaveLength(0);
    await user.type(table.getByLabelText('Motivo'), 'Se cambió de chaleco');
    await user.click(table.getByRole('button', { name: 'Guardar corrección' }));
    await waitFor(() => {
      expect(api.callsTo('correctPodAssignment')).toHaveLength(1);
    });
    expect(api.callsTo('correctPodAssignment')[0]?.body).toEqual({
      version: '1793586338688123',
      changeReason: 'Se cambió de chaleco',
      startsAt: '2026-11-03T21:45:00.000Z',
    });
  });

  it('sends only the edited end: a back-to-back swap keeps the exact start', async () => {
    const { api, user } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: handlers({
        getSessionPods: () => ({
          podsEnabled: true,
          players: [
            sessionPodPlayer(
              P3,
              { first: 'Lucas', last: 'Castro' },
              {
                assignment: podAssignment(P3, TAKEN, {
                  startsAt: '2026-11-03T21:30:17.250Z',
                  endsAt: '2026-11-03T22:10:42.000Z',
                }),
              },
            ),
          ],
        }),
        correctPodAssignment: () => podAssignment(P3, TAKEN),
      }),
    });
    const table = await podsTable();
    await user.click(table.getByRole('button', { name: 'Corregir Castro, Lucas' }));
    const end = table.getByLabelText('Hora de fin');
    await user.clear(end);
    await user.type(end, '19:05');
    await user.type(table.getByLabelText('Motivo'), 'Cambio de chaleco');
    await user.click(table.getByRole('button', { name: 'Guardar corrección' }));
    await waitFor(() => {
      expect(api.callsTo('correctPodAssignment')).toHaveLength(1);
    });
    const body = api.callsTo('correctPodAssignment')[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('startsAt');
    expect(body.endsAt).toBe('2026-11-03T22:05:00.000Z');
  });

  it('says when the category of the session has no pods', async () => {
    const { api } = renderApp({
      path: `/sessions/${SESSION_ID}`,
      handlers: handlers({ getSessionPods: () => ({ podsEnabled: false, players: [] }) }),
    });
    expect(
      await screen.findByText(
        'Esta categoría no tiene pods. La administración los habilita por categoría.',
      ),
    ).toBeVisible();
    expect(api.callsTo('listPods')).toHaveLength(0);
  });
});
