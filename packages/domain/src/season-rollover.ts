import { DEFAULT_AGE_BANDS, ageInSeasonYear, type AgeBand } from './category.js';
import { memberGuard, memberParser } from './enum.js';
import type { CategoryId, PlayerId } from './ids.js';
import type { Sex } from './sex.js';
import { localDateParts, type LocalDate } from './time.js';

/**
 * Season change (B-316, ADR 0049): at the start of a season every player of
 * the sport moves to the category of their birth year, after a manual review
 * by the administration. This module is the proposal, pure: the API (and the
 * worker, once it schedules drafts) store it, the staff reviews it and the
 * application of the reviewed draft writes `player_category`.
 */

/** Life cycle of a season change: a draft under review, applied once, or cancelled. */
export const SEASON_ROLLOVER_STATUSES = ['draft', 'applied', 'cancelled'] as const;
export type SeasonRolloverStatus = (typeof SEASON_ROLLOVER_STATUSES)[number];
export const isSeasonRolloverStatus = memberGuard(SEASON_ROLLOVER_STATUSES);
export const parseSeasonRolloverStatus = memberParser(
  SEASON_ROLLOVER_STATUSES,
  'invalid_argument',
  'season rollover status',
);

/**
 * Why the proposal for a player is what it is:
 *
 * - `birth_year`: moves to the only active category of their branch for the
 *   age band of their birth year.
 * - `already_there`: they are already in that category on the effective day.
 * - `ambiguous`: the branch has more than one active category for the band
 *   (the club split it, "M15 A" and "M15 B"): the staff picks one.
 * - `no_category`: the band exists but the branch has no active category for it.
 * - `aged_out`: older than every youth band; leaving (`graduated`) is a
 *   decision of the administration, not of the season change.
 * - `too_young`: younger than every band.
 */
export const SEASON_ROLLOVER_PROPOSALS = [
  'birth_year',
  'already_there',
  'ambiguous',
  'no_category',
  'aged_out',
  'too_young',
] as const;
export type SeasonRolloverProposal = (typeof SEASON_ROLLOVER_PROPOSALS)[number];
export const isSeasonRolloverProposal = memberGuard(SEASON_ROLLOVER_PROPOSALS);
export const parseSeasonRolloverProposal = memberParser(
  SEASON_ROLLOVER_PROPOSALS,
  'invalid_argument',
  'season rollover proposal',
);

/** What the application does with a player: move to a category, or leave them as they are. */
export const SEASON_ROLLOVER_DECISIONS = ['move', 'stay'] as const;
export type SeasonRolloverDecision = (typeof SEASON_ROLLOVER_DECISIONS)[number];
export const isSeasonRolloverDecision = memberGuard(SEASON_ROLLOVER_DECISIONS);
export const parseSeasonRolloverDecision = memberParser(
  SEASON_ROLLOVER_DECISIONS,
  'invalid_argument',
  'season rollover decision',
);

/**
 * What applying did with a player, decided on the state at that moment
 * (the draft may be days old):
 *
 * - `moved`: their current categories closed on the effective day and the
 *   new one opened that day.
 * - `stayed`: nothing changed (decision `stay`, or already in the category).
 * - `skipped_left`: they left the club meanwhile.
 * - `skipped_later_membership`: a membership starts on or after the effective
 *   day (a manual pass already done): it is corrected by hand, not overwritten.
 * - `skipped_category_unavailable`: the target category was archived, or no
 *   longer of the player's branch.
 */
export const SEASON_ROLLOVER_OUTCOMES = [
  'moved',
  'stayed',
  'skipped_left',
  'skipped_later_membership',
  'skipped_category_unavailable',
] as const;
export type SeasonRolloverOutcome = (typeof SEASON_ROLLOVER_OUTCOMES)[number];
export const isSeasonRolloverOutcome = memberGuard(SEASON_ROLLOVER_OUTCOMES);
export const parseSeasonRolloverOutcome = memberParser(
  SEASON_ROLLOVER_OUTCOMES,
  'invalid_argument',
  'season rollover outcome',
);

/**
 * The year that decides the categories of a season: the year of its first
 * day. A season is the planning year of the sport (ADR 0036), February to
 * November in Argentina, so it never spans two calendar years there; a club
 * whose season starts in one year and ends in the next counts the first.
 */
