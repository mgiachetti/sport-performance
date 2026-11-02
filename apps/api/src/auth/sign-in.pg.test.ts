/**
 * Sign-in with a code by email (Better Auth email OTP) end to end against
 * Postgres 16: codes, attempts, sessions by cookie and bearer, sign-out, rate
 * limits, superadmin and the CSRF origin guard.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { describeWithPostgres } from '../testing/support.js';
import {
  cookieHeader,
  createTestDatabase,
  lastCode,
  signIn,
  startIdentityApp,
  TEST_WEB_ORIGIN,
  type IdentityTestApp,
  type TestDatabase,
} from '../testing/identity.js';

interface Envelope {
  error: { code: string };
}

describeWithPostgres('sign-in with email OTP (Better Auth + Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let n = 0;
  /** A fresh email per test: rate limits and codes never leak between tests. */
  let email: string;

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database);
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  beforeEach(() => {
    n += 1;
    email = `jugador${String(n)}@example.com`;
  });

  const send = (address = email) =>
    t.app.inject({ method: 'POST', url: '/v1/auth/email-otp', payload: { email: address } });
  const verify = (code: string, transport?: 'cookie' | 'bearer', address = email) =>
    t.app.inject({
      method: 'POST',
      url: '/v1/auth/email-otp/verify',
      payload: { email: address, code, ...(transport !== undefined && { transport }) },
    });

  it('sends a 6-digit code in Rioplatense Spanish, HTML and text', async () => {
    const response = await send();
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ expiresInS: 300 });
    const message = t.emails.lastTo(email);
    expect(message?.subject).toMatch(/^\d{6} es tu código para ingresar$/);
    expect(message?.html).toContain('lang="es-AR"');
    expect(message?.html).toContain(lastCode(t.emails, email));
    expect(message?.text).toContain('Vence en 5 minutos');
  });

  it('stores the code hashed, never in clear text', async () => {
    await send();
    const code = lastCode(t.emails, email);
    const rows = await database.admin.query<{ value: string }>(
      'select value from verification where identifier = $1',
      [`sign-in-otp-${email}`],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.value).not.toContain(code);
  });

  it('creates the account on first sign-in and opens a cookie session for the web', async () => {
    await send('Mixed.Case@Example.com');
    const code = lastCode(t.emails, 'mixed.case@example.com');
    const response = await verify(code, undefined, 'Mixed.Case@Example.com');
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      user: { id: string; email: string; isSuperadmin: boolean };
      session: { token: string | null; expiresAt: string };
    }>();
    expect(body.user).toMatchObject({ email: 'mixed.case@example.com', isSuperadmin: false });
    expect(body.session.token).toBeNull();
    expect(new Date(body.session.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 29 * 24 * 3600 * 1000,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    const stored = await database.admin.query<{ expires_at: Date }>(
      'select expires_at from session where user_id = $1',
      [body.user.id],
    );
    expect(body.session.expiresAt).toBe(stored.rows[0]?.expires_at.toISOString());

    const session = response.cookies.find((c) => c.name === 'sp.session_token');
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    const user = await database.admin.query<{ email_verified: boolean }>(
      'select email_verified from "user" where id = $1',
      [body.user.id],
    );
    expect(user.rows[0]?.email_verified).toBe(true);

    const me = await t.app.inject({ url: '/v1/me', headers: { cookie: cookieHeader(response) } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: { id: body.user.id, email: 'mixed.case@example.com', isSuperadmin: false },
      activeMembership: null,
    });
  });

  it('gives mobile a bearer token and no cookie', async () => {
    await send();
    const response = await verify(lastCode(t.emails, email), 'bearer');
    expect(response.statusCode).toBe(200);
    expect(response.cookies).toEqual([]);
    const token = response.json<{ session: { token: string } }>().session.token;
    expect(token.length).toBeGreaterThan(20);

    const me = await t.app.inject({ url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.cookies).toEqual([]);

    const forged = await t.app.inject({
      url: '/v1/me',
      headers: { authorization: `Bearer ${token.slice(0, -2)}xx` },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('rejects a wrong code and burns the code after 3 wrong attempts', async () => {
    await send();
    const code = lastCode(t.emails, email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await verify(wrong);
      expect(response.statusCode).toBe(401);
      expect(response.json<Envelope>().error.code).toBe('unauthenticated');
    }
    const exhausted = await verify(code);
    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.json<Envelope>().error.code).toBe('rate_limited');
    // The burnt code is gone: a new one has to be requested.
    expect((await verify(code)).statusCode).toBe(401);
    await send();
    expect((await verify(lastCode(t.emails, email))).statusCode).toBe(200);
  });

  it('accepts a code once', async () => {
    await send();
    const code = lastCode(t.emails, email);
    expect((await verify(code)).statusCode).toBe(200);
    expect((await verify(code)).statusCode).toBe(401);
  });

  it('rejects an expired code', async () => {
    await send();
    const code = lastCode(t.emails, email);
    await database.admin.query(
      "update verification set expires_at = now() - interval '1 second' where identifier = $1",
      [`sign-in-otp-${email}`],
    );
    const response = await verify(code);
    expect(response.statusCode).toBe(401);
    expect(response.json<Envelope>().error.code).toBe('unauthenticated');
  });

  it('invalidates the previous code when a new one is requested', async () => {
    await send();
    const first = lastCode(t.emails, email);
    await send();
    const second = lastCode(t.emails, email);
    if (first !== second) expect((await verify(first)).statusCode).toBe(401);
    expect((await verify(second)).statusCode).toBe(200);
  });

  it('validates the body against the contract', async () => {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/email-otp/verify',
      payload: { email: 'not-an-email', code: '12ab' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<Envelope>().error.code).toBe('validation_failed');
  });

  it('signs out a cookie session and a bearer session', async () => {
    const web = await signIn(t, email);
    const out = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-out',
      headers: web.headers,
    });
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((c) => c.name === 'sp.session_token')?.maxAge).toBe(0);
    expect((await t.app.inject({ url: '/v1/me', headers: web.headers })).statusCode).toBe(401);

    const mobile = await signIn(t, email, 'bearer');
    expect(
      (await t.app.inject({ method: 'POST', url: '/v1/auth/sign-out', headers: mobile.headers }))
        .statusCode,
    ).toBe(204);
    expect((await t.app.inject({ url: '/v1/me', headers: mobile.headers })).statusCode).toBe(401);
  });

  it('answers unauthenticated without a session', async () => {
    const response = await t.app.inject({ url: '/v1/me' });
    expect(response.statusCode).toBe(401);
    const signOut = await t.app.inject({ method: 'POST', url: '/v1/auth/sign-out' });
    expect(signOut.statusCode).toBe(401);
  });

  it('exposes the superadmin flag, which users cannot set themselves', async () => {
    const caller = await signIn(t, email);
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      caller.userId,
    ]);
    const me = await t.app.inject({ url: '/v1/me', headers: caller.headers });
    expect(me.json()).toMatchObject({ user: { isSuperadmin: true } });
  });

  it('rejects cookie requests that change state from an untrusted origin', async () => {
    const caller = await signIn(t, email);
    const evil = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-out',
      headers: { ...caller.headers, origin: 'https://evil.example.com' },
    });
    expect(evil.statusCode).toBe(403);
    expect((await t.app.inject({ url: '/v1/me', headers: caller.headers })).statusCode).toBe(200);

    const web = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/sign-out',
      headers: { ...caller.headers, origin: TEST_WEB_ORIGIN },
    });
    expect(web.statusCode).toBe(204);
  });

  it('answers CORS preflights only for the web origins, with credentials', async () => {
    const preflight = (origin: string) =>
      t.app.inject({
        method: 'OPTIONS',
        url: '/v1/me',
        headers: {
          origin,
          'access-control-request-method': 'GET',
          'access-control-request-headers': 'x-membership-id',
        },
      });
    const allowed = await preflight(TEST_WEB_ORIGIN);
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(String(allowed.headers['access-control-allow-headers'])).toContain('x-membership-id');
    const denied = await preflight('https://evil.example.com');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers 503 when the email cannot be sent', async () => {
    t.emails.failing = true;
    try {
      const response = await send();
      expect(response.statusCode).toBe(503);
      expect(response.json<Envelope>().error.code).toBe('service_unavailable');
    } finally {
      t.emails.failing = false;
    }
  });
});

