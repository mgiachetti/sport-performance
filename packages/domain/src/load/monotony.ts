import { DomainValidationError } from '../errors.js';
import type { StandardDeviationKind } from './parameters.js';
import { assertLoadAu } from './validate.js';

export interface MonotonySummary {
  /** Sum of the window's daily loads. */
  readonly totalLoadAu: number;
  readonly meanDailyLoadAu: number;
  readonly sdDailyLoadAu: number;
  /** `mean / sd`; `null` when the standard deviation is 0 (undefined). */
  readonly monotony: number | null;
  /** `totalLoad × monotony`; `null` when the monotony is undefined. */
  readonly strainAu: number | null;
}

/**
 * Relative tolerance under which a standard deviation counts as 0: identical
 * decimal loads (`[0.1, 0.1, …]`) leave a rounding residue that would
 * otherwise yield a monotony of 10¹⁵.
 */
const ZERO_SD_RELATIVE_TOLERANCE = 1e-9;

/**
 * Foster's (1998) monotony and strain over the daily loads of a window
 * (usually a week). Days without load must be present as 0. Needs at least
 * two days.
 */
export function fosterMonotony(
  dailyLoadsAu: readonly number[],
  standardDeviation: StandardDeviationKind = 'sample',
): MonotonySummary {
  if (dailyLoadsAu.length < 2) {
    throw new DomainValidationError(
      'invalid_argument',
      `fosterMonotony needs at least 2 daily loads, got ${String(dailyLoadsAu.length)}.`,
      dailyLoadsAu,
    );
  }
  let totalLoadAu = 0;
  dailyLoadsAu.forEach((loadAu, index) => {
    assertLoadAu(loadAu, `dailyLoadsAu[${String(index)}]`);
    totalLoadAu += loadAu;
  });
  const n = dailyLoadsAu.length;
  const meanDailyLoadAu = totalLoadAu / n;
  let squares = 0;
  for (const loadAu of dailyLoadsAu) squares += (loadAu - meanDailyLoadAu) ** 2;
  const rawSd = Math.sqrt(squares / (standardDeviation === 'sample' ? n - 1 : n));
  const sdDailyLoadAu =
    rawSd <= ZERO_SD_RELATIVE_TOLERANCE * Math.max(1, meanDailyLoadAu) ? 0 : rawSd;
  const monotony = sdDailyLoadAu === 0 ? null : meanDailyLoadAu / sdDailyLoadAu;
  return {
    totalLoadAu,
    meanDailyLoadAu,
    sdDailyLoadAu,
    monotony,
    strainAu: monotony === null ? null : totalLoadAu * monotony,
  };
}
