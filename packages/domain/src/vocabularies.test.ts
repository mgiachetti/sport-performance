import { describe, expect, it } from 'vitest';
import {
  DOMINANT_SIDES,
  DomainValidationError,
  HEIGHT_SOURCES,
  MEMBERSHIP_ROLES,
  PARENTS,
  PLAYER_LEAVE_REASONS,
  TEST_NOT_DONE_REASONS,
  TEST_RESULT_STATUSES,
  isDominantSide,
  isHeightSource,
  isMembershipRole,
  isParent,
  isPlayerLeaveReason,
  isTestNotDoneReason,
  isTestResultStatus,
  parseDominantSide,
  parseHeightSource,
  parseMembershipRole,
  parseParent,
  parsePlayerLeaveReason,
  parseTestNotDoneReason,
  parseTestResultStatus,
} from './index.js';

const cases = [
  {
    name: 'membership role',
    values: MEMBERSHIP_ROLES,
    is: isMembershipRole,
    parse: parseMembershipRole,
  },
  {
    name: 'test result status',
    values: TEST_RESULT_STATUSES,
    is: isTestResultStatus,
    parse: parseTestResultStatus,
  },
  {
    name: 'test not-done reason',
    values: TEST_NOT_DONE_REASONS,
    is: isTestNotDoneReason,
    parse: parseTestNotDoneReason,
  },
  { name: 'dominant side', values: DOMINANT_SIDES, is: isDominantSide, parse: parseDominantSide },
  { name: 'height source', values: HEIGHT_SOURCES, is: isHeightSource, parse: parseHeightSource },
  { name: 'parent', values: PARENTS, is: isParent, parse: parseParent },
  {
    name: 'player leave reason',
    values: PLAYER_LEAVE_REASONS,
    is: isPlayerLeaveReason,
    parse: parsePlayerLeaveReason,
  },
] as const;

describe.each(cases)('$name', ({ values, is, parse }) => {
  it('accepts every member', () => {
    for (const value of values) {
      expect(is(value)).toBe(true);
      expect(parse(value)).toBe(value);
    }
  });

  it('rejects non-members', () => {
    for (const value of ['', 'unknown', 42, null, undefined]) {
      expect(is(value)).toBe(false);
      expect(() => parse(value)).toThrow(DomainValidationError);
    }
  });
});

describe('membership roles', () => {
  it('are the club roles of CLAUDE.md, without superadmin (a global attribute, ADR 0007)', () => {
    expect(MEMBERSHIP_ROLES).toEqual(['player', 'parent', 'coach', 'sc', 'medical', 'admin']);
    expect(MEMBERSHIP_ROLES).not.toContain('superadmin');
  });
});
