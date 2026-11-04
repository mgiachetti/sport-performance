import type { SyncEngine } from '../offline/engine.ts';
import type { SessionController, SessionState } from '../state/session-controller.ts';
import {
  cmjAttemptMutation,
  nextAttemptNumber,
  type CmjAttemptMutationOf,
  type CmjAttemptOp,
  playerCmjAttempts,
  type CmjVideoDay,
  type MarkedJump,
} from './attempt.ts';
import {
  createCaptureStore,
  type CaptureScope,
  type CmjVideoCapture,
  type CmjVideoContentType,
  type VideoFileSystem,
} from './captures.ts';
import { createCmjVideoUploader, type VideoTransfer } from './uploader.ts';

/**
 * CMJ by video on the phone (B-604, ADR 0085): saving a marked jump writes
 * its attempt through the offline queue and keeps the video until it goes
 * up. Uploads run after every sync cycle (an attempt that just reached the
 * server takes its video right away), when a jump is saved and when their
 * backoff is due. The videos belong to the user and the membership that
 * filmed them: signing out on purpose deletes all of them; another user
 * signing in deletes the previous one's (as the local database, ADR 0069).
 */

/** The platform of the CMJ videos: the file system and the transfer of the bytes. */
export interface CmjVideoPlatform {
  readonly files: VideoFileSystem;
  readonly transfer: VideoTransfer;
}

export interface RecordedVideo {
  /** Where the camera left it (a temporary file). */
  readonly path: string;
  readonly contentType: CmjVideoContentType;
  readonly durationMs: number;
}

export interface SaveJumpInput {
  readonly scope: CaptureScope;
  readonly day: CmjVideoDay;
  readonly playerId: string;
  readonly jump: Omit<MarkedJump, 'attemptNumber' | 'attemptId'>;
  readonly video: RecordedVideo;
}

export interface CmjVideoService {
  /**
   * Queues the attempt (added to the player's result of the day, or a new
   * one) and keeps its video for the upload. Returns the attempt number.
   */
  saveJump(
    input: SaveJumpInput,
  ): Promise<{ readonly attemptNumber: number; readonly attemptId: string }>;
  /** The videos of the membership on this phone (waiting or failed). */
  list(scope: CaptureScope): Promise<CmjVideoCapture[]>;
  /** Drops a failed capture from the list. */
  dismiss(capture: CmjVideoCapture): Promise<void>;
  /** Deletes a recording that was not saved (the evaluator discarded it). */
  discardRecording(path: string): Promise<void>;
  /** Runs the uploads of the active membership (single-flight). */
  requestUpload(): void;
  /** Changes whenever the list may have changed. */
  readonly subscribe: (listener: () => void) => () => void;
  readonly getVersion: () => number;
  dispose(): void;
}

export interface CmjVideoServiceOptions {
  readonly platform: CmjVideoPlatform;
  readonly sync: SyncEngine;
  readonly session: Pick<SessionController, 'getState' | 'subscribe'>;
  readonly api: Parameters<typeof createCmjVideoUploader>[0]['api'];
  readonly randomUUID: () => string;
  readonly now?: () => number;
  readonly reportError: (error: unknown) => void;
  /** Timers (fakes in tests). */
  readonly setTimeout?: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
}

function scopeOf(state: SessionState): CaptureScope | null {
  if (state.status !== 'signedIn' || state.activeMembership === null) return null;
  return { userId: state.user.id, membershipId: state.activeMembership.id };
}

const MAX_TIMER_MS = 60 * 60_000;

