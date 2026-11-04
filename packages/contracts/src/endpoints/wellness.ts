import {
  REPORT_CHANNELS,
  WELLNESS_ITEMS,
  WELLNESS_SCORE_MAX,
  WELLNESS_SCORE_MIN,
  type WellnessItem,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
  stageSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, playerIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { changeReasonSchema } from './change-history.js';

/**
 * Pre-training wellness (B-319, ADR 0038): one check-in per player and club
 * day, with the item set of the player's stage that day (3 items with faces
 * in M13/M14, 5 later). The player loads it; the staff reads it by scope.
 */

export const wellnessIdSchema = idOf('carga de bienestar');

/** How a self-reported value reached the club (B-504, ADR 0086). */
export const reportChannelSchema = z.enum(REPORT_CHANNELS).meta({
  id: 'ReportChannel',
  description:
    'Por dónde llegó lo que reporta el jugador: `player_account` (desde su propia cuenta) o `kiosk` (en el kiosco del club, con la sesión de un miembro del staff, que queda como autor).',
});

export const wellnessItemSchema = z.enum(WELLNESS_ITEMS).meta({
  id: 'WellnessItem',
  description:
    'Ítem de bienestar: `sleep` (sueño), `fatigue` (fatiga), `soreness` (dolor muscular), `stress` (estrés), `mood` (ánimo).',
});

export const wellnessItemCountSchema = z.union([z.literal(3), z.literal(5)]).meta({
  id: 'WellnessItemCount',
  description:
    'Versión del conjunto de ítems: `3` (sueño, fatiga y dolor muscular, con caritas; M13/M14) o `5` (los cinco).',
});

const scoreSchema = z.int().min(WELLNESS_SCORE_MIN).max(WELLNESS_SCORE_MAX).meta({
  description: 'Puntaje 1–5, ya orientado: más alto es mejor (5 = descansado, sin dolor).',
});

const scoreShape = Object.fromEntries(
  WELLNESS_ITEMS.map((item) => [item, scoreSchema.optional()]),
) as Record<WellnessItem, z.ZodOptional<typeof scoreSchema>>;

/** Answer of a check-in: exactly the items of its set (checked by the API against the stage). */
export const wellnessScoresInputSchema = z.strictObject(scoreShape).meta({
  id: 'WellnessScoresInput',
  description:
    'Puntaje de cada ítem del conjunto de la etapa, y de ninguno más. Ítems que faltan o sobran: `validation_failed` en `body.scores.<ítem>`.',
});

export const wellnessScoresSchema = z.object(scoreShape).meta({
  id: 'WellnessScores',
  description: 'Puntajes de los ítems respondidos; los que la versión no pregunta no aparecen.',
});

export const wellnessSchema = z
  .object({
    id: wellnessIdSchema,
    playerId: playerIdSchema,
    localDate: localDateSchema.meta({ description: 'Día del club de la carga.' }),
    itemCount: wellnessItemCountSchema,
    items: z.array(wellnessItemSchema).meta({ description: 'Ítems de la versión, en orden.' }),
    scores: wellnessScoresSchema,
    meanScore: z
      .number()
      .min(WELLNESS_SCORE_MIN)
      .max(WELLNESS_SCORE_MAX)
      .meta({ description: 'Media de los ítems respondidos (lo que evalúan las alertas).' }),
    submittedAt: dateTimeSchema,
    channel: reportChannelSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'Wellness' });

export const wellnessFormSchema = z
  .object({
    playerId: playerIdSchema,
    localDate: localDateSchema.meta({ description: 'Hoy en la zona horaria del club.' }),
    stage: stageSchema,
    itemCount: wellnessItemCountSchema,
    items: z.array(wellnessItemSchema).meta({ description: 'Ítems a preguntar, en orden.' }),
    entry: wellnessSchema.nullable().meta({ description: 'La carga de hoy, si ya la hizo.' }),
  })
  .meta({ id: 'WellnessForm' });

export type Wellness = z.output<typeof wellnessSchema>;
export type WellnessForm = z.output<typeof wellnessFormSchema>;

const wellnessParams = z.strictObject({ wellnessId: wellnessIdSchema });

export const getWellnessForm = defineEndpoint({
  method: 'GET',
  path: '/v1/wellness/today',
  summary: 'Bienestar de hoy del jugador',
  description:
    'Solo el jugador, sobre sí mismo y con consentimiento de datos vigente. Devuelve el día del club, la etapa y la versión de ítems que corresponde preguntar, y la carga de hoy si ya existe. Sin etapa ni categoría vigente: `conflict`.',
  tags: ['wellness'],
  auth: 'club',
  response: { status: 200, description: 'Formulario de hoy.', schema: wellnessFormSchema },
  errors: ['conflict'],
});

export const submitWellness = defineEndpoint({
  method: 'POST',
  path: '/v1/wellness',
  summary: 'Cargar el bienestar del día',
  description:
    'El jugador, sobre sí mismo y con consentimiento de datos vigente. Con `playerId`, la carga del modo kiosco (B-504): el staff con la sesión abierta en el dispositivo compartido del club carga por el jugador que se eligió ahí (`wellness.kiosk_submit`: `coach` y `sc` en sus asignaciones, la administración en el club, siempre con el consentimiento de datos del jugador), y la carga queda con canal `kiosk`. Una carga por día del club: otra carga del mismo día es `conflict` (corregir con `PATCH`, solo el jugador). `localDate` es hoy o ayer (cola offline). La versión de ítems sale de la etapa del jugador ese día. Idempotente por `clientUuid`.',
  tags: ['wellness'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    playerId: playerIdSchema.optional().meta({
      description: 'Solo en el modo kiosco: el jugador por el que se carga. Sin él, quien llama.',
    }),
    localDate: localDateSchema.optional().meta({
      description: 'Día del club de la carga: hoy (por defecto) o ayer.',
    }),
    scores: wellnessScoresInputSchema,
  }),
  response: { status: 201, description: 'Carga registrada.', schema: wellnessSchema },
  errors: ['conflict'],
});

