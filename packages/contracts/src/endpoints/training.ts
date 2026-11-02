import {
  CONTACT_LEVELS,
  EXPOSURE_CONTEXTS,
  MAX_SESSION_DURATION_MIN,
  PARTICIPATION_STATUSES,
  RPE_CR10_MAX,
  RPE_CR10_MIN,
  participationCarriesLoad,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  archivedAtSchema,
  archiveStatusQuerySchema,
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
  sportSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, playerIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { changeReasonSchema } from './change-history.js';

/**
 * Training sessions and matches (B-318): the session with its drills (and
 * their contact level), the participation of each player (status, minutes,
 * contacts) and the player's own session RPE. `srpeAu` = RPE × minutes is a
 * generated column of the database, never computed by a client.
 *
 * Changing a value that was already submitted (the minutes the coach
 * entered, the RPE the player sent, the start of a session) is a correction
 * (ADR 0030): the body carries `changeReason`, and without it the answer is
 * `400 validation_failed` at `body.changeReason`. Filling an empty value is
 * not a correction.
 */

/** Longest short text of a session or drill (title, location, opponent, drill name). */
export const TRAINING_TEXT_MAX_LENGTH = 120;
/** Longest note of a session or drill. */
export const TRAINING_NOTES_MAX_LENGTH = 2000;
/** Most drills in a session create. */
export const SESSION_DRILLS_MAX = 50;
/** Most rows of a participation batch. */
export const PARTICIPATION_BATCH_MAX = 100;
/** Largest minutes and contacts of a participation (the database checks the same). */
export const PARTICIPATION_MINUTES_MAX = 600;
export const PARTICIPATION_CONTACTS_MAX = 32_767;
/** Largest `sort_order` and duration (a `smallint`). */
const SMALLINT_MAX = 32_767;

function trimmedText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' });
}

export const trainingSessionIdSchema = idOf('sesión de entrenamiento o partido');
export const drillIdSchema = idOf('bloque (drill)');
export const participationIdSchema = idOf('participación');

export const sessionKindSchema = z.enum(EXPOSURE_CONTEXTS).meta({
  id: 'SessionKind',
  description:
    '`training` (entrenamiento) o `match` (partido): la exposición y la incidencia de lesiones se informan por separado (B-210).',
});

export const contactLevelSchema = z.enum(CONTACT_LEVELS).meta({
  id: 'ContactLevel',
  description:
    'Nivel de contacto del bloque: `none` (sin contacto), `controlled` (contacto controlado, intensidad reducida) o `full` (intensidad de partido).',
});

export const participationStatusSchema = z.enum(PARTICIPATION_STATUSES).meta({
  id: 'ParticipationStatus',
  description:
    '`full` (presente, toda la sesión), `partial` (limitado: parte de la sesión o con restricciones), `absent` (ausente) o `unavailable` (no disponible: lesionado o bloqueado; nunca la causa). Ausente y no disponible no llevan minutos, contactos ni RPE.',
});

const durationMinSchema = z.int().min(1).max(MAX_SESSION_DURATION_MIN);
const sortOrderSchema = z
  .int()
  .min(0)
  .max(SMALLINT_MAX)
  .meta({ description: 'Posición del bloque en la sesión (ascendente).' });
const minutesSchema = z
  .int()
  .min(0)
  .max(PARTICIPATION_MINUTES_MAX)
  .meta({ description: 'Minutos que participó.' });
const contactsSchema = z
  .int()
  .min(0)
  .max(PARTICIPATION_CONTACTS_MAX)
  .meta({ description: 'Contactos (tackles, rucks, scrums) registrados.' });
export const rpeSchema = z
  .int()
  .min(RPE_CR10_MIN)
  .max(RPE_CR10_MAX)
  .meta({ id: 'SessionRpe', description: 'RPE de la sesión, escala CR-10 de Borg (0 a 10).' });

