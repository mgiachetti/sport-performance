import {
  DOMINANT_SIDES,
  HEIGHT_SOURCES,
  PARENTS,
  PLAYER_LEAVE_REASONS,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  archivedAtSchema,
  archiveStatusQuerySchema,
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sexSchema,
  sortQuerySchema,
  sportSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, playerIdSchema, uuidSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { positionIdSchema } from './categories.js';

/**
 * Players and roster (B-315, ADR 0035): the profile (ficha) of each player,
 * their positions, dominant side, sign-up and leave (alta y baja), their
 * category history (`player_category`) and the parents' heights with their
 * origin, for Khamis-Roche (B-203).
 *
 * Who sees what is the permission matrix (ADR 0025): the administration the
 * whole club; `coach`, `sc` and `medical` the players of their assignments;
 * the player their own profile; a guardian the (summarised) profile of the
 * minors in their care. Lists of players are a roster, never a ranking.
 */

export const PLAYER_NAME_MAX_LENGTH = 80;
export const PLAYER_LEAVE_NOTE_MAX_LENGTH = 500;
/** Most positions per player (main one first). */
export const PLAYER_POSITIONS_MAX = 5;
/** Plausible height of an adult parent, in cm: outside it is a typo, not a value. */
export const PARENT_HEIGHT_MIN_CM = 120;
export const PARENT_HEIGHT_MAX_CM = 230;

const trimmed = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' });

export const playerNameSchema = trimmed(PLAYER_NAME_MAX_LENGTH);

export const dominantSideSchema = z.enum(DOMINANT_SIDES).meta({
  id: 'DominantSide',
  description: 'Lado dominante: pie en rugby, mano en hockey.',
});

export const heightSourceSchema = z.enum(HEIGHT_SOURCES).meta({
  id: 'HeightSource',
  description: 'Origen de la altura: `measured` (medida por el staff) o `reported` (informada).',
});

export const parentSchema = z.enum(PARENTS).meta({
  id: 'Parent',
  description: 'Madre o padre biológico (Khamis-Roche usa los dos).',
});

export const playerLeaveReasonSchema = z.enum(PLAYER_LEAVE_REASONS).meta({
  id: 'PlayerLeaveReason',
  description:
    'Motivo de la baja: `graduated` (terminó juveniles o pasó a primera), `transferred` (se fue a otro club), `quit` (dejó) u `other`.',
});

export const playerCategoryMembershipIdSchema = idOf('pertenencia a una categoría');

const positionIdsSchema = z
  .array(positionIdSchema)
  .max(PLAYER_POSITIONS_MAX)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Repeated position' })
  .meta({
    description: `Posiciones del deporte del jugador, la principal primero (hasta ${String(PLAYER_POSITIONS_MAX)}).`,
  });

export const playerSchema = z
  .object({
    id: playerIdSchema,
    firstName: playerNameSchema,
    lastName: playerNameSchema,
    birthDate: localDateSchema,
    sex: sexSchema,
    sport: sportSchema,
    dominantSide: dominantSideSchema.nullable(),
    positionIds: z.array(positionIdSchema).meta({ description: 'La principal primero.' }),
    currentCategoryIds: z.array(categoryIdSchema).meta({
      description: 'Categorías vigentes hoy (día del club).',
    }),
    joinedOn: localDateSchema.meta({ description: 'Día de alta en el club.' }),
    leftOn: localDateSchema.nullable().meta({ description: 'Último día en el club (baja).' }),
    leftReason: playerLeaveReasonSchema.nullable(),
    leftNote: z.string().min(1).max(PLAYER_LEAVE_NOTE_MAX_LENGTH).nullable(),
    hasAccount: z.boolean().meta({ description: 'Si el jugador tiene usuario propio (B-310).' }),
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'Player' });

export const playerCategoryMembershipSchema = z
  .object({
    id: playerCategoryMembershipIdSchema,
    playerId: playerIdSchema,
    categoryId: categoryIdSchema,
    seasonId: uuidSchema
      .nullable()
      .meta({ description: 'Temporada del pase, si la hubo (B-316).' }),
    validFrom: localDateSchema.meta({ description: 'Primer día en la categoría.' }),
    validTo: localDateSchema.nullable().meta({
      description: 'Primer día fuera de la categoría (exclusivo); `null` si sigue.',
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'PlayerCategoryMembership' });

export const parentHeightSchema = z
  .object({
    parent: parentSchema,
    heightCm: z.number().positive(),
    source: heightSourceSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'ParentHeight' });

export const playerParentHeightsSchema = z
  .object({
    mother: parentHeightSchema.nullable(),
    father: parentHeightSchema.nullable(),
  })
  .meta({ id: 'PlayerParentHeights' });

export type Player = z.output<typeof playerSchema>;
export type PlayerCategoryMembership = z.output<typeof playerCategoryMembershipSchema>;
export type ParentHeight = z.output<typeof parentHeightSchema>;
export type PlayerParentHeights = z.output<typeof playerParentHeightsSchema>;

const playerParams = z.strictObject({ playerId: playerIdSchema });

export const listPlayers = defineEndpoint({
  method: 'GET',
  path: '/v1/players',
  summary: 'Plantel',
  description:
    'La administración ve todo el club; `coach`, `sc` y `medical` los jugadores vigentes en sus asignaciones (por categoría o por deporte); el jugador solo su ficha; el tutor la de los menores a su cargo. Un staff sin asignaciones recibe una lista vacía.',
  tags: ['players'],
  auth: 'club',
  query: pageQuerySchema.extend({
    categoryId: categoryIdSchema.optional().meta({
      description: 'Solo los que están hoy en esta categoría.',
    }),
    sport: sportSchema.optional(),
    sex: sexSchema.optional(),
    status: archiveStatusQuerySchema.meta({
      description: '`active` (por defecto: sin baja), `archived` (con baja) o `all`.',
    }),
    q: z.string().min(1).max(120).optional().meta({
      description: 'Texto a buscar en el nombre o el apellido (sin distinguir mayúsculas).',
    }),
    sort: sortQuerySchema(['name', 'birthDate', 'joinedOn', 'createdAt'], 'name'),
  }),
  response: {
    status: 200,
    description: 'Página de jugadores.',
    schema: pageOf(playerSchema).meta({ id: 'PlayerPage' }),
  },
  errors: ['bad_request'],
});

export const getPlayer = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}',
  summary: 'Ficha de un jugador',
  description:
    'Mismo alcance que la lista. Un jugador de otro club o que la RLS no le muestra a quien pregunta (fuera de sus asignaciones): `not_found`; uno visible pero no permitido (el tutor de un jugador mayor de edad): `forbidden`.',
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  response: { status: 200, description: 'La ficha.', schema: playerSchema },
  errors: ['not_found'],
});

