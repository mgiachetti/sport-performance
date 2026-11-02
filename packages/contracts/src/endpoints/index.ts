import type { EndpointCatalog } from '../endpoint.js';
import { sendSignInCode, signOut, verifySignInCode } from './auth.js';
import {
  archiveCategory,
  createCategory,
  getCategory,
  listCategories,
  listPositions,
  restoreCategory,
  updateCategory,
} from './categories.js';
import { getClubTheme } from './club-theme.js';
import {
  archiveClubBranch,
  createClub,
  enableClubBranch,
  getClub,
  listClubBranches,
  listClubs,
  restoreClubBranch,
  updateClub,
} from './clubs.js';
import { getHealth } from './health.js';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  revokeInvitation,
} from './invitations.js';
import { getMe, listMyMemberships } from './me.js';
import { listMySessions, revokeMyOtherSessions, revokeMySession } from './sessions.js';
import { changeMemberRole, endMember, getMember, listMembers } from './members.js';
import {
  createStaffAssignment,
  endStaffAssignment,
  getStaffAssignment,
  listMyStaffAssignments,
  listStaffAssignments,
  updateStaffAssignment,
} from './staff-assignments.js';
import {
  addPlayerCategory,
  archivePlayer,
  createPlayer,
  getPlayer,
  getPlayerParentHeights,
  listPlayerCategories,
  listPlayers,
  restorePlayer,
  setPlayerParentHeight,
  updatePlayer,
  updatePlayerCategory,
} from './players.js';

export * from './auth.js';
export * from './categories.js';
export * from './club-theme.js';
export * from './clubs.js';
export * from './health.js';
export * from './invitations.js';
export * from './me.js';
export * from './sessions.js';
export * from './members.js';
export * from './staff-assignments.js';
export * from './players.js';

/**
 * Every endpoint of the API, keyed by operationId. The API registers its
 * routes from here, the OpenAPI document is generated from here and the typed
 * client exposes one method per entry.
 */
export const apiEndpoints = {
  getHealth,
  sendSignInCode,
  verifySignInCode,
  signOut,
  getMe,
  listMyMemberships,
  listMySessions,
  revokeMySession,
  revokeMyOtherSessions,
  createInvitation,
  listInvitations,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
  getClubTheme,
  listClubs,
  createClub,
  getClub,
  updateClub,
  listClubBranches,
  enableClubBranch,
  archiveClubBranch,
  restoreClubBranch,
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  archiveCategory,
  restoreCategory,
  listPositions,
  listMembers,
  getMember,
  changeMemberRole,
  endMember,
  listStaffAssignments,
  listMyStaffAssignments,
  getStaffAssignment,
  createStaffAssignment,
  updateStaffAssignment,
  endStaffAssignment,
  listPlayers,
  getPlayer,
  createPlayer,
  updatePlayer,
  archivePlayer,
  restorePlayer,
  listPlayerCategories,
  addPlayerCategory,
  updatePlayerCategory,
  getPlayerParentHeights,
  setPlayerParentHeight,
} as const satisfies EndpointCatalog;

export type ApiEndpoints = typeof apiEndpoints;
