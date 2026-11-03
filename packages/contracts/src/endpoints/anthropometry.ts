import {
  COEFFICIENT_VERIFICATION_STATUSES,
  MATURATION_GAPS,
  MATURITY_OFFSET_EQUATIONS,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
  stageSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, playerIdSchema, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import {
  testConditionsInputSchema,
  testConditionsSchema,
  testSessionIdSchema,
} from './calendar.js';
import { changeReasonSchema } from './change-history.js';
import { measurementMethodSchema } from './tests.js';

/**
 * Anthropometry (`anthro`, B-412): the measurement day loads height, sitting
 * height, weight and, in the performance stage, the sum of ISAK skinfolds,
 * by batch. The worker derives the maturation of each measurement (years
 * from PHV, Khamis-Roche % of predicted adult height, growth velocity) with
 * the domain formulas; the preview computes the same values while the staff
 * types, without writing anything.
 */

/** Most measurements in one batch (a squad on a measurement day). */
export const ANTHRO_BATCH_MAX = 200;
export const ANTHRO_NOTES_MAX_LENGTH = 1000;
/** Hard bounds of the inputs: beyond them it is a typo, not a value (plausibility warns earlier). */
export const ANTHRO_HEIGHT_MAX_CM = 250;
export const ANTHRO_SITTING_HEIGHT_MAX_CM = 150;
export const ANTHRO_WEIGHT_MAX_KG = 250;
export const ANTHRO_SKINFOLDS_SUM_MAX_MM = 600;

export const anthroMeasurementIdSchema = idOf('medición antropométrica');

export const maturityOffsetEquationSchema = z.enum(MATURITY_OFFSET_EQUATIONS).meta({
  id: 'MaturityOffsetEquation',
  description:
    'Ecuación del offset de maduración: `mirwald_2002`, `moore_2015` o `moore_2015_height` (varones sin talla sentado). Valores de ecuaciones distintas no se mezclan sin aviso.',
});

export const maturationGapSchema = z.enum(MATURATION_GAPS).meta({
  id: 'MaturationGap',
  description:
    'Por qué falta un valor de maduración: `invalid_age` (medición antes del nacimiento), `height_missing`, `sitting_height_missing` (ninguna ecuación del club calcula el offset solo con la talla), `weight_missing`, `parent_heights_missing` (Khamis-Roche usa la altura de los dos padres), `age_outside_reference` (edad fuera de la tabla), `no_reference_table` (el club no tiene la tabla) o `prediction_rejected` (datos inverosímiles).',
});

const notes = z
  .string()
  .min(1)
  .max(ANTHRO_NOTES_MAX_LENGTH)
  .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' });

const heightCm = z.number().positive().max(ANTHRO_HEIGHT_MAX_CM);
const sittingHeightCm = z.number().positive().max(ANTHRO_SITTING_HEIGHT_MAX_CM);
const weightKg = z.number().positive().max(ANTHRO_WEIGHT_MAX_KG);
const skinfoldsSumMm = z.number().positive().max(ANTHRO_SKINFOLDS_SUM_MAX_MM);

/** The values a measurement derives (the worker writes them; the preview computes them). */
const maturationShape = {
  phvOffsetYears: z.number().nullable().meta({
    description: 'Años desde el pico de velocidad de crecimiento (negativo: antes del PHV).',
  }),
  maturityOffsetEquation: maturityOffsetEquationSchema.nullable(),
  predictedAdultHeightCm: z.number().nullable().meta({
    description: 'Talla adulta predicha (Khamis-Roche 1994), con la altura de los padres.',
  }),
  adultHeightPct: z.number().nullable().meta({
    description: '% de la talla adulta predicha alcanzado (puede pasar de 100).',
  }),
  growthVelocityCmYear: z.number().nullable().meta({
    description: 'Velocidad de crecimiento desde la medición anterior en rango (cm/año).',
  }),
};

export const anthroMaturationSchema = z
  .object({
    ...maturationShape,
    derivedAt: dateTimeSchema.nullable().meta({
      description:
        'Cuándo la calculó el worker; `null` mientras está pendiente (recién cargada o corregida).',
    }),
  })
  .meta({ id: 'AnthroMaturation' });

export const anthroMeasurementSchema = z
  .object({
    id: anthroMeasurementIdSchema,
    playerId: playerIdSchema,
    testSessionId: testSessionIdSchema.nullable(),
    measuredOn: localDateSchema,
    heightCm: z.number().nullable(),
    sittingHeightCm: z.number().nullable(),
    weightKg: z.number().nullable(),
    skinfoldsSumMm: z.number().nullable().meta({ description: 'Σ de pliegues ISAK (mm).' }),
    method: measurementMethodSchema,
    evaluatorId: userIdSchema.nullable(),
    conditions: testConditionsSchema,
    notes: z.string().nullable(),
    maturation: anthroMaturationSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'AnthroMeasurement' });

export type AnthroMeasurement = z.output<typeof anthroMeasurementSchema>;

const VALUES_RULES =
  'Al menos un valor; talla sentado menor que la talla; Σ de pliegues ISAK solo en la etapa `performance` (M17/M19) del jugador ese día.';

export const anthroMeasurementInputSchema = z
  .strictObject({
    clientUuid: clientUuidSchema.optional(),
    playerId: playerIdSchema,
    measuredOn: localDateSchema.optional().meta({
      description:
        'Por defecto, la fecha del día de test (con día de test, tiene que ser esa). Obligatoria sin día de test.',
    }),
    testSessionId: testSessionIdSchema.optional().meta({
      description: 'El día de test (de la categoría del jugador) en que se midió, si lo hubo.',
    }),
    heightCm: heightCm.optional(),
    sittingHeightCm: sittingHeightCm.optional(),
    weightKg: weightKg.optional(),
    skinfoldsSumMm: skinfoldsSumMm.optional(),
    method: measurementMethodSchema
      .exclude(['historical'])
      .optional()
      .meta({ description: 'Por defecto `manual`.' }),
    evaluatorId: userIdSchema.optional().meta({
      description: 'Por defecto, el evaluador del día de test o quien carga (staff del club).',
    }),
    conditions: testConditionsInputSchema.optional().meta({
      description: 'Por defecto, las del día de test.',
    }),
    notes: notes.optional(),
  })
  .meta({ id: 'AnthroMeasurementInput' });

export type AnthroMeasurementInput = z.output<typeof anthroMeasurementInputSchema>;

const RECORD_RULES =
  '`sc` en sus asignaciones y la administración, con consentimiento de datos vigente del jugador.';

export const recordAnthroMeasurements = defineEndpoint({
  method: 'POST',
  path: '/v1/anthro-measurements',
  summary: 'Cargar mediciones antropométricas por lote',
  description: `El día de mediciones: hasta ${String(ANTHRO_BATCH_MAX)} mediciones (varios jugadores) en una transacción, todo o nada; los errores de todas las filas vuelven juntos en \`body.measurements.<i>.<campo>\`. Cada medición es idempotente por \`clientUuid\` (\`replayed\` dice si ya estaba). ${RECORD_RULES} Un jugador sin consentimiento de datos es un problema de su fila (\`consent_required\` en \`body.measurements.<i>.playerId\`). ${VALUES_RULES} Un día de test cancelado no recibe mediciones (\`conflict\`). La maduración la calcula el worker después del commit.`,
  tags: ['tests'],
  auth: 'club',
  body: z.strictObject({
    measurements: z.array(anthroMeasurementInputSchema).min(1).max(ANTHRO_BATCH_MAX),
  }),
  response: {
    status: 201,
    description: 'Mediciones cargadas, en el orden del pedido.',
    schema: z
      .object({
        measurements: z.array(
          z.object({ measurement: anthroMeasurementSchema, replayed: z.boolean() }),
        ),
      })
      .meta({ id: 'AnthroMeasurementBatch' }),
  },
  errors: ['not_found', 'conflict'],
});

export const listAnthroMeasurements = defineEndpoint({
  method: 'GET',
  path: '/v1/anthro-measurements',
  summary: 'Mediciones antropométricas',
  description:
    'El staff ve los jugadores de sus asignaciones, la administración todo el club y el jugador las suyas. `categoryId` filtra por la categoría del jugador el día de cada medición.',
  tags: ['tests'],
  auth: 'club',
  query: pageQuerySchema.extend({
    playerId: playerIdSchema.optional(),
    categoryId: categoryIdSchema.optional(),
    testSessionId: testSessionIdSchema.optional(),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    sort: sortQuerySchema(['measuredOn', 'createdAt'], '-measuredOn'),
  }),
  response: {
    status: 200,
    description: 'Página de mediciones.',
    schema: pageOf(anthroMeasurementSchema).meta({ id: 'AnthroMeasurementPage' }),
  },
  errors: ['bad_request'],
});

const measurementParams = z.strictObject({ anthroMeasurementId: anthroMeasurementIdSchema });

export const getAnthroMeasurement = defineEndpoint({
  method: 'GET',
  path: '/v1/anthro-measurements/{anthroMeasurementId}',
  summary: 'Una medición antropométrica',
  description: 'Mismo alcance que la lista.',
  tags: ['tests'],
  auth: 'club',
  params: measurementParams,
  response: { status: 200, description: 'La medición.', schema: anthroMeasurementSchema },
  errors: ['not_found'],
});

export const updateAnthroMeasurement = defineEndpoint({
  method: 'PATCH',
  path: '/v1/anthro-measurements/{anthroMeasurementId}',
  summary: 'Corregir una medición antropométrica',
  description: `${RECORD_RULES} Se manda la \`version\` leída (\`conflict\` si cambió) y el motivo (\`changeReason\`, queda en el historial de cambios). \`null\` borra un valor. ${VALUES_RULES} Una medición de un día de test solo cambia de fecha a la del día. La maduración se recalcula.`,
  tags: ['tests'],
  auth: 'club',
  params: measurementParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    changeReason: changeReasonSchema,
    measuredOn: localDateSchema.optional(),
    heightCm: heightCm.nullable().optional(),
    sittingHeightCm: sittingHeightCm.nullable().optional(),
    weightKg: weightKg.nullable().optional(),
    skinfoldsSumMm: skinfoldsSumMm.nullable().optional(),
    method: measurementMethodSchema.exclude(['historical']).optional(),
    evaluatorId: userIdSchema.nullable().optional(),
    conditions: testConditionsInputSchema.optional(),
    notes: notes.nullable().optional(),
  }),
  response: { status: 200, description: 'La medición corregida.', schema: anthroMeasurementSchema },
  errors: ['not_found', 'conflict'],
});

