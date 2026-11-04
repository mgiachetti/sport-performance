import type {
  SyncOperationRequest,
  TestDaySheet,
  TestEntryInputPayload,
  TestResult,
} from '@sport-performance/contracts';
import { ruleFor, type Role, type Sex } from '@sport-performance/domain';
import type { LocalStore, QueuedMutation } from '../offline/local-store.ts';

/**
 * The attempt of a sprint timed on video (B-605, ADR 0082): it goes to the
 * player's result of the test day through the offline queue, like any
 * attempt of the field (append-only, ADR 0015), the moment the evaluator
 * saves the marks. Only the frames go: the video never leaves the phone.
 */

/**
 * Who films the sprint: whoever records results and may film the players
 * (`test_result:record` and `media:upload`: `sc` and the administration).
 * The image consent is per player (the sheet says).
 */
export function canFilmSprint(role: Role): boolean {
  return (
    ruleFor('test_result', 'record', role).effect === 'allow' &&
    ruleFor('media', 'upload', role).effect === 'allow'
  );
}

/** What the sprint by video needs from the sheet of a test day. */
export interface SprintVideoDay {
  readonly testSessionId: string;
  readonly scheduledOn: string;
  readonly definitionId: string;
  readonly protocolVersion: number;
  readonly attemptCount: number;
}

export type SprintVideoPermission = 'allowed' | 'missing_consent' | 'forbidden';

export interface SprintVideoPlayer {
  readonly id: string;
  readonly name: string;
  readonly sex: Sex;
  /** May results be recorded (data consent, scope)? */
  readonly recording: SprintVideoPermission;
  /** May the player be filmed (image consent, `media:upload`)? */
  readonly video: SprintVideoPermission;
  /** The sprint applies to the player's stage that day. */
  readonly applicable: boolean;
}

/** The sprint station of a sheet, when its protocol version takes video frames. */
export function sprintVideoDayOf(sheet: TestDaySheet): SprintVideoDay | null {
  const station = sheet.stations.find((s) => s.testCode === 'sprint_40');
  if (!station?.definition.entryKinds.includes('sprint_video_frames')) return null;
  return {
    testSessionId: sheet.testSession.id,
    scheduledOn: sheet.testSession.scheduledOn,
    definitionId: station.definition.id,
    protocolVersion: station.definition.version,
    attemptCount: station.definition.attemptCount,
  };
}

/** The players of the day (by last name, as the sheet orders them). */
export function sprintVideoPlayersOf(sheet: TestDaySheet): SprintVideoPlayer[] {
  return sheet.players.map((player) => ({
    id: player.id,
    name: `${player.lastName}, ${player.firstName}`,
    sex: player.sex,
    recording: player.recording,
    video: player.video,
    applicable: player.tests.some((test) => test.testCode === 'sprint_40' && test.applicable),
  }));
}

export type FilmingBlock =
  'missing_data_consent' | 'missing_image_consent' | 'forbidden' | 'not_applicable';

/** Why a player cannot be filmed now, or `null` when they can. */
export function filmingBlock(player: SprintVideoPlayer): FilmingBlock | null {
  if (player.recording === 'missing_consent') return 'missing_data_consent';
  if (player.recording === 'forbidden' || player.video === 'forbidden') return 'forbidden';
  if (player.video === 'missing_consent') return 'missing_image_consent';
  if (!player.applicable) return 'not_applicable';
  return null;
}

type AttemptOp = 'test_session.record_results' | 'test_result.create' | 'test_result.add_entries';
const ATTEMPT_OPS: readonly AttemptOp[] = [
  'test_session.record_results',
  'test_result.create',
  'test_result.add_entries',
];

/** Where the next attempt of the player goes: an existing result, or a new one. */
export type SprintResultTarget =
  | { readonly kind: 'served'; readonly id: string }
  | { readonly kind: 'queued'; readonly clientUuid: string }
  | { readonly kind: 'none' };

export interface PlayerSprintAttempts {
  readonly target: SprintResultTarget;
  /** Attempt numbers already recorded (served or queued; voided ones left out). */
  readonly attemptNumbers: readonly number[];
  /**
   * Every attempt number already taken, voided ones included: the next
   * attempt goes after them, so a number is never shown twice on the sheet.
   */
  readonly takenNumbers: readonly number[];
}

function entryNumbers(entries: readonly { attemptNumber?: number | null | undefined }[]): number[] {
  return entries.flatMap((entry) =>
    typeof entry.attemptNumber === 'number' ? [entry.attemptNumber] : [],
  );
}

function isSprintOf(result: TestResult, day: SprintVideoDay, playerId: string): boolean {
  return (
    result.playerId === playerId &&
    result.testDefinitionId === day.definitionId &&
    result.testSessionId === day.testSessionId &&
    result.status === 'done'
  );
}

/** The results a queued write creates on the test day (none for another day). */
function createdResults(mutation: QueuedMutation<AttemptOp>, testSessionId: string) {
  if (mutation.op === 'test_session.record_results') {
    const input = mutation.input as SyncOperationRequest<'test_session.record_results'>;
    return input.params.testSessionId === testSessionId ? input.body.results : [];
  }
  if (mutation.op === 'test_result.create') {
    const { body } = mutation.input as SyncOperationRequest<'test_result.create'>;
    return body.testSessionId === testSessionId ? [body] : [];
  }
  return [];
}

