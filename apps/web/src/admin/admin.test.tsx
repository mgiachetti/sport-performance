import { localDateInTimeZone, parseTimeZone, parseUuid } from '@sport-performance/domain';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as admin from '../test/admin-fixtures';
import { position } from '../test/configuration-fixtures';
import { apiError, type FakeHandlers } from '../test/fake-api';
import * as fixtures from '../test/fixtures';
import { renderApp, signedIn } from '../test/render-app';

const ADMIN = fixtures.membership('admin');
const HOOKER = position('hooker', 'forwards', 1);
const WING = position('wing', 'backs', 8);
const GOALKEEPER = { ...position('goalkeeper', 'goalkeepers', 0), sport: 'hockey' as const };
const SWEEPER = {
  ...position('sweeper', 'defenders', 4),
  sport: 'hockey' as const,
  label: 'Líbero',
  archivedAt: '2026-11-02T12:00:00.000Z',
};

function asAdmin(handlers: FakeHandlers = {}): FakeHandlers {
  return {
    ...signedIn({ memberships: [ADMIN] }),
    listClubBranches: () => fixtures.page([admin.RUGBY_MALE]),
    listCategories: () => fixtures.page([fixtures.M15_RUGBY, fixtures.M17_RUGBY]),
    listPositions: () => fixtures.page([HOOKER, WING]),
    ...handlers,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('administration: access', () => {
  it('is in the navigation for the administration and opens its first section', async () => {
    const { user, app } = renderApp({
      path: '/',
      handlers: asAdmin({ listMembers: () => fixtures.page([admin.ownAdminMember()]) }),
    });
    await user.click(await screen.findByRole('link', { name: 'Administración' }));
    expect(
      await screen.findByRole('heading', { name: 'Usuarios y roles', level: 2 }),
    ).toBeVisible();
    expect(app.router.state.location.pathname).toBe('/admin/members');
    const tabs = screen.getByRole('navigation', { name: 'Secciones de la administración' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([
      'Usuarios y roles',
      'Invitaciones',
      'Asignaciones',
      'Marca del club',
      'Categorías',
      'Temporadas',
      'Importar padrón',
    ]);
    expect(within(tabs).getByRole('link', { name: 'Usuarios y roles' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('is not for the staff that sees through assignments', async () => {
    const { api } = renderApp({
      path: '/admin/members',
      handlers: signedIn({ memberships: [fixtures.membership('sc')] }),
    });
    expect(await screen.findByText('No tenés permiso para ver esto.')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Administración' })).not.toBeInTheDocument();
    expect(api.callsTo('listMembers')).toHaveLength(0);
  });
});

describe('administration: users and roles', () => {
  it('lists members, filters them and changes the role of a staff member', async () => {
    const coach = admin.member('coach', { name: 'Pablo Gómez', email: 'pablo@example.com' });
    const { user, api } = renderApp({
      path: '/admin/members',
      handlers: asAdmin({
        listMembers: () => fixtures.page([admin.ownAdminMember(), coach]),
        changeMemberRole: () => admin.member('sc', { name: 'Pablo Gómez' }),
      }),
    });
    const findRow = async () => {
      const found = (await screen.findByText('Pablo Gómez')).closest('tr');
      if (found === null) throw new Error('no row');
      return found;
    };
    let row = await findRow();
    expect(within(row).getByRole('cell', { name: 'Entrenador/a' })).toBeVisible();
    expect(within(row).getByText('Vigente')).toBeVisible();

    // The own membership offers no actions.
    const own = screen.getByText('Sos vos').closest('tr');
    if (own === null) throw new Error('no own row');
    expect(within(own).queryByRole('button')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Rol', { selector: 'select' }), 'coach');
    await waitFor(() => {
      expect(api.callsTo('listMembers').at(-1)?.url.searchParams.get('role')).toBe('coach');
    });
    expect(api.callsTo('listMembers').at(-1)?.url.searchParams.get('status')).toBe('active');
    row = await findRow();

    await user.selectOptions(within(row).getByLabelText('Nuevo rol de Pablo Gómez'), 'sc');
    await user.click(within(row).getByRole('button', { name: 'Cambiar rol' }));
    expect(
      within(row).getByText(/Va a pasar a Preparador\/a físico\/a\. Se cierran sus asignaciones/),
    ).toBeVisible();
    const [confirmRole] = within(row).getAllByRole('button', { name: 'Cambiar rol' });
    if (confirmRole === undefined) throw new Error('no confirm');
    await user.click(confirmRole);
    await waitFor(() => {
      expect(api.callsTo('changeMemberRole')).toHaveLength(1);
    });
    expect(api.callsTo('changeMemberRole')[0]).toMatchObject({
      params: { membershipId: coach.id },
      body: { version: coach.version, role: 'sc' },
    });
    expect(api.unhandled).toEqual([]);
  });

  it('ends a membership after confirming and explains the last-admin conflict', async () => {
    const other = admin.member('admin', { name: 'Marta Ruiz' });
    const { user, api } = renderApp({
      path: '/admin/members',
      handlers: asAdmin({
        listMembers: () => fixtures.page([other]),
        endMember: () => apiError(409, 'conflict'),
      }),
    });
    const row = (await screen.findByText('Marta Ruiz')).closest('tr');
    if (row === null) throw new Error('no row');
    await user.click(within(row).getByRole('button', { name: 'Dar de baja' }));
    expect(within(row).getByText(/Deja de tener acceso al club desde ahora/)).toBeVisible();
    await user.click(within(row).getByRole('button', { name: 'Dar de baja' }));
    expect(
      await within(row).findByText(/el club no puede quedarse sin una persona administradora/),
    ).toBeVisible();
    expect(api.callsTo('endMember')[0]?.params).toEqual({ membershipId: other.id });
  });

  it('shows the error envelope with its request id', async () => {
    renderApp({
      path: '/admin/members',
      handlers: asAdmin({
        listMembers: () => apiError(500, 'internal_error', { requestId: 'req-42' }),
      }),
    });
    expect(await screen.findByText('Código para soporte: req-42')).toBeVisible();
  });
});

describe('administration: invitations', () => {
  it('validates, invites a coach to categories and shows the link once', async () => {
    const { user, api } = renderApp({
      path: '/admin/invitations',
      handlers: asAdmin({
        listInvitations: () => fixtures.page([]),
        createInvitation: (request) => ({
          invitation: admin.invitation({
            email: (request.body as { email: string }).email,
            categoryIds: [fixtures.M15_RUGBY.id],
          }),
          links: {
            app: 'sportperformance://invite/abc',
            web: 'https://app.example.com/invite/abc',
          },
        }),
      }),
    });
    await user.click(await screen.findByRole('button', { name: 'Enviar invitación' }));
    expect(screen.getByText('Este dato es obligatorio.')).toBeVisible();
    await user.type(screen.getByLabelText('Email'), 'no-es-email');
    await user.click(screen.getByRole('button', { name: 'Enviar invitación' }));
    expect(screen.getByText(/Ingresá un email válido/)).toBeVisible();
    expect(api.callsTo('createInvitation')).toHaveLength(0);

    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'pablo@example.com');
    await user.click(await screen.findByRole('checkbox', { name: /M15 · Rugby/ }));
    await user.click(screen.getByRole('button', { name: 'Enviar invitación' }));

    expect(await screen.findByText('Le mandamos la invitación a pablo@example.com.')).toBeVisible();
    expect(screen.getByText('https://app.example.com/invite/abc')).toBeVisible();
    expect(api.callsTo('createInvitation')[0]?.body).toEqual({
      email: 'pablo@example.com',
      role: 'coach',
      categoryIds: [fixtures.M15_RUGBY.id],
      expiresInDays: 7,
    });
    // The list is read again.
    expect(api.callsTo('listInvitations').length).toBeGreaterThan(1);
  });

  it('lists invitations with their status and revokes a pending one', async () => {
    const pending = admin.invitation({ email: 'ana@example.com' });
    const { user, api } = renderApp({
      path: '/admin/invitations',
      handlers: asAdmin({
        listInvitations: () => fixtures.page([pending]),
        revokeInvitation: () => undefined,
      }),
    });
    const row = (await screen.findByText('ana@example.com')).closest('tr');
    if (row === null) throw new Error('no row');
    expect(within(row).getByText('Pendiente')).toBeVisible();
    expect(api.callsTo('listInvitations')[0]?.url.searchParams.get('status')).toBe('pending');
    await user.click(within(row).getByRole('button', { name: 'Anular' }));
    await user.click(within(row).getByRole('button', { name: 'Anular' }));
    await waitFor(() => {
      expect(api.callsTo('revokeInvitation')[0]?.params).toEqual({ invitationId: pending.id });
    });
  });
});

describe('administration: staff assignments', () => {
  it('assigns a staff member to a category from today in the club, and ends one', async () => {
    const coach = admin.member('coach', { name: 'Pablo Gómez' });
    const existing = admin.assignment();
    const { user, api } = renderApp({
      path: '/admin/assignments',
      handlers: asAdmin({
        listMembers: (request) =>
          fixtures.page(request.url.searchParams.get('role') === 'coach' ? [coach] : []),
        listStaffAssignments: () => fixtures.page([existing]),
        createStaffAssignment: () => admin.assignment(),
        endStaffAssignment: () => ({ ...existing, status: 'ended' as const }),
      }),
    });
    const row = (await screen.findByText('M15 · Rugby')).closest('tr');
    if (row === null) throw new Error('no row');
    expect(within(row).getByText('Vigente')).toBeVisible();
    expect(within(row).getByText('Desde el 01/03/2026')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Asignar' }));
    expect(screen.getAllByText('Este dato es obligatorio.')).toHaveLength(2);
    await screen.findByRole('option', { name: /Pablo Gómez/ });
    await user.selectOptions(screen.getByLabelText('Persona', { selector: 'select' }), coach.id);
    await user.selectOptions(
      screen.getByLabelText('Qué ve', { selector: 'select' }),
      `category:${fixtures.M17_RUGBY.id}`,
    );
    await user.click(screen.getByRole('button', { name: 'Asignar' }));
    expect(await screen.findByText('Listo: la asignación quedó creada.')).toBeVisible();
    const today = localDateInTimeZone(new Date(), parseTimeZone('America/Argentina/Buenos_Aires'));
    expect(api.callsTo('createStaffAssignment')[0]?.body).toEqual({
      clientUuid: expect.any(String) as string,
      membershipId: coach.id,
      target: { kind: 'category', categoryId: fixtures.M17_RUGBY.id },
      validFrom: today,
    });

    await user.click(within(row).getByRole('button', { name: 'Terminar' }));
    expect(within(row).getByText(/Deja de valer hoy/)).toBeVisible();
    await user.click(within(row).getByRole('button', { name: 'Terminar' }));
    await waitFor(() => {
      expect(api.callsTo('endStaffAssignment')).toHaveLength(1);
    });
  });

  it('offers a whole sport and checks the end is after the start', async () => {
    const medical = admin.member('medical', { name: 'Dra. Paz' });
    const { user, api } = renderApp({
      path: '/admin/assignments',
      handlers: asAdmin({
        listMembers: (request) =>
          fixtures.page(request.url.searchParams.get('role') === 'medical' ? [medical] : []),
        listStaffAssignments: () => fixtures.page([]),
      }),
    });
    await screen.findByRole('option', { name: /Dra\. Paz/ });
    await user.selectOptions(screen.getByLabelText('Persona', { selector: 'select' }), medical.id);
    await user.selectOptions(
      screen.getByLabelText('Qué ve', { selector: 'select' }),
      'sport:rugby',
    );
    const from = screen.getByLabelText('Desde');
    await user.clear(from);
    await user.type(from, '2027-03-01');
    await user.type(screen.getByLabelText('Hasta (no incluido)'), '2027-02-01');
    await user.click(screen.getByRole('button', { name: 'Asignar' }));
    expect(
      screen.getByText('La fecha de fin tiene que ser posterior a la de inicio.'),
    ).toBeVisible();
    expect(api.callsTo('createStaffAssignment')).toHaveLength(0);
  });
});

describe('administration: brand of the club', () => {
  it('saves only what changed, with the version, and refreshes the theme', async () => {
    let club = fixtures.club();
    const { user, api } = renderApp({
      path: '/admin/club',
      handlers: asAdmin({
        getClub: () => club,
        updateClub: () => {
          club = fixtures.club({
            name: 'Olivos RC',
            colors: { primary: '#123456', secondary: '#050505' },
            version: '1793586338688999',
          });
          return club;
        },
      }),
    });
    const name = await screen.findByLabelText('Nombre');
    await user.clear(name);
    await user.type(name, 'Olivos RC');
    const primary = screen.getByLabelText('Color principal');
    await user.clear(primary);
    await user.type(primary, '#123456');
    expect(screen.getByText(/Sobre el fondo oscuro este color tiene poco contraste/)).toBeVisible();
    const themeCalls = api.callsTo('getClubTheme').length;
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByText('Listo: guardamos los cambios del club.')).toBeVisible();
    expect(api.callsTo('updateClub')[0]?.body).toEqual({
      version: fixtures.club().version,
      name: 'Olivos RC',
      colors: { primary: '#123456' },
    });
    await waitFor(() => {
      expect(api.callsTo('getClubTheme').length).toBeGreaterThan(themeCalls);
    });
  });

  it('explains a conflict and starts again from the current club', async () => {
    const { user } = renderApp({
      path: '/admin/club',
      handlers: asAdmin({ updateClub: () => apiError(409, 'conflict') }),
    });
    const shortName = await screen.findByLabelText('Sigla');
    await user.clear(shortName);
    await user.type(shortName, 'OLI');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/Alguien cambió esto mientras lo mirabas/)).toBeVisible();
  });

  it('uploads the crest straight to the bucket and confirms it', async () => {
    const fileId = parseUuid(admin.id());
    const pending = {
      id: fileId,
      kind: 'club_logo' as const,
      status: 'pending' as const,
      playerId: null,
      categoryId: null,
      contentType: 'image/png',
      sizeBytes: 4,
      checksumSha256: 'n2SnR+G5fxMfq7a0Rylsm28CAeefs8U1bmx36JtqgGo=',
      fileName: 'escudo.png',
      testResultId: null,
      testEntryId: null,
      uploadedAt: null,
      expiresAt: '2026-11-01T13:00:00.000Z',
      deletedAt: null,
      createdBy: fixtures.USER.id,
      createdAt: '2026-11-01T12:00:00.000Z',
      updatedAt: '2026-11-01T12:00:00.000Z',
    };
    const bucket = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    vi.stubGlobal('fetch', bucket);
    const { user, api } = renderApp({
      path: '/admin/club',
      handlers: asAdmin({
        createFileUpload: () => ({
          file: pending,
          upload: {
            method: 'PUT' as const,
            url: 'https://bucket.example.com/clubs/orc/club_logo/1?signature=x',
            headers: {
              'content-type': 'image/png',
              'x-amz-checksum-sha256': pending.checksumSha256,
            },
            expiresAt: '2026-11-01T12:15:00.000Z',
          },
        }),
        confirmFileUpload: () => ({ ...pending, status: 'ready' as const }),
        updateClub: () => fixtures.club({ logoFileId: fileId, version: '1793586338688999' }),
      }),
    });
    const input = await screen.findByLabelText('Archivo del escudo');
    await user.upload(
      input,
      new File([new Uint8Array([1, 2, 3, 4])], 'escudo.png', { type: 'image/png' }),
    );
    await user.click(screen.getByRole('button', { name: 'Subir escudo' }));
    await waitFor(() => {
      expect(api.callsTo('updateClub')).toHaveLength(1);
    });
    expect(api.callsTo('createFileUpload')[0]?.body).toEqual({
      kind: 'club_logo',
      clientUuid: expect.any(String) as string,
      contentType: 'image/png',
      sizeBytes: 4,
      checksumSha256: pending.checksumSha256,
      fileName: 'escudo.png',
    });
    expect(bucket).toHaveBeenCalledWith(
      'https://bucket.example.com/clubs/orc/club_logo/1?signature=x',
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(api.callsTo('confirmFileUpload')[0]?.params).toEqual({ fileId });
    expect(api.callsTo('updateClub')[0]?.body).toEqual({
      version: fixtures.club().version,
      logoFileId: fileId,
    });
  });

  it('refuses a crest that is not PNG or WebP before uploading', async () => {
    const { api } = renderApp({ path: '/admin/club', handlers: asAdmin() });
    const input = await screen.findByLabelText('Archivo del escudo');
    // The picker's `accept` filters it in a browser; a drop or another browser may not.
    fireEvent.change(input, {
      target: { files: [new File(['<svg/>'], 'escudo.svg', { type: 'image/svg+xml' })] },
    });
    expect(await screen.findByText('El escudo tiene que ser PNG o WebP.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Subir escudo' })).toBeDisabled();
    expect(api.callsTo('createFileUpload')).toHaveLength(0);
  });
});

describe('administration: branches and categories', () => {
  it('enables a branch, creates a category and refreshes the layout categories', async () => {
    const { user, api } = renderApp({
      path: '/admin/categories',
      handlers: asAdmin({
        enableClubBranch: () => admin.HOCKEY_FEMALE,
        createCategory: () => fixtures.F15_HOCKEY,
      }),
    });
    expect(
      await screen.findByRole('heading', { name: 'Categorías de Rugby · Masculino' }),
    ).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Habilitar otra rama'), 'hockey:female');
    await user.click(screen.getByRole('button', { name: 'Habilitar' }));
    await waitFor(() => {
      expect(api.callsTo('enableClubBranch')[0]?.body).toEqual({
        clientUuid: expect.any(String) as string,
        sport: 'hockey',
        sex: 'female',
      });
    });

    const form = screen.getByRole('heading', { name: 'Nueva categoría' }).closest('section');
    if (form === null) throw new Error('no form');
    await user.selectOptions(within(form).getByLabelText('Rama'), 'rugby:male');
    await user.selectOptions(within(form).getByLabelText('Franja de edad'), 'm16');
    await user.type(within(form).getByLabelText('Nombre'), 'Menores de 16');
    const before = api.callsTo('listCategories').length;
    await user.click(within(form).getByRole('button', { name: 'Crear categoría' }));
    await waitFor(() => {
      expect(api.callsTo('createCategory')).toHaveLength(1);
    });
    expect(api.callsTo('createCategory')[0]?.body).toEqual({
      clientUuid: expect.any(String) as string,
      sport: 'rugby',
      sex: 'male',
      ageBandCode: 'm16',
      name: 'Menores de 16',
    });
    // Both the section's list (all) and the shell's (active) are read again.
    await waitFor(() => {
      const statuses = api
        .callsTo('listCategories')
        .slice(before)
        .map((call) => call.url.searchParams.get('status'));
      expect(statuses).toEqual(expect.arrayContaining(['all', 'active']));
    });
  });

  it('renames a category with its version and archives one after confirming', async () => {
    const { user, api } = renderApp({
      path: '/admin/categories',
      handlers: asAdmin({
        updateCategory: () => ({ ...fixtures.M15_RUGBY, name: 'Menores de 15' }),
        archiveCategory: () => ({ ...fixtures.M17_RUGBY, archivedAt: '2026-11-02T12:00:00.000Z' }),
      }),
    });
    const m15 = (await screen.findByRole('rowheader', { name: 'M15' })).closest('tr');
    if (m15 === null) throw new Error('no row');
    expect(within(m15).getByText('Desarrollo (M15 / M16)')).toBeVisible();
    await user.click(within(m15).getByRole('button', { name: 'Editar' }));
    const name = within(m15).getByLabelText('Nombre');
    await user.clear(name);
    await user.type(name, 'Menores de 15');
    await user.click(within(m15).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      expect(api.callsTo('updateCategory')[0]).toMatchObject({
        params: { categoryId: fixtures.M15_RUGBY.id },
        body: { version: fixtures.M15_RUGBY.version, name: 'Menores de 15' },
      });
    });

    const m17 = screen.getByRole('rowheader', { name: 'M17' }).closest('tr');
    if (m17 === null) throw new Error('no row');
    await user.click(within(m17).getByRole('button', { name: 'Archivar' }));
    expect(within(m17).getByText(/M17 deja de ofrecerse/)).toBeVisible();
    await user.click(within(m17).getByRole('button', { name: 'Archivar' }));
    await waitFor(() => {
      expect(api.callsTo('archiveCategory')[0]?.params).toEqual({
        categoryId: fixtures.M17_RUGBY.id,
      });
    });
  });
});

describe('administration: positions (B-801)', () => {
  it('lists the positions of each sport of the club with their lines and names', async () => {
    renderApp({
      path: '/admin/categories',
      handlers: asAdmin({
        listClubBranches: () => fixtures.page([admin.RUGBY_MALE, admin.HOCKEY_FEMALE]),
        listPositions: () => fixtures.page([HOOKER, WING, GOALKEEPER, SWEEPER]),
      }),
    });
    const hockey = (await screen.findByRole('heading', { name: 'Posiciones de Hockey' })).closest(
      'section',
    );
    if (hockey === null) throw new Error('no hockey section');
    const keeper = within(hockey).getByRole('rowheader', { name: 'Arquera' }).closest('tr');
    if (keeper === null) throw new Error('no row');
    expect(within(keeper).getByText('Arqueras')).toBeVisible();
    expect(within(keeper).getByText('Activa')).toBeVisible();
    // The club's own label, archived (icon and text), restorable.
    const sweeper = within(hockey).getByRole('rowheader', { name: 'Líbero' }).closest('tr');
    if (sweeper === null) throw new Error('no row');
    expect(within(sweeper).getByText('Defensoras')).toBeVisible();
    expect(within(sweeper).getByText('Archivada')).toBeVisible();
    expect(within(sweeper).getByRole('button', { name: 'Restaurar' })).toBeVisible();
    const rugby = screen.getByRole('heading', { name: 'Posiciones de Rugby' }).closest('section');
    if (rugby === null) throw new Error('no rugby section');
    expect(within(rugby).getByRole('rowheader', { name: 'Hooker' })).toBeVisible();
    expect(within(rugby).queryByRole('rowheader', { name: 'Arquera' })).not.toBeInTheDocument();
  });

  it('renames a position and moves it to another line of its sport, with its version', async () => {
    const { user, api } = renderApp({
      path: '/admin/categories',
      handlers: asAdmin({
        updatePosition: () => ({ ...WING, label: 'Wing derecho' }),
      }),
    });
    const wing = (await screen.findByRole('rowheader', { name: 'Wing' })).closest('tr');
    if (wing === null) throw new Error('no row');
    await user.click(within(wing).getByRole('button', { name: 'Editar' }));
    // Only the lines of rugby.
    const line = within(wing).getByLabelText('Línea');
    expect(
      within(line)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Forwards', 'Backs']);
    await user.type(within(wing).getByLabelText('Nombre'), 'Wing derecho');
    await user.selectOptions(line, 'forwards');
    await user.click(within(wing).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      expect(api.callsTo('updatePosition')[0]).toMatchObject({
        params: { positionId: WING.id },
        body: { version: WING.version, label: 'Wing derecho', lineCode: 'forwards' },
      });
    });
  });

  it('adds a position of the club inside a line, and archives one after confirming', async () => {
    const { user, api } = renderApp({
      path: '/admin/categories',
      handlers: asAdmin({
        createPosition: () => ({ ...position('utility_back', 'backs', 9), label: 'Utility' }),
        archivePosition: () => ({ ...HOOKER, archivedAt: '2026-11-02T12:00:00.000Z' }),
      }),
    });
    const form = await screen.findByRole('form', { name: 'Sumar una posición (Rugby)' });
    await user.click(within(form).getByRole('button', { name: 'Sumar posición' }));
    expect(within(form).getAllByText('Este dato es obligatorio.')).toHaveLength(3);
    await user.type(within(form).getByLabelText('Nombre'), 'Utility');
    await user.type(within(form).getByLabelText(/^Código/), 'Utility Back');
    await user.selectOptions(within(form).getByLabelText('Línea'), 'backs');
    await user.click(within(form).getByRole('button', { name: 'Sumar posición' }));
    expect(
      within(form).getByText('Usá minúsculas sin acentos, números y guiones bajos.'),
    ).toBeVisible();
    expect(api.callsTo('createPosition')).toHaveLength(0);
    await user.clear(within(form).getByLabelText(/^Código/));
    await user.type(within(form).getByLabelText(/^Código/), 'utility_back');
    await user.click(within(form).getByRole('button', { name: 'Sumar posición' }));
    await waitFor(() => {
      expect(api.callsTo('createPosition')[0]?.body).toEqual({
        clientUuid: expect.any(String) as string,
        sport: 'rugby',
        code: 'utility_back',
        label: 'Utility',
        lineCode: 'backs',
      });
    });

    const hooker = screen.getByRole('rowheader', { name: 'Hooker' }).closest('tr');
    if (hooker === null) throw new Error('no row');
    await user.click(within(hooker).getByRole('button', { name: 'Archivar' }));
    expect(within(hooker).getByText(/quien ya la tiene la conserva/)).toBeVisible();
    await user.click(within(hooker).getByRole('button', { name: 'Archivar' }));
    await waitFor(() => {
      expect(api.callsTo('archivePosition')[0]?.params).toEqual({ positionId: HOOKER.id });
    });
  });
});

describe('administration: season change', () => {
  it('reviews a player and applies only when nobody is left to review', async () => {
    let current = admin.rollover();
    const item = admin.rolloverItem();
    const { user, api } = renderApp({
      path: '/admin/seasons',
      handlers: asAdmin({
        listSeasons: () => fixtures.page([admin.SEASON_2027]),
        getSeason: () => admin.SEASON_2027,
        listSeasonRollovers: () => fixtures.page([current]),
        listSeasonRolloverItems: () => fixtures.page([item]),
        updateSeasonRolloverItem: () => {
          current = admin.rollover({
            counts: { players: 2, moving: 2, staying: 0, pendingReview: 0, outcomes: null },
            version: '1793586338688999',
          });
          return {
            ...item,
            decision: 'move' as const,
            targetCategoryId: fixtures.M17_RUGBY.id,
            reviewedAt: '2026-11-02T12:00:00.000Z',
          };
        },
        applySeasonRollover: () => admin.rollover({ status: 'applied' }),
      }),
    });
    await user.click(await screen.findByRole('link', { name: 'Cambio de temporada 2027' }));
    expect(await screen.findByRole('heading', { name: 'Cambio de temporada 2027' })).toBeVisible();
    expect(screen.getByText('Falta revisar 1 jugador antes de aplicar.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Aplicar el cambio' })).toBeDisabled();
    expect(api.callsTo('listSeasonRolloverItems')[0]?.url.searchParams.get('needsReview')).toBe(
      'true',
    );

    const row = screen.getByRole('rowheader', { name: 'Álvarez, Tomás' }).closest('tr');
    if (row === null) throw new Error('no row');
    expect(within(row).getByText('Pide revisión')).toBeVisible();
    await user.selectOptions(
      within(row).getByLabelText('Decisión para Tomás Álvarez'),
      `move:${fixtures.M17_RUGBY.id}`,
    );
    await user.click(within(row).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => {
      expect(api.callsTo('updateSeasonRolloverItem')[0]?.body).toEqual({
        version: item.version,
        decision: 'move',
        targetCategoryId: fixtures.M17_RUGBY.id,
      });
    });

    const applyButton = await screen.findByRole('button', { name: 'Aplicar el cambio' });
    await waitFor(() => {
      expect(applyButton).toBeEnabled();
    });
    await user.click(applyButton);
    expect(
      screen.getByText(/2 jugadores cambian de categoría desde el 01\/02\/2027/),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Aplicar el cambio' }));
    await waitFor(() => {
      expect(api.callsTo('applySeasonRollover')[0]?.body).toEqual({
        version: '1793586338688999',
      });
    });
  });

  it('asks for a proposal when there is none in review', async () => {
    const { user, api } = renderApp({
      path: `/admin/seasons/${admin.SEASON_2027.id}`,
      handlers: asAdmin({
        getSeason: () => admin.SEASON_2027,
        listSeasonRollovers: () => fixtures.page([]),
        createSeasonRollover: () => admin.rollover(),
      }),
    });
    expect(await screen.findByLabelText('Día del pase')).toHaveValue('2027-02-01');
    await user.click(screen.getByRole('button', { name: 'Pedir la propuesta' }));
    await waitFor(() => {
      expect(api.callsTo('createSeasonRollover')[0]).toMatchObject({
        params: { seasonId: admin.SEASON_2027.id },
        body: { effectiveOn: '2027-02-01' },
      });
    });
  });
});

describe('administration: roster import', () => {
  const CSV = [
    'Apellido;Nombre;Fecha de nacimiento;Sexo;Categoría;Email madre;Club anterior',
    'Gómez;Juan;05/03/2011;M;M15;madre@example.com;CASI',
    'Perez;Juan;05/03/2010;M;M17;;',
    'Sosa;Ana;31/02/2011;F;M15;;',
  ].join('\n');

  it('reads the sheet, decides a possible duplicate, imports and sends the invitations', async () => {
    const { user, api } = renderApp({
      path: '/admin/roster',
      handlers: asAdmin({
        listRosterImports: () => fixtures.page([]),
        previewRosterImport: (request) => {
          const body = request.body as { rows: { resolution?: unknown }[] };
          return admin.rosterPreview(body.rows[1]?.resolution !== undefined);
        },
        importRoster: () => admin.rosterImportResult() as never,
        createInvitation: () => ({
          invitation: admin.invitation({ email: 'madre@example.com', role: 'parent' }),
          links: { app: 'sportperformance://invite/x', web: 'https://app.example.com/invite/x' },
        }),
      }),
    });
    await user.upload(
      await screen.findByLabelText('Planilla'),
      new File([CSV], 'padron.csv', { type: 'text/csv' }),
    );
    expect(
      await screen.findByText(/Leímos 3 filas: 2 se pueden importar y 1 tienen/),
    ).toBeVisible();
    expect(screen.getByText(/no las reconocemos y no se leen: Club anterior/)).toBeVisible();
    expect(screen.getByText(/La fecha no se entiende/)).toBeVisible();

    await waitFor(() => {
      expect(api.callsTo('previewRosterImport')).toHaveLength(1);
    });
    expect(api.callsTo('previewRosterImport')[0]?.body).toEqual({
      sport: 'rugby',
      rows: [
        {
          sourceRow: 2,
          firstName: 'Juan',
          lastName: 'Gómez',
          birthDate: '2011-03-05',
          sex: 'male',
          category: 'M15',
          guardians: [{ email: 'madre@example.com', relationship: 'mother' }],
        },
        {
          sourceRow: 3,
          firstName: 'Juan',
          lastName: 'Perez',
          birthDate: '2010-03-05',
          sex: 'male',
          category: 'M17',
        },
      ],
    });
    expect(
      await screen.findByText(/puede ser alguien que ya está en el club: decidí qué hacer/),
    ).toBeVisible();
    const importButton = screen.getByRole('button', { name: 'Importar 2 filas' });
    expect(importButton).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: /Es Pérez, Juan \(05\/03\/2010\)/ }));
    await waitFor(() => {
      expect(api.callsTo('previewRosterImport')).toHaveLength(2);
    });
    expect(
      (api.callsTo('previewRosterImport')[1]?.body as { rows: unknown[] }).rows[1],
    ).toMatchObject({
      resolution: {
        action: 'update',
        playerId: admin.MATCHED_PLAYER_ID,
        version: expect.any(String) as string,
      },
    });
    // The unreadable row has to be left out on purpose.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Importar 2 filas' })).toBeDisabled();
    });
    await user.click(screen.getByRole('checkbox', { name: 'Importar sin esa fila' }));
    await user.click(screen.getByRole('button', { name: 'Importar 2 filas' }));

    expect(await screen.findByRole('heading', { name: 'Padrón importado' })).toBeVisible();
    const imported = api.callsTo('importRoster')[0]?.body as {
      clientUuid: string;
      rows: unknown[];
    };
    expect(imported.clientUuid).toEqual(expect.any(String) as string);
    expect(imported.rows).toHaveLength(2);
    expect(screen.getByText(/Altas: 1\. Actualizados: 1\./)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Enviar 1 invitación' }));
    expect(await screen.findByText('Enviada')).toBeVisible();
    expect(api.callsTo('createInvitation')[0]?.body).toEqual({
      email: 'madre@example.com',
      role: 'parent',
      playerId: admin.NEW_PLAYER_ID,
      relationship: 'mother',
      categoryIds: [],
      expiresInDays: 7,
    });
  });

  it('says why a file cannot be read', async () => {
    const { user, api } = renderApp({
      path: '/admin/roster',
      handlers: asAdmin({ listRosterImports: () => fixtures.page([]) }),
    });
    await user.upload(
      await screen.findByLabelText('Planilla'),
      new File(['Nombre;Sexo\nJuan;M'], 'padron.csv', { type: 'text/csv' }),
    );
    expect(await screen.findByText('La planilla no se puede importar así:')).toBeVisible();
    expect(screen.getAllByText('Falta una columna obligatoria.').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Planilla'), {
      target: { files: [new File(['%PDF'], 'padron.pdf', { type: 'application/pdf' })] },
    });
    expect(await screen.findByText(/Ese archivo no es un CSV ni un Excel/)).toBeVisible();
    expect(api.callsTo('previewRosterImport')).toHaveLength(0);
  });
});
