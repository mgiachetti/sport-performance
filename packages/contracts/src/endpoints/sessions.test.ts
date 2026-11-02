import { describe, expect, it } from 'vitest';
import {
  activeSessionSchema,
  listMySessions,
  revokeMyOtherSessions,
  revokeMySession,
  verifySignInCode,
  type ActiveSession,
} from './index.js';

const session: ActiveSession = {
  id: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f' as ActiveSession['id'],
  clientType: 'mobile',
  device: { os: 'ios', browser: 'app' },
  createdAt: '2026-11-01T12:00:00.000Z',
  lastUsedAt: '2026-11-01T12:30:00.000Z',
  expiresAt: '2026-12-01T12:30:00.000Z',
  current: false,
};

describe('session endpoints (B-333)', () => {
  it('need a session, not a club', () => {
    for (const endpoint of [listMySessions, revokeMySession, revokeMyOtherSessions]) {
      expect(endpoint.auth).toBe('session');
      expect(endpoint.path.startsWith('/v1/me/sessions')).toBe(true);
    }
    expect(revokeMySession.method).toBe('DELETE');
    expect(revokeMySession.errors).toEqual(['not_found', 'conflict']);
  });

  it('describe a session without IP, user agent or token', () => {
    expect(activeSessionSchema.parse(session)).toEqual(session);
    expect(
      activeSessionSchema.parse({ ...session, device: { os: null, browser: null } }).device,
    ).toEqual({ os: null, browser: null });
    expect(activeSessionSchema.safeParse({ ...session, clientType: 'tv' }).success).toBe(false);
    expect(Object.keys(activeSessionSchema.shape).sort()).toEqual(
      ['clientType', 'createdAt', 'current', 'device', 'expiresAt', 'id', 'lastUsedAt'].sort(),
    );
  });

  it('takes a session id path param, lowercased', () => {
    expect(
      revokeMySession.params.parse({ sessionId: '0192E7A0-5C1A-7B7E-9F3A-2D4C6B8A1E0F' }),
    ).toEqual({ sessionId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f' });
    expect(revokeMySession.params.safeParse({ sessionId: 'token' }).success).toBe(false);
  });

  it('lets mobile name its device when verifying a code', () => {
    const body = { email: 'ana@example.com', code: '012345', transport: 'bearer' };
    expect(verifySignInCode.body.parse(body).deviceId).toBeUndefined();
    expect(
      verifySignInCode.body.parse({ ...body, deviceId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f' })
        .deviceId,
    ).toBe('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f');
    expect(verifySignInCode.body.safeParse({ ...body, deviceId: 'x' }).success).toBe(false);
  });
});
