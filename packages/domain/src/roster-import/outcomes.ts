import type { PlayerId } from '../ids.js';

/**
 * What the roster import did with each row (B-330, ADR 0047). Stored with
 * the import (`roster_import.outcomes`) as the record of who was created or
 * updated: ids and outcomes only, never names or emails.
 */

/**
 * The decision for a row:
 *
 * - `create`: a new player (rows without a match, by default);
 * - `skip`: nothing changes in the profile (exact matches, by default);
 *   the guardians are still linked to the matched player;
 * - `update`: merge into a matched player (dominant side, positions, a
 *   category when they have none).
 */
export const ROSTER_IMPORT_ACTIONS = ['create', 'skip', 'update'] as const;
export type RosterImportAction = (typeof ROSTER_IMPORT_ACTIONS)[number];

/** What happened to a row: the past of {@link RosterImportAction}. */
export const ROSTER_ROW_RESULTS = ['created', 'skipped', 'updated'] as const;
export type RosterRowResult = (typeof ROSTER_ROW_RESULTS)[number];

/**
 * What happened (or, in the preview, will happen) to a guardian of a row:
 *
 * - `linked`: the email is an active `parent` of the club, linked now;
 * - `already_linked`: that `parent` already had an open link;
 * - `invitation_pending`: an open invitation to that email for the player
 *   already exists;
 * - `invite`: nobody with that email is a `parent` of the club: an
 *   invitation has to be sent (the result lists it; the import sends no
 *   email);
 * - `skipped`: nobody to link: the row was skipped without a matched
 *   player, or the matched player left the club (restore them first).
 */
export const ROSTER_GUARDIAN_OUTCOMES = [
  'linked',
  'already_linked',
  'invitation_pending',
  'invite',
  'skipped',
] as const;
export type RosterGuardianOutcome = (typeof ROSTER_GUARDIAN_OUTCOMES)[number];

/** The stored outcome of one row. */
export interface RosterImportRowOutcome {
  /** Index of the row in the request. */
  index: number;
  /** Row of the spreadsheet, if the client sent it. */
  sourceRow: number | null;
  result: RosterRowResult;
  /** The created, updated or matched player; `null` for a skipped row without a match. */
  playerId: PlayerId | null;
  /** Outcome of each guardian of the row, in order. */
  guardians: RosterGuardianOutcome[];
}
