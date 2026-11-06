import { snapFrameRate } from './high-speed.ts';

/**
 * A slow-motion video taken from the gallery (ADR 0102): recorded with the
 * phone's own camera app ("Cámara lenta"), so the app never chose its frame
 * rate. The real capture rate comes from the file, and the measurement
 * needs capture-time seconds (`t = frames / captureFps`), so a file whose
 * timeline was stretched for slow playback (240 frames per capture second
 * shown over 8 s at 30 fps) still maps each frame to its capture time. Pure,
 * so it is tested in Node.
 */

/** What the native side reads from the file (`modules/cmj-frames`, `inspect`). */
export interface VideoTimingInfo {
  /** Presentation times of the first video samples (µs, any order: decode order has B-frames). */
  readonly frameTimesUs: readonly number[];
  /** Video samples in the whole track (`frameTimesUs` may hold only the first ones). */
  readonly sampleCount: number;
  /** Duration of the track on the file's timeline (ms). */
  readonly durationMs: number;
  /** Frame rate the container declares (Android `KEY_FRAME_RATE`, iOS `nominalFrameRate`). */
  readonly nominalFps: number | null;
  /**
   * Capture rate from the metadata, when the camera wrote it (Android
   * `com.android.capture.fps` / `METADATA_KEY_CAPTURE_FRAMERATE`): for
   * a file re-timed for slow playback it is the only place the real rate is.
   */
  readonly captureFps: number | null;
  readonly sizeBytes: number | null;
}

/** How the frames of an imported file map to capture time. */
export interface VideoTiming {
  /** The rate the camera captured at: the one stored with the attempt. */
  readonly captureFps: number;
  /** Frames per second of the file's own timeline. */
  readonly timelineFps: number;
  /**
   * Seconds of the file's timeline per second of capture (1 when the file
   * plays at its capture rate, 8 for 240 fps shown at 30 fps): the time to
   * ask the frame extractor for is the capture time times this.
   */
  readonly timelineScale: number;
  readonly frameCount: number;
  /** Capture-time duration (ms): `frameCount` frames at `captureFps`. */
  readonly durationMs: number;
}

export type VideoTimingProblem =
  /** No video track, or too few frames to tell a rate. */
  | 'unreadable'
  /** The frames are not evenly spaced (a slow section between normal-speed ones). */
  | 'variable_rate';

/** Share of the gaps between frames that may be off the usual gap (dropped frames). */
const MAX_IRREGULAR_SHARE = 0.05;

/** A capture rate in the metadata this much over the timeline's says the file was re-timed. */
const STRETCH_TOLERANCE = 1.05;

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

/**
 * The timing of a file from its frame times: the rate of its timeline (the
 * usual gap between frames), evenly spaced or not, and the capture rate:
 * the metadata's when it is faster than the timeline (the file was re-timed
 * for slow playback), else the timeline's.
 */
export function videoTiming(info: VideoTimingInfo):
  | { readonly ok: true; readonly timing: VideoTiming }
  | {
      readonly ok: false;
      readonly problem: VideoTimingProblem;
    } {
  const times = [...info.frameTimesUs].filter(Number.isFinite).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i] ?? 0) - (times[i - 1] ?? 0);
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length < 2) return { ok: false, problem: 'unreadable' };
  const usualGapUs = median([...gaps].sort((a, b) => a - b));
  if (!(usualGapUs > 0)) return { ok: false, problem: 'unreadable' };
  const irregular = gaps.filter((gap) => gap < usualGapUs * 0.5 || gap > usualGapUs * 1.5).length;
  if (irregular / gaps.length > MAX_IRREGULAR_SHARE) return { ok: false, problem: 'variable_rate' };

  const timelineFps = snapFrameRate(1_000_000 / usualGapUs);
  const declared = info.captureFps;
  const captureFps =
    declared !== null && Number.isFinite(declared) && declared > timelineFps * STRETCH_TOLERANCE
      ? snapFrameRate(declared)
      : timelineFps;
  const frameCount = Math.max(info.sampleCount, times.length);
  return {
    ok: true,
    timing: {
      captureFps,
      timelineFps,
      timelineScale: captureFps / timelineFps,
      frameCount,
      durationMs: (frameCount * 1000) / captureFps,
    },
  };
}

