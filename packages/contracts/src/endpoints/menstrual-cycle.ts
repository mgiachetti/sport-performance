import {
  MENSTRUAL_CYCLE_VIEWER_ROLES,
  MENSTRUAL_CYCLE_VIEWERS_MAX,
  MENSTRUAL_FLOWS,
  MENSTRUAL_LOG_WINDOW_DAYS,
  MENSTRUAL_NOTE_MAX_LENGTH,
  MENSTRUAL_READ_MAX_DAYS,
  MENSTRUAL_SYMPTOMS,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { clientUuidSchema } from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { idOf, playerIdSchema } from '../primitives/ids.js';
import { membershipIdSchema } from './auth.js';

/**
 * Menstrual cycle tracking (B-806, ADR 0092): an optional module of health
 * data with three keys (the club's `menstrual_cycle` module, the `data`,
 * `health` and `menstrual_cycle` consents, and the player's own opt-in). Only
 * the player writes; she reads all of hers and authorizes, one by one, the
 * assigned medical or S&C members that may read it. Never the coach, the
 * administration or the guardian. Every read and write is in the log of
 * accesses to health data. No phases, no forecasts: the summary describes
 * what she logged.
 */

export const menstrualCycleDayIdSchema = idOf('día del ciclo');
export const menstrualCycleShareIdSchema = idOf('autorización del ciclo');

export const menstrualFlowSchema = z.enum(MENSTRUAL_FLOWS).meta({
  id: 'MenstrualFlow',
  description:
    'Sangrado del día: `none` (nada), `spotting` (manchado, no cuenta como día del período), `light`, `moderate` o `heavy`.',
});

export const menstrualSymptomSchema = z.enum(MENSTRUAL_SYMPTOMS).meta({
  id: 'MenstrualSymptom',
  description: `Síntoma de un vocabulario cerrado (a definir con el staff médico): ${MENSTRUAL_SYMPTOMS.map((s) => `\`${s}\``).join(', ')}. Lo demás va en la nota.`,
});

export const menstrualCycleViewerRoleSchema = z.enum(MENSTRUAL_CYCLE_VIEWER_ROLES).meta({
  id: 'MenstrualCycleViewerRole',
  description: 'Rol de quien puede autorizar: el staff médico o de preparación física asignado.',
});

export const menstrualCycleDaySchema = z
  .object({
    id: menstrualCycleDayIdSchema,
    clientUuid: clientUuidSchema,
    playerId: playerIdSchema,
    localDate: localDateSchema.meta({ description: 'Día del club del registro.' }),
    flow: menstrualFlowSchema,
    symptoms: z.array(menstrualSymptomSchema).meta({
      description: 'Síntomas marcados, en el orden del vocabulario.',
    }),
    note: z.string().nullable(),
    loggedAt: dateTimeSchema.meta({
      description: 'Cuándo se cargó. Si el día se cargó varias veces, vale la última.',
    }),
  })
  .meta({ id: 'MenstrualCycleDay' });

export type MenstrualCycleDay = z.output<typeof menstrualCycleDaySchema>;

export const menstrualCycleSummarySchema = z
  .object({
    periodStarts: z.array(localDateSchema).meta({
      description:
        'Primer día de cada período que empieza en el rango (un día de sangrado cuyo día anterior no lo es; un período que viene de antes de `from` no empieza en el rango), del más viejo al más nuevo.',
    }),
    lastPeriodStart: localDateSchema.nullable(),
    cycleDay: z.int().min(1).nullable().meta({
      description:
        'Día del ciclo en el último día del rango (`to`, o hoy si `to` es futuro; el primer día del último período es el 1); `null` sin inicios de período en el rango. No es una estimación de fase.',
    }),
    cycleLengthsDays: z.array(z.int().min(1)).meta({
      description: 'Días entre inicios consecutivos (solo ciclos completos dentro del rango).',
    }),
    daysLogged: z.int().min(0),
  })
  .meta({ id: 'MenstrualCycleSummary' });

export const menstrualCycleViewerSchema = z
  .object({
    id: menstrualCycleShareIdSchema,
    membershipId: membershipIdSchema,
    role: menstrualCycleViewerRoleSchema,
    name: z.string(),
    authorizedAt: dateTimeSchema,
  })
  .meta({ id: 'MenstrualCycleViewer' });

export type MenstrualCycleViewer = z.output<typeof menstrualCycleViewerSchema>;

export const menstrualCycleCandidateSchema = z
  .object({
    membershipId: membershipIdSchema,
    role: menstrualCycleViewerRoleSchema,
    name: z.string(),
    authorized: z.boolean().meta({ description: 'Ya la autorizaste.' }),
  })
  .meta({ id: 'MenstrualCycleCandidate' });

export const menstrualCycleUnavailableReasonSchema = z
  .enum(['module_off', 'not_female', 'missing_consent'])
  .meta({
    id: 'MenstrualCycleUnavailableReason',
    description:
      '`module_off`: el club no tiene el módulo `menstrual_cycle`; `not_female`: el módulo es para jugadoras; `missing_consent`: falta alguno de los consentimientos de datos, de salud o del ciclo menstrual vigente.',
  });

export const menstrualCycleStatusSchema = z
  .object({
    playerId: playerIdSchema,
    localDate: localDateSchema.meta({ description: 'Hoy en la zona horaria del club.' }),
    available: z.boolean().meta({
      description: 'Si se le ofrece el seguimiento (módulo, jugadora y consentimientos).',
    }),
    unavailableReason: menstrualCycleUnavailableReasonSchema.nullable(),
    tracking: z.boolean().meta({ description: 'Lo activó y no lo desactivó.' }),
    trackingSince: dateTimeSchema.nullable(),
    viewers: z.array(menstrualCycleViewerSchema).meta({
      description: 'A quiénes autorizó ahora (vacío si no lo tiene activo).',
    }),
    candidates: z.array(menstrualCycleCandidateSchema).meta({
      description:
        'Staff médico y de preparación física asignado que puede autorizar (vacío si no se le ofrece o no lo tiene activo).',
    }),
  })
  .meta({ id: 'MenstrualCycleStatus' });

export type MenstrualCycleStatus = z.output<typeof menstrualCycleStatusSchema>;

export const menstrualCycleDaysSchema = z
  .object({
    playerId: playerIdSchema,
    from: localDateSchema,
    to: localDateSchema,
    days: z.array(menstrualCycleDaySchema).meta({
      description: 'El registro que vale de cada día cargado (el último), por fecha.',
    }),
    summary: menstrualCycleSummarySchema,
  })
  .meta({ id: 'MenstrualCycleDays' });

export type MenstrualCycleDays = z.output<typeof menstrualCycleDaysSchema>;

export const menstrualCycleSharedPlayerSchema = z
  .object({
    playerId: playerIdSchema,
    firstName: z.string(),
    lastName: z.string(),
    authorizedAt: dateTimeSchema,
  })
  .meta({ id: 'MenstrualCycleSharedPlayer' });

export const getMenstrualCycleStatus = defineEndpoint({
  method: 'GET',
  path: '/v1/menstrual-cycle/me',
  summary: 'Mi seguimiento del ciclo menstrual',
  description:
    'Solo la jugadora, sobre sí misma. Dice si se le ofrece (módulo del club, jugadora y consentimientos de datos, salud y ciclo menstrual), si lo tiene activo, a quiénes autorizó y a quiénes puede autorizar. La lectura queda en el registro de accesos a datos de salud.',
  tags: ['menstrual_cycle'],
  auth: 'club',
  response: {
    status: 200,
    description: 'Estado del seguimiento.',
    schema: menstrualCycleStatusSchema,
  },
  errors: [],
});

export const startMenstrualCycleTracking = defineEndpoint({
  method: 'POST',
  path: '/v1/menstrual-cycle/me/enrollment',
  summary: 'Activar mi seguimiento del ciclo',
  description:
    'Solo la jugadora, con el módulo del club y los tres consentimientos vigentes (si no, `forbidden`). El consentimiento lo permite pero no lo activa: lo decide ella. Empieza sin nadie autorizado. Si ya estaba activo, responde el estado sin cambios.',
  tags: ['menstrual_cycle'],
  auth: 'club',
  body: z.strictObject({ clientUuid: clientUuidSchema.optional() }),
  response: {
    status: 200,
    description: 'Estado del seguimiento.',
    schema: menstrualCycleStatusSchema,
  },
  errors: [],
});

export const endMenstrualCycleTracking = defineEndpoint({
  method: 'POST',
  path: '/v1/menstrual-cycle/me/enrollment/end',
  summary: 'Desactivar mi seguimiento del ciclo',
  description:
    'Solo la jugadora, siempre (aunque falte un consentimiento). Corta la carga y saca el acceso a todas las personas que había autorizado; lo cargado sigue siendo suyo. Si no estaba activo, responde el estado sin cambios.',
  tags: ['menstrual_cycle'],
  auth: 'club',
  body: z.strictObject({}),
  response: {
    status: 200,
    description: 'Estado del seguimiento.',
    schema: menstrualCycleStatusSchema,
  },
  errors: [],
});

export const logMenstrualCycleDay = defineEndpoint({
  method: 'POST',
  path: '/v1/menstrual-cycle/days',
  summary: 'Registrar un día del ciclo',
  description: `Solo la jugadora, con el seguimiento activo, el módulo y los tres consentimientos (si no, \`forbidden\`). \`localDate\` es hoy o ayer en el día del club (los últimos ${String(MENSTRUAL_LOG_WINDOW_DAYS)} días; por defecto hoy). Nunca se edita: volver a cargar el día es otro registro y vale el último. Idempotente por \`clientUuid\` (cola sin conexión).`,
  tags: ['menstrual_cycle'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    localDate: localDateSchema.optional(),
    flow: menstrualFlowSchema,
    symptoms: z.array(menstrualSymptomSchema).max(MENSTRUAL_SYMPTOMS.length).default([]),
    note: z
      .string()
      .max(MENSTRUAL_NOTE_MAX_LENGTH * 2)
      .nullable()
      .optional()
      .meta({
        description: `Nota opcional: hasta ${String(MENSTRUAL_NOTE_MAX_LENGTH)} caracteres, no vacía.`,
      }),
  }),
  response: { status: 201, description: 'Día registrado.', schema: menstrualCycleDaySchema },
  errors: [],
});

