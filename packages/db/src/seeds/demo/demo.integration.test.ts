/**
 * The demo club against Postgres 16 (B-307, ADR 0055): the dataset lands as
 * generated (every check, trigger and foreign key of the schema accepts it),
 * re-running is a no-op, a later day only adds and moves forward, the outbox
 * of the worker is marked, and the guards hold in the database too.
 */
import { addDays, parseLocalDate, type ClubId, type LocalDate } from '@sport-performance/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../../client.js';
import { club } from '../../schema/index.js';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  type MigratedTestDatabase,
} from '../../testing/database.js';
import { ORC_TENANT, seedTenant } from '../tenant.js';
import { totalInserted } from '../bootstrap.js';
import {
  DemoSeedRefusedError,
  generateDemoDataset,
  runDemoSeed,
  seedDemoClub,
  type DemoOptions,
} from './index.js';

const d = (value: string): LocalDate => parseLocalDate(value);
const SMALL = {
  playersPerCohort: { rugby: 6, hockey: 6 },
  historyDays: 21,
  seasons: 1,
} as const satisfies Partial<DemoOptions>;

/** Rows per table of a club. */
async function counts(t: MigratedTestDatabase, clubId: ClubId) {
  const tables = [
    'player',
    'player_category',
    'player_position',
    'player_parent_height',
    'guardian',
    'consent',
    'membership',
    'staff_assignment',
    'season',
    'test_window',
    'fixture',
    'training_session',
    'participation',
    'wellness',
    'test_session',
    'test_result',
    'test_result_value',
    'anthro_measurement',
    'reference_value',
    'medical.injury',
    'medical.hold',
  ];
  const out: Record<string, number> = {};
  for (const table of tables) {
    const quoted = table
      .split('.')
      .map((p) => `"${p}"`)
      .join('.');
    const { rows } = await t.pool.query<{ n: string }>(
      `select count(*)::text as n from ${quoted} where club_id = $1`,
      [clubId],
    );
    out[table] = Number(rows[0]?.n ?? 0);
  }
  return out;
}

