import {
  SYNC_OPERATION_INPUTS,
  createApiClient,
  type SyncChange,
  type TestDaySheet,
  type TestResult,
} from '@sport-performance/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_TOKEN_KEY } from '../auth/session-store.ts';
import { openLocalDatabase } from '../offline/db/database.ts';
import { createSyncEngine } from '../offline/engine.ts';
import { createFakeApi } from '../test/fake-api.ts';
import { T0, createFakeSyncServer, uuid } from '../test/fake-sync-server.ts';
import {
  COACH_AT_ORC,
  SESSION_TOKEN,
  USER,
  membership,
  signedInRoutes,
  testServices,
} from '../test/fixtures.ts';
import { memorySprintVideoFiles } from '../test/memory-sprint-videos.ts';
import { nodeSqliteDriver } from '../test/node-sqlite.ts';
import {
  canFilmSprint,
  filmingBlock,
  nextAttemptNumber,
  playerSprintAttempts,
  sprintAttemptMutation,
  sprintVideoDayOf,
  sprintVideoPlayersOf,
  type SprintVideoDay,
  type SprintVideoPlayer,
} from './attempt.ts';
import { sprintCameraFrameRate } from './camera.ts';
import { mainCameraMinDistanceM, parseLayoutDraft } from './layout.ts';
import {
  frameTimeMs,
  implausibleSprintValues,
  initialSprintMarking,
  sprintMarkingReducer,
  sprintMarkingResult,
  type SprintMarkingAction,
  type SprintMarkingState,
} from './marking.ts';
import { createSprintRecordings } from './recordings.ts';
import { saveSprintAttempt } from './save.ts';

const SC_AT_ORC = membership('a4444444-4444-4444-8444-444444444444', 'sc');
const SCOPE = { userId: USER.id, membershipId: SC_AT_ORC.id };
const PLAYER = 'b2222222-2222-4222-8222-222222222222';
const DAY: SprintVideoDay = {
  testSessionId: 'c2222222-2222-4222-8222-222222222222',
  scheduledOn: '2026-11-03',
  definitionId: 'd2222222-2222-4222-8222-222222222222',
  protocolVersion: 1,
  attemptCount: 3,
};
const MARKS = { startFrame: 120, frame10: 552, frame20: 888, frame40: 1488 };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function run(state: SprintMarkingState, ...actions: SprintMarkingAction[]): SprintMarkingState {
  return actions.reduce(sprintMarkingReducer, state);
}

function sheetOf(entryKinds: string[], playerOverrides: Record<string, unknown> = {}) {
  return {
    testSession: { id: DAY.testSessionId, scheduledOn: DAY.scheduledOn },
    stations: [
      {
        testCode: 'sprint_40',
        scheduled: true,
        definition: { id: DAY.definitionId, version: 1, attemptCount: 3, entryKinds },
      },
    ],
    players: [
      {
        id: PLAYER,
        firstName: 'Juan',
        lastName: 'Díaz',
        sex: 'male',
        recording: 'allowed',
        video: 'allowed',
        tests: [{ testCode: 'sprint_40', applicable: true, reason: null }],
        ...playerOverrides,
      },
    ],
  } as unknown as TestDaySheet;
}

