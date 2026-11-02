import {
  SEASON_ROLLOVER_DECISIONS,
  SEASON_ROLLOVER_OUTCOMES,
  SEASON_ROLLOVER_PROPOSALS,
  SEASON_ROLLOVER_STATUSES,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sexSchema,
  sortQuerySchema,
  sportSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, playerIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { seasonIdSchema } from './calendar.js';
import { playerCategoryMembershipIdSchema, playerNameSchema } from './players.js';

/**
 * Season change (B-316, ADR 0049): at the start of a season the
 * administration asks for the proposal of moving every player of the
 * season's sport to the category of their birth year, reviews it player by
 * player and applies it once. Applying closes the previous memberships on
 * the effective day and opens the new ones, with the season: the history
 * stays in `player_category`. Only the administration (`season.manage`,
 * `category.manage`): it is the roster of a whole sport, with birth dates.
 */

export const seasonRolloverIdSchema = idOf('cambio de temporada');
export const seasonRolloverItemIdSchema = idOf('jugador/a de un cambio de temporada');

export const seasonRolloverStatusSchema = z.enum(SEASON_ROLLOVER_STATUSES).meta({
  id: 'SeasonRolloverStatus',
  description:
    '`draft` (en revisión), `applied` (aplicado: las categorías ya cambiaron) o `cancelled` (descartado sin aplicar).',
});

export const seasonRolloverProposalSchema = z.enum(SEASON_ROLLOVER_PROPOSALS).meta({
  id: 'SeasonRolloverProposal',
  description:
    'Por qué se propone lo que se propone: `birth_year` (pasa a la categoría de su año de nacimiento), `already_there` (ya está en ella), `ambiguous` (la rama tiene más de una categoría activa para su franja), `no_category` (la rama no tiene categoría activa para su franja), `aged_out` (mayor que toda franja de juveniles) o `too_young` (menor que toda franja).',
});

export const seasonRolloverDecisionSchema = z.enum(SEASON_ROLLOVER_DECISIONS).meta({
  id: 'SeasonRolloverDecision',
  description: '`move` (pasa a `targetCategoryId`) o `stay` (sus categorías no cambian).',
});

export const seasonRolloverOutcomeSchema = z.enum(SEASON_ROLLOVER_OUTCOMES).meta({
  id: 'SeasonRolloverOutcome',
  description:
    'Qué hizo la aplicación: `moved` (pasó de categoría), `stayed` (sin cambios), `skipped_left` (se dio de baja antes), `skipped_later_membership` (ya tenía un pase desde ese día o después: se corrige a mano) o `skipped_category_unavailable` (la categoría destino se archivó o ya no es de su rama).',
});

const outcomeCountsSchema = z
  .object(
    Object.fromEntries(
      SEASON_ROLLOVER_OUTCOMES.map((outcome) => [outcome, z.number().int().nonnegative()]),
    ) as Record<(typeof SEASON_ROLLOVER_OUTCOMES)[number], z.ZodNumber>,
  )
  .meta({ id: 'SeasonRolloverOutcomeCounts' });

export const seasonRolloverSchema = z
  .object({
    id: seasonRolloverIdSchema,
    seasonId: seasonIdSchema,
    sport: sportSchema,
    effectiveOn: localDateSchema.meta({
      description:
        'Día del pase: las categorías nuevas empiezan ese día y las anteriores terminan ese día (exclusivo).',
    }),
    seasonYear: z.number().int().meta({
      description:
        'Año que decide las categorías (`año − año de nacimiento`): el del inicio de la temporada.',
    }),
    status: seasonRolloverStatusSchema,
    counts: z
      .object({
        players: z.number().int().nonnegative(),
        moving: z.number().int().nonnegative().meta({ description: 'Con decisión `move`.' }),
        staying: z.number().int().nonnegative().meta({ description: 'Con decisión `stay`.' }),
        pendingReview: z.number().int().nonnegative().meta({
          description: 'Piden revisión y todavía no se revisaron: mientras haya, no se aplica.',
        }),
        outcomes: outcomeCountsSchema.nullable().meta({
          description: 'Resultado de la aplicación; `null` si no se aplicó.',
        }),
      })
      .meta({ id: 'SeasonRolloverCounts' }),
    appliedAt: dateTimeSchema.nullable(),
    cancelledAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema.meta({
      description:
        'Versión de la propuesta: cambia con cada revisión de un jugador. `apply` la exige, así se aplica lo que se revisó.',
    }),
  })
  .meta({ id: 'SeasonRollover' });

export const seasonRolloverItemSchema = z
  .object({
    id: seasonRolloverItemIdSchema,
    rolloverId: seasonRolloverIdSchema,
    player: z
      .object({
        id: playerIdSchema,
        firstName: playerNameSchema,
        lastName: playerNameSchema,
        birthDate: localDateSchema,
        sex: sexSchema,
      })
      .meta({ id: 'SeasonRolloverPlayer' }),
    previousCategoryIds: z.array(categoryIdSchema).meta({
      description: 'Categorías vigentes el día anterior al pase.',
    }),
    ageInSeasonYear: z
      .number()
      .int()
      .meta({ description: 'Año de la temporada − año de nacimiento.' }),
    ageBandCode: z
      .string()
      .nullable()
      .meta({ description: 'Franja de esa edad (`m15`); `null` fuera de toda franja.' }),
    proposal: seasonRolloverProposalSchema,
    proposedCategoryId: categoryIdSchema.nullable(),
    needsReview: z.boolean().meta({
      description:
        'La propuesta no es automática, juega en más de una categoría o el pase lo bajaría de franja: hay que revisarlo antes de aplicar.',
    }),
    decision: seasonRolloverDecisionSchema,
    targetCategoryId: categoryIdSchema.nullable().meta({
      description: 'Categoría a la que pasa (`decision = move`).',
    }),
    reviewedAt: dateTimeSchema.nullable(),
    outcome: seasonRolloverOutcomeSchema.nullable(),
    membershipId: playerCategoryMembershipIdSchema.nullable().meta({
      description: 'Pertenencia que abrió la aplicación (`outcome = moved`).',
    }),
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'SeasonRolloverItem' });

export type SeasonRollover = z.output<typeof seasonRolloverSchema>;
export type SeasonRolloverItem = z.output<typeof seasonRolloverItemSchema>;

const rolloverParams = z.strictObject({ rolloverId: seasonRolloverIdSchema });
const ADMINISTRATION =
  'Solo la administración: es el plantel del deporte, con fechas de nacimiento.';

export const createSeasonRollover = defineEndpoint({
  method: 'POST',
  path: '/v1/seasons/{seasonId}/rollovers',
  summary: 'Proponer el cambio de temporada',
  description: `${ADMINISTRATION} Calcula, para cada jugador activo del deporte de la temporada dado de alta hasta \`effectiveOn\`, la categoría de su año de nacimiento en su rama, y deja la propuesta en revisión. La temporada tiene que estar activa y contener el día. Ya hay una propuesta en revisión de la temporada: \`conflict\`. Idempotente por \`clientUuid\`.`,
  tags: ['players'],
  auth: 'club',
  params: z.strictObject({ seasonId: seasonIdSchema }),
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    effectiveOn: localDateSchema.optional().meta({
      description: 'Día del pase, dentro de la temporada. Por defecto, su primer día.',
    }),
  }),
  response: { status: 201, description: 'Propuesta en revisión.', schema: seasonRolloverSchema },
  errors: ['not_found', 'conflict'],
});

