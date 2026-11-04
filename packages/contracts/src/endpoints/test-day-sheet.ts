import {
  ATTEMPT_AGGREGATIONS,
  TEST_ENTRY_KINDS,
  TEST_NOT_APPLICABLE_REASONS,
  type MetricDirection,
  type StrengthAssessment,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { sexSchema, sportSchema, stageSchema } from '../primitives/conventions.js';
import { localDateSchema } from '../primitives/dates.js';
import { playerIdSchema } from '../primitives/ids.js';
import {
  testSessionIdSchema,
  testSessionSchema,
  testWindowIdSchema,
  testWindowNumberSchema,
} from './calendar.js';
import { playerNameSchema } from './players.js';
import {
  deviceIdSchema,
  exerciseCodeSchema,
  measurementMethodSchema,
  metricCodeSchema,
  testCodeSchema,
  testDefinitionIdSchema,
  testMetricScoreSchema,
  testResultIdSchema,
} from './tests.js';

/**
 * The sheet of a test day (B-405, ADR 0068): everything the staff needs to
 * run the day on one read — the stations (tests the battery schedules in the
 * day's window, with the protocol version in effect), the roster of the day
 * with the stage of each player and whether each test applies to them, the
 * previous result of each test, and the club's devices. The web (B-405) and
 * the field app (B-505) record against it with the endpoints of B-320.
 */

const METRIC_DIRECTIONS = [
  'higher_is_better',
  'lower_is_better',
  'neutral',
] as const satisfies readonly MetricDirection[];

const STRENGTH_ASSESSMENTS = [
  'technique_reps',
  'estimated_rm',
  'direct_rm',
] as const satisfies readonly StrengthAssessment[];

/** Kinds of device of the club (mirrors the `device_kind` enum of the database). */
export const DEVICE_KINDS = [
  'phone',
  'tablet',
  'hr_band',
  'photocell',
  'reaction_lights',
  'dynamometer',
  'pod',
  'gps_vest',
] as const;

export const testDaySheetDefinitionMetricSchema = z
  .object({
    code: metricCodeSchema,
    unit: z.string().min(1),
    direction: z.enum(METRIC_DIRECTIONS),
    derived: z.boolean().meta({
      description: 'La calcula el servidor (Vmax, asimetría, e1RM): no se carga a mano.',
    }),
  })
  .meta({ id: 'TestDaySheetDefinitionMetric' });

export const testDaySheetDefinitionSchema = z
  .object({
    id: testDefinitionIdSchema,
    code: testCodeSchema,
    version: z.int().min(1),
    sports: z.array(sportSchema).nullable().meta({ description: '`null`: todos los deportes.' }),
    attemptCount: z.int().min(1).meta({ description: 'Intentos previstos por el protocolo.' }),
    attemptAggregation: z.enum(ATTEMPT_AGGREGATIONS).meta({
      description: 'Cómo se reducen los intentos: el mejor (según el sentido) o el promedio.',
    }),
    maximalLoad: z.boolean().meta({ description: 'Test con cargas máximas (nunca M13/M14).' }),
    sameDeviceOnly: z.boolean().meta({
      description: 'Solo se compara con el mismo equipo (reacción): el resultado pide `deviceId`.',
    }),
    entryKinds: z.array(z.enum(TEST_ENTRY_KINDS)).meta({
      description: 'Tipos de entrada que acepta, el preferido primero.',
    }),
    protocol: z.object({
      summary: z.string().nullable(),
      steps: z.array(z.string()),
      restBetweenAttemptsS: z.number().nullable(),
      equipment: z.array(z.string()),
      parameters: z.record(z.string(), z.unknown()).meta({
        description:
          'Parámetros del protocolo de los que depende el cálculo (etapas del 30-15, rango de reps del e1RM): la vista previa usa las mismas fórmulas del dominio.',
      }),
    }),
    metrics: z
      .array(testDaySheetDefinitionMetricSchema)
      .meta({ description: 'En el orden del protocolo.' }),
    validFrom: localDateSchema,
    validTo: localDateSchema.nullable(),
  })
  .meta({ id: 'TestDaySheetDefinition', description: 'Una versión del protocolo de un test.' });

export const testDaySheetStationSchema = z
  .object({
    testCode: testCodeSchema,
    definition: testDaySheetDefinitionSchema.meta({
      description: 'La versión del protocolo vigente el día del test, con la que se carga.',
    }),
    scheduled: z.boolean().meta({
      description:
        'La batería lo programa en la ventana del día para algún jugador del plantel; `false`: aparece solo porque ya tiene resultados.',
    }),
  })
  .meta({ id: 'TestDaySheetStation' });

export const testDayPreviousResultSchema = z
  .object({
    testCode: testCodeSchema,
    testResultId: testResultIdSchema,
    measuredOn: localDateSchema,
    method: measurementMethodSchema,
    protocolVersion: z.int().min(1),
    deviceId: deviceIdSchema.nullable(),
    exercise: exerciseCodeSchema.nullable(),
    scores: z.array(testMetricScoreSchema),
  })
  .meta({
    id: 'TestDayPreviousResult',
    description: 'El último resultado `done` del test antes del día (de cualquier día de test).',
  });

export const testDaySheetPlayerSchema = z
  .object({
    id: playerIdSchema,
    firstName: playerNameSchema,
    lastName: playerNameSchema,
    sex: sexSchema,
    birthDate: localDateSchema,
    inCategory: z.boolean().meta({
      description:
        'Está en la categoría del día de test ese día; `false`: aparece solo porque ya tiene resultados.',
    }),
    recording: z.enum(['allowed', 'missing_consent', 'forbidden']).meta({
      description:
        'Si quien pide puede cargarle resultados (`test_result:record`): `missing_consent` sin consentimiento de datos vigente, `forbidden` por rol o alcance.',
    }),
    video: z.enum(['allowed', 'missing_consent', 'forbidden']).meta({
      description:
        'Si quien pide puede grabarle video (`media:upload`; sprint por video, B-605): `missing_consent` sin consentimiento de imagen vigente (sin él no se graba), `forbidden` por rol o alcance.',
    }),
    stage: stageSchema.nullable().meta({
      description: 'Etapa el día del test (por maduración, fijada o de la categoría).',
    }),
    strengthAssessment: z.enum(STRENGTH_ASSESSMENTS).nullable().meta({
      description:
        'Cómo se evalúa su fuerza ese día: técnica (M13/M14), 1RM estimado o 1RM/3RM directo.',
    }),
    tests: z
      .array(
        z.object({
          testCode: testCodeSchema,
          applicable: z.boolean(),
          reason: z.enum(TEST_NOT_APPLICABLE_REASONS).nullable().meta({
            description:
              'Por qué no le corresponde: se carga `not_done` con `not_applicable_to_stage`.',
          }),
        }),
      )
      .meta({ description: 'Por estación, en el mismo orden.' }),
    previous: z.array(testDayPreviousResultSchema).meta({
      description: 'A lo sumo uno por estación.',
    }),
  })
  .meta({ id: 'TestDaySheetPlayer' });

export const testDaySheetSchema = z
  .object({
    testSession: testSessionSchema,
    testWindow: z
      .object({
        id: testWindowIdSchema,
        number: testWindowNumberSchema,
        label: z.enum(['V1', 'V2', 'V3', 'V4']),
      })
      .nullable(),
    stations: z
      .array(testDaySheetStationSchema)
      .meta({ description: 'En el orden de la batería.' }),
    players: z.array(testDaySheetPlayerSchema).meta({ description: 'Por apellido y nombre.' }),
    devices: z
      .array(
        z.object({
          id: deviceIdSchema,
          kind: z.enum(DEVICE_KINDS),
          label: z.string().min(1),
        }),
      )
      .meta({ description: 'Equipos vigentes del club (no retirados), por nombre.' }),
  })
  .meta({ id: 'TestDaySheet' });

export type TestDefinition = z.output<typeof testDaySheetDefinitionSchema>;
export type TestDaySheet = z.output<typeof testDaySheetSchema>;
export type TestDaySheetStation = z.output<typeof testDaySheetStationSchema>;
export type TestDaySheetPlayer = z.output<typeof testDaySheetPlayerSchema>;
export type TestDayPreviousResult = z.output<typeof testDayPreviousResultSchema>;

export const getTestSessionSheet = defineEndpoint({
  method: 'GET',
  path: '/v1/test-sessions/{testSessionId}/sheet',
  summary: 'Planilla de un día de test',
  description:
    'Mismo alcance que el día de test (`coach`, `sc` y `medical` de la categoría, la administración). Las estaciones son los tests que la batería vigente programa en la ventana del día (sin ventana, todos los de la batería) para algún jugador del plantel, más los que ya tienen resultados en el día; cada una con la versión del protocolo vigente ese día. El plantel son los jugadores de la categoría ese día más los que tienen resultados en el día, solo los que quien pide puede ver (`test_result:read`), con su etapa, si cada test les corresponde (principio 3) y el resultado anterior. De otro club: `not_found`; fuera del alcance: `forbidden`.',
  tags: ['tests'],
  auth: 'club',
  params: z.strictObject({ testSessionId: testSessionIdSchema }),
  response: { status: 200, description: 'La planilla del día.', schema: testDaySheetSchema },
  errors: ['not_found'],
});
