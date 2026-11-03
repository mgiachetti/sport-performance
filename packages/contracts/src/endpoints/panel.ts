import { ACWR_STATUSES, AVAILABILITY_STATUSES, MONOTONY_STATUSES } from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { sexSchema, sportSchema, stageSchema } from '../primitives/conventions.js';
import { localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, playerIdSchema } from '../primitives/ids.js';
import { alertIdSchema, alertSeveritySchema } from './alerts.js';
import { positionIdSchema } from './categories.js';
import { alertRuleKindSchema } from './configuration-alert-rules.js';

/**
 * Weekly panel of the staff (B-403): one aggregated read of the players the
 * caller sees, for a club week (Monday to Sunday in the club's time zone).
 * Everything comes from what the worker already derived (`player_load_daily`,
 * `player_wellness_daily`, the maturation of `anthro_measurement`, the
 * alerts) and from `medical.availability` (the status, never the cause): the
 * API neither recalculates nor ranks. Grouping (by category or by maturity,
 * bio-banding) is a view over these rows. Staff only, by the scope of the
 * permission matrix (`load_metrics.read`, `wellness.read`, `alert.read`).
 */

/** History the panel draws, in weeks (the week asked for included). */
export const PANEL_WEEKS_MIN = 4;
export const PANEL_WEEKS_MAX = 26;
export const PANEL_WEEKS_DEFAULT = 12;
/**
 * Most players of one panel. It is an aggregate, not a paginated list: past
 * it the caller narrows by sport or category (`bad_request`).
 */
export const PANEL_MAX_PLAYERS = 500;

export const acwrStatusSchema = z.enum(ACWR_STATUSES).meta({
  id: 'AcwrStatus',
  description:
    '`ok` (hay ACWR), `insufficient_history` (menos de 28 días de historia: sin ACWR ni alertas de ACWR) o `zero_chronic_load` (crónica en cero).',
});

export const monotonyStatusSchema = z.enum(MONOTONY_STATUSES).meta({
  id: 'MonotonyStatus',
  description:
    '`ok`, `insufficient_history` (la ventana empieza antes de la historia) o `zero_variance` (todos los días con la misma carga).',
});

export const availabilityStatusSchema = z.enum(AVAILABILITY_STATUSES).meta({
  id: 'AvailabilityStatus',
  description: '`available`, `limited` o `unavailable`. Nunca la causa.',
});

const weekRangeSchema = z
  .object({
    from: localDateSchema.meta({ description: 'Lunes de la semana.' }),
    to: localDateSchema.meta({ description: 'Domingo de la semana.' }),
  })
  .meta({ id: 'PanelWeek' });

export const panelWeekLoadSchema = z
  .object({
    loadAu: z.number().min(0).meta({
      description:
        'sRPE de la semana (UA): suma de RPE × minutos de los días hasta el de referencia.',
    }),
    hasData: z.boolean().meta({ description: 'Si algún día de la semana tuvo carga cargada.' }),
    chronicWeeklyAu: z.number().min(0).nullable().meta({
      description:
        'Carga crónica (EWMA de 28 días) del último día de la semana, llevada a una semana (× 7); `null` sin historia.',
    }),
  })
  .meta({ id: 'PanelWeekLoad' });

export const panelMaturitySchema = z
  .object({
    measuredOn: localDateSchema.meta({
      description: 'Día de la última antropometría con maduración.',
    }),
    phvOffsetYears: z.number().nullable().meta({
      description: 'Años desde el PHV medidos ese día (Mirwald 2002 / Moore 2015).',
    }),
    phvOffsetYearsOnDate: z.number().nullable().meta({
      description:
        'El offset proyectado al día de referencia (crece un año por año): el que usa el bio-banding.',
    }),
    adultHeightPct: z.number().positive().nullable().meta({
      description: '% de la talla adulta predicha (Khamis-Roche 1994).',
    }),
    growthVelocityCmYear: z.number().nullable().meta({
      description: 'Velocidad de crecimiento desde la medición anterior (cm/año).',
    }),
  })
  .meta({ id: 'PanelMaturity' });

export const panelWellnessSchema = z
  .object({
    submittedToday: z.boolean().meta({
      description:
        'Si cargó el bienestar hoy (día del club). Solo tiene sentido en la semana en curso.',
    }),
    weekEntries: z.int().min(0).meta({ description: 'Días de la semana con bienestar cargado.' }),
    weekMeanScore: z.number().min(1).max(5).nullable().meta({
      description: 'Media de los días cargados de la semana (1 a 5, más es mejor).',
    }),
    latestOn: localDateSchema.nullable().meta({
      description:
        'Último día con bienestar hasta el de referencia (puede ser de antes de la semana).',
    }),
    latestMeanScore: z.number().min(1).max(5).nullable(),
    latestZScore: z.number().nullable().meta({
      description: 'z-score del último contra la media móvil propia; `null` sin base suficiente.',
    }),
  })
  .meta({ id: 'PanelWellness' });

export const panelLoadSchema = z
  .object({
    weekLoadAu: z.number().min(0).meta({ description: 'sRPE de la semana pedida (UA).' }),
    pendingRpeN: z.int().min(0).meta({
      description: 'Participaciones de la semana con minutos y sin RPE (no suman a la carga).',
    }),
    asOf: localDateSchema.nullable().meta({
      description: 'Día de la serie del que salen ACWR y monotonía; `null` si no hay historia.',
    }),
    historyDays: z.int().min(0),
    acwr: z.number().min(0).nullable().meta({ description: '`null` salvo `acwrStatus = ok`.' }),
    acwrStatus: acwrStatusSchema,
    acuteEwmaAu: z.number().min(0).nullable(),
    chronicEwmaAu: z.number().min(0).nullable(),
    monotony: z.number().nullable(),
    strainAu: z.number().nullable(),
    monotonyStatus: monotonyStatusSchema,
    weeks: z.array(panelWeekLoadSchema).meta({
      description: 'Una por semana de `weeks` de la respuesta, en el mismo orden.',
    }),
  })
  .meta({ id: 'PanelLoad' });