export const getMenstrualCycleDays = defineEndpoint({
  method: 'GET',
  path: '/v1/menstrual-cycle/players/{playerId}/days',
  summary: 'Días del ciclo de una jugadora',
  description: `La jugadora, los suyos, siempre. El staff médico o de preparación física asignado, con los tres consentimientos vigentes (si no, \`forbidden\` con \`consent_required\`), y solo si ella autorizó a esa persona y mientras el módulo y el seguimiento sigan vigentes; si no, la respuesta está vacía. Nadie más (\`forbidden\`). Rango de hasta ${String(MENSTRUAL_READ_MAX_DAYS)} días (por defecto los últimos 90). Cada lectura queda en el registro de accesos a datos de salud.`,
  tags: ['menstrual_cycle'],
  auth: 'club',
  params: z.strictObject({ playerId: playerIdSchema }),
  query: z.strictObject({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  }),
  response: { status: 200, description: 'Días y resumen.', schema: menstrualCycleDaysSchema },
  errors: ['bad_request', 'not_found'],
});

export const authorizeMenstrualCycleViewer = defineEndpoint({
  method: 'POST',
  path: '/v1/menstrual-cycle/me/viewers',
  summary: 'Autorizar a alguien a ver mi ciclo',
  description: `Solo la jugadora, con el seguimiento activo. A una persona del staff médico o de preparación física asignada a ella (si no, \`validation_failed\`); hasta ${String(MENSTRUAL_CYCLE_VIEWERS_MAX)} a la vez. Ya autorizada: responde la autorización vigente.`,
  tags: ['menstrual_cycle'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    membershipId: membershipIdSchema,
  }),
  response: {
    status: 201,
    description: 'Autorización vigente.',
    schema: menstrualCycleViewerSchema,
  },
  errors: ['validation_failed'],
});

