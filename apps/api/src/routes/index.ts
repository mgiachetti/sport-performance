import type { ApiEndpoints } from '@sport-performance/contracts';
import type { FastifyInstance } from 'fastify';
import { revokeSessionsOfEndedMembership } from '../auth/member-sessions.js';
import type { AuthModule } from '../auth/module.js';
import type { FilesModule } from '../files/module.js';
import {
  registerAppCompatibilityRoutes,
  type AppCompatibilityOptions,
} from './app-compatibility.js';
import { registerAuthRoutes } from './auth.js';
import { registerCalendarRoutes } from './calendar/index.js';
import { registerCategoryRoutes } from './categories.js';
import { registerClubRoutes } from './clubs.js';
import { registerAlertRuleRoutes } from './configuration-alert-rules.js';
import { registerBatteryRoutes } from './configuration-battery.js';
import { registerCatalogRoutes } from './configuration-catalog.js';
import { registerModuleRoutes } from './configuration-modules.js';
import { registerSpeedZoneRoutes } from './configuration-speed-zones.js';
import { registerGuardianRoutes } from './guardians.js';
import { registerConsentRoutes } from './consents.js';
import { registerFileRoutes } from './files.js';
import { registerClubDataExportRoutes } from './club-data-exports.js';
import { registerDeviceRoutes } from './devices.js';
import {
  registerAccountDeletionRoute,
  registerDataSubjectRightsRoutes,
} from './data-subject-rights.js';
import { registerHealthRoutes, type HealthOptions } from './health.js';
import { registerInvitationRoutes } from './invitations.js';
import { registerMeRoutes } from './me.js';
import { registerMePlayerRoutes } from './me-player.js';
import { registerNotificationRoutes } from './notifications.js';
import { registerMemberRoutes } from './members.js';
import { registerOpenApiRoute } from './openapi.js';
import { registerReferenceValueRoutes } from './reference-values.js';
import { registerRosterImportRoutes } from './roster-imports.js';
import { registerSessionRoutes } from './sessions.js';
import { registerStaffAssignmentRoutes } from './staff-assignments.js';
import { registerPlayerRoutes } from './players.js';
import { registerPlayerProfileRoutes } from './player-profile.js';
import { registerPlayerReportRoutes } from './player-reports.js';
import { registerCategoryReportRoutes } from './category-reports.js';
import { registerSeasonRolloverRoutes } from './season-rollovers.js';
import { registerParticipationRoutes } from './participations.js';
import { registerSessionRosterRoutes } from './session-roster.js';
import { registerTrainingSessionRoutes } from './training-sessions.js';
import { registerFieldSessionRoutes } from './field-sessions.js';
import { registerWellnessRoutes } from './wellness.js';
import { registerGymRoutes } from './gym/index.js';
import { registerPainReportRoutes } from './pain-reports.js';
import { registerExternalLoadRoutes } from './external-loads.js';
import { registerAlertRoutes } from './alerts.js';
import { registerPanelRoutes } from './panel.js';
import { registerAnthropometryRoutes } from './anthropometry.js';
import { registerTestResultRoutes } from './test-results.js';
import { registerTestDefinitionRoutes } from './test-definitions.js';
import { registerTestImportRoutes } from './test-imports.js';
import { registerTestSessionResultRoutes } from './test-sessions.js';
import { registerTestSessionSheetRoutes } from './test-session-sheet.js';
import { registerSyncRoutes } from './sync.js';
import { registerSupportAccessRoutes } from './support-access.js';

/**
 * Endpoints of the contract the API serves, by operationId. Adding an
 * endpoint to `apiEndpoints` without listing it here or in
 * {@link PENDING_ENDPOINTS} fails to compile (see `Unaccounted` below).
 */