// ─── Preview: the maturation while the staff types ──────────────────────────────────

export const ANTHRO_FIELDS = ['heightCm', 'sittingHeightCm', 'weightKg', 'skinfoldsSumMm'] as const;

export const anthroPlausibilitySchema = z
  .object({
    field: z.enum(ANTHRO_FIELDS),
    status: z.enum(['below', 'above']),
    minValue: z.number(),
    maxValue: z.number(),
    suggestedValues: z.array(z.number()).meta({
      description: 'El mismo número con la coma corrida que cae en el rango (¿quisiste decir…?).',
    }),
  })
  .meta({
    id: 'AnthroPlausibility',
    description: 'Un valor fuera del rango plausible para la edad y el sexo. No bloquea la carga.',
  });

export const anthroPreviewSchema = z
  .object({
    playerId: playerIdSchema,
    measuredOn: localDateSchema,
    blockedBy: z.enum(['consent_required']).nullable().meta({
      description:
        '`consent_required`: el jugador no tiene consentimiento de datos vigente; no se calcula nada ni se puede cargar. El resto del plantel sigue.',
    }),
    ageYears: z.number().nullable().meta({ description: 'Edad decimal ese día.' }),
    stage: stageSchema.nullable().meta({ description: 'Etapa del jugador ese día.' }),
    ...maturationShape,
    maturityOffsetVerification: z.enum(COEFFICIENT_VERIFICATION_STATUSES).nullable().meta({
      description:
        'Si los coeficientes de la ecuación usada (`maturityOffsetEquation`) están verificados contra la publicación; `null` sin offset. Todo lo que no sea `verified_against_publication` se muestra con aviso.',
    }),
    gaps: z.object({
      phvOffset: z.array(maturationGapSchema),
      adultHeight: z.array(maturationGapSchema),
    }),
    plausibility: z.array(anthroPlausibilitySchema),
  })
  .meta({ id: 'AnthroPreview' });

