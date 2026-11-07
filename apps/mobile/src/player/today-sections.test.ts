import { localDate } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import type { RpeSession } from './today.ts';
import { todaySections, type TodaySectionsInput } from './today-sections.ts';

const ITEMS = ['sleep', 'fatigue', 'soreness'] as const;

function session(id: string, overrides: Partial<RpeSession> = {}): RpeSession {
  return {
    session: {
      id: id as RpeSession['session']['id'],
      sport: 'rugby',
      kind: 'training',
      categoryId: null,
      title: null,
      startsAt: '2026-11-03T22:00:00.000Z',
      localDate: localDate(2026, 11, 3),
      plannedDurationMin: 90,
      archivedAt: null,
    },
    closesAt: '2026-11-05T03:00:00.000Z',
    rpe: null,
    minutes: 90,
    pending: false,
    canSubmit: true,
    ...overrides,
  };
}

const loaded = {
  kind: 'form' as const,
  items: ITEMS,
  entry: {
    scores: { sleep: 4, fatigue: 3, soreness: 2 },
    target: { id: 'w1' },
    pending: false,
  },
};

function input(overrides: Partial<TodaySectionsInput> = {}): TodaySectionsInput {
  return {
    wellness: { kind: 'form', items: ITEMS, entry: null },
    rpe: { allowed: true, sessions: [session('s1')] },
    hasNextTestDay: true,
    offers: { painReport: false, externalLoad: false, menstrualCycle: false },
    opened: new Set(),
    ...overrides,
  };
}

const kinds = (value: TodaySectionsInput) => todaySections(value).map((section) => section.kind);

describe('todaySections', () => {
  it('puts what is pending first and open: wellness, then the RPE to load', () => {
    expect(todaySections(input())).toEqual([
      { kind: 'wellnessForm' },
      { kind: 'rpeForm', sessionIds: ['s1'] },
      { kind: 'secondary', rows: ['streak', 'nextTestDay'] },
    ]);
  });

  it('collapses what is done under what is still pending', () => {
    expect(todaySections(input({ wellness: loaded }))).toEqual([
      { kind: 'rpeForm', sessionIds: ['s1'] },
      { kind: 'done', items: [{ kind: 'wellness', key: 'wellness', expanded: false }] },
      { kind: 'secondary', rows: ['streak', 'nextTestDay'] },
    ]);
  });

  it('says "all done" on top when nothing is pending, then the collapsed lines', () => {
    const sections = todaySections(
      input({
        wellness: loaded,
        rpe: { allowed: true, sessions: [session('s1', { rpe: 6 }), session('s2', { rpe: 4 })] },
      }),
    );
    expect(sections).toEqual([
      { kind: 'allDone' },
      {
        kind: 'done',
        items: [
          { kind: 'wellness', key: 'wellness', expanded: false },
          { kind: 'rpe', key: 'rpe:s1', sessionId: 's1', expanded: false },
          { kind: 'rpe', key: 'rpe:s2', sessionId: 's2', expanded: false },
        ],
      },
      { kind: 'secondary', rows: ['streak', 'nextTestDay'] },
    ]);
  });

  it('opens a done line the player tapped, and only that one', () => {
    const sections = todaySections(
      input({
        wellness: loaded,
        rpe: { allowed: true, sessions: [session('s1', { rpe: 6 })] },
        opened: new Set(['rpe:s1']),
      }),
    );
    expect(sections[1]).toEqual({
      kind: 'done',
      items: [
        { kind: 'wellness', key: 'wellness', expanded: false },
        { kind: 'rpe', key: 'rpe:s1', sessionId: 's1', expanded: true },
      ],
    });
  });

  it('keeps a pending RPE apart from a rated one, and a closed rated one as done', () => {
    const sections = todaySections(
      input({
        rpe: {
          allowed: true,
          sessions: [session('old', { rpe: 5, canSubmit: false }), session('new')],
        },
      }),
    );
    expect(sections.slice(0, 3)).toEqual([
      { kind: 'wellnessForm' },
      { kind: 'rpeForm', sessionIds: ['new'] },
      {
        kind: 'done',
        items: [{ kind: 'rpe', key: 'rpe:old', sessionId: 'old', expanded: false }],
      },
    ]);
  });

  it('shows no RPE form without a session: one muted line, and all done with the check-in', () => {
    const sections = todaySections(
      input({ wellness: loaded, rpe: { allowed: true, sessions: [] } }),
    );
    expect(sections.slice(0, 2)).toEqual([
      { kind: 'allDone' },
      {
        kind: 'done',
        items: [
          { kind: 'wellness', key: 'wellness', expanded: false },
          { kind: 'rpeNone', key: 'rpe:none', expanded: false },
        ],
      },
    ]);
    // A muted "no session" alone is not something done.
    expect(kinds(input({ rpe: { allowed: true, sessions: [] } }))).toEqual([
      'wellnessForm',
      'done',
      'secondary',
    ]);
  });

  it('never says "all done" while something is blocked', () => {
    expect(
      todaySections(
        input({
          wellness: { kind: 'unavailable', reason: 'no_consent' },
          rpe: { allowed: false, sessions: [] },
        }),
      ),
    ).toEqual([
      { kind: 'wellnessBlocked', reason: 'no_consent' },
      { kind: 'rpeBlocked' },
      { kind: 'secondary', rows: ['streak', 'nextTestDay'] },
    ]);
    expect(kinds(input({ wellness: loaded, rpe: { allowed: false, sessions: [] } }))).toEqual([
      'rpeBlocked',
      'done',
      'secondary',
    ]);
  });

  it('lists the secondary rows the club offers; pain only after the check-in', () => {
    const offers = { painReport: true, externalLoad: true, menstrualCycle: true };
    expect(todaySections(input({ offers, hasNextTestDay: false })).at(-1)).toEqual({
      kind: 'secondary',
      rows: ['streak', 'externalLoad', 'menstrualCycle'],
    });
    expect(todaySections(input({ offers, wellness: loaded })).at(-1)).toEqual({
      kind: 'secondary',
      rows: ['streak', 'nextTestDay', 'painReport', 'externalLoad', 'menstrualCycle'],
    });
  });
});
