import {
  useId,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { useChartOptions } from './context.js';

export type ActiveSource = 'pointer' | 'keyboard';

export interface ActivePosition<T> {
  readonly value: T;
  readonly source: ActiveSource;
}

/** Where the arrow keys move from the current position (`null` = nothing active yet). */
export type KeyMove<T> = (current: T | null, key: string) => T | null | undefined;

/**
 * Active position of an interactive chart (crosshair column, bar or cell), driven by the pointer
 * and the keyboard alike. `move` returns the next position for a key, `null` to close, or
 * `undefined` when the key is not handled.
 */
export function useActivePosition<T>(move: KeyMove<T>, initial: () => T | null) {
  const [active, setActive] = useState<ActivePosition<T> | null>(null);
  return {
    active,
    setFromPointer: (value: T | null): void => {
      setActive(value === null ? null : { value, source: 'pointer' });
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>): void => {
      const next = move(active?.value ?? null, event.key);
      if (next === undefined) return;
      event.preventDefault();
      setActive(next === null ? null : { value: next, source: 'keyboard' });
    },
    onFocus: (event: FocusEvent<HTMLElement>): void => {
      if (event.target !== event.currentTarget || active !== null) return;
      const value = initial();
      if (value !== null) setActive({ value, source: 'keyboard' });
    },
    onBlur: (): void => {
      setActive(null);
    },
    onPointerLeave: (): void => {
      if (active?.source === 'pointer') setActive(null);
    },
  };
}

/** Arrow-key move along a row of `count` positions. */
export function linearMove(count: number): KeyMove<number> {
  return (current, key) => {
    const last = count - 1;
    if (count === 0) return undefined;
    switch (key) {
      case 'ArrowRight':
        return current === null ? last : Math.min(last, current + 1);
      case 'ArrowLeft':
        return current === null ? last : Math.max(0, current - 1);
      case 'Home':
        return 0;
      case 'End':
        return last;
      case 'Escape':
        return current === null ? undefined : null;
      default:
        return undefined;
    }
  };
}

export interface InteractivePlotProps {
  /** Accessible name of the focusable plot (the chart title). */
  readonly label: string;
  /** Accessible summary of the drawing. */
  readonly summary: string;
  readonly width: number;
  readonly height: number;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onFocus: (event: FocusEvent<HTMLElement>) => void;
  readonly onBlur: () => void;
  /** Pointer position in chart pixels. */
  readonly onPointer: (x: number, y: number) => void;
  readonly onPointerLeave: () => void;
  /** Readout announced to screen readers when the keyboard moves (empty for none). */
  readonly announcement: string;
  readonly tooltip: ReactNode;
  /** The SVG content. */
  readonly children: ReactNode;
}

/**
 * The drawing of a chart plus its interaction layer: a focusable group (visible focus ring) that
 * the arrow keys walk, an `aria-live` region that reads the active value, and the tooltip. The
 * SVG itself is `role="img"` with the summary as its name.
 */
export function InteractivePlot({
  label,
  summary,
  width,
  height,
  onKeyDown,
  onFocus,
  onBlur,
  onPointer,
  onPointerLeave,
  announcement,
  tooltip,
  children,
}: InteractivePlotProps) {
  const { translator } = useChartOptions();
  const hintId = `${useId()}-hint`;

  const handlePointer = (event: PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = rect.width > 0 ? width / rect.width : 1;
    const scaleY = rect.height > 0 ? height / rect.height : 1;
    onPointer((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
  };

  return (
    <div
      className="sp-chart__plot"
      role="group"
      aria-label={label}
      aria-describedby={hintId}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      onPointerMove={handlePointer}
      onPointerDown={handlePointer}
      onPointerLeave={onPointerLeave}
    >
      <svg
        className="sp-chart__svg"
        role="img"
        aria-label={summary}
        width={width}
        height={height}
        viewBox={`0 0 ${String(width)} ${String(height)}`}
      >
        {children}
      </svg>
      {tooltip}
      <span id={hintId} className="sp-sr-only">
        {translator.t('chart.keyboardHint')}
      </span>
      <span className="sp-sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </div>
  );
}
