/**
 * Android constrained high-speed capture (ADR 0102): 120 and 240 fps reach
 * third-party apps only through a `CameraConstrainedHighSpeedCaptureSession`,
 * with the sizes and the fps ranges the camera lists for it
 * (`StreamConfigurationMap.getHighSpeedVideoSizes()` /
 * `getHighSpeedVideoFpsRangesFor(size)`). The app's own module
 * (`modules/high-speed-camera`) lists them; this picks what to film at. Pure,
 * so it is tested in Node.
 */

export interface FpsRange {
  readonly min: number;
  readonly max: number;
}

export interface HighSpeedSize {
  readonly width: number;
  readonly height: number;
  /** The ranges the high-speed session accepts at this size. */
  readonly fpsRanges: readonly FpsRange[];
}

/** A back camera with the constrained high-speed capability. */
export interface HighSpeedCamera {
  readonly id: string;
  readonly sizes: readonly HighSpeedSize[];
}

/** What to open the high-speed session with. */
export interface HighSpeedConfig {
  readonly cameraId: string;
  readonly width: number;
  readonly height: number;
  /** Fixed rate of the recording (`[fps, fps]`: a high-speed recording asks for a fixed range). */
  readonly fps: number;
  /**
   * Lower end of the preview-only range (`[previewMinFps, fps]`, usually
   * `[30, fps]`, saves power before recording); `fps` when the camera lists
   * no variable range ending at `fps` for the size.
   */
  readonly previewMinFps: number;
}

export interface HighSpeedRequest {
  /** Under this the test cannot be measured (120 fps). */
  readonly minFps: number;
  /** Asked for when the camera has it (240 fps). */
  readonly preferredFps: number;
  /** The size the recording is meant for (720p for the CMJ, 1080p for the sprint). */
  readonly targetWidth: number;
  readonly targetHeight: number;
}

/** Short side of a size under this is too coarse to mark a line or a foot. */
export const HIGH_SPEED_MIN_SHORT_SIDE_PX = 720;

interface Candidate extends HighSpeedConfig {
  readonly cameraIndex: number;
}

function shortSide(size: { readonly width: number; readonly height: number }): number {
  return Math.min(size.width, size.height);
}

/**
 * 0: the preferred rate at 720p or more; 1: another rate that reaches the
 * minimum at 720p or more; 2: under 720p.
 */
function tier(candidate: Candidate, request: HighSpeedRequest): number {
  if (shortSide(candidate) < HIGH_SPEED_MIN_SHORT_SIDE_PX) return 2;
  return candidate.fps === request.preferredFps ? 0 : 1;
}

/**
 * Order of the rates within a tier: the preferred one, then the fastest
 * under it, then the slowest over it (faster than that only costs light and
 * storage). Same rule as `chooseCmjVideoFrameRate`.
 */
function fpsRank(fps: number, preferredFps: number): number {
  return fps <= preferredFps ? preferredFps - fps : 10_000 + fps;
}

function sizeDistance(candidate: Candidate, request: HighSpeedRequest): number {
  const target = request.targetWidth * request.targetHeight;
  const pixels = candidate.width * candidate.height;
  // Under the target weighs a little more than over it at the same distance.
  return pixels >= target ? pixels - target : (target - pixels) * 1.01;
}

/**
 * The camera, size and fixed rate to film at: the preferred rate (240 fps)
 * at 720p or more, closest to the target size; else the closest rate that
 * reaches the minimum at 720p or more; else under 720p. The first camera the
 * system lists wins a tie (the main one). `null` when no fixed range reaches
 * the minimum: the phone cannot film the test at high speed.
 */
export function chooseHighSpeedConfig(
  cameras: readonly HighSpeedCamera[],
  request: HighSpeedRequest,
): HighSpeedConfig | null {
  const candidates: Candidate[] = [];
  cameras.forEach((camera, cameraIndex) => {
    for (const size of camera.sizes) {
      if (!(size.width > 0 && size.height > 0)) continue;
      for (const range of size.fpsRanges) {
        if (range.min !== range.max || !(range.max >= request.minFps)) continue;
        const fps = range.max;
        const variable = size.fpsRanges.filter((r) => r.max === fps && r.min < fps);
        const previewMinFps = variable.length === 0 ? fps : Math.min(...variable.map((r) => r.min));
        candidates.push({
          cameraId: camera.id,
          width: size.width,
          height: size.height,
          fps,
          previewMinFps,
          cameraIndex,
        });
      }
    }
  });
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      tier(a, request) - tier(b, request) ||
      fpsRank(a.fps, request.preferredFps) - fpsRank(b.fps, request.preferredFps) ||
      sizeDistance(a, request) - sizeDistance(b, request) ||
      a.cameraIndex - b.cameraIndex,
  );
  const [best] = candidates;
  if (best === undefined) return null;
  return {
    cameraId: best.cameraId,
    width: best.width,
    height: best.height,
    fps: best.fps,
    previewMinFps: best.previewMinFps,
  };
}

/** Common capture rates: a measured rate this close to one of them is that one. */
const STANDARD_FPS = [24, 25, 30, 48, 50, 60, 90, 100, 120, 180, 240, 480, 960] as const;
const STANDARD_TOLERANCE = 0.015;

/**
 * A measured frame rate (frames over time) as the rate the camera ran at:
 * the standard one it is within 1,5% of (239,7 → 240), else rounded to a
 * hundredth.
 */
export function snapFrameRate(fps: number): number {
  for (const standard of STANDARD_FPS) {
    if (Math.abs(fps - standard) / standard <= STANDARD_TOLERANCE) return standard;
  }
  return Math.round(fps * 100) / 100;
}

/**
 * The frame rate stored with a high-speed recording: the fixed rate of the
 * session, unless the file says otherwise (frames over its own timeline,
 * more than 10% away: the camera dropped frames or ran slower), then what
 * the file holds. The measurement counts frames, so it must be the file's.
 */
export function recordedFrameRate(sessionFps: number, measuredFps: number | null): number {
  if (measuredFps === null || !Number.isFinite(measuredFps) || measuredFps <= 0) {
    return sessionFps;
  }
  return Math.abs(measuredFps - sessionFps) / sessionFps <= 0.1
    ? sessionFps
    : snapFrameRate(measuredFps);
}
