import type { ConsentType } from '@sport-performance/domain';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, type FakeHandlers } from '../test/fake-api';
import * as fixtures from '../test/fixtures';
import * as family from '../test/guardian-fixtures';
import { renderApp, signedIn } from '../test/render-app';
import { buildActiveClub, isGuardianPath } from '../club/active-club';
import { childFacts, guardianSeesData } from './child';
import { parseHeightInput } from './ParentHeightsSection';

const PARENT = fixtures.membership('parent');

function asGuardian(handlers: FakeHandlers = {}): FakeHandlers {
  return {
    ...signedIn({ memberships: [PARENT] }),
    listMyChildren: () => fixtures.page([family.child(), family.hiddenAdult()]),
    getPlayer: () => family.player(),
    getPlayerConsents: () => family.playerConsents(),
    getPlayerParentHeights: () => family.parentHeights(),
    listPlayerConsentHistory: () =>
      fixtures.page([
        family.consent('data'),
        family.consent('health', {
          revokedAt: '2026-06-01T12:00:00.000Z',
          revokedBy: fixtures.USER.id,
        }),
      ]),
    getConsentDocument: (request) => {
      const type = (['data', 'image', 'health'] as const).find(
        (candidate) => family.consentDocument(candidate).id === request.params.documentId,
      );
      return family.consentDocument(type ?? 'data');
    },
    ...handlers,
  };
}

const childPath = `/family/${family.SOFIA_ID}`;

describe('family area: access', () => {
  it('lands a guardian in their children, without staff data or scope', async () => {
    const { api, app } = renderApp({ path: '/', handlers: asGuardian() });
    expect(await screen.findByRole('heading', { name: 'Mis hijos/as' })).toBeVisible();
    expect(app.router.state.location.pathname).toBe('/family');
    expect(screen.getByRole('link', { name: 'Ver la ficha de Sofía Ríos' })).toBeVisible();
    expect(within(screen.getByRole('navigation')).getByText('Mis hijos/as')).toBeVisible();
    expect(screen.queryByLabelText('Deporte')).toBeNull();
    expect(api.callsTo('listCategories')).toHaveLength(0);
    expect(api.callsTo('listMyStaffAssignments')).toHaveLength(0);
    expect(api.callsTo('listMyChildren')[0]?.headers['x-membership-id']).toBe(PARENT.id);
  });

  it('keeps a guardian out of the staff screens', async () => {
    const { app } = renderApp({ path: '/?sport=rugby', handlers: asGuardian() });
    await screen.findByRole('heading', { name: 'Mis hijos/as' });
    expect(app.router.state.location.pathname).toBe('/family');
  });

  it('keeps the staff out of the family area', async () => {
    const { api, app } = renderApp({
      path: '/family',
      handlers: signedIn({ memberships: [fixtures.membership('coach')] }),
    });
    expect(await screen.findByRole('heading', { name: 'Inicio' })).toBeVisible();
    expect(app.router.state.location.pathname).toBe('/');
    expect(api.callsTo('listMyChildren')).toHaveLength(0);
  });

  it('lists an adult who did not keep the access only by name', async () => {
    renderApp({ path: '/family', handlers: asGuardian() });
    const card = await screen.findByRole('article', { name: 'Martín Ríos' });
    expect(within(card).getByText(/decidió no compartir sus datos con vos/)).toBeVisible();
    expect(within(card).queryByRole('link')).toBeNull();
    expect(within(card).queryByText('M15 · Rugby')).toBeNull();
  });

  it('asks nothing about an adult who did not keep the access', async () => {
    const { api } = renderApp({ path: `/family/${family.MARTIN_ID}`, handlers: asGuardian() });
    expect(await screen.findByText('Sus datos ya no se comparten')).toBeVisible();
    expect(api.callsTo('getPlayer')).toHaveLength(0);
    expect(api.callsTo('getPlayerConsents')).toHaveLength(0);
    expect(api.callsTo('getPlayerParentHeights')).toHaveLength(0);
  });

  it('says so for a player who is not one of the children', async () => {
    const { api } = renderApp({
      path: '/family/0192e7a0-4444-7000-8000-0000000000ff',
      handlers: asGuardian(),
    });
    expect(await screen.findByText(/No encontramos a ese jugador\/a/)).toBeVisible();
    expect(api.callsTo('getPlayer')).toHaveLength(0);
    expect(api.callsTo('getPlayerConsents')).toHaveLength(0);
  });

  it('tells a guardian without children what to do', async () => {
    renderApp({
      path: '/family',
      handlers: asGuardian({ listMyChildren: () => fixtures.page([]) }),
    });
    expect(await screen.findByText(/Todavía no tenés hijos\/as vinculados/)).toBeVisible();
  });
});

