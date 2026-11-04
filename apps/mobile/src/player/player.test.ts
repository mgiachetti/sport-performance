import type { MyTrainingSession, TestResult } from '@sport-performance/contracts';
import { localDate } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import type { LocalRow, QueuedMutation } from '../offline/local-store.ts';
import { participationDto, SESSION_ID, uuid } from '../test/fake-sync-server.ts';
import { personalRecords, testHistory } from './records.ts';
import { wellnessStreak } from './streak.ts';
import { nextTestDay, rpeRange, rpeSessions } from './today.ts';

const TODAY = localDate(2026, 11, 3);
const day = (n: number) => localDate(2026, 11, n);

describe('wellnessStreak', () => {
  it('counts consecutive club days ending today', () => {
    expect(wellnessStreak([day(1), day(2), day(3)], TODAY)).toEqual({
      days: 3,
      includesToday: true,
    });
  });

  it('keeps a streak that ended yesterday alive until today closes', () => {
    expect(wellnessStreak([day(1), day(2)], TODAY)).toEqual({
      days: 2,
      includesToday: false,
    });
  });

  it('breaks on a missing day and starts at zero', () => {
    expect(wellnessStreak([day(1), day(3)], TODAY).days).toBe(1);
    expect(wellnessStreak([day(1)], TODAY).days).toBe(0);
    expect(wellnessStreak([], TODAY)).toEqual({ days: 0, includesToday: false });
  });

  it('crosses months and ignores repeated days', () => {
    const days = [localDate(2026, 10, 31), day(1), day(1), day(2), day(3)];
    expect(wellnessStreak(days, TODAY).days).toBe(4);
  });
});

function result(overrides: Partial<TestResult> & Pick<TestResult, 'measuredOn'>): TestResult {
  return {
    id: uuid(),
    playerId: 'b1111111-1111-4111-8111-111111111111',
    testDefinitionId: uuid(),
    testCode: 'sprint_40',
    protocolVersion: 1,
    testSessionId: null,
    status: 'done',
    notDoneReason: null,
    notDoneNote: null,
    method: 'photocell',
    evaluatorId: null,
    deviceId: null,
    exercise: null,
    conditions: {},
    notes: null,
    importId: null,
    entries: [],
    scores: [],
    createdAt: `${overrides.measuredOn}T12:00:00.000Z`,
    updatedAt: `${overrides.measuredOn}T12:00:00.000Z`,
    version: 'v1',
    ...overrides,
  } as TestResult;
}

const score = (metricCode: string, value: number, unit = 's') => ({
  metricCode,
  unit,
  value,
  aggregation: 'best' as const,
  attemptCount: 3,
  derived: false,
});

describe('personalRecords', () => {
  it('keeps the best by the direction of each metric, with its day and method', () => {
    const records = personalRecords([
      result({
        measuredOn: day(1),
        scores: [score('sprint_40_s', 5.6), score('sprint_vmax_ms', 8.1, 'ms')],
      }),
      result({
        measuredOn: day(2),
        method: 'manual',
        scores: [score('sprint_40_s', 5.4), score('sprint_vmax_ms', 7.9, 'ms')],
      }),
    ]);
    const sprint = records.find((r) => r.metricCode === 'sprint_40_s');
    expect(sprint).toMatchObject({
      value: 5.4,
      measuredOn: day(2),
      method: 'manual',
      direction: 'lower_is_better',
      resultCount: 2,
      // Photocell and manual are not comparable without a warning (principle 4).
      mixedMethods: true,
    });
    expect(records.find((r) => r.metricCode === 'sprint_vmax_ms')).toMatchObject({
      value: 8.1,
      measuredOn: day(1),
      method: 'photocell',
    });
  });

  it('keeps the first day of a tie and a record per strength exercise', () => {
    const records = personalRecords([
      result({
        measuredOn: day(1),
        testCode: 'cmj',
        method: 'app',
        scores: [score('cmj_height_cm', 40, 'cm')],
      }),
      result({
        measuredOn: day(2),
        testCode: 'cmj',
        method: 'app',
        scores: [score('cmj_height_cm', 40, 'cm')],
      }),
      result({
        measuredOn: day(1),
        testCode: 'strength',
        exercise: 'goblet_squat',
        scores: [score('e1rm_kg', 50, 'kg')],
      }),
      result({
        measuredOn: day(1),
        testCode: 'strength',
        exercise: 'bench_press',
        scores: [score('e1rm_kg', 40, 'kg')],
      }),
    ]);
    expect(records.find((r) => r.metricCode === 'cmj_height_cm')).toMatchObject({
      measuredOn: day(1),
      mixedMethods: false,
    });
    expect(records.filter((r) => r.metricCode === 'e1rm_kg').map((r) => r.exercise)).toEqual([
      'goblet_squat',
      'bench_press',
    ]);
  });

  it('ignores results not done and metrics outside the dictionary', () => {
    const records = personalRecords([
      result({ measuredOn: day(1), status: 'not_done', scores: [score('sprint_40_s', 5)] }),
      result({
        measuredOn: day(1),
        testCode: 'cod_505',
        scores: [score('club_custom_s', 2)],
      }),
    ]);
    expect(records).toEqual([]);
  });

  it('orders the history newest first', () => {
    const older = result({ measuredOn: day(1) });
    const newer = result({ measuredOn: day(2) });
    expect(testHistory([older, newer]).map((r) => r.id)).toEqual([newer.id, older.id]);
  });
});

