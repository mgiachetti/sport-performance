import { DomainValidationError } from '../errors.js';
import { addDays, compareLocalDates, parseLocalDate, type LocalDate } from '../time.js';
import { WELLNESS_SCORE_MAX, WELLNESS_SCORE_MIN } from '../wellness/index.js';
import { DEFAULT_WELLNESS_BASELINE_PARAMS, type WellnessBaselineParams } from './parameters.js';

/** A player's wellness of one club day: the mean of the answered items (1–5). */
export interface WellnessDay {
  readonly date: LocalDate;
  readonly meanScore: number;
  /** Items answered (3 with faces in M13/M14, otherwise 5). */
  readonly itemCount: number;
}

/** A wellness day compared with the player's own rolling baseline. */
export interface WellnessBaselineDay extends WellnessDay {
  /** Entries in the `windowDays` days before `date` (the day itself excluded). */
  readonly baselineSamples: number;
  /** Mean of those entries; `null` without entries. */
  readonly baselineMeanScore: number | null;
  /** Sample standard deviation (n − 1); `null` with fewer than two entries. */
  readonly baselineSdScore: number | null;
  /**
   * `(meanScore − baselineMean) / baselineSd`; `null` with fewer than
   * `minSamples` entries or without variation (an undefined z-score is never 0).
   */
  readonly zScore: number | null;
}

/** Same tolerance as the alert engine: a standard deviation below it is no variation. */
const EPSILON = 1e-9;

/**
 * Each day's wellness against the player's own past (CLAUDE.md: "bienestar
 * también contra la media móvil propia (z-score)"), with the same window as
 * the `wellness_zscore_low` rule so the panel and the alerts agree. Input
 * order does not matter; one entry per day.
 */
export function wellnessBaselineSeries(
  days: readonly WellnessDay[],
  params: WellnessBaselineParams = DEFAULT_WELLNESS_BASELINE_PARAMS,
): WellnessBaselineDay[] {
  const seen = new Set<LocalDate>();
  const sorted = days
    .map((day) => {
      const date = parseLocalDate(day.date);
      if (seen.has(date)) {
        throw new DomainValidationError(
          'invalid_argument',
          `Two wellness entries on ${date}.`,
          date,
        );
      }
      seen.add(date);
      if (
        !Number.isFinite(day.meanScore) ||
        day.meanScore < WELLNESS_SCORE_MIN ||
        day.meanScore > WELLNESS_SCORE_MAX
      ) {
        throw new DomainValidationError(
          'invalid_argument',
          `Wellness mean score on ${date} must be between 1 and 5.`,
          day.meanScore,
        );
      }
      return { ...day, date };
    })
    .sort((a, b) => compareLocalDates(a.date, b.date));

  return sorted.map((day, index) => {
    const from = addDays(day.date, -params.windowDays);
    const window: number[] = [];
    for (let i = index - 1; i >= 0; i--) {
      const previous = sorted[i];
      if (previous === undefined || compareLocalDates(previous.date, from) < 0) break;
      window.push(previous.meanScore);
    }
    const samples = window.length;
    const mean = samples === 0 ? null : window.reduce((a, b) => a + b, 0) / samples;
    const sd =
      mean === null || samples < 2
        ? null
        : Math.sqrt(window.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (samples - 1));
    const zScore =
      mean !== null && sd !== null && samples >= params.minSamples && sd >= EPSILON
        ? (day.meanScore - mean) / sd
        : null;
    return {
      ...day,
      baselineSamples: samples,
      baselineMeanScore: mean,
      baselineSdScore: sd,
      zScore,
    };
  });
}
