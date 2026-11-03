import { DEFAULT_IFT_3015_PROTOCOL, vift3015Kmh, type Ift3015Protocol } from './ift3015.js';
import { assertIntegerAtLeast, assertPositive, invalidArgument } from './validate.js';

/**
 * Audio signals of the 30-15 Intermittent Fitness Test (B-507, Buchheit
 * 2008), as pure timing logic: the app plays what this module schedules and
 * the staff marks each player against it.
 *
 * Each stage is a 30 s run and a 15 s recovery. During the run the players
 * shuttle on a 40 m course with lines at both ends and in the middle; a
 * signal sounds every time they must be in the 3 m tolerance zone of a line
 * (every 20 m at the stage speed). In the recovery they walk forward to the
 * nearest line, where the next stage starts. A player's test ends when they
 * stop or miss the zone at three consecutive signals; the result is the last
 * stage completed (`vift_kmh`).
 *
 * Times are integer milliseconds from the start of stage 1 (the lead-in
 * before it is negative), so they compare exactly and the schedule is the
 * same on every device.
 */

/** Settings of the signals, on top of the speed progression of {@link Ift3015Protocol}. */
export interface Ift3015SignalProtocol extends Ift3015Protocol {
  /** Running part of each stage, in seconds (30). */
  readonly workDurationS: number;
  /** Recovery part of each stage, in seconds (15). `work + recovery = stageDurationS`. */
  readonly recoveryDurationS: number;
  /** Length of the shuttle course, in metres (40). */
  readonly shuttleLengthM: number;
  /** Distance between the lines a signal marks (ends and middle), in metres (20). */
  readonly lineSpacingM: number;
  /** Width of the tolerance zone around each line, in metres (3). Shown to the staff. */
  readonly toleranceZoneM: number;
  /** Last stage of the recording; whoever completes it ends with it. */
  readonly maxStages: number;
  /** Time between pressing start and stage 1, in seconds. */
  readonly leadInS: number;
  /** Countdown signals (one per second) before each stage starts. */
  readonly countdownS: number;
  /** Consecutive missed zones that end a player's test (3). */
  readonly missesToStop: number;
  /**
   * A "stopped" mark this many seconds into a recovery still counts against
   * the stage just run: the staff taps a moment after seeing the player fail.
   */
  readonly stopGraceS: number;
}

/**
 * The standard test: the speed progression of {@link DEFAULT_IFT_3015_PROTOCOL},
 * 30 s + 15 s, 40 m with lines every 20 m and 3 m zones, three misses. 40
 * stages reach 27.5 km/h, past any recorded VIFT (the plausible range ends
 * at 25 km/h). Data: a protocol version overrides any of them in its
 * `parameters` (read with {@link ift3015SignalProtocol}).
 */
export const DEFAULT_IFT_3015_SIGNAL_PROTOCOL = {
  ...DEFAULT_IFT_3015_PROTOCOL,
  workDurationS: 30,
  recoveryDurationS: 15,
  shuttleLengthM: 40,
  lineSpacingM: 20,
  toleranceZoneM: 3,
  maxStages: 40,
  leadInS: 10,
  countdownS: 3,
  missesToStop: 3,
  stopGraceS: 2,
} as const satisfies Ift3015SignalProtocol;

const MS_PER_S = 1000;

function msOf(seconds: number): number {
  return Math.round(seconds * MS_PER_S);
}