const NOW = Date.parse('2026-11-03T21:00:00.000Z');

function myTrainingSession(
  overrides: { startsAt?: string; closesAt?: string; id?: string; archived?: boolean } = {},
): MyTrainingSession {
  const startsAt = overrides.startsAt ?? '2026-11-03T19:00:00.000Z';
  return {
    session: {
      id: overrides.id ?? SESSION_ID,
      sport: 'rugby',
      kind: 'training',
      categoryId: null,
      title: null,
      startsAt,
      localDate: day(3),
      plannedDurationMin: 90,
      archivedAt: overrides.archived === true ? '2026-11-03T20:00:00.000Z' : null,
    },
    participation: null,
    rpeWindow: { opensAt: startsAt, closesAt: overrides.closesAt ?? '2026-11-05T03:00:00.000Z' },
    canSubmitRpe: true,
  } as MyTrainingSession;
}

const localParticipation = (
  overrides: Parameters<typeof participationDto>[0],
  pending = false,
): LocalRow<'participation'> => {
  const data = participationDto(overrides);
  return { id: data.id, clientUuid: null, data, pending };
};

const queuedRpe = (sessionId: string, rpe: number): QueuedMutation =>
  ({
    seq: 1,
    mutationId: uuid(),
    op: 'rpe.submit',
    hlc: 'h',
    input: { params: { trainingSessionId: sessionId }, body: { clientUuid: uuid(), rpe } },
    targets: [],
    state: 'pending',
    attempts: 0,
    createdAt: NOW,
    ackedAt: null,
  }) as unknown as QueuedMutation;

describe('rpeSessions', () => {
  it('lists an open session without RPE with the planned minutes', () => {
    const [item] = rpeSessions({
      sessions: [myTrainingSession()],
      participations: [],
      queue: [],
      nowMs: NOW,
    });
    expect(item).toMatchObject({ rpe: null, canSubmit: true, minutes: 90, pending: false });
  });

  it('shows a queued RPE before the participation exists', () => {
    const [item] = rpeSessions({
      sessions: [myTrainingSession()],
      participations: [],
      queue: [queuedRpe(SESSION_ID, 6)],
      nowMs: NOW,
    });
    expect(item).toMatchObject({ rpe: 6, pending: true });
  });

  it('prefers the local participation, with its minutes and pending edits', () => {
    const [item] = rpeSessions({
      sessions: [myTrainingSession()],
      participations: [localParticipation({ rpe: 7, minutes: 60 }, true)],
      queue: [queuedRpe(SESSION_ID, 3)],
      nowMs: NOW,
    });
    expect(item).toMatchObject({ rpe: 7, minutes: 60, pending: true });
  });

  it('leaves out absent players, archived sessions and closed windows without RPE', () => {
    const closed = myTrainingSession({ id: uuid(), closesAt: '2026-11-03T20:00:00.000Z' });
    expect(
      rpeSessions({
        sessions: [myTrainingSession(), myTrainingSession({ id: uuid(), archived: true }), closed],
        participations: [localParticipation({ status: 'absent', minutes: null })],
        queue: [],
        nowMs: NOW,
      }),
    ).toEqual([]);
  });

  it('keeps a closed session with its RPE, read only', () => {
    const [item] = rpeSessions({
      sessions: [myTrainingSession({ closesAt: '2026-11-03T20:00:00.000Z' })],
      participations: [localParticipation({ rpe: 5 })],
      queue: [],
      nowMs: NOW,
    });
    expect(item).toMatchObject({ rpe: 5, canSubmit: false });
  });

  it('covers yesterday and today', () => {
    expect(rpeRange(TODAY)).toEqual({ from: day(2), to: day(3) });
  });
});

describe('nextTestDay', () => {
  it('is the first day from today on', () => {
    const days = [{ scheduledOn: day(10) }, { scheduledOn: day(2) }, { scheduledOn: day(5) }];
    expect(nextTestDay(days, TODAY)).toEqual({ scheduledOn: day(5) });
    expect(nextTestDay([], TODAY)).toBeNull();
  });
});
