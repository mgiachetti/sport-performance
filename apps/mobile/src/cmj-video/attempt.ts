import type {
  SyncOperationRequest,
  TestDaySheet,
  TestEntryInputPayload,
  TestResult,
} from '@sport-performance/contracts';
import {
  decimalAgeYears,
  parseLocalDate,
  ruleFor,
  testScoringSettings,
  type LocalDate,
  type Role,
  type Sex,
  type SyncOperation,
} from '@sport-performance/domain';
import type { LocalStore, QueuedMutation } from '../offline/local-store.ts';

/**
 * The attempt of a CMJ filmed on the phone (B-604, ADR 0085): it goes to the
 * result of the player on the test day through the offline queue, like any
 * attempt of the field (append-only, ADR 0015), the moment the evaluator
 * saves the marks. The video follows it later (`uploader.ts`).
 */

/**
 * Who films the CMJ on the phone: whoever records results and uploads the
 * videos of the players (`test_result:record` and `media:upload`: `sc` and
 * the administration). The image consent is per player (the sheet says).
 */
export function canFilmCmj(role: Role): boolean {
  return (
    ruleFor('test_result', 'record', role).effect === 'allow' &&
    ruleFor('media', 'upload', role).effect === 'allow'
  );
}

/** What the CMJ station of a test day needs from its sheet. */
export interface CmjVideoDay {
  readonly testSessionId: string;
  /** The day of the test (the result's `measuredOn` comes from it on the server). */
  readonly scheduledOn: string;
  readonly definitionId: string;
  readonly protocolVersion: number;
  readonly attemptCount: number;
  /** Gravity of the protocol version (`h = g·t²/8`). */
  readonly gravityMs2: number;
}

export type CmjVideoPermission = 'allowed' | 'missing_consent' | 'forbidden';

export interface CmjVideoPlayer {
  readonly id: string;
  readonly name: string;
  readonly sex: Sex;
  /** Decimal age on the day of the test (the plausible range of the height depends on it). */
  readonly ageYears: number | null;
  /** May results be recorded (data consent, scope)? */
  readonly recording: CmjVideoPermission;
  /** May the CMJ be filmed (image consent, `media:upload`)? */
  readonly video: CmjVideoPermission;
  /** The CMJ applies to the player's stage that day. */
  readonly applicable: boolean;
}

/** The CMJ station of a sheet, when the day has one that takes video frames. */
export function cmjVideoDayOf(sheet: TestDaySheet): CmjVideoDay | null {
  const station = sheet.stations.find((s) => s.testCode === 'cmj');
  if (!station?.definition.entryKinds.includes('cmj_video_frames')) {
    return null;
  }
  return {
    testSessionId: sheet.testSession.id,
    scheduledOn: sheet.testSession.scheduledOn,
    definitionId: station.definition.id,
    protocolVersion: station.definition.version,
    attemptCount: station.definition.attemptCount,
    gravityMs2: testScoringSettings(station.definition.protocol.parameters).gravityMs2,
  };
}

/** The players of the day as the CMJ by video lists them (by last name, as the sheet). */
export function cmjVideoPlayersOf(sheet: TestDaySheet): CmjVideoPlayer[] {
  const day = parseLocalDate(sheet.testSession.scheduledOn);
  return sheet.players.map((player) => ({
    id: player.id,
    name: `${player.lastName}, ${player.firstName}`,
    sex: player.sex,
    ageYears: ageOn(player.birthDate, day),
    recording: player.recording,
    video: player.video,
    applicable: player.tests.some((test) => test.testCode === 'cmj' && test.applicable),
  }));
}

function ageOn(birthDate: string, day: LocalDate): number | null {
  try {
    return decimalAgeYears(parseLocalDate(birthDate), day);
  } catch {
    // A birth date after the day (a data error): the age-free envelope applies.
    return null;
  }
}

