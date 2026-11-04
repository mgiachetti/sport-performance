import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MENARCHE_REFERENCE,
  DomainValidationError,
  MENARCHE_REFERENCE_PROVENANCE,
  ageAtMenarcheYears,
  checkOffsetAgainstMenarche,
  isTruncatedMenarcheDate,
  menarcheApplies,
  menarchePeriod,
  menarcheReportIssues,
  parseLocalDate,
  parseMenarcheReference,
  truncateMenarcheDate,
  type MenarcheReportFacts,
} from '../index.js';

const d = parseLocalDate;
const BIRTH = d('2012-01-01');

// Days from 2012-01-01 (leap days 2012-02-29, 2016, 2020 and 2024 counted by hand).
const DAYS_TO_2024_01_01 = 12 * 365 + 3;
const DAYS_TO_2024_03_01 = DAYS_TO_2024_01_01 + 31 + 29;

const occurred = (
  occurredOn: string,
  precision: 'day' | 'month' | 'year',
  reportedOn = '2025-06-01',
): MenarcheReportFacts => ({
  status: 'occurred',
  occurredOn: d(occurredOn),
  precision,
  reportedOn: d(reportedOn),
});
const notYet = (reportedOn: string): MenarcheReportFacts => ({
  status: 'not_yet',
  occurredOn: null,
  precision: null,
  reportedOn: d(reportedOn),
});

describe('menarche dates', () => {
  it('only girls have the record', () => {
    expect(menarcheApplies('female')).toBe(true);
    expect(menarcheApplies('male')).toBe(false);
  });

  it('truncates a date to its precision and knows a stored one', () => {
    expect(truncateMenarcheDate(d('2025-03-17'), 'day')).toBe('2025-03-17');
    expect(truncateMenarcheDate(d('2025-03-17'), 'month')).toBe('2025-03-01');
    expect(truncateMenarcheDate(d('2025-03-17'), 'year')).toBe('2025-01-01');
    expect(isTruncatedMenarcheDate(d('2025-03-01'), 'month')).toBe(true);
    expect(isTruncatedMenarcheDate(d('2025-03-02'), 'month')).toBe(false);
    expect(isTruncatedMenarcheDate(d('2025-03-01'), 'year')).toBe(false);
  });

  it('a period spans the whole month or year', () => {
    expect(menarchePeriod(d('2024-02-10'), 'month')).toEqual({
      start: '2024-02-01',
      end: '2024-02-29',
    });
    expect(menarchePeriod(d('2023-12-01'), 'month')).toEqual({
      start: '2023-12-01',
      end: '2023-12-31',
    });
    expect(menarchePeriod(d('2024-07-01'), 'year')).toEqual({
      start: '2024-01-01',
      end: '2024-12-31',
    });
    expect(menarchePeriod(d('2024-07-09'), 'day')).toEqual({
      start: '2024-07-09',
      end: '2024-07-09',
    });
  });

  it('age at menarche: the exact day, or the middle of the period with half of it as uncertainty', () => {
    const exact = ageAtMenarcheYears(BIRTH, d('2024-03-01'), 'day');
    expect(exact.ageYears).toBeCloseTo(DAYS_TO_2024_03_01 / 365.25, 12);
    expect(exact.uncertaintyYears).toBe(0);

    const year = ageAtMenarcheYears(BIRTH, d('2024-01-01'), 'year');
    const endOfYear = DAYS_TO_2024_01_01 + 365; // 2024-12-31
    expect(year.ageYears).toBeCloseTo((DAYS_TO_2024_01_01 + endOfYear) / 2 / 365.25, 12);
    expect(year.uncertaintyYears).toBeCloseTo(365 / 2 / 365.25, 12);

    const month = ageAtMenarcheYears(BIRTH, d('2024-03-01'), 'month');
    expect(month.ageYears).toBeCloseTo((DAYS_TO_2024_03_01 + 15) / 365.25, 12);
    expect(month.uncertaintyYears).toBeCloseTo(15 / 365.25, 12);
  });
});

