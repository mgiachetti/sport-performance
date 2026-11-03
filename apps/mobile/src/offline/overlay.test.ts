import type { TestResult } from '@sport-performance/contracts';
import { describe, expect, it } from 'vitest';
import { PLAYER_ID, SESSION_ID, participationDto, uuid } from '../test/fake-sync-server.ts';
import { matchesTarget, prepareMutation } from './operations.ts';
import { applyOverlay } from './overlay.ts';

function testResult(): TestResult {
  return {
    id: uuid(),
    playerId: PLAYER_ID,
    testDefinitionId: uuid(),
    testCode: 'cmj',
    protocolVersion: 1,
    testSessionId: null,
    measuredOn: '2026-11-03',
    status: 'done',
    notDoneReason: null,
    notDoneNote: null,
    method: 'app',
    evaluatorId: null,
    deviceId: null,
    exercise: null,
    conditions: { surface: 'grass' },
    notes: null,
    importId: null,
    entries: [
      {
        id: 'e1',
        kind: 'attempt',
        attemptNumber: 1,
        recordedAt: '2026-11-03T11:00:00.000Z',
        inputs: null,
        values: [],
        issues: [],
        voided: null,
      },
    ],
    scores: [],
    createdAt: '2026-11-03T11:00:00.000Z',
    updatedAt: '2026-11-03T11:00:00.000Z',
    version: 'v1',
  } as unknown as TestResult;
}

describe('overlays', () => {
  it('lays a correction of a result over only the fields it sets', () => {
    const row = testResult();
    const next = applyOverlay('test_result.update', row, {
      target: { id: row.id },
      body: { notes: 'viento', conditions: { footwear: 'cleats' } },
    }) as TestResult;
    expect(next).toMatchObject({ notes: 'viento', method: 'app' });
    expect(next.conditions).toEqual({ surface: 'grass', footwear: 'cleats' });
    expect(row.notes).toBeNull();
  });

  it('shows voided attempts as voided and keeps the rest', () => {
    const row = testResult();
    const next = applyOverlay('test_result.void_entries', row, {
      target: { id: row.id },
      body: { entryIds: ['e1'], reason: 'mal medido' },
    }) as TestResult;
    expect(next.entries[0]?.voided).toMatchObject({ reason: 'mal medido' });
  });

  it('applies the staff batch row of the player and recomputes the load', () => {
    const row = participationDto({ status: 'full', minutes: 60, rpe: 6, srpeAu: 360 });
    const next = applyOverlay('participation.record', row, {
      params: { trainingSessionId: SESSION_ID },
      body: { rows: [{ clientUuid: uuid(), playerId: PLAYER_ID, status: 'partial', minutes: 30 }] },
    });
    expect(next).toMatchObject({ status: 'partial', minutes: 30, srpeAu: 180 });
  });

  it('leaves operations without an overlay (creates, attempts) as served', () => {
    const row = testResult();
    expect(applyOverlay('test_result.add_entries', row, {})).toBe(row);
  });
});

describe('mutation targets', () => {
  it('name the rows by id, clientUuid or session and player', () => {
    const clientUuid = uuid();
    const prepared = prepareMutation('participation.record', {
      params: { trainingSessionId: SESSION_ID },
      body: { rows: [{ clientUuid, playerId: PLAYER_ID, status: 'full' }] },
    });
    const [target] = prepared.targets;
    expect(target).toEqual({
      collection: 'participation',
      clientUuid,
      parentId: SESSION_ID,
      playerId: PLAYER_ID,
    });
    const row = {
      collection: 'participation' as const,
      id: uuid(),
      clientUuid: uuid(),
      parentId: SESSION_ID,
      playerId: PLAYER_ID,
    };
    // A participation the staff created keeps its own clientUuid: matched by session and player.
    expect(target && matchesTarget(target, row)).toBe(true);
    expect(target && matchesTarget(target, { ...row, playerId: uuid() })).toBe(false);
    expect(target && matchesTarget(target, { ...row, collection: 'wellness' })).toBe(false);
  });

  it('require the clientUuid of every attempt', () => {
    expect(() =>
      prepareMutation('test_result.add_entries', {
        target: { id: uuid() },
        body: { entries: [{ kind: 'value', metricCode: 'cmj_height_cm', value: 30 }] },
      }),
    ).toThrow(/clientUuid|invalid input/);
  });
});
