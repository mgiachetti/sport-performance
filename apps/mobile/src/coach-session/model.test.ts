import type { SessionRosterEntry, TrainingSession } from '@sport-performance/contracts';
import type { LocalDate } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_CLOCK,
  canRecordParticipation,
  clockElapsedMs,
  createBatches,
  digitsOnly,
  fillPresent,
  finishClock,
  initialDraft,
  isCorrection,
  isDirty,
  mergeDraftRow,
  pauseClock,
  planSave,
  playedMsOf,
  sessionLists,
  sheetSummary,
  startClock,
  stepContacts,
  toggleOnField,
  touchRow,
  withStatus,
  type DraftRow,
  type KnownParticipation,
} from './model.ts';

const MIN = 60_000;
const empty: DraftRow = { status: '', minutes: '', contacts: '' };

function session(id: string, localDate: string, startsAt: string, archived = false) {
  return {
    id,
    localDate,
    startsAt,
    archivedAt: archived ? '2026-11-01T00:00:00.000Z' : null,
  } as unknown as TrainingSession;
}

function entry(id: string, overrides: Partial<SessionRosterEntry> = {}): SessionRosterEntry {
  return {
    player: { id, firstName: 'Juan', lastName: id, archivedAt: null },
    inCategory: true,
    participation: null,
    availability: { status: 'available', staffNotes: [] },
    hasDataConsent: true,
    canRecord: true,
    ...overrides,
  } as SessionRosterEntry;
}

function known(overrides: Partial<KnownParticipation> = {}): KnownParticipation {
  return {
    target: { id: 'p-1' },
    status: 'full',
    minutes: 60,
    contactsN: null,
    rpe: null,
    srpeAu: null,
    pending: false,
    ...overrides,
  };
}

describe('who loads', () => {
  it('follows the matrix: the coach and the administration', () => {
    expect(canRecordParticipation('coach')).toBe(true);
    expect(canRecordParticipation('admin')).toBe(true);
    expect(canRecordParticipation('sc')).toBe(false);
    expect(canRecordParticipation('medical')).toBe(false);
    expect(canRecordParticipation('player')).toBe(false);
    expect(canRecordParticipation('parent')).toBe(false);
  });
});

describe('sessionLists', () => {
  it("splits today's (by start) from the last week's (latest first), without archived ones", () => {
    const today = '2026-11-03' as LocalDate;
    const lists = sessionLists(
      [
        session('late', '2026-11-03', '2026-11-03T21:00:00.000Z'),
        session('early', '2026-11-03', '2026-11-03T12:00:00.000Z'),
        session('archived', '2026-11-03', '2026-11-03T13:00:00.000Z', true),
        session('yesterday', '2026-11-02', '2026-11-02T20:00:00.000Z'),
        session('week', '2026-10-27', '2026-10-27T20:00:00.000Z'),
        session('old', '2026-10-26', '2026-10-26T20:00:00.000Z'),
        session('tomorrow', '2026-11-04', '2026-11-04T20:00:00.000Z'),
      ],
      today,
    );
    expect(lists.today.map((s) => s.id)).toEqual(['early', 'late']);
    expect(lists.recent.map((s) => s.id)).toEqual(['yesterday', 'week']);
  });
});

