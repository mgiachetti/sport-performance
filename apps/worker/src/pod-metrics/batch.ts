/**
 * How the pod metrics job walks a club's sessions (B-919, ADR 0110): at most
 * `batch` decodes per run (failures included), a session that fails waits
 * with an exponential backoff before it is tried again (never re-decoded in a
 * loop, never holding back the sessions after it), and `more` only when the
 * run made progress and stopped because the batch was full, so a club whose
 * only pending sessions keep failing does not re-enqueue itself.
 */

/** What one session gave. `no_slot`: it needed a decode and the batch was full. */
export type StepOutcome =
  | 'computed'
  | 'unchanged'
  | 'deleted'
  | 'skipped'
  | 'no_slot'
  /** Nothing else can be done in this run (the club has no key). */
  | 'stop';

/** First wait after a failure; doubled on every new failure, up to the cap. */
export const POD_METRICS_RETRY_BASE_MS = 15 * 60_000;
export const POD_METRICS_RETRY_MAX_MS = 24 * 60 * 60_000;

/**
 * The sessions that failed and when they may be tried again. Kept by the
 * worker process (one per process, shared by its jobs): a restart tries them
 * once more, which is the same as the first retry.
 */
export class PodMetricsBackoff {
  private readonly entries = new Map<string, { failures: number; retryAtMs: number }>();

  /** The session must wait (it failed and its time has not come). */
  waiting(key: string, nowMs: number): boolean {
    const entry = this.entries.get(key);
    return entry !== undefined && entry.retryAtMs > nowMs;
  }

  /** Records a failure; returns the number of consecutive failures and the retry time. */
  failed(key: string, nowMs: number): { failures: number; retryAtMs: number } {
    const failures = (this.entries.get(key)?.failures ?? 0) + 1;
    const waitMs = Math.min(
      POD_METRICS_RETRY_BASE_MS * 2 ** (failures - 1),
      POD_METRICS_RETRY_MAX_MS,
    );
    const entry = { failures, retryAtMs: nowMs + waitMs };
    this.entries.set(key, entry);
    return entry;
  }

  succeeded(key: string): void {
    this.entries.delete(key);
  }
}

export interface FailedPair<P> {
  readonly pair: P;
  readonly error: unknown;
  readonly failures: number;
  readonly retryAtMs: number;
}

export interface BatchResult<P> {
  readonly computed: number;
  readonly unchanged: number;
  readonly deleted: number;
  readonly skipped: number;
  /** Sessions waiting for their retry time (not tried this run). */
  readonly backingOff: number;
  /** Sessions that failed this run, each reported once per backoff window. */
  readonly failures: readonly FailedPair<P>[];
  readonly more: boolean;
}

export async function processPairs<P>(input: {
  readonly pairs: readonly P[];
  readonly keyOf: (pair: P) => string;
  readonly batch: number;
  readonly backoff: PodMetricsBackoff;
  readonly nowMs: number;
  /** Processes one session; calls `takeSlot()` before decoding (false: the batch is full). */
  readonly step: (pair: P, takeSlot: () => boolean) => Promise<StepOutcome>;
}): Promise<BatchResult<P>> {
  let used = 0;
  const counts = { computed: 0, unchanged: 0, deleted: 0, skipped: 0, backingOff: 0 };
  const failures: FailedPair<P>[] = [];
  let full = false;
  const takeSlot = () => {
    if (used >= input.batch) return false;
    used += 1;
    return true;
  };
  for (const pair of input.pairs) {
    const key = input.keyOf(pair);
    if (input.backoff.waiting(key, input.nowMs)) {
      counts.backingOff += 1;
      continue;
    }
    const slot = { took: false };
    const take = () => {
      const ok = takeSlot();
      if (ok) slot.took = true;
      return ok;
    };
    let outcome: StepOutcome;
    try {
      outcome = await input.step(pair, take);
    } catch (error) {
      // A failure counts toward the batch, whether or not it got as far as decoding.
      if (!slot.took && used < input.batch) used += 1;
      failures.push({ pair, error, ...input.backoff.failed(key, input.nowMs) });
      continue;
    }
    if (outcome === 'no_slot') {
      full = true;
      break;
    }
    if (outcome === 'stop') break;
    input.backoff.succeeded(key);
    counts[outcome] += 1;
  }
  // Re-enqueue only for progress: a batch that only failed waits for the sweep.
  return { ...counts, failures, more: full && counts.computed + counts.deleted > 0 };
}
