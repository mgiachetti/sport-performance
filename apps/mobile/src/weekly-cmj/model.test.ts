import { parseAlertRule, parseLocalDate } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import type { LocalRow } from '../offline/local-store.ts';
import { prepareMutation } from '../offline/operations.ts';
import { uuid } from '../test/fake-sync-server.ts';
import { ANA_ID, BRUNO_ID, CMJ_DEFINITION_ID, cmjResultDto } from '../test/weekly-cmj-fixtures.ts';
import {
  attemptEntry,
  canRecordWeeklyCmj,
  cmjResults,
  cmjRuleFor,
  createResultInput,
  nextAttemptNumber,
  nextPendingPlayer,
  parseAttempt,
  parseWeeklyCmjSettings,
  weeklyCmjRoster,
  weeklyCmjRows,
  type WeeklyCmjPlayer,
} from './model.ts';

const TODAY = parseLocalDate('2026-11-03');

function player(playerId: string, overrides: Partial<WeeklyCmjPlayer> = {}): WeeklyCmjPlayer {
  return {
    playerId,
    firstName: 'Ana',
    lastName: 'Pérez',
    sex: 'male',
    sport: 'rugby',
    stage: 'performance',
    availability: 'available',
    ...overrides,
  };
}

function row(data: ReturnType<typeof cmjResultDto>, pending = false): LocalRow<'test_result'> {
  return { id: data.id, clientUuid: null, data, pending };
}

const DEFAULT_RULE = parseAlertRule({
  code: 'cmj_drop',
  kind: 'cmj_drop',
  enabled: true,
  params: {
    warningDropPct: 7,
    criticalDropPct: 15,
    baselineWindowDays: 42,
    minBaselineSamples: 3,
    maxMeasurementAgeDays: 7,
  },
});

describe('who and whom', () => {
  it('is for whoever records test results', () => {
    expect(canRecordWeeklyCmj('sc')).toBe(true);
    expect(canRecordWeeklyCmj('admin')).toBe(true);
    expect(canRecordWeeklyCmj('coach')).toBe(false);
    expect(canRecordWeeklyCmj('player')).toBe(false);
    expect(canRecordWeeklyCmj('parent')).toBe(false);
  });

  it('lists only the stages with a weekly CMJ and counts the rest', () => {
    const roster = weeklyCmjRoster([
      player(ANA_ID),
      player(BRUNO_ID, { stage: 'development' }),
      player(uuid(), { stage: null }),
    ]);
    expect(roster.players.map((p) => p.playerId)).toEqual([ANA_ID]);
    expect(roster.otherStages).toBe(2);
  });
});

describe('results', () => {
  it('reads served CMJ results and leaves out other tests and "not done"', () => {
    const cmj = cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-27', heightsCm: [40, 42] });
    const sprint = {
      ...cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-27', heightsCm: [1] }),
      testCode: 'sprint_40',
    };
    const notDone = {
      ...cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-28', heightsCm: [] }),
      status: 'not_done' as const,
    };
    const results = cmjResults([row(cmj), row(sprint), row(notDone)], [], 'best');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ heightCm: 42, sync: 'saved', target: { id: cmj.id } });
    expect(results[0]?.attempts.map((a) => a.counts)).toEqual([false, true]);
  });

  it('computes the height of a flight time with h = g·t²/8', () => {
    const cmj = cmjResultDto({
      playerId: ANA_ID,
      measuredOn: '2026-10-27',
      heightsCm: [],
      flightTimesS: [0.6],
    });
    const [result] = cmjResults(
      [row({ ...cmj, entries: cmj.entries.map((e) => ({ ...e, values: [] })) })],
      [],
      'best',
    );
    expect(result?.heightCm).toBeCloseTo(((9.81 * 0.36) / 8) * 100, 6);
    expect(result?.attempts[0]?.flightTimeMs).toBeCloseTo(600, 6);
  });

  it('scores by the mean when the protocol says so', () => {
    const cmj = cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-27', heightsCm: [40, 42] });
    const [result] = cmjResults([row(cmj)], [], 'mean');
    expect(result?.heightCm).toBe(41);
    expect(result?.attempts.some((a) => a.counts)).toBe(false);
  });
});

