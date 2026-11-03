import type { TestResult } from '@sport-performance/contracts';
import {
  CANONICAL_METRICS,
  compareLocalDates,
  isCanonicalMetricCode,
  type LocalDate,
  type MeasurementMethod,
  type MetricDirection,
  type UnitCode,
} from '@sport-performance/domain';

/** The player's best value of one metric (and exercise, in strength). */
export interface PersonalRecord {
  readonly key: string;
  readonly metricCode: string;
  readonly testCode: string;
  readonly exercise: string | null;
  readonly unit: UnitCode;
  readonly direction: Exclude<MetricDirection, 'neutral'>;
  readonly value: number;
  readonly measuredOn: LocalDate;
  readonly method: MeasurementMethod | null;
  /** Results counted for this metric. */
  readonly resultCount: number;
  /** The results compared were measured with different methods (principle 4). */
  readonly mixedMethods: boolean;
}

function better(direction: PersonalRecord['direction'], a: number, b: number): boolean {
  return direction === 'higher_is_better' ? a > b : a < b;
}

/**
 * Own records (B-503): the best score of each metric of the canonical
 * dictionary with a direction, over the player's done results, by exercise in
 * strength. A tie keeps the earliest day (the day the record was set).
 * Neutral metrics have no "best", and a metric outside the
 * dictionary has no known direction: neither is a record. Methods are kept
 * so the screen can warn when the series mixes them.
 */
export function personalRecords(results: readonly TestResult[]): PersonalRecord[] {
  const records = new Map<string, PersonalRecord & { methods: Set<string> }>();
  const ordered = [...results].sort((a, b) => compareLocalDates(a.measuredOn, b.measuredOn));
  for (const result of ordered) {
    if (result.status !== 'done') continue;
    for (const score of result.scores) {
      if (!isCanonicalMetricCode(score.metricCode)) continue;
      const metric = CANONICAL_METRICS[score.metricCode];
      if (metric.direction === 'neutral' || metric.source !== 'test') continue;
      const direction = metric.direction;
      const key = `${score.metricCode}:${result.exercise ?? ''}`;
      const current = records.get(key);
      const method = result.method;
      if (current === undefined) {
        records.set(key, {
          key,
          metricCode: score.metricCode,
          testCode: result.testCode,
          exercise: result.exercise,
          unit: metric.unit,
          direction,
          value: score.value,
          measuredOn: result.measuredOn,
          method,
          resultCount: 1,
          mixedMethods: false,
          methods: new Set(method === null ? [] : [method]),
        });
        continue;
      }
      if (method !== null) current.methods.add(method);
      const next = better(direction, score.value, current.value)
        ? { value: score.value, measuredOn: result.measuredOn, method }
        : {};
      records.set(key, {
        ...current,
        ...next,
        resultCount: current.resultCount + 1,
        mixedMethods: current.methods.size > 1,
      });
    }
  }
  return [...records.values()].map((record): PersonalRecord => ({
    key: record.key,
    metricCode: record.metricCode,
    testCode: record.testCode,
    exercise: record.exercise,
    unit: record.unit,
    direction: record.direction,
    value: record.value,
    measuredOn: record.measuredOn,
    method: record.method,
    resultCount: record.resultCount,
    mixedMethods: record.mixedMethods,
  }));
}

/** The player's results, newest first (ties: the latest created). */
export function testHistory(results: readonly TestResult[]): TestResult[] {
  return [...results].sort(
    (a, b) => compareLocalDates(b.measuredOn, a.measuredOn) || (a.createdAt < b.createdAt ? 1 : -1),
  );
}
