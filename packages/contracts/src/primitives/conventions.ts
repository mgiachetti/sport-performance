import { SEXES, SPORTS, STAGES } from '@sport-performance/domain';
import { z } from 'zod';
import { uuidSchema } from './ids.js';

/**
 * Shared building blocks of the endpoint conventions (ADR 0032): every
 * resource endpoint uses these instead of redefining them, so the web and
 * mobile clients handle idempotency, concurrency, sorting and archiving the
 * same way everywhere.
 */

/**
 * Id the client generates for a create (offline queue, ADR 0015, or a retry
 * after a timeout). Sending the same create again with the same `clientUuid`
 * returns the row it created the first time instead of a duplicate. Unique
 * per club and table.
 */
export const clientUuidSchema = uuidSchema.meta({
  id: 'ClientUuid',
  description:
    'UUID generado por el cliente para la alta (cola offline o reintento). Reenviar la misma alta con el mismo `clientUuid` devuelve la fila ya creada, sin duplicarla.',
});

/** Pattern of a resource version: opaque to clients, compared as is. */
export const RESOURCE_VERSION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Optimistic concurrency token of an editable resource. Every response
 * carries the current one; a `PATCH` sends back the one it read and gets
 * `409 conflict` if the resource changed since.
 */
export const resourceVersionSchema = z
  .string()
  .regex(RESOURCE_VERSION_PATTERN)
  .meta({
    id: 'ResourceVersion',
    description:
      'Versión opaca del recurso. Un `PATCH` la manda tal cual la leyó; si el recurso cambió desde entonces responde `409 conflict` y hay que releerlo.',
    examples: ['1793586338688123'],
  });

/** Field of a `PATCH` body: the version the client read. */
export const expectedVersionSchema = resourceVersionSchema.meta({
  description:
    'Versión que el cliente leyó (`version` de la respuesta). Si no es la actual: `409 conflict`.',
});

/**
 * `sort` query param of a list: one of the allowed fields, ascending, or the
 * same with a leading `-` for descending. Ties are always broken by id, so
 * the order (and the cursor) is total.
 */
export function sortQuerySchema<const Field extends string>(
  fields: readonly [Field, ...Field[]],
  defaultSort: Field | `-${Field}`,
) {
  type Sort = Field | `-${Field}`;
  const values = fields.flatMap((field) => [field, `-${field}`] as const) as [Sort, ...Sort[]];
  const schema: z.ZodEnum<{ [K in Sort]: K }> = z.enum(values);
  return (
    schema
      // `Sort` is generic: zod cannot relate it to the enum output, which is the same union.
      .default(defaultSort as never)
      .meta({
        description: `Orden: ${fields.map((f) => `\`${f}\``).join(', ')}; con \`-\` adelante, descendente. Desempata por id.`,
      })
  );
}

export const ARCHIVE_STATUSES = ['active', 'archived', 'all'] as const;
export type ArchiveStatus = (typeof ARCHIVE_STATUSES)[number];

/** Filter of the lists of archivable resources. Archived rows are hidden by default. */
export const archiveStatusQuerySchema = z.enum(ARCHIVE_STATUSES).default('active').meta({
  description: '`active` (por defecto), `archived` o `all`.',
});

/** `archivedAt` of an archivable resource: `null` while active. */
export const archivedAtSchema = z.iso
  .datetime({ offset: true })
  .nullable()
  .meta({ description: 'Cuándo se archivó; `null` si está activo.' });

export const sportSchema = z.enum(SPORTS).meta({
  id: 'Sport',
  description: 'Deporte (ADR 0017).',
});

export const sexSchema = z.enum(SEXES).meta({
  id: 'Sex',
  description: 'Rama: sexo biológico que usan las fórmulas y las comparaciones (ADR 0017).',
});

export const stageSchema = z.enum(STAGES).meta({
  id: 'Stage',
  description:
    'Etapa de desarrollo: `foundation` (M13/M14), `development` (M15/M16), `performance` (M17/M19).',
});
