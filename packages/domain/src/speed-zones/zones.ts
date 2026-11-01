import { isWellFormedCode } from '../codes.js';
import { DomainValidationError, describeValue } from '../errors.js';
import { memberGuard, memberParser } from '../enum.js';

/**
 * Speed zones (B-209).
 *
 * A zone set is an ordered list of zones, each defined by its **inclusive
 * lower bound**; a zone ends where the next one starts and the last one is
 * open. Two kinds, matching the "double reading" of every field metric
 * (CLAUDE.md):
 *
 * - **absolute**: bounds in m/s (`minSpeedMs`), comparable with the first team
 *   and copied from its Catapult velocity bands;
 * - **relative**: bounds in % of the player's Vmax (`minVmaxPct`), turned into
 *   m/s with the player's reference Vmax on the day.
 *
 * `highSpeedZoneCode` names the zone from which running counts as high speed:
 * its lower bound is the threshold of `hsr_abs_m` (absolute set) or
 * `hsr_rel_m` (relative set).
 */
export const SPEED_ZONE_KINDS = ['absolute', 'relative'] as const;
export type SpeedZoneKind = (typeof SPEED_ZONE_KINDS)[number];

export const isSpeedZoneKind = memberGuard(SPEED_ZONE_KINDS);
export const parseSpeedZoneKind = memberParser(
  SPEED_ZONE_KINDS,
  'invalid_argument',
  'speed zone kind',
);

/**
 * Zone code: English `snake_case` (`high_speed_running`, `band_5`). What the
 * user sees is looked up in `packages/i18n` or comes from the club's own
 * terminology; the domain never holds UI text.
 */
export type SpeedZoneCode = string;

export interface AbsoluteSpeedZone {
  readonly code: SpeedZoneCode;
  /** Inclusive lower bound, m/s. */
  readonly minSpeedMs: number;
}

export interface RelativeSpeedZone {
  readonly code: SpeedZoneCode;
  /** Inclusive lower bound, % of the player's Vmax (0–100). */
  readonly minVmaxPct: number;
}

export interface AbsoluteSpeedZoneSet {
  readonly kind: 'absolute';
  readonly zones: readonly AbsoluteSpeedZone[];
  readonly highSpeedZoneCode: SpeedZoneCode;
}

export interface RelativeSpeedZoneSet {
  readonly kind: 'relative';
  readonly zones: readonly RelativeSpeedZone[];
  readonly highSpeedZoneCode: SpeedZoneCode;
}

export type SpeedZoneSet = AbsoluteSpeedZoneSet | RelativeSpeedZoneSet;

/** The zone set of a given kind. */
export type SpeedZoneSetOfKind<K extends SpeedZoneKind> = Extract<SpeedZoneSet, { kind: K }>;

/** A zone resolved to m/s for one player on one day. */
export interface SpeedZoneBand {
  readonly code: SpeedZoneCode;
  /** Inclusive lower bound, m/s. */
  readonly minSpeedMs: number;
  /** Exclusive upper bound, m/s; `null` for the last (open) zone. */
  readonly maxSpeedMs: number | null;
}

/**
 * Sanity cap for absolute bounds, m/s. The fastest recorded human top speed is
 * about 12.4 m/s; anything above 15 m/s is a typo or a km/h value.
 */
export const MAX_ABSOLUTE_ZONE_SPEED_MS = 15;

/** Relative bounds are a share of the player's own Vmax: at most 100%. */
export const MAX_RELATIVE_ZONE_VMAX_PCT = 100;

function invalid(message: string, value: unknown): never {
  throw new DomainValidationError('invalid_argument', message, value);
}

function lowerBoundOf(zoneSet: SpeedZoneSet, index: number): number {
  return zoneSet.kind === 'absolute'
    ? (zoneSet.zones[index]?.minSpeedMs ?? Number.NaN)
    : (zoneSet.zones[index]?.minVmaxPct ?? Number.NaN);
}

/**
 * Throws a {@link DomainValidationError} unless the zone set is well formed:
 * at least one zone, the first one starting at 0 (every non-negative speed
 * falls in a zone), finite bounds strictly increasing and within the sanity
 * cap, unique well-formed codes, and a high-speed zone that exists and is not
 * the first one (a threshold of 0 would count every metre as high speed).
 */
