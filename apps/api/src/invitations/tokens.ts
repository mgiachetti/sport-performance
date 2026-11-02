import { createHash, randomBytes } from 'node:crypto';
import type { InvitationLinks, InvitationStatus } from '@sport-performance/contracts';

/** 256 random bits, base64url without padding (43 characters). */
export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What the database stores: lowercase hex SHA-256 of the token. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface InvitationLinkOptions {
  /** `https://app.example.com` (no trailing slash). */
  webAppUrl: string;
  /** `sportperformance`. */
  appScheme: string;
}

/**
 * Links of an invitation. The email carries the universal link (the web
 * route `/invite/<token>`, associated with the app on iOS and Android): it
 * opens the app when installed and the web otherwise. The custom scheme deep
 * link is for sharing from inside the app (QR, WhatsApp).
 */
export function invitationLinks(token: string, options: InvitationLinkOptions): InvitationLinks {
  return {
    app: `${options.appScheme}://invite/${token}`,
    web: `${options.webAppUrl}/invite/${token}`,
  };
}

/** `ana.perez@example.com` → `a***@example.com`: enough to recognize it, not to harvest it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email.slice(0, 1)}***${email.slice(at)}`;
}

export interface InvitationState {
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly revokedAt: Date | null;
}

/** Status of an invitation at `now`. Accepted and revoked are final; expiry applies to the rest. */
export function invitationStatus(invitation: InvitationState, now: Date): InvitationStatus {
  if (invitation.acceptedAt !== null) return 'accepted';
  if (invitation.revokedAt !== null) return 'revoked';
  if (invitation.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}