/** Throws `invalid_argument` unless the settings make a playable test. */
export function assertIft3015SignalProtocol(protocol: Ift3015SignalProtocol): void {
  assertPositive('protocol.initialSpeedKmh', protocol.initialSpeedKmh);
  assertPositive('protocol.stageIncrementKmh', protocol.stageIncrementKmh);
  assertPositive('protocol.stageDurationS', protocol.stageDurationS);
  assertPositive('protocol.workDurationS', protocol.workDurationS);
  assertPositive('protocol.recoveryDurationS', protocol.recoveryDurationS);
  assertPositive('protocol.shuttleLengthM', protocol.shuttleLengthM);
  assertPositive('protocol.lineSpacingM', protocol.lineSpacingM);
  assertPositive('protocol.toleranceZoneM', protocol.toleranceZoneM);
  assertIntegerAtLeast('protocol.maxStages', protocol.maxStages, 1);
  assertIntegerAtLeast('protocol.countdownS', protocol.countdownS, 0);
  assertIntegerAtLeast('protocol.missesToStop', protocol.missesToStop, 1);
  if (!Number.isFinite(protocol.leadInS) || protocol.leadInS < protocol.countdownS) {
    invalidArgument('protocol.leadInS must be >= protocol.countdownS.', protocol.leadInS);
  }
  if (msOf(protocol.workDurationS) + msOf(protocol.recoveryDurationS) !== stageMs(protocol)) {
    invalidArgument(
      'protocol.workDurationS + protocol.recoveryDurationS must equal protocol.stageDurationS.',
      protocol,
    );
  }
  if (protocol.countdownS >= protocol.recoveryDurationS) {
    invalidArgument('protocol.countdownS must be shorter than the recovery.', protocol.countdownS);
  }
  if (
    !Number.isFinite(protocol.stopGraceS) ||
    protocol.stopGraceS < 0 ||
    protocol.stopGraceS >= protocol.recoveryDurationS
  ) {
    invalidArgument(
      'protocol.stopGraceS must be >= 0 and shorter than the recovery.',
      protocol.stopGraceS,
    );
  }
  const linesPerShuttle = protocol.shuttleLengthM / protocol.lineSpacingM;
  if (!Number.isInteger(linesPerShuttle)) {
    invalidArgument(
      'protocol.lineSpacingM must divide protocol.shuttleLengthM (lines at both ends).',
      protocol.lineSpacingM,
    );
  }
}

function stageMs(protocol: Ift3015Protocol): number {
  return msOf(protocol.stageDurationS);
}

function positiveOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function integerOr(value: unknown, min: number, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
    ? value
    : fallback;
}

function nonNegativeOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * {@link Ift3015SignalProtocol} of a protocol version's `parameters`
 * (`test_definition.protocol.parameters`): each missing or malformed setting
 * falls back to the default; settings that do not make a playable test
 * together (a recovery that does not add up to the stage) fall back to the
 * whole default timing, never to a mix.
 */
export function ift3015SignalProtocol(
  parameters: Readonly<Record<string, unknown>> | null | undefined,
): Ift3015SignalProtocol {
  const p = parameters ?? {};
  const d = DEFAULT_IFT_3015_SIGNAL_PROTOCOL;
  const read: Ift3015SignalProtocol = {
    initialSpeedKmh: positiveOr(p.initialSpeedKmh, d.initialSpeedKmh),
    stageIncrementKmh: positiveOr(p.stageIncrementKmh, d.stageIncrementKmh),
    stageDurationS: positiveOr(p.stageDurationS, d.stageDurationS),
    workDurationS: positiveOr(p.workDurationS, d.workDurationS),
    recoveryDurationS: positiveOr(p.recoveryDurationS, d.recoveryDurationS),
    shuttleLengthM: positiveOr(p.shuttleLengthM, d.shuttleLengthM),
    lineSpacingM: positiveOr(p.lineSpacingM, d.lineSpacingM),
    toleranceZoneM: positiveOr(p.toleranceZoneM, d.toleranceZoneM),
    maxStages: integerOr(p.maxStages, 1, d.maxStages),
    leadInS: nonNegativeOr(p.leadInS, d.leadInS),
    countdownS: integerOr(p.countdownS, 0, d.countdownS),
    missesToStop: integerOr(p.missesToStop, 1, d.missesToStop),
    stopGraceS: nonNegativeOr(p.stopGraceS, d.stopGraceS),
  };
  try {
    assertIft3015SignalProtocol(read);
    return read;
  } catch {
    // Keep the speed progression (it scores the result) and the club's rule
    // values; take the whole default timing.
    const fallback: Ift3015SignalProtocol = {
      ...d,
      initialSpeedKmh: read.initialSpeedKmh,
      stageIncrementKmh: read.stageIncrementKmh,
      maxStages: read.maxStages,
      missesToStop: read.missesToStop,
    };
    return fallback;
  }
}

/** Speed of a stage (1-based), in km/h. */
export function ift3015StageSpeedKmh(stage: number, protocol: Ift3015Protocol): number {
  return vift3015Kmh(stage, protocol);
}

/** Start of the run of a stage (1-based), in ms from the start of stage 1. */
export function ift3015StageStartMs(stage: number, protocol: Ift3015SignalProtocol): number {
  assertIntegerAtLeast('stage', stage, 1);
  return (stage - 1) * stageMs(protocol);
}

/** End of the run of a stage (start of its recovery), in ms from the start of stage 1. */
export function ift3015RunEndMs(stage: number, protocol: Ift3015SignalProtocol): number {
  return ift3015StageStartMs(stage, protocol) + msOf(protocol.workDurationS);
}

