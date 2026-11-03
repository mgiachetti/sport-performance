import type { MessageKey, Translator } from '@sport-performance/i18n';
import { statusLevels, type StatusLevel } from '@sport-performance/ui-tokens';

export { statusLevels, type StatusLevel };

/** One stroke or fill of a status glyph, in a 12 × 12 box. */
export interface StatusIconPart {
  readonly d: string;
  readonly paint: 'fill' | 'stroke';
}

/**
 * Status glyphs. Each level has a different shape (check, triangle, cross in a circle) so the
 * state reads without color; it is always shown next to its text label too.
 */
export const STATUS_ICONS: Readonly<Record<StatusLevel, readonly StatusIconPart[]>> = {
  ok: [{ d: 'M2.5 6.4l2.4 2.4L9.6 3.6', paint: 'stroke' }],
  warning: [
    { d: 'M6 1.2L11.2 10.6H0.8Z', paint: 'stroke' },
    { d: 'M6 4.6V7.2M6 8.8V8.9', paint: 'stroke' },
  ],
  critical: [
    { d: 'M6 0.9A5.1 5.1 0 1 1 5.99 0.9Z', paint: 'stroke' },
    { d: 'M4 4L8 8M8 4L4 8', paint: 'stroke' },
  ],
};

const STATUS_MESSAGE: Readonly<Record<StatusLevel, MessageKey>> = {
  ok: 'status.ok',
  warning: 'status.warning',
  critical: 'status.critical',
};

/** Text label of a status level (`Bien`, `Atención`, `Crítico`). */
export function statusLabel(t: Translator['t'], level: StatusLevel): string {
  return t(STATUS_MESSAGE[level]);
}

export function isStatusLevel(value: unknown): value is StatusLevel {
  return typeof value === 'string' && (statusLevels as readonly string[]).includes(value);
}
