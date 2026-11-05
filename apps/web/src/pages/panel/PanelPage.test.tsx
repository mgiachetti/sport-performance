import { screen, waitFor, within } from '@testing-library/react';
import { parseLocalDate } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { apiError } from '../../test/fake-api';
import * as fixtures from '../../test/fixtures';
import { renderApp, signedIn } from '../../test/render-app';
import { panelAlert, panelPlayer, squad, weeklyPanel } from './panel-fixtures';

function roster(): HTMLElement {
  return screen.getByRole('table', { name: 'Plantel' });
}

function rowOf(name: string): HTMLElement {
  const header = within(roster()).getByRole('rowheader', { name });
  const row = header.closest('tr');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

describe('weekly panel', () => {
  it('is in the navigation of the staff and shows the week of the scope', async () => {
    const { user, api } = renderApp({
      path: '/',
      handlers: { ...signedIn(), getWeeklyPanel: () => weeklyPanel(squad()) },
    });
    await user.click(await screen.findByRole('link', { name: 'Panel semanal' }));

    expect(await screen.findByRole('heading', { name: 'Panel semanal', level: 1 })).toBeVisible();
    expect(screen.getByText('Semana del 02/11/2026 al 08/11/2026')).toBeVisible();
    const [call] = api.callsTo('getWeeklyPanel');
    expect(call?.url.searchParams.toString()).toBe('weeks=12&sport=rugby');
    expect(call?.headers['x-membership-id']).toBe(fixtures.membership('coach').id);
    expect(api.unhandled).toEqual([]);
  });

  it('summarises the group, lists who needs attention and the roster, never a cause', async () => {
    renderApp({
      path: '/panel',
      handlers: { ...signedIn(), getWeeklyPanel: () => weeklyPanel(squad()) },
    });
    const kpis = await screen.findByRole('region', { name: 'Resumen del grupo' });
    expect(within(kpis).getByText('Respondieron bienestar hoy')).toBeVisible();
    // Each tile: the figure and its unit read together ("1 de 3").
    const values = kpis.querySelectorAll('.sp-kpi__value');
    expect([...values].map((value) => value.textContent)).toEqual([
      '1 de 3',
      '3,5 de 5',
      '1.000 UA',
      '2 de 3',
    ]);
    expect(within(kpis).getByText('1 en crítico')).toBeVisible();

    const attention = screen.getByRole('region', { name: 'Requieren atención' });
    const items = within(attention).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Bianchi, Tomás');
    expect(items[1]).toHaveTextContent('Roldán, Felipe');
    // One short line per player: the metric and its threshold, and how many alerts more.
    expect(items[0]).toHaveTextContent('ACWR alto 1,46 · umbral 1,40');
    expect(within(attention).getByText('+1 alerta')).toBeVisible();
    expect(items[1]).toHaveTextContent('Crecimiento 9,4 cm/año · pico desde 8,0 cm/año');

    const bianchi = rowOf('Bianchi, Tomás');
    expect(within(bianchi).getByText('Hooker')).toBeVisible();
    // One fact per line: the offset, then the % of adult height.
    expect(within(bianchi).getByText('-0,4 años del PHV')).toBeVisible();
    expect(within(bianchi).getByText('91,2 % de la talla adulta')).toBeVisible();
    expect(within(bianchi).getByText('2,5 de 5')).toBeVisible();
    expect(within(bianchi).getByText('1.200 UA')).toBeVisible();
    expect(within(bianchi).getByText('1 RPE pendiente')).toBeVisible();
    expect(within(bianchi).getByText('1,46')).toBeVisible();
    // Availability as a status with icon and text, never the cause.
    expect(within(bianchi).getByText('No disponible')).toBeVisible();
    // The detail is visible text, not a tooltip (screen readers and touch screens).
    expect(within(bianchi).getByText('Entrenar: Limitado')).toBeVisible();
    expect(within(bianchi).getByText('Partido: No disponible')).toBeVisible();
    // Available is plain text: the chips are for who is limited or out.
    expect(within(rowOf('Paz, Bautista')).getByText('Disponible')).toBeVisible();
    expect(within(rowOf('Paz, Bautista')).queryByText(/Entrenar:/)).toBeNull();
    expect(within(bianchi).getByText('Crítico')).toBeVisible();

    const roldan = rowOf('Roldán, Felipe');
    expect(within(roldan).getByText('Historia insuficiente')).toBeVisible();
    expect(within(roldan).getByText('Sin respuesta')).toBeVisible();
    expect(within(roldan).getByText('Sin datos')).toBeVisible();
    expect(within(roldan).getByText('Atención')).toBeVisible();
    expect(within(rowOf('Paz, Bautista')).getByText('En rango')).toBeVisible();

    expect(
      screen.getByRole('figure', { name: /Carga del grupo, últimas 4 semanas/ }),
    ).toBeVisible();
  });

  it('shows the first five who need attention, critical first, and the rest on demand', async () => {
    const players = Array.from({ length: 11 }, (_, index) =>
      panelPlayer(index + 1, {
        alerts: [panelAlert({ severity: index >= 8 ? 'critical' : 'warning' })],
      }),
    );
    const { user } = renderApp({
      path: '/panel',
      handlers: { ...signedIn(), getWeeklyPanel: () => weeklyPanel(players) },
    });
    const attention = await screen.findByRole('region', { name: 'Requieren atención' });
    const items = () => within(attention).getAllByRole('listitem');
    expect(items()).toHaveLength(5);
    // The three critical ones (players 9 to 11) lead the list.
    expect(items()[0]).toHaveTextContent('Apellido 9, Jugador');
    expect(items()[2]).toHaveTextContent('Apellido 11, Jugador');

    const toggle = within(attention).getByRole('button', { name: 'Ver todas (11)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Collapsed, the list does not scroll on its own (nothing hidden behind a scroll).
    expect(within(attention).queryByRole('region')).toBeNull();
    await user.click(toggle);
    expect(items()).toHaveLength(11);
    // Expanded, it scrolls inside the card as a named region the keyboard can reach.
    const list = within(attention).getByRole('region', { name: 'Lista completa: 11 jugadores' });
    expect(list).toHaveAttribute('tabindex', '0');
    // The region wraps the list: the items keep their list parent (WCAG 1.3.1).
    expect(within(list).getByRole('list')).toBeVisible();
    expect(within(list).getAllByRole('listitem')).toHaveLength(11);
    await user.click(within(attention).getByRole('button', { name: 'Ver menos' }));
    expect(items()).toHaveLength(5);
  });

  it('groups by maturity (bio-banding) and filters by group', async () => {
    const { user, app } = renderApp({
      path: '/panel',
      handlers: { ...signedIn(), getWeeklyPanel: () => weeklyPanel(squad()) },
    });
    const grouping = await screen.findByRole('radiogroup', { name: 'Agrupar por' });
    // By category the top bar's scope filters: no group tabs on the page.
    expect(screen.queryByRole('group', { name: 'Grupos' })).toBeNull();
    await user.click(within(grouping).getByRole('radio', { name: 'Años desde el PHV' }));
    await waitFor(() => {
      expect(app.router.state.location.search).toMatchObject({ group: 'phv_offset' });
    });
    const tabs = screen.getByRole('group', { name: 'Grupos' });
    expect(
      within(tabs)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual([
      'Todos (3)',
      'En el pico de crecimiento (1)',
      'Después del pico de crecimiento (1)',
      'Sin datos de maduración (1)',
    ]);
    expect(screen.getByText(/Agrupados por maduración y no por edad/)).toBeVisible();
    expect(within(rowOf('Bianchi, Tomás')).getByText('En el pico de crecimiento')).toBeVisible();

    await user.click(
      within(tabs).getByRole('button', { name: 'Después del pico de crecimiento (1)' }),
    );
    expect(
      screen.getByRole('button', { name: 'Después del pico de crecimiento (1)' }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      within(roster())
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['Paz, Bautista']);
    expect(screen.getByText('Nadie del grupo tiene alertas activas.')).toBeVisible();
  });

  it('moves between weeks through the URL', async () => {
    const { user, api } = renderApp({
      path: '/panel?category=' + fixtures.M15_RUGBY.id,
      handlers: {
        ...signedIn(),
        getWeeklyPanel: (request) => {
          const weekOf = request.url.searchParams.get('weekOf');
          return weeklyPanel(squad(), weekOf === null ? undefined : (weekOf as never));
        },
      },
    });
    expect(await screen.findByRole('button', { name: 'Semana siguiente' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Semana anterior' }));
    expect(await screen.findByText('Semana del 26/10/2026 al 01/11/2026')).toBeVisible();
    expect(screen.getByText('Cargaron bienestar en la semana')).toBeVisible();
    // A past week says the roster is today's and the data the reference day's.
    expect(
      screen.getByText(
        'Semana pasada: los jugadores, sus categorías y posiciones son los de hoy; los datos y las alertas, los del 01/11/2026.',
      ),
    ).toBeVisible();
    const last = api.callsTo('getWeeklyPanel').at(-1);
    expect(Object.fromEntries(last?.url.searchParams ?? [])).toEqual({
      weekOf: '2026-10-26',
      weeks: '12',
      sport: 'rugby',
      categoryId: fixtures.M15_RUGBY.id,
    });
    await user.click(screen.getByRole('button', { name: 'Esta semana' }));
    expect(await screen.findByText('Semana del 02/11/2026 al 08/11/2026')).toBeVisible();
    expect(screen.queryByText(/Semana pasada:/)).toBeNull();
  });

  it('says from when an ACWR is when the last derived day is older than the reference day', async () => {
    const players = squad().map((player) =>
      player.lastName === 'Paz'
        ? { ...player, load: { ...player.load, asOf: parseLocalDate('2026-10-20') } }
        : player,
    );
    renderApp({
      path: '/panel',
      handlers: { ...signedIn(), getWeeklyPanel: () => weeklyPanel(players) },
    });
    const paz = await screen.findByRole('rowheader', { name: 'Paz, Bautista' });
    const row = paz.closest('tr');
    if (row === null) throw new Error('no row');
    expect(within(row).getByText('1,10')).toBeVisible();
    expect(within(row).getByText('Último cálculo: 20/10/2026')).toBeVisible();
    expect(within(rowOf('Bianchi, Tomás')).queryByText(/Último cálculo/)).toBeNull();
  });

  it('explains an empty scope, too many players and errors', async () => {
    const first = renderApp({
      path: '/panel',
      handlers: { ...signedIn({ categories: [] }) },
    });
    expect(
      await screen.findByText(
        'Todavía no tenés categorías asignadas. Pedile a la administración del club que te asigne.',
      ),
    ).toBeVisible();
    expect(first.api.callsTo('getWeeklyPanel')).toHaveLength(0);
    first.unmount();

    const second = renderApp({
      path: '/panel',
      handlers: { ...signedIn(), getWeeklyPanel: () => apiError(400, 'bad_request') },
    });
    expect(await screen.findByText(/Son demasiados jugadores para un solo panel/)).toBeVisible();
    second.unmount();

    renderApp({
      path: '/panel',
      handlers: { ...signedIn(), getWeeklyPanel: () => weeklyPanel([]) },
    });
    expect(
      await screen.findByText('No hay jugadores vigentes en lo que estás mirando.'),
    ).toBeVisible();
  });
});
