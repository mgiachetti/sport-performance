import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  inContext,
  pgErrorOf,
  type MigratedTestDatabase,
  type RoleConnection,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture } from './testing/tenant-fixture.js';

/**
 * The calendar (B-317, migration 0013): seasons that never overlap per sport,
 * windows that never overlap within a season, the one-year cap, the archive
 * columns, and the fixture table under RLS through the application role.
 */
describe.skipIf(!hasDatabase)('calendar (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'calendar-a');
    b = await seedClubFixture(t.db, 'calendar-b');
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const as = (who: 'admin' | 'coach' | 'sc' | 'player', fixture = a) => ({
    clubId: fixture.clubId,
    userId: fixture.users[who],
    role: who,
  });

  const insertSeason = (clubId: string, sport: string, name: string, from: string, to: string) =>
    t.pool.query<{ id: string }>(
      `insert into season (club_id, sport, name, starts_on, ends_on)
       values ($1, $2, $3, $4, $5) returning id`,
      [clubId, sport, name, from, to],
    );

  it('keeps the active seasons of a sport apart, ends included', async () => {
    // The fixture's rugby season is 2026-01-01 … 2026-12-31.
    expect(
      await pgErrorOf(insertSeason(a.clubId, 'rugby', '2026 B', '2026-12-31', '2027-03-01')),
    ).toMatchObject({ code: '23P01', constraint: 'season_no_overlap' });
    // Another sport, another club, or the next day: fine.
    await insertSeason(a.clubId, 'hockey', '2026', '2026-02-01', '2026-11-30');
    await insertSeason(b.clubId, 'rugby', '2027', '2027-01-01', '2027-08-01');
    await insertSeason(a.clubId, 'rugby', '2027', '2027-01-01', '2027-11-30');
  });

  it('lets an archived season overlap, and not come back while it does', async () => {
    const archived = await t.pool.query<{ id: string }>(
      `insert into season (club_id, sport, name, starts_on, ends_on, archived_at)
       values ($1, 'rugby', 'Borrador', '2026-03-01', '2026-10-31', now()) returning id`,
      [a.clubId],
    );
    expect(
      await pgErrorOf(
        t.pool.query('update season set archived_at = null where id = $1', [archived.rows[0]?.id]),
      ),
    ).toMatchObject({ code: '23P01', constraint: 'season_no_overlap' });
  });

  it('caps a season at a year and rejects padded names', async () => {
    expect(
      await pgErrorOf(insertSeason(a.clubId, 'hockey', 'Larga', '2030-01-01', '2031-01-02')),
    ).toMatchObject({ code: '23514', constraint: 'season_max_length' });
    await insertSeason(a.clubId, 'hockey', '2028', '2028-01-01', '2028-12-31');
    expect(
      await pgErrorOf(insertSeason(a.clubId, 'hockey', ' 2032', '2032-01-01', '2032-02-01')),
    ).toMatchObject({ code: '23514', constraint: 'season_name_format' });
  });

  it('keeps the active windows of a season apart', async () => {
    const seasonId = a.rows.season;
    // The fixture's V1 is 2026-02-01 … 2026-02-28.
    const insert = (number: number, from: string, to: string, archived = false) =>
      t.pool.query(
        `insert into test_window (club_id, season_id, number, starts_on, ends_on, archived_at)
         values ($1, $2, $3, $4, $5, case when $6 then now() end)`,
        [a.clubId, seasonId, number, from, to, archived],
      );
    expect(await pgErrorOf(insert(2, '2026-02-28', '2026-03-10'))).toMatchObject({
      code: '23P01',
      constraint: 'test_window_no_overlap',
    });
    await insert(2, '2026-04-01', '2026-04-30');
    await insert(3, '2026-02-10', '2026-02-20', true);
  });

  it('lets the S&C staff archive windows and the admin archive seasons, through RLS', async () => {
    await inContext(app.pool, as('sc'), async (client) => {
      const updated = await client.query(
        'update test_window set archived_at = now() where club_id = $1 and id = $2',
        [a.clubId, a.rows.test_window],
      );
      expect(updated.rowCount).toBe(1);
    });
    await inContext(app.pool, as('admin'), async (client) => {
      const updated = await client.query(
        'update season set archived_at = null where club_id = $1 and id = $2',
        [a.clubId, a.rows.season],
      );
      expect(updated.rowCount).toBe(1);
    });
    // A coach does not write seasons.
    const coach = await inContext(app.pool, as('coach'), (client) =>
      client.query('update season set archived_at = now() where club_id = $1', [a.clubId]),
    );
    expect(coach.rowCount).toBe(0);
  });

  it('lets coaches write the fixture, every member read it, nobody delete it', async () => {
    const inserted = await inContext(app.pool, as('coach'), (client) =>
      client.query<{ id: string }>(
        `insert into fixture (club_id, category_id, opponent, venue, match_date, kickoff_time)
         values ($1, $2, 'Rival', 'away', '2026-05-02', '16:00') returning id`,
        [a.clubId, a.rows.category],
      ),
    );
    const fixtureId = inserted.rows[0]?.id;
    const seen = await inContext(app.pool, as('player'), (client) =>
      client.query<{ id: string }>('select id from fixture where id = $1', [fixtureId]),
    );
    expect(seen.rows).toHaveLength(1);
    expect(
      await pgErrorOf(
        inContext(app.pool, as('player'), (client) =>
          client.query(
            `insert into fixture (club_id, category_id, opponent, venue, match_date)
             values ($1, $2, 'Rival', 'home', '2026-05-09')`,
            [a.clubId, a.rows.category],
          ),
        ),
      ),
    ).toMatchObject({ code: '42501' });
    expect(
      await pgErrorOf(
        inContext(app.pool, as('admin'), (client) =>
          client.query('delete from fixture where id = $1', [fixtureId]),
        ),
      ),
    ).toMatchObject({ code: '42501' });
    // Another club does not see it, and cannot point a match at a category of club A.
    const other = await inContext(app.pool, as('admin', b), (client) =>
      client.query('select id from fixture where id = $1', [fixtureId]),
    );
    expect(other.rows).toEqual([]);
    expect(
      await pgErrorOf(
        t.pool.query(
          `insert into fixture (club_id, category_id, opponent, venue, match_date)
           values ($1, $2, 'Rival', 'home', '2026-05-09')`,
          [b.clubId, a.rows.category],
        ),
      ),
    ).toMatchObject({ code: '23503', constraint: 'fixture_category_id_fkey' });
  });

  it('rejects blank or padded fixture texts and kick-offs with seconds', async () => {
    for (const [column, value, constraint] of [
      ['opponent', ' Rival', 'fixture_opponent_format'],
      ['competition', '', 'fixture_competition_format'],
      ['location', 'x'.repeat(121), 'fixture_location_format'],
    ] as const) {
      expect(
        await pgErrorOf(
          t.pool.query(`update fixture set ${column} = $1 where id = $2`, [value, a.rows.fixture]),
        ),
      ).toMatchObject({ code: '23514', constraint });
    }
    expect(
      await pgErrorOf(
        t.pool.query(`update fixture set kickoff_time = '15:30:42' where id = $1`, [
          a.rows.fixture,
        ]),
      ),
    ).toMatchObject({ code: '23514', constraint: 'fixture_kickoff_minute' });
  });
});
