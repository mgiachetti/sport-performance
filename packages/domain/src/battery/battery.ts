import { TEST_WINDOW_NUMBERS, type TestWindowNumber } from '../calendar/calendar.js';
import type { AgeBand } from '../category.js';
import { DomainValidationError, describeValue } from '../errors.js';
import type { CategoryId, ClubId } from '../ids.js';
import type { Sex } from '../sex.js';
import type { Sport } from '../sport.js';
import { STAGE_PROFILES, type Stage } from '../stage.js';
import { maximalLoadTestsAllowed } from '../stage-rules.js';
import { compareLocalDates, type LocalDate } from '../time.js';

/**
 * Test battery of a club (B-322, "Batería de tests" and "Calendario" of
 * CLAUDE.md): which tests a group does, in which windows of the season
 * (1 = V1 in February … 4 = V4 in November) and/or continuously every N
 * weeks (anthropometry, weekly CMJ).
 *
 * - **Scope:** a sport, narrowed by `sex`, `stage` and `categoryId`; `null`
 *   means "any". The stage is the player's (B-204: by maturation, or pinned),
 *   so one category can do different tests per stage.
 * - **Validity:** `[validFrom, validTo)`, like the speed zones. Changing the
 *   schedule of an entry in force means closing it and opening a new one, so
 *   the battery of past seasons stays readable.
 *
 * Callers may carry extra fields (id, audit columns); the functions below pass
 * them through untouched.
 */

// Test windows of a season (V1 to V4): one definition, the calendar's (B-317).
export { TEST_WINDOW_NUMBERS, type TestWindowNumber };

/** Continuous schedule: a measurement every `min` to `max` weeks. */
export interface BatteryCadenceWeeks {
  readonly min: number;
  readonly max: number;
}

/** Longest continuous cadence accepted, weeks (a year). */
export const MAX_BATTERY_CADENCE_WEEKS = 52;

export interface BatteryEntry {
  readonly clubId: ClubId;
  readonly sport: Sport;
  readonly sex: Sex | null;
  readonly stage: Stage | null;
  readonly categoryId: CategoryId | null;
  readonly testCode: string;
  readonly windows: readonly TestWindowNumber[];
  readonly cadenceWeeks: BatteryCadenceWeeks | null;
  readonly validFrom: LocalDate;
  readonly validTo: LocalDate | null;
}

/** Who and when to resolve the battery for. */
export interface BatteryQuery {
  readonly clubId: ClubId;
  readonly sport: Sport;
  readonly sex: Sex;
  readonly stage: Stage;
  /** The player's (or group's) category; `null` resolves club-wide entries only. */
  readonly categoryId: CategoryId | null;
  /** The club's day. */
  readonly onDate: LocalDate;
}

/** A problem of a battery entry, with the field it is about (for the API's `details`). */
export class BatteryEntryValidationError extends DomainValidationError {
  readonly field: string;

  constructor(field: string, message: string, value: unknown) {
    super('invalid_argument', `Invalid battery entry (${field}): ${message}`, value);
    this.field = field;
  }
}

function fail(field: string, message: string, value: unknown): never {
  throw new BatteryEntryValidationError(field, message, value);
}

/**
 * Throws {@link BatteryEntryValidationError} unless the schedule is usable:
 * windows among V1–V4 without repeats, a cadence of whole weeks with
 * `1 ≤ min ≤ max ≤ 52`, and at least one of the two.
 */
export function validateBatterySchedule(
  windows: readonly number[],
  cadenceWeeks: BatteryCadenceWeeks | null,
): void {
  const seen = new Set<number>();
  for (const window of windows) {
    if (!(TEST_WINDOW_NUMBERS as readonly number[]).includes(window)) {
      fail('windows', `expected windows 1 to 4, got ${describeValue(window)}`, window);
    }
    if (seen.has(window)) fail('windows', `window ${String(window)} is repeated`, window);
    seen.add(window);
  }
  if (cadenceWeeks !== null) {
    const { min, max } = cadenceWeeks;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1) {
      fail('cadenceWeeks', 'expected whole weeks, at least 1', cadenceWeeks);
    }
    if (max < min) fail('cadenceWeeks', 'max must be at least min', cadenceWeeks);
    if (max > MAX_BATTERY_CADENCE_WEEKS) {
      fail('cadenceWeeks', `at most ${String(MAX_BATTERY_CADENCE_WEEKS)} weeks`, cadenceWeeks);
    }
  }
  if (windows.length === 0 && cadenceWeeks === null) {
    fail('windows', 'schedule the test in at least one window or with a cadence', windows);
  }
}

/**
 * Principle 3 ("cada etapa mide lo que puede entrenar"): a test with maximal
 * loads is only scheduled for a stage that allows them and, when the entry is
 * for a category, for an age band that allows them too (never M13/M14). An
 * entry without a stage would reach every stage, the foundation one too.
 */
