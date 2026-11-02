import type { PlayerId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { finite } from './checks.js';
import { localDate, timestamptz } from './columns.js';
import { acwrStatusEnum, monotonyStatusEnum } from './enums.js';
import { player } from './players.js';
import { tenantColumns, tenantConstraints, tenantReference } from './tenant.js';

/**
 * Values derived by the worker for the panel (B-326, ADR 0045). They are a
 * cache rebuilt from the source rows (participation, wellness,
 * anthropometry), never edited: the API only reads them, the worker replaces
 * them (it is the only role with `DELETE` here) and they go with the player
 * (`ON DELETE CASCADE`). Maturation is written on `anthro_measurement`
 * itself, next to the measurement it comes from.
 */

/**
 * A pending recalculation (outbox, ADR 0045): triggers on the source tables
 * mark the player in the same transaction as the write, with what to
 * recalculate: the load series from `load_from`, the wellness baseline from
 * `wellness_from` (the earliest of every pending write), the maturation of
 * every measurement. The worker deletes the row only if no write came in
 * meanwhile (`requested_at` unchanged). One row per player.
 */
export const derivedRefresh = pgTable(
  'derived_refresh',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    /** First club day of the load series to recalculate (`1900-01-01`: all of it). */
    loadFrom: localDate('load_from'),
    /** First club day of the wellness baseline to recalculate. */
    wellnessFrom: localDate('wellness_from'),
    /** Recalculate the maturation of every measurement of the player. */
    maturation: boolean('maturation').notNull().default(false),
    /** Time of the latest write that marked it (`clock_timestamp()`). */
    requestedAt: timestamptz('requested_at').notNull().defaultNow(),
  },
  (t) => [
    ...tenantConstraints('derived_refresh', t),
    tenantReference('derived_refresh', t.clubId, t.playerId, player).onDelete('cascade'),
    unique('derived_refresh_club_id_player_id_key').on(t.clubId, t.playerId),
    index('derived_refresh_requested_idx').on(t.clubId, t.requestedAt),
    check(
      'derived_refresh_something',
      sql`${t.loadFrom} is not null or ${t.wellnessFrom} is not null or ${t.maturation}`,
    ),
  ],
);

/**
 * Training load of a player per club day (`computeLoadSeries`): one row per
 * day from the first day with load through today (or the day the player
 * left). Days without data are rows too (`has_data = false`, load 0), so the
 * panel draws a gap-free series.
 */
export const playerLoadDaily = pgTable(
  'player_load_daily',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    localDate: localDate('local_date').notNull(),
    /** sRPE of the day (sum of RPE × minutes), in AU. */
    loadAu: doublePrecision('load_au').notNull(),
    hasData: boolean('has_data').notNull(),
    /** Participations of the day with an RPE (counted in `load_au`). */
    sessionsN: smallint('sessions_n').notNull(),
    /** Participations of the day with minutes but no RPE yet (not counted). */
    pendingRpeN: smallint('pending_rpe_n').notNull(),
    historyDays: integer('history_days').notNull(),
    acuteEwmaAu: doublePrecision('acute_ewma_au').notNull(),
    chronicEwmaAu: doublePrecision('chronic_ewma_au').notNull(),
    /** `NULL` unless `acwr_status = 'ok'`. */
    acwr: doublePrecision('acwr'),
    acwrStatus: acwrStatusEnum('acwr_status').notNull(),
    missingDaysAcute: smallint('missing_days_acute').notNull(),
    missingDaysChronic: smallint('missing_days_chronic').notNull(),
    /** Load of the rolling monotony window (7 days by default). */
    windowLoadAu: doublePrecision('window_load_au').notNull(),
    monotony: doublePrecision('monotony'),
    strainAu: doublePrecision('strain_au'),
    monotonyStatus: monotonyStatusEnum('monotony_status').notNull(),
    computedAt: timestamptz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    ...tenantConstraints('player_load_daily', t),
    tenantReference('player_load_daily', t.clubId, t.playerId, player).onDelete('cascade'),
    /** Also the index of the composite foreign key and of the panel's range reads. */
    unique('player_load_daily_player_day_key').on(t.clubId, t.playerId, t.localDate),
    index('player_load_daily_day_idx').on(t.clubId, t.localDate),
    check(
      'player_load_daily_values',
      sql`${finite(t.loadAu)} and ${t.loadAu} >= 0 and ${finite(t.acuteEwmaAu)} and ${t.acuteEwmaAu} >= 0 and ${finite(t.chronicEwmaAu)} and ${t.chronicEwmaAu} >= 0 and ${finite(t.windowLoadAu)} and ${t.windowLoadAu} >= 0 and ${t.historyDays} >= 1 and ${t.sessionsN} >= 0 and ${t.pendingRpeN} >= 0 and ${t.missingDaysAcute} >= 0 and ${t.missingDaysChronic} >= 0`,
    ),
    check(
      'player_load_daily_acwr',
      sql`(${t.acwrStatus} = 'ok') = (${t.acwr} is not null) and (${t.acwr} is null or (${finite(t.acwr)} and ${t.acwr} >= 0))`,
    ),
    check(
      'player_load_daily_monotony',
      sql`(${t.monotonyStatus} = 'ok') = (${t.monotony} is not null) and (${t.monotony} is null) = (${t.strainAu} is null) and (${t.monotony} is null or ${finite(t.monotony)}) and (${t.strainAu} is null or ${finite(t.strainAu)})`,
    ),
  ],
);

/**
 * Wellness of a player per club day with an entry, against the player's own
 * rolling baseline (`wellnessBaselineSeries`).
 */
export const playerWellnessDaily = pgTable(
  'player_wellness_daily',
  {
    ...tenantColumns(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    localDate: localDate('local_date').notNull(),
    itemCount: smallint('item_count').notNull(),
    /** Mean of the answered items (1–5, higher is better). */
    meanScore: doublePrecision('mean_score').notNull(),
    baselineSamples: smallint('baseline_samples').notNull(),
    baselineMeanScore: doublePrecision('baseline_mean_score'),
    baselineSdScore: doublePrecision('baseline_sd_score'),
    zScore: doublePrecision('z_score'),
    computedAt: timestamptz('computed_at').notNull().defaultNow(),
  },
  (t) => [
    ...tenantConstraints('player_wellness_daily', t),
    tenantReference('player_wellness_daily', t.clubId, t.playerId, player).onDelete('cascade'),
    unique('player_wellness_daily_player_day_key').on(t.clubId, t.playerId, t.localDate),
    index('player_wellness_daily_day_idx').on(t.clubId, t.localDate),
    check('player_wellness_daily_item_count', sql`${t.itemCount} in (3, 5)`),
    check(
      'player_wellness_daily_values',
      sql`${finite(t.meanScore)} and ${t.meanScore} between 1 and 5 and ${t.baselineSamples} >= 0 and (${t.baselineMeanScore} is null or ${finite(t.baselineMeanScore)}) and (${t.baselineSdScore} is null or (${finite(t.baselineSdScore)} and ${t.baselineSdScore} >= 0)) and (${t.zScore} is null or ${finite(t.zScore)})`,
    ),
  ],
);
