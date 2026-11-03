import {
  ACCOUNT_DELETION_FRESH_SESSION_S,
  ACCOUNT_DELETION_OUTCOMES,
  DATA_SUBJECT_REQUEST_NOTE_MAX_LENGTH,
  DATA_SUBJECT_REQUEST_KINDS,
  DATA_SUBJECT_REQUEST_STATUSES,
  PLAYER_DATA_EXPORT_FORMAT,
  PLAYER_DATA_EXPORT_FORMAT_VERSION,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { clientUuidSchema, sortQuerySchema } from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { clubIdSchema, idOf, playerIdSchema, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';

/**
 * Rights of the data subject (Ley 25.326, arts. 14 to 16; B-329, ADR 0051):
 * export of every datum of a player, erasure requests that the club's
 * administration executes, and the deletion of the caller's account (Apple
 * App Store Review Guideline 5.1.1(v)).
 */

export const dataSubjectRequestIdSchema = idOf('pedido del titular');

export const dataSubjectRequestKindSchema = z.enum(DATA_SUBJECT_REQUEST_KINDS).meta({
  id: 'DataSubjectRequestKind',
  description:
    '`access`: una exportación de los datos (queda registrada al entregarse). `erasure`: la supresión del jugador/a.',
});

export const dataSubjectRequestStatusSchema = z.enum(DATA_SUBJECT_REQUEST_STATUSES).meta({
  id: 'DataSubjectRequestStatus',
  description:
    '`pending`: supresión a la espera de la administración. `completed`: exportación entregada o jugador/a suprimido. `rejected`: rechazada con motivo. `cancelled`: cancelada.',
});

const note = (description: string) =>
  z
    .string()
    .min(1)
    .max(DATA_SUBJECT_REQUEST_NOTE_MAX_LENGTH)
    .refine((value) => value.trim() !== '', { message: 'Cannot be blank' })
    .meta({ description });

export const dataSubjectRequestSchema = z
  .object({
    id: dataSubjectRequestIdSchema,
    playerId: playerIdSchema,
    player: z
      .object({ firstName: z.string(), lastName: z.string() })
      .nullable()
      .meta({ description: 'Nombre del jugador/a; `null` una vez suprimido.' }),
    kind: dataSubjectRequestKindSchema,
    status: dataSubjectRequestStatusSchema,
    requestedBy: userIdSchema
      .nullable()
      .meta({ description: 'Quién lo pidió; `null` si después borró su cuenta.' }),
    requesterRole: z.enum(['player', 'parent', 'admin']).meta({
      description: 'Con qué rol lo pidió: el jugador/a, su tutor o la administración.',
    }),
    note: z.string().nullable(),
    createdAt: dateTimeSchema,
    dueOn: localDateSchema.nullable().meta({
      description:
        'Para una supresión, el último día para resolverla: 5 días hábiles desde el pedido, en el día del club (Ley 25.326, art. 16; sin feriados). `null` para una exportación.',
    }),
    resolvedAt: dateTimeSchema.nullable(),
    resolvedBy: userIdSchema.nullable(),
    resolutionNote: z.string().nullable(),
    erasedRows: z.record(z.string(), z.int().nonnegative()).nullable().meta({
      description:
        'Filas borradas por tabla (`esquema.tabla`) en una supresión completada; la evidencia que queda.',
    }),
  })
  .meta({ id: 'DataSubjectRequest' });

const exportedRowsSchema = z.array(z.record(z.string(), z.unknown()));

export const playerDataExportSchema = z
  .object({
    format: z.literal(PLAYER_DATA_EXPORT_FORMAT),
    formatVersion: z.literal(PLAYER_DATA_EXPORT_FORMAT_VERSION),
    generatedAt: dateTimeSchema,
    requestId: dataSubjectRequestIdSchema.meta({
      description: 'El pedido de tipo `access` que registra esta exportación.',
    }),
    club: z.object({ id: clubIdSchema, name: z.string() }),
    playerId: playerIdSchema,
    account: z.object({ id: userIdSchema, name: z.string(), email: z.string() }).nullable().meta({
      description:
        'La cuenta propia del jugador/a: solo para el jugador/a y la administración (el tutor no ve su email).',
    }),
    tables: z.record(z.string(), exportedRowsSchema).meta({
      description:
        'Cada fila de cada tabla que referencia al jugador/a, por `esquema.tabla`, con las columnas como están guardadas (`snake_case`, fechas ISO 8601, días del club `aaaa-mm-dd`). También los valores de sus resultados, las sesiones y días de test en los que participó y los textos de los consentimientos firmados. `test_result.not_done_reason = injured` sale como `unavailable` para quien no es médico.',
    }),
    medical: z
      .object({
        included: z.boolean(),
        reason: z.enum(['not_holder', 'no_health_consent']).nullable().meta({
          description:
            'Por qué no se incluyó: `not_holder` (la administración no lee datos de salud) o `no_health_consent` (sin consentimiento de salud vigente).',
        }),
        tables: z.record(z.string(), exportedRowsSchema).meta({
          description:
            'Lesiones, conmociones, etapas del retorno y notas compartidas, leídas por las funciones auditadas del esquema `medical`. Vacío si no se incluyó.',
        }),
      })
      .meta({
        description:
          'Datos de salud: solo para el jugador/a con consentimiento de salud o el tutor de un menor con ese consentimiento; cada lectura queda en el log médico.',
      }),
  })
  .meta({ id: 'PlayerDataExport' });

export const accountDeletionSchema = z
  .object({
    outcome: z.enum(ACCOUNT_DELETION_OUTCOMES).meta({
      description:
        '`deleted`: la cuenta ya no existe. `anonymized`: queda solo su id, sin nombre ni email, porque es evidencia legal (firmó consentimientos o dio un alta médica); todo lo demás se borró igual.',
    }),
    erasureRequests: z.array(
      z.object({ id: dataSubjectRequestIdSchema, clubId: clubIdSchema, playerId: playerIdSchema }),
    ),
  })
  .meta({ id: 'AccountDeletion' });

export type DataSubjectRequest = z.output<typeof dataSubjectRequestSchema>;
export type PlayerDataExport = z.output<typeof playerDataExportSchema>;
export type AccountDeletion = z.output<typeof accountDeletionSchema>;

const playerParams = z.strictObject({ playerId: playerIdSchema });
const requestParams = z.strictObject({ requestId: dataSubjectRequestIdSchema });

export const exportPlayerData = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/data-exports',
  summary: 'Exportar todos los datos de un jugador/a',
  description:
    'Derecho de acceso (Ley 25.326, art. 14): el jugador/a mayor de edad, el tutor de un menor o la administración (con consentimiento de datos). Devuelve un JSON para descargar (`Content-Disposition: attachment`, sin caché) y deja registrado un pedido `access`. Idempotente por `clientUuid`: un reintento devuelve los datos de nuevo con el mismo pedido.',
  tags: ['privacy'],
  auth: 'club',
  params: playerParams,
  body: z.strictObject({ clientUuid: clientUuidSchema.optional() }),
  response: { status: 201, description: 'Los datos.', schema: playerDataExportSchema },
  errors: ['not_found', 'consent_required'],
});

