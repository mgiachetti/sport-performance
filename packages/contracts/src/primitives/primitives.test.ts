import { describe, expect, expectTypeOf, it } from 'vitest';
import { hexColorSchema } from './color.js';
import type { ClubId, LocalDate, TimeZone, Uuid } from '@sport-performance/domain';
import { dateTimeSchema, localDateSchema, timeZoneSchema } from './dates.js';
import { clubIdSchema, idOf, slugSchema, uuidSchema } from './ids.js';
import { PAGE_LIMIT_DEFAULT, PAGE_LIMIT_MAX, pageOf, pageQuerySchema } from './pagination.js';
import { z } from 'zod';

describe('ids', () => {
  it('accepts RFC 9562 UUIDs (v4 and v7)', () => {
    expect(uuidSchema.safeParse('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f').success).toBe(true);
    expect(uuidSchema.safeParse('3f2504e0-4f89-41d3-9a0c-0305e82c3301').success).toBe(true);
    expect(idOf('player').safeParse('3F2504E0-4F89-41D3-9A0C-0305E82C3301').success).toBe(true);
  });

  it('parses into the canonical lowercase domain ids', () => {
    const id = clubIdSchema.parse('3F2504E0-4F89-41D3-9A0C-0305E82C3301');
    expect(id).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expectTypeOf(id).toEqualTypeOf<ClubId>();
    expectTypeOf(uuidSchema.parse(id)).toEqualTypeOf<Uuid>();
  });

  it('rejects malformed ids', () => {
    for (const value of ['', '42', 'not-a-uuid', '3f2504e04f8941d39a0c0305e82c3301']) {
      expect(uuidSchema.safeParse(value).success).toBe(false);
    }
  });

  it('accepts lowercase hyphenated slugs only', () => {
    for (const value of ['orc', 'olivos-rugby', 'm19', 'a1-b2']) {
      expect(slugSchema.safeParse(value).success).toBe(true);
    }
    for (const value of ['o', 'ORC', 'olivos_rugby', '-orc', 'orc-', 'or--c', 'a'.repeat(64)]) {
      expect(slugSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('dates', () => {
  it('accepts ISO 8601 date-times with zone', () => {
    for (const value of [
      '2026-11-01T12:00:00.000Z',
      '2026-11-01T12:00:00Z',
      '2026-11-01T09:00:00-03:00',
      new Date(0).toISOString(),
    ]) {
      expect(dateTimeSchema.safeParse(value).success).toBe(true);
    }
  });

  it('rejects date-times without zone or invalid', () => {
    for (const value of [
      '2026-11-01T12:00:00',
      '2026-11-01',
      '01/11/2026',
      '2026-13-01T00:00:00Z',
    ]) {
      expect(dateTimeSchema.safeParse(value).success).toBe(false);
    }
  });

  it('accepts calendar dates as YYYY-MM-DD', () => {
    expect(localDateSchema.safeParse('2026-11-01').success).toBe(true);
    expect(localDateSchema.safeParse('2028-02-29').success).toBe(true);
    for (const value of [
      '2026-02-30',
      '0000-01-01',
      '01/11/2026',
      '2026-11-01T00:00:00Z',
      '20261101',
    ]) {
      expect(localDateSchema.safeParse(value).success, value).toBe(false);
    }
    expectTypeOf(localDateSchema.parse('2026-11-01')).toEqualTypeOf<LocalDate>();
  });

  it('validates IANA time zones', () => {
    expect(timeZoneSchema.safeParse('America/Argentina/Buenos_Aires').success).toBe(true);
    expect(timeZoneSchema.safeParse('UTC').success).toBe(true);
    expectTypeOf(timeZoneSchema.parse('UTC')).toEqualTypeOf<TimeZone>();
    for (const value of [
      'Mars/Olympus_Mons',
      '',
      'Etc/GMT+3',
      'EST',
      'america/argentina/buenos_aires',
    ]) {
      expect(timeZoneSchema.safeParse(value).success, value).toBe(false);
    }
  });
});

describe('hexColorSchema', () => {
  it('accepts #RRGGBB in any case', () => {
    expect(hexColorSchema.safeParse('#F1882A').success).toBe(true);
    expect(hexColorSchema.safeParse('#f1882a').success).toBe(true);
  });

  it('rejects shorthand, alpha and named colors', () => {
    for (const value of ['#FFF', '#F1882AFF', 'F1882A', 'orange', '#GGGGGG']) {
      expect(hexColorSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('pagination', () => {
  it('defaults the limit and coerces query strings', () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: PAGE_LIMIT_DEFAULT });
    expect(pageQuerySchema.parse({ limit: '20', cursor: 'abc' })).toEqual({
      limit: 20,
      cursor: 'abc',
    });
  });

  it('bounds the limit', () => {
    expect(pageQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ limit: PAGE_LIMIT_MAX + 1 }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ limit: 1.5 }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
  });

  it('builds page schemas around an item schema', () => {
    const page = pageOf(z.object({ id: uuidSchema }));
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    expect(page.parse({ items: [{ id }], nextCursor: null })).toEqual({
      items: [{ id }],
      nextCursor: null,
    });
    expect(page.safeParse({ items: [{ id: 'x' }], nextCursor: null }).success).toBe(false);
    expect(page.safeParse({ items: [] }).success).toBe(false);
  });
});
