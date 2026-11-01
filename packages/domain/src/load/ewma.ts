import { MAX_LOAD_WINDOW_DAYS, type EwmaSeed } from './parameters.js';
import { assertIntegerInRange, assertLoadAu } from './validate.js';

/** EWMA decay of an `N`-day window (Williams et al. 2017): `λ = 2/(N+1)`. */
export function ewmaLambda(windowDays: number): number {
  assertIntegerInRange(windowDays, 'windowDays', 1, MAX_LOAD_WINDOW_DAYS);
  return 2 / (windowDays + 1);
}

/** One EWMA step: `EWMA_today = load_today·λ + (1−λ)·EWMA_yesterday`. */
export function nextEwmaAu(previousEwmaAu: number, loadAu: number, lambda: number): number {
  return loadAu * lambda + (1 - lambda) * previousEwmaAu;
}

/**
 * EWMA of a gap-free daily series: index 0 is the first day of history and
 * days without data are already 0. See {@link EwmaSeed} for the first value.
 */
export function ewmaSeriesAu(
  dailyLoadsAu: readonly number[],
  windowDays: number,
  seed: EwmaSeed = 'first_day',
): number[] {
  const lambda = ewmaLambda(windowDays);
  const result: number[] = [];
  let previous = 0;
  dailyLoadsAu.forEach((loadAu, index) => {
    assertLoadAu(loadAu, `dailyLoadsAu[${String(index)}]`);
    previous = index === 0 && seed === 'first_day' ? loadAu : nextEwmaAu(previous, loadAu, lambda);
    result.push(previous);
  });
  return result;
}

/**
 * Acute:chronic workload ratio `EWMA_acute / EWMA_chronic`. `null` when the
 * chronic load is 0: the ratio is undefined, not infinite.
 */
export function acuteChronicWorkloadRatio(
  acuteEwmaAu: number,
  chronicEwmaAu: number,
): number | null {
  assertLoadAu(acuteEwmaAu, 'acuteEwmaAu');
  assertLoadAu(chronicEwmaAu, 'chronicEwmaAu');
  return chronicEwmaAu === 0 ? null : acuteEwmaAu / chronicEwmaAu;
}
