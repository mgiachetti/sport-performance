import { parseClubId, parseUuid } from '@sport-performance/domain';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../http/errors.js';
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationLinks,
  invitationStatus,
  maskEmail,
} from '../invitations/tokens.js';
import { selectMembership, sessionHeaders } from './authenticate.js';
import type { ActiveMembership } from './identity.js';
import { createOriginGuard } from './origin-guard.js';
import { enforceRateLimits, rateLimitKey, type RateLimiter } from './rate-limit.js';

const membership = (id: string): ActiveMembership => ({
  id: parseUuid(id),
  clubId: parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f'),
  clubSlug: 'orc',
  clubName: 'Olivos Rugby Club',
  role: 'coach',
  startedAt: new Date('2026-01-01T00:00:00.000Z'),
});

const a = membership('11111111-1111-4111-8111-111111111111');
const b = membership('22222222-2222-4222-8222-222222222222');

describe('selectMembership', () => {
  it('implies the only membership without a header', () => {
    expect(selectMembership([a], undefined)).toEqual({ membership: a, rejected: false });
    expect(selectMembership([a], '')).toEqual({ membership: a, rejected: false });
  });

  it('selects nothing without a header when there are none or several', () => {
    expect(selectMembership([], undefined)).toEqual({ membership: null, rejected: false });
    expect(selectMembership([a, b], undefined)).toEqual({ membership: null, rejected: false });
  });

  it('selects the named membership, in any case', () => {
    expect(selectMembership([a, b], b.id.toUpperCase())).toEqual({
      membership: b,
      rejected: false,
    });
  });

  it('rejects an unknown, malformed or repeated header', () => {
    const rejected = { membership: null, rejected: true };
    expect(selectMembership([a], b.id)).toEqual(rejected);
    expect(selectMembership([a], 'orc')).toEqual(rejected);
    expect(selectMembership([a], [a.id, b.id])).toEqual(rejected);
  });
});

describe('sessionHeaders', () => {
  it('hands Better Auth only the cookie and the authorization header', () => {
    const headers = sessionHeaders({
      headers: {
        cookie: 'sp.session_token=x',
        authorization: 'Bearer y',
        'x-forwarded-for': '1.2.3.4',
      },
    } as unknown as FastifyRequest);
    expect([...headers.keys()].sort()).toEqual(['authorization', 'cookie']);
  });
});

describe('origin guard', () => {
  const guard = createOriginGuard(['https://web.example.com']);
  const request = (method: string, headers: Record<string, string>) =>
    ({ method, headers }) as unknown as FastifyRequest;
  const check = (method: string, headers: Record<string, string>) => () => {
    guard(request(method, headers));
  };

  it('rejects state changes with cookies from another origin', () => {
    expect(check('POST', { cookie: 'a=b', origin: 'https://evil.example.com' })).toThrow(HttpError);
    expect(check('DELETE', { cookie: 'a=b', origin: 'null' })).toThrow(HttpError);
  });

  it('lets through trusted origins, safe methods and requests without cookies', () => {
    expect(check('POST', { cookie: 'a=b', origin: 'https://web.example.com' })).not.toThrow();
    expect(check('GET', { cookie: 'a=b', origin: 'https://evil.example.com' })).not.toThrow();
    expect(check('POST', { origin: 'https://evil.example.com' })).not.toThrow();
    expect(check('POST', { cookie: 'a=b' })).not.toThrow();
  });
});

describe('rate limits', () => {
  const rule = { name: 'verify_email', max: 1, windowS: 60 };

  it('keys counters with an HMAC of the subject', () => {
    const key = rateLimitKey('secret', rule, 'ana@example.com');
    expect(key).toMatch(/^verify_email:[A-Za-z0-9_-]{43}$/);
    expect(key).not.toContain('ana');
    expect(rateLimitKey('secret', rule, 'ana@example.com')).toBe(key);
    expect(rateLimitKey('other-secret', rule, 'ana@example.com')).not.toBe(key);
  });

  it('throws 429 with the longest Retry-After when any limit is over', async () => {
    const limiter: RateLimiter = {
      hit: (_rule, subject) =>
        Promise.resolve(
          subject === 'over'
            ? { allowed: false, retryAfterS: 42 }
            : { allowed: true, retryAfterS: 10 },
        ),
      prune: () => Promise.resolve(0),
    };
    await expect(enforceRateLimits(limiter, [[rule, 'ok']])).resolves.toBeUndefined();
    const error = await enforceRateLimits(limiter, [
      [rule, 'ok'],
      [rule, 'over'],
    ]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe('rate_limited');
    expect((error as HttpError).headers).toEqual({ 'retry-after': '42' });
  });
});

describe('invitation tokens', () => {
  it('generates 256-bit base64url tokens and hashes them to hex SHA-256', () => {
    const token = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateInvitationToken()).not.toBe(token);
    expect(hashInvitationToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvitationToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('builds the deep link and the universal link', () => {
    expect(
      invitationLinks('tok', {
        webAppUrl: 'https://app.example.com',
        appScheme: 'sportperformance',
      }),
    ).toEqual({
      app: 'sportperformance://invite/tok',
      web: 'https://app.example.com/invite/tok',
    });
  });

  it('masks emails', () => {
    expect(maskEmail('ana.perez@example.com')).toBe('a***@example.com');
    expect(maskEmail('@example.com')).toBe('***');
  });

  it('derives the status: accepted and revoked are final, then expiry', () => {
    const now = new Date('2026-11-01T12:00:00.000Z');
    const future = new Date('2026-11-02T12:00:00.000Z');
    const past = new Date('2026-10-31T12:00:00.000Z');
    const base = { expiresAt: future, acceptedAt: null, revokedAt: null };
    expect(invitationStatus(base, now)).toBe('pending');
    expect(invitationStatus({ ...base, expiresAt: past }, now)).toBe('expired');
    expect(invitationStatus({ ...base, expiresAt: now }, now)).toBe('expired');
    expect(invitationStatus({ ...base, expiresAt: past, acceptedAt: past }, now)).toBe('accepted');
    expect(invitationStatus({ ...base, revokedAt: past }, now)).toBe('revoked');
  });
});
