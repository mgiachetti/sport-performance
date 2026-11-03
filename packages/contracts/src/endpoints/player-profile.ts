import {
  ACWR_STATUSES,
  MATURITY_OFFSET_EQUATIONS,
  MEASUREMENT_METHODS,
  MONOTONY_STATUSES,
  PERCENTILE_GROUP_DIMENSIONS,
  STAGE_BASES,
  TEST_COMPARISON_WARNINGS,
  UNIT_CODES,
  type MetricDirection,
  type UnitCode,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { stageSchema } from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, playerIdSchema } from '../primitives/ids.js';
import { testWindowIdSchema } from './calendar.js';
import { availabilityStatusSchema } from './panel.js';
import {
  exerciseCodeSchema,
  measurementMethodSchema,
  metricCodeSchema,
  testCodeSchema,
} from './tests.js';

/**
 * Reads of the player profile (ficha, B-404, ADR 0060): one player's derived
 * series, already computed by the worker (`player_load_daily`,
 * `player_wellness_daily`, maturation in `anthro_measurement`), the history
 * of the derived availability (never the cause) and the comparison of their
 * tests against their group (percentiles and category average by window),
 * aggregated in the API so no other player's value or identity leaves it.
 *
 * Each endpoint authorizes the player with the permission matrix (ADR 0025)
 * and reads under RLS: a player of another club or out of the caller's scope
 * is `not_found`; a role the matrix denies is `forbidden`.
 */

/** Peak-zone criterion outcomes (domain `PeakZoneCriterionStatus`). */
export const PEAK_ZONE_CRITERION_STATUSES = ['met', 'not_met', 'unknown', 'disabled'] as const;

/** A measurement older than this (days) says nothing about the peak zone today. */
export const PEAK_ZONE_MAX_MEASUREMENT_AGE_DAYS = 120;

/** Longest range of days of the daily monitoring (one season and some). */
export const DAILY_MONITORING_MAX_DAYS = 366;
/** Default range of the daily monitoring: the last 28 days, today included. */
export const DAILY_MONITORING_DEFAULT_DAYS = 28;
/** Longest range of the availability history (two years). */
export const AVAILABILITY_HISTORY_MAX_DAYS = 731;
/** Default range of the availability history: the last 90 days, today included. */
export const AVAILABILITY_HISTORY_DEFAULT_DAYS = 90;
/** Most anthropometric measurements in the maturation read (newest first). */
export const MATURATION_MEASUREMENTS_MAX = 200;
/**
 * Fewest distinct players for a category average by window to be shown: a
 * smaller group would let a player work out another one's value.
 */
export const CATEGORY_AVERAGE_MIN_PLAYERS = 5;

const UNIT_VALUES = UNIT_CODES as [UnitCode, ...UnitCode[]];
const unitSchema = z.enum(UNIT_VALUES).meta({ description: 'Unidad canónica de la métrica.' });
const DIRECTIONS = [
  'higher_is_better',
  'lower_is_better',
  'neutral',
] as const satisfies readonly MetricDirection[];
const directionSchema = z.enum(DIRECTIONS).meta({
  description: 'Sentido de la métrica: si más es mejor, si menos es mejor o neutra.',
});

const playerParams = z.strictObject({ playerId: playerIdSchema });

// ─── Daily monitoring: load and wellness ─────────────────────────────────────────────

export const playerLoadDaySchema = z
  .object({
    date: localDateSchema.meta({ description: 'Día del club.' }),
    loadAu: z.number().min(0).meta({ description: 'sRPE del día (UA); 0 sin carga.' }),
    hasData: z.boolean().meta({ description: 'Si hubo alguna sesión con RPE ese día.' }),
    sessions: z.int().min(0).meta({ description: 'Sesiones con RPE.' }),
    pendingRpe: z.int().min(0).meta({ description: 'Sesiones jugadas sin RPE todavía.' }),
    historyDays: z.int().min(1).meta({ description: 'Días de historia hasta ese día.' }),
    acuteEwmaAu: z.number().min(0).meta({ description: 'EWMA aguda (N = 7 por defecto).' }),
    chronicEwmaAu: z.number().min(0).meta({ description: 'EWMA crónica (N = 28 por defecto).' }),
    acwr: z.number().min(0).nullable().meta({ description: 'Aguda / crónica; `null` sin `ok`.' }),
    acwrStatus: z.enum(ACWR_STATUSES).meta({
      description:
        '`ok`, `insufficient_history` (menos de 28 días: sin alertas de ACWR) o `zero_chronic_load`.',
    }),
    missingDaysAcute: z.int().min(0),
    missingDaysChronic: z.int().min(0),
    weekLoadAu: z.number().min(0).meta({ description: 'Carga de los últimos 7 días (UA).' }),
    monotony: z.number().nullable().meta({ description: 'Monotonía de Foster de la semana.' }),
    strainAu: z.number().nullable().meta({ description: 'Strain: carga semanal × monotonía.' }),
    monotonyStatus: z.enum(MONOTONY_STATUSES),
  })
  .meta({ id: 'PlayerLoadDay' });

