import {
  USAGE_ACTIVITY_RETENTION_DAYS,
  USAGE_CLIENTS,
  USAGE_SURFACES,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { sexSchema, sportSchema } from '../primitives/conventions.js';
import { localDateSchema, timeZoneSchema } from '../primitives/dates.js';
import { categoryIdSchema } from '../primitives/ids.js';
import { membershipRoleSchema } from './auth.js';
import { categoryNameSchema } from './categories.js';

/**
 * Usage metrics of the club (B-707, ADR 0093): adoption by week, for the
 * administration (the pilot's review, B-709). Everything is a count: the
 * outcomes come from the data (wellness, RPE, test results), the use of the
 * surfaces from the first-party record the API keeps when it serves them
 * (no third-party SDK). Never a member, a player or a ranking.
 */

export const USAGE_WEEKS_MIN = 1;
export const USAGE_WEEKS_MAX = 26;
export const USAGE_WEEKS_DEFAULT = 4;

export const usageSurfaceSchema = z.enum(USAGE_SURFACES).meta({
  id: 'UsageSurface',
  description:
    'Superficie usada: `panel` (panel semanal del staff), `player_profile` (ficha de un jugador abierta por el staff), `test_day_sheet` (planilla de un día de test), `player_home` (inicio del jugador en la app), `guardian_home` (hijos/as del tutor) o `kiosk` (plantel del kiosco).',
});

export const usageClientSchema = z.enum(USAGE_CLIENTS).meta({
  id: 'UsageClient',
  description: 'Desde dónde: `web` (la web del staff) o `app` (la app mobile).',
});

const countSchema = z.number().int().min(0);
const rateSchema = z.number().min(0).max(1).nullable();

export const usageWeekSchema = z
  .object({
    weekStart: localDateSchema.meta({ description: 'Lunes de la semana (día del club).' }),
    weekEnd: localDateSchema.meta({ description: 'Domingo de la semana.' }),
  })
  .meta({ id: 'UsageWeek' });

export const usageCategorySchema = z
  .object({
    id: categoryIdSchema,
    name: categoryNameSchema,
    sport: sportSchema,
    sex: sexSchema,
  })
  .meta({ id: 'UsageCategory' });

export const usageTrainingRowSchema = z
  .object({
    weekStart: localDateSchema,
    categoryId: categoryIdSchema.nullable().meta({
      description: 'Categoría de la sesión; `null`: sesiones sin categoría.',
    }),
    sessions: countSchema.meta({ description: 'Sesiones y partidos de la semana, hasta hoy.' }),
    attendedPlayerDays: countSchema.meta({
      description: 'Jugador × día con una sesión a la que fue (completa o parcial).',
    }),
    attendedPlayerDaysWithWellness: countSchema.meta({
      description: 'De esos, los que tienen bienestar cargado ese día del club.',
    }),
    attendedParticipations: countSchema.meta({
      description: 'Participaciones completas o parciales.',
    }),
    participationsWithRpe: countSchema.meta({ description: 'De esas, las que tienen RPE.' }),
    rpeViaKiosk: countSchema.meta({ description: 'RPE cargados en el kiosco del club.' }),
    wellnessOnSessionDaysRate: rateSchema.meta({
      description: 'Bienestar en días de sesión / días de sesión; `null` sin sesiones.',
    }),
    rpeRate: rateSchema.meta({
      description: 'Participaciones con RPE / participaciones; `null` sin participaciones.',
    }),
  })
  .meta({ id: 'UsageTrainingRow' });

export const usageWellnessRowSchema = z
  .object({
    weekStart: localDateSchema,
    categoryId: categoryIdSchema.nullable().meta({
      description: 'Categoría del jugador ese día; `null`: sin categoría.',
    }),
    rosterPlayers: countSchema.meta({
      description: 'Jugadores en la categoría en algún día de la semana (sin los dados de baja).',
    }),
    responses: countSchema.meta({ description: 'Bienestares cargados en la semana.' }),
    respondents: countSchema.meta({ description: 'Jugadores distintos que cargaron alguno.' }),
    viaKiosk: countSchema.meta({ description: 'Bienestares cargados en el kiosco.' }),
  })
  .meta({ id: 'UsageWellnessRow' });

export const usageTestRowSchema = z
  .object({
    weekStart: localDateSchema,
    categoryId: categoryIdSchema.nullable().meta({
      description:
        'Categoría del día de test; `null`: resultados sin día de test o de un día sin categoría.',
    }),
    testDays: countSchema.meta({
      description: 'Días de test con al menos un resultado medido en la semana.',
    }),
    results: countSchema.meta({
      description: 'Resultados cargados (hechos o no hechos), sin los importados.',
    }),
    playersTested: countSchema.meta({ description: 'Jugadores distintos con un resultado.' }),
    importedResults: countSchema.meta({
      description: 'Resultados históricos importados con fecha de la semana (aparte).',
    }),
  })
  .meta({ id: 'UsageTestRow' });

export const usageSurfaceRowSchema = z
  .object({
    weekStart: localDateSchema,
    surface: usageSurfaceSchema,
    client: usageClientSchema,
    role: membershipRoleSchema,
    activeMembers: countSchema.meta({
      description: 'Miembros distintos con ese rol que la usaron en la semana.',
    }),
    memberDays: countSchema.meta({
      description: 'Suma de los días que la usó cada uno (de 1 a 7 por miembro).',
    }),
    events: countSchema.meta({ description: 'Veces que se sirvió (pedidos, no tiempo de uso).' }),
  })
  .meta({ id: 'UsageSurfaceRow' });

export const usageMembersRowSchema = z
  .object({
    weekStart: localDateSchema,
    role: membershipRoleSchema,
    members: countSchema.meta({
      description: 'Membresías activas con ese rol en algún momento de la semana.',
    }),
  })
  .meta({ id: 'UsageMembersRow' });

export const usageSummarySchema = z
  .object({
    timeZone: timeZoneSchema,
    today: localDateSchema.meta({ description: 'Hoy en la zona del club.' }),
    isDemo: z.boolean().meta({
      description: 'Club demo (datos ficticios): no se mezcla con los clubes reales.',
    }),
    weeks: z.array(usageWeekSchema).meta({ description: 'Las semanas pedidas, en orden.' }),
    usageRetainedFrom: localDateSchema.meta({
      description: `Lunes desde el que hay uso por miembro (${String(USAGE_ACTIVITY_RETENTION_DAYS)} días). Antes, solo los conteos semanales que quedaron.`,
    }),
    categories: z.array(usageCategorySchema).meta({
      description: 'Categorías nombradas en las filas.',
    }),
    training: z.array(usageTrainingRowSchema),
    wellness: z.array(usageWellnessRowSchema),
    tests: z.array(usageTestRowSchema),
    surfaces: z.array(usageSurfaceRowSchema),
    members: z.array(usageMembersRowSchema),
  })
  .meta({ id: 'UsageSummary' });

export type UsageSummary = z.output<typeof usageSummarySchema>;

export const getUsageSummary = defineEndpoint({
  method: 'GET',
  path: '/v1/usage/summary',
  summary: 'Métricas de uso',
  description: `Adopción del club por semana (lunes a domingo del club), solo conteos: bienestar en días de sesión, RPE, días de test cargados y uso de las superficies (panel, ficha, planilla de test, app del jugador, tutor, kiosco) por rol y por web o app. El uso lo registra la API al servir esas superficies, sin SDK de terceros; el uso por miembro se guarda ${String(USAGE_ACTIVITY_RETENTION_DAYS)} días y después quedan conteos semanales sin miembros. Nunca muestra a un miembro ni a un jugador. Solo la administración (y el superadmin con acceso de soporte, que no cuenta como uso). Filas solo donde hay algo. Una semana futura: \`bad_request\`.`,
  tags: ['usage'],
  auth: 'club',
  query: z.strictObject({
    weekOf: localDateSchema.optional().meta({
      description: 'Cualquier día de la última semana; por defecto, hoy del club.',
    }),
    weeks: z.coerce
      .number<number>()
      .int()
      .min(USAGE_WEEKS_MIN)
      .max(USAGE_WEEKS_MAX)
      .default(USAGE_WEEKS_DEFAULT)
      .meta({
        description: `Semanas, la pedida incluida (${String(USAGE_WEEKS_MIN)} a ${String(USAGE_WEEKS_MAX)}).`,
      }),
  }),
  response: { status: 200, description: 'Las métricas de uso.', schema: usageSummarySchema },
  errors: ['bad_request'],
});
