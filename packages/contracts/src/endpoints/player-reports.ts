import {
  MATURITY_OFFSET_EQUATIONS,
  MEASUREMENT_METHODS,
  PLAYER_REPORT_FAILURE_CODES,
  PLAYER_REPORT_FORMAT_VERSION,
  PLAYER_REPORT_STATUSES,
  TEST_COMPARISON_WARNINGS,
  TEST_NOT_DONE_REASONS,
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
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { idOf, playerIdSchema, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { testWindowIdSchema } from './calendar.js';
import { fileIdSchema } from './clubs.js';
import { testEvolutionColumnSchema, testEvolutionMetricSchema } from './player-profile.js';
import { referenceScopeSchema } from './reference-values.js';
import { exerciseCodeSchema, metricCodeSchema, testCodeSchema } from './tests.js';

/**
 * The PDF report of a player for a test window (B-602, ADR 0069), for the
 * player and their family. The staff asks for it; the API freezes what it
 * shows into a versioned snapshot (`content`), read with the rules of the
 * player profile (ADR 0060), and the worker renders it into a `pdf_report`
 * file that is downloaded like any other file (`GET /v1/files/{id}/download`).
 */

export const playerReportIdSchema = idOf('informe del jugador');

const UNIT_VALUES = UNIT_CODES as [UnitCode, ...UnitCode[]];
const unitSchema = z.enum(UNIT_VALUES);
const directionSchema = z.enum(['higher_is_better', 'lower_is_better', 'neutral']);

// ─── The snapshot ────────────────────────────────────────────────────────────────────

/** One metric of a test done in the report's window. */
export const playerReportTestSchema = z
  .object({
    testCode: testCodeSchema,
    metricCode: metricCodeSchema,
    exercise: exerciseCodeSchema.nullable(),
    unit: unitSchema,
    direction: directionSchema,
    value: z.number().meta({
      description: 'Valor del jugador en la ventana: el mejor según el sentido (o el último).',
    }),
    measuredOn: localDateSchema,
    methods: z.array(z.enum(MEASUREMENT_METHODS)),
    previous: z
      .object({
        seasonName: z.string().nullable(),
        number: z.int().min(1).max(4).nullable(),
        startsOn: localDateSchema,
        value: z.number(),
        methods: z.array(z.enum(MEASUREMENT_METHODS)),
      })
      .nullable()
      .meta({ description: 'Su valor en la ventana (o el día) anterior con resultado.' }),
    categoryAverage: z.number().nullable().meta({
      description:
        'Promedio de su categoría en la ventana con las reglas de la ficha (al menos 5 jugadores, ventana terminada); `null` si no.',
    }),
    categoryMixedMethods: z.boolean(),
    categoryMixedProtocolVersions: z.boolean(),
    firstTeam: z
      .object({ value: z.number(), unit: unitSchema, scope: referenceScopeSchema })
      .nullable()
      .meta({ description: 'Referencia de primera de la métrica para su deporte, sexo y puesto.' }),
    warnings: z.array(z.enum(TEST_COMPARISON_WARNINGS)).meta({
      description: 'Sobre su serie hasta la ventana: métodos o versiones del protocolo mezclados.',
    }),
  })
  .meta({ id: 'PlayerReportTest' });

export const playerReportContentSchema = z
  .object({
    formatVersion: z.literal(PLAYER_REPORT_FORMAT_VERSION),
    locale: z.string().min(2),
    timeZone: z.string().min(1),
    generatedOn: localDateSchema.meta({ description: 'Día del club en que se pidió.' }),
    club: z.object({
      name: z.string().min(1),
      shortName: z.string().nullable(),
      primaryColor: hexColorSchema,
      secondaryColor: hexColorSchema,
      logoFileId: fileIdSchema.nullable().meta({
        description: 'Escudo del club al pedirlo; el PDF lo lleva si sigue siendo un PNG listo.',
      }),
    }),
    player: z.object({
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      birthDate: localDateSchema,
      sex: sexSchema,
      sport: sportSchema,
      ageYears: z.number().int().min(0).meta({ description: 'Edad al terminar la ventana.' }),
      categories: z.array(z.string().min(1)).meta({
        description: 'Categorías del jugador al terminar la ventana (o hoy, si no terminó).',
      }),
    }),
    window: z.object({
      id: testWindowIdSchema,
      seasonName: z.string().min(1),
      number: z.int().min(1).max(4),
      startsOn: localDateSchema,
      endsOn: localDateSchema,
      closed: z.boolean().meta({ description: 'La ventana ya había terminado al pedirlo.' }),
    }),
    tests: z.array(playerReportTestSchema),
    notDone: z
      .array(
        z.object({
          testCode: testCodeSchema,
          measuredOn: localDateSchema,
          reason: z.enum([...TEST_NOT_DONE_REASONS, 'unavailable']).meta({
            description: 'Una lesión sale como `unavailable`: nunca la causa (ADR 0029).',
          }),
        }),
      )
      .meta({ description: 'Tests de la ventana que no hizo (sin uno hecho después).' }),
    evolution: z.object({
      columns: z.array(testEvolutionColumnSchema),
      metrics: z.array(testEvolutionMetricSchema),
    }),
    maturation: z
      .object({
        measuredOn: localDateSchema,
        heightCm: z.number().positive().nullable(),
        sittingHeightCm: z.number().positive().nullable(),
        weightKg: z.number().positive().nullable(),
        phvOffsetYears: z.number().nullable(),
        maturityOffsetEquation: z.enum(MATURITY_OFFSET_EQUATIONS).nullable(),
        predictedAdultHeightCm: z.number().positive().nullable(),
        adultHeightPct: z.number().positive().nullable(),
        growthVelocityCmYear: z.number().nullable(),
        inPeakZone: z.boolean().nullable().meta({
          description: 'En zona de pico de crecimiento (`null`: no se puede evaluar).',
        }),
      })
      .nullable()
      .meta({ description: 'Última medición hasta el fin de la ventana.' }),
  })
  .meta({
    id: 'PlayerReportContent',
    description:
      'Lo que muestra el informe, congelado al pedirlo. Solo valores del propio jugador, promedios anónimos con mínimo y referencias de primera: nunca nombres ni valores de otros jugadores, percentiles, rankings ni datos de salud.',
  });

export type PlayerReportContent = z.output<typeof playerReportContentSchema>;
export type PlayerReportTest = z.output<typeof playerReportTestSchema>;

// ─── The report ──────────────────────────────────────────────────────────────────────

export const playerReportStatusSchema = z.enum(PLAYER_REPORT_STATUSES).meta({
  id: 'PlayerReportStatus',
  description:
    '`pending`: lo está generando el worker. `ready`: el PDF está en `fileId`. `failed`: no se pudo generar (pedilo de nuevo).',
});

export const playerReportSchema = z
  .object({
    id: playerReportIdSchema,
    playerId: playerIdSchema,
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
  .meta({ id: 'PlayerReport' });

export type PlayerReport = z.output<typeof playerReportSchema>;

const playerParams = z.strictObject({ playerId: playerIdSchema });

export const requestPlayerReport = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/reports',
  summary: 'Pedir el informe PDF de un jugador para una ventana',
  description:
    'El preparador físico asignado y la administración (`player_report.generate`). La ventana es de una temporada del deporte del jugador y ya empezó. Congela lo que muestra el informe con las reglas de la ficha (el promedio de la categoría solo con la ventana terminada y al menos 5 jugadores) y lo deja `pending`: el worker genera el PDF en segundos. Idempotente por `clientUuid`. Pedirlo otra vez genera un informe nuevo con los datos de ese momento.',
  tags: ['reports'],
  auth: 'club',
  params: playerParams,
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    testWindowId: testWindowIdSchema,
  }),
  response: { status: 202, description: 'Informe pedido.', schema: playerReportSchema },
  errors: ['bad_request', 'not_found', 'conflict'],
});

export const listPlayerReports = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/reports',
  summary: 'Informes de un jugador',
  description:
    'El jugador/a (los suyos), su tutor, el staff asignado y la administración (`player_report.read`). Los más nuevos primero.',
  tags: ['reports'],
  auth: 'club',
  params: playerParams,
  query: pageQuerySchema.extend({
    testWindowId: testWindowIdSchema.optional(),
    sort: sortQuerySchema(['createdAt'], '-createdAt'),
  }),
  response: {
    status: 200,
    description: 'Página de informes.',
    schema: pageOf(playerReportSchema).meta({ id: 'PlayerReportPage' }),
  },
  errors: ['bad_request', 'not_found'],
});

export const getPlayerReport = defineEndpoint({
  method: 'GET',
  path: '/v1/player-reports/{reportId}',
  summary: 'Un informe de un jugador',
  description: 'Mismo alcance que la lista; sirve para esperar a que esté listo.',
  tags: ['reports'],
  auth: 'club',
  params: z.strictObject({ reportId: playerReportIdSchema }),
  response: { status: 200, description: 'El informe.', schema: playerReportSchema },
  errors: ['not_found'],
});
