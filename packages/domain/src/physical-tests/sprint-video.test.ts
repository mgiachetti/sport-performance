import { describe, expect, it } from 'vitest';
import {
  DomainValidationError,
  SPRINT_VIDEO_MAX_SIGHT_ANGLE_DEG,
  chooseSprintVideoFrameRate,
  isSprintVideoFrameRate,
  scoreTestEntry,
  sprintSplitsFromVideoFrames,
  sprintVideoLayout,
  sprintVideoMeasurement,
  sprintVideoMinCameraDistanceM,
} from '../index.js';

describe('sprint video frame rate', () => {
  it('needs 120 fps and prefers 240', () => {
    expect(isSprintVideoFrameRate(119.9)).toBe(false);
    expect(isSprintVideoFrameRate(120)).toBe(true);
    expect(isSprintVideoFrameRate(Number.NaN)).toBe(false);
    expect(chooseSprintVideoFrameRate([30, 60, 120, 240])).toBe(240);
    expect(chooseSprintVideoFrameRate([30, 120, 180])).toBe(180);
    expect(chooseSprintVideoFrameRate([60, 480])).toBe(480);
    expect(chooseSprintVideoFrameRate([30, 60])).toBeNull();
    expect(chooseSprintVideoFrameRate([])).toBeNull();
  });
});

describe('sprintSplitsFromVideoFrames', () => {
  it('times every line from the crossing of the 0 m line', () => {
    expect(
      sprintSplitsFromVideoFrames({
        startFrame: 120,
        frame10: 552,
        frame20: 888,
        frame40: 1488,
        frameRateFps: 240,
      }),
    ).toEqual({ split10S: 1.8, split20S: 3.2, split40S: 5.7 });
  });

  it('leaves the 10 m split out when it is not marked', () => {
    expect(
      sprintSplitsFromVideoFrames({
        startFrame: 0,
        frame20: 384,
        frame40: 684,
        frameRateFps: 120,
      }),
    ).toEqual({ split20S: 3.2, split40S: 5.7 });
  });

  it('refuses frames that do not increase, are not whole or a bad frame rate', () => {
    const base = { startFrame: 10, frame10: 50, frame20: 90, frame40: 150, frameRateFps: 240 };
    for (const frames of [
      { ...base, frame10: 10 },
      { ...base, frame20: 50 },
      { ...base, frame40: 80 },
      { ...base, startFrame: -1 },
      { ...base, frame20: 90.5 },
      { ...base, frameRateFps: 0 },
    ]) {
      expect(() => sprintSplitsFromVideoFrames(frames)).toThrow(DomainValidationError);
    }
  });
});

describe('sprintVideoMeasurement', () => {
  it('gives the Vmax and how much one frame moves each value', () => {
    const m = sprintVideoMeasurement({
      startFrame: 0,
      frame20: 768,
      frame40: 1368,
      frameRateFps: 240,
    });
    expect(m.splits).toEqual({ split20S: 3.2, split40S: 5.7 });
    expect(m.vmaxMs).toBeCloseTo(8, 10);
    expect(m.splitPrecisionS).toBeCloseTo(1 / 240, 12);
    // 20 / (2,5 ∓ 1/240): ≈ ±0,013 m/s.
    const expected = (20 / (2.5 - 1 / 240) - 20 / (2.5 + 1 / 240)) / 2;
    expect(m.vmaxPrecisionMs).toBeCloseTo(expected, 12);
    expect(m.vmaxPrecisionMs).toBeLessThan(0.02);
  });
});

describe('scoreTestEntry with sprint_video_frames', () => {
  it('computes every split and the Vmax from the frames', () => {
    const scored = scoreTestEntry('sprint_40', {
      kind: 'sprint_video_frames',
      startFrame: 120,
      frame10: 552,
      frame20: 888,
      frame40: 1488,
      frameRateFps: 240,
    });
    expect(scored.values).toEqual([
      { metricCode: 'sprint_10_s', value: 1.8, computed: true },
      { metricCode: 'sprint_20_s', value: 3.2, computed: true },
      { metricCode: 'sprint_40_s', value: 5.7, computed: true },
      { metricCode: 'sprint_vmax_ms', value: expect.closeTo(8, 10) as number, computed: true },
    ]);
    expect(scored.issues).toEqual([]);
  });

  it('belongs to the sprint only', () => {
    expect(() =>
      scoreTestEntry('cmj', {
        kind: 'sprint_video_frames',
        startFrame: 0,
        frame20: 10,
        frame40: 20,
        frameRateFps: 240,
      }),
    ).toThrow(DomainValidationError);
  });
});

