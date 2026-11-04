import {
  HLC_MAX_LENGTH,
  HLC_PATTERN,
  SYNC_COLLECTIONS,
  SYNC_MUTATION_STATUSES,
  SYNC_STORED_OUTCOMES,
  SYNC_OPERATIONS,
  SYNC_PULL_LIMIT_DEFAULT,
  SYNC_PULL_LIMIT_MAX,
  SYNC_PUSH_MAX,
  type SyncOperation,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  anthroMeasurementSchema,
  recordAnthroMeasurements,
  updateAnthroMeasurement,
} from './anthropometry.js';
import { clientUuidSchema } from '../primitives/conventions.js';
import { errorBodySchema } from '../primitives/errors.js';
import { uuidSchema } from '../primitives/ids.js';
import { testSessionIdSchema, testSessionSchema } from './calendar.js';
import { changeReasonSchema } from './change-history.js';
import {
  externalLoadCorrectionSchema,
  externalLoadSchema,
  reportExternalLoad,
} from './external-loads.js';
import {
  addTestResultEntries,
  createTestResult,
  recordTestSessionResults,
  testResultSchema,
  updateTestResult,
  voidTestResultEntries,
} from './tests.js';
import {
  contactsSchema,
  minutesSchema,
  participationSchema,
  participationStatusSchema,
  periodMinutesSchema,
  recordParticipations,
  submitSessionRpe,
  trainingSessionIdSchema,
  trainingSessionSchema,
} from './training.js';
import { logMenstrualCycleDay } from './menstrual-cycle.js';
import { submitPainReport } from './pain-reports.js';
import { submitWellness, wellnessSchema, wellnessScoresInputSchema } from './wellness.js';
import { correctGymSet, gymProgramSchema, gymSetSchema, logGymSets, voidGymSet } from './gym.js';

/**
 * Offline sync (B-323, ADR 0015, ADR 0050): the device pushes its queue of
 * mutations (each one a write the API already serves online, run by the
 * same handler) and pulls the changes since its cursor.
 */

export const syncCollectionSchema = z.enum(SYNC_COLLECTIONS).meta({
  id: 'SyncCollection',
  description:
    'Colección sincronizable: `wellness`, `participation`, `training_session`, `test_session`, `test_result` (con sus intentos), `gym_program` (solo lectura), `gym_set`, `anthro_measurement` (con la maduración que deriva el worker) o `external_load` (actividades fuera del club que informa el jugador).',
});

export const syncOperationSchema = z.enum(SYNC_OPERATIONS).meta({
  id: 'SyncOperation',
  description: 'Escritura de la cola sin conexión; cada una es la de un endpoint en línea.',
});

export const hlcSchema = z.string().max(HLC_MAX_LENGTH).regex(HLC_PATTERN).meta({
  id: 'Hlc',
  description:
    'Reloj lógico híbrido `PPPPPPPPPPPPPPP-CCCCCC-nodo`: milisegundos desde 1970 (15 dígitos), contador (6 dígitos) y nodo del dispositivo (16 a 32 caracteres hex en minúscula). Se ordena como texto.',
  example: '001793620800000-000003-0f1e2d3c4b5a6978',
});

/** The row an edit applies to: its id, or the `clientUuid` it was created with offline. */
export const syncTargetSchema = z
  .union([z.strictObject({ id: uuidSchema }), z.strictObject({ clientUuid: clientUuidSchema })])
  .meta({
    id: 'SyncTarget',
    description:
      'Fila que edita la mutación: `{ id }` o, si se creó sin conexión, `{ clientUuid }` de su alta.',
  });

// ─── Inputs of each operation ────────────────────────────────────────────────────────

const trainingSessionParams = z.strictObject({ trainingSessionId: trainingSessionIdSchema });
const testSessionParams = z.strictObject({ testSessionId: testSessionIdSchema });

const participationFields = {
  status: participationStatusSchema.optional(),
  minutes: minutesSchema.nullable().optional(),
  periodMinutes: periodMinutesSchema.nullable().optional(),
  contactsN: contactsSchema.nullable().optional(),
};

/** The fields of the online correction of a result, without its `version`. */
const resultUpdateBody = updateTestResult.body.omit({ version: true });

