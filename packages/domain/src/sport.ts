import { memberGuard, memberParser } from './enum.js';

/**
 * Sports supported by the model. Closed enumeration, extended by adding a value
 * here plus a migration (ADR 0017). Hockey-specific behaviour lands in M8.
 */
export const SPORTS = ['rugby', 'hockey'] as const;
export type Sport = (typeof SPORTS)[number];

export const isSport = memberGuard(SPORTS);
export const parseSport = memberParser(SPORTS, 'invalid_sport', 'sport');