export const drillSchema = z
  .object({
    id: drillIdSchema,
    trainingSessionId: trainingSessionIdSchema,
    name: trimmedText(TRAINING_TEXT_MAX_LENGTH),
    sortOrder: sortOrderSchema,
    durationMin: durationMinSchema.nullable(),
    contactLevel: contactLevelSchema,
    notes: trimmedText(TRAINING_NOTES_MAX_LENGTH).nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'Drill' });

const sessionFields = {
  id: trainingSessionIdSchema,
  sport: sportSchema.meta({ description: 'Deporte de la categoría de la sesión.' }),
  kind: sessionKindSchema,
  categoryId: categoryIdSchema.nullable().meta({
    description:
      'Categoría. La API siempre la pide; `null` solo en sesiones de todo un deporte que cargó una importación.',
  }),
  title: trimmedText(TRAINING_TEXT_MAX_LENGTH).nullable(),
  startsAt: dateTimeSchema,
  localDate: localDateSchema.meta({
    description: 'Día del club de `startsAt` (en la zona horaria del club).',
  }),
  plannedDurationMin: durationMinSchema.nullable(),
  location: trimmedText(TRAINING_TEXT_MAX_LENGTH).nullable(),
  opponent: trimmedText(TRAINING_TEXT_MAX_LENGTH)
    .nullable()
    .meta({ description: 'Rival: solo en partidos.' }),
  notes: trimmedText(TRAINING_NOTES_MAX_LENGTH).nullable(),
  archivedAt: archivedAtSchema,
};

export const trainingSessionSchema = z
  .object({
    ...sessionFields,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'TrainingSession' });

export const trainingSessionDetailSchema = trainingSessionSchema
  .extend({
    drills: z.array(drillSchema).meta({ description: 'Bloques, por `sortOrder`.' }),
  })
  .meta({ id: 'TrainingSessionDetail' });

/** What a participation shows of its session (the player cannot read sessions themselves). */
export const trainingSessionSummarySchema = z
  .object({
    id: trainingSessionIdSchema,
    sport: sportSchema,
    kind: sessionKindSchema,
    categoryId: sessionFields.categoryId,
    title: sessionFields.title,
    startsAt: dateTimeSchema,
    localDate: sessionFields.localDate,
    plannedDurationMin: sessionFields.plannedDurationMin,
    archivedAt: archivedAtSchema,
  })
  .meta({ id: 'TrainingSessionSummary' });

