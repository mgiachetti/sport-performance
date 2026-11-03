import type { Ift3015CueKind } from '@sport-performance/domain';

/**
 * The signals of the 30-15 IFT are synthesized on the device (B-507, ADR
 * 0070): no recorded or downloaded audio, so they work offline, are the same
 * on every phone and carry no third-party recording. Each sound is a short
 * sequence of tones written as 16-bit PCM WAV; its first sample is the
 * instant of the cue (no leading silence).
 */

export const SIGNAL_SOUNDS = ['pip', 'go', 'line', 'stop', 'end'] as const;
export type SignalSound = (typeof SIGNAL_SOUNDS)[number];

/** The sound of each cue: distinct pitch and rhythm, never told apart by volume alone. */
export const CUE_SOUNDS: Readonly<Record<Ift3015CueKind, SignalSound>> = {
  countdown: 'pip',
  stage_start: 'go',
  line: 'line',
  run_end: 'stop',
  test_end: 'end',
};

/** A tone (`frequencyHz` > 0) or a gap (`frequencyHz` = 0). */
export interface ToneSegment {
  readonly frequencyHz: number;
  readonly durationMs: number;
}

/**
 * The sounds: a short pip for the countdown, a long high tone for the start,
 * a sharp mid tone at each line, two low tones for the end of the run and a
 * falling triad for the end of the test.
 */
export const SIGNAL_TONES: Readonly<Record<SignalSound, readonly ToneSegment[]>> = {
  pip: [{ frequencyHz: 880, durationMs: 120 }],
  go: [{ frequencyHz: 1320, durationMs: 500 }],
  line: [{ frequencyHz: 1000, durationMs: 220 }],
  stop: [
    { frequencyHz: 660, durationMs: 180 },
    { frequencyHz: 0, durationMs: 90 },
    { frequencyHz: 660, durationMs: 180 },
  ],
  end: [
    { frequencyHz: 880, durationMs: 200 },
    { frequencyHz: 0, durationMs: 60 },
    { frequencyHz: 660, durationMs: 200 },
    { frequencyHz: 0, durationMs: 60 },
    { frequencyHz: 440, durationMs: 400 },
  ],
};

/**
 * Bumped whenever a tone changes, so the cached files are rewritten
 * (`ift3015-<sound>-v<version>.wav`).
 */
export const SIGNAL_TONES_VERSION = 1;

export const SIGNAL_SAMPLE_RATE_HZ = 22_050;
/** Fade in and out of each tone, against clicks. */
const FADE_MS = 8;
/** Peak level: loud on a phone speaker, without clipping. */
const PEAK = 0.9;
/** Third harmonic mixed in: carries better outdoors than a pure sine. */
const THIRD_HARMONIC = 0.3;

/** Length of a sound, in ms. */
export function signalDurationMs(sound: SignalSound): number {
  return SIGNAL_TONES[sound].reduce((total, segment) => total + segment.durationMs, 0);
}

/** Samples in [-1, 1] of a sequence of tones. */
export function synthesizeTones(
  segments: readonly ToneSegment[],
  sampleRateHz: number = SIGNAL_SAMPLE_RATE_HZ,
): Float32Array {
  const counts = segments.map((s) => Math.round((s.durationMs * sampleRateHz) / 1000));
  const samples = new Float32Array(counts.reduce((a, b) => a + b, 0));
  const fadeSamples = Math.round((FADE_MS * sampleRateHz) / 1000);
  const norm = PEAK / (1 + THIRD_HARMONIC);
  let offset = 0;
  segments.forEach((segment, i) => {
    const count = counts[i] ?? 0;
    if (segment.frequencyHz > 0) {
      const w = (2 * Math.PI * segment.frequencyHz) / sampleRateHz;
      const fade = Math.min(fadeSamples, Math.floor(count / 2));
      for (let n = 0; n < count; n += 1) {
        const edge = Math.min(n, count - 1 - n);
        const envelope = edge < fade ? 0.5 - 0.5 * Math.cos((Math.PI * edge) / fade) : 1;
        samples[offset + n] =
          norm * envelope * (Math.sin(w * n) + THIRD_HARMONIC * Math.sin(3 * w * n));
      }
    }
    offset += count;
  });
  return samples;
}

/** Mono 16-bit PCM WAV of `samples` (clamped to [-1, 1]). */
export function encodeWav(
  samples: Float32Array,
  sampleRateHz: number = SIGNAL_SAMPLE_RATE_HZ,
): Uint8Array {
  const bytesPerSample = 2;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * bytesPerSample, Math.round(value * 0x7fff), true);
  }
  return new Uint8Array(buffer);
}

/** WAV file of a signal. */
export function signalWav(sound: SignalSound): Uint8Array {
  return encodeWav(synthesizeTones(SIGNAL_TONES[sound]));
}

/**
 * One second of silence, looped while the test runs: it keeps the audio
 * session (and so the app) alive in the background between signals.
 */
export function silenceWav(): Uint8Array {
  return encodeWav(new Float32Array(SIGNAL_SAMPLE_RATE_HZ));
}
