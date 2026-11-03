import { describe, expect, it } from 'vitest';
import { listClubSupportAccess, listSupportAccess, supportAccessEntrySchema } from '../index.js';

describe('support access endpoints', () => {
  it('list newest first by default, up to the page limit', () => {
    expect(listSupportAccess.query.parse({})).toEqual({ limit: 50 });
    expect(listClubSupportAccess.query.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('the period must start before it ends', () => {
    const period = { from: '2026-11-02T03:00:00.000Z', to: '2026-11-01T03:00:00.000Z' };
    expect(listSupportAccess.query.safeParse(period).success).toBe(false);
    expect(listClubSupportAccess.query.safeParse(period).success).toBe(false);
    expect(listSupportAccess.query.safeParse({ from: period.to, to: period.from }).success).toBe(
      true,
    );
  });

  it('only the registry filters by club', () => {
    const clubId = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';
    expect(listSupportAccess.query.safeParse({ clubId }).success).toBe(true);
    expect(listClubSupportAccess.query.safeParse({ clubId }).success).toBe(false);
  });

  it('an entry of the registry has no club', () => {
    const entry = {
      id: '0192e7a0-9999-7000-8000-000000000001',
      startedAt: '2026-11-01T12:00:00.000Z',
      operator: { userId: '0192e7a0-0000-7000-8000-000000000099', name: null, email: null },
      club: null,
      reason: 'Alta del club',
      requestId: 'req-1',
    };
    expect(supportAccessEntrySchema.safeParse(entry).success).toBe(true);
    expect(supportAccessEntrySchema.safeParse({ ...entry, reason: '' }).success).toBe(false);
  });
});