export type AnthroPreview = z.output<typeof anthroPreviewSchema>;

export const anthroPreviewReferenceSchema = z
  .object({
    code: z.string().min(1),
    verification: z.enum(COEFFICIENT_VERIFICATION_STATUSES),
  })
  .nullable()
  .meta({
    description:
      'La tabla Khamis-Roche del club y si sus coeficientes están verificados contra la publicación (todo lo que no sea `verified_against_publication` se muestra con aviso); `null` sin tabla.',
  });

export type AnthroPreviewReference = z.output<typeof anthroPreviewReferenceSchema>;

export const previewAnthroMeasurements = defineEndpoint({
  method: 'POST',
  path: '/v1/anthro-measurements/preview',
  summary: 'Maduración al instante de mediciones sin guardar',
  description: `Mientras se tipea la planilla: offset de PHV, talla adulta predicha y su %, y velocidad de crecimiento de hasta ${String(ANTHRO_BATCH_MAX)} mediciones, con la misma función del dominio, los parámetros del club y la tabla Khamis-Roche sembrada que usa el worker, y la historia del jugador. No escribe nada (cuenta en el presupuesto de lecturas). Dice por qué falta cada valor y qué valores están fuera del rango plausible. Se puede mandar todo el plantel, con o sin valores (la planilla vacía ya muestra a quién le falta la altura de los padres). ${RECORD_RULES} Un jugador sin consentimiento de datos vuelve con \`blockedBy\` y sin cálculo.`,
  tags: ['tests'],
  auth: 'club',
  body: z.strictObject({
    measurements: z
      .array(
        z.strictObject({
          playerId: playerIdSchema,
          measuredOn: localDateSchema,
          heightCm: heightCm.optional(),
          sittingHeightCm: sittingHeightCm.optional(),
          weightKg: weightKg.optional(),
          skinfoldsSumMm: skinfoldsSumMm.optional(),
        }),
      )
      .min(1)
      .max(ANTHRO_BATCH_MAX),
  }),
  response: {
    status: 200,
    description: 'La maduración de cada medición, en el orden del pedido.',
    schema: z
      .object({
        reference: anthroPreviewReferenceSchema,
        items: z.array(anthroPreviewSchema),
      })
      .meta({ id: 'AnthroPreviewBatch' }),
  },
  errors: ['not_found'],
});
