import { describe, expect, it } from 'vitest';
import { parseAppLink, redirectSystemPath, routeForAppLink } from './app-links.ts';

// A link token is 43 base64url characters (256 bits); a fixed fake one.
const TOKEN = 'k'.repeat(43);
const origins = { scheme: 'sportperformance', webAppUrl: 'https://app.example.com' };

describe('parseAppLink', () => {
  it('reads invitation and player-access deep links', () => {
    expect(parseAppLink(`sportperformance://invite/${TOKEN}`, origins)).toEqual({
      kind: 'invite',
      token: TOKEN,
    });
    expect(parseAppLink(`sportperformance://player-access/${TOKEN}`, origins)).toEqual({
      kind: 'player-access',
      token: TOKEN,
    });
    // `scheme:///invite/…` (empty host) and a trailing slash also work.
    expect(parseAppLink(`sportperformance:///invite/${TOKEN}/`, origins)).toEqual({
      kind: 'invite',
      token: TOKEN,
    });
  });

  it('reads universal links of the web, ignoring query and fragment', () => {
    expect(parseAppLink(`https://app.example.com/invite/${TOKEN}?utm=x#y`, origins)).toEqual({
      kind: 'invite',
      token: TOKEN,
    });
  });

  it('honours a path prefix of the web', () => {
    const prefixed = { ...origins, webAppUrl: 'https://example.com/staff' };
    expect(parseAppLink(`https://example.com/staff/invite/${TOKEN}`, prefixed)).toEqual({
      kind: 'invite',
      token: TOKEN,
    });
    expect(parseAppLink(`https://example.com/invite/${TOKEN}`, prefixed)).toBeNull();
  });

  it('marks our links with an unknown path or a malformed token as unknown', () => {
    expect(parseAppLink('sportperformance://invite/short', origins)).toEqual({ kind: 'unknown' });
    expect(parseAppLink(`sportperformance://invite/${TOKEN}/extra`, origins)).toEqual({
      kind: 'unknown',
    });
    expect(parseAppLink('sportperformance://settings', origins)).toEqual({ kind: 'unknown' });
    expect(parseAppLink(`https://app.example.com/players/${TOKEN}`, origins)).toEqual({
      kind: 'unknown',
    });
  });

  it('leaves other schemes, hosts and plain http alone', () => {
    expect(parseAppLink(`https://evil.example.com/invite/${TOKEN}`, origins)).toBeNull();
    expect(parseAppLink(`http://app.example.com/invite/${TOKEN}`, origins)).toBeNull();
    expect(
      parseAppLink('exp+sport-performance://expo-development-client/?url=x', origins),
    ).toBeNull();
    expect(parseAppLink('/home', origins)).toBeNull();
    expect(
      parseAppLink(`https://app.example.com/invite/${TOKEN}`, { ...origins, webAppUrl: null }),
    ).toBeNull();
  });
});

describe('redirectSystemPath', () => {
  it('maps our links to their route and anything else of ours home', () => {
    expect(redirectSystemPath(`sportperformance://invite/${TOKEN}`, origins)).toBe(
      `/invite/${TOKEN}`,
    );
    expect(redirectSystemPath('sportperformance://anything', origins)).toBe('/');
    expect(routeForAppLink({ kind: 'player-access', token: TOKEN })).toBe(
      `/player-access/${TOKEN}`,
    );
  });

  it('passes URLs that are not ours unchanged', () => {
    const devClient = 'exp+sport-performance://expo-development-client/?url=http%3A%2F%2Fx';
    expect(redirectSystemPath(devClient, origins)).toBe(devClient);
  });
});
