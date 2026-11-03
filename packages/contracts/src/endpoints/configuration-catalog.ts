import {
  ATTEMPT_AGGREGATIONS,
  UNIT_CODES,
  type MetricDirection,
  type MetricSource,
  type UnitCode,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  archivedAtSchema,
  archiveStatusQuerySchema,
  resourceVersionSchema,
  sortQuerySchema,
  sportSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { idOf } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { testDefinitionIdSchema } from './tests.js';
import {
  batteryTestCodeSchema,
  configurationCodeSchema,
  onDateQuerySchema,
  validFromSchema,
  validToSchema,
} from './configuration-common.js';

/**
 * Read side of the club's catalog (B-409, ADR 0062): the tests of the
 * catalog (one row per test code, the protocol version in force) and the
 * metric dictionary (principle 1). Both are seeded per club (B-306, ADR 0027)
 * and are what the configuration screens pick from: the battery schedules a
 * test of the catalog, a first-team reference is for a metric of the
 * dictionary and takes its unit. Same permission as the rest of the club
 * configuration (`configuration.read`).
 */

const METRIC_SOURCE_VALUES = ['field', 'test', 'load'] as const satisfies readonly MetricSource[];
const METRIC_DIRECTION_VALUES = [
  'higher_is_better',
  'lower_is_better',
  'neutral',
] as const satisfies readonly MetricDirection[];
const UNIT_VALUES = UNIT_CODES as [UnitCode, ...UnitCode[]];

export const metricSourceSchema = z.enum(METRIC_SOURCE_VALUES).meta({
  id: 'MetricSource',
  description:
    'De dónde sale: `field` (cancha, equivalente a Catapult), `test` (la batería) o `load` (RPE y sRPE).',
});

export const metricDirectionSchema = z.enum(METRIC_DIRECTION_VALUES).meta({
  id: 'MetricDirection',
  description: 'Si más es mejor, si menos es mejor o neutra.',
});

const metricCodeSchema = configurationCodeSchema.meta({
  description: 'Código canónico de la métrica.',
  examples: ['cmj_height_cm'],
});

const sportsSchema = z
  .array(sportSchema)
  .min(1)
  .nullable()
  .meta({ description: 'Deportes donde aplica; `null` = todos.' });

export const catalogTestSchema = z
  .object({
    code: batteryTestCodeSchema,
    testDefinitionId: testDefinitionIdSchema.meta({
      description: 'La versión del protocolo que se muestra (la vigente ese día, o la última).',
    }),
    protocolVersion: z.int().min(1).meta({ description: 'Número de versión del protocolo.' }),
    inForce: z.boolean().meta({
      description:
        'La versión está vigente el día pedido. `false`: no hay ninguna vigente y se muestra la última.',
    }),
    sports: sportsSchema,
    maximalLoad: z.boolean().meta({
      description:
        'Test con cargas máximas: solo para la etapa `performance` y franjas que las permitan (principio 3).',
    }),
    attemptCount: z.int().min(1),
    attemptAggregation: z.enum(ATTEMPT_AGGREGATIONS).meta({
      description: 'Cómo se resumen los intentos: el mejor (`best`) o el promedio (`mean`).',
    }),
    metricCodes: z
      .array(metricCodeSchema)
      .meta({ description: 'Métricas que produce la versión, en su orden.' }),
    validFrom: validFromSchema,
    validTo: validToSchema,
  })
  .meta({ id: 'CatalogTest' });

export type CatalogTest = z.output<typeof catalogTestSchema>;

export const listCatalogTests = defineEndpoint({
  method: 'GET',
  path: '/v1/catalog/tests',
  summary: 'Tests del catálogo del club',
  description:
    'Un ítem por código de test: la versión del protocolo vigente en `onDate` o, si ninguna lo está, la última. Lectura: `coach`, `sc`, `medical` y la administración (`configuration.read`).',
  tags: ['configuration'],
  auth: 'club',
  query: pageQuerySchema.extend({
    sport: sportSchema
      .optional()
      .meta({ description: 'Solo los tests que aplican a ese deporte (o a todos).' }),
    onDate: onDateQuerySchema,
    sort: sortQuerySchema(['code'], 'code'),
  }),
  response: {
    status: 200,
    description: 'Página de tests del catálogo.',
    schema: pageOf(catalogTestSchema).meta({ id: 'CatalogTestPage' }),
  },
  errors: ['bad_request'],
});

export const catalogMetricIdSchema = idOf('métrica');

export const catalogMetricSchema = z
  .object({
    id: catalogMetricIdSchema,
    code: metricCodeSchema,
    unit: z.enum(UNIT_VALUES).meta({ description: 'Unidad canónica.' }),
    source: metricSourceSchema,
    direction: metricDirectionSchema,
    testCode: batteryTestCodeSchema
      .nullable()
      .meta({ description: 'Test que la produce (`source = test`).' }),
    sports: sportsSchema,
    description: z
      .string()
      .nullable()
      .meta({ description: 'Definición corta para el glosario del staff.' }),
    catapultAliases: z
      .array(z.string())
      .meta({ description: 'Columnas de OpenField que se importan a esta métrica.' }),
    isCanonical: z
      .boolean()
      .meta({ description: 'Del diccionario canónico (mismo que la primera).' }),
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'CatalogMetric' });

export type CatalogMetric = z.output<typeof catalogMetricSchema>;

export const listCatalogMetrics = defineEndpoint({
  method: 'GET',
  path: '/v1/catalog/metrics',
  summary: 'Diccionario de métricas del club',
  description:
    'Código, unidad, sentido, origen, test y alias de Catapult de cada métrica (principio 1). Lectura: `coach`, `sc`, `medical` y la administración (`configuration.read`).',
  tags: ['configuration'],
  auth: 'club',
  query: pageQuerySchema.extend({
    sport: sportSchema
      .optional()
      .meta({ description: 'Solo las métricas que aplican a ese deporte (o a todos).' }),
    source: metricSourceSchema.optional(),
    testCode: batteryTestCodeSchema.optional(),
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['code'], 'code'),
  }),
  response: {
    status: 200,
    description: 'Página de métricas.',
    schema: pageOf(catalogMetricSchema).meta({ id: 'CatalogMetricPage' }),
  },
  errors: ['bad_request'],
});
