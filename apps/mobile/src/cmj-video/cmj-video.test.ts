import {
  SYNC_OPERATION_INPUTS,
  createApiClient,
  type TestResult,
} from '@sport-performance/contracts';
import type { SyncChange } from '@sport-performance/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine } from '../offline/engine.ts';
import type { SessionState } from '../state/session-controller.ts';
import { apiError, createFakeApi, type FakeApi } from '../test/fake-api.ts';
import { T0, createFakeSyncServer, uuid } from '../test/fake-sync-server.ts';
import { USER, membership } from '../test/fixtures.ts';
import { memoryVideoPlatform } from '../test/memory-video-files.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import {
  attemptOnServer,
  canFilmCmj,
  cmjAttemptMutation,
  filmingBlock,
  nextAttemptNumber,
  playerCmjAttempts,
  type CmjVideoDay,
  type CmjVideoPlayer,
} from './attempt.ts';
import { cmjCameraFrameRate } from './camera.ts';
import { createCaptureStore } from './captures.ts';
import { hexToBase64 } from './digest.ts';
import {
  frameTimeMs,
  heightPlausibility,
  initialMarking,
  markingReducer,
  markingResult,
} from './marking.ts';
import { createCmjVideoService } from './service.ts';
import { MAX_REFUSED_UPLOADS, createCmjVideoUploader, uploadBackoffMs } from './uploader.ts';

const SC_AT_ORC = membership('a4444444-4444-4444-8444-444444444444', 'sc');
const SCOPE = { userId: USER.id, membershipId: SC_AT_ORC.id };
const PLAYER = 'b2222222-2222-4222-8222-222222222222';
const DAY: CmjVideoDay = {
  testSessionId: 'c2222222-2222-4222-8222-222222222222',
  scheduledOn: '2026-11-03',
  definitionId: 'd2222222-2222-4222-8222-222222222222',
  protocolVersion: 1,
  attemptCount: 3,
  gravityMs2: 9.81,
};
const FILE_ID = 'f2222222-2222-4222-8222-222222222222';
const SHA = 'n2SnR+G5fxMfq7a0Rylsm28CAeefs8U1bmx36JtqgGo=';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function resultDto(
  entries: TestResult['entries'],
  overrides: Partial<TestResult> = {},
): TestResult {
  return {
    id: uuid(),
    playerId: PLAYER,
    testDefinitionId: DAY.definitionId,
    testCode: 'cmj',
    protocolVersion: 1,
    testSessionId: DAY.testSessionId,
    measuredOn: DAY.scheduledOn,
    status: 'done',
    notDoneReason: null,
    notDoneNote: null,
    method: 'video',
    evaluatorId: USER.id,
    deviceId: null,
    exercise: null,
    conditions: {},
    notes: null,
    importId: null,
    entries,
    scores: [],
    createdAt: '2026-11-03T12:00:00.000Z',
    updatedAt: '2026-11-03T12:00:00.000Z',
    version: 'v1',
    ...overrides,
  } as TestResult;
}

function videoEntry(
  id: string,
  attemptNumber: number,
  extra: Partial<TestResult['entries'][number]> = {},
): TestResult['entries'][number] {
  return {
    id,
    kind: 'cmj_video_frames',
    attemptNumber,
    recordedAt: '2026-11-03T12:00:00.000Z',
    inputs: { kind: 'cmj_video_frames', takeoffFrame: 10, landingFrame: 130, frameRateFps: 240 },
    values: [{ id: uuid(), metricCode: 'cmj_height_cm', unit: 'cm', value: 30.7, computed: true }],
    issues: [],
    voided: null,
    videoFileId: null,
    ...extra,
  } as TestResult['entries'][number];
}

function resultChange(result: TestResult, clientUuid: string | null = null): SyncChange {
  return {
    collection: 'test_result',
    op: 'upsert',
    id: result.id,
    clientUuid,
    data: result,
  } as SyncChange;
}

