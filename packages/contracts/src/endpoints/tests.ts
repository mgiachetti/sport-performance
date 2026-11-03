import {
  CHANGE_REASON_MAX_LENGTH,
  E1RM_SET_ISSUES,
  MEASUREMENT_METHODS,
  TEST_COMPARISON_WARNINGS,
  TEST_ENTRY_KINDS,
  TEST_NOT_DONE_REASONS,
  isWellFormedCode,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { idOf, playerIdSchema, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import {
  testConditionsInputSchema,
  testConditionsSchema,
  testSessionIdSchema,
} from './calendar.js';
import { changeReasonSchema } from './change-history.js';

/**
 * Test results (B-320). A test day (`TestSession`, scheduled and run with
 * the calendar endpoints of B-317) is the battery of a category on a date,
 * in a window of the season; its results are recorded here. A result is
 * one player in one protocol version: how it was measured (method,
 * evaluator, device, conditions) and its entries, the raw attempts the
 * evaluator typed; the server computes the metric values with the formulas
 * of the domain. Entries are append-only: a wrong one is voided with a
 * reason and a new one added (ADR 0015, ADR 0030).
 */

export const TEST_TEXT_MAX_LENGTH = 1000;
export const TEST_LABEL_MAX_LENGTH = 120;
/** Most entries in one request (a result, or one result of a batch). */
export const TEST_ENTRIES_MAX = 50;
/** Most results in one batch of a test day. */
export const TEST_BATCH_MAX = 200;
export const TEST_ATTEMPT_NUMBER_MAX = 50;

export const testResultIdSchema = idOf('resultado de test');
/** Id of an import of historical results (B-331): here, as results name their import. */
export const testImportIdSchema = idOf('importación de históricos');
export const testEntryIdSchema = idOf('entrada de un resultado de test');
export const testDefinitionIdSchema = idOf('versión del protocolo de un test');
export const deviceIdSchema = idOf('dispositivo');

const trimmed = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim(), {
      message: 'No leading or trailing whitespace',
    });

export const metricCodeSchema = z
  .string()
  .refine(isWellFormedCode, { message: 'Invalid metric code' })
  .meta({
    description: 'Código canónico de la métrica (`cmj_height_cm`).',
    examples: ['cmj_height_cm'],
  });

export const testCodeSchema = z
  .string()
  .refine(isWellFormedCode, { message: 'Invalid test code' })
  .meta({ description: 'Código del test (`sprint_40`).', examples: ['sprint_40'] });

export const exerciseCodeSchema = z
  .string()
  .refine(isWellFormedCode, { message: 'Invalid exercise code' })
  .meta({
    description: 'Ejercicio de un resultado de fuerza, en `snake_case`.',
    examples: ['trap_bar_deadlift'],
  });

export const measurementMethodSchema = z.enum(MEASUREMENT_METHODS).meta({
  id: 'MeasurementMethod',
  description:
    'Cómo se midió (principio 4): `manual`, `video`, `photocell`, `pod`, `app` o `historical`. Nunca se comparan métodos distintos sin aviso.',
});

export const testNotDoneReasonSchema = z.enum(TEST_NOT_DONE_REASONS).meta({
  id: 'TestNotDoneReason',
  description:
    'Por qué no se hizo: `absent`, `injured` (nunca el diagnóstico), `not_applicable_to_stage` u `other` (con nota).',
});

/** As the viewer reads it: `injured` is `unavailable` for every role but `medical` (ADR 0029). */
export const testNotDoneReasonViewSchema = z.enum([...TEST_NOT_DONE_REASONS, 'unavailable']).meta({
  id: 'TestNotDoneReasonView',
  description:
    'Motivo como lo ve quien lee: `injured` se ve `unavailable` para todo rol que no sea `medical`.',
});

// ─── Entries ─────────────────────────────────────────────────────────────────────────

const positive = z.number().positive().max(1_000_000);

const entryClientUuid = {
  clientUuid: clientUuidSchema.optional().meta({
    description:
      'UUID de la entrada generado por el cliente (cola offline): reenviarla no la duplica. Es el `id` de la entrada.',
  }),
};

/** Fields of every entry but its `clientUuid`. */
export const testEntryAttemptFields = {
  attemptNumber: z.int().min(1).max(TEST_ATTEMPT_NUMBER_MAX).optional().meta({
    description:
      'Número de intento (etiqueta del evaluador). Sin número, la entrada es el valor único del resultado.',
  }),
  recordedAt: dateTimeSchema.optional().meta({
    description: 'Cuándo se registró en la cancha (ordena intentos de varios dispositivos).',
  }),
};

export const TEST_ENTRY_INPUT_DESCRIPTION =
  'Un intento como lo carga el evaluador. `value`: el valor de una métrica en su unidad; el resto son entradas crudas que el servidor convierte con las fórmulas del dominio (sprint: t10/t20/t40 y Vmax 20–40; CMJ: tiempo de vuelo o cuadros de video, `h = g·t²/8`; 30-15 IFT: última etapa → VIFT; fuerza: serie peso/reps/RIR → e1RM de Epley con RIR). Las métricas derivadas no se cargan a mano.';

/**
 * The kinds of entry, with `common` fields in each: the entries of a result
 * (with their `clientUuid`) and those of an import (without: the server
 * derives them from the batch, ADR 0052).
 */
export function testEntryInputVariants<const Common extends z.ZodRawShape>(common: Common) {
  return z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('value'),
      ...common,
      metricCode: metricCodeSchema,
      value: z.number().min(-1_000_000).max(1_000_000),
    }),
    z.strictObject({
      kind: z.literal('sprint_splits'),
      ...common,
      split10S: positive.optional(),
      split20S: positive,
      split40S: positive,
    }),
    z.strictObject({ kind: z.literal('cmj_flight_time'), ...common, flightTimeS: positive }),
    z.strictObject({
      kind: z.literal('cmj_video_frames'),
      ...common,
      takeoffFrame: z.int().min(0).max(10_000_000),
      landingFrame: z.int().min(0).max(10_000_000),
      frameRateFps: positive,
    }),
    z.strictObject({
      kind: z.literal('ift_stage'),
      ...common,
      lastCompletedStage: z.int().min(1).max(100),
    }),
    z.strictObject({
      kind: z.literal('strength_set'),
      ...common,
      loadKg: positive,
      reps: z.int().min(1).max(100),
      rir: z.number().min(0).max(20),
    }),
  ]);
}

