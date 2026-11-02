import { createHash } from 'node:crypto';
import type { Page } from '@sport-performance/contracts';
import { asc, desc, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { HttpError } from './errors.js';

/**
 * Keyset (cursor) pagination of the list endpoints (ADR 0032).
 *
 * - The client picks a `sort` among the fields the endpoint allows (`name`,
 *   `-name`); the id always breaks ties in the same direction, so the order
 *   is total and no row is skipped or repeated between pages, also under
 *   concurrent inserts.
 * - The cursor is opaque (base64url JSON): the sort, a fingerprint of the
 *   filters and the key `(value, id)` of the last row. Reusing it with
 *   another sort or other filters is `400 bad_request`, never a wrong page.
 * - `limit` comes validated by the contract (1 to `PAGE_LIMIT_MAX`); the
 *   query asks for one row more to know if there is a next page.
 * - Sort columns must be `NOT NULL`. Timestamps are compared truncated to
 *   the millisecond the cursor carries (`timestamptz` keeps microseconds).
 */

export type SortKeyType = 'text' | 'integer' | 'timestamp';

export interface SortKey<Row> {
  /** Column or expression to order by. An enum is ordered by its text (`sport::text`). */
  readonly column: AnyColumn | SQL;
  readonly type: SortKeyType;
  /** The value of the key in a returned row. */
  readonly value: (row: Row) => string | number | Date;
}

export interface KeysetSpec<Row, Field extends string> {
  readonly fields: Readonly<Record<Field, SortKey<Row>>>;
  /** The id column (`uuid`) and its value in a row: the tie-breaker. */
  readonly id: { readonly column: AnyColumn; readonly value: (row: Row) => string };
}

export interface KeysetQuery<Field extends string> {
  readonly sort: Field | `-${Field}`;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface KeysetPlan<Row> {
  /** Condition for the rows after the cursor (`undefined` on the first page). */
  readonly where: SQL | undefined;
  readonly orderBy: SQL[];
  /** `limit + 1`. */
  readonly limit: number;
  /** Cuts the rows to the page and encodes the next cursor. */
  page<Item>(rows: readonly Row[], toItem: (row: Row) => Item): Page<Item>;
}

interface CursorPayload {
  readonly v: 1;
  readonly s: string;
  readonly f: string;
  readonly k: readonly [string | number, string];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Stable fingerprint of the filters: the cursor is only valid for the same ones. */
export function filtersFingerprint(filters: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(filters)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash('sha256').update(JSON.stringify(entries)).digest('base64url').slice(0, 16);
}

function keyExpression(key: SortKey<unknown>): SQL {
  return key.type === 'timestamp'
    ? sql`date_trunc('milliseconds', ${key.column})`
    : sql`${key.column}`;
}

function keyParameter(type: SortKeyType, value: string | number): SQL {
  switch (type) {
    case 'text':
      return sql`${value}::text`;
    case 'integer':
      return sql`${value}::bigint`;
    case 'timestamp':
      return sql`${value}::timestamptz`;
  }
}

function serialize(type: SortKeyType, value: string | number | Date): string | number {
  if (type === 'timestamp') {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString();
  }
  return value instanceof Date ? value.toISOString() : value;
}

function invalidCursor(): never {
  throw new HttpError('bad_request', 'Invalid cursor');
}

function decodeCursor(
  cursor: string,
  expected: { sort: string; fingerprint: string; type: SortKeyType },
): CursorPayload['k'] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return invalidCursor();
  }
  if (typeof parsed !== 'object' || parsed === null) return invalidCursor();
  const { v, s, f, k } = parsed as { v?: unknown; s?: unknown; f?: unknown; k?: unknown };
  if (v !== 1 || !Array.isArray(k) || k.length !== 2) return invalidCursor();
  if (s !== expected.sort || f !== expected.fingerprint) {
    throw new HttpError('bad_request', 'The cursor belongs to another sort or other filters');
  }
  const [value, id] = k as [unknown, unknown];
  if (typeof id !== 'string' || !UUID.test(id)) return invalidCursor();
  switch (expected.type) {
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) return invalidCursor();
      return [value, id];
    case 'text':
      if (typeof value !== 'string' || value.length > 512) return invalidCursor();
      return [value, id];
    case 'timestamp':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return invalidCursor();
      return [value, id];
  }
}

/**
 * Plans a page: the `where`, `orderBy` and `limit` to add to the query, and
 * `page()` to turn the rows into `{ items, nextCursor }`.
 *
 * ```ts
 * const plan = keysetPage(CATEGORY_KEYS, query, { sport: query.sport, status: query.status });
 * const rows = await db.select(columns).from(category)
 *   .where(and(filters, plan.where)).orderBy(...plan.orderBy).limit(plan.limit);
 * return plan.page(rows, toDto);
 * ```
 */
export function keysetPage<Row, Field extends string>(
  spec: KeysetSpec<Row, Field>,
  query: KeysetQuery<Field>,
  filters: Readonly<Record<string, unknown>>,
): KeysetPlan<Row> {
  const descending = query.sort.startsWith('-');
  const field = (descending ? query.sort.slice(1) : query.sort) as Field;
  const key = spec.fields[field] as SortKey<unknown> | undefined;
  if (key === undefined) throw new HttpError('bad_request', 'Unknown sort field');
  const fingerprint = filtersFingerprint(filters);
  const expression = keyExpression(key);
  const direction = descending ? desc : asc;

  let where: SQL | undefined;
  if (query.cursor !== undefined) {
    const [value, id] = decodeCursor(query.cursor, {
      sort: query.sort,
      fingerprint,
      type: key.type,
    });
    const comparison = descending ? sql`<` : sql`>`;
    where = sql`(${expression}, ${spec.id.column}) ${comparison} (${keyParameter(key.type, value)}, ${id}::uuid)`;
  }

  return {
    where,
    orderBy: [direction(expression), direction(spec.id.column)],
    limit: query.limit + 1,
    page(rows, toItem) {
      const items = rows.slice(0, query.limit);
      const last = items.at(-1);
      const nextCursor =
        rows.length > query.limit && last !== undefined
          ? Buffer.from(
              JSON.stringify({
                v: 1,
                s: query.sort,
                f: fingerprint,
                k: [serialize(key.type, spec.fields[field].value(last)), spec.id.value(last)],
              } satisfies CursorPayload),
            ).toString('base64url')
          : null;
      return { items: items.map(toItem), nextCursor };
    },
  };
}

/** Escapes `%`, `_` and `\` for a `LIKE` / `ILIKE` pattern (text search filters). */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