describe('family area: summarised profile', () => {
  it('shows the roster data of the child in es-AR, never health data', async () => {
    const { user } = renderApp({ path: '/family', handlers: asGuardian() });
    const card = await screen.findByRole('article', { name: 'Sofía Ríos' });
    expect(within(card).getByText('M15 · Rugby')).toBeVisible();
    await user.click(within(card).getByRole('link', { name: 'Ver la ficha de Sofía Ríos' }));

    expect(await screen.findByRole('heading', { name: 'Sofía Ríos', level: 1 })).toBeVisible();
    expect(screen.getByText('Tu vínculo: Madre')).toBeVisible();
    const summary = screen.getByRole('region', { name: 'Ficha' });
    expect(within(summary).getByText('10/05/2012')).toBeVisible();
    expect(await within(summary).findByText('01/03/2020')).toBeVisible();
    expect(within(summary).getByText('Rugby')).toBeVisible();
    expect(within(summary).getByText('M15')).toBeVisible();
    expect(within(summary).getByText(/no se muestran datos de salud/)).toBeVisible();
  });

  it('shows an adult who kept the access read-only', async () => {
    const adult = family.child({
      ofAge: true,
      adultConfirmed: true,
      birthDate: '2000-01-01' as never,
      canManageAccess: false,
    });
    renderApp({
      path: childPath,
      handlers: asGuardian({
        listMyChildren: () => fixtures.page([adult]),
        getPlayerConsents: () =>
          family.playerConsents(
            [
              family.typeStatus('data', 'granted', { actions: [] }),
              family.typeStatus('image', 'missing', { actions: [] }),
              family.typeStatus('health', 'missing', { actions: [] }),
            ],
            { playerOfAge: true, requiredSigner: 'player' },
          ),
        getPlayerParentHeights: () => family.parentHeights(),
      }),
    });
    expect(await screen.findByText(/las firmas y las cargas las hace él o ella/)).toBeVisible();
    const consents = screen.getByRole('region', { name: 'Consentimientos' });
    expect(await within(consents).findByText('Datos personales y de entrenamiento')).toBeVisible();
    expect(within(consents).queryByRole('button', { name: /firmar|Revocar/i })).toBeNull();
    const heights = screen.getByRole('region', { name: 'Altura de los padres' });
    await within(heights).findByText('Madre');
    expect(within(heights).queryByRole('button')).toBeNull();
  });
});

function consentRow(type: ConsentType) {
  const titles = {
    data: 'Datos personales y de entrenamiento',
    image: 'Imágenes y videos',
    health: 'Datos de salud',
    menstrual_cycle: 'Seguimiento del ciclo menstrual',
    location: 'Ubicación con el pod',
  } as const;
  return screen.findByRole('article', { name: titles[type] });
}