export const requestPlayerErasure = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/erasure-requests',
  summary: 'Pedir la supresión de un jugador/a',
  description:
    'Derecho de supresión (Ley 25.326, art. 16): el jugador/a mayor de edad, el tutor de un menor o la administración (un pedido que llegó por otro medio). La administración lo ejecuta o lo rechaza. Uno pendiente por jugador/a: otro es `conflict`. Idempotente por `clientUuid`.',
  tags: ['privacy'],
  auth: 'club',
  params: playerParams,
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    note: note('Cómo llegó el pedido o algo que la administración tenga que saber.').optional(),
  }),
  response: { status: 201, description: 'Pedido creado.', schema: dataSubjectRequestSchema },
  errors: ['not_found', 'conflict'],
});

export const listDataSubjectRequests = defineEndpoint({
  method: 'GET',
  path: '/v1/data-subject-requests',
  summary: 'Pedidos del titular',
  description:
    'La administración ve los del club; el jugador/a y el tutor, los que pidieron ellos (también después de la supresión).',
  tags: ['privacy'],
  auth: 'club',
  query: pageQuerySchema.extend({
    kind: dataSubjectRequestKindSchema.optional(),
    status: dataSubjectRequestStatusSchema.optional(),
    playerId: playerIdSchema.optional(),
    sort: sortQuerySchema(['createdAt'], '-createdAt'),
  }),
  response: {
    status: 200,
    description: 'Página de pedidos.',
    schema: pageOf(dataSubjectRequestSchema).meta({ id: 'DataSubjectRequestPage' }),
  },
  errors: ['bad_request'],
});

