import type { UsageSummary } from '@sport-performance/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FakeHandlers } from '../test/fake-api';
import * as fixtures from '../test/fixtures';
import { renderApp, signedIn } from '../test/render-app';

const ADMIN = fixtures.membership('admin');

const SUMMARY = {
  timeZone: 'America/Argentina/Buenos_Aires',
  today: '2026-11-04',
  isDemo: false,
  weeks: [
    { weekStart: '2026-10-26', weekEnd: '2026-11-01' },
    { weekStart: '2026-11-02', weekEnd: '2026-11-08' },
  ],
  usageRetainedFrom: '2026-08-03',
  categories: [{ id: fixtures.M15_RUGBY.id, name: 'M15', sport: 'rugby', sex: 'male' }],
  training: [
    {
      weekStart: '2026-11-02',
      categoryId: fixtures.M15_RUGBY.id,
      sessions: 2,
      attendedPlayerDays: 4,
      attendedPlayerDaysWithWellness: 3,
      attendedParticipations: 4,
      participationsWithRpe: 2,
      rpeViaKiosk: 1,
      wellnessOnSessionDaysRate: 0.75,
      rpeRate: 0.5,
    },
  ],
  wellness: [],
  tests: [
    {
      weekStart: '2026-10-26',
      categoryId: null,
      testDays: 0,
      results: 0,
      playersTested: 0,
      importedResults: 12,
    },
  ],
  surfaces: [
    {
      weekStart: '2026-11-02',
      surface: 'panel',
      client: 'web',
      role: 'coach',
      activeMembers: 2,
      memberDays: 3,
      events: 7,
    },
  ],
  members: [{ weekStart: '2026-11-02', role: 'coach', members: 4 }],
} as unknown as UsageSummary;

function asAdmin(handlers: FakeHandlers = {}): FakeHandlers {
  return {
    ...signedIn({ memberships: [ADMIN] }),
    getUsageSummary: () => SUMMARY,
    ...handlers,
  };
}

describe('usage metrics page', () => {
  it('is in the navigation of the administration and shows the adoption as tables', async () => {
    const { user, api } = renderApp({ path: '/', handlers: asAdmin() });
    await user.click(await screen.findByRole('link', { name: 'Uso' }));
    expect(await screen.findByRole('heading', { name: 'Uso de la plataforma' })).toBeVisible();

    const training = screen.getByRole('region', { name: 'Bienestar y RPE en días de sesión' });
    const row = within(training).getByRole('row', { name: /M15/ });
    expect(row).toHaveTextContent('Semana del 02/11/2026 al 08/11/2026');
    expect(row).toHaveTextContent('3 de 4 (75 %)');
    expect(row).toHaveTextContent('2 de 4 (50 %)');

    const surfaces = screen.getByRole('region', { name: 'Uso de las pantallas' });
    const panel = within(surfaces).getByRole('row', { name: /Panel semanal/ });
    expect(panel).toHaveTextContent('Entrenador/a');
    expect(panel).toHaveTextContent('2 de 4 (50 %)');

    const tests = screen.getByRole('region', { name: 'Días de test cargados' });
    expect(within(tests).getByRole('row', { name: /Sin categoría/ })).toHaveTextContent('12');
    expect(
      screen.getByText('No hubo bienestar cargado en el período.', { exact: true }),
    ).toBeVisible();

    expect(api.callsTo('getUsageSummary')[0]?.url.searchParams.get('weeks')).toBe('4');
  });

  it('asks for the period chosen and warns about a demo club', async () => {
    const { user, api } = renderApp({
      path: '/usage',
      handlers: asAdmin({ getUsageSummary: () => ({ ...SUMMARY, isDemo: true }) }),
    });
    expect(await screen.findByText(/Este es el club demo/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Período'), '12');
    await waitFor(() => {
      expect(api.callsTo('getUsageSummary').map((r) => r.url.searchParams.get('weeks'))).toContain(
        '12',
      );
    });
  });

  it('is not for the staff', async () => {
    renderApp({
      path: '/usage',
      handlers: signedIn({ memberships: [fixtures.membership('coach')] }),
    });
    expect(await screen.findByText('No tenés permiso para ver esto.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Uso' })).toBeNull();
  });
});
