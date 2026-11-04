import {
  EXTERNAL_LOAD_ACTIVITIES,
  EXTERNAL_LOAD_DETAIL_MAX_LENGTH,
  EXTERNAL_LOAD_MINUTES_MAX,
  EXTERNAL_LOAD_MINUTES_MIN,
  EXTERNAL_LOAD_REPORT_WINDOW_DAYS,
  EXTERNAL_LOAD_RPE_MAX,
  EXTERNAL_LOAD_RPE_MIN,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  archiveStatusQuerySchema,
  archivedAtSchema,
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, playerIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { changeReasonSchema } from './change-history.js';

/**
 * External load (B-511, ADR 0084): an activity outside the club (another
 * sport, physical education, training on their own) that the player reports
 * with its type, minutes and CR-10 RPE. It adds to the player's daily load,
 * always marked as reported by the player.
 */

export const externalLoadIdSchema = idOf('carga externa');

export const externalLoadActivitySchema = z.enum(EXTERNAL_LOAD_ACTIVITIES).meta({
  id: 'ExternalLoadActivity',
  description:
    'Tipo de actividad: `physical_education` (educación física), `other_sport` (otro deporte u otro club), `own_training` (entrenamiento por su cuenta) u `other`.',
});

const detailSchema = z
  .string()
  .min(1)
  .max(EXTERNAL_LOAD_DETAIL_MAX_LENGTH)
  .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' })
  .meta({ description: 'Qué fue, en palabras del jugador ("Fútbol", "Natación").' });

const minutesSchema = z
  .int()
  .min(EXTERNAL_LOAD_MINUTES_MIN)
  .max(EXTERNAL_LOAD_MINUTES_MAX)
  .meta({ description: 'Minutos de la actividad.' });

const rpeSchema = z
  .int()
  .min(EXTERNAL_LOAD_RPE_MIN)
  .max(EXTERNAL_LOAD_RPE_MAX)
  .meta({ description: 'RPE de la actividad, escala CR-10 de Borg (0 a 10).' });

const dayDescription = `Día del club de la actividad: hoy o hasta ${String(EXTERNAL_LOAD_REPORT_WINDOW_DAYS - 1)} días antes.`;

export const externalLoadSchema = z
  .object({
    id: externalLoadIdSchema,
    playerId: playerIdSchema,
    localDate: localDateSchema.meta({ description: 'Día del club de la actividad.' }),
    activity: externalLoadActivitySchema,
    detail: detailSchema.nullable(),
    minutes: minutesSchema,
    rpe: rpeSchema,
    srpeAu: z.int().min(0).meta({
      description:
        'Carga de la actividad: RPE × minutos (UA). Suma a la carga diaria del jugador como informada por él.',
    }),
    reportedBy: z.literal('player').meta({
      description: 'Siempre `player`: la carga externa la informa el jugador.',
    }),
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'ExternalLoad' });

export type ExternalLoad = z.output<typeof externalLoadSchema>;

const externalLoadParams = z.strictObject({ externalLoadId: externalLoadIdSchema });

export const reportExternalLoad = defineEndpoint({
  method: 'POST',
  path: '/v1/external-loads',
  summary: 'Informar una actividad fuera del club',
  description: `Solo el jugador, sobre sí mismo y con consentimiento de datos vigente. ${dayDescription} Suma a su carga diaria (EWMA, ACWR, monotonía) como informada por el jugador. Idempotente por \`clientUuid\`.`,
  tags: ['training'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    localDate: localDateSchema
      .optional()
      .meta({ description: `${dayDescription} Hoy por defecto.` }),
    activity: externalLoadActivitySchema,
    detail: detailSchema.optional(),
    minutes: minutesSchema,
    rpe: rpeSchema,
  }),
  response: { status: 201, description: 'Actividad registrada.', schema: externalLoadSchema },
  errors: ['conflict'],
});

