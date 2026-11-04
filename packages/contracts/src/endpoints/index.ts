import type { EndpointCatalog } from '../endpoint.js';
import { getAlert, listAlerts, reviewAlert } from './alerts.js';
import { getWeeklyPanel } from './panel.js';
import {
  archiveGymProgram,
  correctGymSet,
  createGymProgram,
  getGymProgram,
  getGymSet,
  getPlayerGymPrograms,
  getPlayerGymSummary,
  listGymPrograms,
  listGymSets,
  logGymSets,
  restoreGymProgram,
  updateGymProgram,
  voidGymSet,
} from './gym.js';
import { getTrainingSessionFieldMetrics, listFieldSessions } from './field-sessions.js';
import {
  getAnthroMeasurement,
  listAnthroMeasurements,
  previewAnthroMeasurements,
  recordAnthroMeasurements,
  updateAnthroMeasurement,
} from './anthropometry.js';
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
  archivePosition,
  createCategory,
  createPosition,
  getCategory,
  listCategories,
  listPositions,
  restoreCategory,
  restorePosition,
  updateCategory,
  updatePosition,
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
import { listCatalogMetrics, listCatalogTests } from './configuration-catalog.js';
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
import {
  cancelDataSubjectRequest,
  deleteMyAccount,
  executeErasure,
  exportPlayerData,
  getDataSubjectRequest,
  listDataSubjectRequests,
  rejectDataSubjectRequest,
  requestPlayerErasure,
} from './data-subject-rights.js';
import {
  createClubDataExport,
  getClubDataExport,
  getClubDataExportDownload,
  listClubDataExports,
} from './club-data-exports.js';
import { getHealth } from './health.js';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  previewInvitation,
  revokeInvitation,
} from './invitations.js';
import { getMe, listMyMemberships } from './me.js';
import { getMyPlayer, listMyTestDays } from './me-player.js';
import {
  getPlayerAvailability,
  getPlayerDailyMonitoring,
  getPlayerMaturation,
  getPlayerPercentiles,
  getPlayerTestEvolution,
} from './player-profile.js';
import { getPlayerReport, listPlayerReports, requestPlayerReport } from './player-reports.js';
import {
  getCategoryReport,
  listCategoryReports,
  requestCategoryReport,
} from './category-reports.js';
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
import {
  getMyNotificationPreferences,
  registerMyPushToken,
  unregisterMyPushToken,
  updateMyNotificationPreferences,
} from './notifications.js';
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
import { listTrainingSessionRoster } from './session-roster.js';
import { getKioskRoster } from './kiosk.js';
import {
  archiveExternalLoad,
  correctExternalLoad,
  getExternalLoad,
  listExternalLoads,
  reportExternalLoad,
} from './external-loads.js';
import {
  correctWellness,
  getWellness,
  getWellnessForm,
  listWellness,
  submitWellness,
} from './wellness.js';
import {
  getPainReportForm,
  listPainReports,
  reviewPainReport,
  submitPainReport,
} from './pain-reports.js';
import { getMenarche, reportMenarche } from './menarche.js';
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
import { pullSyncChanges, pushSyncMutations } from './sync.js';
import { listClubSupportAccess, listSupportAccess } from './support-access.js';
import {
  archiveProtocolMedia,
  attachProtocolMedia,
  getTestDefinition,
  listProtocolMedia,
  listTestDefinitions,
  restoreProtocolMedia,
  updateProtocolMedia,
} from './test-definitions.js';
import {
  createTestImport,
  getTestImport,
  listTestImports,
  previewTestImport,
} from './test-imports.js';
import { getTestSessionSheet } from './test-day-sheet.js';
import {
  getDevice,
  listDevices,
  registerDevice,
  restoreDevice,
  retireDevice,
  updateDevice,
} from './devices.js';

