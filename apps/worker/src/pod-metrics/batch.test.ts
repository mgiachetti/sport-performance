import { describe, expect, it } from 'vitest';
import {
  POD_METRICS_RETRY_BASE_MS,
  POD_METRICS_RETRY_MAX_MS,
  PodMetricsBackoff,
  processPairs,
  type StepOutcome,
} from './batch.js';

const MIN = 60_000;

/** `n` sessions that always fail when decoded, then one good one. */
function sessions(failing: number): string[] {
  return [...Array.from({ length: failing }, (_, i) => `bad-${String(i)}`), 'good'];
}

function stepper() {
  const decoded: string[] = [];
  const step = (pair: string, takeSlot: () => boolean): Promise<StepOutcome> => {
    if (!takeSlot()) return Promise.resolve('no_slot');
    decoded.push(pair);
    if (pair.startsWith('bad')) return Promise.reject(new Error('corrupt file'));
    return Promise.resolve('computed');
  };
  return { decoded, step };
}

describe('processPairs (review: no failure loop)', () => {
  it('a batch of failing sessions: the good one after them is computed on a later run, and failures wait', async () => {
    const backoff = new PodMetricsBackoff();
    const pairs = sessions(12);
    const run = async (nowMs: number) => {
      const s = stepper();
      const result = await processPairs({
        pairs,
        keyOf: (p) => p,
        batch: 10,
        backoff,
        nowMs,
        step: s.step,
      });
      return { result, decoded: s.decoded };
    };
    // First run: 10 failures fill the batch; no progress, so no re-enqueue.
    const first = await run(0);
    expect(first.decoded).toHaveLength(10);
    expect(first.result).toMatchObject({ computed: 0, more: false });
    expect(first.result.failures).toHaveLength(10);
    // The sweep a minute later: the 10 wait, the last 2 failing and the good one go.
    const second = await run(MIN);
    expect(second.decoded).toEqual(['bad-10', 'bad-11', 'good']);
    expect(second.result).toMatchObject({ computed: 1, backingOff: 10, more: false });
    // Another minute: everything failing is waiting, nothing is re-decoded.
    const third = await run(2 * MIN);
    expect(third.decoded).toEqual(['good']);
    expect(third.result).toMatchObject({ backingOff: 12, failures: [] });
  });

  it('re-enqueues only after progress with a full batch', async () => {
    const backoff = new PodMetricsBackoff();
    const s = stepper();
    const result = await processPairs({
      pairs: ['good-1', 'good-2', 'good-3'],
      keyOf: (p) => p,
      batch: 2,
      backoff,
      nowMs: 0,
      step: s.step,
    });
    expect(result).toMatchObject({ computed: 2, more: true });
  });

  it('a failure before decoding counts toward the batch too', async () => {
    const backoff = new PodMetricsBackoff();
    let steps = 0;
    const result = await processPairs({
      pairs: ['a', 'b', 'c'],
      keyOf: (p) => p,
      batch: 2,
      backoff,
      nowMs: 0,
      step: (_pair, takeSlot) => {
        steps += 1;
        if (steps <= 2) return Promise.reject(new Error('plan failed'));
        return Promise.resolve(takeSlot() ? 'computed' : 'no_slot');
      },
    });
    expect(result).toMatchObject({ computed: 0, more: false });
    expect(result.failures).toHaveLength(2);
  });

  it('backs off exponentially up to a day, and forgets a session that recovers', () => {
    const backoff = new PodMetricsBackoff();
    expect(backoff.failed('x', 0).retryAtMs).toBe(POD_METRICS_RETRY_BASE_MS);
    expect(backoff.failed('x', 0).retryAtMs).toBe(2 * POD_METRICS_RETRY_BASE_MS);
    for (let i = 0; i < 20; i += 1) backoff.failed('x', 0);
    expect(backoff.failed('x', 0).retryAtMs).toBe(POD_METRICS_RETRY_MAX_MS);
    expect(backoff.waiting('x', MIN)).toBe(true);
    backoff.succeeded('x');
    expect(backoff.waiting('x', MIN)).toBe(false);
  });
});
