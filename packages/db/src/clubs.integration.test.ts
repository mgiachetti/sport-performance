import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { user } from './schema/index.js';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  inContext,
  must,
  type MigratedTestDatabase,
  type RoleConnection,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture } from './testing/tenant-fixture.js';

/**
 * Club profile, brand and branches (B-313, migration 0009): the typed brand
 * columns and their checks, the branch every category hangs from, and the
 * slug only a superadmin changes.
 */

async function pgError(
  promise: Promise<unknown>,
): Promise<{ code?: string; constraint?: string } | 'no error'> {
  try {
    await promise;
  } catch (error) {
    const failure = error as { code?: string; constraint?: string };
    return {
      ...(failure.code && { code: failure.code }),
      ...(failure.constraint && { constraint: failure.constraint }),
    };
  }
  return 'no error';
}

describe.skipIf(!hasDatabase)('clubs, brand and branches (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;
  let superadminId: string;

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'clubs-a');
    superadminId = must(
      (
        await t.db
          .insert(user)
          .values({ name: 'Soporte', email: 'soporte@clubs.example.com', isSuperadmin: true })
          .returning({ id: user.id })
      )[0],
    ).id;
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.drop();
  });

  const admin = () => ({ clubId: a.clubId, userId: a.users.admin, role: 'admin' });

  it('stores brand colors as lowercase #rrggbb only', async () => {
    for (const value of ['#F1882A', 'f1882a', '#fff', 'red']) {
      expect(
        await pgError(
          t.pool.query('update club set primary_color = $1 where id = $2', [value, a.clubId]),
        ),
      ).toEqual({ code: '23514', constraint: 'club_primary_color_format' });
    }
    await t.pool.query(`update club set secondary_color = '#123abc' where id = $1`, [a.clubId]);
  });

  it('rejects blank or padded names and short names, and malformed locales', async () => {
    expect(
      await pgError(t.pool.query(`update club set name = ' ORC' where id = $1`, [a.clubId])),
    ).toEqual({ code: '23514', constraint: 'club_name_format' });
    expect(
      await pgError(
        t.pool.query(`update club set short_name = 'DEMASIADO-LARGO-17' where id = $1`, [a.clubId]),
      ),
    ).toEqual({ code: '23514', constraint: 'club_short_name_format' });
    expect(
      await pgError(t.pool.query(`update club set locale = 'es_ar' where id = $1`, [a.clubId])),
    ).toEqual({ code: '23514', constraint: 'club_locale_format' });
  });

  it('needs an enabled branch of the club for every category', async () => {
    expect(
      await pgError(
        t.pool.query(
          `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
           values ($1, 'hockey', 'female', 'm15', 'M15', 'development')`,
          [a.clubId],
        ),
      ),
    ).toEqual({ code: '23503', constraint: 'category_branch_fkey' });
  });

  it('lets the admin edit the profile and brand, but not the slug', async () => {
    await inContext(app.pool, admin(), (client) =>
      client.query(
        `update club set name = 'Club A editado', short_name = 'CAE', primary_color = '#00ff00'
          where id = $1`,
        [a.clubId],
      ),
    );
    expect(
      await pgError(
        inContext(app.pool, admin(), (client) =>
          client.query(`update club set slug = 'otro-slug' where id = $1`, [a.clubId]),
        ),
      ),
    ).toEqual({ code: '42501' });
  });

  it('lets a superadmin with a recorded support access change the slug', async () => {
    const support = {
      clubId: a.clubId,
      userId: superadminId,
      role: 'superadmin',
      supportReason: 'Corrección del slug pedida por el club',
    };
    const updated = await inContext(app.pool, support, (client) =>
      client.query(`update club set slug = 'clubs-a2' where id = $1`, [a.clubId]),
    );
    expect(updated.rowCount).toBe(1);
    // Without the support access the superadmin role is not granted: nothing is updated.
    const withoutAccess = { clubId: a.clubId, userId: superadminId, role: 'superadmin' };
    const hidden = await inContext(app.pool, withoutAccess, (client) =>
      client.query(`update club set slug = 'clubs-a3' where id = $1`, [a.clubId]),
    );
    expect(hidden.rowCount).toBe(0);
  });

  it('lets every member read the branches and only the administration write them', async () => {
    const coach = { clubId: a.clubId, userId: a.users.coach, role: 'coach' };
    const seen = await inContext(app.pool, coach, (client) =>
      client.query<{ sport: string }>('select sport from club_branch'),
    );
    expect(seen.rows.map((r) => r.sport)).toEqual(['rugby']);
    expect(
      await pgError(
        inContext(app.pool, coach, (client) =>
          client.query(
            `insert into club_branch (club_id, sport, sex) values ($1, 'hockey', 'female')`,
            [a.clubId],
          ),
        ),
      ),
    ).toEqual({ code: '42501' });
    await inContext(app.pool, admin(), (client) =>
      client.query(
        `insert into club_branch (club_id, sport, sex) values ($1, 'hockey', 'female')`,
        [a.clubId],
      ),
    );
    expect(
      await pgError(
        inContext(app.pool, admin(), (client) =>
          client.query(`delete from club_branch where club_id = $1`, [a.clubId]),
        ),
      ),
    ).toEqual({ code: '42501' });
  });
});
