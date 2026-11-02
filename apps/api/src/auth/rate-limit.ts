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
  /**
   * Player access codes typed from one IP (B-310, ADR 0042). A code has ~40
   * bits and lives 15 minutes; with these limits guessing any open code is
   * out of reach (see the ADR).
   */
  playerAccessCodeByIp: { name: 'player_access_code_ip', max: 10, windowS: 15 * 60 },
  /**
   * Player access codes typed across the whole platform (subject `all`):
   * bounds a guess distributed over many IPs. Only the code: the link
   * (256-bit token) cannot be guessed and keeps working under a flood.
   */
  playerAccessCodeGlobal: { name: 'player_access_code_all', max: 1000, windowS: 15 * 60 },
  /** Player access links opened from one IP. */
  playerAccessLinkByIp: { name: 'player_access_link_ip', max: 30, windowS: 15 * 60 },
  /** Access codes and player invitations a guardian (or admin) issues. */
  playerAccessIssueByUser: { name: 'player_access_issue_user', max: 20, windowS: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export type AuthRateLimits = Record<keyof typeof AUTH_RATE_LIMITS, RateLimitRule>;

export interface RateLimitResult {
  readonly allowed: boolean;
  /** Seconds until the window ends (for `Retry-After`). */
  readonly retryAfterS: number;
}

/** One counter to hit: a rule and its subject (an email, an IP, a user id). */
export type RateLimitCheck = readonly [rule: RateLimitRule, subject: string];

/**
 * Store of fixed-window counters. Pluggable: the API uses Postgres
 * ({@link createPgRateLimiter}); tests use memory ({@link createMemoryRateLimiter}).
 */
export interface RateLimiter {
  /**
   * Counts one attempt for each check, atomically per counter and in one
   * round trip, and returns the results in the same order. Checks with the
   * same rule and subject are counted once.
   */
  hit(checks: readonly RateLimitCheck[]): Promise<RateLimitResult[]>;
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

/** Every counter of a request in one statement: one row per key of `$1`, window of `$2`. */
const HIT_SQL = `
insert into auth_rate_limit as l (key, count, window_ends_at)
select t.key, 1, now() + make_interval(secs => t.window_s)
from unnest($1::text[], $2::int[]) as t(key, window_s)
on conflict (key) do update set
  count = case when l.window_ends_at <= now() then 1 else l.count + 1 end,
  window_ends_at = case when l.window_ends_at <= now() then excluded.window_ends_at else l.window_ends_at end
returning key, count, greatest(ceil(extract(epoch from (window_ends_at - now()))), 1)::int as retry_after_s`;

/** Distinct stored keys of `checks`, with the window of their rule. */
function keysOf(secret: string, checks: readonly RateLimitCheck[]) {
  const windows = new Map<string, number>();
  const keys = checks.map(([rule, subject]) => {
    const key = rateLimitKey(secret, rule, subject);
    windows.set(key, rule.windowS);
    return { key, max: rule.max };
  });
  return { keys, windows };
}

/**
 * Fixed-window counters in Postgres (`auth_rate_limit`): shared by every
 * replica of the API, atomic (one upsert per attempt) and they survive
 * restarts. Runs on Better Auth's connection (`sport_performance_auth`, the
 * only role that reaches the table; ADR 0026, ADR 0028).
 */
export function createPgRateLimiter(db: Database, secret: string): RateLimiter {
  return {
    async hit(checks) {
      if (checks.length === 0) return [];
      const { keys, windows } = keysOf(secret, checks);
      const rows = await db.transaction(ANONYMOUS_CONTEXT, async (client) => {
        const result = await client.query<{ key: string; count: number; retry_after_s: number }>(
          HIT_SQL,
          [[...windows.keys()], [...windows.values()]],
        );
        return new Map(result.rows.map((row) => [row.key, row]));
      });
      return keys.map(({ key, max }) => {
        const row = rows.get(key);
        if (row === undefined) throw new Error('rate limiter: upsert returned no row');
        return { allowed: row.count <= max, retryAfterS: row.retry_after_s };
      });
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
 * Counters in the memory of one process, same semantics as Postgres. Only
 * for tests and tools: with more than one replica each would count apart
 * (ADR 0028).
 */
export function createMemoryRateLimiter(
  secret: string,
  now: () => number = Date.now,
): RateLimiter & { readonly size: () => number } {
  const counters = new Map<string, { count: number; windowEndsAtMs: number }>();
  return {
    hit(checks) {
      const { keys, windows } = keysOf(secret, checks);
      const at = now();
      const rows = new Map<string, { count: number; windowEndsAtMs: number }>();
      for (const [key, windowS] of windows) {
        const current = counters.get(key);
        const next =
          current === undefined || current.windowEndsAtMs <= at
            ? { count: 1, windowEndsAtMs: at + windowS * 1000 }
            : { count: current.count + 1, windowEndsAtMs: current.windowEndsAtMs };
        counters.set(key, next);
        rows.set(key, next);
      }
      return Promise.resolve(
        keys.map(({ key, max }) => {
          const row = rows.get(key) ?? { count: 0, windowEndsAtMs: at };
          return {
            allowed: row.count <= max,
            retryAfterS: Math.max(Math.ceil((row.windowEndsAtMs - at) / 1000), 1),
          };
        }),
      );
    },
    prune() {
      const at = now();
      let pruned = 0;
      for (const [key, value] of counters) {
        if (value.windowEndsAtMs <= at) {
          counters.delete(key);
          pruned += 1;
        }
      }
      return Promise.resolve(pruned);
    },
    size: () => counters.size,
  };
}

/** `429 rate_limited` with the longest `Retry-After` of the refused results, if any. */
export function rateLimitError(results: readonly RateLimitResult[]): HttpError | undefined {
  const refused = results.filter((result) => !result.allowed);
  if (refused.length === 0) return undefined;
  const retryAfterS = Math.max(...refused.map((result) => result.retryAfterS));
  return new HttpError('rate_limited', 'Too many attempts, try again later', {
    headers: { 'retry-after': String(retryAfterS) },
  });
}

/**
 * Counts one attempt for each `[rule, subject]` and throws `429 rate_limited`
 * with `Retry-After` if any is over its limit. Every counter is hit, even
 * after the first refusal, so a flood keeps the window closed.
 */
export async function enforceRateLimits(
  limiter: RateLimiter,
  checks: readonly RateLimitCheck[],
): Promise<void> {
  const error = rateLimitError(await limiter.hit(checks));
  if (error !== undefined) throw error;
}