describeWithPostgres('sign-in rate limits (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      limits: {
        signInCodeByEmail: { name: 'sign_in_code_email', max: 2, windowS: 600 },
        verifyByIp: { name: 'verify_ip', max: 3, windowS: 600 },
      },
    });
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('limits codes per email and answers Retry-After', async () => {
    const send = () =>
      t.app.inject({
        method: 'POST',
        url: '/v1/auth/email-otp',
        payload: { email: 'limited@example.com' },
      });
    expect((await send()).statusCode).toBe(202);
    expect((await send()).statusCode).toBe(202);
    const limited = await send();
    expect(limited.statusCode).toBe(429);
    expect(limited.json<Envelope>().error.code).toBe('rate_limited');
    const retryAfter = Number(limited.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(500);
    expect(retryAfter).toBeLessThanOrEqual(600);
    // Another email from the same IP is not affected by the per-email limit.
    const other = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/email-otp',
      payload: { email: 'other@example.com' },
    });
    expect(other.statusCode).toBe(202);
  });

  it('limits verification attempts per IP across emails', async () => {
    const verify = (address: string) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/auth/email-otp/verify',
        payload: { email: address, code: '000000' },
      });
    for (const address of ['a@example.com', 'b@example.com', 'c@example.com']) {
      expect((await verify(address)).statusCode).toBe(401);
    }
    expect((await verify('d@example.com')).statusCode).toBe(429);
  });

  it('keys the counters with an HMAC: no email or IP in clear text', async () => {
    const rows = await database.admin.query<{ key: string; count: number }>(
      'select key, count from auth_rate_limit',
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const row of rows.rows) {
      expect(row.key).toMatch(/^[a-z_]+:[A-Za-z0-9_-]{43}$/);
      expect(row.key).not.toContain('example.com');
      expect(row.key).not.toContain('127.0.0.1');
    }
  });

  it('prunes ended windows', async () => {
    await database.admin.query(
      "update auth_rate_limit set window_ends_at = now() - interval '1 second'",
    );
    expect(await t.auth.rateLimiter.prune()).toBeGreaterThan(0);
    const rows = await database.admin.query('select 1 from auth_rate_limit');
    expect(rows.rowCount).toBe(0);
  });
});

