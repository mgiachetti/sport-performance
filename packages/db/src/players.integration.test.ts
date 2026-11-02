import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  inContext,
  pgErrorOf,
  type MigratedTestDatabase,
  type RoleConnection,
  type TestContext,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture, type FixtureUser } from './testing/tenant-fixture.js';

/**
 * The roster tables of B-315 (ADR 0035) through the application role: who
 * writes positions, parents' heights and the profile, the leave guard and
 * the sport invariants of categories and positions.
 */

describe.skipIf(!hasDatabase)('roster tables (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;

  const as = (who: FixtureUser): TestContext => ({
    clubId: a.clubId,
    userId: a.users[who],
    role: who === 'coachM17' ? 'coach' : who,
  });
  function run<T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) {
    return inContext(app.pool, context, work);
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'roster-a');
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe('profile', () => {
    it('coach and S&C edit the profile of their players, never of others', async () => {
      const rename = (playerId: string) => (client: pg.ClientBase) =>
        client.query(`update player set dominant_side = 'left' where id = $1`, [playerId]);
      expect((await run(as('coach'), rename(a.players.assigned))).rowCount).toBe(1);
      expect((await run(as('coach'), rename(a.players.other))).rowCount).toBe(0);
      expect((await run(as('sc'), rename(a.players.other))).rowCount).toBe(1);
      expect((await run(as('player'), rename(a.players.assigned))).rowCount).toBe(0);
      expect((await run(as('parent'), rename(a.players.assigned))).rowCount).toBe(0);
    });

    it('only the administration records a leave or creates a player', async () => {
      const leave = (client: pg.ClientBase) =>
        client.query(
          `update player set left_on = '2026-06-30', left_reason = 'quit', archived_at = now()
            where id = $1`,
          [a.players.assigned],
        );
      expect((await pgErrorOf(run(as('coach'), leave))).code).toBe('42501');
      expect((await pgErrorOf(run(as('sc'), leave))).code).toBe('42501');
      await run(as('admin'), async (client) => {
        expect((await leave(client)).rowCount).toBe(1);
        await client.query(
          `update player set left_on = null, left_reason = null, archived_at = null where id = $1`,
          [a.players.assigned],
        );
      });
      const create = (client: pg.ClientBase) =>
        client.query(
          `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
           values ($1, 'Nuevo', 'Jugador', '2012-01-01', 'male', 'rugby', '2026-03-01')`,
          [a.clubId],
        );
      expect((await pgErrorOf(run(as('coach'), create))).code).toBe('42501');
    });

    it('keeps the leave consistent and the sport fixed', async () => {
      const halfLeave = await pgErrorOf(
        run(as('admin'), (client) =>
          client.query(`update player set left_on = '2026-06-30' where id = $1`, [
            a.players.assigned,
          ]),
        ),
      );
      expect(halfLeave).toEqual({ code: '23514', constraint: 'player_leave' });
      const sport = await pgErrorOf(
        run(as('admin'), (client) =>
          client.query(`update player set sport = 'hockey' where id = $1`, [a.players.assigned]),
        ),
      );
      expect(sport).toEqual({ code: '23514', constraint: 'player_sport_fixed' });
    });
  });

  describe('positions', () => {
    it('the staff that edits profiles replaces them, within their players', async () => {
      await run(as('coach'), async (client) => {
        const removed = await client.query(`delete from player_position where player_id = $1`, [
          a.players.assigned,
        ]);
        expect(removed.rowCount).toBe(1);
        await client.query(
          `insert into player_position (club_id, player_id, position_id, sort_order)
           values ($1, $2, $3, 0)`,
          [a.clubId, a.players.assigned, a.rows.position],
        );
      });
      const foreign = await pgErrorOf(
        run(as('coach'), (client) =>
          client.query(
            `insert into player_position (club_id, player_id, position_id, sort_order)
             values ($1, $2, $3, 0)`,
            [a.clubId, a.players.other, a.rows.position],
          ),
        ),
      );
      expect(foreign.code).toBe('42501');
      // The player sees their positions but no DELETE policy covers them: nothing goes.
      const byPlayer = await run(as('player'), (client) =>
        client.query(`delete from player_position where player_id = $1`, [a.players.assigned]),
      );
      expect(byPlayer.rowCount).toBe(0);
    });

    it('must be of the player’s sport, like the categories', async () => {
      const hockey = await t.pool.query<{ id: string }>(
        `insert into position (club_id, sport, code) values ($1, 'hockey', 'goalkeeper') returning id`,
        [a.clubId],
      );
      const position = await pgErrorOf(
        t.pool.query(
          `insert into player_position (club_id, player_id, position_id, sort_order)
           values ($1, $2, $3, 1)`,
          [a.clubId, a.players.assigned, hockey.rows[0]?.id],
        ),
      );
      expect(position).toEqual({ code: '23514', constraint: 'player_position_sport' });
      await t.pool.query(
        `insert into club_branch (club_id, sport, sex) values ($1, 'hockey', 'female')`,
        [a.clubId],
      );
      const category = await t.pool.query<{ id: string }>(
        `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
         values ($1, 'hockey', 'female', 'm15', 'Hockey M15', 'development') returning id`,
        [a.clubId],
      );
      const membership = await pgErrorOf(
        t.pool.query(
          `insert into player_category (club_id, player_id, category_id, valid_from)
           values ($1, $2, $3, '2026-03-01')`,
          [a.clubId, a.players.assigned, category.rows[0]?.id],
        ),
      );
      expect(membership).toEqual({ code: '23514', constraint: 'player_category_sport' });
    });
  });

  describe('parents’ heights', () => {
    const report = (playerId: string, parent: string, source: string) => (client: pg.ClientBase) =>
      client.query(
        `insert into player_parent_height (club_id, player_id, parent, height_cm, source)
         values ($1, $2, $3, 181, $4)`,
        [a.clubId, playerId, parent, source],
      );

    it('a guardian reports them for their child, never as measured', async () => {
      await run(as('parent'), report(a.players.assigned, 'father', 'reported'));
      expect(
        (await pgErrorOf(run(as('parent'), report(a.players.other, 'father', 'reported')))).code,
      ).toBe('42501');
      const measured = await pgErrorOf(
        run(as('parent'), (client) =>
          client.query(`update player_parent_height set source = 'measured' where player_id = $1`, [
            a.players.assigned,
          ]),
        ),
      );
      expect(measured.code).toBe('42501');
    });

    it('S&C and the administration record them; the coach and the player do not', async () => {
      await run(as('sc'), report(a.players.other, 'mother', 'measured'));
      await run(as('admin'), report(a.players.other, 'father', 'reported'));
      for (const who of ['coach', 'player'] as const) {
        expect(
          (await pgErrorOf(run(as(who), report(a.players.assigned, 'mother', 'reported')))).code,
          who,
        ).toBe('42501');
      }
      // One row per parent: a second report is an update.
      const twice = await pgErrorOf(
        run(as('admin'), report(a.players.other, 'father', 'reported')),
      );
      expect(twice.code).toBe('23505');
    });
  });
});
