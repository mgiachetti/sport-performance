import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { memoryLogger, testApp, testAuthContext } from '../testing/support.js';
import { parseUserId } from '@sport-performance/domain';
import {
  databaseUrlProblems,
  estimateEntropyBits,
  MIN_SECRET_ENTROPY_BITS,
  secretProblems,
} from './secrets.js';

describe('secret checks', () => {
  it('estimates entropy: random values pass, repetitive ones do not', () => {
    expect(estimateEntropyBits('')).toBe(0);
    expect(estimateEntropyBits('a'.repeat(100))).toBe(0);
    expect(estimateEntropyBits('ab'.repeat(32))).toBe(64);
    expect(estimateEntropyBits(randomBytes(48).toString('base64'))).toBeGreaterThan(
      MIN_SECRET_ENTROPY_BITS * 1.5,
    );
    expect(estimateEntropyBits(randomBytes(32).toString('hex'))).toBeGreaterThan(
      MIN_SECRET_ENTROPY_BITS,
    );
  });

  it('describes problems without the value', () => {
    expect(secretProblems(randomBytes(48).toString('base64url'))).toEqual([]);
    const short = secretProblems('Zq8!xR2');
    expect(short.join(' ')).toContain('at least 32');
    expect(short.join(' ')).not.toContain('Zq8');
    expect(secretProblems('change-me-to-a-long-random-string-of-48-characters')).toEqual([
      expect.stringContaining('placeholder'),
    ]);
  });

  it('requires a strong password in database URLs', () => {
    const strong = randomBytes(24).toString('base64url');
    expect(databaseUrlProblems(`postgres://api:${strong}@db:5432/x`)).toEqual([]);
    expect(databaseUrlProblems('postgres://api@db:5432/x')).toEqual([
      'needs a password in production',
    ]);
    expect(databaseUrlProblems('postgres://api:short@db:5432/x')[0]).toContain('at least 16');
    expect(databaseUrlProblems('postgres://api:change-me-local-only@db/x').join(' ')).toContain(
      'placeholder',
    );
    expect(databaseUrlProblems('not a url')).toEqual(['is not a valid URL']);
  });
});

describe('log redaction', () => {
  it('censors credentials, secrets and personal data at every known path', () => {
    const logs = memoryLogger();
    const secret = `s3cr3t-${randomBytes(8).toString('hex')}`;
    logs.logger.info(
      {
        headers: { authorization: `Bearer ${secret}`, cookie: `sp.session_token=${secret}` },
        upstream: { 'set-cookie': secret },
        err: { detail: `Key (email)=(${secret})`, where: secret, parameters: [secret] },
        user: { email: secret, password: secret, token: secret, otp: secret },
        auth: { secret, apiKey: secret, resendApiKey: secret, sessionToken: secret },
        session: { accessToken: secret, refreshToken: secret },
        pool: { connectionString: secret, databaseUrl: secret },
        call: { authorization: secret, cookie: secret },
      },
      'everything',
    );
    expect(logs.raw()).not.toContain(secret);
    expect(logs.raw()).toContain('[redacted]');
  });

  it('keeps tokens, cookies, bodies and query strings out of request logs', async () => {
    const { app, logs } = await testApp({
      authenticate: () =>
        Promise.resolve(testAuthContext(parseUserId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e01'))),
      register: (instance) => {
        instance.post('/v1/test/fail', () => {
          throw new Error('boom');
        });
      },
    });
    const token = `tok-${randomBytes(12).toString('hex')}`;
    const response = await app.inject({
      method: 'POST',
      url: `/v1/test/fail?email=${token}%40example.com`,
      headers: {
        authorization: `Bearer ${token}`,
        cookie: `sp.session_token=${token}`,
        'content-type': 'application/json',
      },
      payload: { email: `${token}@example.com`, code: '123456' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain(token);
    expect(logs.raw()).not.toContain(token);
    expect(logs.raw()).not.toContain('123456');
    await app.close();
  });
});
