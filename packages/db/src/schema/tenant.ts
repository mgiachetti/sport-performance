import { DEFAULT_CLUB_TIME_ZONE, type ClubId, type TimeZone } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { timestamptz } from './columns.js';

/**
 * Tenancy and audit conventions (ADR 0006, ADR 0023).
 *
 * - `club` is the tenant root. Every other table with club data spreads
 *   {@link tenantColumns} and calls {@link tenantConstraints}: a `uuid` id, a
 *   `club_id NOT NULL`, the audit columns and two unique keys, `(club_id, id)`
 *   (target of the composite foreign keys) and `(club_id, client_uuid)`
 *   (idempotent offline sync, ADR 0015).
 * - References between club tables use {@link tenantReference}: a composite
 *   foreign key `(club_id, x_id) → x (club_id, id)`, so a row of club A can
 *   never point to a player, category or session of club B, whatever the RLS
 *   policies say.
 * - RLS, `app.current_club_id()` and grants are added on top in SQL
 *   migrations (ADR 0025): every table that has `club_id` calls
 *   `app_admin.secure_club_table()` in the migration that creates it.
 */

/** Branding applied at runtime (ADR 0014). Colors are `#RRGGBB`. */
export interface ClubBranding {
  readonly logoUrl?: string;
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly backgroundColor?: string;
}

/** Club-level switches (B-322: active modules). Unknown keys are ignored. */
export interface ClubSettings {
  readonly modules?: Readonly<Record<string, boolean>>;
}

/** `created_*`, `updated_*` and `client_uuid`, shared by `club` and every club table. */
export function auditColumns() {
  return {
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /** Kept current by the `set_updated_at` trigger, also for raw SQL updates. */
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    /** `NULL` for system writes (seeds, worker jobs) and after the author's account is deleted. */
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    /**
     * Id the client generated for the mutation that created the row (ADR
     * 0015). Unique per club, so re-sending a mutation never inserts twice.
     * Server-side inserts get a random one.
     */
    clientUuid: uuid('client_uuid').notNull().defaultRandom(),
  };
}

export const club = pgTable(
  'club',
  {
    id: uuid('id').primaryKey().defaultRandom().$type<ClubId>(),
    /** URL-safe identifier (`orc`), unique across tenants. */
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    /**
     * IANA zone. "The day" of every club metric is computed in it. Free text:
     * the API must validate it (`Intl.DateTimeFormat` accepts it) before
     * writing: a `CHECK` cannot validate it, the list of zones depends on
     * the tzdata of each runtime.
     */
    timeZone: text('time_zone').notNull().default(DEFAULT_CLUB_TIME_ZONE).$type<TimeZone>(),
    branding: jsonb('branding').notNull().default({}).$type<ClubBranding>(),
    settings: jsonb('settings').notNull().default({}).$type<ClubSettings>(),
    ...auditColumns(),
  },
  (t) => [
    unique('club_client_uuid_key').on(t.clientUuid),
    check('club_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

/** Columns every club table starts with: id, `club_id` and the audit columns. */
export function tenantColumns() {
  return {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => club.id, { onDelete: 'restrict' })
      .$type<ClubId>(),
    ...auditColumns(),
  };
}

interface TenantKeyColumns {
  readonly id: AnyPgColumn;
  readonly clubId: AnyPgColumn;
  readonly clientUuid: AnyPgColumn;
}

/** The unique keys every club table has. `(club_id, id)` also serves as the club index. */
export function tenantConstraints(table: string, t: TenantKeyColumns) {
  return [
    unique(`${table}_club_id_id_key`).on(t.clubId, t.id),
    unique(`${table}_club_id_client_uuid_key`).on(t.clubId, t.clientUuid),
  ];
}

/**
 * Index `(club_id, column) WHERE column IS NOT NULL` for an optional
 * {@link tenantReference}. Postgres does not index the referencing side of a
 * foreign key; without it, deleting the parent or joining scans the table.
 * Required references are usually covered by a wider index on the table.
 */
export function tenantReferenceIndex(table: string, clubId: AnyPgColumn, column: AnyPgColumn) {
  return index(`${table}_${column.name}_idx`)
    .on(clubId, column)
    .where(sql`${column} is not null`);
}

/**
 * Composite foreign key `(club_id, column) → target (club_id, id)`. Named
 * `<table>_<column>_fkey`. A `NULL` column skips the check (`MATCH SIMPLE`),
 * so it also works for optional references. Defaults to `ON DELETE
 * RESTRICT`: club data is deleted through explicit flows, never by accident.
 */
export function tenantReference(
  table: string,
  clubId: AnyPgColumn,
  column: AnyPgColumn,
  target: { readonly clubId: AnyPgColumn; readonly id: AnyPgColumn },
) {
  const name = `${table}_${column.name}_fkey`;
  if (name.length > 63) throw new Error(`Constraint name too long for Postgres: ${name}`);
  return foreignKey({
    name,
    columns: [clubId, column],
    foreignColumns: [target.clubId, target.id],
  }).onDelete('restrict');
}
