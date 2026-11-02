import { describe, expect, it } from 'vitest';
import {
  changeMemberRole,
  createStaffAssignment,
  endMember,
  endpointErrorCodes,
  listMembers,
  listMyStaffAssignments,
  listStaffAssignments,
  staffAssignmentSchema,
  updateStaffAssignment,
} from '../index.js';

const membershipId = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f';
const categoryId = '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10';

describe('staff assignment endpoints', () => {
  it('takes one target: a category or a sport', () => {
    expect(
      createStaffAssignment.body.parse({
        membershipId,
        target: { kind: 'category', categoryId: categoryId.toUpperCase() },
      }),
    ).toEqual({ membershipId, target: { kind: 'category', categoryId } });
    expect(
      createStaffAssignment.body.safeParse({
        membershipId,
        target: { kind: 'sport', sport: 'hockey' },
        validFrom: '2026-03-01',
        validTo: null,
      }).success,
    ).toBe(true);
    for (const target of [
      { kind: 'category' },
      { kind: 'sport', sport: 'football' },
      { kind: 'category', categoryId, sport: 'rugby' },
      { categoryId },
    ]) {
      expect(
        createStaffAssignment.body.safeParse({ membershipId, target }).success,
        JSON.stringify(target),
      ).toBe(false);
    }
  });

  it('needs an exclusive end after the start', () => {
    const base = { membershipId, target: { kind: 'sport', sport: 'rugby' } };
    for (const validTo of ['2026-03-01', '2026-02-28']) {
      const result = createStaffAssignment.body.safeParse({
        ...base,
        validFrom: '2026-03-01',
        validTo,
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['validTo']);
    }
    expect(
      updateStaffAssignment.body.safeParse({ version: '1', validFrom: '2026-03-01' }).success,
    ).toBe(true);
    expect(updateStaffAssignment.body.safeParse({ validTo: null }).success).toBe(false);
    expect(endpointErrorCodes(updateStaffAssignment)).toContain('conflict');
  });

  it('filters lists by status on the club day, active by default', () => {
    expect(listStaffAssignments.query.parse({})).toMatchObject({
      status: 'active',
      sort: 'validFrom',
      limit: 50,
    });
    expect(listMyStaffAssignments.query.safeParse({ status: 'upcoming' }).success).toBe(true);
    expect(listMyStaffAssignments.query.safeParse({ membershipId }).success).toBe(false);
    expect(listStaffAssignments.query.safeParse({ status: 'archived' }).success).toBe(false);
  });

  it('describes an assignment with its member, target and status', () => {
    const assignment = {
      id: '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e11',
      membershipId,
      member: { userId: 'b5f0c1d2-1111-4c2a-9d3e-2f4a6b8c0d1e', name: 'Ana', role: 'coach' },
      target: { kind: 'category', categoryId },
      validFrom: '2026-03-01',
      validTo: '2026-03-01',
      status: 'ended',
      createdAt: '2026-03-01T12:00:00.000Z',
      updatedAt: '2026-03-01T12:00:00.000Z',
      version: '1793586338688123',
    };
    expect(staffAssignmentSchema.parse(assignment)).toEqual(assignment);
    expect(staffAssignmentSchema.safeParse({ ...assignment, status: 'cancelled' }).success).toBe(
      false,
    );
  });
});

describe('member endpoints', () => {
  it('lists members by role, status and text', () => {
    expect(listMembers.query.parse({ role: 'coach', q: 'ana' })).toMatchObject({
      role: 'coach',
      status: 'active',
      sort: 'name',
    });
    expect(listMembers.query.safeParse({ role: 'superadmin' }).success).toBe(false);
  });

  it('changes a role with the version and ends without a body', () => {
    expect(changeMemberRole.body.safeParse({ role: 'sc' }).success).toBe(false);
    expect(changeMemberRole.body.safeParse({ version: '1', role: 'superadmin' }).success).toBe(
      false,
    );
    expect(changeMemberRole.body.safeParse({ version: '1', role: 'sc' }).success).toBe(true);
    expect(endpointErrorCodes(changeMemberRole)).toContain('conflict');
    expect(endpointErrorCodes(endMember)).toEqual(
      expect.arrayContaining(['not_found', 'conflict']),
    );
    expect(endMember.method).toBe('POST');
  });
});