describe.skipIf(!hasDatabase)('demo club (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let clubId: ClubId;
  const asOf = d('2026-06-10');

  beforeAll(async () => {
    t = await createMigratedDatabase();
  });

  afterAll(async () => {
    await t.close();
  });

  it('writes the whole dataset, accepted by every constraint of the schema', async () => {
    const report = await seedDemoClub(t.db, { asOf, ...SMALL });
    clubId = report.clubId;
    expect(report.created).toBe(true);
    expect(totalInserted(report.bootstrap)).toBeGreaterThan(0);
    const data = generateDemoDataset({ asOf, ...SMALL });
    const [row] = await t.db.select().from(club).where(eq(club.id, clubId));
    expect(row).toMatchObject({
      slug: 'demo',
      name: 'Club Atlético Demo',
      isDemo: true,
      settings: { demo: { seed: 'demo' } },
    });
    const c = await counts(t, clubId);
    expect(c).toMatchObject({
      player: data.players.length,
      player_category: data.playerCategories.length,
      player_position: data.playerPositions.length,
      guardian: data.guardians.length,
      consent: data.consents.length,
      membership: data.memberships.length,
      staff_assignment: data.staffAssignments.length,
      season: data.seasons.length,
      fixture: data.fixtures.length,
      training_session: data.trainingSessions.length,
      participation: data.participations.length,
      wellness: data.wellness.length,
      test_session: data.testSessions.length,
      test_result: data.testResults.length,
      test_result_value: data.testValues.length,
      anthro_measurement: data.anthropometry.length,
      reference_value: data.referenceValues.length,
      'medical.injury': data.injuries.length,
      'medical.hold': data.holds.length,
    });
    expect(report.inserted.wellness).toBe(data.wellness.length);
    // sRPE is the generated column, never written by the seed.
    const { rows: load } = await t.pool.query<{ ok: boolean }>(
      `select bool_and(srpe_au = rpe * minutes) as ok from participation where club_id = $1 and rpe is not null`,
      [clubId],
    );
    expect(load[0]?.ok).toBe(true);
    // Derived values are the worker's: the triggers marked every player with load or wellness.
    const { rows: pending } = await t.pool.query<{ n: string }>(
      `select count(*)::text as n from derived_refresh where club_id = $1`,
      [clubId],
    );
    expect(Number(pending[0]?.n)).toBeGreaterThan(0);
    const { rows: derived } = await t.pool.query<{ n: string }>(
      `select count(*)::text as n from anthro_measurement where club_id = $1 and phv_offset_years is not null`,
      [clubId],
    );
    expect(Number(derived[0]?.n)).toBe(0);
    // Every write of health data was logged (ADR 0008).
    const { rows: logged } = await t.pool.query<{ n: string }>(
      `select count(*)::text as n from medical.access_log where club_id = $1 and action = 'insert'`,
      [clubId],
    );
    expect(Number(logged[0]?.n)).toBe(data.injuries.length + data.holds.length);
  });

  it('is a no-op the second time for the same day', async () => {
    const before = await counts(t, clubId);
    const { rows: stamp } = await t.pool.query<{ max: string }>(
      `select max(updated_at)::text as max from player where club_id = $1`,
      [clubId],
    );
    const report = await seedDemoClub(t.db, { asOf, ...SMALL });
    expect(report.created).toBe(false);
    expect(totalInserted(report.bootstrap)).toBe(0);
    expect(Object.values(report.inserted).every((n) => n === 0)).toBe(true);
    expect(Object.values(report.updated).every((n) => n === 0)).toBe(true);
    expect(await counts(t, clubId)).toEqual(before);
    const { rows: again } = await t.pool.query<{ max: string }>(
      `select max(updated_at)::text as max from player where club_id = $1`,
      [clubId],
    );
    expect(again[0]?.max).toBe(stamp[0]?.max);
  });

  it('only adds the missing days on a later day, and keeps what the app edited', async () => {
    // The staff changed a wellness entry through the app: the seed never rewrites it.
    const { rows: edited } = await t.pool.query<{ id: string }>(
      `update wellness set sleep = 1 where id = (select id from wellness where club_id = $1 order by id limit 1) returning id`,
      [clubId],
    );
    const later = addDays(asOf, 14);
    const report = await seedDemoClub(t.db, { asOf: later, ...SMALL });
    expect(report.inserted.wellness).toBeGreaterThan(0);
    expect(report.inserted.players).toBeGreaterThanOrEqual(0);
    const data = generateDemoDataset({ asOf: later, ...SMALL });
    const { rows: days } = await t.pool.query<{ max: string; min: string }>(
      `select max(local_date)::text as max, min(local_date)::text as min from wellness where club_id = $1`,
      [clubId],
    );
    expect(days[0]).toEqual({ max: later, min: addDays(asOf, -20) });
    const { rows: ids } = await t.pool.query<{ n: string }>(
      `select count(*)::text as n from wellness where club_id = $1 and id = any($2::uuid[])`,
      [clubId, data.wellness.map((w) => w.id)],
    );
    expect(Number(ids[0]?.n)).toBe(data.wellness.length);
    const { rows: kept } = await t.pool.query<{ sleep: number }>(
      `select sleep from wellness where id = $1`,
      [edited[0]?.id],
    );
    expect(kept[0]?.sleep).toBe(1);
  });

  it('closes the season and records the M19 leaves when a new season starts', async () => {
    await seedDemoClub(t.db, { asOf: d('2026-11-25'), ...SMALL, historyDays: 3 });
    const { rows: open2026 } = await t.pool.query<{ n: string }>(
      `select count(*)::text as n from player_category pc join season s on s.id = pc.season_id
        where pc.club_id = $1 and s.name = '2026' and pc.valid_to is null`,
      [clubId],
    );
    expect(Number(open2026[0]?.n)).toBeGreaterThan(0);
    const report = await seedDemoClub(t.db, { asOf: d('2027-02-10'), ...SMALL, historyDays: 3 });
    expect(report.updated.playerLeaves).toBeGreaterThan(0);
    expect(report.updated.playerCategories).toBeGreaterThan(0);
    const { rows: overlaps } = await t.pool.query<{ n: string }>(
      `select count(*)::text as n from player_category a join player_category b
         on b.club_id = a.club_id and b.player_id = a.player_id and b.id <> a.id
        where a.club_id = $1
          and daterange(a.valid_from, a.valid_to) && daterange(b.valid_from, b.valid_to)`,
      [clubId],
    );
    expect(Number(overlaps[0]?.n)).toBe(0);
    const { rows: stillOpen } = await t.pool.query<{ n: string }>(
      `select count(*)::text as n from player_category pc join season s on s.id = pc.season_id
        where pc.club_id = $1 and s.name = '2026' and pc.valid_to is null`,
      [clubId],
    );
    expect(Number(stillOpen[0]?.n)).toBe(0);
    const { rows: graduates } = await t.pool.query<{ n: string; open: string }>(
      `select count(*)::text as n,
              count(*) filter (where pc.valid_to is null)::text as open
         from player p join player_category pc on pc.player_id = p.id
        where p.club_id = $1 and p.left_on = '2026-11-30'`,
      [clubId],
    );
    expect(Number(graduates[0]?.n)).toBeGreaterThan(0);
    expect(Number(graduates[0]?.open)).toBe(0);
  });

  it('keeps the demo apart: another demo slug is another club, other users', async () => {
    const report = await seedDemoClub(t.db, {
      asOf,
      ...SMALL,
      slug: 'demo-e2e',
      emailDomain: 'demo.test',
    });
    expect(report.created).toBe(true);
    expect(report.clubId).not.toBe(clubId);
    const { rows } = await t.pool.query<{ n: string }>(
      `select count(*)::text as n from "user" where email like 'demo-e2e.%@demo.test'`,
    );
    expect(Number(rows[0]?.n)).toBeGreaterThan(0);
  });

  it('refuses a real club, another seed and a production database', async () => {
    const orc = await seedTenant(t.db, { ...ORC_TENANT, slug: 'demo-real', name: 'Club real' });
    expect(orc.created).toBe(true);
    await expect(seedDemoClub(t.db, { asOf, ...SMALL, slug: 'demo-real' })).rejects.toThrow(
      /not a demo club/,
    );
    const { rows } = await t.pool.query<{ n: string }>(
      `select count(*)::text as n from player where club_id = $1`,
      [orc.clubId],
    );
    expect(rows[0]?.n).toBe('0');
    await expect(seedDemoClub(t.db, { asOf, ...SMALL, seed: 'otra' })).rejects.toThrow(
      /generated with seed "demo"/,
    );
    // A database that declares itself production (ADR 0055) never takes demo data.
    const { rows: name } = await t.pool.query<{ db: string }>('select current_database() as db');
    const database = `"${name[0]?.db ?? ''}"`;
    await t.pool.query(`alter database ${database} set app.deployment_environment = 'production'`);
    const pool = t.temporary.pool({ max: 1 });
    try {
      await expect(seedDemoClub(createDatabase(pool), { asOf, ...SMALL })).rejects.toThrow(
        /declares itself "production"/,
      );
      await expect(
        runDemoSeed({
          connectionString: t.connectionString,
          env: { NODE_ENV: 'test', DEMO_SEED_CONFIRM: 'test' },
          asOf,
          ...SMALL,
        }),
      ).rejects.toBeInstanceOf(DemoSeedRefusedError);
    } finally {
      await t.temporary.closePool(pool);
      await t.pool.query(`alter database ${database} reset app.deployment_environment`);
    }
  });

  it('runs from the CLI entry point only when the environment is confirmed', async () => {
    await expect(
      runDemoSeed({
        connectionString: t.connectionString,
        env: { RAILWAY_ENVIRONMENT_NAME: 'production', DEMO_SEED_CONFIRM: 'production' },
        asOf,
        ...SMALL,
      }),
    ).rejects.toThrow(DemoSeedRefusedError);
    await expect(
      runDemoSeed({
        connectionString: t.connectionString,
        env: { NODE_ENV: 'test' },
        asOf,
        ...SMALL,
      }),
    ).rejects.toThrow(/DEMO_SEED_CONFIRM/);
    const result = await runDemoSeed({
      connectionString: t.connectionString,
      env: { NODE_ENV: 'test', DEMO_SEED_CONFIRM: 'test' },
      asOf: d('2027-02-10'),
      ...SMALL,
      historyDays: 3,
    });
    expect(result.summary).toMatch(
      /^Demo seed demo \(test, as of 2027-02-10\): club already existed; 0 configuration rows, 0 demo rows inserted, 0 moved forward\.$/,
    );
  });

  it('never lets the app mark or unmark a demo club', async () => {
    const app = await connectAs(t, 'app');
    try {
      const failure = async (statement: string, params: unknown[]) => {
        try {
          await app.pool.query(statement, params);
          return 'no error';
        } catch (error) {
          return (error as Error).message;
        }
      };
      // The trigger runs before the row-level security check of the insert.
      expect(
        await failure(
          `insert into club (slug, name, short_name, is_demo) values ('demo-app', 'App', 'APP', true)`,
          [],
        ),
      ).toMatch(/Only the demo seed marks a club as a demo/);
      expect(await failure(`update club set is_demo = false where id = $1`, [clubId])).toMatch(
        /permission denied/,
      );
    } finally {
      await app.close();
    }
    const [row] = await t.db.select({ isDemo: club.isDemo }).from(club).where(eq(club.id, clubId));
    expect(row?.isDemo).toBe(true);
  });
});