export const participationSchema = z
  .object({
    id: participationIdSchema,
    trainingSessionId: trainingSessionIdSchema,
    playerId: playerIdSchema,
    status: participationStatusSchema,
    minutes: minutesSchema.nullable(),
    contactsN: contactsSchema.nullable(),
    rpe: rpeSchema
      .nullable()
      .meta({ description: 'RPE que cargó el jugador; `null` si todavía no.' }),
    rpeReportedAt: dateTimeSchema.nullable(),
    srpeAu: z.int().min(0).nullable().meta({
      description:
        'Carga sRPE = RPE × minutos (UA), columna generada de la base; `null` sin RPE o sin minutos.',
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'Participation' });

export const participationListItemSchema = participationSchema
  .extend({ session: trainingSessionSummarySchema })
  .meta({ id: 'ParticipationListItem' });

export const rpeWindowSchema = z
  .object({
    opensAt: dateTimeSchema.meta({ description: 'Desde cuándo se acepta (inicio de la sesión).' }),
    closesAt: dateTimeSchema.meta({
      description: 'Hasta cuándo (excluido): fin del día del club siguiente al de la sesión.',
    }),
  })
  .meta({ id: 'RpeWindow' });

export const myTrainingSessionSchema = z
  .object({
    session: trainingSessionSummarySchema,
    participation: participationSchema
      .nullable()
      .meta({ description: 'Lo que cargó el staff o el jugador; `null` si nadie cargó nada.' }),
    rpeWindow: rpeWindowSchema,
    canSubmitRpe: z.boolean().meta({
      description:
        'Si ahora puede cargar (o corregir) el RPE: ventana abierta, sesión activa y no figura ausente ni no disponible.',
    }),
  })
  .meta({ id: 'MyTrainingSession' });

export type TrainingSession = z.output<typeof trainingSessionSchema>;
export type TrainingSessionDetail = z.output<typeof trainingSessionDetailSchema>;
export type TrainingSessionSummary = z.output<typeof trainingSessionSummarySchema>;
export type Drill = z.output<typeof drillSchema>;
export type Participation = z.output<typeof participationSchema>;
export type ParticipationListItem = z.output<typeof participationListItemSchema>;
export type MyTrainingSession = z.output<typeof myTrainingSessionSchema>;

// ─── Inputs ──────────────────────────────────────────────────────────────────────────

const sessionParams = z.strictObject({ trainingSessionId: trainingSessionIdSchema });
const drillParams = z.strictObject({ drillId: drillIdSchema });
const participationParams = z.strictObject({ participationId: participationIdSchema });

const drillInputFields = {
  name: trimmedText(TRAINING_TEXT_MAX_LENGTH),
  sortOrder: sortOrderSchema
    .optional()
    .meta({ description: 'Por defecto, después del último bloque.' }),
  durationMin: durationMinSchema.optional(),
  contactLevel: contactLevelSchema.optional().meta({ description: 'Por defecto `none`.' }),
  notes: trimmedText(TRAINING_NOTES_MAX_LENGTH).optional(),
};

export const drillCreateSchema = z
  .strictObject({ clientUuid: clientUuidSchema.optional(), ...drillInputFields })
  .meta({ id: 'DrillCreate' });

function opponentOnlyInMatches(
  value: { kind?: string | undefined; opponent?: string | null | undefined },
  ctx: z.core.$RefinementCtx,
): void {
  if (value.kind === 'training' && value.opponent !== undefined && value.opponent !== null) {
    ctx.addIssue({
      code: 'custom',
      path: ['opponent'],
      message: 'Only matches have an opponent',
    });
  }
}

/** Rows without load (absent, unavailable) carry no minutes and no contacts. */
function noLoadWithoutMinutes(
  value: {
    status?: string | undefined;
    minutes?: number | null | undefined;
    contactsN?: number | null | undefined;
  },
  ctx: z.core.$RefinementCtx,
): void {
  const status = value.status;
  if (status === undefined) return;
  if (participationCarriesLoad(status as (typeof PARTICIPATION_STATUSES)[number])) return;
  for (const field of ['minutes', 'contactsN'] as const) {
    const amount = value[field];
    if (amount !== undefined && amount !== null && amount !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: `A player who is ${status} has no ${field}`,
      });
    }
  }
}

export const listTrainingSessions = defineEndpoint({
  method: 'GET',
  path: '/v1/training-sessions',
  summary: 'Sesiones de entrenamiento y partidos',
  description:
    'La administración ve todas; `coach`, `sc` y `medical` las de sus categorías (o deportes) asignados. Jugadores y tutores ven las suyas en `GET /v1/me/training-sessions`. `from` y `to` son días del club, incluidos.',
  tags: ['training'],
  auth: 'club',
  query: pageQuerySchema.extend({
    categoryId: categoryIdSchema.optional(),
    kind: sessionKindSchema.optional(),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['startsAt', 'createdAt'], '-startsAt'),
  }),
  response: {
    status: 200,
    description: 'Página de sesiones.',
    schema: pageOf(trainingSessionSchema).meta({ id: 'TrainingSessionPage' }),
  },
  errors: ['bad_request'],
});

export const getTrainingSession = defineEndpoint({
  method: 'GET',
  path: '/v1/training-sessions/{trainingSessionId}',
  summary: 'Una sesión, con sus bloques',
  description:
    'Mismo alcance que la lista. De otro club: `not_found`; fuera del alcance: `forbidden`.',
  tags: ['training'],
  auth: 'club',
  params: sessionParams,
  response: { status: 200, description: 'La sesión.', schema: trainingSessionDetailSchema },
  errors: ['not_found'],
});

