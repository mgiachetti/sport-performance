import { ROLES, type PermissionSubject } from '@sport-performance/domain';
import { createTheme } from '@sport-performance/ui-tokens';
import { describe, expect, it } from 'vitest';
import { STAFF_ROLES, buildActiveClub, isStaffRole } from '../club/active-club';
import { parseScopeSearch, resolveScope, scopeToSearch } from '../club/scope';
import { InvalidWebEnvError, parseWebEnv } from '../env';
import { navItem, visibleNavItems } from '../layout/navigation';
import { canSomewhere } from '../permissions/permissions';
import { parseClubsSearch, parseLoginSearch, safeRedirect } from '../routing/redirect';
import * as fixtures from '../test/fixtures';
import { ThemeStore, applyTheme, resolveVariant, themeFor } from '../theme/theme-store';

describe('env', () => {
  it('accepts the API origin and strips the trailing slash', () => {
    expect(parseWebEnv({ VITE_API_URL: 'https://api.example.com/' }, true)).toEqual({
      apiUrl: 'https://api.example.com',
    });
    expect(parseWebEnv({ VITE_API_URL: 'http://localhost:3000' }, true).apiUrl).toBe(
      'http://localhost:3000',
    );
  });

  it('names the variable when it is missing or unsafe', () => {
    expect(() => parseWebEnv({}, false)).toThrow(/VITE_API_URL is required/);
    expect(() => parseWebEnv({ VITE_API_URL: 'nope' }, false)).toThrow(InvalidWebEnvError);
    expect(() => parseWebEnv({ VITE_API_URL: 'ftp://x' }, false)).toThrow(/http/);
    expect(() => parseWebEnv({ VITE_API_URL: 'http://api.example.com' }, true)).toThrow(/https/);
    expect(() => parseWebEnv({ VITE_API_URL: 'https://api.example.com/?a=1' }, true)).toThrow(
      /query/,
    );
  });
});

describe('redirects', () => {
  it('only goes back to paths of this app', () => {
    expect(safeRedirect('/?category=x')).toBe('/?category=x');
    expect(safeRedirect('https://evil.example')).toBeUndefined();
    expect(safeRedirect('//evil.example')).toBeUndefined();
    expect(safeRedirect('/\\evil.example')).toBeUndefined();
    expect(safeRedirect('/login?redirect=/')).toBeUndefined();
    expect(safeRedirect('/a\nb')).toBeUndefined();
    expect(safeRedirect(42)).toBeUndefined();
  });

  it('parses the sign-in and club selector search', () => {
    expect(parseLoginSearch({ redirect: '//x', expired: 'true' })).toEqual({ expired: true });
    expect(parseClubsSearch({ redirect: '/', unavailable: true })).toEqual({
      redirect: '/',
      unavailable: true,
    });
    expect(parseClubsSearch({ unavailable: 'no' })).toEqual({});
  });
});

describe('scope', () => {
  const all = [fixtures.M15_RUGBY, fixtures.M17_RUGBY, fixtures.F15_HOCKEY];

  it('drops malformed search params', () => {
    expect(parseScopeSearch({ sport: 'polo', category: 'x' })).toEqual({});
    expect(
      parseScopeSearch({ sport: 'rugby', category: fixtures.M15_RUGBY.id.toUpperCase() }),
    ).toEqual({
      sport: 'rugby',
      category: fixtures.M15_RUGBY.id,
    });
  });

  it('offers every visible sport and pins the only one', () => {
    expect(resolveScope(all, {})).toMatchObject({
      sports: ['rugby', 'hockey'],
      sport: null,
      category: null,
    });
    const rugbyOnly = resolveScope([fixtures.M15_RUGBY, fixtures.M17_RUGBY], {});
    expect(rugbyOnly.sport).toBe('rugby');
    expect(scopeToSearch(rugbyOnly)).toEqual({ sport: undefined, category: undefined });
    expect(resolveScope([], {})).toMatchObject({ sports: [], sport: null, categoryOptions: [] });
  });

  it('filters categories by sport and lets a category pin its sport', () => {
    const hockey = resolveScope(all, { sport: 'hockey' });
    expect(hockey.categoryOptions.map((c) => c.name)).toEqual(['Sub 15']);
    const byCategory = resolveScope(all, { category: fixtures.M17_RUGBY.id });
    expect(byCategory).toMatchObject({ sport: 'rugby', ignored: false });
    expect(byCategory.category?.name).toBe('M17');
    expect(scopeToSearch(byCategory)).toEqual({ sport: 'rugby', category: fixtures.M17_RUGBY.id });
  });

  it('ignores what the user does not see', () => {
    const unknown = resolveScope(all, {
      category: '0192e7a0-2222-7000-8000-0000000000ff' as never,
    });
    expect(unknown).toMatchObject({ category: null, ignored: true });
    const mismatch = resolveScope(all, { sport: 'hockey', category: fixtures.M15_RUGBY.id });
    expect(mismatch).toMatchObject({ sport: 'hockey', category: null, ignored: true });
    expect(
      resolveScope([fixtures.M15_RUGBY, fixtures.F15_HOCKEY], { sport: 'rugby' }).ignored,
    ).toBe(false);
  });
});

