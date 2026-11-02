import type { ValidationIssue } from '@sport-performance/contracts';
import { category, player, playerCategory } from '@sport-performance/db/schema';
import {
  PermissionDeniedError,
  compareLocalDates,
  parseLocalDate,
  type CategoryId,
  type ClubId,
  type LocalDate,
  type PlayerId,
  type Sex,
  type Sport,
} from '@sport-performance/domain';
import { and, eq, gt, isNull, lte, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { TenantDatabase } from '../db/database.js';
import { HttpError } from '../http/errors.js';
import type { RequestPermissions } from '../http/permissions.js';

/**
 * Helpers shared by the configuration endpoints of the club (B-322, ADR
 * 0041): the club's day, dated configuration (validity, archive, overlaps)
 * and the player-scoped rows.
 */

/** "Today" in the club's time zone, from the database clock (`app.club_today()`). */
export async function clubToday(db: TenantDatabase): Promise<LocalDate> {
  const { rows } = await db.execute<{ today: string | null }>(
    sql`select app.club_today()::text as today`,
  );
  const today = rows[0]?.today ?? null;
  if (today === null) throw new HttpError('forbidden', 'The club of the request is not visible');
  return parseLocalDate(today);
}

/**
 * Serializes the writes of one kind of dated configuration in a club, so
 * the overlap check and the write do not race (released at commit).
 */
export async function lockConfiguration(
  db: TenantDatabase,
  table: string,
  clubId: ClubId,
): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${table}:${clubId}`}, 0))`);
}

export function validationError(
  message: string,
  path: readonly (string | number)[],
  detail = message,
): HttpError {
  const issue: ValidationIssue = { path: [...path], code: 'custom', message: detail };
  return new HttpError('validation_failed', message, { details: [issue] });
}

/** Where a dated row stands on the club's day. */
export type ValidityPhase = 'planned' | 'current' | 'ended';

export function validityPhase(
  row: { readonly validFrom: LocalDate; readonly validTo: LocalDate | null },
  today: LocalDate,
): ValidityPhase {
  if (compareLocalDates(row.validFrom, today) > 0) return 'planned';
  if (row.validTo !== null && compareLocalDates(row.validTo, today) <= 0) return 'ended';
  return 'current';
}

/**
 * The validity after an edit, enforcing the rules of dated configuration
 * (ADR 0041): a planned row changes freely (from today on); a row in force
 * keeps its content and start and is only closed, from today on; an ended
 * row does not change. `contentChanged` is whether the edit touches anything
 * but the dates.
 */
export function plannedValidity(options: {
  row: { readonly validFrom: LocalDate; readonly validTo: LocalDate | null };
  today: LocalDate;
  validFrom: LocalDate | undefined;
  validTo: LocalDate | null | undefined;
  contentChanged: boolean;
  resource: string;
}): { validFrom: LocalDate; validTo: LocalDate | null } {
  const { row, today } = options;
  const phase = validityPhase(row, today);
  const validFrom = options.validFrom ?? row.validFrom;
  const validTo = options.validTo === undefined ? row.validTo : options.validTo;
  const startChanged = validFrom !== row.validFrom;
  const endChanged = validTo !== row.validTo;
  if (phase === 'ended' && (options.contentChanged || startChanged || endChanged)) {
    throw new HttpError('conflict', `The ${options.resource} already ended: it does not change`);
  }
  if (phase === 'current' && (options.contentChanged || startChanged)) {
    throw new HttpError(
      'conflict',
      `The ${options.resource} is in force: close it (validTo) and create a new one`,
    );
  }
  if (phase === 'planned' && startChanged && compareLocalDates(validFrom, today) < 0) {
    throw validationError(
      'validFrom cannot be in the past',
      ['body', 'validFrom'],
      'Today or later',
    );
  }
  if (
    phase === 'current' &&
    endChanged &&
    validTo !== null &&
    compareLocalDates(validTo, today) < 0
  ) {
    throw validationError(
      'A configuration in force is closed from today on',
      ['body', 'validTo'],
      'Today or later',
    );
  }
  assertValidRange(validFrom, validTo);
  return { validFrom, validTo };
}

