import { describe, expect, it } from 'vitest';
import { createFileUploadBodySchema } from './files.js';
import {
  attachProtocolMedia,
  listTestDefinitions,
  updateProtocolMedia,
  testDefinitionSchema,
} from './test-definitions.js';

const SHA = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';
const ID = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';

describe('test protocols (B-415)', () => {
  it('lists the versions in force by default, sorted by code', () => {
    expect(listTestDefinitions.query.parse({})).toMatchObject({ sort: 'code' });
    expect(listTestDefinitions.query.safeParse({ sport: 'polo' }).success).toBe(false);
    expect(listTestDefinitions.query.safeParse({ validOn: '01/03/2026' }).success).toBe(false);
  });

  it('describes a version with its protocol and metrics', () => {
    const parsed = testDefinitionSchema.parse({
      id: ID,
      code: 'cmj',
      version: 1,
      sports: null,
      attemptCount: 3,
      attemptAggregation: 'best',
      maximalLoad: false,
      protocol: {
        summary: 'Salto con contramovimiento.',
        steps: ['Manos en la cintura.'],
        restBetweenAttemptsS: 60,
        equipment: ['celular con trípode'],
        parameters: { gravityMs2: 9.81, ift: { stageS: 45 } },
      },
      metrics: [{ code: 'cmj_height_cm', unit: 'cm', isDerived: false }],
      validFrom: '2026-01-01',
      validTo: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed.metrics[0]?.unit).toBe('cm');
  });

  it('uploads protocol media as raster images or web video only', () => {
    const base = { kind: 'protocol_media', sizeBytes: 10, checksumSha256: SHA };
    for (const contentType of [
      'image/png',
      'image/jpeg',
      'image/webp',
      'video/mp4',
      'video/webm',
    ]) {
      expect(createFileUploadBodySchema.safeParse({ ...base, contentType }).success).toBe(true);
    }
    expect(
      createFileUploadBodySchema.safeParse({ ...base, contentType: 'image/svg+xml' }).success,
    ).toBe(false);
    expect(
      createFileUploadBodySchema.safeParse({ ...base, contentType: 'image/png', playerId: ID })
        .success,
    ).toBe(false);
  });

  it('needs a caption (the text alternative) to attach media', () => {
    expect(attachProtocolMedia.body.safeParse({ fileId: ID }).success).toBe(false);
    expect(attachProtocolMedia.body.safeParse({ fileId: ID, caption: '   ' }).success).toBe(false);
    expect(attachProtocolMedia.body.parse({ fileId: ID, caption: ' Salida ' }).caption).toBe(
      'Salida',
    );
    expect(
      attachProtocolMedia.body.safeParse({ fileId: ID, caption: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(
      attachProtocolMedia.body.safeParse({ fileId: ID, caption: 'Salida', sortOrder: 1000 })
        .success,
    ).toBe(false);
  });

  it('edits at a version', () => {
    expect(updateProtocolMedia.body.safeParse({ caption: 'Salida' }).success).toBe(false);
    expect(updateProtocolMedia.body.safeParse({ version: '1', caption: 'Salida' }).success).toBe(
      true,
    );
  });
});
