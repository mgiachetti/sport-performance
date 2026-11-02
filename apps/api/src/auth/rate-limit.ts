import { createHmac } from 'node:crypto';
import type { Database } from '../db/database.js';
import { ANONYMOUS_CONTEXT } from '../db/tenant-context.js';
import { HttpError } from '../http/errors.js';

/** At most `max` attempts per subject in a fixed window of `windowS` seconds. */
export interface RateLimitRule {
  /** Stable name; part of the stored key (`sign_in_code_email`). */
  readonly name: string;
  readonly max: number;
  readonly windowS: number;
}

/**
 * Limits of the identity flows (ADR 0010, ADR 0028). Each code also has its
 * own budget of attempts (Better Auth's `allowedAttempts`); these limits stop
 * floods across codes, emails and addresses.
 */
export const AUTH_RATE_LIMITS = {
  /** Codes requested for one email. */
  signInCodeByEmail: { name: 'sign_in_code_email', max: 5, windowS: 15 * 60 },
  /** Codes requested from one IP (a club's wifi may sign in a whole team). */
  signInCodeByIp: { name: 'sign_in_code_ip', max: 30, windowS: 15 * 60 },
  /** Codes tried for one email, across codes. */
  verifyByEmail: { name: 'verify_email', max: 10, windowS: 15 * 60 },
  verifyByIp: { name: 'verify_ip', max: 60, windowS: 15 * 60 },
  /** Invitation tokens looked up or accepted from one IP. */
  invitationByIp: { name: 'invitation_ip', max: 30, windowS: 15 * 60 },
  /** Invitations accepted by one signed-in user (on top of the IP limit). */
  invitationAcceptByUser: { name: 'invitation_accept_user', max: 10, windowS: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export type AuthRateLimits = Record<keyof typeof AUTH_RATE_LIMITS, RateLimitRule>;

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Seconds until the window ends (for `Retry-After`). */
  readonly retryAfterS: number;
}

/** Counts one attempt of `subject` (an email, an IP) under `rule`. */
export interface RateLimiter {
  hit(rule: RateLimitRule, subject: string): Promise<RateLimitResult>;
  /** Deletes counters whose window ended; returns how many. */
  prune(): Promise<number>;
}

/**
 * Stored key: rule name + HMAC-SHA-256 of the subject with the auth secret.
 * Emails and IPs never reach the table in clear text, and the keys cannot be
 * reversed by hashing a list of known emails without the secret.
 */
export function rateLimitKey(secret: string, rule: RateLimitRule, subject: string): string {
  const digest = createHmac('sha256', secret)
    .update(`${rule.name}\0${subject}`)
    .digest('base64url');
  return `${rule.name}:${digest}`;
}

const HIT_SQL = `
insert into auth_rate_limit as l (key, count, window_ends_at)
values ($1, 1, now() + make_interval(secs => $2))
on conflict (key) do update set
  count = case when l.window_ends_at <= now() then 1 else l.count + 1 end,
  window_ends_at = case when l.window_ends_at <= now() then excluded.window_ends_at else l.window_ends_at end
returning count, greatest(ceil(extract(epoch from (window_ends_at - now()))), 1)::int as retry_after_s`;

/**
 * Fixed-window counters in Postgres (`auth_rate_limit`): shared by every
 * replica of the API, atomic (one upsert per attempt) and they survive
 * restarts. Runs on Better Auth's connection (`sport_performance_auth`, the
 * only role that reaches the table; ADR 0026, ADR 0028).
 */
export function createPgRateLimiter(db: Database, secret: string): RateLimiter {
  return {
    async hit(rule, subject) {
      const key = rateLimitKey(secret, rule, subject);
      const row = await db.transaction(ANONYMOUS_CONTEXT, async (client) => {
        const result = await client.query<{ count: number; retry_after_s: number }>(HIT_SQL, [
          key,
          rule.windowS,
        ]);
        return result.rows[0];
      });
      if (row === undefined) throw new Error('rate limiter: upsert returned no row');
      return { allowed: row.count <= rule.max, retryAfterS: row.retry_after_s };
    },

    async prune() {
      return db.transaction(ANONYMOUS_CONTEXT, async (client) => {
        const result = await client.query(
          'delete from auth_rate_limit where window_ends_at <= now()',
        );
        return result.rowCount ?? 0;
      });
    },
  };
}

/**
 * Counts one attempt for each `[rule, subject]` and throws `429 rate_limited`
 * with `Retry-After` if any is over its limit. Every counter is hit, even
 * after the first refusal, so a flood keeps the window closed.
 */
export async function enforceRateLimits(
  limiter: RateLimiter,
  checks: readonly (readonly [RateLimitRule, string])[],
): Promise<void> {
  const results = await Promise.all(checks.map(([rule, subject]) => limiter.hit(rule, subject)));
  const refused = results.filter((result) => !result.allowed);
  if (refused.length === 0) return;
  const retryAfterS = Math.max(...refused.map((result) => result.retryAfterS));
  throw new HttpError('rate_limited', 'Too many attempts, try again later', {
    headers: { 'retry-after': String(retryAfterS) },
  });
}
