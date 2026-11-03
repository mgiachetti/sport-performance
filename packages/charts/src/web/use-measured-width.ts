import { useLayoutEffect, useState, type RefCallback } from 'react';

/** Width used until the container is measured (server render, tests, no `ResizeObserver`). */
export const FALLBACK_WIDTH_PX = 640;

/**
 * Width of the chart's container in CSS pixels, kept up to date with `ResizeObserver`, so the
 * layout (tick count, label thinning, bar width) adapts to the card instead of scaling the text.
 * A fixed `width` skips the measuring.
 */
export function useMeasuredWidth(
  fixedWidth: number | undefined,
): [RefCallback<HTMLElement>, number] {
  const [measured, setMeasured] = useState<number | null>(null);
  // State (not a ref) so that attaching the node re-runs the effect.
  const [element, setElement] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (fixedWidth !== undefined || element === null) return undefined;
    const read = (width: number): void => {
      if (width > 0) setMeasured(Math.round(width));
    };
    read(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) read(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [element, fixedWidth]);

  return [setElement, fixedWidth ?? measured ?? FALLBACK_WIDTH_PX];
}
