import type { EndpointCatalog } from '../endpoint.js';
import { getAppCompatibility } from './app-compatibility.js';
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
  createAlertRule,
  getAlertRule,
  listAlertRules,
  updateAlertRule,
} from './configuration-alert-rules.js';
import {
  archiveBatteryEntry,
  createBatteryEntry,
  getBatteryEntry,
  getEffectiveBattery,
  listBatteryEntries,
  restoreBatteryEntry,
  updateBatteryEntry,
} from './configuration-battery.js';
import { getClubModules, updateClubModules } from './configuration-modules.js';
import {
  archiveSpeedZoneConfig,
  createSpeedZoneConfig,
  getEffectiveSpeedZones,
  getSpeedZoneConfig,
  listSpeedZoneConfigs,
  restoreSpeedZoneConfig,
  updateSpeedZoneConfig,
} from './configuration-speed-zones.js';
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
import {
  confirmGuardianAsAdult,
  createPlayerGuardian,
  endGuardian,
  invitePlayer,
  issuePlayerAccessCode,
  listMyChildren,
  listPlayerAccessCodes,
  listPlayerGuardians,
  redeemPlayerAccess,
  revokePlayerAccessCode,
  updateGuardian,
  withdrawGuardianAdultConfirmation,
} from './guardians.js';
import {
  getConsentDocument,
  getPlayerConsents,
  listConsentDocuments,
  listPlayerConsentHistory,
  publishConsentDocument,
  revokeConsent,
  signConsent,
} from './consents.js';
import {
  confirmFileUpload,
  createFileUpload,
  deleteFile,
  getFile,
  getFileDownload,
  listFiles,
} from './files.js';
import { getHealth } from './health.js';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  revokeInvitation,
} from './invitations.js';
import { getMe, listMyMemberships } from './me.js';
import {
  archiveReferenceValue,
  createReferenceValue,
  getPlayerFirstTeamReferences,
  getReferenceValue,
  importReferenceValues,
  listReferenceValues,
  restoreReferenceValue,
  updateReferenceValue,
} from './reference-values.js';
import {
  getRosterImport,
  importRoster,
  listRosterImports,
  previewRosterImport,
} from './roster-imports.js';
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
  applySeasonRollover,
  cancelSeasonRollover,
  createSeasonRollover,
  getSeasonRollover,
  listSeasonRolloverItems,
  listSeasonRollovers,
  updateSeasonRolloverItem,
} from './season-rollovers.js';
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

export * from './app-compatibility.js';
export * from './auth.js';
export * from './calendar.js';
export * from './categories.js';
export * from './club-theme.js';
export * from './clubs.js';
export * from './configuration-alert-rules.js';
export * from './configuration-battery.js';
export * from './configuration-common.js';
export * from './configuration-modules.js';
export * from './configuration-speed-zones.js';
export * from './guardians.js';
export * from './consents.js';
export * from './files.js';
export * from './health.js';
export * from './invitations.js';
export * from './me.js';
export * from './reference-values.js';
export * from './roster-imports.js';
export * from './sessions.js';
export * from './members.js';
export * from './staff-assignments.js';
export * from './players.js';
export * from './season-rollovers.js';
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
  getAppCompatibility,
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
  createSeasonRollover,
  listSeasonRollovers,
  getSeasonRollover,
  listSeasonRolloverItems,
  updateSeasonRolloverItem,
  applySeasonRollover,
  cancelSeasonRollover,
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
  listReferenceValues,
  getReferenceValue,
  createReferenceValue,
  updateReferenceValue,
  archiveReferenceValue,
  restoreReferenceValue,
  importReferenceValues,
  getPlayerFirstTeamReferences,
  listBatteryEntries,
  getEffectiveBattery,
  getBatteryEntry,
  createBatteryEntry,
  updateBatteryEntry,
  archiveBatteryEntry,
  restoreBatteryEntry,
  listSpeedZoneConfigs,
  getEffectiveSpeedZones,
  getSpeedZoneConfig,
  createSpeedZoneConfig,
  updateSpeedZoneConfig,
  archiveSpeedZoneConfig,
  restoreSpeedZoneConfig,
  listAlertRules,
  getAlertRule,
  createAlertRule,
  updateAlertRule,
  getClubModules,
  updateClubModules,
  listPlayerGuardians,
  createPlayerGuardian,
  updateGuardian,
  endGuardian,
  confirmGuardianAsAdult,
  withdrawGuardianAdultConfirmation,
  listMyChildren,
  invitePlayer,
  issuePlayerAccessCode,
  listPlayerAccessCodes,
  revokePlayerAccessCode,
  redeemPlayerAccess,
  listConsentDocuments,
  getConsentDocument,
  publishConsentDocument,
  getPlayerConsents,
  listPlayerConsentHistory,
  signConsent,
  revokeConsent,
  createFileUpload,
  confirmFileUpload,
  listFiles,
  getFile,
  getFileDownload,
  deleteFile,
  previewRosterImport,
  importRoster,
  listRosterImports,
  getRosterImport,
} as const satisfies EndpointCatalog;

export type ApiEndpoints = typeof apiEndpoints;
