import { sql } from 'drizzle-orm';
import { check, doublePrecision, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { codeCheck, finite } from './checks.js';
import { coefficientVerificationEnum, sexEnum } from './enums.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';

/**
 * Maturation reference data (B-203, B-306). CLAUDE.md asks for the
 * Khamis-Roche coefficients "como datos en la base (seed), no hardcodeados":
 * they are seeded per club from the domain's `KHAMIS_ROCHE_1994_TABLE`
 * (ADR 0023: no shared `club_id NULL` rows) and read back as a domain
 * `KhamisRocheTable` (`loadKhamisRocheTable`). Clubs do not edit them: a
 * corrected or local table is a new `code`, so every stored
 * `adult_height_pct` keeps pointing to the table it was computed with.
 */

/** A coefficient table and its provenance (`CoefficientProvenance` in the domain). */
export const khamisRocheTable = pgTable(
  'khamis_roche_table',
  {
    ...tenantColumns(),
    /** Stable identifier stored with each computed value (`khamis_roche_1994`). */
    code: text('code').notNull(),
    citation: text('citation').notNull(),
    doi: text('doi'),
    errata: text('errata')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Production may refuse `unverified` tables (the UI shows the status). */
    verification: coefficientVerificationEnum('verification').notNull(),
    verificationNotes: text('verification_notes').notNull(),
  },
  (t) => [
    ...tenantConstraints('khamis_roche_table', t),
    unique('khamis_roche_table_club_id_code_key').on(t.clubId, t.code),
    codeCheck('khamis_roche_table_code_format', t.code),
  ],
);

/**
 * One age row of a table, per sex (`KhamisRocheRow` in the domain). Units are
 * the paper's: inches and pounds.
 */
export const khamisRocheCoefficient = pgTable(
  'khamis_roche_coefficient',
  {
    ...tenantColumns(),
    tableId: uuid('table_id').notNull(),
    sex: sexEnum('sex').notNull(),
    /** Decimal age of the row, in years (the paper tabulates half years). */
    ageYears: doublePrecision('age_years').notNull(),
    /** β0, in inches. */
    interceptIn: doublePrecision('intercept_in').notNull(),
    /** β1: inches of adult height per inch of current height. */
    heightInCoef: doublePrecision('height_in_coef').notNull(),
    /** β2: inches of adult height per pound of current weight. */
    weightLbCoef: doublePrecision('weight_lb_coef').notNull(),
    /** β3: inches of adult height per inch of midparent height. */
    midparentHeightInCoef: doublePrecision('midparent_height_in_coef').notNull(),
  },
  (t) => [
    ...tenantConstraints('khamis_roche_coefficient', t),
    tenantReference('khamis_roche_coefficient', t.clubId, t.tableId, khamisRocheTable).onDelete(
      'cascade',
    ),
    /** Also the index of the composite foreign key (starts with `club_id, table_id`). */
    unique('khamis_roche_coefficient_row_key').on(t.clubId, t.tableId, t.sex, t.ageYears),
    check(
      'khamis_roche_coefficient_age_range',
      sql`${finite(t.ageYears)} and ${t.ageYears} > 0 and ${t.ageYears} < 25`,
    ),
    check(
      'khamis_roche_coefficient_finite',
      sql`${finite(t.interceptIn)} and ${finite(t.heightInCoef)} and ${finite(t.weightLbCoef)} and ${finite(t.midparentHeightInCoef)}`,
    ),
  ],
);
