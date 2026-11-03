/**
 * The report job against Postgres 16 and an S3-compatible bucket (MinIO,
 * `STORAGE_TEST_URL`), through the worker's own login (B-602, ADR 0069): a
 * pending report becomes a `pdf_report` file in the bucket with its row
 * ready and its retention; an unreadable snapshot fails at once; a bucket
 * that refuses the upload retries with backoff, never leaves an object
 * without a row, and gives up after the attempts; and a report asked for
 * through the API's login reaches the worker by its notification. A pending
 * category report (B-603, ADR 0073) goes through the same job into a
 * `category_report` file of its category.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createDatabase, schema, type Database } from '@sport-performance/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import {
  PLAYER_REPORT_MAX_ATTEMPTS,
  fileObjectKey,
  parseTimeZone,
  type ClubId,
} from '@sport-performance/domain';
import { createS3Storage, type ObjectStorage } from '@sport-performance/storage';
import {
  createTestBucket,
  storageTestUrl,
  type TestBucket,
} from '@sport-performance/storage/testing';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disabledErrorReporter } from '../observability.js';
import { startWorker } from '../worker.js';
import { pdfText } from '../testing/pdf-text.js';
import { sampleCategoryReportContent, sampleReportContent } from '../testing/report-fixture.js';
import { runClubReports } from './job.js';

const { club, membership, player, season, testWindow, user } = schema;

const serverUrl = process.env.DATABASE_URL;
const hasDatabase = serverUrl !== undefined && serverUrl.trim() !== '';
const hasBucket = storageTestUrl !== undefined && storageTestUrl !== '';
if ((!hasDatabase || !hasBucket) && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL and STORAGE_TEST_URL are required in CI for the report job.');
}

const logger = pino({ level: process.env.TEST_LOG_LEVEL === 'error' ? 'error' : 'silent' });
/** A 1×1 PNG: the club's crest. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('base64');

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for the worker');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

interface ReportState {
  status: string;
  attempts: number;
  failure_code: string | null;
  file_id: string | null;
  next_attempt_at: Date;
}

describe.skipIf(!hasDatabase || !hasBucket)('player report job (Postgres 16 + MinIO)', () => {
  let temporary: TemporaryDatabase;
  let owner: pg.Pool;
  let ownerDb: Database;
  let worker: pg.Pool;
  let workerUrl: string;
  let app: pg.Pool;
  let bucket: TestBucket;
  let storage: ObjectStorage;
  let clubId: ClubId;
  let playerId: string;
  let windowId: string;
  let scId: string;
  let categoryId: string;

  async function insertReport(content: unknown = sampleReportContent()): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(
      `insert into player_report (club_id, player_id, test_window_id, format_version, content, created_by)
       values ($1, $2, $3, 1, $4, $5) returning id`,
      [clubId, playerId, windowId, JSON.stringify(content), scId],
    );
    return rows[0]?.id ?? '';
  }

  async function stateOf(reportId: string): Promise<ReportState> {
    const { rows } = await owner.query<ReportState>(
      `select status::text, attempts, failure_code, file_id, next_attempt_at
         from player_report where id = $1`,
      [reportId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('no report');
    return row;
  }

  /** Every report due: the retries' backoff is skipped. */
  async function makeDue(): Promise<void> {
    await owner.query(
      `update player_report set next_attempt_at = now() - interval '1 second' where status = 'pending'`,
    );
  }

  beforeAll(async () => {
    if (serverUrl === undefined || storageTestUrl === undefined) return;
    temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_report_test' });
    owner = temporary.pool({ max: 3 });
    ownerDb = createDatabase(owner);
    const workerLogin = await temporary.login('worker');
    workerUrl = workerLogin.connectionString;
    worker = temporary.pool({ connectionString: workerUrl, max: 4 });
    app = temporary.pool({
      connectionString: (await temporary.login('app')).connectionString,
      max: 2,
    });
    bucket = await createTestBucket(storageTestUrl);
    storage = createS3Storage(bucket.config);

    const [row] = await ownerDb
      .insert(club)
      .values({
        slug: 'club-informes',
        name: 'Olivos Rugby Club',
        shortName: 'ORC',
        timeZone: parseTimeZone('America/Argentina/Buenos_Aires'),
      })
      .returning({ id: club.id });
    clubId = row?.id as ClubId;
    scId = `sc-${randomUUID()}`;
    await ownerDb.insert(user).values({ id: scId, name: 'PF', email: `${scId}@example.com` });
    await ownerDb.insert(membership).values({ clubId, userId: scId, role: 'admin' });
    const [p] = await ownerDb
      .insert(player)
      .values({
        clubId,
        firstName: 'Martín',
        lastName: 'Núñez',
        birthDate: '2011-05-01' as never,
        sex: 'male',
        sport: 'rugby',
        joinedOn: '2020-01-01' as never,
      })
      .returning({ id: player.id });
    playerId = p?.id ?? '';
    const [s] = await ownerDb
      .insert(season)
      .values({
        clubId,
        sport: 'rugby',
        name: 'Temporada 2026',
        startsOn: '2026-02-01' as never,
        endsOn: '2026-11-30' as never,
      })
      .returning({ id: season.id });
    const [w] = await ownerDb
      .insert(testWindow)
      .values({
        clubId,
        seasonId: s?.id ?? '',
        number: 2,
        startsOn: '2026-04-01' as never,
        endsOn: '2026-04-30' as never,
      })
      .returning({ id: testWindow.id });
    windowId = w?.id ?? '';
    const { rows: categoryRows } = await owner.query<{ id: string }>(
      `with b as (insert into club_branch (club_id, sport, sex) values ($1, 'rugby', 'male'))
       insert into category (club_id, sport, sex, age_band_code, name, default_stage)
       values ($1, 'rugby', 'male', 'm15', 'M15', 'development') returning id`,
      [clubId],
    );
    categoryId = categoryRows[0]?.id ?? '';

    // The crest: a PNG in the bucket, set as the club's logo.
    const { rows: logo } = await owner.query<{ id: string }>(
      `insert into file (club_id, kind, status, content_type, size_bytes, checksum_sha256, uploaded_at)
       values ($1, 'club_logo', 'ready', 'image/png', $2, $3, now()) returning id`,
      [clubId, PNG.length, sha256(PNG)],
    );
    const logoId = logo[0]?.id ?? '';
    await storage.put({
      key: fileObjectKey({ clubId, kind: 'club_logo', id: logoId }),
      contentType: 'image/png',
      body: PNG,
      checksumSha256: sha256(PNG),
    });
    await owner.query('update club set logo_file_id = $2 where id = $1', [clubId, logoId]);
  });

  afterAll(async () => {
    await bucket.drop();
    await temporary.drop();
  });

  it('renders a pending report into a PDF file of the player', async () => {
    const content = sampleReportContent();
    const logoId = (
      await owner.query<{ logo_file_id: string }>('select logo_file_id from club where id = $1', [
        clubId,
      ])
    ).rows[0]?.logo_file_id;
    const reportId = await insertReport({
      ...content,
      club: { ...content.club, logoFileId: logoId },
    });
    const report = await runClubReports({ pool: worker, storage, logger }, clubId, {
      jobId: 'test-1',
    });
    expect(report).toMatchObject({ ready: 1, retried: 0, failed: 0, more: false });

    const state = await stateOf(reportId);
    expect(state).toMatchObject({ status: 'ready', attempts: 1, failure_code: null });
    const { rows } = await owner.query<{
      kind: string;
      status: string;
      player_id: string;
      content_type: string;
      size_bytes: number;
      checksum_sha256: string;
      file_name: string;
      days: number;
    }>(
      `select kind, status, player_id, content_type, size_bytes, checksum_sha256, file_name,
              round(extract(epoch from expires_at - uploaded_at) / 86400)::int as days
         from file where id = $1`,
      [state.file_id],
    );
    const file = rows[0];
    expect(file).toMatchObject({
      kind: 'pdf_report',
      status: 'ready',
      player_id: playerId,
      content_type: 'application/pdf',
      file_name: 'Informe Temporada 2026 V2 - Martín Núñez.pdf',
      days: 365,
    });
    const key = fileObjectKey({ clubId, kind: 'pdf_report', id: state.file_id ?? '' });
    const bytes = await storage.get(key, 20 * 1024 * 1024);
    expect(bytes?.byteLength).toBe(Number(file?.size_bytes));
    expect(sha256(bytes ?? new Uint8Array())).toBe(file?.checksum_sha256);
    const text = (await pdfText(bytes ?? new Uint8Array())).join(' ');
    expect(text).toContain('Martín Núñez');
    expect(text).toContain('Temporada 2026 · Ventana V2');
  });

  it('renders a pending category report into a PDF file of the category', async () => {
    const content = sampleCategoryReportContent();
    const { rows: inserted } = await owner.query<{ id: string }>(
      `insert into category_report (club_id, category_id, test_window_id, format_version, content, created_by)
       values ($1, $2, $3, 1, $4, $5) returning id`,
      [
        clubId,
        categoryId,
        windowId,
        JSON.stringify({ ...content, category: { ...content.category, id: categoryId } }),
        scId,
      ],
    );
    const reportId = inserted[0]?.id ?? '';
    const report = await runClubReports({ pool: worker, storage, logger }, clubId);
    expect(report).toMatchObject({ ready: 1, failed: 0, more: false });
    const { rows: states } = await owner.query<{ status: string; file_id: string | null }>(
      'select status::text, file_id from category_report where id = $1',
      [reportId],
    );
    expect(states[0]?.status).toBe('ready');
    const fileId = states[0]?.file_id ?? '';
    const { rows } = await owner.query<{
      kind: string;
      category_id: string;
      player_id: string | null;
      file_name: string;
      size_bytes: number;
      days: number;
    }>(
      `select kind, category_id, player_id, file_name, size_bytes,
              round(extract(epoch from expires_at - uploaded_at) / 86400)::int as days
         from file where id = $1`,
      [fileId],
    );
    expect(rows[0]).toMatchObject({
      kind: 'category_report',
      category_id: categoryId,
      player_id: null,
      file_name: 'Informe M15 Temporada 2026 V2.pdf',
      days: 365,
    });
    const bytes = await storage.get(
      fileObjectKey({ clubId, kind: 'category_report', id: fileId }),
      20 * 1024 * 1024,
    );
    expect(bytes?.byteLength).toBe(Number(rows[0]?.size_bytes));
    const text = (await pdfText(bytes ?? new Uint8Array())).join(' ');
    expect(text).toContain('Informe de categoría');
    expect(text).toContain('CUMPLIMIENTO DE LA BATERÍA');
  });

  it('fails at once a snapshot it cannot read', async () => {
    const reportId = await insertReport({ formatVersion: 99 });
    const report = await runClubReports({ pool: worker, storage, logger }, clubId);
    expect(report).toMatchObject({ ready: 0, failed: 1 });
    expect(await stateOf(reportId)).toMatchObject({
      status: 'failed',
      attempts: 1,
      failure_code: 'invalid_content',
      file_id: null,
    });
  });

  it('retries a refused upload with backoff, leaves no object without a row and gives up', async () => {
    const refusing: ObjectStorage = {
      ...storage,
      put: () => Promise.reject(new Error('bucket unavailable')),
    };
    const reportId = await insertReport();
    const before = new Set(await bucket.keys());
    for (let attempt = 1; attempt <= PLAYER_REPORT_MAX_ATTEMPTS; attempt += 1) {
      await makeDue();
      const report = await runClubReports({ pool: worker, storage: refusing, logger }, clubId);
      const state = await stateOf(reportId);
      if (attempt < PLAYER_REPORT_MAX_ATTEMPTS) {
        expect(report).toMatchObject({ retried: 1, failed: 0 });
        expect(state).toMatchObject({ status: 'pending', attempts: attempt });
        // Backoff: attempt × 5 minutes ahead.
        expect(state.next_attempt_at.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
        // Not due: a run in between takes nothing.
        expect(
          (await runClubReports({ pool: worker, storage: refusing, logger }, clubId)).more,
        ).toBe(false);
      } else {
        expect(report).toMatchObject({ failed: 1 });
        expect(state).toMatchObject({ status: 'failed', failure_code: 'storage_failed' });
      }
    }
    // Each attempt's file row is deleted (the retention job purges it); nothing reached the bucket.
    const { rows } = await owner.query<{ status: string }>(
      `select status::text from file where kind = 'pdf_report' and player_id = $1
         and created_at > now() - interval '1 minute' and status <> 'ready'`,
      [playerId],
    );
    expect(rows.map((r) => r.status)).toEqual(
      Array.from({ length: PLAYER_REPORT_MAX_ATTEMPTS }, () => 'deleted'),
    );
    expect(new Set(await bucket.keys())).toEqual(before);
  });

  it('gives up on a report whose attempts all died without recording a failure', async () => {
    // Every attempt was claimed and the process died while rendering it: nothing recorded.
    const reportId = await insertReport();
    await owner.query(
      `update player_report set attempts = $2, next_attempt_at = now() - interval '1 second'
        where id = $1`,
      [reportId, PLAYER_REPORT_MAX_ATTEMPTS],
    );
    const report = await runClubReports({ pool: worker, storage, logger }, clubId);
    expect(report).toMatchObject({ ready: 0, failed: 1, more: false });
    expect(await stateOf(reportId)).toMatchObject({
      status: 'failed',
      attempts: PLAYER_REPORT_MAX_ATTEMPTS,
      failure_code: 'attempts_exhausted',
      file_id: null,
    });
  });

  it('takes a report asked for through the API the moment it is committed', async () => {
    const running = await startWorker({
      pool: worker,
      connectionString: workerUrl,
      logger,
      reporter: disabledErrorReporter,
      clubConcurrency: 2,
      jobQueuePoolMax: 3,
      pollingIntervalSeconds: 0.5,
      schedule: false,
      storage,
      notifications: null,
    });
    try {
      const client = await app.connect();
      let reportId = '';
      try {
        await client.query('begin');
        await client.query(
          `select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true),
                  set_config('app.role', 'admin', true), set_config('app.request_id', 'req-report', true)`,
          [clubId, scId],
        );
        const { rows } = await client.query<{ id: string }>(
          `insert into player_report (club_id, player_id, test_window_id, format_version, content, created_by)
           values ($1, $2, $3, 1, $4, $5) returning id`,
          [clubId, playerId, windowId, JSON.stringify(sampleReportContent()), scId],
        );
        reportId = rows[0]?.id ?? '';
        await client.query('commit');
      } finally {
        client.release();
      }
      const state = await waitFor(async () => {
        const current = await stateOf(reportId);
        return current.status === 'ready' ? current : undefined;
      });
      expect(state.file_id).not.toBeNull();
    } finally {
      await running.stop(10_000);
    }
  });
});
