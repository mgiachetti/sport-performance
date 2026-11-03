import { E1RM_SET_ISSUES } from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { clientUuidSchema, sortQuerySchema } from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { validationIssueSchema } from '../primitives/errors.js';
import { playerIdSchema, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { testConditionsInputSchema } from './calendar.js';
import { playerNameSchema } from './players.js';
import {
  TEST_ENTRIES_MAX,
  TEST_TEXT_MAX_LENGTH,
  deviceIdSchema,
  exerciseCodeSchema,
  metricCodeSchema,
  testCodeSchema,
  testDefinitionIdSchema,
  TEST_ENTRY_INPUT_DESCRIPTION,
  testEntryAttemptFields,
  testEntryInputVariants,
  testImportIdSchema,
  testMetricScoreSchema,
  testResultIdSchema,
} from './tests.js';

/**
 * Imports of historical results (B-331, ADR 0052): the results of previous
 * seasons, from the club's spreadsheets, already parsed by the client into
 * rows. Every imported result is `historical` (principle 4: the series warns
 * when it mixes them with what the platform measured) and remembers the
 * import it came from. The entries and the formulas are those of B-320.
 */

/** Most rows in one import (a larger spreadsheet goes in several imports). */
export const TEST_IMPORT_MAX_ROWS = 1000;
export const TEST_IMPORT_SOURCE_MAX_LENGTH = 200;

const trimmed = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim(), {
      message: 'No leading or trailing whitespace',
    });

export const testImportSourceSchema = trimmed(TEST_IMPORT_SOURCE_MAX_LENGTH).meta({
  description: 'De dónde salieron los datos: la planilla, quién la llevaba, la temporada.',
  examples: ['Planilla de tests M15 2024 (preparación física)'],
});

/** How a row names its player: the id, or the name and birth date of the spreadsheet. */
export const testImportPlayerSchema = z
  .union([
    z.strictObject({ playerId: playerIdSchema }),
    z.strictObject({
      lastName: playerNameSchema,
      firstName: playerNameSchema,
      birthDate: localDateSchema,
    }),
  ])
  .meta({
    id: 'TestImportPlayer',
    description:
      'El jugador por `playerId` o por apellido, nombre y fecha de nacimiento (sin distinguir mayúsculas, tildes ni espacios repetidos). Ninguno o más de uno que coincida es un error de la fila.',
  });

/**
 * An entry of an import: as in the results, without `clientUuid` (the server
 * derives it from the batch's, so that re-sending the batch finds the same
 * entries and no entry of a row collides with another one).
 */
export const testImportEntryInputSchema = testEntryInputVariants(testEntryAttemptFields).meta({
  id: 'TestImportEntryInput',
  description: `${TEST_ENTRY_INPUT_DESCRIPTION} Sin \`clientUuid\`: el servidor lo deriva del lote.`,
});

export const testImportRowSchema = z
  .strictObject({
    player: testImportPlayerSchema,
    testCode: testCodeSchema,
    protocolVersion: z.int().min(1).optional().meta({
      description:
        'Versión del protocolo; por defecto, la vigente el día medido. Tiene que estar vigente ese día.',
    }),
    measuredOn: localDateSchema.optional().meta({
      description: 'Día medido; por defecto, el del lote. Nunca en el futuro.',
    }),
    exercise: exerciseCodeSchema.optional().meta({ description: 'Obligatorio en fuerza.' }),
    evaluatorId: userIdSchema.nullable().optional().meta({
      description: 'Por defecto desconocido (`null`); si se indica, un miembro vigente del staff.',
    }),
    deviceId: deviceIdSchema.optional(),
    conditions: testConditionsInputSchema.optional(),
    notes: trimmed(TEST_TEXT_MAX_LENGTH).optional(),
    entries: z.array(testImportEntryInputSchema).min(1).max(TEST_ENTRIES_MAX).meta({
      description:
        'Como en la carga de resultados: valores directos o entradas crudas que el servidor convierte (Vmax, altura del CMJ, VIFT, e1RM). Las métricas derivadas no se cargan a mano.',
    }),
  })
  .meta({ id: 'TestImportRow' });

export type TestImportRowInput = z.output<typeof testImportRowSchema>;