describeWithPostgres('secure cookies over https (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      config: { baseUrl: 'https://api.example.com', secureCookies: true },
    });
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('sets a __Secure- cookie with the Secure attribute', async () => {
    const caller = await signIn(t, 'secure@example.com');
    expect(caller.headers.cookie).toMatch(/^__Secure-sp\.session_token=/);
    const me = await t.app.inject({ url: '/v1/me', headers: caller.headers });
    expect(me.statusCode).toBe(200);
  });
});

describeWithPostgres('invitation accept limit per user (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      limits: {
        invitationAcceptByUser: { name: 'invitation_accept_user', max: 2, windowS: 600 },
      },
    });
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('counts accepts per signed-in user, not only per IP', async () => {
    const one = await signIn(t, 'uno@example.com');
    const two = await signIn(t, 'dos@example.com');
    const accept = (caller: { headers: Record<string, string> }) =>
      t.app.inject({
        method: 'POST',
        url: '/v1/invitations/accept',
        headers: caller.headers,
        payload: { token: 'A'.repeat(43) },
      });
    expect((await accept(one)).statusCode).toBe(404);
    expect((await accept(one)).statusCode).toBe(404);
    expect((await accept(one)).statusCode).toBe(429);
    // Same IP, another user: their own budget.
    expect((await accept(two)).statusCode).toBe(404);
  });
});
