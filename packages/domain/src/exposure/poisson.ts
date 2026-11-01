import { describeValue } from '../errors.js';
import { invalid } from './period.js';

/** Two-sided confidence interval. */
export interface ConfidenceInterval {
  readonly lower: number;
  readonly upper: number;
}

/** P(X ≤ k) for X ~ Poisson(mean), summed in log space so large means do not underflow. */
function poissonCdf(k: number, mean: number): number {
  if (k < 0) return 0;
  if (mean === 0) return 1;
  const logMean = Math.log(mean);
  let logTerm = -mean; // log P(X = 0)
  let maxLog = logTerm;
  let scaledSum = 1;
  for (let i = 1; i <= k; i++) {
    logTerm += logMean - Math.log(i);
    if (logTerm > maxLog) {
      scaledSum = scaledSum * Math.exp(maxLog - logTerm) + 1;
      maxLog = logTerm;
    } else {
      scaledSum += Math.exp(logTerm - maxLog);
    }
  }
  return Math.min(1, Math.exp(maxLog + Math.log(scaledSum)));
}

/** Mean μ at which `poissonCdf(k, μ) = target` (the CDF decreases with μ). */
function solveMean(k: number, target: number): number {
  let lo = 0;
  let hi = k + 1;
  while (poissonCdf(k, hi) > target) hi *= 2;
  for (let i = 0; i < 200 && hi - lo > 1e-12 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (poissonCdf(k, mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Exact (Garwood 1936) confidence interval for the mean of a Poisson count.
 * Valid for any count, including 0 (lower bound 0).
 */
export function poissonMeanConfidenceInterval(
  count: number,
  confidenceLevel: number,
): ConfidenceInterval {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw invalid(`count must be a non-negative integer, got ${describeValue(count)}.`, count);
  }
  assertConfidenceLevel(confidenceLevel);
  const alpha = 1 - confidenceLevel;
  const lower = count === 0 ? 0 : solveMean(count - 1, 1 - alpha / 2);
  const upper = solveMean(count, alpha / 2);
  return { lower, upper };
}

/**
 * Exact Poisson confidence interval of a rate `count / exposure × ratePer`,
 * e.g. injuries per 1000 h with `exposure` in hours and `ratePer = 1000`.
 * Exposure must be positive: without exposure there is no rate.
 */
export function poissonRateConfidenceInterval(
  count: number,
  exposure: number,
  confidenceLevel: number,
  ratePer = 1,
): ConfidenceInterval {
  assertPositive(exposure, 'exposure');
  assertPositive(ratePer, 'ratePer');
  const { lower, upper } = poissonMeanConfidenceInterval(count, confidenceLevel);
  const scale = ratePer / exposure;
  return { lower: lower * scale, upper: upper * scale };
}

export function assertConfidenceLevel(confidenceLevel: number): void {
  if (typeof confidenceLevel !== 'number' || !(confidenceLevel > 0 && confidenceLevel < 1)) {
    throw invalid(
      `confidenceLevel must be strictly between 0 and 1, got ${describeValue(confidenceLevel)}.`,
      confidenceLevel,
    );
  }
}

export function assertPositive(value: number, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw invalid(`${label} must be a positive finite number, got ${describeValue(value)}.`, value);
  }
}
