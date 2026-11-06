import { CMJ_VIDEO_MIN_FPS, FILE_KIND_POLICIES } from '@sport-performance/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  chooseHighSpeedConfig,
  recordedFrameRate,
  snapFrameRate,
  type HighSpeedCamera,
} from './high-speed.ts';
import {
  acceptImportedVideo,
  importStateOf,
  importVideo,
  videoContentType,
  videoTiming,
  type VideoTimingInfo,
} from './imported.ts';

const CMJ = { minFps: 120, preferredFps: 240, targetWidth: 1280, targetHeight: 720 };
const SPRINT = { minFps: 120, preferredFps: 240, targetWidth: 1920, targetHeight: 1080 };

/** What a Galaxy S24 Ultra-like main camera lists for its high-speed session. */
const SAMSUNG: HighSpeedCamera = {
  id: '0',
  sizes: [
    {
      width: 1920,
      height: 1080,
      fpsRanges: [
        { min: 30, max: 120 },
        { min: 120, max: 120 },
        { min: 30, max: 240 },
        { min: 240, max: 240 },
      ],
    },
    {
      width: 1280,
      height: 720,
      fpsRanges: [
        { min: 30, max: 240 },
        { min: 240, max: 240 },
        { min: 30, max: 120 },
        { min: 120, max: 120 },
      ],
    },
    { width: 3840, height: 2160, fpsRanges: [{ min: 120, max: 120 }] },
  ],
};

describe('chooseHighSpeedConfig', () => {
  it('films at a fixed 240 fps at the size of the test when the camera has it', () => {
    expect(chooseHighSpeedConfig([SAMSUNG], CMJ)).toEqual({
      cameraId: '0',
      width: 1280,
      height: 720,
      fps: 240,
      previewMinFps: 30,
    });
    expect(chooseHighSpeedConfig([SAMSUNG], SPRINT)).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 240,
    });
  });

  it('takes 120 fps at 720p or more before 240 fps under 720p', () => {
    const camera: HighSpeedCamera = {
      id: '0',
      sizes: [
        { width: 720, height: 480, fpsRanges: [{ min: 240, max: 240 }] },
        { width: 1920, height: 1080, fpsRanges: [{ min: 120, max: 120 }] },
      ],
    };
    expect(chooseHighSpeedConfig([camera], CMJ)).toEqual({
      cameraId: '0',
      width: 1920,
      height: 1080,
      fps: 120,
      // No variable range ends at 120: the preview runs at the fixed one too.
      previewMinFps: 120,
    });
  });

  it('prefers the closest rate under 240 to a faster one, and the first camera on a tie', () => {
    const camera = (id: string, fps: number): HighSpeedCamera => ({
      id,
      sizes: [{ width: 1280, height: 720, fpsRanges: [{ min: fps, max: fps }] }],
    });
    expect(chooseHighSpeedConfig([camera('2', 480), camera('0', 120)], CMJ)?.fps).toBe(120);
    expect(chooseHighSpeedConfig([camera('2', 240), camera('0', 240)], CMJ)?.cameraId).toBe('2');
  });

  it('never records with a variable range nor under the minimum', () => {
    const camera: HighSpeedCamera = {
      id: '0',
      sizes: [
        {
          width: 1280,
          height: 720,
          fpsRanges: [
            { min: 30, max: 240 },
            { min: 60, max: 60 },
          ],
        },
      ],
    };
    expect(chooseHighSpeedConfig([camera], CMJ)).toBeNull();
    expect(chooseHighSpeedConfig([], CMJ)).toBeNull();
  });
});

describe('recorded frame rate', () => {
  it('keeps the session rate unless the file is more than 10% off', () => {
    expect(recordedFrameRate(240, 239.4)).toBe(240);
    expect(recordedFrameRate(240, null)).toBe(240);
    expect(recordedFrameRate(240, Number.NaN)).toBe(240);
    // The camera ran at half the rate: the file's frames are what gets counted.
    expect(recordedFrameRate(240, 119.6)).toBe(120);
    expect(recordedFrameRate(240, 200.123)).toBe(200.12);
  });

  it('snaps measured rates to the standard ones', () => {
    expect(snapFrameRate(29.97)).toBe(30);
    expect(snapFrameRate(238)).toBe(240);
    expect(snapFrameRate(210)).toBe(210);
  });
});

/** Frame times of `count` frames every `gapUs`, shuffled like decode order. */
function frames(count: number, gapUs: number, startUs = 0): number[] {
  const times = Array.from({ length: count }, (_, i) => startUs + Math.round(i * gapUs));
  // B-frames: decode order swaps neighbours.
  for (let i = 1; i + 1 < times.length; i += 3) {
    const a = times[i] ?? 0;
    times[i] = times[i + 1] ?? 0;
    times[i + 1] = a;
  }
  return times;
}

function info(overrides: Partial<VideoTimingInfo>): VideoTimingInfo {
  const frameTimesUs = overrides.frameTimesUs ?? frames(480, 1_000_000 / 240);
  return {
    frameTimesUs,
    sampleCount: frameTimesUs.length,
    durationMs: 2000,
    nominalFps: null,
    captureFps: null,
    sizeBytes: 10_000_000,
    ...overrides,
  };
}

