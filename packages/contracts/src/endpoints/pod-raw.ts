import {
  FILE_KIND_POLICIES,
  POD_CHIP_ID_PATTERN,
  POD_RAW_ISSUE_CODES,
  POD_RAW_PENDING_DAYS_MAX,
  POD_RAW_PENDING_DAYS_MIN,
  POD_RAW_REJECTION_REASONS,
  POD_RAW_UPLOAD_STATES,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
} from '../primitives/conventions.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { idOf, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { fileIdSchema } from './clubs.js';
import { fileUploadSchema } from './files.js';
import { podIdSchema } from './pods.js';

/**
 * Ingestion of the pod's NAND log (B-916, ADR 0106, ADR 0108). The dock
 * (with the session of S&C or the administration: `pod.manage`) uploads one
 * `pod_raw` file per recording segment with its manifest, straight to the
 * bucket with a signed `PUT` (ADR 0044), and confirms it. The worker decodes
 * it with the pod's keys and, once verified, the dock fetches the **erase
 * command signed by the server** and hands it to the pod, which erases the
 * segment only if its own scan still matches. The file stays pending until
 * the sessions end and the assignments close (or the club's days), and then
 * it is trimmed once to the windows that are data.
 */

export const podRawUploadIdSchema = idOf('subida del log del pod');

/** The 32-bit unsigned integers of the protocol. */
const u32 = z.int().min(0).max(0xffff_ffff);
const SHA256_HEX = /^[0-9a-f]{64}$/;
const POD_RAW_HEADER_B = 64;
const POD_RAW_ENTRY_B = 2056;

export const podRawManifestSchema = z
  .strictObject({
    kind: z.literal('pod_raw'),
    containerVersion: z.literal(1),
    logFormatVersion: z.literal(1),
    deviceIdHex: z.string().regex(POD_CHIP_ID_PATTERN).meta({
      description: 'FICR `DEVICEID` del pod (8 bytes, 16 dígitos hex en minúscula).',
    }),
    podSerial: z.string().min(1).max(64).meta({ description: 'Número de serie del pod.' }),
    bootCounter: u32,
    segmentId: u32,
    firstPageSeq: u32,
    lastPageSeq: u32,
    pagesN: z.int().min(1).meta({ description: 'Páginas en el archivo.' }),
    validPagesN: z.int().min(0).meta({
      description: 'Páginas que el escaneo del pod contó como válidas (CRC y encabezado).',
    }),
    blocks: z.array(z.int().min(0).max(0xffff)).min(1).max(0xffff),
    keyEpochs: z.array(z.int().min(0).max(0xff)).min(1).max(0xff),
    closed: z.boolean(),
    startUnixMs: z.int().min(0).nullable(),
    endUnixMs: z.int().min(0).nullable(),
    sizeB: z.int().min(1).max(FILE_KIND_POLICIES.pod_raw.maxSizeBytes),
    sha256Hex: z.string().regex(SHA256_HEX),
  })
  .refine((m) => m.sizeB === POD_RAW_HEADER_B + m.pagesN * POD_RAW_ENTRY_B, {
    message: 'sizeB must be 64 + pagesN × 2056',
    path: ['sizeB'],
  })
  .refine((m) => m.lastPageSeq >= m.firstPageSeq && m.validPagesN <= m.pagesN, {
    message: 'Inconsistent page range or count',
    path: ['lastPageSeq'],
  })
  .refine((m) => m.startUnixMs === null || m.endUnixMs === null || m.endUnixMs >= m.startUnixMs, {
    message: 'endUnixMs before startUnixMs',
    path: ['endUnixMs'],
  })
  .meta({
    id: 'PodRawManifest',
    description:
      'Manifiesto del archivo `pod_raw` que arma la base (`buildPodRawFile` de `@sport-performance/pod-protocol`): el tramo de grabación, su rango de páginas y bloques, las épocas, el tamaño y el SHA-256 del archivo.',
  });

export type PodRawManifestBody = z.output<typeof podRawManifestSchema>;

export const podRawUploadStateSchema = z.enum(POD_RAW_UPLOAD_STATES).meta({
  id: 'PodRawUploadState',
  description:
    '`uploading` (falta subir o confirmar), `pending` (subido, falta verificarlo con las claves), `verified` (verificado: se puede pedir el comando de borrado; sigue pendiente de recorte), `trimmed` (recortado una sola vez a las ventanas válidas) o `rejected` (no verificó: el pod lo conserva y se puede subir de nuevo).',
});

