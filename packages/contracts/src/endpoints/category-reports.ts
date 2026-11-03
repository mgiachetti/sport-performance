import {
  CATEGORY_REPORT_EVOLUTION_COLUMNS,
  CATEGORY_REPORT_FORMAT_VERSION,
  CATEGORY_REPORT_MIN_PLAYERS,
  MEASUREMENT_METHODS,
  PLAYER_REPORT_FAILURE_CODES,
  UNIT_CODES,
  type UnitCode,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { hexColorSchema } from '../primitives/color.js';
import {
  clientUuidSchema,
  sexSchema,
  sortQuerySchema,
  sportSchema,
  stageSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { testWindowIdSchema } from './calendar.js';
import { fileIdSchema } from './clubs.js';
import { playerReportStatusSchema } from './player-reports.js';
import { referenceScopeSchema } from './reference-values.js';
import { exerciseCodeSchema, metricCodeSchema, testCodeSchema } from './tests.js';

/**
 * The PDF report of a category for a test window (B-603, ADR 0073), for the
 * staff and the club's sub-committee: the group's evolution, the battery
 * done and the response rate of wellness and RPE. The staff asks for it; the
 * API freezes what it shows into a versioned snapshot (`content`) with
 * aggregates only, and the worker renders it into a `category_report` file
 * that is downloaded like any other file (`GET /v1/files/{id}/download`).
 */

export const categoryReportIdSchema = idOf('informe de la categoría');

const UNIT_VALUES = UNIT_CODES as [UnitCode, ...UnitCode[]];
const unitSchema = z.enum(UNIT_VALUES);
const directionSchema = z.enum(['higher_is_better', 'lower_is_better', 'neutral']);
const countSchema = z.int().min(0);
/** A count of players that is only told from the minimum on. */
const groupSizeSchema = z.int().min(CATEGORY_REPORT_MIN_PLAYERS).nullable();

// ─── The snapshot ────────────────────────────────────────────────────────────────────

/** Expected and answered questionnaires. */
export const categoryReportResponseCountSchema = z.object({
  expected: countSchema,
  answered: countSchema,
});

/** One test of the battery of the window: how many had to do it and what happened. */
export const categoryReportBatteryTestSchema = z
  .object({
    testCode: testCodeSchema,
    expected: countSchema.meta({
      description: 'Jugadores del plantel a los que la batería les programa el test en la ventana.',
    }),
    done: countSchema,
    notDone: z
      .object({
        absent: countSchema,
        unavailable: countSchema.meta({
          description: 'No disponible: una lesión nunca se nombra (ADR 0029).',
        }),
        notApplicableToStage: countSchema,
        other: countSchema,
      })
      .meta({ description: 'Sin hacerlo, por motivo (el último registro de cada jugador).' }),
    noRecord: countSchema.meta({ description: 'Sin ningún registro del test en la ventana.' }),
  })
  .meta({ id: 'CategoryReportBatteryTest' });

/** A window of the group's evolution. */
export const categoryReportColumnSchema = z
  .object({
    key: z.string().min(1),
    testWindowId: testWindowIdSchema,
    seasonName: z.string().min(1),
    number: z.int().min(1).max(4),
    startsOn: localDateSchema,
    endsOn: localDateSchema,
  })
  .meta({ id: 'CategoryReportColumn' });

/** The group in one window of one metric. */
export const categoryReportPointSchema = z
  .object({
    columnKey: z.string().min(1),
    average: z
      .number()
      .nullable()
      .meta({
        description: `Promedio del plantel, un valor por jugador (el mejor según el sentido); \`null\` con menos de ${String(CATEGORY_REPORT_MIN_PLAYERS)} jugadores.`,
      }),
    players: groupSizeSchema.meta({
      description: `Jugadores con resultado; \`null\` por debajo del mínimo (${String(CATEGORY_REPORT_MIN_PLAYERS)}).`,
    }),
    methods: z.array(z.enum(MEASUREMENT_METHODS)).meta({
      description: 'Métodos de los resultados de la columna (principio 4).',
    }),
    protocolVersions: z.array(z.int().min(1)),
  })
  .meta({ id: 'CategoryReportPoint' });

export const categoryReportMetricSchema = z
  .object({
    testCode: testCodeSchema,
    metricCode: metricCodeSchema,
    exercise: exerciseCodeSchema.nullable(),
    unit: unitSchema,
    direction: directionSchema,
    points: z.array(categoryReportPointSchema),
    change: z
      .object({
        fromColumnKey: z.string().min(1),
        paired: z.int().min(CATEGORY_REPORT_MIN_PLAYERS),
        improved: countSchema,
        worsened: countSchema,
        unchanged: countSchema,
      })
      .nullable()
      .meta({
        description: `Contra la ventana anterior con resultados: cuántos jugadores mejoraron, empeoraron o quedaron igual, solo con la misma versión del protocolo; \`null\` con menos de ${String(CATEGORY_REPORT_MIN_PLAYERS)} pares o sin ventana de la que venir.`,
      }),
    firstTeam: z
      .object({ value: z.number(), unit: unitSchema, scope: referenceScopeSchema })
      .nullable()
      .meta({ description: 'Referencia de primera del plantel para el deporte y el sexo.' }),
  })
  .meta({ id: 'CategoryReportMetric' });

export const categoryReportContentSchema = z
  .object({
    formatVersion: z.literal(CATEGORY_REPORT_FORMAT_VERSION),
    locale: z.string().min(2),
    timeZone: z.string().min(1),
    generatedOn: localDateSchema.meta({ description: 'Día del club en que se pidió.' }),
    club: z.object({
      name: z.string().min(1),
      shortName: z.string().nullable(),
      primaryColor: hexColorSchema,
      secondaryColor: hexColorSchema,
      logoFileId: fileIdSchema.nullable(),
    }),
    category: z.object({
      id: categoryIdSchema,
      name: z.string().min(1),
      sport: sportSchema,
      sex: sexSchema,
      ageBandCode: z.string().min(1),
    }),
    window: z.object({
      id: testWindowIdSchema,
      seasonName: z.string().min(1),
      number: z.int().min(1).max(4),
      startsOn: localDateSchema,
      endsOn: localDateSchema,
      closed: z.boolean().meta({ description: 'La ventana ya había terminado al pedirlo.' }),
    }),
    roster: z.object({
      players: countSchema.meta({
        description: 'Jugadores de la categoría al cierre de la ventana (o hoy, si no terminó).',
      }),
      byStage: z.array(z.object({ stage: stageSchema, players: countSchema })),
    }),
    battery: z.array(categoryReportBatteryTestSchema),
    evolution: z.object({
      columns: z.array(categoryReportColumnSchema).max(CATEGORY_REPORT_EVOLUTION_COLUMNS),
      metrics: z.array(categoryReportMetricSchema),
    }),
    responses: z.object({
      from: localDateSchema,
      to: localDateSchema,
      sessionDays: countSchema.meta({ description: 'Días con sesión de la categoría.' }),
      wellness: categoryReportResponseCountSchema,
      rpe: categoryReportResponseCountSchema,
      weeks: z.array(
        z.object({
          weekStart: localDateSchema,
          wellness: categoryReportResponseCountSchema,
          rpe: categoryReportResponseCountSchema,
        }),
      ),
    }),
  })
  .meta({
    id: 'CategoryReportContent',
    description:
      'Lo que muestra el informe, congelado al pedirlo. Solo agregados del grupo con mínimo: nunca nombres, ids ni valores de un jugador, rankings ni datos de salud.',
  });

export type CategoryReportContent = z.output<typeof categoryReportContentSchema>;
export type CategoryReportBatteryTest = z.output<typeof categoryReportBatteryTestSchema>;
export type CategoryReportColumn = z.output<typeof categoryReportColumnSchema>;
export type CategoryReportMetric = z.output<typeof categoryReportMetricSchema>;
export type CategoryReportResponseCount = z.output<typeof categoryReportResponseCountSchema>;

// ─── The report ──────────────────────────────────────────────────────────────────────

export const categoryReportSchema = z
  .object({
    id: categoryReportIdSchema,
    categoryId: categoryIdSchema,
    testWindowId: testWindowIdSchema,
    window: z.object({
      seasonName: z.string(),
      number: z.int().min(1).max(4),
      startsOn: localDateSchema,
      endsOn: localDateSchema,
    }),
    status: playerReportStatusSchema,
    fileId: fileIdSchema.nullable().meta({
      description:
        'El PDF (`GET /v1/files/{id}/download`). `null` mientras no está listo o una vez vencida su retención.',
    }),
    failureCode: z.enum(PLAYER_REPORT_FAILURE_CODES).nullable(),
    requestedBy: userIdSchema.nullable(),
    createdAt: dateTimeSchema,
    generatedAt: dateTimeSchema.nullable(),
  })
  .meta({ id: 'CategoryReport' });

export type CategoryReport = z.output<typeof categoryReportSchema>;

const categoryParams = z.strictObject({ categoryId: categoryIdSchema });

export const requestCategoryReport = defineEndpoint({
  method: 'POST',
  path: '/v1/categories/{categoryId}/reports',
  summary: 'Pedir el informe PDF de una categoría para una ventana',
  description: `El preparador físico asignado y la administración (\`category_report.generate\`). La ventana es de una temporada del deporte de la categoría y ya empezó; la categoría no está archivada. Congela lo que muestra el informe (evolución del plantel, cumplimiento de la batería y tasa de respuesta de bienestar y RPE), solo con agregados de al menos ${String(CATEGORY_REPORT_MIN_PLAYERS)} jugadores, y lo deja \`pending\`: el worker genera el PDF en segundos. Idempotente por \`clientUuid\`. Pedirlo otra vez genera un informe nuevo con los datos de ese momento.`,
  tags: ['reports'],
  auth: 'club',
  params: categoryParams,
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    testWindowId: testWindowIdSchema,
  }),
  response: { status: 202, description: 'Informe pedido.', schema: categoryReportSchema },
  errors: ['bad_request', 'not_found', 'conflict'],
});

export const listCategoryReports = defineEndpoint({
  method: 'GET',
  path: '/v1/categories/{categoryId}/reports',
  summary: 'Informes de una categoría',
  description:
    'El staff asignado a la categoría y la administración (`category_report.read`). Los más nuevos primero.',
  tags: ['reports'],
  auth: 'club',
  params: categoryParams,
  query: pageQuerySchema.extend({
    testWindowId: testWindowIdSchema.optional(),
    sort: sortQuerySchema(['createdAt'], '-createdAt'),
  }),
  response: {
    status: 200,
    description: 'Página de informes.',
    schema: pageOf(categoryReportSchema).meta({ id: 'CategoryReportPage' }),
  },
  errors: ['bad_request', 'not_found'],
});

export const getCategoryReport = defineEndpoint({
  method: 'GET',
  path: '/v1/category-reports/{reportId}',
  summary: 'Un informe de una categoría',
  description: 'Mismo alcance que la lista; sirve para esperar a que esté listo.',
  tags: ['reports'],
  auth: 'club',
  params: z.strictObject({ reportId: categoryReportIdSchema }),
  response: { status: 200, description: 'El informe.', schema: categoryReportSchema },
  errors: ['not_found'],
});