/** The fields a correction may change (at least one). */
const correctionFields = {
  localDate: localDateSchema.optional().meta({ description: dayDescription }),
  activity: externalLoadActivitySchema.optional(),
  detail: detailSchema.nullable().optional(),
  minutes: minutesSchema.optional(),
  rpe: rpeSchema.optional(),
};
export const EXTERNAL_LOAD_CORRECTION_FIELDS = [
  'localDate',
  'activity',
  'detail',
  'minutes',
  'rpe',
] as const satisfies readonly (keyof typeof correctionFields)[];

const changesSomething = (body: object) =>
  EXTERNAL_LOAD_CORRECTION_FIELDS.some((key) => key in body);
const changesSomethingIssue = { message: 'Change at least one field' };

/**
 * A correction without its `version`: the offline queue's
 * (`external_load.correct`, ADR 0050), where the per-field clocks replace it.
 * The reason is required online and offline (ADR 0030).
 */
export const externalLoadCorrectionSchema = z
  .strictObject({ changeReason: changeReasonSchema, ...correctionFields })
  .refine(changesSomething, changesSomethingIssue)
  .meta({ id: 'ExternalLoadCorrection' });

export const correctExternalLoad = defineEndpoint({
  method: 'PATCH',
  path: '/v1/external-loads/{externalLoadId}',
  summary: 'Corregir una actividad informada',
  description: `Solo el jugador, sobre una actividad suya no archivada cuyo día (el de antes y el nuevo) está en la ventana: ${dayDescription} Lleva la \`version\` leída y el motivo (\`changeReason\`, queda en el historial de cambios). \`version\` desactualizada, actividad archivada o fuera de la ventana: \`conflict\`.`,
  tags: ['training'],
  auth: 'club',
  params: externalLoadParams,
  body: z
    .strictObject({
      version: expectedVersionSchema,
      changeReason: changeReasonSchema,
      ...correctionFields,
    })
    .refine(changesSomething, changesSomethingIssue),
  response: { status: 200, description: 'La actividad corregida.', schema: externalLoadSchema },
  errors: ['not_found', 'conflict'],
});

export const archiveExternalLoad = defineEndpoint({
  method: 'POST',
  path: '/v1/external-loads/{externalLoadId}/archive',
  summary: 'Archivar una actividad informada',
  description:
    'Solo el jugador, sobre una actividad suya dentro de la ventana: cargada por error o que no hizo. Deja de sumar a la carga; no se restaura (se informa de nuevo). Idempotente.',
  tags: ['training'],
  auth: 'club',
  params: externalLoadParams,
  response: { status: 200, description: 'Actividad archivada.', schema: externalLoadSchema },
  errors: ['not_found', 'conflict'],
});

export const listExternalLoads = defineEndpoint({
  method: 'GET',
  path: '/v1/external-loads',
  summary: 'Actividades informadas fuera del club',
  description:
    'El jugador ve las suyas; `coach`, `sc` y `medical` las de los jugadores de sus asignaciones; la administración, todo el club. `categoryId` filtra por la categoría del jugador en el día de cada actividad. Por defecto, sin las archivadas.',
  tags: ['training'],
  auth: 'club',
  query: pageQuerySchema.extend({
    playerId: playerIdSchema.optional(),
    categoryId: categoryIdSchema.optional(),
    from: localDateSchema.optional().meta({ description: 'Desde este día del club (inclusive).' }),
    to: localDateSchema.optional().meta({ description: 'Hasta este día del club (inclusive).' }),
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['localDate', 'createdAt'], '-localDate'),
  }),
  response: {
    status: 200,
    description: 'Página de actividades.',
    schema: pageOf(externalLoadSchema).meta({ id: 'ExternalLoadPage' }),
  },
  errors: ['bad_request'],
});

export const getExternalLoad = defineEndpoint({
  method: 'GET',
  path: '/v1/external-loads/{externalLoadId}',
  summary: 'Una actividad informada',
  description:
    'Mismo alcance que la lista. Una actividad de otro club o de un jugador que no se ve: `not_found`.',
  tags: ['training'],
  auth: 'club',
  params: externalLoadParams,
  response: { status: 200, description: 'La actividad.', schema: externalLoadSchema },
  errors: ['not_found'],
});
