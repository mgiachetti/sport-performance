import {
  DEFAULT_POD_LIVE_SIGNAL_RULES,
  POD_LIVE_SIGNAL_KINDS,
  type LiveSignal,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { esAR } from './es-AR.js';
import { isMessageKey, type MessageKey } from './index.js';
import { podLiveMessagesEsAR } from './pod-live.js';
import { extractArguments } from './validate.js';

/** Compile-time check: every key the domain returns is a key of the catalog. */
const asMessageKey = (key: LiveSignal['messageKey'] | LiveSignal['suggestionKey']): MessageKey =>
  key;

/** The values each kind of signal carries (`evaluateLiveSignals`). */
const VALUES: Readonly<Record<string, readonly string[]>> = {
  pace_drop: ['paceMMin', 'peakMMin', 'pctOfPeak'],
  match_average_high: ['metric', 'pctOfAverage'],
  speed_near_vmax: ['speedMs', 'vmaxMs', 'pctOfVmax'],
  repeated_high_intensity: ['bouts', 'windowMin'],
};

describe('live signal texts (B-906)', () => {
  it('belong to the catalog under podLive.', () => {
    for (const [key, message] of Object.entries(podLiveMessagesEsAR)) {
      expect(key).toMatch(/^podLive\./);
      expect(esAR[key as keyof typeof esAR]).toBe(message);
    }
  });

  it('have a message and a suggestion per kind, with only the values the domain gives', () => {
    for (const kind of POD_LIVE_SIGNAL_KINDS) {
      const message = asMessageKey(`podLive.signal.${kind}`);
      expect(isMessageKey(asMessageKey(`podLive.signal.${kind}.suggestion`))).toBe(true);
      const args = extractArguments(esAR[message]);
      for (const arg of args.keys()) expect(VALUES[kind]).toContain(arg);
    }
    expect(DEFAULT_POD_LIVE_SIGNAL_RULES.length).toBeGreaterThan(0);
  });

  it('suggest, never diagnose', () => {
    for (const message of Object.values(podLiveMessagesEsAR)) {
      expect(message.toLowerCase()).not.toMatch(/lesi[oó]n|diagn[oó]stic/);
    }
  });
});
