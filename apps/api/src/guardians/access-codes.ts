import { createHmac, randomInt } from 'node:crypto';
import {
  PLAYER_ACCESS_CODE_ALPHABET,
  PLAYER_ACCESS_CODE_LENGTH,
  type PlayerAccessCodeStatus,
} from '@sport-performance/contracts';
import type { InvitationLinkOptions } from '../invitations/tokens.js';

/**
 * Player access codes (B-310, ADR 0042): what a guardian reads aloud or
 * shows to their child, typed in the app of a device without a session.
 *
 * - 8 characters of a 31-symbol alphabet without `0 O 1 I L` (~39.6 bits),
 *   drawn with `crypto.randomInt` (uniform, no modulo bias).
 * - Stored as HMAC-SHA-256 with the auth secret, never as is: a plain hash of
 *   40 bits is reversed in minutes from a dump; the HMAC needs the secret.
 * - Compared after normalizing (uppercase, no separators): `k7qm 2xpa`,
 *   `K7QM-2XPA` and `K7QM2XPA` are the same code.
 */

/** A fresh code, without separator (`K7QM2XPA`). */
export function generateAccessCode(): string {
  let code = '';
  for (let i = 0; i < PLAYER_ACCESS_CODE_LENGTH; i += 1) {
    code += PLAYER_ACCESS_CODE_ALPHABET.charAt(randomInt(PLAYER_ACCESS_CODE_ALPHABET.length));
  }
  return code;
}

/** `K7QM2XPA` → `K7QM-2XPA`, as shown to the guardian. */
export function formatAccessCode(code: string): string {
  const half = PLAYER_ACCESS_CODE_LENGTH / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/** The code as typed (contract-validated) → the stored form: uppercase, no separators. */
export function normalizeAccessCode(typed: string): string {
  return typed.replace(/[- ]/g, '').toUpperCase();
}

/** What `player_access_code.code_hash` stores: hex HMAC-SHA-256 with the auth secret. */
export function hashAccessCode(secret: string, normalizedCode: string): string {
  return createHmac('sha256', secret)
    .update(`player_access_code\0${normalizedCode}`, 'utf8')
    .digest('hex');
}

/**
 * Links of an access code: the universal link (`/player-access/<token>` of
 * the web, associated with the app) and the app's deep link, to share on
 * WhatsApp or show as a QR on the guardian's phone.
 */
export function playerAccessLinks(
  token: string,
  options: InvitationLinkOptions,
): { app: string; web: string } {
  return {
    app: `${options.appScheme}://player-access/${token}`,
    web: `${options.webAppUrl}/player-access/${token}`,
  };
}

export interface AccessCodeState {
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly revokedAt: Date | null;
}

/** Status of a code at `now`. Used and revoked are final; expiry applies to the rest. */
export function accessCodeStatus(state: AccessCodeState, now: Date): PlayerAccessCodeStatus {
  if (state.consumedAt !== null) return 'used';
  if (state.revokedAt !== null) return 'revoked';
  if (state.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}
