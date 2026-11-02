import { category, player, playerCategory } from '@sport-performance/db/schema';
import {
  CONSENT_TYPES,
  SPORTS,
  isCurrentOn,
  isOfAge,
  type ClubId,
  type ConsentType,
  type LocalDate,
  type PlayerFacts,
  type PlayerId,
} from '@sport-performance/domain';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { TenantDatabase } from '../db/database.js';
import { HttpError, consentRequiredDetails } from './errors.js';
import { clubToday } from './permissions.js';

/**
 * Consents in the handlers (B-312, ADR 0043). Every route that stores data
 * of a player checks the consent its data needs **before writing**:
 *
 * - with the permission matrix, passing the facts of {@link loadPlayerFacts}
 *   (they carry the current consents): the cells that collect data already
 *   require `data`, `image` or `health`, and a denial for a missing consent
 *   is answered `403 consent_required` with the missing types;
 * - or directly with {@link requireConsent}, when the data needs a consent
 *   the matrix cell does not (a CMJ video stored with a test result needs
 *   `image`, the result itself only `data`).
 *
 * "Current" has one definition, in the database: `app.current_consent_types`
 * (signed, not revoked), which the medical schema uses too.
 */

/**
 * Types of the player's current consents, as the database defines them.
 * Empty for a player the caller does not see: load the player first (the
 * matrix and RLS answer `404`/`403` before asking this).
 */
export async function currentConsentTypesOf(
  db: TenantDatabase,
  playerId: PlayerId,
): Promise<ConsentType[]> {
  const { rows } = await db.execute<{ types: string[] | null }>(
    sql`select app.current_consent_types(${playerId}::uuid)::text[] as types`,
  );
  const types = rows[0]?.types ?? [];
  return CONSENT_TYPES.filter((type) => types.includes(type));
}

/**
 * Refuses to go on unless the player has a current consent of every type in
 * `types`: `403 consent_required`, with one `details` entry per missing type
 * (`path: ['consents', type]`). Call it after authorizing the access to the
 * player and before writing.
 *
 * ```ts
 * const facts = await requirePlayerFacts(db, clubId, params.playerId);
 * await permissions.authorize('media', 'upload', { player: facts });
 * await requireConsent(db, params.playerId, ['image']);
 * ```
 */
export async function requireConsent(
  db: TenantDatabase,
  playerId: PlayerId,
  types: readonly ConsentType[],
): Promise<void> {
  const current = await currentConsentTypesOf(db, playerId);
  const missing = CONSENT_TYPES.filter((type) => types.includes(type) && !current.includes(type));
  if (missing.length > 0) {
    throw new HttpError(
      'consent_required',
      `The player has no current consent of type ${missing.join(', ')}`,
      { details: consentRequiredDetails(missing) },
    );
  }
}

/** The facts of a player for the permission matrix, and what they come from. */
export interface LoadedPlayer {
  readonly facts: PlayerFacts;
  readonly birthDate: LocalDate;
  /** The club's day the facts were computed on. */
  readonly today: LocalDate;
}

/**
 * Loads a player of the club (under RLS: `undefined` when the caller does
 * not see it) with the facts the matrix needs for player resources: sport
 * and current categories (assignment scope), majority on the club's day
 * (guardian access, `minor` / `adult`) and current consents (consent
 * requirements). Stage and age band are not loaded: no consent route needs
 * them, and a rule that does denies with `missing_fact`.
 */
export async function loadPlayerFacts(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
): Promise<LoadedPlayer | undefined> {
  const [row] = await db
    .select({ id: player.id, birthDate: player.birthDate })
    .from(player)
    .where(and(eq(player.clubId, clubId), eq(player.id, playerId)));
  if (row === undefined) return undefined;
  const today = await clubToday(db);
  const categories = await db
    .select({
      categoryId: playerCategory.categoryId,
      sport: category.sport,
      validFrom: playerCategory.validFrom,
      validTo: playerCategory.validTo,
    })
    .from(playerCategory)
    .innerJoin(
      category,
      and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
    )
    .where(and(eq(playerCategory.clubId, clubId), eq(playerCategory.playerId, playerId)))
    .orderBy(desc(playerCategory.validFrom));
  const current = categories.filter((c) => isCurrentOn(c, today));
  // The sport of the current category, else of the last one. A player without any category
  // is invisible to assigned staff (RLS scopes them by current category), so the only rules
  // left (club, self, guardian) never read it: the first sport is a placeholder.
  const sport = current[0]?.sport ?? categories[0]?.sport ?? SPORTS[0];
  return {
    facts: {
      id: row.id,
      sport,
      categoryIds: current.map((c) => c.categoryId),
      ofAge: isOfAge(row.birthDate, today),
      consents: await currentConsentTypesOf(db, row.id),
    },
    birthDate: row.birthDate,
    today,
  };
}

/** {@link loadPlayerFacts}, answering `404` when the caller does not see the player. */
export async function requirePlayerFacts(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
): Promise<LoadedPlayer> {
  const loaded = await loadPlayerFacts(db, clubId, playerId);
  if (loaded === undefined) throw new HttpError('not_found', 'Player not found');
  return loaded;
}
