/**
 * Demo club and test data (B-307, ADR 0055): a deterministic generator of a
 * fictitious club with both sports and both sexes, and the writer that seeds
 * it idempotently, guarded so it never runs in production.
 *
 * - {@link generateDemoDataset}: pure, for unit tests and fixtures.
 * - {@link seedDemoClub}: writes the dataset of a demo club (`is_demo`).
 * - {@link runDemoSeed}: what the `db:seed:demo` CLI does, guard included.
 */
export {
  DEFAULT_DEMO_EMAIL_DOMAIN,
  DEFAULT_DEMO_HISTORY_DAYS,
  DEFAULT_DEMO_PLAYERS_PER_COHORT,
  DEFAULT_DEMO_SEASONS,
  DEFAULT_DEMO_SEED,
  DEFAULT_DEMO_SLUG,
  DEMO_EPOCH,
  DEMO_FEATURED,
  DEMO_INJURY_DIAGNOSIS_PREFIX,
  DEMO_MARK,
  DEMO_SLUG_PATTERN,
  DemoOptionsError,
  MIN_DEMO_PLAYERS_PER_COHORT,
  demoSeasonYear,
  generateDemoDataset,
  resolveDemoOptions,
  type DemoOptions,
} from './generate.js';
export {
  DATABASE_ENVIRONMENT_SETTING,
  DEMO_SEED_ENVIRONMENTS,
  DemoSeedRefusedError,
  assertDemoSeedAllowed,
  databaseForbidsDemo,
  demoSeedEnvironment,
  demoSeedRefusals,
  type DemoSeedEnvironment,
} from './guard.js';
export { runDemoSeed, type RunDemoSeedOptions, type RunDemoSeedResult } from './run.js';
export type * from './types.js';
export { seedDemoClub, type DemoSeedReport } from './write.js';
