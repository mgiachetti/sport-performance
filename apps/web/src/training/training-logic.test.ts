import { parseTimeZone } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { P1, P2, participation, rosterEntry, trainingSession } from '../test/training-fixtures';
import { fromLocalStart, parseTimeOfDay, toLocalStart } from './local-time';
import {
  fillPresent,
  initialDraft,
  isCorrection,
  isDirty,
  planSave,
  rowValues,
  sessionTotals,
  withStatus,
  type DraftRow,
} from './participation';
import { parseSessionsSearch } from './search';
import {
  apiFieldErrors,
  createBody,
  editPatch,
  emptySessionForm,
  parseDrills,
  parseSessionForm,
  sessionFormFrom,
} from './session-form';
import { ApiError } from '@sport-performance/contracts';

const BUENOS_AIRES = parseTimeZone('America/Argentina/Buenos_Aires');
const MADRID = parseTimeZone('Europe/Madrid');

describe('local start of a session', () => {
  it('reads the club clock, not the browser one', () => {
    expect(toLocalStart('2026-11-03T21:30:00.000Z', BUENOS_AIRES)).toEqual({
      date: '2026-11-03',
      time: '18:30',
    });
    // Past midnight UTC it is still the same club day.
    expect(toLocalStart('2026-11-04T02:15:00.000Z', BUENOS_AIRES)).toEqual({
      date: '2026-11-03',
      time: '23:15',
    });
  });

  it('turns the club day and time into the instant, with DST', () => {
    expect(fromLocalStart({ date: '2026-11-03', time: '18:30' }, BUENOS_AIRES)).toBe(
      '2026-11-03T21:30:00.000Z',
    );
    expect(fromLocalStart({ date: '2026-07-01', time: '10:00' }, MADRID)).toBe(
      '2026-07-01T08:00:00.000Z',
    );
    expect(fromLocalStart({ date: '2026-02-30', time: '10:00' }, BUENOS_AIRES)).toBeNull();
    expect(fromLocalStart({ date: '2026-02-01', time: '24:00' }, BUENOS_AIRES)).toBeNull();
    expect(parseTimeOfDay('7:00')).toBeNull();
    expect(parseTimeOfDay('07:05')).toBe(425);
  });
});

describe('session form', () => {
  const base = emptySessionForm({
    categoryId: 'c',
    date: '2026-11-03' as never,
  });

  it('parses with the contract limits and drops the opponent of a training', () => {
    const parsed = parseSessionForm(
      { ...base, time: '18:30', plannedDurationMin: '90', title: '  Defensa ', opponent: 'CASI' },
      BUENOS_AIRES,
    );
    expect(parsed).toEqual({
      ok: true,
      session: {
        kind: 'training',
        categoryId: 'c',
        startsAt: '2026-11-03T21:30:00.000Z',
        plannedDurationMin: 90,
        title: 'Defensa',
        location: null,
        opponent: null,
        notes: null,
      },
    });
  });

  it('reports what is missing or out of range', () => {
    expect(
      parseSessionForm(
        { ...base, categoryId: '', date: '', plannedDurationMin: '0' },
        BUENOS_AIRES,
      ),
    ).toEqual({
      ok: false,
      errors: { categoryId: 'required', date: 'required', plannedDurationMin: 'duration' },
    });
    expect(parseSessionForm({ ...base, time: '' }, BUENOS_AIRES)).toEqual({
      ok: false,
      errors: { time: 'start' },
    });
  });

  it('builds the create body with the drills and the client uuid', () => {
    const parsed = parseSessionForm({ ...base, kind: 'match', opponent: 'CASI' }, BUENOS_AIRES);
    const drills = parseDrills([
      { key: 'a', name: 'Tackle', durationMin: '20', contactLevel: 'controlled' },
    ]);
    if (!parsed.ok || !drills.ok) throw new Error('expected valid');
    expect(createBody(parsed.session, drills.drills, 'uuid')).toEqual({
      clientUuid: 'uuid',
      kind: 'match',
      categoryId: 'c',
      startsAt: '2026-11-03T21:00:00.000Z',
      opponent: 'CASI',
      drills: [{ name: 'Tackle', durationMin: 20, contactLevel: 'controlled' }],
    });
    expect(parseDrills([{ key: 'b', name: ' ', durationMin: 'x', contactLevel: 'none' }])).toEqual({
      ok: false,
      errors: new Map([['b', { name: 'required', durationMin: 'duration' }]]),
    });
  });

  it('patches only what changed and knows a correction from a completion', () => {
    const current = trainingSession({ plannedDurationMin: null });
    const form = sessionFormFrom(current, BUENOS_AIRES);
    const same = parseSessionForm(form, BUENOS_AIRES);
    if (!same.ok) throw new Error('expected valid');
    expect(editPatch(same.session, current)).toEqual({ changes: {}, isCorrection: false });

    // Filling an empty value is not a correction.
    const filled = parseSessionForm({ ...form, plannedDurationMin: '75' }, BUENOS_AIRES);
    if (!filled.ok) throw new Error('expected valid');
    expect(editPatch(filled.session, current)).toEqual({
      changes: { plannedDurationMin: 75 },
      isCorrection: false,
    });

    // Moving the start is.
    const moved = parseSessionForm({ ...form, time: '19:00' }, BUENOS_AIRES);
    if (!moved.ok) throw new Error('expected valid');
    expect(editPatch(moved.session, current)).toEqual({
      changes: { startsAt: '2026-11-03T22:00:00.000Z' },
      isCorrection: true,
    });
  });

  it('points the API validation errors at their fields', () => {
    const error = new ApiError({
      operationId: 'createTrainingSession',
      status: 400,
      code: 'validation_failed',
      message: 'x',
      details: [
        { path: ['body', 'startsAt'], code: 'custom', message: 'x' },
        { path: ['body', 'opponent'], code: 'custom', message: 'x' },
      ],
    });
    expect(apiFieldErrors(error)).toEqual({ time: 'start', opponent: 'invalid' });
    expect(apiFieldErrors(new Error('x'))).toEqual({});
  });
});

