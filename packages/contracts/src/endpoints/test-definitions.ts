import {
  ATTEMPT_AGGREGATIONS,
  PROTOCOL_MEDIA_CAPTION_MAX_LENGTH,
  UNIT_CODES,
  type UnitCode,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  archivedAtSchema,
  archiveStatusQuerySchema,
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
  sportSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { idOf } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { fileIdSchema } from './clubs.js';
import { fileSchema } from './files.js';
import { metricCodeSchema, testCodeSchema, testDefinitionIdSchema } from './tests.js';

/**
 * Test protocols (B-415, ADR 0067): every version of every test of the club
 * with its protocol (what the evaluator reads before measuring) and the
 * metrics it produces, plus the images and videos that show how it is done.
 * The protocol text is club data in the club's language; changing it is a
 * new version (principle 4), never an edit.
 */

/** Highest position of a media item in its protocol. */
export const PROTOCOL_MEDIA_SORT_ORDER_MAX = 999;

export const protocolMediaIdSchema = idOf('imagen o video de un protocolo');

const UNIT_VALUES = UNIT_CODES as [UnitCode, ...UnitCode[]];

const protocolParameterValueSchema = z.union([z.number(), z.string(), z.boolean()]);

export const testProtocolSchema = z
  .object({
    summary: z
      .string()
      .nullable()
      .meta({ description: 'Resumen: entrada en calor, intentos y pausas.' }),
    steps: z
      .array(z.string())
      .meta({ description: 'Pasos en orden, tal como los lee el evaluador.' }),
    restBetweenAttemptsS: z
      .number()
      .min(0)
      .nullable()
      .meta({ description: 'Pausa entre intentos, en segundos; `null` si no aplica.' }),
    equipment: z.array(z.string()).meta({ description: 'Equipo necesario.' }),
    parameters: z
      .record(
        z.string(),
        z.union([protocolParameterValueSchema, z.record(z.string(), protocolParameterValueSchema)]),
      )
      .meta({
        description:
          'Ajustes numéricos y de código de los que depende el cálculo (umbrales del sprint, progresión del 30-15, rango del e1RM). Son parte de la versión.',
      }),
  })
  .meta({ id: 'TestProtocol', description: 'El protocolo de una versión del test.' });

export type TestProtocolDto = z.output<typeof testProtocolSchema>;

export const testDefinitionMetricSchema = z
  .object({
    code: metricCodeSchema,
    unit: z.enum(UNIT_VALUES),
    isDerived: z
      .boolean()
      .meta({ description: 'Se calcula desde otras métricas del resultado (no se carga).' }),
  })
  .meta({ id: 'TestDefinitionMetric' });

export const testDefinitionSchema = z
  .object({
    id: testDefinitionIdSchema,
    code: testCodeSchema,
    version: z.int().min(1).meta({ description: 'Versión del protocolo (principio 4).' }),
    sports: z
      .array(sportSchema)
      .nullable()
      .meta({ description: 'Deportes donde aplica; `null` = todos.' }),
    attemptCount: z.int().min(1).meta({ description: 'Intentos planificados.' }),
    attemptAggregation: z.enum(ATTEMPT_AGGREGATIONS).meta({
      description: 'Cuál vale: el mejor intento (`best`) o el promedio (`mean`).',
    }),
    maximalLoad: z
      .boolean()
      .meta({ description: 'Test máximo con carga: nunca en M13/M14 (principio 3).' }),
    protocol: testProtocolSchema,
    metrics: z
      .array(testDefinitionMetricSchema)
      .meta({ description: 'Métricas que produce, en el orden del diccionario.' }),
    validFrom: localDateSchema,
    validTo: localDateSchema
      .nullable()
      .meta({ description: 'Fin de la vigencia (exclusivo); `null` = sigue vigente.' }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .meta({
    id: 'TestDefinition',
    description: 'Una versión del protocolo de un test, con las métricas que produce.',
  });

export type TestDefinitionDto = z.output<typeof testDefinitionSchema>;

const testDefinitionParams = z.strictObject({ testDefinitionId: testDefinitionIdSchema });

export const listTestDefinitions = defineEndpoint({
  method: 'GET',
  path: '/v1/test-definitions',
  summary: 'Tests y protocolos del club',
  description:
    'Cada versión del protocolo de cada test, con su texto y sus métricas. Por defecto, las vigentes hoy en el club (`validOn`); `validOn` con otra fecha, las de ese día. La ve todo miembro del club (`metric_catalog.read`): el texto del protocolo no es un dato personal.',
  tags: ['tests'],
  auth: 'club',
  query: pageQuerySchema.extend({
    code: testCodeSchema.optional(),
    sport: sportSchema
      .optional()
      .meta({ description: 'Solo los que aplican al deporte (incluye los de todos).' }),
    validOn: localDateSchema
      .optional()
      .meta({ description: 'Día del club; por defecto, hoy en su zona horaria.' }),
    sort: sortQuerySchema(['code', 'version'], 'code'),
  }),
  response: {
    status: 200,
    description: 'Página de versiones de protocolos.',
    schema: pageOf(testDefinitionSchema).meta({ id: 'TestDefinitionPage' }),
  },
  errors: ['bad_request'],
});

export const getTestDefinition = defineEndpoint({
  method: 'GET',
  path: '/v1/test-definitions/{testDefinitionId}',
  summary: 'Un protocolo',
  description: 'Una versión del protocolo, vigente o no. Mismo permiso que la lista.',
  tags: ['tests'],
  auth: 'club',
  params: testDefinitionParams,
  response: { status: 200, description: 'La versión del protocolo.', schema: testDefinitionSchema },
  errors: ['not_found'],
});

export const protocolMediaCaptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(PROTOCOL_MEDIA_CAPTION_MAX_LENGTH)
  .meta({
    description:
      'Texto alternativo de la imagen o descripción del video: qué muestra, para quien no lo ve.',
    examples: ['Posición de salida: pie adelantado a 0,5 m de la línea'],
  });

export const protocolMediaSortOrderSchema = z
  .int()
  .min(0)
  .max(PROTOCOL_MEDIA_SORT_ORDER_MAX)
  .meta({ description: 'Lugar en el protocolo; a igual orden, el más viejo primero.' });

export const protocolMediaSchema = z
  .object({
    id: protocolMediaIdSchema,
    testDefinitionId: testDefinitionIdSchema,
    file: fileSchema,
    caption: protocolMediaCaptionSchema,
    sortOrder: protocolMediaSortOrderSchema,
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({
    id: 'ProtocolMedia',
    description:
      'Una imagen o un video del protocolo. El contenido se pide con `GET /v1/files/{fileId}/download`.',
  });

export type ProtocolMediaDto = z.output<typeof protocolMediaSchema>;

const MEDIA_ACCESS =
  'Lo ve el staff (`configuration.read`: un video puede mostrar a una persona); lo adjuntan, editan y archivan `sc` y la administración (`configuration.update`).';

const protocolMediaParams = z.strictObject({
  testDefinitionId: testDefinitionIdSchema,
  mediaId: protocolMediaIdSchema,
});

export const listProtocolMedia = defineEndpoint({
  method: 'GET',
  path: '/v1/test-definitions/{testDefinitionId}/media',
  summary: 'Imágenes y videos de un protocolo',
  description: `En el orden del protocolo. ${MEDIA_ACCESS}`,
  tags: ['tests'],
  auth: 'club',
  params: testDefinitionParams,
  query: pageQuerySchema.extend({
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['sortOrder', 'createdAt'], 'sortOrder'),
  }),
  response: {
    status: 200,
    description: 'Página de imágenes y videos.',
    schema: pageOf(protocolMediaSchema).meta({ id: 'ProtocolMediaPage' }),
  },
  errors: ['not_found', 'bad_request'],
});

export const attachProtocolMedia = defineEndpoint({
  method: 'POST',
  path: '/v1/test-definitions/{testDefinitionId}/media',
  summary: 'Adjuntar una imagen o un video a un protocolo',
  description: `El archivo tiene que ser un \`protocol_media\` del club ya confirmado (\`POST /v1/files\` y \`/confirm\`). Mientras esté adjunto a un protocolo activo no vence; el mismo archivo una sola vez por versión (\`conflict\`). ${MEDIA_ACCESS} Idempotente por \`clientUuid\`.`,
  tags: ['tests'],
  auth: 'club',
  params: testDefinitionParams,
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    fileId: fileIdSchema,
    caption: protocolMediaCaptionSchema,
    sortOrder: protocolMediaSortOrderSchema
      .optional()
      .meta({ description: 'Por defecto, al final.' }),
  }),
  response: { status: 201, description: 'Adjuntado.', schema: protocolMediaSchema },
  errors: ['not_found', 'conflict'],
});

export const updateProtocolMedia = defineEndpoint({
  method: 'PATCH',
  path: '/v1/test-definitions/{testDefinitionId}/media/{mediaId}',
  summary: 'Editar el texto o el orden de una imagen o un video',
  description: `${MEDIA_ACCESS} Archivado: \`conflict\` (restaurarlo antes). \`version\` desactualizada: \`conflict\`.`,
  tags: ['tests'],
  auth: 'club',
  params: protocolMediaParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    caption: protocolMediaCaptionSchema.optional(),
    sortOrder: protocolMediaSortOrderSchema.optional(),
  }),
  response: { status: 200, description: 'Actualizado.', schema: protocolMediaSchema },
  errors: ['not_found', 'conflict'],
});

export const archiveProtocolMedia = defineEndpoint({
  method: 'POST',
  path: '/v1/test-definitions/{testDefinitionId}/media/{mediaId}/archive',
  summary: 'Sacar una imagen o un video del protocolo',
  description: `Deja de mostrarse. Si ningún otro protocolo activo usa el archivo, vence a los 30 días (se puede restaurar mientras tanto). ${MEDIA_ACCESS} Idempotente.`,
  tags: ['tests'],
  auth: 'club',
  params: protocolMediaParams,
  response: { status: 200, description: 'Archivado.', schema: protocolMediaSchema },
  errors: ['not_found'],
});

export const restoreProtocolMedia = defineEndpoint({
  method: 'POST',
  path: '/v1/test-definitions/{testDefinitionId}/media/{mediaId}/restore',
  summary: 'Volver a mostrar una imagen o un video',
  description: `Solo si el archivo sigue disponible (no venció ni se borró: si no, \`conflict\`); vuelve a no vencer. ${MEDIA_ACCESS} Idempotente.`,
  tags: ['tests'],
  auth: 'club',
  params: protocolMediaParams,
  response: { status: 200, description: 'Restaurado.', schema: protocolMediaSchema },
  errors: ['not_found', 'conflict'],
});
