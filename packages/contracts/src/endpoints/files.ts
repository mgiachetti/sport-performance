import {
  FILE_KINDS,
  FILE_KIND_POLICIES,
  FILE_NAME_MAX_LENGTH,
  FILE_STATUSES,
  SHA256_BASE64_PATTERN,
  type FileKind,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { clientUuidSchema, sortQuerySchema } from '../primitives/conventions.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { categoryIdSchema, playerIdSchema, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { fileIdSchema } from './clubs.js';
import { testEntryIdSchema, testResultIdSchema } from './tests.js';

/**
 * Uploaded files (B-325, ADR 0044): CMJ videos, the crest of the club,
 * reports and spreadsheets to import. The bytes never go through the API:
 * the client asks for a signed upload URL, sends the file straight to the
 * bucket and confirms it; downloads are short-lived signed URLs.
 */

export const fileKindSchema = z.enum(FILE_KINDS).meta({
  id: 'FileKind',
  description:
    '`club_logo` (escudo del club), `cmj_video` (video del CMJ de un jugador), `pdf_report` (informe de un jugador, lo genera el sistema), `data_import` (planilla a importar), `protocol_media` (imagen o video de cómo se hace un test), `data_export` (ZIP con los CSV de una exportación de datos del club, lo genera el sistema; se baja por `GET /v1/data-exports/{exportId}/download`) o `category_report` (informe de una categoría por ventana, lo genera el sistema).',
});

export const fileStatusSchema = z.enum(FILE_STATUSES).meta({
  id: 'FileStatus',
  description:
    '`pending` (falta subir o confirmar), `ready` (subido y verificado) o `deleted` (vencido o borrado: el contenido ya no se puede bajar).',
});

export const checksumSha256Schema = z
  .string()
  .regex(SHA256_BASE64_PATTERN)
  .meta({
    description:
      'SHA-256 del contenido en base64 (44 caracteres). El bucket rechaza cualquier otro contenido.',
    examples: ['47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='],
  });

export const fileNameSchema = z
  .string()
  .min(1)
  .max(FILE_NAME_MAX_LENGTH)
  .meta({
    description:
      'Nombre original, para la descarga. Se guarda sin carpetas ni caracteres de control.',
    examples: ['salto-1.mp4'],
  });

export const fileSchema = z
  .object({
    id: fileIdSchema,
    kind: fileKindSchema,
    status: fileStatusSchema,
    playerId: playerIdSchema.nullable().meta({ description: 'Jugador/a del video o del informe.' }),
    categoryId: categoryIdSchema
      .nullable()
      .meta({ description: 'Categoría de una importación; `null` si es de todo el club.' }),
    contentType: z
      .string()
      .min(3)
      .meta({ examples: ['video/mp4'] }),
    sizeBytes: z.int().min(1),
    checksumSha256: checksumSha256Schema,
    fileName: fileNameSchema.nullable(),
    testResultId: testResultIdSchema.nullable().meta({
      description:
        'Resultado del CMJ del intento que muestra el video; `null` si no es de un intento (o el resultado se borró).',
    }),
    testEntryId: testEntryIdSchema.nullable().meta({
      description: 'Intento (`cmj_video_frames`) del resultado que muestra el video.',
    }),
    uploadedAt: dateTimeSchema
      .nullable()
      .meta({ description: 'Cuándo se confirmó la subida; `null` mientras está pendiente.' }),
    expiresAt: dateTimeSchema.nullable().meta({
      description:
        'Cuándo se borra (retención de su tipo, o fin de la ventana de subida si está pendiente); `null` si no vence (el escudo en uso).',
    }),
    deletedAt: dateTimeSchema.nullable(),
    createdBy: userIdSchema.nullable().meta({ description: 'Quién lo subió.' }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .meta({
    id: 'File',
    description: 'Un archivo subido: qué es, de quién y hasta cuándo se guarda.',
  });

export const fileUploadSchema = z
  .object({
    method: z.literal('PUT'),
    url: z.url().meta({ description: 'URL firmada del bucket.' }),
    headers: z.record(z.string(), z.string()).meta({
      description:
        'Headers que hay que mandar tal cual (`Content-Type`, `x-amz-checksum-sha256`). El largo también está firmado: el cuerpo tiene que ser exactamente `sizeBytes`.',
    }),
    expiresAt: dateTimeSchema.meta({
      description: 'La URL vence; después, pedir otra con el mismo `clientUuid`.',
    }),
  })
  .meta({ id: 'FileUpload', description: 'Cómo subir el contenido directamente al bucket.' });

export const createdFileSchema = z
  .object({
    file: fileSchema,
    upload: fileUploadSchema.nullable().meta({
      description: '`null` si el archivo ya no está pendiente (reenvío de un alta ya confirmada).',
    }),
  })
  .meta({ id: 'CreatedFile' });

export const fileDownloadSchema = z
  .object({
    url: z.url().meta({ description: 'URL firmada de vida corta; no se guarda ni se comparte.' }),
    expiresAt: dateTimeSchema,
  })
  .meta({ id: 'FileDownload' });

export type UploadedFile = z.output<typeof fileSchema>;
export type FileUpload = z.output<typeof fileUploadSchema>;
export type CreatedFile = z.output<typeof createdFileSchema>;
export type FileDownload = z.output<typeof fileDownloadSchema>;

const MIB = 1024 * 1024;

/** The fields every upload declares, with the limits of its kind. */
function uploadFields<K extends FileKind>(kind: K) {
  const policy = FILE_KIND_POLICIES[kind];
  return {
    kind: z.literal(kind),
    clientUuid: clientUuidSchema.optional(),
    contentType: z.enum(policy.contentTypes).meta({ description: 'Tipo MIME, sin parámetros.' }),
    sizeBytes: z
      .int()
      .min(1)
      .max(policy.maxSizeBytes)
      .meta({
        description: `Tamaño exacto en bytes; hasta ${String(policy.maxSizeBytes / MIB)} MiB.`,
      }),
    checksumSha256: checksumSha256Schema,
    fileName: fileNameSchema.optional(),
  };
}

export const createFileUploadBodySchema = z
  .discriminatedUnion('kind', [
    z.strictObject(uploadFields('club_logo')).meta({ title: 'Escudo del club' }),
    z
      .strictObject({
        ...uploadFields('cmj_video'),
        playerId: playerIdSchema,
        testResultId: testResultIdSchema.optional().meta({
          description:
            'Resultado del CMJ del intento que muestra el video (con `testEntryId`): un intento `cmj_video_frames` no anulado del mismo jugador. Un solo video vivo por intento.',
        }),
        testEntryId: testEntryIdSchema.optional().meta({
          description:
            'El `id` del intento (el `clientUuid` con el que se cargó), con `testResultId`.',
        }),
      })
      .refine((body) => (body.testResultId === undefined) === (body.testEntryId === undefined), {
        message: 'testResultId and testEntryId go together',
        path: ['testEntryId'],
      })
      .meta({ title: 'Video del CMJ' }),
    z
      .strictObject({
        ...uploadFields('data_import'),
        categoryId: categoryIdSchema.optional().meta({
          description:
            'Categoría de la importación; sin ella, es de todo el club (solo la administración).',
        }),
      })
      .meta({ title: 'Planilla a importar' }),
    z
      .strictObject(uploadFields('protocol_media'))
      .meta({ title: 'Imagen o video de un protocolo' }),
  ])
  .meta({ id: 'CreateFileUpload' });

const fileParams = z.strictObject({ fileId: fileIdSchema });

const ACCESS =
  'El escudo lo sube la administración y lo ve todo miembro; el video del CMJ lo sube `sc` (asignado) o la administración y lo ven el jugador, `coach`, `sc` y la administración, siempre con **consentimiento de imagen vigente**; el informe lo ven quienes ven la ficha resumida; la planilla, quien puede importar; la imagen o el video de un protocolo los suben `sc` y la administración y los ve el staff.';

export const createFileUpload = defineEndpoint({
  method: 'POST',
  path: '/v1/files',
  summary: 'Pedir una subida',
  description: `Crea el archivo \`pending\` y devuelve la URL firmada para subir el contenido directo al bucket con \`PUT\`; después, \`POST /v1/files/{fileId}/confirm\`. El tipo, el tamaño y el SHA-256 quedan firmados. ${ACCESS} El video de un intento del CMJ (\`testResultId\` + \`testEntryId\`) exige que el intento sea \`cmj_video_frames\`, no esté anulado y sea del mismo jugador (si no, \`validation_failed\`); si el intento ya tiene un video vivo, \`conflict\`. Idempotente por \`clientUuid\`: reenviar devuelve el mismo archivo con una URL nueva mientras siga pendiente; el mismo \`clientUuid\` con otro archivo (tipo, jugador, intento, categoría, tipo MIME, tamaño, SHA-256 o nombre distintos) es \`conflict\`.`,
  tags: ['files'],
  auth: 'club',
  body: createFileUploadBodySchema,
  response: {
    status: 201,
    description: 'Archivo pendiente y cómo subirlo.',
    schema: createdFileSchema,
  },
  errors: ['not_found', 'conflict', 'service_unavailable'],
});

export const confirmFileUpload = defineEndpoint({
  method: 'POST',
  path: '/v1/files/{fileId}/confirm',
  summary: 'Confirmar una subida',
  description:
    'Verifica que el bucket tenga exactamente el contenido declarado (tamaño, tipo y SHA-256) y deja el archivo `ready`, con su retención. Sin contenido todavía, o con otro (se descarta): `conflict`. Vencida la ventana de subida: `conflict` (pedir otra). Idempotente.',
  tags: ['files'],
  auth: 'club',
  params: fileParams,
  response: { status: 200, description: 'El archivo, listo.', schema: fileSchema },
  errors: ['not_found', 'conflict', 'service_unavailable'],
});

export const listFiles = defineEndpoint({
  method: 'GET',
  path: '/v1/files',
  summary: 'Archivos del club',
  description: `De un tipo. ${ACCESS} Para los videos, una página puede traer menos de \`limit\` (se omiten los de jugadores sin consentimiento de imagen): seguir con \`nextCursor\` hasta que sea \`null\`.`,
  tags: ['files'],
  auth: 'club',
  query: pageQuerySchema.extend({
    kind: fileKindSchema,
    playerId: playerIdSchema.optional(),
    categoryId: categoryIdSchema.optional(),
    status: z
      .enum([...FILE_STATUSES, 'all'])
      .default('ready')
      .meta({
        description:
          '`ready` por defecto; `pending`, `deleted` o `all`. Los escudos pendientes o borrados los ve solo la administración: al resto se le listan solo los `ready`.',
      }),
    sort: sortQuerySchema(['createdAt', 'sizeBytes'], '-createdAt'),
  }),
  response: {
    status: 200,
    description: 'Página de archivos.',
    schema: pageOf(fileSchema).meta({ id: 'FilePage' }),
  },
  errors: ['bad_request'],
});

export const getFile = defineEndpoint({
  method: 'GET',
  path: '/v1/files/{fileId}',
  summary: 'Un archivo',
  description: `Sus datos, sin el contenido. ${ACCESS} De otro club, o un escudo pendiente o borrado para quien no es de la administración: \`not_found\`.`,
  tags: ['files'],
  auth: 'club',
  params: fileParams,
  response: { status: 200, description: 'El archivo.', schema: fileSchema },
  errors: ['not_found'],
});

export const getFileDownload = defineEndpoint({
  method: 'GET',
  path: '/v1/files/{fileId}/download',
  summary: 'Bajar un archivo',
  description: `URL firmada de vida corta (minutos) para bajar o reproducir el contenido; solo de un archivo \`ready\` (si no: \`conflict\`). ${ACCESS}`,
  tags: ['files'],
  auth: 'club',
  params: fileParams,
  response: { status: 200, description: 'URL de descarga.', schema: fileDownloadSchema },
  errors: ['not_found', 'conflict', 'service_unavailable'],
});

export const deleteFile = defineEndpoint({
  method: 'DELETE',
  path: '/v1/files/{fileId}',
  summary: 'Borrar un archivo',
  description:
    'El contenido deja de poder bajarse en el acto y el job de retención lo borra del bucket cuando ya no queda viva ninguna URL de subida que se haya entregado (hasta una hora y unos minutos después); el registro queda con `status: deleted`. Videos: `sc` asignado o la administración; escudo, informes y planillas: la administración (la planilla, también quien puede importarla). El escudo en uso y el material adjunto a un protocolo activo no se borran (`conflict`: cambiarlo o sacarlo antes). Material de protocolos: `sc` y la administración. Idempotente.',
  tags: ['files'],
  auth: 'club',
  params: fileParams,
  response: { status: 200, description: 'El archivo, borrado.', schema: fileSchema },
  errors: ['not_found', 'conflict'],
});
