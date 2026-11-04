import type { CanonicalMetricCode } from '../codes.js';
import { assertIntegerAtLeast, assertPositive, invalidArgument } from './validate.js';

/**
 * Reaction test (B-606): simple reaction and go/no-go on a touch screen, as
 * pure logic. The app shows what this module plans, times the touch and
 * records what it classifies; the result is the mean of the valid stimuli
 * (`reaction_simple_msec`, `reaction_go_no_go_msec`).
 *
 * A touch screen adds a latency of its own (30–80 ms between devices, from
 * the panel, the touch sampling and the frame the stimulus lands on), so a
 * time is only compared with the same player's on the same device
 * (`sameDeviceOnly` in the protocol): never between players, never across
 * devices.
 *
 * - **Simple:** after a random wait, a stimulus appears and the player
 *   touches as fast as possible.
 * - **Go/no-go:** the stimulus is either "go" (touch) or "no-go" (hold);
 *   only the go stimuli give times, a touch on a no-go is an error of
 *   commission.
 *
 * Every series starts with practice stimuli that are not scored; then
 * stimuli follow until the planned number of valid ones (the `attemptCount`
 * of the test definition). An anticipation (a touch before the stimulus or
 * faster than a human can react) or a missing response is repeated; past
 * the cap of stimuli the series is incomplete and is not recorded.
 */

export const REACTION_TASKS = ['simple', 'go_no_go'] as const;
export type ReactionTask = (typeof REACTION_TASKS)[number];

/** The metric each task records (milliseconds, lower is better). */
export const REACTION_METRIC_BY_TASK = {
  simple: 'reaction_simple_msec',
  go_no_go: 'reaction_go_no_go_msec',
} as const satisfies Record<ReactionTask, CanonicalMetricCode>;

export const REACTION_STIMULI = ['go', 'no_go'] as const;
export type ReactionStimulus = (typeof REACTION_STIMULI)[number];

/**
 * What one stimulus ended as: `valid` (a go touched in time), `anticipation`
 * (a touch before the stimulus or under the anticipation threshold),
 * `lapse` (a go without a touch in the response window), `commission` (a
 * no-go touched) and `correct_rejection` (a no-go held).
 */
export const REACTION_OUTCOMES = [
  'valid',
  'anticipation',
  'lapse',
  'commission',
  'correct_rejection',
] as const;
export type ReactionOutcome = (typeof REACTION_OUTCOMES)[number];

export interface ReactionProtocol {
  /** Valid stimuli per series: the `attemptCount` of the test definition (5). */
  readonly validTrials: number;
  /** Practice stimuli at the start of each series, not scored (3). */
  readonly practiceTrials: number;
  /** Random wait before each stimulus, from this… (ms). */
  readonly foreperiodMinMs: number;
  /** …to this (ms): a fixed wait would be anticipated. */
  readonly foreperiodMaxMs: number;
  /** A touch faster than this after the stimulus is an anticipation (100 ms). */
  readonly anticipationMs: number;
  /** How long the stimulus waits for a touch (ms); after it, a go is a lapse. */
  readonly responseWindowMs: number;
  /** Share of no-go stimuli in a go/no-go series (0.3). */
  readonly noGoShare: number;
  /** Most no-go stimuli in a row (2): a long run of holds teaches to hold. */
  readonly maxNoGoInARow: number;
  /** Most scored stimuli in a series (practice apart) before it is incomplete. */
  readonly maxTrialsPerSeries: number;
}

/**
 * The standard protocol: 3 practice stimuli and 5 valid ones per series,
 * waits of 1 to 3 s, 100 ms for an anticipation, 1 s to respond, 30% no-go
 * (never more than 2 in a row) and at most 20 scored stimuli per series.
 * Data: a protocol version overrides any of them in its `parameters` (read
 * with {@link reactionProtocol}).
 */
