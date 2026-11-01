import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const packageDir = fileURLToPath(new URL('../..', import.meta.url));
const migrationsDir = join(packageDir, 'drizzle');
const drizzleKit = join(packageDir, 'node_modules', '.bin', 'drizzle-kit');

/**
 * The TypeScript schema and the committed migrations must not drift: running
 * `drizzle-kit generate` against a copy of `drizzle/` must find nothing to do.
 * If this fails, run `pnpm --filter @sport-performance/db db:generate` and
 * commit the new migration.
 */
describe('migrations', () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'sp-db-sync-'));
    await cp(migrationsDir, join(workDir, 'drizzle'), { recursive: true });
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it('are in sync with the schema', { timeout: 120_000 }, async () => {
    const out = join(workDir, 'drizzle');
    const before = await readdir(out);
    // drizzle-kit prefixes `out` with "./", so it must be relative to the cwd.
    const { stdout } = await run(
      drizzleKit,
      [
        'generate',
        '--dialect=postgresql',
        '--schema=./src/schema/index.ts',
        `--out=${relative(packageDir, out)}`,
      ],
      { cwd: packageDir },
    );
    expect(stdout).toContain('No schema changes');
    expect(await readdir(out)).toEqual(before);
  });
});
