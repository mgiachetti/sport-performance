import {
  FIXTURE_STATUSES,
  FIXTURE_VENUES,
  LOCAL_TIME_PATTERN,
  SEASON_MAX_DAYS,
  TEST_SESSION_STATUSES,
  TEST_WINDOW_NUMBERS,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  archivedAtSchema,
  archiveStatusQuerySchema,
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
  sportSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { changeReasonSchema } from './change-history.js';

/**
 * The club's calendar (B-317): seasons per sport with their testing windows
 * V1–V4, scheduled test days of a category and the fixture (matches), plus
 * the calendar of a category over a date range. Every date is a day of the
 * club's time zone (`YYYY-MM-DD`); spans include both ends.
 */

export const seasonIdSchema = idOf('temporada');
export const testWindowIdSchema = idOf('ventana de tests');
export const testSessionIdSchema = idOf('día de test');
export const fixtureIdSchema = idOf('partido');

function isTrimmed(value: string): boolean {
  return value === value.trim();
}

function trimmedText(max: number) {
  return z
    .string()
    .min(1)
    .max(max)
    .refine(isTrimmed, { message: 'No leading or trailing whitespace' });
}

export const SEASON_NAME_MAX_LENGTH = 60;
export const CALENDAR_TEXT_MAX_LENGTH = 120;
export const CALENDAR_NOTES_MAX_LENGTH = 2000;
/** Longest range of the calendar of a category, both ends included. */
export const CALENDAR_RANGE_MAX_DAYS = SEASON_MAX_DAYS;

export const seasonNameSchema = trimmedText(SEASON_NAME_MAX_LENGTH).meta({
  description: 'Nombre de la temporada.',
  examples: ['2027'],
});

const locationSchema = trimmedText(CALENDAR_TEXT_MAX_LENGTH).meta({
  description: 'Lugar (cancha, sede).',
  examples: ['Cancha 2, sede Munro'],
});

const notesSchema = trimmedText(CALENDAR_NOTES_MAX_LENGTH).meta({ description: 'Notas.' });

export const testWindowNumberSchema = z
  .literal(TEST_WINDOW_NUMBERS)
  .meta({ id: 'TestWindowNumber', description: 'Ventana: 1 = V1 … 4 = V4.' });

export const testSessionStatusSchema = z.enum(TEST_SESSION_STATUSES).meta({
  id: 'TestSessionStatus',
  description:
    '`scheduled` (programado), `in_progress` (en curso), `completed` (cerrado) o `cancelled` (suspendido).',
});

export const fixtureVenueSchema = z.enum(FIXTURE_VENUES).meta({
  id: 'FixtureVenue',
  description: 'Dónde se juega, para el club: `home` (local), `away` (visitante) o `neutral`.',
});

export const fixtureStatusSchema = z.enum(FIXTURE_STATUSES).meta({
  id: 'FixtureStatus',
  description: '`scheduled` (programado), `postponed` (postergado) o `cancelled` (suspendido).',
});

/** Kick-off on the club's wall clock. */
export const localTimeSchema = z
  .string()
  .regex(LOCAL_TIME_PATTERN)
  .meta({
    id: 'LocalTime',
    description: 'Hora `HH:MM` (24 h) en la zona horaria del club.',
    examples: ['15:30'],
  });

// ─── Resources ───────────────────────────────────────────────────────────────────────

export const testWindowSchema = z
  .object({
    id: testWindowIdSchema,
    seasonId: seasonIdSchema,
    number: testWindowNumberSchema,
    label: z.enum(['V1', 'V2', 'V3', 'V4']).meta({ description: 'Cómo la nombra el staff.' }),
    startsOn: localDateSchema,
    endsOn: localDateSchema,
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'TestWindow' });

export const seasonSchema = z
  .object({
    id: seasonIdSchema,
    sport: sportSchema,
    name: seasonNameSchema,
    startsOn: localDateSchema,
    endsOn: localDateSchema,
    testWindows: z.array(testWindowSchema).meta({
      description: 'Sus ventanas por número, también las archivadas (con `archivedAt`).',
    }),
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({
    id: 'Season',
    description:
      'Año de planificación de un deporte (por ejemplo, de febrero a noviembre): contiene sus ventanas V1 a V4. Las temporadas activas de un deporte no se superponen.',
  });

export const testSessionSchema = z
  .object({
    id: testSessionIdSchema,
    sport: sportSchema,
    categoryId: categoryIdSchema
      .nullable()
      .meta({ description: 'Categoría; `null` solo en días importados de un histórico.' }),
    testWindowId: testWindowIdSchema.nullable(),
    scheduledOn: localDateSchema,
    status: testSessionStatusSchema,
    location: locationSchema.nullable(),
    notes: notesSchema.nullable(),
    startedAt: dateTimeSchema.nullable(),
    completedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'TestSession', description: 'Día de test programado de una categoría.' });

export const fixtureSchema = z
  .object({
    id: fixtureIdSchema,
    sport: sportSchema,
    categoryId: categoryIdSchema,
    opponent: trimmedText(CALENDAR_TEXT_MAX_LENGTH).meta({
      description: 'Rival.',
      examples: ['Club Atlético San Isidro'],
    }),
    venue: fixtureVenueSchema,
    competition: trimmedText(CALENDAR_TEXT_MAX_LENGTH)
      .nullable()
      .meta({ description: 'Torneo o competencia.', examples: ['Torneo URBA M15'] }),
    date: localDateSchema.meta({ description: 'Día del partido en la zona horaria del club.' }),
    kickoffTime: localTimeSchema.nullable().meta({
      description: 'Hora de inicio en la zona horaria del club; `null` si no está confirmada.',
    }),
    startsAt: dateTimeSchema.nullable().meta({
      description:
        'Inicio como instante (UTC), calculado con la zona horaria actual del club; `null` sin hora.',
    }),
    location: locationSchema.nullable(),
    status: fixtureStatusSchema,
    notes: notesSchema.nullable(),
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'Fixture', description: 'Partido del fixture de una categoría.' });

/** One entry of the calendar of a category. `date`…`endDate` is its span (a day, or a window). */
export const calendarEventSchema = z
  .discriminatedUnion('type', [
    z.object({
      type: z.literal('test_window'),
      date: localDateSchema,
      endDate: localDateSchema,
      season: z.object({ id: seasonIdSchema, name: seasonNameSchema }),
      testWindow: testWindowSchema,
    }),
    z.object({
      type: z.literal('test_session'),
      date: localDateSchema,
      endDate: localDateSchema,
      testSession: testSessionSchema,
    }),
    z.object({
      type: z.literal('fixture'),
      date: localDateSchema,
      endDate: localDateSchema,
      fixture: fixtureSchema,
    }),
  ])
  .meta({
    id: 'CalendarEvent',
    description:
      'Ventana de tests (de una temporada del deporte), día de test o partido. Ordenados por `date`.',
  });

export type TestWindow = z.output<typeof testWindowSchema>;
export type Season = z.output<typeof seasonSchema>;
export type TestSession = z.output<typeof testSessionSchema>;
export type Fixture = z.output<typeof fixtureSchema>;
export type CalendarEvent = z.output<typeof calendarEventSchema>;

// ─── Seasons ─────────────────────────────────────────────────────────────────────────

const seasonParams = z.strictObject({ seasonId: seasonIdSchema });

export const listSeasons = defineEndpoint({
  method: 'GET',
  path: '/v1/seasons',
  summary: 'Temporadas del club',
  description: 'Todo miembro del club. Cada temporada trae sus ventanas.',
  tags: ['calendar'],
  auth: 'club',
  query: pageQuerySchema.extend({
    sport: sportSchema.optional(),
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['startsOn', 'name', 'createdAt'], '-startsOn'),
  }),
  response: {
    status: 200,
    description: 'Página de temporadas.',
    schema: pageOf(seasonSchema).meta({ id: 'SeasonPage' }),
  },
  errors: ['bad_request'],
});

export const getSeason = defineEndpoint({
  method: 'GET',
  path: '/v1/seasons/{seasonId}',
  summary: 'Una temporada',
  description: 'Todo miembro del club. De otro club: `not_found`.',
  tags: ['calendar'],
  auth: 'club',
  params: seasonParams,
  response: { status: 200, description: 'La temporada.', schema: seasonSchema },
  errors: ['not_found'],
});

export const createSeason = defineEndpoint({
  method: 'POST',
  path: '/v1/seasons',
  summary: 'Crear una temporada',
  description: `Solo la administración. El deporte tiene que tener una rama habilitada. Hasta ${String(SEASON_MAX_DAYS)} días. Se superpone con otra temporada activa del deporte, o el nombre se repite en el deporte: \`conflict\`. Idempotente por \`clientUuid\`.`,
  tags: ['calendar'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    sport: sportSchema,
    name: seasonNameSchema,
    startsOn: localDateSchema,
    endsOn: localDateSchema,
  }),
  response: { status: 201, description: 'Temporada creada.', schema: seasonSchema },
  errors: ['conflict'],
});

export const updateSeason = defineEndpoint({
  method: 'PATCH',
  path: '/v1/seasons/{seasonId}',
  summary: 'Editar una temporada',
  description:
    'Solo la administración. El deporte no cambia. Las fechas tienen que seguir conteniendo sus ventanas activas (`validation_failed`). `version` desactualizada, superposición con otra temporada o nombre repetido: `conflict`.',
  tags: ['calendar'],
  auth: 'club',
  params: seasonParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    name: seasonNameSchema.optional(),
    startsOn: localDateSchema.optional(),
    endsOn: localDateSchema.optional(),
  }),
  response: { status: 200, description: 'La temporada actualizada.', schema: seasonSchema },
  errors: ['not_found', 'conflict'],
});