function fileDto(status: 'pending' | 'ready', resultId: string, entryId: string) {
  return {
    id: FILE_ID,
    kind: 'cmj_video',
    status,
    playerId: PLAYER,
    categoryId: null,
    contentType: 'video/mp4',
    sizeBytes: 20,
    checksumSha256: SHA,
    fileName: 'cmj-intento-1.mp4',
    testResultId: resultId,
    testEntryId: entryId,
    uploadedAt: status === 'ready' ? '2026-11-03T12:10:00.000Z' : null,
    expiresAt: '2026-11-04T12:00:00.000Z',
    deletedAt: null,
    createdBy: USER.id,
    createdAt: '2026-11-03T12:05:00.000Z',
    updatedAt: '2026-11-03T12:05:00.000Z',
  };
}

function signedIn(): SessionState {
  return {
    status: 'signedIn',
    user: USER,
    email: USER.email,
    memberships: [SC_AT_ORC],
    activeMembership: SC_AT_ORC,
    clubNotice: null,
    offline: false,
  };
}

function fakeSession(initial: SessionState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: SessionState) {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

/** The file endpoints of the API: a pending upload, the bucket and the confirmation. */
function fileRoutes(api: FakeApi, resultId: () => string, entryId: () => string) {
  api.on('POST /v1/files', () => ({
    status: 201,
    body: {
      file: fileDto('pending', resultId(), entryId()),
      upload: {
        method: 'PUT',
        url: 'https://bucket.test/clubs/orc/cmj_video/f?signature=x',
        headers: { 'content-type': 'video/mp4', 'x-amz-checksum-sha256': SHA },
        expiresAt: '2026-11-03T12:20:00.000Z',
      },
    },
  }));
  api.on(`POST /v1/files/${FILE_ID}/confirm`, () => ({
    status: 200,
    body: fileDto('ready', resultId(), entryId()),
  }));
}

async function setup() {
  const api = createFakeApi();
  const server = createFakeSyncServer(api);
  const client = createApiClient({ baseUrl: api.baseUrl, fetch: api.fetch });
  const database = await openLocalDatabase(nodeSqliteDriver());
  let time = T0;
  const errors: unknown[] = [];
  const engine = createSyncEngine({
    database,
    api: client,
    randomUUID: uuid,
    now: () => time,
    random: () => 0.5,
    setTimer: () => 0,
    clearTimer: () => undefined,
    reportError: (error) => errors.push(error),
  });
  await engine.setScope(SCOPE);
  const platform = memoryVideoPlatform();
  const captures = createCaptureStore(platform.files);
  const uploader = createCmjVideoUploader({
    captures,
    store: engine.store,
    api: client,
    transfer: platform.transfer,
    randomUUID: uuid,
    now: () => time,
    reportError: (error) => errors.push(error),
  });
  cleanups.push(() => {
    engine.dispose();
  });
  return {
    api,
    server,
    client,
    engine,
    platform,
    captures,
    uploader,
    errors,
    advance: (ms: number) => {
      time += ms;
    },
    now: () => time,
  };
}

/** Queues a filmed attempt as the service does, and keeps its video. */
async function filmAttempt(t: Awaited<ReturnType<typeof setup>>, attemptId = uuid()) {
  const attempts = await playerCmjAttempts(t.engine.store, SCOPE.membershipId, DAY, PLAYER);
  const attemptNumber = nextAttemptNumber(attempts.attemptNumbers);
  const resultClientUuid = uuid();
  const mutation = cmjAttemptMutation({
    day: DAY,
    playerId: PLAYER,
    evaluatorId: USER.id,
    target: attempts.target,
    jump: {
      attemptId,
      attemptNumber,
      takeoffFrame: 10,
      landingFrame: 130,
      frameRateFps: 240,
      recordedAt: new Date(t.now()).toISOString(),
    },
    resultClientUuid,
  });
  if (mutation.op === 'test_result.add_entries')
    await t.engine.enqueue(mutation.op, mutation.input);
  else await t.engine.enqueue(mutation.op, mutation.input);
  t.platform.record(`/tmp/${attemptId}.mp4`);
  const capture = await t.captures.add(
    {
      id: attemptId,
      uploadId: uuid(),
      userId: SCOPE.userId,
      membershipId: SCOPE.membershipId,
      playerId: PLAYER,
      testSessionId: DAY.testSessionId,
      attemptNumber,
      contentType: 'video/mp4',
      frameRateFps: 240,
      durationMs: 3000,
      recordedAt: t.now(),
      sizeBytes: null,
      checksumSha256: null,
    },
    `/tmp/${attemptId}.mp4`,
  );
  return { capture, mutation, resultClientUuid, attemptNumber };
}

describe('CMJ by video: who films and the marking', () => {
  it('is for whoever records results and uploads videos', () => {
    expect(canFilmCmj('sc')).toBe(true);
    expect(canFilmCmj('admin')).toBe(true);
    for (const role of ['coach', 'player', 'parent', 'medical'] as const) {
      expect(canFilmCmj(role), role).toBe(false);
    }
  });

  it('never films a player without image consent', () => {
    const player: CmjVideoPlayer = {
      id: PLAYER,
      name: 'Díaz, Juan',
      sex: 'male',
      ageYears: 17.2,
      recording: 'allowed',
      video: 'allowed',
      applicable: true,
    };
    expect(filmingBlock(player)).toBeNull();
    expect(filmingBlock({ ...player, video: 'missing_consent' })).toBe('missing_image_consent');
    expect(filmingBlock({ ...player, recording: 'missing_consent' })).toBe('missing_data_consent');
    expect(filmingBlock({ ...player, video: 'forbidden' })).toBe('forbidden');
    expect(filmingBlock({ ...player, applicable: false })).toBe('not_applicable');
  });

  it('marks take-off and landing frame by frame and measures h = g·t²/8', () => {
    let state = initialMarking(2_000, 240);
    expect(state.frameCount).toBe(480);
    expect(markingResult(state, 9.81)).toEqual({ status: 'incomplete' });
    state = markingReducer(state, { type: 'step', delta: 10 });
    state = markingReducer(state, { type: 'mark_takeoff' });
    state = markingReducer(state, { type: 'step', delta: 120 });
    state = markingReducer(state, { type: 'step', delta: -1 });
    state = markingReducer(state, { type: 'step', delta: 1 });
    state = markingReducer(state, { type: 'mark_landing' });
    expect([state.takeoffFrame, state.landingFrame]).toEqual([10, 130]);
    const result = markingResult(state, 9.81);
    expect(result.status).toBe('measured');
    if (result.status !== 'measured') return;
    expect(result.flightTimeS).toBe(0.5);
    expect(result.heightCm).toBeCloseTo((9.81 * 0.25 * 100) / 8, 10);
    expect(result.precisionCm).toBeGreaterThan(0.4);
    // Going back to a mark shows its frame; the image is asked at the middle of the frame.
    state = markingReducer(state, { type: 'go_to', mark: 'takeoff' });
    expect(state.frame).toBe(10);
    expect(frameTimeMs(state)).toBeCloseTo(43.75, 6);
    // A landing before the take-off is not a jump.
    state = markingReducer(state, { type: 'step', delta: -5 });
    state = markingReducer(state, { type: 'mark_landing' });
    expect(markingResult(state, 9.81)).toEqual({ status: 'invalid' });
    // Never outside the video.
    expect(markingReducer(state, { type: 'seek', frame: 9999 }).frame).toBe(479);
    expect(markingReducer(state, { type: 'clear' }).takeoffFrame).toBeNull();
  });

  it('warns about an implausible height without blocking', () => {
    expect(heightPlausibility(35, { sex: 'male', ageYears: 15.4 })).toBe('within');
    expect(heightPlausibility(95, { sex: 'male', ageYears: 15.4 })).toBe('above');
    expect(heightPlausibility(3, { sex: 'female', ageYears: null })).toBe('below');
    // The ranges of the women's CMJ: 70 cm is within the men's, above the women's.
    expect(heightPlausibility(70, { sex: 'male', ageYears: 17 })).toBe('within');
    expect(heightPlausibility(70, { sex: 'female', ageYears: 17 })).toBe('above');
  });

  it('films at 240 fps when the camera holds it, never under 120', () => {
    expect(
      cmjCameraFrameRate([
        { min: 1, max: 30 },
        { min: 1, max: 240 },
      ]),
    ).toBe(240);
    expect(
      cmjCameraFrameRate([
        { min: 1, max: 60 },
        { min: 30, max: 120 },
      ]),
    ).toBe(120);
    expect(cmjCameraFrameRate([{ min: 1, max: 60 }])).toBeNull();
  });

  it('declares the SHA-256 the phone computes in hex as base64', () => {
    expect(hexToBase64('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')).toBe(
      '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
    );
    expect(hexToBase64('ff')).toBe('/w==');
    expect(() => hexToBase64('xyz')).toThrow();
  });
});

describe('CMJ by video: the attempt through the queue', () => {
  it('creates the result of the day with the first attempt and adds the next ones', async () => {
    const t = await setup();
    const first = await filmAttempt(t);
    expect(first.mutation.op).toBe('test_session.record_results');
    expect(first.attemptNumber).toBe(1);
    // What the server receives is what its contract accepts.
    expect(SYNC_OPERATION_INPUTS[first.mutation.op].safeParse(first.mutation.input).success).toBe(
      true,
    );
    expect(first.mutation.input).toMatchObject({
      params: { testSessionId: DAY.testSessionId },
      body: {
        results: [
          {
            status: 'done',
            playerId: PLAYER,
            testDefinitionId: DAY.definitionId,
            method: 'video',
            evaluatorId: USER.id,
            entries: [
              {
                kind: 'cmj_video_frames',
                clientUuid: first.capture.id,
                attemptNumber: 1,
                takeoffFrame: 10,
                landingFrame: 130,
                frameRateFps: 240,
              },
            ],
          },
        ],
      },
    });
    // Without signal: the second attempt goes to the result still in the queue.
    const second = await filmAttempt(t);
    expect(second.mutation).toMatchObject({
      op: 'test_result.add_entries',
      input: { target: { clientUuid: first.resultClientUuid } },
    });
    expect(second.attemptNumber).toBe(2);
    expect(await attemptOnServer(t.engine.store, SCOPE.membershipId, second.capture)).toEqual({
      status: 'queued',
    });

    // Synced: the next attempt goes to the served result, after the served attempts.
    await t.engine.syncNow();
    const served = resultDto([videoEntry(first.capture.id, 1), videoEntry(second.capture.id, 2)]);
    t.server.publish(resultChange(served, first.resultClientUuid));
    await t.engine.syncNow();
    const third = await filmAttempt(t);
    expect(third.mutation).toMatchObject({
      op: 'test_result.add_entries',
      input: { target: { id: served.id } },
    });
    expect(third.attemptNumber).toBe(3);
    expect(await attemptOnServer(t.engine.store, SCOPE.membershipId, first.capture)).toEqual({
      status: 'served',
      testResultId: served.id,
      videoFileId: null,
    });
  });

  it('never adds a filmed attempt to a result measured another way (principle 4)', async () => {
    const t = await setup();
    // A CMJ of the day already recorded by hand (flight time), created first.
    const manual = resultDto(
      [
        {
          ...videoEntry(uuid(), 1),
          kind: 'cmj_flight_time',
          inputs: { kind: 'cmj_flight_time', flightTimeS: 0.5 },
        },
      ],
      { method: 'manual', createdAt: '2026-11-03T09:00:00.000Z' },
    );
    t.server.publish(resultChange(manual));
    await t.engine.syncNow();
    const first = await filmAttempt(t);
    expect(first.mutation.op).toBe('test_session.record_results');
    expect(first.attemptNumber).toBe(1);
  });
});

describe('CMJ by video: the upload', () => {
  async function servedAttempt() {
    const t = await setup();
    const { capture, resultClientUuid } = await filmAttempt(t);
    await t.engine.syncNow();
    const served = resultDto([videoEntry(capture.id, 1)]);
    t.server.publish(resultChange(served, resultClientUuid));
    await t.engine.syncNow();
    return { ...t, capture, served };
  }

  it('waits for the attempt to be on the server, then uploads, confirms and frees the phone', async () => {
    const t = await setup();
    const { capture, resultClientUuid } = await filmAttempt(t);
    // Offline: nothing goes up and nothing is asked.
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 1, failed: 0 });
    expect(t.api.requests.filter((r) => r.path.startsWith('/v1/files'))).toEqual([]);

    await t.engine.syncNow();
    const served = resultDto([videoEntry(capture.id, 1)]);
    t.server.publish(resultChange(served, resultClientUuid));
    await t.engine.syncNow();
    fileRoutes(
      t.api,
      () => served.id,
      () => capture.id,
    );
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 1, waiting: 0, failed: 0 });

    const created = t.api.last('POST /v1/files');
    expect(created?.headers['x-membership-id']).toBe(SCOPE.membershipId);
    expect(created?.body).toMatchObject({
      kind: 'cmj_video',
      clientUuid: capture.uploadId,
      playerId: PLAYER,
      testResultId: served.id,
      testEntryId: capture.id,
      contentType: 'video/mp4',
    });
    const declared = created?.body as { sizeBytes: number; checksumSha256: string };
    expect(declared.sizeBytes).toBeGreaterThan(0);
    expect(t.platform.puts).toHaveLength(1);
    expect(t.platform.puts[0]?.headers['x-amz-checksum-sha256']).toBe(SHA);
    expect(t.api.last(`POST /v1/files/${FILE_ID}/confirm`)).toBeDefined();
    // Nothing of the video is left on the phone.
    expect(await t.captures.list(SCOPE)).toEqual([]);
    expect([...t.platform.entries.keys()]).toEqual([]);
  });

  it('keeps the video and backs off when there is no answer', async () => {
    const t = await servedAttempt();
    // No file routes: every request fails like without signal.
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 1, failed: 0 });
    const [waiting] = await t.captures.list(SCOPE);
    expect(waiting?.tries).toBe(1);
    expect(waiting?.nextTryAt).toBe(t.now() + uploadBackoffMs(1));
    expect(waiting?.checksumSha256).not.toBeNull();
    // Not due yet: not tried again.
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 1, failed: 0 });
    expect(t.api.requests.filter((r) => r.path === '/v1/files')).toHaveLength(1);
    t.advance(uploadBackoffMs(1));
    fileRoutes(
      t.api,
      () => t.served.id,
      () => t.capture.id,
    );
    t.platform.answerPut = () => new Error('offline');
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 1, failed: 0 });
    expect((await t.captures.list(SCOPE))[0]?.tries).toBe(2);
    expect(uploadBackoffMs(2)).toBe(60_000);
    expect(uploadBackoffMs(20)).toBe(60 * 60_000);
  });

  it('deletes the video when the image consent is gone, and keeps the attempt', async () => {
    const t = await servedAttempt();
    t.api.on('POST /v1/files', apiError(403, 'forbidden'));
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 0, failed: 1 });
    const [failed] = await t.captures.list(SCOPE);
    expect(failed).toMatchObject({ state: 'failed', failure: 'consent' });
    expect(await t.platform.transfer.exists(t.captures.videoPath(t.capture))).toBe(false);
    // The attempt is still on the result.
    expect(await attemptOnServer(t.engine.store, SCOPE.membershipId, t.capture)).toMatchObject({
      status: 'served',
    });
    // Dismissed by the evaluator: gone.
    if (failed !== undefined) await t.captures.remove(failed);
    expect(await t.captures.list(SCOPE)).toEqual([]);
  });

  it('never uploads the video of a voided attempt', async () => {
    const t = await setup();
    const { capture, resultClientUuid } = await filmAttempt(t);
    await t.engine.syncNow();
    t.server.publish(
      resultChange(
        resultDto([
          videoEntry(capture.id, 1, {
            voided: { at: '2026-11-03T12:30:00.000Z', by: null, reason: 'Mal marcado' },
          }),
        ]),
        resultClientUuid,
      ),
    );
    await t.engine.syncNow();
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 0, failed: 1 });
    expect((await t.captures.list(SCOPE))[0]?.failure).toBe('voided');
    expect(t.api.requests.filter((r) => r.path === '/v1/files')).toEqual([]);
  });

  it('asks for a new upload when the old one closed, and drops a video already up', async () => {
    const t = await servedAttempt();
    t.api.on('POST /v1/files', apiError(409, 'conflict'));
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 1, failed: 0 });
    const [rotated] = await t.captures.list(SCOPE);
    expect(rotated?.uploadId).not.toBe(t.capture.uploadId);
    // With the backoff: an older pending upload of the attempt may still be open.
    expect(rotated?.nextTryAt).toBe(t.now() + uploadBackoffMs(1));
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 1, failed: 0 });
    expect(t.api.requests.filter((r) => r.path === '/v1/files')).toHaveLength(1);
    t.advance(uploadBackoffMs(1));

    // The confirmation's answer was lost, but the pull already shows the video.
    t.server.publish(
      resultChange(
        resultDto([videoEntry(t.capture.id, 1, { videoFileId: FILE_ID as never })], {
          id: t.served.id,
        }),
      ),
    );
    await t.engine.syncNow();
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 1, waiting: 0, failed: 0 });
    expect(await t.captures.list(SCOPE)).toEqual([]);
  });

  it('backs off when the confirmation is refused and gives the video up after a few uploads', async () => {
    const t = await servedAttempt();
    fileRoutes(
      t.api,
      () => t.served.id,
      () => t.capture.id,
    );
    // The bucket never proves the declared content (a provider without the checksum).
    t.api.on(`POST /v1/files/${FILE_ID}/confirm`, apiError(409, 'conflict'));
    for (let refused = 1; refused < MAX_REFUSED_UPLOADS; refused += 1) {
      expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 1, failed: 0 });
      const [waiting] = await t.captures.list(SCOPE);
      // The same upload, asked again later: never a new pending file per try.
      expect(waiting).toMatchObject({ uploadId: t.capture.uploadId, refusedUploads: refused });
      expect(waiting?.nextTryAt).toBe(t.now() + uploadBackoffMs(refused));
      // Not due: no other whole upload in this cycle.
      expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 1, failed: 0 });
      expect(t.platform.puts).toHaveLength(refused);
      t.advance(uploadBackoffMs(refused));
    }
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 0, failed: 1 });
    expect(t.platform.puts).toHaveLength(MAX_REFUSED_UPLOADS);
    expect((await t.captures.list(SCOPE))[0]).toMatchObject({
      state: 'failed',
      failure: 'rejected',
    });
    expect(await t.platform.transfer.exists(t.captures.videoPath(t.capture))).toBe(false);
  });

  it('gives up on an attempt the server never shows, after a day', async () => {
    const t = await setup();
    const { capture } = await filmAttempt(t);
    await t.engine.syncNow();
    // Applied, but the pull never brings it (rejected later, another scope).
    t.advance(3 * 60_000);
    await t.engine.syncNow();
    expect(await attemptOnServer(t.engine.store, SCOPE.membershipId, capture)).toEqual({
      status: 'unknown',
    });
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 1, failed: 0 });
    t.advance(24 * 60 * 60_000);
    expect(await t.uploader.run(SCOPE)).toEqual({ uploaded: 0, waiting: 0, failed: 1 });
  });
});

