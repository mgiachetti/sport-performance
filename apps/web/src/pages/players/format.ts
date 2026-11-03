import type { AvailabilityStatus, UnitCode } from '@sport-performance/domain';
import {
  formatNumber,
  formatUnit,
  isMessageKey,
  type MessageValues,
  type Translator,
} from '@sport-performance/i18n';
import type { StatusLevel } from '@sport-performance/ui-tokens';
import { translate } from '../../i18n/i18n';

/** Formatting shared by the blocks of the player profile (es-AR, units of the dictionary). */

/** A catalog code without a message (an exercise, a club position) as words: `trap bar deadlift`. */
export function humanizeCode(code: string): string {
  return code.replaceAll('_', ' ');
}

/** Name of a test metric, with the strength exercise when there is one. */
export function metricLabel(t: Translator['t'], metricCode: string, exercise: string | null) {
  const key = `player.metric.${metricCode}`;
  const metric = isMessageKey(key) ? translate(t, key) : humanizeCode(metricCode);
  return exercise === null
    ? metric
    : t('player.metric.withExercise', { metric, exercise: humanizeCode(exercise) });
}

/** The availability as a status (icon + text): available, limited, unavailable. */
export const AVAILABILITY_LEVEL: Record<AvailabilityStatus, StatusLevel> = {
  available: 'ok',
  limited: 'warning',
  unavailable: 'critical',
};

export function availabilityLabel(t: Translator['t'], status: AvailabilityStatus): string {
  return t(`player.availability.status.${status}`);
}

/**
 * The numeric values of an alert as its message shows them, by the name's
 * suffix (the engine's convention, B-207): ratios and z-scores with two
 * decimals, scores with one, percentages, centimetres and cm/year with
 * their unit.
 */
export function alertMessageValues(values: Readonly<Record<string, number>>): MessageValues {
  const formatted: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    formatted[name] = formatAlertValue(name, value);
  }
  return formatted;
}

const SUFFIX_UNITS: readonly (readonly [string, UnitCode, number])[] = [
  ['CmYear', 'cm_year', 1],
  ['Pct', 'pct', 1],
  ['Cm', 'cm', 1],
];

export function formatAlertValue(name: string, value: number): string {
  for (const [suffix, unit, decimals] of SUFFIX_UNITS) {
    if (name.endsWith(suffix)) return formatUnit(value, unit, { decimals });
  }
  if (name.endsWith('Ratio') || /z_?score$/i.test(name))
    return formatNumber(value, { decimals: 2 });
  if (name.endsWith('Score')) return formatNumber(value, { decimals: 1 });
  return formatNumber(value, { decimals: Number.isInteger(value) ? 0 : 1 });
}
