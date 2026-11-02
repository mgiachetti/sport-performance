/**
 * Uploaded files end to end (B-325, ADR 0044) against Postgres 16 and a real
 * S3-compatible bucket (MinIO, `STORAGE_TEST_URL`), through the real
 * connection roles (ADR 0026): signed uploads the bucket enforces, the
 * permission matrix and the image consent in the handlers, RLS behind them,
 * the crest of the theme and the retention job with the worker role.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createDatabase, provisionLoginRole } from '@sport-performance/db';
import {
  FILE_UPLOAD_URL_MAX_TTL_S,
  SIGNED_URL_CLOCK_SKEW_S,
  type ClubId,
} from '@sport-performance/domain';
import { purgeExpiredFiles } from '@sport-performance/storage';
import {
  createTestBucket,
  storageTestUrl,
  type TestBucket,
} from '@sport-performance/storage/testing';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
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

// Real round trips to the bucket on top of the database: slow when CI runs every package at once.
vi.setConfig({ testTimeout: 30_000 });

interface FileBody {
  id: string;
  kind: string;
  status: string;
  playerId: string | null;
  categoryId: string | null;
  contentType: string;
  sizeBytes: number;
  fileName: string | null;
  uploadedAt: string | null;
  expiresAt: string | null;
  deletedAt: string | null;
  createdBy: string | null;
}

interface CreatedBody {
  file: FileBody;
  upload: { method: 'PUT'; url: string; headers: Record<string, string>; expiresAt: string } | null;
}

interface Envelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  randomBytes(64),
]);

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('base64');
}

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
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

describeWithStorage('files (Postgres + MinIO)', (serverUrl, storageUrl) => {
  let database: TestDatabase;
  let bucket: TestBucket;
  let files: FilesModule;
  let t: IdentityTestApp;
  let adminA: SignedIn;
  let scA: SignedIn;
  let coachA: SignedIn;
  let playerA: SignedIn;
  let parentA: SignedIn;
  let adminB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m15: string;
  /** M15 player with image consent (the user of `playerA`). */
  let consenting: string;
  /** M15 player without image consent. */
  let withoutConsent: string;
  let playerB: string;
  let videoId: string;
  const video = Buffer.from(`cmj ${randomBytes(256).toString('hex')}`);

  const upload = (signed: NonNullable<CreatedBody['upload']>, body: Buffer) =>
    fetch(signed.url, { method: signed.method, headers: signed.headers, body });

  async function create(caller: SignedIn, payload: Record<string, unknown>) {
    return t.app.inject({ method: 'POST', url: '/v1/files', headers: caller.headers, payload });
  }

  const videoPayload = (playerId: string, body: Buffer = video, extra = {}) => ({
    kind: 'cmj_video',
    playerId,
    contentType: 'video/mp4',
    sizeBytes: body.length,
    checksumSha256: sha256(body),
    fileName: 'salto 1.mp4',
    ...extra,
  });

  async function insertPlayer(
    club: ClubId,
    category: string,
    name: string,
    userId: string | null = null,
  ): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      // The player's sport is the one of its category (`player_sport_guard`).
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport,
                           joined_on)
       select $1, $2, $3, 'Test', '2011-05-10', 'male', sport, '2024-03-01'
         from category where club_id = $1 and id = $4
       returning id`,
      [club, userId, name, category],
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

  async function clubOf(caller: SignedIn) {
    const response = await t.app.inject({ url: '/v1/club', headers: caller.headers });
    return response.json<{ version: string; logoFileId: string | null }>();
  }

  async function uploadedFile(caller: SignedIn, payload: Record<string, unknown>, body: Buffer) {
    const created = await create(caller, payload);
    expect(created.statusCode, created.body).toBe(201);
    const { file, upload: signed } = created.json<CreatedBody>();
    if (signed === null) throw new Error('no upload URL');
    expect((await upload(signed, body)).status).toBe(200);
    const confirmed = await t.app.inject({
      method: 'POST',
      url: `/v1/files/${file.id}/confirm`,
      headers: caller.headers,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    return confirmed.json<FileBody>();
  }

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
        upload: {
          perIp: { name: 'api_upload_ip', ...generous },
          perUser: { name: 'api_upload_user', ...generous },
        },
      },
    });
    adminA = await signIn(t, 'admin@files-a.example.com');
    scA = await signIn(t, 'sc@files-a.example.com');
    coachA = await signIn(t, 'coach@files-a.example.com');
    playerA = await signIn(t, 'player@files-a.example.com');
    parentA = await signIn(t, 'parent@files-a.example.com');
    adminB = await signIn(t, 'admin@files-b.example.com');

    clubA = await createClub(database.admin, 'files-a');
    clubB = await createClub(database.admin, 'files-b');
    m15 = await createCategory(database.admin, clubA, 'M15');
    const m15B = await createCategory(database.admin, clubB, 'M15');
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await createMembership(database.admin, playerA.userId, clubA, 'player');
    await createMembership(database.admin, parentA.userId, clubA, 'parent');
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
    consenting = await insertPlayer(clubA, m15, 'Con', playerA.userId);
    withoutConsent = await insertPlayer(clubA, m15, 'Sin');
    playerB = await insertPlayer(clubB, m15B, 'Otro');
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2024-01-01')`,
      [clubA, consenting, parentA.userId],
    );
    for (const type of ['data', 'image']) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, $3, '2026-01', 'guardian', $4)`,
        [clubA, consenting, type, parentA.userId],
      );
    }
    await database.admin.query(
      `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
       values ($1, $2, 'data', '2026-01', 'guardian', $3)`,
      [clubA, withoutConsent, parentA.userId],
    );
  }, 120_000);

  afterAll(async () => {
    await t.close();
    await bucket.drop();
    await database.drop();
  });

  describe('CMJ videos', () => {
    const clientUuid = randomUUID();

    it('hands out a signed upload the bucket enforces, then confirms it', async () => {
      const created = await create(scA, videoPayload(consenting, video, { clientUuid }));
      expect(created.statusCode, created.body).toBe(201);
      const body = created.json<CreatedBody>();
      videoId = body.file.id;
      expect(body.file).toMatchObject({
        kind: 'cmj_video',
        status: 'pending',
        playerId: consenting,
        categoryId: null,
        contentType: 'video/mp4',
        sizeBytes: video.length,
        fileName: 'salto 1.mp4',
        uploadedAt: null,
        createdBy: scA.userId,
      });
      expect(Date.parse(body.file.expiresAt ?? '') - Date.now()).toBeGreaterThan(DAY_MS - 60_000);
      const signed = body.upload;
      if (signed === null) throw new Error('no upload URL');
      expect(signed.method).toBe('PUT');
      expect(signed.url).toContain(`clubs/${clubA}/cmj_video/${videoId}`);
      expect(signed.headers['content-type']).toBe('video/mp4');

      // Not uploaded yet.
      const early = await t.app.inject({
        method: 'POST',
        url: `/v1/files/${videoId}/confirm`,
        headers: scA.headers,
      });
      expect(early.statusCode).toBe(409);

      // The bucket refuses any other body, size or type than the signed one.
      const tampered = Buffer.from(video);
      tampered[10] = (tampered[10] ?? 0) ^ 0xff;
      expect((await upload(signed, tampered)).ok).toBe(false);
      expect((await upload(signed, Buffer.concat([video, video]))).ok).toBe(false);
      const otherType = await fetch(signed.url, {
        method: 'PUT',
        headers: { ...signed.headers, 'content-type': 'text/html' },
        body: video,
      });
      expect(otherType.ok).toBe(false);
      expect(await bucket.keys()).toEqual([]);

      expect((await upload(signed, video)).status).toBe(200);
      const confirmed = await t.app.inject({
        method: 'POST',
        url: `/v1/files/${videoId}/confirm`,
        headers: scA.headers,
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      const file = confirmed.json<FileBody>();
      expect(file.status).toBe('ready');
      expect(file.uploadedAt).not.toBeNull();
      // Retention of the kind: 180 days after the confirmation.
      const kept = Date.parse(file.expiresAt ?? '') - Date.parse(file.uploadedAt ?? '');
      expect(kept).toBe(180 * DAY_MS);

      // Confirming again changes nothing.
      const again = await t.app.inject({
        method: 'POST',
        url: `/v1/files/${videoId}/confirm`,
        headers: scA.headers,
      });
      expect(again.json<FileBody>()).toEqual(file);
    });

    it('replays the create by clientUuid without a new row or a new upload', async () => {
      const replay = await create(scA, videoPayload(consenting, video, { clientUuid }));
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      const body = replay.json<CreatedBody>();
      expect(body.file.id).toBe(videoId);
      expect(body.file.status).toBe('ready');
      expect(body.upload).toBeNull();
      const count = await database.admin.query<{ n: string }>(
        'select count(*) as n from file where client_uuid = $1',
        [clientUuid],
      );
      expect(count.rows[0]?.n).toBe('1');
    });

    it('gives a fresh upload URL when a pending create is replayed', async () => {
      const body = Buffer.from('another jump');
      const uuid = randomUUID();
      const first = (
        await create(scA, videoPayload(consenting, body, { clientUuid: uuid }))
      ).json<CreatedBody>();
      const replay = await create(scA, videoPayload(consenting, body, { clientUuid: uuid }));
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      const again = replay.json<CreatedBody>();
      expect(again.file.id).toBe(first.file.id);
      expect(again.upload?.url).toContain(first.file.id);
    });

    it('refuses a replay of the clientUuid with another file', async () => {
      const body = Buffer.from('one more jump');
      const uuid = randomUUID();
      const first = await create(scA, videoPayload(consenting, body, { clientUuid: uuid }));
      expect(first.statusCode, first.body).toBe(201);
      const other = Buffer.from('a different jump');
      for (const payload of [
        videoPayload(consenting, other, { clientUuid: uuid }),
        videoPayload(consenting, body, { clientUuid: uuid, fileName: 'otro.mp4' }),
        videoPayload(consenting, body, { clientUuid: uuid, contentType: 'video/quicktime' }),
      ]) {
        const replay = await create(scA, payload);
        expect(replay.statusCode, replay.body).toBe(409);
        expect(errorOf(replay).code).toBe('conflict');
      }
      // The same file from someone else is not their replay either.
      const byAdmin = await create(adminA, videoPayload(consenting, body, { clientUuid: uuid }));
      expect(byAdmin.statusCode, byAdmin.body).toBe(409);
    });

    it('fails the confirmation closed when the bucket does not return the checksum', async () => {
      const blind = createFilesModule(
        { storage: null, uploadUrlTtlS: 900, downloadUrlTtlS: 120, logoUrlTtlS: 3600 },
        {
          storage: {
            ...files.storage,
            stat: async (key) => {
              const stored = await files.storage.stat(key);
              return stored === null ? null : { ...stored, checksumSha256: null };
            },
          },
        },
      );
      const blindApp = await startIdentityApp(database, { files: blind });
      try {
        const body = Buffer.from(`unverifiable jump ${randomBytes(8).toString('hex')}`);
        const created = (await create(scA, videoPayload(consenting, body))).json<CreatedBody>();
        if (created.upload === null) throw new Error('no upload URL');
        expect((await upload(created.upload, body)).status).toBe(200);
        const confirm = await blindApp.app.inject({
          method: 'POST',
          url: `/v1/files/${created.file.id}/confirm`,
          headers: scA.headers,
        });
        expect(confirm.statusCode, confirm.body).toBe(409);
        const row = await database.admin.query<{ status: string }>(
          'select status from file where id = $1',
          [created.file.id],
        );
        expect(row.rows[0]?.status).toBe('pending');
        expect(await files.storage.stat(`clubs/${clubA}/cmj_video/${created.file.id}`)).toBeNull();
      } finally {
        await blindApp.close();
      }
    });

    it('downloads with a short signed URL for those who may see it', async () => {
      for (const caller of [scA, coachA, adminA, playerA]) {
        const response = await t.app.inject({
          url: `/v1/files/${videoId}/download`,
          headers: caller.headers,
        });
        expect(response.statusCode, response.body).toBe(200);
        const { url, expiresAt } = response.json<{ url: string; expiresAt: string }>();
        expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(120_000);
        const fetched = await fetch(url);
        expect(fetched.status).toBe(200);
        expect(fetched.headers.get('content-type')).toBe('video/mp4');
        expect(fetched.headers.get('content-disposition')).toBe(
          `inline; filename="salto 1.mp4"; filename*=UTF-8''salto%201.mp4`,
        );
        expect(Buffer.from(await fetched.arrayBuffer())).toEqual(video);
      }
    });

    it('never shows a video to a guardian, and denies without a reason', async () => {
      const response = await t.app.inject({
        url: `/v1/files/${videoId}/download`,
        headers: parentA.headers,
      });
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).message).not.toMatch(/role_denied|consent/);
      const meta = await t.app.inject({ url: `/v1/files/${videoId}`, headers: parentA.headers });
      expect(meta.statusCode).toBe(403);
    });

    it('refuses videos of a player without a current image consent', async () => {
      for (const caller of [scA, adminA]) {
        const response = await create(caller, videoPayload(withoutConsent));
        expect(response.statusCode, response.body).toBe(403);
        // The missing consent is what the holder has to sign (B-312, ADR 0043).
        expect(errorOf(response).code).toBe('consent_required');
      }
      // A video uploaded while the consent was current stops being shown once revoked.
      await database.admin.query(
        `update consent set revoked_at = now(), revoked_by = signed_by
          where player_id = $1 and type = 'image'`,
        [consenting],
      );
      try {
        const response = await t.app.inject({
          url: `/v1/files/${videoId}/download`,
          headers: scA.headers,
        });
        expect(response.statusCode).toBe(403);
        expect(errorOf(response).code).toBe('consent_required');
      } finally {
        await database.admin.query(
          `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
           values ($1, $2, 'image', '2026-02', 'guardian', $3)`,
          [clubA, consenting, parentA.userId],
        );
      }
    });

    it('denies the upload to roles without it', async () => {
      for (const caller of [coachA, playerA, parentA]) {
        const response = await create(caller, videoPayload(consenting));
        expect(response.statusCode, response.body).toBe(403);
      }
    });

    it('hides the files and players of another club', async () => {
      for (const url of [`/v1/files/${videoId}`, `/v1/files/${videoId}/download`]) {
        const response = await t.app.inject({ url, headers: adminB.headers });
        expect(response.statusCode, url).toBe(404);
      }
      const confirm = await t.app.inject({
        method: 'POST',
        url: `/v1/files/${videoId}/confirm`,
        headers: adminB.headers,
      });
      expect(confirm.statusCode).toBe(404);
      const remove = await t.app.inject({
        method: 'DELETE',
        url: `/v1/files/${videoId}`,
        headers: adminB.headers,
      });
      expect(remove.statusCode).toBe(404);
      // A player of club B is not a player of club A.
      const response = await create(adminA, videoPayload(playerB));
      expect(response.statusCode).toBe(404);
    });

    it('validates the declared file against its kind', async () => {
      const cases: [Record<string, unknown>, string][] = [
        [videoPayload(consenting, video, { contentType: 'video/x-msvideo' }), 'contentType'],
        [videoPayload(consenting, video, { sizeBytes: 251 * 1024 * 1024 }), 'sizeBytes'],
        [videoPayload(consenting, video, { checksumSha256: 'abc' }), 'checksumSha256'],
        [{ ...videoPayload(consenting), kind: 'pdf_report' }, 'kind'],
        [{ ...videoPayload(consenting), extra: true }, ''],
      ];
      for (const [payload, field] of cases) {
        const response = await create(scA, payload);
        expect(response.statusCode, field).toBe(400);
        expect(errorOf(response).code).toBe('validation_failed');
      }
      const empty = await create(scA, videoPayload(consenting, video, { fileName: '../' }));
      expect(empty.statusCode).toBe(400);
      expect(errorOf(empty).details?.[0]?.path).toEqual(['body', 'fileName']);
      // C1 control characters (U+0085) are dropped, never a 500 from the database CHECK.
      const c1 = await create(
        scA,
        videoPayload(consenting, video, { fileName: 'salto\u0085 2.mp4' }),
      );
      expect(c1.statusCode, c1.body).toBe(201);
      expect(c1.json<CreatedBody>().file.fileName).toBe('salto 2.mp4');
      const onlyC1 = await create(
        scA,
        videoPayload(consenting, video, { fileName: '\u0085\u009f' }),
      );
      expect(onlyC1.statusCode, onlyC1.body).toBe(400);
      expect(errorOf(onlyC1).details?.[0]?.path).toEqual(['body', 'fileName']);
    });

    it('lists the videos each role may see, page by page', async () => {
      const list = async (caller: SignedIn, query: string) => {
        const response = await t.app.inject({ url: `/v1/files?${query}`, headers: caller.headers });
        expect(response.statusCode, response.body).toBe(200);
        return response.json<{ items: FileBody[]; nextCursor: string | null }>();
      };
      const all = await list(adminA, 'kind=cmj_video&status=all');
      expect(all.items.length).toBeGreaterThanOrEqual(2);
      const ready = await list(coachA, 'kind=cmj_video');
      expect(ready.items.map((f) => f.id)).toEqual([videoId]);
      const own = await list(playerA, 'kind=cmj_video&status=all');
      expect(own.items.every((f) => f.playerId === consenting)).toBe(true);
      const parent = await t.app.inject({
        url: '/v1/files?kind=cmj_video',
        headers: parentA.headers,
      });
      expect(parent.statusCode).toBe(403);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: FileBody[]; nextCursor: string | null } = await list(
          adminA,
          `kind=cmj_video&status=all&limit=1${cursor === null ? '' : `&cursor=${cursor}`}`,
        );
        seen.push(...page.items.map((f) => f.id));
        cursor = page.nextCursor;
      } while (cursor !== null);
      expect(seen).toEqual(all.items.map((f) => f.id));
      const mismatch = await t.app.inject({
        url: `/v1/files?kind=club_logo&cursor=${encodeURIComponent((await list(adminA, 'kind=cmj_video&status=all&limit=1')).nextCursor ?? '')}`,
        headers: adminA.headers,
      });
      expect(mismatch.statusCode).toBe(400);
    });
  });

  describe('imports', () => {
    const csv = Buffer.from('nombre;apellido\nJuan;Pérez\n');
    const payload = (extra = {}) => ({
      kind: 'data_import',
      contentType: 'text/csv',
      sizeBytes: csv.length,
      checksumSha256: sha256(csv),
      fileName: 'Padrón M15.csv',
      ...extra,
    });

    it('lets sc import for an assigned category and the administration for the club', async () => {
      const forClub = await create(scA, payload());
      expect(forClub.statusCode).toBe(403);
      const file = await uploadedFile(scA, payload({ categoryId: m15 }), csv);
      expect(file).toMatchObject({ kind: 'data_import', categoryId: m15, status: 'ready' });
      await uploadedFile(adminA, payload(), csv);
      const response = await t.app.inject({
        url: `/v1/files/${file.id}/download`,
        headers: scA.headers,
      });
      const { url } = response.json<{ url: string }>();
      const fetched = await fetch(url);
      expect(fetched.headers.get('content-disposition')).toBe(
        `attachment; filename="Padron M15.csv"; filename*=UTF-8''Padr%C3%B3n%20M15.csv`,
      );
      const listed = await t.app.inject({
        url: '/v1/files?kind=data_import',
        headers: scA.headers,
      });
      expect(listed.json<{ items: FileBody[] }>().items.map((f) => f.id)).toEqual([file.id]);
      const coach = await t.app.inject({ url: `/v1/files/${file.id}`, headers: coachA.headers });
      expect(coach.statusCode).toBe(403);
    });
  });

  describe('crest of the club', () => {
    const logoPayload = (body: Buffer) => ({
      kind: 'club_logo',
      contentType: 'image/png',
      sizeBytes: body.length,
      checksumSha256: sha256(body),
    });

    it('is uploaded by the administration only', async () => {
      for (const caller of [scA, coachA]) {
        expect((await create(caller, logoPayload(PNG))).statusCode).toBe(403);
      }
    });

    it('is a raster image: no SVG, which can carry scripts', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
      const response = await create(adminA, { ...logoPayload(svg), contentType: 'image/svg+xml' });
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).code).toBe('validation_failed');
    });

    it('becomes the crest of the theme, with a signed URL', async () => {
      const before = await t.app.inject({ url: '/v1/clubs/files-a/theme' });
      expect(before.json<{ logoUrl: string | null }>().logoUrl).toBeNull();

      const logo = await uploadedFile(adminA, logoPayload(PNG), PNG);
      // Unused, a crest is kept for 30 days.
      expect(Date.parse(logo.expiresAt ?? '') - Date.parse(logo.uploadedAt ?? '')).toBe(
        30 * DAY_MS,
      );
      const patched = await t.app.inject({
        method: 'PATCH',
        url: '/v1/club',
        headers: adminA.headers,
        payload: { version: (await clubOf(adminA)).version, logoFileId: logo.id },
      });
      expect(patched.statusCode, patched.body).toBe(200);
      expect(patched.json<{ logoFileId: string }>().logoFileId).toBe(logo.id);
      const inUse = await t.app.inject({ url: `/v1/files/${logo.id}`, headers: adminA.headers });
      expect(inUse.json<FileBody>().expiresAt).toBeNull();

      const theme = await t.app.inject({ url: '/v1/clubs/files-a/theme' });
      expect(theme.statusCode, theme.body).toBe(200);
      const { logoUrl } = theme.json<{ logoUrl: string }>();
      expect(logoUrl).toContain(`clubs/${clubA}/club_logo/${logo.id}`);
      const fetched = await fetch(logoUrl);
      expect(fetched.status).toBe(200);
      expect(fetched.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await fetched.arrayBuffer())).toEqual(PNG);

      // Every member sees the crest's record.
      const asCoach = await t.app.inject({ url: `/v1/files/${logo.id}`, headers: coachA.headers });
      expect(asCoach.statusCode).toBe(200);

      // The crest in use is not deleted.
      const remove = await t.app.inject({
        method: 'DELETE',
        url: `/v1/files/${logo.id}`,
        headers: adminA.headers,
      });
      expect(remove.statusCode).toBe(409);

      // Replaced: the old crest expires 30 days later.
      const next = await uploadedFile(adminA, logoPayload(PNG), PNG);
      const replaced = await t.app.inject({
        method: 'PATCH',
        url: '/v1/club',
        headers: adminA.headers,
        payload: { version: (await clubOf(adminA)).version, logoFileId: next.id },
      });
      expect(replaced.statusCode, replaced.body).toBe(200);
      const old = (
        await t.app.inject({ url: `/v1/files/${logo.id}`, headers: adminA.headers })
      ).json<FileBody>();
      expect(Date.parse(old.expiresAt ?? '') - Date.now()).toBeGreaterThan(29 * DAY_MS);
    });

    it('only accepts a ready crest of the club itself', async () => {
      const pending = (await create(adminA, logoPayload(PNG))).json<CreatedBody>().file;
      const csvFile = (
        await t.app.inject({ url: '/v1/files?kind=data_import', headers: adminA.headers })
      ).json<{ items: FileBody[] }>().items[0];
      const otherClub = await uploadedFile(adminB, logoPayload(PNG), PNG);
      for (const logoFileId of [pending.id, csvFile?.id, otherClub.id, randomUUID()]) {
        const response = await t.app.inject({
          method: 'PATCH',
          url: '/v1/club',
          headers: adminA.headers,
          payload: { version: (await clubOf(adminA)).version, logoFileId },
        });
        expect(response.statusCode, response.body).toBe(400);
        expect(errorOf(response).details?.[0]?.path).toEqual(['body', 'logoFileId']);
      }
    });

    it('shows pending and deleted crests only to the administration', async () => {
      const pending = (await create(adminA, logoPayload(PNG))).json<CreatedBody>().file;
      const list = async (caller: SignedIn, query: string) => {
        const response = await t.app.inject({ url: `/v1/files?${query}`, headers: caller.headers });
        expect(response.statusCode, response.body).toBe(200);
        return response.json<{ items: FileBody[] }>();
      };
      const ids = async (caller: SignedIn) =>
        (await list(caller, 'kind=club_logo&status=all&limit=100')).items.map((f) => f.id);
      expect(await ids(adminA)).toContain(pending.id);
      expect(await ids(coachA)).not.toContain(pending.id);
      expect((await list(coachA, 'kind=club_logo&status=pending')).items).toEqual([]);
      const asCoach = await t.app.inject({
        url: `/v1/files/${pending.id}`,
        headers: coachA.headers,
      });
      expect(asCoach.statusCode).toBe(404);
    });

    it('is never set as the crest and deleted at once', async () => {
      for (let round = 0; round < 3; round += 1) {
        const crest = await uploadedFile(adminA, logoPayload(PNG), PNG);
        const { version } = await clubOf(adminA);
        const [patched, removed] = await Promise.all([
          t.app.inject({
            method: 'PATCH',
            url: '/v1/club',
            headers: adminA.headers,
            payload: { version, logoFileId: crest.id },
          }),
          t.app.inject({
            method: 'DELETE',
            url: `/v1/files/${crest.id}`,
            headers: adminA.headers,
          }),
        ]);
        // One of the two wins; the other sees what it left.
        const outcome = [patched.statusCode, removed.statusCode];
        expect([
          [200, 409],
          [400, 200],
        ]).toContainEqual(outcome);
        const { logoFileId } = await clubOf(adminA);
        const row = await database.admin.query<{ status: string }>(
          'select status from file where id = $1',
          [crest.id],
        );
        if (logoFileId === crest.id) expect(row.rows[0]?.status).toBe('ready');
        else expect(row.rows[0]?.status).toBe('deleted');
      }
    });
  });

  describe('deletion and retention', () => {
    let worker: { login: string; pool: pg.Pool };

    beforeAll(async () => {
      const login = `sp_test_files_worker_${randomBytes(4).toString('hex')}`;
      const password = randomBytes(24).toString('hex');
      await provisionLoginRole({ connectionString: serverUrl, login, password, role: 'worker' });
      const url = new URL(database.appUrl);
      url.username = login;
      url.password = password;
      // Two connections: two runs of the job at once.
      worker = { login, pool: new pg.Pool({ connectionString: url.toString(), max: 2 }) };
    });

    afterAll(async () => {
      await worker.pool.end();
      const client = new pg.Client({ connectionString: serverUrl });
      await client.connect();
      // A member of sport_performance_worker that owns nothing: dropped like the harness's logins.
      await client.query(`drop role if exists "${worker.login}"`);
      await client.end();
    });

    /** A moment the job runs after every upload URL handed out until now is dead. */
    const afterEveryUploadUrl = () =>
      new Date(Date.now() + (FILE_UPLOAD_URL_MAX_TTL_S + SIGNED_URL_CLOCK_SKEW_S + 1) * 1000);

    /** The retention job as the worker runs it: one club, its context, one transaction. */
    async function purge(
      club: ClubId,
      now?: Date,
      options: { limit?: number; budgetMs?: number; beforeCommit?: () => Promise<void> } = {},
    ) {
      const client = await worker.pool.connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('app.club_id', $1, true)`, [club]);
        const report = await purgeExpiredFiles(createDatabase(client), files.storage, {
          ...(now !== undefined && { now }),
          ...(options.limit !== undefined && { limit: options.limit }),
          ...(options.budgetMs !== undefined && { budgetMs: options.budgetMs }),
        });
        await options.beforeCommit?.();
        await client.query('commit');
        return report;
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
    }

    it('deletes on request: unavailable at once, purged by the job', async () => {
      const coachDelete = await t.app.inject({
        method: 'DELETE',
        url: `/v1/files/${videoId}`,
        headers: coachA.headers,
      });
      expect(coachDelete.statusCode).toBe(403);
      const response = await t.app.inject({
        method: 'DELETE',
        url: `/v1/files/${videoId}`,
        headers: scA.headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<FileBody>()).toMatchObject({ status: 'deleted' });
      const again = await t.app.inject({
        method: 'DELETE',
        url: `/v1/files/${videoId}`,
        headers: scA.headers,
      });
      expect(again.statusCode).toBe(200);
      const download = await t.app.inject({
        url: `/v1/files/${videoId}/download`,
        headers: scA.headers,
      });
      expect(download.statusCode).toBe(409);
      const key = `clubs/${clubA}/cmj_video/${videoId}`;
      expect(await bucket.keys()).toContain(key);

      // Confirmed a moment ago: an upload URL signed before it may still be valid, so the
      // job waits until none is (a PUT after the purge would bring the object back).
      expect((await purge(clubA)).purged).toBe(0);
      expect(await bucket.keys()).toContain(key);
      const report = await purge(clubA, afterEveryUploadUrl());
      expect(report.failed).toBe(0);
      expect(report.purged).toBeGreaterThanOrEqual(1);
      expect(await bucket.keys()).not.toContain(key);
      const row = await database.admin.query<{ status: string; purged_at: Date | null }>(
        'select status, purged_at from file where id = $1',
        [videoId],
      );
      expect(row.rows[0]?.status).toBe('deleted');
      expect(row.rows[0]?.purged_at).not.toBeNull();
      // Nothing left to do: idempotent.
      expect((await purge(clubA, afterEveryUploadUrl())).purged).toBe(0);
    });

    it('removes what a late PUT uploads after a pending file is deleted', async () => {
      const body = Buffer.from(`late jump ${randomBytes(16).toString('hex')}`);
      const created = (await create(scA, videoPayload(consenting, body))).json<CreatedBody>();
      if (created.upload === null) throw new Error('no upload URL');
      const key = `clubs/${clubA}/cmj_video/${created.file.id}`;
      const deleted = await t.app.inject({
        method: 'DELETE',
        url: `/v1/files/${created.file.id}`,
        headers: scA.headers,
      });
      expect(deleted.statusCode, deleted.body).toBe(200);
      const { expiresAt } = deleted.json<FileBody>();
      // Due once the URL handed out is dead (not the 24 h upload window, not now).
      expect(Date.parse(expiresAt ?? '')).toBeGreaterThanOrEqual(
        Date.parse(created.upload.expiresAt),
      );
      expect(Date.parse(expiresAt ?? '') - Date.now()).toBeLessThanOrEqual(
        FILE_UPLOAD_URL_MAX_TTL_S * 1000,
      );

      // The job runs before the client's PUT: nothing to remove yet, and the row stays due.
      expect((await purge(clubA)).purged).toBe(0);
      // The signed URL is still valid: the bytes land after the delete.
      expect((await upload(created.upload, body)).status).toBe(200);
      expect(await bucket.keys()).toContain(key);
      const confirm = await t.app.inject({
        method: 'POST',
        url: `/v1/files/${created.file.id}/confirm`,
        headers: scA.headers,
      });
      expect(confirm.statusCode).toBe(409);
      const download = await t.app.inject({
        url: `/v1/files/${created.file.id}/download`,
        headers: scA.headers,
      });
      expect(download.statusCode).toBe(409);

      // Once every URL is dead, the job removes the late object and marks the row.
      const report = await purge(clubA, afterEveryUploadUrl());
      expect(report.failed).toBe(0);
      expect(await bucket.keys()).not.toContain(key);
      const row = await database.admin.query<{ status: string; purged_at: Date | null }>(
        'select status, purged_at from file where id = $1',
        [created.file.id],
      );
      expect(row.rows[0]).toMatchObject({ status: 'deleted' });
      expect(row.rows[0]?.purged_at).not.toBeNull();
    });

    it('removes what a late PUT re-uploads after a confirmed file is deleted', async () => {
      const body = Buffer.from(`confirmed jump ${randomBytes(16).toString('hex')}`);
      const created = (await create(scA, videoPayload(consenting, body))).json<CreatedBody>();
      if (created.upload === null) throw new Error('no upload URL');
      expect((await upload(created.upload, body)).status).toBe(200);
      const confirmed = await t.app.inject({
        method: 'POST',
        url: `/v1/files/${created.file.id}/confirm`,
        headers: scA.headers,
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      const key = `clubs/${clubA}/cmj_video/${created.file.id}`;
      const deleted = await t.app.inject({
        method: 'DELETE',
        url: `/v1/files/${created.file.id}`,
        headers: scA.headers,
      });
      expect(deleted.statusCode).toBe(200);
      // Even if something removed the object right away, the URL signed before the
      // confirmation still uploads it again...
      await files.storage.remove(key);
      expect((await upload(created.upload, body)).status).toBe(200);
      expect((await purge(clubA)).purged).toBe(0);
      // ...and the job, which waits for that URL to die, removes it.
      await purge(clubA, afterEveryUploadUrl());
      expect(await bucket.keys()).not.toContain(key);
    });

    it('hands out no upload URL when the create of a deleted file is replayed', async () => {
      const body = Buffer.from(`replayed jump ${randomBytes(8).toString('hex')}`);
      const clientUuid = randomUUID();
      const created = (
        await create(scA, videoPayload(consenting, body, { clientUuid }))
      ).json<CreatedBody>();
      expect(created.upload).not.toBeNull();
      const deleted = await t.app.inject({
        method: 'DELETE',
        url: `/v1/files/${created.file.id}`,
        headers: scA.headers,
      });
      expect(deleted.statusCode).toBe(200);
      const replay = await create(scA, videoPayload(consenting, body, { clientUuid }));
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      const again = replay.json<CreatedBody>();
      expect(again.file).toMatchObject({ id: created.file.id, status: 'deleted' });
      expect(again.upload).toBeNull();
      await purge(clubA, afterEveryUploadUrl());
    });

    it('never touches a purged row again, even when asked to delete it', async () => {
      const body = Buffer.from(`purged jump ${randomBytes(8).toString('hex')}`);
      const created = (await create(scA, videoPayload(consenting, body))).json<CreatedBody>();
      const remove = () =>
        t.app.inject({
          method: 'DELETE',
          url: `/v1/files/${created.file.id}`,
          headers: scA.headers,
        });
      expect((await remove()).statusCode).toBe(200);
      await purge(clubA, afterEveryUploadUrl());
      const before = await database.admin.query<Record<string, unknown>>(
        'select status, deleted_at, expires_at, purged_at, updated_at from file where id = $1',
        [created.file.id],
      );
      expect(before.rows[0]?.purged_at).not.toBeNull();
      const again = await remove();
      expect(again.statusCode).toBe(200);
      expect(again.json<FileBody>().status).toBe('deleted');
      const after = await database.admin.query<Record<string, unknown>>(
        'select status, deleted_at, expires_at, purged_at, updated_at from file where id = $1',
        [created.file.id],
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
    });

    it('splits the work between two runs at once (SKIP LOCKED) and keeps runs short', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const body = Buffer.from(`split jump ${String(i)} ${randomBytes(8).toString('hex')}`);
        const created = (await create(scA, videoPayload(consenting, body))).json<CreatedBody>();
        if (created.upload === null) throw new Error('no upload URL');
        expect((await upload(created.upload, body)).status).toBe(200);
        ids.push(created.file.id);
      }
      for (const id of ids) {
        const response = await t.app.inject({
          method: 'DELETE',
          url: `/v1/files/${id}`,
          headers: scA.headers,
        });
        expect(response.statusCode).toBe(200);
      }
      const later = afterEveryUploadUrl();
      // The first run takes one file and holds its lock while a second run goes: the second
      // skips it and takes the rest, without waiting.
      let second: Awaited<ReturnType<typeof purge>> | undefined;
      const first = await purge(clubA, later, {
        limit: 1,
        beforeCommit: async () => {
          second = await purge(clubA, later);
        },
      });
      expect(first).toMatchObject({ purged: 1, failed: 0, more: true });
      expect(second).toMatchObject({ purged: 2, failed: 0, more: false });
      const keys = await bucket.keys();
      for (const id of ids) expect(keys).not.toContain(`clubs/${clubA}/cmj_video/${id}`);
      const rows = await database.admin.query<{ n: string }>(
        'select count(*) as n from file where id = any($1) and purged_at is not null',
        [ids],
      );
      expect(rows.rows[0]?.n).toBe('3');
    });

    it('stops a run when its time budget runs out, leaving the rest due', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i += 1) {
        const body = Buffer.from(`budget jump ${String(i)} ${randomBytes(8).toString('hex')}`);
        const created = (await create(scA, videoPayload(consenting, body))).json<CreatedBody>();
        ids.push(created.file.id);
        await t.app.inject({
          method: 'DELETE',
          url: `/v1/files/${created.file.id}`,
          headers: scA.headers,
        });
      }
      const later = afterEveryUploadUrl();
      expect(await purge(clubA, later, { budgetMs: 0 })).toMatchObject({ purged: 1, more: true });
      expect(await purge(clubA, later, { budgetMs: 0 })).toMatchObject({ purged: 1 });
      expect((await purge(clubA, later)).purged).toBe(0);
    });

    it('purges expired files and abandoned uploads, never the crest in use', async () => {
      const body = Buffer.from('abandoned jump');
      const created = (await create(scA, videoPayload(consenting, body))).json<CreatedBody>();
      if (created.upload === null) throw new Error('no upload URL');
      expect((await upload(created.upload, body)).status).toBe(200);
      const abandonedKey = `clubs/${clubA}/cmj_video/${created.file.id}`;
      const { logoFileId } = await clubOf(adminA);
      // A day and a half later: the upload window (24 h) closed.
      const later = new Date(Date.now() + 1.5 * DAY_MS);
      const report = await purge(clubA, later);
      expect(report.failed).toBe(0);
      const keys = await bucket.keys();
      expect(keys).not.toContain(abandonedKey);
      expect(keys).toContain(`clubs/${clubA}/club_logo/${logoFileId ?? ''}`);
      const abandoned = await t.app.inject({
        url: `/v1/files/${created.file.id}`,
        headers: scA.headers,
      });
      expect(abandoned.json<FileBody>().status).toBe('deleted');

      // A year later: every crest but the one in use is gone too, and club B is untouched.
      await purge(clubA, new Date(Date.now() + 365 * DAY_MS));
      const remaining = (await bucket.keys()).filter((k) => k.startsWith(`clubs/${clubA}/`));
      expect(remaining).toEqual([`clubs/${clubA}/club_logo/${logoFileId ?? ''}`]);
      expect((await bucket.keys()).some((k) => k.startsWith(`clubs/${clubB}/`))).toBe(true);
    });
  });

  describe('without a bucket', () => {
    it('answers 503 and serves the theme without a crest', async () => {
      const bare = await startIdentityApp(database);
      try {
        const response = await bare.app.inject({
          method: 'POST',
          url: '/v1/files',
          headers: adminA.headers,
          payload: videoPayload(consenting),
        });
        expect(response.statusCode).toBe(503);
        const theme = await bare.app.inject({ url: '/v1/clubs/files-a/theme' });
        expect(theme.json<{ logoUrl: string | null }>().logoUrl).toBeNull();
      } finally {
        await bare.close();
      }
    });
  });
});
