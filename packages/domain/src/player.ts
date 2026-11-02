import { memberGuard, memberParser } from './enum.js';

/**
 * Vocabularies of the player's profile (B-315). They were database-only
 * enums (`packages/db`) until the API contracts needed them: the values,
 * and therefore the Postgres enums, are the same.
 */

/** Dominant side of a player: foot in rugby, hand (stick side) in hockey. */
export const DOMINANT_SIDES = ['left', 'right', 'both'] as const;
export type DominantSide = (typeof DOMINANT_SIDES)[number];
export const isDominantSide = memberGuard(DOMINANT_SIDES);
export const parseDominantSide = memberParser(DOMINANT_SIDES, 'invalid_argument', 'dominant side');

/**
 * Origin of a parent's height for Khamis-Roche (B-203): measured by the
 * staff or reported (by the guardian, or on a form). A measured height is
 * preferred: a report never replaces it.
 */
export const HEIGHT_SOURCES = ['measured', 'reported'] as const;
export type HeightSource = (typeof HEIGHT_SOURCES)[number];
export const isHeightSource = memberGuard(HEIGHT_SOURCES);
export const parseHeightSource = memberParser(HEIGHT_SOURCES, 'invalid_argument', 'height source');

/** Which biological parent a height belongs to (Khamis-Roche uses both). */
export const PARENTS = ['mother', 'father'] as const;
export type Parent = (typeof PARENTS)[number];
export const isParent = memberGuard(PARENTS);
export const parseParent = memberParser(PARENTS, 'invalid_argument', 'parent');

/**
 * Why a player left the club (baja, B-315):
 *
 * - `graduated`: finished the youth categories (moved up to the first team
 *   or aged out of M19); the history is what the first team receives.
 * - `transferred`: moved to another club.
 * - `quit`: stopped playing.
 * - `other`: anything else (the optional note says what).
 */
export const PLAYER_LEAVE_REASONS = ['graduated', 'transferred', 'quit', 'other'] as const;
export type PlayerLeaveReason = (typeof PLAYER_LEAVE_REASONS)[number];
export const isPlayerLeaveReason = memberGuard(PLAYER_LEAVE_REASONS);
export const parsePlayerLeaveReason = memberParser(
  PLAYER_LEAVE_REASONS,
  'invalid_argument',
  'player leave reason',
);
