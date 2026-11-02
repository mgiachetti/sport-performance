import { memberGuard, memberParser } from './enum.js';

/**
 * Modules a club turns on or off (B-322). Closed set: a new module needs its
 * screens to check it (web and app) and its texts in `packages/i18n`. The
 * core of the product (players, categories, sessions, RPE, tests) is not a
 * module: it is always on.
 *
 * - `wellness`: pre-training wellness questionnaire (B-404).
 * - `gym`: gym routines and sets (B-405).
 * - `gps`: field metrics from GPS (Catapult imports, B-601; pods, Phase 3).
 * - `maturation`: maturation and growth (B-203): PHV, % of adult height,
 *   growth velocity. Anthropometry itself is part of the core.
 * - `pain_report`: "¿te duele algo?" with a body map in the wellness (B-609),
 *   which also needs a health consent per player.
 * - `menstrual_cycle`: opt-in menstrual cycle tracking (B-806), with its own
 *   consent; only meaningful for female branches.
 */
export const CLUB_MODULES = [
  'wellness',
  'gym',
  'gps',
  'maturation',
  'pain_report',
  'menstrual_cycle',
] as const;
export type ClubModule = (typeof CLUB_MODULES)[number];

export const isClubModule = memberGuard(CLUB_MODULES);
export const parseClubModule = memberParser(CLUB_MODULES, 'invalid_argument', 'club module');

/** Whether each module is on for a club that never changed it. */
export type ClubModules = Readonly<Record<ClubModule, boolean>>;

/**
 * Defaults: what every club gets on day one. The optional modules that touch
 * health or need extra hardware or data (`gps`, `pain_report`,
 * `menstrual_cycle`) start off; the rest of the product's monitoring starts on.
 */
export const DEFAULT_CLUB_MODULES: ClubModules = {
  wellness: true,
  gym: true,
  gps: false,
  maturation: true,
  pain_report: false,
  menstrual_cycle: false,
};

/**
 * The modules of a club: the defaults overridden by what the club stored
 * (`club.settings.modules`). Unknown keys and non-boolean values are ignored,
 * so a module removed from the product never breaks an old row.
 */
export function resolveClubModules(stored: unknown): ClubModules {
  const resolved: Record<ClubModule, boolean> = { ...DEFAULT_CLUB_MODULES };
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return resolved;
  for (const [key, value] of Object.entries(stored)) {
    if (isClubModule(key) && typeof value === 'boolean') resolved[key] = value;
  }
  return resolved;
}

/**
 * What to store after a change: the known modules of `current` with
 * `changes` applied, every module explicit (a later change of the defaults
 * does not silently flip a club's choice).
 */
export function applyClubModuleChanges(
  current: unknown,
  changes: Readonly<Partial<Record<ClubModule, boolean | undefined>>>,
): ClubModules {
  const next: Record<ClubModule, boolean> = { ...resolveClubModules(current) };
  for (const module of CLUB_MODULES) {
    const value = changes[module];
    if (value !== undefined) next[module] = value;
  }
  return next;
}
