import { createDatabase, createPool } from '../client.js';
import { totalInserted } from './bootstrap.js';
import { ORC_TENANT, seedTenant, type SeedTenantResult, type TenantSeed } from './tenant.js';

export interface RunSeedOptions {
  readonly connectionString: string;
  /** Defaults to the ORC tenant. */
  readonly tenant?: TenantSeed;
}

export interface RunSeedResult extends SeedTenantResult {
  /** One line for the CLI output; no connection details. */
  readonly summary: string;
}

/** What `db:seed` does: opens a short-lived pool, seeds the tenant, closes the pool. */
export async function runSeed(options: RunSeedOptions): Promise<RunSeedResult> {
  const tenant = options.tenant ?? ORC_TENANT;
  const pool = createPool({
    connectionString: options.connectionString,
    applicationName: 'db-seed',
    max: 1,
  });
  try {
    const result = await seedTenant(createDatabase(pool), tenant);
    const details = Object.entries(result.report)
      .filter(([, count]) => count > 0)
      .map(([table, count]) => `${table} ${String(count)}`)
      .join(', ');
    const summary =
      `Seed ${tenant.slug}: club ${result.created ? 'created' : 'already existed'}; ` +
      `${String(totalInserted(result.report))} rows inserted${details === '' ? '' : ` (${details})`}.`;
    return { ...result, summary };
  } finally {
    await pool.end();
  }
}
