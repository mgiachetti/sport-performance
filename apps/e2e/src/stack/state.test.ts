import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseRunState, readRunState, RunStateError, type RunState } from './state.ts';

const state: RunState = {
  startedAt: '2026-11-04T12:00:00.000Z',
  asOf: '2026-11-04',
  slug: 'demo-e2e',
  seed: 'e2e',
  historyDays: 35,
  emailDomain: 'example.com',
  apiUrl: 'http://127.0.0.1:3100',
  webUrl: 'http://127.0.0.1:4174',
  injuryFixture: {
    playerId: '0b9f6a52-3a4f-4c1e-9d5b-3f1c2a7e8d90',
    diagnosis: 'Lesión ficticia (knee) E2E',
    validFrom: '2026-11-01',
    validTo: '2026-11-25',
  },
};

describe('state of the run', () => {
  it('reads what the stack wrote', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sp-e2e-state-'));
    writeFileSync(join(dir, 'state.json'), JSON.stringify(state));
    expect(readRunState(dir)).toEqual(state);
  });

  it('says how to start the stack when there is no state', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sp-e2e-state-'));
    expect(() => readRunState(dir)).toThrow(/No end-to-end stack state/);
  });

  it('refuses a state that is not JSON', () => {
    expect(() => parseRunState('{')).toThrow(RunStateError);
  });

  it('refuses a stale state with what is wrong', () => {
    const stale = Object.fromEntries(
      Object.entries(state).filter(([key]) => key !== 'injuryFixture'),
    );
    expect(() => parseRunState(JSON.stringify(stale))).toThrow(/injuryFixture/);
    expect(() => parseRunState(JSON.stringify({ ...state, asOf: '04/11/2026' }))).toThrow(/asOf/);
    expect(() => parseRunState(JSON.stringify({ ...state, extra: true }))).toThrow(RunStateError);
  });
});
