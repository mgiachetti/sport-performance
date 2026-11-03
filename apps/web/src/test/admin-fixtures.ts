import type {
  ClubBranch,
  Invitation,
  Member,
  RosterImport,
  RosterImportPreview,
  Season,
  SeasonRollover,
  SeasonRolloverItem,
  StaffAssignment,
} from '@sport-performance/contracts';
import { parseUuid, type MembershipRole } from '@sport-performance/domain';
import { M15_RUGBY, M17_RUGBY, USER } from './fixtures';

/** Valid payloads of the administration endpoints (B-411) for the screen tests. */

const AT = '2026-11-01T12:00:00.000Z';
const VERSION = '1793586338688123';

let counter = 0;
/** A fresh, valid UUID v7-shaped id. */
export function id(): string {
  counter += 1;
  return `0192e7a0-9999-7000-8000-${String(counter).padStart(12, '0')}`;
}

export function member(
  role: MembershipRole,
  overrides: Partial<Member> & { name?: string; email?: string } = {},
): Member {
  const { name, email, ...rest } = overrides;
  return {
    id: parseUuid(id()),
    user: {
      id: parseUuid(id()) as Member['user']['id'],
      name: name ?? 'Lucía Fernández',
      email: email ?? 'lucia@example.com',
    },
    role,
    status: 'active',
    startedAt: '2026-03-01T12:00:00.000Z',
    endedAt: null,
    invitedBy: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...rest,
  };
}

/** The signed-in admin's own membership as the members list returns it. */
export function ownAdminMember(): Member {
  return member('admin', {
    id: parseUuid('0192e7a0-1111-7000-8000-000000000001'),
    name: USER.name,
    email: USER.email,
    user: { id: USER.id, name: USER.name, email: USER.email },
  });
}

export function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: parseUuid(id()),
    email: 'nuevo@example.com',
    role: 'coach',
    categoryIds: [],
    playerId: null,
    relationship: null,
    status: 'pending',
    expiresAt: '2026-11-08T12:00:00.000Z',
    createdAt: AT,
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

