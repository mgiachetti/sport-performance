import {
  PAIN_AREAS_MAX,
  PAIN_BODY_REGIONS,
  PAIN_COMMENT_MAX_LENGTH,
  PAIN_INTENSITY_MAX,
  PAIN_INTENSITY_MIN,
  PAIN_SIDES,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { clientUuidSchema } from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, playerIdSchema, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';

/**
 * Pain report of the wellness (B-609, ADR 0078): "¿te duele algo?" with a
 * body map. Health data in the `medical` schema: the player answers with a
 * data and a health consent, the assigned medical staff reads and reviews,
 * the holder reads their own; the coach and the rest of the staff never see
 * it (the wellness they read has no trace of it). Only when the club has the
 * `wellness` and `pain_report` modules on.
 */

export const painReportIdSchema = idOf('reporte de dolor');

export const painBodyRegionSchema = z.enum(PAIN_BODY_REGIONS).meta({
  id: 'PainBodyRegion',
  description:
    'Zona del mapa del cuerpo (el vocabulario de las lesiones, sin `other`): `head_face`, `neck`, `shoulder`, `upper_arm`, `elbow`, `forearm`, `wrist_hand`, `chest`, `thoracic_spine`, `lumbar_spine`, `abdomen`, `pelvis_hip_groin`, `thigh_anterior`, `thigh_posterior`, `knee`, `lower_leg`, `ankle`, `foot`.',
});

export const painSideSchema = z.enum(PAIN_SIDES).meta({
  id: 'PainSide',
  description:
    'Lado: `left` o `right` en brazos, piernas y cadera; `central` en cabeza, cuello y tronco.',
});

export const painAreaSchema = z
  .strictObject({
    region: painBodyRegionSchema,
    side: painSideSchema,
    intensity: z
      .int()
      .min(PAIN_INTENSITY_MIN)
      .max(PAIN_INTENSITY_MAX)
      .meta({
        description: `Intensidad en la escala numérica 0–10; una zona que duele es de ${String(PAIN_INTENSITY_MIN)} a ${String(PAIN_INTENSITY_MAX)}.`,
      }),
  })
  .meta({ id: 'PainArea' });

export const painReportSchema = z
  .object({
    id: painReportIdSchema,
    clientUuid: clientUuidSchema,
    playerId: playerIdSchema,
    localDate: localDateSchema.meta({ description: 'Día del club de la respuesta.' }),
    hasPain: z.boolean().meta({ description: 'Respondió que le duele algo.' }),
    areas: z.array(painAreaSchema).meta({
      description: 'Zonas que marcó, en el orden del vocabulario; vacío sin dolor.',
    }),
    comment: z.string().nullable().meta({ description: 'Lo que agregó, solo con dolor.' }),
    maxIntensity: z
      .int()
      .min(0)
      .max(PAIN_INTENSITY_MAX)
      .meta({ description: 'La intensidad más alta de sus zonas (`0` sin dolor).' }),
    submittedAt: dateTimeSchema,
    reviewedAt: dateTimeSchema.nullable().meta({
      description: 'Cuándo lo revisó el staff médico; `null` si sigue pendiente.',
    }),
    reviewedBy: userIdSchema.nullable().meta({ description: 'Quién lo revisó.' }),
  })
  .meta({ id: 'PainReport' });

export type PainReport = z.output<typeof painReportSchema>;

export const painReportUnavailableReasonSchema = z.enum(['module_off', 'missing_consent']).meta({
  id: 'PainReportUnavailableReason',
  description:
    '`module_off`: el club no pregunta por dolor (módulos `wellness` y `pain_report`); `missing_consent`: falta el consentimiento de datos o de salud vigente.',
});

export const painReportFormSchema = z
  .object({
    playerId: playerIdSchema,
    localDate: localDateSchema.meta({ description: 'Hoy en la zona horaria del club.' }),
    enabled: z.boolean().meta({ description: 'Si la app pregunta "¿te duele algo?" hoy.' }),
    unavailableReason: painReportUnavailableReasonSchema.nullable(),
    latest: painReportSchema.nullable().meta({
      description: 'Su última respuesta de hoy, si ya respondió (y puede leerla).',
    }),
  })
  .meta({ id: 'PainReportForm' });

export type PainReportForm = z.output<typeof painReportFormSchema>;

export const PAIN_REPORT_STATUS_FILTERS = ['all', 'pending'] as const;

export const getPainReportForm = defineEndpoint({
  method: 'GET',
  path: '/v1/pain-reports/today',
  summary: 'Pregunta de dolor de hoy del jugador',
  description:
    'Solo el jugador, sobre sí mismo. Dice si hoy se le pregunta "¿te duele algo?" (módulos del club y consentimientos de datos y salud) y su última respuesta del día. La lectura queda en el registro de accesos a datos de salud.',
  tags: ['wellness'],
  auth: 'club',
  response: { status: 200, description: 'Estado de hoy.', schema: painReportFormSchema },
  errors: [],
});

export const submitPainReport = defineEndpoint({
  method: 'POST',
  path: '/v1/pain-reports',
  summary: 'Responder "¿te duele algo?"',
  description: `Solo el jugador, sobre sí mismo, con consentimientos de datos y de salud vigentes y los módulos \`wellness\` y \`pain_report\` del club prendidos (si no, \`forbidden\`). Con dolor, de 1 a ${String(PAIN_AREAS_MAX)} zonas distintas, cada una con un lado de su zona; sin dolor, sin zonas ni comentario. \`localDate\` es hoy o ayer (cola offline). Nunca se edita: otra respuesta del día es otro reporte y vale la última. Va al esquema médico: el entrenador no la ve. Idempotente por \`clientUuid\`.`,
  tags: ['wellness'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    localDate: localDateSchema.optional().meta({
      description: 'Día del club de la respuesta: hoy (por defecto) o ayer.',
    }),
    hasPain: z.boolean(),
    areas: z.array(painAreaSchema).max(PAIN_AREAS_MAX).default([]),
    comment: z
      .string()
      .max(PAIN_COMMENT_MAX_LENGTH * 2)
      .nullable()
      .optional()
      .meta({
        description: `Comentario opcional, solo con dolor: hasta ${String(PAIN_COMMENT_MAX_LENGTH)} caracteres, no vacío.`,
      }),
  }),
  response: { status: 201, description: 'Respuesta registrada.', schema: painReportSchema },
  errors: [],
});

