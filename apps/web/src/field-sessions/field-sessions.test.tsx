import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError } from '../test/fake-api';
import * as fs from '../test/field-session-fixtures';
import * as fixtures from '../test/fixtures';
import { renderApp, signedIn } from '../test/render-app';

function rowAt(rows: readonly HTMLElement[], index: number): HTMLElement {
  const row = rows[index];
  if (row === undefined) throw new Error(`No row ${String(index)}`);
  return row;
}

const MODULES_ON = {
  modules: {
    wellness: true,
    gym: true,
    gps: true,
    maturation: true,
    pain_report: false,
    menstrual_cycle: false,
  },
  version: '1793586338688123',
};
const MODULES_OFF = { ...MODULES_ON, modules: { ...MODULES_ON.modules, gps: false } };

function coach() {
  return signedIn({
    memberships: [fixtures.membership('coach')],
    categories: [fixtures.M15_RUGBY, fixtures.M17_RUGBY],
  });
}

describe('field sessions list', () => {
  it('is in the navigation of the staff and lists the sessions with field data', async () => {
    const { user, api } = renderApp({
      path: '/',
      handlers: {
        ...coach(),
        getClubModules: () => MODULES_ON,
        listFieldSessions: () =>
          fixtures.page([
            fs.listItem(),
            fs.listItem({
              session: fs.sessionSummary({
                id: fs.TRAINING_ID as never,
                kind: 'training',
                title: null,
                categoryId: fixtures.M17_RUGBY.id,
                localDate: '2026-10-21' as never,
              }),
              playersN: 12,
              sources: ['catapult', 'pod'],
            }),
          ]),
      },
    });
    const nav = await screen.findByRole('navigation', { name: 'Secciones' });
    await user.click(within(nav).getByRole('link', { name: 'Sesión en cancha' }));

    expect(await screen.findByRole('heading', { name: 'Sesiones en cancha' })).toBeVisible();
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rowAt(rows, 1)).getByText('24/10/2026')).toBeVisible();
    expect(within(rowAt(rows, 1)).getByRole('link', { name: 'Ver M15 vs. CASI' })).toHaveAttribute(
      'href',
      `/field-sessions/${fs.MATCH_ID}`,
    );
    expect(within(rowAt(rows, 1)).getByText('M15')).toBeVisible();
    expect(within(rowAt(rows, 1)).getByText('3 métricas')).toBeVisible();
    // A session without title is named by its kind and day.
    expect(
      within(rowAt(rows, 2)).getByRole('link', {
        name: 'Ver Entrenamiento del 21/10/2026',
      }),
    ).toBeVisible();
    expect(within(rowAt(rows, 2)).getByText('Catapult, Pod')).toBeVisible();
    expect(api.callsTo('listFieldSessions')[0]?.url.searchParams.get('limit')).toBe('25');
    expect(api.unhandled).toEqual([]);
  });

  it('filters by the category of the layout and by kind', async () => {
    const { user, api } = renderApp({
      path: `/field-sessions?category=${fixtures.M15_RUGBY.id}`,
      handlers: {
        ...coach(),
        getClubModules: () => MODULES_ON,
        listFieldSessions: () => fixtures.page([]),
      },
    });
    expect(
      await screen.findByText('No hay sesiones con datos de cancha para este filtro.'),
    ).toBeVisible();
    expect(api.callsTo('listFieldSessions')[0]?.url.searchParams.get('categoryId')).toBe(
      fixtures.M15_RUGBY.id,
    );
    await user.selectOptions(screen.getByLabelText('Tipo'), 'Partido');
    await waitFor(() => {
      expect(api.callsTo('listFieldSessions').at(-1)?.url.searchParams.get('kind')).toBe('match');
    });
  });

  it('explains where the data comes from and says when the GPS module is off', async () => {
    renderApp({
      path: '/field-sessions',
      handlers: {
        ...coach(),
        getClubModules: () => MODULES_OFF,
        listFieldSessions: () => fixtures.page([]),
      },
    });
    expect(
      await screen.findByText(
        /Todavía no hay sesiones con datos de cancha\. Llegan con la importación de Catapult/,
      ),
    ).toBeVisible();
    expect(
      await screen.findByText(/El módulo de métricas de cancha \(GPS\) está apagado/),
    ).toBeVisible();
  });

  it('pages with "Cargar más"', async () => {
    const { user, api } = renderApp({
      path: '/field-sessions',
      handlers: {
        ...coach(),
        getClubModules: () => MODULES_ON,
        listFieldSessions: (request) =>
          request.url.searchParams.get('cursor') === null
            ? { items: [fs.listItem()], nextCursor: 'next-page' }
            : fixtures.page([
                fs.listItem({
                  session: fs.sessionSummary({ id: fs.TRAINING_ID as never, title: 'Velocidad' }),
                }),
              ]),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByRole('link', { name: 'Ver Velocidad' })).toBeVisible();
    expect(api.callsTo('listFieldSessions')[1]?.url.searchParams.get('cursor')).toBe('next-page');
    expect(screen.queryByRole('button', { name: 'Cargar más' })).not.toBeInTheDocument();
  });

  it('shows the error envelope', async () => {
    renderApp({
      path: '/field-sessions',
      handlers: {
        ...coach(),
        getClubModules: () => MODULES_ON,
        listFieldSessions: () => apiError(500, 'internal', { requestId: 'req-42' }),
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('req-42');
  });
});

describe('field session view', () => {
  const path = `/field-sessions/${fs.MATCH_ID}`;

  it('shows the summary, the chart by line with the first-team reference and the table', async () => {
    const { api } = renderApp({
      path,
      handlers: {
        ...coach(),
        getClubModules: () => MODULES_ON,
        getTrainingSessionFieldMetrics: () => fs.fieldSession(),
      },
    });
    expect(await screen.findByRole('heading', { name: 'M15 vs. CASI' })).toBeVisible();
    expect(screen.getByText('Partido · M15 · sábado 24 de octubre de 2026 · 70 min')).toBeVisible();

    const kpis = screen.getByRole('region', { name: 'Resumen de la sesión' });
    expect(within(kpis).getByText('Distancia media')).toBeVisible();
    expect(within(kpis).getByText('5.675 m')).toBeVisible();
    expect(within(kpis).getByText('HSR media')).toBeVisible();
    expect(within(kpis).getByText('415 m')).toBeVisible();
    expect(within(kpis).getByText('8,61 m/s')).toBeVisible();
    expect(within(kpis).getByText('De Juan Bianchi · Catapult')).toBeVisible();
    expect(within(kpis).getByText('24')).toBeVisible();

    // Bars highest first, backs in the brand tone and forwards in grey, named in the legend.
    const chart = screen.getByRole('figure', { name: 'Distancia por jugador (m)' });
    const legend = within(chart).getByRole('list', { name: 'Leyenda' });
    expect(within(legend).getByText('Backs')).toBeVisible();
    expect(within(legend).getByText('Delanteros')).toBeVisible();
    expect(within(chart).getAllByText(/Primera 6\.000/).length).toBeGreaterThan(0);
    const chartTable = within(chart).getByRole('table', { hidden: true });
    const chartRows = within(chartTable).getAllByRole('row', { hidden: true });
    expect(chartRows[1]).toHaveTextContent('Juan Bianchi');
    expect(chartRows[2]).toHaveTextContent('Tomás Álvarez');

    const table = screen.getByRole('table', { name: 'Fuente: Catapult' });
    const header = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(header).toEqual([
      'Jugador',
      'Posición',
      'Participación',
      'Minutos',
      'sRPE (UA)',
      'Distancia (m)',
      'HSR absoluta (m)',
      'Vmax (m/s)',
      'Contactos',
    ]);
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Tomás ÁlvarezHookerCompleta704905.1203107,8418');
    // "No disponible", never a cause; no field data, said in words.
    expect(within(rowAt(rows, 3)).getByText('No disponible')).toBeVisible();
    expect(within(rowAt(rows, 3)).getByText('Sin datos de cancha')).toBeVisible();
    expect(api.callsTo('getTrainingSessionFieldMetrics')[0]?.url.pathname).toBe(
      `/v1/training-sessions/${fs.MATCH_ID}/field-metrics`,
    );
    expect(api.unhandled).toEqual([]);
  });

  it('switches the metric of the chart', async () => {
    const { user } = renderApp({
      path,
      handlers: {
        ...coach(),
        getClubModules: () => MODULES_ON,
        getTrainingSessionFieldMetrics: () => fs.fieldSession(),
      },
    });
    await user.selectOptions(await screen.findByLabelText('Métrica'), 'Vmax');
    const chart = await screen.findByRole('figure', { name: 'Vmax por jugador (m/s)' });
    // No first-team reference of Vmax in this club: no dashed line.
    expect(within(chart).queryByText(/Primera/)).not.toBeInTheDocument();
  });

  it('keeps two sources of a metric apart and warns', async () => {
    const view = fs.fieldSession({
      columns: [
        { metricCode: 'dist_m', source: 'catapult', unit: 'm', direction: 'higher_is_better' },
        { metricCode: 'dist_m', source: 'pod', unit: 'm', direction: 'higher_is_better' },
      ] as never,
      players: [
        { ...fs.ALVAREZ, values: fs.values(['dist_m', 'catapult', 5120], ['dist_m', 'pod', 5090]) },
        { ...fs.BIANCHI, values: fs.values(['dist_m', 'pod', 6100]) },
      ],
    });
    renderApp({
      path,
      handlers: {
        ...coach(),
        getClubModules: () => MODULES_ON,
        getTrainingSessionFieldMetrics: () => view,
      },
    });
    expect(
      await screen.findByText(
        'Distancia tiene valores de más de una fuente (Catapult, Pod). Se muestran en columnas separadas: no los compares sin tener en cuenta el método.',
      ),
    ).toBeVisible();
    const table = screen.getByRole('table', { name: 'Fuente: Catapult, Pod' });
    expect(
      within(table).getByRole('columnheader', { name: 'Distancia (m) · Catapult' }),
    ).toBeVisible();
    expect(within(table).getByRole('columnheader', { name: 'Distancia (m) · Pod' })).toBeVisible();
    // The summary of a shared metric comes from one source, and says which.
    const kpis = screen.getByRole('region', { name: 'Resumen de la sesión' });
    expect(within(kpis).getByText('5.120 m')).toBeVisible();
    expect(within(kpis).getByText('1 jugador · Catapult')).toBeVisible();
    expect(
      screen.getByRole('figure', { name: 'Distancia · Catapult por jugador (m)' }),
    ).toBeVisible();
  });

  it('says when a session has no field data yet', async () => {
    renderApp({
      path,
      handlers: {
        ...coach(),
        getClubModules: () => MODULES_ON,
        getTrainingSessionFieldMetrics: () =>
          fs.fieldSession({
            session: { ...fs.fieldSession().session, title: null },
            columns: [],
            references: [],
            players: [fs.CASTRO],
          }),
      },
    });
    expect(await screen.findByText(/Esta sesión todavía no tiene datos de cancha/)).toBeVisible();
    // Without a title of its own, the session is named by its kind, day and rival.
    expect(
      screen.getByRole('heading', { name: 'Partido del 24/10/2026 contra CASI' }),
    ).toBeVisible();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeVisible();
  });

  it('shows a forbidden session as an error and links back', async () => {
    renderApp({
      path,
      handlers: {
        ...coach(),
        getClubModules: () => MODULES_ON,
        getTrainingSessionFieldMetrics: () => apiError(403, 'forbidden'),
      },
    });
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Volver a las sesiones en cancha' })).toHaveAttribute(
      'href',
      '/field-sessions',
    );
  });
});