export const IMPLEMENTED_ENDPOINTS = [
  'getHealth',
  'getAppCompatibility',
  'sendSignInCode',
  'verifySignInCode',
  'signOut',
  'getMe',
  'listMyMemberships',
  'getMyPlayer',
  'listMyTestDays',
  'listMySessions',
  'revokeMySession',
  'revokeMyOtherSessions',
  'registerMyPushToken',
  'unregisterMyPushToken',
  'getMyNotificationPreferences',
  'updateMyNotificationPreferences',
  'createInvitation',
  'listInvitations',
  'revokeInvitation',
  'previewInvitation',
  'acceptInvitation',
  'getClubTheme',
  'listClubs',
  'createClub',
  'listSupportAccess',
  'listClubSupportAccess',
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
  'createSeasonRollover',
  'listSeasonRollovers',
  'getSeasonRollover',
  'listSeasonRolloverItems',
  'updateSeasonRolloverItem',
  'applySeasonRollover',
  'cancelSeasonRollover',
  'getPlayerParentHeights',
  'setPlayerParentHeight',
  'listSeasons',
  'getSeason',
  'createSeason',
  'updateSeason',
  'archiveSeason',
  'restoreSeason',
  'createTestWindow',
  'updateTestWindow',
  'archiveTestWindow',
  'restoreTestWindow',
  'listTestSessions',
  'getTestSession',
  'createTestSession',
  'updateTestSession',
  'cancelTestSession',
  'restoreTestSession',
  'listFixtures',
  'getFixture',
  'createFixture',
  'updateFixture',
  'archiveFixture',
  'restoreFixture',
  'getCategoryCalendar',
  'listTrainingSessions',
  'getTrainingSession',
  'createTrainingSession',
  'updateTrainingSession',
  'archiveTrainingSession',
  'restoreTrainingSession',
  'createDrill',
  'updateDrill',
  'deleteDrill',
  'recordParticipations',
  'updateParticipation',
  'listParticipations',
  'listTrainingSessionRoster',
  'submitSessionRpe',
  'listMyTrainingSessions',
  'listFieldSessions',
  'getTrainingSessionFieldMetrics',
  'getWellnessForm',
  'submitWellness',
  'correctWellness',
  'listWellness',
  'getWellness',
  'getPainReportForm',
  'submitPainReport',
  'listPainReports',
  'reviewPainReport',
  'reportExternalLoad',
  'correctExternalLoad',
  'archiveExternalLoad',
  'listExternalLoads',
  'getExternalLoad',
  'listAlerts',
  'getAlert',
  'reviewAlert',
  'getWeeklyPanel',
  'recordTestSessionResults',
  'getTestSessionSheet',
  'listTestResults',
  'previewTestImport',
  'createTestImport',
  'listTestImports',
  'getTestImport',
  'getTestResult',
  'createTestResult',
  'updateTestResult',
  'addTestResultEntries',
  'voidTestResultEntries',
  'listPlayerTestMetric',
  'recordAnthroMeasurements',
  'previewAnthroMeasurements',
  'listAnthroMeasurements',
  'getAnthroMeasurement',
  'updateAnthroMeasurement',
  'listReferenceValues',
  'getReferenceValue',
  'createReferenceValue',
  'updateReferenceValue',
  'archiveReferenceValue',
  'restoreReferenceValue',
  'importReferenceValues',
  'getPlayerFirstTeamReferences',
  'getPlayerDailyMonitoring',
  'getPlayerMaturation',
  'getPlayerAvailability',
  'getPlayerPercentiles',
  'getPlayerTestEvolution',
  'listBatteryEntries',
  'getEffectiveBattery',
  'listTestDefinitions',
  'getTestDefinition',
  'listProtocolMedia',
  'attachProtocolMedia',
  'updateProtocolMedia',
  'archiveProtocolMedia',
  'restoreProtocolMedia',
  'getBatteryEntry',
  'createBatteryEntry',
  'updateBatteryEntry',
  'archiveBatteryEntry',
  'restoreBatteryEntry',
  'listSpeedZoneConfigs',
  'getEffectiveSpeedZones',
  'getSpeedZoneConfig',
  'createSpeedZoneConfig',
  'updateSpeedZoneConfig',
  'archiveSpeedZoneConfig',
  'restoreSpeedZoneConfig',
  'listAlertRules',
  'getAlertRule',
  'createAlertRule',
  'updateAlertRule',
  'getClubModules',
  'updateClubModules',
  'listCatalogTests',
  'listCatalogMetrics',
  'listPlayerGuardians',
  'createPlayerGuardian',
  'updateGuardian',
  'endGuardian',
  'confirmGuardianAsAdult',
  'withdrawGuardianAdultConfirmation',
  'listMyChildren',
  'invitePlayer',
  'issuePlayerAccessCode',
  'listPlayerAccessCodes',
  'revokePlayerAccessCode',
  'redeemPlayerAccess',
  'listConsentDocuments',
  'getConsentDocument',
  'publishConsentDocument',
  'getPlayerConsents',
  'listPlayerConsentHistory',
  'signConsent',
  'revokeConsent',
  'createFileUpload',
  'confirmFileUpload',
  'listFiles',
  'getFile',
  'getFileDownload',
  'deleteFile',
  'previewRosterImport',
  'importRoster',
  'listRosterImports',
  'getRosterImport',
  'pushSyncMutations',
  'pullSyncChanges',
  'exportPlayerData',
  'requestPlayerErasure',
  'listDataSubjectRequests',
  'getDataSubjectRequest',
  'cancelDataSubjectRequest',
  'rejectDataSubjectRequest',
  'executeErasure',
  'deleteMyAccount',
  'requestPlayerReport',
  'listPlayerReports',
  'getPlayerReport',
  'requestCategoryReport',
  'listCategoryReports',
  'getCategoryReport',
  'createClubDataExport',
  'listClubDataExports',
  'getClubDataExport',
  'getClubDataExportDownload',
  'listGymPrograms',
  'getGymProgram',
  'createGymProgram',
  'updateGymProgram',
  'archiveGymProgram',
  'restoreGymProgram',
  'getPlayerGymPrograms',
  'logGymSets',
  'correctGymSet',
  'voidGymSet',
  'listGymSets',
  'getGymSet',
  'getPlayerGymSummary',
  'listDevices',
  'getDevice',
  'registerDevice',
  'updateDevice',
  'retireDevice',
  'restoreDevice',
] as const satisfies readonly (keyof ApiEndpoints)[];