/** The online correction of a measurement, without its `version` (the reason stays required). */
const anthroUpdateBody = updateAnthroMeasurement.body.omit({ version: true });

/**
 * What each operation carries besides `mutationId`, `hlc` and `op`. Bodies
 * are the online endpoint's (creates must carry their `clientUuid`: the row
 * is reconciled by it when it comes back in a pull, the server checks it);
 * edits name their row with `target` and carry no `version`: the per-field
 * clocks replace it.
 */
export const SYNC_OPERATION_INPUTS = {
  'wellness.submit': z.strictObject({ body: submitWellness.body }),
  'wellness.correct': z.strictObject({
    target: syncTargetSchema,
    body: z.strictObject({
      changeReason: changeReasonSchema.optional(),
      scores: wellnessScoresInputSchema.meta({
        description:
          'Solo los ítems que se editaron: cada uno se resuelve por separado contra su reloj.',
      }),
    }),
  }),
  'rpe.submit': z.strictObject({
    params: trainingSessionParams,
    body: submitSessionRpe.body,
  }),
  'participation.record': z.strictObject({
    params: trainingSessionParams,
    body: recordParticipations.body,
  }),
  'participation.update': z.strictObject({
    target: syncTargetSchema,
    body: z.strictObject({ changeReason: changeReasonSchema.optional(), ...participationFields }),
  }),
  'test_result.create': z.strictObject({ body: createTestResult.body }),
  'test_session.record_results': z.strictObject({
    params: testSessionParams,
    body: recordTestSessionResults.body,
  }),
  'test_result.update': z.strictObject({
    target: syncTargetSchema,
    body: resultUpdateBody,
  }),
  'test_result.add_entries': z.strictObject({
    target: syncTargetSchema,
    body: addTestResultEntries.body,
  }),
  'test_result.void_entries': z.strictObject({
    target: syncTargetSchema,
    body: voidTestResultEntries.body,
  }),
  'gym_set.log': z.strictObject({ body: logGymSets.body }),
  'gym_set.correct': z.strictObject({
    target: syncTargetSchema,
    body: correctGymSet.body.omit({ version: true }),
  }),
  'gym_set.void': z.strictObject({ target: syncTargetSchema, body: voidGymSet.body }),
  'pain_report.submit': z.strictObject({ body: submitPainReport.body }),
  'anthro.record': z.strictObject({ body: recordAnthroMeasurements.body }),
  'anthro.update': z.strictObject({
    target: syncTargetSchema,
    body: anthroUpdateBody,
  }),
  'external_load.report': z.strictObject({ body: reportExternalLoad.body }),
  'external_load.correct': z.strictObject({
    target: syncTargetSchema,
    body: externalLoadCorrectionSchema,
  }),
  'external_load.archive': z.strictObject({ target: syncTargetSchema }),
  'menstrual_cycle.log': z.strictObject({ body: logMenstrualCycleDay.body }),
} as const satisfies Record<SyncOperation, z.ZodType>;

export type SyncOperationInput<Op extends SyncOperation> = z.output<
  (typeof SYNC_OPERATION_INPUTS)[Op]
>;

/** What a client writes for an operation before validation (ids as plain strings). */
export type SyncOperationRequest<Op extends SyncOperation> = z.input<
  (typeof SYNC_OPERATION_INPUTS)[Op]
>;

/**
 * A mutation as it travels. The envelope is checked with the request; the
 * part of each operation (`SYNC_OPERATION_INPUTS`) is checked per mutation,
 * so one mutation an older build cannot express anymore is rejected alone
 * instead of blocking the whole queue.
 */
