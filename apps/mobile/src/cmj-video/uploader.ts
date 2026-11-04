import {
  ApiContractError,
  ApiError,
  MEMBERSHIP_HEADER,
  type ApiClient,
  type CreatedFile,
} from '@sport-performance/contracts';
import { FILE_KIND_POLICIES } from '@sport-performance/domain';
import type { LocalStore } from '../offline/local-store.ts';
import { attemptOnServer } from './attempt.ts';
import type { CaptureScope, CaptureStore, CmjVideoCapture } from './captures.ts';

/**
 * Uploads the CMJ videos filmed on the phone (B-604, ADR 0085), each once
 * its attempt is on the server: `POST /v1/files` with a stable `clientUuid`
 * (the capture's `uploadId`) and the attempt, the bytes straight to the
 * bucket with the signed `PUT` (type, size and SHA-256 signed), then the
 * confirmation. The video leaves the phone when the server confirms it.
 *
 * - Without an answer (no signal, a server failing) it waits and tries again
 *   with backoff (30 s doubling up to an hour).
 * - `403` (the image consent was revoked, the player left the scope), a
 *   voided attempt, an attempt or video the server refuses: the video is
 *   deleted from the phone and the capture shows why. The attempt stays.
 * - A signed URL that expired (the upload window is 24 h) is asked again
 *   with a new `clientUuid`: the pending file of the old one expires alone.
 * - Every `409` waits with the same backoff. A confirmation refused because
 *   the bucket does not hold the declared video costs a whole upload: after
 *   `MAX_REFUSED_UPLOADS` of them the video is given up (`rejected`).
 */

/** What the device does with the bytes (`expo-file-system` and `@noble/hashes` on the phone). */
export interface VideoTransfer {
  /** SHA-256 (base64) and size in bytes of a file, read in chunks. */
  digest(path: string): Promise<{ readonly checksumSha256: string; readonly sizeBytes: number }>;
  /** `PUT` of a file to a signed URL with its headers; the HTTP status (throws without an answer). */
  put(request: {
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly path: string;
  }): Promise<number>;
  /** Whether the file is still there. */
  exists(path: string): Promise<boolean>;
}

export interface CmjVideoUploaderOptions {
  readonly captures: CaptureStore;
  readonly store: LocalStore;
  readonly api: Pick<ApiClient, 'createFileUpload' | 'confirmFileUpload'>;
  readonly transfer: VideoTransfer;
  readonly randomUUID: () => string;
  readonly now?: () => number;
  readonly reportError: (error: unknown) => void;
}

export interface UploadRunResult {
  readonly uploaded: number;
  readonly waiting: number;
  readonly failed: number;
}

/** First retry after 30 s, doubling to an hour. */
export function uploadBackoffMs(tries: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, tries - 1), 60 * 60_000);
}

/** An attempt that never shows up on the server after a day: rejected by the queue (a sync issue says why). */
const UNKNOWN_ATTEMPT_GIVE_UP_MS = 24 * 60 * 60_000;

const MAX_SIZE_BYTES = FILE_KIND_POLICIES.cmj_video.maxSizeBytes;

/** Confirmations refused (`409`) before the video is given up: each one cost a whole upload. */
export const MAX_REFUSED_UPLOADS = 3;

type Outcome = 'uploaded' | 'waiting' | 'failed';

export interface CmjVideoUploader {
  /** One pass over the videos of the membership that are due; never two at once. */
  run(scope: CaptureScope): Promise<UploadRunResult>;
}

