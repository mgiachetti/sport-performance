import {
  DEFAULT_IFT_3015_SIGNAL_PROTOCOL,
  newIft3015PlayerMarks,
  stopIft3015Player,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import type { IftRunnerState } from '../ift/runner.ts';
import type { IftRunSnapshot } from '../ift/run-store.ts';
import { ANA_ID, BRUNO_ID, CATEGORY_ID, sheet as sheetFixture } from '../test/test-day-fixtures.ts';
import { iftRunForDay } from './ift.ts';

const P = DEFAULT_IFT_3015_SIGNAL_PROTOCOL;
const SCOPE = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };

function run(overrides: Partial<IftRunSnapshot> = {}): IftRunSnapshot {
  return {
    version: 1,
    scope: SCOPE,
    runId: 'r1',
    categoryId: CATEGORY_ID,
    protocol: P,
    stage1WallMs: 0,
    status: 'finished',
    lastAliveWallMs: 0,
    endedAtMs: 600_000,
    endedBy: 'staff',
    players: [
      // Stopped in the run of stage 3: stage 2 completed.
      stopIft3015Player(newIft3015PlayerMarks(ANA_ID), P, 2 * 45_000 + 5_000),
      // Never completed stage 1: no VIFT, nothing to record.
      stopIft3015Player(newIft3015PlayerMarks(BRUNO_ID), P, 5_000),
      stopIft3015Player(newIft3015PlayerMarks('not-in-the-roster'), P, 200_000),
    ],
    ...overrides,
  };
}

describe('the 30-15 run on the phone and the station of a day', () => {
  it('gives the stages of the players of the day with a VIFT', () => {
    const state: IftRunnerState = { status: 'finished', run: run() };
    const result = iftRunForDay(state, SCOPE, sheetFixture());
    expect(result.status).toBe('finished');
    if (result.status !== 'finished') return;
    expect(result.stages).toEqual([{ playerId: ANA_ID, lastCompletedStage: 2 }]);
  });

  it('asks to finish a run under way, and ignores runs of another category or user', () => {
    const sheet = sheetFixture();
    const running = { status: 'interrupted', run: run({ status: 'running' }) } as IftRunnerState;
    expect(iftRunForDay(running, SCOPE, sheet)).toEqual({ status: 'running' });
    const other = { status: 'finished', run: run({ categoryId: 'other' }) } as IftRunnerState;
    expect(iftRunForDay(other, SCOPE, sheet)).toEqual({ status: 'none' });
    const someoneElse: IftRunnerState = { status: 'finished', run: run() };
    expect(iftRunForDay(someoneElse, { ...SCOPE, userId: 'u2' }, sheet)).toEqual({
      status: 'none',
    });
    expect(iftRunForDay({ status: 'idle' }, SCOPE, sheet)).toEqual({ status: 'none' });
  });
});