describe('CMJ by video: on the phone', () => {
  it('drops records it cannot read and videos without a record', async () => {
    const platform = memoryVideoPlatform();
    const captures = createCaptureStore(platform.files);
    const dir = `/cache/cmj-videos/${SCOPE.userId}/${SCOPE.membershipId}`;
    platform.entries.set(`${dir}/broken.json`, '{ not json');
    platform.entries.set(`${dir}/orphan.mp4`, 'bytes');
    expect(await captures.list(SCOPE)).toEqual([]);
    expect([...platform.entries.keys()]).toEqual([]);
    await expect(
      captures.add(
        {
          id: '../../etc',
          uploadId: uuid(),
          userId: SCOPE.userId,
          membershipId: SCOPE.membershipId,
          playerId: PLAYER,
          testSessionId: DAY.testSessionId,
          attemptNumber: 1,
          contentType: 'video/mp4',
          frameRateFps: 240,
          durationMs: 1000,
          recordedAt: T0,
          sizeBytes: null,
          checksumSha256: null,
        },
        '/tmp/x.mp4',
      ),
    ).rejects.toThrow('Unsafe');
  });

  it('never deletes a video being saved when the folder is listed meanwhile', async () => {
    const platform = memoryVideoPlatform();
    const captures = createCaptureStore(platform.files);
    const id = uuid();
    platform.record('/tmp/rec.mp4');
    // The move of the recording takes a while (a big file): a list runs in between.
    const move = platform.files.move.bind(platform.files);
    const listed: Promise<unknown>[] = [];
    platform.files.move = async (from, to) => {
      listed.push(captures.list(SCOPE));
      await new Promise((resolve) => setTimeout(resolve, 5));
      await move(from, to);
    };
    const added = await captures.add(
      {
        id,
        uploadId: uuid(),
        userId: SCOPE.userId,
        membershipId: SCOPE.membershipId,
        playerId: PLAYER,
        testSessionId: DAY.testSessionId,
        attemptNumber: 1,
        contentType: 'video/mp4',
        frameRateFps: 240,
        durationMs: 2000,
        recordedAt: T0,
        sizeBytes: null,
        checksumSha256: null,
      },
      '/tmp/rec.mp4',
    );
    expect(listed).toHaveLength(1);
    expect(await listed[0]).toEqual([added]);
    expect(await platform.transfer.exists(captures.videoPath(added))).toBe(true);
    expect(await captures.list(SCOPE)).toEqual([added]);

    // A recording that cannot be moved leaves no record behind.
    platform.files.move = move;
    await expect(
      captures.add({ ...added, id: uuid(), uploadId: uuid() }, '/tmp/missing.mp4'),
    ).rejects.toThrow('No such file');
    expect(await captures.list(SCOPE)).toEqual([added]);
  });

  it('saves through the service, uploads after a sync and wipes on sign-out', async () => {
    const t = await setup();
    const session = fakeSession(signedIn());
    const service = createCmjVideoService({
      platform: t.platform,
      sync: t.engine,
      session,
      api: t.client,
      randomUUID: uuid,
      now: t.now,
      reportError: (error) => t.errors.push(error),
      setTimeout: () => 0,
      clearTimeout: () => undefined,
    });
    cleanups.push(() => {
      service.dispose();
    });
    let changes = 0;
    service.subscribe(() => {
      changes += 1;
    });
    t.platform.record('/tmp/rec.mp4');
    const saved = await service.saveJump({
      scope: SCOPE,
      day: DAY,
      playerId: PLAYER,
      jump: {
        takeoffFrame: 12,
        landingFrame: 128,
        frameRateFps: 240,
        recordedAt: new Date(T0).toISOString(),
      },
      video: { path: '/tmp/rec.mp4', contentType: 'video/mp4', durationMs: 2500 },
    });
    expect(saved.attemptNumber).toBe(1);
    expect(changes).toBeGreaterThan(0);
    const [queued] = await t.engine.store.pending(SCOPE.membershipId);
    expect(queued?.op).toBe('test_session.record_results');
    expect(await service.list(SCOPE)).toHaveLength(1);
    expect(t.platform.entries.has('/tmp/rec.mp4')).toBe(false);

    // The sync brings the attempt: the video goes up on its own.
    const input = queued?.input as { body: { results: { clientUuid: string }[] } };
    await t.engine.syncNow();
    const served = resultDto([videoEntry(saved.attemptId, 1)]);
    t.server.publish(resultChange(served, input.body.results[0]?.clientUuid ?? null));
    fileRoutes(
      t.api,
      () => served.id,
      () => saved.attemptId,
    );
    await t.engine.syncNow();
    await expect.poll(() => service.list(SCOPE)).toEqual([]);
    expect(t.platform.puts).toHaveLength(1);

    // Another video waits; signing out on purpose deletes it from the phone.
    t.platform.record('/tmp/rec2.mp4');
    await service.saveJump({
      scope: SCOPE,
      day: DAY,
      playerId: PLAYER,
      jump: {
        takeoffFrame: 1,
        landingFrame: 100,
        frameRateFps: 240,
        recordedAt: new Date(T0).toISOString(),
      },
      video: { path: '/tmp/rec2.mp4', contentType: 'video/mp4', durationMs: 2500 },
    });
    expect(await service.list(SCOPE)).toHaveLength(1);
    session.set({ status: 'signedOut', notice: null });
    await expect.poll(() => [...t.platform.entries.keys()]).toEqual([]);
  });
});
