/**
 * The CMJ videos filmed on this phone that still have to go up (B-604,
 * ADR 0085). The bytes cannot go through the sync queue (ADR 0005, 0015):
 * each video stays as a file of the app with a small JSON next to it, under
 * the user and the membership that filmed it, until the server confirms the
 * upload. The attempt itself (the marked frames) went through the queue the
 * moment it was saved.
 *
 * `<root>/<userId>/<membershipId>/<captureId>.json` (this record) and
 * `<captureId>.<mp4|mov>` (the video). The capture id is the `clientUuid`
 * of the attempt, which is the attempt's id on the server.
 */

/** What the file system of the app offers the store (`expo-file-system`, `node:fs` in tests). */
export interface VideoFileSystem {
  /** Absolute directory of the videos (inside the app's documents, never a shared folder). */
  readonly root: string;
  /** Names in a directory; `[]` when it does not exist. */
  list(directory: string): Promise<string[]>;
  /** A text file, `null` when it does not exist. */
  readText(path: string): Promise<string | null>;
  /** Writes a text file whole (creating its directory): a crash leaves the old one or the new one. */
  writeText(path: string, text: string): Promise<void>;
  /** Moves a file (the recording, out of the camera's temporary directory), creating the target directory. */
  move(from: string, to: string): Promise<void>;
  /** Deletes a file or a directory with what it holds; nothing if it does not exist. */
  remove(path: string): Promise<void>;
}

export type CmjVideoContentType = 'video/mp4' | 'video/quicktime';

/** Why a video will not go up: the attempt stays (it is the measurement), the video goes. */
export type CmjVideoFailure =
  /** No current image consent of the player any more (`403`). */
  | 'consent'
  /** The attempt was voided before its video went up. */
  | 'voided'
  /** The server refused the attempt or the video (another video, an attempt it does not have). */
  | 'rejected'
  /** Larger than what a CMJ video may weigh. */
  | 'too_large'
  /** The file of the recording is not on the phone any more. */
  | 'missing_file';

export interface CmjVideoCapture {
  /** `clientUuid` of the attempt (`cmj_video_frames` entry) the video is the evidence of. */
  readonly id: string;
  /** `clientUuid` of the upload (`POST /v1/files`): resending it never creates another file. */
  readonly uploadId: string;
  readonly userId: string;
  readonly membershipId: string;
  readonly playerId: string;
  readonly testSessionId: string;
  readonly attemptNumber: number;
  /** File name of the video, next to this record. */
  readonly videoFile: string;
  readonly contentType: CmjVideoContentType;
  readonly frameRateFps: number;
  readonly durationMs: number;
  /** When it was filmed (epoch ms). */
  readonly recordedAt: number;
  /** Computed once, before the first upload. */
  readonly sizeBytes: number | null;
  readonly checksumSha256: string | null;
  /** `waiting`: to go up when its attempt is on the server; `failed`: it will not go up. */
  readonly state: 'waiting' | 'failed';
  readonly failure: CmjVideoFailure | null;
  /** Failed upload tries (network, server), for the backoff. */
  readonly tries: number;
  /** Not before this instant (epoch ms); `null`: now. */
  readonly nextTryAt: number | null;
  /** Uploads the server refused to confirm (`409`: the bytes it holds are not the declared video). */
  readonly refusedUploads: number;
}

export interface CaptureScope {
  readonly userId: string;
  readonly membershipId: string;
}

function isCapture(value: unknown): value is CmjVideoCapture {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.uploadId === 'string' &&
    typeof v.userId === 'string' &&
    typeof v.membershipId === 'string' &&
    typeof v.playerId === 'string' &&
    typeof v.testSessionId === 'string' &&
    typeof v.attemptNumber === 'number' &&
    typeof v.videoFile === 'string' &&
    (v.contentType === 'video/mp4' || v.contentType === 'video/quicktime') &&
    typeof v.frameRateFps === 'number' &&
    typeof v.durationMs === 'number' &&
    typeof v.recordedAt === 'number' &&
    (v.state === 'waiting' || v.state === 'failed') &&
    typeof v.refusedUploads === 'number'
  );
}

/** The ids are UUIDs: nothing else ever becomes a path. */
const SAFE_SEGMENT = /^[A-Za-z0-9-]{1,64}$/;

function segment(value: string): string {
  if (!SAFE_SEGMENT.test(value)) throw new Error('Unsafe path segment for a CMJ video');
  return value;
}

