import type { MenstrualCycleDays } from '@sport-performance/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import * as fixtures from '../test/fixtures';
import { renderApp, signedIn } from '../test/render-app';

const PLAYER_ID = '0192e7a0-5555-7000-8000-000000000001';
const MODULES = {
  modules: {
    wellness: true,
    gym: true,
    gps: false,
    maturation: true,
    pain_report: false,
    menstrual_cycle: true,
  },
  version: '1',
};

const DAYS: MenstrualCycleDays = {
  playerId: PLAYER_ID as MenstrualCycleDays['playerId'],
  from: '2026-08-07' as MenstrualCycleDays['from'],
  to: '2026-11-04' as MenstrualCycleDays['to'],
  days: [
    {
      id: '0192e7a0-6666-7000-8000-000000000001' as never,
      clientUuid: '0192e7a0-6666-7000-8000-000000000002' as never,
      playerId: PLAYER_ID as never,
      localDate: '2026-11-03' as never,
      flow: 'heavy',
      symptoms: ['cramps', 'fatigue'],
      note: 'Molestia',
      loggedAt: '2026-11-03T12:00:00.000Z',
    },
  ],
  summary: {
    periodStarts: ['2026-11-03' as never],
    lastPeriodStart: '2026-11-03' as never,
    cycleDay: 2,
    cycleLengthsDays: [],
    daysLogged: 1,
  },
};

describe('menstrual cycle shared with the staff', () => {
  it('the authorized medical member lists the players and reads a table of days', async () => {
    const { user } = renderApp({
      path: '/menstrual-cycle',
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('medical')] }),
        getClubModules: () => MODULES,
        listMenstrualCycleSharedWithMe: () => ({
          items: [
            {
              playerId: PLAYER_ID as MenstrualCycleDays['playerId'],
              firstName: 'Sofía',
              lastName: 'Gómez',
              authorizedAt: '2026-11-01T12:00:00.000Z',
            },
          ],
        }),
        getMenstrualCycleDays: () => DAYS,
      },
    });
    expect(
      await screen.findByRole('heading', { name: 'Ciclo menstrual compartido con vos' }),
    ).toBeVisible();
    await user.click(
      await screen.findByRole('button', { name: 'Ver el registro de Gómez, Sofía' }),
    );
    const table = await screen.findByRole('table', { name: 'Últimos 90 días' });
    const row = within(table).getByRole('row', { name: /03\/11\/2026/ });
    expect(within(row).getByText('Abundante')).toBeVisible();
    expect(within(row).getByText('Cólicos, Cansancio')).toBeVisible();
    expect(screen.getByText('Día 2 del ciclo')).toBeVisible();
  });

  it('a member nobody authorized sees an empty list', async () => {
    renderApp({
      path: '/menstrual-cycle',
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        getClubModules: () => MODULES,
        listMenstrualCycleSharedWithMe: () => ({ items: [] }),
      },
    });
    expect(await screen.findByText('Ninguna jugadora te autorizó a ver su ciclo.')).toBeVisible();
  });

  it('the coach does not get the entry in the navigation', async () => {
    renderApp({
      path: '/',
      handlers: { ...signedIn({ memberships: [fixtures.membership('coach')] }) },
    });
    const nav = await screen.findByRole('navigation', { name: 'Secciones' });
    expect(within(nav).queryByRole('link', { name: 'Ciclo menstrual' })).toBeNull();
  });
});
