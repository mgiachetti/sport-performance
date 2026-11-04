import type { SVGProps } from 'react';

/**
 * Line icons of the shell (24×24, `currentColor`). Decorative by default
 * (`aria-hidden`): the text next to them carries the meaning, because a
 * status is never conveyed by color or icon alone.
 */
export type IconName =
  | 'ok'
  | 'warning'
  | 'critical'
  | 'info'
  | 'offline'
  | 'sync'
  | 'home'
  | 'panel'
  | 'players'
  | 'club'
  | 'support'
  | 'signOut'
  | 'contrast'
  | 'calendar'
  | 'clipboard'
  | 'plus'
  | 'arrowUp'
  | 'arrowDown'
  | 'trash'
  | 'field'
  | 'stopwatch'
  | 'flag'
  | 'chevronLeft'
  | 'chevronRight'
  | 'settings'
  | 'ruler'
  | 'family'
  | 'help'
  | 'dumbbell'
  | 'cycle';

const PATHS: Record<IconName, readonly string[]> = {
  ok: ['M20 6 9 17l-5-5'],
  warning: ['M12 3 2 21h20L12 3Z', 'M12 10v5', 'M12 18h.01'],
  critical: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'm15 9-6 6', 'm9 9 6 6'],
  info: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M12 11v6', 'M12 7h.01'],
  offline: ['M2 2l20 20', 'M8.5 16.5a5 5 0 0 1 7 0', 'M5 12.5a10 10 0 0 1 5-2.7', 'M12 20h.01'],
  sync: [
    'M21 12a9 9 0 0 1-15.5 6.2L3 16',
    'M3 12a9 9 0 0 1 15.5-6.2L21 8',
    'M21 3v5h-5',
    'M3 21v-5h5',
  ],
  home: ['M3 11 12 3l9 8', 'M5 10v10h14V10'],
  panel: ['M3 3v18h18', 'M7 16v-4', 'M12 16V8', 'M17 16v-7'],
  players: ['M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6'],
  club: ['M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z'],
  support: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M9 9a3 3 0 1 1 3 3v2', 'M12 17h.01'],
  signOut: ['M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4', 'M10 17l-5-5 5-5', 'M5 12h11'],
  contrast: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z', 'M12 2v20'],
  calendar: ['M4 5h16v16H4Z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  clipboard: ['M9 3h6v4H9Z', 'M9 5H5v16h14V5h-4', 'M8 12h8', 'M8 16h5'],
  plus: ['M12 5v14', 'M5 12h14'],
  arrowUp: ['M12 19V5', 'm5 12 7-7 7 7'],
  arrowDown: ['M12 5v14', 'm19 12-7 7-7-7'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 15h10l1-15'],
  field: ['M3 17l5-6 4 3 4-7 5 5', 'M3 21h18'],
  stopwatch: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M12 13V9', 'M9 2h6'],
  flag: ['M5 21V4', 'M5 4h11l-2 4 2 4H5'],
  chevronLeft: ['m15 18-6-6 6-6'],
  chevronRight: ['m9 18 6-6-6-6'],
  settings: [
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
    'M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  ],
  ruler: ['M3 17 17 3l4 4L7 21l-4-4Z', 'M7 13l2 2', 'M10 10l2 2', 'M13 7l2 2'],
  family: [
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
    'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    'M22 21v-2a4 4 0 0 0-3-3.87',
    'M16 3.13a4 4 0 0 1 0 7.75',
  ],
  dumbbell: ['M6 6v12', 'M18 6v12', 'M3 9v6', 'M21 9v6', 'M6 12h12'],
  // A circle closing on itself: the cycle (B-806).
  cycle: ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v4h-4'],
  help: ['M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4Z', 'M20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6Z'],
};

export function Icon({
  name,
  size = 16,
  ...rest
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'children'>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      {...rest}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
