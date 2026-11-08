/**
 * Ingestion of the pod's log through the worker's login (B-916, ADR 0106,
 * ADR 0108), against Postgres 16 and MinIO, with recordings written by the
 * protocol's reference encoder under the test master key: verification with
 * the keys (and the erase command it leaves), rejection of a tampered file,
 * no key (kept pending), waiting for the session to end, the one-time trim
 * to session × assignment × consent per instant (1 Hz traces and a trimmed
 * `pod_raw` per player, the original deleted), idempotency, a correction
 * after the trim, the retention of the traces and the erasure when the
 * location consent is revoked.
 */
import { createHash } from 'node:crypto';
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import { parseClubId, type ClubId } from '@sport-performance/domain';
import {
  decodeEraseCommand,
  decodeLog,
  deriveStorageKey,
  fromHex,
  readPodRawFile,
  type PodRawManifest,
} from '@sport-performance/pod-protocol';
import { createS3Storage, type ObjectStorage } from '@sport-performance/storage';
import {
  createTestBucket,
  storageTestUrl,
  type TestBucket,
} from '@sport-performance/storage/testing';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runClubLocationErasures } from '../location-erasure.js';
import { TEST_MASTER_KEY, TEST_MASTER_KEY_BASE64, podRecording } from '../testing/pod-recording.js';
import { listPodRawClubs, runClubPodRawIngest } from './ingest.js';
import { staticPodKeyProvider } from './keys.js';

const serverUrl = process.env.DATABASE_URL;
const hasDatabase = serverUrl !== undefined && serverUrl.trim() !== '';
const hasBucket = storageTestUrl !== undefined && storageTestUrl !== '';
if ((!hasDatabase || !hasBucket) && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL and STORAGE_TEST_URL are required in CI for the pod ingestion.');
}

const logger = pino({ level: 'silent' });
const MIN = 60_000;
/** The session: 21:00 UTC for 10 minutes. */
const T0 = Date.parse('2026-11-04T21:00:00Z');
const OTHER_CHIP = '0102030405060708';