export const testEntryInputSchema = testEntryInputVariants({
  ...entryClientUuid,
  ...testEntryAttemptFields,
}).meta({ id: 'TestEntryInput', description: TEST_ENTRY_INPUT_DESCRIPTION });

/** An entry as the API receives it (validated). */
export type TestEntryInputBody = z.output<typeof testEntryInputSchema>;

export const testEntryValueSchema = z.object({
  id: idOf('valor'),
  metricCode: metricCodeSchema,
  unit: z.string().min(1),
  value: z.number(),
  computed: z.boolean().meta({ description: 'Lo calculó el servidor (no se tipeó).' }),
});

export const testEntrySchema = z
  .object({
    id: testEntryIdSchema,
    kind: z.enum([...TEST_ENTRY_KINDS, 'derived']).meta({
      description:
        '`derived`: métrica del resultado recalculada por el servidor (asimetría, fuerza relativa).',
    }),
    attemptNumber: z.int().nullable(),
    recordedAt: dateTimeSchema,
    inputs: z.record(z.string(), z.unknown()).nullable().meta({
      description:
        'Lo que tipeó el evaluador para una entrada cruda; `null` para un valor directo.',
    }),
    values: z.array(testEntryValueSchema),
    issues: z.array(z.enum(E1RM_SET_ISSUES)).meta({
      description: 'Avisos de protocolo (una serie fuera de 3–5 reps o con RIR < 2). No bloquean.',
    }),
    voided: z
      .object({ at: dateTimeSchema, by: userIdSchema.nullable(), reason: z.string() })
      .nullable(),
  })
  .meta({ id: 'TestEntry' });

export const testMetricScoreSchema = z
  .object({
    metricCode: metricCodeSchema,
    unit: z.string().min(1),
    value: z.number(),
    aggregation: z.enum(['best', 'mean', 'single']).meta({
      description: 'Cómo se redujeron los intentos (de la definición del test), o `single`.',
    }),
    attemptCount: z.int().min(1),
    derived: z.boolean(),
  })
  .meta({ id: 'TestMetricScore' });

// ─── Results ─────────────────────────────────────────────────────────────────────────