export const playerWellnessDaySchema = z
  .object({
    date: localDateSchema,
    itemCount: z.union([z.literal(3), z.literal(5)]).meta({
      description: 'Ítems del formulario: 3 (caritas, M13/M14) o 5.',
    }),
    meanScore: z.number().min(1).max(5),
    baselineSamples: z.int().min(0),
    baselineMeanScore: z.number().nullable().meta({ description: 'Media móvil propia.' }),
    baselineSdScore: z.number().min(0).nullable(),
    zScore: z.number().nullable().meta({ description: 'Contra la media móvil propia.' }),
  })
  .meta({ id: 'PlayerWellnessDay' });

export type PlayerLoadDay = z.output<typeof playerLoadDaySchema>;
export type PlayerWellnessDay = z.output<typeof playerWellnessDaySchema>;

export const getPlayerDailyMonitoring = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/daily-monitoring',
  summary: 'Carga y bienestar diarios de un jugador',
  description: `La serie que calcula el worker (ADR 0046): carga diaria con EWMA, ACWR, monotonía y strain, y el bienestar de cada día con su comparación contra la media propia. Entre \`from\` y \`to\` (incluidos, hasta ${String(DAILY_MONITORING_MAX_DAYS)} días); por defecto los últimos ${String(DAILY_MONITORING_DEFAULT_DAYS)} días hasta hoy en la zona del club. Un día sin fila es un día antes de la historia del jugador (la carga tiene fila también los días sin dato). \`load_metrics.read\` y \`wellness.read\` del jugador.`,
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  query: z.strictObject({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  }),
  response: {
    status: 200,
    description: 'La serie del rango.',
    schema: z
      .object({
        playerId: playerIdSchema,
        from: localDateSchema,
        to: localDateSchema,
        today: localDateSchema.meta({ description: 'Hoy en la zona del club.' }),
        refreshPending: z.boolean().meta({
          description: 'Hay datos nuevos que el worker todavía no recalculó.',
        }),
        load: z
          .array(playerLoadDaySchema)
          .meta({ description: 'Por día, del más viejo al más nuevo.' }),
        wellness: z
          .array(playerWellnessDaySchema)
          .meta({ description: 'Por día con bienestar, del más viejo al más nuevo.' }),
      })
      .meta({ id: 'PlayerDailyMonitoring' }),
  },
  errors: ['bad_request', 'not_found'],
});

// ─── Maturation ──────────────────────────────────────────────────────────────────────

export const anthroMeasurementIdSchema = idOf('medición antropométrica');

export const playerAnthroMeasurementSchema = z
  .object({
    id: anthroMeasurementIdSchema,
    measuredOn: localDateSchema,
    heightCm: z.number().positive().nullable(),
    sittingHeightCm: z.number().positive().nullable(),
    weightKg: z.number().positive().nullable(),
    skinfoldsSumMm: z.number().positive().nullable(),
    method: measurementMethodSchema,
    phvOffsetYears: z.number().nullable().meta({
      description: 'Años desde el pico de velocidad de crecimiento (negativo: antes del pico).',
    }),
    maturityOffsetEquation: z.enum(MATURITY_OFFSET_EQUATIONS).nullable().meta({
      description: 'Ecuación usada para el offset (`null` sin datos suficientes).',
    }),
    predictedAdultHeightCm: z.number().positive().nullable().meta({
      description: 'Talla adulta predicha (Khamis-Roche); requiere la altura de los dos padres.',
    }),
    adultHeightPct: z.number().positive().nullable().meta({
      description: '% de la talla adulta predicha alcanzado.',
    }),
    growthVelocityCmYear: z.number().nullable().meta({
      description: 'Velocidad de crecimiento de la talla (cm/año) contra una medición anterior.',
    }),
    derivedAt: dateTimeSchema.nullable().meta({
      description: 'Cuándo calculó el worker la maduración; `null` si todavía no.',
    }),
  })
  .meta({ id: 'PlayerAnthroMeasurement' });

