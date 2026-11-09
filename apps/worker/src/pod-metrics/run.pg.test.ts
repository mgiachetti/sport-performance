/**
 * The pod's field metrics through the worker's login (B-919, ADR 0110),
 * against Postgres 16 and MinIO: a recording written by the protocol's
 * reference encoder (10 Hz Doppler with a sprint, IMU batches and a high-g
 * impact) is ingested and trimmed like in production, then the metrics job
 * decodes the player's trimmed file and writes the canonical metrics as pod
 * values (variant, algorithm version, run with the firmware versions). Then:
 * idempotency, a reference Vmax that appears (a 40 m sprint), definitions
 * that change from a day on, and a correction that takes the data away.
 */
import { createHash } from 'node:crypto';
import { createDatabase, type Database } from '@sport-performance/db';
import { bootstrapClub } from '@sport-performance/db/seeds';
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import {
  DEFAULT_POD_METRIC_PARAMS,
  POD_METRICS_ALGORITHM_VERSION,
  canonicalJson,
  parseClubId,
  type ClubId,
} from '@sport-performance/domain';
import type { PodRawManifest } from '@sport-performance/pod-protocol';
import { createS3Storage, type ObjectStorage } from '@sport-performance/storage';
import {
  createTestBucket,
  storageTestUrl,
  type TestBucket,
} from '@sport-performance/storage/testing';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runClubPodRawIngest } from '../pod-raw/ingest.js';
import { staticPodKeyProvider } from '../pod-raw/keys.js';
import { TEST_MASTER_KEY_BASE64, podRecording } from '../testing/pod-recording.js';
import { listPodMetricClubs, podExternalRef, runClubPodMetrics } from './run.js';

const serverUrl = process.env.DATABASE_URL;
const hasDatabase = serverUrl !== undefined && serverUrl.trim() !== '';
const hasBucket = storageTestUrl !== undefined && storageTestUrl !== '';
if ((!hasDatabase || !hasBucket) && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL and STORAGE_TEST_URL are required in CI for the pod metrics.');
}

const logger = pino({ level: 'silent' });
const MIN = 60_000;
/** The session: 21:00 UTC for 10 minutes. */
const T0 = Date.parse('2026-11-04T21:00:00Z');
/** The recording starts a minute before the session. */
const REC0_S = -60;

/** Rec time (s) → speed: 3 m/s, and a sprint 2 minutes into the session (0 → 8 m/s at 4 m/s²). */
function speedMmS(tS: number): number {
  const t = tS + REC0_S - 120;
  if (t < 0 || t >= 7) return 3000;
  // From 3 m/s: up to 8 m/s at 4 m/s² (1.25 s), 3 s at 8, back to 3 at 4 m/s².
  if (t < 1.25) return 3000 + 4000 * t;
  if (t < 4.25) return 8000;
  if (t < 5.5) return 8000 - 4000 * (t - 4.25);
  return 3000;
}

/** A triangle wave of ±0.5 g with a period of 2 s on x: 1 g/s of change. */
function xG(tS: number): number {
  return Math.abs((tS % 2) - 1) - 0.5;
}

