/** Font size of axis and direct labels, in px (matches `charts.css`). */
export const LABEL_FONT_PX = 12;

/**
 * Approximate width of a label in Barlow / Barlow Condensed. Layout runs without a DOM (and in
 * mobile), so it cannot measure text; the estimate errs wide so labels never overlap.
 */
export function estimateTextWidth(text: string, fontPx = LABEL_FONT_PX): number {
  let width = 0;
  for (const char of text) {
    if (/[\s.,:;'|!il1]/.test(char)) width += 0.32;
    else if (/[MWmw%]/.test(char)) width += 0.86;
    else if (/[A-Z0-9]/.test(char)) width += 0.62;
    else width += 0.56;
  }
  return width * fontPx;
}

/**
 * Which labels of an evenly spaced axis to draw so they do not collide: every k-th one, counted
 * back from the last (the most recent value always keeps its label).
 */
export function visibleLabelIndexes(
  positions: readonly number[],
  labels: readonly string[],
  minGapPx = 8,
  fontPx = LABEL_FONT_PX,
): number[] {
  const n = positions.length;
  if (n === 0) return [];
  const widest = Math.max(...labels.map((label) => estimateTextWidth(label, fontPx)));
  const slot = n > 1 ? Math.abs((positions[1] ?? 0) - (positions[0] ?? 0)) : Infinity;
  const every = Math.max(1, Math.ceil((widest + minGapPx) / slot));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= every) out.push(i);
  return out.reverse();
}