export const TEST_IMPORT_DUPLICATE_MODES = ['reject', 'skip'] as const;

export const testImportBodySchema = z
  .strictObject({
    clientUuid: clientUuidSchema,
    source: testImportSourceSchema,
    measuredOn: localDateSchema
      .optional()
      .meta({ description: 'Día medido de las filas que no traen el suyo.' }),
    onDuplicate: z.enum(TEST_IMPORT_DUPLICATE_MODES).default('reject').meta({
      description:
        'Una fila igual a un resultado ya cargado (jugador, test, día y ejercicio): `reject` (por defecto) es un error de la fila; `skip` la saltea.',
    }),
    rows: z.array(testImportRowSchema).min(1).max(TEST_IMPORT_MAX_ROWS),
  })
  .superRefine((batch, ctx) => {
    batch.rows.forEach((row, index) => {
      if (row.measuredOn === undefined && batch.measuredOn === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['rows', index, 'measuredOn'],
          message: 'The row has no measuredOn and the batch has no default',
        });
      }
    });
  })
  .meta({ id: 'TestImportInput' });

export type TestImportBody = z.output<typeof testImportBodySchema>;

/**
 * Warnings of a row: they never block, a historical result is what was
 * measured then (ADR 0052).
 */
export const TEST_IMPORT_WARNINGS = [
  /** The test was not in the battery of the player's stage that day. */
  'not_in_battery',
  /** A maximal-load protocol in a stage that does not take maximal loads. */
  'maximal_load_not_allowed',
  /** A strength metric outside the assessment of the stage (1RM in M13/M14…). */
  'strength_metric_not_in_stage',
  /** The player was in no category that day: no stage rules were checked. */
  'no_category_on_day',
  /** A value outside the plausible range of the metric (`suggestedValues` may fix a comma). */
  'implausible_value',
  /** A protocol warning of an e1RM set (reps outside 3–5, RIR < 2). */
  'protocol_issue',
  /** A result of the same player, test, day and exercise is already recorded. */
  'duplicate',
] as const;

export const testImportWarningSchema = z
  .object({
    code: z.enum(TEST_IMPORT_WARNINGS),
    message: z.string(),
    metricCode: metricCodeSchema.optional(),
    value: z.number().optional(),
    bounds: z.object({ min: z.number(), max: z.number() }).optional().meta({
      description: 'Rango plausible usado (`implausible_value`).',
    }),
    suggestedValues: z.array(z.number()).optional().meta({
      description: 'Valores con la coma corrida que caen en el rango (`implausible_value`).',
    }),
    issues: z.array(z.enum(E1RM_SET_ISSUES)).optional().meta({
      description: 'Avisos de protocolo de la serie (`protocol_issue`).',
    }),
    testResultIds: z.array(testResultIdSchema).optional().meta({
      description: 'Resultados ya cargados que coinciden (`duplicate`).',
    }),
  })
  .meta({ id: 'TestImportWarning' });

export type TestImportWarning = z.output<typeof testImportWarningSchema>;

export const testImportRowPreviewSchema = z
  .object({
    index: z.int().min(0),
    playerId: playerIdSchema.nullable().meta({ description: '`null` si no se resolvió.' }),
    testDefinitionId: testDefinitionIdSchema.nullable(),
    protocolVersion: z.int().min(1).nullable(),
    measuredOn: localDateSchema.nullable(),
    outcome: z.enum(['create', 'skip_duplicate', 'invalid']).meta({
      description:
        'Qué haría la importación con la fila: crearla, saltearla (duplicado con `skip`) o nada (tiene errores).',
    }),
    scores: z.array(testMetricScoreSchema).meta({
      description: 'Puntajes calculados con las fórmulas del dominio (vacío si la fila no vale).',
    }),
    warnings: z.array(testImportWarningSchema),
  })
  .meta({ id: 'TestImportRowPreview' });

export const testImportSchema = z
  .object({
    id: testImportIdSchema,
    source: testImportSourceSchema,
    rowCount: z.int().min(1),
    createdCount: z.int().min(0),
    skippedCount: z.int().min(0),
    createdBy: userIdSchema.nullable(),
    createdAt: dateTimeSchema,
  })
  .meta({ id: 'TestImport' });

