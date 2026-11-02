import { describe, expect, it } from 'vitest';
import * as contracts from './index.js';

describe('@sport-performance/contracts entry point', () => {
  it('exposes its package name', () => {
    expect(contracts.packageName).toBe('@sport-performance/contracts');
  });

  it('exports the catalog, the client and the primitives', () => {
    expect(Object.keys(contracts.apiEndpoints)).toEqual([
      'getHealth',
      'sendSignInCode',
      'verifySignInCode',
      'signOut',
      'getMe',
      'listMyMemberships',
      'listMySessions',
      'revokeMySession',
      'revokeMyOtherSessions',
      'createInvitation',
      'listInvitations',
      'revokeInvitation',
      'previewInvitation',
      'acceptInvitation',
      'getClubTheme',
      'listClubs',
      'createClub',
      'getClub',
      'updateClub',
      'listClubBranches',
      'enableClubBranch',
      'archiveClubBranch',
      'restoreClubBranch',
      'listCategories',
      'getCategory',
      'createCategory',
      'updateCategory',
      'archiveCategory',
      'restoreCategory',
      'listPositions',
      'listMembers',
      'getMember',
      'changeMemberRole',
      'endMember',
      'listStaffAssignments',
      'listMyStaffAssignments',
      'getStaffAssignment',
      'createStaffAssignment',
      'updateStaffAssignment',
      'endStaffAssignment',
      'listPlayers',
      'getPlayer',
      'createPlayer',
      'updatePlayer',
      'archivePlayer',
      'restorePlayer',
      'listPlayerCategories',
      'addPlayerCategory',
      'updatePlayerCategory',
      'getPlayerParentHeights',
      'setPlayerParentHeight',
    ]);
    expect(contracts.MEMBERSHIP_HEADER).toBe('x-membership-id');
    expect(contracts.SUPPORT_CLUB_HEADER).toBe('x-support-club-id');
    expect(contracts.SUPPORT_REASON_HEADER).toBe('x-support-reason');
    expect(typeof contracts.createApiClient).toBe('function');
    expect(typeof contracts.defineEndpoint).toBe('function');
    expect(contracts.ERROR_STATUS.not_found).toBe(404);
  });

  it('does not ship the OpenAPI generator in the client entry', () => {
    expect(contracts).not.toHaveProperty('buildOpenApiDocument');
  });
});
