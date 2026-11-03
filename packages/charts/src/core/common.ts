import type { Translator } from '@sport-performance/i18n';
import { createTheme } from '@sport-performance/ui-tokens';
import { formatTick, formatValue, getDefaultTranslator, type ValueFormat } from './format.js';
import type { Point, Rect } from './geometry.js';
import { linearScale, niceTicks, type LinearScale } from './scale.js';
import { statusLabel } from './status.js';
import { LABEL_FONT_PX, estimateTextWidth } from './text.js';
import type { AxisTick, ChartReference, LayoutOptions, Readout, ReferenceLayout } from './types.js';

/** Dash of the first-team reference line, from the design tokens. */
export const REFERENCE_DASH: readonly [number, number] = createTheme().chartDash.reference;

/** Space between the tick labels and the plot. */
const TICK_GAP_PX = 8;
/** Vertical room of a label line. */
export const LABEL_LINE_PX = LABEL_FONT_PX + 4;

export function translatorOf(options: LayoutOptions | undefined): Translator {
  return options?.translator ?? getDefaultTranslator();
}

export function checkSize(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError(`chart size must be positive, got ${String(width)} × ${String(height)}`);
  }
}

export function checkLength(name: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new RangeError(`${name} has ${String(actual)} values for ${String(expected)} categories`);
  }
}

export interface ValueAxis {
  readonly scale: LinearScale;
  readonly ticks: readonly AxisTick[];
  /** Width the tick labels need on the left. */
  readonly labelWidth: number;
}

/** Tick count that keeps about 40 px between gridlines. */
export function maxTicksFor(plotHeight: number): number {
  return Math.min(6, Math.max(2, Math.floor(plotHeight / 40)));
}

/**
 * The single value axis of a chart (charts never have a second one). Its domain covers every
 * value drawn, the reference included, and starts at zero when `includeZero` (bars).
 */
export function valueAxis(
  values: readonly number[],
  { includeZero, top, bottom }: { includeZero: boolean; top: number; bottom: number },
): ValueAxis {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const nice = niceTicks(min, max, maxTicksFor(bottom - top));
  const scale = linearScale([nice.min, nice.max], [bottom, top]);
  const ticks = nice.ticks.map((value) => ({
    value,
    position: scale(value),
    label: formatTick(value, nice.decimals),
  }));
  const labelWidth = Math.max(...ticks.map((tick) => estimateTextWidth(tick.label))) + TICK_GAP_PX;
  return { scale, ticks, labelWidth };
}

/** "Primera 5,25 s": the direct label of the reference line. */
export function referenceText(
  t: Translator['t'],
  reference: ChartReference,
  format: ValueFormat | undefined,
): string {
  return t('chart.reference.directLabel', {
    label: reference.label ?? t('chart.reference.firstTeam'),
    value: formatValue(reference.value, format),
  });
}

/** A data point as an area the reference label must not cover (marker radius + ring). */
export function pointArea(point: Point, radius = 6): Rect {
  return { x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2 };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Places the reference line and its direct label. Tries, in order: right end above the line,
 * right end below it, left end above, left end below; the first spot that stays inside the plot
 * area and covers none of `avoid` (markers, bars, other labels) wins. If none is free the label
 * goes above the line at the right end.
 */
export function referenceLayout(
  y: number,
  plot: Rect,
  text: string,
  avoid: readonly Rect[],
): ReferenceLayout {
  const labelWidth = estimateTextWidth(text);
  const right = plot.x + plot.width;
  const bottom = plot.y + plot.height;
  const candidates = [
    { anchor: 'end', labelX: right, labelY: y - 6 },
    { anchor: 'end', labelX: right, labelY: y + LABEL_LINE_PX },
    { anchor: 'start', labelX: plot.x + 4, labelY: y - 6 },
    { anchor: 'start', labelX: plot.x + 4, labelY: y + LABEL_LINE_PX },
  ] as const;
  const fits = (candidate: (typeof candidates)[number]): boolean => {
    const box: Rect = {
      x: candidate.anchor === 'end' ? candidate.labelX - labelWidth : candidate.labelX,
      y: candidate.labelY - LABEL_FONT_PX,
      width: labelWidth,
      height: LABEL_FONT_PX + 2,
    };
    return box.y >= 0 && candidate.labelY <= bottom && !avoid.some((area) => intersects(box, area));
  };
  const chosen = candidates.find(fits) ?? candidates[0];
  return {
    y,
    x1: plot.x,
    x2: right,
    text,
    labelX: chosen.labelX,
    labelY: chosen.labelY,
    anchor: chosen.anchor,
    dash: REFERENCE_DASH,
  };
}

/** The tooltip readout as one sentence, for the `aria-live` region. */
export function readoutText(t: Translator['t'], readout: Readout): string {
  const parts = readout.rows.map((row) => {
    const status = row.status === undefined ? '' : ` (${statusLabel(t, row.status)})`;
    return `${row.label}: ${row.text}${status}`;
  });
  return `${readout.title}. ${parts.join('; ')}.`;
}

/** First and last finite value of a series, with their positions. */
export function firstAndLast(
  values: readonly (number | null)[],
): { first: number; firstIndex: number; last: number; lastIndex: number; count: number } | null {
  let first: { value: number; index: number } | undefined;
  let last: { value: number; index: number } | undefined;
  let count = 0;
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) return;
    first ??= { value, index };
    last = { value, index };
    count += 1;
  });
  if (first === undefined || last === undefined) return null;
  return {
    first: first.value,
    firstIndex: first.index,
    last: last.value,
    lastIndex: last.index,
    count,
  };
}

/** Summary sentence of one series: "Jugador: 8 valores, de 5,62 s (V1 25) a 5,31 s (V4 26)." */
export function seriesSummary(
  t: Translator['t'],
  label: string,
  values: readonly (number | null)[],
  categories: readonly { label: string }[],
  format: ValueFormat | undefined,
): string {
  const span = firstAndLast(values);
  if (span === null) return t('chart.summary.seriesEmpty', { series: label });
  return t('chart.summary.series', {
    series: label,
    count: span.count,
    first: formatValue(span.first, format),
    firstLabel: categories[span.firstIndex]?.label ?? '',
    last: formatValue(span.last, format),
    lastLabel: categories[span.lastIndex]?.label ?? '',
  });
}