describe.skipIf(!hasDatabase || !hasBucket)('pod metrics (Postgres 16 + MinIO)', () => {
  let temporary: TemporaryDatabase;
  let owner: pg.Pool;
  let ownerDb: Database;
  let worker: pg.Pool;
  let bucket: TestBucket;
  let storage: ObjectStorage;
  let clubId: ClubId;
  let player: string;
  let session: string;
  let assignment: string;

  const keys = () => staticPodKeyProvider(new Map([[clubId, TEST_MASTER_KEY_BASE64]]));
  const deps = (now: number) => ({
    pool: worker,
    storage,
    keys: keys(),
    logger,
    now: () => new Date(now),
  });
  const metrics = (
    now = T0 + 30 * MIN,
    beforeWrite?: (pair: { playerId: string; sessionId: string }) => Promise<void>,
  ) => runClubPodMetrics({ ...deps(now), ...(beforeWrite && { beforeWrite }) }, clubId);

  async function values(): Promise<Record<string, number>> {
    const { rows } = await owner.query<{ code: string; value: number }>(
      `select m.code, e.value from external_metric e
         join metric_definition m on m.club_id = e.club_id and m.id = e.metric_definition_id
        where e.player_id = $1 and e.training_session_id = $2 and e.source = 'pod'`,
      [player, session],
    );
    return Object.fromEntries(rows.map((r) => [r.code, r.value]));
  }

  async function runRow() {
    const { rows } = await owner.query<{
      id: string;
      definition_hash: string;
      inputs_hash: string;
      firmware_versions: string[];
      gnss_firmware_versions: string[];
      reference_vmax_ms: number | null;
      reference_vmax_source: string | null;
      session_vmax_ms: number | null;
      pod_metric_config_id: string | null;
      stats: {
        impactsN: number | null;
        omitted: Record<string, string>;
        speed: { rejected: Record<string, number> };
      };
      computed_at: Date;
    }>(`select * from pod_metric_run where player_id = $1 and training_session_id = $2`, [
      player,
      session,
    ]);
    return rows[0];
  }

  async function confirmedUpload(
    pod: string,
    file: { bytes: Uint8Array; manifest: PodRawManifest },
    confirmedAt: number,
  ): Promise<string> {
    const checksum = createHash('sha256').update(file.bytes).digest('base64');
    const { rows: files } = await owner.query<{ id: string }>(
      `insert into file (club_id, kind, status, content_type, size_bytes, checksum_sha256, uploaded_at, expires_at)
       values ($1, 'pod_raw', 'ready', 'application/octet-stream', $2, $3, $4::timestamptz, $4::timestamptz + interval '8 days')
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
       select $1, p.id, p.device_id, $20, $3, $6, $4, $5, $7, $8, $9, $10, $11, $12,
              $13, $14, $15, $16, $17, $18, 'pending', $19::timestamptz, $19::timestamptz + interval '7 days'
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
        `${m.deviceIdHex}/${String(m.bootCounter)}/${String(m.segmentId)}`,
      ],
    );
    return rows[0]?.id ?? '';
  }

  beforeAll(async () => {
    if (serverUrl === undefined || storageTestUrl === undefined) return;
    temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_worker_pod_metrics' });
    owner = temporary.pool({ max: 3 });
    ownerDb = createDatabase(owner);
    const login = await temporary.login('worker');
    worker = temporary.pool({ connectionString: login.connectionString, max: 3 });
    bucket = await createTestBucket(storageTestUrl);
    storage = createS3Storage(bucket.config);
    clubId = parseClubId(
      (
        await owner.query<{ id: string }>(
          `insert into club (slug, name, short_name) values ('podmetrics', 'Pod', 'POD') returning id`,
        )
      ).rows[0]?.id,
    );
    // Texts in force from before the session (the bootstrap only publishes missing types).
    for (const type of ['data', 'location']) {
      await owner.query(
        `insert into consent_document (club_id, type, version, locale, title, body, published_at)
         values ($1, $2::consent_type, '2026-01', 'es-AR', 'Texto', 'Texto', '2026-01-01T00:00:00Z')`,
        [clubId, type],
      );
    }
    await bootstrapClub(ownerDb, { clubId, branches: [{ sport: 'rugby', sex: 'male' }] });
    const { rows: cats } = await owner.query<{ id: string }>(
      `select id from category where club_id = $1 and age_band_code = 'm19'`,
      [clubId],
    );
    const m19 = cats[0]?.id ?? '';
    const signer = 'signer-podmetrics';
    await owner.query(
      `insert into "user" (id, name, email) values ($1, 'Firma', 'firma@podmetrics.example.com')`,
      [signer],
    );
    const { rows: players } = await owner.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, 'Rápido', 'Pérez', '2007-03-01', 'male', 'rugby', '2020-01-01') returning id`,
      [clubId],
    );
    player = players[0]?.id ?? '';
    await owner.query(
      `insert into player_category (club_id, player_id, category_id, valid_from) values ($1, $2, $3, '2020-01-01')`,
      [clubId, player, m19],
    );
    for (const type of ['data', 'location']) {
      await owner.query(
        `insert into consent (club_id, player_id, type, document_id, document_version, signer_kind,
                              signed_by, signed_at)
         select $1, $2, $3::consent_type, d.id, d.version, 'player', $5, $4
           from consent_document d where d.club_id = $1 and d.type = $3::consent_type
          order by d.published_at desc limit 1`,
        [clubId, player, type, new Date(T0 - 60 * MIN), signer],
      );
    }
    const { rows: sessions } = await owner.query<{ id: string }>(
      `insert into training_session (club_id, sport, kind, category_id, starts_at, local_date, planned_duration_min)
       values ($1, 'rugby', 'training', $2, $3, '2026-11-04', 10) returning id`,
      [clubId, m19, new Date(T0)],
    );
    session = sessions[0]?.id ?? '';
    const { rows: pods } = await owner.query<{ id: string }>(
      `with d as (
         insert into pod_device (serial_number, chip_id, hardware_revision, provisioning_state, owner_club_id)
         values ('ORC-0001', '8a1f3c5e7d902b46', 'v0', 'provisioned', $1) returning id)
       insert into pod (club_id, device_id, short_id, number) select $1, d.id, 1, 1 from d returning id`,
      [clubId],
    );
    const pod = pods[0]?.id ?? '';
    const { rows: assignments } = await owner.query<{ id: string }>(
      `insert into pod_assignment (club_id, pod_id, player_id, starts_at, ends_at)
       values ($1, $2, $3, $4, $5) returning id`,
      [clubId, pod, player, new Date(T0 - 5 * MIN), new Date(T0 + 15 * MIN)],
    );
    assignment = assignments[0]?.id ?? '';
    const recording = podRecording({
      startUnixMs: T0 + REC0_S * 1000,
      durationS: 12 * 60,
      speedMmS,
      imu: { xG, zG: 1, impactsAtS: [-REC0_S + 300] },
    });
    await confirmedUpload(pod, recording, T0 + 13 * MIN);
    const ingest = (now: number) =>
      runClubPodRawIngest(
        { pool: worker, storage, keys: keys(), logger, now: () => new Date(now) },
        clubId,
      );
    // Verified and trimmed in one run: the session ended and the assignment is closed.
    expect(await ingest(T0 + 20 * MIN)).toMatchObject({ verified: 1, trimmed: 1 });
  }, 180_000);

  afterAll(async () => {
    await worker.end();
    await owner.end();
    await bucket.drop();
    await temporary.drop();
  });

  it('computes the canonical metrics from the trimmed log, inside the session only', async () => {
    expect(await listPodMetricClubs(worker)).toContain(clubId);
    const report = await metrics();
    expect(report).toMatchObject({ computed: 1, failed: 0, more: false });
    const v = await values();
    // 600 s inside the session at 3 m/s, plus the sprint's extra metres (about 23 m).
    expect(v.dist_m).toBeGreaterThan(1815);
    expect(v.dist_m).toBeLessThan(1830);
    expect(v.dist_m_min).toBeCloseTo((v.dist_m ?? 0) / 10, 6);
    expect(v.vmax_ms).toBeCloseTo(8, 1);
    expect(v.sprints_n).toBe(1);
    expect(v.acc_n).toBe(1);
    expect(v.dec_n).toBe(1);
    // Above 5.5 m/s: the sprint only.
    expect(v.hsr_abs_m).toBeGreaterThan(25);
    expect(v.hsr_abs_m).toBeLessThan(35);
    expect(v.sprint_dist_m).toBeGreaterThan(24);
    // 1 g/s of change on x for 600 s: 600 × 100 × 0.01 g × 0.01 = 6 AU.
    expect(v.accel_load_au).toBeGreaterThan(5.7);
    expect(v.accel_load_au).toBeLessThan(6.1);
    // No reference Vmax yet (one session, no 40 m sprint): no relative values.
    expect(v.hsr_rel_m).toBeUndefined();
    expect(v.vmax_pct).toBeUndefined();

    const run = await runRow();
    expect(run).toMatchObject({
      firmware_versions: ['0.3.1'],
      gnss_firmware_versions: ['LC29HAANR11A03S'],
      reference_vmax_ms: null,
      reference_vmax_source: null,
    });
    expect(run?.stats.impactsN).toBe(1);
    expect(run?.stats.omitted.hsr_rel_m).toBe('reference_vmax_missing');
    expect(run?.pod_metric_config_id).not.toBeNull();
    const { rows } = await owner.query<{
      method_variant: string;
      algorithm_version: string;
      external_ref: string;
      pod_metric_run_id: string;
      unit: string;
    }>(
      `select method_variant::text, algorithm_version, external_ref, pod_metric_run_id, unit::text
         from external_metric where player_id = $1 and source = 'pod'`,
      [player],
    );
    expect(rows.length).toBe(9);
    for (const row of rows) {
      expect(row).toMatchObject({
        method_variant: 'pod_log',
        algorithm_version: POD_METRICS_ALGORITHM_VERSION,
        external_ref: podExternalRef(session),
        pod_metric_run_id: run?.id,
      });
    }
  });

  it('is idempotent: the same definitions and inputs decode nothing', async () => {
    const before = await runRow();
    const report = await metrics();
    expect(report).toMatchObject({ computed: 0, unchanged: 1 });
    expect((await runRow())?.computed_at).toEqual(before?.computed_at);
  });

  it('a 40 m sprint gives the reference Vmax: relative values appear', async () => {
    const { rows } = await owner.query<{ id: string }>(
      `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, method)
       select $1, $2, d.id, '2026-10-01', 'done', 'manual'
         from test_definition d where d.club_id = $1 and d.code = 'sprint_40' and d.version = 1
       returning id`,
      [clubId, player],
    );
    await owner.query(
      `insert into test_result_value (club_id, test_result_id, metric_definition_id, attempt_number, value, unit)
       select $1, $2, m.id, 1, 8.5, 'ms'
         from metric_definition m where m.club_id = $1 and m.code = 'sprint_vmax_ms'`,
      [clubId, rows[0]?.id],
    );
    // A correction of the ingestion marks the run while the files are being read (review
    // B2): the write sees it under the lock and gives up, never clearing the mark.
    const raced = await metrics(T0 + 30 * MIN, async ({ playerId }) => {
      await owner.query('update pod_metric_run set stale = true where player_id = $1', [playerId]);
    });
    expect(raced).toMatchObject({ computed: 0, skipped: { inputs_changed: 1 }, more: false });
    expect(await runRow()).toMatchObject({ reference_vmax_ms: null });
    const { rows: marks } = await owner.query<{ stale: boolean }>(
      'select stale from pod_metric_run where player_id = $1',
      [player],
    );
    expect(marks).toEqual([{ stale: true }]);
    // The trims changed meanwhile: also given up.
    const moved = await metrics(T0 + 30 * MIN, async ({ playerId }) => {
      await owner.query(
        `update pod_raw_trim set windows = jsonb_build_array(jsonb_build_object(
           'startMs', $2::bigint, 'endMs', $3::bigint)) where player_id = $1`,
        [playerId, T0, T0 + 10 * MIN - 1000],
      );
    });
    expect(moved).toMatchObject({ computed: 0, skipped: { inputs_changed: 1 } });
    // The next run computes from the data as it is, and only then clears the mark.
    expect((await metrics()).computed).toBe(1);
    expect(marks.length).toBe(1);
    const v = await values();
    expect(v.vmax_pct).toBeCloseTo(((v.vmax_ms ?? 0) / 8.5) * 100, 6);
    // 60 % of 8.5 m/s = 5.1 m/s: still only the sprint.
    expect(v.hsr_rel_m).toBeGreaterThan(v.hsr_abs_m ?? 0);
    expect(await runRow()).toMatchObject({
      reference_vmax_ms: 8.5,
      reference_vmax_source: 'sprint_40',
    });
  });

  it('new definitions from a day on recompute the sessions of those days', async () => {
    await owner.query(
      `update pod_metric_config set valid_to = '2026-11-01' where club_id = $1 and valid_to is null`,
      [clubId],
    );
    const params = {
      ...DEFAULT_POD_METRIC_PARAMS,
      accelerations: { thresholdMs2: 5, minDwellS: 0.5 },
    };
    await owner.query(
      `insert into pod_metric_config (club_id, algorithm_version, params, verification, valid_from)
       values ($1, $2, $3::jsonb, 'club_openfield', '2026-11-01')`,
      [clubId, POD_METRICS_ALGORITHM_VERSION, canonicalJson(params)],
    );
    expect((await metrics()).computed).toBe(1);
    expect((await values()).acc_n).toBe(0);
  });

  it('definitions of another algorithm are reported and wait, never replaced by the defaults', async () => {
    const before = await values();
    const { rows } = await owner.query<{ id: string }>(
      `insert into pod_metric_config (club_id, sport, algorithm_version, params, valid_from)
       values ($1, 'rugby', 'pod-metrics/2', '{}'::jsonb, '2026-11-02') returning id`,
      [clubId],
    );
    const report = await metrics();
    expect(report).toMatchObject({ computed: 0, configIssues: 1, skipped: { config_unusable: 1 } });
    expect(await values()).toEqual(before);
    await owner.query('update pod_metric_config set archived_at = now() where id = $1', [
      rows[0]?.id,
    ]);
    expect(await metrics()).toMatchObject({ computed: 0, unchanged: 1, configIssues: 0 });
  });

  it('a trimmed file that is not ready: nothing is computed nor deleted', async () => {
    const before = await values();
    await owner.query(
      `update file set status = 'deleted', deleted_at = now()
        where id = (select file_id from pod_raw_trim where player_id = $1)`,
      [player],
    );
    expect(await metrics()).toMatchObject({ computed: 0, skipped: { inputs_unavailable: 1 } });
    expect(await values()).toEqual(before);
  });

  it('a correction that takes the data away deletes the values with their run', async () => {
    await owner.query(
      `update pod_assignment set archived_at = now(), reprocess_requested_at = now() where id = $1`,
      [assignment],
    );
    await runClubPodRawIngest(
      { pool: worker, storage, keys: keys(), logger, now: () => new Date(T0 + 40 * MIN) },
      clubId,
    );
    const { rows } = await owner.query<{ stale: boolean }>(
      'select stale from pod_metric_run where player_id = $1',
      [player],
    );
    expect(rows).toEqual([{ stale: true }]);
    expect((await metrics()).deleted).toBe(1);
    expect(await values()).toEqual({});
    expect(await runRow()).toBeUndefined();
  });
});
