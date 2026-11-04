import { DEFAULT_AGE_BANDS, POSITION_LINE_CODES, SPORTS } from '@sport-performance/domain';
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
  stageSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { configurationCodeSchema } from './configuration-common.js';

/**
 * Categories of the club (B-313): a branch (sport + sex) and an age band of
 * the domain (M13 to M19), named freely by the club. They do not depend on
 * the season: players move between them (B-316), the category stays.
 * Positions: the seeded catalog of each sport, which the club renames,
 * reorders, extends inside the lines of the sport and archives (B-801, ADR
 * 0087).
 */

export const CATEGORY_NAME_MAX_LENGTH = 60;
export const POSITION_LABEL_MAX_LENGTH = 40;
/** Largest `sort_order` (a `smallint`). */
export const SORT_ORDER_MAX = 32_767;

const AGE_BAND_CODES = DEFAULT_AGE_BANDS.map((band) => band.code) as [
  (typeof DEFAULT_AGE_BANDS)[number]['code'],
  ...(typeof DEFAULT_AGE_BANDS)[number]['code'][],
];

export const ageBandCodeSchema = z.enum(AGE_BAND_CODES).meta({
  id: 'AgeBandCode',
  description: 'Franja de edad del dominio (M13 a M19; no hay M18).',
});

export const categoryNameSchema = z
  .string()
  .min(1)
  .max(CATEGORY_NAME_MAX_LENGTH)
  .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' })
  .meta({ description: 'Nombre que usa el club.', examples: ['M15', 'Menores de 15'] });

const sortOrderSchema = z
  .int()
  .min(0)
  .max(SORT_ORDER_MAX)
  .meta({ description: 'Posición en las listas (ascendente).' });

export const categorySchema = z
  .object({
    id: categoryIdSchema,
    sport: sportSchema,
    sex: sexSchema,
    ageBandCode: ageBandCodeSchema,
    name: categoryNameSchema,
    defaultStage: stageSchema.meta({
      description: 'Etapa de la franja antes de la maduración (B-204).',
    }),
    sortOrder: sortOrderSchema,
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'Category' });

export const positionIdSchema = idOf('posición');

/** Every line of every sport, for the documentation; the API checks the line against the sport. */
const ALL_LINE_CODES = [...new Set(SPORTS.flatMap((sport) => POSITION_LINE_CODES[sport]))] as [
  string,
  ...string[],
];

export const positionLineCodeSchema = z.enum(ALL_LINE_CODES).meta({
  id: 'PositionLineCode',
  description:
    'Línea de la posición, una de las del deporte (rugby: `forwards`, `backs`; hockey: `goalkeepers`, `defenders`, `midfielders`, `forwards`). Agrupa referencias y percentiles.',
});

export const positionLabelSchema = z
  .string()
  .min(1)
  .max(POSITION_LABEL_MAX_LENGTH)
  .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' })
  .meta({ description: 'Texto propio del club.', examples: ['Líbero', 'Volante central'] });

export const positionSchema = z
  .object({
    id: positionIdSchema,
    sport: sportSchema,
    code: z
      .string()
      .min(1)
      .meta({
        description: 'Código estable; el texto sale de i18n o de `label`.',
        examples: ['hooker'],
      }),
    label: positionLabelSchema
      .nullable()
      .meta({ description: 'Texto propio del club, si lo tiene; si no, el del catálogo.' }),
    lineCode: z
      .string()
      .min(1)
      .nullable()
      .meta({
        description: 'Línea para agrupar referencias y percentiles.',
        examples: ['forwards'],
      }),
    sortOrder: sortOrderSchema,
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'Position' });

export type Category = z.output<typeof categorySchema>;
export type Position = z.output<typeof positionSchema>;

const categoryParams = z.strictObject({ categoryId: categoryIdSchema });
const positionParams = z.strictObject({ positionId: positionIdSchema });

export const listCategories = defineEndpoint({
  method: 'GET',
  path: '/v1/categories',
  summary: 'Categorías del club',
  description:
    'La administración ve todas; `coach`, `sc` y `medical` solo las de sus asignaciones (por categoría o por deporte).',
  tags: ['categories'],
  auth: 'club',
  query: pageQuerySchema.extend({
    sport: sportSchema.optional(),
    sex: sexSchema.optional(),
    ageBandCode: ageBandCodeSchema.optional(),
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['sortOrder', 'name', 'createdAt'], 'sortOrder'),
  }),
  response: {
    status: 200,
    description: 'Página de categorías.',
    schema: pageOf(categorySchema).meta({ id: 'CategoryPage' }),
  },
  errors: ['bad_request'],
});

export const getCategory = defineEndpoint({
  method: 'GET',
  path: '/v1/categories/{categoryId}',
  summary: 'Una categoría',
  description:
    'Mismo alcance que la lista. Una categoría de otro club o fuera del alcance: `not_found`.',
  tags: ['categories'],
  auth: 'club',
  params: categoryParams,
  response: { status: 200, description: 'La categoría.', schema: categorySchema },
  errors: ['not_found'],
});

export const createCategory = defineEndpoint({
  method: 'POST',
  path: '/v1/categories',
  summary: 'Crear una categoría',
  description:
    'Solo la administración. La rama tiene que estar habilitada. La etapa por defecto sale de la franja. Idempotente por `clientUuid`; nombre repetido en la rama: `conflict`.',
  tags: ['categories'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    sport: sportSchema,
    sex: sexSchema,
    ageBandCode: ageBandCodeSchema,
    name: categoryNameSchema.optional().meta({
      description:
        'Por defecto, el nombre de la franja en el deporte (`M15` en rugby, `Sub 15` en hockey).',
    }),
    sortOrder: sortOrderSchema.optional().meta({
      description: 'Por defecto, el orden de la franja.',
    }),
  }),
  response: { status: 201, description: 'Categoría creada.', schema: categorySchema },
  errors: ['conflict'],
});

