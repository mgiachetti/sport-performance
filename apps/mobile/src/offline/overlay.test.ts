import type { TestResult } from '@sport-performance/contracts';
import { describe, expect, it } from 'vitest';
import { PLAYER_ID, SESSION_ID, participationDto, uuid } from '../test/fake-sync-server.ts';
import { matchesTarget, prepareMutation } from './operations.ts';
import { applyOverlay as overlayAt } from './overlay.ts';

const ENQUEUED_AT = Date.UTC(2026, 10, 3, 11, 0, 0);
const applyOverlay = (...args: [Parameters<typeof overlayAt>[0], unknown, unknown]) =>
  overlayAt(...args, { enqueuedAt: ENQUEUED_AT });

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

  it('leaves operations without an overlay (creates) as served', () => {
    const row = testResult();
    expect(applyOverlay('test_result.create', row, {})).toBe(row);
  });

  it('shows attempts added offline after the served ones, once, with what was typed', () => {
    const row = testResult();
    row.scores = [
      {
        metricCode: 'cmj_height_cm',
        unit: 'cm',
        value: 31,
        aggregation: 'best',
        attemptCount: 1,
        derived: false,
      },
    ];
    const served = uuid();
    row.entries = row.entries.map((entry) => ({ ...entry, id: served as typeof entry.id }));
    const value = uuid();
    const flight = uuid();
    const unknownMetric = uuid();
    const { input } = prepareMutation('test_result.add_entries', {
      target: { id: row.id },
      body: {
        entries: [
          { clientUuid: value, kind: 'value', metricCode: 'cmj_height_cm', value: 33.5 },
          {
            clientUuid: flight,
            kind: 'cmj_flight_time',
            flightTimeS: 0.52,
            attemptNumber: 3,
            recordedAt: '2026-11-03T11:05:00.000Z',
          },
          { clientUuid: unknownMetric, kind: 'value', metricCode: 'other_metric_cm', value: 4 },
          // Already in the row (a resend the pull brought): not twice.
          { clientUuid: served, kind: 'value', metricCode: 'cmj_height_cm', value: 1 },
        ],
      },
    });
    const next = applyOverlay('test_result.add_entries', row, input) as TestResult;
    expect(next.entries.map((entry) => entry.id)).toEqual([served, value, flight, unknownMetric]);
    expect(next.entries[1]).toMatchObject({
      kind: 'value',
      attemptNumber: null,
      // Not typed: when it was queued.
      recordedAt: new Date(ENQUEUED_AT).toISOString(),
      inputs: null,
      values: [
        { id: value, metricCode: 'cmj_height_cm', unit: 'cm', value: 33.5, computed: false },
      ],
      voided: null,
    });
    // The server computes the height of a flight time: only what was typed until the pull.
    expect(next.entries[2]).toMatchObject({
      kind: 'cmj_flight_time',
      attemptNumber: 3,
      recordedAt: '2026-11-03T11:05:00.000Z',
      inputs: { kind: 'cmj_flight_time', flightTimeS: 0.52 },
      values: [],
    });
    // No unit known for the metric on this row yet: the value shows as typed until the pull.
    expect(next.entries[3]).toMatchObject({
      kind: 'value',
      inputs: { kind: 'value', metricCode: 'other_metric_cm', value: 4 },
      values: [],
    });
    expect(next.scores).toEqual(row.scores);
    expect(row.entries).toHaveLength(1);
  });

  it('voids an attempt added offline when the void comes after it in the queue', () => {
    const row = testResult();
    const id = uuid();
    const added = applyOverlay('test_result.add_entries', row, {
      target: { id: row.id },
      body: { entries: [{ clientUuid: id, kind: 'cmj_flight_time', flightTimeS: 0.5 }] },
    });
    const next = applyOverlay('test_result.void_entries', added, {
      target: { id: row.id },
      body: { entryIds: [id], reason: 'pisó la línea' },
    }) as TestResult;
    expect(next.entries[1]?.voided).toMatchObject({ reason: 'pisó la línea' });
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
