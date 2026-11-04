import type { ProtocolMediaDto, TestDefinitionDto } from '@sport-performance/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError } from '../../test/fake-api';
import * as fixtures from '../../test/fixtures';
import { renderApp, signedIn } from '../../test/render-app';

const AT = '2026-03-01T12:00:00.000Z';
const SPRINT_ID = '0192e7a0-4444-7000-8000-000000000001';
const CMJ_ID = '0192e7a0-4444-7000-8000-000000000002';
const FILE_ID = '0192e7a0-5555-7000-8000-000000000001';
const MEDIA_ID = '0192e7a0-6666-7000-8000-000000000001';
const SHA = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';

function definition(overrides: Partial<TestDefinitionDto> = {}): TestDefinitionDto {
  return {
    id: SPRINT_ID as TestDefinitionDto['id'],
    code: 'sprint_40',
    version: 1,
    sports: null,
    attemptCount: 3,
    attemptAggregation: 'best',
    maximalLoad: false,
    protocol: {
      summary: 'Sprint de 40 m con parciales a 10 y 20 m.',
      steps: ['Salida parado a 0,5 m detrás de la línea.', 'Fotocélulas en 0, 10, 20 y 40 m.'],
      restBetweenAttemptsS: 180,
      equipment: ['fotocélulas', 'conos'],
      parameters: { vmaxFromM: 20, vmaxToM: 40 },
    },
    metrics: [
      { code: 'sprint_40_s', unit: 's', isDerived: false },
      { code: 'sprint_vmax_ms', unit: 'ms', isDerived: true },
    ],
    validFrom: '2026-01-01' as TestDefinitionDto['validFrom'],
    validTo: null,
    createdAt: AT,
    updatedAt: AT,
    ...overrides,
  };
}

const SPRINT = definition();
const CMJ = definition({
  id: CMJ_ID as TestDefinitionDto['id'],
  code: 'cmj',
  protocol: {
    summary: 'Salto con contramovimiento, manos en la cintura.',
    steps: [],
    restBetweenAttemptsS: 45,
    equipment: [],
    parameters: {},
  },
  metrics: [{ code: 'cmj_height_cm', unit: 'cm', isDerived: false }],
});