export const updateCategory = defineEndpoint({
  method: 'PATCH',
  path: '/v1/categories/{categoryId}',
  summary: 'Editar una categoría',
  description:
    'Solo la administración. Se cambian el nombre y el orden; la rama y la franja no (la historia tiene que seguir siendo comparable: se crea otra categoría). Una categoría archivada (sola o con su rama) no se edita: se restaura primero (`conflict`). `version` desactualizada o nombre repetido: `conflict`.',
  tags: ['categories'],
  auth: 'club',
  params: categoryParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    name: categoryNameSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
  }),
  response: { status: 200, description: 'La categoría actualizada.', schema: categorySchema },
  errors: ['not_found', 'conflict'],
});

export const archiveCategory = defineEndpoint({
  method: 'POST',
  path: '/v1/categories/{categoryId}/archive',
  summary: 'Archivar una categoría',
  description:
    'Solo la administración. Deja de ofrecerse para nuevas asignaciones; su historia se conserva. Idempotente.',
  tags: ['categories'],
  auth: 'club',
  params: categoryParams,
  response: { status: 200, description: 'Categoría archivada.', schema: categorySchema },
  errors: ['not_found'],
});

export const restoreCategory = defineEndpoint({
  method: 'POST',
  path: '/v1/categories/{categoryId}/restore',
  summary: 'Restaurar una categoría',
  description:
    'Solo la administración. Con la rama archivada no se puede: `conflict`. Idempotente.',
  tags: ['categories'],
  auth: 'club',
  params: categoryParams,
  response: { status: 200, description: 'Categoría restaurada.', schema: categorySchema },
  errors: ['not_found', 'conflict'],
});

export const listPositions = defineEndpoint({
  method: 'GET',
  path: '/v1/positions',
  summary: 'Posiciones por deporte',
  description:
    'Todo miembro del club activo. Catálogo sembrado por deporte (B-306) con lo que el club cambió (B-801). Por defecto solo las activas; para mostrar la posición de una jugadora que ya la tiene archivada, `status=all`.',
  tags: ['categories'],
  auth: 'club',
  query: pageQuerySchema.extend({
    sport: sportSchema.optional(),
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['sortOrder', 'code'], 'sortOrder'),
  }),
  response: {
    status: 200,
    description: 'Página de posiciones.',
    schema: pageOf(positionSchema).meta({ id: 'PositionPage' }),
  },
  errors: ['bad_request'],
});

export const createPosition = defineEndpoint({
  method: 'POST',
  path: '/v1/positions',
  summary: 'Sumar una posición del club',
  description:
    'Solo la administración. Una posición propia dentro de una de las líneas del deporte (por ejemplo "Líbero" en `defenders` de hockey), con su texto. El deporte tiene que ser el de una rama habilitada. Idempotente por `clientUuid`; código repetido en el deporte: `conflict`.',
  tags: ['categories'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    sport: sportSchema,
    code: configurationCodeSchema.meta({
      description: 'Código estable en inglés `snake_case`, único en el deporte.',
      examples: ['sweeper'],
    }),
    label: positionLabelSchema,
    lineCode: positionLineCodeSchema,
    sortOrder: sortOrderSchema.optional().meta({
      description: 'Por defecto, después de las posiciones del deporte.',
    }),
  }),
  response: { status: 201, description: 'Posición creada.', schema: positionSchema },
  errors: ['conflict'],
});

export const updatePosition = defineEndpoint({
  method: 'PATCH',
  path: '/v1/positions/{positionId}',
  summary: 'Editar una posición',
  description:
    'Solo la administración. Se cambian el texto del club (`null` vuelve al del catálogo; una posición propia del club no tiene texto de catálogo y siempre lleva el suyo), la línea (una del deporte) y el orden; el deporte y el código no. Una posición archivada no se edita: se restaura primero (`conflict`). `version` desactualizada: `conflict`.',
  tags: ['categories'],
  auth: 'club',
  params: positionParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    label: positionLabelSchema.nullable().optional(),
    lineCode: positionLineCodeSchema.optional(),
    sortOrder: sortOrderSchema.optional(),
  }),
  response: { status: 200, description: 'La posición actualizada.', schema: positionSchema },
  errors: ['not_found', 'conflict'],
});

export const archivePosition = defineEndpoint({
  method: 'POST',
  path: '/v1/positions/{positionId}/archive',
  summary: 'Archivar una posición',
  description:
    'Solo la administración. Deja de ofrecerse y de aceptarse para asignaciones nuevas; quien ya la tiene la conserva. Idempotente.',
  tags: ['categories'],
  auth: 'club',
  params: positionParams,
  response: { status: 200, description: 'Posición archivada.', schema: positionSchema },
  errors: ['not_found'],
});

export const restorePosition = defineEndpoint({
  method: 'POST',
  path: '/v1/positions/{positionId}/restore',
  summary: 'Restaurar una posición',
  description: 'Solo la administración. Idempotente.',
  tags: ['categories'],
  auth: 'club',
  params: positionParams,
  response: { status: 200, description: 'Posición restaurada.', schema: positionSchema },
  errors: ['not_found'],
});
