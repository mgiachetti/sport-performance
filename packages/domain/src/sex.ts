import { memberGuard, memberParser } from './enum.js';

/**
 * Biological sex used by sex-specific formulas (Mirwald, Moore, Khamis-Roche)
 * and to scope comparisons (percentiles, references). Not gender identity.
 * There is intentionally no default value: formulas receive it explicitly.
 */
export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];

export const isSex = memberGuard(SEXES);
export const parseSex = memberParser(SEXES, 'invalid_sex', 'sex');
