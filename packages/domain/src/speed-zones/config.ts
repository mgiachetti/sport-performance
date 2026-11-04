import { DomainValidationError, describeValue } from '../errors.js';
import { isUuid, type ClubId, type PlayerId } from '../ids.js';
import { isSex, type Sex } from '../sex.js';
import { isSport, type Sport } from '../sport.js';
import { compareLocalDates, isLocalDate, type LocalDate } from '../time.js';
import { defaultSpeedZoneSet } from './defaults.js';
import {
  validateSpeedZoneSet,
  type SpeedZoneKind,
  type SpeedZoneSet,
  type SpeedZoneSetOfKind,
} from './zones.js';

/**
 * A club's speed zone configuration, scoped and dated.
 *
 * - **Scope:** `sport`, `sex` and `playerId` narrow who it applies to; `null`
 *   means "any". A player-scoped row is how an individual threshold (for
 *   example a first-team player's own HSR) is stored.
 * - **Validity:** from `validFrom` (inclusive) to `validTo` (exclusive;
 *   `null` = open ended), the same convention as a Postgres `daterange '[)'`.
 *   Changing the zones means closing the current row and opening a new one,
 *   so past sessions keep the zones they were computed with.
 *
 * Callers may carry extra fields (id, audit columns); the functions below pass
 * them through untouched.
 */
export interface SpeedZoneConfig<Z extends SpeedZoneSet = SpeedZoneSet> {
  readonly clubId: ClubId;
  readonly sport: Sport | null;
  readonly sex: Sex | null;
  readonly playerId: PlayerId | null;
  readonly validFrom: LocalDate;
  readonly validTo: LocalDate | null;
  readonly zoneSet: Z;
}

/** Who and when to resolve zones for. */
export interface SpeedZoneQuery<K extends SpeedZoneKind = SpeedZoneKind> {
  readonly clubId: ClubId;
  readonly sport: Sport;
  readonly sex: Sex;
  readonly playerId: PlayerId;
  /** The club's day of the session (see `localDateInTimeZone`). */
  readonly onDate: LocalDate;
  readonly kind: K;
}

function invalid(message: string, value: unknown): never {
  throw new DomainValidationError('invalid_argument', message, value);
}

/**
 * Throws a {@link DomainValidationError} unless the configuration is well
 * formed: valid ids, scope, dates (`validTo` strictly after `validFrom`) and
 * zone set (see `validateSpeedZoneSet`).
 */
export function validateSpeedZoneConfig(config: SpeedZoneConfig): void {
  if (!isUuid(config.clubId))
    invalid(`Invalid clubId: ${describeValue(config.clubId)}.`, config.clubId);
  if (config.sport !== null && !isSport(config.sport)) {
    invalid(`Invalid sport: ${describeValue(config.sport)}.`, config.sport);
  }
  if (config.sex !== null && !isSex(config.sex)) {
    invalid(`Invalid sex: ${describeValue(config.sex)}.`, config.sex);
  }
  if (config.playerId !== null && !isUuid(config.playerId)) {
    invalid(`Invalid playerId: ${describeValue(config.playerId)}.`, config.playerId);
  }
  if (!isLocalDate(config.validFrom)) {
    invalid(`Invalid validFrom: ${describeValue(config.validFrom)}.`, config.validFrom);
  }
  if (config.validTo !== null) {
    if (!isLocalDate(config.validTo)) {
      invalid(`Invalid validTo: ${describeValue(config.validTo)}.`, config.validTo);
    }
    if (compareLocalDates(config.validTo, config.validFrom) <= 0) {
      invalid(
        `validTo (${config.validTo}) must be after validFrom (${config.validFrom}); validTo is exclusive.`,
        { validFrom: config.validFrom, validTo: config.validTo },
      );
    }
  }
  validateSpeedZoneSet(config.zoneSet);
}

/** True when `onDate` is inside `[validFrom, validTo)`. */
export function isSpeedZoneConfigValidOn(config: SpeedZoneConfig, onDate: LocalDate): boolean {
  return (
    compareLocalDates(config.validFrom, onDate) <= 0 &&
    (config.validTo === null || compareLocalDates(onDate, config.validTo) < 0)
  );
}