export type TestImport = z.output<typeof testImportSchema>;

const IMPORT_RULES = `\`sc\` en sus asignaciones y la administración (\`data_import.run\`), con permiso para cargar resultados de cada jugador (\`test_result.record\`, con su consentimiento de datos vigente). De 1 a ${String(TEST_IMPORT_MAX_ROWS)} filas ya parseadas (el cliente lee la planilla). Cada resultado se guarda con método \`historical\`, sin día de test, y la serie avisa cuando se mezcla con otros métodos. Las reglas de etapa de la batería no bloquean un histórico: son avisos.`;

export const previewTestImport = defineEndpoint({
  method: 'POST',
  path: '/v1/test-imports/preview',
  summary: 'Vista previa de una importación de históricos',
  description: `${IMPORT_RULES} No escribe nada: corre la importación y la deshace, así lo que muestra es exactamente lo que importaría. Un lote cuyo \`clientUuid\` ya se importó es \`conflict\`. Devuelve por fila el jugador y la versión resueltos, los puntajes y los avisos, y los errores de todas las filas (\`issues\`, con ruta \`body.rows.<i>.<campo>\`).`,
  tags: ['tests'],
  auth: 'club',
  body: testImportBodySchema,
  response: {
    status: 200,
    description: 'Lo que haría la importación.',
    schema: z
      .object({
        rows: z.array(testImportRowPreviewSchema),
        issues: z.array(validationIssueSchema).meta({
          description: 'Errores que impiden importar; vacío si el lote se puede importar.',
        }),
        summary: z.object({
          rowCount: z.int().min(1),
          createCount: z.int().min(0),
          skipCount: z.int().min(0),
          invalidCount: z.int().min(0),
          warningCount: z.int().min(0),
        }),
      })
      .meta({ id: 'TestImportPreview' }),
  },
  errors: ['conflict'],
});

export const createTestImport = defineEndpoint({
  method: 'POST',
  path: '/v1/test-imports',
  summary: 'Importar resultados históricos',
  description: `${IMPORT_RULES} Todo o nada: si alguna fila no vale, \`validation_failed\` con el detalle por fila y no se escribe nada. Idempotente por \`clientUuid\` del lote: reenviar el mismo lote devuelve lo mismo con \`X-Idempotent-Replay: true\` (sin los avisos, que no se guardan); el mismo \`clientUuid\` con otro lote es \`conflict\`, y reenviarlo sin ver a todos sus jugadores es \`forbidden\`. Las importaciones de un club corren de a una: si otra tarda más que la espera, \`service_unavailable\` con \`Retry-After\` y no se escribe nada; el mismo lote se reenvía.`,
  tags: ['tests'],
  auth: 'club',
  body: testImportBodySchema,
  response: {
    status: 201,
    description: 'La importación y qué pasó con cada fila, en orden.',
    schema: z
      .object({
        import: testImportSchema,
        rows: z.array(
          z.object({
            index: z.int().min(0),
            outcome: z.enum(['created', 'skipped_duplicate']),
            testResultId: testResultIdSchema.nullable(),
            warnings: z.array(testImportWarningSchema),
          }),
        ),
      })
      .meta({ id: 'TestImportResult' }),
  },
  errors: ['conflict'],
});

export const listTestImports = defineEndpoint({
  method: 'GET',
  path: '/v1/test-imports',
  summary: 'Importaciones de históricos',
  description:
    '`sc` y la administración. Sus resultados se listan con `GET /v1/test-results?importId=`.',
  tags: ['tests'],
  auth: 'club',
  query: pageQuerySchema.extend({
    sort: sortQuerySchema(['createdAt'], '-createdAt'),
  }),
  response: {
    status: 200,
    description: 'Página de importaciones.',
    schema: pageOf(testImportSchema).meta({ id: 'TestImportPage' }),
  },
  errors: ['bad_request'],
});

export const getTestImport = defineEndpoint({
  method: 'GET',
  path: '/v1/test-imports/{testImportId}',
  summary: 'Una importación de históricos',
  tags: ['tests'],
  auth: 'club',
  params: z.strictObject({ testImportId: testImportIdSchema }),
  response: { status: 200, description: 'La importación.', schema: testImportSchema },
  errors: ['not_found'],
});
