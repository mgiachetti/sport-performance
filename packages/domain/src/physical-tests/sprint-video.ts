import { sprintVmaxMs, type Sprint40Splits } from './sprint.js';
import {
  assertIntegerAtLeast,
  assertNonNegative,
  assertPositive,
  invalidArgument,
} from './validate.js';

/**
 * Sprint photo-finish by video (B-605, ADR 0082): one phone films the whole
 * 40 m from the side at high speed and the evaluator marks, frame by frame,
 * when the torso crosses each line (0, 10, 20 and 40 m). Every time comes
 * from the frames of one video: one clock, no synchronization between
 * phones and no network. The zero is the crossing of the 0 m line, as with
 * a photocell gate there (the player starts 0,5 m behind it): never the
 * reaction to a signal.
 */

/**
 * Lowest frame rate a sprint is filmed at. One frame is the resolution of
 * each mark: 8,3 ms at 120 fps (≈ 7 cm at 8 m/s), more than that and the
 * 10 m split moves by more than the change the test looks for.
 */
export const SPRINT_VIDEO_MIN_FPS = 120;

/** Frame rate asked for when the camera has it (slow motion): 4,2 ms per frame. */
export const SPRINT_VIDEO_PREFERRED_FPS = 240;

/** Whether the camera's frame rate is enough to film a sprint ({@link SPRINT_VIDEO_MIN_FPS}). */
export function isSprintVideoFrameRate(frameRateFps: number): boolean {
  return Number.isFinite(frameRateFps) && frameRateFps >= SPRINT_VIDEO_MIN_FPS;
}

/**
 * The frame rate to film at among what the camera offers: the preferred one
 * if it is there, else the fastest one under it that reaches the minimum
 * (or the slowest above it); `null` when none does.
 */
export function chooseSprintVideoFrameRate(available: readonly number[]): number | null {
  const usable = available.filter(isSprintVideoFrameRate);
  if (usable.length === 0) return null;
  if (usable.includes(SPRINT_VIDEO_PREFERRED_FPS)) return SPRINT_VIDEO_PREFERRED_FPS;
  const below = usable.filter((fps) => fps < SPRINT_VIDEO_PREFERRED_FPS);
  // Faster than the preferred rate only costs light, storage and marking time.
  return below.length > 0 ? Math.max(...below) : Math.min(...usable);
}

/** The frames marked on a sprint video: the torso crossing each line. */
export interface SprintVideoFrames {
  /** Crossing of the 0 m line: the zero of every split. */
  readonly startFrame: number;
  /** Crossing of the 10 m line; optional, as the 10 m gate of `sprint_splits`. */
  readonly frame10?: number | undefined;
  readonly frame20: number;
  readonly frame40: number;
  readonly frameRateFps: number;
}

/**
 * Split times of the marked frames: `(frame_line − startFrame) / fps`. The
 * frames are integers ≥ 0 that strictly increase with distance.
 *
 * @throws DomainValidationError when a frame is not an integer ≥ 0, the frame
 *   rate is not positive or the frames do not increase.
 */
export function sprintSplitsFromVideoFrames(frames: SprintVideoFrames): Sprint40Splits {
  const { startFrame, frame10, frame20, frame40, frameRateFps } = frames;
  assertIntegerAtLeast('startFrame', startFrame, 0);
  if (frame10 !== undefined) assertIntegerAtLeast('frame10', frame10, 0);
  assertIntegerAtLeast('frame20', frame20, 0);
  assertIntegerAtLeast('frame40', frame40, 0);
  assertPositive('frameRateFps', frameRateFps);
  const ordered = [startFrame, ...(frame10 === undefined ? [] : [frame10]), frame20, frame40];
  for (let i = 1; i < ordered.length; i += 1) {
    if ((ordered[i] ?? 0) <= (ordered[i - 1] ?? 0)) {
      invalidArgument(
        'sprintSplitsFromVideoFrames: the frames must strictly increase with distance (0 < 10 < 20 < 40 m).',
        { startFrame, frame10, frame20, frame40 },
      );
    }
  }
  const at = (frame: number) => (frame - startFrame) / frameRateFps;
  return {
    ...(frame10 !== undefined && { split10S: at(frame10) }),
    split20S: at(frame20),
    split40S: at(frame40),
  };
}