export const getDataSubjectRequest = defineEndpoint({
  method: 'GET',
  path: '/v1/data-subject-requests/{requestId}',
  summary: 'Un pedido del titular',
  description: 'Mismo alcance que la lista. De otro club o ajeno: `not_found`.',
  tags: ['privacy'],
  auth: 'club',
  params: requestParams,
  response: { status: 200, description: 'El pedido.', schema: dataSubjectRequestSchema },
  errors: ['not_found'],
});

export const cancelDataSubjectRequest = defineEndpoint({
  method: 'POST',
  path: '/v1/data-subject-requests/{requestId}/cancel',
  summary: 'Cancelar un pedido de supresión',
  description:
    'Quien lo pidió o la administración, mientras está pendiente. Ya resuelto: `conflict`.',
  tags: ['privacy'],
  auth: 'club',
  params: requestParams,
  body: z.strictObject({ reason: note('Por qué se cancela.').optional() }),
  response: { status: 200, description: 'Pedido cancelado.', schema: dataSubjectRequestSchema },
  errors: ['not_found', 'conflict'],
});

export const rejectDataSubjectRequest = defineEndpoint({
  method: 'POST',
  path: '/v1/data-subject-requests/{requestId}/reject',
  summary: 'Rechazar un pedido de supresión',
  description:
    'Solo la administración, con el motivo (p. ej. una obligación legal de conservar los datos, art. 16.5). Ya resuelto: `conflict`.',
  tags: ['privacy'],
  auth: 'club',
  params: requestParams,
  body: z.strictObject({ reason: note('Motivo del rechazo; lo ve quien pidió.') }),
  response: { status: 200, description: 'Pedido rechazado.', schema: dataSubjectRequestSchema },
  errors: ['not_found', 'conflict'],
});

export const executeErasure = defineEndpoint({
  method: 'POST',
  path: '/v1/data-subject-requests/{requestId}/execute',
  summary: 'Ejecutar una supresión',
  description: `Solo la administración, con una sesión abierta hace menos de ${String(ACCOUNT_DELETION_FRESH_SESSION_S / 60)} minutos (si no, \`reauthentication_required\`). Borra al jugador/a y todo lo que lo referencia (plantel, cargas, bienestar, tests, consentimientos, alertas, datos de salud, historial de cambios) en una transacción; si su cuenta es la sin email, también; sus archivos quedan borrados y el job de retención borra los objetos. Quedan el pedido, con las filas borradas por tabla, y los logs de acceso (solo ids). \`playerId\` confirma a quién se suprime: otro es \`conflict\`, igual que un pedido cancelado o rechazado. Un reintento de una supresión completada devuelve el pedido. Si una fila que no es del jugador/a apunta a sus datos, \`conflict\` y no se borra nada. No se deshace.`,
  tags: ['privacy'],
  auth: 'club',
  params: requestParams,
  body: z.strictObject({ playerId: playerIdSchema }),
  response: { status: 200, description: 'Supresión completada.', schema: dataSubjectRequestSchema },
  errors: ['not_found', 'conflict', 'reauthentication_required'],
});

export const deleteMyAccount = defineEndpoint({
  method: 'POST',
  path: '/v1/me/account-deletion',
  summary: 'Borrar mi cuenta',
  description: `Borra la cuenta de la sesión (guía 5.1.1(v) de Apple): sesiones, membresías, vínculos de tutor y dispositivos; en los datos del club queda sin autor. Pide una sesión abierta hace menos de ${String(ACCOUNT_DELETION_FRESH_SESSION_S / 60)} minutos: si no, \`reauthentication_required\` (volver a pedir el código). Con \`requestErasure\`, pide además la supresión de los jugadores/as de los que es titular (su propio jugador/a si es mayor, sus hijos/as menores); la ejecuta cada club. Un superadmin: \`conflict\` (lo hace un operador). Vale con o sin club elegido: la cuenta es global.`,
  tags: ['me', 'privacy'],
  auth: 'session',
  body: z.strictObject({ requestErasure: z.boolean().default(false) }),
  response: { status: 200, description: 'Cuenta borrada.', schema: accountDeletionSchema },
  errors: ['conflict', 'reauthentication_required'],
});
