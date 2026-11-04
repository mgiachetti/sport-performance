import { memberGuard } from './enum.js';

/**
 * Kiosk mode (B-504, ADR 0086): a shared club device where players without
 * a phone of their own load their wellness and session RPE, under the
 * session of a staff member who opened the kiosk.
 */

/**
 * How a self-reported value (wellness, session RPE) reached the club:
 * `player_account`, the player from their own account; `kiosk`, on the
 * club's kiosk. Kept with the value (principle 4: every value keeps how it
 * was taken), stored as `wellness.via_kiosk` / `participation.rpe_via_kiosk`.
 */
export const REPORT_CHANNELS = ['player_account', 'kiosk'] as const;
export type ReportChannel = (typeof REPORT_CHANNELS)[number];
export const isReportChannel = memberGuard(REPORT_CHANNELS);

/** The channel of a stored value from its `via_kiosk` flag. */
export function reportChannelOf(viaKiosk: boolean): ReportChannel {
  return viaKiosk ? 'kiosk' : 'player_account';
}

/**
 * Where a player of the kiosk stands with the RPE of a session: `pending`
 * (nothing reported yet: the kiosk asks it while the window is open),
 * `reported` (already reported, by any channel: the kiosk never corrects),
 * `not_taking_part` (the staff recorded them absent or unavailable: no load).
 */
export const KIOSK_RPE_STATES = ['pending', 'reported', 'not_taking_part'] as const;
export type KioskRpeState = (typeof KIOSK_RPE_STATES)[number];
export const isKioskRpeState = memberGuard(KIOSK_RPE_STATES);