export const testResultSchema = z
  .object({
    id: testResultIdSchema,
    playerId: playerIdSchema,
    testDefinitionId: testDefinitionIdSchema,
    testCode: testCodeSchema,
    protocolVersion: z.int().min(1),
    testSessionId: testSessionIdSchema.nullable(),
    measuredOn: localDateSchema,
    status: z.enum(['done', 'not_done']),
    notDoneReason: testNotDoneReasonViewSchema.nullable(),
    notDoneNote: z.string().nullable().meta({
      description: 'Nota del motivo; no se muestra con `unavailable`.',
    }),
    method: measurementMethodSchema.nullable(),
    evaluatorId: userIdSchema.nullable(),
    deviceId: deviceIdSchema.nullable(),
    exercise: exerciseCodeSchema.nullable(),
    conditions: testConditionsSchema,
    notes: z.string().nullable(),
    importId: testImportIdSchema.nullable().meta({
      description: 'La importación de históricos de la que salió (B-331); `null` si se cargó acá.',
    }),
    entries: z.array(testEntrySchema),
    scores: z.array(testMetricScoreSchema).meta({
      description: 'Puntaje de cada métrica con las entradas válidas.',
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'TestResult' });

export type TestResult = z.output<typeof testResultSchema>;

const resultCommon = {
  clientUuid: clientUuidSchema.optional(),
  playerId: playerIdSchema,
  testDefinitionId: testDefinitionIdSchema,
  measuredOn: localDateSchema.optional().meta({
    description: 'Por defecto, la fecha del día de test. Obligatoria sin día de test.',
  }),
  evaluatorId: userIdSchema.nullable().optional().meta({
    description:
      'Por defecto, el evaluador del día de test o quien carga. `null` solo si se desconoce (históricos).',
  }),
  deviceId: deviceIdSchema.optional(),
  exercise: exerciseCodeSchema.optional().meta({ description: 'Obligatorio en fuerza.' }),
  conditions: testConditionsInputSchema.optional().meta({
    description: 'Por defecto, las del día de test.',
  }),
  notes: trimmed(TEST_TEXT_MAX_LENGTH).optional(),
};

const doneResultShape = {
  status: z.literal('done'),
  ...resultCommon,
  method: measurementMethodSchema,
  entries: z.array(testEntryInputSchema).min(1).max(TEST_ENTRIES_MAX),
};

const notDoneResultShape = {
  status: z.literal('not_done'),
  ...resultCommon,
  notDoneReason: testNotDoneReasonSchema,
  notDoneNote: trimmed(TEST_TEXT_MAX_LENGTH).optional().meta({
    description: 'Obligatoria con `other`.',
  }),
  method: measurementMethodSchema.optional(),
};

/** A result of a test day (batch): the day comes from the path. */
export const testSessionResultInputSchema = z
  .discriminatedUnion('status', [
    z.strictObject(doneResultShape),
    z.strictObject(notDoneResultShape),
  ])
  .meta({ id: 'TestSessionResultInput' });

/** A result of a test day as a client sends it. */
export type TestSessionResultInput = z.input<typeof testSessionResultInputSchema>;
/** An entry as a client sends it. */
export type TestEntryInputPayload = z.input<typeof testEntryInputSchema>;

export const createTestResultBodySchema = z
  .discriminatedUnion('status', [
    z.strictObject({ ...doneResultShape, testSessionId: testSessionIdSchema.optional() }),
    z.strictObject({ ...notDoneResultShape, testSessionId: testSessionIdSchema.optional() }),
  ])
  .meta({ id: 'TestResultInput' });

/** A result as the API receives it (validated). */
export type TestResultInputBody = z.output<typeof createTestResultBodySchema>;
export type TestConditionsInput = z.output<typeof testConditionsInputSchema>;

const testResultParams = z.strictObject({ testResultId: testResultIdSchema });

const RECORD_RULES =
  'Con consentimiento de datos vigente del jugador; `sc` en sus asignaciones y la administración. Un `done` solo para tests de la batería vigente de la etapa del jugador (deporte, sexo, etapa a la fecha y categoría), nunca con cargas máximas en M13/M14 y, en fuerza, solo las métricas de su evaluación (técnica, 1RM estimado o directo): lo que no corresponde se carga `not_done` con `not_applicable_to_stage`.';

export const listTestResults = defineEndpoint({
  method: 'GET',
  path: '/v1/test-results',
  summary: 'Resultados de tests',
  description:
    'El staff ve los jugadores de sus asignaciones, la administración todo el club y el jugador los suyos. `injured` se ve `unavailable` salvo para `medical`.',
  tags: ['tests'],
  auth: 'club',
  query: pageQuerySchema.extend({
    playerId: playerIdSchema.optional(),
    testSessionId: testSessionIdSchema.optional(),
    testCode: testCodeSchema.optional(),
    testDefinitionId: testDefinitionIdSchema.optional(),
    status: z.enum(['done', 'not_done']).optional(),
    importId: testImportIdSchema
      .optional()
      .meta({ description: 'Solo los resultados de una importación de históricos.' }),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    sort: sortQuerySchema(['measuredOn', 'createdAt'], '-measuredOn'),
  }),
  response: {
    status: 200,
    description: 'Página de resultados.',
    schema: pageOf(testResultSchema).meta({ id: 'TestResultPage' }),
  },
  errors: ['bad_request'],
});

export const getTestResult = defineEndpoint({
  method: 'GET',
  path: '/v1/test-results/{testResultId}',
  summary: 'Un resultado de test',
  description: 'Con sus entradas (también las anuladas) y el puntaje de cada métrica.',
  tags: ['tests'],
  auth: 'club',
  params: testResultParams,
  response: { status: 200, description: 'El resultado.', schema: testResultSchema },
  errors: ['not_found'],
});

export const createTestResult = defineEndpoint({
  method: 'POST',
  path: '/v1/test-results',
  summary: 'Cargar un resultado',
  description: `${RECORD_RULES} Idempotente por \`clientUuid\`.`,
  tags: ['tests'],
  auth: 'club',
  body: createTestResultBodySchema,
  response: { status: 201, description: 'Resultado cargado.', schema: testResultSchema },
  errors: ['not_found', 'conflict'],
});

const testSessionParams = z.strictObject({ testSessionId: testSessionIdSchema });

export const recordTestSessionResults = defineEndpoint({
  method: 'POST',
  path: '/v1/test-sessions/{testSessionId}/results',
  summary: 'Cargar resultados de un día de test por lote',
  description: `Carga de la cancha: hasta ${String(TEST_BATCH_MAX)} resultados (varios jugadores y tests) en una transacción, todo o nada. Cada resultado es idempotente por \`clientUuid\` (\`replayed\` dice si ya estaba). ${RECORD_RULES} Un día cancelado no recibe resultados: \`conflict\`.`,
  tags: ['tests'],
  auth: 'club',
  params: testSessionParams,
  body: z.strictObject({
    results: z.array(testSessionResultInputSchema).min(1).max(TEST_BATCH_MAX),
  }),
  response: {
    status: 201,
    description: 'Resultados cargados, en el orden del pedido.',
    schema: z
      .object({
        results: z.array(z.object({ result: testResultSchema, replayed: z.boolean() })),
      })
      .meta({ id: 'TestSessionResults' }),
  },
  errors: ['not_found', 'conflict'],
});

export const updateTestResult = defineEndpoint({
  method: 'PATCH',
  path: '/v1/test-results/{testResultId}',
  summary: 'Corregir un resultado',
  description:
    'Método, evaluador, dispositivo, ejercicio, condiciones, notas, fecha y estado. Cambiar un dato ya cargado pide `changeReason` (ADR 0030). Pasar a `not_done` exige anular antes las entradas; pasar a `done` exige `method`. Un resultado importado (`importId`, ADR 0052) sigue `done` y `historical`, y cambiarle la fecha no aplica las reglas de etapa de la batería (como en la importación). `version` desactualizada: `conflict`. Las entradas no se editan: se anulan.',
  tags: ['tests'],
  auth: 'club',
  params: testResultParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    changeReason: changeReasonSchema.optional(),
    measuredOn: localDateSchema.optional(),
    status: z.enum(['done', 'not_done']).optional(),
    notDoneReason: testNotDoneReasonSchema.nullable().optional(),
    notDoneNote: trimmed(TEST_TEXT_MAX_LENGTH).nullable().optional(),
    method: measurementMethodSchema.nullable().optional(),
    evaluatorId: userIdSchema.nullable().optional(),
    deviceId: deviceIdSchema.nullable().optional(),
    exercise: exerciseCodeSchema.nullable().optional(),
    conditions: testConditionsInputSchema.optional(),
    notes: trimmed(TEST_TEXT_MAX_LENGTH).nullable().optional(),
  }),
  response: { status: 200, description: 'El resultado corregido.', schema: testResultSchema },
  errors: ['not_found', 'conflict'],
});