/** `validTo` is exclusive: strictly after `validFrom`. */
export function assertValidRange(validFrom: LocalDate, validTo: LocalDate | null): void {
  if (validTo !== null && compareLocalDates(validTo, validFrom) <= 0) {
    throw validationError(
      'validTo must be after validFrom',
      ['body', 'validTo'],
      'After validFrom',
    );
  }
}

/**
 * Overlapping rows of the same scope found before a write: closes them at
 * `validFrom` when the client asked for it (`closePrevious`) and every one
 * started before, from today on; otherwise answers `409`.
 */
export function rowsToClose<Row extends { readonly validFrom: LocalDate }>(options: {
  conflicts: readonly Row[];
  closePrevious: boolean;
  validFrom: LocalDate;
  today: LocalDate;
  resource: string;
}): Row[] {
  if (options.conflicts.length === 0) return [];
  const closable =
    options.closePrevious &&
    compareLocalDates(options.validFrom, options.today) >= 0 &&
    options.conflicts.every((row) => compareLocalDates(row.validFrom, options.validFrom) < 0);
  if (!closable) {
    throw new HttpError(
      'conflict',
      `Another ${options.resource} with the same scope is valid on overlapping days`,
    );
  }
  return [...options.conflicts];
}

/** A player of the club and the categories they are in on the club's day. */
export interface PlayerScope {
  readonly id: PlayerId;
  readonly sex: Sex;
  readonly categories: readonly { readonly id: CategoryId; readonly sport: Sport }[];
}

/**
 * Reads a player and checks with the matrix that the caller sees them
 * (`player_profile.read`): `404` when the player is not in the club (or not
 * visible under RLS), `403` when out of the caller's scope.
 */
export async function authorizedPlayer(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  playerId: PlayerId,
): Promise<PlayerScope> {
  const [row] = await db
    .select({ id: player.id, sex: player.sex })
    .from(player)
    .where(and(eq(player.clubId, clubId), eq(player.id, playerId)));
  if (row === undefined) throw new HttpError('not_found', 'Player not found');
  const today = await clubToday(db);
  const categories = await db
    .select({ id: category.id, sport: category.sport })
    .from(playerCategory)
    .innerJoin(
      category,
      and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
    )
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        eq(playerCategory.playerId, playerId),
        lte(playerCategory.validFrom, today),
        or(isNull(playerCategory.validTo), gt(playerCategory.validTo, today)),
      ),
    );
  const categoryIds = categories.map((c) => c.id);
  const sports = [...new Set(categories.map((c) => c.sport))];
  if (sports.length === 0) {
    // Without a category today only who sees the whole club sees the player.
    const scope = await permissions.listScope('player_profile', 'read');
    if (scope.kind !== 'club') {
      throw new PermissionDeniedError('player_profile', 'read', {
        allowed: false,
        reason: 'out_of_scope',
      });
    }
  } else {
    let denied: unknown;
    let allowed = false;
    for (const sport of sports) {
      try {
        await permissions.authorize('player_profile', 'read', {
          player: { id: row.id, sport, categoryIds },
        });
        allowed = true;
        break;
      } catch (error) {
        if (!(error instanceof PermissionDeniedError)) throw error;
        denied = error;
      }
    }
    if (!allowed) throw denied;
  }
  return { id: row.id, sex: row.sex, categories };
}

/** SQL: the player-scoped rows the caller sees (group rows are always visible). */
export function visiblePlayerRows(playerIdColumn: AnyColumn): SQL {
  return sql`(${playerIdColumn} is null or (select app.sees_whole_club()) or ${playerIdColumn} = any ((select app.visible_player_ids())::uuid[]))`;
}