export type PlayerAnthroMeasurement = z.output<typeof playerAnthroMeasurementSchema>;

export const playerPeakZoneSchema = z
  .object({
    inZone: z.boolean().meta({
      description:
        'Está en la zona de pico de crecimiento: sugiere bajar saltos y sprints, vigilar rodilla y talón.',
    }),
    offset: z.enum(PEAK_ZONE_CRITERION_STATUSES).meta({
      description: 'Criterio por años desde el PHV (por defecto entre −1 y +1).',
    }),
    growthVelocity: z.enum(PEAK_ZONE_CRITERION_STATUSES).meta({
      description: 'Criterio por velocidad de crecimiento (apagado por defecto).',
    }),
    measuredOn: localDateSchema.meta({ description: 'Medición evaluada.' }),
  })
  .meta({ id: 'PlayerPeakZone' });

export type PlayerPeakZone = z.output<typeof playerPeakZoneSchema>;

export const getPlayerMaturation = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/maturation',
  summary: 'Maduración de un jugador',
  description: `Las mediciones antropométricas del jugador (las ${String(MATURATION_MEASUREMENTS_MAX)} más nuevas, de la más nueva a la más vieja) con lo que derivó el worker: offset de PHV con su ecuación, talla adulta predicha y su %, velocidad de crecimiento. También la etapa vigente hoy (por maduración, fijada por el staff o la de la categoría). Si faltan datos para un derivado, queda \`null\`. \`anthropometry.read\` del jugador.`,
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  response: {
    status: 200,
    description: 'La maduración del jugador.',
    schema: z
      .object({
        playerId: playerIdSchema,
        today: localDateSchema,
        stage: z
          .object({
            stage: stageSchema,
            basis: z.enum(STAGE_BASES).meta({
              description:
                '`maturation` (asignada por maduración), `manual` (fijada por el staff) o `category` (la de su categoría).',
            }),
            categoryId: categoryIdSchema,
          })
          .nullable()
          .meta({ description: 'Etapa de hoy; `null` sin categoría vigente.' }),
        refreshPending: z.boolean().meta({
          description: 'Hay mediciones nuevas que el worker todavía no derivó.',
        }),
        peakZone: playerPeakZoneSchema.nullable().meta({
          description: `Zona de pico de la medición derivada más nueva (dominio, \`peakHeightVelocityZone\`); \`null\` sin medición evaluable de los últimos ${String(PEAK_ZONE_MAX_MEASUREMENT_AGE_DAYS)} días. No depende de las alertas: la ve todo el que lee la antropometría.`,
        }),
        measurements: z.array(playerAnthroMeasurementSchema),
      })
      .meta({ id: 'PlayerMaturation' }),
  },
  errors: ['not_found'],
});

// ─── Availability ────────────────────────────────────────────────────────────────────

export const availabilityPeriodSchema = z
  .object({
    from: localDateSchema,
    to: localDateSchema.meta({ description: 'Último día del tramo (inclusive).' }),
    training: availabilityStatusSchema,
    match: availabilityStatusSchema,
    overall: availabilityStatusSchema.meta({ description: 'La peor de las dos.' }),
  })
  .meta({ id: 'AvailabilityPeriod' });

export type AvailabilityPeriod = z.output<typeof availabilityPeriodSchema>;

export const getPlayerAvailability = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/availability',
  summary: 'Disponibilidad de un jugador',
  description: `La disponibilidad derivada de hoy (entrenamiento, partido y la peor de las dos, con las notas del bloqueo para el staff) y su historia por tramos entre \`from\` y \`to\` (incluidos, hasta ${String(AVAILABILITY_HISTORY_MAX_DAYS)} días; por defecto los últimos ${String(AVAILABILITY_HISTORY_DEFAULT_DAYS)} días hasta hoy). Sale de las funciones del esquema \`medical\` (ADR 0029), que registran cada lectura; nunca el diagnóstico ni la causa. Las notas no se muestran al jugador ni al tutor. \`availability.read\` del jugador.`,
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  query: z.strictObject({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  }),
  response: {
    status: 200,
    description: 'La disponibilidad del jugador.',
    schema: z
      .object({
        playerId: playerIdSchema,
        today: localDateSchema,
        from: localDateSchema,
        to: localDateSchema,
        current: z.object({
          training: availabilityStatusSchema,
          match: availabilityStatusSchema,
          overall: availabilityStatusSchema,
          staffNotes: z.array(z.string()).meta({
            description: 'Notas de los bloqueos vigentes para el staff (sin diagnóstico).',
          }),
        }),
        periods: z.array(availabilityPeriodSchema).meta({
          description: 'Tramos consecutivos con el mismo estado, del más viejo al más nuevo.',
        }),
      })
      .meta({ id: 'PlayerAvailability' }),
  },
  errors: ['bad_request', 'not_found'],
});

