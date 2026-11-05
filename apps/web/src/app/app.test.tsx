import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FakeNetworkError, apiError } from '../test/fake-api';
import * as fixtures from '../test/fixtures';
import { renderApp, signedIn, signedOut } from '../test/render-app';

const SIGNED_IN = {
  user: fixtures.USER,
  session: { expiresAt: '2026-12-01T12:00:00.000Z', token: null },
};

describe('sign-in', () => {
  it('sends a visitor to the sign-in, keeping where they were going', async () => {
    const { app } = renderApp({ path: '/?sport=rugby', handlers: signedOut() });
    expect(
      await screen.findByRole('heading', { name: 'Ingresá a Sport Performance' }),
    ).toBeVisible();
    expect(app.router.state.location.pathname).toBe('/login');
    expect(app.router.state.location.search).toEqual({ redirect: '/?sport=rugby' });
  });

  it('signs in with the email code over the cookie and lands in the club', async () => {
    const { user, api } = renderApp({
      path: '/login',
      handlers: {
        ...signedOut(),
        sendSignInCode: () => ({ expiresInS: 300 }),
        verifySignInCode: () => {
          api.use(signedIn());
          return SIGNED_IN;
        },
      },
    });
    await user.type(await screen.findByLabelText('Email'), 'santiago@example.com');
    await user.click(screen.getByRole('button', { name: 'Mandame el código' }));

    expect(
      await screen.findByText('Te mandamos un código a santiago@example.com. Revisá tu correo.'),
    ).toBeVisible();
    expect(screen.getByText('El código vence en 5 minutos y sirve una sola vez.')).toBeVisible();
    await user.type(screen.getByLabelText('Código'), '48a2913');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeVisible();
    expect(api.callsTo('sendSignInCode')[0]?.body).toEqual({ email: 'santiago@example.com' });
    expect(api.callsTo('verifySignInCode')[0]).toMatchObject({
      body: { email: 'santiago@example.com', code: '482913', transport: 'cookie' },
      credentials: 'include',
    });
    expect(api.unhandled).toEqual([]);
  });

  it('validates the email and the code before calling the API', async () => {
    const { user, api } = renderApp({
      path: '/login',
      handlers: { ...signedOut(), sendSignInCode: () => ({ expiresInS: 300 }) },
    });
    await user.type(await screen.findByLabelText('Email'), 'no-es-un-email');
    await user.click(screen.getByRole('button', { name: 'Mandame el código' }));
    expect(await screen.findByText('Ingresá un email válido.')).toBeVisible();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('sendSignInCode')).toHaveLength(0);

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Mandame el código' }));
    await user.type(await screen.findByLabelText('Código'), '123');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByText('El código tiene 6 dígitos.')).toBeVisible();
  });

  it('explains a wrong code, a burnt code and a rate limit', async () => {
    const answers = [
      apiError(401, 'unauthenticated'),
      apiError(429, 'rate_limited'),
      apiError(429, 'rate_limited', { retryAfterS: 42 }),
    ];
    const { user, api } = renderApp({
      path: '/login',
      handlers: {
        ...signedOut(),
        sendSignInCode: () => ({ expiresInS: 300 }),
        verifySignInCode: () => answers.shift() ?? apiError(500, 'internal_error'),
      },
    });
    await user.type(await screen.findByLabelText('Email'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Mandame el código' }));
    await user.type(await screen.findByLabelText('Código'), '111111');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(
      await screen.findByText('El código no es válido o ya venció. Pedí uno nuevo.'),
    ).toBeVisible();
    // A wrong code is an answer, not an expired session: the page stays.
    expect(screen.getByLabelText('Código')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(
      await screen.findByText('Probaste demasiadas veces. Pedí un código nuevo.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(
      await screen.findByText('Hiciste muchos intentos seguidos. Probá de nuevo en 42 segundos.'),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Mandame otro código' }));
    expect(
      await screen.findByText('Te mandamos un código nuevo. El anterior ya no sirve.'),
    ).toBeVisible();
    expect(api.callsTo('sendSignInCode')).toHaveLength(2);
  });

  it('shows the error envelope with the request id', async () => {
    const { user } = renderApp({
      path: '/login',
      handlers: {
        ...signedOut(),
        sendSignInCode: () => apiError(503, 'service_unavailable', { requestId: 'req-77' }),
      },
    });
    await user.type(await screen.findByLabelText('Email'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Mandame el código' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('El servicio no está disponible en este momento.');
    expect(alert).toHaveTextContent('Código para soporte: req-77');
  });

  it('skips the sign-in when there is already a session', async () => {
    const { app } = renderApp({ path: '/login?redirect=%2F', handlers: signedIn() });
    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeVisible();
    expect(app.router.state.location.pathname).toBe('/');
  });
});

describe('club selection', () => {
  it('enters the only club by itself and acts in it with X-Membership-Id', async () => {
    const coach = fixtures.membership('coach');
    const { api } = renderApp({ handlers: signedIn({ memberships: [coach] }) });
    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeVisible();
    expect(screen.getByText('Tu rol en Olivos Rugby Club: Entrenador/a')).toBeVisible();
    for (const call of [...api.callsTo('getClub'), ...api.callsTo('listCategories')]) {
      expect(call.headers['x-membership-id']).toBe(coach.id);
    }
    expect(api.callsTo('listMyStaffAssignments')[0]?.url.searchParams.get('status')).toBe(
      'current',
    );
    expect(window.localStorage.getItem('sp.web.membership')).toContain(coach.id);
  });

  it('lets a user with several clubs pick one and goes back where they were', async () => {
    const orc = fixtures.membership('sc');
    const other = fixtures.membership('admin', {
      id: '0192e7a0-1111-7000-8000-000000000002',
      clubId: fixtures.OTHER_CLUB_ID,
      clubName: 'Club Atlético',
      slug: 'cat',
    });
    const { user, api, app } = renderApp({
      path: `/?category=${fixtures.M15_RUGBY.id}`,
      handlers: signedIn({ memberships: [orc, other] }),
    });
    expect(await screen.findByRole('heading', { name: 'Elegí el club' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Club Atlético · Administrador/a' }));
    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeVisible();
    expect(app.router.state.location.search).toMatchObject({ category: fixtures.M15_RUGBY.id });
    expect(api.callsTo('getClub').at(-1)?.headers['x-membership-id']).toBe(other.id);
    // Not scoped by assignments: the admin never asks for them.
    expect(api.callsTo('listMyStaffAssignments')).toHaveLength(0);
  });

  it('forgets a remembered club the user no longer has', async () => {
    window.localStorage.setItem(
      'sp.web.membership',
      JSON.stringify({ membershipId: '0192e7a0-1111-7000-8000-0000000000aa' }),
    );
    renderApp({
      handlers: signedIn({
        memberships: [
          fixtures.membership('coach'),
          fixtures.membership('sc', { id: '0192e7a0-1111-7000-8000-000000000002' }),
        ],
      }),
    });
    expect(await screen.findByText('Ya no tenés acceso a ese club. Elegí otro.')).toBeVisible();
    expect(window.localStorage.getItem('sp.web.membership')).toBeNull();
  });

  it('sends players to the app without loading club data', async () => {
    const { api } = renderApp({
      handlers: signedIn({ memberships: [fixtures.membership('player')] }),
    });
    expect(await screen.findByRole('heading', { name: 'La web es para el staff' })).toBeVisible();
    expect(screen.getByText(/usás la app en el teléfono/)).toBeVisible();
    expect(api.callsTo('listCategories')).toHaveLength(0);
    expect(api.callsTo('listMyStaffAssignments')).toHaveLength(0);
  });

  it('tells a user without clubs how to get in', async () => {
    renderApp({ handlers: signedIn({ memberships: [] }) });
    expect(await screen.findByText(/Tu cuenta no tiene acceso a ningún club/)).toBeVisible();
  });
});

describe('support mode', () => {
  const superadmin = () => ({
    ...signedIn({ user: fixtures.SUPERADMIN, memberships: [] }),
    getMe: () => fixtures.me(fixtures.SUPERADMIN, null),
    listClubs: () => fixtures.page([fixtures.club()]),
  });

  it('asks for a reason, then acts in the club with the support headers until exit', async () => {
    const { user, api } = renderApp({ handlers: superadmin() });
    await user.click(await screen.findByRole('link', { name: 'Entrar a un club como soporte' }));
    await user.click(await screen.findByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Contá el motivo antes de buscar el club.')).toBeVisible();
    expect(api.callsTo('listClubs')).toHaveLength(0);

    await user.type(screen.getByLabelText('Motivo del acceso'), 'Ticket 12: no ve la M15');
    await user.type(screen.getByLabelText('Buscar club por nombre o sigla'), 'olivos');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await user.click(await screen.findByRole('button', { name: 'Entrar a Olivos Rugby Club' }));

    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeVisible();
    expect(api.callsTo('listClubs')[0]?.headers['x-support-reason']).toBe(
      encodeURIComponent('Ticket 12: no ve la M15'),
    );
    expect(api.callsTo('listClubs')[0]?.url.searchParams.get('q')).toBe('olivos');
    const clubCall = api.callsTo('getClub').at(-1);
    expect(clubCall?.headers['x-support-club-id']).toBe(fixtures.ORC_ID);
    expect(clubCall?.headers['x-membership-id']).toBeUndefined();
    expect(
      screen.getByText('Estás en Olivos Rugby Club como soporte. Motivo: Ticket 12: no ve la M15'),
    ).toBeVisible();
    expect(window.localStorage.getItem('sp.web.support')).toBeNull();
    expect(window.sessionStorage.getItem('sp.web.support')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Salir del modo soporte' }));
    expect(await screen.findByRole('heading', { name: 'Elegí el club' })).toBeVisible();
    expect(window.sessionStorage.getItem('sp.web.support')).toBeNull();
  });

  it('is not available to other users', async () => {
    const { app } = renderApp({ path: '/support', handlers: signedIn() });
    await waitFor(() => {
      expect(app.router.state.location.pathname).toBe('/clubs');
    });
  });
});

describe('club shell', () => {
  it('applies the club brand at runtime and shows its identity', async () => {
    renderApp({
      handlers: {
        ...signedIn(),
        getClubTheme: () =>
          fixtures.clubTheme({
            colors: {
              primary: '#1e88e5',
              onPrimary: '#ffffff',
              secondary: '#ffffff',
              onSecondary: '#050505',
            },
          }),
      },
    });
    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeVisible();
    await waitFor(() => {
      expect(document.documentElement.style.getPropertyValue('--sp-color-brand-solid')).toBe(
        '#1e88e5',
      );
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    const sidebar = screen.getByRole('navigation', { name: 'Secciones' });
    expect(within(sidebar).getByRole('link', { name: 'Inicio' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Saltar al contenido' })).toHaveAttribute(
      'href',
      '#main',
    );
    expect(document.title).toBe('Inicio · Sport Performance');
  });

  it('switches to the light high-contrast variant and remembers it', async () => {
    const { user } = renderApp({ handlers: signedIn() });
    // The colors live in the user menu of the sidebar footer.
    await user.click(await screen.findByRole('button', { name: /Tu cuenta/ }));
    const colors = screen.getByRole('radiogroup', { name: 'Colores' });
    expect(within(colors).getByRole('radio', { name: 'Automático' })).toBeChecked();
    await user.click(
      within(colors).getByRole('radio', { name: 'Claro, alto contraste (para el sol)' }),
    );
    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute('data-theme', 'light-hc');
    });
    expect(window.localStorage.getItem('sp.web.theme')).toBe('"light-hc"');
  });

  it('follows the system contrast preference by default', async () => {
    const matchMedia = vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query === '(prefers-contrast: more)',
          media: query,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        }) as unknown as MediaQueryList,
    );
    renderApp({ handlers: signedIn(), systemPrefersMoreContrast: true });
    await screen.findByRole('heading', { name: 'Inicio' });
    expect(document.documentElement).toHaveAttribute('data-theme', 'light-hc');
    matchMedia.mockRestore();
  });

  it('keeps sport and category in the URL, limited to what the user sees', async () => {
    const { user, app } = renderApp({
      handlers: signedIn({
        categories: [fixtures.M15_RUGBY, fixtures.M17_RUGBY, fixtures.F15_HOCKEY],
      }),
    });
    // Few options: segmented controls (radio groups) instead of selects.
    const sport = await screen.findByRole('radiogroup', { name: 'Deporte' });
    expect(
      within(sport)
        .getAllByRole('radio')
        .map((o) => o.closest('span')?.textContent),
    ).toEqual(['Todos los deportes', 'Rugby', 'Hockey']);
    await user.click(within(sport).getByRole('radio', { name: 'Hockey' }));
    await waitFor(() => {
      expect(app.router.state.location.search).toEqual({ sport: 'hockey' });
      expect(app.router.state.location.searchStr).toBe('?sport=hockey');
    });
    const category = screen.getByRole('radiogroup', { name: 'Categoría' });
    expect(
      within(category)
        .getAllByRole('radio')
        .map((o) => o.closest('span')?.textContent),
    ).toEqual(['Todas las categorías', 'Sub 15']);
    await user.click(within(category).getByRole('radio', { name: 'Sub 15' }));
    await waitFor(() => {
      expect(app.router.state.location.search).toEqual({
        sport: 'hockey',
        category: fixtures.F15_HOCKEY.id,
      });
    });
    expect(screen.getByText('Mirando: Hockey · Sub 15')).toBeVisible();
  });

  it('keeps a select for the category when there are many', async () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      fixtures.category(
        `0192e7a0-2222-7000-8000-0000000002${String(index).padStart(2, '0')}`,
        `M${String(13 + index)}`,
        'rugby',
        { sortOrder: index },
      ),
    );
    const { user, app } = renderApp({ handlers: signedIn({ categories: many }) });
    const select = await screen.findByRole('combobox', { name: 'Categoría' });
    expect(within(select).getAllByRole('option')).toHaveLength(8);
    await user.selectOptions(select, 'M16');
    await waitFor(() => {
      expect(app.router.state.location.search).toEqual({ category: many[3]?.id });
    });
  });

  it('opens the user menu with the account and closes it with Escape', async () => {
    const { user } = renderApp({ handlers: signedIn() });
    const account = await screen.findByRole('button', { name: /Tu cuenta/ });
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Cerrar sesión', hidden: true })).not.toBeVisible();
    await user.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(account).toHaveFocus();
  });

  it('moves the focus into the drawer, makes the page inert and gives the focus back', async () => {
    const { user } = renderApp({ handlers: signedIn() });
    const menu = await screen.findByRole('button', { name: 'Abrir el menú' });
    const page = screen.getByRole('main').parentElement;
    expect(menu).toHaveAttribute('aria-expanded', 'false');

    await user.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    const close = screen.getByRole('button', { name: 'Cerrar el menú', hidden: true });
    expect(close).toHaveFocus();
    expect(page).toHaveAttribute('inert');

    await user.keyboard('{Escape}');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(page).not.toHaveAttribute('inert');
    expect(menu).toHaveFocus();

    // Escape in the user menu closes only the user menu; the drawer stays open.
    await user.click(menu);
    const account = screen.getByRole('button', { name: /Tu cuenta/, hidden: true });
    await user.click(account);
    expect(account).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(account).toHaveAttribute('aria-expanded', 'false');
    expect(account).toHaveFocus();
    expect(menu).toHaveAttribute('aria-expanded', 'true');

    await user.click(close);
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveFocus();
  });

  it('ignores a shared link to a category the user does not see, and says so', async () => {
    const { app } = renderApp({
      path: `/?category=${fixtures.M17_RUGBY.id}`,
      handlers: signedIn({ categories: [fixtures.M15_RUGBY] }),
    });
    expect(
      await screen.findByText(
        'El link pedía un deporte o una categoría que no ves: te mostramos lo que sí ves.',
      ),
    ).toBeVisible();
    await waitFor(() => {
      expect(app.router.state.location.search).toEqual({});
    });
    // Only rugby: no sport selector, the category one stays.
    expect(screen.queryByRole('radiogroup', { name: 'Deporte' })).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Categoría' })).toBeVisible();
  });

  it('counts the assigned categories of a coach', async () => {
    renderApp({
      handlers: signedIn({ categories: [fixtures.M15_RUGBY], assignedTo: [fixtures.M15_RUGBY] }),
    });
    expect(await screen.findByText('1 categoría asignada.')).toBeVisible();
  });

  it('signs out and forgets the club', async () => {
    const { user, api } = renderApp({ handlers: signedIn() });
    await screen.findByRole('heading', { name: 'Inicio' });
    api.use(signedOut());
    await user.click(screen.getByRole('button', { name: /Tu cuenta/ }));
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(
      await screen.findByRole('heading', { name: 'Ingresá a Sport Performance' }),
    ).toBeVisible();
    expect(api.callsTo('signOut')).toHaveLength(1);
    expect(window.localStorage.getItem('sp.web.membership')).toBeNull();
  });

  it('keeps the user signed in when the sign-out cannot reach the API', async () => {
    const { user, api } = renderApp({ handlers: signedIn() });
    await screen.findByRole('heading', { name: 'Inicio' });
    api.use({
      signOut: () => {
        throw new FakeNetworkError();
      },
    });
    await user.click(screen.getByRole('button', { name: /Tu cuenta/ }));
    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(
      await screen.findByText('No hay conexión. Revisá la señal y probá de nuevo.'),
    ).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  });

  it('goes back to the sign-in when the session expires mid-use', async () => {
    const { app, api } = renderApp({ handlers: signedIn() });
    await screen.findByRole('heading', { name: 'Inicio' });
    api.use({
      getClub: () => apiError(401, 'unauthenticated'),
      getMe: () => apiError(401, 'unauthenticated'),
    });
    await app.services.queryClient.refetchQueries({ queryKey: ['club'] });
    expect(await screen.findByText('Tu sesión venció. Volvé a ingresar.')).toBeVisible();
    expect(app.router.state.location.pathname).toBe('/login');
    expect(app.router.state.location.search).toMatchObject({ expired: true, redirect: '/' });
  });
});

describe('connection status', () => {
  it('shows online, offline and the time of the last answer, with icon and text', async () => {
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get');
    renderApp({ handlers: signedIn() });
    const status = await screen.findByRole('status', { name: 'Estado de la conexión' });
    expect(within(status).getByText('En línea')).toBeVisible();
    expect(within(status).getByText(/^Actualizado a las \d{2}:\d{2}$/)).toBeVisible();
    expect(status.querySelector('[data-icon="ok"]')).not.toBeNull();

    onLine.mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    expect(await within(status).findByText('Sin conexión')).toBeVisible();
    expect(within(status).getByText(/Lo que guardes queda en espera/)).toBeVisible();
    onLine.mockRestore();
  });

  it('counts the changes waiting for the connection and sends them when it is back', async () => {
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    const { app } = renderApp({ handlers: signedIn() });
    await screen.findByRole('heading', { name: 'Inicio' });
    window.dispatchEvent(new Event('offline'));
    const sent = vi.fn(() => Promise.resolve());
    const { queryClient } = app.services;
    const done = queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: sent })
      .execute(undefined);
    expect(await screen.findByText('1 cambio sin enviar')).toBeVisible();
    expect(sent).not.toHaveBeenCalled();

    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await done;
    expect(sent).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByText('1 cambio sin enviar')).toBeNull();
    });
    onLine.mockRestore();
  });

  it('says when the API does not answer', async () => {
    const { app, api } = renderApp({ handlers: signedIn() });
    await screen.findByRole('heading', { name: 'Inicio' });
    const down = () => {
      throw new FakeNetworkError();
    };
    api.use({ getClub: down, listCategories: down, listMyStaffAssignments: down });
    await app.services.queryClient.refetchQueries({ queryKey: ['club'] }).catch(() => undefined);
    expect(await screen.findByText('No llegamos al servidor. Reintentando…')).toBeVisible();
  });

  it('asks to reload a tab older than the deployed API', async () => {
    const { app, api } = renderApp({ handlers: signedIn() });
    await screen.findByRole('heading', { name: 'Inicio' });
    expect(screen.queryByText('Hay una versión nueva de la web')).toBeNull();
    api.setContractVersion('9.0.0');
    await app.services.queryClient.refetchQueries({ queryKey: ['club'] });
    expect(await screen.findByText('Hay una versión nueva de la web')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Recargar' })).toBeVisible();
  });
});

describe('routing', () => {
  it('has a page for unknown routes', async () => {
    renderApp({ path: '/no-existe', handlers: signedIn() });
    expect(await screen.findByRole('heading', { name: 'Esta página no existe' })).toBeVisible();
  });

  it('shows the error envelope when the club cannot be loaded, with retry', async () => {
    let fail = true;
    const { user } = renderApp({
      handlers: {
        ...signedIn(),
        getClub: () =>
          fail ? apiError(500, 'internal_error', { requestId: 'req-9' }) : fixtures.club(),
      },
    });
    expect(await screen.findByRole('heading', { name: 'No pudimos cargar esto' })).toBeVisible();
    expect(screen.getByText('Código para soporte: req-9')).toBeVisible();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeVisible();
  });
});
