import {
  ApiContractError,
  ApiError,
  ApiNetworkError,
  CONTRACT_VERSION,
  ERROR_CODES,
} from '@sport-performance/contracts';
import { isMessageKey } from '@sport-performance/i18n';
import { describe, expect, it, vi } from 'vitest';
import { createFakeApi, reply } from '../test/fake-api';
import { ClubSelectionStore, selectionKey, supportReasonHeader } from './club-selection';
import { createWebApiClient } from './client';
import { ConnectionStore, connectionStatus, isWebOutdated } from './connection';
import {
  ERROR_MESSAGE_KEYS,
  describeError,
  isSessionExpired,
  isTransientError,
  retryDelayMs,
} from './errors';
import { fetchAllPages } from './queries';

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    data,
  };
}

const MEMBERSHIP = '0192e7a0-1111-7000-8000-000000000001';
const CLUB = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';

function apiError(
  status: number,
  code: string,
  extra: Partial<{ retryAfterS: number; operationId: string }> = {},
) {
  return new ApiError({
    operationId: extra.operationId ?? 'getMe',
    status,
    code,
    message: 'm',
    requestId: 'req-1',
    retryAfterS: extra.retryAfterS,
  });
}

describe('club selection', () => {
  it('remembers the membership and sends it as X-Membership-Id', () => {
    const local = memoryStorage();
    const store = new ClubSelectionStore({ local, session: memoryStorage() });
    expect(store.get()).toBeNull();
    expect(store.headers()).toEqual({});
    store.select({ kind: 'membership', membershipId: MEMBERSHIP as never });
    expect(store.headers()).toEqual({ 'x-membership-id': MEMBERSHIP });
    expect(new ClubSelectionStore({ local, session: memoryStorage() }).get()).toEqual({
      kind: 'membership',
      membershipId: MEMBERSHIP,
    });
  });

  it('keeps support mode in the tab only, percent-encodes the reason and falls back on exit', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    const store = new ClubSelectionStore({ local, session });
    store.select({ kind: 'membership', membershipId: MEMBERSHIP as never });
    store.select({ kind: 'support', clubId: CLUB as never, reason: 'Ticket 12: no ve la M15' });
    expect(store.headers()).toEqual({
      'x-support-club-id': CLUB,
      'x-support-reason': 'Ticket%2012%3A%20no%20ve%20la%20M15',
    });
    expect(local.data.get('sp.web.support')).toBeUndefined();
    expect(new ClubSelectionStore({ local, session }).get()?.kind).toBe('support');
    expect(new ClubSelectionStore({ local, session: memoryStorage() }).get()?.kind).toBe(
      'membership',
    );
    store.clearSupport();
    expect(store.get()).toEqual({ kind: 'membership', membershipId: MEMBERSHIP });
    expect(selectionKey(store.get())).toBe(`membership:${MEMBERSHIP}`);
  });

  it('ignores tampered or unreadable storage', () => {
    const local = memoryStorage();
    local.setItem('sp.web.membership', '{"membershipId":"not-a-uuid"}');
    const session = memoryStorage();
    session.setItem('sp.web.support', '{not json');
    expect(new ClubSelectionStore({ local, session }).get()).toBeNull();
    expect(new ClubSelectionStore({ local: null, session: null }).get()).toBeNull();
  });

  it('encodes non-ASCII reasons', () => {
    expect(supportReasonHeader('Revisión ñandú')).toEqual({
      'x-support-reason': 'Revisi%C3%B3n%20%C3%B1and%C3%BA',
    });
  });
});

describe('web API client', () => {
  it('sends the cookie, the club headers and feeds the connection store', async () => {
    const fake = createFakeApi('https://api.test', {
      getHealth: () =>
        reply(
          200,
          { status: 'ok', version: '1', time: '2026-11-01T00:00:00Z' },
          { 'x-api-version': '0.9.0' },
        ),
    });
    const selection = new ClubSelectionStore({ local: memoryStorage(), session: memoryStorage() });
    selection.select({ kind: 'membership', membershipId: MEMBERSHIP as never });
    const connection = new ConnectionStore({ browserOnline: true, now: () => 42 });
    const api = createWebApiClient({
      baseUrl: 'https://api.test',
      selection,
      connection,
      fetch: fake.fetch,
    });
    await api.getHealth();
    expect(fake.calls[0]?.credentials).toBe('include');
    expect(fake.calls[0]?.headers['x-membership-id']).toBe(MEMBERSHIP);
    expect(connection.get()).toMatchObject({ lastResponseAt: 42, serverContractVersion: '0.9.0' });
  });

  it('marks the API unreachable when there is no response, but not on abort', async () => {
    const connection = new ConnectionStore({ browserOnline: true });
    const selection = new ClubSelectionStore({ local: null, session: null });
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(abort)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const api = createWebApiClient({ baseUrl: 'https://api.test', selection, connection, fetch });
    await expect(api.getHealth()).rejects.toBeInstanceOf(ApiNetworkError);
    expect(connectionStatus(connection.get())).toBe('online');
    await expect(api.getHealth()).rejects.toBeInstanceOf(ApiNetworkError);
    expect(connectionStatus(connection.get())).toBe('unreachable');
    connection.reportResponse(null);
    expect(connectionStatus(connection.get())).toBe('online');
    connection.setBrowserOnline(false);
    expect(connectionStatus(connection.get())).toBe('offline');
  });
});