export const archiveSeason = defineEndpoint({
  method: 'POST',
  path: '/v1/seasons/{seasonId}/archive',
  summary: 'Archivar una temporada',
  description:
    'Solo la administración. Sale del plan (sus ventanas y días de test se conservan). Con días de test programados o en curso en sus ventanas: `conflict` (reprogramarlos o suspenderlos antes). Idempotente.',
  tags: ['calendar'],
  auth: 'club',
  params: seasonParams,
  response: { status: 200, description: 'Temporada archivada.', schema: seasonSchema },
  errors: ['not_found', 'conflict'],
});

export const restoreSeason = defineEndpoint({
  method: 'POST',
  path: '/v1/seasons/{seasonId}/restore',
  summary: 'Restaurar una temporada',
  description:
    'Solo la administración. Si se superpone con otra temporada activa del deporte: `conflict`. Idempotente.',
  tags: ['calendar'],
  auth: 'club',
  params: seasonParams,
  response: { status: 200, description: 'Temporada restaurada.', schema: seasonSchema },
  errors: ['not_found', 'conflict'],
});

// ─── Testing windows ─────────────────────────────────────────────────────────────────

const testWindowParams = z.strictObject({ testWindowId: testWindowIdSchema });

export const createTestWindow = defineEndpoint({
  method: 'POST',
  path: '/v1/seasons/{seasonId}/test-windows',
  summary: 'Agregar una ventana de tests',
  description:
    'La administración y el `sc`. Dentro de la temporada (activa), sin superponerse con otra ventana activa y en orden (V2 después de V1): si no, `validation_failed`. Número repetido en la temporada: `conflict`. Idempotente por `clientUuid`.',
  tags: ['calendar'],
  auth: 'club',
  params: seasonParams,
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    number: testWindowNumberSchema,
    startsOn: localDateSchema,
    endsOn: localDateSchema,
  }),
  response: { status: 201, description: 'Ventana creada.', schema: testWindowSchema },
  errors: ['not_found', 'conflict'],
});