describe('draft rows', () => {
  it('start from what the phone knows, or suggest "no disponible" from the medical staff', () => {
    expect(initialDraft(entry('a'), known({ minutes: 45, contactsN: 3 }))).toEqual({
      status: 'full',
      minutes: '45',
      contacts: '3',
    });
    expect(
      initialDraft(entry('a', { availability: { status: 'unavailable', staffNotes: [] } }), null),
    ).toEqual({ status: 'unavailable', minutes: '', contacts: '' });
    expect(initialDraft(entry('a'), null)).toEqual(empty);
  });

  it('clear minutes and contacts with a status without load', () => {
    const row = { status: 'full', minutes: '60', contacts: '4' } as const;
    expect(withStatus(row, 'absent')).toEqual({ status: 'absent', minutes: '', contacts: '' });
    expect(withStatus(row, 'partial')).toEqual({ ...row, status: 'partial' });
  });

  it('count contacts: a first contact marks the player present, never below zero', () => {
    const one = stepContacts(empty, 1);
    expect(one).toEqual({ status: 'full', minutes: '', contacts: '1' });
    expect(stepContacts(stepContacts(one, 1), -1).contacts).toBe('1');
    expect(stepContacts({ ...one, contacts: '0' }, -1).contacts).toBe('0');
    expect(stepContacts(empty, -1)).toEqual(empty);
    const absent = { status: 'absent', minutes: '', contacts: '' } as const;
    expect(stepContacts(absent, 1)).toBe(absent);
  });

  it('accept only digits in the number fields', () => {
    expect(digitsOnly('6a0', 600)).toBe('60');
    expect(digitsOnly('12345', 600)).toBe('123');
  });

  it('fill "todos presentes" only where nothing was picked, for the players the coach loads', () => {
    const rows = new Map<string, DraftRow>([
      ['a', empty],
      ['b', { status: 'absent', minutes: '', contacts: '' }],
      ['c', empty],
    ]);
    const next = fillPresent(rows, new Set(['a', 'b']), 80);
    expect(next.get('a')).toEqual({ status: 'full', minutes: '80', contacts: '' });
    expect(next.get('b')?.status).toBe('absent');
    expect(next.get('c')).toBe(empty);
  });

  it('tell what changed and what corrects a loaded value', () => {
    expect(isDirty(empty, null)).toBe(false);
    expect(isDirty({ status: 'full', minutes: '60', contacts: '' }, known())).toBe(false);
    expect(isDirty({ status: 'full', minutes: '61', contacts: '' }, known())).toBe(true);
    expect(isDirty({ status: 'full', minutes: '9999', contacts: '' }, known())).toBe(true);
    // Filling contacts that were empty is not a correction; changing the minutes is.
    expect(isCorrection({ status: 'full', minutes: 60, contactsN: 3 }, known())).toBe(false);
    expect(isCorrection({ status: 'full', minutes: 50, contactsN: null }, known())).toBe(true);
    expect(isCorrection({ status: 'partial', minutes: 60, contactsN: null }, known())).toBe(true);
    expect(isCorrection({ status: 'full', minutes: 60, contactsN: null }, null)).toBe(false);
  });
});

describe('the clock of who is on the field', () => {
  it('counts each stint while it runs, pauses at half time and survives being re-read', () => {
    let clock = toggleOnField(EMPTY_CLOCK, 'a', 0);
    clock = toggleOnField(clock, 'b', 0);
    clock = startClock(clock, 1_000);
    expect(playedMsOf(clock, 'a', 1_000 + 20 * MIN)).toBe(20 * MIN);
    // b comes off at 30', c goes in.
    clock = toggleOnField(clock, 'b', 1_000 + 30 * MIN);
    clock = toggleOnField(clock, 'c', 1_000 + 30 * MIN);
    clock = pauseClock(clock, 1_000 + 40 * MIN);
    expect(clock.onField).toEqual(['a', 'c']);
    // Half time does not count.
    const resumed = startClock(JSON.parse(JSON.stringify(clock)) as typeof clock, 1_000 + 55 * MIN);
    const end = 1_000 + 95 * MIN;
    expect(clockElapsedMs(resumed, end)).toBe(80 * MIN);
    expect(playedMsOf(resumed, 'a', end)).toBe(80 * MIN);
    expect(playedMsOf(resumed, 'b', end)).toBe(30 * MIN);
    expect(playedMsOf(resumed, 'c', end)).toBe(50 * MIN);
  });

  it('never counts a negative stint when the phone time goes back', () => {
    const clock = startClock(toggleOnField(EMPTY_CLOCK, 'a', 0), 10 * MIN);
    expect(playedMsOf(clock, 'a', 5 * MIN)).toBe(0);
    expect(clockElapsedMs(clock, 5 * MIN)).toBe(0);
  });

  it('writes minutes and status into the draft when it ends', () => {
    let clock = toggleOnField(toggleOnField(EMPTY_CLOCK, 'a', 0), 'b', 0);
    clock = startClock(clock, 0);
    clock = toggleOnField(clock, 'b', 25 * MIN);
    const rows = new Map<string, DraftRow>([
      ['a', empty],
      ['b', { status: '', minutes: '', contacts: '7' }],
      ['c', empty],
      ['d', { status: 'partial', minutes: '', contacts: '' }],
    ]);
    clock = toggleOnField(clock, 'd', 0);
    const next = finishClock(clock, rows, new Set(['a', 'b', 'c', 'd']), 70 * MIN + 20_000);
    expect(next.get('a')).toEqual({ status: 'full', minutes: '70', contacts: '' });
    expect(next.get('b')).toEqual({ status: 'partial', minutes: '25', contacts: '7' });
    expect(next.get('c')).toBe(empty);
    // A status the coach picked stays.
    expect(next.get('d')?.status).toBe('partial');
  });
});

