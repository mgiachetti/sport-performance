import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a media query matches, kept in sync with the viewport. For layouts
 * that change structure (a table that becomes a list of cards), not only
 * style: CSS alone would leave both in the DOM. Without `matchMedia` (jsdom,
 * old browsers) it never matches, so the wide layout is the default.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  const matches = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, matches, () => false);
}

/** Phones: below 40 rem (the breakpoint of the primitives' compact layouts). */
export const NARROW_QUERY = '(max-width: 40rem)';
