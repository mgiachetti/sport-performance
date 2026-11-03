import type {
  ClubBranch,
  ClubModuleSettings,
  Invitation,
  SupportAccessEntry,
} from '@sport-performance/contracts';
import { parseClubId, parseTimeZone, parseUuid } from '@sport-performance/domain';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, reply, type FakeHandlers } from '../test/fake-api';
import * as fixtures from '../test/fixtures';
import { renderApp, signedIn } from '../test/render-app';
import { slugFromName } from './NewClubPage';

const AT = '2026-11-01T12:00:00.000Z';
const VERSION = '1793586338688123';
const REASON = 'Alta pedida por la comisión directiva';
const NEW_CLUB_ID = parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e20');

function branch(sport: 'rugby' | 'hockey', sex: 'male' | 'female', archived = false): ClubBranch {
  return {
    id: parseUuid(
      sport === 'rugby'
        ? '0192e7a0-4444-7000-8000-000000000001'
        : '0192e7a0-4444-7000-8000-000000000002',
    ),
    sport,
    sex,
    archivedAt: archived ? AT : null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
  };
}

const MODULES: ClubModuleSettings = {
  modules: {
    wellness: true,
    gym: true,
    gps: false,
    maturation: true,
    pain_report: false,
    menstrual_cycle: false,
  },
  version: VERSION,
};

function invitation(email: string): Invitation {
  return {
    id: parseUuid('0192e7a0-6666-7000-8000-000000000001'),
    email,
    role: 'admin',
    categoryIds: [],
    playerId: null,
    relationship: null,
    status: 'pending',
    expiresAt: '2026-11-08T12:00:00.000Z',
    createdAt: AT,
    acceptedAt: null,
    revokedAt: null,
  };
}

function entry(overrides: Partial<SupportAccessEntry> = {}): SupportAccessEntry {
  return {
    id: '0192e7a0-7777-7000-8000-000000000001',
    startedAt: '2026-11-01T21:30:00.000Z',
    operator: { userId: fixtures.SUPERADMIN.id, name: 'Soporte', email: 'soporte@example.com' },
    club: {
      id: fixtures.ORC_ID,
      name: 'Olivos Rugby Club',
      slug: 'orc',
      timeZone: parseTimeZone('America/Argentina/Buenos_Aires'),
    },
    reason: 'Ticket 12: no ve la M15',
    requestId: 'req-12',
    ...overrides,
  };
}

/** A superadmin without memberships, and the registry and one club (ORC). */
function superadmin(extra: FakeHandlers = {}): FakeHandlers {
  return {
    ...signedIn({ user: fixtures.SUPERADMIN, memberships: [] }),
    getMe: () => fixtures.me(fixtures.SUPERADMIN, null),
    listClubs: () => fixtures.page([fixtures.club()]),
    listClubBranches: () => fixtures.page([branch('rugby', 'male'), branch('hockey', 'female')]),
    getClubModules: () => MODULES,
    listInvitations: () => fixtures.page([]),
    listSupportAccess: () => fixtures.page([entry()]),
    ...extra,
  };
}

/** Starts the console with the reason already stated in this tab. */
function withReason() {
  window.sessionStorage.setItem('sp.web.console', JSON.stringify(REASON));
}