export const createPlayer = defineEndpoint({
  method: 'POST',
  path: '/v1/players',
  summary: 'Alta de un jugador',
  description:
    'Solo la administración. La rama (deporte y sexo) tiene que estar habilitada; las posiciones y la categoría inicial, ser del deporte. El alta es hoy (día del club) si no se dice. Idempotente por `clientUuid`.',
  tags: ['players'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    firstName: playerNameSchema,
    lastName: playerNameSchema,
    birthDate: localDateSchema,
    sex: sexSchema,
    sport: sportSchema,
    dominantSide: dominantSideSchema.optional(),
    positionIds: positionIdsSchema.optional(),
    joinedOn: localDateSchema.optional().meta({ description: 'Por defecto, hoy.' }),
    categoryId: categoryIdSchema.optional().meta({
      description: 'Categoría inicial, desde el día de alta.',
    }),
  }),
  response: { status: 201, description: 'Jugador dado de alta.', schema: playerSchema },
  errors: ['conflict'],
});

export const updatePlayer = defineEndpoint({
  method: 'PATCH',
  path: '/v1/players/{playerId}',
  summary: 'Editar la ficha',
  description:
    'La administración, y `coach` y `sc` en sus asignaciones. El deporte no cambia (otro deporte es otro jugador). `positionIds` reemplaza la lista. `version` desactualizada: `conflict`.',
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    firstName: playerNameSchema.optional(),
    lastName: playerNameSchema.optional(),
    birthDate: localDateSchema.optional(),
    sex: sexSchema.optional(),
    dominantSide: dominantSideSchema.nullable().optional(),
    positionIds: positionIdsSchema.optional(),
    joinedOn: localDateSchema.optional(),
  }),
  response: { status: 200, description: 'La ficha actualizada.', schema: playerSchema },
  errors: ['not_found', 'conflict'],
});

export const archivePlayer = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/archive',
  summary: 'Baja de un jugador',
  description:
    'Solo la administración. Registra el último día y el motivo, y cierra sus categorías vigentes al día siguiente. Su historia se conserva. Idempotente: un jugador ya dado de baja se devuelve como está. Una categoría que empieza después de la baja: `conflict`.',
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  body: z.strictObject({
    leftOn: localDateSchema.meta({ description: 'Último día en el club; hoy o antes.' }),
    reason: playerLeaveReasonSchema,
    note: trimmed(PLAYER_LEAVE_NOTE_MAX_LENGTH).optional(),
  }),
  response: { status: 200, description: 'Jugador dado de baja.', schema: playerSchema },
  errors: ['not_found', 'conflict'],
});