export const revokeMenstrualCycleViewer = defineEndpoint({
  method: 'POST',
  path: '/v1/menstrual-cycle/me/viewers/{shareId}/revoke',
  summary: 'Sacarle a alguien el acceso a mi ciclo',
  description:
    'Solo la jugadora, siempre. Desde ese momento esa persona no ve nada. Ya revocada: `not_found`.',
  tags: ['menstrual_cycle'],
  auth: 'club',
  params: z.strictObject({ shareId: menstrualCycleShareIdSchema }),
  body: z.strictObject({}),
  response: {
    status: 200,
    description: 'Estado del seguimiento.',
    schema: menstrualCycleStatusSchema,
  },
  errors: ['not_found'],
});

export const listMenstrualCycleSharedWithMe = defineEndpoint({
  method: 'GET',
  path: '/v1/menstrual-cycle/shared-with-me',
  summary: 'Jugadoras que me autorizaron a ver su ciclo',
  description:
    'Solo el staff médico o de preparación física: las jugadoras asignadas que autorizaron a esta persona y que hoy se pueden leer (módulo, seguimiento y consentimientos vigentes). La lectura queda en el registro de accesos a datos de salud.',
  tags: ['menstrual_cycle'],
  auth: 'club',
  response: {
    status: 200,
    description: 'Jugadoras.',
    schema: z
      .object({ items: z.array(menstrualCycleSharedPlayerSchema) })
      .meta({ id: 'MenstrualCycleSharedWithMe' }),
  },
  errors: [],
});