export const createTrainingSession = defineEndpoint({
  method: 'POST',
  path: '/v1/training-sessions',
  summary: 'Crear una sesión o un partido',
  description:
    'El `coach` en sus categorías asignadas y la administración. El deporte sale de la categoría (activa) y `localDate` de `startsAt` en la zona horaria del club. Los bloques se pueden crear en la misma alta. Idempotente por `clientUuid`.',
  tags: ['training'],
  auth: 'club',
  body: z
    .strictObject({
      clientUuid: clientUuidSchema.optional(),
      kind: sessionKindSchema,
      categoryId: categoryIdSchema,
      startsAt: dateTimeSchema,
      plannedDurationMin: durationMinSchema.optional(),
      title: trimmedText(TRAINING_TEXT_MAX_LENGTH).optional(),
      location: trimmedText(TRAINING_TEXT_MAX_LENGTH).optional(),
      opponent: trimmedText(TRAINING_TEXT_MAX_LENGTH).optional(),
      notes: trimmedText(TRAINING_NOTES_MAX_LENGTH).optional(),
      drills: z.array(drillCreateSchema).max(SESSION_DRILLS_MAX).optional(),
    })
    .superRefine(opponentOnlyInMatches),
  response: { status: 201, description: 'Sesión creada.', schema: trainingSessionDetailSchema },
  errors: ['conflict'],
});

export const updateTrainingSession = defineEndpoint({
  method: 'PATCH',
  path: '/v1/training-sessions/{trainingSessionId}',
  summary: 'Editar una sesión',
  description:
    'Mismo permiso que el alta (también sobre la categoría nueva, si cambia). Cambiar un dato ya cargado es una corrección: pide `changeReason`. `null` vacía un campo opcional. `version` desactualizada: `conflict`; sesión archivada: `conflict`.',
  tags: ['training'],
  auth: 'club',
  params: sessionParams,
  body: z
    .strictObject({
      version: expectedVersionSchema,
      changeReason: changeReasonSchema.optional(),
      kind: sessionKindSchema.optional(),
      categoryId: categoryIdSchema.optional(),
      startsAt: dateTimeSchema.optional(),
      plannedDurationMin: durationMinSchema.nullable().optional(),
      title: trimmedText(TRAINING_TEXT_MAX_LENGTH).nullable().optional(),
      location: trimmedText(TRAINING_TEXT_MAX_LENGTH).nullable().optional(),
      opponent: trimmedText(TRAINING_TEXT_MAX_LENGTH).nullable().optional(),
      notes: trimmedText(TRAINING_NOTES_MAX_LENGTH).nullable().optional(),
    })
    .superRefine(opponentOnlyInMatches),
  response: { status: 200, description: 'La sesión actualizada.', schema: trainingSessionSchema },
  errors: ['not_found', 'conflict'],
});

export const archiveTrainingSession = defineEndpoint({
  method: 'POST',
  path: '/v1/training-sessions/{trainingSessionId}/archive',
  summary: 'Archivar una sesión',
  description:
    'Suspendida o cargada por error. Conserva la participación para la historia, pero no acepta bloques, participación ni RPE nuevos. Idempotente.',
  tags: ['training'],
  auth: 'club',
  params: sessionParams,
  response: { status: 200, description: 'Sesión archivada.', schema: trainingSessionSchema },
  errors: ['not_found'],
});

export const restoreTrainingSession = defineEndpoint({
  method: 'POST',
  path: '/v1/training-sessions/{trainingSessionId}/restore',
  summary: 'Restaurar una sesión',
  description: 'Mismo permiso que el alta. Idempotente.',
  tags: ['training'],
  auth: 'club',
  params: sessionParams,
  response: { status: 200, description: 'Sesión restaurada.', schema: trainingSessionSchema },
  errors: ['not_found'],
});

export const createDrill = defineEndpoint({
  method: 'POST',
  path: '/v1/training-sessions/{trainingSessionId}/drills',
  summary: 'Agregar un bloque a una sesión',
  description:
    'Mismo permiso que editar la sesión. Por defecto va al final. Idempotente por `clientUuid`; sesión archivada: `conflict`.',
  tags: ['training'],
  auth: 'club',
  params: sessionParams,
  body: drillCreateSchema,
  response: { status: 201, description: 'Bloque creado.', schema: drillSchema },
  errors: ['not_found', 'conflict'],
});

