import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { TransactionClient } from '../db/database.js';
import { usageRange } from '../routes/usage.js';
import { HttpError } from './errors.js';
import { recordUsage, usageClientOf } from './usage.js';

const day = (value: string) => value as Parameters<typeof usageRange>[0];

function fakeTx(failOn: string | null) {
  const statements: string[] = [];
  const tx = {
    query: vi.fn((text: string) => {
      statements.push(text);
      if (failOn !== null && text.includes(failOn)) {
        return Promise.reject(Object.assign(new Error('boom'), { code: '42501' }));
      }
      return Promise.resolve({ rows: [] });
    }),
  } as unknown as TransactionClient;
  return { tx, statements };
}

function fakeLog() {
  const warn = vi.fn();
  return { log: { warn } as unknown as FastifyBaseLogger, warn };
}

describe('recordUsage', () => {
  it('records the surface and client in a savepoint', async () => {
    const { tx, statements } = fakeTx(null);
    const { log, warn } = fakeLog();
    await recordUsage(tx, 'panel', 'web', log);
    expect(statements).toEqual([
      'savepoint usage_record',
      'select app.record_usage($1, $2)',
      'release savepoint usage_record',
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('never fails the request: rolls the savepoint back and logs without data', async () => {
    const { tx, statements } = fakeTx('record_usage');
    const { log, warn } = fakeLog();
    await expect(recordUsage(tx, 'kiosk', 'app', log)).resolves.toBeUndefined();
    expect(statements.at(-1)).toBe('rollback to savepoint usage_record');
    expect(warn).toHaveBeenCalledWith(
      { surface: 'kiosk', code: '42501' },
      'usage record failed; the request goes on',
    );
  });
});

describe('usageClientOf', () => {
  const request = (headers: Record<string, string>) => ({ headers }) as unknown as FastifyRequest;

  it('is the app with the client headers of the app, the web otherwise', () => {
    expect(usageClientOf(request({}))).toBe('web');
    expect(
      usageClientOf(request({ 'x-client-platform': 'android', 'x-client-version': '1.2.3' })),
    ).toBe('app');
    expect(usageClientOf(request({ 'x-client-platform': 'windows' }))).toBe('web');
  });
});

describe('usageRange', () => {
  it('ends with the week of the day asked for, Monday to Sunday', () => {
    expect(usageRange(day('2026-11-04'), undefined, 2)).toEqual({
      today: '2026-11-04',
      weekStarts: ['2026-10-26', '2026-11-02'],
      from: '2026-10-26',
      to: '2026-11-08',
    });
    expect(usageRange(day('2026-11-04'), day('2026-10-18'), 1).weekStarts).toEqual(['2026-10-12']);
  });

  it('rejects a week that has not started', () => {
    expect(() => usageRange(day('2026-11-04'), day('2026-11-09'), 1)).toThrow(HttpError);
    expect(usageRange(day('2026-11-04'), day('2026-11-08'), 1).weekStarts).toEqual(['2026-11-02']);
  });
});
