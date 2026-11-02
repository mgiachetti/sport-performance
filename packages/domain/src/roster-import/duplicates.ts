import type { PlayerId } from '../ids.js';
import type { Sport } from '../sport.js';
import { compareLocalDates, daysBetween, type LocalDate } from '../time.js';

/**
 * Duplicate detection of the roster import (B-330): whether a row of the
 * spreadsheet is a player the club already has. Spreadsheets are typed by
 * hand: accents, case, double spaces and swapped columns differ between a
 * row and the profile. A match is only proposed within the same sport (a
 * player of another sport is another profile, ADR 0035).
 */

/**
 * A person's name for comparison: without diacritics (`Pérez` = `Perez`,
 * `Muñoz` = `Munoz`), lowercase, with punctuation (`'`, `-`, `.`) as spaces
 * and single spaces.
 */
export function normalizePersonName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Levenshtein distance, stopping once it exceeds `max` (returns `max + 1`). */
export function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length] ?? max + 1;
}

/** Who a row describes, for matching. */
export interface RosterPerson {
  firstName: string;
  lastName: string;
  birthDate: LocalDate;
  sport: Sport;
}

/** A player of the club, as matching needs it. */
export interface RosterPlayer extends RosterPerson {
  id: PlayerId;
}

/**
 * Why a row may be a player of the club:
 *
 * - `same_name_and_birth_date`: the same normalized first name, last name
 *   and birth date (an exact match);
 * - `swapped_names`: first and last name swapped, same birth date;
 * - `same_last_name_and_birth_date`: same last name and birth date, another
 *   first name (a nickname, a second name);
 * - `similar_name`: the full name within two edits, same birth date (a typo);
 * - `same_name_close_birth_date`: the same full name with the birth date a
 *   few days off or with day and month swapped (a typo in the date).
 */
export const ROSTER_MATCH_REASONS = [
  'same_name_and_birth_date',
  'swapped_names',
  'same_last_name_and_birth_date',
  'similar_name',
  'same_name_close_birth_date',
] as const;
export type RosterMatchReason = (typeof ROSTER_MATCH_REASONS)[number];

export interface RosterMatch {
  playerId: PlayerId;
  /** `exact`: the same person for sure; `possible`: someone has to decide. */
  kind: 'exact' | 'possible';
  reason: RosterMatchReason;
}

/** Most edits between two full names for {@link RosterMatchReason} `similar_name`. */
export const SIMILAR_NAME_MAX_EDITS = 2;
/** Most days between two birth dates for `same_name_close_birth_date`. */
export const CLOSE_BIRTH_DATE_MAX_DAYS = 31;

/** Whether `a` is `b` with day and month swapped (`03/05` typed as `05/03`). */
function swappedDayMonth(a: LocalDate, b: LocalDate): boolean {
  const [ya, ma, da] = a.split('-');
  const [yb, mb, db] = b.split('-');
  return ya === yb && ma === db && da === mb && ma !== da;
}

interface NormalizedPerson {
  first: string;
  last: string;
  full: string;
  birthDate: LocalDate;
  sport: Sport;
}

function normalized(person: RosterPerson): NormalizedPerson {
  const first = normalizePersonName(person.firstName);
  const last = normalizePersonName(person.lastName);
  return {
    first,
    last,
    full: `${last} ${first}`,
    birthDate: person.birthDate,
    sport: person.sport,
  };
}

/** The reason `row` may be `player`, the strongest one, or `undefined`. */
function matchReason(
  row: NormalizedPerson,
  player: NormalizedPerson,
): RosterMatchReason | undefined {
  if (row.sport !== player.sport) return undefined;
  const sameBirth = compareLocalDates(row.birthDate, player.birthDate) === 0;
  if (sameBirth) {
    if (row.first === player.first && row.last === player.last) return 'same_name_and_birth_date';
    if (row.first === player.last && row.last === player.first) return 'swapped_names';
    if (row.last === player.last) return 'same_last_name_and_birth_date';
    if (
      boundedEditDistance(row.full, player.full, SIMILAR_NAME_MAX_EDITS) <= SIMILAR_NAME_MAX_EDITS
    ) {
      return 'similar_name';
    }
    return undefined;
  }
  if (row.full === player.full) {
    const days = Math.abs(daysBetween(row.birthDate, player.birthDate));
    if (days <= CLOSE_BIRTH_DATE_MAX_DAYS || swappedDayMonth(row.birthDate, player.birthDate)) {
      return 'same_name_close_birth_date';
    }
  }
  return undefined;
}

const REASON_ORDER = new Map(ROSTER_MATCH_REASONS.map((reason, index) => [reason, index]));

/**
 * The club players a row may be, strongest first (exact matches before
 * possible ones). An index over the club's players: build it once per
 * import and look every row up.
 */
export class RosterMatcher {
  private readonly players: { id: PlayerId; person: NormalizedPerson }[];

  constructor(players: readonly RosterPlayer[]) {
    this.players = players.map((p) => ({ id: p.id, person: normalized(p) }));
  }

  matches(row: RosterPerson): RosterMatch[] {
    const person = normalized(row);
    const found: RosterMatch[] = [];
    for (const player of this.players) {
      const reason = matchReason(person, player.person);
      if (reason === undefined) continue;
      found.push({
        playerId: player.id,
        kind: reason === 'same_name_and_birth_date' ? 'exact' : 'possible',
        reason,
      });
    }
    return found.sort(
      (a, b) =>
        (REASON_ORDER.get(a.reason) ?? 0) - (REASON_ORDER.get(b.reason) ?? 0) ||
        a.playerId.localeCompare(b.playerId),
    );
  }
}

/** Key of a person within one spreadsheet: two rows with the same key are the same person. */
export function rosterPersonKey(person: RosterPerson): string {
  const n = normalized(person);
  return `${n.sport}|${n.last}|${n.first}|${n.birthDate}`;
}