export const syncMutationSchema = z
  .strictObject({
    mutationId: clientUuidSchema.meta({
      description:
        'Id de la mutación generado en el dispositivo. Reenviarla no la aplica dos veces: vuelve `replayed`.',
    }),
    hlc: hlcSchema,
    op: z
      .string()
      .min(1)
      .max(64)
      .meta({
        description: `Operación: ${SYNC_OPERATIONS.map((op) => `\`${op}\``).join(', ')}. Una desconocida se rechaza sola.`,
      }),
    params: z.unknown().optional().meta({
      description:
        'Parámetros de ruta del endpoint en línea (`trainingSessionId`, `testSessionId`).',
    }),
    target: z.unknown().optional().meta({
      description: 'Fila que edita: `{ id }` o `{ clientUuid }` (ediciones).',
    }),
    body: z.unknown().optional().meta({
      description: 'Body del endpoint en línea, sin `version` en las ediciones.',
    }),
  })
  .meta({ id: 'SyncMutation' });

export type SyncMutation = z.output<typeof syncMutationSchema>;

export const syncMutationResultSchema = z
  .object({
    mutationId: clientUuidSchema,
    op: z.string(),
    status: z.enum(SYNC_MUTATION_STATUSES).meta({
      description:
        '`applied`; `superseded` (todos sus campos ya tenían un reloj posterior: no se escribió nada); `replayed` (ya se había aplicado); `rejected` (el error que daría el endpoint en línea; no frena la cola).',
    }),
    hlc: hlcSchema.nullable().meta({
      description:
        'Reloj con el que se aplicó: el del dispositivo o, si estaba adelantado, la hora del servidor. `null` si se rechazó.',
    }),
    clamped: z.boolean().meta({
      description: 'El reloj del dispositivo estaba adelantado y se llevó a la hora del servidor.',
    }),
    appliedFields: z.array(z.string()).meta({
      description: 'Campos que ganaron (ediciones resueltas por campo).',
    }),
    supersededFields: z.array(z.string()).meta({
      description: 'Campos que perdieron contra una edición posterior.',
    }),
    firstOutcome: z.enum(SYNC_STORED_OUTCOMES).nullable().meta({
      description:
        'En un reenvío del mismo `mutationId` (`replayed`), lo que resultó la primera vez: `applied`, `superseded` o `replayed` (el handler ya tenía el alta por su `clientUuid`). `null` en cualquier otro caso.',
    }),
    error: errorBodySchema.nullable(),
  })
  .meta({ id: 'SyncMutationResult' });

export type SyncMutationResult = z.output<typeof syncMutationResultSchema>;

export const pushSyncMutations = defineEndpoint({
  method: 'POST',
  path: '/v1/sync/push',
  summary: 'Sincronizar la cola de mutaciones',
  description: `Hasta ${String(SYNC_PUSH_MAX)} mutaciones, en el orden de la cola. Cada una corre el mismo handler que su endpoint en línea (contrato, permisos, consentimientos, RLS) en su propio savepoint: una rechazada vuelve con su error y no frena las siguientes; un error del servidor hace fallar todo el pedido (reintentar), y un choque con un push concurrente (deadlock) es un \`503\` con \`Retry-After\` para reintentar el pedido entero. Idempotente por \`mutationId\`. Las ediciones se resuelven por campo: gana el reloj (HLC) mayor.`,
  tags: ['sync'],
  auth: 'club',
  body: z.strictObject({
    mutations: z.array(syncMutationSchema).min(1).max(SYNC_PUSH_MAX),
  }),
  response: {
    status: 200,
    description: 'El resultado de cada mutación, en el orden del pedido.',
    schema: z
      .object({
        serverHlc: hlcSchema.meta({
          description: 'Reloj del servidor: el dispositivo lo recibe para adelantar el suyo.',
        }),
        results: z.array(syncMutationResultSchema),
      })
      .meta({ id: 'SyncPushResult' }),
  },
  errors: ['service_unavailable'],
});

// ─── Pull ────────────────────────────────────────────────────────────────────────────

const changeBase = {
  id: uuidSchema,
  clientUuid: clientUuidSchema.nullable().meta({
    description:
      'El `clientUuid` con que se creó la fila, para reconciliar lo creado sin conexión.',
  }),
};