export const DEFAULT_REACTION_PROTOCOL = {
  validTrials: 5,
  practiceTrials: 3,
  foreperiodMinMs: 1000,
  foreperiodMaxMs: 3000,
  anticipationMs: 100,
  responseWindowMs: 1000,
  noGoShare: 0.3,
  maxNoGoInARow: 2,
  maxTrialsPerSeries: 20,
} as const satisfies ReactionProtocol;

/** Throws `invalid_argument` unless the settings make a series that can end. */
export function assertReactionProtocol(protocol: ReactionProtocol): void {
  assertIntegerAtLeast('protocol.validTrials', protocol.validTrials, 1);
  assertIntegerAtLeast('protocol.practiceTrials', protocol.practiceTrials, 0);
  assertPositive('protocol.foreperiodMinMs', protocol.foreperiodMinMs);
  assertPositive('protocol.anticipationMs', protocol.anticipationMs);
  assertPositive('protocol.responseWindowMs', protocol.responseWindowMs);
  assertIntegerAtLeast('protocol.maxNoGoInARow', protocol.maxNoGoInARow, 1);
  if (
    !Number.isFinite(protocol.foreperiodMaxMs) ||
    protocol.foreperiodMaxMs < protocol.foreperiodMinMs
  ) {
    invalidArgument(
      'protocol.foreperiodMaxMs must be >= protocol.foreperiodMinMs.',
      protocol.foreperiodMaxMs,
    );
  }
  if (protocol.responseWindowMs <= protocol.anticipationMs) {
    invalidArgument(
      'protocol.responseWindowMs must be longer than protocol.anticipationMs.',
      protocol.responseWindowMs,
    );
  }
  if (!Number.isFinite(protocol.noGoShare) || protocol.noGoShare <= 0 || protocol.noGoShare >= 1) {
    invalidArgument('protocol.noGoShare must be > 0 and < 1.', protocol.noGoShare);
  }
  if (
    !Number.isSafeInteger(protocol.maxTrialsPerSeries) ||
    protocol.maxTrialsPerSeries < protocol.validTrials
  ) {
    invalidArgument(
      'protocol.maxTrialsPerSeries must be an integer >= protocol.validTrials.',
      protocol.maxTrialsPerSeries,
    );
  }
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function integerOr(value: unknown, min: number, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
    ? value
    : fallback;
}

/**
 * {@link ReactionProtocol} of a protocol version: its `parameters`
 * (`test_definition.protocol.parameters`) and its `attemptCount` (the valid
 * stimuli). A missing or malformed setting falls back to the default;
 * settings that do not make a series that can end together fall back to the
 * whole default protocol with the version's valid stimuli, never to a mix.
 */
export function reactionProtocol(
  parameters: Readonly<Record<string, unknown>> | null | undefined,
  attemptCount?: number | null,
): ReactionProtocol {
  const p = parameters ?? {};
  const d = DEFAULT_REACTION_PROTOCOL;
  const validTrials = integerOr(attemptCount, 1, integerOr(p.validTrials, 1, d.validTrials));
  const read: ReactionProtocol = {
    validTrials,
    practiceTrials: integerOr(p.practiceTrials, 0, d.practiceTrials),
    foreperiodMinMs: positiveOr(p.foreperiodMinMs, d.foreperiodMinMs),
    foreperiodMaxMs: positiveOr(p.foreperiodMaxMs, d.foreperiodMaxMs),
    anticipationMs: positiveOr(p.anticipationMs, d.anticipationMs),
    responseWindowMs: positiveOr(p.responseWindowMs, d.responseWindowMs),
    noGoShare: positiveOr(p.noGoShare, d.noGoShare),
    maxNoGoInARow: integerOr(p.maxNoGoInARow, 1, d.maxNoGoInARow),
    maxTrialsPerSeries: integerOr(
      p.maxTrialsPerSeries,
      1,
      Math.max(d.maxTrialsPerSeries, validTrials * 4),
    ),
  };
  try {
    assertReactionProtocol(read);
    return read;
  } catch {
    return {
      ...d,
      validTrials,
      maxTrialsPerSeries: Math.max(d.maxTrialsPerSeries, validTrials * 4),
    };
  }
}

/** Whether a protocol version is compared only on the same device (the reaction test). */
export function isSameDeviceOnlyProtocol(
  parameters: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  return parameters?.sameDeviceOnly === true;
}

// ─── Stimuli ─────────────────────────────────────────────────────────────────────────

/** One stimulus as planned. */
export interface ReactionTrial {
  /** 0-based, over the whole series (practice included). */
  readonly index: number;
  readonly practice: boolean;
  readonly stimulus: ReactionStimulus;
  /** Wait from the start of the trial to the stimulus, in whole ms. */
  readonly foreperiodMs: number;
}

/** What the player did on one stimulus, as the app timed it. */
export type ReactionResponse =
  /** A touch while waiting, before the stimulus showed. */
  | { readonly kind: 'early' }
  /** A touch `reactionMs` after the stimulus showed. */
  | { readonly kind: 'touch'; readonly reactionMs: number }
  /** No touch within the response window. */
  | { readonly kind: 'none' };

/** One stimulus with what it ended as. */
export interface ReactionTrialRecord extends ReactionTrial {
  readonly outcome: ReactionOutcome;
  /** The time of a touch after the stimulus, in whole ms (`null` otherwise). */
  readonly reactionMs: number | null;
}

/** What a response to a stimulus counts as. */
export function classifyReactionResponse(
  stimulus: ReactionStimulus,
  response: ReactionResponse,
  protocol: ReactionProtocol,
): ReactionOutcome {
  if (response.kind === 'early') return 'anticipation';
  if (response.kind === 'none') return stimulus === 'go' ? 'lapse' : 'correct_rejection';
  if (!Number.isFinite(response.reactionMs) || response.reactionMs < protocol.anticipationMs) {
    return 'anticipation';
  }
  if (response.reactionMs > protocol.responseWindowMs) {
    return stimulus === 'go' ? 'lapse' : 'correct_rejection';
  }
  return stimulus === 'go' ? 'valid' : 'commission';
}

/** The record of a stimulus: its outcome and, for a touch after it, the time in whole ms. */
export function recordReactionTrial(
  trial: ReactionTrial,
  response: ReactionResponse,
  protocol: ReactionProtocol,
): ReactionTrialRecord {
  const outcome = classifyReactionResponse(trial.stimulus, response, protocol);
  return {
    ...trial,
    outcome,
    reactionMs:
      response.kind === 'touch' && Number.isFinite(response.reactionMs)
        ? Math.round(response.reactionMs)
        : null,
  };
}

/** Where a series stands. */
export type ReactionSeriesStatus = 'in_progress' | 'complete' | 'incomplete';

export interface ReactionSeriesSummary {
  readonly task: ReactionTask;
  readonly status: ReactionSeriesStatus;
  /** Times of the valid stimuli, in order (whole ms): the attempts of the result. */
  readonly validMs: readonly number[];
  /** Mean of {@link validMs}, rounded to the ms; `null` until the series is complete. */
  readonly meanMs: number | null;
  readonly anticipations: number;
  readonly lapses: number;
  readonly commissions: number;
  readonly correctRejections: number;
  /** No-go stimuli shown (scored ones). */
  readonly noGoTrials: number;
  /** Scored stimuli shown so far (practice apart). */
  readonly scoredTrials: number;
}

/** The summary of a series from its records (practice is never scored). */
export function summarizeReactionSeries(
  task: ReactionTask,
  records: readonly ReactionTrialRecord[],
  protocol: ReactionProtocol,
): ReactionSeriesSummary {
  const scored = records.filter((r) => !r.practice);
  const count = (outcome: ReactionOutcome) => scored.filter((r) => r.outcome === outcome).length;
  const validMs = scored.flatMap((r) =>
    r.outcome === 'valid' && r.reactionMs !== null ? [r.reactionMs] : [],
  );
  const kept = validMs.slice(0, protocol.validTrials);
  const complete = kept.length >= protocol.validTrials;
  const status: ReactionSeriesStatus = complete
    ? 'complete'
    : scored.length >= protocol.maxTrialsPerSeries
      ? 'incomplete'
      : 'in_progress';
  return {
    task,
    status,
    validMs: kept,
    meanMs: complete ? Math.round(kept.reduce((sum, v) => sum + v, 0) / kept.length) : null,
    anticipations: count('anticipation'),
    lapses: count('lapse'),
    commissions: count('commission'),
    correctRejections: count('correct_rejection'),
    noGoTrials: scored.filter((r) => r.stimulus === 'no_go').length,
    scoredTrials: scored.length,
  };
}

/**
 * The next stimulus of a series, or `null` once it is over (complete or
 * incomplete). `random` returns a number in `[0, 1)` (injected, so a series
 * replays in tests): it draws the wait and, in go/no-go, the kind of
 * stimulus. A practice series of go/no-go shows at least one no-go, so the
 * player sees both before the scored ones.
 */
export function nextReactionTrial(
  task: ReactionTask,
  records: readonly ReactionTrialRecord[],
  protocol: ReactionProtocol,
  random: () => number,
): ReactionTrial | null {
  const summary = summarizeReactionSeries(task, records, protocol);
  if (summary.status !== 'in_progress') return null;
  const index = records.length;
  const practice = index < protocol.practiceTrials;
  const span = protocol.foreperiodMaxMs - protocol.foreperiodMinMs;
  const foreperiodMs = Math.round(protocol.foreperiodMinMs + unit(random()) * span);
  return {
    index,
    practice,
    stimulus: stimulusFor(task, records, protocol, random, practice),
    foreperiodMs,
  };
}

function unit(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1 - Number.EPSILON) : 0;
}

