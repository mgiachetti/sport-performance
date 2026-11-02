import type { ApiEndpoints } from '@sport-performance/contracts';
import type { FastifyInstance } from 'fastify';
import { revokeSessionsOfEndedMembership } from '../auth/member-sessions.js';
import type { AuthModule } from '../auth/module.js';
import { registerAuthRoutes } from './auth.js';
import { registerCalendarRoutes } from './calendar/index.js';
import { registerCategoryRoutes } from './categories.js';
import { registerClubRoutes } from './clubs.js';
import { registerHealthRoutes, type HealthOptions } from './health.js';
import { registerInvitationRoutes } from './invitations.js';
import { registerMeRoutes } from './me.js';
import { registerMemberRoutes } from './members.js';
import { registerOpenApiRoute } from './openapi.js';
import { registerSessionRoutes } from './sessions.js';
import { registerStaffAssignmentRoutes } from './staff-assignments.js';
import { registerPlayerRoutes } from './players.js';
import { registerParticipationRoutes } from './participations.js';
import { registerTrainingSessionRoutes } from './training-sessions.js';
import { registerWellnessRoutes } from './wellness.js';
import { registerTestResultRoutes } from './test-results.js';
import { registerTestSessionResultRoutes } from './test-sessions.js';

/**
 * Endpoints of the contract the API serves, by operationId. Adding an
 * endpoint to `apiEndpoints` without listing it here or in
 * {@link PENDING_ENDPOINTS} fails to compile (see `Unaccounted` below).
 */
export const IMPLEMENTED_ENDPOINTS = [
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
  'submitSessionRpe',
  'listMyTrainingSessions',
  'getWellnessForm',
  'submitWellness',
  'correctWellness',
  'listWellness',
  'getWellness',
  'recordTestSessionResults',
  'listTestResults',
  'getTestResult',
  'createTestResult',
  'updateTestResult',
  'addTestResultEntries',
  'voidTestResultEntries',
  'listPlayerTestMetric',
] as const satisfies readonly (keyof ApiEndpoints)[];

/** Declared in the contract but served by a later issue (`'#N (B-xxx): why'`). */
export const PENDING_ENDPOINTS: Partial<Record<keyof ApiEndpoints, string>> = {};

type Unaccounted = Exclude<keyof ApiEndpoints, (typeof IMPLEMENTED_ENDPOINTS)[number]>;
/** Compile-time check: every endpoint of the contract is either served or pending. */
export const everyEndpointAccounted: [Unaccounted] extends [never] ? true : Unaccounted = true;

export interface RoutesOptions extends HealthOptions {
  /**
   * Identity endpoints (`/v1/auth`, `/v1/me`, `/v1/invitations`). Always
   * present in the process (`main.ts`); unit tests of the core build the app
   * without it and those routes answer `404`.
   */
  auth?: AuthModule | undefined;
}

export function registerRoutes(app: FastifyInstance, options: RoutesOptions): void {
  registerOpenApiRoute(app);
  registerHealthRoutes(app, options);
  // Club data: they need no auth module (the theme is public; the rest answer 401 without it).
  registerClubRoutes(app);
  registerCategoryRoutes(app);
  registerStaffAssignmentRoutes(app);
  registerPlayerRoutes(app);
  registerCalendarRoutes(app);
  registerTrainingSessionRoutes(app);
  registerParticipationRoutes(app);
  registerWellnessRoutes(app);
  registerTestSessionResultRoutes(app);
  registerTestResultRoutes(app);
  if (options.auth !== undefined) {
    registerAuthRoutes(app, options.auth);
    registerMeRoutes(app, options.auth);
    registerSessionRoutes(app, options.auth);
    registerInvitationRoutes(app, options.auth);
    const auth = options.auth;
    registerMemberRoutes(app, {
      // B-333: a member left without any membership is signed out everywhere.
      onMembershipEnded: async (caller, ended) => {
        if (caller.membership.membershipId !== null) {
          await revokeSessionsOfEndedMembership(auth, caller, ended.id);
          return;
        }
        // A supporting superadmin: `revokeSessionsOfEndedMembership` reads the membership in a
        // transaction of its own, which a superadmin cannot open without the support reason.
        // The route already authorized the end and resolved the member: same rule, here.
        const others = (await auth.identity.activeMemberships(ended.userId)).filter(
          (membership) => membership.id !== ended.id,
        );
        if (others.length === 0) await auth.sessions.revokeAllOfMember(ended.userId);
      },
    });
  }
}