describe('menarcheReportIssues', () => {
  it('accepts a plausible menarche and a "not yet"', () => {
    expect(menarcheReportIssues(occurred('2024-03-01', 'month'), BIRTH)).toEqual([]);
    expect(menarcheReportIssues(occurred('2025-06-01', 'day'), BIRTH)).toEqual([]);
    expect(menarcheReportIssues(notYet('2025-06-01'), BIRTH)).toEqual([]);
  });

  it('a date goes with menarche only, and menarche needs date and precision', () => {
    expect(
      menarcheReportIssues(
        {
          status: 'not_yet',
          occurredOn: d('2024-03-01'),
          precision: 'month',
          reportedOn: d('2025-06-01'),
        },
        BIRTH,
      ),
    ).toEqual([
      { path: ['occurredOn'], problem: 'date_without_menarche' },
      { path: ['precision'], problem: 'date_without_menarche' },
    ]);
    expect(
      menarcheReportIssues(
        { status: 'occurred', occurredOn: null, precision: null, reportedOn: d('2025-06-01') },
        BIRTH,
      ),
    ).toEqual([
      { path: ['occurredOn'], problem: 'date_required' },
      { path: ['precision'], problem: 'precision_required' },
    ]);
  });

  it('refuses a date after the report or before the birth', () => {
    expect(menarcheReportIssues(occurred('2025-06-02', 'day'), BIRTH)).toEqual([
      { path: ['occurredOn'], problem: 'date_after_report' },
    ]);
    // A month or year that starts by the report day is fine (it is the current one).
    expect(menarcheReportIssues(occurred('2025-01-01', 'year'), BIRTH)).toEqual([]);
    expect(menarcheReportIssues(occurred('2011-01-01', 'year'), BIRTH)).toEqual([
      { path: ['occurredOn'], problem: 'date_before_birth' },
    ]);
  });

  it('refuses ages outside the plausible range of the reference (a typo)', () => {
    expect(menarcheReportIssues(occurred('2018-05-01', 'month'), BIRTH)).toEqual([
      { path: ['occurredOn'], problem: 'age_implausible' },
    ]);
    const birth2004 = d('2004-01-01');
    expect(menarcheReportIssues(occurred('2023-02-01', 'month', '2024-01-01'), birth2004)).toEqual([
      { path: ['occurredOn'], problem: 'age_implausible' },
    ]);
    expect(menarcheReportIssues(notYet('2023-06-01'), birth2004)).toEqual([
      { path: ['status'], problem: 'not_yet_implausible' },
    ]);
    // The club's reference decides.
    const wide = { ...DEFAULT_MENARCHE_REFERENCE, plausibleAgeMinYears: 6 };
    expect(menarcheReportIssues(occurred('2018-05-01', 'month'), BIRTH, wide)).toEqual([]);
  });
});