export const listSeasonRollovers = defineEndpoint({
  method: 'GET',
  path: '/v1/seasons/{seasonId}/rollovers',
  summary: 'Cambios de temporada de una temporada',
  description: ADMINISTRATION,
  tags: ['players'],
  auth: 'club',
  params: z.strictObject({ seasonId: seasonIdSchema }),
  query: pageQuerySchema.extend({
    status: seasonRolloverStatusSchema.optional(),
    sort: sortQuerySchema(['createdAt'], '-createdAt'),
  }),
  response: {
    status: 200,
    description: 'Página de cambios de temporada.',
    schema: pageOf(seasonRolloverSchema).meta({ id: 'SeasonRolloverPage' }),
  },
  errors: ['not_found', 'bad_request'],
});

export const getSeasonRollover = defineEndpoint({
  method: 'GET',
  path: '/v1/season-rollovers/{rolloverId}',
  summary: 'Un cambio de temporada',
  description: `${ADMINISTRATION} Con los contadores de la revisión y, si se aplicó, de su resultado.`,
  tags: ['players'],
  auth: 'club',
  params: rolloverParams,
  response: { status: 200, description: 'El cambio de temporada.', schema: seasonRolloverSchema },
  errors: ['not_found'],
});

export const listSeasonRolloverItems = defineEndpoint({
  method: 'GET',
  path: '/v1/season-rollovers/{rolloverId}/items',
  summary: 'Jugadores de un cambio de temporada',
  description: `${ADMINISTRATION} Lo que propone para cada jugador, lo que se decidió y, si se aplicó, qué pasó.`,
  tags: ['players'],
  auth: 'club',
  params: rolloverParams,
  query: pageQuerySchema.extend({
    proposal: seasonRolloverProposalSchema.optional(),
    decision: seasonRolloverDecisionSchema.optional(),
    outcome: seasonRolloverOutcomeSchema.optional(),
    needsReview: z
      .enum(['true', 'false'])
      .optional()
      .meta({ description: 'Solo los que piden revisión (`true`) o los que no (`false`).' }),
    reviewed: z
      .enum(['true', 'false'])
      .optional()
      .meta({ description: 'Solo los ya revisados (`true`) o los que no (`false`).' }),
    targetCategoryId: categoryIdSchema.optional().meta({
      description: 'Solo los que pasan a esta categoría.',
    }),
    sort: sortQuerySchema(['name', 'birthDate'], 'name'),
  }),
  response: {
    status: 200,
    description: 'Página de jugadores del cambio.',
    schema: pageOf(seasonRolloverItemSchema).meta({ id: 'SeasonRolloverItemPage' }),
  },
  errors: ['not_found', 'bad_request'],
});