export const addTestResultEntries = defineEndpoint({
  method: 'POST',
  path: '/v1/test-results/{testResultId}/entries',
  summary: 'Agregar intentos a un resultado',
  description:
    'Solo a un resultado `done`. Cada entrada es idempotente por su `clientUuid`. Las métricas derivadas del resultado se recalculan en la misma transacción. Un valor único que ya existe para la métrica: `conflict` (anularlo primero).',
  tags: ['tests'],
  auth: 'club',
  params: testResultParams,
  body: z.strictObject({
    entries: z.array(testEntryInputSchema).min(1).max(TEST_ENTRIES_MAX),
  }),
  response: {
    status: 200,
    description: 'El resultado con sus entradas.',
    schema: testResultSchema,
  },
  errors: ['not_found', 'conflict'],
});

export const voidTestResultEntries = defineEndpoint({
  method: 'POST',
  path: '/v1/test-results/{testResultId}/void',
  summary: 'Anular entradas de un resultado',
  description: `La corrección de un intento (append-only): se anulan todos sus valores con el motivo (1 a ${String(CHANGE_REASON_MAX_LENGTH)} caracteres), que queda en el historial, y se recalculan las derivadas. Idempotente: anular una entrada ya anulada no hace nada. Las entradas \`derived\` no se anulan a mano.`,
  tags: ['tests'],
  auth: 'club',
  params: testResultParams,
  body: z.strictObject({
    entryIds: z.array(testEntryIdSchema).min(1).max(TEST_ENTRIES_MAX),
    reason: changeReasonSchema,
  }),
  response: {
    status: 200,
    description: 'El resultado con las entradas anuladas.',
    schema: testResultSchema,
  },
  errors: ['not_found', 'conflict'],
});

