import { describe, expect, it } from 'vitest';
import { DomainValidationError, ROLES, isRole, parseRole } from './index.js';

describe('roles', () => {
  it('lists the roles of CLAUDE.md', () => {
    expect(ROLES).toEqual(['player', 'parent', 'coach', 'sc', 'medical', 'admin', 'superadmin']);
  });

  it('guards and parses members', () => {
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
      expect(parseRole(role)).toBe(role);
    }
    expect(isRole('Admin')).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it('rejects unknown roles with a stable code', () => {
    expect(() => parseRole('owner')).toThrow(DomainValidationError);
    expect(() => parseRole('owner')).toThrow(expect.objectContaining({ code: 'invalid_role' }));
  });
});
