import {
  DEFAULT_CLUB_TIME_ZONE,
  localDateInTimeZone,
  type LocalDate,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import { createDatabase, createPool } from '../../client.js';
import { totalInserted } from '../bootstrap.js';
import type { DemoOptions } from './generate.js';
import {
  DATABASE_ENVIRONMENT_SETTING,
  assertDemoSeedAllowed,
  type DemoSeedEnvironment,
} from './guard.js';
import { seedDemoClub, type DemoSeedReport } from './write.js';

export interface RunDemoSeedOptions extends Omit<DemoOptions, 'asOf'> {
  readonly connectionString: string;
  /** The process environment the guard checks (`process.env` in the CLI). */
  readonly env: DemoSeedEnvironment;
  /** Defaults to today in the club's zone. */
  readonly asOf?: LocalDate;
  /** Injectable clock for "today". */
  readonly now?: () => Date;
}

export interface RunDemoSeedResult extends DemoSeedReport {
  readonly environment: string;
  readonly asOf: LocalDate;
  /** One line for the CLI output; no connection details, no personal data. */
  readonly summary: string;
}

/**
 * What `db:seed:demo` does: checks the guard (environment, confirmation and
 * the database's declared environment, see `guard.ts`), then writes the demo
 * club up to `asOf` in one transaction. Re-running it is a no-op for the same
 * day; run daily (a Railway cron in staging) it keeps the demo current.
 */
export async function runDemoSeed(options: RunDemoSeedOptions): Promise<RunDemoSeedResult> {
  const { connectionString, env, now, ...rest } = options;
  const pool = createPool({ connectionString, applicationName: 'db-seed-demo', max: 1 });
  try {
    const db = createDatabase(pool);
    const [setting] = (
      await db.execute<{ value: string | null }>(
        sql`select current_setting(${DATABASE_ENVIRONMENT_SETTING}, true) as value`,
      )
    ).rows;
    const environment = assertDemoSeedAllowed(env, setting?.value ?? null);
    const asOf = rest.asOf ?? localDateInTimeZone(now?.() ?? new Date(), DEFAULT_CLUB_TIME_ZONE);
    const report = await seedDemoClub(db, { ...rest, asOf });
    const rows = Object.values(report.inserted).reduce((sum, n) => sum + n, 0);
    const moved = Object.values(report.updated).reduce((sum, n) => sum + n, 0);
    const summary =
      `Demo seed ${rest.slug ?? 'demo'} (${environment}, as of ${asOf}): ` +
      `club ${report.created ? 'created' : 'already existed'}; ` +
      `${String(totalInserted(report.bootstrap))} configuration rows, ` +
      `${String(rows)} demo rows inserted, ${String(moved)} moved forward.`;
    return { ...report, environment, asOf, summary };
  } finally {
    await pool.end();
  }
}
