import { parseClubId, parseUserId } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { tenantContextOf } from '../auth/context.js';
import { testAuthContext } from '../testing/support.js';
import {
  ANONYMOUS_CONTEXT,
  TenantContextError,
  transactionParameters,
  type TenantContext,
} from './tenant-context.js';

const clubId = parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f');
const userId = parseUserId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10');

const settingsOf = (context: TenantContext) => transactionParameters(context).settings;

describe('transactionParameters', () => {
  it('maps a club context to the settings', () => {
    expect(settingsOf({ clubId, userId, role: 'coach' })).toEqual([
      clubId,
      userId,
      'coach',
      '',
      '',
    ]);
  });

  it('uses empty strings for missing values', () => {
    expect(settingsOf(ANONYMOUS_CONTEXT)).toEqual(['', '', '', '', '']);
    expect(settingsOf({ clubId: null, userId, role: null })).toEqual(['', userId, '', '', '']);
  });

  it('carries the request id and a trimmed change reason', () => {
    expect(
      transactionParameters(
        { clubId, userId, role: 'sc' },
        { requestId: 'req-12345678', changeReason: '  Se cargó mal  ' },
      ),
    ).toEqual({
      settings: [clubId, userId, 'sc', 'req-12345678', 'Se cargó mal'],
      supportReason: null,
    });
  });

  it('needs a support reason and a request id for a superadmin, in a club or on the registry', () => {
    const inClub = { clubId, userId, role: 'superadmin' } as const;
    const registry = { clubId: null, userId, role: 'superadmin' } as const;
    for (const context of [inClub, registry]) {
      expect(() => transactionParameters(context, { requestId: 'req-12345678' })).toThrow(
        TenantContextError,
      );
      expect(() => transactionParameters(context, { supportReason: 'Soporte' })).toThrow(
        TenantContextError,
      );
      expect(
        transactionParameters(context, { requestId: 'req-12345678', supportReason: ' Soporte ' })
          .supportReason,
      ).toBe('Soporte');
    }
    expect(
      transactionParameters(registry, { requestId: 'r', supportReason: 'x' }).settings,
    ).toEqual(['', userId, 'superadmin', 'r', '']);
  });

  it.each([
    ['a request id with spaces', { requestId: 'req 1' }],
    ['a request id too long', { requestId: 'r'.repeat(129) }],
    ['a blank change reason', { changeReason: '   ' }],
    ['a change reason too long', { changeReason: 'x'.repeat(501) }],
    ['a support reason for another role', { supportReason: 'Soporte' }],
  ])('rejects %s', (_name, settings) => {
    expect(() => transactionParameters({ clubId, userId, role: 'admin' }, settings)).toThrow(
      TenantContextError,
    );
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
    expect(() => transactionParameters(context as unknown as TenantContext)).toThrow(
      TenantContextError,
    );
  });
});

describe('tenantContextOf', () => {
  it('derives the context from the auth context', () => {
    expect(tenantContextOf(null)).toEqual(ANONYMOUS_CONTEXT);
    expect(tenantContextOf(testAuthContext(userId))).toEqual({
      clubId: null,
      userId,
      role: null,
    });
    expect(tenantContextOf(testAuthContext(userId, { clubId, role: 'medical' }))).toEqual({
      clubId,
      userId,
      role: 'medical',
    });
  });
});