export const updateTestWindow = defineEndpoint({
  method: 'PATCH',
  path: '/v1/test-windows/{testWindowId}',
  summary: 'Cambiar las fechas de una ventana',
  description:
    'La administración y el `sc`. Mismas reglas que al crearla; además, sus días de test programados tienen que seguir adentro (`conflict`). El número no cambia. `version` desactualizada: `conflict`.',
  tags: ['calendar'],
  auth: 'club',
  params: testWindowParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    startsOn: localDateSchema.optional(),
    endsOn: localDateSchema.optional(),
  }),
  response: { status: 200, description: 'La ventana actualizada.', schema: testWindowSchema },
  errors: ['not_found', 'conflict'],
});

export const archiveTestWindow = defineEndpoint({
  method: 'POST',
  path: '/v1/test-windows/{testWindowId}/archive',
  summary: 'Archivar una ventana',
  description:
    'La administración y el `sc`. Con días de test programados o en curso en ella: `conflict` (reprogramarlos o suspenderlos antes); los suspendidos y los realizados la siguen nombrando. No se programan días nuevos en ella. Idempotente.',
  tags: ['calendar'],
  auth: 'club',
  params: testWindowParams,
  response: { status: 200, description: 'Ventana archivada.', schema: testWindowSchema },
  errors: ['not_found', 'conflict'],
});