export function createCmjVideoUploader(options: CmjVideoUploaderOptions): CmjVideoUploader {
  const { captures, store, api, transfer, randomUUID, reportError } = options;
  const now = options.now ?? Date.now;
  let running: Promise<UploadRunResult> | null = null;

  async function retryLater(capture: CmjVideoCapture): Promise<Outcome> {
    const tries = capture.tries + 1;
    await captures.update({ ...capture, tries, nextTryAt: now() + uploadBackoffMs(tries) });
    return 'waiting';
  }

  /** Not the caller's network: the answer says the video will not go up as it is. */
  async function refused(
    capture: CmjVideoCapture,
    error: ApiError,
    step: 'create' | 'confirm',
  ): Promise<Outcome> {
    if (error.code === 'forbidden') {
      await captures.fail(capture, 'consent');
      return 'failed';
    }
    if (error.code === 'validation_failed' || error.code === 'not_found') {
      await captures.fail(capture, 'rejected');
      return 'failed';
    }
    if (error.code === 'conflict' && step === 'confirm') {
      // The server holds bytes that are not the declared video (and deleted them), or none:
      // every new try sends the whole video again, so it backs off and gives up after a few.
      const refusedUploads = capture.refusedUploads + 1;
      if (refusedUploads >= MAX_REFUSED_UPLOADS) {
        await captures.fail(capture, 'rejected');
        return 'failed';
      }
      // Same clientUuid: asking again signs a new `PUT` for the same pending file.
      return retryLater({ ...capture, refusedUploads });
    }
    if (error.code === 'conflict') {
      // The clientUuid belongs to an upload that closed or differs, or an older pending
      // upload of the attempt is still open (it expires in a day): a new clientUuid, later.
      return retryLater({ ...capture, uploadId: randomUUID() });
    }
    return retryLater(capture);
  }

  function isRetryable(error: unknown): boolean {
    if (!(error instanceof ApiError)) return true;
    return error.status >= 500 || error.status === 429 || error.status === 408;
  }

  async function uploadOne(scope: CaptureScope, initial: CmjVideoCapture): Promise<Outcome> {
    let capture = initial;
    const attempt = await attemptOnServer(store, scope.membershipId, capture);
    if (attempt.status === 'queued') return 'waiting';
    if (attempt.status === 'voided') {
      await captures.fail(capture, 'voided');
      return 'failed';
    }
    if (attempt.status === 'unknown') {
      if (now() - capture.recordedAt < UNKNOWN_ATTEMPT_GIVE_UP_MS) return 'waiting';
      await captures.fail(capture, 'rejected');
      return 'failed';
    }
    if (attempt.videoFileId !== null) {
      // Already up (a confirmation whose answer was lost): nothing left on the phone.
      await captures.remove(capture);
      return 'uploaded';
    }
    const path = captures.videoPath(capture);
    if (!(await transfer.exists(path))) {
      await captures.fail(capture, 'missing_file');
      return 'failed';
    }
    if (capture.checksumSha256 === null || capture.sizeBytes === null) {
      const digest = await transfer.digest(path);
      capture = { ...capture, ...digest };
      await captures.update(capture);
    }
    const sizeBytes = capture.sizeBytes ?? 0;
    const checksumSha256 = capture.checksumSha256 ?? '';
    if (sizeBytes > MAX_SIZE_BYTES || sizeBytes < 1) {
      await captures.fail(capture, 'too_large');
      return 'failed';
    }
    const callOptions = { headers: { [MEMBERSHIP_HEADER]: scope.membershipId } };
    let created: CreatedFile;
    try {
      created = await api.createFileUpload(
        {
          body: {
            kind: 'cmj_video',
            clientUuid: capture.uploadId,
            playerId: capture.playerId,
            testResultId: attempt.testResultId,
            testEntryId: capture.id,
            contentType: capture.contentType,
            sizeBytes,
            checksumSha256,
            fileName: `cmj-intento-${String(capture.attemptNumber)}.${capture.videoFile.split('.').pop() ?? 'mp4'}`,
          },
        },
        callOptions,
      );
    } catch (error) {
      if (error instanceof ApiError && !isRetryable(error))
        return refused(capture, error, 'create');
      if (error instanceof ApiContractError && error.side === 'request') {
        // This build cannot even express the upload: retrying would never change that.
        reportError(error);
        await captures.fail(capture, 'rejected');
        return 'failed';
      }
      return retryLater(capture);
    }
    if (created.file.status === 'deleted') {
      await captures.update({ ...capture, uploadId: randomUUID() });
      return 'waiting';
    }
    if (created.file.status === 'pending') {
      if (created.upload === null) {
        // The window of this upload closed: a new one.
        await captures.update({ ...capture, uploadId: randomUUID() });
        return 'waiting';
      }
      let status: number;
      try {
        status = await transfer.put({
          url: created.upload.url,
          headers: created.upload.headers,
          path,
        });
      } catch {
        return retryLater(capture);
      }
      if (status === 403 || status === 400) {
        // The signature expired between the create and the PUT, or a clock skew: ask again.
        return retryLater(capture);
      }
      if (status < 200 || status >= 300) return retryLater(capture);
      try {
        await api.confirmFileUpload({ params: { fileId: created.file.id } }, callOptions);
      } catch (error) {
        if (error instanceof ApiError && !isRetryable(error)) {
          return refused(capture, error, 'confirm');
        }
        return retryLater(capture);
      }
    }
    await captures.remove(capture);
    return 'uploaded';
  }

  async function pass(scope: CaptureScope): Promise<UploadRunResult> {
    const counts = { uploaded: 0, waiting: 0, failed: 0 };
    for (const capture of await captures.list(scope)) {
      if (capture.state === 'failed') {
        counts.failed += 1;
        continue;
      }
      if (capture.nextTryAt !== null && capture.nextTryAt > now()) {
        counts.waiting += 1;
        continue;
      }
      let outcome: Outcome;
      try {
        outcome = await uploadOne(scope, capture);
      } catch (error) {
        // The phone's own failure (file system, hashing): reported, tried again later.
        reportError(error);
        outcome = await retryLater(capture).catch(() => 'waiting' as const);
      }
      counts[outcome] += 1;
    }
    return counts;
  }

  return {
    run(scope) {
      if (running !== null) return running;
      running = pass(scope).finally(() => {
        running = null;
      });
      return running;
    },
  };
}