export interface CaptureStore {
  /** The captures of a membership, oldest first. Records that no longer parse are dropped. */
  list(scope: CaptureScope): Promise<CmjVideoCapture[]>;
  /** Moves a finished recording into the store and records it. */
  add(
    capture: Omit<
      CmjVideoCapture,
      'videoFile' | 'state' | 'failure' | 'tries' | 'nextTryAt' | 'refusedUploads'
    >,
    recordingPath: string,
  ): Promise<CmjVideoCapture>;
  /** Replaces the record (the video stays). */
  update(capture: CmjVideoCapture): Promise<void>;
  /** Marks it failed and deletes its video: it never goes up. */
  fail(capture: CmjVideoCapture, failure: CmjVideoFailure): Promise<CmjVideoCapture>;
  /** Deletes the capture and its video (uploaded, or dismissed by the user). */
  remove(capture: CmjVideoCapture): Promise<void>;
  /** Absolute path of the video of a capture. */
  videoPath(capture: CmjVideoCapture): string;
  /** Deletes the videos of every user but `keepUserId` (`null`: of everyone). */
  wipe(keepUserId: string | null): Promise<void>;
}

const EXTENSIONS: Readonly<Record<CmjVideoContentType, string>> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

export function createCaptureStore(fs: VideoFileSystem): CaptureStore {
  const dirOf = (scope: CaptureScope) =>
    `${fs.root}/${segment(scope.userId)}/${segment(scope.membershipId)}`;
  const recordPath = (capture: CmjVideoCapture) => `${dirOf(capture)}/${segment(capture.id)}.json`;
  const videoPath = (capture: CmjVideoCapture) => `${dirOf(capture)}/${capture.videoFile}`;
  const write = (capture: CmjVideoCapture) =>
    fs.writeText(recordPath(capture), JSON.stringify(capture));
  // Every operation runs alone: a `list` (which deletes the videos without a record) never
  // reads the folder halfway through an `add`, whoever calls them (the uploader after a
  // sync cycle, the backoff timer, the screen).
  let queue: Promise<unknown> = Promise.resolve();
  function serial<A extends unknown[], T>(
    task: (...args: A) => Promise<T>,
  ): (...args: A) => Promise<T> {
    return (...args) => {
      const next = queue.then(() => task(...args));
      queue = next.catch(() => undefined);
      return next;
    };
  }

  return {
    list: serial(async (scope: CaptureScope) => {
      const directory = dirOf(scope);
      const names = await fs.list(directory);
      const captures: CmjVideoCapture[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const text = await fs.readText(`${directory}/${name}`);
        if (text === null) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        if (
          !isCapture(parsed) ||
          parsed.userId !== scope.userId ||
          parsed.membershipId !== scope.membershipId
        ) {
          // Written by another build, or damaged: neither shown nor uploaded.
          await fs.remove(`${directory}/${name}`);
          continue;
        }
        captures.push(parsed);
      }
      // A video without a record (left by an older build, or a removal cut short) has no attempt
      // to go with; `add` writes the record before the video, so it is never one being saved.
      const known = new Set(captures.map((capture) => capture.videoFile));
      for (const name of names) {
        if (!name.endsWith('.json') && !known.has(name)) await fs.remove(`${directory}/${name}`);
      }
      return captures.sort((a, b) => a.recordedAt - b.recordedAt || a.id.localeCompare(b.id));
    }),
    add: serial(
      async (
        input: Parameters<CaptureStore['add']>[0],
        recordingPath: string,
      ): Promise<CmjVideoCapture> => {
        const capture: CmjVideoCapture = {
          ...input,
          videoFile: `${segment(input.id)}.${EXTENSIONS[input.contentType]}`,
          state: 'waiting',
          failure: null,
          tries: 0,
          nextTryAt: null,
          refusedUploads: 0,
        };
        // The record first: if the app dies before the move, the capture says its file is
        // gone (the attempt stays); a video is never in the folder without its record.
        await write(capture);
        try {
          await fs.move(recordingPath, videoPath(capture));
        } catch (error) {
          await fs.remove(recordPath(capture)).catch(() => undefined);
          throw error;
        }
        return capture;
      },
    ),
    update: serial(write),
    fail: serial(async (capture: CmjVideoCapture, failure: CmjVideoFailure) => {
      const failed: CmjVideoCapture = { ...capture, state: 'failed', failure, nextTryAt: null };
      await write(failed);
      await fs.remove(videoPath(capture));
      return failed;
    }),
    remove: serial(async (capture: CmjVideoCapture) => {
      await fs.remove(videoPath(capture));
      await fs.remove(recordPath(capture));
    }),
    videoPath,
    wipe: serial(async (keepUserId: string | null) => {
      for (const user of await fs.list(fs.root)) {
        if (user !== keepUserId) await fs.remove(`${fs.root}/${user}`);
      }
    }),
  };
}