function resultDto(entries: TestResult['entries'], overrides: Partial<TestResult> = {}) {
  return {
    id: uuid(),
    playerId: PLAYER,
    testDefinitionId: DAY.definitionId,
    testCode: 'sprint_40',
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

function videoEntry(attemptNumber: number, voided = false): TestResult['entries'][number] {
  return {
    id: uuid(),
    kind: 'sprint_video_frames',
    attemptNumber,
    recordedAt: '2026-11-03T12:00:00.000Z',
    inputs: { kind: 'sprint_video_frames', ...MARKS, frameRateFps: 240 },
    values: [],
    issues: [],
    voided: voided ? { at: '2026-11-03T12:05:00.000Z', by: USER.id, reason: 'Mal marcado' } : null,
    videoFileId: null,
  } as unknown as TestResult['entries'][number];
}

function upsertResult(result: TestResult, clientUuid: string | null = null): SyncChange {
  return {
    collection: 'test_result',
    op: 'upsert',
    id: result.id,
    clientUuid,
    data: result,
  } as SyncChange;
}

async function setup() {
  const api = createFakeApi();
  const server = createFakeSyncServer(api);
  const client = createApiClient({ baseUrl: api.baseUrl, fetch: api.fetch });
  const database = await openLocalDatabase(nodeSqliteDriver());
  const errors: unknown[] = [];
  const engine = createSyncEngine({
    database,
    api: client,
    randomUUID: uuid,
    now: () => T0,
    random: () => 0.5,
    setTimer: () => 0,
    clearTimer: () => undefined,
    reportError: (error) => errors.push(error),
  });
  await engine.setScope(SCOPE);
  const videos = memorySprintVideoFiles();
  const recordings = createSprintRecordings(videos.directory);
  cleanups.push(() => {
    engine.dispose();
  });
  return { api, server, engine, videos, recordings, errors };
}

/** Films a sprint and takes the video into the directory, as the route does. */
async function film(t: Awaited<ReturnType<typeof setup>>) {
  const cameraPath = `/tmp/camera/${uuid()}.mov`;
  t.videos.record(cameraPath);
  const path = await t.recordings.adopt(cameraPath, uuid());
  return { path, durationMs: 9_000, frameRateFps: 240 };
}

function save(
  t: Awaited<ReturnType<typeof setup>>,
  video: { path: string; durationMs: number; frameRateFps: number },
  marks: { startFrame: number; frame10: number | null; frame20: number; frame40: number } = MARKS,
) {
  return saveSprintAttempt({
    sync: t.engine,
    recordings: t.recordings,
    membershipId: SCOPE.membershipId,
    evaluatorId: USER.id,
    day: DAY,
    playerId: PLAYER,
    video,
    marks,
    recordedUntilMs: T0,
    randomUUID: uuid,
    reportError: (error) => t.errors.push(error),
  });
}

describe('sprint by video: who films and whom', () => {
  it('is for whoever records results and may film the players', () => {
    expect(canFilmSprint('sc')).toBe(true);
    expect(canFilmSprint('admin')).toBe(true);
    for (const role of ['coach', 'player', 'parent', 'medical'] as const) {
      expect(canFilmSprint(role), role).toBe(false);
    }
  });

  it('never films a player without image consent', () => {
    const player: SprintVideoPlayer = {
      id: PLAYER,
      name: 'Díaz, Juan',
      sex: 'male',
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

  it('reads the day and the players from the sheet', () => {
    expect(sprintVideoDayOf(sheetOf(['sprint_splits', 'sprint_video_frames', 'value']))).toEqual(
      DAY,
    );
    // A protocol version that does not take video frames has no sprint by video.
    expect(sprintVideoDayOf(sheetOf(['sprint_splits', 'value']))).toBeNull();
    expect(
      sprintVideoPlayersOf(sheetOf(['sprint_video_frames'], { video: 'missing_consent' })),
    ).toEqual([
      {
        id: PLAYER,
        name: 'Díaz, Juan',
        sex: 'male',
        recording: 'allowed',
        video: 'missing_consent',
        applicable: true,
      },
    ]);
  });
});

describe('sprint by video: the camera and the layout', () => {
  it('films at 240 fps when it can and never under 120', () => {
    expect(
      sprintCameraFrameRate([
        { min: 1, max: 30 },
        { min: 1, max: 240 },
      ]),
    ).toBe(240);
    expect(
      sprintCameraFrameRate([
        { min: 1, max: 60 },
        { min: 120, max: 120 },
      ]),
    ).toBe(120);
    expect(sprintCameraFrameRate([{ min: 1, max: 60 }])).toBeNull();
  });

  it('turns what the evaluator typed into where the cones go', () => {
    const ok = parseLayoutDraft({ cameraDistance: '30', poleOffset: '1,5' });
    expect(ok.status).toBe('ok');
    if (ok.status !== 'ok') return;
    expect(ok.layout.poles.map((p) => p.poleAtM)).toEqual([-1, 9.5, 20, 41]);
    expect(parseLayoutDraft({ cameraDistance: '30.5', poleOffset: '1' })).toEqual({
      status: 'problems',
      cameraDistance: 'invalid',
      poleOffset: null,
    });
    expect(parseLayoutDraft({ cameraDistance: '2', poleOffset: '20' })).toEqual({
      status: 'problems',
      cameraDistance: 'out_of_range',
      poleOffset: 'out_of_range',
    });
    // 20 m on each side with a 60° camera: 20 / tan 30° ≈ 34,6 m.
    expect(mainCameraMinDistanceM()).toBe(35);
  });
});

describe('sprint by video: the marking', () => {
  it('marks the lines in order and gives the splits, the Vmax and the precision', () => {
    let state = initialSprintMarking(9_000, 240);
    expect(state.frameCount).toBe(2160);
    expect(sprintMarkingResult(state)).toEqual({ status: 'incomplete' });
    state = run(
      state,
      { type: 'seek', frame: 120 },
      { type: 'mark' },
      { type: 'step', delta: 432 },
      { type: 'mark' },
      { type: 'step', delta: 336 },
      { type: 'mark' },
      { type: 'step', delta: 600 },
      { type: 'mark' },
    );
    expect(state.marks).toEqual({ start: 120, line10: 552, line20: 888, line40: 1488 });
    const result = sprintMarkingResult(state);
    expect(result.status).toBe('measured');
    if (result.status !== 'measured') return;
    expect(result.splits).toEqual({ split10S: 1.8, split20S: 3.2, split40S: 5.7 });
    expect(result.vmaxMs).toBeCloseTo(8, 10);
    expect(result.splitPrecisionS).toBeCloseTo(1 / 240, 12);
    expect(implausibleSprintValues(result, 'male')).toEqual([]);
    // The image is asked at the middle of the frame.
    expect(frameTimeMs(run(state, { type: 'go_to', mark: 'start' }))).toBeCloseTo(502.083, 3);
  });

  it('skips the 10 m mark, which is optional, and keeps frames in the video', () => {
    let state = run(
      initialSprintMarking(2_000, 120),
      { type: 'step', delta: -10 },
      { type: 'mark' },
      { type: 'select', mark: 'line20' },
      { type: 'step', delta: 60 },
      { type: 'mark' },
    );
    expect(state.frame).toBe(60);
    expect(state.current).toBe('line40');
    state = run(state, { type: 'step', delta: 10_000 }, { type: 'mark' });
    expect(state.marks).toEqual({ start: 0, line10: null, line20: 60, line40: 239 });
    const result = sprintMarkingResult(state);
    expect(result.status === 'measured' && result.splits.split10S).toBeUndefined();
  });

  it('says when the marks are out of order and lets one be redone', () => {
    let state = run(
      initialSprintMarking(9_000, 240),
      { type: 'seek', frame: 500 },
      { type: 'mark' },
      { type: 'seek', frame: 400 },
      { type: 'mark' },
      { type: 'seek', frame: 900 },
      { type: 'mark' },
      { type: 'seek', frame: 1500 },
      { type: 'mark' },
    );
    expect(sprintMarkingResult(state)).toEqual({ status: 'invalid' });
    state = run(state, { type: 'clear', mark: 'line10' });
    expect(state.current).toBe('line10');
    expect(sprintMarkingResult(state).status).toBe('measured');
    // Going to a mark shows its frame and makes it the one the next press redoes.
    state = run(
      state,
      { type: 'go_to', mark: 'line20' },
      { type: 'step', delta: 1 },
      { type: 'mark' },
    );
    expect(state.marks.line20).toBe(901);
  });

  it('warns of values out of the plausible range', () => {
    const result = sprintMarkingResult(
      run(
        initialSprintMarking(20_000, 240),
        { type: 'mark' },
        { type: 'select', mark: 'line20' },
        { type: 'seek', frame: 2400 },
        { type: 'mark' },
        { type: 'seek', frame: 3600 },
        { type: 'mark' },
      ),
    );
    if (result.status !== 'measured') throw new Error(result.status);
    // A 20 m in 10 s is not a sprint: the marks are probably wrong.
    expect(implausibleSprintValues(result, 'male')).toContain('sprint_20_s');
  });
});

describe('sprint by video: the temporary videos', () => {
  it('takes the recording of the camera and deletes it on discard and on sweep', async () => {
    const videos = memorySprintVideoFiles();
    const recordings = createSprintRecordings(videos.directory);
    videos.record('/tmp/camera/a.MOV');
    videos.record('/tmp/camera/b.mp4');
    const a = await recordings.adopt('/tmp/camera/a.MOV', 'attempt-a');
    expect(a).toBe('/cache/sprint-videos/attempt-a.mov');
    const b = await recordings.adopt('/tmp/camera/b.mp4', 'attempt-b');
    expect(videos.files()).toEqual([a, b]);
    await recordings.discard(a);
    expect(videos.files()).toEqual([b]);
    // Nothing outside the directory is ever deleted from here.
    videos.record('/documents/other.mp4');
    await recordings.discard('/documents/other.mp4');
    await recordings.discard('/cache/sprint-videos/../other.mp4');
    expect(videos.files()).toEqual(['/cache/sprint-videos/attempt-b.mp4', '/documents/other.mp4']);
    await recordings.sweep();
    expect(videos.files()).toEqual(['/documents/other.mp4']);
  });

  it('are swept at launch and when the user or the club changes', async () => {
    const { api, sprintVideos, services } = testServices({
      secure: { [SESSION_TOKEN_KEY]: SESSION_TOKEN },
    });
    cleanups.push(() => {
      services.dispose();
    });
    signedInRoutes(api, [SC_AT_ORC, COACH_AT_ORC]);
    await services.session.start();
    await services.session.selectMembership(SC_AT_ORC.id);
    sprintVideos.record('/cache/sprint-videos/being-marked.mp4');
    await services.session.selectMembership(COACH_AT_ORC.id);
    await vi.waitFor(() => {
      expect(sprintVideos.files()).toEqual([]);
    });
    sprintVideos.record('/cache/sprint-videos/being-marked.mp4');
    api.on('POST /v1/auth/sign-out', { status: 204 });
    await services.session.signOut();
    await vi.waitFor(() => {
      expect(sprintVideos.files()).toEqual([]);
    });
  });

  it('a video left by a crash is gone at launch', async () => {
    const { sprintVideos, services } = testServices({
      sprintVideos: ['/cache/sprint-videos/left-by-a-crash.mp4'],
    });
    cleanups.push(() => {
      services.dispose();
    });
    await vi.waitFor(() => {
      expect(sprintVideos.files()).toEqual([]);
    });
  });
});

describe('sprint by video: saving the attempt', () => {
  it('queues a new result with the frames and deletes the video', async () => {
    const t = await setup();
    const video = await film(t);
    expect(await save(t, video)).toBe(1);
    expect(t.videos.files()).toEqual([]);
    const [queued] = await t.engine.store.pending(SCOPE.membershipId, [
      'test_session.record_results',
    ]);
    expect(queued?.input).toEqual(
      SYNC_OPERATION_INPUTS['test_session.record_results'].parse(queued?.input),
    );
    const result = queued?.input.body.results[0];
    expect(result).toMatchObject({
      status: 'done',
      playerId: PLAYER,
      testDefinitionId: DAY.definitionId,
      method: 'video',
      evaluatorId: USER.id,
      entries: [
        {
          kind: 'sprint_video_frames',
          attemptNumber: 1,
          ...MARKS,
          frameRateFps: 240,
          recordedAt: new Date(T0 - 9_000).toISOString(),
        },
      ],
    });
    expect(queued?.input.params.testSessionId).toBe(DAY.testSessionId);
  });

  it('adds the next attempts to the result still in the queue, without the 10 m', async () => {
    const t = await setup();
    await save(t, await film(t));
    expect(await save(t, await film(t), { ...MARKS, frame10: null })).toBe(2);
    const queue = await t.engine.store.pending(SCOPE.membershipId);
    expect(queue.map((m) => m.op)).toEqual([
      'test_session.record_results',
      'test_result.add_entries',
    ]);
    const created = queue[0]?.input as { body: { results: { clientUuid: string }[] } };
    const added = queue[1]?.input as {
      target: { clientUuid: string };
      body: { entries: Record<string, unknown>[] };
    };
    expect(added.target).toEqual({ clientUuid: created.body.results[0]?.clientUuid });
    expect(added.body.entries[0]).toMatchObject({ attemptNumber: 2, kind: 'sprint_video_frames' });
    expect(added.body.entries[0]).not.toHaveProperty('frame10');
    const attempts = await playerSprintAttempts(t.engine.store, SCOPE.membershipId, DAY, PLAYER);
    expect(attempts.attemptNumbers).toEqual([1, 2]);
    expect(nextAttemptNumber(attempts.takenNumbers)).toBe(3);
  });

  it('adds to the result the server already has, after its valid attempts', async () => {
    const t = await setup();
    const served = resultDto([videoEntry(1), videoEntry(2, true), videoEntry(3)]);
    t.server.publish(
      upsertResult(served),
      // Another result of the day for another test, or another player, is left alone.
      upsertResult(
        resultDto([videoEntry(1)], {
          testDefinitionId: uuid() as TestResult['testDefinitionId'],
          id: uuid() as TestResult['id'],
        }),
      ),
    );
    await t.engine.syncNow();
    const attempts = await playerSprintAttempts(t.engine.store, SCOPE.membershipId, DAY, PLAYER);
    expect(attempts).toEqual({
      target: { kind: 'served', id: served.id },
      attemptNumbers: [1, 3],
      // The voided attempt keeps its number: the next one is never a second "3".
      takenNumbers: [1, 2, 3],
    });
    expect(await save(t, await film(t))).toBe(4);
    const [queued] = await t.engine.store.pending(SCOPE.membershipId, ['test_result.add_entries']);
    expect(queued?.input.target).toEqual({ id: served.id });
  });

  it('never adds to an unsynced sprint of the player from another test day', async () => {
    const t = await setup();
    const otherDay: SprintVideoDay = {
      ...DAY,
      testSessionId: uuid(),
      scheduledOn: '2026-10-27',
    };
    const other = sprintAttemptMutation({
      day: otherDay,
      playerId: PLAYER,
      evaluatorId: USER.id,
      target: { kind: 'none' },
      resultClientUuid: uuid(),
      sprint: {
        attemptId: uuid(),
        attemptNumber: 1,
        ...MARKS,
        frameRateFps: 240,
        recordedAt: '2026-10-27T12:00:00.000Z',
      },
    });
    if (other.op !== 'test_session.record_results') throw new Error(other.op);
    await t.engine.enqueue(other.op, other.input);
    // Also a result created on its own for that other day.
    const created = other.input.body.results[0];
    if (created === undefined) throw new Error('no result');
    await t.engine.enqueue('test_result.create', {
      body: { ...created, clientUuid: uuid(), testSessionId: otherDay.testSessionId },
    });
    expect(await playerSprintAttempts(t.engine.store, SCOPE.membershipId, DAY, PLAYER)).toEqual({
      target: { kind: 'none' },
      attemptNumbers: [],
      takenNumbers: [],
    });
    expect(await save(t, await film(t))).toBe(1);
    const queue = await t.engine.store.pending(SCOPE.membershipId);
    expect(queue.map((m) => m.op)).toEqual([
      'test_session.record_results',
      'test_result.create',
      'test_session.record_results',
    ]);
    const mine = queue[2]?.input as { params: { testSessionId: string } };
    expect(mine.params.testSessionId).toBe(DAY.testSessionId);
  });

  it('keeps the video when the attempt could not be queued', async () => {
    const t = await setup();
    const video = await film(t);
    await t.engine.setScope(null);
    await expect(save(t, video)).rejects.toThrow();
    expect(t.videos.files()).toEqual([video.path]);
  });
});