export type ImportRejection =
  | { readonly reason: VideoTimingProblem }
  /** Captured under the minimum: `fps` says at how much. */
  | { readonly reason: 'too_slow'; readonly fps: number }
  | { readonly reason: 'too_large' }
  | { readonly reason: 'format' };

export interface ImportLimits {
  readonly minFps: number;
  /** Largest file the test keeps (`null`: no limit beyond the phone's). */
  readonly maxSizeBytes: number | null;
  /** Content types the test keeps (`null`: any video). */
  readonly contentTypes: readonly string[] | null;
}

export type ImportDecision =
  | { readonly accepted: true; readonly timing: VideoTiming }
  | { readonly accepted: false; readonly rejection: ImportRejection };

/**
 * Whether an imported file can be marked: a known format and size, evenly
 * spaced frames and a capture rate that reaches the minimum.
 */
export function acceptImportedVideo(
  info: VideoTimingInfo,
  contentType: string | null,
  limits: ImportLimits,
): ImportDecision {
  if (
    limits.contentTypes !== null &&
    (contentType === null || !limits.contentTypes.includes(contentType))
  ) {
    return { accepted: false, rejection: { reason: 'format' } };
  }
  if (
    limits.maxSizeBytes !== null &&
    info.sizeBytes !== null &&
    info.sizeBytes > limits.maxSizeBytes
  ) {
    return { accepted: false, rejection: { reason: 'too_large' } };
  }
  const result = videoTiming(info);
  if (!result.ok) return { accepted: false, rejection: { reason: result.problem } };
  if (!(result.timing.captureFps >= limits.minFps)) {
    return {
      accepted: false,
      rejection: { reason: 'too_slow', fps: Math.round(result.timing.captureFps) },
    };
  }
  return { accepted: true, timing: result.timing };
}

/**
 * The content type of a picked file: the picker's, else from its extension
 * (`.mp4`, `.mov`); `null` when neither says.
 */
export function videoContentType(mimeType: string | null, path: string): string | null {
  if (mimeType?.startsWith('video/') === true) return mimeType;
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  if (extension === 'mov' || extension === 'qt') return 'video/quicktime';
  return null;
}

/** What the record screens show about an import. */
export type VideoImportState =
  | { readonly status: 'idle' }
  | { readonly status: 'reading' }
  | { readonly status: 'rejected'; readonly rejection: ImportRejection }
  /** The picker or the file failed (not a problem of the video). */
  | { readonly status: 'failed' };

/** A video picked from the gallery, already copied into the app. */
export interface PickedVideoFile {
  readonly path: string;
  readonly contentType: string | null;
  readonly info: VideoTimingInfo;
}

export type ImportOutcome =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'rejected'; readonly rejection: ImportRejection }
  | {
      readonly kind: 'accepted';
      readonly path: string;
      readonly contentType: string | null;
      readonly timing: VideoTiming;
    };

/**
 * Picks a video and decides on it: a refused copy is deleted, an accepted
 * one is handed on with its timing (the test adopts the file).
 */
export async function importVideo(
  pick: () => Promise<PickedVideoFile | null>,
  discard: (path: string) => void,
  limits: ImportLimits,
): Promise<ImportOutcome> {
  const picked = await pick();
  if (picked === null) return { kind: 'cancelled' };
  const decision = acceptImportedVideo(picked.info, picked.contentType, limits);
  if (!decision.accepted) {
    discard(picked.path);
    return { kind: 'rejected', rejection: decision.rejection };
  }
  return {
    kind: 'accepted',
    path: picked.path,
    contentType: picked.contentType,
    timing: decision.timing,
  };
}

/** The state an outcome leaves the record screen in (`null`: it moves on to the marking). */
export function importStateOf(outcome: ImportOutcome): VideoImportState | null {
  switch (outcome.kind) {
    case 'cancelled':
      return { status: 'idle' };
    case 'rejected':
      return { status: 'rejected', rejection: outcome.rejection };
    case 'accepted':
      return null;
  }
}