/** Why a player cannot be filmed now, or `null` when they can. */
export function filmingBlock(
  player: CmjVideoPlayer,
): 'missing_data_consent' | 'missing_image_consent' | 'forbidden' | 'not_applicable' | null {
  if (player.recording === 'missing_consent') return 'missing_data_consent';
  if (player.recording === 'forbidden' || player.video === 'forbidden') return 'forbidden';
  if (player.video === 'missing_consent') return 'missing_image_consent';
  if (!player.applicable) return 'not_applicable';
  return null;
}

type ResultCreateOp = 'test_session.record_results' | 'test_result.create';
type AttemptOp = ResultCreateOp | 'test_result.add_entries';

/** Where the next attempt of the player goes: an existing result, or a new one. */
export type CmjResultTarget =
  | { readonly kind: 'served'; readonly id: string }
  | { readonly kind: 'queued'; readonly clientUuid: string }
  | { readonly kind: 'none' };

export interface PlayerCmjAttempts {
  readonly target: CmjResultTarget;
  /** Attempt numbers already recorded (served or queued, voided ones left out). */
  readonly attemptNumbers: readonly number[];
}

function entryNumbers(entries: readonly { attemptNumber?: number | null | undefined }[]): number[] {
  return entries.flatMap((entry) =>
    typeof entry.attemptNumber === 'number' ? [entry.attemptNumber] : [],
  );
}

function isCmjOf(result: TestResult, day: CmjVideoDay, playerId: string): boolean {
  return (
    result.playerId === playerId &&
    result.testCode === 'cmj' &&
    result.testSessionId === day.testSessionId &&
    result.status === 'done' &&
    // Principle 4: a filmed attempt never joins a result measured another way.
    result.method === 'video'
  );
}

/**
 * The CMJ result by video of the player on the day, as the phone knows it:
 * one the server served (the first created, so every phone of the day picks
 * the same one), or one created offline that is still in the queue. Results
 * of the day measured with another method (manual, app) are left
 * out: the filmed attempts go to a result of their own (principle 4, never
 * mix methods).
 */
export async function playerCmjAttempts(
  store: LocalStore,
  membershipId: string,
  day: CmjVideoDay,
  playerId: string,
): Promise<PlayerCmjAttempts> {
  const served = (
    await store.list(membershipId, 'test_result', { parentId: day.testSessionId, playerId })
  )
    .filter((row) => isCmjOf(row.data, day, playerId))
    .sort((a, b) => a.data.createdAt.localeCompare(b.data.createdAt) || a.id.localeCompare(b.id));
  const queue = (await store.pending(membershipId, [
    'test_session.record_results',
    'test_result.create',
    'test_result.add_entries',
  ])) as QueuedMutation<AttemptOp>[];
  const numbers: number[] = [];
  for (const row of served) {
    numbers.push(...entryNumbers(row.data.entries.filter((entry) => entry.voided === null)));
  }
  let queued: string | null = null;
  for (const mutation of queue) {
    for (const result of createdResults(mutation)) {
      if (
        result.status !== 'done' ||
        result.method !== 'video' ||
        result.playerId !== playerId ||
        result.testDefinitionId !== day.definitionId ||
        result.clientUuid === undefined
      ) {
        continue;
      }
      // Already served: its entries are counted above.
      if (served.some((row) => row.clientUuid === result.clientUuid)) continue;
      queued ??= result.clientUuid;
      numbers.push(...entryNumbers(result.entries));
    }
    if (mutation.op === 'test_result.add_entries' && queued !== null) {
      const input = mutation.input as SyncOperationRequest<'test_result.add_entries'>;
      if ('clientUuid' in input.target && input.target.clientUuid === queued) {
        numbers.push(...entryNumbers(input.body.entries));
      }
    }
  }
  const first = served[0];
  const target: CmjResultTarget =
    first !== undefined
      ? { kind: 'served', id: first.id }
      : queued !== null
        ? { kind: 'queued', clientUuid: queued }
        : { kind: 'none' };
  return { target, attemptNumbers: numbers };
}

/** `clientUuid` of every entry a queued attempt write carries. */
function queuedEntryUuids(mutation: QueuedMutation<AttemptOp>): string[] {
  const entries =
    mutation.op === 'test_result.add_entries'
      ? (mutation.input as SyncOperationRequest<'test_result.add_entries'>).body.entries
      : createdResults(mutation).flatMap((result) =>
          result.status === 'done' ? result.entries : [],
        );
  return entries.flatMap((entry) =>
    typeof entry.clientUuid === 'string' ? [entry.clientUuid] : [],
  );
}

