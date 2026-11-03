import type { Child, Player, PlayerConsents } from '@sport-performance/contracts';
import {
  ageInCompletedYears,
  localDateInTimeZone,
  type LocalDate,
  type PlayerFacts,
  type TimeZone,
} from '@sport-performance/domain';

/**
 * What the family area derives from a child (ADR 0065): pure, so the rules
 * the screens follow are tested without rendering.
 */

/** The club's day now (ages and "today" are the club's, CLAUDE.md). */
export function clubToday(timeZone: TimeZone, now: number = Date.now()): LocalDate {
  return localDateInTimeZone(now, timeZone);
}

export function ageOn(child: Pick<Child, 'birthDate'>, today: LocalDate): number {
  return ageInCompletedYears(child.birthDate, today);
}

/**
 * Whether the guardian sees the child's data: a minor, or an adult who kept
 * the guardian's access (B-311). Otherwise only the link is shown.
 */
export function guardianSeesData(child: Pick<Child, 'ofAge' | 'adultConfirmed'>): boolean {
  return !child.ofAge || child.adultConfirmed;
}

export function fullName(child: Pick<Child, 'firstName' | 'lastName'>): string {
  return `${child.firstName} ${child.lastName}`;
}

/**
 * Facts of the matrix (ADR 0025) about the child, from the profile and the
 * consents the screen already read: what `can()` needs to decide whether the
 * guardian may report a parent's height (guardian of a minor with a current
 * `data` consent). The API decides again.
 */
export function childFacts(
  child: Pick<Child, 'playerId' | 'ofAge'>,
  player: Pick<Player, 'sport' | 'currentCategoryIds'>,
  consents: PlayerConsents | undefined,
): PlayerFacts {
  return {
    id: child.playerId,
    sport: player.sport,
    categoryIds: player.currentCategoryIds,
    ofAge: child.ofAge,
    ...(consents === undefined
      ? {}
      : {
          consents: consents.types
            .filter((status) => status.consent !== null)
            .map((status) => status.type),
        }),
  };
}