const LIMITS = {
  minFps: CMJ_VIDEO_MIN_FPS,
  maxSizeBytes: FILE_KIND_POLICIES.cmj_video.maxSizeBytes,
  contentTypes: FILE_KIND_POLICIES.cmj_video.contentTypes,
};

describe('videoTiming', () => {
  it('reads the rate of a file that plays at its capture rate', () => {
    const result = videoTiming(info({ captureFps: 240 }));
    expect(result).toEqual({
      ok: true,
      timing: {
        captureFps: 240,
        timelineFps: 240,
        timelineScale: 1,
        frameCount: 480,
        durationMs: 2000,
      },
    });
  });

  it('maps a file re-timed for slow playback to capture time', () => {
    // 240 captured frames shown at 30 fps: 8 s of timeline per capture second.
    const result = videoTiming(
      info({ frameTimesUs: frames(480, 1_000_000 / 30), durationMs: 16_000, captureFps: 240 }),
    );
    expect(result.ok && result.timing).toEqual({
      captureFps: 240,
      timelineFps: 30,
      timelineScale: 8,
      frameCount: 480,
      durationMs: 2000,
    });
  });

  it('counts every sample even when only the first frame times came', () => {
    const result = videoTiming(info({ sampleCount: 2400 }));
    expect(result.ok && result.timing.durationMs).toBe(10_000);
  });

  it('refuses a file with a slow section between normal-speed ones, or without frames', () => {
    const mixed = [...frames(200, 1_000_000 / 240), ...frames(200, 1_000_000 / 30, 2_000_000)];
    expect(videoTiming(info({ frameTimesUs: mixed }))).toEqual({
      ok: false,
      problem: 'variable_rate',
    });
    expect(videoTiming(info({ frameTimesUs: [0] }))).toEqual({ ok: false, problem: 'unreadable' });
    // A dropped frame now and then is no reason to refuse it.
    const dropped = frames(480, 1_000_000 / 240).filter((_, i) => i % 50 !== 25);
    expect(videoTiming(info({ frameTimesUs: dropped })).ok).toBe(true);
  });
});

describe('acceptImportedVideo', () => {
  it('accepts a slow-motion file that reaches the minimum', () => {
    const decision = acceptImportedVideo(info({}), 'video/mp4', LIMITS);
    expect(decision.accepted && decision.timing.captureFps).toBe(240);
  });

  it('says why it refuses a file', () => {
    expect(
      acceptImportedVideo(info({ frameTimesUs: frames(90, 1_000_000 / 30) }), 'video/mp4', LIMITS),
    ).toEqual({ accepted: false, rejection: { reason: 'too_slow', fps: 30 } });
    expect(
      acceptImportedVideo(info({ frameTimesUs: frames(240, 1_000_000 / 60) }), 'video/mp4', LIMITS),
    ).toEqual({ accepted: false, rejection: { reason: 'too_slow', fps: 60 } });
    expect(acceptImportedVideo(info({}), 'video/webm', LIMITS)).toEqual({
      accepted: false,
      rejection: { reason: 'format' },
    });
    expect(
      acceptImportedVideo(info({ sizeBytes: 300 * 1024 * 1024 }), 'video/quicktime', LIMITS),
    ).toEqual({ accepted: false, rejection: { reason: 'too_large' } });
    expect(
      acceptImportedVideo(info({ sizeBytes: 300 * 1024 * 1024 }), null, {
        ...LIMITS,
        maxSizeBytes: null,
        contentTypes: null,
      }).accepted,
    ).toBe(true);
  });

  it('reads the content type from the picker or the extension', () => {
    expect(videoContentType('video/quicktime', '/a/b.mov')).toBe('video/quicktime');
    expect(videoContentType(null, '/a/b.MP4')).toBe('video/mp4');
    expect(videoContentType('application/octet-stream', '/a/b.mov')).toBe('video/quicktime');
    expect(videoContentType(null, '/a/b')).toBeNull();
  });
});

describe('importVideo', () => {
  const picked = { path: '/cache/a.mp4', contentType: 'video/mp4', info: info({}) };

  it('hands an accepted file on and deletes a refused one', async () => {
    const discard = vi.fn();
    const accepted = await importVideo(() => Promise.resolve(picked), discard, LIMITS);
    expect(accepted).toMatchObject({ kind: 'accepted', path: '/cache/a.mp4' });
    expect(importStateOf(accepted)).toBeNull();
    expect(discard).not.toHaveBeenCalled();

    const slow = { ...picked, info: info({ frameTimesUs: frames(60, 1_000_000 / 30) }) };
    const refused = await importVideo(() => Promise.resolve(slow), discard, LIMITS);
    expect(refused).toEqual({ kind: 'rejected', rejection: { reason: 'too_slow', fps: 30 } });
    expect(importStateOf(refused)).toEqual({
      status: 'rejected',
      rejection: { reason: 'too_slow', fps: 30 },
    });
    expect(discard).toHaveBeenCalledWith('/cache/a.mp4');
  });

  it('goes back to idle when the picker closes without a video', async () => {
    const outcome = await importVideo(() => Promise.resolve(null), vi.fn(), LIMITS);
    expect(importStateOf(outcome)).toEqual({ status: 'idle' });
  });
});
