import type { SessionRosterEntry, TrainingSession } from '@sport-performance/contracts';
import { DEFAULT_CLUB_TIME_ZONE } from '@sport-performance/domain';
import { createTranslator } from '@sport-performance/i18n';
import { describe, expect, it } from 'vitest';
import { EMPTY_CLOCK, startClock, toggleOnField, type KnownParticipation } from './model.ts';
import {
  clockView,
  editablePlayers,
  rowErrors,
  effectiveRows,
  sessionTitle,
  sessionWhen,
  sheetPlayers,
} from './view.ts';

const translator = createTranslator();

function entry(id: string, overrides: Partial<SessionRosterEntry> = {}): SessionRosterEntry {
  return {
    player: { id, firstName: 'Juan', lastName: `Apellido ${id}`, archivedAt: null },
    inCategory: true,
    participation: null,
    availability: { status: 'available', staffNotes: [] },
    hasDataConsent: true,
    canRecord: true,
    ...overrides,
  } as SessionRosterEntry;
}

const knownA: KnownParticipation = {
  target: { id: 'p-a' },
  status: 'full',
  minutes: 70,
  periodMinutes: null,
  contactsN: 4,
  rpe: 6,
  srpeAu: 420,
  pending: true,
};

describe('session titles', () => {
  const base = { title: null, kind: 'training', opponent: null } as const;
  it('use the title, the opponent or the kind with the category', () => {
    expect(sessionTitle({ ...base, title: 'Defensa' }, 'M17', translator)).toBe('Defensa');
    expect(sessionTitle({ ...base, kind: 'match', opponent: 'Hindú' }, 'M17', translator)).toBe(
      'Partido contra Hindú',
    );
    expect(sessionTitle(base, 'M17', translator)).toBe('Entrenamiento M17');
    expect(sessionTitle({ ...base, kind: 'match' }, null, translator)).toBe(
      'Partido todo el deporte',
    );
  });

  it('say when, in the club time zone', () => {
    const session = {
      kind: 'match',
      startsAt: '2026-11-03T21:30:00.000Z',
      localDate: '2026-11-03',
    } as Pick<TrainingSession, 'kind' | 'startsAt' | 'localDate'>;
    expect(sessionWhen(session, DEFAULT_CLUB_TIME_ZONE, translator)).toBe(
      'Partido · 03/11/2026 18:30',
    );
  });
});

describe('sheetPlayers', () => {
  it('lays the draft over what the phone knows, with the clock and read-only reasons', () => {
    const entries = [
      entry('a'),
      entry('b', { availability: { status: 'unavailable', staffNotes: [] } }),
      entry('c', { inCategory: false, hasDataConsent: false, canRecord: false }),
    ];
    const known = new Map([['a', knownA]]);
    const clock = startClock(toggleOnField(EMPTY_CLOCK, 'a', 0), 0);
    const draft = {
      rows: { a: { status: 'full', minutes: '70', contacts: '5', touched: ['contacts'] } as const },
      clock,
    };
    const rows = effectiveRows(entries, known, draft);
    const players = sheetPlayers(
      entries,
      known,
      draft,
      rowErrors(rows, editablePlayers(entries)),
      12 * 60_000,
    );
    expect(players.map((p) => p.name)).toEqual([
      'Apellido a, Juan',
      'Apellido b, Juan',
      'Apellido c, Juan',
    ]);
    expect(players[0]).toMatchObject({
      row: { contacts: '5' },
      edited: true,
      unsent: true,
      rpe: 6,
      srpeAu: 420,
      field: { on: true, minutes: 12 },
      readOnly: null,
    });
    // The medical staff's "no disponible" is the starting suggestion.
    expect(players[1]?.row.status).toBe('unavailable');
    expect(players[1]?.edited).toBe(false);
    expect(players[1]?.playsWhileUnavailable).toBe(false);
    expect(players[2]).toMatchObject({
      calledUp: true,
      readOnly: 'noConsent',
      field: { on: false },
    });
    expect(clockView(clock, 125_000)).toEqual({
      status: 'running',
      elapsedS: 125,
      onField: 1,
      periods: 0,
    });
    expect(clockView(null, 0)).toEqual({ status: 'off' });
  });

  it('warns when a player the medical staff marked unavailable goes on the field', () => {
    const entries = [entry('b', { availability: { status: 'unavailable', staffNotes: [] } })];
    const onField = startClock(toggleOnField(EMPTY_CLOCK, 'b', 0), 0);
    const draft = { rows: {}, clock: onField };
    expect(sheetPlayers(entries, new Map(), draft, new Map(), 0)[0]?.playsWhileUnavailable).toBe(
      true,
    );
    // After the clock ends the sheet has them playing: still warned.
    const played = {
      rows: {
        b: { status: 'full', minutes: '30', contacts: '', touched: ['status', 'minutes'] } as const,
      },
      clock: null,
    };
    expect(sheetPlayers(entries, new Map(), played, new Map(), 0)[0]?.playsWhileUnavailable).toBe(
      true,
    );
  });

  it('marks invalid rows only for the players the coach loads', () => {
    const entries = [entry('a'), entry('b', { canRecord: false })];
    const bad = {
      status: 'full',
      minutes: '700',
      contacts: '',
      touched: ['status', 'minutes'],
    } as const;
    const rows = effectiveRows(entries, new Map(), { rows: { a: bad, b: bad }, clock: null });
    expect([...rowErrors(rows, editablePlayers(entries))]).toEqual([['a', ['minutes']]]);
  });
});