// ─── Percentiles ─────────────────────────────────────────────────────────────────────

export const percentileGroupingSchema = z
  .object({
    dimensions: z.array(z.enum(PERCENTILE_GROUP_DIMENSIONS)).meta({
      description: 'Con qué se armó el grupo, además del deporte y la métrica.',
    }),
    seasonsAccumulated: z.int().min(1),
  })
  .meta({ id: 'PercentileGrouping' });

export const playerPercentileSchema = z
  .object({
    metricCode: metricCodeSchema,
    testCode: testCodeSchema,
    exercise: exerciseCodeSchema.nullable().meta({
      description:
        'Ejercicio de fuerza (`null` en los demás tests): cada ejercicio es una comparación aparte.',
    }),
    unit: unitSchema,
    direction: directionSchema,
    value: z
      .number()
      .meta({ description: 'Último valor del jugador (en la unidad de la métrica).' }),
    measuredOn: localDateSchema,
    method: z.enum(MEASUREMENT_METHODS),
    protocolVersion: z.int().min(1).meta({
      description:
        'Versión del protocolo del último resultado del jugador: el grupo solo tiene resultados de esa versión (principio 4).',
    }),
    status: z.enum(['ok', 'insufficient_sample']).meta({
      description:
        '`insufficient_sample`: ningún grupo llegó al mínimo de jugadores; no hay percentil.',
    }),
    percentile: z.number().min(0).max(100).nullable().meta({
      description: 'Percentil (0–100) según el sentido de la métrica: más alto es mejor.',
    }),
    sampleSize: z.int().min(0).nullable().meta({
      description:
        'Jugadores del grupo usado; `null` sin percentil: por debajo del mínimo no se dice el tamaño, para que no se pueda deducir el valor de otro jugador.',
    }),
    grouping: percentileGroupingSchema.nullable(),
    seasonFrom: z.int().nullable(),
    seasonTo: z.int().nullable(),
    median: z.number().nullable().meta({ description: 'Mediana del grupo (P50).' }),
    mixedMethods: z.boolean().meta({ description: 'El grupo mezcla métodos de medición.' }),
  })
  .meta({ id: 'PlayerPercentile' });

export type PlayerPercentile = z.output<typeof playerPercentileSchema>;

export const getPlayerPercentiles = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/percentiles',
  summary: 'Percentiles de un jugador en su grupo',
  description:
    'Por cada métrica de test con sentido (más es mejor o menos es mejor), el último valor del jugador hasta `asOf` ubicado en su grupo de comparación con los parámetros del dominio (B-208: posición, línea, categoría y sexo, temporadas acumuladas, mínimo de jugadores, mismo método) y solo con resultados de la misma versión del protocolo. La etapa que autoriza es la del jugador en `asOf`. El grupo se arma con resultados de todo el club, pero de los otros jugadores solo sale el agregado: tamaño, mediana y percentil. `percentile.read` del jugador (el propio jugador, solo desde M15).',
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  query: z.strictObject({
    asOf: localDateSchema.optional().meta({
      description:
        'Día de referencia; por defecto, hoy en la zona del club. Nunca después de hoy, y solo el staff elige otro día: para el jugador es siempre hoy (ADR 0060).',
    }),
  }),
  response: {
    status: 200,
    description: 'Los percentiles del jugador.',
    schema: z
      .object({
        playerId: playerIdSchema,
        asOf: localDateSchema,
        minSampleSize: z.int().min(1),
        items: z.array(playerPercentileSchema),
      })
      .meta({ id: 'PlayerPercentiles' }),
  },
  errors: ['not_found'],
});

// ─── Evolution by test window ────────────────────────────────────────────────────────