export function createCmjVideoService(options: CmjVideoServiceOptions): CmjVideoService {
  const { platform, sync, session, randomUUID, reportError } = options;
  const now = options.now ?? Date.now;
  const schedule = options.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
  const cancel =
    options.clearTimeout ??
    ((handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  const captures = createCaptureStore(platform.files);
  const uploader = createCmjVideoUploader({
    captures,
    store: sync.store,
    api: options.api,
    transfer: platform.transfer,
    randomUUID,
    now,
    reportError,
  });
  const listeners = new Set<() => void>();
  let version = 0;
  let timer: unknown = null;
  let disposed = false;
  // Uploads and wipes run one after the other: a wipe never races an upload that would
  // write the record of a deleted video back.
  let chain: Promise<unknown> = Promise.resolve();

  function changed(): void {
    version += 1;
    for (const listener of listeners) listener();
  }

  function enqueueWork<T>(task: () => Promise<T>): Promise<T> {
    const next = chain.then(task);
    chain = next.catch(() => undefined);
    return next;
  }

  async function scheduleNext(scope: CaptureScope): Promise<void> {
    const due = (await captures.list(scope))
      .filter((capture) => capture.state === 'waiting' && capture.nextTryAt !== null)
      .map((capture) => capture.nextTryAt ?? 0);
    if (timer !== null) cancel(timer);
    timer = null;
    if (due.length === 0 || disposed) return;
    const waitMs = Math.min(Math.max(0, Math.min(...due) - now()), MAX_TIMER_MS);
    timer = schedule(() => {
      timer = null;
      requestUpload();
    }, waitMs);
  }

  function requestUpload(): void {
    const scope = scopeOf(session.getState());
    if (scope === null || disposed) return;
    enqueueWork(async () => {
      // The scope may have changed while waiting in line.
      const current = scopeOf(session.getState());
      if (current?.membershipId !== scope.membershipId || current.userId !== scope.userId) return;
      const result = await uploader.run(scope);
      if (result.uploaded > 0 || result.failed > 0) changed();
      await scheduleNext(scope);
    }).catch(reportError);
  }

  // Same rules as the local database (`bindSyncToSession`).
  let previous: SessionState = session.getState();
  function onSession(state: SessionState): void {
    if (state.status === 'starting') return;
    const signedOutOnPurpose =
      state.status === 'signedOut' &&
      state.notice === null &&
      (previous.status === 'signedIn' || previous.status === 'unavailable');
    const userChanged =
      state.status === 'signedIn' &&
      (previous.status !== 'signedIn' || previous.user.id !== state.user.id);
    previous = state;
    if (signedOutOnPurpose) {
      if (timer !== null) cancel(timer);
      timer = null;
      enqueueWork(() => captures.wipe(null))
        .then(changed)
        .catch(reportError);
    } else if (userChanged) {
      const keep = state.user.id;
      enqueueWork(() => captures.wipe(keep))
        .then(changed)
        .catch(reportError);
    }
    if (scopeOf(state) !== null) requestUpload();
  }
  onSession(previous);
  const unsubscribeSession = session.subscribe(() => {
    onSession(session.getState());
  });
  // A cycle that ends may have brought the attempt of a waiting video.
  let lastPhase = sync.getStatus().phase;
  const unsubscribeSync = sync.subscribe(() => {
    const { phase } = sync.getStatus();
    if (phase === 'idle' && lastPhase === 'syncing') requestUpload();
    lastPhase = phase;
  });

  /** One call for either operation (the op and its input go together). */
  function enqueueAttempt<Op extends CmjAttemptOp>(mutation: CmjAttemptMutationOf<Op>) {
    return sync.enqueue(mutation.op, mutation.input);
  }

  return {
    async saveJump({ scope, day, playerId, jump, video }) {
      const attempts = await playerCmjAttempts(sync.store, scope.membershipId, day, playerId);
      const attemptNumber = nextAttemptNumber(attempts.attemptNumbers);
      const attemptId = randomUUID();
      const mutation = cmjAttemptMutation({
        day,
        playerId,
        evaluatorId: scope.userId,
        target: attempts.target,
        jump: { ...jump, attemptId, attemptNumber },
        resultClientUuid: randomUUID(),
      });
      // The measurement first: if the app dies right after, the attempt is kept (the video
      // stays in the camera's temporary folder and the system clears it).
      await enqueueAttempt(mutation);
      try {
        await captures.add(
          {
            id: attemptId,
            uploadId: randomUUID(),
            userId: scope.userId,
            membershipId: scope.membershipId,
            playerId,
            testSessionId: day.testSessionId,
            attemptNumber,
            contentType: video.contentType,
            frameRateFps: jump.frameRateFps,
            durationMs: video.durationMs,
            recordedAt: Date.parse(jump.recordedAt),
            sizeBytes: null,
            checksumSha256: null,
          },
          video.path,
        );
      } catch (error) {
        // The attempt is saved: saving it again would duplicate it. Only its video is lost.
        reportError(error);
        await platform.files.remove(video.path).catch(() => undefined);
      }
      changed();
      requestUpload();
      return { attemptNumber, attemptId };
    },
    list: (scope) => captures.list(scope),
    async dismiss(capture) {
      await captures.remove(capture);
      changed();
    },
    discardRecording: (path) => platform.files.remove(path),
    requestUpload,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => version,
    dispose() {
      disposed = true;
      if (timer !== null) cancel(timer);
      unsubscribeSession();
      unsubscribeSync();
    },
  };
}