function createdResults(mutation: QueuedMutation<AttemptOp>) {
  if (mutation.op === 'test_session.record_results') {
    return (mutation.input as SyncOperationRequest<'test_session.record_results'>).body.results;
  }
  if (mutation.op === 'test_result.create') {
    return [(mutation.input as SyncOperationRequest<'test_result.create'>).body];
  }
  return [];
}

/** The next attempt number: after the highest one recorded. */
export function nextAttemptNumber(attemptNumbers: readonly number[]): number {
  return attemptNumbers.length === 0 ? 1 : Math.max(...attemptNumbers) + 1;
}

export interface MarkedJump {
  /** `clientUuid` of the attempt (and id of the capture). */
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly takeoffFrame: number;
  readonly landingFrame: number;
  readonly frameRateFps: number;
  /** When it was filmed (ISO): orders attempts of several phones. */
  readonly recordedAt: string;
}

/** The queue operations a marked jump goes through. */
export type CmjAttemptOp = 'test_session.record_results' | 'test_result.add_entries';

/** A queue write of one of those operations, with its input. */
export interface CmjAttemptMutationOf<Op extends CmjAttemptOp> {
  readonly op: Op;
  readonly input: SyncOperationRequest<Op>;
}

export type CmjAttemptMutation =
  | CmjAttemptMutationOf<'test_session.record_results'>
  | CmjAttemptMutationOf<'test_result.add_entries'>;

/**
 * The write of a marked jump for the queue: added to the player's result of
 * the day, or a new result (method `video`, evaluator: who films) with
 * `resultClientUuid`. Validated by the server's contract on `enqueue`.
 */
export function cmjAttemptMutation(options: {
  readonly day: CmjVideoDay;
  readonly playerId: string;
  readonly evaluatorId: string;
  readonly target: CmjResultTarget;
  readonly jump: MarkedJump;
  readonly resultClientUuid: string;
}): CmjAttemptMutation {
  const { day, playerId, evaluatorId, target, jump } = options;
  const entry: TestEntryInputPayload = {
    kind: 'cmj_video_frames',
    clientUuid: jump.attemptId,
    attemptNumber: jump.attemptNumber,
    recordedAt: jump.recordedAt,
    takeoffFrame: jump.takeoffFrame,
    landingFrame: jump.landingFrame,
    frameRateFps: jump.frameRateFps,
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

/** Where the attempt of a capture stands on the server, for its video. */
export type AttemptOnServer =
  | { readonly status: 'queued' }
  | {
      readonly status: 'served';
      readonly testResultId: string;
      readonly videoFileId: string | null;
    }
  | { readonly status: 'voided' }
  | { readonly status: 'unknown' };

/**
 * The attempt of a video once the server has it: no mutation of the queue
 * writes it any more and a pulled result holds it. Until then the video
 * waits (an upload of an attempt the server does not have would be refused).
 */
export async function attemptOnServer(
  store: LocalStore,
  membershipId: string,
  capture: { readonly id: string; readonly playerId: string; readonly testSessionId: string },
): Promise<AttemptOnServer> {
  const queue = await store.pending(membershipId, [
    'test_session.record_results',
    'test_result.create',
    'test_result.add_entries',
  ] satisfies SyncOperation[]);
  const inQueue = queue.some((mutation) => queuedEntryUuids(mutation).includes(capture.id));
  if (inQueue) return { status: 'queued' };
  const rows = await store.list(membershipId, 'test_result', {
    parentId: capture.testSessionId,
    playerId: capture.playerId,
  });
  for (const row of rows) {
    const entry = row.data.entries.find((e) => e.id === capture.id);
    if (entry === undefined) continue;
    if (entry.voided !== null) return { status: 'voided' };
    return { status: 'served', testResultId: row.id, videoFileId: entry.videoFileId };
  }
  return { status: 'unknown' };
}