export const restoreTestWindow = defineEndpoint({
  method: 'POST',
  path: '/v1/test-windows/{testWindowId}/restore',
  summary: 'Restaurar una ventana',
  description:
    'La administración y el `sc`. Vuelve si cumple las reglas de las ventanas activas (`validation_failed`); con la temporada archivada: `conflict`. Idempotente.',
  tags: ['calendar'],
  auth: 'club',
  params: testWindowParams,
  response: { status: 200, description: 'Ventana restaurada.', schema: testWindowSchema },
  errors: ['not_found', 'conflict'],
});

// ─── Scheduled test days ─────────────────────────────────────────────────────────────

const testSessionParams = z.strictObject({ testSessionId: testSessionIdSchema });

export const listTestSessions = defineEndpoint({
  method: 'GET',
  path: '/v1/test-sessions',
  summary: 'Días de test',
  description:
    'La administración ve todos; `coach`, `sc` y `medical`, los de sus categorías asignadas (o su deporte). `from` y `to` filtran por día, ambos incluidos.',
  tags: ['calendar'],
  auth: 'club',
  query: pageQuerySchema.extend({
    categoryId: categoryIdSchema.optional(),
    sport: sportSchema.optional(),
    testWindowId: testWindowIdSchema.optional(),
    status: testSessionStatusSchema.optional(),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    sort: sortQuerySchema(['scheduledOn', 'createdAt'], 'scheduledOn'),
  }),
  response: {
    status: 200,
    description: 'Página de días de test.',
    schema: pageOf(testSessionSchema).meta({ id: 'TestSessionPage' }),
  },
  errors: ['bad_request'],
});

export const getTestSession = defineEndpoint({
  method: 'GET',
  path: '/v1/test-sessions/{testSessionId}',
  summary: 'Un día de test',
  description:
    'Mismo alcance que la lista. De otro club: `not_found`; fuera del alcance: `forbidden`.',
  tags: ['calendar'],
  auth: 'club',
  params: testSessionParams,
  response: { status: 200, description: 'El día de test.', schema: testSessionSchema },
  errors: ['not_found'],
});

export const createTestSession = defineEndpoint({
  method: 'POST',
  path: '/v1/test-sessions',
  summary: 'Programar un día de test',
  description:
    'La administración y el `sc` de la categoría. La categoría tiene que estar activa; la ventana (opcional) activa, del mismo deporte y con el día adentro (`validation_failed`). Idempotente por `clientUuid`.',
  tags: ['calendar'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    categoryId: categoryIdSchema,
    scheduledOn: localDateSchema,
    testWindowId: testWindowIdSchema.optional(),
    location: locationSchema.optional(),
    notes: notesSchema.optional(),
  }),
  response: { status: 201, description: 'Día de test programado.', schema: testSessionSchema },
  errors: ['not_found', 'conflict'],
});