describe('participation sheet', () => {
  const recorded = participation(P1, { status: 'full', minutes: 90, contactsN: 4, rpe: 6 });

  it('starts from what is recorded, or "unavailable" when the medical staff says so', () => {
    expect(
      initialDraft(rosterEntry(P1, { first: 'a', last: 'b' }, { participation: recorded })),
    ).toEqual({ status: 'full', minutes: '90', contacts: '4' });
    expect(
      initialDraft(
        rosterEntry(
          P2,
          { first: 'a', last: 'b' },
          {
            availability: { status: 'unavailable', staffNotes: [] },
          },
        ),
      ),
    ).toEqual({ status: 'unavailable', minutes: '', contacts: '' });
    expect(initialDraft(rosterEntry(P2, { first: 'a', last: 'b' }))).toEqual({
      status: '',
      minutes: '',
      contacts: '',
    });
  });

  it('clears the load of absent and unavailable players', () => {
    const row: DraftRow = { status: 'full', minutes: '90', contacts: '3' };
    expect(withStatus(row, 'absent')).toEqual({ status: 'absent', minutes: '', contacts: '' });
    expect(withStatus(row, 'partial')).toEqual({ ...row, status: 'partial' });
    expect(rowValues({ status: 'full', minutes: '601', contacts: 'x' })).toEqual({
      errors: ['minutes', 'contacts'],
    });
  });

  it('fills present only the editable rows with nothing yet', () => {
    const rows = new Map<string, DraftRow>([
      ['a', { status: '', minutes: '', contacts: '' }],
      ['b', { status: 'absent', minutes: '', contacts: '' }],
      ['c', { status: '', minutes: '', contacts: '' }],
    ]);
    const filled = fillPresent(rows, new Set(['a', 'b']), 80);
    expect(filled.get('a')).toEqual({ status: 'full', minutes: '80', contacts: '' });
    expect(filled.get('b')?.status).toBe('absent');
    expect(filled.get('c')?.status).toBe('');
  });

  it('knows corrections: a status change, or minutes and contacts that had a value', () => {
    expect(isCorrection({ status: 'full', minutes: 90, contactsN: 4 }, recorded)).toBe(false);
    expect(isCorrection({ status: 'full', minutes: 80, contactsN: 4 }, recorded)).toBe(true);
    expect(isCorrection({ status: 'absent', minutes: null, contactsN: null }, recorded)).toBe(true);
    const empty = participation(P1, { minutes: null });
    expect(isCorrection({ status: 'full', minutes: 60, contactsN: null }, empty)).toBe(false);
    expect(isCorrection({ status: 'full', minutes: 60, contactsN: null }, null)).toBe(false);
  });

  it('plans one batch with the dirty recordable rows, their versions and the reason', () => {
    const entries = [
      rosterEntry(P1, { first: 'a', last: 'b' }, { participation: recorded }),
      rosterEntry(P2, { first: 'c', last: 'd' }),
      rosterEntry(
        '0192e7a0-5555-7000-8000-000000000009',
        { first: 'e', last: 'f' },
        {
          canRecord: false,
          hasDataConsent: false,
        },
      ),
    ];
    const drafts = new Map<string, DraftRow>([
      [P1, { status: 'full', minutes: '75', contacts: '4' }],
      [P2, { status: 'partial', minutes: '30', contacts: '' }],
      ['0192e7a0-5555-7000-8000-000000000009', { status: 'full', minutes: '90', contacts: '' }],
    ]);
    let n = 0;
    const plan = planSave(entries, drafts, () => `uuid-${String((n += 1))}`);
    expect(plan.needsReason).toBe(true);
    expect(plan.errors.size).toBe(0);
    expect(plan.rows).toEqual([
      {
        clientUuid: 'uuid-1',
        playerId: P1,
        status: 'full',
        minutes: 75,
        contactsN: 4,
        version: recorded.version,
      },
      { clientUuid: 'uuid-2', playerId: P2, status: 'partial', minutes: 30, contactsN: null },
    ]);
    expect(isDirty({ status: 'full', minutes: '90', contacts: '4' }, recorded)).toBe(false);
  });

  it('totals what the API holds', () => {
    const totals = sessionTotals([
      rosterEntry(
        P1,
        { first: 'a', last: 'b' },
        {
          participation: participation(P1, { minutes: 90, rpe: 6, srpeAu: 540 }),
        },
      ),
      rosterEntry(
        P2,
        { first: 'c', last: 'd' },
        {
          participation: participation(P2, { status: 'absent', minutes: null }),
        },
      ),
    ]);
    expect(totals).toEqual({
      recorded: 2,
      present: 1,
      absent: 1,
      unavailable: 0,
      minutes: 90,
      rpeReported: 1,
      srpeAu: 540,
    });
  });
});

describe('sessions search', () => {
  it('keeps only valid filters', () => {
    expect(
      parseSessionsSearch({ kind: 'match', from: '2026-03-01', to: 'nope', archived: 'true' }),
    ).toEqual({ kind: 'match', from: '2026-03-01', archived: true });
    expect(parseSessionsSearch({ kind: 'gym' })).toEqual({});
  });
});
