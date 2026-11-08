import { describe, expect, it } from 'vitest';
import { DEFAULT_CLUB_MODULES } from '../club-modules.js';
import type { LocalDate } from '../time.js';
import {
  MENSTRUAL_CYCLE_VIEWER_ROLES,
  MENSTRUAL_FLOWS,
  MENSTRUAL_LOG_WINDOW_DAYS,
  MENSTRUAL_NOTE_MAX_LENGTH,
  consentTypeSignable,
  consentTypesAskedFor,
  consentTypesVisibleTo,
  isPeriodFlow,
  isWithinMenstrualLogWindow,
  latestMenstrualEntryPerDay,
  menstrualCycleDayIssues,
  menstrualCycleUnavailableReason,
  menstrualSummaryReadFrom,
  normalizeMenstrualSymptoms,
  seesMenstrualCycleConsent,
  summarizeMenstrualCycle,
  type MenstrualFlow,
} from './index.js';

const d = (value: string) => value as LocalDate;
const ON = { ...DEFAULT_CLUB_MODULES, menstrual_cycle: true };

describe('vocabulary', () => {
  it('keeps the stored values (the database enums are built from them)', () => {
    expect(MENSTRUAL_FLOWS).toEqual(['none', 'spotting', 'light', 'moderate', 'heavy']);
    expect(MENSTRUAL_CYCLE_VIEWER_ROLES).toEqual(['medical', 'sc']);
  });

  it('spotting and no bleeding are not days of the period', () => {
    expect(MENSTRUAL_FLOWS.filter(isPeriodFlow)).toEqual(['light', 'moderate', 'heavy']);
  });
});

describe('menstrualCycleDayIssues', () => {
  it('accepts a day with symptoms and a note', () => {
    expect(
      menstrualCycleDayIssues({ flow: 'light', symptoms: ['cramps', 'fatigue'], note: 'ok' }),
    ).toEqual([]);
    expect(menstrualCycleDayIssues({ flow: 'none', symptoms: [] })).toEqual([]);
  });

  it('rejects repeated symptoms, blank and long notes', () => {
    expect(
      menstrualCycleDayIssues({
        flow: 'heavy',
        symptoms: ['cramps', 'cramps'],
        note: ' ',
      }),
    ).toEqual([
      { path: ['symptoms', 1], problem: 'duplicate_symptom' },
      { path: ['note'], problem: 'note_blank' },
    ]);
    expect(
      menstrualCycleDayIssues({
        flow: 'none',
        symptoms: [],
        note: '🩸'.repeat(MENSTRUAL_NOTE_MAX_LENGTH),
      }),
    ).toEqual([]);
    expect(
      menstrualCycleDayIssues({
        flow: 'none',
        symptoms: [],
        note: 'a'.repeat(MENSTRUAL_NOTE_MAX_LENGTH + 1),
      }),
    ).toEqual([{ path: ['note'], problem: 'note_too_long' }]);
  });

  it('normalizes symptoms to the vocabulary order', () => {
    expect(normalizeMenstrualSymptoms(['fatigue', 'cramps', 'fatigue'])).toEqual([
      'cramps',
      'fatigue',
    ]);
  });
});

describe('isWithinMenstrualLogWindow', () => {
  it('takes today or yesterday (club days), never earlier or the future', () => {
    const today = d('2026-11-04');
    expect(MENSTRUAL_LOG_WINDOW_DAYS).toBe(2);
    expect(isWithinMenstrualLogWindow(today, today)).toBe(true);
    expect(isWithinMenstrualLogWindow(d('2026-11-03'), today)).toBe(true);
    expect(isWithinMenstrualLogWindow(d('2026-11-02'), today)).toBe(false);
    expect(isWithinMenstrualLogWindow(d('2026-03-01'), d('2026-03-02'))).toBe(true);
    expect(isWithinMenstrualLogWindow(d('2026-11-05'), today)).toBe(false);
  });
});