describe('error envelope', () => {
  it('has a message for every error code of the contract', () => {
    for (const code of ERROR_CODES) {
      expect(isMessageKey(ERROR_MESSAGE_KEYS[code]), code).toBe(true);
    }
  });

  it('describes API, network, contract and unknown errors', () => {
    expect(describeError(apiError(409, 'conflict'))).toEqual({
      kind: 'api',
      messageKey: 'error.code.conflict',
      code: 'conflict',
      status: 409,
      requestId: 'req-1',
    });
    expect(describeError(apiError(418, 'brand_new_code')).messageKey).toBe(
      'error.code.bad_request',
    );
    expect(describeError(apiError(599, 'brand_new_code')).messageKey).toBe('error.generic');
    expect(describeError(new ApiNetworkError('getMe', new TypeError('x'))).messageKey).toBe(
      'error.network',
    );
    expect(
      describeError(new ApiContractError({ operationId: 'getMe', side: 'response', message: 'm' }))
        .messageKey,
    ).toBe('error.contract');
    expect(describeError(new Error('boom'))).toEqual({
      kind: 'unknown',
      messageKey: 'error.generic',
    });
  });

  it('treats a 401 as an expired session except in the sign-in', () => {
    expect(isSessionExpired(apiError(401, 'unauthenticated'))).toBe(true);
    expect(
      isSessionExpired(apiError(401, 'unauthenticated', { operationId: 'verifySignInCode' })),
    ).toBe(false);
    expect(isSessionExpired(apiError(403, 'forbidden'))).toBe(false);
  });

  it('retries only transient errors, honouring Retry-After', () => {
    expect(isTransientError(new ApiNetworkError('getMe', new TypeError('x')))).toBe(true);
    expect(isTransientError(apiError(503, 'service_unavailable'))).toBe(true);
    expect(isTransientError(apiError(500, 'internal_error'))).toBe(false);
    expect(isTransientError(apiError(404, 'not_found'))).toBe(false);
    expect(isTransientError(apiError(429, 'rate_limited'))).toBe(false);
    expect(isTransientError(apiError(429, 'rate_limited', { retryAfterS: 5 }))).toBe(true);
    expect(retryDelayMs(0, apiError(429, 'rate_limited', { retryAfterS: 5 }))).toBe(5000);
    expect(retryDelayMs(0, new Error('x'))).toBe(1000);
    expect(retryDelayMs(10, new Error('x'))).toBe(30_000);
  });
});

describe('connection', () => {
  it('flags a tab built for another contract (major or minor)', () => {
    expect(isWebOutdated(null)).toBe(false);
    expect(isWebOutdated(CONTRACT_VERSION)).toBe(false);
    expect(isWebOutdated('0.2.7', '0.2.0')).toBe(false);
    expect(isWebOutdated('0.3.0', '0.2.0')).toBe(true);
    expect(isWebOutdated('1.2.0', '0.2.0')).toBe(true);
    expect(isWebOutdated('garbage', '0.2.0')).toBe(false);
  });

  it('follows the browser online/offline events', () => {
    const connection = new ConnectionStore({ browserOnline: true });
    const detach = connection.attach(window);
    const onLine = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    expect(connection.get().browserOnline).toBe(false);
    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    expect(connection.get().browserOnline).toBe(true);
    detach();
    onLine.mockRestore();
  });
});

describe('fetchAllPages', () => {
  it('follows the cursor and refuses a runaway one', async () => {
    const pages = [
      { items: [1, 2], nextCursor: 'a' },
      { items: [3], nextCursor: null },
    ];
    const cursors: (string | undefined)[] = [];
    await expect(
      fetchAllPages((cursor) => {
        cursors.push(cursor);
        return Promise.resolve(pages[cursors.length - 1] ?? { items: [], nextCursor: null });
      }),
    ).resolves.toEqual([1, 2, 3]);
    expect(cursors).toEqual([undefined, 'a']);
    await expect(
      fetchAllPages(() => Promise.resolve({ items: [0], nextCursor: 'again' }), 3),
    ).rejects.toThrow(/More than 3 pages/);
  });
});