describe('active club and permissions', () => {
  const base = {
    user: fixtures.USER,
    club: fixtures.club(),
    theme: fixtures.clubTheme(),
    categories: [fixtures.M15_RUGBY, fixtures.M17_RUGBY],
  };

  it('serves only staff roles', () => {
    expect(ROLES.filter(isStaffRole)).toEqual([...STAFF_ROLES]);
    expect(isStaffRole('player')).toBe(false);
    expect(isStaffRole('parent')).toBe(false);
  });

  it('builds the subject from the membership and its assignments', () => {
    const coach = buildActiveClub({
      ...base,
      selection: { kind: 'membership', membershipId: fixtures.membership('coach').id },
      membership: fixtures.membership('coach'),
      assignments: [fixtures.categoryAssignment('coach', fixtures.M15_RUGBY)],
    });
    expect(coach.subject).toEqual({
      userId: fixtures.USER.id,
      role: 'coach',
      clubId: fixtures.ORC_ID,
      assignments: [{ kind: 'category', categoryId: fixtures.M15_RUGBY.id }],
    });
    const support = buildActiveClub({
      ...base,
      selection: { kind: 'support', clubId: fixtures.ORC_ID, reason: 'r' },
      membership: null,
      assignments: [fixtures.categoryAssignment('coach', fixtures.M15_RUGBY)],
    });
    expect(support.role).toBe('superadmin');
    expect(support.subject.assignments).toEqual([]);
  });

  it('gates with the domain matrix: club, category and player resources', () => {
    const coach: PermissionSubject = {
      userId: fixtures.USER.id,
      role: 'coach',
      clubId: fixtures.ORC_ID,
      assignments: [{ kind: 'category', categoryId: fixtures.M15_RUGBY.id }],
    };
    const admin: PermissionSubject = { ...coach, role: 'admin', assignments: [] };
    const categories = [fixtures.M15_RUGBY, fixtures.M17_RUGBY];
    expect(canSomewhere(coach, 'training_session', 'manage', categories)).toBe(true);
    expect(canSomewhere(coach, 'training_session', 'manage', [fixtures.M17_RUGBY])).toBe(false);
    expect(canSomewhere(coach, 'configuration', 'update', categories)).toBe(false);
    expect(canSomewhere(admin, 'configuration', 'update', categories)).toBe(true);
    // Player resources: some player to list (assignments, the club), by the matrix's list scope.
    expect(canSomewhere(admin, 'player_profile', 'read', categories)).toBe(true);
    expect(canSomewhere(coach, 'alert', 'read', categories)).toBe(true);
    expect(canSomewhere({ ...coach, assignments: [] }, 'alert', 'read', categories)).toBe(false);
    expect(canSomewhere({ ...coach, role: 'player' }, 'alert', 'read', categories)).toBe(false);
    expect(canSomewhere({ ...coach, clubId: null }, 'club', 'read', categories)).toBe(false);

    const items = [
      navItem({ to: '/', labelKey: 'nav.home', icon: 'home' }),
      navItem({
        to: '/',
        labelKey: 'nav.home',
        icon: 'club',
        permission: { kind: 'configuration', action: 'update' },
      }),
    ];
    expect(visibleNavItems(items, coach, categories).map((item) => item.icon)).toEqual(['home']);
    expect(visibleNavItems(items, admin, categories).map((item) => item.icon)).toEqual([
      'home',
      'club',
    ]);
  });
});

describe('theme', () => {
  function memoryStorage() {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
  }

  it('resolves the variant from the preference or the system contrast', () => {
    const storage = memoryStorage();
    const store = new ThemeStore({ storage, systemPrefersMoreContrast: false });
    expect(resolveVariant(store.get())).toBe('dark');
    store.setSystemPrefersMoreContrast(true);
    expect(resolveVariant(store.get())).toBe('light-hc');
    store.setPreference('dark');
    expect(resolveVariant(store.get())).toBe('dark');
    expect(new ThemeStore({ storage, systemPrefersMoreContrast: true }).get().preference).toBe(
      'dark',
    );
    store.setPreference('system');
    expect(new ThemeStore({ storage, systemPrefersMoreContrast: true }).get().preference).toBe(
      'system',
    );
  });

  it('takes the club brand and survives an invalid one', () => {
    const store = new ThemeStore({ storage: null, systemPrefersMoreContrast: false });
    store.setBrand({ primary: '#1E88E5', secondary: '#ffffff' });
    expect(store.get().brand).toEqual({ primary: '#1e88e5', secondary: '#ffffff' });
    expect(themeFor(store.get()).color.brand.solid).toBe('#1e88e5');
    store.setBrand({ primary: 'blue', secondary: '#ffffff' });
    expect(store.get().brand.primary).toBe('#f1882a');
  });

  it('applies the variables and data-theme to the element', () => {
    const element = document.createElement('div');
    applyTheme(element, createTheme({ variant: 'light-hc' }));
    expect(element.getAttribute('data-theme')).toBe('light-hc');
    expect(element.style.getPropertyValue('--sp-color-background')).not.toBe('');
  });
});
