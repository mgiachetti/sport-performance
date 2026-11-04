import type {
  SyncOperationRequest,
  TestEntryInputPayload,
  TestResult,
} from '@sport-performance/contracts';
import {
  REACTION_METRIC_BY_TASK,
  reactionHistoryOnDevice,
  type LocalDate,
  type ReactionSeriesSummary,
  type ReactionTask,
} from '@sport-performance/domain';
import type { LocalRow, QueuedMutation } from '../offline/local-store.ts';

/**
 * The reaction result as the phone writes and reads it (B-606, ADR 0076):
 * one `test_result` per player and run, with the valid stimuli of each
 * complete series as numbered `value` attempts (the server averages them:
 * `attemptAggregation: mean`), measured with the app on this device. The
 * history is the player's own on this device only.
 */

export const REACTION_TEST_CODE = 'reaction';
export const REACTION_OPS = ['test_result.create'] as const;

/** The series of a run that are recorded: only the complete ones. */
export function recordableSeries(
  summaries: readonly ReactionSeriesSummary[],
): ReactionSeriesSummary[] {
  return summaries.filter((summary) => summary.status === 'complete');
}

/** The attempts of a run: each valid stimulus of each complete series, numbered per metric. */
export function reactionEntries(
  summaries: readonly ReactionSeriesSummary[],
  input: { readonly randomUUID: () => string; readonly recordedAt: string },
): TestEntryInputPayload[] {
  return recordableSeries(summaries).flatMap((summary) =>
    summary.validMs.map((valueMs, index) => ({
      kind: 'value' as const,
      clientUuid: input.randomUUID(),
      attemptNumber: index + 1,
      recordedAt: input.recordedAt,
      metricCode: REACTION_METRIC_BY_TASK[summary.task],
      value: valueMs,
    })),
  );
}

/**
 * The `test_result.create` of a run, or `null` when no series is complete
 * (nothing to record). The device is required: the reaction test is
 * compared only on the same one. The notes say what the mean does not: the
 * errors of each series, already in words (`notes`).
 */
export function reactionResultInput(input: {
  readonly clientUuid: string;
  readonly playerId: string;
  readonly testDefinitionId: string;
  readonly deviceId: string;
  readonly measuredOn: LocalDate;
  readonly evaluatorId: string;
  readonly summaries: readonly ReactionSeriesSummary[];
  readonly notes: string | null;
  readonly randomUUID: () => string;
  readonly recordedAt: string;
}): SyncOperationRequest<'test_result.create'> | null {
  const entries = reactionEntries(input.summaries, input);
  if (entries.length === 0) return null;
  return {
    body: {
      status: 'done',
      clientUuid: input.clientUuid,
      playerId: input.playerId,
      testDefinitionId: input.testDefinitionId,
      measuredOn: input.measuredOn,
      method: 'app',
      evaluatorId: input.evaluatorId,
      deviceId: input.deviceId,
      entries,
      ...(input.notes !== null && { notes: input.notes }),
    },
  };
}

/** What a series did besides its mean, for the notes and the summary screen. */
export interface ReactionErrorCounts {
  readonly task: ReactionTask;
  readonly anticipations: number;
  readonly lapses: number;
  readonly commissions: number;
  readonly noGoTrials: number;
}

export function errorCountsOf(summaries: readonly ReactionSeriesSummary[]): ReactionErrorCounts[] {
  return recordableSeries(summaries).map((summary) => ({
    task: summary.task,
    anticipations: summary.anticipations,
    lapses: summary.lapses,
    commissions: summary.commissions,
    noGoTrials: summary.noGoTrials,
  }));
}

// ─── History: the same player on this device ─────────────────────────────────────────

/** One earlier mean of the player on this device. */
export interface ReactionHistoryItem {
  readonly key: string;
  readonly playerId: string;
  readonly deviceId: string | null;
  readonly measuredOn: string;
  readonly task: ReactionTask;
  readonly valueMs: number;
  /** Still in the queue (not on the server yet). */
  readonly pending: boolean;
}

const TASK_OF_METRIC = new Map<string, ReactionTask>(
  (Object.entries(REACTION_METRIC_BY_TASK) as [ReactionTask, string][]).map(([task, code]) => [
    code,
    task,
  ]),
);

function mean(values: readonly number[]): number {
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function servedItems(row: LocalRow<'test_result'>): ReactionHistoryItem[] {
  const data: TestResult = row.data;
  if (data.testCode !== REACTION_TEST_CODE || data.status !== 'done') return [];
  return data.scores.flatMap((score) => {
    const task = TASK_OF_METRIC.get(score.metricCode);
    if (task === undefined) return [];
    return [
      {
        key: `${row.id}:${task}`,
        playerId: data.playerId,
        deviceId: data.deviceId,
        measuredOn: data.measuredOn,
        task,
        valueMs: Math.round(score.value),
        pending: row.pending,
      },
    ];
  });
}

function queuedItems(
  mutation: QueuedMutation<'test_result.create'>,
  served: ReadonlySet<string>,
): ReactionHistoryItem[] {
  const { body } = mutation.input;
  if (body.status !== 'done' || body.measuredOn === undefined) return [];
  if (body.clientUuid === undefined || served.has(body.clientUuid)) return [];
  const byTask = new Map<ReactionTask, number[]>();
  for (const entry of body.entries) {
    if (entry.kind !== 'value') continue;
    const task = TASK_OF_METRIC.get(entry.metricCode);
    if (task === undefined) continue;
    byTask.set(task, [...(byTask.get(task) ?? []), entry.value]);
  }
  return [...byTask].map(([task, values]) => ({
    key: `${body.clientUuid ?? String(mutation.seq)}:${task}`,
    playerId: body.playerId,
    deviceId: body.deviceId ?? null,
    measuredOn: body.measuredOn ?? '',
    task,
    valueMs: mean(values),
    pending: true,
  }));
}

/**
 * The player's reaction means on this device, oldest first, per task: the
 * synced results and the ones still in the queue. Other devices and other
 * players are never in it (the comparison the test allows).
 */
export function reactionHistory(input: {
  readonly rows: readonly LocalRow<'test_result'>[];
  readonly queue: readonly QueuedMutation<'test_result.create'>[];
  readonly playerId: string;
  readonly deviceId: string;
}): Record<ReactionTask, ReactionHistoryItem[]> {
  const served = new Set(
    input.rows.flatMap((row) => (row.clientUuid === null ? [] : [row.clientUuid])),
  );
  const items = [
    ...input.rows.flatMap(servedItems),
    ...input.queue.flatMap((mutation) => queuedItems(mutation, served)),
  ];
  const mine = reactionHistoryOnDevice(items, input.playerId, input.deviceId);
  return {
    simple: mine.filter((item) => item.task === 'simple'),
    go_no_go: mine.filter((item) => item.task === 'go_no_go'),
  };
}

/** The player's best earlier mean of a task on this device (`null` without one). */
export function bestOf(items: readonly ReactionHistoryItem[]): number | null {
  return items.length === 0 ? null : Math.min(...items.map((item) => item.valueMs));
}