export * from './alerts.js';
export * from './anthropometry.js';
export * from './app-compatibility.js';
export * from './auth.js';
export * from './calendar.js';
export * from './categories.js';
export * from './club-theme.js';
export * from './clubs.js';
export * from './configuration-alert-rules.js';
export * from './configuration-battery.js';
export * from './configuration-catalog.js';
export * from './configuration-common.js';
export * from './configuration-modules.js';
export * from './configuration-speed-zones.js';
export * from './guardians.js';
export * from './gym.js';
export * from './consents.js';
export * from './field-sessions.js';
export * from './files.js';
export * from './data-subject-rights.js';
export * from './club-data-exports.js';
export * from './health.js';
export * from './invitations.js';
export * from './me.js';
export * from './me-player.js';
export * from './notifications.js';
export * from './reference-values.js';
export * from './roster-imports.js';
export * from './sessions.js';
export * from './members.js';
export * from './staff-assignments.js';
export * from './players.js';
export * from './player-profile.js';
export * from './player-reports.js';
export * from './category-reports.js';
export * from './season-rollovers.js';
export * from './training.js';
export * from './session-roster.js';
export * from './wellness.js';
export * from './pain-reports.js';
export * from './menarche.js';
export * from './external-loads.js';
export * from './kiosk.js';
export * from './tests.js';
export * from './sync.js';
export * from './support-access.js';
export * from './test-imports.js';
export * from './panel.js';
export * from './test-definitions.js';
export * from './test-day-sheet.js';
export * from './devices.js';

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
  getMyPlayer,
  listMyTestDays,
  listMySessions,
  revokeMySession,
  revokeMyOtherSessions,
  registerMyPushToken,
  unregisterMyPushToken,
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
  createInvitation,
  listInvitations,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
  getClubTheme,
  listClubs,
  createClub,
  listSupportAccess,
  listClubSupportAccess,
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
  createPosition,
  updatePosition,
  archivePosition,
  restorePosition,
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
  getMenarche,
  reportMenarche,
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
  listTrainingSessionRoster,
  submitSessionRpe,
  listMyTrainingSessions,
  listFieldSessions,
  getTrainingSessionFieldMetrics,
  getWellnessForm,
  submitWellness,
  correctWellness,
  listWellness,
  getWellness,
  getPainReportForm,
  submitPainReport,
  listPainReports,
  reviewPainReport,
  reportExternalLoad,
  correctExternalLoad,
  archiveExternalLoad,
  listExternalLoads,
  getExternalLoad,
  getKioskRoster,
  listAlerts,
  getAlert,
  reviewAlert,
  getWeeklyPanel,
  recordTestSessionResults,
  getTestSessionSheet,
  listTestResults,
  getTestResult,
  createTestResult,
  updateTestResult,
  addTestResultEntries,
  voidTestResultEntries,
  listPlayerTestMetric,
  listDevices,
  getDevice,
  registerDevice,
  updateDevice,
  retireDevice,
  restoreDevice,
  recordAnthroMeasurements,
  previewAnthroMeasurements,
  listAnthroMeasurements,
  getAnthroMeasurement,
  updateAnthroMeasurement,
  listTestDefinitions,
  getTestDefinition,
  listProtocolMedia,
  attachProtocolMedia,
  updateProtocolMedia,
  archiveProtocolMedia,
  restoreProtocolMedia,
  previewTestImport,
  createTestImport,
  listTestImports,
  getTestImport,
  listReferenceValues,
  getReferenceValue,
  createReferenceValue,
  updateReferenceValue,
  archiveReferenceValue,
  restoreReferenceValue,
  importReferenceValues,
  getPlayerFirstTeamReferences,
  getPlayerDailyMonitoring,
  getPlayerMaturation,
  getPlayerAvailability,
  getPlayerPercentiles,
  getPlayerTestEvolution,
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
  listCatalogTests,
  listCatalogMetrics,
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
  pushSyncMutations,
  pullSyncChanges,
  exportPlayerData,
  requestPlayerErasure,
  listDataSubjectRequests,
  getDataSubjectRequest,
  cancelDataSubjectRequest,
  rejectDataSubjectRequest,
  executeErasure,
  deleteMyAccount,
  requestPlayerReport,
  listPlayerReports,
  getPlayerReport,
  requestCategoryReport,
  listCategoryReports,
  getCategoryReport,
  createClubDataExport,
  listClubDataExports,
  getClubDataExport,
  getClubDataExportDownload,
  listGymPrograms,
  getGymProgram,
  createGymProgram,
  updateGymProgram,
  archiveGymProgram,
  restoreGymProgram,
  getPlayerGymPrograms,
  logGymSets,
  correctGymSet,
  voidGymSet,
  listGymSets,
  getGymSet,
  getPlayerGymSummary,
} as const satisfies EndpointCatalog;

export type ApiEndpoints = typeof apiEndpoints;
