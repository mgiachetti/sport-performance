import type {
  AbsoluteSpeedZoneSet,
  RelativeSpeedZoneSet,
  SpeedZoneKind,
  SpeedZoneSetOfKind,
} from './zones.js';

/**
 * Default speed zones. Data, not logic: these are the values seeded into the
 * database (B-306) for a club with no configuration of its own, and the
 * fallback of `resolveSpeedZoneSet`. They are heuristics; a club replaces them
 * with the first team's Catapult velocity bands (absolute) or its own
 * percentages (relative).
 */

/**
 * Absolute zones, m/s. High-speed running from 5.5 m/s (CLAUDE.md,
 * `hsr_abs_m`); sprinting from 7 m/s.
 */
export const DEFAULT_ABSOLUTE_SPEED_ZONES = {
  kind: 'absolute',
  zones: [
    { code: 'walking', minSpeedMs: 0 },
    { code: 'jogging', minSpeedMs: 2 },
    { code: 'running', minSpeedMs: 4 },
    { code: 'high_speed_running', minSpeedMs: 5.5 },
    { code: 'sprinting', minSpeedMs: 7 },
  ],
  highSpeedZoneCode: 'high_speed_running',
} as const satisfies AbsoluteSpeedZoneSet;

/**
 * Relative zones, % of the player's Vmax. High-speed running from 60%
 * (CLAUDE.md, `hsr_rel_m`); near-maximal sprinting from 90%.
 */
export const DEFAULT_RELATIVE_SPEED_ZONES = {
  kind: 'relative',
  zones: [
    { code: 'low_intensity', minVmaxPct: 0 },
    { code: 'moderate_intensity', minVmaxPct: 40 },
    { code: 'high_speed_running', minVmaxPct: 60 },
    { code: 'very_high_speed_running', minVmaxPct: 80 },
    { code: 'near_max_sprinting', minVmaxPct: 90 },
  ],
  highSpeedZoneCode: 'high_speed_running',
} as const satisfies RelativeSpeedZoneSet;

/** Default zone set of each kind. */
export const DEFAULT_SPEED_ZONE_SETS: {
  readonly [K in SpeedZoneKind]: SpeedZoneSetOfKind<K>;
} = {
  absolute: DEFAULT_ABSOLUTE_SPEED_ZONES,
  relative: DEFAULT_RELATIVE_SPEED_ZONES,
};
