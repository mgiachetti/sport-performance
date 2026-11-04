import { describe, expect, it } from 'vitest';
import { DomainValidationError } from '../errors.js';
import { parseLocalDate } from '../time.js';
import {
  EXTERNAL_LOAD_ACTIVITIES,
  EXTERNAL_LOAD_REPORT_WINDOW_DAYS,
  externalLoadAu,
  externalLoadIssues,
  externalLoadWindowStart,
  isExternalLoadActivity,
  isWithinExternalLoadWindow,
  parseExternalLoadActivity,
} from './index.js';

const day = parseLocalDate;

describe('external load', () => {
  it('names the kinds of activity a player reports', () => {
    expect(EXTERNAL_LOAD_ACTIVITIES).toEqual([
      'physical_education',
      'other_sport',
      'own_training',
      'other',
    ]);
    expect(isExternalLoadActivity('other_sport')).toBe(true);
    expect(isExternalLoadActivity('match')).toBe(false);
    expect(() => parseExternalLoadActivity('gym')).toThrow(DomainValidationError);
  });

  it('is RPE × minutes, like a club session', () => {
    expect(externalLoadAu({ minutes: 60, rpe: 5 })).toBe(300);
    expect(externalLoadAu({ minutes: 40, rpe: 0 })).toBe(0);
    expect(externalLoadAu({ minutes: 600, rpe: 10 })).toBe(6000);
  });

  it('refuses minutes and RPE outside the accepted ranges', () => {
    expect(externalLoadIssues({ minutes: 0, rpe: 5 })).toEqual(['minutes_out_of_range']);
    expect(externalLoadIssues({ minutes: 601, rpe: 5 })).toEqual(['minutes_out_of_range']);
    expect(externalLoadIssues({ minutes: 30.5, rpe: 5 })).toEqual(['minutes_out_of_range']);
    expect(externalLoadIssues({ minutes: 30, rpe: 11 })).toEqual(['rpe_out_of_range']);
    expect(externalLoadIssues({ minutes: 30, rpe: 4.5 })).toEqual(['rpe_out_of_range']);
    expect(externalLoadIssues({ minutes: -1, rpe: -1 })).toEqual([
      'minutes_out_of_range',
      'rpe_out_of_range',
    ]);
    expect(externalLoadAu({ minutes: 0, rpe: 5 })).toBeNull();
  });

  it('is reported from 6 days ago through today, never for a future day', () => {
    const today = day('2026-11-03');
    expect(EXTERNAL_LOAD_REPORT_WINDOW_DAYS).toBe(7);
    expect(externalLoadWindowStart(today)).toBe('2026-10-28');
    expect(isWithinExternalLoadWindow(today, today)).toBe(true);
    expect(isWithinExternalLoadWindow(day('2026-10-28'), today)).toBe(true);
    expect(isWithinExternalLoadWindow(day('2026-10-27'), today)).toBe(false);
    expect(isWithinExternalLoadWindow(day('2026-11-04'), today)).toBe(false);
    // Across a month and a year boundary.
    expect(isWithinExternalLoadWindow(day('2026-12-27'), day('2027-01-02'))).toBe(true);
  });
});