export const listPainReports = defineEndpoint({
  method: 'GET',
  path: '/v1/pain-reports',
  summary: 'Reportes de dolor',
  description:
    'El staff médico, los de los jugadores de sus asignaciones; el jugador, los suyos, y el tutor, los de su hijo/a menor, con consentimiento de salud vigente. Nadie más (`forbidden`). Del más nuevo al más viejo. Cada lectura queda en el registro de accesos a datos de salud.',
  tags: ['wellness'],
  auth: 'club',
  query: pageQuerySchema.extend({
    playerId: playerIdSchema.optional(),
    categoryId: categoryIdSchema.optional().meta({
      description: 'Jugadores que hoy están en la categoría.',
    }),
    from: localDateSchema.optional().meta({ description: 'Desde este día del club (inclusive).' }),
    to: localDateSchema.optional().meta({ description: 'Hasta este día del club (inclusive).' }),
    status: z.enum(PAIN_REPORT_STATUS_FILTERS).default('all').meta({
      description: '`pending`: solo los que el staff médico no revisó; `all` (por defecto).',
    }),
  }),
  response: {
    status: 200,
    description: 'Página de reportes.',
    schema: pageOf(painReportSchema).meta({ id: 'PainReportPage' }),
  },
  errors: ['bad_request'],
});

export const reviewPainReport = defineEndpoint({
  method: 'POST',
  path: '/v1/pain-reports/{painReportId}/review',
  summary: 'Marcar un reporte de dolor como revisado',
  description:
    'Solo el staff médico asignado al jugador. Una vez, firmado por quien lo revisa: ya revisado es `conflict`. No diagnostica ni bloquea: la lesión o el bloqueo se registran aparte.',
  tags: ['wellness'],
  auth: 'club',
  params: z.strictObject({ painReportId: painReportIdSchema }),
  response: { status: 200, description: 'El reporte revisado.', schema: painReportSchema },
  errors: ['not_found', 'conflict'],
});