describe('checkOffsetAgainstMenarche', () => {
  // Menarche on 2024-03-01, measured a year later: y = 365 / 365.25 years since menarche.
  const y = 365 / 365.25;
  const base = {
    birthDate: BIRTH,
    report: occurred('2024-03-01', 'day'),
    measuredOn: d('2025-03-01'),
  };

  it('a girl past menarche: offset ≈ years since menarche + mean interval, bounded by min and max', () => {
    const check = checkOffsetAgainstMenarche({ ...base, phvOffsetYears: 2 });
    expect(check.ageAtMenarcheYears).toBeCloseTo(DAYS_TO_2024_03_01 / 365.25, 12);
    expect(check.impliedPhvOffsetYears).toBeCloseTo(y + 1.3, 12);
    expect(check.impliedMinPhvOffsetYears).toBeCloseTo(y, 12);
    expect(check.impliedMaxPhvOffsetYears).toBeCloseTo(y + 3, 12);
    expect(check.verdict).toBe('consistent');
  });

  it('flags an offset clearly below (early maturer) or above (late maturer) the bounds, past the margin', () => {
    // Within the margin of 0.5 years below the minimum: still consistent.
    expect(checkOffsetAgainstMenarche({ ...base, phvOffsetYears: y - 0.49 }).verdict).toBe(
      'consistent',
    );
    expect(checkOffsetAgainstMenarche({ ...base, phvOffsetYears: y - 0.51 }).verdict).toBe(
      'offset_below_reference',
    );
    expect(checkOffsetAgainstMenarche({ ...base, phvOffsetYears: y + 3.49 }).verdict).toBe(
      'consistent',
    );
    expect(checkOffsetAgainstMenarche({ ...base, phvOffsetYears: y + 3.51 }).verdict).toBe(
      'offset_above_reference',
    );
  });

  it('a measurement before the menarche gives negative years since menarche', () => {
    const check = checkOffsetAgainstMenarche({
      ...base,
      measuredOn: d('2023-03-01'),
      phvOffsetYears: 0,
    });
    const before = -366 / 365.25; // 2023-03-01 → 2024-03-01 crosses 2024-02-29
    expect(check.impliedPhvOffsetYears).toBeCloseTo(before + 1.3, 12);
    expect(check.impliedMinPhvOffsetYears).toBeCloseTo(before, 12);
    expect(check.verdict).toBe('consistent');
  });

  it('the precision of the date widens the bounds', () => {
    const byYear = checkOffsetAgainstMenarche({
      ...base,
      report: occurred('2024-01-01', 'year'),
      phvOffsetYears: 1,
    });
    const middle = (DAYS_TO_2024_01_01 + DAYS_TO_2024_01_01 + 365) / 2 / 365.25;
    const yAtMeasurement = (DAYS_TO_2024_03_01 + 365) / 365.25 - middle;
    const half = 365 / 2 / 365.25;
    expect(byYear.impliedMinPhvOffsetYears).toBeCloseTo(yAtMeasurement - half, 12);
    expect(byYear.impliedMaxPhvOffsetYears).toBeCloseTo(yAtMeasurement + 3 + half, 12);
  });

  it('without menarche there is only an upper bound, moving with the time since the report', () => {
    const sameDay = checkOffsetAgainstMenarche({
      birthDate: BIRTH,
      report: notYet('2025-03-01'),
      measuredOn: d('2025-03-01'),
      phvOffsetYears: -3,
    });
    expect(sameDay).toEqual({
      ageAtMenarcheYears: null,
      impliedPhvOffsetYears: null,
      impliedMinPhvOffsetYears: null,
      impliedMaxPhvOffsetYears: 3,
      verdict: 'consistent',
    });
    expect(
      checkOffsetAgainstMenarche({
        birthDate: BIRTH,
        report: notYet('2025-03-01'),
        measuredOn: d('2025-03-01'),
        phvOffsetYears: 3.6,
      }).verdict,
    ).toBe('offset_above_reference');
    // Measured a year before the "not yet": the bound is a year lower.
    const earlier = checkOffsetAgainstMenarche({
      birthDate: BIRTH,
      report: notYet('2025-03-01'),
      measuredOn: d('2024-03-01'),
      phvOffsetYears: 2.6,
    });
    expect(earlier.impliedMaxPhvOffsetYears).toBeCloseTo(3 - 365 / 365.25, 12);
    expect(earlier.verdict).toBe('offset_above_reference');
  });

  it('refuses a non-finite offset or an occurred menarche without a date', () => {
    expect(() => checkOffsetAgainstMenarche({ ...base, phvOffsetYears: Number.NaN })).toThrow(
      DomainValidationError,
    );
    expect(() =>
      checkOffsetAgainstMenarche({
        ...base,
        report: { ...base.report, occurredOn: null },
        phvOffsetYears: 1,
      }),
    ).toThrow(DomainValidationError);
  });
});

describe('menarche reference', () => {
  it('the defaults are data with their source, pending verification', () => {
    expect(parseMenarcheReference(DEFAULT_MENARCHE_REFERENCE)).toEqual(DEFAULT_MENARCHE_REFERENCE);
    expect(MENARCHE_REFERENCE_PROVENANCE.verification).toBe('unverified');
    expect(MENARCHE_REFERENCE_PROVENANCE.citation).toContain('Marshall WA, Tanner JM');
    expect(MENARCHE_REFERENCE_PROVENANCE.verificationNotes).toContain('Pending');
  });

  it.each([
    { phvToMenarcheMeanYears: Number.NaN },
    { phvToMenarcheMinYears: 2 },
    { phvToMenarcheMaxYears: 1 },
    { phvToMenarcheMaxYears: 7 },
    { marginYears: -0.1 },
    { plausibleAgeMinYears: 4 },
    { plausibleAgeMaxYears: 8 },
  ])('rejects %o', (change) => {
    expect(() => parseMenarcheReference({ ...DEFAULT_MENARCHE_REFERENCE, ...change })).toThrow(
      DomainValidationError,
    );
  });
});
