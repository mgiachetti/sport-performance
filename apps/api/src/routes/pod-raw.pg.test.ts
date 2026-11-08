/**
 * Ingestion of the pod's log (B-916, ADR 0106, ADR 0108) against Postgres 16
 * and MinIO, through the real connection roles: the dock (S&C or the
 * administration) asks for the upload of a segment with its manifest, puts
 * the committed `pod_raw` sample of `@sport-performance/pod-protocol` in the
 * bucket with the signed URL and confirms it; idempotent by segment; the
 * manifest must be the pod's device; the erase command is signed only once
 * the worker verified the file, with a key generated for the run.
 */
import { createHash, generateKeyPairSync, verify, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { ClubId } from '@sport-performance/domain';
import {
  decodeEraseCommand,
  decodeLog,
  deriveStorageKey,
  encodeEraseCommand,
  fromHex,
  readPodRawFile,
  toHex,
  verifyUploadForErase,
  type PodRawManifest,
} from '@sport-performance/pod-protocol';
import {
  createTestBucket,
  storageTestUrl,
  type TestBucket,
} from '@sport-performance/storage/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFilesModule, type FilesModule } from '../files/module.js';
import { createPodCommandSigner } from '../pods/command-signer.js';
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

const require = createRequire(import.meta.url);
const vectors = JSON.parse(
  readFileSync(
    require.resolve('@sport-performance/pod-protocol/fixtures/v1/log-vectors.json'),
    'utf8',
  ),
) as { keys: { masterKeyHex: string }; podRaw: { manifest: PodRawManifest } };
const sample = readFileSync(
  require.resolve('@sport-performance/pod-protocol/fixtures/v1/pod-raw-sample.bin'),
);
const manifest = vectors.podRaw.manifest;

interface UploadBody {
  id: string;
  podId: string;
  state: string;
  fileId: string;
  bootCounter: number;
  segmentId: number;
  eraseCommandAvailable: boolean;
  pendingUntil: string | null;
  confirmedAt: string | null;
}
interface CreatedBody {
  upload: UploadBody;
  fileUpload: { method: 'PUT'; url: string; headers: Record<string, string> } | null;
}
interface ErrorBody {
  error: { code: string; details?: { path: (string | number)[] }[] };
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

describeWithStorage('pod log ingestion (Postgres + MinIO)', (serverUrl, storageUrl) => {
  let database: TestDatabase;
  let bucket: TestBucket;
  let t: IdentityTestApp;
  let sc: SignedIn;
  let coach: SignedIn;
  let admin: SignedIn;
  let medical: SignedIn;
  let adminB: SignedIn;
  let clubA: ClubId;
  let podId: string;
  let otherPodId: string;
  let publicKey: KeyObject;
  let files: FilesModule;

  const request = (
    caller: SignedIn,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    t.app.inject({
      method,
      url,
      headers: caller.headers,
      ...(payload !== undefined && { payload }),
    });
  const create = (caller: SignedIn, pod: string, body: PodRawManifest) =>
    request(caller, 'POST', `/v1/pods/${pod}/raw-uploads`, { manifest: body });

  async function insertPod(clubId: ClubId, chip: string, serial: string, n: number) {
    const { rows } = await database.admin.query<{ id: string }>(
      `with d as (
         insert into pod_device (serial_number, chip_id, hardware_revision, provisioning_state, owner_club_id)
         values ($1, $2, 'v0', 'provisioned', $3) returning id)
       insert into pod (club_id, device_id, short_id, number) select $3, d.id, $4::int, $4::int from d
       returning id`,
      [serial, chip, clubId, n],
    );
    return rows[0]?.id ?? '';
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
    // A key of this run only: no signing key is ever committed.
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    publicKey = pair.publicKey;
    const generous = { max: 10_000, windowS: 60 };
    t = await startIdentityApp(database, {
      files,
      podCommandSigner: createPodCommandSigner({
        privateKeyPkcs8Base64: pair.privateKey
          .export({ format: 'der', type: 'pkcs8' })
          .toString('base64'),
        keyId: 'test-run',
      }),
      routeClassLimits: {
        auth: { perIp: { name: 'api_auth_ip', ...generous } },
        upload: {
          perIp: { name: 'api_upload_ip', ...generous },
          perUser: { name: 'api_upload_user', ...generous },
        },
      },
    });
    sc = await signIn(t, 'sc@podraw-a.example.com');
    coach = await signIn(t, 'coach@podraw-a.example.com');
    admin = await signIn(t, 'admin@podraw-a.example.com');
    medical = await signIn(t, 'medical@podraw-a.example.com');
    adminB = await signIn(t, 'admin@podraw-b.example.com');
    clubA = await createClub(database.admin, 'podraw-a');
    const clubB = await createClub(database.admin, 'podraw-b');
    await createCategory(database.admin, clubA, 'M19');
    await createMembership(database.admin, sc.userId, clubA, 'sc');
    await createMembership(database.admin, coach.userId, clubA, 'coach');
    await createMembership(database.admin, admin.userId, clubA, 'admin');
    await createMembership(database.admin, medical.userId, clubA, 'medical');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    podId = await insertPod(clubA, manifest.deviceIdHex, manifest.podSerial, 1);
    otherPodId = await insertPod(clubA, '0102030405060708', 'ORC-0002', 2);
  }, 120_000);

  afterAll(async () => {
    await t.close();
    await bucket.drop();
    await database.drop();
  });

  it('only who runs the fleet asks for an upload', async () => {
    for (const caller of [coach, medical, adminB]) {
      const response = await create(caller, podId, manifest);
      expect([403, 404], response.body).toContain(response.statusCode);
    }
  });

  it('the manifest must be of the pod’s device', async () => {
    const response = await create(sc, otherPodId, manifest);
    expect(response.statusCode, response.body).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('validation_failed');
    expect(response.json<ErrorBody>().error.details?.[0]?.path).toEqual([
      'body',
      'manifest',
      'deviceIdHex',
    ]);
    const inconsistent = await create(sc, podId, { ...manifest, sizeB: manifest.sizeB + 1 });
    expect(inconsistent.statusCode).toBe(400);
  });

  let uploadId: string;

  it('uploads the segment to the bucket with the signed URL and confirms it, idempotent by segment', async () => {
    const created = await create(sc, podId, manifest);
    expect(created.statusCode, created.body).toBe(201);
    const { upload, fileUpload } = created.json<CreatedBody>();
    expect(upload).toMatchObject({ podId, state: 'uploading', bootCounter: 70_000, segmentId: 5 });
    if (fileUpload === null) throw new Error('no upload URL');
    uploadId = upload.id;

    // Asked again before uploading: the same upload and a new URL.
    const again = await create(sc, podId, manifest);
    expect(again.statusCode).toBe(201);
    expect(again.headers['x-idempotent-replay']).toBe('true');
    expect(again.json<CreatedBody>().upload.id).toBe(uploadId);
    expect(again.json<CreatedBody>().fileUpload).not.toBeNull();

    // Confirming before the bytes are there.
    const early = await request(sc, 'POST', `/v1/pod-raw-uploads/${uploadId}/confirm`);
    expect(early.statusCode, early.body).toBe(409);

    const put = await fetch(fileUpload.url, {
      method: fileUpload.method,
      headers: fileUpload.headers,
      body: sample,
    });
    expect(put.status).toBe(200);
    const confirmed = await request(sc, 'POST', `/v1/pod-raw-uploads/${uploadId}/confirm`);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const body = confirmed.json<UploadBody>();
    expect(body).toMatchObject({ state: 'pending', eraseCommandAvailable: false });
    expect(
      new Date(body.pendingUntil ?? 0).getTime() - new Date(body.confirmedAt ?? 0).getTime(),
    ).toBe(7 * 24 * 60 * 60 * 1000);
    expect(await bucket.keys()).toContain(`clubs/${clubA}/pod_raw/${body.fileId}`);
    // The file is of no player yet, kept at most the pending days and a day.
    const { rows } = await database.admin.query<{
      status: string;
      player_id: string | null;
      days: number;
    }>(
      `select status, player_id, extract(epoch from expires_at - uploaded_at) / 86400 as days
         from file where id = $1`,
      [body.fileId],
    );
    expect(rows[0]).toMatchObject({ status: 'ready', player_id: null });
    expect(Number(rows[0]?.days)).toBeCloseTo(8, 5);

    // Again after the confirmation: the same upload, nothing to upload.
    const replay = await create(sc, podId, manifest);
    expect(replay.json<CreatedBody>()).toMatchObject({
      upload: { id: uploadId },
      fileUpload: null,
    });
    // Another file for the same segment.
    const other = await create(sc, podId, { ...manifest, sha256Hex: 'f'.repeat(64) });
    expect(other.statusCode).toBe(409);
  });

  it('signs the erase command only once verified, with the server key', async () => {
    const early = await request(sc, 'GET', `/v1/pod-raw-uploads/${uploadId}/erase-command`);
    expect(early.statusCode, early.body).toBe(409);

    // What the worker does: decode with the pod's keys and verify against the manifest.
    const { pages } = readPodRawFile(new Uint8Array(sample), manifest);
    const deviceId = fromHex(manifest.deviceIdHex);
    const masterKey = fromHex(vectors.keys.masterKeyHex);
    const decoded = decodeLog({
      pages,
      deviceId,
      keyForEpoch: (epoch) => deriveStorageKey({ masterKey, deviceId, epoch }),
    });
    const verification = verifyUploadForErase({ manifest, pages, decoded });
    if (!verification.ok) throw new Error(verification.reason);
    await database.admin.query(
      `update pod_raw_upload set state = 'verified', verified_at = now(), erase_command = $2 where id = $1`,
      [uploadId, toHex(encodeEraseCommand(verification.command))],
    );

    for (const caller of [coach, medical]) {
      const denied = await request(caller, 'GET', `/v1/pod-raw-uploads/${uploadId}/erase-command`);
      expect([403, 404]).toContain(denied.statusCode);
    }
    const response = await request(sc, 'GET', `/v1/pod-raw-uploads/${uploadId}/erase-command`);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{
      command: string;
      signature: string;
      algorithm: string;
      keyId: string;
    }>();
    expect(body).toMatchObject({ algorithm: 'ecdsa-p256-sha256', keyId: 'test-run' });
    const command = Buffer.from(body.command, 'base64');
    const signature = Buffer.from(body.signature, 'base64');
    expect(signature).toHaveLength(64);
    expect(
      verify('sha256', command, { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature),
    ).toBe(true);
    expect(decodeEraseCommand(new Uint8Array(command))).toEqual({
      deviceIdHex: manifest.deviceIdHex,
      bootCounter: manifest.bootCounter,
      segmentId: manifest.segmentId,
      firstPageSeq: manifest.firstPageSeq,
      lastPageSeq: manifest.lastPageSeq,
      validPagesN: manifest.validPagesN,
      blocks: manifest.blocks,
      sha256Hex: manifest.sha256Hex,
    });
  });

  it('records every signed command, with who, which key and the bytes', async () => {
    const { rows } = await database.admin.query<{
      command: string;
      key_id: string;
      command_sha256: string;
      created_by: string;
      request_id: string | null;
    }>(
      `select command, key_id, command_sha256, created_by, request_id from pod_command_audit
        where pod_raw_upload_id = $1`,
      [uploadId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ command: 'erase', key_id: 'test-run', created_by: sc.userId });
    const { rows: upload } = await database.admin.query<{ erase_command: string }>(
      'select erase_command from pod_raw_upload where id = $1',
      [uploadId],
    );
    expect(rows[0]?.command_sha256).toBe(
      createHash('sha256')
        .update(Buffer.from(upload[0]?.erase_command ?? '', 'hex'))
        .digest('hex'),
    );
    expect(rows[0]?.request_id).not.toBeNull();
  });

  it('never signs for a rejected upload, and answers 503 without a signing key', async () => {
    const created = await create(sc, podId, {
      ...manifest,
      segmentId: manifest.segmentId + 1,
      sha256Hex: 'e'.repeat(64),
    });
    expect(created.statusCode, created.body).toBe(201);
    const rejected = created.json<CreatedBody>().upload.id;
    await database.admin.query(
      `update pod_raw_upload set state = 'rejected', rejection_reason = 'pages_not_authentic',
              rejected_at = now() where id = $1`,
      [rejected],
    );
    const refused = await request(sc, 'GET', `/v1/pod-raw-uploads/${rejected}/erase-command`);
    expect(refused.statusCode, refused.body).toBe(409);
    // An API without the key: the verified upload stays on the pod.
    const plain = await startIdentityApp(database, {
      files,
      routeClassLimits: { auth: { perIp: { name: 'api_auth_ip', max: 10_000, windowS: 60 } } },
    });
    try {
      const scPlain = await signIn(plain, 'sc@podraw-a.example.com');
      const unavailable = await plain.app.inject({
        method: 'GET',
        url: `/v1/pod-raw-uploads/${uploadId}/erase-command`,
        headers: scPlain.headers,
      });
      expect(unavailable.statusCode, unavailable.body).toBe(503);
    } finally {
      await plain.close();
    }
    await database.admin.query(`delete from pod_raw_upload where id = $1`, [rejected]);
  });

  it('lists and reads the uploads for who runs the fleet', async () => {
    const list = await request(admin, 'GET', `/v1/pod-raw-uploads?podId=${podId}`);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json<{ items: UploadBody[] }>().items.map((u) => u.id)).toEqual([uploadId]);
    const verified = await request(admin, 'GET', '/v1/pod-raw-uploads?state=verified');
    expect(verified.json<{ items: UploadBody[] }>().items).toHaveLength(1);
    const one = await request(sc, 'GET', `/v1/pod-raw-uploads/${uploadId}`);
    expect(one.json<UploadBody>()).toMatchObject({
      state: 'verified',
      eraseCommandAvailable: true,
    });
    expect((await request(coach, 'GET', '/v1/pod-raw-uploads')).statusCode).toBe(403);
    // Nobody reads the file through the generic endpoints.
    const fileId = one.json<UploadBody>().fileId;
    expect((await request(admin, 'GET', `/v1/files/${fileId}/download`)).statusCode).toBe(403);
    expect((await request(admin, 'GET', '/v1/files?kind=pod_raw')).statusCode).toBe(403);
  });

  it('the club sets the pending days: S&C reads them, the administration changes them', async () => {
    const read = await request(sc, 'GET', '/v1/configuration/pods');
    expect(read.statusCode, read.body).toBe(200);
    const settings = read.json<{ rawPendingDays: number; version: string }>();
    expect(settings.rawPendingDays).toBe(7);
    const denied = await request(sc, 'PATCH', '/v1/configuration/pods', {
      version: settings.version,
      rawPendingDays: 3,
    });
    expect(denied.statusCode).toBe(403);
    expect(
      (
        await request(admin, 'PATCH', '/v1/configuration/pods', {
          version: settings.version,
          rawPendingDays: 0,
        })
      ).statusCode,
    ).toBe(400);
    const changed = await request(admin, 'PATCH', '/v1/configuration/pods', {
      version: settings.version,
      rawPendingDays: 3,
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json<{ rawPendingDays: number }>().rawPendingDays).toBe(3);
    const stale = await request(admin, 'PATCH', '/v1/configuration/pods', {
      version: settings.version,
      rawPendingDays: 4,
    });
    expect(stale.statusCode).toBe(409);
  });
});
