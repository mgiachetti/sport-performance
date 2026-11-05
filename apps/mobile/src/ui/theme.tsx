import type { NativeTheme, ThemeVariant } from '@sport-performance/ui-tokens';
import { createContext, useContext, type ReactNode } from 'react';
import { nativeThemeFor } from '../branding/club-branding.ts';

/**
 * The club's mark for the headers (ADR 0014): its crest as the API serves it
 * (or `null` without one) and the names to say it or to draw it as text.
 */
export interface ClubMark {
  readonly name: string;
  readonly shortName: string;
  readonly logoUrl: string | null;
}

export interface ThemeContextValue {
  readonly theme: NativeTheme;
  readonly variant: ThemeVariant;
  readonly setVariant: (variant: ThemeVariant) => void;
  /** The active club's crest and names; `null` before choosing a club. */
  readonly club?: ClubMark | null;
}

const defaultValue: ThemeContextValue = {
  theme: nativeThemeFor(null, 'dark'),
  variant: 'dark',
  setVariant: () => undefined,
  club: null,
};

const ThemeContext = createContext<ThemeContextValue>(defaultValue);

export function ThemeProvider({
  value,
  children,
}: {
  readonly value: ThemeContextValue;
  readonly children: ReactNode;
}) {
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

/** The club theme in effect (brand of the active club, chosen variant). */
export function useTheme(): NativeTheme {
  return useContext(ThemeContext).theme;
}

export function useThemeVariant(): Pick<ThemeContextValue, 'variant' | 'setVariant'> {
  const { variant, setVariant } = useContext(ThemeContext);
  return { variant, setVariant };
}

/** The active club's crest and names for a header; `null` without a club. */
export function useClubMark(): ClubMark | null {
  return useContext(ThemeContext).club ?? null;
}
