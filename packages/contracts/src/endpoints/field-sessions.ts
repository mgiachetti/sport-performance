import {
  FIELD_METRIC_SOURCES,
  MEASUREMENT_METHODS,
  UNIT_CODES,
  type MetricDirection,
  type UnitCode,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  archiveStatusQuerySchema,
  sortQuerySchema,
  sportSchema,
} from '../primitives/conventions.js';
import { localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, playerIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { playerNameSchema } from './players.js';
import { referenceSourceSchema } from './reference-values.js';
import { metricCodeSchema } from './tests.js';
import {
  contactsSchema,
  minutesSchema,
  participationStatusSchema,
  rpeSchema,
  sessionKindSchema,
  trainingSessionIdSchema,
  trainingSessionSchema,
  trainingSessionSummarySchema,
} from './training.js';

/**
 * Field sessions (B-408, ADR 0061): the field metrics of a training session
 * or match per player, as the staff reads them after a Catapult import
 * (B-601), the heart-rate bands (Phase 2) or the pods (Phase 3). Values keep
 * their source (principle 4): two sources of the same metric are two
 * columns, never one average.
 */

export const fieldMetricSourceSchema = z.enum(FIELD_METRIC_SOURCES).meta({
  id: 'FieldMetricSource',
  description:
    'De dónde sale el valor: `catapult` (importación de OpenField), `pod` (pod GNSS + IMU del jugador), `hr_band` (banda de frecuencia cardíaca) o `manual`. Cada fuente es un método distinto: nunca se mezclan.',
});

const UNIT_VALUES = UNIT_CODES as [UnitCode, ...UnitCode[]];
const unitSchema = z.enum(UNIT_VALUES).meta({
  description: 'Unidad canónica de la métrica (`metric_definition.unit`).',
  examples: ['m'],
});

const DIRECTIONS = [
  'higher_is_better',
  'lower_is_better',
  'neutral',
] as const satisfies readonly MetricDirection[];

/** A column of the session view: one metric from one source. */
export const fieldMetricColumnSchema = z
  .object({
    metricCode: metricCodeSchema,
    source: fieldMetricSourceSchema,
    unit: unitSchema,
    direction: z.enum(DIRECTIONS).meta({
      description: 'Sentido de la métrica: si más es mejor, si menos es mejor o neutra.',
    }),
  })
  .meta({ id: 'FieldMetricColumn' });

export const fieldMetricValueSchema = z
  .object({
    metricCode: metricCodeSchema,
    source: fieldMetricSourceSchema,
    value: z
      .number()
      .meta({ description: 'Valor del total de la sesión, en la unidad de la métrica.' }),
  })
  .meta({ id: 'FieldMetricValue' });

export const fieldSessionPlayerSchema = z
  .object({
    playerId: playerIdSchema,
    firstName: playerNameSchema,
    lastName: playerNameSchema,
    position: z
      .object({
        code: z
          .string()
          .min(1)
          .meta({ examples: ['hooker'] }),
        label: z
          .string()
          .min(1)
          .nullable()
          .meta({ description: 'Texto propio del club, si lo tiene.' }),
        lineCode: z
          .string()
          .min(1)
          .nullable()
          .meta({ description: 'Línea (`forwards`, `backs`): agrupa las barras.' }),
      })
      .nullable()
      .meta({ description: 'Posición principal del jugador; `null` si no tiene.' }),
    participation: z
      .object({
        status: participationStatusSchema,
        minutes: minutesSchema.nullable(),
        contactsN: contactsSchema.nullable(),
        rpe: rpeSchema.nullable(),
        srpeAu: z.int().min(0).nullable().meta({ description: 'sRPE = RPE × minutos (UA).' }),
      })
      .nullable()
      .meta({
        description:
          'Lo que cargó el entrenador y el jugador; `null` si nadie cargó su participación. `unavailable` nunca dice la causa.',
      }),
    values: z
      .array(fieldMetricValueSchema)
      .meta({ description: 'Un valor por métrica y fuente; vacío si no tiene datos de cancha.' }),
  })
  .meta({ id: 'FieldSessionPlayer' });

export const fieldSessionReferenceSchema = z
  .object({
    metricCode: metricCodeSchema,
    unit: unitSchema,
    value: z.number().meta({ description: 'Valor de la primera, en la unidad de la métrica.' }),
    method: z.enum(MEASUREMENT_METHODS).nullable().meta({
      description: 'Cómo la midió la primera, si se sabe.',
    }),
    validFrom: localDateSchema,
    source: referenceSourceSchema,
  })
  .meta({ id: 'FieldSessionReference' });

export const fieldSessionSchema = z
  .object({
    session: trainingSessionSchema,
    columns: z.array(fieldMetricColumnSchema).meta({
      description:
        'Métricas con algún valor en la sesión, en el orden del diccionario canónico (las propias del club al final) y, dentro de una métrica, por fuente.',
    }),
    players: z.array(fieldSessionPlayerSchema).meta({
      description:
        'Jugadores con datos de cancha o con participación cargada que el usuario ve (`load_metrics.read`), por apellido y nombre.',
    }),
    references: z.array(fieldSessionReferenceSchema).meta({
      description:
        'Referencias de primera de todo el plantel (deporte y sexo de la categoría, vigentes el día de la sesión) de las métricas de `columns`. Vacío sin categoría o sin referencias.',
    }),
  })
  .meta({ id: 'FieldSession' });

export const fieldSessionListItemSchema = z
  .object({
    session: trainingSessionSummarySchema,
    playersN: z
      .int()
      .min(1)
      .meta({ description: 'Jugadores con datos de cancha que el usuario ve.' }),
    sources: z
      .array(fieldMetricSourceSchema)
      .min(1)
      .meta({ description: 'Fuentes presentes, en el orden de `FieldMetricSource`.' }),
    metricCodes: z
      .array(metricCodeSchema)
      .min(1)
      .meta({ description: 'Métricas presentes, en el orden del diccionario canónico.' }),
  })
  .meta({ id: 'FieldSessionListItem' });

export type FieldMetricColumn = z.output<typeof fieldMetricColumnSchema>;
export type FieldMetricValue = z.output<typeof fieldMetricValueSchema>;
export type FieldSessionPlayer = z.output<typeof fieldSessionPlayerSchema>;
export type FieldSessionReference = z.output<typeof fieldSessionReferenceSchema>;
export type FieldSession = z.output<typeof fieldSessionSchema>;
export type FieldSessionListItem = z.output<typeof fieldSessionListItemSchema>;

export const listFieldSessions = defineEndpoint({
  method: 'GET',
  path: '/v1/field-sessions',
  summary: 'Sesiones y partidos con métricas de cancha',
  description:
    'Las sesiones con al menos un valor de cancha (`external_metric`) de un jugador visible. Mismo alcance que `GET /v1/training-sessions`: la administración ve todas; `coach`, `sc` y `medical`, las de sus categorías (o deportes) asignados. `from` y `to` son días del club, incluidos. Las archivadas, con `status`.',
  tags: ['training'],
  auth: 'club',
  query: pageQuerySchema.extend({
    sport: sportSchema.optional(),
    categoryId: categoryIdSchema.optional(),
    kind: sessionKindSchema.optional(),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['startsAt'], '-startsAt'),
  }),
  response: {
    status: 200,
    description: 'Página de sesiones con datos de cancha.',
    schema: pageOf(fieldSessionListItemSchema).meta({ id: 'FieldSessionPage' }),
  },
  errors: ['bad_request'],
});

export const getTrainingSessionFieldMetrics = defineEndpoint({
  method: 'GET',
  path: '/v1/training-sessions/{trainingSessionId}/field-metrics',
  summary: 'Vista de cancha de una sesión',
  description:
    'La sesión (`training_session.read`) con el total de cada métrica de cancha por jugador y fuente (las filas sin bloque; si hay más de una, la última cargada), la participación y las referencias de primera del plantel. Cada jugador pasa por `load_metrics.read`: los que el usuario no ve no aparecen. Es un recurso acotado (los jugadores de una sesión), sin paginar. De otro club: `not_found`; fuera del alcance: `forbidden`.',
  tags: ['training'],
  auth: 'club',
  params: z.strictObject({ trainingSessionId: trainingSessionIdSchema }),
  response: { status: 200, description: 'La vista de la sesión.', schema: fieldSessionSchema },
  errors: ['not_found'],
});
