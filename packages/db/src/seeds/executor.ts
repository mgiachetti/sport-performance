import type { NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type * as schema from '../schema/index.js';

/** A database or a transaction over the full schema (`Database` or the `tx` of `db.transaction`). */
export type SeedExecutor = PgDatabase<NodePgQueryResultHKT, typeof schema>;
