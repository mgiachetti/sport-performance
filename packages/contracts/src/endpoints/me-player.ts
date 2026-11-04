import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { sexSchema, sportSchema, stageSchema } from '../primitives/conventions.js';
import { localDateSchema, timeZoneSchema } from '../primitives/dates.js';
import { categoryIdSchema, playerIdSchema } from '../primitives/ids.js';
import {
  testSessionIdSchema,
  testSessionStatusSchema,
  testWindowIdSchema,
  testWindowNumberSchema,
} from './calendar.js';
import { playerNameSchema } from './players.js';
import { testCodeSchema } from './tests.js';
import { wellnessItemCountSchema, wellnessItemSchema } from './wellness.js';

/**
 * The player app (B-503, ADR 0074): what the phone of a player needs to work
 * offline and that no other read gives a player — their own profile with the
 * stage and wellness item set of today, what the permission matrix lets them
 * do, and their own upcoming test days (the player cannot read the test days
 * of a category: that is the staff's calendar). Both are read only by the
 * `player` role about themselves; any other role is `forbidden`.
 */

/** How far ahead the upcoming test days reach (club days, today included). */
export const MY_TEST_DAYS_HORIZON_DAYS = 120;
/** Most upcoming test days returned. */
export const MY_TEST_DAYS_MAX = 20;

export const myPlayerSchema = z
  .object({
    player: z.object({
      id: playerIdSchema,
      firstName: playerNameSchema,
      lastName: playerNameSchema,
      sport: sportSchema.meta({ description: 'Deporte de su categoría vigente.' }),
      sex: sexSchema,
    }),
    today: localDateSchema.meta({ description: 'Hoy en la zona horaria del club.' }),
    timeZone: timeZoneSchema.meta({
      description: 'Zona horaria del club: la app calcula "hoy" con ella también sin conexión.',
    }),
    ofAge: z.boolean().meta({ description: 'Mayor de edad hoy (firma sus consentimientos).' }),
    categoryId: categoryIdSchema.nullable().meta({
      description: 'Categoría vigente hoy; `null` si no tiene ninguna.',
    }),
    stage: stageSchema.nullable().meta({
      description:
        'Etapa de hoy con la que el servidor valida el bienestar (la fijada por el staff o la de su categoría); `null` sin categoría ni etapa.',
    }),
    wellness: z
      .object({
        itemCount: wellnessItemCountSchema,
        items: z.array(wellnessItemSchema).meta({ description: 'Ítems a preguntar, en orden.' }),
      })
      .nullable()
      .meta({ description: 'Conjunto de ítems de hoy; `null` sin etapa.' }),
    permissions: z
      .object({
        submitWellness: z.boolean().meta({
          description: 'Puede cargar su bienestar (necesita el consentimiento de datos vigente).',
        }),
        submitRpe: z.boolean().meta({ description: 'Puede cargar su RPE (ídem).' }),
        readPercentiles: z.boolean().meta({
          description:
            'Puede ver sus percentiles (desde M15, según su etapa y la franja de su categoría).',
        }),
      })
      .meta({ description: 'Lo que la matriz de permisos le deja hacer hoy.' }),
  })
  .meta({ id: 'MyPlayer' });

export type MyPlayer = z.output<typeof myPlayerSchema>;

export const myTestDaySchema = z
  .object({
    id: testSessionIdSchema,
    scheduledOn: localDateSchema,
    status: testSessionStatusSchema.meta({
      description: 'Solo `scheduled` (programado) o `in_progress` (en curso).',
    }),
    location: z.string().nullable(),
    testWindow: z
      .object({
        id: testWindowIdSchema,
        number: testWindowNumberSchema,
        label: z.enum(['V1', 'V2', 'V3', 'V4']),
      })
      .nullable()
      .meta({ description: 'Ventana del día de test; `null` fuera de ventana.' }),
    testCodes: z.array(testCodeSchema).meta({
      description:
        'Tests que la batería le programa ese día según su etapa, en el orden de la batería. Vacía si la batería no programa ninguno para él/ella.',
    }),
  })
  .meta({ id: 'MyTestDay' });

export type MyTestDay = z.output<typeof myTestDaySchema>;

export const getMyPlayer = defineEndpoint({
  method: 'GET',
  path: '/v1/me/player',
  summary: 'Mi ficha para la app del jugador',
  description:
    'Solo el rol `player`, sobre su propia ficha (`player_profile.read`). La app la guarda en el teléfono para cargar bienestar y RPE sin conexión: etapa e ítems de bienestar de hoy, zona horaria del club y lo que la matriz le deja hacer. Otro rol o un jugador sin ficha: `forbidden`.',
  tags: ['me', 'players'],
  auth: 'club',
  response: { status: 200, description: 'Mi ficha.', schema: myPlayerSchema },
  errors: [],
});

export const listMyTestDays = defineEndpoint({
  method: 'GET',
  path: '/v1/me/test-days',
  summary: 'Mis próximos días de test',
  description: `Solo el rol \`player\`, sobre sí mismo (\`player_profile.read\`). Los días de test programados o en curso de las categorías en las que está ese día, desde hoy (zona del club) y hasta ${String(MY_TEST_DAYS_HORIZON_DAYS)} días, como mucho ${String(MY_TEST_DAYS_MAX)}, por fecha. Cada uno con su ventana, el lugar y los tests que la batería le programa según su etapa. Nada de otros jugadores. Otro rol: \`forbidden\`.`,
  tags: ['me', 'calendar'],
  auth: 'club',
  response: {
    status: 200,
    description: 'Mis próximos días de test.',
    schema: z
      .object({
        today: localDateSchema,
        items: z.array(myTestDaySchema),
      })
      .meta({ id: 'MyTestDays' }),
  },
  errors: [],
});