/**
 * The sprint result of the player on the day, as the phone knows it: the
 * first one the server served (so every phone of the day adds to the same
 * one), else one created offline still in the queue; with the numbers of
 * the attempts it holds (served, and queued on top of it).
 */
export async function playerSprintAttempts(
  store: LocalStore,
  membershipId: string,
  day: SprintVideoDay,
  playerId: string,
): Promise<PlayerSprintAttempts> {
  const served = (
    await store.list(membershipId, 'test_result', { parentId: day.testSessionId, playerId })
  )
    .filter((row) => isSprintOf(row.data, day, playerId))
    .sort((a, b) => a.data.createdAt.localeCompare(b.data.createdAt) || a.id.localeCompare(b.id));
  const queue = await store.pending(membershipId, ATTEMPT_OPS);
  const numbers: number[] = [];
  const voided: number[] = [];
  for (const row of served) {
    numbers.push(...entryNumbers(row.data.entries.filter((entry) => entry.voided === null)));
    voided.push(...entryNumbers(row.data.entries.filter((entry) => entry.voided !== null)));
  }
  const servedIds = new Set(served.map((row) => row.id));
  const servedClientUuids = new Set(served.flatMap((row) => row.clientUuid ?? []));
  let queued: string | null = null;
  for (const mutation of queue) {
    // Only results of this test day: an unsynced sprint of the player from
    // another day is another result (another session, window and date).
    for (const result of createdResults(mutation, day.testSessionId)) {
      if (
        result.status !== 'done' ||
        result.playerId !== playerId ||
        result.testDefinitionId !== day.definitionId ||
        result.clientUuid === undefined ||
        // Already served: its entries are counted above.
        servedClientUuids.has(result.clientUuid)
      ) {
        continue;
      }
      queued ??= result.clientUuid;
      numbers.push(...entryNumbers(result.entries));
    }
    if (mutation.op !== 'test_result.add_entries') continue;
    const { target, body } = mutation.input as SyncOperationRequest<'test_result.add_entries'>;
    // Entries queued onto any served result of the day count for the
    // numbering, though the new attempt always goes to `served[0]`: a second
    // served result only appears when two phones created one offline, and
    // the numbers stay unique across both.
    const onServed = 'id' in target && servedIds.has(target.id);
    const onQueued = 'clientUuid' in target && target.clientUuid === queued;
    if (onServed || onQueued) numbers.push(...entryNumbers(body.entries));
  }
  const first = served[0];
  const target: SprintResultTarget =
    first !== undefined
      ? { kind: 'served', id: first.id }
      : queued !== null
        ? { kind: 'queued', clientUuid: queued }
        : { kind: 'none' };
  const sorted = (values: readonly number[]) => [...new Set(values)].sort((a, b) => a - b);
  return { target, attemptNumbers: sorted(numbers), takenNumbers: sorted([...numbers, ...voided]) };
}

/** The next attempt number: after the highest one taken (`takenNumbers`). */
export function nextAttemptNumber(attemptNumbers: readonly number[]): number {
  return attemptNumbers.length === 0 ? 1 : Math.max(...attemptNumbers) + 1;
}

export interface MarkedSprint {
  /** `clientUuid` of the attempt. */
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly startFrame: number;
  readonly frame10: number | null;
  readonly frame20: number;
  readonly frame40: number;
  readonly frameRateFps: number;
  /** When it was filmed (ISO): orders attempts of several phones. */
  readonly recordedAt: string;
}

export type SprintAttemptMutation =
  | {
      readonly op: 'test_session.record_results';
      readonly input: SyncOperationRequest<'test_session.record_results'>;
    }
  | {
      readonly op: 'test_result.add_entries';
      readonly input: SyncOperationRequest<'test_result.add_entries'>;
    };

/**
 * The write of a marked sprint for the queue: added to the player's result
 * of the day, or a new result (method `video`, evaluator: who films) with
 * `resultClientUuid`. Validated by the server's contract on `enqueue`.
 */
export function sprintAttemptMutation(options: {
  readonly day: SprintVideoDay;
  readonly playerId: string;
  readonly evaluatorId: string;
  readonly target: SprintResultTarget;
  readonly sprint: MarkedSprint;
  readonly resultClientUuid: string;
}): SprintAttemptMutation {
  const { day, playerId, evaluatorId, target, sprint } = options;
  const entry: TestEntryInputPayload = {
    kind: 'sprint_video_frames',
    clientUuid: sprint.attemptId,
    attemptNumber: sprint.attemptNumber,
    recordedAt: sprint.recordedAt,
    startFrame: sprint.startFrame,
    ...(sprint.frame10 !== null && { frame10: sprint.frame10 }),
    frame20: sprint.frame20,
    frame40: sprint.frame40,
    frameRateFps: sprint.frameRateFps,
  };
  if (target.kind !== 'none') {
    return {
      op: 'test_result.add_entries',
      input: {
        target: target.kind === 'served' ? { id: target.id } : { clientUuid: target.clientUuid },
        body: { entries: [entry] },
      },
    };
  }
  return {
    op: 'test_session.record_results',
    input: {
      params: { testSessionId: day.testSessionId },
      body: {
        results: [
          {
            status: 'done',
            clientUuid: options.resultClientUuid,
            playerId,
            testDefinitionId: day.definitionId,
            method: 'video',
            evaluatorId,
            entries: [entry],
          },
        ],
      },
    },
  };
}
