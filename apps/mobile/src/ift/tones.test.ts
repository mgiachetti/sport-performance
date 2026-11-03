import { IFT_3015_CUE_KINDS } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  CUE_SOUNDS,
  SIGNAL_SAMPLE_RATE_HZ,
  SIGNAL_SOUNDS,
  SIGNAL_TONES,
  encodeWav,
  signalDurationMs,
  signalWav,
  silenceWav,
  synthesizeTones,
} from './tones.ts';

function text(bytes: Uint8Array, from: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(from, from + length));
}

describe('IFT signal tones', () => {
  it('gives every cue a sound, and tells them apart', () => {
    expect(Object.keys(CUE_SOUNDS).sort()).toEqual([...IFT_3015_CUE_KINDS].sort());
    const signatures = SIGNAL_SOUNDS.map((sound) => JSON.stringify(SIGNAL_TONES[sound]));
    expect(new Set(signatures).size).toBe(SIGNAL_SOUNDS.length);
    // The line signal is short enough for the fastest stage (20 m in 2.4 s at 30 km/h).
    expect(signalDurationMs('line')).toBeLessThan(500);
    expect(signalDurationMs('stop')).toBe(450);
  });

  it('synthesizes the tones with soft edges and no clipping', () => {
    const samples = synthesizeTones(SIGNAL_TONES.stop);
    expect(samples.length).toBe(Math.round((450 * SIGNAL_SAMPLE_RATE_HZ) / 1000));
    expect(samples[0]).toBe(0);
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
    // The gap between the two tones is silent.
    const gapStart = Math.round((185 * SIGNAL_SAMPLE_RATE_HZ) / 1000);
    const gapEnd = Math.round((265 * SIGNAL_SAMPLE_RATE_HZ) / 1000);
    expect(samples.subarray(gapStart, gapEnd).every((v) => v === 0)).toBe(true);
  });

  it('starts the sound on its first samples (the cue is on time)', () => {
    const samples = synthesizeTones(SIGNAL_TONES.line);
    const firstAudible = samples.findIndex((v) => Math.abs(v) > 0.05);
    expect((firstAudible / SIGNAL_SAMPLE_RATE_HZ) * 1000).toBeLessThan(10);
  });

  it('encodes a mono 16-bit PCM WAV', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, 0.5]), 8_000);
    const view = new DataView(wav.buffer);
    expect(text(wav, 0, 4)).toBe('RIFF');
    expect(text(wav, 8, 4)).toBe('WAVE');
    expect(text(wav, 12, 4)).toBe('fmt ');
    expect(text(wav, 36, 4)).toBe('data');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8_000);
    expect(view.getUint32(28, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((i) => view.getInt16(44 + i * 2, true))).toEqual([
      0, 32767, -32767, 32767, 16384,
    ]);
  });

  it('builds the files of every signal and the silent loop', () => {
    for (const sound of SIGNAL_SOUNDS) {
      const wav = signalWav(sound);
      const samples = (wav.length - 44) / 2;
      expect(Math.round((samples / SIGNAL_SAMPLE_RATE_HZ) * 1000)).toBe(signalDurationMs(sound));
    }
    const silence = silenceWav();
    expect(silence.length).toBe(44 + SIGNAL_SAMPLE_RATE_HZ * 2);
    expect(silence.subarray(44).every((byte) => byte === 0)).toBe(true);
  });
});
