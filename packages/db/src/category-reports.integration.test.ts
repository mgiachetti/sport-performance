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
  type TestContext,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture } from './testing/tenant-fixture.js';

/**
 * Category reports in the database (B-603, ADR 0073): read by the staff
 * assigned to the category and by the administration (never by players or
 * guardians), inserted pending by the test staff as themselves, completed
 * only by the worker with a `category_report` file of the same category,
 * never changed once finished; the file follows the report.
 */

const CHECKSUM = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';

describe.skipIf(!hasDatabase)('category reports (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let m17: string;

  const as = (club: ClubFixture, user: keyof ClubFixture['users'], role: string): TestContext => ({
    clubId: club.clubId,
    userId: club.users[user],
    role,
  });
  const asWorker = (club: ClubFixture): TestContext => ({ clubId: club.clubId });

  const visible = (context: TestContext, table: 'category_report' | 'file', id: string) =>
    inContext(app.pool, context, async (client) => {
      const { rows } = await client.query(`select id from ${table} where id = $1`, [id]);
      return rows.length === 1;
    });

  async function insertAs(context: TestContext, values: Record<string, unknown> = {}) {
    return inContext(app.pool, context, async (client) => {
      const columns = {
        club_id: a.clubId,
        category_id: a.rows.category,
        test_window_id: a.rows.test_window,
        format_version: 1,
        content: '{"formatVersion":1}',
        created_by: context.userId,
        ...values,
      };
      const names = Object.keys(columns);
      const { rows } = await client.query<{ id: string }>(
        `insert into category_report (${names.join(', ')})
         values (${names.map((_, i) => `$${String(i + 1)}`).join(', ')}) returning id`,
        Object.values(columns),
      );
      return must(rows[0]).id;
    });
  }

  async function reportFile(
    club: ClubFixture,
    target: { categoryId?: string | undefined; playerId?: string | undefined },
    kind = 'category_report',
  ) {
    const { rows } = await t.pool.query<{ id: string }>(
      `insert into file (club_id, kind, status, category_id, player_id, content_type, size_bytes,
                         checksum_sha256, uploaded_at)
       values ($1, $2, 'ready', $3, $4, 'application/pdf', 10, $5, now()) returning id`,
      [club.clubId, kind, target.categoryId ?? null, target.playerId ?? null, CHECKSUM],
    );
    return must(rows[0]).id;
  }

  const complete = (id: string, fileId: string) =>
    inContext(worker.pool, asWorker(a), (client) =>
      client.query(
        `update category_report set status = 'ready', file_id = $2, generated_at = now(),
                attempts = attempts + 1 where id = $1`,
        [id, fileId],
      ),
    );

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'category-reports-a');
    b = await seedClubFixture(t.db, 'category-reports-b');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
    const { rows } = await t.pool.query<{ id: string }>(
      `select id from category where club_id = $1 and name = 'M17'`,
      [a.clubId],
    );
    m17 = must(rows[0]).id;
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  it('is read by the staff of the category and the administration, never by players', async () => {
    const report = must(a.rows.category_report);
    expect(await visible(as(a, 'coach', 'coach'), 'category_report', report)).toBe(true);
    // The S&C staff is assigned to the whole sport.
    expect(await visible(as(a, 'sc', 'sc'), 'category_report', report)).toBe(true);
    expect(await visible(as(a, 'admin', 'admin'), 'category_report', report)).toBe(true);
    expect(await visible(as(a, 'player', 'player'), 'category_report', report)).toBe(false);
    expect(await visible(as(a, 'parent', 'parent'), 'category_report', report)).toBe(false);
    // A coach of another category, the medical staff without assignments, another club.
    expect(await visible(as(a, 'coachM17', 'coach'), 'category_report', report)).toBe(false);
    expect(await visible(as(a, 'medical', 'medical'), 'category_report', report)).toBe(false);
    expect(await visible(as(b, 'admin', 'admin'), 'category_report', report)).toBe(false);
    expect(await visible({}, 'category_report', report)).toBe(false);
  });

  it('is inserted pending by the test staff as themselves', async () => {
    const id = await insertAs(as(a, 'sc', 'sc'));
    expect(await visible(as(a, 'coach', 'coach'), 'category_report', id)).toBe(true);
    expect((await pgErrorOf(insertAs(as(a, 'player', 'player')))).code).toBe('42501');
    expect((await pgErrorOf(insertAs(as(a, 'coach', 'coach')))).code).toBe('42501');
    expect((await pgErrorOf(insertAs(as(a, 'sc', 'sc'), { created_by: a.users.admin }))).code).toBe(
      '42501',
    );
    // Never already finished: the guard does not even find a file no report points at, and
    // the policy would refuse it anyway.
    const file = await reportFile(a, { categoryId: a.rows.category });
    expect(['42501', '23514']).toContain(
      (
        await pgErrorOf(
          insertAs(as(a, 'admin', 'admin'), {
            status: 'ready',
            file_id: file,
            generated_at: new Date(),
          }),
        )
      ).code,
    );
  });

  it('is never edited by the API', async () => {
    const id = await insertAs(as(a, 'admin', 'admin'));
    const code = (
      await pgErrorOf(
        inContext(app.pool, as(a, 'admin', 'admin'), (client) =>
          client.query(
            `update category_report set status = 'failed', failure_code = 'render_failed' where id = $1`,
            [id],
          ),
        ),
      )
    ).code;
    expect(code).toBe('42501');
  });

  it('is completed by the worker with a report file of the same category, once', async () => {
    const id = await insertAs(as(a, 'sc', 'sc'));
    const playerPdf = await reportFile(a, { playerId: a.players.assigned }, 'pdf_report');
    const otherCategory = await reportFile(a, { categoryId: m17 });
    const own = await reportFile(a, { categoryId: a.rows.category });
    expect((await pgErrorOf(complete(id, playerPdf))).code).toBe('23514');
    expect((await pgErrorOf(complete(id, otherCategory))).code).toBe('23514');
    await complete(id, own);
    const { rows } = await t.pool.query<{ status: string }>(
      'select status from category_report where id = $1',
      [id],
    );
    expect(must(rows[0]).status).toBe('ready');
    expect(
      (
        await pgErrorOf(
          inContext(worker.pool, asWorker(a), (client) =>
            client.query(
              `update category_report set status = 'pending', file_id = null, generated_at = null where id = $1`,
              [id],
            ),
          ),
        )
      ).code,
    ).toBe('23514');
    expect(
      (
        await pgErrorOf(
          inContext(worker.pool, asWorker(a), (client) =>
            client.query(`update category_report set content = '{}' where id = $1`, [id]),
          ),
        )
      ).code,
    ).toBe('42501');

    // Its PDF is seen by whoever sees the report.
    expect(await visible(as(a, 'coach', 'coach'), 'file', own)).toBe(true);
    expect(await visible(as(a, 'admin', 'admin'), 'file', own)).toBe(true);
    expect(await visible(as(a, 'coachM17', 'coach'), 'file', own)).toBe(false);
    expect(await visible(as(a, 'player', 'player'), 'file', own)).toBe(false);
    // A report file no report points at is nobody's to read through the API.
    expect(await visible(as(a, 'coachM17', 'coach'), 'file', otherCategory)).toBe(false);
  });

  it('always belongs to a category', async () => {
    const error = await pgErrorOf(reportFile(a, {}));
    expect(error.code).toBe('23514');
    expect(error.constraint).toBe('file_subject');
  });

  it('tells the worker which clubs have due reports of either kind, and nothing else', async () => {
    const clubs = async () =>
      (
        await worker.pool.query<{ club_id: string }>(
          'select club_id from app.worker_report_clubs()',
        )
      ).rows.map((r) => r.club_id);
    for (const table of ['player_report', 'category_report']) {
      await t.pool.query(
        `update ${table} set next_attempt_at = now() + interval '1 hour' where status = 'pending'`,
      );
    }
    expect(await clubs()).toEqual([]);
    await insertAs(as(a, 'admin', 'admin'));
    expect(await clubs()).toEqual([a.clubId]);
    expect((await pgErrorOf(app.pool.query('select * from app.worker_report_clubs()'))).code).toBe(
      '42501',
    );
  });
});
