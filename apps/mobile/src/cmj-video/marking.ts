import {
  DomainValidationError,
  checkPlausibleValue,
  parseMetricCode,
  cmjVideoMeasurement,
  stepVideoFrame,
  videoFrameCount,
  videoFrameTimeMs,
  type CmjVideoMeasurement,
  type Sex,
} from '@sport-performance/domain';

/**
 * The frame-by-frame marking of a recorded jump (B-604, ADR 0085): the
 * evaluator moves through the frames and marks the first one in the air
 * (take-off) and the first one back on the ground (landing). Pure, so the
 * screen only renders it.
 */
export interface MarkingState {
  readonly frameRateFps: number;
  readonly frameCount: number;
  /** The frame on screen. */
  readonly frame: number;
  readonly takeoffFrame: number | null;
  readonly landingFrame: number | null;
}

export type MarkingAction =
  | { readonly type: 'step'; readonly delta: number }
  | { readonly type: 'seek'; readonly frame: number }
  | { readonly type: 'mark_takeoff' }
  | { readonly type: 'mark_landing' }
  | { readonly type: 'go_to'; readonly mark: 'takeoff' | 'landing' }
  | { readonly type: 'clear' };

export function initialMarking(durationMs: number, frameRateFps: number): MarkingState {
  return {
    frameRateFps,
    frameCount: videoFrameCount(durationMs, frameRateFps),
    frame: 0,
    takeoffFrame: null,
    landingFrame: null,
  };
}

export function markingReducer(state: MarkingState, action: MarkingAction): MarkingState {
  switch (action.type) {
    case 'step':
      return { ...state, frame: stepVideoFrame(state.frame, action.delta, state.frameCount) };
    case 'seek':
      return { ...state, frame: stepVideoFrame(action.frame, 0, state.frameCount) };
    case 'mark_takeoff':
      return { ...state, takeoffFrame: state.frame };
    case 'mark_landing':
      return { ...state, landingFrame: state.frame };
    case 'go_to': {
      const frame = action.mark === 'takeoff' ? state.takeoffFrame : state.landingFrame;
      return frame === null ? state : { ...state, frame };
    }
    case 'clear':
      return { ...state, takeoffFrame: null, landingFrame: null };
  }
}

/** Time of the frame on screen, to ask for its image. */
export function frameTimeMs(state: MarkingState): number {
  return videoFrameTimeMs(state.frame, state.frameRateFps);
}

export type MarkingResult =
  | { readonly status: 'incomplete' }
  /** The landing is not after the take-off. */
  | { readonly status: 'invalid' }
  | ({ readonly status: 'measured' } & CmjVideoMeasurement);

export function markingResult(state: MarkingState, gravityMs2: number): MarkingResult {
  if (state.takeoffFrame === null || state.landingFrame === null) return { status: 'incomplete' };
  try {
    return {
      status: 'measured',
      ...cmjVideoMeasurement(
        {
          takeoffFrame: state.takeoffFrame,
          landingFrame: state.landingFrame,
          frameRateFps: state.frameRateFps,
        },
        gravityMs2,
      ),
    };
  } catch (error) {
    if (error instanceof DomainValidationError) return { status: 'invalid' };
    throw error;
  }
}

const CMJ_HEIGHT = parseMetricCode('cmj_height_cm');

/**
 * Whether the height is within the plausible range of `cmj_height_cm` for the
 * player's sex and age on the day (the same ranges and check the web sheet and
 * the import use): outside it the evaluator checks the marks before saving
 * (never a block: an outlier may be real). Without an age, the envelope of
 * every age of the sex.
 */
export function heightPlausibility(
  heightCm: number,
  player: { readonly sex: Sex; readonly ageYears: number | null },
): 'within' | 'below' | 'above' {
  const range = checkPlausibleValue({
    metricCode: CMJ_HEIGHT,
    value: heightCm,
    sex: player.sex,
    ageYears: player.ageYears,
  });
  return range.status === 'below' || range.status === 'above' ? range.status : 'within';
}