export const restorePlayer = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/restore',
  summary: 'Deshacer la baja',
  description:
    'Solo la administración. Vuelve a estar activo con su fecha de alta original; las categorías no se reabren (se asignan con un pase). Idempotente.',
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  response: { status: 200, description: 'Jugador activo.', schema: playerSchema },
  errors: ['not_found'],
});

export const listPlayerCategories = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/categories',
  summary: 'Historia de categorías de un jugador',
  description: 'Mismo alcance que la ficha.',
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  query: pageQuerySchema.extend({
    sort: sortQuerySchema(['validFrom'], '-validFrom'),
  }),
  response: {
    status: 200,
    description: 'Página de pertenencias a categorías.',
    schema: pageOf(playerCategoryMembershipSchema).meta({ id: 'PlayerCategoryMembershipPage' }),
  },
  errors: ['not_found', 'bad_request'],
});

export const addPlayerCategory = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/categories',
  summary: 'Pase a una categoría',
  description:
    'Solo la administración. El jugador entra a la categoría desde `validFrom` y, salvo `keepCurrent`, sale ese día de las que tenía vigentes. La categoría tiene que ser del deporte del jugador y estar activa; el jugador, activo. Superponerse con otra pertenencia a la misma categoría o empezar antes de una vigente: `conflict`. Idempotente por `clientUuid`.',
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    categoryId: categoryIdSchema,
    validFrom: localDateSchema,
    keepCurrent: z
      .boolean()
      .default(false)
      .meta({ description: 'Mantener las categorías vigentes (juega en dos).' }),
  }),
  response: {
    status: 201,
    description: 'Pertenencia creada.',
    schema: playerCategoryMembershipSchema,
  },
  errors: ['not_found', 'conflict'],
});

export const updatePlayerCategory = defineEndpoint({
  method: 'PATCH',
  path: '/v1/players/{playerId}/categories/{membershipId}',
  summary: 'Corregir o cerrar una pertenencia',
  description:
    'Solo la administración. Corrige las fechas o cierra la pertenencia (`validTo`, exclusivo). La categoría no cambia: un error de categoría se cierra y se carga el pase correcto. `version` desactualizada o superposición: `conflict`.',
  tags: ['players'],
  auth: 'club',
  params: z.strictObject({
    playerId: playerIdSchema,
    membershipId: playerCategoryMembershipIdSchema,
  }),
  body: z.strictObject({
    version: expectedVersionSchema,
    validFrom: localDateSchema.optional(),
    validTo: localDateSchema.nullable().optional(),
  }),
  response: {
    status: 200,
    description: 'Pertenencia actualizada.',
    schema: playerCategoryMembershipSchema,
  },
  errors: ['not_found', 'conflict'],
});

export const getPlayerParentHeights = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/parent-heights',
  summary: 'Altura de los padres',
  description:
    'La administración, `sc` en sus asignaciones y el tutor de sus tutelados. Para la talla adulta predicha (Khamis-Roche).',
  tags: ['players'],
  auth: 'club',
  params: playerParams,
  response: {
    status: 200,
    description: 'Altura de la madre y del padre, con su origen.',
    schema: playerParentHeightsSchema,
  },
  errors: ['not_found'],
});

export const setPlayerParentHeight = defineEndpoint({
  method: 'PUT',
  path: '/v1/players/{playerId}/parent-heights/{parent}',
  summary: 'Cargar la altura de un padre',
  description: `Con consentimiento de datos vigente: \`sc\` en sus asignaciones y la administración (medida o informada); el tutor, mientras el jugador es menor, solo informada y sin pisar una medida (\`conflict\`). Para reemplazar una altura cargada hay que mandar su \`version\` (\`conflict\` si falta o cambió). Entre ${String(PARENT_HEIGHT_MIN_CM)} y ${String(PARENT_HEIGHT_MAX_CM)} cm.`,
  tags: ['players'],
  auth: 'club',
  params: z.strictObject({ playerId: playerIdSchema, parent: parentSchema }),
  body: z.strictObject({
    version: expectedVersionSchema.optional().meta({
      description: 'Versión de la altura cargada que se reemplaza; sin altura previa, se omite.',
    }),
    heightCm: z.number().min(PARENT_HEIGHT_MIN_CM).max(PARENT_HEIGHT_MAX_CM),
    source: heightSourceSchema,
  }),
  response: { status: 200, description: 'La altura cargada.', schema: parentHeightSchema },
  errors: ['not_found', 'conflict'],
});