/** End of the test: the end of the run of the last stage. */
export function ift3015TestEndMs(protocol: Ift3015SignalProtocol): number {
  return ift3015RunEndMs(protocol.maxStages, protocol);
}

/** Start of the lead-in (when the staff presses start), in ms (≤ 0). */
export function ift3015LeadInStartMs(protocol: Ift3015SignalProtocol): number {
  return -msOf(protocol.leadInS);
}

/**
 * Time from the start of a run to the moment the players must be at the
 * `k`-th line (`k · lineSpacing / speed`), in integer ms. Computed as
 * `k · L · 3600 / speedKmh` so the usual speeds give exact values.
 */
export function ift3015LineOffsetMs(k: number, speedKmh: number, lineSpacingM: number): number {
  assertIntegerAtLeast('k', k, 1);
  assertPositive('speedKmh', speedKmh);
  assertPositive('lineSpacingM', lineSpacingM);
  return Math.round((k * lineSpacingM * 3600) / speedKmh);
}

export const IFT_3015_CUE_KINDS = [
  'countdown',
  'stage_start',
  'line',
  'run_end',
  'test_end',
] as const;
export type Ift3015CueKind = (typeof IFT_3015_CUE_KINDS)[number];

/** One signal of the test. */
export interface Ift3015Cue {
  /** Position in the schedule. */
  readonly index: number;
  readonly kind: Ift3015CueKind;
  /** When it sounds, in ms from the start of stage 1. */
  readonly atMs: number;
  /** Stage it belongs to (the upcoming one for a countdown). */
  readonly stage: number;
  /**
   * 0-based position among every line signal of the test, when the players
   * must be at a line: each `line`, and a `run_end` / `test_end` that falls
   * exactly on a line. Consecutive misses count over this index, across stages.
   */
  readonly lineIndex: number | null;
  /** Seconds left before the stage starts, for a `countdown` (3, 2, 1). */
  readonly secondsLeft: number | null;
}

/**
 * Every signal of the test, in time order: before each stage a countdown
 * (one per second), the start of the run, a signal at each line, and the end
 * of the run (the last stage's is the end of the test). When a line falls
 * exactly on the end of the run, the end signal is that line.
 */
export function ift3015Schedule(protocol: Ift3015SignalProtocol): readonly Ift3015Cue[] {
  assertIft3015SignalProtocol(protocol);
  const cues: Ift3015Cue[] = [];
  const workMs = msOf(protocol.workDurationS);
  let lineIndex = 0;
  const push = (cue: Omit<Ift3015Cue, 'index'>) => {
    cues.push({ index: cues.length, ...cue });
  };
  for (let stage = 1; stage <= protocol.maxStages; stage += 1) {
    const startMs = ift3015StageStartMs(stage, protocol);
    for (let secondsLeft = protocol.countdownS; secondsLeft >= 1; secondsLeft -= 1) {
      push({
        kind: 'countdown',
        atMs: startMs - secondsLeft * MS_PER_S,
        stage,
        lineIndex: null,
        secondsLeft,
      });
    }
    push({ kind: 'stage_start', atMs: startMs, stage, lineIndex: null, secondsLeft: null });
    const speedKmh = ift3015StageSpeedKmh(stage, protocol);
    let endIsLine = false;
    for (let k = 1; ; k += 1) {
      const offsetMs = ift3015LineOffsetMs(k, speedKmh, protocol.lineSpacingM);
      if (offsetMs > workMs) break;
      if (offsetMs === workMs) {
        endIsLine = true;
        break;
      }
      push({
        kind: 'line',
        atMs: startMs + offsetMs,
        stage,
        lineIndex: lineIndex++,
        secondsLeft: null,
      });
    }
    push({
      kind: stage === protocol.maxStages ? 'test_end' : 'run_end',
      atMs: startMs + workMs,
      stage,
      lineIndex: endIsLine ? lineIndex++ : null,
      secondsLeft: null,
    });
  }
  return cues;
}

export const IFT_3015_PHASES = ['lead_in', 'run', 'recovery', 'finished'] as const;
export type Ift3015Phase = (typeof IFT_3015_PHASES)[number];

