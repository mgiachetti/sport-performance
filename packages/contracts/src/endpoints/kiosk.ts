import { KIOSK_RPE_STATES } from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { sortQuerySchema, stageSchema } from '../primitives/conventions.js';
import { localDateSchema, timeZoneSchema } from '../primitives/dates.js';
import { categoryIdSchema, playerIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { playerNameSchema } from './players.js';
import { rpeWindowSchema, trainingSessionSummarySchema } from './training.js';
import { wellnessItemCountSchema, wellnessItemSchema } from './wellness.js';

/**
 * Kiosk mode (B-504, ADR 0086): a shared club device where players without
 * a phone load their wellness and session RPE, under the session of the staff
 * member who opened it. The roster is what the device keeps to work without
 * signal: who may load and what each one has left to load, never a value.
 */

export const kioskRpeStateSchema = z.enum(KIOSK_RPE_STATES).meta({
  id: 'KioskRpeState',
  description:
    '`pending` (sin RPE todavía), `reported` (ya cargado, por cualquier canal: el kiosco no corrige) o `not_taking_part` (el staff lo cargó ausente o no disponible: no hay carga).',
});

export const kioskRosterSessionSchema = z
  .object({
    session: trainingSessionSummarySchema,
    rpeWindow: rpeWindowSchema,
    state: kioskRpeStateSchema,
  })
  .meta({ id: 'KioskRosterSession' });

export const kioskRosterEntrySchema = z
  .object({
    player: z
      .object({ id: playerIdSchema, firstName: playerNameSchema, lastName: playerNameSchema })
      .meta({ id: 'KioskRosterPlayer' }),
    canReport: z.boolean().meta({
      description:
        'Si quien pide puede cargarle bienestar y RPE en el kiosco (matriz `wellness.kiosk_submit` y `rpe.kiosk_submit`, con el consentimiento `data` vigente). El kiosco no dice por qué no.',
    }),
    wellness: z
      .object({
        localDate: localDateSchema.meta({ description: 'Hoy, día del club.' }),
        stage: stageSchema,
        itemCount: wellnessItemCountSchema,
        items: z.array(wellnessItemSchema).meta({ description: 'Ítems a preguntar, en orden.' }),
        submitted: z.boolean().meta({
          description: 'Si ya cargó el bienestar de hoy (por cualquier canal). Nunca los puntajes.',
        }),
      })
      .nullable()
      .meta({
        id: 'KioskRosterWellness',
        description: '`null` si hoy no tiene etapa ni categoría: no se le pregunta.',
      }),
    sessions: z.array(kioskRosterSessionSchema).meta({
      description:
        'Sesiones activas de ayer y de hoy cuya ventana de RPE no cerró (también las que todavía no empezaron), de sus categorías ese día o con su participación, por hora de inicio.',
    }),
  })
  .meta({ id: 'KioskRosterEntry' });

export type KioskRpeStateDto = z.output<typeof kioskRpeStateSchema>;
export type KioskRosterSession = z.output<typeof kioskRosterSessionSchema>;
export type KioskRosterEntry = z.output<typeof kioskRosterEntrySchema>;

export const kioskRosterPageSchema = pageOf(kioskRosterEntrySchema)
  .extend({
    today: localDateSchema.meta({ description: 'Hoy en la zona horaria del club.' }),
    timeZone: timeZoneSchema.meta({
      description: 'Zona horaria del club: el dispositivo calcula "hoy" sin conexión.',
    }),
  })
  .meta({ id: 'KioskRosterPage' });

export type KioskRosterPage = z.output<typeof kioskRosterPageSchema>;

export const getKioskRoster = defineEndpoint({
  method: 'GET',
  path: '/v1/categories/{categoryId}/kiosk-roster',
  summary: 'Plantel del kiosco de una categoría',
  description:
    'Para el modo kiosco (B-504): los jugadores de la categoría hoy (día del club) que quien pide ve, con lo que les falta cargar hoy. Solo quien puede cargar en el kiosco (`wellness.kiosk_submit`: `coach` y `sc` de la categoría, la administración); los demás: `forbidden`. Nunca puntajes, valores, disponibilidad ni la causa de nada. Ordenado por apellido y nombre. De otro club: `not_found`.',
  tags: ['wellness'],
  auth: 'club',
  params: z.strictObject({ categoryId: categoryIdSchema }),
  query: pageQuerySchema.extend({ sort: sortQuerySchema(['name'], 'name') }),
  response: { status: 200, description: 'Página del plantel.', schema: kioskRosterPageSchema },
  errors: ['not_found', 'bad_request'],
});