describe('rows', () => {
  const history = [
    cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-13', heightsCm: [40] }),
    cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-20', heightsCm: [41] }),
    cmjResultDto({ playerId: ANA_ID, measuredOn: '2026-10-27', heightsCm: [42] }),
  ];

  function rowsWith(
    today: readonly number[],
    rules = [DEFAULT_RULE],
    method: 'app' | 'manual' = 'app',
  ) {
    const results = cmjResults(
      [
        ...history.map((r) => row(r)),
        ...(today.length === 0
          ? []
          : [row(cmjResultDto({ playerId: ANA_ID, measuredOn: TODAY, heightsCm: today, method }))]),
      ],
      [],
      'best',
    );
    return weeklyCmjRows({ players: [player(ANA_ID)], results, rules, today: TODAY, method });
  }

  it('shows the baseline before the jump', () => {
    const [ana] = rowsWith([]);
    expect(ana?.baseline).toMatchObject({ heightCm: 41, samples: 3, minSamples: 3 });
    expect(ana?.verdict).toBeNull();
    expect(ana?.sync).toBeNull();
  });

  it('gives the verdict of the club rule: ok, warning or critical', () => {
    expect(rowsWith([40])[0]?.verdict).toMatchObject({ kind: 'compared', severity: 'ok' });
    const warning = rowsWith([38])[0]?.verdict;
    expect(warning).toMatchObject({ kind: 'compared', severity: 'warning', baselineHeightCm: 41 });
    expect(warning?.kind === 'compared' ? warning.dropPct : 0).toBeCloseTo((3 / 41) * 100, 6);
    expect(rowsWith([34])[0]?.verdict).toMatchObject({ severity: 'critical' });
  });

  it('never compares another method: no baseline with it', () => {
    const [ana] = rowsWith([30], [DEFAULT_RULE], 'manual');
    expect(ana?.baseline.heightCm).toBeNull();
    expect(ana?.otherMethodDays).toBe(3);
    expect(ana?.verdict).toEqual({ kind: 'no_baseline', samples: 0, minSamples: 3 });
  });

  it('says when no rule of the club applies to the player', () => {
    const female = parseAlertRule({ ...DEFAULT_RULE, appliesTo: { sexes: ['female'] } });
    const disabled = parseAlertRule({ ...DEFAULT_RULE, enabled: false });
    expect(cmjRuleFor([female, disabled], player(ANA_ID))).toBeNull();
    const [ana] = rowsWith([38], [female]);
    expect(ana?.verdict).toEqual({ kind: 'no_rule', heightCm: 38 });
    // The baseline still shows, with the default window.
    expect(ana?.baseline.heightCm).toBe(41);
  });
});

describe('typing', () => {
  it('reads es-AR numbers and refuses what is not a jump', () => {
    expect(parseAttempt('', 'height_cm', 'male')).toEqual({ status: 'empty' });
    expect(parseAttempt('41,5', 'height_cm', 'male')).toEqual({
      status: 'ok',
      value: 41.5,
      heightCm: 41.5,
      implausible: false,
    });
    expect(parseAttempt('41.5', 'height_cm', 'male')).toEqual({ status: 'invalid' });
    expect(parseAttempt('0', 'height_cm', 'male')).toEqual({ status: 'invalid' });
    expect(parseAttempt('-3', 'height_cm', 'male')).toEqual({ status: 'invalid' });
    expect(parseAttempt('abc', 'flight_time_ms', 'male')).toEqual({ status: 'invalid' });
  });

  it('turns a flight time into a height and flags implausible jumps', () => {
    const flight = parseAttempt('580', 'flight_time_ms', 'male');
    expect(flight.status === 'ok' ? flight.heightCm : 0).toBeCloseTo(41.25, 2);
    expect(parseAttempt('95', 'height_cm', 'male')).toMatchObject({ implausible: true });
    expect(parseAttempt('5', 'height_cm', 'female')).toMatchObject({ implausible: true });
  });
});

describe('writing', () => {
  it('builds a create the server contract accepts, outside a test day', () => {
    const entries = [
      attemptEntry({
        mode: 'height_cm',
        value: 41.5,
        attemptNumber: 1,
        clientUuid: uuid(),
        recordedAt: '2026-11-03T15:00:00.000Z',
      }),
      attemptEntry({
        mode: 'flight_time_ms',
        value: 580,
        attemptNumber: 2,
        clientUuid: uuid(),
        recordedAt: '2026-11-03T15:00:00.000Z',
      }),
    ];
    const input = createResultInput({
      clientUuid: uuid(),
      playerId: ANA_ID,
      testDefinitionId: CMJ_DEFINITION_ID,
      measuredOn: TODAY,
      method: 'app',
      evaluatorId: 'f1111111-1111-4111-8111-111111111111',
      entries,
    });
    const prepared = prepareMutation('test_result.create', input);
    expect(prepared.input.body).not.toHaveProperty('testSessionId');
    const { body } = prepared.input;
    if (body.status !== 'done') throw new Error('done');
    expect(body.entries[1]).toMatchObject({
      kind: 'cmj_flight_time',
      flightTimeS: 0.58,
    });
  });

  it('numbers the next attempt after every attempt, voided ones included', () => {
    const [result] = cmjResults(
      [row(cmjResultDto({ playerId: ANA_ID, measuredOn: TODAY, heightsCm: [40, 41] }))],
      [],
      'best',
    );
    expect(nextAttemptNumber(result ?? null)).toBe(3);
    expect(nextAttemptNumber(null)).toBe(1);
  });

  it('goes to the next player without a jump today', () => {
    const rows = weeklyCmjRows({
      players: [player(ANA_ID), player(BRUNO_ID)],
      results: cmjResults(
        [row(cmjResultDto({ playerId: ANA_ID, measuredOn: TODAY, heightsCm: [40] }))],
        [],
        'best',
      ),
      rules: [DEFAULT_RULE],
      today: TODAY,
      method: 'app',
    });
    expect(nextPendingPlayer(rows, null)).toBe(BRUNO_ID);
    expect(nextPendingPlayer(rows, BRUNO_ID)).toBeNull();
  });

  it('reads back only settings this build knows', () => {
    expect(parseWeeklyCmjSettings({ method: 'app', mode: 'height_cm', categoryId: null })).toEqual({
      method: 'app',
      mode: 'height_cm',
      categoryId: null,
    });
    expect(
      parseWeeklyCmjSettings({ method: 'video', mode: 'height_cm', categoryId: null }),
    ).toBeNull();
    expect(parseWeeklyCmjSettings('x')).toBeNull();
  });
});