export const updateDrill = defineEndpoint({
  method: 'PATCH',
  path: '/v1/drills/{drillId}',
  summary: 'Editar un bloque',
  description:
    'Mismo permiso que editar la sesión. `null` vacía la duración o la nota. `version` desactualizada o sesión archivada: `conflict`.',
  tags: ['training'],
  auth: 'club',
  params: drillParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    name: trimmedText(TRAINING_TEXT_MAX_LENGTH).optional(),
    sortOrder: sortOrderSchema.optional(),
    durationMin: durationMinSchema.nullable().optional(),
    contactLevel: contactLevelSchema.optional(),
    notes: trimmedText(TRAINING_NOTES_MAX_LENGTH).nullable().optional(),
  }),
  response: { status: 200, description: 'El bloque actualizado.', schema: drillSchema },
  errors: ['not_found', 'conflict'],
});

export const deleteDrill = defineEndpoint({
  method: 'DELETE',
  path: '/v1/drills/{drillId}',
  summary: 'Quitar un bloque',
  description:
    'El plan de la sesión no es un dato de un jugador: es la única tabla donde se borra (ADR 0026, ADR 0032). Sesión archivada: `conflict`.',
  tags: ['training'],
  auth: 'club',
  params: drillParams,
  response: { status: 204, description: 'Bloque borrado.', schema: undefined },
  errors: ['not_found', 'conflict'],
});

export const participationRowSchema = z
  .strictObject({
    clientUuid: clientUuidSchema.meta({
      description:
        'Id de la fila generado por el cliente. Reenviar una fila ya aplicada no la duplica: vuelve como `replayed`.',
    }),
    playerId: playerIdSchema,
    status: participationStatusSchema,
    minutes: minutesSchema.nullable().optional().meta({
      description: 'Omitido: se mantiene; `null`: se vacía. Ausente o no disponible: sin minutos.',
    }),
    contactsN: contactsSchema.nullable().optional(),
    version: expectedVersionSchema.optional().meta({
      description:
        'Versión que el cliente leyó, si la fila ya existía. Si no es la actual y la fila cambiaría: `conflict`.',
    }),
  })
  .superRefine(noLoadWithoutMinutes)
  .meta({ id: 'ParticipationRow' });

export const PARTICIPATION_OUTCOMES = ['created', 'updated', 'unchanged', 'replayed'] as const;

export const participationBatchResultSchema = z
  .object({
    items: z.array(
      z.object({
        outcome: z.enum(PARTICIPATION_OUTCOMES).meta({
          description:
            '`created`, `updated`, `unchanged` (ya tenía esos valores) o `replayed` (la fila de ese `clientUuid` ya se había aplicado).',
        }),
        participation: participationSchema,
      }),
    ),
  })
  .meta({ id: 'ParticipationBatchResult' });

export const recordParticipations = defineEndpoint({
  method: 'POST',
  path: '/v1/training-sessions/{trainingSessionId}/participations/batch',
  summary: 'Cargar la participación de la sesión',
  description:
    'Carga masiva del staff (`coach` de los jugadores asignados, administración), con consentimiento `data` vigente de cada jugador. Crea o actualiza por jugador; todo o nada. Ausente o no disponible borra los minutos, los contactos y el RPE. Corregir un valor ya cargado pide `changeReason`. Cada fila es idempotente por `clientUuid` (apta para la cola offline). Jugador desconocido: `validation_failed` en `body.rows[i].playerId`; sesión archivada o `version` desactualizada: `conflict`.',
  tags: ['training'],
  auth: 'club',
  params: sessionParams,
  body: z
    .strictObject({
      changeReason: changeReasonSchema.optional(),
      rows: z.array(participationRowSchema).min(1).max(PARTICIPATION_BATCH_MAX),
    })
    .superRefine((value, ctx) => {
      const players = new Set<string>();
      const uuids = new Set<string>();
      value.rows.forEach((row, index) => {
        if (players.has(row.playerId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['rows', index, 'playerId'],
            message: 'One row per player',
          });
        }
        if (uuids.has(row.clientUuid)) {
          ctx.addIssue({
            code: 'custom',
            path: ['rows', index, 'clientUuid'],
            message: 'Repeated clientUuid',
          });
        }
        players.add(row.playerId);
        uuids.add(row.clientUuid);
      });
    }),
  response: {
    status: 200,
    description: 'Cada fila, en el orden del pedido, con lo que pasó.',
    schema: participationBatchResultSchema,
  },
  errors: ['not_found', 'conflict'],
});

