import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useServices, useStore } from '../app/services';
import { applyTheme, themeFor } from './theme-store';

const MORE_CONTRAST = '(prefers-contrast: more)';

/**
 * Applies the runtime theme to `<html>` before paint whenever the club brand
 * or the variant changes, and follows the system contrast preference.
 */
export function ThemeController() {
  const { theme } = useServices();
  const state = useStore(theme);
  const resolved = useMemo(() => themeFor(state), [state]);

  useLayoutEffect(() => {
    applyTheme(document.documentElement, resolved);
  }, [resolved]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(MORE_CONTRAST);
    const update = () => {
      theme.setSystemPrefersMoreContrast(query.matches);
    };
    update();
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, [theme]);

  return null;
}
