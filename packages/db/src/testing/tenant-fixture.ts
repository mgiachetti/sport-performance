import { createHash } from 'node:crypto';
import type { ClubId, LocalDate, PlayerId } from '@sport-performance/domain';
import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import {
  alert,
  alertRule,
  anthroMeasurement,
  batteryConfig,
  category,
  changeHistory,
  club,
  clubBranch,
  consent,
  consentDocument,
  derivedRefresh,
  dataSubjectRequest,
  device,
  drill,
  externalMetric,
  fixture,
  file,
  guardian,
  gymProgram,
  gymSet,
  invitation,
  invitationCategory,
  khamisRocheCoefficient,
  khamisRocheTable,
  membership,
  metricDefinition,
  participation,
  player,
  playerAccessCode,
  playerCategory,
  playerLoadDaily,
  playerParentHeight,
  playerPosition,
  playerStage,
  playerWellnessDaily,
  position,
  referenceValue,
  rosterImport,
  season,
  seasonRollover,
  seasonRolloverItem,
  speedZoneConfig,
  staffAssignment,
  syncChange,
  syncMutation,
  testDefinition,
  testDefinitionMetric,
  testResult,
  testResultValue,
  testSession,
  testWindow,
  trainingSession,
  user,
  wellness,
} from '../schema/index.js';
import { must } from './database.js';

/**
 * One club with a row in every club table, written as the owner (no RLS), for
 * the RLS tests (ADR 0026). Two players: `assigned` (M15, linked to the
 * player user and the parent) and `other` (M17). Staff:
 *
 * - `admin`, and `coach` assigned to M15, `coachM17` assigned to M17;
 * - `sc` assigned to the whole sport (rugby); `medical` without assignment;
 * - `player` (the user of the assigned player) and `parent` (their guardian).
 *
 * `rows` maps every club table to the id of a row of the assigned player (or
 * of the club, for tables without player): the isolation tests check that
 * the map covers every table with `club_id` in the migrated database.
 */
export interface ClubFixture {
  readonly clubId: ClubId;
  readonly slug: string;
  readonly users: Readonly<Record<FixtureUser, string>>;
  readonly players: { readonly assigned: PlayerId; readonly other: PlayerId };
  readonly rows: Readonly<Record<string, string>>;
}

export const FIXTURE_USERS = [
  'admin',
  'coach',
  'coachM17',
  'sc',
  'medical',
  'player',
  'parent',
] as const;
export type FixtureUser = (typeof FIXTURE_USERS)[number];

const MEMBERSHIP_ROLE_OF: Record<
  FixtureUser,
  'admin' | 'coach' | 'sc' | 'medical' | 'player' | 'parent'
> = {
  admin: 'admin',
  coach: 'coach',
  coachM17: 'coach',
  sc: 'sc',
  medical: 'medical',
  player: 'player',
  parent: 'parent',
};

const day = (value: string) => value as LocalDate;
const FROM = day('2020-01-01');

async function id<T extends { id: string }>(rows: Promise<T[]>): Promise<T['id']> {
  return must((await rows)[0], 'inserted row').id;
}

