import {
  applyCssVariables,
  createTheme,
  defaultBrand,
  parseClubBrand,
  type ClubBrand,
  type CssVariableTarget,
  type Theme,
  type ThemeVariant,
} from '@sport-performance/ui-tokens';
import { Store, readJson, writeJson, type KeyValueStorage } from '../lib/store';

/** What the user picked; `system` follows `prefers-contrast: more`. */
export type ThemePreference = 'system' | ThemeVariant;

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'dark', 'light-hc'];

export interface ThemeState {
  /** Brand of the active club (ORC until a club is picked). */
  readonly brand: ClubBrand;
  readonly preference: ThemePreference;
  /** `prefers-contrast: more` of the system. */
  readonly systemPrefersMoreContrast: boolean;
}

const PREFERENCE_KEY = 'sp.web.theme';

function isPreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

export function resolveVariant(state: ThemeState): ThemeVariant {
  if (state.preference !== 'system') return state.preference;
  return state.systemPrefersMoreContrast ? 'light-hc' : 'dark';
}

/** The full semantic theme for the state: brand of the club, resolved variant. */
export function themeFor(state: ThemeState): Theme {
  return createTheme({ brand: state.brand, variant: resolveVariant(state) });
}

/** Element the theme is applied to: `<html>` (CSS variables + `data-theme`). */
export interface ThemeTarget extends CssVariableTarget {
  setAttribute(name: string, value: string): void;
}

/** Applies the theme at runtime (ADR 0014): `--sp-*` variables and `data-theme` on `target`. */
export function applyTheme(target: ThemeTarget, theme: Theme): void {
  applyCssVariables(target, theme);
  target.setAttribute('data-theme', theme.variant);
}

/**
 * Runtime theme of the web (ADR 0014, ADR 0056): the brand comes from the
 * club's public theme (`GET /v1/clubs/{slug}/theme`), the variant from the
 * user (remembered in `localStorage`) or the system's contrast preference.
 */
export class ThemeStore extends Store<ThemeState> {
  readonly #storage: KeyValueStorage | null;

  constructor(options: { storage: KeyValueStorage | null; systemPrefersMoreContrast: boolean }) {
    const stored = readJson(options.storage, PREFERENCE_KEY);
    super({
      brand: defaultBrand,
      preference: isPreference(stored) ? stored : 'system',
      systemPrefersMoreContrast: options.systemPrefersMoreContrast,
    });
    this.#storage = options.storage;
  }

  /** Sets the club brand; invalid colors fall back to the default brand (never break the UI). */
  setBrand(colors: { primary: string; secondary: string } | null): void {
    let brand = defaultBrand;
    if (colors !== null) {
      try {
        brand = parseClubBrand(colors);
      } catch {
        brand = defaultBrand;
      }
    }
    const current = this.get();
    if (current.brand.primary === brand.primary && current.brand.secondary === brand.secondary) {
      return;
    }
    this.set({ ...current, brand });
  }

  setPreference(preference: ThemePreference): void {
    writeJson(this.#storage, PREFERENCE_KEY, preference === 'system' ? null : preference);
    this.set({ ...this.get(), preference });
  }

  setSystemPrefersMoreContrast(value: boolean): void {
    if (this.get().systemPrefersMoreContrast !== value) {
      this.set({ ...this.get(), systemPrefersMoreContrast: value });
    }
  }
}
