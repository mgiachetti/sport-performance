import type { TestDaySheet } from '@sport-performance/contracts';
import { ift3015PlayerResult } from '@sport-performance/domain';
import type { IftRunnerState } from '../ift/runner.ts';
import type { IftRunScope } from '../ift/run-store.ts';

/**
 * The bridge between the 30-15 IFT signals (B-507, ADR 0070) and the field
 * test day (B-505): a finished run of this user in this club leaves the
 * last completed stage of each player, and the 30-15 station of a day of
 * the same category records them through the sync queue (`planIftStages`).
 */

export interface IftStage {
  readonly playerId: string;
  readonly lastCompletedStage: number;
}

export type IftRunForDay =
  | { readonly status: 'none' }
  /** A run of this category is under way or interrupted: finish it first. */
  | { readonly status: 'running' }
  | { readonly status: 'finished'; readonly stages: readonly IftStage[] };

/** What the 30-15 station of a day can do with the run on the phone. */
export function iftRunForDay(
  state: IftRunnerState,
  scope: IftRunScope,
  sheet: Pick<TestDaySheet, 'testSession' | 'players'>,
): IftRunForDay {
  if (!('run' in state)) return { status: 'none' };
  const { run } = state;
  if (run.scope.userId !== scope.userId || run.scope.membershipId !== scope.membershipId) {
    return { status: 'none' };
  }
  if (run.categoryId !== sheet.testSession.categoryId) return { status: 'none' };
  if (state.status !== 'finished') return { status: 'running' };
  const roster = new Set<string>(sheet.players.map((p) => p.id));
  const stages = run.players.flatMap((marks) => {
    const result = ift3015PlayerResult(marks, run.protocol);
    // Without stage 1 completed there is no VIFT to record.
    const entry = result?.entry ?? null;
    if (result === null || entry === null || !roster.has(result.playerId)) return [];
    return [{ playerId: result.playerId, lastCompletedStage: entry.lastCompletedStage }];
  });
  return { status: 'finished', stages };
}