export function validateSpeedZoneSet(zoneSet: SpeedZoneSet): void {
  if (!isSpeedZoneKind(zoneSet.kind)) {
    invalid(`Invalid speed zone kind: ${describeValue(zoneSet.kind)}.`, zoneSet.kind);
  }
  const zones: readonly { readonly code: SpeedZoneCode }[] = zoneSet.zones;
  if (zones.length === 0) {
    invalid('A speed zone set needs at least one zone.', zones);
  }
  const unit = zoneSet.kind === 'absolute' ? 'm/s' : '% of Vmax';
  const cap = zoneSet.kind === 'absolute' ? MAX_ABSOLUTE_ZONE_SPEED_MS : MAX_RELATIVE_ZONE_VMAX_PCT;
  const codes = new Set<string>();
  let previous = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < zones.length; index += 1) {
    const code: unknown = zones[index]?.code;
    if (!isWellFormedCode(code)) {
      invalid(
        `Invalid speed zone code: ${describeValue(code)}. Expected English snake_case.`,
        code,
      );
    }
    if (codes.has(code)) invalid(`Duplicate speed zone code: ${code}.`, code);
    codes.add(code);

    const bound = lowerBoundOf(zoneSet, index);
    if (typeof bound !== 'number' || !Number.isFinite(bound)) {
      invalid(`Speed zone ${code}: lower bound must be a finite number.`, bound);
    }
    if (index === 0 && bound !== 0) {
      invalid(`The first speed zone (${code}) must start at 0 ${unit}.`, bound);
    }
    if (bound <= previous) {
      invalid(`Speed zone ${code}: lower bounds must be strictly increasing.`, bound);
    }
    if (bound > cap) {
      invalid(
        `Speed zone ${code}: lower bound ${String(bound)} exceeds ${String(cap)} ${unit}.`,
        bound,
      );
    }
    previous = bound;
  }
  const highSpeedIndex = zones.findIndex((zone) => zone.code === zoneSet.highSpeedZoneCode);
  if (highSpeedIndex < 0) {
    invalid(
      `High-speed zone ${describeValue(zoneSet.highSpeedZoneCode)} is not one of the zones.`,
      zoneSet.highSpeedZoneCode,
    );
  }
  if (highSpeedIndex === 0) {
    invalid(
      'The high-speed zone cannot be the first zone (its threshold would be 0).',
      zoneSet.highSpeedZoneCode,
    );
  }
}

/** Throws unless `vmaxMs` is a usable reference Vmax (finite, > 0). */
function assertReferenceVmaxMs(vmaxMs: unknown): asserts vmaxMs is number {
  if (typeof vmaxMs !== 'number' || !Number.isFinite(vmaxMs) || vmaxMs <= 0) {
    invalid(
      `Relative speed zones need the player's reference Vmax (finite, > 0 m/s); got ${describeValue(vmaxMs)}.`,
      vmaxMs,
    );
  }
}

function assertSpeedMs(speedMs: unknown, label: string): asserts speedMs is number {
  if (typeof speedMs !== 'number' || !Number.isFinite(speedMs) || speedMs < 0) {
    invalid(
      `${label} must be a finite, non-negative speed in m/s; got ${describeValue(speedMs)}.`,
      speedMs,
    );
  }
}

/**
 * Lower bounds of the zone set in m/s. For a relative set `vmaxMs` is the
 * player's reference Vmax (m/s) on the day and is required; it is ignored for
 * an absolute set.
 */
function lowerBoundsMs(zoneSet: SpeedZoneSet, vmaxMs: number | undefined): number[] {
  if (zoneSet.kind === 'absolute') return zoneSet.zones.map((zone) => zone.minSpeedMs);
  assertReferenceVmaxMs(vmaxMs);
  return zoneSet.zones.map((zone) => (zone.minVmaxPct / 100) * vmaxMs);
}

/**
 * The zones of `zoneSet` as m/s bands. Validates the set first. For a relative
 * set, pass the player's reference Vmax in m/s (for example the best
 * `sprint_vmax_ms` of the current test window).
 */
export function speedZoneBandsMs(zoneSet: SpeedZoneSet, vmaxMs?: number): SpeedZoneBand[] {
  validateSpeedZoneSet(zoneSet);
  const bounds = lowerBoundsMs(zoneSet, vmaxMs);
  return zoneSet.zones.map((zone, index) => ({
    code: zone.code,
    minSpeedMs: bounds[index] ?? 0,
    maxSpeedMs: bounds[index + 1] ?? null,
  }));
}

/**
 * High-speed running threshold in m/s: the lower bound of
 * `highSpeedZoneCode`. Distance at or above it is `hsr_abs_m` (absolute set)
 * or `hsr_rel_m` (relative set, needs `vmaxMs`).
 */
export function highSpeedThresholdMs(zoneSet: SpeedZoneSet, vmaxMs?: number): number {
  const band = speedZoneBandsMs(zoneSet, vmaxMs).find(
    (candidate) => candidate.code === zoneSet.highSpeedZoneCode,
  );
  // validateSpeedZoneSet guarantees the zone exists.
  return band?.minSpeedMs ?? Number.NaN;
}

/**
 * Code of the zone `speedMs` falls in. Lower bounds are inclusive, so a speed
 * exactly on a threshold belongs to the faster zone (same convention as
 * "HSR > 5.5 m/s" being counted from 5.5 m/s on). `bands` must come from
 * {@link speedZoneBandsMs}.
 */
export function classifySpeedMs(speedMs: number, bands: readonly SpeedZoneBand[]): SpeedZoneCode {
  assertSpeedMs(speedMs, 'speedMs');
  let found: SpeedZoneCode | undefined;
  for (const band of bands) {
    if (speedMs >= band.minSpeedMs) found = band.code;
    else break;
  }
  if (found === undefined) invalid('classifySpeedMs: bands must start at 0 m/s.', bands);
  return found;
}

/**
 * A speed as % of the player's reference Vmax (`vmax_pct` when `speedMs` is
 * the session's peak speed). Can exceed 100 when the player beats the
 * reference.
 */
export function speedPctOfVmax(speedMs: number, vmaxMs: number): number {
  assertSpeedMs(speedMs, 'speedMs');
  assertReferenceVmaxMs(vmaxMs);
  return (speedMs / vmaxMs) * 100;
}
