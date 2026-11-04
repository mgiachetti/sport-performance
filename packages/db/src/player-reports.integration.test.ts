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
 * Player reports in the database (B-602, ADR 0071): read with the player
 * scope (the player, the guardian, the assigned staff, the administration),
 * inserted pending by the staff as themselves, completed only by the worker
 * with a PDF of the same player, and never changed once finished.
 */

const CHECKSUM = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';

describe.skipIf(!hasDatabase)('player reports (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;

  const as = (club: ClubFixture, user: keyof ClubFixture['users'], role: string): TestContext => ({
    clubId: club.clubId,
    userId: club.users[user],
    role,
  });
  const asWorker = (club: ClubFixture): TestContext => ({ clubId: club.clubId });

  const visible = (context: TestContext, reportId: string) =>
    inContext(app.pool, context, async (client) => {
      const { rows } = await client.query('select id from player_report where id = $1', [reportId]);
      return rows.length === 1;
    });

  async function insertAs(context: TestContext, values: Record<string, unknown> = {}) {
    return inContext(app.pool, context, async (client) => {
      const columns = {
        club_id: a.clubId,
        player_id: a.players.assigned,
        test_window_id: a.rows.test_window,
        format_version: 1,
        content: '{"formatVersion":1}',
        created_by: context.userId,
        ...values,
      };
      const names = Object.keys(columns);
      const { rows } = await client.query<{ id: string }>(
        `insert into player_report (${names.join(', ')})
         values (${names.map((_, i) => `$${String(i + 1)}`).join(', ')}) returning id`,
        Object.values(columns),
      );
      return must(rows[0]).id;
    });
  }

  async function pdfFile(club: ClubFixture, playerId: string, kind = 'pdf_report') {
    const { rows } = await t.pool.query<{ id: string }>(
      `insert into file (club_id, kind, status, player_id, content_type, size_bytes,
                         checksum_sha256, uploaded_at)
       values ($1, $2, 'ready', $3, $4, 10, $5, now()) returning id`,
      [
        club.clubId,
        kind,
        playerId,
        kind === 'pdf_report' ? 'application/pdf' : 'video/mp4',
        CHECKSUM,
      ],
    );
    return must(rows[0]).id;
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'reports-a');
    b = await seedClubFixture(t.db, 'reports-b');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  it('is read by the player, the guardian, the assigned staff and the administration', async () => {
    const report = must(a.rows.player_report);
    expect(await visible(as(a, 'player', 'player'), report)).toBe(true);
    expect(await visible(as(a, 'parent', 'parent'), report)).toBe(true);
    expect(await visible(as(a, 'coach', 'coach'), report)).toBe(true);
    expect(await visible(as(a, 'sc', 'sc'), report)).toBe(true);
    expect(await visible(as(a, 'admin', 'admin'), report)).toBe(true);
    // A coach of another category, and the admin of another club, do not see it.
    expect(await visible(as(a, 'coachM17', 'coach'), report)).toBe(false);
    expect(await visible(as(b, 'admin', 'admin'), report)).toBe(false);
    expect(await visible({}, report)).toBe(false);
  });

  it('is inserted pending by the staff as themselves', async () => {
    const id = await insertAs(as(a, 'sc', 'sc'));
    expect(await visible(as(a, 'player', 'player'), id)).toBe(true);
    // The player and the guardian never ask for it in the database either.
    expect((await pgErrorOf(insertAs(as(a, 'player', 'player')))).code).toBe('42501');
    expect((await pgErrorOf(insertAs(as(a, 'parent', 'parent')))).code).toBe('42501');
    // Not on someone else's behalf, never already finished.
    expect((await pgErrorOf(insertAs(as(a, 'sc', 'sc'), { created_by: a.users.admin }))).code).toBe(
      '42501',
    );
    const file = await pdfFile(a, a.players.assigned);
    expect(
      (
        await pgErrorOf(
          insertAs(as(a, 'admin', 'admin'), {
            status: 'ready',
            file_id: file,
            generated_at: new Date(),
          }),
        )
      ).code,
    ).toBe('42501');
    // Nor the coach: the staff that asks for reports is the test staff and the administration.
    expect((await pgErrorOf(insertAs(as(a, 'coach', 'coach')))).code).toBe('42501');
  });

  it('is never edited by the API', async () => {
    const id = await insertAs(as(a, 'admin', 'admin'));
    const code = (
      await pgErrorOf(
        inContext(app.pool, as(a, 'admin', 'admin'), (client) =>
          client.query(
            `update player_report set status = 'failed', failure_code = 'render_failed' where id = $1`,
            [id],
          ),
        ),
      )
    ).code;
    expect(code).toBe('42501');
  });

  it('is completed by the worker with a PDF of the same player, once', async () => {
    const id = await insertAs(as(a, 'sc', 'sc'));
    const video = await pdfFile(a, a.players.assigned, 'cmj_video');
    const otherPlayers = await pdfFile(a, a.players.other);
    const own = await pdfFile(a, a.players.assigned);
    const complete = (fileId: string) =>
      inContext(worker.pool, asWorker(a), (client) =>
        client.query(
          `update player_report set status = 'ready', file_id = $2, generated_at = now(),
                  attempts = attempts + 1 where id = $1`,
          [id, fileId],
        ),
      );
    expect((await pgErrorOf(complete(video))).code).toBe('23514');
    expect((await pgErrorOf(complete(otherPlayers))).code).toBe('23514');
    await complete(own);
    const { rows } = await t.pool.query<{ status: string }>(
      'select status from player_report where id = $1',
      [id],
    );
    expect(must(rows[0]).status).toBe('ready');
    // Finished: never back to pending, never another file.
    expect(
      (
        await pgErrorOf(
          inContext(worker.pool, asWorker(a), (client) =>
            client.query(
              `update player_report set status = 'pending', file_id = null, generated_at = null where id = $1`,
              [id],
            ),
          ),
        )
      ).code,
    ).toBe('23514');
    // The worker never rewrites the snapshot.
    expect(
      (
        await pgErrorOf(
          inContext(worker.pool, asWorker(a), (client) =>
            client.query(`update player_report set content = '{}' where id = $1`, [id]),
          ),
        )
      ).code,
    ).toBe('42501');
  });

  it('tells the worker which clubs have due reports, and nothing else', async () => {
    const clubs = async () =>
      (
        await worker.pool.query<{ club_id: string }>(
          'select club_id from app.worker_report_clubs()',
        )
      ).rows.map((r) => r.club_id);
    // Nothing due: every pending report waits for a retry.
    // (The category reports of the fixture too: the sweep lists both, ADR 0073.)
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
