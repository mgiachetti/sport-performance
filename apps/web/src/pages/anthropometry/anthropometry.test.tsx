import type { AnthroMeasurement, AnthroPreview, Player } from '@sport-performance/contracts';
import {
  localDateInTimeZone,
  parsePlayerId,
  parseTimeZone,
  parseUuid,
} from '@sport-performance/domain';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError, reply, type FakeHandlers, type FakeRequest } from '../../test/fake-api';
import * as fixtures from '../../test/fixtures';
import { renderApp, signedIn } from '../../test/render-app';

const AT = '2026-11-01T12:00:00.000Z';
const VERSION = '1793586338688123';
const TODAY = localDateInTimeZone(new Date(), parseTimeZone('America/Argentina/Buenos_Aires'));

function player(id: string, firstName: string, lastName: string): Player {
  return {
    id: parsePlayerId(id),
    firstName,
    lastName,
    birthDate: '2011-06-01' as Player['birthDate'],
    sex: 'male',
    sport: 'rugby',
    dominantSide: null,
    positionIds: [],
    currentCategoryIds: [fixtures.M15_RUGBY.id],
    joinedOn: '2020-01-01' as Player['joinedOn'],
    leftOn: null,
    leftReason: null,
    leftNote: null,
    hasAccount: false,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
  };
}

const JUAN = player('0192e7a0-4444-7000-8000-000000000001', 'Juan', 'Pérez');
const TOMAS = player('0192e7a0-4444-7000-8000-000000000002', 'Tomás', 'Gómez');

interface PreviewInput {
  playerId: string;
  measuredOn: string;
  heightCm?: number;
  weightKg?: number;
}

/** A fake of the preview: Juan has his parents' heights, Tomás does not. */
function previewOf(request: FakeRequest) {
  const { measurements } = request.body as { measurements: PreviewInput[] };
  return {
    // What the repo seeds: agreed across secondary sources, not checked against the article.
    reference: {
      code: 'khamis_roche_1994',
      verification: 'cross_checked_secondary_sources' as const,
    },
    items: measurements.map((m): AnthroPreview => {
      const hasParents = m.playerId === JUAN.id;
      const height = m.heightCm !== undefined;
      const weight = m.weightKg !== undefined;
      const adult = hasParents && height && weight;
      return {
        playerId: parsePlayerId(m.playerId),
        measuredOn: m.measuredOn as AnthroPreview['measuredOn'],
        blockedBy: null,
        ageYears: 15.4,
        stage: 'development',
        phvOffsetYears: height ? -1.23 : null,
        maturityOffsetEquation: height ? 'moore_2015' : null,
        maturityOffsetVerification: height ? 'cross_checked_secondary_sources' : null,
        predictedAdultHeightCm: adult ? 178.5 : null,
        adultHeightPct: adult ? 92.4 : null,
        growthVelocityCmYear: null,
        gaps: {
          phvOffset: height ? [] : ['height_missing'],
          adultHeight: adult
            ? []
            : [
                ...(height ? [] : (['height_missing'] as const)),
                ...(weight ? [] : (['weight_missing'] as const)),
                ...(hasParents ? [] : (['parent_heights_missing'] as const)),
              ],
        },
        plausibility:
          m.weightKg !== undefined && m.weightKg < 20
            ? [
                {
                  field: 'weightKg',
                  status: 'below',
                  minValue: 35,
                  maxValue: 150,
                  suggestedValues: [m.weightKg * 10],
                },
              ]
            : [],
      };
    }),
  };
}

