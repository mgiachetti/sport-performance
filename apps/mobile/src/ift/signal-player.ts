import type { SignalSound } from './tones.ts';

/**
 * Plays the signals of the test. Implemented with `expo-audio` on the phone
 * (`src/platform/signal-audio.ts`) and by a recorder in tests. The runner
 * decides *when*; the player only has to start a sound with the least
 * latency it can (sounds are preloaded by `prepare`).
 */
export interface SignalPlayer {
  /** Loads every sound and sets the audio session. Called before the lead-in starts. */
  prepare(): Promise<void>;
  /**
   * While the test runs: the screen stays on and the audio session stays
   * active in the background (a silent loop), so the signals keep sounding
   * if the staff leaves the app. Idempotent: called again after an
   * interruption (a call) to take the session back.
   */
  beginSession(): Promise<void>;
  endSession(): Promise<void>;
  /** Starts a sound now. Never throws: a failed sound is reported, the test goes on. */
  play(sound: SignalSound): void;
}

/** A player that records what it was asked to play, for tests. */
export function recordingSignalPlayer(): SignalPlayer & {
  readonly played: { readonly sound: SignalSound; readonly atMs: number }[];
  readonly calls: string[];
  /** The clock read when a sound plays (set by the test). */
  now: () => number;
} {
  const played: { sound: SignalSound; atMs: number }[] = [];
  const calls: string[] = [];
  const player = {
    played,
    calls,
    now: () => 0,
    prepare: () => {
      calls.push('prepare');
      return Promise.resolve();
    },
    beginSession: () => {
      calls.push('beginSession');
      return Promise.resolve();
    },
    endSession: () => {
      calls.push('endSession');
      return Promise.resolve();
    },
    play: (sound: SignalSound) => {
      played.push({ sound, atMs: player.now() });
    },
  };
  return player;
}
