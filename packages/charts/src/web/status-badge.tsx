import type { StatusLevel } from '@sport-performance/ui-tokens';
import { STATUS_ICONS, statusLabel } from '../core/status.js';
import { useChartOptions } from './context.js';

/** The glyph of a status level (decorative: always next to its text). */
export function StatusIconPaths({ level }: { readonly level: StatusLevel }) {
  return (
    <>
      {STATUS_ICONS[level].map((part) => (
        <path
          key={part.d}
          d={part.d}
          fill={part.paint === 'fill' ? 'currentColor' : 'none'}
          stroke={part.paint === 'stroke' ? 'currentColor' : 'none'}
          strokeWidth={part.paint === 'stroke' ? 1.6 : undefined}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
}

export function StatusIcon({
  level,
  size = 12,
}: {
  readonly level: StatusLevel;
  readonly size?: number;
}) {
  return (
    <svg
      className="sp-status__icon"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <StatusIconPaths level={level} />
    </svg>
  );
}

export interface StatusBadgeProps {
  readonly level: StatusLevel;
  /** Text instead of the level's name (`Historia insuficiente`); the icon stays. */
  readonly label?: string | undefined;
}

/** A state shown as icon + text, never by color alone (CLAUDE.md, accessibility). */
export function StatusBadge({ level, label }: StatusBadgeProps) {
  const { translator } = useChartOptions();
  return (
    <span className={`sp-status sp-status--${level}`}>
      <StatusIcon level={level} />
      <span className="sp-status__label">{label ?? statusLabel(translator.t, level)}</span>
    </span>
  );
}