export const panelAvailabilitySchema = z
  .object({
    training: availabilityStatusSchema,
    match: availabilityStatusSchema,
    overall: availabilityStatusSchema.meta({ description: 'La peor de las dos.' }),
  })
  .meta({
    id: 'PanelAvailability',
    description: 'Disponibilidad derivada del día de referencia, sin la causa ni el diagnóstico.',
  });

export const panelAlertSchema = z
  .object({
    id: alertIdSchema,
    kind: alertRuleKindSchema,
    severity: alertSeveritySchema.meta({
      description:
        'La severidad del día de referencia: la del último día evaluado del episodio o, en una semana pasada de un episodio que siguió, la más alta que había alcanzado hasta ese día.',
    }),
    status: z.enum(['open', 'acknowledged']).meta({
      description:
        'La revisión del staff vigente el día de referencia. Las alertas descartadas (`dismissed`: el staff dijo que no aplica) no se devuelven.',
    }),
    raisedOn: localDateSchema,
    lastSeenOn: localDateSchema,
    messageKey: z.string().meta({ description: 'Clave del texto (`alert.<kind>.message`).' }),
    values: z.record(z.string(), z.number()),
  })
  .meta({ id: 'PanelAlert' });

export const panelPlayerSchema = z
  .object({
    playerId: playerIdSchema,
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    sex: sexSchema,
    sport: sportSchema,
    birthDate: localDateSchema,
    categoryIds: z.array(categoryIdSchema).meta({
      description: 'Categorías vigentes hoy (día del club).',
    }),
    position: z
      .object({
        id: positionIdSchema,
        code: z.string().min(1),
        label: z.string().min(1).nullable(),
      })
      .nullable()
      .meta({ description: 'Posición principal.' }),
    stage: stageSchema.nullable().meta({ description: 'Etapa vigente el día de referencia.' }),
    maturity: panelMaturitySchema.nullable(),
    wellness: panelWellnessSchema,
    load: panelLoadSchema,
    availability: panelAvailabilitySchema.nullable().meta({
      description: '`null` si la base no la informa para este jugador.',
    }),
    alerts: z.array(panelAlertSchema).meta({
      description:
        'Alertas activas el día de referencia (sin resolver), críticas primero. Heurísticas de carga, nunca un diagnóstico.',
    }),
  })
  .meta({ id: 'PanelPlayer' });

export const weeklyPanelSchema = z
  .object({
    today: localDateSchema.meta({ description: 'Hoy en la zona horaria del club.' }),
    week: weekRangeSchema,
    referenceDate: localDateSchema.meta({
      description: 'El domingo de la semana, o hoy si la semana está en curso.',
    }),
    weeks: z.array(weekRangeSchema).meta({
      description: 'Semanas de la historia, de la más vieja a la pedida (la última).',
    }),
    players: z.array(panelPlayerSchema).meta({
      description:
        'Jugadores vigentes hoy en el alcance, por apellido y nombre (nunca un ranking).',
    }),
  })
  .meta({ id: 'WeeklyPanel' });

export type WeeklyPanel = z.output<typeof weeklyPanelSchema>;
export type PanelPlayer = z.output<typeof panelPlayerSchema>;
export type PanelAlert = z.output<typeof panelAlertSchema>;
export type PanelWeekLoad = z.output<typeof panelWeekLoadSchema>;

export const getWeeklyPanel = defineEndpoint({
  method: 'GET',
  path: '/v1/panel/weekly',
  summary: 'Panel semanal',
  description: `Una lectura agregada de los jugadores que ve el staff para una semana del club (lunes a domingo): bienestar, carga (sRPE, ACWR, monotonía, historia semanal), maduración, disponibilidad sin la causa y alertas activas. \`coach\`, \`sc\` y \`medical\` ven los de sus asignaciones; la administración, todo el club; jugadores y tutores nunca (\`forbidden\`). Datos derivados por el worker: ni la API ni la web recalculan. Hasta ${String(PANEL_MAX_PLAYERS)} jugadores; si son más, \`bad_request\` (acotá por deporte o categoría). Una semana futura: \`bad_request\`.`,
  tags: ['panel'],
  auth: 'club',
  query: z.strictObject({
    weekOf: localDateSchema.optional().meta({
      description: 'Cualquier día de la semana; por defecto, hoy del club.',
    }),
    weeks: z.coerce
      .number<number>()
      .int()
      .min(PANEL_WEEKS_MIN)
      .max(PANEL_WEEKS_MAX)
      .default(PANEL_WEEKS_DEFAULT)
      .meta({
        description: `Semanas de historia de carga, la pedida incluida (${String(PANEL_WEEKS_MIN)} a ${String(PANEL_WEEKS_MAX)}).`,
      }),
    sport: sportSchema.optional(),
    categoryId: categoryIdSchema.optional().meta({
      description: 'Solo los que están hoy en esta categoría.',
    }),
  }),
  response: { status: 200, description: 'El panel de la semana.', schema: weeklyPanelSchema },
  errors: ['bad_request'],
});