describe('family area: location consent (B-913)', () => {
  const withLocation = (state: Parameters<typeof family.typeStatus>[1], handlers = {}) =>
    asGuardian({
      getPlayerConsents: () =>
        family.playerConsents([
          family.typeStatus('data', 'granted'),
          family.typeStatus('image', 'missing'),
          family.typeStatus('health', 'missing'),
          family.typeStatus('location', state),
        ]),
      ...handlers,
    });

  it('says what it covers and that the guardian never sees the position', async () => {
    renderApp({ path: childPath, handlers: withLocation('missing') });
    const location = await consentRow('location');
    expect(within(location).getByText('Sin firmar')).toBeVisible();
    expect(within(location).getByText(/Sin este no recibe pod/)).toBeVisible();
    expect(within(location).getByText(/vos no ves la ubicación/)).toBeVisible();
    expect(within(location).getByRole('button', { name: 'Leer y firmar' })).toBeVisible();
  });

  it('an older text no longer counts: asks to sign the new version', async () => {
    renderApp({ path: childPath, handlers: withLocation('outdated') });
    const location = await consentRow('location');
    expect(within(location).getByText(/lo firmado antes ya no vale/)).toBeVisible();
    expect(within(location).queryByText(/Lo firmado sigue valiendo/)).toBeNull();
    expect(
      within(location).getByRole('button', { name: 'Leer y firmar la versión nueva' }),
    ).toBeVisible();
    // Unlike data, an outdated location consent is not a fact of the matrix.
    const facts = childFacts(
      family.child(),
      family.player(),
      family.playerConsents([
        family.typeStatus('data', 'outdated'),
        family.typeStatus('location', 'outdated'),
      ]),
    );
    expect(facts.consents).toEqual(['data']);
  });

  it('revoking warns that the traces are deleted', async () => {
    const { user, api } = renderApp({
      path: childPath,
      handlers: withLocation('granted', {
        revokeConsent: () => family.typeStatus('location', 'revoked'),
      }),
    });
    const location = await consentRow('location');
    await user.click(within(location).getByRole('button', { name: 'Revocar' }));
    expect(within(location).getByText(/se borran sus trazas de posición/)).toBeVisible();
    expect(within(location).getByText(/El borrado no se deshace/)).toBeVisible();
    await user.click(within(location).getByRole('button', { name: 'Sí, revocar' }));
    expect(
      await within(location).findByText(
        'Listo: quedó revocado. El club está borrando sus trazas de posición.',
      ),
    ).toBeVisible();
    expect(api.callsTo('revokeConsent')[0]?.params).toEqual({
      playerId: family.SOFIA_ID,
      type: 'location',
    });
  });
});

