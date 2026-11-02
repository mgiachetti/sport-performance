/**
 * Seeds (B-306): reference data and the default configuration of a club,
 * built from the constants of `@sport-performance/domain` (single source of
 * truth). Every function is idempotent: re-running inserts nothing and never
 * overwrites what a club edited.
 *
 * - {@link bootstrapClub}: what club creation (B-313) calls for a new club.
 * - {@link seedTenant} / {@link ORC_TENANT}: the first tenant, used by the
 *   `db:seed` CLI.
 * - {@link loadKhamisRocheTable}: reads the seeded coefficients back as a
 *   domain `KhamisRocheTable`.
 */
export {
  BootstrapClubError,
  DEFAULT_SEED_VALID_FROM,
  bootstrapClub,
  totalInserted,
  type BootstrapClubOptions,
  type BootstrapClubReport,
  type ClubBranch,
} from './bootstrap.js';
export { batterySeeds, type BatterySeed, type TestWindowNumber } from './battery.js';
export { DEFAULT_CATAPULT_ALIASES, normalizeCatapultAlias } from './catapult-aliases.js';
export type { SeedExecutor } from './executor.js';
export {
  SEEDED_KHAMIS_ROCHE_TABLES,
  khamisRocheCoefficientSeeds,
  khamisRocheTableSeed,
  loadKhamisRocheTable,
} from './khamis-roche.js';
export { catapultAliasesOf, metricDefinitionSeeds, type ClubSeedRow } from './metrics.js';
export {
  DERIVED_TEST_METRIC_CODES,
  SEEDED_PROTOCOL_VERSION,
  isDerivedTestMetric,
  testAppliesToSport,
  testDefinitionSeeds,
  type TestDefinitionSeed,
} from './test-definitions.js';
export { runSeed, type RunSeedOptions, type RunSeedResult } from './run.js';
export { ORC_TENANT, seedTenant, type SeedTenantResult, type TenantSeed } from './tenant.js';
