import { describe, expect, it } from 'vitest';
import { DomainValidationError } from '../errors.js';
import {
  CMJ_VIDEO_MIN_FPS,
  chooseCmjVideoFrameRate,
  cmjVideoMeasurement,
  isCmjVideoFrameRate,
  stepVideoFrame,
  videoFrameCount,
  videoFrameTimeMs,
} from './cmj-video.js';
import { cmjHeightCmFromFlightTimeS } from './cmj.js';

describe('CMJ by video', () => {
  it('measures the flight between the marked frames with h = g·t²/8', () => {
    // 120 frames at 240 fps: 0,5 s in the air.
    const measured = cmjVideoMeasurement({
      takeoffFrame: 100,
      landingFrame: 220,
      frameRateFps: 240,
    });
    expect(measured.flightTimeS).toBe(0.5);
    expect(measured.heightCm).toBeCloseTo((9.81 * 0.25 * 100) / 8, 10);
    expect(measured.heightCm).toBeCloseTo(cmjHeightCmFromFlightTimeS(0.5), 10);
  });

  it('uses the gravity of the protocol version', () => {
    const frames = { takeoffFrame: 0, landingFrame: 120, frameRateFps: 240 };
    expect(cmjVideoMeasurement(frames, 9.8).heightCm).toBeCloseTo((9.8 * 0.25 * 100) / 8, 10);
  });

  it('says how precise the marking is: one frame either way', () => {
    // A 40 cm jump: ±0,6 cm at 240 fps, ±1,2 cm at 120, ±4,6 cm at 30.
    const at = (fps: number) =>
      cmjVideoMeasurement({
        takeoffFrame: 0,
        landingFrame: Math.round(0.571 * fps),
        frameRateFps: fps,
      }).precisionCm;
    expect(at(240)).toBeCloseTo(0.58, 1);
    expect(at(120)).toBeCloseTo(1.17, 1);
    expect(at(30)).toBeCloseTo(4.63, 1);
    expect(at(240)).toBeLessThan(at(120));
  });

  it('rejects a landing that is not after the take-off', () => {
    expect(() =>
      cmjVideoMeasurement({ takeoffFrame: 50, landingFrame: 50, frameRateFps: 240 }),
    ).toThrow(DomainValidationError);
    expect(() =>
      cmjVideoMeasurement({ takeoffFrame: 50, landingFrame: 10, frameRateFps: 240 }),
    ).toThrow(DomainValidationError);
  });

  it('asks for the middle of each frame', () => {
    expect(videoFrameTimeMs(0, 240)).toBeCloseTo(2.083, 3);
    expect(videoFrameTimeMs(240, 240)).toBeCloseTo(1002.083, 3);
    // Rounded to whole milliseconds, consecutive frames never share a time.
    const times = Array.from({ length: 480 }, (_, frame) =>
      Math.round(videoFrameTimeMs(frame, 240)),
    );
    expect(new Set(times).size).toBe(480);
    expect(() => videoFrameTimeMs(-1, 240)).toThrow(DomainValidationError);
    expect(() => videoFrameTimeMs(1.5, 240)).toThrow(DomainValidationError);
  });

  it('counts whole frames and keeps a step within the video', () => {
    expect(videoFrameCount(2_000, 240)).toBe(480);
    expect(videoFrameCount(2_001, 240)).toBe(480);
    expect(videoFrameCount(1, 30)).toBe(1);
    expect(stepVideoFrame(10, -1, 480)).toBe(9);
    expect(stepVideoFrame(5, -10, 480)).toBe(0);
    expect(stepVideoFrame(475, 10, 480)).toBe(479);
  });

  it('films at the preferred rate, or the closest that reaches the minimum', () => {
    expect(isCmjVideoFrameRate(CMJ_VIDEO_MIN_FPS)).toBe(true);
    expect(isCmjVideoFrameRate(60)).toBe(false);
    expect(isCmjVideoFrameRate(Number.NaN)).toBe(false);
    expect(chooseCmjVideoFrameRate([30, 60, 120, 240])).toBe(240);
    expect(chooseCmjVideoFrameRate([30, 60, 120, 480])).toBe(120);
    expect(chooseCmjVideoFrameRate([30, 480])).toBe(480);
    expect(chooseCmjVideoFrameRate([30, 60])).toBeNull();
    expect(chooseCmjVideoFrameRate([])).toBeNull();
  });
});
