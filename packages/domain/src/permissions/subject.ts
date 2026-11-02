import type { AgeBand } from '../category.js';
import { AGE_OF_MAJORITY_YEARS, type ConsentType } from '../consent.js';
import type { CategoryId, ClubId, PlayerId, UserId } from '../ids.js';
import type { Role } from '../role.js';
import type { Sport } from '../sport.js';
import type { Stage } from '../stage.js';
import { ageInCompletedYears, compareLocalDates, type LocalDate } from '../time.js';
import type { ResourceKind } from './resources.js';

/** What a staff assignment points at (B-314): a category, or a whole sport. */
export type AssignmentTarget =
  | { readonly kind: 'category'; readonly categoryId: CategoryId }
  | { readonly kind: 'sport'; readonly sport: Sport };

/**
 * A guardian link (B-310). Once the player is of age, the guardian keeps
 * access only if the adult player confirmed it (B-311).
 */
export interface Guardianship {
  readonly playerId: PlayerId;
  readonly confirmedByAdultPlayer: boolean;
}

/**
 * Who asks. Built per request from the session (user and membership of the
 * selected club, ADR 0007) and the rows of `staff_assignment`, `guardian`
 * and the player linked to the user. Only **current** assignments and links
 * go in: use {@link currentAssignments} and {@link currentGuardianships}.
 */
export interface PermissionSubject {
  readonly userId: UserId;
  /** Role of the membership in `clubId`, or `superadmin`. */
  readonly role: Role;
  /** Club of the request context; `null` before picking a club (only platform rules apply). */
  readonly clubId: ClubId | null;
  /** The player this user is, for the `player` role. */
  readonly playerId?: PlayerId | null;
  /** Current staff assignments in `clubId`. */
  readonly assignments?: readonly AssignmentTarget[];
  /** Current guardian links in `clubId`. */
  readonly guardianships?: readonly Guardianship[];
}

/**
 * Facts about the player a resource belongs to. Only `id`, `sport` and
 * `categoryIds` are always needed; the rest only by the rules that check
 * them. A rule that needs a missing fact denies (`missing_fact`): the
 * evaluator never assumes.
 */
export interface PlayerFacts {
  readonly id: PlayerId;
  readonly sport: Sport;
  /** Current categories of the player (`player_category`). */
  readonly categoryIds: readonly CategoryId[];
  /** Current stage (B-204). Needed by `own_percentiles` and `named_rankings`. */
  readonly stage?: Stage;
  /** Age band of the player's category. Needed by `own_percentiles` and `named_rankings`. */
  readonly ageBand?: Pick<AgeBand, 'ownPercentilesForPlayers' | 'namedRankingsForPlayers'>;
  /** Whether the player is of age. Needed by `minor`, `adult` and guardian access. */
  readonly ofAge?: boolean;
  /** Types of the player's current (signed, not revoked) consents. Needed by consent requirements. */
  readonly consents?: readonly ConsentType[];
}

/** Facts about the category a resource belongs to. */
export interface CategoryFacts {
  readonly id: CategoryId;
  readonly sport: Sport;
}

/**
 * What is accessed. `clubId` is the club that owns it (omitted only for the
 * platform registry). Pass `player` when it is about one player, otherwise
 * `category` when it is about a category; the evaluator checks the player
 * first.
 */
export interface PermissionResource<K extends ResourceKind = ResourceKind> {
  readonly kind: K;
  readonly clubId?: ClubId | null;
  readonly player?: PlayerFacts;
  readonly category?: CategoryFacts;
}

/** Whether someone born on `birthDate` is of age on `onDate`. */
export function isOfAge(birthDate: LocalDate, onDate: LocalDate): boolean {
  return ageInCompletedYears(birthDate, onDate) >= AGE_OF_MAJORITY_YEARS;
}

/** A row with an inclusive `validFrom` and an exclusive, optional `validTo`. */
export interface ValidityWindow {
  readonly validFrom: LocalDate;
  readonly validTo?: LocalDate | null;
}

/** Whether a validity window (`validTo` exclusive, ADR 0023) covers `onDate`. */
export function isCurrentOn(row: ValidityWindow, onDate: LocalDate): boolean {
  if (compareLocalDates(row.validFrom, onDate) > 0) return false;
  const validTo = row.validTo ?? null;
  return validTo === null || compareLocalDates(onDate, validTo) < 0;
}

/**
 * Current assignment targets from `staff_assignment` rows (exactly one of
 * `categoryId` and `sport` per row), on the club's day.
 */
export function currentAssignments(
  rows: readonly (ValidityWindow & {
    readonly categoryId?: CategoryId | null;
    readonly sport?: Sport | null;
  })[],
  onDate: LocalDate,
): AssignmentTarget[] {
  const targets: AssignmentTarget[] = [];
  for (const row of rows) {
    if (!isCurrentOn(row, onDate)) continue;
    const categoryId = row.categoryId ?? null;
    const sport = row.sport ?? null;
    if (categoryId !== null && sport === null) {
      targets.push({ kind: 'category', categoryId });
    } else if (sport !== null && categoryId === null) {
      targets.push({ kind: 'sport', sport });
    }
    // A row with both or neither targets breaks `staff_assignment_one_target`: ignored (fail closed).
  }
  return targets;
}

/** Current guardian links from `guardian` rows, on the club's day. */
export function currentGuardianships(
  rows: readonly (ValidityWindow & {
    readonly playerId: PlayerId;
    readonly confirmedByAdultPlayer?: boolean;
  })[],
  onDate: LocalDate,
): Guardianship[] {
  return rows
    .filter((row) => isCurrentOn(row, onDate))
    .map((row) => ({
      playerId: row.playerId,
      confirmedByAdultPlayer: row.confirmedByAdultPlayer ?? false,
    }));
}
