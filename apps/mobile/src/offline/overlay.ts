import type {
  Participation,
  SyncOperationInput,
  TestResult,
  Wellness,
} from '@sport-performance/contracts';
import { participationCarriesLoad, type SyncOperation } from '@sport-performance/domain';

/**
 * How a queued edit shows on the row the server last served (ADR 0069):
 * pure functions from the DTO and the mutation's input to the DTO the user
 * expects to see. They only touch what the edit sets; what the server
 * derives and the device cannot know (the scores of a result, the alerts)
 * stays as served until the pull brings the real row.
 *
 * Creates have no server row to lay over: screens read them from the queue
 * (`LocalStore.pending`) until they come back in a pull.
 */
type Overlay<Op extends SyncOperation, Row> = (row: Row, input: SyncOperationInput<Op>) => Row;

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const wellnessCorrect: Overlay<'wellness.correct', Wellness> = (row, { body }) => {
  const scores = { ...row.scores, ...body.scores };
  const answered = Object.values(scores).filter((value): value is number => value !== undefined);
  return { ...row, scores, meanScore: answered.length === 0 ? row.meanScore : mean(answered) };
};

function withLoad(row: Participation): Participation {
  if (!participationCarriesLoad(row.status)) {
    // The online rule (ADR 0037, ADR 0050): no load without taking part.
    return { ...row, minutes: null, contactsN: null, rpe: null, srpeAu: null };
  }
  return {
    ...row,
    srpeAu: row.rpe !== null && row.minutes !== null ? row.rpe * row.minutes : null,
  };
}

const participationUpdate: Overlay<'participation.update', Participation> = (row, { body }) =>
  withLoad({
    ...row,
    ...(body.status !== undefined && { status: body.status }),
    ...(body.minutes !== undefined && { minutes: body.minutes }),
    ...(body.contactsN !== undefined && { contactsN: body.contactsN }),
  });

const rpeSubmit: Overlay<'rpe.submit', Participation> = (row, { body }) =>
  // Against a status without load the server answers `conflict`: nothing to show.
  participationCarriesLoad(row.status) ? withLoad({ ...row, rpe: body.rpe }) : row;

const participationRecord: Overlay<'participation.record', Participation> = (row, { body }) => {
  const edit = body.rows.find((candidate) => candidate.playerId === row.playerId);
  if (edit === undefined) return row;
  return withLoad({
    ...row,
    status: edit.status,
    ...(edit.minutes !== undefined && { minutes: edit.minutes }),
    ...(edit.contactsN !== undefined && { contactsN: edit.contactsN }),
  });
};

const testResultUpdate: Overlay<'test_result.update', TestResult> = (row, { body }) => {
  const next: TestResult = { ...row };
  if (body.measuredOn !== undefined) next.measuredOn = body.measuredOn;
  if (body.status !== undefined) next.status = body.status;
  if (body.notDoneReason !== undefined) next.notDoneReason = body.notDoneReason;
  if (body.notDoneNote !== undefined) next.notDoneNote = body.notDoneNote;
  if (body.method !== undefined) next.method = body.method;
  if (body.evaluatorId !== undefined) next.evaluatorId = body.evaluatorId;
  if (body.deviceId !== undefined) next.deviceId = body.deviceId;
  if (body.exercise !== undefined) next.exercise = body.exercise;
  if (body.conditions !== undefined) next.conditions = { ...row.conditions, ...body.conditions };
  if (body.notes !== undefined) next.notes = body.notes;
  return next;
};

const testResultVoid: Overlay<'test_result.void_entries', TestResult> = (row, { body }) => {
  const ids = new Set(body.entryIds);
  return {
    ...row,
    entries: row.entries.map((entry) =>
      ids.has(entry.id) && entry.voided === null
        ? // Until the pull: voided now, by this device's user, with the reason.
          { ...entry, voided: { at: row.updatedAt, by: null, reason: body.reason } }
        : entry,
    ),
  };
};

type AnyOverlay = (row: unknown, input: unknown) => unknown;

/** The overlay of each edit; operations without one show the row as served. */
export const OVERLAYS: Partial<Record<SyncOperation, AnyOverlay>> = {
  'wellness.correct': wellnessCorrect as AnyOverlay,
  'participation.update': participationUpdate as AnyOverlay,
  'participation.record': participationRecord as AnyOverlay,
  'rpe.submit': rpeSubmit as AnyOverlay,
  'test_result.update': testResultUpdate as AnyOverlay,
  'test_result.void_entries': testResultVoid as AnyOverlay,
};

export function applyOverlay(op: SyncOperation, row: unknown, input: unknown): unknown {
  const overlay = OVERLAYS[op];
  return overlay === undefined ? row : overlay(row, input);
}
