import { z } from 'zod';

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 100;

/**
 * Cursor pagination query. The cursor is opaque to clients (the server
 * encodes the sort key of the last item); clients only pass back `nextCursor`.
 * Cursor pagination is stable under concurrent inserts, unlike offsets.
 */
export const pageQuerySchema = z.strictObject({
  cursor: z
    .string()
    .min(1)
    .max(512)
    .optional()
    .meta({ description: 'Cursor opaco devuelto como `nextCursor` por la página anterior.' }),
  limit: z.coerce
    .number<number>()
    .int()
    .min(1)
    .max(PAGE_LIMIT_MAX)
    .default(PAGE_LIMIT_DEFAULT)
    .meta({ description: `Tamaño de página (1 a ${String(PAGE_LIMIT_MAX)}).` }),
});

export type PageQuery = z.output<typeof pageQuerySchema>;

/** Response page for a list endpoint: `{ items, nextCursor }`. */
export function pageOf<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    nextCursor: z
      .string()
      .min(1)
      .nullable()
      .meta({ description: 'Cursor de la página siguiente; `null` si no hay más.' }),
  });
}

export interface Page<Item> {
  items: Item[];
  nextCursor: string | null;
}
