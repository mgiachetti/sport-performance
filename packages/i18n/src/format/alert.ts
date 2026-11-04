import type { UnitCode } from '@sport-performance/domain';
import { isMessageKey, type MessageKey, type MessageValues } from '../messages/index.js';
import { MessageFormatError, type Translator } from '../translator.js';
import { formatNumber } from './number.js';
import { formatUnit } from './unit.js';

/**
 * Text of an alert from what the API sends (`messageKey` / `suggestionKey` + raw `values`,
 * ADR 0053), the same on the web and in the app: each value is formatted es-AR with its unit
 * before it goes into the message, as the catalog asks. Values the catalog does not name are
 * formatted as plain numbers.
 */
type ValueFormat =
  | { readonly kind: 'number'; readonly decimals: number; readonly sign?: 'always' }
  | { readonly kind: 'unit'; readonly unit: UnitCode; readonly decimals: number };

const VALUE_FORMATS: Readonly<Record<string, ValueFormat>> = {
  acwrRatio: { kind: 'number', decimals: 2 },
  thresholdRatio: { kind: 'number', decimals: 2 },
  wellnessScore: { kind: 'number', decimals: 1 },
  thresholdScore: { kind: 'number', decimals: 1 },
  meanScore: { kind: 'number', decimals: 1 },
  sdScore: { kind: 'number', decimals: 1 },
  zScore: { kind: 'number', decimals: 1, sign: 'always' },
  thresholdZScore: { kind: 'number', decimals: 1, sign: 'always' },
  dropPct: { kind: 'unit', unit: 'pct', decimals: 1 },
  thresholdPct: { kind: 'unit', unit: 'pct', decimals: 1 },
  heightCm: { kind: 'unit', unit: 'cm', decimals: 1 },
  baselineHeightCm: { kind: 'unit', unit: 'cm', decimals: 1 },
  velocityCmYear: { kind: 'unit', unit: 'cm_year', decimals: 1 },
  thresholdCmYear: { kind: 'unit', unit: 'cm_year', decimals: 1 },
};

/** One value of an alert, es-AR, with the unit and decimals the catalog expects for it. */
export function formatAlertValue(name: string, value: number): string {
  const format = VALUE_FORMATS[name];
  if (format === undefined) return formatNumber(value, { maxDecimals: 2 });
  if (format.kind === 'unit') return formatUnit(value, format.unit, { decimals: format.decimals });
  return formatNumber(value, {
    decimals: format.decimals,
    ...(format.sign === undefined ? {} : { sign: format.sign }),
  });
}

/**
 * The text of `key` (an alert's `messageKey` or `suggestionKey`) with its values, or `null`
 * when this build does not know the key yet or the values do not fit it (an older build
 * reading a newer rule): the caller shows a generic line instead of failing.
 */
export function alertMessage(
  t: Translator['t'],
  key: string,
  values: Readonly<Record<string, number>> = {},
): string | null {
  if (!isMessageKey(key)) return null;
  const formatted: MessageValues = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [name, formatAlertValue(name, value)]),
  );
  try {
    return (t as (key: MessageKey, values?: MessageValues) => string)(key, formatted);
  } catch (error) {
    if (error instanceof MessageFormatError) return null;
    throw error;
  }
}