describe('family area: consents', () => {
  it('shows the state of each type with icon and text', async () => {
    renderApp({ path: childPath, handlers: asGuardian() });
    const data = await consentRow('data');
    expect(within(data).getByText('Vigente')).toBeVisible();
    expect(
      within(data).getByText('Firmado por un tutor/a el 05/03/2026 (versión 2026-03).'),
    ).toBeVisible();
    expect(within(await consentRow('image')).getByText('Sin firmar')).toBeVisible();
    expect(within(await consentRow('health')).getByText('Revocado')).toBeVisible();
    // Each state carries its icon next to the text.
    expect(within(data).getByText('Vigente').parentElement?.querySelector('svg')).not.toBeNull();
  });

  it('signs after reading the whole text and accepting it, once per signature', async () => {
    let signed = false;
    const { user, api } = renderApp({
      path: childPath,
      handlers: asGuardian({
        signConsent: () => {
          signed = true;
          return family.consent('image');
        },
        getPlayerConsents: () =>
          family.playerConsents([
            family.typeStatus('data', 'granted'),
            signed ? family.typeStatus('image', 'granted') : family.typeStatus('image', 'missing'),
            family.typeStatus('health', 'revoked'),
          ]),
      }),
    });
    const image = await consentRow('image');
    await user.click(within(image).getByRole('button', { name: 'Leer y firmar' }));
    expect(await within(image).findByText('Primer párrafo del texto image.')).toBeVisible();
    expect(within(image).getByText(/Segundo párrafo/)).toBeVisible();

    await user.click(within(image).getByRole('button', { name: 'Firmar' }));
    expect(within(image).getByText('Marcá que leíste el texto antes de firmar.')).toBeVisible();
    expect(api.callsTo('signConsent')).toHaveLength(0);

    await user.click(
      within(image).getByRole('checkbox', {
        name: 'Leí el texto y doy mi consentimiento como madre de Sofía Ríos.',
      }),
    );
    await user.click(within(image).getByRole('button', { name: 'Firmar' }));
    expect(await within(image).findByText('Listo: quedó firmado.')).toBeVisible();
    const [call] = api.callsTo('signConsent');
    expect(call?.params.playerId).toBe(family.SOFIA_ID);
    expect(call?.body).toEqual({
      clientUuid: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
      documentId: family.consentDocument('image').id,
    });
    expect(await within(image).findByText('Vigente')).toBeVisible();
  });

  it('offers the new version of an outdated consent', async () => {
    renderApp({
      path: childPath,
      handlers: asGuardian({
        getPlayerConsents: () =>
          family.playerConsents([
            family.typeStatus('data', 'outdated'),
            family.typeStatus('image', 'missing'),
            family.typeStatus('health', 'missing'),
          ]),
      }),
    });
    const data = await consentRow('data');
    expect(within(data).getByText('Vigente sobre un texto anterior')).toBeVisible();
    expect(
      within(data).getByRole('button', { name: 'Leer y firmar la versión nueva' }),
    ).toBeVisible();
  });

  it('says when the club has not published a text yet', async () => {
    renderApp({
      path: childPath,
      handlers: asGuardian({
        getPlayerConsents: () =>
          family.playerConsents([
            family.typeStatus('data', 'granted'),
            family.typeStatus('image', 'missing', { currentDocument: null }),
            family.typeStatus('health', 'missing'),
          ]),
      }),
    });
    const image = await consentRow('image');
    expect(within(image).getByText(/todavía no publicó el texto/)).toBeVisible();
    expect(within(image).queryByRole('button', { name: 'Leer y firmar' })).toBeNull();
  });

  it('revokes after confirming the consequence', async () => {
    const { user, api } = renderApp({
      path: childPath,
      handlers: asGuardian({ revokeConsent: () => family.typeStatus('data', 'revoked') }),
    });
    const data = await consentRow('data');
    await user.click(within(data).getByRole('button', { name: 'Revocar' }));
    expect(
      within(data).getByText(
        /el club no puede cargar datos personales ni de entrenamiento de Sofía/,
      ),
    ).toBeVisible();
    expect(api.callsTo('revokeConsent')).toHaveLength(0);
    await user.click(within(data).getByRole('button', { name: 'Sí, revocar' }));
    expect(await within(data).findByText('Listo: quedó revocado.')).toBeVisible();
    expect(api.callsTo('revokeConsent')[0]?.params).toEqual({
      playerId: family.SOFIA_ID,
      type: 'data',
    });
  });

  it('shows the error envelope when a signature fails', async () => {
    const { user } = renderApp({
      path: childPath,
      handlers: asGuardian({
        signConsent: () => apiError(409, 'conflict', { requestId: 'req-9' }),
      }),
    });
    const image = await consentRow('image');
    await user.click(within(image).getByRole('button', { name: 'Leer y firmar' }));
    await user.click(await within(image).findByRole('checkbox'));
    await user.click(within(image).getByRole('button', { name: 'Firmar' }));
    expect(await within(image).findByText('Código para soporte: req-9')).toBeVisible();
  });

  it('lists the history of signatures when opened', async () => {
    const { user, api } = renderApp({ path: childPath, handlers: asGuardian() });
    await consentRow('data');
    expect(api.callsTo('listPlayerConsentHistory')).toHaveLength(0);
    await user.click(screen.getByText('Historial de firmas'));
    expect(await screen.findByText('Revocado el 01/06/2026')).toBeVisible();
    expect(screen.getByText('Sin revocar')).toBeVisible();
  });
});

