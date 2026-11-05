import { parseClubId, type PermissionSubject } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../http/errors.js';
import { decodePullCursor, encodePullCursor, pullScopes } from './pull.js';

const CLUB = parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f');
const OTHER = parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10');

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof HttpError ? error.code : 'other';
  }
  return undefined;
}

describe('pull cursor', () => {
  it('starts from the beginning without a cursor', () => {
    expect(decodePullCursor(undefined, CLUB, 'f')).toEqual({
      at: { txid: null, seq: null },
      reset: false,
    });
  });

  it('round-trips a position', () => {
    const cursor = encodePullCursor(CLUB, 'f', { txid: '12345', seq: 9 });
    expect(decodePullCursor(cursor, CLUB, 'f')).toEqual({
      at: { txid: '12345', seq: 9 },
      reset: false,
    });
    const largest = encodePullCursor(CLUB, 'f', { txid: '18446744073709551615', seq: 0 });
    expect(decodePullCursor(largest, CLUB, 'f').at).toEqual({
      txid: '18446744073709551615',
      seq: 0,
    });
    const start = encodePullCursor(CLUB, 'f', { txid: null, seq: null });
    expect(decodePullCursor(start, CLUB, 'f').at).toEqual({ txid: null, seq: null });
  });

  it('restarts with reset when what the caller sees changed', () => {
    const cursor = encodePullCursor(CLUB, 'before', { txid: '12345', seq: 9 });
    expect(decodePullCursor(cursor, CLUB, 'after')).toEqual({
      at: { txid: null, seq: null },
      reset: true,
    });
  });

  it('restarts with reset when the cursor is past the next txid (a restored database, ADR 0094)', () => {
    const cursor = encodePullCursor(CLUB, 'f', { txid: '12345', seq: 9 });
    // The server will assign 12345 next: the cursor read a transaction this history lacks.
    expect(decodePullCursor(cursor, CLUB, 'f', '12345')).toEqual({
      at: { txid: null, seq: null },
      reset: true,
    });
    expect(decodePullCursor(cursor, CLUB, 'f', '900')).toEqual({
      at: { txid: null, seq: null },
      reset: true,
    });
    expect(decodePullCursor(cursor, CLUB, 'f', '12346')).toEqual({
      at: { txid: '12345', seq: 9 },
      reset: false,
    });
    const start = encodePullCursor(CLUB, 'f', { txid: null, seq: null });
    expect(decodePullCursor(start, CLUB, 'f', '1')).toEqual({
      at: { txid: null, seq: null },
      reset: false,
    });
  });

  it('rejects a malformed cursor or one of another club', () => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    for (const cursor of [
      'nope',
      encode(null),
      encode({ v: 2, c: CLUB, f: 'f', x: null, s: null }),
      encode({ v: 1, c: CLUB, f: 'f', x: '1; drop table', s: 1 }),
      encode({ v: 1, c: CLUB, f: 'f', x: '1', s: 1.5 }),
      encode({ v: 1, c: CLUB, f: 'f', x: '1', s: null }),
      encode({ v: 1, c: CLUB, f: 'f', x: '18446744073709551616', s: 1 }),
      encode({ v: 1, c: CLUB, f: 'f', x: '99999999999999999999', s: 1 }),
      encode({ v: 1, c: CLUB, f: 'f', x: '1', s: -1 }),
    ]) {
      expect(
        code(() => decodePullCursor(cursor, CLUB, 'f')),
        cursor,
      ).toBe('bad_request');
    }
    const theirs = encodePullCursor(OTHER, 'f', { txid: '1', seq: 1 });
    expect(code(() => decodePullCursor(theirs, CLUB, 'f'))).toBe('bad_request');
  });
});

describe('pull scopes', () => {
  const base = { userId: 'u1' as PermissionSubject['userId'], clubId: CLUB };

  it('serves each role only the collections the matrix lets it read', () => {
    const all = [
      'wellness',
      'participation',
      'training_session',
      'test_session',
      'test_result',
      'external_load',
    ] as const;
    const player = pullScopes({ ...base, role: 'player', playerId: null }, all);
    expect([...player.keys()]).toEqual([]);
    const own = pullScopes(
      { ...base, role: 'player', playerId: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e11' as never },
      all,
    );
    expect([...own.keys()]).toEqual(['wellness', 'participation', 'test_result', 'external_load']);
    expect([...pullScopes({ ...base, role: 'parent', guardianships: [] }, all).keys()]).toEqual([]);
    expect([...pullScopes({ ...base, role: 'admin' }, all).keys()]).toEqual([...all]);
    expect([...pullScopes({ ...base, role: 'admin' }, ['test_result']).keys()]).toEqual([
      'test_result',
    ]);
    // A coach without assignments sees nothing (an empty scope, not an error).
    expect([...pullScopes({ ...base, role: 'coach', assignments: [] }, all).keys()]).toEqual([]);
  });
});
