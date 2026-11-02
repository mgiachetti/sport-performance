import type { EndpointCatalog } from '../endpoint.js';
import { sendSignInCode, signOut, verifySignInCode } from './auth.js';
import {
  archiveFixture,
  archiveSeason,
  archiveTestWindow,
  cancelTestSession,
  createFixture,
  createSeason,
  createTestSession,
  createTestWindow,
  getCategoryCalendar,
  getFixture,
  getSeason,
  getTestSession,
  listFixtures,
  listSeasons,
  listTestSessions,
  restoreFixture,
  restoreSeason,
  restoreTestSession,
  restoreTestWindow,
  updateFixture,
  updateSeason,
  updateTestSession,
  updateTestWindow,
} from './calendar.js';
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
import {
  archiveTrainingSession,
  createDrill,
  createTrainingSession,
  deleteDrill,
  getTrainingSession,
  listMyTrainingSessions,
  listParticipations,
  listTrainingSessions,
  recordParticipations,
  restoreTrainingSession,
  submitSessionRpe,
  updateDrill,
  updateParticipation,
  updateTrainingSession,
} from './training.js';
import {
  correctWellness,
  getWellness,
  getWellnessForm,
  listWellness,
  submitWellness,
} from './wellness.js';
import {
  addTestResultEntries,
  createTestResult,
  getTestResult,
  listPlayerTestMetric,
  listTestResults,
  recordTestSessionResults,
  updateTestResult,
  voidTestResultEntries,
} from './tests.js';

export * from './auth.js';
export * from './calendar.js';
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
export * from './training.js';
export * from './wellness.js';
export * from './tests.js';

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
  listSeasons,
  getSeason,
  createSeason,
  updateSeason,
  archiveSeason,
  restoreSeason,
  createTestWindow,
  updateTestWindow,
  archiveTestWindow,
  restoreTestWindow,
  listTestSessions,
  getTestSession,
  createTestSession,
  updateTestSession,
  cancelTestSession,
  restoreTestSession,
  listFixtures,
  getFixture,
  createFixture,
  updateFixture,
  archiveFixture,
  restoreFixture,
  getCategoryCalendar,
  listTrainingSessions,
  getTrainingSession,
  createTrainingSession,
  updateTrainingSession,
  archiveTrainingSession,
  restoreTrainingSession,
  createDrill,
  updateDrill,
  deleteDrill,
  recordParticipations,
  updateParticipation,
  listParticipations,
  submitSessionRpe,
  listMyTrainingSessions,
  getWellnessForm,
  submitWellness,
  correctWellness,
  listWellness,
  getWellness,
  recordTestSessionResults,
  listTestResults,
  getTestResult,
  createTestResult,
  updateTestResult,
  addTestResultEntries,
  voidTestResultEntries,
  listPlayerTestMetric,
} as const satisfies EndpointCatalog;

export type ApiEndpoints = typeof apiEndpoints;
