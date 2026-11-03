import { describe, expect, it } from 'vitest';
import {
  ANTHRO_BATCH_MAX,
  getAnthroMeasurement,
  listAnthroMeasurements,
  previewAnthroMeasurements,
  recordAnthroMeasurements,
  updateAnthroMeasurement,
} from './anthropometry.js';

const PLAYER = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10';

describe('anthropometry endpoints', () => {
  it('are club endpoints under /v1/anthro-measurements', () => {
    for (const endpoint of [
      recordAnthroMeasurements,
      previewAnthroMeasurements,
      listAnthroMeasurements,
      getAnthroMeasurement,
      updateAnthroMeasurement,
    ]) {
      expect(endpoint.auth).toBe('club');
      expect(endpoint.path.startsWith('/v1/anthro-measurements')).toBe(true);
    }
  });

  it('take a batch of measurements with their hard bounds', () => {
    const body = recordAnthroMeasurements.body;
    const row = { playerId: PLAYER, measuredOn: '2026-11-03', heightCm: 165.4 };
    expect(body.safeParse({ measurements: [row] }).success).toBe(true);
    expect(body.safeParse({ measurements: [] }).success).toBe(false);
    expect(
      body.safeParse({ measurements: Array.from({ length: ANTHRO_BATCH_MAX + 1 }, () => row) })
        .success,
    ).toBe(false);
    // A height in millimetres is a typo: refused before any rule of the API.
    expect(body.safeParse({ measurements: [{ ...row, heightCm: 1654 }] }).success).toBe(false);
    // Historical values come through the imports, never typed on a measurement day.
    expect(body.safeParse({ measurements: [{ ...row, method: 'historical' }] }).success).toBe(
      false,
    );
    expect(body.safeParse({ measurements: [{ ...row, extra: 1 }] }).success).toBe(false);
  });

  it('ask for a reason to correct', () => {
    const body = updateAnthroMeasurement.body;
    expect(body.safeParse({ version: '1', heightCm: 166 }).success).toBe(false);
    expect(
      body.safeParse({ version: '1', heightCm: null, changeReason: 'Error de tipeo' }).success,
    ).toBe(true);
  });

  it('preview the whole squad, with or without values', () => {
    expect(
      previewAnthroMeasurements.body.safeParse({
        measurements: [{ playerId: PLAYER, measuredOn: '2026-11-03' }],
      }).success,
    ).toBe(true);
  });
});