export const updateSeasonRolloverItem = defineEndpoint({
  method: 'PATCH',
  path: '/v1/season-rollovers/{rolloverId}/items/{itemId}',
  summary: 'Revisar un jugador del cambio de temporada',
  description: `${ADMINISTRATION} Decide si pasa a una categoría (\`move\`, activa y de la rama del jugador) o si sus categorías no cambian (\`stay\`); el jugador queda revisado, también si se confirma la propuesta. Solo mientras el cambio está en revisión (\`conflict\`). \`version\` desactualizada: \`conflict\`.`,
  tags: ['players'],
  auth: 'club',
  params: z.strictObject({
    rolloverId: seasonRolloverIdSchema,
    itemId: seasonRolloverItemIdSchema,
  }),
  body: z
    .strictObject({
      version: expectedVersionSchema,
      decision: seasonRolloverDecisionSchema,
      targetCategoryId: categoryIdSchema.optional().meta({
        description: 'Obligatoria con `move`; no va con `stay`.',
      }),
    })
    .refine((body) => (body.decision === 'move') === (body.targetCategoryId !== undefined), {
      message: '`move` needs targetCategoryId and `stay` takes none',
      path: ['targetCategoryId'],
    }),
  response: {
    status: 200,
    description: 'El jugador revisado.',
    schema: seasonRolloverItemSchema,
  },
  errors: ['not_found', 'conflict'],
});

export const applySeasonRollover = defineEndpoint({
  method: 'POST',
  path: '/v1/season-rollovers/{rolloverId}/apply',
  summary: 'Aplicar el cambio de temporada',
  description: `${ADMINISTRATION} Exige la \`version\` de la propuesta (cada revisión la cambia) y que no queden jugadores que piden revisión sin revisar (\`conflict\`). En una sola transacción: a cada jugador con \`move\` le cierra las categorías vigentes en \`effectiveOn\` y le abre la nueva desde ese día, con la temporada. Cada jugador se decide con su estado de ese momento: dado de baja, con un pase desde ese día o después, o con la categoría archivada, queda salteado con su motivo. Idempotente: un cambio ya aplicado se devuelve como está. Cancelado: \`conflict\`.`,
  tags: ['players'],
  auth: 'club',
  params: rolloverParams,
  body: z.strictObject({ version: expectedVersionSchema }),
  response: { status: 200, description: 'El cambio aplicado.', schema: seasonRolloverSchema },
  errors: ['not_found', 'conflict'],
});

export const cancelSeasonRollover = defineEndpoint({
  method: 'POST',
  path: '/v1/season-rollovers/{rolloverId}/cancel',
  summary: 'Descartar el cambio de temporada',
  description: `${ADMINISTRATION} Descarta una propuesta en revisión sin tocar ninguna categoría; queda como registro y se puede pedir otra. Idempotente. Ya aplicado: \`conflict\`.`,
  tags: ['players'],
  auth: 'club',
  params: rolloverParams,
  response: { status: 200, description: 'El cambio descartado.', schema: seasonRolloverSchema },
  errors: ['not_found', 'conflict'],
});