export const correctWellness = defineEndpoint({
  method: 'PATCH',
  path: '/v1/wellness/{wellnessId}',
  summary: 'Corregir una carga de bienestar',
  description:
    'Solo el jugador, sobre su carga de hoy o de ayer, con consentimiento de datos vigente. Se mandan todos los ítems de la versión de la carga (no cambia), la `version` leída y el motivo (`changeReason`, queda en el historial de cambios). `version` desactualizada o carga fuera de la ventana: `conflict`.',
  tags: ['wellness'],
  auth: 'club',
  params: wellnessParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    scores: wellnessScoresInputSchema,
    changeReason: changeReasonSchema,
  }),
  response: { status: 200, description: 'La carga corregida.', schema: wellnessSchema },
  errors: ['not_found', 'conflict'],
});

export const listWellness = defineEndpoint({
  method: 'GET',
  path: '/v1/wellness',
  summary: 'Cargas de bienestar',
  description:
    'El jugador ve las suyas; `coach`, `sc` y `medical` las de los jugadores de sus asignaciones; la administración, todo el club. `categoryId` filtra por la categoría del jugador en el día de cada carga.',
  tags: ['wellness'],
  auth: 'club',
  query: pageQuerySchema.extend({
    playerId: playerIdSchema.optional(),
    categoryId: categoryIdSchema.optional(),
    from: localDateSchema.optional().meta({ description: 'Desde este día del club (inclusive).' }),
    to: localDateSchema.optional().meta({ description: 'Hasta este día del club (inclusive).' }),
    sort: sortQuerySchema(['localDate', 'submittedAt'], '-localDate'),
  }),
  response: {
    status: 200,
    description: 'Página de cargas.',
    schema: pageOf(wellnessSchema).meta({ id: 'WellnessPage' }),
  },
  errors: ['bad_request'],
});

export const getWellness = defineEndpoint({
  method: 'GET',
  path: '/v1/wellness/{wellnessId}',
  summary: 'Una carga de bienestar',
  description:
    'Mismo alcance que la lista. Una carga de otro club o de un jugador que no se ve: `not_found`.',
  tags: ['wellness'],
  auth: 'club',
  params: wellnessParams,
  response: { status: 200, description: 'La carga.', schema: wellnessSchema },
  errors: ['not_found'],
});
