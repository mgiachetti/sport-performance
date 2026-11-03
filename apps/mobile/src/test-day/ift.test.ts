import {
  DEFAULT_IFT_3015_SIGNAL_PROTOCOL,
  newIft3015PlayerMarks,
  stopIft3015Player,
} from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import type { IftRunnerState } from '../ift/runner.ts';
import type { IftRunSnapshot } from '../ift/run-store.ts';
import {
  ANA_ID,
  BRUNO_ID,
  CATEGORY_ID,
  IFT,
  SESSION_ID,
  sheet as sheetFixture,
} from '../test/test-day-fixtures.ts';
import { iftRunForDay } from './ift.ts';

const P = DEFAULT_IFT_3015_SIGNAL_PROTOCOL;
const SCOPE = { membershipId: 'a1111111-1111-4111-8111-111111111111', userId: 'u1' };

function run(overrides: Partial<IftRunSnapshot> = {}): IftRunSnapshot {
  return {
    version: 1,
    scope: SCOPE,
    runId: 'r1',
    categoryId: CATEGORY_ID,
    testSessionId: SESSION_ID,
    savedPlayerIds: [],
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

const daySheet = () => sheetFixture({ stations: [IFT] });

describe('the 30-15 run on the phone and the station of a day', () => {
  it('gives the stages of the players of the day with a VIFT', () => {
    const state: IftRunnerState = { status: 'finished', run: run() };
    const result = iftRunForDay(state, SCOPE, daySheet());
    expect(result.status).toBe('finished');
    if (result.status !== 'finished') return;
    expect(result.stages).toEqual([{ playerId: ANA_ID, lastCompletedStage: 2 }]);
    expect(result.savedCount).toBe(0);
  });

  it('leaves out the players whose stage was already queued', () => {
    const state: IftRunnerState = { status: 'finished', run: run({ savedPlayerIds: [ANA_ID] }) };
    expect(iftRunForDay(state, SCOPE, daySheet())).toEqual({
      status: 'finished',
      stages: [],
      savedCount: 1,
    });
  });

  it('asks to finish a run under way, and ignores runs of another category or user', () => {
    const sheet = daySheet();
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

  it('ignores a finished run of another day or started from Inicio', () => {
    const sheet = daySheet();
    for (const testSessionId of ['0192e7a0-4444-7000-8000-000000000099', null]) {
      const state: IftRunnerState = { status: 'finished', run: run({ testSessionId }) };
      expect(iftRunForDay(state, SCOPE, sheet)).toEqual({ status: 'none' });
    }
  });

  it('ignores a run with a protocol other than the one of the station', () => {
    // The day runs a protocol version that starts at 9 km/h; the run used the standard one.
    const station = {
      ...IFT,
      definition: {
        ...IFT.definition,
        protocol: { ...IFT.definition.protocol, parameters: { initialSpeedKmh: 9 } },
      },
    };
    const sheet = sheetFixture({ stations: [station] });
    const standard: IftRunnerState = { status: 'finished', run: run() };
    expect(iftRunForDay(standard, SCOPE, sheet)).toEqual({ status: 'none' });
    const dayProtocol = { ...P, initialSpeedKmh: 9 };
    const sameAsDay: IftRunnerState = { status: 'finished', run: run({ protocol: dayProtocol }) };
    expect(iftRunForDay(sameAsDay, SCOPE, sheet).status).toBe('finished');
  });
});