describe('family area: parents’ heights', () => {
  it('reports a height typed in es-AR, as reported', async () => {
    const { user, api } = renderApp({
      path: childPath,
      handlers: asGuardian({
        setPlayerParentHeight: () => family.parentHeight('mother', 165.5),
      }),
    });
    const heights = await screen.findByRole('region', { name: 'Altura de los padres' });
    const mother = await within(heights).findByRole('article', { name: 'Madre' });
    expect(within(mother).getByText('Sin cargar')).toBeVisible();
    await user.click(within(mother).getByRole('button', { name: 'Informar' }));
    const input = within(mother).getByRole('textbox', { name: 'Altura de la madre (cm)' });

    await user.type(input, '1.65');
    await user.click(within(mother).getByRole('button', { name: 'Guardar' }));
    expect(within(mother).getByText(/Escribí la altura en centímetros/)).toBeVisible();
    await user.clear(input);
    await user.type(input, '300');
    await user.click(within(mother).getByRole('button', { name: 'Guardar' }));
    expect(within(mother).getByText('Tiene que estar entre 120 y 230 cm.')).toBeVisible();
    expect(api.callsTo('setPlayerParentHeight')).toHaveLength(0);

    await user.clear(input);
    await user.type(input, '165,5');
    await user.click(within(mother).getByRole('button', { name: 'Guardar' }));
    expect(await within(mother).findByText('Listo: quedó guardada.')).toBeVisible();
    const [call] = api.callsTo('setPlayerParentHeight');
    expect(call?.params).toEqual({ playerId: family.SOFIA_ID, parent: 'mother' });
    expect(call?.body).toEqual({ heightCm: 165.5, source: 'reported' });
  });

  it('corrects a reported height with its version; never a measured one', async () => {
    const { user, api } = renderApp({
      path: childPath,
      handlers: asGuardian({
        getPlayerParentHeights: () =>
          family.parentHeights({ mother: family.parentHeight('mother', 164) }),
        setPlayerParentHeight: () => family.parentHeight('mother', 166),
      }),
    });
    const heights = await screen.findByRole('region', { name: 'Altura de los padres' });
    const father = await within(heights).findByRole('article', { name: 'Padre' });
    expect(within(father).getByText('181,0 cm')).toBeVisible();
    expect(within(father).getByText(/Medida por el staff/)).toBeVisible();
    expect(within(father).getByText(/La midió el staff del club/)).toBeVisible();
    expect(within(father).queryByRole('button')).toBeNull();

    const mother = within(heights).getByRole('article', { name: 'Madre' });
    expect(within(mother).getByText(/Informada · Actualizada el 02\/04\/2026/)).toBeVisible();
    await user.click(within(mother).getByRole('button', { name: 'Corregir' }));
    const input = within(mother).getByRole('textbox', { name: 'Altura de la madre (cm)' });
    expect(input).toHaveValue('164');
    await user.clear(input);
    await user.type(input, '166');
    await user.click(within(mother).getByRole('button', { name: 'Guardar' }));
    await within(mother).findByText('Listo: quedó guardada.');
    expect(api.callsTo('setPlayerParentHeight')[0]?.body).toEqual({
      heightCm: 166,
      source: 'reported',
      version: family.parentHeight('mother', 164).version,
    });
  });

  it('explains a height that changed meanwhile and shows the current one', async () => {
    let measured = false;
    const { user } = renderApp({
      path: childPath,
      handlers: asGuardian({
        getPlayerParentHeights: () =>
          family.parentHeights({
            mother: measured ? family.parentHeight('mother', 162, 'measured') : null,
          }),
        setPlayerParentHeight: () => {
          measured = true;
          return apiError(409, 'conflict');
        },
      }),
    });
    const heights = await screen.findByRole('region', { name: 'Altura de los padres' });
    const mother = await within(heights).findByRole('article', { name: 'Madre' });
    await user.click(within(mother).getByRole('button', { name: 'Informar' }));
    await user.type(within(mother).getByRole('textbox'), '165');
    await user.click(within(mother).getByRole('button', { name: 'Guardar' }));
    expect(await within(mother).findByText(/La altura cambió mientras la editabas/)).toBeVisible();
    expect(await within(mother).findByText('162,0 cm')).toBeVisible();
    await waitFor(() => {
      expect(within(mother).queryByRole('textbox')).toBeNull();
    });
  });

  it('asks for the data consent before reporting', async () => {
    renderApp({
      path: childPath,
      handlers: asGuardian({
        getPlayerConsents: () =>
          family.playerConsents([
            family.typeStatus('data', 'missing'),
            family.typeStatus('image', 'missing'),
            family.typeStatus('health', 'missing'),
          ]),
      }),
    });
    const heights = await screen.findByRole('region', { name: 'Altura de los padres' });
    expect(
      await within(heights).findByText(
        /primero tiene que estar firmado el consentimiento de datos/,
      ),
    ).toBeVisible();
    await within(heights).findByRole('article', { name: 'Madre' });
    expect(within(heights).queryByRole('button', { name: 'Informar' })).toBeNull();
  });
});

