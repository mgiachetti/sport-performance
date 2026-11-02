import { category, consent, player, playerCategory } from '@sport-performance/db/schema';
import {
  isConsentType,
  isOfAge,
  isCurrentOn,
  parseLocalDate,
  type CategoryFacts,
  type CategoryId,
  type ClubId,
  type ConsentType,
  type PlayerFacts,
  type PlayerId,
} from '@sport-performance/domain';
import { and, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { TenantDatabase } from '../db/database.js';
import { HttpError } from '../http/errors.js';

/**
 * Facts about players the permission matrix needs for their files (ADR
 * 0025): sport, current categories, majority and current consents, on the
 * club's day. Read on the request transaction, so a player the caller cannot
 * see under RLS has no facts (the endpoint answers `404`).
 *
 * The sport is the player's own (`player.sport`, B-315). A current consent
 * is one signed and not revoked, as `app.current_consent_types` defines it
 * (B-312, ADR 0043); read here in one query for a whole page of a list,
 * where `loadPlayerFacts` of `http/consents.ts` loads one player.
 */
export async function loadPlayerFacts(
  db: TenantDatabase,
  clubId: ClubId,
  playerIds: readonly PlayerId[],
): Promise<Map<PlayerId, PlayerFacts>> {
  const facts = new Map<PlayerId, PlayerFacts>();
  const ids = [...new Set(playerIds)];
  if (ids.length === 0) return facts;
  const { rows } = await db.execute<{ today: string | null }>(
    sql`select app.club_today()::text as today`,
  );
  const todayText = rows[0]?.today ?? null;
  if (todayText === null) {
    throw new HttpError('forbidden', 'The club of the request is not visible');
  }
  const today = parseLocalDate(todayText);

  // One after the other: they share the connection of the request transaction.
  const players = await db
    .select({ id: player.id, sport: player.sport, birthDate: player.birthDate })
    .from(player)
    .where(and(eq(player.clubId, clubId), inArray(player.id, ids)));
  const categories = await db
    .select({
      playerId: playerCategory.playerId,
      categoryId: playerCategory.categoryId,
      validFrom: playerCategory.validFrom,
      validTo: playerCategory.validTo,
    })
    .from(playerCategory)
    .where(and(eq(playerCategory.clubId, clubId), inArray(playerCategory.playerId, ids)))
    .orderBy(desc(playerCategory.validFrom));
  const consents = await db
    .select({ playerId: consent.playerId, type: consent.type })
    .from(consent)
    .where(
      and(
        eq(consent.clubId, clubId),
        inArray(consent.playerId, ids),
        isNull(consent.revokedAt),
        lte(consent.signedAt, sql`now()`),
      ),
    );

  for (const row of players) {
    const current = categories.filter((c) => c.playerId === row.id && isCurrentOn(c, today));
    const types = new Set<ConsentType>();
    for (const c of consents) if (c.playerId === row.id && isConsentType(c.type)) types.add(c.type);
    facts.set(row.id, {
      id: row.id,
      sport: row.sport,
      categoryIds: current.map((c) => c.categoryId),
      ofAge: isOfAge(row.birthDate, today),
      consents: [...types],
    });
  }
  return facts;
}

/** Facts about a category of the club, or `404` when the caller cannot see it. */
export async function loadCategoryFacts(
  db: TenantDatabase,
  clubId: ClubId,
  categoryId: CategoryId,
): Promise<CategoryFacts> {
  const [row] = await db
    .select({ id: category.id, sport: category.sport })
    .from(category)
    .where(and(eq(category.clubId, clubId), eq(category.id, categoryId)));
  if (row === undefined) throw new HttpError('not_found', 'Category not found');
  return { id: row.id, sport: row.sport };
}
