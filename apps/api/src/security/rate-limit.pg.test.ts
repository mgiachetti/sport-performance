/**
 * General rate limits (ADR 0031) on the Postgres store of ADR 0028, with the
 * real `sport_performance_auth` login: one statement per request, HMAC keys,
 * per user and per IP.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  createTestDatabase,
  signIn,
  startIdentityApp,
  type IdentityTestApp,
  type TestDatabase,
} from '../testing/identity.js';
import { describeWithPostgres } from '../testing/support.js';

interface Envelope {
  error: { code: string };
}

describeWithPostgres('general rate limits on Postgres', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      routeClassLimits: {
        read: {
          perIp: { name: 'api_read_ip', max: 1000, windowS: 60 },
          perUser: { name: 'api_read_user', max: 3, windowS: 60 },
        },
      },
    });
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('counts several counters in one call, once per distinct key, atomically', async () => {
    const rule = { name: 'api_test_multi', max: 2, windowS: 60 };
    const other = { name: 'api_test_other', max: 1, windowS: 30 };
    const first = await t.auth.rateLimiter.hit([
      [rule, 'a'],
      [rule, 'a'],
      [other, 'a'],
    ]);
    expect(first.map((result) => result.allowed)).toEqual([true, true, true]);
    expect(first[2]?.retryAfterS).toBeLessThanOrEqual(30);
    const parallel = await Promise.all(
      Array.from({ length: 5 }, () => t.auth.rateLimiter.hit([[rule, 'b']])),
    );
    expect(parallel.flat().filter((result) => result.allowed)).toHaveLength(2);
    expect(await t.auth.rateLimiter.hit([])).toEqual([]);
  });

  it('limits a signed-in user per minute with 429 and Retry-After', async () => {
    const ana = await signIn(t, 'ana.limites@example.com', 'bearer');
    for (let i = 0; i < 3; i += 1) {
      expect((await t.app.inject({ url: '/v1/me', headers: ana.headers })).statusCode).toBe(200);
    }
    const limited = await t.app.inject({ url: '/v1/me', headers: ana.headers });
    expect(limited.statusCode).toBe(429);
    expect(limited.json<Envelope>().error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);

    // Another user from the same IP keeps their own budget.
    const beto = await signIn(t, 'beto.limites@example.com', 'bearer');
    expect((await t.app.inject({ url: '/v1/me', headers: beto.headers })).statusCode).toBe(200);
  });

  it('stores only HMAC keys: no user id or IP in clear text', async () => {
    const rows = await database.admin.query<{ key: string }>(
      "select key from auth_rate_limit where key like 'api_%'",
    );
    expect(rows.rows.map((row) => row.key.split(':')[0])).toEqual(
      expect.arrayContaining(['api_read_user', 'api_read_ip', 'api_auth_ip']),
    );
    for (const { key } of rows.rows) {
      expect(key).toMatch(/^api_[a-z_]+:[A-Za-z0-9_-]{43}$/);
      expect(key).not.toContain('127.0.0.1');
    }
  });
});
