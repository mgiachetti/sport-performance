import { memberGuard, memberParser } from './enum.js';

/**
 * How a result was measured. Stored with every result together with the
 * evaluator, conditions and protocol version; results measured with different
 * methods are never compared without a warning (product principle 4).
 */
export const MEASUREMENT_METHODS = [
  'manual',
  'video',
  'photocell',
  'pod',
  'app',
  'historical',
] as const;
export type MeasurementMethod = (typeof MEASUREMENT_METHODS)[number];

export const isMeasurementMethod = memberGuard(MEASUREMENT_METHODS);
export const parseMeasurementMethod = memberParser(
  MEASUREMENT_METHODS,
  'invalid_measurement_method',
  'measurement method',
);

/**
 * Pre-training wellness items, each scored 1–5. Which items a stage asks for
 * (3 with faces in M13/M14, all 5 later) is configuration, not part of the type.
 */
export const WELLNESS_ITEMS = ['sleep', 'fatigue', 'soreness', 'stress', 'mood'] as const;
export type WellnessItem = (typeof WELLNESS_ITEMS)[number];

export const isWellnessItem = memberGuard(WELLNESS_ITEMS);
export const parseWellnessItem = memberParser(
  WELLNESS_ITEMS,
  'invalid_wellness_item',
  'wellness item',
);