describe('latestMenstrualEntryPerDay', () => {
  it('keeps the last entry of each day, by date', () => {
    const entries = [
      { localDate: d('2026-11-02'), flow: 'light' as const, loggedAt: new Date(3) },
      { localDate: d('2026-11-01'), flow: 'heavy' as const, loggedAt: new Date(1) },
      { localDate: d('2026-11-01'), flow: 'moderate' as const, loggedAt: new Date(2) },
    ];
    expect(latestMenstrualEntryPerDay(entries).map((e) => [e.localDate, e.flow])).toEqual([
      ['2026-11-01', 'moderate'],
      ['2026-11-02', 'light'],
    ]);
  });
});

describe('summarizeMenstrualCycle', () => {
  const day = (localDate: string, flow: MenstrualFlow) => ({ localDate: d(localDate), flow });
  const range = (from: string, to: string) => ({ from: d(from), to: d(to) });

  it('is empty without a period', () => {
    expect(
      summarizeMenstrualCycle([day('2026-11-01', 'spotting')], range('2026-08-07', '2026-11-04')),
    ).toEqual({
      periodStarts: [],
      lastPeriodStart: null,
      cycleDay: null,
      cycleLengthsDays: [],
      daysLogged: 1,
    });
  });

  it('finds the starts of periods, the cycle lengths and the day of the cycle', () => {
    const days = [
      day('2026-09-10', 'spotting'),
      day('2026-09-11', 'heavy'),
      day('2026-09-12', 'moderate'),
      day('2026-09-13', 'light'),
      day('2026-09-14', 'none'),
      day('2026-10-09', 'moderate'),
      day('2026-10-10', 'heavy'),
      day('2026-11-03', 'light'),
    ];
    expect(summarizeMenstrualCycle(days, range('2026-08-07', '2026-11-04'))).toEqual({
      periodStarts: ['2026-09-11', '2026-10-09', '2026-11-03'],
      lastPeriodStart: '2026-11-03',
      cycleDay: 2,
      cycleLengthsDays: [28, 25],
      daysLogged: 8,
    });
  });

  it('a day not logged inside a period splits it, and spotting does not join it', () => {
    const days = [
      day('2026-11-01', 'heavy'),
      day('2026-11-02', 'spotting'),
      day('2026-11-03', 'light'),
    ];
    expect(summarizeMenstrualCycle(days, range('2026-10-01', '2026-11-03')).periodStarts).toEqual([
      '2026-11-01',
      '2026-11-03',
    ]);
  });

  it('reads the day before the range: a summary of [from, to] looks one day back', () => {
    expect(menstrualSummaryReadFrom(range('2026-09-01', '2026-11-04'))).toBe('2026-08-31');
  });

  it('a period that crosses `from` does not start on `from`', () => {
    // Read from the day before `from`, as the API does: 08-31 is a day of the period.
    const days = [
      day('2026-08-30', 'heavy'),
      day('2026-08-31', 'heavy'),
      day('2026-09-01', 'moderate'),
      day('2026-09-02', 'light'),
      day('2026-09-29', 'heavy'),
      day('2026-10-27', 'light'),
    ];
    expect(summarizeMenstrualCycle(days, range('2026-09-01', '2026-11-04'))).toEqual({
      periodStarts: ['2026-09-29', '2026-10-27'],
      lastPeriodStart: '2026-10-27',
      cycleDay: 9,
      cycleLengthsDays: [28],
      daysLogged: 4,
    });
    // When the crossing period is the latest one, there is no start in the range.
    expect(
      summarizeMenstrualCycle(days.slice(0, 4), range('2026-09-01', '2026-09-10')),
    ).toMatchObject({ periodStarts: [], lastPeriodStart: null, cycleDay: null });
  });

  it('a period on `from` starts there when the day before is not one', () => {
    const days = [day('2026-08-31', 'spotting'), day('2026-09-01', 'heavy')];
    expect(summarizeMenstrualCycle(days, range('2026-09-01', '2026-09-03'))).toMatchObject({
      periodStarts: ['2026-09-01'],
      cycleDay: 3,
      daysLogged: 1,
    });
    // Not logged the day before: as inside the range, a day without a log is not a period day.
    expect(
      summarizeMenstrualCycle(days.slice(1), range('2026-09-01', '2026-09-03')).periodStarts,
    ).toEqual(['2026-09-01']);
  });

  it('counts the cycle day on `to`, not on the club day, for a past range', () => {
    const days = [day('2026-06-03', 'heavy'), day('2026-06-04', 'heavy')];
    expect(summarizeMenstrualCycle(days, range('2026-05-01', '2026-06-10')).cycleDay).toBe(8);
  });

  it('ignores the days outside the range', () => {
    const days = [day('2026-08-20', 'heavy'), day('2026-11-05', 'heavy')];
    expect(summarizeMenstrualCycle(days, range('2026-09-01', '2026-11-04'))).toMatchObject({
      periodStarts: [],
      daysLogged: 0,
    });
  });
});

