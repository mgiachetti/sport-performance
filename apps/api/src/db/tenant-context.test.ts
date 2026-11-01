import { parseClubId, parseUserId } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { tenantContextOf } from '../auth/context.js';
import {
  ANONYMOUS_CONTEXT,
  TenantContextError,
  tenantContextParameters,
  type TenantContext,
} from './tenant-context.js';

const clubId = parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f');
const userId = parseUserId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10');

describe('tenantContextParameters', () => {
  it('maps a club context to the three settings', () => {
    expect(tenantContextParameters({ clubId, userId, role: 'coach' })).toEqual([
      clubId,
      userId,
      'coach',
    ]);
  });

  it('uses empty strings for missing values', () => {
    expect(tenantContextParameters(ANONYMOUS_CONTEXT)).toEqual(['', '', '']);
    expect(tenantContextParameters({ clubId: null, userId, role: null })).toEqual(['', userId, '']);
  });

  it.each([
    ['a club id that is not a UUID', { clubId: "x'; drop table club; --", userId, role: 'admin' }],
    ['an uppercase UUID', { clubId: clubId.toUpperCase(), userId, role: 'admin' }],
    ['a user id that is not a UUID', { clubId: null, userId: 'nobody', role: null }],
    ['an unknown role', { clubId, userId, role: 'owner' }],
    ['a club without role', { clubId, userId, role: null }],
    ['a role without club', { clubId: null, userId, role: 'admin' }],
    ['a club without user', { clubId, userId: null, role: 'admin' }],
  ])('rejects %s', (_name, context) => {
    expect(() => tenantContextParameters(context as unknown as TenantContext)).toThrow(
      TenantContextError,
    );
  });
});

describe('tenantContextOf', () => {
  it('derives the context from the auth context', () => {
    expect(tenantContextOf(null)).toEqual(ANONYMOUS_CONTEXT);
    expect(tenantContextOf({ userId, membership: null })).toEqual({
      clubId: null,
      userId,
      role: null,
    });
    expect(tenantContextOf({ userId, membership: { clubId, role: 'medical' } })).toEqual({
      clubId,
      userId,
      role: 'medical',
    });
  });
});