export async function seedClubFixture(db: Database, slug: string): Promise<ClubFixture> {
  const clubId = must(
    (
      await db
        .insert(club)
        .values({ slug, name: `Club ${slug}`, shortName: slug.slice(0, 16).toUpperCase() })
        .returning({ id: club.id })
    )[0],
  ).id;

  const users = {} as Record<FixtureUser, string>;
  for (const key of FIXTURE_USERS) {
    users[key] = await id(
      db
        .insert(user)
        .values({ name: `${key} ${slug}`, email: `${key.toLowerCase()}@${slug}.example.com` })
        .returning({ id: user.id }),
    );
  }
  const memberships = {} as Record<FixtureUser, string>;
  for (const key of FIXTURE_USERS) {
    memberships[key] = await id(
      db
        .insert(membership)
        .values({ clubId, userId: users[key], role: MEMBERSHIP_ROLE_OF[key] })
        .returning({ id: membership.id }),
    );
  }

  const rows: Record<string, string> = { membership: memberships.admin };
  const base = { clubId };

  rows.season = await id(
    db
      .insert(season)
      .values({
        ...base,
        sport: 'rugby',
        name: '2026',
        startsOn: day('2026-01-01'),
        endsOn: day('2026-12-31'),
      })
      .returning({ id: season.id }),
  );
  rows.test_window = await id(
    db
      .insert(testWindow)
      .values({
        ...base,
        seasonId: rows.season,
        number: 1,
        startsOn: day('2026-02-01'),
        endsOn: day('2026-02-28'),
      })
      .returning({ id: testWindow.id }),
  );
  const categoryBase = { ...base, sport: 'rugby' as const, sex: 'male' as const };
  rows.club_branch = await id(
    db
      .insert(clubBranch)
      .values({ ...base, sport: 'rugby', sex: 'male' })
      .returning({ id: clubBranch.id }),
  );
  const m15 = await id(
    db
      .insert(category)
      .values({ ...categoryBase, ageBandCode: 'm15', name: 'M15', defaultStage: 'development' })
      .returning({ id: category.id }),
  );
  const m17 = await id(
    db
      .insert(category)
      .values({ ...categoryBase, ageBandCode: 'm17', name: 'M17', defaultStage: 'performance' })
      .returning({ id: category.id }),
  );
  rows.position = await id(
    db
      .insert(position)
      .values({ ...base, sport: 'rugby', code: 'hooker' })
      .returning({ id: position.id }),
  );

  rows.staff_assignment = await id(
    db
      .insert(staffAssignment)
      .values({
        ...base,
        membershipId: memberships.coach,
        categoryId: m15,
        validFrom: FROM,
      })
      .returning({ id: staffAssignment.id }),
  );
  await db.insert(staffAssignment).values([
    { ...base, membershipId: memberships.coachM17, categoryId: m17, validFrom: FROM },
    { ...base, membershipId: memberships.sc, sport: 'rugby', validFrom: FROM },
  ]);

  const playerBase = {
    ...base,
    birthDate: day('2011-05-04'),
    sex: 'male' as const,
    sport: 'rugby' as const,
    joinedOn: FROM,
  };
  const assigned = await id(
    db
      .insert(player)
      .values({ ...playerBase, userId: users.player, firstName: 'Juan', lastName: slug })
      .returning({ id: player.id }),
  );
  const other = await id(
    db
      .insert(player)
      .values({ ...playerBase, firstName: 'Pedro', lastName: slug })
      .returning({ id: player.id }),
  );
  rows.player = assigned;
  rows.category = m15;
  rows.player_category = await id(
    db
      .insert(playerCategory)
      .values({ ...base, playerId: assigned, categoryId: m15, validFrom: FROM })
      .returning({ id: playerCategory.id }),
  );
  await db
    .insert(playerCategory)
    .values({ ...base, playerId: other, categoryId: m17, validFrom: FROM });
  // A season change under review (B-316): the assigned player stays in M15.
  rows.season_rollover = await id(
    db
      .insert(seasonRollover)
      .values({ ...base, seasonId: rows.season, effectiveOn: day('2026-01-01'), seasonYear: 2026 })
      .returning({ id: seasonRollover.id }),
  );
  rows.season_rollover_item = await id(
    db
      .insert(seasonRolloverItem)
      .values({
        ...base,
        rolloverId: rows.season_rollover,
        playerId: assigned,
        ageInSeasonYear: 15,
        ageBandCode: 'm15',
        proposal: 'already_there',
        proposedCategoryId: m15,
        needsReview: false,
        decision: 'stay',
      })
      .returning({ id: seasonRolloverItem.id }),
  );
  rows.player_position = await id(
    db
      .insert(playerPosition)
      .values({ ...base, playerId: assigned, positionId: rows.position, sortOrder: 0 })
      .returning({ id: playerPosition.id }),
  );
  rows.player_parent_height = await id(
    db
      .insert(playerParentHeight)
      .values({
        ...base,
        playerId: assigned,
        parent: 'mother',
        heightCm: 165,
        source: 'reported',
      })
      .returning({ id: playerParentHeight.id }),
  );
  rows.guardian = await id(
    db
      .insert(guardian)
      .values({
        ...base,
        playerId: assigned,
        userId: users.parent,
        relationship: 'mother',
        validFrom: FROM,
      })
      .returning({ id: guardian.id }),
  );
  rows.player_access_code = await id(
    db
      .insert(playerAccessCode)
      .values({
        ...base,
        playerId: assigned,
        codeHash: createHash('sha256').update(`fixture-access-code-${slug}`).digest('hex'),
        tokenHash: createHash('sha256').update(`fixture-access-token-${slug}`).digest('hex'),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        createdBy: users.parent,
      })
      .returning({ id: playerAccessCode.id }),
  );
  rows.consent_document = await id(
    db
      .insert(consentDocument)
      .values({
        ...base,
        type: 'data',
        version: '2026-01',
        title: 'Datos personales',
        body: 'Texto del consentimiento de datos.',
      })
      .returning({ id: consentDocument.id }),
  );
  rows.consent = await id(
    db
      .insert(consent)
      .values({
        ...base,
        playerId: assigned,
        type: 'data',
        documentVersion: '2026-01',
        documentId: rows.consent_document,
        signerKind: 'guardian',
        signedBy: users.parent,
      })
      .returning({ id: consent.id }),
  );
  rows.player_stage = await id(
    db
      .insert(playerStage)
      .values({
        ...base,
        playerId: assigned,
        stage: 'development',
        basis: 'category',
        reason: 'maturation_disabled',
        validFrom: FROM,
      })
      .returning({ id: playerStage.id }),
  );

  rows.metric_definition = await id(
    db
      .insert(metricDefinition)
      .values({
        ...base,
        code: 'cmj_height_cm',
        unit: 'cm',
        source: 'test',
        direction: 'higher_is_better',
        testCode: 'cmj',
      })
      .returning({ id: metricDefinition.id }),
  );
  rows.test_definition = await id(
    db
      .insert(testDefinition)
      .values({ ...base, code: 'cmj', version: 1, attemptCount: 3, validFrom: FROM })
      .returning({ id: testDefinition.id }),
  );
  rows.test_definition_metric = await id(
    db
      .insert(testDefinitionMetric)
      .values({
        ...base,
        testDefinitionId: rows.test_definition,
        metricDefinitionId: rows.metric_definition,
      })
      .returning({ id: testDefinitionMetric.id }),
  );
  rows.battery_config = await id(
    db
      .insert(batteryConfig)
      .values({ ...base, sport: 'rugby', testCode: 'cmj', windows: [1], validFrom: FROM })
      .returning({ id: batteryConfig.id }),
  );
  rows.reference_value = await id(
    db
      .insert(referenceValue)
      .values({
        ...base,
        metricDefinitionId: rows.metric_definition,
        sport: 'rugby',
        sex: 'male',
        value: 45,
        unit: 'cm',
        validFrom: FROM,
        source: 'primera',
      })
      .returning({ id: referenceValue.id }),
  );
  rows.khamis_roche_table = await id(
    db
      .insert(khamisRocheTable)
      .values({
        ...base,
        code: 'khamis_roche_1994',
        citation: 'Khamis & Roche (1994)',
        verification: 'unverified',
        verificationNotes: 'fixture',
      })
      .returning({ id: khamisRocheTable.id }),
  );
  rows.khamis_roche_coefficient = await id(
    db
      .insert(khamisRocheCoefficient)
      .values({
        ...base,
        tableId: rows.khamis_roche_table,
        sex: 'male',
        ageYears: 14,
        interceptIn: -10,
        heightInCoef: 1,
        weightLbCoef: 0,
        midparentHeightInCoef: 0.3,
      })
      .returning({ id: khamisRocheCoefficient.id }),
  );
  rows.speed_zone_config = await id(
    db
      .insert(speedZoneConfig)
      .values({
        ...base,
        playerId: assigned,
        kind: 'relative',
        zoneSet: { kind: 'relative', zones: [] } as never,
        validFrom: FROM,
      })
      .returning({ id: speedZoneConfig.id }),
  );
  rows.device = await id(
    db
      .insert(device)
      .values({ ...base, kind: 'photocell', label: 'Fotocélula 1' })
      .returning({ id: device.id }),
  );

  rows.test_session = await id(
    db
      .insert(testSession)
      .values({ ...base, sport: 'rugby', scheduledOn: day('2026-02-10') })
      .returning({ id: testSession.id }),
  );
  rows.test_result = await id(
    db
      .insert(testResult)
      .values({
        ...base,
        playerId: assigned,
        testDefinitionId: rows.test_definition,
        testSessionId: rows.test_session,
        measuredOn: day('2026-02-10'),
        status: 'done',
        method: 'video',
      })
      .returning({ id: testResult.id }),
  );
  rows.test_result_value = await id(
    db
      .insert(testResultValue)
      .values({
        ...base,
        testResultId: rows.test_result,
        metricDefinitionId: rows.metric_definition,
        attemptNumber: 1,
        value: 41.5,
        unit: 'cm',
      })
      .returning({ id: testResultValue.id }),
  );
  // The other player has results too, so scoped roles can be checked against them.
  await db.insert(testResult).values({
    ...base,
    playerId: other,
    testDefinitionId: rows.test_definition,
    measuredOn: day('2026-02-10'),
    status: 'not_done',
    notDoneReason: 'absent',
  });
  // A CMJ video of the assigned player (B-325): the object itself lives in the bucket.
  rows.file = await id(
    db
      .insert(file)
      .values({
        ...base,
        kind: 'cmj_video',
        playerId: assigned,
        contentType: 'video/mp4',
        sizeBytes: 1024,
        checksumSha256: '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
      })
      .returning({ id: file.id }),
  );
  rows.anthro_measurement = await id(
    db
      .insert(anthroMeasurement)
      .values({ ...base, playerId: assigned, measuredOn: day('2026-02-10'), heightCm: 170 })
      .returning({ id: anthroMeasurement.id }),
  );

  rows.training_session = await id(
    db
      .insert(trainingSession)
      .values({
        ...base,
        sport: 'rugby',
        kind: 'training',
        categoryId: m15,
        startsAt: new Date('2026-03-10T21:00:00Z'),
        localDate: day('2026-03-10'),
      })
      .returning({ id: trainingSession.id }),
  );
  rows.fixture = await id(
    db
      .insert(fixture)
      .values({
        ...base,
        categoryId: m15,
        opponent: 'Club Rival',
        venue: 'home',
        matchDate: day('2026-04-11'),
        kickoffTime: '15:30',
      })
      .returning({ id: fixture.id }),
  );
  rows.drill = await id(
    db
      .insert(drill)
      .values({ ...base, trainingSessionId: rows.training_session, name: 'Rondo' })
      .returning({ id: drill.id }),
  );
  rows.participation = await id(
    db
      .insert(participation)
      .values({
        ...base,
        trainingSessionId: rows.training_session,
        playerId: assigned,
        status: 'full',
        minutes: 60,
        rpe: 5,
        rpeReportedAt: new Date('2026-03-10T22:30:00Z'),
      })
      .returning({ id: participation.id }),
  );
  const wellnessOf = (playerId: PlayerId) => ({
    ...base,
    playerId,
    localDate: day('2026-03-10'),
    itemCount: 3,
    sleep: 4,
    fatigue: 3,
    soreness: 3,
  });
  rows.wellness = await id(
    db.insert(wellness).values(wellnessOf(assigned)).returning({ id: wellness.id }),
  );
  await db.insert(wellness).values(wellnessOf(other));
  // A corrected wellness entry: the trigger records the change (ADR 0030).
  await db.update(wellness).set({ sleep: 5 }).where(eq(wellness.id, rows.wellness));
  rows.change_history = await id(
    db
      .select({ id: changeHistory.id })
      .from(changeHistory)
      .where(
        and(eq(changeHistory.tableName, 'wellness'), eq(changeHistory.recordId, rows.wellness)),
      ),
  );
  // The participation and the wellness above marked the player for the worker (ADR 0045).
  rows.derived_refresh = await id(
    db
      .select({ id: derivedRefresh.id })
      .from(derivedRefresh)
      .where(and(eq(derivedRefresh.clubId, clubId), eq(derivedRefresh.playerId, assigned))),
  );
  rows.player_load_daily = await id(
    db
      .insert(playerLoadDaily)
      .values({
        ...base,
        playerId: assigned,
        localDate: day('2026-03-10'),
        loadAu: 300,
        hasData: true,
        sessionsN: 1,
        pendingRpeN: 0,
        historyDays: 1,
        acuteEwmaAu: 300,
        chronicEwmaAu: 300,
        acwrStatus: 'insufficient_history',
        missingDaysAcute: 0,
        missingDaysChronic: 0,
        windowLoadAu: 300,
        monotonyStatus: 'insufficient_history',
      })
      .returning({ id: playerLoadDaily.id }),
  );
  rows.player_wellness_daily = await id(
    db
      .insert(playerWellnessDaily)
      .values({
        ...base,
        playerId: assigned,
        localDate: day('2026-03-10'),
        itemCount: 3,
        meanScore: 11 / 3,
        baselineSamples: 0,
      })
      .returning({ id: playerWellnessDaily.id }),
  );
  rows.external_metric = await id(
    db
      .insert(externalMetric)
      .values({
        ...base,
        playerId: assigned,
        metricDefinitionId: rows.metric_definition,
        localDate: day('2026-03-10'),
        value: 40,
        unit: 'cm',
        source: 'manual',
      })
      .returning({ id: externalMetric.id }),
  );
  rows.gym_program = await id(
    db
      .insert(gymProgram)
      .values({ ...base, name: 'Fuerza M15', categoryId: m15, validFrom: FROM })
      .returning({ id: gymProgram.id }),
  );
  rows.gym_set = await id(
    db
      .insert(gymSet)
      .values({
        ...base,
        playerId: assigned,
        gymProgramId: rows.gym_program,
        performedOn: day('2026-03-11'),
        exerciseCode: 'goblet_squat',
        setNumber: 1,
        reps: 8,
      })
      .returning({ id: gymSet.id }),
  );
  rows.alert_rule = await id(
    db
      .insert(alertRule)
      .values({ ...base, code: 'acwr_high', kind: 'acwr_high', params: {} as never })
      .returning({ id: alertRule.id }),
  );
  rows.alert = await id(
    db
      .insert(alert)
      .values({
        ...base,
        alertRuleId: rows.alert_rule,
        playerId: assigned,
        kind: 'acwr_high',
        severity: 'warning',
        localDate: day('2026-03-11'),
        observedOn: day('2026-03-11'),
      })
      .returning({ id: alert.id }),
  );

  rows.invitation = await id(
    db
      .insert(invitation)
      .values({
        ...base,
        email: `invitado@${slug}.example.com`,
        role: 'coach',
        tokenHash: createHash('sha256').update(`fixture-invitation-${slug}`).digest('hex'),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdBy: users.admin,
      })
      .returning({ id: invitation.id }),
  );
  rows.invitation_category = await id(
    db
      .insert(invitationCategory)
      .values({ ...base, invitationId: rows.invitation, categoryId: m15 })
      .returning({ id: invitationCategory.id }),
  );

  rows.roster_import = await id(
    db
      .insert(rosterImport)
      .values({
        ...base,
        requestSha256: createHash('sha256').update(`fixture-roster-import-${slug}`).digest('hex'),
        rowCount: 1,
        createdCount: 1,
        updatedCount: 0,
        skippedCount: 0,
        guardiansLinkedCount: 0,
        invitationsToSendCount: 0,
        outcomes: [
          { index: 0, sourceRow: 2, result: 'created', playerId: assigned, guardians: [] },
        ],
        createdBy: users.admin,
      })
      .returning({ id: rosterImport.id }),
  );
  // The offline sync log is written by its trigger (ADR 0050); a pushed mutation by its author.
  rows.sync_change = await id(
    db
      .select({ id: syncChange.id })
      .from(syncChange)
      .where(and(eq(syncChange.collection, 'wellness'), eq(syncChange.rowId, rows.wellness))),
  );
  rows.sync_mutation = await id(
    db
      .insert(syncMutation)
      .values({
        ...base,
        operation: 'wellness.submit',
        hlc: '001773100800000-000000-0123456789abcdef',
        receivedHlc: '001773100800000-000000-0123456789abcdef',
        outcome: 'applied',
        createdBy: users.admin,
      })
      .returning({ id: syncMutation.id }),
  );

  // The guardian asked for the erasure of the assigned player (B-329).
  rows.data_subject_request = await id(
    db
      .insert(dataSubjectRequest)
      .values({
        ...base,
        playerId: assigned,
        kind: 'erasure',
        status: 'pending',
        requestedBy: users.parent,
        requesterRole: 'parent',
        createdBy: users.parent,
      })
      .returning({ id: dataSubjectRequest.id }),
  );

  return { clubId, slug, users, players: { assigned, other }, rows };
}
