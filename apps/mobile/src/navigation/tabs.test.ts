import { DEFAULT_CLUB_MODULES, MEMBERSHIP_ROLES } from '@sport-performance/domain';
import { describe, expect, it } from 'vitest';
import { tabVisibility } from './tabs.ts';

const GYM_OFF = { ...DEFAULT_CLUB_MODULES, gym: false };

describe('tabVisibility', () => {
  it('shows the gym to the player while the module is on, never to the staff', () => {
    for (const role of [...MEMBERSHIP_ROLES, null]) {
      expect(tabVisibility(role, DEFAULT_CLUB_MODULES).gym, String(role)).toBe(role === 'player');
    }
  });

  it('hides the gym from every role when the club turns the module off', () => {
    for (const role of [...MEMBERSHIP_ROLES, null]) {
      expect(tabVisibility(role, GYM_OFF).gym, String(role)).toBe(false);
    }
  });

  it('leaves the other tabs as the role says, whatever the gym', () => {
    for (const role of [...MEMBERSHIP_ROLES, null]) {
      const on = tabVisibility(role, DEFAULT_CLUB_MODULES);
      expect(tabVisibility(role, GYM_OFF), String(role)).toEqual({ ...on, gym: false });
    }
    expect(tabVisibility('player', GYM_OFF)).toEqual({
      tests: true,
      gym: false,
      testDays: false,
      sessions: false,
      staff: false,
    });
    expect(tabVisibility(null, DEFAULT_CLUB_MODULES)).toEqual({
      tests: false,
      gym: false,
      testDays: false,
      sessions: false,
      staff: false,
    });
  });
});