const upsertChange = z
  .discriminatedUnion('collection', [
    z.object({
      collection: z.literal('wellness'),
      op: z.literal('upsert'),
      ...changeBase,
      data: wellnessSchema,
    }),
    z.object({
      collection: z.literal('participation'),
      op: z.literal('upsert'),
      ...changeBase,
      data: participationSchema,
    }),
    z.object({
      collection: z.literal('training_session'),
      op: z.literal('upsert'),
      ...changeBase,
      data: trainingSessionSchema,
    }),
    z.object({
      collection: z.literal('test_session'),
      op: z.literal('upsert'),
      ...changeBase,
      data: testSessionSchema,
    }),
    z.object({
      collection: z.literal('test_result'),
      op: z.literal('upsert'),
      ...changeBase,
      data: testResultSchema,
    }),
    z.object({
      collection: z.literal('gym_program'),
      op: z.literal('upsert'),
      ...changeBase,
      data: gymProgramSchema,
    }),
    z.object({
      collection: z.literal('gym_set'),
      op: z.literal('upsert'),
      ...changeBase,
      data: gymSetSchema,
    }),
    z.object({
      collection: z.literal('anthro_measurement'),
      op: z.literal('upsert'),
      ...changeBase,
      data: anthroMeasurementSchema,
    }),
    z.object({
      collection: z.literal('external_load'),
      op: z.literal('upsert'),
      ...changeBase,
      data: externalLoadSchema,
    }),
  ])
  .meta({ id: 'SyncUpsert' });

const deleteChange = z
  .object({
    collection: syncCollectionSchema,
    op: z.literal('delete'),
    id: uuidSchema,
    clientUuid: z.null(),
    data: z.null(),
  })
  .meta({
    id: 'SyncTombstone',
    description:
      'La fila ya no existe o salió de la vista de quien pide (por ejemplo, una sesión que pasó a otra categoría): borrarla del dispositivo. Si el dispositivo no la tiene, no hace nada.',
  });

export const syncChangeSchema = z.union([upsertChange, deleteChange]).meta({ id: 'SyncChange' });
export type SyncChange = z.output<typeof syncChangeSchema>;

const COLLECTIONS_PATTERN = new RegExp(
  `^(${SYNC_COLLECTIONS.join('|')})(,(${SYNC_COLLECTIONS.join('|')}))*$`,
);

export const pullSyncChanges = defineEndpoint({
  method: 'GET',
  path: '/v1/sync/changes',
  summary: 'Cambios desde el cursor',
  description:
    'Cambios de las colecciones que el rol puede leer (la misma matriz y RLS que las listas), en el orden en que confirmaron, con los mismos DTO que los endpoints de lectura. Sin `cursor`, desde el principio. Una fila que salió de la vista por un cambio propio (una sesión que pasó a otra categoría) llega como baja. Si cambió lo que ve quien pide (rol, asignaciones, categorías asignadas, jugadores visibles o colecciones), `reset: true`: la página empieza de cero y el dispositivo borra esas colecciones antes de aplicarla. Seguir pidiendo con `cursor` mientras `hasMore`.',
  tags: ['sync'],
  auth: 'club',
  query: z.strictObject({
    cursor: z
      .string()
      .min(1)
      .max(1024)
      .optional()
      .meta({ description: 'El `cursor` de la respuesta anterior.' }),
    limit: z.coerce
      .number<number>()
      .int()
      .min(1)
      .max(SYNC_PULL_LIMIT_MAX)
      .default(SYNC_PULL_LIMIT_DEFAULT)
      .meta({ description: `Cambios por página (1 a ${String(SYNC_PULL_LIMIT_MAX)}).` }),
    collections: z.string().max(256).regex(COLLECTIONS_PATTERN).optional().meta({
      description:
        'Colecciones separadas por coma; por defecto, todas las que el rol puede leer. Las que no puede leer no se devuelven.',
    }),
  }),
  response: {
    status: 200,
    description: 'Una página de cambios.',
    schema: z
      .object({
        items: z.array(syncChangeSchema),
        cursor: z.string().min(1).meta({
          description: 'Cursor opaco para el próximo pedido (también sin cambios nuevos).',
        }),
        hasMore: z.boolean(),
        reset: z.boolean().meta({
          description:
            'El cursor ya no servía: borrar las colecciones del dispositivo antes de aplicar esta página.',
        }),
        collections: z.array(syncCollectionSchema).meta({
          description: 'Colecciones que cubre la respuesta (las pedidas que el rol puede leer).',
        }),
        serverHlc: hlcSchema,
      })
      .meta({ id: 'SyncChangesPage' }),
  },
  errors: ['bad_request'],
});
