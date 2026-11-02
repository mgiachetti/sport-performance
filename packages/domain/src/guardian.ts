import { memberGuard, memberParser } from './enum.js';
import type { PlayerId } from './ids.js';

/**
 * Relationship of a guardian with the player (B-310). `packages/db` builds
 * the `guardian_relationship` enum from this constant, so a value is never
 * renamed.
 */
export const GUARDIAN_RELATIONSHIPS = ['mother', 'father', 'legal_guardian', 'other'] as const;
export type GuardianRelationship = (typeof GUARDIAN_RELATIONSHIPS)[number];

export const isGuardianRelationship = memberGuard(GUARDIAN_RELATIONSHIPS);
export const parseGuardianRelationship = memberParser(
  GUARDIAN_RELATIONSHIPS,
  'invalid_argument',
  'guardian relationship',
);

/**
 * Domain of the accounts of players without email (B-310, ADR 0042). A
 * player who signs in with a code issued by their guardian gets an account
 * whose address is `player.<player id>@no-email.invalid`: `.invalid` is
 * reserved (RFC 2606), so no email can ever be delivered there, and the API
 * never sends sign-in codes to it. The player takes the account over with
 * their own email later (B-311).
 */
export const NO_EMAIL_ACCOUNT_DOMAIN = 'no-email.invalid';

/** The address of the account without email of a player. */
export function noEmailAccountAddress(playerId: PlayerId): string {
  return `player.${playerId}@${NO_EMAIL_ACCOUNT_DOMAIN}`;
}

/**
 * Whether an address cannot receive email: an account without email, or any
 * other reserved `.invalid` domain (RFC 2606). Case-insensitive.
 */
export function isUndeliverableEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  return domain === 'invalid' || domain.endsWith('.invalid');
}