function measurement(overrides: Partial<AnthroMeasurement> = {}): AnthroMeasurement {
  return {
    id: parseUuid('0192e7a0-5555-7000-8000-000000000001'),
    playerId: JUAN.id,
    testSessionId: null,
    measuredOn: '2026-10-01' as AnthroMeasurement['measuredOn'],
    heightCm: 164,
    sittingHeightCm: 83.5,
    weightKg: 54,
    skinfoldsSumMm: null,
    method: 'manual',
    evaluatorId: null,
    conditions: {},
    notes: null,
    maturation: {
      phvOffsetYears: -0.84,
      maturityOffsetEquation: 'moore_2015',
      predictedAdultHeightCm: 179.2,
      adultHeightPct: 91.5,
      growthVelocityCmYear: 7.9,
      derivedAt: AT,
    },
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

function handlers(role: 'sc' | 'coach' | 'admin', extra: FakeHandlers = {}): FakeHandlers {
  return {
    ...signedIn({ memberships: [fixtures.membership(role)] }),
    listPlayers: () => fixtures.page([JUAN, TOMAS]),
    previewAnthroMeasurements: previewOf,
    listAnthroMeasurements: () =>
      fixtures.page([
        measurement(),
        measurement({
          id: parseUuid('0192e7a0-5555-7000-8000-000000000002'),
          playerId: TOMAS.id,
          maturation: {
            phvOffsetYears: null,
            maturityOffsetEquation: null,
            predictedAdultHeightCm: null,
            adultHeightPct: null,
            growthVelocityCmYear: null,
            derivedAt: null,
          },
        }),
      ]),
    ...extra,
  };
}

const PATH = `/anthropometry?category=${fixtures.M15_RUGBY.id}`;

const SHEET = /^Mediciones de M15 del/;

function sheetRow(name: RegExp): HTMLElement {
  return within(screen.getByRole('table', { name: SHEET })).getByRole('row', { name });
}

async function findSheetRow(name: RegExp): Promise<HTMLElement> {
  return within(await screen.findByRole('table', { name: SHEET })).findByRole('row', { name });
}

describe('anthropometry screen', () => {
  it('is in the navigation of the staff that reads it and asks for a category', async () => {
    const { api } = renderApp({ path: '/anthropometry', handlers: handlers('sc') });
    expect(await screen.findByRole('heading', { name: 'Antropometría' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Antropometría' })).toBeVisible();
    expect(
      screen.getByText(
        'Elegí una categoría en el selector de arriba para cargar o ver sus mediciones.',
      ),
    ).toBeVisible();
    expect(api.callsTo('previewAnthroMeasurements')).toEqual([]);
  });

  it('computes the maturation of each row while typing', async () => {
    const { user, api } = renderApp({ path: PATH, handlers: handlers('sc') });
    const height = await screen.findByLabelText('Talla (cm) de Juan Pérez');
    // Before typing: what the staff can fix that day, with its action.
    const tomas = sheetRow(/Tomás Gómez/);
    expect(await within(tomas).findByText('Falta la altura de los padres')).toBeVisible();
    expect(
      within(tomas).getByRole('button', { name: 'Cargar altura de los padres' }),
    ).toBeVisible();
    expect(
      screen.getByText(/^Coeficientes sin verificar contra la publicación original/),
    ).toBeVisible();
    expect(
      screen.getByText(
        '% de talla adulta (Khamis-Roche): coinciden entre varias fuentes secundarias, falta compararlos con el artículo original.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/^Offset de PHV \(/)).toBeNull();

    await user.type(height, '165,4');
    await user.type(screen.getByLabelText('Peso (kg) de Juan Pérez'), '55');
    const juan = sheetRow(/Juan Pérez/);
    expect(await within(juan).findByText(/1,2 años/)).toBeVisible();
    // The equation used is not verified against its article either: said once, with its status.
    expect(
      screen.getByText(
        'Offset de PHV (Moore 2015): coinciden entre varias fuentes secundarias, falta compararlos con el artículo original.',
      ),
    ).toBeVisible();
    expect(within(juan).getByText('Moore 2015')).toBeVisible();
    expect(await within(juan).findByText(/92,4\s%\sde\s178,5\scm/)).toBeVisible();

    const last = api.callsTo('previewAnthroMeasurements').at(-1);
    expect(last?.body).toEqual({
      measurements: [
        { playerId: JUAN.id, measuredOn: TODAY, heightCm: 165.4, weightKg: 55 },
        { playerId: TOMAS.id, measuredOn: TODAY },
      ],
    });
    // Skinfolds are not a column in a development category.
    expect(screen.queryByLabelText('Σ pliegues ISAK (mm) de Juan Pérez')).toBeNull();
    expect(api.unhandled).toEqual([]);
  });

  it('checks the typed numbers before saving and offers the decimal fix', async () => {
    const { user } = renderApp({ path: PATH, handlers: handlers('sc') });
    const height = await screen.findByLabelText('Talla (cm) de Juan Pérez');
    await user.type(height, '1.65');
    expect(
      screen.getByText('Escribí un número con coma decimal (por ejemplo 165,4).'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: /Guardar/ })).toBeDisabled();
    await user.clear(height);

    const weight = screen.getByLabelText('Peso (kg) de Tomás Gómez');
    await user.type(weight, '5,2');
    expect(await screen.findByText('Bajo para la edad (rango 35–150)')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '¿Quisiste decir 52?' }));
    expect(weight).toHaveValue('52');
  });

  it('saves the batch with a clientUuid per row and refreshes the list', async () => {
    const { user, api } = renderApp({
      path: PATH,
      handlers: handlers('sc', {
        recordAnthroMeasurements: () =>
          reply(201, { measurements: [{ measurement: measurement(), replayed: false }] }),
      }),
    });
    await user.type(await screen.findByLabelText('Talla (cm) de Juan Pérez'), '165,4');
    await user.click(screen.getByRole('button', { name: 'Guardar 1 medición' }));
    expect(
      await screen.findByText(
        'Guardaste 1 medición. La maduración guardada se recalcula en unos segundos.',
      ),
    ).toBeVisible();
    const [call] = api.callsTo('recordAnthroMeasurements');
    expect(call?.body).toEqual({
      measurements: [
        {
          clientUuid: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
          playerId: JUAN.id,
          measuredOn: TODAY,
          heightCm: 165.4,
        },
      ],
    });
    expect(screen.getByLabelText('Talla (cm) de Juan Pérez')).toHaveValue('');
    await waitFor(() => {
      expect(api.callsTo('listAnthroMeasurements').length).toBeGreaterThan(1);
    });
  });

  it('says nothing about coefficients verified against the publication', async () => {
    renderApp({
      path: PATH,
      handlers: handlers('sc', {
        previewAnthroMeasurements: (request) => ({
          ...previewOf(request),
          reference: {
            code: 'khamis_roche_1994',
            verification: 'verified_against_publication' as const,
          },
        }),
      }),
    });
    expect(await findSheetRow(/Tomás Gómez/)).toBeVisible();
    expect(await screen.findByText('Falta la altura de los padres')).toBeVisible();
    expect(screen.queryByText(/^Coeficientes sin verificar/)).toBeNull();
  });

  it('never saves under a date that was rejected', async () => {
    const { user, api } = renderApp({
      path: PATH,
      handlers: handlers('sc', {
        recordAnthroMeasurements: () =>
          reply(201, { measurements: [{ measurement: measurement(), replayed: false }] }),
      }),
    });
    await user.type(await screen.findByLabelText('Talla (cm) de Juan Pérez'), '165,4');
    const date = screen.getByLabelText(/^Fecha de la medición/);
    await user.clear(date);
    await user.type(date, '2999-01-01');
    expect(
      screen.getByText('Revisá la fecha: no puede ser futura ni anterior al nacimiento.'),
    ).toBeVisible();
    expect(screen.getByText('Revisá la fecha de la medición antes de guardar.')).toBeVisible();
    const save = screen.getByRole('button', { name: 'Guardar 1 medición' });
    expect(save).toBeDisabled();
    await user.click(save);
    expect(api.callsTo('recordAnthroMeasurements')).toEqual([]);

    await user.clear(date);
    await user.type(date, TODAY);
    expect(save).toBeEnabled();
  });

  it('marks the rows the API rejected, with a message of its own', async () => {
    const { user } = renderApp({
      path: PATH,
      handlers: handlers('sc', {
        recordAnthroMeasurements: () =>
          reply(400, {
            error: {
              code: 'validation_failed',
              message: 'The request breaks a rule',
              details: [
                {
                  path: ['body', 'measurements', 0, 'playerId'],
                  code: 'consent_required',
                  message: 'The player has no current data consent',
                },
              ],
            },
          }),
      }),
    });
    await user.type(await screen.findByLabelText('Peso (kg) de Tomás Gómez'), '50');
    await user.click(screen.getByRole('button', { name: 'Guardar 1 medición' }));
    expect(
      await screen.findByText('No se guardó nada: revisá las filas marcadas y volvé a guardar.'),
    ).toBeVisible();
    const tomas = sheetRow(/Tomás Gómez/);
    expect(within(tomas).getByText('Sin consentimiento de datos vigente.')).toBeVisible();
    // What was typed stays, to fix and save again.
    expect(screen.getByLabelText('Peso (kg) de Tomás Gómez')).toHaveValue('50');
  });

  it("loads the parents' heights from the sheet", async () => {
    const { user, api } = renderApp({
      path: PATH,
      handlers: handlers('sc', {
        getPlayerParentHeights: () => ({ mother: null, father: null }),
        setPlayerParentHeight: (request) => {
          const body = request.body as { heightCm: number; source: 'measured' | 'reported' };
          return {
            parent: request.params.parent as 'mother' | 'father',
            heightCm: body.heightCm,
            source: body.source,
            updatedAt: AT,
            version: VERSION,
          };
        },
      }),
    });
    const tomas = await findSheetRow(/Tomás Gómez/);
    await user.click(
      await within(tomas).findByRole('button', { name: 'Cargar altura de los padres' }),
    );
    const form = await screen.findByRole('form', { name: 'Altura de los padres de Tomás Gómez' });
    await user.type(within(form).getByLabelText('Madre (cm)'), '164,5');
    await user.type(within(form).getByLabelText('Padre (cm)'), '181');
    await user.click(within(form).getByRole('button', { name: 'Guardar alturas' }));
    expect(
      await screen.findByText('Guardaste la altura de los padres de Tomás Gómez.'),
    ).toBeVisible();
    expect(
      api.callsTo('setPlayerParentHeight').map((call) => [call.params.parent, call.body]),
    ).toEqual([
      ['mother', { heightCm: 164.5, source: 'measured' }],
      ['father', { heightCm: 181, source: 'measured' }],
    ]);
  });

  it('shows the latest measurements, pending while the worker recalculates', async () => {
    renderApp({ path: PATH, handlers: handlers('sc') });
    const table = await screen.findByRole('table', { name: 'Últimas mediciones de M15' });
    const juan = within(table).getByRole('row', { name: /Juan Pérez/ });
    expect(within(juan).getByText('01/10/2026')).toBeVisible();
    expect(within(juan).getByText(/0,8 años/)).toBeVisible();
    const tomas = within(table).getByRole('row', { name: /Tomás Gómez/ });
    expect(within(tomas).getAllByText('Calculando…')).toHaveLength(2);
  });

  it('is read only for the coach: no sheet, no preview', async () => {
    const { api } = renderApp({ path: PATH, handlers: handlers('coach') });
    expect(
      await screen.findByText(
        'Podés ver las mediciones de la categoría; la carga es del preparador físico asignado.',
      ),
    ).toBeVisible();
    expect(await screen.findByRole('table', { name: 'Últimas mediciones de M15' })).toBeVisible();
    expect(screen.queryByLabelText('Talla (cm) de Juan Pérez')).toBeNull();
    expect(api.callsTo('previewAnthroMeasurements')).toEqual([]);
  });

  it('shows an error of the list without breaking the sheet', async () => {
    renderApp({
      path: PATH,
      handlers: handlers('admin', {
        listAnthroMeasurements: () => apiError(503, 'service_unavailable'),
      }),
    });
    expect(await screen.findByLabelText('Talla (cm) de Juan Pérez')).toBeVisible();
    expect(await screen.findByRole('alert')).toBeVisible();
  });
});
