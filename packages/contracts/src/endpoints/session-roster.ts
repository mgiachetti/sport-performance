import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { archivedAtSchema, sortQuerySchema } from '../primitives/conventions.js';
import { playerIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { availabilityStatusSchema } from './panel.js';
import { playerNameSchema } from './players.js';
import { participationSchema, trainingSessionIdSchema } from './training.js';

/**
 * The roster of a session (B-407): what the staff needs to record the
 * participation in one read. The players of the session's category on the
 * session's club day, plus anyone who already has a participation in it
 * (called up from another category), each with that participation, the
 * derived availability of the medical staff (`medical.availability`,
 * audited; never the cause, ADR 0029) and whether the caller may record it.
 */

export const sessionAvailabilitySchema = z
  .object({
    status: availabilityStatusSchema.meta({
      description:
        'Para el tipo de la sesión (entrenamiento o partido), el día del club de la sesión.',
    }),
    staffNotes: z.array(z.string().min(1)).meta({
      description:
        'Notas para el staff de los bloqueos vigentes ("sin contacto"), escritas por el staff médico sin diagnóstico.',
    }),
  })
  .meta({ id: 'SessionAvailability' });

export const sessionRosterPlayerSchema = z
  .object({
    id: playerIdSchema,
    firstName: playerNameSchema,
    lastName: playerNameSchema,
    archivedAt: archivedAtSchema.meta({ description: 'Baja del club, si la tuvo.' }),
  })
  .meta({ id: 'SessionRosterPlayer' });

export const sessionRosterEntrySchema = z
  .object({
    player: sessionRosterPlayerSchema,
    inCategory: z.boolean().meta({
      description:
        'Si el jugador estaba en la categoría de la sesión ese día; `false`: convocado de otra categoría (tiene participación cargada).',
    }),
    participation: participationSchema
      .nullable()
      .meta({ description: 'Lo cargado; `null` si todavía nadie cargó nada.' }),
    availability: sessionAvailabilitySchema.nullable().meta({
      description: '`null` si quien pide no puede ver la disponibilidad de ese jugador.',
    }),
    hasDataConsent: z
      .boolean()
      .meta({ description: 'Si tiene consentimiento `data` vigente (sin él no se carga nada).' }),
    canRecord: z.boolean().meta({
      description:
        'Si quien pide puede cargar su participación ahora (permiso de la matriz y consentimiento vigente). La sesión archivada no acepta cargas aunque diga `true`.',
    }),
  })
  .meta({ id: 'SessionRosterEntry' });

export type AvailabilityStatusDto = z.output<typeof availabilityStatusSchema>;
export type SessionAvailability = z.output<typeof sessionAvailabilitySchema>;
export type SessionRosterEntry = z.output<typeof sessionRosterEntrySchema>;

export const listTrainingSessionRoster = defineEndpoint({
  method: 'GET',
  path: '/v1/training-sessions/{trainingSessionId}/roster',
  summary: 'Plantel de una sesión, con su participación y disponibilidad',
  description:
    'Quien puede leer la sesión: los jugadores de su categoría el día de la sesión (día del club) y los que ya tienen participación cargada, dentro de lo que ve por asignación (RLS). Cada fila trae la participación, la disponibilidad derivada para el tipo de sesión (sin la causa; la lectura queda en el log médico) y si quien pide puede cargarla. Ordenado por apellido y nombre. De otro club: `not_found`; fuera del alcance: `forbidden`.',
  tags: ['training'],
  auth: 'club',
  params: z.strictObject({ trainingSessionId: trainingSessionIdSchema }),
  query: pageQuerySchema.extend({
    sort: sortQuerySchema(['name'], 'name'),
  }),
  response: {
    status: 200,
    description: 'Página del plantel.',
    schema: pageOf(sessionRosterEntrySchema).meta({ id: 'SessionRosterPage' }),
  },
  errors: ['not_found', 'bad_request'],
});