// ─── Series of a player's metric, with the comparison warnings ───────────────────────

export const testMetricPointSchema = z
  .object({
    testResultId: testResultIdSchema,
    testSessionId: testSessionIdSchema.nullable(),
    testDefinitionId: testDefinitionIdSchema,
    protocolVersion: z.int().min(1),
    measuredOn: localDateSchema,
    value: z.number(),
    unit: z.string().min(1),
    aggregation: z.enum(['best', 'mean', 'single']),
    attemptCount: z.int().min(1),
    method: measurementMethodSchema,
    deviceId: deviceIdSchema.nullable(),
    exercise: exerciseCodeSchema.nullable().meta({
      description: 'Ejercicio de fuerza del resultado (`null` en los demás tests).',
    }),
  })
  .meta({ id: 'TestMetricPoint' });

export const testComparisonSchema = z
  .object({
    methods: z.array(measurementMethodSchema),
    protocolVersions: z.array(z.int().min(1)),
    deviceIds: z.array(deviceIdSchema.nullable()),
    exercises: z.array(exerciseCodeSchema.nullable()),
    warnings: z.array(z.enum(TEST_COMPARISON_WARNINGS)).meta({
      description:
        'Sobre todo el rango filtrado (no solo la página): `mixed_methods`, `mixed_protocol_versions`, para tests que solo se comparan con el mismo equipo (reacción) `mixed_devices` y, en fuerza, `mixed_exercises` (el código de la métrica, como `e1rm_kg`, no lleva el ejercicio). La UI los muestra siempre junto a los datos.',
    }),
  })
  .meta({ id: 'TestComparison' });

export const listPlayerTestMetric = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/test-metrics/{metricCode}',
  summary: 'Serie de una métrica de test de un jugador',
  description:
    'El puntaje de la métrica en cada resultado `done` del jugador, con cómo se midió y el aviso cuando se mezclan métodos, versiones del protocolo, equipos o ejercicios de fuerza (principio 4). Mismo alcance que los resultados.',
  tags: ['tests'],
  auth: 'club',
  params: z.strictObject({ playerId: playerIdSchema, metricCode: metricCodeSchema }),
  query: pageQuerySchema.extend({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    method: measurementMethodSchema.optional().meta({
      description: 'Solo un método (para comparar sin mezclar).',
    }),
    exercise: exerciseCodeSchema.optional().meta({
      description: 'Solo un ejercicio de fuerza (para comparar sin mezclar).',
    }),
    sort: sortQuerySchema(['measuredOn'], 'measuredOn'),
  }),
  response: {
    status: 200,
    description: 'Página de la serie y la comparación de todo el rango.',
    schema: pageOf(testMetricPointSchema)
      .extend({ comparison: testComparisonSchema })
      .meta({ id: 'TestMetricSeries' }),
  },
  errors: ['bad_request', 'not_found'],
});
