import { describe, expect, it } from 'vitest';
import { currentAssignments, isCurrentOn } from './permissions/index.js';
import {
  endedValidTo,
  isEmptyValidity,
  isStaffAssignmentRole,
  staffAssignmentStatus,
  validitiesOverlap,
  type AssignmentValidity,
} from './staff-assignment.js';
import { parseLocalDate, type LocalDate } from './time.js';

const d = (value: string): LocalDate => parseLocalDate(value);
const range = (from: string, to: string | null): AssignmentValidity => ({
  validFrom: d(from),
  validTo: to === null ? null : d(to),
});

describe('staff assignment roles', () => {
  it('are the scoped staff roles', () => {
    expect(['coach', 'sc', 'medical'].every(isStaffAssignmentRole)).toBe(true);
    expect(['admin', 'player', 'parent', 'superadmin'].some(isStaffAssignmentRole)).toBe(false);
  });
});

describe('staffAssignmentStatus', () => {
  const today = d('2026-11-02');

  it('tells upcoming, current and ended apart with an exclusive end', () => {
    expect(staffAssignmentStatus(range('2026-11-03', null), today)).toBe('upcoming');
    expect(staffAssignmentStatus(range('2026-11-02', null), today)).toBe('current');
    expect(staffAssignmentStatus(range('2026-01-01', '2026-11-03'), today)).toBe('current');
    expect(staffAssignmentStatus(range('2026-01-01', '2026-11-02'), today)).toBe('ended');
    expect(staffAssignmentStatus(range('2026-12-01', '2026-12-01'), today)).toBe('ended');
  });

  it('agrees with the validity the permission subject uses', () => {
    for (const window of [
      range('2026-11-03', null),
      range('2026-11-02', null),
      range('2026-01-01', '2026-11-02'),
      range('2026-11-02', '2026-11-02'),
      range('2026-11-02', '2026-11-03'),
    ]) {
      const current = staffAssignmentStatus(window, today) === 'current';
      expect(isCurrentOn(window, today)).toBe(current);
      const rows = [{ ...window, sport: 'rugby' as const }];
      expect(currentAssignments(rows, today).length === 1).toBe(current);
    }
  });
});

describe('endedValidTo', () => {
  const today = d('2026-11-02');

  it('ends a current assignment today, so it stops counting today', () => {
    expect(endedValidTo(range('2026-03-01', null), today)).toBe('2026-11-02');
    expect(endedValidTo(range('2026-03-01', '2027-01-01'), today)).toBe('2026-11-02');
    expect(endedValidTo(range('2026-11-02', null), today)).toBe('2026-11-02');
  });

  it('cancels an upcoming one with an empty range', () => {
    const ended = endedValidTo(range('2026-12-01', null), today);
    expect(ended).toBe('2026-12-01');
    expect(isEmptyValidity({ validFrom: d('2026-12-01'), validTo: ended })).toBe(true);
  });

  it('leaves an assignment that is already over as it is', () => {
    expect(endedValidTo(range('2026-01-01', '2026-06-01'), today)).toBeNull();
    expect(endedValidTo(range('2026-01-01', '2026-11-02'), today)).toBeNull();
    expect(endedValidTo(range('2026-12-01', '2026-12-01'), today)).toBeNull();
  });
});

describe('validitiesOverlap', () => {
  it('compares half-open ranges', () => {
    expect(validitiesOverlap(range('2026-01-01', '2026-06-01'), range('2026-06-01', null))).toBe(
      false,
    );
    expect(validitiesOverlap(range('2026-01-01', '2026-06-02'), range('2026-06-01', null))).toBe(
      true,
    );
    expect(validitiesOverlap(range('2026-01-01', null), range('2027-01-01', null))).toBe(true);
    expect(validitiesOverlap(range('2027-01-01', null), range('2026-01-01', '2026-02-01'))).toBe(
      false,
    );
  });

  it('never overlaps an empty (cancelled) range', () => {
    expect(validitiesOverlap(range('2026-03-01', '2026-03-01'), range('2026-01-01', null))).toBe(
      false,
    );
  });
});
