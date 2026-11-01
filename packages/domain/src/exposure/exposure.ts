import { describeValue } from '../errors.js';
import type { PlayerId } from '../ids.js';
import type { LocalDate } from '../time.js';
import { isExposureContext, type ExposureContext } from './contexts.js';
import { assertLocalDate, invalid, periodFilter, type DatePeriod } from './period.js';

/** Upper bound for one participation entry: a whole day. */
export const MAX_EXPOSURE_ENTRY_MIN = 24 * 60;

const MIN_PER_H = 60;

/**
 * Time one player actually took part in one club session or match (B-318
 * participation). Minutes are the minutes played or trained, not the length of
 * the session: an absent player contributes 0, a substitute their minutes on
 * the field.
 */
export interface ExposureEntry {
  readonly playerId: PlayerId;
  /** Club day of the session (computed in the club's time zone). */
  readonly date: LocalDate;
  readonly context: ExposureContext;
  readonly durationMin: number;
}

/** Exposure hours by context. `totalH = trainingH + matchH`. */
export interface ExposureHours {
  readonly trainingH: number;
  readonly matchH: number;
  readonly totalH: number;
}

export function minutesToHours(minutes: number): number {
  return minutes / MIN_PER_H;
}

function assertExposureEntry(entry: ExposureEntry, index: number): void {
  const label = `exposures[${String(index)}]`;
  assertLocalDate(entry.date, `${label}.date`);
  if (!isExposureContext(entry.context)) {
    throw invalid(
      `${label}.context must be training or match, got ${describeValue(entry.context)}.`,
      entry,
    );
  }
  const { durationMin } = entry;
  if (
    typeof durationMin !== 'number' ||
    !Number.isFinite(durationMin) ||
    durationMin < 0 ||
    durationMin > MAX_EXPOSURE_ENTRY_MIN
  ) {
    throw invalid(
      `${label}.durationMin must be between 0 and ${String(MAX_EXPOSURE_ENTRY_MIN)} minutes, got ${describeValue(durationMin)}.`,
      entry,
    );
  }
}

interface MinutesAccumulator {
  trainingMin: number;
  matchMin: number;
}

function toHours({ trainingMin, matchMin }: MinutesAccumulator): ExposureHours {
  // Summed in minutes and converted once, so hours do not accumulate rounding.
  return {
    trainingH: minutesToHours(trainingMin),
    matchH: minutesToHours(matchMin),
    totalH: minutesToHours(trainingMin + matchMin),
  };
}

function addEntry(acc: MinutesAccumulator, entry: ExposureEntry): void {
  if (entry.context === 'training') acc.trainingMin += entry.durationMin;
  else acc.matchMin += entry.durationMin;
}

/** Validates every entry (also those outside the period) and returns the ones inside it. */
function entriesInPeriod(
  entries: readonly ExposureEntry[],
  period: DatePeriod | undefined,
): ExposureEntry[] {
  const inPeriod = periodFilter(period);
  entries.forEach(assertExposureEntry);
  return entries.filter((entry) => inPeriod(entry.date));
}

/**
 * Exposure hours of a population (the players whose entries are given) in the
 * inclusive period.
 */
export function exposureHours(
  entries: readonly ExposureEntry[],
  period?: DatePeriod,
): ExposureHours {
  const acc: MinutesAccumulator = { trainingMin: 0, matchMin: 0 };
  for (const entry of entriesInPeriod(entries, period)) addEntry(acc, entry);
  return toHours(acc);
}

/**
 * Exposure hours per player in the inclusive period. Players without entries
 * in the period are absent from the map.
 */
export function exposureHoursByPlayer(
  entries: readonly ExposureEntry[],
  period?: DatePeriod,
): Map<PlayerId, ExposureHours> {
  const byPlayer = new Map<PlayerId, MinutesAccumulator>();
  for (const entry of entriesInPeriod(entries, period)) {
    let acc = byPlayer.get(entry.playerId);
    if (acc === undefined) {
      acc = { trainingMin: 0, matchMin: 0 };
      byPlayer.set(entry.playerId, acc);
    }
    addEntry(acc, entry);
  }
  return new Map([...byPlayer].map(([playerId, acc]) => [playerId, toHours(acc)]));
}