export const updateTestSession = defineEndpoint({
  method: 'PATCH',
  path: '/v1/test-sessions/{testSessionId}',
  summary: 'Reprogramar un día de test',
  description:
    'La administración y el `sc` de la categoría, mientras está `scheduled` (si no, `conflict`). Cambiar un dato ya cargado (el día, la ventana, el lugar o las notas) es una corrección y pide `changeReason` (ADR 0030). `version` desactualizada: `conflict`.',
  tags: ['calendar'],
  auth: 'club',
  params: testSessionParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    scheduledOn: localDateSchema.optional(),
    testWindowId: testWindowIdSchema.nullable().optional(),
    location: locationSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
    changeReason: changeReasonSchema.optional(),
  }),
  response: { status: 200, description: 'El día de test actualizado.', schema: testSessionSchema },
  errors: ['not_found', 'conflict'],
});

export const cancelTestSession = defineEndpoint({
  method: 'POST',
  path: '/v1/test-sessions/{testSessionId}/cancel',
  summary: 'Suspender un día de test',
  description:
    'La administración y el `sc` de la categoría. Solo uno programado; uno en curso o cerrado: `conflict`. Idempotente.',
  tags: ['calendar'],
  auth: 'club',
  params: testSessionParams,
  response: { status: 200, description: 'Día de test suspendido.', schema: testSessionSchema },
  errors: ['not_found', 'conflict'],
});

export const restoreTestSession = defineEndpoint({
  method: 'POST',
  path: '/v1/test-sessions/{testSessionId}/restore',
  summary: 'Volver a programar un día suspendido',
  description:
    'La administración y el `sc` de la categoría. Vuelve a `scheduled`. Si tiene ventana, la ventana y su temporada tienen que seguir activas y contener el día; si no: `conflict` (reprogramarlo antes). Idempotente.',
  tags: ['calendar'],
  auth: 'club',
  params: testSessionParams,
  response: { status: 200, description: 'Día de test programado.', schema: testSessionSchema },
  errors: ['not_found', 'conflict'],
});

// ─── Fixture ─────────────────────────────────────────────────────────────────────────

const fixtureParams = z.strictObject({ fixtureId: fixtureIdSchema });

export const listFixtures = defineEndpoint({
  method: 'GET',
  path: '/v1/fixtures',
  summary: 'Partidos del fixture',
  description:
    'La administración ve todos; `coach`, `sc` y `medical`, los de sus categorías asignadas (o su deporte). `from` y `to` filtran por día, ambos incluidos.',
  tags: ['calendar'],
  auth: 'club',
  query: pageQuerySchema.extend({
    categoryId: categoryIdSchema.optional(),
    sport: sportSchema.optional(),
    venue: fixtureVenueSchema.optional(),
    fixtureStatus: fixtureStatusSchema.optional(),
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['date', 'createdAt'], 'date'),
  }),
  response: {
    status: 200,
    description: 'Página de partidos.',
    schema: pageOf(fixtureSchema).meta({ id: 'FixturePage' }),
  },
  errors: ['bad_request'],
});

export const getFixture = defineEndpoint({
  method: 'GET',
  path: '/v1/fixtures/{fixtureId}',
  summary: 'Un partido',
  description:
    'Mismo alcance que la lista. De otro club: `not_found`; fuera del alcance: `forbidden`.',
  tags: ['calendar'],
  auth: 'club',
  params: fixtureParams,
  response: { status: 200, description: 'El partido.', schema: fixtureSchema },
  errors: ['not_found'],
});

