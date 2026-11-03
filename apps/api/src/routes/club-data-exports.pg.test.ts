/**
 * CSV export of the club's data (B-608, ADR 0072) against Postgres 16 and
 * MinIO through the API's login: who may ask, which players the request
 * fixes (scope and data consent, row by row), the audited availability
 * snapshot, idempotency, who sees which export and the signed download of a
 * ready ZIP until it expires.
 */
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ClubId } from '@sport-performance/domain';
import {
  createTestBucket,
  storageTestUrl,
  type TestBucket,
} from '@sport-performance/storage/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFilesModule, type FilesModule } from '../files/module.js';
import {
  createCategory,
  createClub,
  createMembership,
  createTestDatabase,
  signIn,
  startIdentityApp,
  type IdentityTestApp,
  type SignedIn,
  type TestDatabase,
} from '../testing/identity.js';
import { describeWithPostgres } from '../testing/support.js';

vi.setConfig({ testTimeout: 30_000 });

interface ExportBody {
  id: string;
  status: string;
  requestedBy: string | null;
  requesterRole: string;
  datasets: string[];
  from: string | null;
  to: string | null;
  requestedOn: string;
  playerCount: number;
  excludedPlayerCount: number;
  file: { id: string; fileName: string; sizeBytes: number; expiresAt: string | null } | null;
  format: string;
  formatVersion: number;
}

function describeWithStorage(name: string, body: (pgUrl: string, s3Url: string) => void): void {
  describeWithPostgres(name, (pgUrl) => {
    if (storageTestUrl !== undefined && storageTestUrl !== '') {
      body(pgUrl, storageTestUrl);
      return;
    }
    if (process.env.CI !== undefined) {
      throw new Error(`${name}: STORAGE_TEST_URL is required in CI (MinIO service)`);
    }
    describe.skip(`${name} (set STORAGE_TEST_URL to run against MinIO)`, () => undefined);
  });
}

