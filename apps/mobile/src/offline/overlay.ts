import type {
  GymSet,
  AnthroMeasurement,
  ExternalLoad,
  Participation,
  SyncOperationInput,
  TestResult,
  Wellness,
} from '@sport-performance/contracts';
import {
  participationCarriesLoad,
  periodMinutesTotal,
  type SyncOperation,
} from '@sport-performance/domain';

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
    return {
      ...row,
      minutes: null,
      periodMinutes: null,
      contactsN: null,
      rpe: null,
      rpeChannel: null,
      srpeAu: null,
    };
  }
  return {
    ...row,
    srpeAu: row.rpe !== null && row.minutes !== null ? row.rpe * row.minutes : null,
  };
}

/**
 * The minutes after a write, as the API decides them (B-803): periods set
 * the total as their sum; a total alone clears the periods.
 */
function withMinutes(
  row: Participation,
  edit: { minutes?: number | null | undefined; periodMinutes?: number[] | null | undefined },
): Pick<Participation, 'minutes' | 'periodMinutes'> {
  if (edit.periodMinutes !== undefined && edit.periodMinutes !== null) {
    return { minutes: periodMinutesTotal(edit.periodMinutes), periodMinutes: edit.periodMinutes };
  }
  if (edit.periodMinutes === null || edit.minutes !== undefined) {
    return {
      minutes: edit.minutes === undefined ? row.minutes : edit.minutes,
      periodMinutes: null,
    };
  }
  return { minutes: row.minutes, periodMinutes: row.periodMinutes };
}

const participationUpdate: Overlay<'participation.update', Participation> = (row, { body }) =>
  withLoad({
    ...row,
    ...(body.status !== undefined && { status: body.status }),
    ...withMinutes(row, body),
    ...(body.contactsN !== undefined && { contactsN: body.contactsN }),
  });

const rpeSubmit: Overlay<'rpe.submit', Participation> = (row, { body }) =>
  // Against a status without load the server answers `conflict`: nothing to show.
  participationCarriesLoad(row.status)
    ? withLoad({
        ...row,
        rpe: body.rpe,
        // The kiosk names the player (B-504); otherwise the player's own account.
        rpeChannel: body.playerId === undefined ? 'player_account' : 'kiosk',
      })
    : row;

const participationRecord: Overlay<'participation.record', Participation> = (row, { body }) => {
  const edit = body.rows.find((candidate) => candidate.playerId === row.playerId);
  if (edit === undefined) return row;
  return withLoad({
    ...row,
    status: edit.status,
    ...withMinutes(row, edit),
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
      // A video goes up after its attempt is on the server (ADR 0085): it comes with the pull.
      videoFileId: null,
    });
  }
  return added.length === 0 ? row : { ...row, entries: [...row.entries, ...added] };
};

/**
 * A set corrected offline (B-607): the values typed, on top of the served
 * row. The e1RM and the warnings the server derives stay as served until
 * the pull brings them again (they depend on the stage and the protocol).
 */
const gymSetCorrect: Overlay<'gym_set.correct', GymSet> = (row, { body }) => ({
  ...row,
  ...(body.reps !== undefined && { reps: body.reps }),
  ...(body.loadKg !== undefined && { loadKg: body.loadKg }),
  ...(body.rir !== undefined && { rir: body.rir }),
  ...(body.techniqueScore !== undefined && { techniqueScore: body.techniqueScore }),
  ...(body.durationS !== undefined && { durationS: body.durationS }),
  ...(body.notes !== undefined && { notes: body.notes }),
});

/** A set voided offline: voided now, with the reason, and no longer counting for the e1RM. */
const gymSetVoid: Overlay<'gym_set.void', GymSet> = (row, { body }, { enqueuedAt }) =>
  row.voidedAt !== null
    ? row
    : {
        ...row,
        voidedAt: new Date(enqueuedAt).toISOString(),
        voidReason: body.reason,
        e1rmKg: null,
      };

/**
 * A correction of a measurement (B-508). The maturation the worker derived
 * from the old values is shown as pending (`derivedAt: null`, "Calculando…")
 * when a value it depends on changes: the device has neither the
 * Khamis-Roche table nor the history to recompute it, and the pull brings
 * the new one.
 */
const anthroUpdate: Overlay<'anthro.update', AnthroMeasurement> = (row, { body }) => {
  const next: AnthroMeasurement = { ...row };
  if (body.measuredOn !== undefined) next.measuredOn = body.measuredOn;
  if (body.heightCm !== undefined) next.heightCm = body.heightCm;
  if (body.sittingHeightCm !== undefined) next.sittingHeightCm = body.sittingHeightCm;
  if (body.weightKg !== undefined) next.weightKg = body.weightKg;
  if (body.skinfoldsSumMm !== undefined) next.skinfoldsSumMm = body.skinfoldsSumMm;
  if (body.method !== undefined) next.method = body.method;
  if (body.evaluatorId !== undefined) next.evaluatorId = body.evaluatorId;
  // The correction replaces the conditions whole, as the server does.
  if (body.conditions !== undefined) next.conditions = { ...body.conditions };
  if (body.notes !== undefined) next.notes = body.notes;
  const maturationInputs = ['measuredOn', 'heightCm', 'sittingHeightCm', 'weightKg'] as const;
  if (maturationInputs.some((field) => body[field] !== undefined && body[field] !== row[field])) {
    next.maturation = { ...row.maturation, derivedAt: null };
  }
  return next;
};

/** A correction of an external load (B-511): the fields it sets, the load recomputed. */
const externalLoadCorrect: Overlay<'external_load.correct', ExternalLoad> = (row, { body }) => {
  const next: ExternalLoad = { ...row };
  if (body.localDate !== undefined) next.localDate = body.localDate;
  if (body.activity !== undefined) next.activity = body.activity;
  if (body.detail !== undefined) next.detail = body.detail;
  if (body.minutes !== undefined) next.minutes = body.minutes;
  if (body.rpe !== undefined) next.rpe = body.rpe;
  return { ...next, srpeAu: next.rpe * next.minutes };
};

/** Archived until the pull brings the server's time of it. */
const externalLoadArchive: Overlay<'external_load.archive', ExternalLoad> = (
  row,
  _input,
  { enqueuedAt },
) => (row.archivedAt === null ? { ...row, archivedAt: new Date(enqueuedAt).toISOString() } : row);

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
  'gym_set.correct': gymSetCorrect as AnyOverlay,
  'gym_set.void': gymSetVoid as AnyOverlay,
  'anthro.update': anthroUpdate as AnyOverlay,
  'external_load.correct': externalLoadCorrect as AnyOverlay,
  'external_load.archive': externalLoadArchive as AnyOverlay,
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
