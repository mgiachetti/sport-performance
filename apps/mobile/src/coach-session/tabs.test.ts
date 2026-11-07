import { describe, expect, it } from 'vitest';
import { firstTabWithError, sheetTabCounts, sheetTabs, tabOfError } from './tabs.ts';
import type { SheetPlayer } from './view.ts';

function player(overrides: Partial<SheetPlayer> = {}): SheetPlayer {
  return {
    id: 'a',
    name: 'Pérez, Juan',
    calledUp: false,
    availability: null,
    readOnly: null,
    row: { status: 'full', minutes: '60', contacts: '2' },
    errors: [],
    edited: false,
    unsent: false,
    rpe: null,
    srpeAu: null,
    field: null,
    playsWhileUnavailable: false,
    ...overrides,
  };
}

describe('sheet tabs', () => {
  it('has a contacts tab only in a sport with contacts', () => {
    expect(sheetTabs({ contacts: true })).toEqual(['attendance', 'minutes', 'contacts']);
    expect(sheetTabs({ contacts: false })).toEqual(['attendance', 'minutes']);
  });

  it('fixes each error in its tab', () => {
    expect(tabOfError('minutes')).toBe('minutes');
    expect(tabOfError('contacts')).toBe('contacts');
  });

  it('counts the loadable players without a status and the errors by tab', () => {
    const counts = sheetTabCounts([
      player({ id: 'a', row: { status: '', minutes: '', contacts: '' } }),
      // Read-only: the coach cannot give them a status, so it is not pending for them.
      player({ id: 'b', readOnly: 'noConsent', row: { status: '', minutes: '', contacts: '' } }),
      player({ id: 'c', errors: ['minutes', 'contacts'] }),
      player({ id: 'd', errors: ['contacts'] }),
    ]);
    expect(counts).toEqual({ noStatus: 1, errors: { attendance: 0, minutes: 1, contacts: 2 } });
  });

  it('finds the first tab with an error in the order shown', () => {
    const tabs = sheetTabs({ contacts: true });
    expect(firstTabWithError([player()], tabs)).toBeNull();
    expect(firstTabWithError([player({ errors: ['contacts'] })], tabs)).toBe('contacts');
    expect(
      firstTabWithError(
        [player({ id: 'a', errors: ['contacts'] }), player({ id: 'b', errors: ['minutes'] })],
        tabs,
      ),
    ).toBe('minutes');
  });
});
