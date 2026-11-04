import {
  DomainValidationError,
  checkPlausibleValue,
  parseMetricCode,
  sprintVideoMeasurement,
  type Sex,
  type SprintVideoMeasurement,
} from '@sport-performance/domain';

/**
 * The frame-by-frame marking of a filmed sprint (B-605, ADR 0082): the
 * evaluator moves through the frames and marks the one where the torso
 * crosses each line, aligned with its cone. Pure, so the screen only
 * renders it.
 */

/** The marks, in the order the runner crosses the lines. */
export const SPRINT_MARKS = ['start', 'line10', 'line20', 'line40'] as const;
export type SprintMark = (typeof SPRINT_MARKS)[number];

/** The line each mark is, in m from the start line. */
export const SPRINT_MARK_LINE_M: Readonly<Record<SprintMark, number>> = {
  start: 0,
  line10: 10,
  line20: 20,
  line40: 40,
};

/** Steps of the frame buttons: one frame, a few, a quarter of a second at 240 fps. */
export const SPRINT_FRAME_STEPS = [-60, -10, -1, 1, 10, 60] as const;

export interface SprintMarkingState {
  readonly frameRateFps: number;
  readonly frameCount: number;
  /** The frame on screen. */
  readonly frame: number;
  readonly marks: Readonly<Record<SprintMark, number | null>>;
  /** The line the next "mark" press is for. */
  readonly current: SprintMark;
}

export type SprintMarkingAction =
  | { readonly type: 'step'; readonly delta: number }
  | { readonly type: 'seek'; readonly frame: number }
  | { readonly type: 'select'; readonly mark: SprintMark }
  | { readonly type: 'mark' }
  | { readonly type: 'go_to'; readonly mark: SprintMark }
  | { readonly type: 'clear'; readonly mark: SprintMark };

const NO_MARKS: Readonly<Record<SprintMark, number | null>> = {
  start: null,
  line10: null,
  line20: null,
  line40: null,
};

/** Frames of a video of `durationMs` at `frameRateFps` (a partial last frame left out). */
export function videoFrameCount(durationMs: number, frameRateFps: number): number {
  if (!(durationMs > 0) || !(frameRateFps > 0)) return 1;
  return Math.max(1, Math.floor((durationMs * frameRateFps) / 1000));
}

function clampFrame(frame: number, frameCount: number): number {
  return Math.min(frameCount - 1, Math.max(0, Math.round(frame)));
}

export function initialSprintMarking(durationMs: number, frameRateFps: number): SprintMarkingState {
  return {
    frameRateFps,
    frameCount: videoFrameCount(durationMs, frameRateFps),
    frame: 0,
    marks: NO_MARKS,
    current: 'start',
  };
}

/** The first line after `mark` with no frame yet, or `mark` itself when all are marked. */
function nextUnmarked(marks: SprintMarkingState['marks'], after: SprintMark): SprintMark {
  const from = SPRINT_MARKS.indexOf(after);
  for (let i = from + 1; i < SPRINT_MARKS.length; i += 1) {
    const mark = SPRINT_MARKS[i];
    if (mark !== undefined && marks[mark] === null) return mark;
  }
  return after;
}

export function sprintMarkingReducer(
  state: SprintMarkingState,
  action: SprintMarkingAction,
): SprintMarkingState {
  switch (action.type) {
    case 'step':
      return { ...state, frame: clampFrame(state.frame + action.delta, state.frameCount) };
    case 'seek':
      return { ...state, frame: clampFrame(action.frame, state.frameCount) };
    case 'select':
      return { ...state, current: action.mark };
    case 'mark': {
      const marks = { ...state.marks, [state.current]: state.frame };
      // The runner goes on: the next press is for the next line.
      return { ...state, marks, current: nextUnmarked(marks, state.current) };
    }
    case 'go_to': {
      const frame = state.marks[action.mark];
      return frame === null
        ? { ...state, current: action.mark }
        : { ...state, frame, current: action.mark };
    }
    case 'clear':
      return { ...state, marks: { ...state.marks, [action.mark]: null }, current: action.mark };
  }
}

/**
 * Time of the frame on screen to ask the video for its image: the middle of
 * the frame, so a rounding of the time either way still lands in it.
 */
export function frameTimeMs(state: Pick<SprintMarkingState, 'frame' | 'frameRateFps'>): number {
  return ((state.frame + 0.5) * 1000) / state.frameRateFps;
}

export type SprintMarkingResult =
  | { readonly status: 'incomplete' }
  /** The marks do not follow the order of the lines. */
  | { readonly status: 'invalid' }
  | ({ readonly status: 'measured' } & SprintVideoMeasurement);

/** The splits of the marks: 0, 20 and 40 m are needed; 10 m is optional. */
export function sprintMarkingResult(state: SprintMarkingState): SprintMarkingResult {
  const { start, line10, line20, line40 } = state.marks;
  if (start === null || line20 === null || line40 === null) return { status: 'incomplete' };
  try {
    return {
      status: 'measured',
      ...sprintVideoMeasurement({
        startFrame: start,
        ...(line10 !== null && { frame10: line10 }),
        frame20: line20,
        frame40: line40,
        frameRateFps: state.frameRateFps,
      }),
    };
  } catch (error) {
    if (error instanceof DomainValidationError) return { status: 'invalid' };
    throw error;
  }
}

const METRICS = {
  sprint_10_s: parseMetricCode('sprint_10_s'),
  sprint_20_s: parseMetricCode('sprint_20_s'),
  sprint_40_s: parseMetricCode('sprint_40_s'),
  sprint_vmax_ms: parseMetricCode('sprint_vmax_ms'),
} as const;

export type SprintCheckedMetric = keyof typeof METRICS;

/**
 * The values out of the plausible range of the catalog defaults: the
 * evaluator checks the marks before saving (never a block, an outlier may
 * be real).
 */
export function implausibleSprintValues(
  measurement: SprintVideoMeasurement,
  sex: Sex,
): SprintCheckedMetric[] {
  const values: [SprintCheckedMetric, number | undefined][] = [
    ['sprint_10_s', measurement.splits.split10S],
    ['sprint_20_s', measurement.splits.split20S],
    ['sprint_40_s', measurement.splits.split40S],
    ['sprint_vmax_ms', measurement.vmaxMs],
  ];
  return values.flatMap(([code, value]) => {
    if (value === undefined) return [];
    const range = checkPlausibleValue({ metricCode: METRICS[code], value, sex, ageYears: null });
    return range.status === 'below' || range.status === 'above' ? [code] : [];
  });
}
