import { memberGuard, memberParser } from '../enum.js';

/**
 * What the offline sync moves (ADR 0015, B-323). Collections are what a
 * device pulls; each one is a table whose changes the database logs per
 * row (`sync_change`).
 */
export const SYNC_COLLECTIONS = [
  'wellness',
  'participation',
  'training_session',
  'test_session',
  'test_result',
  'gym_program',
  'gym_set',
  'anthro_measurement',
  'external_load',
] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export const isSyncCollection = memberGuard(SYNC_COLLECTIONS);
export const parseSyncCollection = memberParser(
  SYNC_COLLECTIONS,
  'invalid_argument',
  'sync collection',
);

/**
 * Columns resolved per field, last writer wins by HLC: the editable fields
 * of the rows devices edit offline. The database keeps the clock of each
 * one (`sync_change.field_hlc`); the arguments of its trigger list exactly
 * these (a test checks it).
 */
export const SYNC_FIELD_COLUMNS = {
  wellness: ['sleep', 'fatigue', 'soreness', 'stress', 'mood'],
  participation: ['status', 'minutes', 'period_minutes', 'contacts_n', 'rpe'],
  test_result: [
    'measured_on',
    'status',
    'not_done_reason',
    'not_done_note',
    'method',
    'evaluator_id',
    'device_id',
    'exercise',
    'conditions',
    'notes',
  ],
  gym_set: ['reps', 'load_kg', 'rir', 'technique_score', 'duration_s', 'notes'],
  // The values and context of a measurement; the maturation the worker derives is not edited.
  anthro_measurement: [
    'measured_on',
    'height_cm',
    'sitting_height_cm',
    'weight_kg',
    'skinfolds_sum_mm',
    'method',
    'evaluator_id',
    'conditions',
    'notes',
  ],
  // What the player reports of an activity outside the club; archiving is one-way, no clock.
  external_load: ['local_date', 'activity', 'detail', 'minutes', 'rpe'],
} as const satisfies Partial<Record<SyncCollection, readonly string[]>>;

export type SyncFieldTable = keyof typeof SYNC_FIELD_COLUMNS;
export type SyncFieldColumn<T extends SyncFieldTable> = (typeof SYNC_FIELD_COLUMNS)[T][number];

/**
 * Operations a device pushes. Each one is a write the API already serves
 * online and runs through the same handler: same contract, permissions,
 * consents and RLS.
 */
export const SYNC_OPERATIONS = [
  'wellness.submit',
  'wellness.correct',
  'rpe.submit',
  'participation.record',
  'participation.update',
  'test_result.create',
  'test_session.record_results',
  'test_result.update',
  'test_result.add_entries',
  'test_result.void_entries',
  'gym_set.log',
  'gym_set.correct',
  'gym_set.void',
  // Create only (B-609, ADR 0078): health data the player gives, written to `medical`. Never
  // pulled back: it is not a collection, so it does not stay on the device once sent.
  'pain_report.submit',
  'anthro.record',
  'anthro.update',
  'external_load.report',
  'external_load.correct',
  'external_load.archive',
  // Create only (B-806, ADR 0092): a day of the menstrual cycle, to `medical`. Like the pain
  // report, never pulled back and forgotten by the device once applied.
  'menstrual_cycle.log',
] as const;
export type SyncOperation = (typeof SYNC_OPERATIONS)[number];

export const isSyncOperation = memberGuard(SYNC_OPERATIONS);

/**
 * What happened to a pushed mutation: `applied`; `superseded` (every field
 * it edits already has a later clock: nothing written); `replayed` (its
 * `mutationId` was applied before: not applied again); `rejected` (the
 * error the online endpoint answers; rolled back, the queue goes on).
 */
export const SYNC_MUTATION_STATUSES = ['applied', 'superseded', 'replayed', 'rejected'] as const;
export type SyncMutationStatus = (typeof SYNC_MUTATION_STATUSES)[number];

/**
 * Outcomes recorded for a mutation that went through (`sync_mutation.outcome`):
 * `replayed` when its handler answered a retry of the create by `clientUuid`
 * and wrote nothing.
 */
export const SYNC_STORED_OUTCOMES = ['applied', 'superseded', 'replayed'] as const;
export type SyncStoredOutcome = (typeof SYNC_STORED_OUTCOMES)[number];

/**
 * How far back a mutation counts as recorded (ADR 0050): the windows of an
 * online endpoint (the RPE of a session) are measured when the mutation was
 * recorded offline, by the device's clock, but never earlier than this many
 * days before it reaches the server. A queue kept offline longer, or a
 * device with its date far behind, is measured as recorded at that limit.
 */
export const SYNC_RECORDED_AT_MAX_AGE_DAYS = 7;

/** Mutations of one push. */
export const SYNC_PUSH_MAX = 100;
/** Changes of one pull page. */
export const SYNC_PULL_LIMIT_MAX = 500;
export const SYNC_PULL_LIMIT_DEFAULT = 200;