describeWithStorage('club data exports (Postgres + MinIO)', (serverUrl, storageUrl) => {
  let database: TestDatabase;
  let bucket: TestBucket;
  let files: FilesModule;
  let t: IdentityTestApp;
  let adminA: SignedIn;
  let scA: SignedIn;
  let coachA: SignedIn;
  let playerA: SignedIn;
  let adminB: SignedIn;
  let clubA: ClubId;
  /** M15, data consent, blocked by the medical staff. */
  let consenting: string;
  /** M15 without a data consent. */
  let withoutConsent: string;
  /** M17 with a data consent: outside the S&C member's assignment. */
  let other: string;

  async function insertPlayer(club: ClubId, category: string, name: string): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Test', '2011-05-10', 'male', 'rugby', '2024-03-01') returning id`,
      [club, name],
    );
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error('player not created');
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2024-03-01')`,
      [club, id, category],
    );
    return id;
  }

  async function consentData(club: ClubId, playerId: string, signer: string) {
    await database.admin.query(
      `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
       values ($1, $2, 'data', '2026-01', 'guardian', $3)`,
      [club, playerId, signer],
    );
  }

  const ask = (caller: SignedIn, payload: Record<string, unknown> = {}) =>
    t.app.inject({ method: 'POST', url: '/v1/data-exports', headers: caller.headers, payload });
  const list = (caller: SignedIn) =>
    t.app.inject({ url: '/v1/data-exports', headers: caller.headers });
  const get = (caller: SignedIn, id: string, suffix = '') =>
    t.app.inject({ url: `/v1/data-exports/${id}${suffix}`, headers: caller.headers });

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    bucket = await createTestBucket(storageUrl);
    const module = createFilesModule({
      storage: bucket.config,
      uploadUrlTtlS: 900,
      downloadUrlTtlS: 120,
      logoUrlTtlS: 3600,
    });
    if (module === undefined) throw new Error('the files module needs the bucket');
    files = module;
    const generous = { max: 10_000, windowS: 60 };
    t = await startIdentityApp(database, {
      files,
      routeClassLimits: {
        auth: { perIp: { name: 'api_auth_ip', ...generous } },
        write: {
          perIp: { name: 'api_write_ip', ...generous },
          perUser: { name: 'api_write_user', ...generous },
        },
      },
    });
    adminA = await signIn(t, 'admin@export-a.example.com');
    scA = await signIn(t, 'sc@export-a.example.com');
    coachA = await signIn(t, 'coach@export-a.example.com');
    playerA = await signIn(t, 'player@export-a.example.com');
    adminB = await signIn(t, 'admin@export-b.example.com');

    clubA = await createClub(database.admin, 'export-a');
    const clubB = await createClub(database.admin, 'export-b');
    const m15 = await createCategory(database.admin, clubA, 'M15');
    const m17 = await createCategory(database.admin, clubA, 'M17');
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await createMembership(database.admin, playerA.userId, clubA, 'player');
    for (const [caller, role] of [
      [scA, 'sc'],
      [coachA, 'coach'],
    ] as const) {
      const membership = await createMembership(database.admin, caller.userId, clubA, role);
      await database.admin.query(
        `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
         values ($1, $2, $3, '2024-01-01')`,
        [clubA, membership, m15],
      );
    }
    consenting = await insertPlayer(clubA, m15, 'Con');
    withoutConsent = await insertPlayer(clubA, m15, 'Sin');
    other = await insertPlayer(clubA, m17, 'Otra');
    await consentData(clubA, consenting, adminA.userId);
    await consentData(clubA, other, adminA.userId);
    await database.admin.query(
      `insert into medical.hold (club_id, player_id, training, match, valid_from, staff_note)
       values ($1, $2, 'unavailable', 'unavailable', '2024-01-01', 'Esguince, sin contacto')`,
      [clubA, consenting],
    );
  }, 120_000);

  afterAll(async () => {
    await t.close();
    await bucket.drop();
    await database.drop();
  });

  async function stored(id: string) {
    const { rows } = await database.admin.query<{
      player_ids: string[];
      availability: Record<string, unknown> | null;
      requested_by: string;
      requester_role: string;
    }>(
      `select player_ids::text[] as player_ids, availability, requested_by,
              requester_role::text as requester_role
         from club_data_export where id = $1`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('no export');
    return row;
  }

  describe('asking', () => {
    it('S&C exports their assigned players with a data consent, with their availability', async () => {
      const response = await ask(scA, { clientUuid: randomUUID() });
      expect(response.statusCode, response.body).toBe(202);
      const body = response.json<ExportBody>();
      expect(body).toMatchObject({
        status: 'queued',
        requestedBy: scA.userId,
        requesterRole: 'sc',
        playerCount: 1,
        excludedPlayerCount: 1,
        file: null,
        format: 'sport-performance.club-data-csv',
        formatVersion: 1,
      });
      expect(body.datasets).toContain('players');
      const row = await stored(body.id);
      expect(row.player_ids).toEqual([consenting]);
      expect(row.player_ids).not.toContain(withoutConsent);
      // Status only: the cause and the staff note of the block stay in the medical schema.
      expect(row.availability).toEqual({
        [consenting]: { training: 'unavailable', match: 'unavailable' },
      });
      expect(JSON.stringify(row.availability)).not.toContain('Esguince');
      // The read was the requester's, in the medical log.
      const { rows } = await database.admin.query<{ n: string }>(
        `select count(*) as n from medical.access_log
          where club_id = $1 and actor_user_id = $2 and resource = 'availability'`,
        [clubA, scA.userId],
      );
      expect(Number(rows[0]?.n)).toBeGreaterThan(0);
    });

    it('the administration exports the whole club', async () => {
      const response = await ask(adminA, { datasets: ['wellness', 'players'], from: '2026-01-01' });
      expect(response.statusCode, response.body).toBe(202);
      const body = response.json<ExportBody>();
      expect(body).toMatchObject({
        datasets: ['players', 'wellness'],
        from: '2026-01-01',
        to: null,
        playerCount: 2,
        excludedPlayerCount: 1,
      });
      expect((await stored(body.id)).player_ids.sort()).toEqual([consenting, other].sort());
    });

    it('takes no availability when the roster is not asked for', async () => {
      const response = await ask(adminA, { datasets: ['wellness'] });
      expect(response.statusCode).toBe(202);
      expect((await stored(response.json<ExportBody>().id)).availability).toBeNull();
    });

    it('nobody else asks', async () => {
      for (const caller of [coachA, playerA]) {
        expect((await ask(caller)).statusCode).toBe(403);
      }
    });

    it('rejects a range that ends before it starts and unknown datasets', async () => {
      expect((await ask(adminA, { from: '2026-03-02', to: '2026-03-01' })).statusCode).toBe(400);
      expect((await ask(adminA, { datasets: ['medical'] })).statusCode).toBe(400);
      expect((await ask(adminA, { datasets: [] })).statusCode).toBe(400);
    });

    it('is idempotent by clientUuid, and the same clientUuid for another export conflicts', async () => {
      const clientUuid = randomUUID();
      const first = await ask(adminA, { clientUuid, datasets: ['players'] });
      expect(first.statusCode).toBe(202);
      const again = await ask(adminA, { clientUuid, datasets: ['players'] });
      expect(again.statusCode).toBe(202);
      expect(again.headers['x-idempotent-replay']).toBe('true');
      expect(again.json<ExportBody>().id).toBe(first.json<ExportBody>().id);
      expect((await ask(adminA, { clientUuid, datasets: ['wellness'] })).statusCode).toBe(409);
      // Someone else's clientUuid is not theirs to replay.
      expect((await ask(scA, { clientUuid, datasets: ['players'] })).statusCode).toBe(409);
    });
  });

  describe('reading and downloading', () => {
    it('each requester lists their own exports, the administration all of the club', async () => {
      const ofSc = (await list(scA)).json<{ items: ExportBody[] }>().items;
      expect(ofSc.length).toBeGreaterThan(0);
      expect(ofSc.every((item) => item.requestedBy === scA.userId)).toBe(true);
      const ofAdmin = (await list(adminA)).json<{ items: ExportBody[] }>().items;
      expect(ofAdmin.some((item) => item.requestedBy === scA.userId)).toBe(true);
      expect(ofAdmin.some((item) => item.requestedBy === adminA.userId)).toBe(true);
      expect((await list(adminB)).json<{ items: ExportBody[] }>().items).toEqual([]);
      expect((await list(coachA)).statusCode).toBe(403);
      const adminExport = ofAdmin.find((item) => item.requestedBy === adminA.userId);
      expect((await get(scA, adminExport?.id ?? '')).statusCode).toBe(404);
      expect((await get(adminB, adminExport?.id ?? '')).statusCode).toBe(404);
    });

    it('signs the download of a ready ZIP until it expires', async () => {
      const created = (await ask(scA, { datasets: ['players'] })).json<ExportBody>();
      expect((await get(scA, created.id, '/download')).statusCode).toBe(409);

      // What the worker leaves: the ZIP in the bucket and the export ready.
      const zip = Buffer.from('PK zip of the club data');
      const checksum = createHash('sha256').update(zip).digest('base64');
      const { rows } = await database.admin.query<{ id: string }>(
        `insert into file (club_id, kind, status, content_type, size_bytes, checksum_sha256, file_name,
                           uploaded_at, expires_at, created_by)
         values ($1, 'data_export', 'ready', 'application/zip', $2, $3, 'datos-export-a-2026-03-20.zip',
                 now(), now() + interval '7 days', $4) returning id`,
        [clubA, zip.length, checksum, scA.userId],
      );
      const fileId = rows[0]?.id ?? '';
      await files.storage.putObject({
        key: `clubs/${clubA}/data_export/${fileId}`,
        contentType: 'application/zip',
        sizeBytes: zip.length,
        checksumSha256: checksum,
        body: () => Readable.from([zip]),
      });
      await database.admin.query(
        `update club_data_export set status = 'ready', started_at = now(), completed_at = now(),
                attempts = 1, file_id = $2, row_counts = '{"players": 1}', availability = null
          where id = $1`,
        [created.id, fileId],
      );

      const ready = (await get(scA, created.id)).json<ExportBody>();
      expect(ready).toMatchObject({
        status: 'ready',
        file: { id: fileId, fileName: 'datos-export-a-2026-03-20.zip', sizeBytes: zip.length },
      });
      const download = await get(scA, created.id, '/download');
      expect(download.statusCode, download.body).toBe(200);
      const fetched = await fetch(download.json<{ url: string }>().url);
      expect(fetched.status).toBe(200);
      expect(fetched.headers.get('content-type')).toBe('application/zip');
      expect(fetched.headers.get('content-disposition')).toContain(
        'attachment; filename="datos-export-a-2026-03-20.zip"',
      );
      expect(Buffer.from(await fetched.arrayBuffer())).toEqual(zip);
      // The administration downloads it too; the generic files endpoints are not for S&C.
      expect((await get(adminA, created.id, '/download')).statusCode).toBe(200);
      expect(
        (await t.app.inject({ url: `/v1/files/${fileId}`, headers: scA.headers })).statusCode,
      ).toBe(403);

      await database.admin.query(
        `update file set expires_at = now() - interval '1 minute' where id = $1`,
        [fileId],
      );
      expect((await get(scA, created.id)).json<ExportBody>()).toMatchObject({
        status: 'expired',
        file: null,
      });
      expect((await get(scA, created.id, '/download')).statusCode).toBe(409);
    });
  });
});
