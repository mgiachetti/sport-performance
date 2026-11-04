import {
  CANONICAL_METRICS,
  isCanonicalMetricCode,
  type UnitCode,
  type WellnessItem,
} from '@sport-performance/domain';
import {
  formatNumber,
  formatUnit,
  isMessageKey,
  type MessageKey,
  type MessageValues,
  type Translator,
} from '@sport-performance/i18n';

/** Formatting of the player app (es-AR, units of the metric dictionary). */

type T = Translator['t'];

/** A key built at runtime, already checked with `isMessageKey`. */
export function translate(t: T, key: MessageKey, values?: MessageValues): string {
  return (t as (key: MessageKey, values?: MessageValues) => string)(key, values);
}

/** A catalog code without a message (an exercise) as words: `trap bar deadlift`. */
export function humanizeCode(code: string): string {
  return code.replaceAll('_', ' ');
}

export function testLabel(t: T, testCode: string): string {
  const key = `test.${testCode}`;
  return isMessageKey(key) ? translate(t, key) : humanizeCode(testCode);
}

/** Name of a test metric, with the strength exercise when there is one. */
export function metricLabel(t: T, metricCode: string, exercise: string | null): string {
  const key = `player.metric.${metricCode}`;
  const metric = isMessageKey(key) ? translate(t, key) : humanizeCode(metricCode);
  return exercise === null
    ? metric
    : t('player.metric.withExercise', { metric, exercise: humanizeCode(exercise) });
}

/** A value with the unit of its metric (the dictionary's, else the one the server sent). */
export function metricValue(metricCode: string, value: number, unit?: string): string {
  if (isCanonicalMetricCode(metricCode))
    return formatUnit(value, CANONICAL_METRICS[metricCode].unit);
  const formatted = formatNumber(value, { maxDecimals: 2 });
  return unit === undefined ? formatted : `${formatted} ${unit}`;
}

export function unitValue(value: number, unit: UnitCode): string {
  return formatUnit(value, unit);
}

export function wellnessItemLabel(t: T, item: WellnessItem): string {
  return t(`wellness.item.${item}`);
}

/** The Borg label of a CR-10 value, where the scale has one. */
export function rpeLabel(t: T, value: number): string | null {
  const key = `rpe.scale.${String(value)}`;
  return isMessageKey(key) ? translate(t, key) : null;
}