export const podRawUploadSchema = z
  .object({
    id: podRawUploadIdSchema,
    podId: podIdSchema,
    podSerial: z.string(),
    bootCounter: u32,
    segmentId: u32,
    firstPageSeq: u32,
    lastPageSeq: u32,
    pagesN: z.int(),
    validPagesN: z.int(),
    sizeBytes: z.int(),
    sha256Hex: z.string(),
    fileId: fileIdSchema,
    state: podRawUploadStateSchema,
    confirmedAt: dateTimeSchema.nullable(),
    pendingUntil: dateTimeSchema.nullable().meta({
      description: 'Se recorta a más tardar entonces (los días del club desde la confirmación).',
    }),
    verifiedAt: dateTimeSchema.nullable(),
    eraseCommandAvailable: z.boolean().meta({
      description: 'Verificado: `GET …/erase-command` devuelve el comando firmado.',
    }),
    recordedFrom: dateTimeSchema.nullable().meta({
      description: 'Inicio de la grabación según el log; `null` sin hora absoluta.',
    }),
    recordedTo: dateTimeSchema.nullable(),
    firmwareVersion: z.string().nullable(),
    gnssFirmwareVersion: z.string().nullable(),
    issues: z
      .array(
        z.object({
          code: z.enum(POD_RAW_ISSUE_CODES),
          count: z.int().optional(),
        }),
      )
      .meta({
        description:
          'Lo que informó el worker sin rechazarlo: base de tiempo de baja confianza (`time_base_few_anchors`, `time_base_steps`, `time_base_none`), páginas o bytes perdidos, falta la clave maestra del club, una corrección de asignación después del recorte. Nunca una posición.',
      }),
    rejectionReason: z.enum(POD_RAW_REJECTION_REASONS).nullable(),
    rejectedAt: dateTimeSchema.nullable(),
    trimmedAt: dateTimeSchema.nullable(),
    trimmedPlayersN: z.int().nullable(),
    trimmedSamplesN: z.int().nullable().meta({ description: 'Muestras de 1 Hz que quedaron.' }),
    createdBy: userIdSchema.nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .meta({ id: 'PodRawUpload' });

export type PodRawUpload = z.output<typeof podRawUploadSchema>;

const MANAGE = 'Solo `sc` y la administración (`pod.manage`): la base corre con su sesión.';

export const createPodRawUpload = defineEndpoint({
  method: 'POST',
  path: '/v1/pods/{podId}/raw-uploads',
  summary: 'Pedir la subida de un tramo del log del pod',
  description: `${MANAGE} Con el manifiesto del tramo: el pod tiene que ser del club y el manifiesto de su dispositivo (chip y número de serie; si no, \`validation_failed\`). Crea el archivo \`pod_raw\` pendiente y devuelve la URL firmada para subirlo directo al bucket con \`PUT\`; después, \`POST /v1/pod-raw-uploads/{podRawUploadId}/confirm\`. Idempotente por tramo (DEVICEID, arranque, tramo): reenviar el mismo archivo devuelve la misma subida (con una URL nueva mientras falte subirlo); otro archivo para un tramo ya subido es \`conflict\`; uno rechazado se puede subir de nuevo.`,
  tags: ['pods'],
  auth: 'club',
  params: z.strictObject({ podId: podIdSchema }),
  body: z.strictObject({ manifest: podRawManifestSchema }),
  response: {
    status: 201,
    description: 'La subida y cómo subir el archivo.',
    schema: z
      .object({
        upload: podRawUploadSchema,
        fileUpload: fileUploadSchema.nullable().meta({
          description: '`null` si el archivo ya no falta (reenvío de una subida confirmada).',
        }),
      })
      .meta({ id: 'CreatedPodRawUpload' }),
  },
  errors: ['not_found', 'conflict', 'validation_failed', 'service_unavailable'],
});

const uploadParams = z.strictObject({ podRawUploadId: podRawUploadIdSchema });

export const confirmPodRawUpload = defineEndpoint({
  method: 'POST',
  path: '/v1/pod-raw-uploads/{podRawUploadId}/confirm',
  summary: 'Confirmar la subida de un tramo',
  description: `${MANAGE} Revisa que el bucket tenga exactamente el archivo declarado (tamaño, tipo y SHA-256) y lo deja \`pending\` para que el worker lo verifique con las claves del pod. Ya confirmado: lo devuelve igual. Nada subido, otro contenido o la ventana de subida cerrada: \`conflict\`.`,
  tags: ['pods'],
  auth: 'club',
  params: uploadParams,
  response: { status: 200, description: 'La subida.', schema: podRawUploadSchema },
  errors: ['not_found', 'conflict', 'service_unavailable'],
});

export const getPodRawUpload = defineEndpoint({
  method: 'GET',
  path: '/v1/pod-raw-uploads/{podRawUploadId}',
  summary: 'Estado de la subida de un tramo',
  description: MANAGE,
  tags: ['pods'],
  auth: 'club',
  params: uploadParams,
  response: { status: 200, description: 'La subida.', schema: podRawUploadSchema },
  errors: ['not_found'],
});

export const listPodRawUploads = defineEndpoint({
  method: 'GET',
  path: '/v1/pod-raw-uploads',
  summary: 'Subidas del log de los pods',
  description: `${MANAGE} Las más nuevas primero; por pod y por estado.`,
  tags: ['pods'],
  auth: 'club',
  query: pageQuerySchema.extend({
    podId: podIdSchema.optional(),
    state: podRawUploadStateSchema.optional(),
    sort: sortQuerySchema(['createdAt'], '-createdAt'),
  }),
  response: {
    status: 200,
    description: 'Página de subidas.',
    schema: pageOf(podRawUploadSchema).meta({ id: 'PodRawUploadPage' }),
  },
  errors: ['bad_request'],
});

export const POD_COMMAND_SIGNATURE_ALGORITHM = 'ecdsa-p256-sha256';

export const podRawEraseCommandSchema = z
  .object({
    podRawUploadId: podRawUploadIdSchema,
    command: z.base64().meta({
      description:
        'Bytes canónicos del comando de borrado (`encodeEraseCommand`: magia `SPER`, versión, DEVICEID, arranque, tramo, primera y última secuencia de página, páginas válidas, SHA-256 del archivo y bloques), en base64.',
    }),
    signature: z.base64().meta({
      description:
        'Firma ECDSA P-256 con SHA-256 de `command`, `r ‖ s` (64 bytes, IEEE P1363) en base64, con la clave del servidor fijada en el pod.',
    }),
    algorithm: z.literal(POD_COMMAND_SIGNATURE_ALGORITHM),
    keyId: z.string().meta({ description: 'Id de la clave de firma del servidor.' }),
  })
  .meta({ id: 'PodRawEraseCommand' });

export type PodRawEraseCommand = z.output<typeof podRawEraseCommandSchema>;

export const getPodRawEraseCommand = defineEndpoint({
  method: 'GET',
  path: '/v1/pod-raw-uploads/{podRawUploadId}/erase-command',
  summary: 'Comando de borrado firmado de un tramo',
  description: `${MANAGE} Solo después de que el worker decodificó el archivo con las claves y comprobó que tiene exactamente el tramo cerrado del manifiesto (\`verified\` o \`trimmed\`); antes, o si se rechazó, \`conflict\`. La base se lo pasa al pod como un blob opaco: el pod verifica la firma y borra solo si su propio escaneo coincide. Sin clave de firma configurada: \`service_unavailable\`.`,
  tags: ['pods'],
  auth: 'club',
  params: uploadParams,
  response: { status: 200, description: 'El comando firmado.', schema: podRawEraseCommandSchema },
  errors: ['not_found', 'conflict', 'service_unavailable'],
});

// ─── Settings ────────────────────────────────────────────────────────────────────────

export const podSettingsSchema = z
  .object({
    rawPendingDays: z.int().min(POD_RAW_PENDING_DAYS_MIN).max(POD_RAW_PENDING_DAYS_MAX).meta({
      description:
        'Días que un tramo verificado espera como máximo a que terminen sus sesiones y se cierren las asignaciones antes de recortarlo (N del ADR 0106).',
    }),
    version: resourceVersionSchema.meta({
      description: 'Versión del club: cambia también con su perfil y su marca.',
    }),
  })
  .meta({ id: 'PodSettings' });

export type PodSettingsBody = z.output<typeof podSettingsSchema>;

export const getPodSettings = defineEndpoint({
  method: 'GET',
  path: '/v1/configuration/pods',
  summary: 'Configuración de los pods del club',
  description: 'Lo ven `sc` y la administración (`pod.manage`).',
  tags: ['configuration'],
  auth: 'club',
  response: { status: 200, description: 'La configuración.', schema: podSettingsSchema },
  errors: [],
});

export const updatePodSettings = defineEndpoint({
  method: 'PATCH',
  path: '/v1/configuration/pods',
  summary: 'Cambiar la configuración de los pods',
  description:
    'Solo la administración (`admin` o superadmin en soporte), como el resto de la configuración del club. Vale para lo que se confirme desde ahora. `version` desactualizada: `conflict`.',
  tags: ['configuration'],
  auth: 'club',
  body: z.strictObject({
    version: expectedVersionSchema,
    rawPendingDays: z.int().min(POD_RAW_PENDING_DAYS_MIN).max(POD_RAW_PENDING_DAYS_MAX),
  }),
  response: { status: 200, description: 'La configuración.', schema: podSettingsSchema },
  errors: ['conflict'],
});
