import { randomUUID } from 'node:crypto';
import type { SyncOperationRequest, TestDaySheet, TestResult } from '@sport-performance/contracts';
import type { SyncOperation } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import type { LocalRow, QueuedMutation } from '../offline/local-store.ts';
import { prepareMutation } from '../offline/operations.ts';
import {
  ANA_ID,
  BRUNO_ID,
  CMJ,
  COD_505,
  DEVICE_ID,
  DIEGO_ID,
  IFT,
  REACTION,
  SPRINT,
  STRENGTH,
  sheet as sheetFixture,
  sprintResult,
  testSession,
} from '../test/test-day-fixtures.ts';
import { USER } from '../test/fixtures.ts';
import { must } from '../test/must.ts';
import {
  defaultStationSettings,
  fieldResults,
  nextPendingPlayer,
  notApplicableCount,
  parseStoredStationSettings,
  planAttempt,
  planIftStages,
  planNotApplicable,
  planNotDone,
  planVoid,
  playerStation,
  stationProgress,
  stationSettingsFor,
  type FieldWrite,
  type PlannedWrites,
  type StationSettings,
  type WriteContext,
} from './model.ts';

const NOW = '2026-04-14T13:00:00.000Z';
let seq = 0;

function queued(
  op: SyncOperation,
  input: SyncOperationRequest<SyncOperation>,
  state: 'pending' | 'acked' = 'pending',
): QueuedMutation {
  seq += 1;
  const prepared = prepareMutation(op, input);
  return {
    seq,
    mutationId: randomUUID(),
    op,
    hlc: `00179358633868${String(seq).padStart(1, '0')}-000000-0f1e2d3c4b5a6978`,
    input: prepared.input,
    targets: prepared.targets,
    state,
    attempts: 0,
    createdAt: Date.parse(NOW) + seq,
    ackedAt: null,
  };
}

function fromWrites(writes: readonly FieldWrite[], state: 'pending' | 'acked' = 'pending') {
  return writes.map((write) => queued(write.op, write.input, state));
}

function row(result: TestResult, clientUuid: string | null = null): LocalRow<'test_result'> {
  return { id: result.id, clientUuid, data: result, pending: false };
}

function context(
  sheet: TestDaySheet,
  station = SPRINT,
  settings: Partial<StationSettings> = {},
): WriteContext {
  return {
    sheet,
    station,
    settings: { ...defaultStationSettings(station), ...settings },
    evaluatorId: USER.id,
    uuid: randomUUID,
    nowIso: NOW,
  };
}

function writesOf(planned: PlannedWrites): readonly FieldWrite[] {
  if (planned.kind !== 'writes') throw new Error(`expected writes, got ${JSON.stringify(planned)}`);
  return planned.writes;
}

function rowsOf(
  sheet: TestDaySheet,
  station = SPRINT,
  queue: QueuedMutation[] = [],
  synced: LocalRow<'test_result'>[] = [],
) {
  const results = fieldResults({ sheet, synced, queue, viewer: 'sc' });
  return sheet.players.map((player) => playerStation(station, player, results));
}