export const createFixture = defineEndpoint({
  method: 'POST',
  path: '/v1/fixtures',
  summary: 'Agregar un partido',
  description:
    'La administración y el entrenador de la categoría (activa). Día y hora en la zona horaria del club. Idempotente por `clientUuid`.',
  tags: ['calendar'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    categoryId: categoryIdSchema,
    opponent: fixtureSchema.shape.opponent,
    venue: fixtureVenueSchema,
    competition: fixtureSchema.shape.competition.unwrap().optional(),
    date: localDateSchema,
    kickoffTime: localTimeSchema.optional(),
    location: locationSchema.optional(),
    status: fixtureStatusSchema.default('scheduled'),
    notes: notesSchema.optional(),
  }),
  response: { status: 201, description: 'Partido creado.', schema: fixtureSchema },
  errors: ['not_found', 'conflict'],
});

export const updateFixture = defineEndpoint({
  method: 'PATCH',
  path: '/v1/fixtures/{fixtureId}',
  summary: 'Editar un partido',
  description:
    'La administración y el entrenador de la categoría. La categoría no cambia (se archiva y se crea otro). Postergar o suspender es cambiar `status`. `version` desactualizada: `conflict`.',
  tags: ['calendar'],
  auth: 'club',
  params: fixtureParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    opponent: fixtureSchema.shape.opponent.optional(),
    venue: fixtureVenueSchema.optional(),
    competition: fixtureSchema.shape.competition.optional(),
    date: localDateSchema.optional(),
    kickoffTime: localTimeSchema.nullable().optional(),
    location: locationSchema.nullable().optional(),
    status: fixtureStatusSchema.optional(),
    notes: notesSchema.nullable().optional(),
  }),
  response: { status: 200, description: 'El partido actualizado.', schema: fixtureSchema },
  errors: ['not_found', 'conflict'],
});

export const archiveFixture = defineEndpoint({
  method: 'POST',
  path: '/v1/fixtures/{fixtureId}/archive',
  summary: 'Archivar un partido',
  description:
    'La administración y el entrenador de la categoría. Para un partido cargado por error (uno suspendido se marca con `status`). Idempotente.',
  tags: ['calendar'],
  auth: 'club',
  params: fixtureParams,
  response: { status: 200, description: 'Partido archivado.', schema: fixtureSchema },
  errors: ['not_found'],
});

export const restoreFixture = defineEndpoint({
  method: 'POST',
  path: '/v1/fixtures/{fixtureId}/restore',
  summary: 'Restaurar un partido',
  description:
    'La administración y el entrenador de la categoría. Con la categoría archivada: `conflict`. Idempotente.',
  tags: ['calendar'],
  auth: 'club',
  params: fixtureParams,
  response: { status: 200, description: 'Partido restaurado.', schema: fixtureSchema },
  errors: ['not_found', 'conflict'],
});

// ─── Calendar of a category ──────────────────────────────────────────────────────────

export const getCategoryCalendar = defineEndpoint({
  method: 'GET',
  path: '/v1/calendar',
  summary: 'Calendario de una categoría',
  description: `Ventanas de tests de las temporadas activas del deporte, días de test (también los suspendidos, con su \`status\`) y partidos no archivados de la categoría entre \`from\` y \`to\` (ambos incluidos, hasta ${String(CALENDAR_RANGE_MAX_DAYS)} días), por fecha. Una ventana entra si se cruza con el rango. Mismo alcance que la categoría; cada tipo, si el rol lo puede leer.`,
  tags: ['calendar'],
  auth: 'club',
  query: pageQuerySchema.extend({
    categoryId: categoryIdSchema,
    from: localDateSchema,
    to: localDateSchema,
    sort: sortQuerySchema(['date'], 'date'),
  }),
  response: {
    status: 200,
    description: 'Página del calendario.',
    schema: pageOf(calendarEventSchema).meta({ id: 'CalendarEventPage' }),
  },
  errors: ['bad_request', 'not_found'],
});
