import { clubThemeSchema, type ClubTheme } from '@sport-performance/contracts';
import {
  createTheme,
  defaultBrand,
  parseClubBrand,
  themeVariants,
  toNativeTheme,
  type ClubBrand,
  type NativeTheme,
  type ThemeVariant,
} from '@sport-performance/ui-tokens';
import type { PreferenceStorage } from '../platform/storage.ts';

/** Preference keys (plain storage: brand data is public, ADR 0014). */
export const THEME_VARIANT_KEY = 'preferences.theme_variant';
export const CLUB_THEME_KEY_PREFIX = 'branding.club_theme.';

/** Club colors for `createTheme`; the ORC brand when the club has none or they are invalid. */
export function brandOf(clubTheme: ClubTheme | null): ClubBrand {
  if (clubTheme === null) return defaultBrand;
  try {
    return parseClubBrand({
      primary: clubTheme.colors.primary,
      secondary: clubTheme.colors.secondary,
    });
  } catch {
    return defaultBrand;
  }
}

/** The React Native theme of a club (white-label at runtime, ADR 0014). */
export function nativeThemeFor(clubTheme: ClubTheme | null, variant: ThemeVariant): NativeTheme {
  return toNativeTheme(createTheme({ brand: brandOf(clubTheme), variant }));
}

export function isThemeVariant(value: unknown): value is ThemeVariant {
  return typeof value === 'string' && (themeVariants as readonly string[]).includes(value);
}

export interface BrandingStore {
  /** The variant the user chose; `dark` (the club identity) by default. */
  getVariant(): Promise<ThemeVariant>;
  setVariant(variant: ThemeVariant): Promise<void>;
  /** The last theme the API served for a club, to open with its brand without signal. */
  getClubTheme(clubSlug: string): Promise<ClubTheme | null>;
  saveClubTheme(theme: ClubTheme): Promise<void>;
}

/**
 * Device cache of the brand. Reads never throw: a missing or corrupt entry
 * (an older build, a full disk) falls back to the default brand.
 */
export function createBrandingStore(storage: PreferenceStorage): BrandingStore {
  async function read(key: string): Promise<string | null> {
    try {
      return await storage.get(key);
    } catch {
      return null;
    }
  }
  async function write(key: string, value: string): Promise<void> {
    try {
      await storage.set(key, value);
    } catch {
      // Best effort: the next launch asks the API again.
    }
  }

  return {
    async getVariant() {
      const stored = await read(THEME_VARIANT_KEY);
      return isThemeVariant(stored) ? stored : 'dark';
    },
    setVariant: (variant) => write(THEME_VARIANT_KEY, variant),
    async getClubTheme(clubSlug) {
      const raw = await read(CLUB_THEME_KEY_PREFIX + clubSlug);
      if (raw === null) return null;
      try {
        const parsed = clubThemeSchema.safeParse(JSON.parse(raw));
        return parsed.success && parsed.data.slug === clubSlug ? parsed.data : null;
      } catch {
        return null;
      }
    },
    saveClubTheme: (theme) => write(CLUB_THEME_KEY_PREFIX + theme.slug, JSON.stringify(theme)),
  };
}