export interface SprintVideoMeasurement {
  readonly splits: Sprint40Splits;
  /** `20 / (t40 − t20)`, m/s. */
  readonly vmaxMs: number;
  /** How much a split moves when one of its marks is one frame off: `1 / fps`. */
  readonly splitPrecisionS: number;
  /**
   * How much the Vmax moves when the 20 or 40 m mark is one frame off (half
   * of `v(Δt − 1 frame) − v(Δt + 1 frame)`): shown next to it.
   */
  readonly vmaxPrecisionMs: number;
}

/** Splits, Vmax and the precision of the marking of a sprint video. */
export function sprintVideoMeasurement(frames: SprintVideoFrames): SprintVideoMeasurement {
  const splits = sprintSplitsFromVideoFrames(frames);
  const vmaxMs = sprintVmaxMs(splits);
  const frameS = 1 / frames.frameRateFps;
  const segmentS = splits.split40S - splits.split20S;
  const distanceM = vmaxMs * segmentS;
  const faster = segmentS > frameS ? distanceM / (segmentS - frameS) : vmaxMs;
  const slower = distanceM / (segmentS + frameS);
  return { splits, vmaxMs, splitPrecisionS: frameS, vmaxPrecisionMs: (faster - slower) / 2 };
}

// ─── Layout of the field ─────────────────────────────────────────────────────────────

/** Lines a `sprint_40` is timed at, in m from the start line. */
export const SPRINT_VIDEO_LINES_M = [0, 10, 20, 40] as const;

/**
 * Widest angle, from the perpendicular, the camera may see a line at: past
 * it the runner moves mostly towards or away from the camera, a frame is
 * less than a third of the displacement it is at the perpendicular
 * (`cos² 55° ≈ 0,33`) and the crossing is hard to see.
 */
export const SPRINT_VIDEO_MAX_SIGHT_ANGLE_DEG = 55;

export interface SprintVideoLayoutInput {
  /** Perpendicular distance from the camera to the runner's lane, m. */
  readonly cameraDistanceM: number;
  /**
   * Distance from the lane to the line of cones on the far side, m (behind
   * the runner, so nobody runs into them). 0: on the lane itself.
   */
  readonly poleOffsetM: number;
  /** Where the camera stands along the track, m from the start line; the middle by default. */
  readonly cameraAtM?: number;
  /** Lines to time, m from the start line; {@link SPRINT_VIDEO_LINES_M} by default. */
  readonly linesM?: readonly number[];
}

export interface SprintVideoPole {
  /** The line it marks, m from the start line. */
  readonly lineM: number;
  /**
   * Where the cone goes along the far line, m from the start line (negative
   * before it): seen from the camera, the cone is aligned with the runner
   * exactly when the runner crosses the line (parallax corrected).
   */
  readonly poleAtM: number;
  /** Angle between the camera's perpendicular to the lane and the line, degrees. */
  readonly sightAngleDeg: number;
  /** Seen too obliquely ({@link SPRINT_VIDEO_MAX_SIGHT_ANGLE_DEG}). */
  readonly oblique: boolean;
}

export interface SprintVideoLayout {
  readonly cameraAtM: number;
  readonly cameraDistanceM: number;
  readonly poleOffsetM: number;
  readonly poles: readonly SprintVideoPole[];
  /** Horizontal field of view the camera needs to see every cone, degrees. */
  readonly fieldOfViewDeg: number;
}

const DEG = 180 / Math.PI;

function linesOf(linesM: readonly number[] | undefined): readonly number[] {
  const lines = linesM ?? SPRINT_VIDEO_LINES_M;
  if (lines.length === 0) invalidArgument('A sprint layout needs at least one line.', lines);
  for (const line of lines) assertNonNegative('lineM', line);
  return lines;
}