describe('planSave', () => {
  it('creates the new ones, edits only the changed fields of the known ones and skips the rest', () => {
    const entries = [
      entry('new'),
      entry('edit', { participation: null }),
      entry('same'),
      entry('noConsent', { hasDataConsent: false, canRecord: false }),
      entry('bad'),
    ];
    const knownMap = new Map([
      ['edit', known({ target: { clientUuid: 'cu-1' }, contactsN: null })],
      ['same', known()],
    ]);
    const rows = new Map<string, DraftRow>([
      ['new', { status: 'full', minutes: '70', contacts: '2' }],
      ['edit', { status: 'full', minutes: '60', contacts: '5' }],
      ['same', { status: 'full', minutes: '60', contacts: '' }],
      ['noConsent', { status: 'full', minutes: '60', contacts: '' }],
      ['bad', { status: 'full', minutes: '601', contacts: '' }],
    ]);
    const plan = planSave(entries, knownMap, rows);
    // Pure: the clientUuid is given when the save is queued.
    expect(plan.creates).toEqual([{ playerId: 'new', status: 'full', minutes: 70, contactsN: 2 }]);
    expect(planSave(entries, knownMap, rows)).toEqual(plan);
    expect(plan.edits).toEqual([
      {
        playerId: 'edit',
        target: { clientUuid: 'cu-1' },
        correction: false,
        fields: { contactsN: 5 },
      },
    ]);
    expect(plan.errors.get('bad')).toEqual(['minutes']);
    expect(plan.needsReason).toBe(false);
  });

  it('asks for a reason when an edit corrects a loaded value', () => {
    const plan = planSave(
      [entry('a')],
      new Map([['a', known({ minutes: 60 })]]),
      new Map([['a', { status: 'absent', minutes: '', contacts: '' }]]),
    );
    expect(plan.needsReason).toBe(true);
    expect(plan.edits[0]?.fields).toEqual({ status: 'absent', minutes: null });
  });

  it('never sends a field the coach did not touch when a pull changed it in between', () => {
    const player = entry('a');
    const entries = [player];
    const before = known({ minutes: 40, contactsN: 2 });
    // The coach taps +1 contact on what the phone knew…
    const shown = mergeDraftRow(initialDraft(player, before), undefined);
    const draftEntry = touchRow(undefined, shown, stepContacts(shown, 1));
    expect(draftEntry.touched).toEqual(['contacts']);
    // …then a pull brings another staff member's 60 minutes.
    const after = known({ minutes: 60, contactsN: 2 });
    const row = mergeDraftRow(initialDraft(player, after), draftEntry);
    expect(row).toEqual({ status: 'full', minutes: '60', contacts: '3' });
    const plan = planSave(entries, new Map([['a', after]]), new Map([['a', row]]));
    expect(plan.edits).toEqual([
      { playerId: 'a', target: { id: 'p-1' }, correction: true, fields: { contactsN: 3 } },
    ]);
    // The reason is for the contacts the coach changed (2 had been loaded), not for the minutes.
    const fromEmpty = known({ minutes: 40, contactsN: null });
    const touchedEmpty = touchRow(
      undefined,
      initialDraft(player, fromEmpty),
      stepContacts(initialDraft(player, fromEmpty), 1),
    );
    const pulled = known({ minutes: 60, contactsN: null });
    const plan2 = planSave(
      entries,
      new Map([['a', pulled]]),
      new Map([['a', mergeDraftRow(initialDraft(player, pulled), touchedEmpty)]]),
    );
    expect(plan2.edits[0]?.fields).toEqual({ contactsN: 1 });
    expect(plan2.needsReason).toBe(false);
  });

  it('follows a status without load that a pull brought, over untouched minutes', () => {
    const base = { status: 'absent', minutes: '', contacts: '' } as const;
    const draftEntry = touchRow(
      undefined,
      { status: 'full', minutes: '40', contacts: '2' },
      { status: 'full', minutes: '45', contacts: '2' },
    );
    expect(mergeDraftRow(base, draftEntry)).toEqual(base);
    // A status the coach picked wins.
    const picked = touchRow(
      draftEntry,
      { status: 'full', minutes: '45', contacts: '2' },
      {
        status: 'partial',
        minutes: '45',
        contacts: '2',
      },
    );
    expect(picked.touched).toEqual(['status', 'minutes']);
    expect(mergeDraftRow(base, picked)).toEqual({ status: 'partial', minutes: '45', contacts: '' });
  });

  it('splits the new rows in batches of the API maximum', () => {
    const rows = Array.from({ length: 230 }, (_, i) => i);
    expect(createBatches(rows).map((batch) => batch.length)).toEqual([100, 100, 30]);
  });
});

describe('sheetSummary', () => {
  it('counts statuses, minutes and contacts of the sheet', () => {
    expect(
      sheetSummary([
        { status: 'full', minutes: '70', contacts: '4' },
        { status: 'partial', minutes: '20', contacts: '' },
        { status: 'absent', minutes: '', contacts: '' },
        { status: 'unavailable', minutes: '', contacts: '' },
        empty,
      ]),
    ).toEqual({ present: 2, absent: 1, unavailable: 1, pending: 1, minutes: 90, contacts: 4 });
  });
});
