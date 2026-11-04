import {
  DEFAULT_REACTION_PROTOCOL,
  summarizeReactionSeries,
  type LocalDate,
  type ReactionSeriesSummary,
  type ReactionTrialRecord,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { errorCountsOf, reactionEntries, reactionResultInput } from './model.ts';

function series(
  task: 'simple' | 'go_no_go',
  outcomes: readonly (number | 'anticipation' | 'commission')[],
): ReactionSeriesSummary {
  const records: ReactionTrialRecord[] = outcomes.map((outcome, index) => ({
    index,
    practice: false,
    stimulus: outcome === 'commission' ? 'no_go' : 'go',
    foreperiodMs: 1500,
    outcome: typeof outcome === 'number' ? 'valid' : outcome,
    reactionMs: typeof outcome === 'number' ? outcome : null,
  }));
  return summarizeReactionSeries(task, records, DEFAULT_REACTION_PROTOCOL);
}

let n = 0;
const uuid = () => {
  n += 1;
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
};

const BASE = {
  clientUuid: 'a0000000-0000-4000-8000-000000000001',
  playerId: 'b0000000-0000-4000-8000-000000000001',
  testDefinitionId: 'd0000000-0000-4000-8000-000000000001',
  deviceId: 'c0000000-0000-4000-8000-000000000001',
  measuredOn: '2026-11-03' as LocalDate,
  evaluatorId: 'e0000000-0000-4000-8000-000000000001',
  notes: null,
  randomUUID: uuid,
  recordedAt: '2026-11-03T15:00:00.000Z',
};

describe('the reaction result', () => {
  it('records each valid stimulus of each complete series as a numbered attempt of its metric', () => {
    const simple = series('simple', [240, 'anticipation', 250, 260, 250, 250]);
    const goNoGo = series('go_no_go', [300, 'commission', 310, 320, 330, 340]);
    const entries = reactionEntries([simple, goNoGo], {
      randomUUID: uuid,
      recordedAt: BASE.recordedAt,
    });
    expect(entries.map((e) => [e.kind === 'value' && e.metricCode, e.attemptNumber])).toEqual([
      ['reaction_simple_msec', 1],
      ['reaction_simple_msec', 2],
      ['reaction_simple_msec', 3],
      ['reaction_simple_msec', 4],
      ['reaction_simple_msec', 5],
      ['reaction_go_no_go_msec', 1],
      ['reaction_go_no_go_msec', 2],
      ['reaction_go_no_go_msec', 3],
      ['reaction_go_no_go_msec', 4],
      ['reaction_go_no_go_msec', 5],
    ]);
    // Each attempt has its own client UUID: a resend never duplicates it.
    expect(new Set(entries.map((e) => e.clientUuid)).size).toBe(entries.length);
    expect(errorCountsOf([simple, goNoGo])).toEqual([
      { task: 'simple', anticipations: 1, lapses: 0, commissions: 0, noGoTrials: 0 },
      { task: 'go_no_go', anticipations: 0, lapses: 0, commissions: 1, noGoTrials: 1 },
    ]);
  });

  it('leaves an incomplete series out, and records nothing without a complete one', () => {
    const simple = series('simple', [240, 250, 260, 250, 250]);
    const incomplete = series(
      'go_no_go',
      Array.from({ length: 20 }, () => 'anticipation' as const),
    );
    const input = reactionResultInput({ ...BASE, summaries: [simple, incomplete], notes: 'x' });
    expect(input?.body).toMatchObject({
      status: 'done',
      method: 'app',
      deviceId: BASE.deviceId,
      notes: 'x',
    });
    expect(input?.body.status === 'done' && input.body.entries).toHaveLength(5);
    expect(reactionResultInput({ ...BASE, summaries: [incomplete] })).toBeNull();
  });
});