/**
 * How specific a configuration is: player 4, sport 2, sex 1. A player row
 * always beats a group row; among group rows sport beats sex.
 */
export function speedZoneConfigSpecificity(config: SpeedZoneConfig): number {
  return (
    (config.playerId !== null ? 4 : 0) +
    (config.sport !== null ? 2 : 0) +
    (config.sex !== null ? 1 : 0)
  );
}

function appliesTo(config: SpeedZoneConfig, query: SpeedZoneQuery): boolean {
  return (
    config.clubId === query.clubId &&
    config.zoneSet.kind === query.kind &&
    (config.sport === null || config.sport === query.sport) &&
    (config.sex === null || config.sex === query.sex) &&
    (config.playerId === null || config.playerId === query.playerId) &&
    isSpeedZoneConfigValidOn(config, query.onDate)
  );
}

/**
 * The configuration in force for the query: same club and kind, matching
 * scope, valid on `onDate`, and the most specific of those
 * ({@link speedZoneConfigSpecificity}). Returns `null` when none applies.
 *
 * Throws when two equally specific configurations apply on the same day: that
 * is a data error ({@link findSpeedZoneConfigConflicts} prevents it on write)
 * and the domain never picks one silently.
 */
export function resolveSpeedZoneConfig<K extends SpeedZoneKind, C extends SpeedZoneConfig>(
  configs: readonly C[],
  query: SpeedZoneQuery<K>,
): (C & SpeedZoneConfig<SpeedZoneSetOfKind<K>>) | null {
  let best: C | null = null;
  let bestSpecificity = -1;
  let tied = false;
  for (const config of configs) {
    if (!appliesTo(config, query)) continue;
    const specificity = speedZoneConfigSpecificity(config);
    if (specificity > bestSpecificity) {
      best = config;
      bestSpecificity = specificity;
      tied = false;
    } else if (specificity === bestSpecificity) {
      tied = true;
    }
  }
  if (tied) {
    invalid(
      `Ambiguous ${query.kind} speed zones on ${query.onDate}: more than one configuration with the same scope applies.`,
      query,
    );
  }
  return best as (C & SpeedZoneConfig<SpeedZoneSetOfKind<K>>) | null;
}

/**
 * The zone set in force for the query, falling back to `fallback` (by default
 * the seeded default of the kind for the query's sex, `defaultSpeedZoneSet`)
 * when the club has no applicable configuration.
 */
export function resolveSpeedZoneSet<K extends SpeedZoneKind>(
  configs: readonly SpeedZoneConfig[],
  query: SpeedZoneQuery<K>,
  fallback: SpeedZoneSetOfKind<K> = defaultSpeedZoneSet(query.kind, query.sex),
): SpeedZoneSetOfKind<K> {
  return resolveSpeedZoneConfig(configs, query)?.zoneSet ?? fallback;
}

function sameScope(a: SpeedZoneConfig, b: SpeedZoneConfig): boolean {
  return (
    a.clubId === b.clubId &&
    a.zoneSet.kind === b.zoneSet.kind &&
    a.sport === b.sport &&
    a.sex === b.sex &&
    a.playerId === b.playerId
  );
}

function overlaps(a: SpeedZoneConfig, b: SpeedZoneConfig): boolean {
  const aStartsBeforeBEnds = b.validTo === null || compareLocalDates(a.validFrom, b.validTo) < 0;
  const bStartsBeforeAEnds = a.validTo === null || compareLocalDates(b.validFrom, a.validTo) < 0;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}

/**
 * Pairs of configurations with the same club, kind and scope whose validity
 * ranges overlap. Run it before saving (the new row together with the
 * existing ones): any pair makes {@link resolveSpeedZoneConfig} ambiguous on
 * the overlapping days. Contiguous ranges (`validTo` of one equal to
 * `validFrom` of the other) do not overlap.
 */
export function findSpeedZoneConfigConflicts<C extends SpeedZoneConfig>(
  configs: readonly C[],
): [C, C][] {
  const conflicts: [C, C][] = [];
  for (let i = 0; i < configs.length; i += 1) {
    const a = configs[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < configs.length; j += 1) {
      const b = configs[j];
      if (b !== undefined && sameScope(a, b) && overlaps(a, b)) conflicts.push([a, b]);
    }
  }
  return conflicts;
}