describe('superadmin console: access and reason', () => {
  it('is reachable from the club selector and asks for a reason before any request', async () => {
    const { user, api, app } = renderApp({ path: '/clubs', handlers: superadmin() });
    await user.click(await screen.findByRole('link', { name: 'Abrir la consola de superadmin' }));
    expect(await screen.findByRole('heading', { name: 'Consola de superadmin' })).toBeVisible();
    expect(api.callsTo('listClubs')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Empezar' }));
    expect(screen.getByText('Contá el motivo antes de seguir.')).toBeVisible();

    await user.type(screen.getByLabelText('Motivo'), `  ${REASON}  `);
    await user.click(screen.getByRole('button', { name: 'Empezar' }));
    expect(await screen.findByRole('link', { name: 'Olivos Rugby Club' })).toBeVisible();
    expect(app.router.state.location.pathname).toBe('/console/clubs');
    expect(screen.getByText(`Motivo registrado: ${REASON}`)).toBeVisible();
    const call = api.callsTo('listClubs')[0];
    expect(call?.headers['x-support-reason']).toBe(encodeURIComponent(REASON));
    expect(call?.headers['x-membership-id']).toBeUndefined();
    expect(call?.headers['x-support-club-id']).toBeUndefined();
    // Only this tab remembers it.
    expect(window.sessionStorage.getItem('sp.web.console')).toBe(JSON.stringify(REASON));
    expect(window.localStorage.getItem('sp.web.console')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cambiar el motivo' }));
    expect(await screen.findByLabelText('Motivo')).toHaveValue('');
    expect(window.sessionStorage.getItem('sp.web.console')).toBeNull();
  });

  it('never sends the membership of the club picked elsewhere', async () => {
    withReason();
    const member = fixtures.membership('admin');
    window.localStorage.setItem('sp.web.membership', JSON.stringify({ membershipId: member.id }));
    const { api } = renderApp({
      path: '/console/clubs',
      handlers: superadmin({
        ...signedIn({ user: fixtures.SUPERADMIN, memberships: [member] }),
        listClubs: () => fixtures.page([fixtures.club()]),
      }),
    });
    expect(await screen.findByRole('link', { name: 'Olivos Rugby Club' })).toBeVisible();
    expect(api.callsTo('listClubs')[0]?.headers['x-membership-id']).toBeUndefined();
  });

  it('is not available to other users', async () => {
    const { app } = renderApp({ path: '/console/clubs', handlers: signedIn() });
    await waitFor(() => {
      expect(app.router.state.location.pathname).toBe('/clubs');
    });
  });
});

describe('superadmin console: registry and onboarding', () => {
  it('searches the registry and loads more pages by cursor', async () => {
    withReason();
    const other = fixtures.club({
      id: fixtures.OTHER_CLUB_ID,
      slug: 'casi',
      name: 'Club Atlético San Isidro',
      shortName: 'CASI',
    });
    const { user, api } = renderApp({
      path: '/console/clubs',
      handlers: superadmin({
        listClubs: (request) =>
          request.url.searchParams.get('cursor') === null
            ? { items: [fixtures.club()], nextCursor: 'next-page' }
            : fixtures.page([other]),
      }),
    });
    expect(await screen.findByRole('link', { name: 'Olivos Rugby Club' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect(await screen.findByRole('link', { name: 'Club Atlético San Isidro' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();

    await user.type(screen.getByLabelText('Buscar por nombre o slug'), 'casi');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => {
      expect(api.callsTo('listClubs').at(-1)?.url.searchParams.get('q')).toBe('casi');
    });
  });

  it('suggests the slug from the name', () => {
    expect(slugFromName('Club Atlético San Isidro')).toBe('club-atletico-san-isidro');
    expect(slugFromName('  Ñandú  R.C. ')).toBe('nandu-r-c');
  });

  it('validates with the contract, creates the club with its branches and opens it', async () => {
    withReason();
    const created = fixtures.club({
      id: NEW_CLUB_ID,
      slug: 'club-atletico-san-isidro',
      name: 'Club Atlético San Isidro',
      shortName: 'CASI',
    });
    const { user, api, app } = renderApp({
      path: '/console/clubs/new',
      handlers: superadmin({
        createClub: () => ({ club: created, branches: [branch('rugby', 'male')] }),
        getClub: () => created,
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Dar de alta' }));
    expect(screen.getByText('Hay datos para revisar.')).toBeVisible();
    expect(screen.getByText('Elegí al menos un deporte y rama.')).toBeVisible();
    expect(api.callsTo('createClub')).toHaveLength(0);

    await user.type(screen.getByLabelText('Nombre completo'), 'Club Atlético San Isidro');
    expect(screen.getByLabelText('Slug')).toHaveValue('club-atletico-san-isidro');
    await user.type(screen.getByLabelText('Sigla'), 'CASI');
    await user.click(screen.getByRole('checkbox', { name: 'Rugby Masculino' }));
    await user.click(screen.getByRole('button', { name: 'Dar de alta' }));

    expect(await screen.findByRole('heading', { name: 'Club Atlético San Isidro' })).toBeVisible();
    expect(app.router.state.location.pathname).toBe(`/console/clubs/${NEW_CLUB_ID}`);
    const call = api.callsTo('createClub')[0];
    expect(call?.headers['x-support-reason']).toBe(encodeURIComponent(REASON));
    expect(call?.body).toMatchObject({
      slug: 'club-atletico-san-isidro',
      name: 'Club Atlético San Isidro',
      shortName: 'CASI',
      timeZone: 'America/Argentina/Buenos_Aires',
      locale: 'es-AR',
      branches: [{ sport: 'rugby', sex: 'male' }],
    });
    expect(call?.body).not.toHaveProperty('colors');
    expect((call?.body as { clientUuid?: string }).clientUuid).toMatch(/^[0-9a-f-]{36}$/);
    // The detail of the new club acts in it as support.
    expect(api.callsTo('getClub').at(-1)?.headers['x-support-club-id']).toBe(NEW_CLUB_ID);
  });

  it('marks a taken slug on its field and retries with the same clientUuid', async () => {
    withReason();
    const { user, api } = renderApp({
      path: '/console/clubs/new',
      handlers: superadmin({ createClub: () => apiError(409, 'conflict') }),
    });
    await user.type(await screen.findByLabelText('Nombre completo'), 'Olivos');
    await user.type(screen.getByLabelText('Sigla'), 'ORC');
    await user.click(screen.getByRole('checkbox', { name: 'Hockey Femenino' }));
    await user.click(screen.getByRole('button', { name: 'Dar de alta' }));
    expect(await screen.findByText('Ese slug ya lo usa otro club.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Dar de alta' }));
    await waitFor(() => {
      expect(api.callsTo('createClub')).toHaveLength(2);
    });
    const [first, second] = api
      .callsTo('createClub')
      .map((call) => (call.body as { clientUuid: string }).clientUuid);
    expect(second).toBe(first);
  });
});

describe('superadmin console: a club', () => {
  const path = `/console/clubs/${fixtures.ORC_ID}`;

  it('shows the profile and branches, every request as support of that club', async () => {
    withReason();
    const { api } = renderApp({ path, handlers: superadmin() });
    expect(await screen.findByRole('heading', { name: 'Olivos Rugby Club' })).toBeVisible();
    const branches = await screen.findByRole('table', { name: 'Ramas del club' });
    expect(within(branches).getByRole('rowheader', { name: 'Rugby Masculino' })).toBeVisible();
    expect(within(branches).getAllByText('Activa')).toHaveLength(2);
    for (const operation of [
      'getClub',
      'listClubBranches',
      'getClubModules',
      'listInvitations',
    ] as const) {
      const call = api.callsTo(operation).at(-1);
      expect(call?.headers['x-support-club-id'], operation).toBe(fixtures.ORC_ID);
      expect(call?.headers['x-support-reason'], operation).toBe(encodeURIComponent(REASON));
    }
  });

  it('archives a branch and enables a missing one', async () => {
    withReason();
    const { user, api } = renderApp({
      path,
      handlers: superadmin({
        listClubBranches: () => fixtures.page([branch('rugby', 'male')]),
        archiveClubBranch: () => branch('rugby', 'male', true),
        enableClubBranch: () => branch('hockey', 'female'),
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Archivar Rugby Masculino' }));
    await waitFor(() => {
      expect(api.callsTo('archiveClubBranch')).toHaveLength(1);
    });
    await user.selectOptions(screen.getByLabelText('Habilitar otra rama'), 'hockey:female');
    await user.click(screen.getByRole('button', { name: 'Habilitar' }));
    await waitFor(() => {
      expect(api.callsTo('enableClubBranch')[0]?.body).toMatchObject({
        sport: 'hockey',
        sex: 'female',
      });
    });
  });

  it('saves only the modules that changed, with the version', async () => {
    withReason();
    const { user, api } = renderApp({
      path,
      handlers: superadmin({
        updateClubModules: () => ({ ...MODULES, modules: { ...MODULES.modules, gps: true } }),
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Guardar módulos' }));
    expect(screen.getByText('No cambiaste ningún módulo.')).toBeVisible();
    expect(api.callsTo('updateClubModules')).toHaveLength(0);

    await user.click(screen.getByRole('checkbox', { name: /Métricas de cancha por GPS/ }));
    await user.click(screen.getByRole('button', { name: 'Guardar módulos' }));
    expect(await screen.findByText('Módulos guardados.')).toBeVisible();
    const call = api.callsTo('updateClubModules')[0];
    expect(call?.body).toEqual({ version: VERSION, modules: { gps: true } });
    expect(call?.headers['x-support-club-id']).toBe(fixtures.ORC_ID);
    expect(screen.getByRole('checkbox', { name: /Métricas de cancha por GPS/ })).toBeChecked();
  });

  it('on a version conflict reloads the modules and says so', async () => {
    withReason();
    const { user, api } = renderApp({
      path,
      handlers: superadmin({ updateClubModules: () => apiError(409, 'conflict') }),
    });
    await user.click(await screen.findByRole('checkbox', { name: /Gimnasio/ }));
    await user.click(screen.getByRole('button', { name: 'Guardar módulos' }));
    expect(
      await screen.findByText(
        'Alguien cambió el club mientras editabas. Cargamos lo último: revisá y guardá de nuevo.',
      ),
    ).toBeVisible();
    await waitFor(() => {
      expect(api.callsTo('getClubModules').length).toBeGreaterThan(1);
    });
    expect(screen.getByRole('checkbox', { name: /Gimnasio/ })).toBeChecked();
  });

  it('invites the first admin and revokes a pending invitation', async () => {
    withReason();
    let pending: Invitation[] = [];
    const { user, api } = renderApp({
      path,
      handlers: superadmin({
        listInvitations: () => fixtures.page(pending),
        createInvitation: (request) => {
          const email = (request.body as { email: string }).email;
          pending = [invitation(email)];
          return reply(201, {
            invitation: invitation(email),
            links: { app: 'sportperformance://invite/x', web: 'https://app.example.com/invite/x' },
          });
        },
        revokeInvitation: () => {
          pending = [];
          return reply(204);
        },
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Invitar como administrador/a' }));
    expect(screen.getByText('Revisá este dato.')).toBeVisible();
    await user.type(screen.getByLabelText('Email'), 'presidencia@casi.example.com');
    await user.click(screen.getByRole('button', { name: 'Invitar como administrador/a' }));
    expect(
      await screen.findByText('Le mandamos la invitación a presidencia@casi.example.com.'),
    ).toBeVisible();
    const call = api.callsTo('createInvitation')[0];
    expect(call?.body).toMatchObject({ email: 'presidencia@casi.example.com', role: 'admin' });
    expect(call?.headers['x-support-club-id']).toBe(fixtures.ORC_ID);

    await user.click(
      await screen.findByRole('button', {
        name: 'Anular la invitación de presidencia@casi.example.com',
      }),
    );
    expect(await screen.findByText('No hay invitaciones pendientes.')).toBeVisible();
  });

  it('enters the club in support mode with the same reason', async () => {
    withReason();
    const { user, api } = renderApp({ path, handlers: superadmin() });
    await user.click(
      await screen.findByRole('button', { name: 'Entrar a Olivos Rugby Club como soporte' }),
    );
    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeVisible();
    expect(
      screen.getByText(`Estás en Olivos Rugby Club como soporte. Motivo: ${REASON}`),
    ).toBeVisible();
    expect(api.callsTo('getClub').at(-1)?.headers['x-support-reason']).toBe(
      encodeURIComponent(REASON),
    );
  });

  it('a malformed club id is not found', async () => {
    withReason();
    renderApp({ path: '/console/clubs/not-a-uuid', handlers: superadmin() });
    expect(await screen.findByRole('heading', { name: 'Esta página no existe' })).toBeVisible();
  });
});

describe('support access log', () => {
  it('the console lists every access with where, who and why, in the club time', async () => {
    withReason();
    const { api } = renderApp({
      path: '/console/support-access',
      handlers: superadmin({
        listSupportAccess: () =>
          fixtures.page([
            entry(),
            entry({
              id: '0192e7a0-7777-7000-8000-000000000002',
              club: null,
              reason: 'Alta de club',
              operator: { userId: fixtures.SUPERADMIN.id, name: null, email: null },
            }),
          ]),
      }),
    });
    const table = await screen.findByRole('table', {
      name: 'Accesos de soporte, los más nuevos primero',
    });
    const [, first, second] = within(table).getAllByRole('row');
    if (first === undefined || second === undefined) throw new Error('two entries expected');
    expect(within(first).getByText('01/11/2026 18:30')).toBeVisible();
    expect(within(first).getByText('Olivos Rugby Club')).toBeVisible();
    expect(within(first).getByText('Ticket 12: no ve la M15')).toBeVisible();
    expect(within(second).getByText('Registro de clubes')).toBeVisible();
    expect(within(second).getByText('Cuenta eliminada')).toBeVisible();
    expect(api.callsTo('listSupportAccess')[0]?.headers['x-support-reason']).toBe(
      encodeURIComponent(REASON),
    );
  });

  it('filters the console log by club (from a club) and by days in the club zone', async () => {
    withReason();
    const { user, api } = renderApp({
      path: `/console/support-access?clubId=${fixtures.ORC_ID}`,
      handlers: superadmin(),
    });
    expect(await screen.findByText('Solo Olivos Rugby Club')).toBeVisible();
    expect(api.callsTo('listSupportAccess')[0]?.url.searchParams.get('clubId')).toBe(
      fixtures.ORC_ID,
    );
    await user.type(screen.getByLabelText('Desde'), '2026-11-02');
    await user.type(screen.getByLabelText('Hasta'), '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    expect(
      screen.getByText('La fecha "desde" tiene que ser anterior o igual a "hasta".'),
    ).toBeVisible();
    await user.clear(screen.getByLabelText('Hasta'));
    await user.type(screen.getByLabelText('Hasta'), '2026-11-03');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));
    await waitFor(() => {
      const params = api.callsTo('listSupportAccess').at(-1)?.url.searchParams;
      // Buenos Aires is UTC−3: the club's days start at 03:00 UTC.
      expect(params?.get('from')).toBe('2026-11-02T03:00:00.000Z');
      expect(params?.get('to')).toBe('2026-11-04T03:00:00.000Z');
      expect(params?.get('clubId')).toBe(fixtures.ORC_ID);
    });
  });

  it('the administration of a club sees who supported it, from its navigation', async () => {
    const { user, api } = renderApp({
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('admin')] }),
        listClubSupportAccess: () => fixtures.page([entry()]),
      },
    });
    await user.click(await screen.findByRole('link', { name: 'Accesos de soporte' }));
    expect(
      await screen.findByText(
        'Quién del soporte de la plataforma entró a Olivos Rugby Club, cuándo y por qué. El registro no se puede editar ni borrar.',
      ),
    ).toBeVisible();
    expect(await screen.findByText('Ticket 12: no ve la M15')).toBeVisible();
    expect(api.callsTo('listClubSupportAccess')[0]?.headers['x-membership-id']).toBe(
      fixtures.membership('admin').id,
    );
  });

  it('the rest of the staff does not get the entry nor the data', async () => {
    const { api } = renderApp({
      path: '/support-access',
      handlers: signedIn({ memberships: [fixtures.membership('coach')] }),
    });
    expect(await screen.findByText('No tenés permiso para ver esto.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Accesos de soporte' })).toBeNull();
    expect(api.callsTo('listClubSupportAccess')).toHaveLength(0);
  });
});
