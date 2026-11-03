#!/usr/bin/env node
/**
 * `pnpm --filter @sport-performance/db db:seed:demo` (or the
 * `sport-performance-db-seed-demo` bin): creates or extends the demo club
 * with fictitious data (B-307, ADR 0055). Separate from `db:seed` on
 * purpose: it refuses to run unless the environment is a demo one and
 * `DEMO_SEED_CONFIRM` names it (see `seeds/demo/guard.ts`).
 *
 * Options (flags win over the environment variables):
 *   --confirm=<env>        DEMO_SEED_CONFIRM   the environment, typed again
 *   --slug=<demo-…>        DEMO_SEED_SLUG      club slug (default `demo`)
 *   --seed=<text>          DEMO_SEED           seed of the data (default `demo`)
 *   --as-of=<YYYY-MM-DD>   DEMO_SEED_AS_OF     last day (default: today, club zone)
 *   --history-days=<n>     DEMO_SEED_HISTORY_DAYS  daily data window (default 84)
 *   --email-domain=<d>     DEMO_EMAIL_DOMAIN   domain of demo emails (default example.com)
 *
 * Connects with `MIGRATIONS_DATABASE_URL` or `DATABASE_URL` (the owner role,
 * like `db:seed`). Exits non-zero on failure and never prints the connection
 * string.
 */
import { parseArgs } from 'node:util';
import { parseLocalDate } from '@sport-performance/domain';
import { migrationsConnectionString } from '../migrate.js';
import { runDemoSeed } from '../seeds/demo/run.js';

function nonBlank(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v === undefined || v === '' ? undefined : v;
}

try {
  const { values } = parseArgs({
    options: {
      confirm: { type: 'string' },
      slug: { type: 'string' },
      seed: { type: 'string' },
      'as-of': { type: 'string' },
      'history-days': { type: 'string' },
      'email-domain': { type: 'string' },
    },
    strict: true,
  });
  const env = process.env;
  const asOf = nonBlank(values['as-of']) ?? nonBlank(env.DEMO_SEED_AS_OF);
  const historyDays = nonBlank(values['history-days']) ?? nonBlank(env.DEMO_SEED_HISTORY_DAYS);
  const slug = nonBlank(values.slug) ?? nonBlank(env.DEMO_SEED_SLUG);
  const seed = nonBlank(values.seed) ?? nonBlank(env.DEMO_SEED);
  const emailDomain = nonBlank(values['email-domain']) ?? nonBlank(env.DEMO_EMAIL_DOMAIN);
  const { summary } = await runDemoSeed({
    connectionString: migrationsConnectionString(),
    env: {
      RAILWAY_ENVIRONMENT_NAME: env.RAILWAY_ENVIRONMENT_NAME,
      NODE_ENV: env.NODE_ENV,
      DEMO_SEED_CONFIRM: nonBlank(values.confirm) ?? env.DEMO_SEED_CONFIRM,
    },
    ...(asOf !== undefined && { asOf: parseLocalDate(asOf) }),
    ...(historyDays !== undefined && { historyDays: Number(historyDays) }),
    ...(slug !== undefined && { slug }),
    ...(seed !== undefined && { seed }),
    ...(emailDomain !== undefined && { emailDomain }),
  });
  process.stdout.write(`${summary}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Demo seed failed: ${message}\n`);
  process.exitCode = 1;
}