function uploadedFile(status: 'pending' | 'ready' = 'ready') {
  return {
    id: FILE_ID as ProtocolMediaDto['file']['id'],
    kind: 'protocol_media' as const,
    status,
    playerId: null,
    categoryId: null,
    contentType: 'image/png',
    sizeBytes: 4,
    checksumSha256: SHA,
    fileName: 'salida.png',
    testResultId: null,
    testEntryId: null,
    uploadedAt: status === 'ready' ? AT : null,
    expiresAt: status === 'ready' ? null : '2026-03-02T12:00:00.000Z',
    deletedAt: null,
    createdBy: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

function media(overrides: Partial<ProtocolMediaDto> = {}): ProtocolMediaDto {
  return {
    id: MEDIA_ID as ProtocolMediaDto['id'],
    testDefinitionId: SPRINT_ID as ProtocolMediaDto['testDefinitionId'],
    file: uploadedFile(),
    caption: 'Posición de salida',
    sortOrder: 0,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: '1700000000000000',
    ...overrides,
  };
}

const protocolHandlers = {
  listTestDefinitions: () => fixtures.page([CMJ, SPRINT]),
  getTestDefinition: () => SPRINT,
  listProtocolMedia: () => fixtures.page([media()]),
  getFileDownload: () => ({
    url: 'https://bucket.test/clubs/orc/protocol_media/file',
    expiresAt: '2026-03-01T12:05:00.000Z',
  }),
};

describe('help: protocols', () => {
  it('lists the protocols in force of the sport the coach sees', async () => {
    const { api, user } = renderApp({
      path: '/',
      handlers: { ...signedIn(), ...protocolHandlers },
    });
    await user.click(await screen.findByRole('link', { name: 'Ayuda' }));
    expect(await screen.findByRole('heading', { name: 'Ayuda' })).toBeVisible();
    const sprint = await screen.findByRole('link', {
      name: 'Ver el protocolo de Sprint 10/20/40 m',
    });
    expect(sprint).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Ver el protocolo de Salto con contramovimiento (CMJ)' }),
    ).toBeVisible();
    expect(
      screen.getAllByText(/Versión 1 · Vigente desde el 01\/01\/2026 · 3 intentos, vale el mejor/),
    ).toHaveLength(2);
    // Only rugby categories: the list is of rugby (and every-sport) tests.
    expect(api.callsTo('listTestDefinitions')[0]?.url.searchParams.get('sport')).toBe('rugby');
    expect(screen.getByRole('link', { name: 'Protocolos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(api.unhandled).toEqual([]);
  });

  it('shows a protocol with its steps, rest, equipment and metrics; the coach only watches the media', async () => {
    const { api } = renderApp({
      path: `/help/protocols/${SPRINT_ID}`,
      handlers: { ...signedIn(), ...protocolHandlers },
    });
    expect(
      await screen.findByRole('heading', { name: 'Sprint 10/20/40 m', level: 1 }),
    ).toBeVisible();
    expect(screen.getByText('Versión 1 · Vigente desde el 01/01/2026')).toBeVisible();
    const summary = screen.getByRole('region', { name: 'Resumen' });
    expect(within(summary).getByText('Sprint de 40 m con parciales a 10 y 20 m.')).toBeVisible();
    expect(screen.getByText('Pausa entre intentos: 3 minutos')).toBeVisible();
    expect(screen.getByText('Salida parado a 0,5 m detrás de la línea.')).toBeVisible();
    expect(screen.getByText('fotocélulas')).toBeVisible();
    expect(screen.getByText('sprint_vmax_ms')).toBeVisible();
    expect(screen.getByText('se calcula')).toBeVisible();
    expect(
      screen.getByText(/Registrá siempre el método, el evaluador y las condiciones/),
    ).toBeVisible();
    const image = await screen.findByRole('img', { name: 'Posición de salida' });
    expect(image).toHaveAttribute('src', 'https://bucket.test/clubs/orc/protocol_media/file');
    expect(screen.queryByRole('button', { name: 'Agregar' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Sacar «Posición de salida» del protocolo' }),
    ).toBeNull();
    expect(api.callsTo('getFileDownload')[0]?.params).toEqual({ fileId: FILE_ID });
  });

  it('says so when the protocol does not exist', async () => {
    renderApp({
      path: `/help/protocols/${SPRINT_ID}`,
      handlers: {
        ...signedIn(),
        ...protocolHandlers,
        getTestDefinition: () => apiError(404, 'not_found'),
      },
    });
    expect(await screen.findByText('No encontramos ese protocolo.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Volver a los protocolos' })).toBeVisible();
  });

  it('lets sc upload an image straight to the bucket and attach it with its description', async () => {
    let attached = false;
    const { api, user, uploads } = renderApp({
      path: `/help/protocols/${CMJ_ID}`,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...protocolHandlers,
        getTestDefinition: () => CMJ,
        listProtocolMedia: () =>
          fixtures.page(
            attached
              ? [
                  media({
                    testDefinitionId: CMJ_ID as ProtocolMediaDto['testDefinitionId'],
                    caption: 'Manos en la cintura',
                  }),
                ]
              : [],
          ),
        createFileUpload: () => ({
          file: uploadedFile('pending'),
          upload: {
            method: 'PUT' as const,
            url: 'https://bucket.test/upload',
            headers: { 'content-type': 'image/png', 'x-amz-checksum-sha256': SHA },
            expiresAt: '2026-03-01T12:15:00.000Z',
          },
        }),
        confirmFileUpload: () => uploadedFile('ready'),
        attachProtocolMedia: () => {
          attached = true;
          return media({
            testDefinitionId: CMJ_ID as ProtocolMediaDto['testDefinitionId'],
            caption: 'Manos en la cintura',
          });
        },
      },
    });
    expect(
      await screen.findByText('Este protocolo todavía no tiene imágenes ni videos.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(await screen.findByText('Elegí un archivo.')).toBeVisible();
    expect(screen.getByText('Escribí una descripción.')).toBeVisible();

    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'salida.png', {
      type: 'image/png',
    });
    await user.upload(screen.getByLabelText('Archivo'), png);
    await user.type(screen.getByLabelText('Descripción'), '  Manos en la cintura ');
    await user.click(screen.getByRole('button', { name: 'Agregar' }));

    expect(await screen.findByText('Listo: agregamos «Manos en la cintura».')).toBeVisible();
    const created = api.callsTo('createFileUpload')[0]?.body as Record<string, unknown>;
    expect(created).toMatchObject({
      kind: 'protocol_media',
      contentType: 'image/png',
      sizeBytes: 4,
      fileName: 'salida.png',
    });
    expect(created.checksumSha256).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.url).toBe('https://bucket.test/upload');
    expect(uploads[0]?.headers['x-amz-checksum-sha256']).toBe(SHA);
    expect(api.callsTo('confirmFileUpload')[0]?.params).toEqual({ fileId: FILE_ID });
    expect(api.callsTo('attachProtocolMedia')[0]).toMatchObject({
      params: { testDefinitionId: CMJ_ID },
      body: { fileId: FILE_ID, caption: 'Manos en la cintura' },
    });
    expect(await screen.findByRole('img', { name: 'Manos en la cintura' })).toBeVisible();
    expect(api.unhandled).toEqual([]);
  });

  it('refuses a file type the bucket would not take', async () => {
    const { api, user } = renderApp({
      path: `/help/protocols/${CMJ_ID}`,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('admin')] }),
        ...protocolHandlers,
        getTestDefinition: () => CMJ,
        listProtocolMedia: () => fixtures.page([]),
      },
    });
    const svg = new File(['<svg/>'], 'dibujo.svg', { type: 'image/svg+xml' });
    // The picker filters by `accept`; a drop or another browser may still hand one over.
    fireEvent.change(await screen.findByLabelText('Archivo'), { target: { files: [svg] } });
    await user.type(screen.getByLabelText('Descripción'), 'Dibujo');
    await user.click(screen.getByRole('button', { name: 'Agregar' }));
    expect(
      await screen.findByText('Ese tipo de archivo no se acepta. Usá PNG, JPEG, WebP, MP4 o WebM.'),
    ).toBeVisible();
    expect(api.callsTo('createFileUpload')).toHaveLength(0);
  });

  it('lets sc edit the description and remove the media from the protocol', async () => {
    let current = media();
    const { api, user } = renderApp({
      path: `/help/protocols/${SPRINT_ID}`,
      handlers: {
        ...signedIn({ memberships: [fixtures.membership('sc')] }),
        ...protocolHandlers,
        listProtocolMedia: () => fixtures.page(current.archivedAt === null ? [current] : []),
        updateProtocolMedia: (request) => {
          current = { ...current, caption: (request.body as { caption: string }).caption };
          return current;
        },
        archiveProtocolMedia: () => {
          current = { ...current, archivedAt: AT };
          return current;
        },
      },
    });
    await user.click(
      await screen.findByRole('button', { name: 'Editar la descripción de «Posición de salida»' }),
    );
    // The edit form comes first; the add form below has its own.
    const [field] = screen.getAllByLabelText('Descripción');
    if (field === undefined) throw new Error('no caption field');
    await user.clear(field);
    await user.type(field, 'Salida con el pie adelantado');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Guardamos la descripción.')).toBeVisible();
    expect(api.callsTo('updateProtocolMedia')[0]?.body).toEqual({
      version: '1700000000000000',
      caption: 'Salida con el pie adelantado',
    });
    await user.click(
      await screen.findByRole('button', {
        name: 'Sacar «Salida con el pie adelantado» del protocolo',
      }),
    );
    await waitFor(() => {
      expect(screen.getByText('Este protocolo todavía no tiene imágenes ni videos.')).toBeVisible();
    });
    expect(api.callsTo('archiveProtocolMedia')[0]?.params).toEqual({
      testDefinitionId: SPRINT_ID,
      mediaId: MEDIA_ID,
    });
  });
});

describe('help: guide', () => {
  it('walks the staff through the platform, with the medical disclaimer', async () => {
    const { user } = renderApp({
      path: '/help',
      handlers: { ...signedIn(), ...protocolHandlers },
    });
    await user.click(await screen.findByRole('link', { name: 'Guía de uso' }));
    expect(await screen.findByRole('heading', { name: 'Bienestar y RPE' })).toBeVisible();
    for (const title of [
      'Qué ve cada uno',
      'Sesiones y carga',
      'Días de test',
      'Maduración',
      'Alertas',
      'Menores y privacidad',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeVisible();
    }
    expect(screen.getByText(/no predicen lesiones ni diagnostican/)).toBeVisible();
    expect(
      screen.getByText(
        'Esta app monitorea la carga de entrenamiento. No diagnostica ni reemplaza al staff médico.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Guía de uso' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