export const testEvolutionColumnSchema = z
  .object({
    key: z.string().min(1).meta({
      description:
        'Ventana (`w:<id>`) o, fuera de toda ventana, el día del resultado (`d:<fecha>`).',
    }),
    testWindowId: testWindowIdSchema.nullable(),
    seasonName: z.string().nullable(),
    number: z.int().min(1).max(4).nullable().meta({ description: 'V1 a V4.' }),
    startsOn: localDateSchema,
    endsOn: localDateSchema,
  })
  .meta({ id: 'TestEvolutionColumn' });

export const testEvolutionPointSchema = z
  .object({
    columnKey: z.string().min(1),
    value: z.number().meta({
      description:
        'Valor del jugador en la ventana: el mejor según el sentido (o el último, en métricas neutras).',
    }),
    measuredOn: localDateSchema.meta({ description: 'Último día con resultado en la ventana.' }),
    methods: z.array(z.enum(MEASUREMENT_METHODS)),
    categoryAverage: z
      .number()
      .nullable()
      .meta({
        description: `Promedio de su categoría (misma franja de edad, sexo y versión del protocolo) en la ventana, un valor por jugador; \`null\` con menos de ${String(CATEGORY_AVERAGE_MIN_PLAYERS)} jugadores o mientras la ventana (o el día) no terminó.`,
      }),
    categorySize: z
      .int()
      .min(CATEGORY_AVERAGE_MIN_PLAYERS)
      .nullable()
      .meta({
        description: `Jugadores de su categoría en la ventana; \`null\` por debajo del mínimo (${String(CATEGORY_AVERAGE_MIN_PLAYERS)}), para no decir cuántos hay.`,
      }),
    categoryMixedMethods: z.boolean().meta({
      description: 'El promedio mezcla métodos o usa otro que el del jugador.',
    }),
    categoryMixedProtocolVersions: z.boolean().meta({
      description:
        'Los valores del jugador en la columna mezclan versiones del protocolo y el promedio usa solo la de su último resultado (principio 4).',
    }),
  })
  .meta({ id: 'TestEvolutionPoint' });

export const testEvolutionMetricSchema = z
  .object({
    metricCode: metricCodeSchema,
    testCode: testCodeSchema,
    exercise: exerciseCodeSchema.nullable().meta({
      description:
        'Ejercicio de fuerza (`null` en los demás tests): cada ejercicio es una comparación aparte.',
    }),
    unit: unitSchema,
    direction: directionSchema,
    points: z.array(testEvolutionPointSchema).meta({ description: 'En el orden de las columnas.' }),
    warnings: z.array(z.enum(TEST_COMPARISON_WARNINGS)).meta({
      description:
        'Sobre la serie del jugador: `mixed_methods` o `mixed_protocol_versions` (principio 4). La UI los muestra junto al gráfico.',
    }),
  })
  .meta({ id: 'TestEvolutionMetric' });

export type TestEvolutionColumn = z.output<typeof testEvolutionColumnSchema>;
export type TestEvolutionMetric = z.output<typeof testEvolutionMetricSchema>;

export const getPlayerTestEvolution = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/test-evolution',
  summary: 'Evolución de los tests de un jugador por ventana',
  description: `Cada métrica de test del jugador (salvo antropometría, que es la maduración) en cada ventana V1–V4 de las temporadas de su deporte (la del día de test o la que cubre la fecha; fuera de ventana, por día), con el promedio de su categoría en esa ventana (mínimo ${String(CATEGORY_AVERAGE_MIN_PLAYERS)} jugadores, solo cuando la ventana o el día ya terminaron). Entre \`from\` y \`to\` (incluidos) se eligen los valores del jugador; por defecto toda la historia hasta hoy. El promedio de cada columna usa siempre la ventana entera (o el día entero fuera de ventana), sin importar \`from\` y \`to\`, para que dos rangos no se puedan restar en el valor de un compañero (ADR 0060). \`test_result.read\` y \`group_reference.read\` del jugador.`,
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  query: z.strictObject({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  }),
  response: {
    status: 200,
    description: 'La evolución del jugador.',
    schema: z
      .object({
        playerId: playerIdSchema,
        columns: z.array(testEvolutionColumnSchema).meta({ description: 'Por fecha.' }),
        metrics: z.array(testEvolutionMetricSchema),
      })
      .meta({ id: 'PlayerTestEvolution' }),
  },
  errors: ['bad_request', 'not_found'],
});