/** Where the test is at an instant, for the screen. */
export interface Ift3015Moment {
  readonly phase: Ift3015Phase;
  /** Stage running, recovering from (`recovery`), upcoming (`lead_in`) or the last (`finished`). */
  readonly stage: number;
  /** Speed of `stage`, in km/h. */
  readonly speedKmh: number;
  /** Speed of the next stage during a recovery or the lead-in; `null` otherwise. */
  readonly nextSpeedKmh: number | null;
  /** Time into the phase, in ms. */
  readonly phaseElapsedMs: number;
  /** Time left in the phase, in ms (0 when finished). */
  readonly phaseRemainingMs: number;
  /** Distance a player on pace has run in this stage, in metres (runs only; else 0). */
  readonly expectedDistanceM: number;
}

/** {@link Ift3015Moment} at `atMs` (ms from the start of stage 1). */
export function ift3015MomentAt(protocol: Ift3015SignalProtocol, atMs: number): Ift3015Moment {
  assertIft3015SignalProtocol(protocol);
  if (!Number.isFinite(atMs)) invalidArgument('atMs must be a finite number.', atMs);
  const stageLengthMs = stageMs(protocol);
  const workMs = msOf(protocol.workDurationS);
  const firstSpeed = ift3015StageSpeedKmh(1, protocol);
  if (atMs < 0) {
    const leadInStart = ift3015LeadInStartMs(protocol);
    return {
      phase: 'lead_in',
      stage: 1,
      speedKmh: firstSpeed,
      nextSpeedKmh: firstSpeed,
      phaseElapsedMs: Math.max(0, atMs - leadInStart),
      phaseRemainingMs: -atMs,
      expectedDistanceM: 0,
    };
  }
  const endMs = ift3015TestEndMs(protocol);
  if (atMs >= endMs) {
    return {
      phase: 'finished',
      stage: protocol.maxStages,
      speedKmh: ift3015StageSpeedKmh(protocol.maxStages, protocol),
      nextSpeedKmh: null,
      phaseElapsedMs: atMs - endMs,
      phaseRemainingMs: 0,
      expectedDistanceM: 0,
    };
  }
  const stage = Math.floor(atMs / stageLengthMs) + 1;
  const intoStageMs = atMs - (stage - 1) * stageLengthMs;
  const speedKmh = ift3015StageSpeedKmh(stage, protocol);
  if (intoStageMs < workMs) {
    return {
      phase: 'run',
      stage,
      speedKmh,
      nextSpeedKmh: null,
      phaseElapsedMs: intoStageMs,
      phaseRemainingMs: workMs - intoStageMs,
      expectedDistanceM: ((speedKmh / 3.6) * intoStageMs) / MS_PER_S,
    };
  }
  return {
    phase: 'recovery',
    stage,
    speedKmh,
    nextSpeedKmh: ift3015StageSpeedKmh(stage + 1, protocol),
    phaseElapsedMs: intoStageMs - workMs,
    phaseRemainingMs: stageLengthMs - intoStageMs,
    expectedDistanceM: 0,
  };
}

/** What the player should do with the clock at `nowMs`. */
export interface Ift3015DueCues {
  /** Due and still on time: play them now, in order. */
  readonly play: readonly Ift3015Cue[];
  /** Due but later than the tolerance: never played late (a late signal misleads the players). */
  readonly skipped: readonly Ift3015Cue[];
  /** First cue not yet due. */
  readonly nextIndex: number;
  /** When it is due, or `null` after the last. */
  readonly nextAtMs: number | null;
}

/**
 * Drift-free scheduling: which cues from `nextIndex` are due at `nowMs` (the
 * monotonic clock, in ms from the start of stage 1). The caller waits until
 * `nextAtMs` measured on the same clock, so timer delays never add up.
 *
 * @param lateToleranceMs how late a cue may still sound.
 */
export function dueIft3015Cues(
  schedule: readonly Ift3015Cue[],
  nextIndex: number,
  nowMs: number,
  lateToleranceMs: number,
): Ift3015DueCues {
  assertIntegerAtLeast('nextIndex', nextIndex, 0);
  if (!Number.isFinite(lateToleranceMs) || lateToleranceMs < 0) {
    invalidArgument('lateToleranceMs must be >= 0.', lateToleranceMs);
  }
  const play: Ift3015Cue[] = [];
  const skipped: Ift3015Cue[] = [];
  let index = nextIndex;
  while (index < schedule.length) {
    const cue = schedule[index];
    if (cue === undefined || cue.atMs > nowMs) break;
    (nowMs - cue.atMs <= lateToleranceMs ? play : skipped).push(cue);
    index += 1;
  }
  return { play, skipped, nextIndex: index, nextAtMs: schedule[index]?.atMs ?? null };
}