describe('the first attempt of a player', () => {
  it('creates the result with the attempt, its method and the evaluator, valid for the queue', () => {
    const sheet = sheetFixture();
    const [ana] = rowsOf(sheet);
    const planned = planAttempt(context(sheet), must(ana), {
      split10S: '1,9',
      split20S: '3,1',
      split40S: '5,5',
    });
    const [write] = writesOf(planned);
    expect(write?.op).toBe('test_session.record_results');
    if (write?.op !== 'test_session.record_results') return;
    const [result] = write.input.body.results;
    expect(result).toMatchObject({
      status: 'done',
      playerId: ANA_ID,
      testDefinitionId: SPRINT.definition.id,
      method: 'photocell',
      evaluatorId: USER.id,
      entries: [
        {
          kind: 'sprint_splits',
          split10S: 1.9,
          split20S: 3.1,
          split40S: 5.5,
          attemptNumber: 1,
          recordedAt: NOW,
        },
      ],
    });
    expect(result?.clientUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(write.input.params.testSessionId).toBe(sheet.testSession.id);
    // The queue validates with the server's contract and asks for every clientUuid.
    expect(() => prepareMutation(write.op, write.input)).not.toThrow();
  });

  it('shows at once, scored on the phone, and the next one is added to it by its clientUuid', () => {
    const sheet = sheetFixture();
    const first = writesOf(
      planAttempt(context(sheet), must(rowsOf(sheet)[0]), { split20S: '3,1', split40S: '5,5' }),
    );
    let queue = fromWrites(first);
    let [ana] = rowsOf(sheet, SPRINT, queue);
    expect(ana?.state).toBe('done');
    expect(ana?.sync).toBe('queued');
    expect(ana?.attempts).toHaveLength(1);
    expect(ana?.attempts[0]?.pending).toBe(true);
    // Vmax = 20 / (t40 − t20) with the domain formula.
    expect(ana?.attempts[0]?.entries[0]?.values).toContainEqual({
      metricCode: 'sprint_vmax_ms',
      value: 20 / 2.4,
    });

    const second = writesOf(
      planAttempt(context(sheet), must(ana), { split20S: '3,0', split40S: '5,3' }),
    );
    expect(second).toHaveLength(1);
    expect(second[0]?.op).toBe('test_result.add_entries');
    if (second[0]?.op !== 'test_result.add_entries') return;
    const created =
      first[0]?.op === 'test_session.record_results' ? first[0].input.body.results[0] : undefined;
    expect(second[0].input.target).toEqual({ clientUuid: created?.clientUuid });
    expect(second[0].input.body.entries[0]?.attemptNumber).toBe(2);

    queue = [...queue, ...fromWrites(second)];
    [ana] = rowsOf(sheet, SPRINT, queue);
    expect(ana?.attempts.map((a) => a.attemptNumber)).toEqual([1, 2]);
    // Best of 40 m: the second (lower is better).
    const best = ana?.attempts.find((a) => a.bestOf.includes('sprint_40_s'));
    expect(best?.attemptNumber).toBe(2);
    expect(ana?.scores.find((s) => s.metricCode === 'sprint_40_s')?.value).toBe(5.3);
    expect(ana?.nextAttemptNumber).toBe(3);
  });
});

describe('results served by the server', () => {
  it('are not duplicated by the create still in the queue, and attempts dedupe by id', () => {
    const sheet = sheetFixture();
    const planned = writesOf(
      planAttempt(context(sheet), must(rowsOf(sheet)[0]), { split20S: '3,1', split40S: '5,5' }),
    );
    const write = planned[0];
    if (write?.op !== 'test_session.record_results') throw new Error('create expected');
    const input = write.input.body.results[0];
    if (input?.status !== 'done') throw new Error('done expected');
    const entry = must(input.entries[0]);
    const served = sprintResult(ANA_ID, {
      entries: [{ ...must(sprintResult(ANA_ID).entries[0]), id: entry.clientUuid as never }],
    });
    const rows = rowsOf(sheet, SPRINT, fromWrites(planned, 'acked'), [
      row(served, input.clientUuid ?? null),
    ]);
    expect(rows[0]?.results).toHaveLength(1);
    expect(rows[0]?.attempts).toHaveLength(1);
    expect(rows[0]?.sync).toBe('saved');
  });

  it('take queued attempts by id, voids, and say whose writes are not answered yet', () => {
    const sheet = sheetFixture();
    const served = sprintResult(ANA_ID);
    const synced = [row(served)];
    const [ana] = rowsOf(sheet, SPRINT, [], synced);
    expect(ana?.primary?.target).toEqual({ id: served.id });
    const added = writesOf(
      planAttempt(context(sheet), must(ana), { split20S: '3,2', split40S: '5,6' }),
    );
    expect(added[0]?.op).toBe('test_result.add_entries');
    let queue = fromWrites(added, 'acked');
    let [after] = rowsOf(sheet, SPRINT, queue, synced);
    expect(after?.sync).toBe('sent');
    expect(after?.attempts).toHaveLength(2);

    const voided = writesOf(
      planVoid(context(sheet), must(after), must(must(after).attempts[0]), 'Salida en falso'),
    );
    expect(voided[0]).toMatchObject({
      op: 'test_result.void_entries',
      input: { target: { id: served.id }, body: { reason: 'Salida en falso' } },
    });
    queue = [...queue, ...fromWrites(voided)];
    [after] = rowsOf(sheet, SPRINT, queue, synced);
    expect(after?.sync).toBe('queued');
    expect(after?.attempts[0]?.voided).toBe(true);
    expect(after?.attempts[0]?.voidReason).toBe('Salida en falso');
    expect(after?.validAttemptCount).toBe(1);
    expect(planVoid(context(sheet), must(after), must(must(after).attempts[1]), '  ')).toEqual({
      kind: 'problem',
      problem: { kind: 'changeReason' },
    });
  });

  it('of several evaluators show together; new attempts go to the served one and never reuse a number', () => {
    const sheet = sheetFixture();
    const served = sprintResult(ANA_ID, { createdAt: '2026-04-14T12:30:00.000Z' });
    const offline = writesOf(
      planAttempt(context(sheet), must(rowsOf(sheet)[0]), { split20S: '3,0', split40S: '5,2' }),
    );
    const [ana] = rowsOf(sheet, SPRINT, fromWrites(offline), [row(served)]);
    expect(ana?.results).toHaveLength(2);
    expect(ana?.multipleResults).toBe(true);
    expect(ana?.primary?.resultId).toBe(served.id);
    expect(ana?.nextAttemptNumber).toBe(2);
    expect(ana?.attempts.find((a) => a.bestOf.includes('sprint_40_s'))?.pending).toBe(true);
  });
});

describe('what an attempt checks', () => {
  it('stops on typing problems and on what the station needs', () => {
    const sheet = sheetFixture({ stations: [SPRINT, REACTION, STRENGTH] });
    const [ana] = rowsOf(sheet);
    expect(planAttempt(context(sheet), must(ana), {})).toEqual({
      kind: 'problem',
      problem: { kind: 'empty' },
    });
    expect(planAttempt(context(sheet), must(ana), { split20S: 'x', split40S: '5' })).toMatchObject({
      problem: { kind: 'attempt', fieldKey: 'split20S', problem: 'number' },
    });
    // Splits that do not increase: the domain refuses them.
    expect(
      planAttempt(context(sheet), must(ana), { split20S: '5,5', split40S: '3,1' }),
    ).toMatchObject({
      problem: { kind: 'attempt', problem: 'domain' },
    });
    const reaction = must(rowsOf(sheet, REACTION)[0]);
    expect(
      planAttempt(context(sheet, REACTION), reaction, { reaction_simple_msec: '250' }),
    ).toMatchObject({ problem: { kind: 'device' } });
    const withDevice = writesOf(
      planAttempt(context(sheet, REACTION, { deviceId: DEVICE_ID }), reaction, {
        reaction_simple_msec: '250',
      }),
    );
    expect(withDevice[0]?.input).toMatchObject({
      body: { results: [{ deviceId: DEVICE_ID, method: 'app' }] },
    });
    const strength = must(rowsOf(sheet, STRENGTH)[0]);
    const set = { loadKg: '60', reps: '5', rir: '2' };
    expect(
      planAttempt(context(sheet, STRENGTH, { mode: 'strength_set' }), strength, set),
    ).toMatchObject({
      problem: { kind: 'exercise' },
    });
    expect(
      writesOf(
        planAttempt(
          context(sheet, STRENGTH, { mode: 'strength_set', exercise: 'goblet_squat' }),
          strength,
          set,
        ),
      )[0]?.input,
    ).toMatchObject({ body: { results: [{ exercise: 'goblet_squat' }] } });
  });

  it('warns about values out of the plausible range and lets them be saved', () => {
    const sheet = sheetFixture({ stations: [SPRINT, CMJ] });
    const planned = planAttempt(context(sheet), must(rowsOf(sheet)[0]), {
      split20S: '1,0',
      split40S: '1,9',
    });
    expect(planned.kind).toBe('writes');
    if (planned.kind !== 'writes') return;
    expect(planned.warnings.map((w) => w.fieldKey)).toContain('split40S');
    const cmj = planAttempt(context(sheet, CMJ), must(rowsOf(sheet, CMJ)[0]), {
      flightTimeMsec: '900',
    });
    expect(cmj.kind === 'writes' && cmj.warnings[0]?.metricCode).toBe('cmj_height_cm');
  });

  it('refuses players without consent, tests that do not apply and a suspended day', () => {
    const base = sheetFixture();
    const diego = must(rowsOf(base).find((r) => r.player.id === DIEGO_ID));
    expect(planAttempt(context(base), diego, { split20S: '3', split40S: '5' })).toMatchObject({
      problem: { kind: 'recording' },
    });
    const cancelled = sheetFixture({ testSession: testSession({ status: 'cancelled' }) });
    expect(
      planAttempt(context(cancelled), must(rowsOf(cancelled)[0]), { split20S: '3', split40S: '5' }),
    ).toMatchObject({ problem: { kind: 'cancelled' } });

    const notApplicable = sheetFixture();
    const players = notApplicable.players.map((p) =>
      p.id === BRUNO_ID
        ? {
            ...p,
            tests: p.tests.map((t) => ({
              ...t,
              applicable: false,
              reason: 'not_in_battery' as const,
            })),
          }
        : p,
    );
    const sheet = { ...notApplicable, players };
    const bruno = must(rowsOf(sheet).find((r) => r.player.id === BRUNO_ID));
    expect(planAttempt(context(sheet), bruno, { split20S: '3', split40S: '5' })).toMatchObject({
      problem: { kind: 'notApplicable' },
    });
    expect(planNotDone(context(sheet), bruno, 'absent', '')).toMatchObject({
      problem: { kind: 'notApplicable' },
    });
    const bulk = planNotApplicable(context(sheet), rowsOf(sheet));
    expect(bulk.count).toBe(1);
    expect(notApplicableCount(sheet, rowsOf(sheet))).toBe(1);
    expect(bulk.writes[0]?.input).toMatchObject({
      body: {
        results: [
          { playerId: BRUNO_ID, status: 'not_done', notDoneReason: 'not_applicable_to_stage' },
        ],
      },
    });
    const after = rowsOf(sheet, SPRINT, fromWrites(bulk.writes));
    expect(after.find((r) => r.player.id === BRUNO_ID)?.state).toBe('not_done');
    expect(planNotApplicable(context(sheet), after).count).toBe(0);
    expect(notApplicableCount(sheet, after)).toBe(0);
  });
});

describe('not done', () => {
  it('needs a reason, a note for «other», and shows «unavailable» to the staff', () => {
    const sheet = sheetFixture();
    const [ana] = rowsOf(sheet);
    expect(planNotDone(context(sheet), must(ana), null, '')).toMatchObject({
      problem: { kind: 'reason' },
    });
    expect(planNotDone(context(sheet), must(ana), 'other', ' ')).toMatchObject({
      problem: { kind: 'note' },
    });
    const writes = writesOf(planNotDone(context(sheet), must(ana), 'injured', ''));
    const results = fieldResults({ sheet, synced: [], queue: fromWrites(writes), viewer: 'coach' });
    expect(results[0]?.notDoneReason).toBe('unavailable');
    const medical = fieldResults({
      sheet,
      synced: [],
      queue: fromWrites(writes),
      viewer: 'medical',
    });
    expect(medical[0]?.notDoneReason).toBe('injured');
  });

  it('turns into done with a reason before the first attempt, and back only without valid attempts', () => {
    const sheet = sheetFixture();
    const notDone = fromWrites(
      writesOf(planNotDone(context(sheet), must(rowsOf(sheet)[0]), 'absent', '')),
    );
    const [ana] = rowsOf(sheet, SPRINT, notDone);
    expect(ana?.state).toBe('not_done');
    expect(planAttempt(context(sheet), must(ana), { split20S: '3', split40S: '5' })).toMatchObject({
      problem: { kind: 'changeReason' },
    });
    const writes = writesOf(
      planAttempt(
        context(sheet),
        must(ana),
        { split20S: '3', split40S: '5' },
        { changeReason: 'Llegó tarde' },
      ),
    );
    expect(writes.map((w) => w.op)).toEqual(['test_result.update', 'test_result.add_entries']);
    expect(writes[0]?.input).toMatchObject({
      body: {
        status: 'done',
        method: 'photocell',
        notDoneReason: null,
        changeReason: 'Llegó tarde',
      },
    });
    const [done] = rowsOf(sheet, SPRINT, [...notDone, ...fromWrites(writes)]);
    expect(done?.state).toBe('done');
    expect(done?.validAttemptCount).toBe(1);
    expect(planNotDone(context(sheet), must(done), 'absent', '', 'x')).toMatchObject({
      problem: { kind: 'hasAttempts' },
    });
  });

  it('moves every done result without valid attempts to not done (several evaluators)', () => {
    const sheet = sheetFixture();
    const values = { split20S: '3', split40S: '5' };
    // Two phones created a result each for Ana, then every attempt was voided.
    const first = writesOf(planAttempt(context(sheet), must(rowsOf(sheet)[0]), values));
    const second = writesOf(planAttempt(context(sheet), must(rowsOf(sheet)[0]), values));
    let queue = fromWrites([...first, ...second]);
    let [ana] = rowsOf(sheet, SPRINT, queue);
    expect(ana?.results.filter((r) => r.status === 'done')).toHaveLength(2);
    for (const attempt of must(ana).attempts) {
      queue = [
        ...queue,
        ...fromWrites(writesOf(planVoid(context(sheet), must(ana), attempt, 'Mal medido'))),
      ];
    }
    [ana] = rowsOf(sheet, SPRINT, queue);
    expect(ana?.validAttemptCount).toBe(0);
    const writes = writesOf(planNotDone(context(sheet), must(ana), 'absent', '', 'No vino'));
    expect(writes.map((w) => w.op)).toEqual(['test_result.update', 'test_result.update']);
    const [after] = rowsOf(sheet, SPRINT, [...queue, ...fromWrites(writes)]);
    expect(after?.state).toBe('not_done');
    expect(after?.results.every((r) => r.status === 'not_done')).toBe(true);
  });
});

describe('the settings of a station on this phone', () => {
  it('take known modes and methods only', () => {
    expect(
      parseStoredStationSettings({ mode: 'sprint_splits', method: 'photocell', deviceId: null }),
    ).toEqual({ mode: 'sprint_splits', method: 'photocell', deviceId: null });
    expect(parseStoredStationSettings({})).toEqual({});
    expect(parseStoredStationSettings({ mode: 'video_frames' })).toBeNull();
    expect(parseStoredStationSettings({ method: 'historical' })).toBeNull();
    expect(parseStoredStationSettings({ exercise: 3 })).toBeNull();
    expect(parseStoredStationSettings('nope')).toBeNull();
  });
});

describe('the station', () => {
  it('counts progress, finds the next player to load and keeps settings that still fit', () => {
    const sheet = sheetFixture({ stations: [SPRINT, COD_505, REACTION] });
    const queue = fromWrites(
      writesOf(
        planAttempt(context(sheet), must(rowsOf(sheet)[0]), { split20S: '3', split40S: '5' }),
      ),
    );
    const results = fieldResults({ sheet, synced: [], queue, viewer: 'sc' });
    expect(stationProgress(SPRINT, sheet.players, results)).toEqual({ recorded: 1, total: 3 });
    const rows = sheet.players.map((p) => playerStation(SPRINT, p, results));
    // Ana has a result, Diego has no consent: Bruno is next.
    expect(nextPendingPlayer(rows, null)).toBe(BRUNO_ID);
    expect(nextPendingPlayer(rows, BRUNO_ID)).toBeNull();
    expect(
      stationSettingsFor(REACTION, { deviceId: 'gone', method: 'pod' as never }, sheet.devices),
    ).toEqual({ mode: 'value', method: 'pod', deviceId: null, exercise: null });
    expect(
      stationSettingsFor(SPRINT, { mode: 'value', method: 'nope' as never }, sheet.devices),
    ).toEqual(defaultStationSettings(SPRINT));
    // Two values in one attempt (left and right): one attempt, two entries; the asymmetry is derived.
    const cod = writesOf(
      planAttempt(context(sheet, COD_505), must(rowsOf(sheet, COD_505)[0]), {
        cod505_left_s: '2,4',
        cod505_right_s: '2,6',
      }),
    );
    const [ana] = rowsOf(sheet, COD_505, fromWrites(cod));
    expect(ana?.attempts).toHaveLength(1);
    expect(ana?.attempts[0]?.entries).toHaveLength(2);
    expect(ana?.scores.map((s) => s.metricCode)).toContain('cod505_asymmetry_pct');
  });

  it('records the stages of a 30-15 IFT run of the signals (B-507)', () => {
    const sheet = sheetFixture({ stations: [IFT] });
    const rows = rowsOf(sheet, IFT);
    const { steps, skipped } = planIftStages(context(sheet, IFT), rows, [
      { playerId: ANA_ID, lastCompletedStage: 20 },
      { playerId: BRUNO_ID, lastCompletedStage: 18 },
      { playerId: DIEGO_ID, lastCompletedStage: 15 },
    ]);
    // Diego has no consent: left out with his stage, for the staff to load by hand.
    expect(skipped).toEqual([{ playerId: DIEGO_ID, lastCompletedStage: 15 }]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.playerIds).toEqual([ANA_ID, BRUNO_ID]);
    const write = must(steps[0]?.writes[0]);
    expect(write.input).toMatchObject({
      body: {
        results: [
          { playerId: ANA_ID, entries: [{ kind: 'ift_stage', lastCompletedStage: 20 }] },
          { playerId: BRUNO_ID, entries: [{ kind: 'ift_stage', lastCompletedStage: 18 }] },
        ],
      },
    });
    expect(() => prepareMutation(write.op, write.input)).not.toThrow();
  });

  it('adds the stage as one more attempt, one step per player, to whoever has a result', () => {
    const sheet = sheetFixture({ stations: [IFT] });
    const first = planIftStages(context(sheet, IFT), rowsOf(sheet, IFT), [
      { playerId: ANA_ID, lastCompletedStage: 12 },
    ]);
    const queue = fromWrites(first.steps.flatMap((s) => s.writes));
    const { steps, skipped } = planIftStages(context(sheet, IFT), rowsOf(sheet, IFT, queue), [
      { playerId: ANA_ID, lastCompletedStage: 14 },
      { playerId: BRUNO_ID, lastCompletedStage: 18 },
    ]);
    expect(skipped).toEqual([]);
    expect(steps.map((s) => [s.playerIds, s.writes.map((w) => w.op)])).toEqual([
      [[BRUNO_ID], ['test_session.record_results']],
      [[ANA_ID], ['test_result.add_entries']],
    ]);
  });
});
