import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  inContext,
  must,
  type MigratedTestDatabase,
  type RoleConnection,
  type TestContext,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture, type FixtureUser } from './testing/tenant-fixture.js';

/**
 * Ingestion of the pod's log in the database (B-916, ADR 0106, ADR 0108):
 * `pod_raw_upload` (S&C and the administration; the manifest checked against
 * the pod's device; the application only confirms, the worker runs the rest
 * of its life), `pod_trace_segment` (the player their own, the assigned staff
 * and the administration with `location` granted; never the guardian, the
 * medical staff nor support access; never in the change history; the worker
 * inserts and deletes) and the `pod_raw` files (only who runs the fleet).
 */

interface PgFailure {
  code?: string;
  constraint?: string;
}

async function failure(
  promise: Promise<unknown>,
): Promise<{ code?: string | undefined; constraint?: string | undefined }> {
  try {
    await promise;
  } catch (error) {
    const e = error as PgFailure;
    return { code: e.code, constraint: e.constraint };
  }
  return { code: 'no error' };
}

const CHECKSUM = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';

describe.skipIf(!hasDatabase)('pod log ingestion (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let device: { id: string; chip: string; serial: string };

  const as = (who: FixtureUser, club: ClubFixture = a): TestContext => ({
    clubId: club.clubId,
    userId: club.users[who],
    role: who === 'coachM17' ? 'coach' : who,
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);
  const asWorker = <T>(club: ClubFixture, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(worker.pool, { clubId: club.clubId }, work);
  const count = (context: TestContext, sql: string, params: unknown[] = []) =>
    run(context, async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n ${sql}`,
        params,
      );
      return must(rows[0]).n;
    });

  async function grantLocation(club: ClubFixture): Promise<string> {
    const { rows } = await t.pool.query<{ id: string }>(
      `with d as (
         insert into consent_document (club_id, type, version, locale, title, body, published_at)
         values ($1, 'location', '2026-11', 'es-AR', 'Ubicación', 'Texto', now() - interval '1 day')
         returning id)
       insert into consent (club_id, player_id, type, document_id, document_version, signer_kind,
                            signed_by, signed_at)
       select $1, $2, 'location', d.id, '2026-11', 'guardian', $3, now() - interval '1 hour' from d
       returning id`,
      [club.clubId, club.players.assigned, club.users.parent],
    );
    return must(rows[0]).id;
  }

  /** A pending `pod_raw` file of the club, inserted as `context` (or the owner). */
  async function newRawFile(client: pg.ClientBase, club: ClubFixture, sizeBytes = 2056 + 64) {
    const { rows } = await client.query<{ id: string }>(
      `insert into file (club_id, kind, content_type, size_bytes, checksum_sha256, expires_at)
       values ($1, 'pod_raw', 'application/octet-stream', $2, $3, now() + interval '1 day')
       returning id`,
      [club.clubId, sizeBytes, CHECKSUM],
    );
    return must(rows[0]).id;
  }

  let segment = 100;
  function insertUpload(
    client: pg.ClientBase,
    club: ClubFixture,
    fileId: string,
    overrides: { chip?: string; serial?: string; sizeBytes?: number; state?: string } = {},
  ) {
    segment += 1;
    const chip = overrides.chip ?? device.chip;
    return client.query<{ id: string }>(
      `insert into pod_raw_upload (club_id, pod_id, device_id, ingest_key, chip_id, pod_serial,
         boot_counter, segment_id, first_page_seq, last_page_seq, pages_n, valid_pages_n, blocks,
         key_epochs, segment_closed, size_bytes, sha256_hex, file_id, state)
       values ($1, $2, $3, $4::text || '/7/' || $5::text, $4::text, $6, 7, $5::bigint, 10, 10, 1, 1, '{3}', '{0}', true, $7,
               repeat('a', 64), $8, $9)
       returning id`,
      [
        club.clubId,
        club.rows.pod,
        device.id,
        chip,
        segment,
        overrides.serial ?? device.serial,
        overrides.sizeBytes ?? 2056 + 64,
        fileId,
        overrides.state ?? 'uploading',
      ],
    );
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'ingest-a');
    b = await seedClubFixture(t.db, 'ingest-b');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
    const { rows } = await t.pool.query<{ id: string; chip_id: string; serial_number: string }>(
      `select d.id, d.chip_id, d.serial_number from pod p join pod_device d on d.id = p.device_id
        where p.club_id = $1 and p.id = $2`,
      [a.clubId, a.rows.pod],
    );
    const row = must(rows[0]);
    device = { id: row.id, chip: row.chip_id, serial: row.serial_number };
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  describe('pod_raw_upload', () => {
    it('S&C and the administration read it; never the coach, the player, the guardian nor the medical staff', async () => {
      for (const who of ['admin', 'sc'] as const) {
        expect(
          await count(as(who), 'from pod_raw_upload where id = $1', [a.rows.pod_raw_upload]),
          who,
        ).toBe(1);
      }
      for (const who of ['coach', 'coachM17', 'player', 'parent', 'medical'] as const) {
        expect(await count(as(who), 'from pod_raw_upload'), who).toBe(0);
      }
    });

    it('the manifest must be of the pod’s device, with a pending pod_raw of the declared size', async () => {
      await run(as('sc'), async (client) => {
        const fileId = await newRawFile(client, a);
        expect(
          await failure(insertUpload(client, a, fileId, { chip: '00000000000000ff' })),
        ).toEqual({
          code: '23514',
          constraint: 'pod_raw_upload_device',
        });
      });
      await run(as('sc'), async (client) => {
        const fileId = await newRawFile(client, a);
        expect(await failure(insertUpload(client, a, fileId, { serial: 'OTHER-1' }))).toEqual({
          code: '23514',
          constraint: 'pod_raw_upload_device',
        });
      });
      await run(as('sc'), async (client) => {
        const fileId = await newRawFile(client, a);
        expect(await failure(insertUpload(client, a, fileId, { sizeBytes: 99 }))).toEqual({
          code: '23514',
          constraint: 'pod_raw_upload_file',
        });
      });
      await run(as('sc'), async (client) => {
        const fileId = await newRawFile(client, a);
        expect(await failure(insertUpload(client, a, fileId, { state: 'pending' }))).toMatchObject({
          code: '23514',
        });
      });
      // The coach cannot create one, nor any file of the kind.
      expect(await failure(run(as('coach'), (client) => newRawFile(client, a)))).toMatchObject({
        code: '42501',
      });
    });

    it('the application only confirms; the worker verifies, rejects and trims, only forward', async () => {
      const id = await run(as('sc'), async (client) => {
        const fileId = await newRawFile(client, a);
        return must((await insertUpload(client, a, fileId)).rows[0]).id;
      });
      // Idempotent by segment: a second live upload of the same segment conflicts.
      const { rows } = await t.pool.query<{ ingest_key: string; file_id: string }>(
        'select ingest_key, file_id from pod_raw_upload where id = $1',
        [id],
      );
      const key = must(rows[0]).ingest_key;
      expect(key).toBe(`${device.chip}/7/${String(segment)}`);
      await run(as('sc'), async (client) => {
        const fileId = await newRawFile(client, a);
        segment -= 1;
        expect(await failure(insertUpload(client, a, fileId))).toEqual({
          code: '23505',
          constraint: 'pod_raw_upload_ingest_key',
        });
      });
      // The application may not verify, nor write the worker's columns.
      expect(
        await failure(
          run(as('admin'), (client) =>
            client.query(
              `update pod_raw_upload set state = 'verified', verified_at = now(), erase_command = '00'
                where id = $1`,
              [id],
            ),
          ),
        ),
      ).toMatchObject({ code: '42501' });
      expect(
        await failure(
          run(as('admin'), (client) =>
            client.query(
              `update pod_raw_upload set state = 'pending', confirmed_at = now(),
                      pending_until = now() + interval '7 days' where id = $1`,
              [id],
            ),
          ),
        ),
      ).toEqual({ code: 'no error' });
      expect(
        await failure(
          run(as('admin'), (client) =>
            client.query(`update pod_raw_upload set updated_at = now() where id = $1`, [id]),
          ),
        ),
      ).toEqual({ code: '23514', constraint: 'pod_raw_upload_transition' });
      // The worker: never backwards.
      expect(
        await failure(
          asWorker(a, (client) =>
            client.query(
              `update pod_raw_upload set state = 'trimmed', trimmed_at = now(), trimmed_players_n = 0,
                      trimmed_samples_n = 0, verified_at = now(), erase_command = '00' where id = $1`,
              [id],
            ),
          ),
        ),
      ).toEqual({ code: '23514', constraint: 'pod_raw_upload_transition' });
      await asWorker(a, (client) =>
        client.query(
          `update pod_raw_upload set state = 'verified', verified_at = now(), erase_command = '5350'
            where id = $1`,
          [id],
        ),
      );
      expect(
        await failure(
          asWorker(a, (client) =>
            client.query(`update pod_raw_upload set state = 'pending' where id = $1`, [id]),
          ),
        ),
      ).toEqual({ code: '23514', constraint: 'pod_raw_upload_transition' });
      // A rejected upload leaves room for the same segment again.
      await asWorker(a, (client) =>
        client.query(
          `update pod_raw_upload set state = 'rejected', rejection_reason = 'pages_not_authentic',
                  rejected_at = now() where id = $1`,
          [id],
        ),
      );
      await run(as('sc'), async (client) => {
        const fileId = await newRawFile(client, a);
        segment -= 1;
        expect(await failure(insertUpload(client, a, fileId))).toEqual({ code: 'no error' });
      });
    });

    it('the sweep lists the clubs with work: to verify, to trim, expired uploads and traces', async () => {
      const clubs = () =>
        asWorker(b, async (client) => {
          const { rows } = await client.query<{ c: string }>(
            'select c from app.worker_pod_raw_clubs() c',
          );
          return rows.map((r) => r.c);
        });
      // Club B only has a trimmed upload and traces within their retention.
      expect(await clubs()).not.toContain(b.clubId);
      await t.pool.query(
        `update pod_trace_segment set expires_at = now() - interval '1 minute' where id = $1`,
        [b.rows.pod_trace_segment],
      );
      expect(await clubs()).toContain(b.clubId);
      await t.pool.query(
        `update pod_trace_segment set expires_at = now() + interval '1 year' where id = $1`,
        [b.rows.pod_trace_segment],
      );
      await t.pool.query(`update pod_assignment set reprocess_requested_at = now() where id = $1`, [
        b.rows.pod_assignment,
      ]);
      expect(await clubs()).toContain(b.clubId);
      await t.pool.query(`update pod_assignment set reprocess_requested_at = null where id = $1`, [
        b.rows.pod_assignment,
      ]);
      expect(await clubs()).not.toContain(b.clubId);
      expect(
        await failure(
          run(as('admin'), (client) => client.query('select app.worker_pod_raw_clubs()')),
        ),
      ).toMatchObject({ code: '42501' });
    });
  });

  describe('pod_trace_segment', () => {
    const traces = (context: TestContext) => count(context, 'from pod_trace_segment');

    it('without location granted, only the player reads their own', async () => {
      expect(await traces(as('player', b))).toBe(1);
      for (const who of ['admin', 'sc', 'coach', 'coachM17', 'parent', 'medical'] as const) {
        expect(await traces(as(who, b)), who).toBe(0);
      }
    });

    it('with location granted, also the assigned staff and the administration; never the guardian nor the medical staff', async () => {
      await grantLocation(a);
      for (const who of ['admin', 'sc', 'coach', 'player'] as const) {
        expect(await traces(as(who)), who).toBe(1);
      }
      for (const who of ['coachM17', 'parent', 'medical'] as const) {
        expect(await traces(as(who)), who).toBe(0);
      }
      // Support access of a superadmin never reads a position: not a role of the policy.
      const { rows } = await t.pool.query<{ policy: string }>(
        `select qual as policy from pg_policies
          where tablename = 'pod_trace_segment' and policyname = 'pod_trace_segment_app_select'`,
      );
      expect(must(rows[0]).policy).not.toContain('superadmin');
      // A new text of location: it stops counting, and so does the staff's access.
      await t.pool.query(
        `insert into consent_document (club_id, type, version, locale, title, body, published_at)
         values ($1, 'location', '2026-12', 'es-AR', 'Ubicación', 'Texto nuevo', now())`,
        [a.clubId],
      );
      expect(await traces(as('admin'))).toBe(0);
      expect(await traces(as('player'))).toBe(1);
    });

    it('nobody in the application writes them; the worker inserts and deletes, never updates', async () => {
      const id = a.rows.pod_trace_segment;
      for (const sql of [
        'update pod_trace_segment set samples_n = samples_n where id = $1',
        'delete from pod_trace_segment where id = $1',
      ]) {
        expect(
          await failure(run(as('admin'), (client) => client.query(sql, [id]))),
          sql,
        ).toMatchObject({
          code: '42501',
        });
      }
      expect(
        await failure(
          asWorker(a, (client) =>
            client.query('update pod_trace_segment set samples_n = samples_n where id = $1', [id]),
          ),
        ),
      ).toMatchObject({ code: '42501' });
      const copy = randomUUID();
      await asWorker(a, (client) =>
        client.query(
          `insert into pod_trace_segment (id, club_id, player_id, training_session_id, pod_id,
             pod_raw_upload_id, chunk_index, method_variant, algorithm_version, starts_at, ends_at,
             samples_n, offsets_ms, lat_e7, lon_e7, speed_mm_s, h_acc_mm, fix_quality,
             time_low_confidence, expires_at)
           select $2, club_id, player_id, training_session_id, pod_id, pod_raw_upload_id, 1,
                  method_variant, algorithm_version, starts_at, ends_at, samples_n, offsets_ms,
                  lat_e7, lon_e7, speed_mm_s, h_acc_mm, fix_quality, time_low_confidence, expires_at
             from pod_trace_segment where id = $1`,
          [id, copy],
        ),
      );
      const deleted = await asWorker(a, (client) =>
        client.query('delete from pod_trace_segment where id = $1', [copy]),
      );
      expect(deleted.rowCount).toBe(1);
    });

    it('checks the samples are parallel arrays of the declared length', async () => {
      expect(
        await failure(
          asWorker(a, (client) =>
            client.query(
              `insert into pod_trace_segment (club_id, player_id, training_session_id, pod_id,
                 pod_raw_upload_id, chunk_index, method_variant, algorithm_version, starts_at, ends_at,
                 samples_n, offsets_ms, lat_e7, lon_e7, speed_mm_s, h_acc_mm, fix_quality,
                 time_low_confidence, expires_at)
               select club_id, player_id, training_session_id, pod_id, pod_raw_upload_id, 9,
                      method_variant, algorithm_version, starts_at, ends_at, 3, offsets_ms, lat_e7,
                      lon_e7, speed_mm_s, h_acc_mm, fix_quality, false, expires_at
                 from pod_trace_segment where id = $1`,
              [a.rows.pod_trace_segment],
            ),
          ),
        ),
      ).toEqual({ code: '23514', constraint: 'pod_trace_segment_samples' });
    });

    it('is never in the change history', async () => {
      const { rows } = await t.pool.query<{ n: number }>(
        `select count(*)::int as n from pg_trigger
          where tgrelid in ('public.pod_trace_segment'::regclass, 'public.pod_raw_upload'::regclass)
            and tgname like '%change_history%'`,
      );
      expect(must(rows[0]).n).toBe(0);
    });
  });

  describe('pod_raw files', () => {
    it('only who runs the fleet sees them; a trimmed one is of a player', async () => {
      const files = (context: TestContext) => count(context, `from file where kind = 'pod_raw'`);
      expect(await files(as('admin', b))).toBe(2);
      expect(await files(as('sc', b))).toBe(2);
      for (const who of ['coach', 'coachM17', 'player', 'parent', 'medical'] as const) {
        expect(await files(as(who, b)), who).toBe(0);
      }
      // A pending one has no player; one of a player is allowed (the trim) for this kind only.
      const { rows } = await t.pool.query<{ with_player: number }>(
        `select count(*) filter (where player_id is not null)::int as with_player from file
          where club_id = $1 and kind = 'pod_raw'`,
        [b.clubId],
      );
      expect(must(rows[0]).with_player).toBe(1);
    });
  });
});