/** Index of the first cue due after `atMs` (to resume the schedule mid-test). */
export function ift3015CueIndexAfter(schedule: readonly Ift3015Cue[], atMs: number): number {
  let low = 0;
  let high = schedule.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    const cue = schedule[mid];
    if (cue !== undefined && cue.atMs <= atMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Latest line signal at or before `atMs`, or `null` before the first. */
export function ift3015LineCueAtOrBefore(
  schedule: readonly Ift3015Cue[],
  atMs: number,
): Ift3015Cue | null {
  for (let index = ift3015CueIndexAfter(schedule, atMs) - 1; index >= 0; index -= 1) {
    const cue = schedule[index];
    if (cue !== undefined && cue.lineIndex !== null) return cue;
  }
  return null;
}

// ─── Marks of the staff ──────────────────────────────────────────────────────────────

export const IFT_3015_OUTCOMES = ['running', 'missed_lines', 'stopped', 'completed'] as const;
/**
 * `running` (still in the test), `missed_lines` (missed the zone at
 * consecutive signals), `stopped` (stopped, or the staff ended the test
 * early) or `completed` (ran every stage of the recording).
 */
export type Ift3015Outcome = (typeof IFT_3015_OUTCOMES)[number];

/** A player's marks in one run of the test. */
export interface Ift3015PlayerMarks {
  readonly playerId: string;
  /** `lineIndex` of each missed zone, ascending, without repeats. */
  readonly misses: readonly number[];
  readonly outcome: Ift3015Outcome;
  /** Last stage completed (0: not even stage 1); `null` while running. */
  readonly lastCompletedStage: number | null;
  /** When the test ended for the player, in ms from the start of stage 1. */
  readonly endedAtMs: number | null;
  /** Stage the staff set by hand over `lastCompletedStage`; `null` if not corrected. */
  readonly adjustedStage: number | null;
}

export function newIft3015PlayerMarks(playerId: string): Ift3015PlayerMarks {
  return {
    playerId,
    misses: [],
    outcome: 'running',
    lastCompletedStage: null,
    endedAtMs: null,
    adjustedStage: null,
  };
}

function trailingStreak(misses: readonly number[]): number {
  let streak = 0;
  for (let i = misses.length - 1; i >= 0; i -= 1) {
    const current = misses[i];
    const following = misses[i + 1];
    if (following !== undefined && current !== following - 1) break;
    streak += 1;
  }
  return streak;
}

/**
 * Consecutive missed zones that still count at `nowMs`: the trailing run of
 * misses, while the signal after the last one has not passed unmarked (the
 * staff may still be tapping it). Shown next to each player (`1/3`, `2/3`).
 */
export function ift3015MissStreak(
  marks: Ift3015PlayerMarks,
  schedule: readonly Ift3015Cue[],
  nowMs: number,
): number {
  const last = marks.misses.at(-1);
  if (last === undefined) return 0;
  const latest = ift3015LineCueAtOrBefore(schedule, nowMs)?.lineIndex ?? null;
  if (marks.outcome === 'running' && latest !== null && latest > last + 1) return 0;
  return trailingStreak(marks.misses);
}

/**
 * The staff saw the player miss the zone: the miss goes to the latest line
 * signal at `atMs` (tapping twice for the same signal counts once). At
 * `missesToStop` consecutive misses the player's test ends: the stage of the
 * last miss was not completed. A tap before the first line signal, or for a
 * player no longer running, changes nothing.
 */
export function recordIft3015Miss(
  marks: Ift3015PlayerMarks,
  schedule: readonly Ift3015Cue[],
  protocol: Ift3015SignalProtocol,
  atMs: number,
): Ift3015PlayerMarks {
  if (marks.outcome !== 'running') return marks;
  const cue = ift3015LineCueAtOrBefore(schedule, atMs);
  const lineIndex = cue?.lineIndex ?? null;
  if (cue === null || lineIndex === null) return marks;
  const last = marks.misses.at(-1);
  if (last !== undefined && lineIndex <= last) return marks;
  const misses = [...marks.misses, lineIndex];
  if (trailingStreak(misses) < protocol.missesToStop) return { ...marks, misses };
  return {
    ...marks,
    misses,
    outcome: 'missed_lines',
    lastCompletedStage: cue.stage - 1,
    endedAtMs: cue.atMs,
  };
}

/**
 * Last stage completed by a player who stops at `atMs`: in the lead-in, 0;
 * during the run of stage `n`, `n − 1`; in the recovery after stage `n`, `n`
 * (they ran it all), except in its first `stopGraceS` (a tap right after
 * failing at the end of the run); after the end of the test, the last stage.
 */
export function ift3015StageCompletedAt(protocol: Ift3015SignalProtocol, atMs: number): number {
  const moment = ift3015MomentAt(protocol, atMs);
  switch (moment.phase) {
    case 'lead_in':
      return 0;
    case 'run':
      return moment.stage - 1;
    case 'recovery':
      return moment.phaseElapsedMs < msOf(protocol.stopGraceS) ? moment.stage - 1 : moment.stage;
    case 'finished':
      return protocol.maxStages;
  }
}

/** The staff saw the player stop. A player no longer running is unchanged. */
export function stopIft3015Player(
  marks: Ift3015PlayerMarks,
  protocol: Ift3015SignalProtocol,
  atMs: number,
): Ift3015PlayerMarks {
  if (marks.outcome !== 'running') return marks;
  const completed = atMs >= ift3015TestEndMs(protocol);
  return {
    ...marks,
    outcome: completed ? 'completed' : 'stopped',
    lastCompletedStage: ift3015StageCompletedAt(protocol, atMs),
    endedAtMs: atMs,
  };
}

/**
 * The test ends at `atMs` (its last stage ran out, or the staff ended it):
 * every player still running gets the stage completed by then.
 */
export function finishIft3015(
  players: readonly Ift3015PlayerMarks[],
  protocol: Ift3015SignalProtocol,
  atMs: number,
): readonly Ift3015PlayerMarks[] {
  return players.map((marks) => stopIft3015Player(marks, protocol, atMs));
}

/**
 * Undoes the player's last mark: an end (back to running, dropping the miss
 * that ended it) or else the last miss. A stage set by hand is undone first.
 */
export function undoIft3015Mark(marks: Ift3015PlayerMarks): Ift3015PlayerMarks {
  if (marks.adjustedStage !== null) return { ...marks, adjustedStage: null };
  if (marks.outcome !== 'running') {
    return {
      ...marks,
      misses: marks.outcome === 'missed_lines' ? marks.misses.slice(0, -1) : marks.misses,
      outcome: 'running',
      lastCompletedStage: null,
      endedAtMs: null,
      adjustedStage: null,
    };
  }
  return marks.misses.length === 0 ? marks : { ...marks, misses: marks.misses.slice(0, -1) };
}

/** The staff corrects the stage of a player whose test ended (0 to `maxStages`). */
export function adjustIft3015Stage(
  marks: Ift3015PlayerMarks,
  lastCompletedStage: number,
  protocol: Ift3015SignalProtocol,
): Ift3015PlayerMarks {
  if (marks.outcome === 'running') {
    invalidArgument('A running player has no stage to correct yet.', marks.playerId);
  }
  assertIntegerAtLeast('lastCompletedStage', lastCompletedStage, 0);
  if (lastCompletedStage > protocol.maxStages) {
    invalidArgument('lastCompletedStage must be <= protocol.maxStages.', lastCompletedStage);
  }
  return {
    ...marks,
    adjustedStage: lastCompletedStage === marks.lastCompletedStage ? null : lastCompletedStage,
  };
}

/** The result of a player whose test ended, as it is recorded. */
export interface Ift3015PlayerResult {
  readonly playerId: string;
  readonly outcome: Exclude<Ift3015Outcome, 'running'>;
  readonly lastCompletedStage: number;
  /** `vift_kmh`; `null` without stage 1 completed (no VIFT to record). */
  readonly viftKmh: number | null;
  /** The entry the API scores (`ift_stage`), or `null` without a VIFT. */
  readonly entry: { readonly kind: 'ift_stage'; readonly lastCompletedStage: number } | null;
  /** The staff corrected the stage marked during the test. */
  readonly adjusted: boolean;
}

/** {@link Ift3015PlayerResult} of a player, or `null` while running. */
export function ift3015PlayerResult(
  marks: Ift3015PlayerMarks,
  protocol: Ift3015Protocol,
): Ift3015PlayerResult | null {
  if (marks.outcome === 'running' || marks.lastCompletedStage === null) return null;
  const stage = marks.adjustedStage ?? marks.lastCompletedStage;
  const hasVift = stage >= 1;
  return {
    playerId: marks.playerId,
    outcome: marks.outcome,
    lastCompletedStage: stage,
    viftKmh: hasVift ? vift3015Kmh(stage, protocol) : null,
    entry: hasVift ? { kind: 'ift_stage', lastCompletedStage: stage } : null,
    adjusted: marks.adjustedStage !== null,
  };
}
