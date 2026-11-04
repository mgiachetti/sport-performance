import {
  sprintVideoLayout,
  sprintVideoMinCameraDistanceM,
  type SprintVideoLayout,
} from '@sport-performance/domain';
import { parseNumber } from '@sport-performance/i18n';

/**
 * The layout of the field for the sprint by video (B-605, ADR 0082): the
 * evaluator says how far the phone stands from the lane and how far behind
 * the lane the cones go, and the screen says where each cone goes. Pure.
 */

/** Distance from the phone to the lane suggested first, m: a 60° camera sees the 40 m. */
export const DEFAULT_CAMERA_DISTANCE_M = 35;

/** Cones 1 m behind the lane: out of the way of the runner, close enough to align. */
export const DEFAULT_POLE_OFFSET_M = 1;

/**
 * Horizontal field of view assumed for the main camera of a phone filming
 * in slow motion (landscape; 240 fps modes crop a little). The real check
 * is the preview: the four cones must be in the frame.
 */
export const MAIN_CAMERA_FIELD_OF_VIEW_DEG = 60;

/** Limits of what is typed, m: within a field, never on the lane. */
const CAMERA_DISTANCE_RANGE_M = { min: 5, max: 100 } as const;
const POLE_OFFSET_RANGE_M = { min: 0, max: 10 } as const;

export interface LayoutDraft {
  readonly cameraDistance: string;
  readonly poleOffset: string;
}

export type LayoutFieldProblem = 'invalid' | 'out_of_range';

export type LayoutParse =
  | { readonly status: 'ok'; readonly layout: SprintVideoLayout }
  | {
      readonly status: 'problems';
      readonly cameraDistance: LayoutFieldProblem | null;
      readonly poleOffset: LayoutFieldProblem | null;
    };

function parseField(
  text: string,
  range: { readonly min: number; readonly max: number },
): number | LayoutFieldProblem {
  const value = parseNumber(text, { allowGrouping: false });
  if (value === null) return 'invalid';
  if (value < range.min || value > range.max) return 'out_of_range';
  return value;
}

/** The layout of what the evaluator typed (es-AR: `1,5`). */
export function parseLayoutDraft(draft: LayoutDraft): LayoutParse {
  const cameraDistanceM = parseField(draft.cameraDistance, CAMERA_DISTANCE_RANGE_M);
  const poleOffsetM = parseField(draft.poleOffset, POLE_OFFSET_RANGE_M);
  if (typeof cameraDistanceM !== 'number' || typeof poleOffsetM !== 'number') {
    return {
      status: 'problems',
      cameraDistance: typeof cameraDistanceM === 'number' ? null : cameraDistanceM,
      poleOffset: typeof poleOffsetM === 'number' ? null : poleOffsetM,
    };
  }
  return { status: 'ok', layout: sprintVideoLayout({ cameraDistanceM, poleOffsetM }) };
}

/** The shortest distance at which the main camera sees the four lines, m (rounded up). */
export function mainCameraMinDistanceM(): number {
  return Math.ceil(sprintVideoMinCameraDistanceM(MAIN_CAMERA_FIELD_OF_VIEW_DEG));
}

export const CAMERA_DISTANCE_LIMITS_M = CAMERA_DISTANCE_RANGE_M;
export const POLE_OFFSET_LIMITS_M = POLE_OFFSET_RANGE_M;