describe('sprintVideoLayout', () => {
  it('moves each cone along the line of sight from the camera (parallax)', () => {
    const layout = sprintVideoLayout({ cameraDistanceM: 30, poleOffsetM: 1.5 });
    expect(layout.cameraAtM).toBe(20);
    const poles = layout.poles.map((p) => [p.lineM, p.poleAtM]);
    // c + (x − c)·(D + P)/D = 20 + (x − 20)·1,05
    expect(poles).toEqual([
      [0, -1],
      [10, 9.5],
      [20, 20],
      [40, 41],
    ]);
    for (const pole of layout.poles) {
      // Camera (20, −30), runner (x, 0) and cone (poleAtM, 1,5) are on one line.
      const slopeRunner = (pole.lineM - 20) / 30;
      const slopeCone = (pole.poleAtM - 20) / 31.5;
      expect(slopeCone).toBeCloseTo(slopeRunner, 12);
    }
  });

  it('says the field of view needed and which lines are seen too obliquely', () => {
    const far = sprintVideoLayout({ cameraDistanceM: 30, poleOffsetM: 1 });
    expect(far.fieldOfViewDeg).toBeCloseTo(2 * Math.atan(20 / 30) * (180 / Math.PI), 10);
    expect(far.poles.every((p) => !p.oblique)).toBe(true);
    const close = sprintVideoLayout({ cameraDistanceM: 10, poleOffsetM: 1 });
    expect(close.poles.filter((p) => p.oblique).map((p) => p.lineM)).toEqual([0, 40]);
    expect(close.poles[0]?.sightAngleDeg).toBeGreaterThan(SPRINT_VIDEO_MAX_SIGHT_ANGLE_DEG);
  });

  it('puts the cone on the line when it is on the lane', () => {
    const layout = sprintVideoLayout({ cameraDistanceM: 25, poleOffsetM: 0, cameraAtM: 15 });
    expect(layout.poles.map((p) => p.poleAtM)).toEqual([0, 10, 20, 40]);
  });

  it('refuses a camera on the lane or a cone in front of it', () => {
    expect(() => sprintVideoLayout({ cameraDistanceM: 0, poleOffsetM: 1 })).toThrow(
      DomainValidationError,
    );
    expect(() => sprintVideoLayout({ cameraDistanceM: 20, poleOffsetM: -1 })).toThrow(
      DomainValidationError,
    );
    expect(() => sprintVideoLayout({ cameraDistanceM: 20, poleOffsetM: 1, linesM: [] })).toThrow(
      DomainValidationError,
    );
  });
});

describe('sprintVideoMinCameraDistanceM', () => {
  it('is the distance at which the lines fill the field of view', () => {
    // From the middle: 20 m on each side.
    expect(sprintVideoMinCameraDistanceM(90)).toBeCloseTo(20, 10);
    const d = sprintVideoMinCameraDistanceM(65);
    expect(sprintVideoLayout({ cameraDistanceM: d, poleOffsetM: 1 }).fieldOfViewDeg).toBeCloseTo(
      65,
      6,
    );
  });

  it('solves an off-centre camera too', () => {
    const d = sprintVideoMinCameraDistanceM(70, { cameraAtM: 25 });
    expect(
      sprintVideoLayout({ cameraDistanceM: d, poleOffsetM: 1, cameraAtM: 25 }).fieldOfViewDeg,
    ).toBeCloseTo(70, 6);
  });

  it('refuses a field of view out of range or a camera outside the lines', () => {
    expect(() => sprintVideoMinCameraDistanceM(0)).toThrow(DomainValidationError);
    expect(() => sprintVideoMinCameraDistanceM(180)).toThrow(DomainValidationError);
    expect(() => sprintVideoMinCameraDistanceM(70, { cameraAtM: 45 })).toThrow(
      DomainValidationError,
    );
  });
});
