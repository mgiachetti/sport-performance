import { describe, expect, it } from 'vitest';
import {
  DATA_SUBJECT_REQUEST_KINDS,
  DATA_SUBJECT_REQUEST_STATUSES,
  DELETED_ACCOUNT_DOMAIN,
  addBusinessDays,
  deletedAccountAddress,
  erasureDueOn,
  isDataSubjectRequestKind,
  isDataSubjectRequestStatus,
  isUndeliverableEmail,
  parseDataSubjectRequestKind,
  parseDataSubjectRequestStatus,
  type LocalDate,
  type UserId,
} from './index.js';

const day = (value: string) => value as LocalDate;

describe('vocabularies of the data subject requests', () => {
  it('accepts the closed values and rejects anything else', () => {
    for (const kind of DATA_SUBJECT_REQUEST_KINDS) {
      expect(isDataSubjectRequestKind(kind)).toBe(true);
      expect(parseDataSubjectRequestKind(kind)).toBe(kind);
    }
    for (const status of DATA_SUBJECT_REQUEST_STATUSES) {
      expect(isDataSubjectRequestStatus(status)).toBe(true);
      expect(parseDataSubjectRequestStatus(status)).toBe(status);
    }
    expect(isDataSubjectRequestKind('rectification')).toBe(false);
    expect(() => parseDataSubjectRequestStatus('done')).toThrow();
  });
});

describe('addBusinessDays', () => {
  it('skips Saturdays and Sundays', () => {
    // 2026-11-02 is a Monday.
    expect(addBusinessDays(day('2026-11-02'), 0)).toBe('2026-11-02');
    expect(addBusinessDays(day('2026-11-02'), 1)).toBe('2026-11-03');
    expect(addBusinessDays(day('2026-11-02'), 4)).toBe('2026-11-06');
    expect(addBusinessDays(day('2026-11-02'), 5)).toBe('2026-11-09');
    // From a Friday, the next business day is Monday.
    expect(addBusinessDays(day('2026-11-06'), 1)).toBe('2026-11-09');
    // From a Saturday or a Sunday too.
    expect(addBusinessDays(day('2026-11-07'), 1)).toBe('2026-11-09');
    expect(addBusinessDays(day('2026-11-08'), 1)).toBe('2026-11-09');
  });

  it('crosses months and years', () => {
    expect(addBusinessDays(day('2026-12-30'), 3)).toBe('2027-01-04');
  });

  it('rejects negative or fractional counts', () => {
    expect(() => addBusinessDays(day('2026-11-02'), -1)).toThrow(RangeError);
    expect(() => addBusinessDays(day('2026-11-02'), 1.5)).toThrow(RangeError);
  });
});

describe('erasureDueOn', () => {
  it('is five business days after the request (Ley 25.326, art. 16)', () => {
    expect(erasureDueOn(day('2026-11-02'))).toBe('2026-11-09');
    expect(erasureDueOn(day('2026-11-05'))).toBe('2026-11-12');
  });
});

describe('deleted accounts', () => {
  it('get a reserved address that never receives email', () => {
    const address = deletedAccountAddress('5d3f7a2e-0000-4000-8000-000000000001' as UserId);
    expect(address).toBe(`deleted.5d3f7a2e-0000-4000-8000-000000000001@${DELETED_ACCOUNT_DOMAIN}`);
    expect(isUndeliverableEmail(address)).toBe(true);
  });
});
