import type { SyncEngine } from '../offline/engine.ts';
import {
  nextAttemptNumber,
  playerSprintAttempts,
  sprintAttemptMutation,
  type SprintAttemptMutation,
  type SprintVideoDay,
} from './attempt.ts';
import type { SprintRecordings } from './recordings.ts';

export interface SprintMarks {
  readonly startFrame: number;
  readonly frame10: number | null;
  readonly frame20: number;
  readonly frame40: number;
}

export interface SaveSprintAttemptOptions {
  readonly sync: Pick<SyncEngine, 'store' | 'enqueue'>;
  readonly recordings: Pick<SprintRecordings, 'discard'>;
  readonly membershipId: string;
  readonly evaluatorId: string;
  readonly day: SprintVideoDay;
  readonly playerId: string;
  readonly video: {
    readonly path: string;
    readonly durationMs: number;
    readonly frameRateFps: number;
  };
  readonly marks: SprintMarks;
  /** When the recording stopped, ms since the epoch. */
  readonly recordedUntilMs: number;
  readonly randomUUID: () => string;
  readonly reportError: (error: unknown) => void;
}

/**
 * `enqueue` is generic over the operation: the union is narrowed per
 * variant so each call carries the input type of its own operation.
 */
function enqueueAttempt(
  sync: Pick<SyncEngine, 'enqueue'>,
  mutation: SprintAttemptMutation,
): Promise<unknown> {
  switch (mutation.op) {
    case 'test_result.add_entries':
      return sync.enqueue(mutation.op, mutation.input);
    case 'test_session.record_results':
      return sync.enqueue(mutation.op, mutation.input);
  }
}

/**
 * Saves a marked sprint (B-605, ADR 0082): the attempt goes to the queue
 * (to the player's result of the day or to a new one, with the next
 * attempt number) and only then is the video deleted, so a failed write
 * leaves it for another try. Works without signal.
 *
 * @returns The number of the attempt saved.
 */
export async function saveSprintAttempt(options: SaveSprintAttemptOptions): Promise<number> {
  const { sync, day, playerId, video, marks } = options;
  const attempts = await playerSprintAttempts(sync.store, options.membershipId, day, playerId);
  const attemptNumber = nextAttemptNumber(attempts.takenNumbers);
  const mutation = sprintAttemptMutation({
    day,
    playerId,
    evaluatorId: options.evaluatorId,
    target: attempts.target,
    resultClientUuid: options.randomUUID(),
    sprint: {
      attemptId: options.randomUUID(),
      attemptNumber,
      ...marks,
      frameRateFps: video.frameRateFps,
      // When the sprint was filmed: orders the attempts of several phones.
      recordedAt: new Date(options.recordedUntilMs - video.durationMs).toISOString(),
    },
  });
  await enqueueAttempt(sync, mutation);
  // The attempt is safe in the queue: the images of the player leave the phone.
  await options.recordings.discard(video.path).catch(options.reportError);
  return attemptNumber;
}