export function seasonRolloverYear(season: { readonly startsOn: LocalDate }): number {
  return localDateParts(season.startsOn).year;
}

/** An active category of the sport, as the proposal needs it. */
export interface RolloverCategory {
  readonly id: CategoryId;
  readonly sex: Sex;
  /** The domain age band the category maps to (`m15`). */
  readonly ageBandCode: string;
}

/** A player of the sport, with the categories they are in on the day before the change. */
export interface RolloverPlayer {
  readonly id: PlayerId;
  readonly birthDate: LocalDate;
  readonly sex: Sex;
  readonly currentCategoryIds: readonly CategoryId[];
}

export interface RolloverProposalItem {
  readonly playerId: PlayerId;
  /** `seasonYear − birthYear`. */
  readonly ageInSeasonYear: number;
  /** Band of that age, `null` outside every band. */
  readonly ageBandCode: string | null;
  readonly proposal: SeasonRolloverProposal;
  /** The category the proposal moves to (`birth_year`) or keeps (`already_there`). */
  readonly proposedCategoryId: CategoryId | null;
  /** Default decision: `move` only for `birth_year`. */
  readonly decision: SeasonRolloverDecision;
  /**
   * The administration has to look at it before applying: the proposal is
   * not automatic, the player plays in more than one category, or the move
   * would take them down a band (they played up).
   */
  readonly needsReview: boolean;
}

export interface SeasonRolloverInput<B extends AgeBand = AgeBand> {
  readonly seasonYear: number;
  readonly players: readonly RolloverPlayer[];
  /** Active categories of the season's sport (every branch). */
  readonly categories: readonly RolloverCategory[];
  /** Youth bands, youngest first; {@link DEFAULT_AGE_BANDS} by default. */
  readonly bands?: readonly B[];
}

/**
 * The proposal of a season change, one item per player, in input order.
 * A category whose `ageBandCode` is not one of `bands` is never proposed.
 */
export function proposeSeasonRollover(input: SeasonRolloverInput): RolloverProposalItem[] {
  const bands: readonly AgeBand[] = input.bands ?? DEFAULT_AGE_BANDS;
  const bandOrder = new Map(bands.map((band, index) => [band.code, index]));
  const categoryById = new Map(input.categories.map((c) => [c.id, c]));
  const youngest = Math.min(...bands.map((b) => b.minAgeInSeasonYear));

  return input.players.map((player): RolloverProposalItem => {
    const birthYear = localDateParts(player.birthDate).year;
    const age = ageInSeasonYear(birthYear, input.seasonYear);
    const band = bands.find((b) => age >= b.minAgeInSeasonYear && age <= b.maxAgeInSeasonYear);
    const playsInSeveral = player.currentCategoryIds.length > 1;
    const base = { playerId: player.id, ageInSeasonYear: age, ageBandCode: band?.code ?? null };

    if (band === undefined) {
      return {
        ...base,
        proposal: age < youngest ? 'too_young' : 'aged_out',
        proposedCategoryId: null,
        decision: 'stay',
        needsReview: true,
      };
    }
    const candidates = input.categories.filter(
      (c) => c.sex === player.sex && c.ageBandCode === band.code,
    );
    const [only, ...rest] = candidates;
    if (only === undefined || rest.length > 0) {
      return {
        ...base,
        proposal: only === undefined ? 'no_category' : 'ambiguous',
        proposedCategoryId: null,
        decision: 'stay',
        needsReview: true,
      };
    }
    if (player.currentCategoryIds.includes(only.id)) {
      return {
        ...base,
        proposal: 'already_there',
        proposedCategoryId: only.id,
        decision: 'stay',
        needsReview: playsInSeveral,
      };
    }
    const target = bandOrder.get(band.code) ?? 0;
    const movesDown = player.currentCategoryIds.some((id) => {
      const code = categoryById.get(id)?.ageBandCode;
      const order = code === undefined ? undefined : bandOrder.get(code);
      return order !== undefined && order > target;
    });
    return {
      ...base,
      proposal: 'birth_year',
      proposedCategoryId: only.id,
      decision: 'move',
      needsReview: playsInSeveral || movesDown,
    };
  });
}
