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
type Overlay<Op extends SyncOperation, Row> = (
  row: Row,
  input: SyncOperationInput<Op>,
  context: OverlayContext,
) => Row;

/** What the queue knows of the edit besides its input. */
export interface OverlayContext {
  /** When the edit was queued (ms since the epoch). */
  readonly enqueuedAt: number;
}

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

type TestEntry = TestResult['entries'][number];

/** The unit the row already shows for a metric (the device has no metric catalog). */
function knownUnit(row: TestResult, metricCode: string): string | null {
  for (const score of row.scores) if (score.metricCode === metricCode) return score.unit;
  for (const entry of row.entries) {
    for (const value of entry.values) if (value.metricCode === metricCode) return value.unit;
  }
  return null;
}

/**
 * Attempts added offline (B-505), shown at the end of the row until the pull
 * brings them computed: the id is their `clientUuid` (the id the server
 * gives them), `inputs` is what the evaluator typed, as the server stores it,
 * and `recordedAt` the time typed or else when it was queued (the server
 * measures it from the HLC of the mutation, ADR 0050). A direct value shows
 * with the unit the row already uses for its metric; when the row has none
 * yet (the first attempt of that metric) it shows as typed in `inputs`
 * (`kind`, `metricCode`, `value`), since a value needs its unit. What the
 * server computes from a raw entry (Vmax, CMJ height, VIFT, e1RM),
 * its protocol issues and the scores of the result stay out until then. An
 * attempt the row already has (a resend that the pull brought) is not added
 * twice.
 */
const testResultAddEntries: Overlay<'test_result.add_entries', TestResult> = (
  row,
  { body },
  { enqueuedAt },
) => {
  const present = new Set(row.entries.map((entry) => entry.id));
  const added: TestEntry[] = [];
  for (const input of body.entries) {
    const id = input.clientUuid;
    if (id === undefined || present.has(id)) continue;
    present.add(id);
    const typed = Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined),
    );
    const unit = input.kind === 'value' ? knownUnit(row, input.metricCode) : null;
    const values: TestEntry['values'] =
      input.kind === 'value' && unit !== null
        ? [{ id, metricCode: input.metricCode, unit, value: input.value, computed: false }]
        : [];
    added.push({
      id,
      kind: input.kind,
      attemptNumber: input.attemptNumber ?? null,
      recordedAt: input.recordedAt ?? new Date(enqueuedAt).toISOString(),
      inputs: input.kind === 'value' && unit !== null ? null : typed,
      values,
      issues: [],
      voided: null,
    });
  }
  return added.length === 0 ? row : { ...row, entries: [...row.entries, ...added] };
};

type AnyOverlay = (row: unknown, input: unknown, context: OverlayContext) => unknown;

/** The overlay of each edit; operations without one show the row as served. */
export const OVERLAYS: Partial<Record<SyncOperation, AnyOverlay>> = {
  'wellness.correct': wellnessCorrect as AnyOverlay,
  'participation.update': participationUpdate as AnyOverlay,
  'participation.record': participationRecord as AnyOverlay,
  'rpe.submit': rpeSubmit as AnyOverlay,
  'test_result.update': testResultUpdate as AnyOverlay,
  'test_result.add_entries': testResultAddEntries as AnyOverlay,
  'test_result.void_entries': testResultVoid as AnyOverlay,
};

export function applyOverlay(
  op: SyncOperation,
  row: unknown,
  input: unknown,
  context: OverlayContext,
): unknown {
  const overlay = OVERLAYS[op];
  return overlay === undefined ? row : overlay(row, input, context);
}
