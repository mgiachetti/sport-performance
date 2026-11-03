import { formatNumber, formatUnit, isMessageKey, type Translator } from '@sport-performance/i18n';
import type { UnitCode } from '@sport-performance/domain';
import { translate } from '../i18n/i18n';

/**
 * Text of an alert from what the API sends (`messageKey` + raw `values`, ADR 0053): each value
 * is formatted es-AR with its unit before it goes into the message, as the catalog asks.
 * Values the catalog does not name are formatted as plain numbers.
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

export function formatAlertValue(name: string, value: number): string {
  const format = VALUE_FORMATS[name];
  if (format === undefined) return formatNumber(value, { maxDecimals: 2 });
  if (format.kind === 'unit') return formatUnit(value, format.unit, { decimals: format.decimals });
  return formatNumber(value, {
    decimals: format.decimals,
    ...(format.sign === undefined ? {} : { sign: format.sign }),
  });
}

/** The alert's message, or `null` when this build does not know the key yet. */
export function alertText(
  t: Translator['t'],
  alert: { readonly messageKey: string; readonly values: Readonly<Record<string, number>> },
): string | null {
  if (!isMessageKey(alert.messageKey)) return null;
  const values = Object.fromEntries(
    Object.entries(alert.values).map(([name, value]) => [name, formatAlertValue(name, value)]),
  );
  return translate(t, alert.messageKey, values);
}
