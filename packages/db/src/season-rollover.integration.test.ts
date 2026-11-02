import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  inContext,
  must,
  pgErrorOf,
  type MigratedTestDatabase,
  type RoleConnection,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture } from './testing/tenant-fixture.js';

/**
 * Season change (B-316, migration 0021): one draft per season, the
 * consistency checks of an item, the guards that freeze an applied or
 * cancelled change, and RLS (only the administration) through the app role.
 */
describe.skipIf(!hasDatabase)('season change (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'rollover-a');
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const m15 = () => must(a.rows.category);
  const draft = async (status = 'draft') => {
    const { rows } = await t.pool.query<{ id: string }>(
      `insert into season_rollover (club_id, season_id, effective_on, season_year, status, applied_at, cancelled_at)
       values ($1, $2, '2026-01-01', 2026, $3::season_rollover_status,
               case when $3 = 'applied' then now() end, case when $3 = 'cancelled' then now() end)
       returning id`,
      [a.clubId, a.rows.season, status],
    );
    return must(rows[0]).id;
  };
  const item = (rolloverId: string, values: Record<string, unknown> = {}) => {
    const row = {
      proposal: 'birth_year',
      proposed_category_id: m15(),
      age_band_code: 'm15',
      decision: 'move',
      target_category_id: m15(),
      ...values,
    };
    return t.pool.query<{ id: string }>(
      `insert into season_rollover_item (club_id, rollover_id, player_id, age_in_season_year,
         age_band_code, proposal, proposed_category_id, needs_review, decision, target_category_id)
       values ($1, $2, $3, 15, $4, $5, $6, false, $7, $8) returning id`,
      [
        a.clubId,
        rolloverId,
        a.players.other,
        row.age_band_code,
        row.proposal,
        row.proposed_category_id,
        row.decision,
        row.target_category_id,
      ],
    );
  };

  it('allows one draft per season, and any number of closed ones', async () => {
    // The fixture already has a draft for its season.
    expect(await pgErrorOf(draft())).toMatchObject({
      code: '23505',
      constraint: 'season_rollover_draft_key',
    });
    await draft('applied');
    await draft('cancelled');
  });

  it('keeps status and its timestamps together', async () => {
    expect(
      await pgErrorOf(
        t.pool.query(
          `insert into season_rollover (club_id, season_id, effective_on, season_year, status)
           values ($1, $2, '2026-01-01', 2026, 'applied')`,
          [a.clubId, a.rows.season],
        ),
      ),
    ).toMatchObject({ code: '23514', constraint: 'season_rollover_lifecycle' });
  });

  it('checks that an item is consistent', async () => {
    const id = must(a.rows.season_rollover);
    // `move` needs a target, `stay` none.
    expect(await pgErrorOf(item(id, { target_category_id: null }))).toMatchObject({
      code: '23514',
      constraint: 'season_rollover_item_decision',
    });
    expect(await pgErrorOf(item(id, { decision: 'stay' }))).toMatchObject({
      code: '23514',
      constraint: 'season_rollover_item_decision',
    });
    // A proposed category only for `birth_year` / `already_there`; no band only out of bands.
    expect(await pgErrorOf(item(id, { proposal: 'ambiguous' }))).toMatchObject({
      code: '23514',
      constraint: 'season_rollover_item_proposal',
    });
    expect(
      await pgErrorOf(item(id, { proposal: 'aged_out', proposed_category_id: null })),
    ).toMatchObject({ code: '23514', constraint: 'season_rollover_item_proposal' });
    // `moved` comes with its membership.
    const { rows } = await item(id);
    const itemId = must(rows[0]).id;
    expect(
      await pgErrorOf(
        t.pool.query(`update season_rollover_item set outcome = 'moved' where id = $1`, [itemId]),
      ),
    ).toMatchObject({ code: '23514', constraint: 'season_rollover_item_outcome' });
    expect(
      await pgErrorOf(
        t.pool.query(`update season_rollover_item set needs_review = true where id = $1`, [itemId]),
      ),
    ).toMatchObject({ code: '23514', constraint: 'season_rollover_item_immutable' });
  });

  it('freezes an applied change and its items, also for the owner', async () => {
    // The fixture's draft: close it.
    const rolloverId = must(a.rows.season_rollover);
    const itemId = must(a.rows.season_rollover_item);
    await t.pool.query(`update season_rollover set effective_on = effective_on where id = $1`, [
      rolloverId,
    ]);
    expect(
      await pgErrorOf(
        t.pool.query(`update season_rollover set effective_on = '2026-02-01' where id = $1`, [
          rolloverId,
        ]),
      ),
    ).toMatchObject({ code: '23514', constraint: 'season_rollover_immutable' });

    await t.pool.query(
      `update season_rollover set status = 'cancelled', cancelled_at = now() where id = $1`,
      [rolloverId],
    );
    expect(
      await pgErrorOf(
        t.pool.query(
          `update season_rollover set status = 'draft', cancelled_at = null where id = $1`,
          [rolloverId],
        ),
      ),
    ).toMatchObject({ code: '23514', constraint: 'season_rollover_closed' });
    expect(
      await pgErrorOf(
        t.pool.query(`update season_rollover_item set reviewed_at = now() where id = $1`, [itemId]),
      ),
    ).toMatchObject({ code: '23514', constraint: 'season_rollover_closed' });
    expect(await pgErrorOf(item(rolloverId))).toMatchObject({
      code: '23514',
      constraint: 'season_rollover_closed',
    });
    // Deleting an author only clears it.
    await t.pool.query(`update season_rollover_item set updated_by = null where id = $1`, [itemId]);
    await t.pool.query(`update season_rollover set updated_by = null where id = $1`, [rolloverId]);
  });

  it('only the administration reads or writes it (RLS)', async () => {
    const id = must(a.rows.season_rollover_item);
    for (const role of ['coach', 'sc', 'medical', 'player', 'parent'] as const) {
      await inContext(
        app.pool,
        { clubId: a.clubId, userId: a.users[role], role },
        async (client) => {
          const seen = await client.query('select 1 from season_rollover_item where id = $1', [id]);
          expect(seen.rowCount, role).toBe(0);
          const rollovers = await client.query('select 1 from season_rollover');
          expect(rollovers.rowCount, role).toBe(0);
        },
      );
      expect(
        await pgErrorOf(
          inContext(app.pool, { clubId: a.clubId, userId: a.users[role], role }, (client) =>
            client.query(
              `insert into season_rollover (club_id, season_id, effective_on, season_year, status, cancelled_at)
               values ($1, $2, '2026-01-01', 2026, 'cancelled', now())`,
              [a.clubId, a.rows.season],
            ),
          ),
        ),
        role,
      ).toMatchObject({ code: '42501' });
    }
    await inContext(
      app.pool,
      { clubId: a.clubId, userId: a.users.admin, role: 'admin' },
      async (client) => {
        const seen = await client.query('select 1 from season_rollover_item where id = $1', [id]);
        expect(seen.rowCount).toBe(1);
        expect(
          await pgErrorOf(client.query('delete from season_rollover_item where id = $1', [id])),
        ).toMatchObject({ code: '42501' });
      },
    );
  });
});
