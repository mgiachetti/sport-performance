import { parseClubId } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { clubThemeSchema, getClubTheme, getHealth, healthSchema, type ClubTheme } from './index.js';

const orcTheme: ClubTheme = {
  clubId: parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f'),
  slug: 'orc',
  name: 'Olivos Rugby Club',
  shortName: 'ORC',
  logoUrl: 'https://assets.example.com/clubs/orc/crest.svg',
  colors: {
    primary: '#F1882A',
    onPrimary: '#050505',
    secondary: '#050505',
    onSecondary: '#F3EEE7',
  },
  updatedAt: '2026-11-01T12:00:00.000Z',
};

describe('getHealth', () => {
  it('is a public GET /v1/health', () => {
    expect(getHealth.method).toBe('GET');
    expect(getHealth.path).toBe('/v1/health');
    expect(getHealth.auth).toBe('public');
  });

  it('validates the health payload', () => {
    const health = { status: 'ok', version: 'a1b2c3d', time: '2026-11-01T12:00:00.000Z' };
    expect(healthSchema.parse(health)).toEqual(health);
    expect(healthSchema.safeParse({ ...health, status: 'degraded' }).success).toBe(false);
    expect(healthSchema.safeParse({ ...health, time: 'now' }).success).toBe(false);
    expect(healthSchema.safeParse({ ...health, version: '' }).success).toBe(false);
  });
});

describe('getClubTheme', () => {
  it('is public and keyed by club slug', () => {
    expect(getClubTheme.path).toBe('/v1/clubs/{clubSlug}/theme');
    expect(getClubTheme.auth).toBe('public');
    expect(getClubTheme.params.parse({ clubSlug: 'orc' })).toEqual({ clubSlug: 'orc' });
    expect(getClubTheme.params.safeParse({ clubSlug: 'ORC' }).success).toBe(false);
    expect(getClubTheme.errors).toContain('not_found');
  });

  it('accepts the ORC theme', () => {
    expect(clubThemeSchema.parse(orcTheme)).toEqual(orcTheme);
    expect(clubThemeSchema.parse({ ...orcTheme, logoUrl: null }).logoUrl).toBeNull();
  });

  it('ignores unknown fields so adding fields is not breaking', () => {
    const parsed = clubThemeSchema.parse({ ...orcTheme, faviconUrl: 'https://x.example/f.png' });
    expect(parsed).toEqual(orcTheme);
  });

  it('rejects invalid branding', () => {
    expect(
      clubThemeSchema.safeParse({ ...orcTheme, logoUrl: 'http://insecure.example/x.svg' }).success,
    ).toBe(false);
    expect(
      clubThemeSchema.safeParse({ ...orcTheme, colors: { ...orcTheme.colors, primary: 'orange' } })
        .success,
    ).toBe(false);
    expect(clubThemeSchema.safeParse({ ...orcTheme, shortName: '' }).success).toBe(false);
    const withoutColors: Partial<ClubTheme> = { ...orcTheme };
    delete withoutColors.colors;
    expect(clubThemeSchema.safeParse(withoutColors).success).toBe(false);
  });
});