describe('menstrualCycleUnavailableReason', () => {
  const all = ['data', 'health', 'menstrual_cycle'] as const;

  it('needs the module, a female player and the three consents', () => {
    expect(menstrualCycleUnavailableReason(DEFAULT_CLUB_MODULES, 'female', all)).toBe('module_off');
    expect(menstrualCycleUnavailableReason(ON, 'male', all)).toBe('not_female');
    expect(menstrualCycleUnavailableReason(ON, 'female', ['data', 'health'])).toBe(
      'missing_consent',
    );
    expect(menstrualCycleUnavailableReason(ON, 'female', all)).toBeNull();
  });
});

describe('consentTypesAskedFor', () => {
  it('asks for the cycle consent only where the module is offered, or once signed', () => {
    expect(consentTypesAskedFor(DEFAULT_CLUB_MODULES, 'female', [])).toEqual([
      'data',
      'image',
      'health',
    ]);
    expect(consentTypesAskedFor(ON, 'male', [])).toEqual(['data', 'image', 'health']);
    expect(consentTypesAskedFor(ON, 'female', [])).toContain('menstrual_cycle');
    expect(consentTypesAskedFor(DEFAULT_CLUB_MODULES, 'female', ['menstrual_cycle'])).toContain(
      'menstrual_cycle',
    );
  });

  it('asks for the location consent only with the gps module on, or once signed (B-913)', () => {
    const gps = { ...DEFAULT_CLUB_MODULES, gps: true };
    expect(consentTypesAskedFor(DEFAULT_CLUB_MODULES, 'male', [])).not.toContain('location');
    expect(consentTypesAskedFor(gps, 'male', [])).toEqual(['data', 'image', 'health', 'location']);
    expect(consentTypesAskedFor(gps, 'female', [])).toContain('location');
    expect(consentTypesAskedFor(DEFAULT_CLUB_MODULES, 'male', ['location'])).toContain('location');
    expect(consentTypesAskedFor({ ...ON, gps: true }, 'female', [])).toEqual([
      'data',
      'image',
      'health',
      'menstrual_cycle',
      'location',
    ]);
  });
});

describe('consentTypeSignable', () => {
  it('signs the cycle consent only where the module is offered to her', () => {
    expect(consentTypeSignable(ON, 'female', 'menstrual_cycle')).toBe(true);
    expect(consentTypeSignable(ON, 'male', 'menstrual_cycle')).toBe(false);
    expect(consentTypeSignable(DEFAULT_CLUB_MODULES, 'female', 'menstrual_cycle')).toBe(false);
    expect(consentTypeSignable(DEFAULT_CLUB_MODULES, 'male', 'health')).toBe(true);
  });

  it('signs the location consent only with the gps module on, for both sexes', () => {
    const gps = { ...DEFAULT_CLUB_MODULES, gps: true };
    expect(consentTypeSignable(gps, 'male', 'location')).toBe(true);
    expect(consentTypeSignable(gps, 'female', 'location')).toBe(true);
    expect(consentTypeSignable(DEFAULT_CLUB_MODULES, 'male', 'location')).toBe(false);
  });
});

describe('consentTypesVisibleTo', () => {
  it('shows the cycle consent only to the player and her guardian', () => {
    const all = ['data', 'image', 'health', 'menstrual_cycle'] as const;
    for (const role of ['player', 'parent'] as const) {
      expect(seesMenstrualCycleConsent(role)).toBe(true);
      expect(consentTypesVisibleTo(role, all)).toEqual(all);
    }
    for (const role of ['coach', 'sc', 'medical', 'admin', 'superadmin'] as const) {
      expect(seesMenstrualCycleConsent(role)).toBe(false);
      expect(consentTypesVisibleTo(role, all)).toEqual(['data', 'image', 'health']);
    }
  });
});
