/**
 * Test protocols and their images and videos (B-415, ADR 0067) against
 * Postgres 16 and a real S3-compatible bucket (MinIO, `STORAGE_TEST_URL`),
 * through the real connection roles: the protocol text for every member, the
 * media for the staff only, attached by `sc` and the administration, kept
 * while a protocol shows it and never purged while in use.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createDatabase, provisionLoginRole } from '@sport-performance/db';
import type { ClubId } from '@sport-performance/domain';
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

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

interface DefinitionBody {
  id: string;
  code: string;
  version: number;
  sports: string[] | null;
  attemptCount: number;
  attemptAggregation: string;
  protocol: {
    summary: string | null;
    steps: string[];
    restBetweenAttemptsS: number | null;
    equipment: string[];
    parameters: Record<string, unknown>;
  };
  metrics: { code: string; unit: string; isDerived: boolean }[];
  validFrom: string;
  validTo: string | null;
}

interface FileBody {
  id: string;
  kind: string;
  status: string;
  expiresAt: string | null;
}

interface MediaBody {
  id: string;
  testDefinitionId: string;
  file: FileBody;
  caption: string;
  sortOrder: number;
  archivedAt: string | null;
  version: string;
}

interface Envelope {
  error: { code: string; details?: { path: (string | number)[] }[] };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SUPPORT_REASON = encodeURIComponent('Alta del club para los tests de B-415');

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('base64');
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

describeWithStorage('test protocols (Postgres + MinIO)', (serverUrl, storageUrl) => {
  let database: TestDatabase;
  let bucket: TestBucket;
  let files: FilesModule;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let scA: SignedIn;
  let coachA: SignedIn;
  let medicalA: SignedIn;
  let playerA: SignedIn;
  let parentA: SignedIn;
  let adminB: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  const definitions: Record<string, string> = {};

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });

  async function createClub(slug: string, branches: { sport: string; sex: string }[]) {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: registry(),
      payload: { slug, name: `Club ${slug}`, shortName: slug.toUpperCase(), branches },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ club: { id: ClubId } }>().club.id;
  }

  async function get<T>(caller: SignedIn, url: string, status = 200): Promise<T> {
    const response = await t.app.inject({ url, headers: caller.headers });
    expect(response.statusCode, response.body).toBe(status);
    return response.json<T>();
  }

  function post(caller: SignedIn, url: string, payload?: Record<string, unknown>) {
    return t.app.inject({
      method: 'POST',
      url,
      headers: caller.headers,
      ...(payload !== undefined && { payload }),
    });
  }

  async function uploadMedia(
    caller: SignedIn,
    body: Buffer,
    contentType = 'image/png',
  ): Promise<FileBody> {
    const created = await post(caller, '/v1/files', {
      kind: 'protocol_media',
      contentType,
      sizeBytes: body.length,
      checksumSha256: sha256(body),
      fileName: 'salida.png',
    });
    expect(created.statusCode, created.body).toBe(201);
    const { file, upload } = created.json<{
      file: FileBody;
      upload: { method: string; url: string; headers: Record<string, string> } | null;
    }>();
    if (upload === null) throw new Error('no upload URL');
    const put = await fetch(upload.url, { method: upload.method, headers: upload.headers, body });
    expect(put.status).toBe(200);
    const confirmed = await post(caller, `/v1/files/${file.id}/confirm`);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    return confirmed.json<FileBody>();
  }

  const mediaUrl = (code: string, suffix = '') =>
    `/v1/test-definitions/${definitions[code] ?? 'missing'}/media${suffix}`;

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
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    adminA = await signIn(t, 'admin@protocols-a.example.com');
    scA = await signIn(t, 'sc@protocols-a.example.com');
    coachA = await signIn(t, 'coach@protocols-a.example.com');
    medicalA = await signIn(t, 'medical@protocols-a.example.com');
    playerA = await signIn(t, 'player@protocols-a.example.com');
    parentA = await signIn(t, 'parent@protocols-a.example.com');
    adminB = await signIn(t, 'admin@protocols-b.example.com');

    clubA = await createClub('protocols-a', [
      { sport: 'rugby', sex: 'male' },
      { sport: 'hockey', sex: 'female' },
    ]);
    clubB = await createClub('protocols-b', [{ sport: 'rugby', sex: 'male' }]);
    const defs = await database.admin.query<{ id: string; code: string }>(
      `select id, code from test_definition where club_id = $1`,
      [clubA],
    );
    for (const row of defs.rows) definitions[row.code] = row.id;
    const defsB = await database.admin.query<{ id: string }>(
      `select id from test_definition where club_id = $1 and code = 'cmj'`,
      [clubB],
    );
    definitions.cmjOfB = defsB.rows[0]?.id ?? '';

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, scA.userId, clubA, 'sc');
    await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await createMembership(database.admin, medicalA.userId, clubA, 'medical');
    await createMembership(database.admin, playerA.userId, clubA, 'player');
    await createMembership(database.admin, parentA.userId, clubA, 'parent');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
  }, 120_000);

  afterAll(async () => {
    await t.close();
    await bucket.drop();
    await database.drop();
  });

  describe('protocols', () => {
    it('lists the versions in force for every member, with the protocol and its metrics', async () => {
      for (const caller of [playerA, parentA, coachA]) {
        const page = await get<Page<DefinitionBody>>(caller, '/v1/test-definitions?limit=100');
        expect(page.items.map((d) => d.code)).toEqual([...page.items.map((d) => d.code)].sort());
        expect(page.items.map((d) => d.code)).toContain('sprint_40');
      }
      const page = await get<Page<DefinitionBody>>(coachA, '/v1/test-definitions?code=sprint_40');
      const [sprint] = page.items;
      expect(sprint).toMatchObject({
        code: 'sprint_40',
        version: 1,
        sports: null,
        attemptCount: 3,
        attemptAggregation: 'best',
        validTo: null,
      });
      expect(sprint?.protocol.steps.length).toBeGreaterThan(3);
      expect(sprint?.protocol.restBetweenAttemptsS).toBe(180);
      expect(sprint?.protocol.equipment).toContain('conos');
      expect(sprint?.protocol.parameters).toMatchObject({ vmaxFromM: 20, vmaxToM: 40 });
      expect(sprint?.metrics).toContainEqual({
        code: 'sprint_vmax_ms',
        unit: 'ms',
        isDerived: true,
      });
      expect(sprint?.metrics.find((m) => m.code === 'sprint_40_s')?.isDerived).toBe(false);
    });

    it('filters by sport (tests of every sport included) and by day', async () => {
      const hockey = await get<Page<DefinitionBody>>(
        coachA,
        '/v1/test-definitions?sport=hockey&limit=100',
      );
      const codes = hockey.items.map((d) => d.code);
      expect(codes).toContain('cmj');
      expect(codes).not.toContain('bronco');
      const rugby = await get<Page<DefinitionBody>>(
        coachA,
        '/v1/test-definitions?sport=rugby&limit=100',
      );
      expect(rugby.items.map((d) => d.code)).toContain('bronco');
      const before = await get<Page<DefinitionBody>>(
        coachA,
        '/v1/test-definitions?validOn=1990-01-01',
      );
      expect(before.items).toEqual([]);
    });

    it('pages by cursor', async () => {
      const first = await get<Page<DefinitionBody>>(coachA, '/v1/test-definitions?limit=4');
      expect(first.items).toHaveLength(4);
      expect(first.nextCursor).not.toBeNull();
      const second = await get<Page<DefinitionBody>>(
        coachA,
        `/v1/test-definitions?limit=4&cursor=${first.nextCursor ?? ''}`,
      );
      expect((second.items[0]?.code ?? '') > (first.items[3]?.code ?? '')).toBe(true);
      const wrong = await t.app.inject({
        url: `/v1/test-definitions?limit=4&sport=rugby&cursor=${first.nextCursor ?? ''}`,
        headers: coachA.headers,
      });
      expect(wrong.statusCode).toBe(400);
    });

    it('reads one version; never another club’s', async () => {
      const cmj = await get<DefinitionBody>(
        playerA,
        `/v1/test-definitions/${definitions.cmj ?? ''}`,
      );
      expect(cmj.code).toBe('cmj');
      expect(cmj.protocol.summary).toContain('h = g·t²/8');
      await get(coachA, `/v1/test-definitions/${definitions.cmjOfB ?? ''}`, 404);
      await get(coachA, `/v1/test-definitions/${randomUUID()}`, 404);
    });
  });

  describe('media', () => {
    const image = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      randomBytes(64),
    ]);
    let mediaFile: FileBody;
    let media: MediaBody;
    const clientUuid = randomUUID();

    it('is uploaded by sc and the administration only', async () => {
      const denied = await post(coachA, '/v1/files', {
        kind: 'protocol_media',
        contentType: 'image/png',
        sizeBytes: image.length,
        checksumSha256: sha256(image),
      });
      expect(denied.statusCode).toBe(403);
      const svg = await post(scA, '/v1/files', {
        kind: 'protocol_media',
        contentType: 'image/svg+xml',
        sizeBytes: image.length,
        checksumSha256: sha256(image),
      });
      expect(svg.statusCode).toBe(400);
      mediaFile = await uploadMedia(scA, image);
      expect(mediaFile).toMatchObject({ kind: 'protocol_media', status: 'ready' });
      // Not in use yet: it expires like an unused crest.
      expect(mediaFile.expiresAt).not.toBeNull();
    });

    it('is attached to a protocol version and kept while it shows there', async () => {
      const response = await post(scA, mediaUrl('cmj'), {
        clientUuid,
        fileId: mediaFile.id,
        caption: '  Manos en la cintura durante todo el salto  ',
      });
      expect(response.statusCode, response.body).toBe(201);
      media = response.json<MediaBody>();
      expect(media).toMatchObject({
        testDefinitionId: definitions.cmj,
        caption: 'Manos en la cintura durante todo el salto',
        sortOrder: 0,
        archivedAt: null,
        file: { id: mediaFile.id, expiresAt: null },
      });
      const replay = await post(scA, mediaUrl('cmj'), {
        clientUuid,
        fileId: mediaFile.id,
        caption: 'Manos en la cintura durante todo el salto',
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<MediaBody>().id).toBe(media.id);
      // Once per version; another version or test may show the same clip.
      const twice = await post(scA, mediaUrl('cmj'), { fileId: mediaFile.id, caption: 'Otra vez' });
      expect(twice.statusCode).toBe(409);
      const elsewhere = await post(adminA, mediaUrl('sprint_40'), {
        fileId: mediaFile.id,
        caption: 'La misma imagen en el sprint',
      });
      expect(elsewhere.statusCode, elsewhere.body).toBe(201);
    });

    it('refuses what is not a ready protocol_media file of the club', async () => {
      const notAFile = await post(scA, mediaUrl('cmj'), { fileId: randomUUID(), caption: 'X' });
      expect(notAFile.statusCode).toBe(400);
      expect(errorOf(notAFile).details?.[0]?.path).toEqual(['body', 'fileId']);
      const pending = await post(scA, '/v1/files', {
        kind: 'protocol_media',
        contentType: 'video/mp4',
        sizeBytes: 10,
        checksumSha256: sha256(Buffer.alloc(10)),
      });
      const pendingId = pending.json<{ file: FileBody }>().file.id;
      expect(
        (await post(scA, mediaUrl('cmj'), { fileId: pendingId, caption: 'Pendiente' })).statusCode,
      ).toBe(400);
      const otherClub = await post(adminB, `/v1/test-definitions/${definitions.cmj ?? ''}/media`, {
        fileId: mediaFile.id,
        caption: 'Ajeno',
      });
      expect(otherClub.statusCode).toBe(404);
      const coach = await post(coachA, mediaUrl('cmj'), { fileId: mediaFile.id, caption: 'X' });
      expect(coach.statusCode).toBe(403);
    });

    it('is seen by the staff only, in the order of the protocol', async () => {
      for (const caller of [coachA, medicalA, scA, adminA]) {
        const page = await get<Page<MediaBody>>(caller, mediaUrl('cmj'));
        expect(page.items.map((m) => m.id)).toEqual([media.id]);
        const download = await get<{ url: string }>(caller, `/v1/files/${mediaFile.id}/download`);
        expect((await fetch(download.url)).status).toBe(200);
      }
      for (const caller of [playerA, parentA]) {
        await get(caller, mediaUrl('cmj'), 403);
        const listed = await t.app.inject({
          url: '/v1/files?kind=protocol_media',
          headers: caller.headers,
        });
        expect(listed.statusCode === 403 || listed.json<Page<FileBody>>().items.length === 0).toBe(
          true,
        );
        const download = await t.app.inject({
          url: `/v1/files/${mediaFile.id}/download`,
          headers: caller.headers,
        });
        expect([403, 404]).toContain(download.statusCode);
      }
    });

    it('edits the caption and the order at the current version', async () => {
      const stale = await t.app.inject({
        method: 'PATCH',
        url: mediaUrl('cmj', `/${media.id}`),
        headers: scA.headers,
        payload: { version: '1', caption: 'Vieja' },
      });
      expect(stale.statusCode).toBe(409);
      const response = await t.app.inject({
        method: 'PATCH',
        url: mediaUrl('cmj', `/${media.id}`),
        headers: scA.headers,
        payload: { version: media.version, caption: 'Caída con piernas extendidas', sortOrder: 2 },
      });
      expect(response.statusCode, response.body).toBe(200);
      media = response.json<MediaBody>();
      expect(media).toMatchObject({ caption: 'Caída con piernas extendidas', sortOrder: 2 });
      const coach = await t.app.inject({
        method: 'PATCH',
        url: mediaUrl('cmj', `/${media.id}`),
        headers: coachA.headers,
        payload: { version: media.version, caption: 'No' },
      });
      expect(coach.statusCode).toBe(403);
    });

    it('cannot be deleted while a protocol shows it', async () => {
      const response = await t.app.inject({
        method: 'DELETE',
        url: `/v1/files/${mediaFile.id}`,
        headers: scA.headers,
      });
      expect(response.statusCode).toBe(409);
    });

    describe('archive, restore and retention', () => {
      let worker: { login: string; pool: pg.Pool };

      beforeAll(async () => {
        const login = `sp_test_protocols_worker_${randomBytes(4).toString('hex')}`;
        const password = randomBytes(24).toString('hex');
        await provisionLoginRole({ connectionString: serverUrl, login, password, role: 'worker' });
        const url = new URL(database.appUrl);
        url.username = login;
        url.password = password;
        worker = { login, pool: new pg.Pool({ connectionString: url.toString(), max: 1 }) };
      });

      afterAll(async () => {
        await worker.pool.end();
        const client = new pg.Client({ connectionString: serverUrl });
        await client.connect();
        await client.query(`drop role if exists "${worker.login}"`);
        await client.end();
      });

      async function purge(now: Date) {
        const client = await worker.pool.connect();
        try {
          await client.query('begin');
          await client.query(`select set_config('app.club_id', $1, true)`, [clubA]);
          const report = await purgeExpiredFiles(createDatabase(client), files.storage, { now });
          await client.query('commit');
          return report;
        } catch (error) {
          await client.query('rollback');
          throw error;
        } finally {
          client.release();
        }
      }

      async function sprintMedia(): Promise<MediaBody> {
        const page = await get<Page<MediaBody>>(scA, mediaUrl('sprint_40'));
        const found = page.items[0];
        if (found === undefined) throw new Error('no sprint media');
        return found;
      }

      it('stays in use while another protocol still shows it', async () => {
        const archived = await post(scA, mediaUrl('cmj', `/${media.id}/archive`));
        expect(archived.statusCode, archived.body).toBe(200);
        expect(archived.json<MediaBody>().archivedAt).not.toBeNull();
        expect(archived.json<MediaBody>().file.expiresAt).toBeNull();
        expect((await get<Page<MediaBody>>(coachA, mediaUrl('cmj'))).items).toEqual([]);
        expect(
          (await get<Page<MediaBody>>(coachA, mediaUrl('cmj', '?status=archived'))).items,
        ).toHaveLength(1);
        const again = await post(scA, mediaUrl('cmj', `/${media.id}/archive`));
        expect(again.statusCode).toBe(200);
        const editArchived = await t.app.inject({
          method: 'PATCH',
          url: mediaUrl('cmj', `/${media.id}`),
          headers: scA.headers,
          payload: { version: archived.json<MediaBody>().version, caption: 'No' },
        });
        expect(editArchived.statusCode).toBe(409);
      });

      it('expires 30 days after the last protocol lets go, and is purged only then', async () => {
        const sprint = await sprintMedia();
        const before = Date.now();
        const archived = await post(scA, mediaUrl('sprint_40', `/${sprint.id}/archive`));
        expect(archived.statusCode, archived.body).toBe(200);
        const expiresAt = Date.parse(archived.json<MediaBody>().file.expiresAt ?? '');
        expect(expiresAt).toBeGreaterThanOrEqual(before + 30 * DAY_MS - 1000);
        expect(expiresAt).toBeLessThanOrEqual(Date.now() + 30 * DAY_MS + 1000);

        // Restored before it expires: in use again, never expires.
        const restored = await post(scA, mediaUrl('cmj', `/${media.id}/restore`));
        expect(restored.statusCode, restored.body).toBe(200);
        expect(restored.json<MediaBody>()).toMatchObject({
          archivedAt: null,
          file: { expiresAt: null },
        });
        // Even with a stale expiry, the job never purges a file a protocol shows.
        await database.admin.query(
          `update file set expires_at = now() - interval '1 day' where id = $1`,
          [mediaFile.id],
        );
        await purge(new Date(Date.now() + 60 * DAY_MS));
        expect(await bucket.keys()).toContain(`clubs/${clubA}/protocol_media/${mediaFile.id}`);

        const archivedAgain = await post(scA, mediaUrl('cmj', `/${media.id}/archive`));
        expect(archivedAgain.statusCode).toBe(200);
        await purge(new Date(Date.now() + 31 * DAY_MS));
        expect(await bucket.keys()).not.toContain(`clubs/${clubA}/protocol_media/${mediaFile.id}`);
        const gone = await post(scA, mediaUrl('cmj', `/${media.id}/restore`));
        expect(gone.statusCode).toBe(409);
      });
    });
  });
});