describe('family area: rules', () => {
  it('builds the guardian subject from the children, adults with their decision', () => {
    const base = {
      selection: { kind: 'membership', membershipId: PARENT.id } as const,
      user: fixtures.USER,
      club: fixtures.club(),
      theme: fixtures.clubTheme(),
      assignments: [],
      categories: [],
      children: [family.child(), family.hiddenAdult()],
    };
    const guardian = buildActiveClub({ ...base, membership: PARENT });
    expect(guardian.subject).toEqual({
      userId: fixtures.USER.id,
      role: 'parent',
      clubId: fixtures.ORC_ID,
      assignments: [],
      guardianships: [
        { playerId: family.SOFIA_ID, confirmedByAdultPlayer: false },
        { playerId: family.MARTIN_ID, confirmedByAdultPlayer: false },
      ],
    });
    const coach = buildActiveClub({ ...base, membership: fixtures.membership('coach') });
    expect(coach.children).toEqual([]);
    expect(coach.subject.guardianships).toBeUndefined();
  });

  it('knows the paths of the family area', () => {
    expect(isGuardianPath('/family')).toBe(true);
    expect(isGuardianPath(`/family/${family.SOFIA_ID}`)).toBe(true);
    expect(isGuardianPath('/familyx')).toBe(false);
    expect(isGuardianPath('/')).toBe(false);
  });

  it('parses heights in es-AR within the contract range', () => {
    expect(parseHeightInput('165,5')).toEqual({ ok: true, heightCm: 165.5 });
    expect(parseHeightInput(' 170 ')).toEqual({ ok: true, heightCm: 170 });
    expect(parseHeightInput('1.65')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseHeightInput('')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseHeightInput('119,9')).toEqual({ ok: false, reason: 'out_of_range' });
    expect(parseHeightInput('230')).toEqual({ ok: true, heightCm: 230 });
  });

  it('sees the data of minors and of adults who kept the access only', () => {
    expect(guardianSeesData({ ofAge: false, adultConfirmed: false })).toBe(true);
    expect(guardianSeesData({ ofAge: true, adultConfirmed: true })).toBe(true);
    expect(guardianSeesData({ ofAge: true, adultConfirmed: false })).toBe(false);
  });

  it('takes the current consents as facts of the matrix, and none until they are read', () => {
    const facts = childFacts(family.child(), family.player(), family.playerConsents());
    expect(facts).toMatchObject({ id: family.SOFIA_ID, ofAge: false, consents: ['data'] });
    expect(childFacts(family.child(), family.player(), undefined).consents).toBeUndefined();
  });
});