export const updateParticipation = defineEndpoint({
  method: 'PATCH',
  path: '/v1/participations/{participationId}',
  summary: 'Editar la participación de un jugador',
  description:
    'Mismo permiso que la carga masiva. Corregir un valor ya cargado pide `changeReason`. `version` desactualizada o sesión archivada: `conflict`.',
  tags: ['training'],
  auth: 'club',
  params: participationParams,
  body: z
    .strictObject({
      version: expectedVersionSchema,
      changeReason: changeReasonSchema.optional(),
      status: participationStatusSchema.optional(),
      minutes: minutesSchema.nullable().optional(),
      contactsN: contactsSchema.nullable().optional(),
    })
    .superRefine(noLoadWithoutMinutes),
  response: {
    status: 200,
    description: 'La participación actualizada.',
    schema: participationSchema,
  },
  errors: ['not_found', 'conflict'],
});

export const listParticipations = defineEndpoint({
  method: 'GET',
  path: '/v1/participations',
  summary: 'Participación por sesión o por jugador',
  description:
    'El staff ve la de sus jugadores asignados, la administración la de todo el club y el jugador la suya. Cada fila trae su sesión resumida. `from` y `to` son días del club, incluidos.',
  tags: ['training'],
  auth: 'club',
  query: pageQuerySchema.extend({
    trainingSessionId: trainingSessionIdSchema.optional(),
    playerId: playerIdSchema.optional(),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    sort: sortQuerySchema(['startsAt', 'createdAt'], '-startsAt'),
  }),
  response: {
    status: 200,
    description: 'Página de participaciones.',
    schema: pageOf(participationListItemSchema).meta({ id: 'ParticipationPage' }),
  },
  errors: ['bad_request'],
});

export const submitSessionRpe = defineEndpoint({
  method: 'POST',
  path: '/v1/training-sessions/{trainingSessionId}/rpe',
  summary: 'Cargar mi RPE de la sesión',
  description:
    'Solo el jugador, para sí mismo y con consentimiento `data` vigente. Dentro de la ventana: desde el inicio de la sesión hasta el fin del día del club siguiente. Si el staff todavía no cargó su participación (y la sesión es de una de sus categorías) se crea como `full` con los minutos planificados. Corregir un RPE ya enviado pide `changeReason`. Fuera de la ventana, sesión archivada o figura ausente o no disponible: `conflict`. Idempotente por `clientUuid`.',
  tags: ['training'],
  auth: 'club',
  params: sessionParams,
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    rpe: rpeSchema,
    changeReason: changeReasonSchema.optional(),
  }),
  response: { status: 200, description: 'Mi participación.', schema: participationSchema },
  errors: ['not_found', 'conflict'],
});

export const listMyTrainingSessions = defineEndpoint({
  method: 'GET',
  path: '/v1/me/training-sessions',
  summary: 'Mis sesiones y mi RPE',
  description:
    'El jugador: las sesiones activas de sus categorías de ese día (y las que tienen su participación), con lo cargado y la ventana del RPE, para saber qué falta puntuar. `from` y `to` son días del club, incluidos.',
  tags: ['training'],
  auth: 'club',
  query: pageQuerySchema.extend({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    sort: sortQuerySchema(['startsAt'], '-startsAt'),
  }),
  response: {
    status: 200,
    description: 'Página de mis sesiones.',
    schema: pageOf(myTrainingSessionSchema).meta({ id: 'MyTrainingSessionPage' }),
  },
  errors: ['bad_request'],
});