function stimulusFor(
  task: ReactionTask,
  records: readonly ReactionTrialRecord[],
  protocol: ReactionProtocol,
  random: () => number,
  practice: boolean,
): ReactionStimulus {
  if (task === 'simple') return 'go';
  const index = records.length;
  // The last practice stimulus is a no-go if practice had none: both are seen before scoring.
  if (
    practice &&
    index === protocol.practiceTrials - 1 &&
    protocol.practiceTrials >= 2 &&
    !records.some((r) => r.stimulus === 'no_go')
  ) {
    return 'no_go';
  }
  let run = 0;
  for (let i = records.length - 1; i >= 0 && records[i]?.stimulus === 'no_go'; i -= 1) run += 1;
  if (run >= protocol.maxNoGoInARow) return 'go';
  // Practice never starts with a no-go: the first touch is always rewarded.
  if (index === 0) return 'go';
  return unit(random()) < protocol.noGoShare ? 'no_go' : 'go';
}

// ─── Comparison: the same player on the same device ──────────────────────────────────

/** A recorded reaction result as the history compares it. */
export interface ReactionHistoryPoint {
  readonly playerId: string;
  /** `null`: recorded without a device (an import): never compared. */
  readonly deviceId: string | null;
  readonly measuredOn: string;
  readonly valueMs: number;
}

/**
 * The player's own earlier results of a metric on one device, oldest first:
 * the only comparison the reaction test allows. Other players and other
 * devices (or no device) are left out, never mixed in.
 */
export function reactionHistoryOnDevice<P extends ReactionHistoryPoint>(
  points: readonly P[],
  playerId: string,
  deviceId: string,
): P[] {
  return points
    .filter((p) => p.playerId === playerId && p.deviceId === deviceId)
    .sort((a, b) => a.measuredOn.localeCompare(b.measuredOn));
}