/** Declared in the contract but served by a later issue (`'#N (B-xxx): why'`). */
export const PENDING_ENDPOINTS: Partial<Record<keyof ApiEndpoints, string>> = {};

type Unaccounted = Exclude<keyof ApiEndpoints, (typeof IMPLEMENTED_ENDPOINTS)[number]>;
/** Compile-time check: every endpoint of the contract is either served or pending. */
export const everyEndpointAccounted: [Unaccounted] extends [never] ? true : Unaccounted = true;

export interface RoutesOptions extends HealthOptions, AppCompatibilityOptions {
  /**
   * Identity endpoints (`/v1/auth`, `/v1/me`, `/v1/invitations`). Always
   * present in the process (`main.ts`); unit tests of the core build the app
   * without it and those routes answer `404`.
   */
  auth?: AuthModule | undefined;
  /** The bucket (B-325); without it the file endpoints answer `503` and the theme has no crest. */
  files?: FilesModule | undefined;
}

export function registerRoutes(app: FastifyInstance, options: RoutesOptions): void {
  registerOpenApiRoute(app);
  registerHealthRoutes(app, options);
  registerAppCompatibilityRoutes(app, options);
  // Club data: they need no auth module (the theme is public; the rest answer 401 without it).
  registerClubRoutes(app, options.files);
  registerSupportAccessRoutes(app);
  registerCategoryRoutes(app);
  registerStaffAssignmentRoutes(app);
  registerPlayerRoutes(app);
  registerPlayerProfileRoutes(app);
  registerPlayerReportRoutes(app);
  registerCategoryReportRoutes(app);
  registerMePlayerRoutes(app);
  registerSeasonRolloverRoutes(app);
  registerCalendarRoutes(app);
  registerTrainingSessionRoutes(app);
  registerParticipationRoutes(app);
  registerSessionRosterRoutes(app);
  registerFieldSessionRoutes(app);
  registerWellnessRoutes(app);
  registerGymRoutes(app);
  registerPainReportRoutes(app);
  registerExternalLoadRoutes(app);
  registerAlertRoutes(app);
  registerPanelRoutes(app);
  registerTestSessionResultRoutes(app);
  registerTestSessionSheetRoutes(app);
  registerTestResultRoutes(app);
  registerTestImportRoutes(app);
  registerDeviceRoutes(app);
  registerAnthropometryRoutes(app);
  registerTestDefinitionRoutes(app);
  registerReferenceValueRoutes(app);
  registerBatteryRoutes(app);
  registerSpeedZoneRoutes(app);
  registerAlertRuleRoutes(app);
  registerCatalogRoutes(app);
  registerModuleRoutes(app);
  registerConsentRoutes(app);
  registerFileRoutes(app, options.files);
  registerRosterImportRoutes(app);
  registerDataSubjectRightsRoutes(app);
  registerClubDataExportRoutes(app, options.files);
  registerNotificationRoutes(app);
  // Last of the club data: the push runs the handlers of the routes above.
  registerSyncRoutes(app);
  if (options.auth !== undefined) {
    registerAuthRoutes(app, options.auth);
    registerMeRoutes(app, options.auth);
    registerAccountDeletionRoute(app);
    registerSessionRoutes(app, options.auth);
    registerInvitationRoutes(app, options.auth);
    const auth = options.auth;
    registerMemberRoutes(app, {
      // B-333: a member left without any membership is signed out everywhere.
      // Read in the request transaction: a supporting superadmin works the same (issue #161).
      onMembershipEnded: async (caller, ended, db) => {
        await revokeSessionsOfEndedMembership(auth, caller, ended.id, db);
      },
    });
    registerGuardianRoutes(app, options.auth);
  }
}
