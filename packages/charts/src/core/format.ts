import type { UnitCode } from '@sport-performance/domain';
import {
  createTranslator,
  formatNumber,
  formatUnit,
  type Translator,
} from '@sport-performance/i18n';

/** How the values of a chart are written: unit from the domain dictionary and decimals. */
export interface ValueFormat {
  /** Unit of the metric (`s`, `cm`, `au`…). Without it the number is shown alone. */
  readonly unit?: UnitCode | undefined;
  /** Exact decimals. Defaults to the unit's resolution (`UNIT_DEFAULT_DECIMALS`) or up to 2. */
  readonly decimals?: number | undefined;
}

/**
 * A value as the chart writes it in labels, tooltips and tables: es-AR (`5,25 s`, `1.980 UA`).
 * Missing values render as the i18n placeholder (`—`).
 */
export function formatValue(value: number | null | undefined, format: ValueFormat = {}): string {
  const options = format.decimals === undefined ? {} : { decimals: format.decimals };
  return format.unit === undefined
    ? formatNumber(value, options)
    : formatUnit(value, format.unit, options);
}

/** Axis tick label: the number alone (the unit goes in the chart title), with the step's decimals. */
export function formatTick(value: number, decimals: number): string {
  return formatNumber(value, { decimals });
}

let defaultTranslator: Translator | undefined;

/** es-AR translator used when the caller does not pass the club's one. */
export function getDefaultTranslator(): Translator {
  defaultTranslator ??= createTranslator();
  return defaultTranslator;
}