describe.skipIf(!hasDatabase || !hasBucket)('pod log ingestion (Postgres 16 + MinIO)', () => {
  let temporary: TemporaryDatabase;
  let owner: pg.Pool;
  let worker: pg.Pool;
  let bucket: TestBucket;
  let storage: ObjectStorage;
  let clubA: ClubId;
  let clubB: ClubId;
  let podA: string;
  let podB: string;
  let session: string;
  /** Data and location from before the session; worn 20:55–21:05. */
  let early: string;
  /** Location signed at 21:07; worn 21:05–21:15. */
  let late: string;
  /** Data only, no location: never data, even worn. */
  let noLocation: string;
  let assignmentEarly: string;
  /** The user who signs the consents (the players themselves, adults). */
  let signer: string;
  let originalPages = 0;

  const keys = () => staticPodKeyProvider(new Map([[clubA, TEST_MASTER_KEY_BASE64]]));
  const run = (clubId: ClubId, now: number) =>
    runClubPodRawIngest(
      { pool: worker, storage, keys: keys(), logger, now: () => new Date(now) },
      clubId,
    );

  async function insertPlayer(clubId: ClubId, category: string, name: string): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Pérez', '2007-03-01', 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, name],
    );
    const id = rows[0]?.id ?? '';
    await owner.query(
      `insert into player_category (club_id, player_id, category_id, valid_from) values ($1, $2, $3, '2020-01-01')`,
      [clubId, id, category],
    );
    return id;
  }

  async function sign(clubId: ClubId, playerId: string, type: 'data' | 'location', at: number) {
    await owner.query(
      `insert into consent (club_id, player_id, type, document_id, document_version, signer_kind,
                            signed_by, signed_at)
       select $1, $2, $3::consent_type, d.id, d.version, 'player', $5, $4
         from consent_document d where d.club_id = $1 and d.type = $3::consent_type
        order by d.published_at desc limit 1`,
      [clubId, playerId, type, new Date(at), signer],
    );
  }

  async function insertPod(clubId: ClubId, chip: string, serial: string): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      `with d as (
         insert into pod_device (serial_number, chip_id, hardware_revision, provisioning_state, owner_club_id)
         values ($1, $2, 'v0', 'provisioned', $3) returning id)
       insert into pod (club_id, device_id, short_id, number) select $3, d.id, 1, 1 from d returning id`,
      [serial, chip, clubId],
    );
    return rows[0]?.id ?? '';
  }

  async function assign(clubId: ClubId, pod: string, player: string, from: number, to: number) {
    const { rows } = await owner.query<{ id: string }>(
      `insert into pod_assignment (club_id, pod_id, player_id, starts_at, ends_at)
       values ($1, $2, $3, $4, $5) returning id`,
      [clubId, pod, player, new Date(from), new Date(to)],
    );
    return rows[0]?.id ?? '';
  }

  /** What the API leaves after the dock's upload and confirmation: a pending upload in the bucket. */
  async function confirmedUpload(
    clubId: ClubId,
    pod: string,
    file: { bytes: Uint8Array; manifest: PodRawManifest },
    confirmedAt: number,
  ): Promise<{ uploadId: string; fileId: string }> {
    const checksum = createHash('sha256').update(file.bytes).digest('base64');
    const { rows: files } = await owner.query<{ id: string }>(
      `insert into file (club_id, kind, status, content_type, size_bytes, checksum_sha256, uploaded_at, expires_at)
       values ($1, 'pod_raw', 'ready', 'application/octet-stream', $2, $3, $4, $4 + interval '8 days')
       returning id`,
      [clubId, file.bytes.length, checksum, new Date(confirmedAt)],
    );
    const fileId = files[0]?.id ?? '';
    await storage.put({
      key: `clubs/${clubId}/pod_raw/${fileId}`,
      body: file.bytes,
      contentType: 'application/octet-stream',
      checksumSha256: checksum,
    });
    const m = file.manifest;
    const { rows } = await owner.query<{ id: string }>(
      `insert into pod_raw_upload (club_id, pod_id, device_id, ingest_key, chip_id, pod_serial, boot_counter,
         segment_id, first_page_seq, last_page_seq, pages_n, valid_pages_n, blocks, key_epochs,
         segment_closed, declared_start_at, declared_end_at, size_bytes, sha256_hex, file_id, state,
         confirmed_at, pending_until)
       select $1, p.id, p.device_id, $3::text || '/' || $4::text || '/' || $5::text, $3::text, $6, $4::bigint, $5::bigint, $7, $8, $9, $10, $11, $12,
              $13, $14, $15, $16, $17, $18, 'pending', $19, $19 + interval '7 days'
         from pod p where p.club_id = $1 and p.id = $2
       returning id`,
      [
        clubId,
        pod,
        m.deviceIdHex,
        m.bootCounter,
        m.segmentId,
        m.podSerial,
        m.firstPageSeq,
        m.lastPageSeq,
        m.pagesN,
        m.validPagesN,
        m.blocks,
        m.keyEpochs,
        m.closed,
        m.startUnixMs === null ? null : new Date(m.startUnixMs),
        m.endUnixMs === null ? null : new Date(m.endUnixMs),
        m.sizeB,
        m.sha256Hex,
        fileId,
        new Date(confirmedAt),
      ],
    );
    return { uploadId: rows[0]?.id ?? '', fileId };
  }

  async function uploadOf(id: string) {
    const { rows } = await owner.query<{
      state: string;
      rejection_reason: string | null;
      erase_command: string | null;
      issues: { code: string; count?: number }[];
      trimmed_players_n: number | null;
      trimmed_samples_n: number | null;
      recorded_from: Date | null;
      firmware_version: string | null;
    }>('select * from pod_raw_upload where id = $1', [id]);
    const row = rows[0];
    if (row === undefined) throw new Error('no upload');
    return row;
  }

  beforeAll(async () => {
    if (serverUrl === undefined || storageTestUrl === undefined) return;
    temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_worker_pod_raw' });
    owner = temporary.pool({ max: 3 });
    const login = await temporary.login('worker');
    worker = temporary.pool({ connectionString: login.connectionString, max: 3 });
    bucket = await createTestBucket(storageTestUrl);
    storage = createS3Storage(bucket.config);
    const club = async (slug: string) =>
      parseClubId(
        (
          await owner.query<{ id: string }>(
            `insert into club (slug, name, short_name) values ($1, $1, upper($1)) returning id`,
            [slug],
          )
        ).rows[0]?.id,
      );
    clubA = await club('podraw-a');
    clubB = await club('podraw-b');
    const category = async (clubId: ClubId) => {
      await owner.query(
        `insert into club_branch (club_id, sport, sex) values ($1, 'rugby', 'male')`,
        [clubId],
      );
      const { rows } = await owner.query<{ id: string }>(
        `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
         values ($1, 'rugby', 'male', 'm19', 'M19', 'performance') returning id`,
        [clubId],
      );
      return rows[0]?.id ?? '';
    };
    const m19 = await category(clubA);
    await category(clubB);
    for (const [clubId] of [[clubA], [clubB]] as const) {
      for (const type of ['data', 'location']) {
        await owner.query(
          `insert into consent_document (club_id, type, version, locale, title, body, published_at)
           values ($1, $2::consent_type, '2026-01', 'es-AR', 'Texto', 'Texto', '2026-01-01T00:00:00Z')`,
          [clubId, type],
        );
      }
    }
    signer =
      (
        await owner.query<{ id: string }>(
          `insert into "user" (id, name, email) values ('signer-podraw', 'Firma', 'firma@podraw.example.com')
         returning id`,
        )
      ).rows[0]?.id ?? '';
    early = await insertPlayer(clubA, m19, 'Temprano');
    late = await insertPlayer(clubA, m19, 'Tarde');
    noLocation = await insertPlayer(clubA, m19, 'Sin');
    for (const p of [early, late, noLocation]) await sign(clubA, p, 'data', T0 - 60 * MIN);
    await sign(clubA, early, 'location', T0 - 60 * MIN);
    await sign(clubA, late, 'location', T0 + 7 * MIN);
    const { rows } = await owner.query<{ id: string }>(
      `insert into training_session (club_id, sport, kind, category_id, starts_at, local_date, planned_duration_min)
       values ($1, 'rugby', 'training', $2, $3, '2026-11-04', 10) returning id`,
      [clubA, m19, new Date(T0)],
    );
    session = rows[0]?.id ?? '';
    podA = await insertPod(clubA, '8a1f3c5e7d902b46', 'ORC-0001');
    podB = await insertPod(clubB, OTHER_CHIP, 'ORC-0002');
    assignmentEarly = await assign(clubA, podA, early, T0 - 5 * MIN, T0 + 5 * MIN);
    await assign(clubA, podA, late, T0 + 5 * MIN, T0 + 15 * MIN);
  }, 120_000);

  afterAll(async () => {
    await worker.end();
    await owner.end();
    await bucket.drop();
    await temporary.drop();
  });

  let uploadId: string;
  let originalFile: string;

  it('verifies a confirmed upload with the keys, and waits for the session to end', async () => {
    // 20:58 → 21:12: two minutes before the session, two after its end.
    const recording = podRecording({ startUnixMs: T0 - 2 * MIN, durationS: 14 * 60 });
    originalPages = recording.manifest.pagesN;
    ({ uploadId, fileId: originalFile } = await confirmedUpload(
      clubA,
      podA,
      recording,
      T0 + 13 * MIN,
    ));
    expect(await listPodRawClubs(worker)).toContain(clubA);
    // During the session's last minute: verified, not trimmed.
    const report = await run(clubA, T0 + 9 * MIN);
    expect(report).toMatchObject({ verified: 1, rejected: 0, trimmed: 0 });
    const upload = await uploadOf(uploadId);
    expect(upload).toMatchObject({ state: 'verified', firmware_version: '0.3.1' });
    expect(upload.recorded_from?.getTime()).toBe(T0 - 2 * MIN);
    expect(upload.issues).toEqual([]);
    // The erase command names exactly the uploaded segment and file.
    const command = decodeEraseCommand(fromHex(upload.erase_command ?? ''));
    expect(command).toEqual({
      deviceIdHex: recording.manifest.deviceIdHex,
      bootCounter: recording.manifest.bootCounter,
      segmentId: recording.manifest.segmentId,
      firstPageSeq: recording.manifest.firstPageSeq,
      lastPageSeq: recording.manifest.lastPageSeq,
      validPagesN: recording.manifest.validPagesN,
      blocks: recording.manifest.blocks,
      sha256Hex: recording.manifest.sha256Hex,
    });
  });

  it('trims once to session × assignment × consent per instant, at 1 Hz, and deletes the rest', async () => {
    const report = await run(clubA, T0 + 20 * MIN);
    expect(report).toMatchObject({ verified: 0, trimmed: 1 });
    const upload = await uploadOf(uploadId);
    expect(upload).toMatchObject({ state: 'trimmed', trimmed_players_n: 2 });
    const { rows: traces } = await owner.query<{
      player_id: string;
      training_session_id: string;
      starts_at: Date;
      ends_at: Date;
      samples_n: number;
      method_variant: string;
      algorithm_version: string;
      firmware_version: string | null;
      gnss_firmware_version: string | null;
      time_low_confidence: boolean;
      raw_file_id: string | null;
      offsets_ms: number[];
    }>(
      `select player_id, training_session_id, starts_at, ends_at, samples_n, method_variant::text,
              algorithm_version, firmware_version, gnss_firmware_version, time_low_confidence,
              raw_file_id, offsets_ms
         from pod_trace_segment where pod_raw_upload_id = $1 order by starts_at`,
      [uploadId],
    );
    // Early: 21:00–21:05 (session start to the end of their assignment). Late: 21:07 (their
    // location consent) to 21:10 (the session's end). The player without location: nothing.
    expect(
      traces.map((t) => [t.player_id, t.starts_at.getTime(), t.ends_at.getTime(), t.samples_n]),
    ).toEqual([
      [early, T0, T0 + 5 * MIN, 300],
      [late, T0 + 7 * MIN, T0 + 10 * MIN, 180],
    ]);
    expect(traces.every((t) => t.training_session_id === session)).toBe(true);
    expect(traces[0]).toMatchObject({
      method_variant: 'pod_log',
      algorithm_version: 'pod-log-trace/1',
      firmware_version: '0.3.1',
      gnss_firmware_version: 'LC29HAANR11A03S',
      time_low_confidence: false,
    });
    expect(traces[0]?.offsets_ms.slice(0, 3)).toEqual([0, 1000, 2000]);
    expect(upload.trimmed_samples_n).toBe(480);
    expect(traces.some((t) => t.player_id === noLocation)).toBe(false);

    // One trimmed pod_raw per player, with only the pages of their windows; the original goes.
    const { rows: files } = await owner.query<{
      id: string;
      player_id: string | null;
      status: string;
      size_bytes: string;
    }>(
      `select id, player_id, status::text, size_bytes from file where club_id = $1 and kind = 'pod_raw'
        order by created_at, id`,
      [clubA],
    );
    expect(files.find((f) => f.id === originalFile)?.status).toBe('deleted');
    const trimmed = files.filter((f) => f.player_id !== null);
    expect(trimmed.map((f) => f.player_id).sort()).toEqual([early, late].sort());
    expect(trimmed.every((f) => f.status === 'ready')).toBe(true);
    for (const file of trimmed) {
      expect(traces.find((t) => t.player_id === file.player_id)?.raw_file_id).toBe(file.id);
      const bytes = await storage.get(`clubs/${clubA}/pod_raw/${file.id}`, Number(file.size_bytes));
      if (bytes === null) throw new Error('no trimmed object');
      // Still the pod's pages as they were: they open with the same keys.
      const { pages } = readPodRawFile(bytes);
      const deviceId = fromHex('8a1f3c5e7d902b46');
      const decoded = decodeLog({
        pages,
        deviceId,
        keyForEpoch: (epoch) => deriveStorageKey({ masterKey: TEST_MASTER_KEY, deviceId, epoch }),
      });
      expect(decoded.pageIssues).toEqual([]);
      const pvt = decoded.segments[0]?.streams.pvt ?? [];
      expect(pvt.length).toBeGreaterThan(0);
      // Only the pages of their windows (5 and 3 of the 14 minutes, and the page at each edge).
      expect(pages.length).toBeLessThan(originalPages / 2);
    }
  });

  it('a second run changes nothing', async () => {
    expect(await run(clubA, T0 + 21 * MIN)).toMatchObject({ verified: 0, trimmed: 0, rejected: 0 });
    const { rows } = await owner.query<{ n: number }>(
      'select count(*)::int as n from pod_trace_segment where pod_raw_upload_id = $1',
      [uploadId],
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('a correction after the trim is reported, never moved, and the flag cleared', async () => {
    await owner.query(`update pod_assignment set reprocess_requested_at = now() where id = $1`, [
      assignmentEarly,
    ]);
    expect(await run(clubA, T0 + 22 * MIN)).toMatchObject({ reprocessed: 1 });
    expect((await uploadOf(uploadId)).issues.map((i) => i.code)).toContain(
      'assignment_corrected_after_trim',
    );
    const { rows } = await owner.query<{ flag: Date | null }>(
      'select reprocess_requested_at as flag from pod_assignment where id = $1',
      [assignmentEarly],
    );
    expect(rows[0]?.flag).toBeNull();
  });

  it('rejects a file whose pages do not pass the CMAC, and deletes it', async () => {
    const recording = podRecording({
      startUnixMs: T0 + 60 * MIN,
      durationS: 30,
      segmentId: 6,
      firstPageSeq: 9000,
      firstBlock: 20,
    });
    // Flip a byte of a page's ciphertext and fix its CRC: only the MAC can tell.
    const bytes = recording.bytes.slice();
    const at = 64 + 8 + 100;
    bytes[at] = (bytes[at] ?? 0) ^ 0xff;
    const { crc32 } = await import('@sport-performance/pod-protocol');
    const page = bytes.subarray(64 + 8, 64 + 8 + 2048);
    const crc = crc32(page.subarray(0, 2044));
    page[2044] = crc & 0xff;
    page[2045] = (crc >>> 8) & 0xff;
    page[2046] = (crc >>> 16) & 0xff;
    page[2047] = (crc >>> 24) & 0xff;
    const sha256Hex = createHash('sha256').update(bytes).digest('hex');
    const { uploadId: bad, fileId } = await confirmedUpload(
      clubA,
      podA,
      { bytes, manifest: { ...recording.manifest, sha256Hex } },
      T0 + 61 * MIN,
    );
    expect(await run(clubA, T0 + 62 * MIN)).toMatchObject({ rejected: 1 });
    expect(await uploadOf(bad)).toMatchObject({
      state: 'rejected',
      rejection_reason: 'pages_not_authentic',
      erase_command: null,
    });
    const { rows } = await owner.query<{ status: string }>(
      'select status::text from file where id = $1',
      [fileId],
    );
    expect(rows[0]?.status).toBe('deleted');
  });

  it('keeps an upload pending while its club has no master key', async () => {
    const recording = podRecording({
      deviceIdHex: OTHER_CHIP,
      startUnixMs: T0,
      durationS: 20,
      podSerial: 'ORC-0002',
    });
    const { uploadId: waiting } = await confirmedUpload(clubB, podB, recording, T0 + 1 * MIN);
    expect(await run(clubB, T0 + 2 * MIN)).toMatchObject({ verified: 0, rejected: 0 });
    expect(await uploadOf(waiting)).toMatchObject({
      state: 'pending',
      issues: [{ code: 'master_key_missing' }],
    });
    // Past its pending days it is rejected: never decoded, never kept.
    expect(await run(clubB, T0 + 8 * 24 * 60 * MIN)).toMatchObject({ expired: 1 });
    expect(await uploadOf(waiting)).toMatchObject({
      state: 'rejected',
      rejection_reason: 'expired',
    });
  });

  it('revoking location erases the player’s traces and trimmed files, with the counts only', async () => {
    await owner.query(
      `update consent set revoked_at = now(), revoked_by = $3
        where club_id = $1 and player_id = $2 and type = 'location'`,
      [clubA, early, signer],
    );
    const report = await runClubLocationErasures({ pool: worker, logger }, clubA);
    expect(report.completed).toBe(1);
    const { rows } = await owner.query<{ deleted_rows: Record<string, number> }>(
      `select deleted_rows from location_erasure where club_id = $1 and player_id = $2 and status = 'completed'`,
      [clubA, early],
    );
    expect(rows[0]?.deleted_rows).toEqual({ 'public.pod_trace_segment': 1, 'file:pod_raw': 1 });
    const { rows: left } = await owner.query<{ player_id: string }>(
      'select player_id from pod_trace_segment where club_id = $1',
      [clubA],
    );
    expect(left.map((r) => r.player_id)).toEqual([late]);
    const { rows: files } = await owner.query<{ status: string }>(
      `select status::text from file where club_id = $1 and kind = 'pod_raw' and player_id = $2`,
      [clubA, early],
    );
    expect(files.map((f) => f.status)).toEqual(['deleted']);
  });

  it('deletes traces past their retention', async () => {
    await owner.query(
      `update pod_trace_segment set expires_at = now() - interval '1 minute' where club_id = $1`,
      [clubA],
    );
    expect(await run(clubA, Date.now())).toMatchObject({ tracesDeleted: 1 });
    const { rows } = await owner.query<{ n: number }>(
      'select count(*)::int as n from pod_trace_segment where club_id = $1',
      [clubA],
    );
    expect(rows[0]?.n).toBe(0);
  });
});
