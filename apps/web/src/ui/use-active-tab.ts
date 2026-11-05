import { useRouterState } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';

/**
 * Section tabs (`.sp-tabs`) scroll sideways on a phone: keeps the current
 * tab (`aria-current="page"`) inside the strip whenever the location changes,
 * so the user sees which section they are in. Scrolls only the strip, never
 * the page.
 */
export function useActiveTabInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const href = useRouterState({ select: (state) => state.location.href });
  useLayoutEffect(() => {
    const strip = ref.current;
    if (strip === null || strip.scrollWidth <= strip.clientWidth) return;
    const active = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (active === null) return;
    const stripBox = strip.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    if (box.left < stripBox.left) strip.scrollLeft += box.left - stripBox.left;
    else if (box.right > stripBox.right) strip.scrollLeft += box.right - stripBox.right;
  }, [href]);
  return ref;
}
