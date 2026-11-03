import type { NativeTheme, ThemeVariant } from '@sport-performance/ui-tokens';
import { createContext, useContext, type ReactNode } from 'react';
import { nativeThemeFor } from '../branding/club-branding.ts';

export interface ThemeContextValue {
  readonly theme: NativeTheme;
  readonly variant: ThemeVariant;
  readonly setVariant: (variant: ThemeVariant) => void;
}

const defaultValue: ThemeContextValue = {
  theme: nativeThemeFor(null, 'dark'),
  variant: 'dark',
  setVariant: () => undefined,
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
