import { describe, expect, it } from 'vitest';
import { DomainValidationError } from '../errors.js';
import { parseLocalDate, parseTimeZone } from '../time.js';
import {
  CONTACT_LEVELS,
  FIELD_METRIC_SOURCES,
  isFieldMetricSource,
  PARTICIPATION_STATUSES,
  isParticipationStatus,
  parseContactLevel,
  participationCarriesLoad,
  rpeSubmissionWindow,
  rpeWindowState,
} from './index.js';

const BUENOS_AIRES = parseTimeZone('America/Argentina/Buenos_Aires');

describe('training vocabularies', () => {
  it('lists the statuses and contact levels', () => {
    expect(PARTICIPATION_STATUSES).toEqual(['full', 'partial', 'absent', 'unavailable']);
    expect(CONTACT_LEVELS).toEqual(['none', 'controlled', 'full']);
    expect(isParticipationStatus('injured')).toBe(false);
    expect(() => parseContactLevel('heavy')).toThrow(DomainValidationError);
  });

  it('names where a field metric comes from', () => {
    expect(FIELD_METRIC_SOURCES).toEqual(['catapult', 'pod', 'hr_band', 'manual']);
    expect(isFieldMetricSource('pod')).toBe(true);
    expect(isFieldMetricSource('gps')).toBe(false);
  });

  it('only full and partial carry load', () => {
    expect(PARTICIPATION_STATUSES.filter(participationCarriesLoad)).toEqual(['full', 'partial']);
  });
});

describe('rpeSubmissionWindow', () => {
  // 19:00 in Buenos Aires (UTC−3) on 2026-11-02.
  const session = {
    startsAt: new Date('2026-11-02T22:00:00Z'),
    localDate: parseLocalDate('2026-11-02'),
  };

  it('opens at the start and closes at the end of the next club day', () => {
    const window = rpeSubmissionWindow(session, BUENOS_AIRES);
    expect(window.opensAt.toISOString()).toBe('2026-11-02T22:00:00.000Z');
    // Midnight of 2026-11-04 in Buenos Aires.
    expect(window.closesAt.toISOString()).toBe('2026-11-04T03:00:00.000Z');
  });

  it('uses the club day, not the UTC day', () => {
    // 23:30 in Buenos Aires is already the next day in UTC.
    const late = {
      startsAt: new Date('2026-11-03T02:30:00Z'),
      localDate: parseLocalDate('2026-11-02'),
    };
    expect(rpeSubmissionWindow(late, BUENOS_AIRES).closesAt.toISOString()).toBe(
      '2026-11-04T03:00:00.000Z',
    );
  });

  it('can close the same club day or stay open longer', () => {
    expect(
      rpeSubmissionWindow(session, BUENOS_AIRES, { closeAfterClubDays: 0 }).closesAt.toISOString(),
    ).toBe('2026-11-03T03:00:00.000Z');
    expect(
      rpeSubmissionWindow(session, BUENOS_AIRES, { closeAfterClubDays: 3 }).closesAt.toISOString(),
    ).toBe('2026-11-06T03:00:00.000Z');
    for (const closeAfterClubDays of [-1, 1.5, 8, Number.NaN]) {
      expect(() => rpeSubmissionWindow(session, BUENOS_AIRES, { closeAfterClubDays })).toThrow(
        DomainValidationError,
      );
    }
  });

  it('tells whether an instant is before, inside or after the window', () => {
    const window = rpeSubmissionWindow(session, BUENOS_AIRES);
    expect(rpeWindowState(window, new Date('2026-11-02T21:59:59Z'))).toBe('not_open');
    expect(rpeWindowState(window, window.opensAt)).toBe('open');
    expect(rpeWindowState(window, new Date('2026-11-04T02:59:59Z'))).toBe('open');
    expect(rpeWindowState(window, window.closesAt)).toBe('closed');
  });
});