export function validateBatteryStage(entry: {
  readonly stage: Stage | null;
  readonly maximalLoad: boolean;
  readonly ageBand: Pick<AgeBand, 'maximalLoadTestsForPlayers'> | null;
}): void {
  if (!entry.maximalLoad) return;
  if (entry.stage === null || !STAGE_PROFILES[entry.stage].maximalLoadTests) {
    fail(
      'stage',
      'a test with maximal loads needs a stage that allows them (performance)',
      entry.stage,
    );
  }
  if (entry.ageBand !== null && !maximalLoadTestsAllowed(entry.stage, entry.ageBand)) {
    fail('categoryId', 'the age band of the category does not allow maximal loads', null);
  }
}

/**
 * How specific an entry is: category 4, stage 2, sex 1. A category entry
 * always beats a stage entry, which beats a sex entry, which beats a
 * club-wide one.
 */
export function batteryEntrySpecificity(entry: BatteryEntry): number {
  return (
    (entry.categoryId !== null ? 4 : 0) +
    (entry.stage !== null ? 2 : 0) +
    (entry.sex !== null ? 1 : 0)
  );
}

/** True when `onDate` is inside `[validFrom, validTo)`. */
export function isBatteryEntryValidOn(entry: BatteryEntry, onDate: LocalDate): boolean {
  return (
    compareLocalDates(entry.validFrom, onDate) <= 0 &&
    (entry.validTo === null || compareLocalDates(onDate, entry.validTo) < 0)
  );
}

function appliesTo(entry: BatteryEntry, query: BatteryQuery): boolean {
  return (
    entry.clubId === query.clubId &&
    entry.sport === query.sport &&
    (entry.sex === null || entry.sex === query.sex) &&
    (entry.stage === null || entry.stage === query.stage) &&
    (entry.categoryId === null || entry.categoryId === query.categoryId) &&
    isBatteryEntryValidOn(entry, query.onDate)
  );
}

/**
 * The battery in force for the query: per test, the most specific entry that
 * applies on `onDate` ({@link batteryEntrySpecificity}), sorted by test code.
 * Throws when two equally specific entries of a test apply on the same day:
 * a data error that {@link findBatteryEntryConflicts} prevents on write.
 */
export function resolveBattery<E extends BatteryEntry>(
  entries: readonly E[],
  query: BatteryQuery,
): E[] {
  const best = new Map<string, { entry: E; specificity: number; tied: boolean }>();
  for (const entry of entries) {
    if (!appliesTo(entry, query)) continue;
    const specificity = batteryEntrySpecificity(entry);
    const current = best.get(entry.testCode);
    if (current === undefined || specificity > current.specificity) {
      best.set(entry.testCode, { entry, specificity, tied: false });
    } else if (specificity === current.specificity) {
      current.tied = true;
    }
  }
  const resolved: E[] = [];
  for (const [testCode, { entry, tied }] of best) {
    if (tied) {
      throw new DomainValidationError(
        'invalid_argument',
        `Ambiguous battery for ${testCode} on ${query.onDate}: more than one entry with the same scope applies.`,
        query,
      );
    }
    resolved.push(entry);
  }
  return resolved.sort((a, b) => (a.testCode < b.testCode ? -1 : a.testCode > b.testCode ? 1 : 0));
}

function sameScope(a: BatteryEntry, b: BatteryEntry): boolean {
  return (
    a.clubId === b.clubId &&
    a.sport === b.sport &&
    a.sex === b.sex &&
    a.stage === b.stage &&
    a.categoryId === b.categoryId &&
    a.testCode === b.testCode
  );
}

/** Whether two `[from, to)` ranges share at least one day. */
export function validityRangesOverlap(
  a: { readonly validFrom: LocalDate; readonly validTo: LocalDate | null },
  b: { readonly validFrom: LocalDate; readonly validTo: LocalDate | null },
): boolean {
  const aStartsBeforeBEnds = b.validTo === null || compareLocalDates(a.validFrom, b.validTo) < 0;
  const bStartsBeforeAEnds = a.validTo === null || compareLocalDates(b.validFrom, a.validTo) < 0;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}

/**
 * Pairs of entries with the same scope and test whose validity overlaps: any
 * pair makes {@link resolveBattery} ambiguous on the shared days. Contiguous
 * ranges (`validTo` of one equal to `validFrom` of the other) do not overlap.
 */
export function findBatteryEntryConflicts<E extends BatteryEntry>(entries: readonly E[]): [E, E][] {
  const conflicts: [E, E][] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const a = entries[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < entries.length; j += 1) {
      const b = entries[j];
      if (b !== undefined && sameScope(a, b) && validityRangesOverlap(a, b)) conflicts.push([a, b]);
    }
  }
  return conflicts;
}