export function assignment(overrides: Partial<StaffAssignment> = {}): StaffAssignment {
  return {
    id: parseUuid(id()),
    membershipId: parseUuid(id()),
    member: {
      userId: parseUuid(id()) as StaffAssignment['member']['userId'],
      name: 'Pablo Gómez',
      role: 'coach',
    },
    target: { kind: 'category', categoryId: M15_RUGBY.id },
    validFrom: '2026-03-01' as StaffAssignment['validFrom'],
    validTo: null,
    status: 'current',
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function branch(
  sport: ClubBranch['sport'],
  sex: ClubBranch['sex'],
  overrides: Partial<ClubBranch> = {},
): ClubBranch {
  return {
    id: parseUuid(id()),
    sport,
    sex,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export const RUGBY_MALE = branch('rugby', 'male');
export const HOCKEY_FEMALE = branch('hockey', 'female');

export const SEASON_2027: Season = {
  id: parseUuid('0192e7a0-5555-7000-8000-000000002027'),
  sport: 'rugby',
  name: '2027',
  startsOn: '2027-02-01' as Season['startsOn'],
  endsOn: '2027-11-30' as Season['endsOn'],
  testWindows: [],
  archivedAt: null,
  createdAt: AT,
  updatedAt: AT,
  version: VERSION,
};

export function rollover(overrides: Partial<SeasonRollover> = {}): SeasonRollover {
  return {
    id: parseUuid('0192e7a0-6666-7000-8000-000000000001'),
    seasonId: SEASON_2027.id,
    sport: 'rugby',
    effectiveOn: '2027-02-01' as SeasonRollover['effectiveOn'],
    seasonYear: 2027,
    status: 'draft',
    counts: { players: 2, moving: 1, staying: 0, pendingReview: 1, outcomes: null },
    appliedAt: null,
    cancelledAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export function rolloverItem(overrides: Partial<SeasonRolloverItem> = {}): SeasonRolloverItem {
  return {
    id: parseUuid(id()),
    rolloverId: rollover().id,
    player: {
      id: parseUuid(id()) as SeasonRolloverItem['player']['id'],
      firstName: 'Tomás',
      lastName: 'Álvarez',
      birthDate: '2012-05-04' as SeasonRolloverItem['player']['birthDate'],
      sex: 'male',
    },
    previousCategoryIds: [M15_RUGBY.id],
    ageInSeasonYear: 15,
    ageBandCode: 'm15',
    proposal: 'ambiguous',
    proposedCategoryId: null,
    needsReview: true,
    decision: 'stay',
    targetCategoryId: null,
    reviewedAt: null,
    outcome: null,
    membershipId: null,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

export const MATCHED_PLAYER_ID = parseUuid('0192e7a0-7777-7000-8000-000000000001');

/** Preview of a two-row sheet: a new player, and a possible duplicate to decide. */
export function rosterPreview(decided: boolean): RosterImportPreview {
  return {
    rowCount: 2,
    invalidCount: decided ? 0 : 1,
    resolutionRequiredCount: decided ? 0 : 1,
    createCount: 1,
    updateCount: decided ? 1 : 0,
    skipCount: 0,
    guardiansToLinkCount: 0,
    invitationsToSendCount: 1,
    rows: [
      {
        index: 0,
        sourceRow: 2,
        issues: [],
        action: 'create',
        resolutionRequired: false,
        categoryId: M15_RUGBY.id,
        positionIds: [],
        matches: [],
        duplicateOfIndex: null,
        guardians: [{ email: 'madre@example.com', relationship: 'mother', outcome: 'invite' }],
      },
      {
        index: 1,
        sourceRow: 3,
        issues: decided
          ? []
          : [
              {
                path: ['body', 'rows', 1, 'resolution'],
                code: 'resolution_required',
                message: 'decide',
              },
            ],
        action: decided ? 'update' : null,
        resolutionRequired: !decided,
        categoryId: M17_RUGBY.id,
        positionIds: [],
        matches: [
          {
            playerId:
              MATCHED_PLAYER_ID as RosterImportPreview['rows'][number]['matches'][number]['playerId'],
            kind: 'possible',
            reason: 'similar_name',
            firstName: 'Juan',
            lastName: 'Pérez',
            birthDate:
              '2010-03-05' as RosterImportPreview['rows'][number]['matches'][number]['birthDate'],
            sex: 'male',
            sport: 'rugby',
            currentCategoryIds: [M17_RUGBY.id],
            archived: false,
            version: VERSION,
          },
        ],
        duplicateOfIndex: null,
        guardians: [],
      },
    ],
  };
}

export const NEW_PLAYER_ID = parseUuid('0192e7a0-7777-7000-8000-000000000002');

export function rosterImportResult(): { import: RosterImport; invitationsToSend: unknown[] } {
  return {
    import: {
      id: parseUuid(id()),
      clientUuid: parseUuid(id()),
      rowCount: 2,
      createdCount: 1,
      updatedCount: 1,
      skippedCount: 0,
      guardiansLinkedCount: 0,
      invitationsToSendCount: 1,
      createdBy: USER.id,
      createdAt: AT,
      rows: [
        {
          index: 0,
          sourceRow: 2,
          result: 'created',
          playerId: NEW_PLAYER_ID as RosterImport['rows'][number]['playerId'],
          guardians: ['invite'],
        },
        {
          index: 1,
          sourceRow: 3,
          result: 'updated',
          playerId: MATCHED_PLAYER_ID as RosterImport['rows'][number]['playerId'],
          guardians: [],
        },
      ],
    },
    invitationsToSend: [
      {
        rowIndex: 0,
        guardianIndex: 0,
        playerId: NEW_PLAYER_ID,
        email: 'madre@example.com',
        relationship: 'mother',
      },
    ],
  };
}