/** Angle from the perpendicular at which the camera sees a point of the lane, degrees. */
function sightAngleDeg(lineM: number, cameraAtM: number, cameraDistanceM: number): number {
  return Math.atan(Math.abs(lineM - cameraAtM) / cameraDistanceM) * DEG;
}

/** Horizontal angle between the leftmost and the rightmost line, seen from the camera. */
function fieldOfViewDeg(
  lines: readonly number[],
  cameraAtM: number,
  cameraDistanceM: number,
): number {
  const left = Math.min(...lines) - cameraAtM;
  const right = Math.max(...lines) - cameraAtM;
  return (Math.atan(right / cameraDistanceM) - Math.atan(left / cameraDistanceM)) * DEG;
}

/**
 * Where the cones go (MySprint, Romero-Franco et al. 2017). Top view, with
 * the lane on `y = 0`, the camera at `(c, −D)` and the cones at `y = P`: the
 * camera, the runner at the line `x` and the cone are aligned when the cone
 * is at `c + (x − c)·(D + P)/D`. A cone on the line itself would be seen
 * aligned with the runner before or after the crossing (parallax).
 */
export function sprintVideoLayout(input: SprintVideoLayoutInput): SprintVideoLayout {
  const { cameraDistanceM, poleOffsetM } = input;
  assertPositive('cameraDistanceM', cameraDistanceM);
  assertNonNegative('poleOffsetM', poleOffsetM);
  const lines = linesOf(input.linesM);
  const cameraAtM = input.cameraAtM ?? (Math.min(...lines) + Math.max(...lines)) / 2;
  if (!Number.isFinite(cameraAtM)) invalidArgument('cameraAtM must be finite.', cameraAtM);
  const scale = (cameraDistanceM + poleOffsetM) / cameraDistanceM;
  return {
    cameraAtM,
    cameraDistanceM,
    poleOffsetM,
    poles: lines.map((lineM) => {
      const angle = sightAngleDeg(lineM, cameraAtM, cameraDistanceM);
      return {
        lineM,
        poleAtM: cameraAtM + (lineM - cameraAtM) * scale,
        sightAngleDeg: angle,
        oblique: angle > SPRINT_VIDEO_MAX_SIGHT_ANGLE_DEG,
      };
    }),
    fieldOfViewDeg: fieldOfViewDeg(lines, cameraAtM, cameraDistanceM),
  };
}

/**
 * The shortest perpendicular distance from which a camera with a horizontal
 * field of view of `fieldOfViewDeg` sees every line (from the middle of
 * them unless `cameraAtM` says otherwise), m. The cones are on the same
 * lines of sight, so they fit too.
 *
 * @throws DomainValidationError when the field of view is not in (0°, 180°)
 *   or the camera does not stand between the first and the last line.
 */
export function sprintVideoMinCameraDistanceM(
  fieldOfViewDeg: number,
  options: { readonly cameraAtM?: number; readonly linesM?: readonly number[] } = {},
): number {
  if (!Number.isFinite(fieldOfViewDeg) || fieldOfViewDeg <= 0 || fieldOfViewDeg >= 180) {
    invalidArgument('fieldOfViewDeg must be within (0, 180).', fieldOfViewDeg);
  }
  const lines = linesOf(options.linesM);
  const cameraAtM = options.cameraAtM ?? (Math.min(...lines) + Math.max(...lines)) / 2;
  const left = Math.min(...lines) - cameraAtM;
  const right = Math.max(...lines) - cameraAtM;
  if (left > 0 || right < 0) {
    invalidArgument('The camera must stand between the first and the last line.', cameraAtM);
  }
  if (left === right) return 0;
  const half = fieldOfViewDeg / 2 / DEG;
  if (-left === right) return right / Math.tan(half);
  // Between the lines, the angle they take shrinks as the camera moves back: bisection.
  let near = 0;
  let far = Math.max(-left, right) / Math.tan(Math.min(half, Math.PI / 4)) + 1;
  for (let i = 0; i < 80; i += 1) {
    const mid = (near + far) / 2;
    if ((Math.atan(right / mid) - Math.atan(left / mid)) * DEG > fieldOfViewDeg) near = mid;
    else far = mid;
  }
  return far;
}
