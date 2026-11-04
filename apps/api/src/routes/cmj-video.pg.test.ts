/**
 * CMJ by video end to end (B-604, ADR 0085) against Postgres 16 and a real
 * S3-compatible bucket (MinIO, `STORAGE_TEST_URL`): the video of an attempt
 * marked frame by frame is tied to that attempt (one live video, same
 * player, a valid `cmj_video_frames` entry), the result shows it while it is
 * ready, and every change of the video is a change of the result for the
 * offline pull.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
import {
  createTestBucket,
  storageTestUrl,
  type TestBucket,
} from '@sport-performance/storage/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFilesModule } from '../files/module.js';
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

interface EntryBody {
  id: string;
  kind: string;
  videoFileId: string | null;
}

interface ResultBody {
  id: string;
  entries: EntryBody[];
}

interface FileBody {
  id: string;
  status: string;
  testResultId: string | null;
  testEntryId: string | null;
}

interface CreatedBody {
  file: FileBody;
  upload: { method: 'PUT'; url: string; headers: Record<string, string> } | null;
}

interface PullBody {
  items: { collection: string; id: string; data: ResultBody | null }[];
  cursor: string;
  hasMore: boolean;
}

interface Envelope {
  error: { code: string; details?: { path: (string | number)[] }[] };
}

const SUPPORT_REASON = encodeURIComponent('Alta del club para las pruebas del CMJ por video');

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

describeWithStorage('CMJ by video (Postgres + MinIO)', (serverUrl, storageUrl) => {
  let database: TestDatabase;
  let bucket: TestBucket;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let scA: SignedIn;
  let coachA: SignedIn;
  let clubA: ClubId;
  let m15 = '';
  let cmjDefinition = '';
  let filmed = '';
  let other = '';
  let result: ResultBody;
  const videoEntry = randomUUID();
  const flightEntry = randomUUID();
  const video = Buffer.from(`cmj ${randomBytes(512).toString('hex')}`);

  const post = (caller: SignedIn, url: string, payload: unknown) =>
    t.app.inject({ method: 'POST', url, headers: caller.headers, payload: payload as never });
  const get = (caller: SignedIn, url: string) => t.app.inject({ url, headers: caller.headers });

  const videoPayload = (extra: Record<string, unknown> = {}) => ({
    kind: 'cmj_video',
    clientUuid: randomUUID(),
    playerId: filmed,
    testResultId: result.id,
    testEntryId: videoEntry,
    contentType: 'video/mp4',
    sizeBytes: video.length,
    checksumSha256: sha256(video),
    ...extra,
  });

  async function upload(payload: Record<string, unknown>): Promise<FileBody> {
    const created = await post(scA, '/v1/files', payload);
    expect(created.statusCode, created.body).toBe(201);
    const { file, upload: signed } = created.json<CreatedBody>();
    if (signed === null) throw new Error('no upload URL');
    const put = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body: video });
    expect(put.status).toBe(200);
    const confirmed = await post(scA, `/v1/files/${file.id}/confirm`, undefined);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    return confirmed.json<FileBody>();
  }

  async function readResult(): Promise<ResultBody> {
    const response = await get(scA, `/v1/test-results/${result.id}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<ResultBody>();
  }

  const videoOf = (body: ResultBody, entryId: string) =>
    body.entries.find((entry) => entry.id === entryId)?.videoFileId;

  /** Waits until every logged change is below the pull horizon (see `sync.pg.test.ts`). */
  async function settled(): Promise<void> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      const { rows } = await database.admin.query<{ done: boolean }>(
        `select coalesce(max(txid) < pg_snapshot_xmin(pg_current_snapshot()), true) as done
           from sync_change`,
      );
      if (rows[0]?.done === true) return;
      if (Date.now() > deadline) throw new Error('the pull horizon did not move');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async function pullFrom(cursor: string | null): Promise<PullBody> {
    await settled();
    const query = new URLSearchParams({ collections: 'test_result' });
    if (cursor !== null) query.set('cursor', cursor);
    const response = await get(scA, `/v1/sync/changes?${query.toString()}`);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<PullBody>();
  }

  async function insertPlayer(name: string, consents: readonly string[]): Promise<string> {
    const created = await database.admin.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, 'Juan', $2, '2011-05-01', 'male', 'rugby', '2020-01-01') returning id`,
      [clubA, name],
    );
    const id = created.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, id, m15],
    );
    for (const type of consents) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, $3, 'v1', 'guardian', $4)`,
        [clubA, id, type, superadmin.userId],
      );
    }
    return id;
  }

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    bucket = await createTestBucket(storageUrl);
    const files = createFilesModule({
      storage: bucket.config,
      uploadUrlTtlS: 900,
      downloadUrlTtlS: 120,
      logoUrlTtlS: 3600,
    });
    if (files === undefined) throw new Error('the files module needs the bucket');
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
    superadmin = await signIn(t, 'soporte@cmj-video.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    scA = await signIn(t, 'sc@cmj-video.example.com');
    coachA = await signIn(t, 'coach@cmj-video.example.com');
    const created = await t.app.inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: { ...superadmin.headers, 'x-support-reason': SUPPORT_REASON },
      payload: {
        slug: 'cmj-video',
        name: 'Club CMJ',
        shortName: 'CMJ',
        branches: [{ sport: 'rugby', sex: 'male' }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    clubA = created.json<{ club: { id: ClubId } }>().club.id;
    const category = await database.admin.query<{ id: string }>(
      `select id from category where club_id = $1 and age_band_code = 'm15'`,
      [clubA],
    );
    m15 = category.rows[0]?.id ?? '';
    const definition = await database.admin.query<{ id: string }>(
      `select id from test_definition where club_id = $1 and code = 'cmj'`,
      [clubA],
    );
    cmjDefinition = definition.rows[0]?.id ?? '';
    for (const [caller, role] of [
      [scA, 'sc'],
      [coachA, 'coach'],
    ] as const) {
      const membership = await createMembership(database.admin, caller.userId, clubA, role);
      await database.admin.query(
        `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
         values ($1, $2, $3, '2020-01-01')`,
        [clubA, membership, m15],
      );
    }
    filmed = await insertPlayer('Filmado', ['data', 'image']);
    other = await insertPlayer('Otro', ['data', 'image']);

    const recorded = await post(scA, '/v1/test-results', {
      clientUuid: randomUUID(),
      status: 'done',
      playerId: filmed,
      testDefinitionId: cmjDefinition,
      measuredOn: '2026-03-02',
      method: 'video',
      entries: [
        {
          kind: 'cmj_video_frames',
          clientUuid: videoEntry,
          attemptNumber: 1,
          takeoffFrame: 10,
          landingFrame: 130,
          frameRateFps: 240,
        },
        { kind: 'cmj_flight_time', clientUuid: flightEntry, attemptNumber: 2, flightTimeS: 0.5 },
      ],
    });
    expect(recorded.statusCode, recorded.body).toBe(201);
    result = recorded.json<ResultBody>();
  }, 240_000);

  afterAll(async () => {
    await t.close();
    await bucket.drop();
    await database.drop();
  });

  it('ties the video to its attempt and shows it on the result once it is ready', async () => {
    const before = await pullFrom(null);
    expect(videoOf(result, videoEntry)).toBeNull();

    const created = await post(scA, '/v1/files', videoPayload());
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json<CreatedBody>().file).toMatchObject({
      status: 'pending',
      testResultId: result.id,
      testEntryId: videoEntry,
    });
    // Pending: not shown yet.
    expect(videoOf(await readResult(), videoEntry)).toBeNull();
    const pendingId = created.json<CreatedBody>().file.id;
    const deleted = await t.app.inject({
      method: 'DELETE',
      url: `/v1/files/${pendingId}`,
      headers: scA.headers,
    });
    expect(deleted.statusCode, deleted.body).toBe(200);

    const file = await upload(videoPayload());
    expect(file).toMatchObject({ status: 'ready', testResultId: result.id });
    const shown = await readResult();
    expect(videoOf(shown, videoEntry)).toBe(file.id);
    expect(videoOf(shown, flightEntry)).toBeNull();

    // The confirmation is a change of the result for the offline pull, with the video in it.
    const after = await pullFrom(before.cursor);
    const change = after.items.find((item) => item.id === result.id);
    expect(change?.data && videoOf(change.data, videoEntry)).toBe(file.id);

    // Deleted: gone from the result (and from the next pull), and the attempt takes a new one.
    const removed = await t.app.inject({
      method: 'DELETE',
      url: `/v1/files/${file.id}`,
      headers: scA.headers,
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(videoOf(await readResult(), videoEntry)).toBeNull();
    const later = await pullFrom(after.cursor);
    const gone = later.items.find((item) => item.id === result.id);
    expect(gone?.data && videoOf(gone.data, videoEntry)).toBeNull();

    const again = await upload(videoPayload());
    expect(videoOf(await readResult(), videoEntry)).toBe(again.id);
  });

  it('keeps one live video per attempt and replays only the same upload', async () => {
    const second = await post(scA, '/v1/files', videoPayload());
    expect(second.statusCode, second.body).toBe(409);

    const clientUuid = randomUUID();
    const otherAttempt = randomUUID();
    const added = await post(scA, `/v1/test-results/${result.id}/entries`, {
      entries: [
        {
          kind: 'cmj_video_frames',
          clientUuid: otherAttempt,
          attemptNumber: 3,
          takeoffFrame: 5,
          landingFrame: 120,
          frameRateFps: 240,
        },
      ],
    });
    expect(added.statusCode, added.body).toBe(200);
    const first = await post(
      scA,
      '/v1/files',
      videoPayload({ clientUuid, testEntryId: otherAttempt }),
    );
    expect(first.statusCode, first.body).toBe(201);
    const replay = await post(
      scA,
      '/v1/files',
      videoPayload({ clientUuid, testEntryId: otherAttempt }),
    );
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    // The same clientUuid for another attempt is another upload.
    const moved = await post(
      scA,
      '/v1/files',
      videoPayload({ clientUuid, testEntryId: flightEntry }),
    );
    expect(moved.statusCode, moved.body).toBe(409);
  });

  it('refuses an attempt that is not a video attempt of the same player', async () => {
    const flight = await post(scA, '/v1/files', videoPayload({ testEntryId: flightEntry }));
    expect(flight.statusCode, flight.body).toBe(400);
    expect(errorOf(flight).details?.[0]?.path).toEqual(['body', 'testEntryId']);

    const unknown = await post(scA, '/v1/files', videoPayload({ testEntryId: randomUUID() }));
    expect(unknown.statusCode).toBe(400);
    expect(errorOf(unknown).details?.[0]?.path).toEqual(['body', 'testEntryId']);

    const otherPlayer = await post(scA, '/v1/files', videoPayload({ playerId: other }));
    expect(otherPlayer.statusCode).toBe(400);
    expect(errorOf(otherPlayer).details?.[0]?.path).toEqual(['body', 'testResultId']);

    const noResult = await post(scA, '/v1/files', videoPayload({ testResultId: randomUUID() }));
    expect(noResult.statusCode).toBe(404);

    // Both or neither (contract).
    const half = await post(scA, '/v1/files', {
      ...videoPayload(),
      testEntryId: undefined,
    });
    expect(half.statusCode).toBe(400);

    // A voided attempt takes no video.
    const voidable = randomUUID();
    const added = await post(scA, `/v1/test-results/${result.id}/entries`, {
      entries: [
        {
          kind: 'cmj_video_frames',
          clientUuid: voidable,
          attemptNumber: 4,
          takeoffFrame: 5,
          landingFrame: 100,
          frameRateFps: 240,
        },
      ],
    });
    expect(added.statusCode, added.body).toBe(200);
    const voided = await post(scA, `/v1/test-results/${result.id}/void`, {
      entryIds: [voidable],
      reason: 'Se marcó mal el despegue',
    });
    expect(voided.statusCode, voided.body).toBe(200);
    const late = await post(scA, '/v1/files', videoPayload({ testEntryId: voidable }));
    expect(late.statusCode).toBe(400);
    expect(errorOf(late).details?.[0]?.path).toEqual(['body', 'testEntryId']);

    // The coach does not upload videos (media.upload).
    const coach = await post(coachA, '/v1/files', videoPayload({ testEntryId: voidable }));
    expect(coach.statusCode).toBe(403);
  });

  it('checks the attempt in the database too, and never moves a video to another one', async () => {
    const insert = (playerId: string, entryId: string) =>
      database.admin.query(
        `insert into file (club_id, kind, player_id, content_type, size_bytes, checksum_sha256,
                           test_result_id, test_entry_id, expires_at)
         values ($1, 'cmj_video', $2, 'video/mp4', 10, $3, $4, $5, now() + interval '1 day')
         returning id`,
        [clubA, playerId, sha256(Buffer.from('x')), result.id, entryId],
      );
    await expect(insert(other, randomUUID())).rejects.toMatchObject({
      constraint: 'file_test_entry_attempt',
    });
    await expect(insert(filmed, flightEntry)).rejects.toMatchObject({
      constraint: 'file_test_entry_attempt',
    });
    const { rows } = await database.admin.query<{ id: string }>(
      `select id from file where club_id = $1 and test_entry_id = $2 and status = 'ready'`,
      [clubA, videoEntry],
    );
    await expect(
      database.admin.query('update file set test_entry_id = $2 where id = $1', [
        rows[0]?.id,
        flightEntry,
      ]),
    ).rejects.toMatchObject({ constraint: 'file_test_entry_frozen' });
  });
});
