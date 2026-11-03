import { defaultBrand } from '@sport-performance/ui-tokens';
import { describe, expect, it } from 'vitest';
import {
  DEVICE_ID_KEY,
  MEMBERSHIP_ID_KEY,
  SESSION_SNAPSHOT_KEY,
  SESSION_TOKEN_KEY,
  createSessionStore,
  parseSnapshot,
  snapshotOf,
} from '../auth/session-store.ts';
import {
  CLUB_THEME_KEY_PREFIX,
  THEME_VARIANT_KEY,
  brandOf,
  createBrandingStore,
  nativeThemeFor,
} from '../branding/club-branding.ts';
import { resolveMembership, sortMemberships } from '../clubs/membership.ts';
import {
  memoryPreferenceStorage,
  memorySecureStorage,
  type PreferenceStorage,
} from '../platform/storage.ts';
import {
  COACH_AT_ORC,
  DEVICE_ID,
  ORC_THEME,
  PARENT_AT_ORC,
  PLAYER_AT_OTHER,
  USER,
} from '../test/fixtures.ts';

describe('session store', () => {
  it('creates the installation id once, even with parallel sign-ins', async () => {
    const storage = memorySecureStorage();
    let created = 0;
    const store = createSessionStore({
      storage,
      randomUUID: () => {
        created += 1;
        return DEVICE_ID;
      },
    });
    const [a, b] = await Promise.all([store.getDeviceId(), store.getDeviceId()]);
    expect([a, b]).toEqual([DEVICE_ID, DEVICE_ID]);
    expect(created).toBe(1);
    expect(storage.entries.get(DEVICE_ID_KEY)).toBe(DEVICE_ID);
  });

  it('replaces a corrupt installation id', async () => {
    const storage = memorySecureStorage({ [DEVICE_ID_KEY]: 'not-a-uuid' });
    const store = createSessionStore({ storage, randomUUID: () => DEVICE_ID });
    await expect(store.getDeviceId()).resolves.toBe(DEVICE_ID);
  });

  it('keeps the token only in the secure storage and clears the session but not the device', async () => {
    const storage = memorySecureStorage({
      [DEVICE_ID_KEY]: DEVICE_ID,
      [MEMBERSHIP_ID_KEY]: COACH_AT_ORC.id,
    });
    const store = createSessionStore({ storage, randomUUID: () => DEVICE_ID });
    await store.saveSession('tok');
    expect(storage.entries.get(SESSION_TOKEN_KEY)).toBe('tok');
    expect(storage.entries.has(MEMBERSHIP_ID_KEY)).toBe(false);
    await store.saveSnapshot(snapshotOf(USER, [COACH_AT_ORC]));
    await store.clear();
    expect([...storage.entries.keys()]).toEqual([DEVICE_ID_KEY]);
    await expect(store.saveSession('')).rejects.toThrow();
  });

  it('clears every key even when one delete fails', async () => {
    const storage = memorySecureStorage({
      [SESSION_TOKEN_KEY]: 'tok',
      [SESSION_SNAPSHOT_KEY]: '{}',
    });
    const failing = {
      ...storage,
      deleteItem: (key: string) =>
        key === MEMBERSHIP_ID_KEY ? Promise.reject(new Error('keychain')) : storage.deleteItem(key),
    };
    const store = createSessionStore({ storage: failing, randomUUID: () => DEVICE_ID });
    await expect(store.clear()).rejects.toThrow('keychain');
    expect(storage.entries.has(SESSION_TOKEN_KEY)).toBe(false);
  });

  it('reads back snapshots and ignores malformed ones', () => {
    const snapshot = snapshotOf(USER, [COACH_AT_ORC]);
    expect(snapshot.user).toEqual({ id: USER.id, name: USER.name, isSuperadmin: false });
    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('{')).toBeNull();
    expect(
      parseSnapshot(JSON.stringify({ user: snapshot.user, memberships: [{ id: 'x' }] })),
    ).toBeNull();
  });
});

describe('membership resolution', () => {
  it('enters the only club, keeps a valid choice and asks otherwise', () => {
    expect(resolveMembership([], null)).toEqual({ kind: 'none' });
    expect(resolveMembership([COACH_AT_ORC], null)).toEqual({
      kind: 'active',
      membership: COACH_AT_ORC,
    });
    expect(resolveMembership([COACH_AT_ORC], PLAYER_AT_OTHER.id)).toEqual({
      kind: 'active',
      membership: COACH_AT_ORC,
    });
    expect(resolveMembership([COACH_AT_ORC, PLAYER_AT_OTHER], PLAYER_AT_OTHER.id)).toEqual({
      kind: 'active',
      membership: PLAYER_AT_OTHER,
    });
    expect(resolveMembership([COACH_AT_ORC, PLAYER_AT_OTHER], 'gone')).toEqual({ kind: 'choose' });
  });

  it('sorts the selector by club and role', () => {
    expect(sortMemberships([PARENT_AT_ORC, PLAYER_AT_OTHER, COACH_AT_ORC])).toEqual([
      PLAYER_AT_OTHER,
      COACH_AT_ORC,
      PARENT_AT_ORC,
    ]);
  });
});

describe('club branding', () => {
  it('derives the theme from the club colors, with the ORC brand as default', () => {
    const blue = { ...ORC_THEME, colors: { ...ORC_THEME.colors, primary: '#1D4ED8' } };
    expect(brandOf(null)).toEqual(defaultBrand);
    expect(brandOf(blue).primary).toBe('#1d4ed8');
    expect(nativeThemeFor(blue, 'dark').colors.brand.solid).toBe('#1d4ed8');
    expect(nativeThemeFor(null, 'light-hc').dark).toBe(false);
    expect(nativeThemeFor(null, 'dark').fontFamilies).toContain('Barlow_400Regular');
  });

  it('caches the theme per club and the variant, ignoring corrupt entries', async () => {
    const storage = memoryPreferenceStorage();
    const store = createBrandingStore(storage);
    await expect(store.getVariant()).resolves.toBe('dark');
    await store.setVariant('light-hc');
    await expect(store.getVariant()).resolves.toBe('light-hc');
    await store.saveClubTheme(ORC_THEME);
    await expect(store.getClubTheme('orc')).resolves.toEqual(ORC_THEME);
    await expect(store.getClubTheme('otro')).resolves.toBeNull();

    storage.entries.set(`${CLUB_THEME_KEY_PREFIX}orc`, '{"slug":"orc"}');
    storage.entries.set(THEME_VARIANT_KEY, 'neon');
    await expect(store.getClubTheme('orc')).resolves.toBeNull();
    await expect(store.getVariant()).resolves.toBe('dark');
  });

  it('never throws when the device storage fails', async () => {
    const failing: PreferenceStorage = {
      get: () => Promise.reject(new Error('disk')),
      set: () => Promise.reject(new Error('disk')),
      remove: () => Promise.reject(new Error('disk')),
    };
    const store = createBrandingStore(failing);
    await expect(store.getVariant()).resolves.toBe('dark');
    await expect(store.saveClubTheme(ORC_THEME)).resolves.toBeUndefined();
    await expect(store.getClubTheme('orc')).resolves.toBeNull();
  });
});
