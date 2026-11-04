import type { CategoryId, ClubId, ConsentType, PlayerId } from '@sport-performance/domain';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PgTable, PgInsertValue } from 'drizzle-orm/pg-core';
import { user } from '../../schema/auth.js';
import { fixture } from '../../schema/calendar.js';
import { device, metricDefinition, referenceValue, testDefinition } from '../../schema/catalog.js';
import { medicalHold, medicalInjury } from '../../schema/medical.js';
import {
  category,
  membership,
  position,
  season,
  staffAssignment,
} from '../../schema/organization.js';
import {
  consent,
  consentDocument,
  guardian,
  player,
  playerCategory,
  playerParentHeight,
  playerPosition,
} from '../../schema/players.js';
import { club } from '../../schema/tenant.js';
import {
  anthroMeasurement,
  testResult,
  testResultValue,
  testSession,
  testWindow,
} from '../../schema/testing.js';
import { externalMetric, participation, trainingSession, wellness } from '../../schema/training.js';
import { bootstrapClub, type BootstrapClubReport } from '../bootstrap.js';
import type { SeedExecutor } from '../executor.js';
import { SEEDED_PROTOCOL_VERSION } from '../test-definitions.js';
import { generateDemoDataset, type DemoOptions } from './generate.js';
import {
  DATABASE_ENVIRONMENT_SETTING,
  DemoSeedRefusedError,
  databaseForbidsDemo,
} from './guard.js';
import type { DemoCategoryKey, DemoDataset } from './types.js';

/** Rows inserted per table (and moved forward, for the few that do). */
export interface DemoSeedReport {
  readonly clubId: ClubId;
  /** Whether the club row was created by this run. */
  readonly created: boolean;
  readonly bootstrap: BootstrapClubReport;
  readonly inserted: Readonly<Record<string, number>>;
  readonly updated: Readonly<Record<string, number>>;
}

/** Rows per INSERT: the widest demo row has about 20 columns, well under 65 535 parameters. */
const CHUNK = 1000;

async function insertRows<T extends PgTable>(
  tx: SeedExecutor,
  table: T,
  rows: readonly PgInsertValue<T>[],
): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    // Any unique or exclusion conflict means the row is there already (same id or same
    // natural key, possibly entered through the app): leave it as it is.
    const result = await tx.insert(table).values(chunk).onConflictDoNothing();
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

function categoryKeyOf(c: DemoCategoryKey): string {
  return `${c.sport}:${c.sex}:${c.ageBandCode}`;
}

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new DemoSeedRefusedError(`The demo club has no ${what}: was its configuration edited?`);
  }
  return value;
}

/**
 * Writes the demo dataset of a demo club (B-307, ADR 0055), creating the
 * club (`is_demo`) and its default configuration (`bootstrapClub`) when they
 * are missing. Idempotent and append-only: every row has a stable id, a row
 * already there is left alone, and only the forward transitions of rows the
 * demo itself wrote are applied (a season's category closes, an M19 leaves,
 * an injury heals, a scheduled test day is completed).
 *
 * Refuses (`DemoSeedRefusedError`) a slug that belongs to a club that is not a
 * demo, a demo club generated with another seed, and a database that
 * declares a non-demo environment. Needs the owner role (no request context,
 * ADR 0027); runs in one transaction.
 */
export async function seedDemoClub(
  db: SeedExecutor,
  options: DemoOptions,
): Promise<DemoSeedReport> {
  const data = generateDemoDataset(options);
  return db.transaction(async (tx) => {
    const [setting] = (
      await tx.execute<{ value: string | null }>(
        sql`select current_setting(${DATABASE_ENVIRONMENT_SETTING}, true) as value`,
      )
    ).rows;
    const databaseEnvironment = setting?.value ?? null;
    if (databaseForbidsDemo(databaseEnvironment)) {
      throw new DemoSeedRefusedError(
        `The database declares itself "${String(databaseEnvironment)}": no demo data there.`,
      );
    }
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`demo:${data.club.slug}`}))`);
    const inserted = await tx
      .insert(club)
      .values({
        slug: data.club.slug,
        name: data.club.name,
        timeZone: data.club.timeZone,
        shortName: data.club.shortName,
        primaryColor: data.club.primaryColor,
        secondaryColor: data.club.secondaryColor,
        isDemo: true,
        // Field metrics are on (B-408): the demo shows the session view with its Catapult data.
        settings: { demo: { seed: data.club.seed }, modules: { gps: true } },
      })
      .onConflictDoNothing({ target: club.slug })
      .returning({ id: club.id });
    const [existing] = await tx
      .select({ id: club.id, isDemo: club.isDemo, settings: club.settings })
      .from(club)
      .where(eq(club.slug, data.club.slug));
    if (existing === undefined) throw new Error(`unreachable: club ${data.club.slug} not found`);
    if (!existing.isDemo) {
      throw new DemoSeedRefusedError(
        `The club "${data.club.slug}" is not a demo club: demo data is never written to a real club.`,
      );
    }
    const storedSeed = existing.settings.demo?.seed;
    if (storedSeed !== undefined && storedSeed !== data.club.seed) {
      throw new DemoSeedRefusedError(
        `The demo club "${data.club.slug}" was generated with seed "${storedSeed}", not "${data.club.seed}".`,
      );
    }
    const clubId = existing.id;
    await tx.execute(sql`select set_config('app.club_id', ${clubId}, true)`);
    const bootstrap = await bootstrapClub(tx, {
      clubId,
      branches: data.branches,
      supportReason: 'Datos de demostración (B-307)',
    });
    const counts = await writeDataset(tx, clubId, data);
    return { clubId, created: inserted[0] !== undefined, bootstrap, ...counts };
  });
}

async function writeDataset(
  tx: SeedExecutor,
  clubId: ClubId,
  data: DemoDataset,
): Promise<Pick<DemoSeedReport, 'inserted' | 'updated'>> {
  const inserted: Record<string, number> = {};
  const updated: Record<string, number> = {};

  // The club's configuration, by natural key.
  const categories = new Map<string, CategoryId>();
  for (const c of await tx
    .select({
      id: category.id,
      sport: category.sport,
      sex: category.sex,
      band: category.ageBandCode,
      archivedAt: category.archivedAt,
    })
    .from(category)
    .where(eq(category.clubId, clubId))) {
    const key = `${c.sport}:${c.sex}:${c.band}`;
    if (!categories.has(key) || c.archivedAt === null) categories.set(key, c.id);
  }
  const categoryId = (c: DemoCategoryKey) =>
    must(categories.get(categoryKeyOf(c)), `category ${categoryKeyOf(c)}`);
  const positions = new Map(
    (
      await tx
        .select({ id: position.id, sport: position.sport, code: position.code })
        .from(position)
        .where(eq(position.clubId, clubId))
    ).map((p) => [`${p.sport}:${p.code}`, p.id]),
  );
  const metrics = new Map(
    (
      await tx
        .select({
          id: metricDefinition.id,
          code: metricDefinition.code,
          unit: metricDefinition.unit,
        })
        .from(metricDefinition)
        .where(eq(metricDefinition.clubId, clubId))
    ).map((m) => [m.code, m]),
  );
  const metric = (code: string) => must(metrics.get(code), `metric ${code}`);
  const tests = new Map(
    (
      await tx
        .select({ id: testDefinition.id, code: testDefinition.code })
        .from(testDefinition)
        .where(
          and(
            eq(testDefinition.clubId, clubId),
            eq(testDefinition.version, SEEDED_PROTOCOL_VERSION),
          ),
        )
    ).map((t) => [t.code, t.id]),
  );
  const documents = new Map<ConsentType, { id: string; version: string }>();
  for (const d of await tx
    .select({
      id: consentDocument.id,
      type: consentDocument.type,
      version: consentDocument.version,
    })
    .from(consentDocument)
    .where(eq(consentDocument.clubId, clubId))
    .orderBy(desc(consentDocument.publishedAt))) {
    if (!documents.has(d.type)) documents.set(d.type, { id: d.id, version: d.version });
  }

  // Users are global: an email already registered keeps its account.
  inserted.users = await insertRows(
    tx,
    user,
    data.users.map((u) => ({ id: u.id, email: u.email, name: u.name, emailVerified: true })),
  );
  const accountByEmail = new Map<string, string>();
  const emails = data.users.map((u) => u.email);
  for (let i = 0; i < emails.length; i += CHUNK) {
    for (const row of await tx
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(inArray(user.email, emails.slice(i, i + CHUNK)))) {
      accountByEmail.set(row.email, row.id);
    }
  }
  const accountOf = new Map(
    data.users.map((u) => [u.id, must(accountByEmail.get(u.email), `account ${u.email}`)]),
  );
  const uid = (generated: string) => must(accountOf.get(generated), `account ${generated}`);

  inserted.memberships = await insertRows(
    tx,
    membership,
    data.memberships.map((m) => ({
      id: m.id,
      clientUuid: m.clientUuid,
      clubId,
      userId: uid(m.userId),
      role: m.role,
      startedAt: m.startedAt,
    })),
  );
  // An open membership with the same role may have been created through the app.
  const memberships = new Map(
    (
      await tx
        .select({ id: membership.id, userId: membership.userId, role: membership.role })
        .from(membership)
        .where(and(eq(membership.clubId, clubId), isNull(membership.endedAt)))
    ).map((m) => [`${m.userId}:${m.role}`, m.id]),
  );
  const membershipId = new Map(
    data.memberships.map((m) => [m.id, memberships.get(`${uid(m.userId)}:${m.role}`) ?? m.id]),
  );
  inserted.staffAssignments = await insertRows(
    tx,
    staffAssignment,
    data.staffAssignments.map((a) => ({
      id: a.id,
      clientUuid: a.clientUuid,
      clubId,
      membershipId: must(membershipId.get(a.membershipId), 'membership'),
      categoryId: a.category === null ? null : categoryId(a.category),
      sport: a.sport,
      validFrom: a.validFrom,
    })),
  );
  inserted.devices = await insertRows(
    tx,
    device,
    data.devices.map((d) => ({ ...d, clubId })),
  );

  inserted.seasons = await insertRows(
    tx,
    season,
    data.seasons.map((s) => ({
      id: s.id,
      clientUuid: s.clientUuid,
      clubId,
      sport: s.sport,
      name: s.name,
      startsOn: s.startsOn,
      endsOn: s.endsOn,
    })),
  );
  const seasons = new Map(
    (
      await tx
        .select({ id: season.id, sport: season.sport, name: season.name })
        .from(season)
        .where(eq(season.clubId, clubId))
    ).map((s) => [`${s.sport}:${s.name}`, s.id]),
  );
  const seasonId = new Map(
    data.seasons.map((s) => [s.id, seasons.get(`${s.sport}:${s.name}`) ?? s.id]),
  );
  const seasonOf = (generated: string) => must(seasonId.get(generated), 'season');
  inserted.testWindows = await insertRows(
    tx,
    testWindow,
    data.testWindows.map((w) => ({
      id: w.id,
      clientUuid: w.clientUuid,
      clubId,
      seasonId: seasonOf(w.seasonId),
      number: w.number,
      startsOn: w.startsOn,
      endsOn: w.endsOn,
    })),
  );
  const windows = new Map(
    (
      await tx
        .select({ id: testWindow.id, seasonId: testWindow.seasonId, number: testWindow.number })
        .from(testWindow)
        .where(eq(testWindow.clubId, clubId))
    ).map((w) => [`${w.seasonId}:${String(w.number)}`, w.id]),
  );
  const windowId = new Map(
    data.testWindows.map((w) => [
      w.id,
      windows.get(`${seasonOf(w.seasonId)}:${String(w.number)}`) ?? w.id,
    ]),
  );

  // People.
  inserted.players = await insertRows(
    tx,
    player,
    data.players.map((p) => ({
      id: p.id as PlayerId,
      clientUuid: p.clientUuid,
      clubId,
      userId: p.userId === null ? null : uid(p.userId),
      firstName: p.firstName,
      lastName: p.lastName,
      birthDate: p.birthDate,
      sex: p.sex,
      sport: p.sport,
      dominantSide: p.dominantSide,
      joinedOn: p.joinedOn,
      leftOn: p.leftOn,
      leftReason: p.leftReason,
      leftNote: null,
      archivedAt: p.archivedAt,
    })),
  );
  inserted.playerPositions = await insertRows(
    tx,
    playerPosition,
    data.playerPositions.map((p) => ({
      id: p.id,
      clientUuid: p.clientUuid,
      clubId,
      playerId: p.playerId as PlayerId,
      positionId: must(positions.get(`${p.sport}:${p.positionCode}`), `position ${p.positionCode}`),
      sortOrder: p.sortOrder,
    })),
  );
  inserted.parentHeights = await insertRows(
    tx,
    playerParentHeight,
    data.parentHeights.map((h) => ({ ...h, playerId: h.playerId as PlayerId, clubId })),
  );
  inserted.playerCategories = await insertRows(
    tx,
    playerCategory,
    data.playerCategories.map((c) => ({
      id: c.id,
      clientUuid: c.clientUuid,
      clubId,
      playerId: c.playerId as PlayerId,
      categoryId: categoryId(c.category),
      seasonId: seasonOf(c.seasonId),
      validFrom: c.validFrom,
      validTo: c.validTo,
    })),
  );
  inserted.guardians = await insertRows(
    tx,
    guardian,
    data.guardians.map((g) => ({
      ...g,
      clubId,
      playerId: g.playerId as PlayerId,
      userId: uid(g.userId),
    })),
  );
  inserted.consents = await insertRows(
    tx,
    consent,
    data.consents.map((c) => {
      const document = must(documents.get(c.type), `consent text ${c.type}`);
      return {
        id: c.id,
        clientUuid: c.clientUuid,
        clubId,
        playerId: c.playerId as PlayerId,
        type: c.type,
        documentVersion: document.version,
        documentId: document.id,
        signerKind: c.signerKind,
        signedBy: uid(c.signedBy),
        signedAt: c.signedAt,
      };
    }),
  );

  // Calendar, sessions and wellness.
  inserted.fixtures = await insertRows(
    tx,
    fixture,
    data.fixtures.map((f) => ({
      id: f.id,
      clientUuid: f.clientUuid,
      clubId,
      categoryId: categoryId(f.category),
      opponent: f.opponent,
      venue: f.venue,
      competition: f.competition,
      matchDate: f.matchDate,
      kickoffTime: f.kickoffTime,
      location: f.location,
    })),
  );
  inserted.trainingSessions = await insertRows(
    tx,
    trainingSession,
    data.trainingSessions.map((s) => ({
      id: s.id,
      clientUuid: s.clientUuid,
      clubId,
      sport: s.sport,
      kind: s.kind,
      categoryId: categoryId(s.category),
      title: s.title,
      startsAt: s.startsAt,
      localDate: s.localDate,
      plannedDurationMin: s.plannedDurationMin,
      location: s.location,
      opponent: s.opponent,
    })),
  );
  inserted.participations = await insertRows(
    tx,
    participation,
    data.participations.map((p) => ({
      id: p.id,
      clientUuid: p.clientUuid,
      clubId,
      trainingSessionId: p.trainingSessionId,
      playerId: p.playerId as PlayerId,
      status: p.status,
      minutes: p.minutes,
      periodMinutes: p.periodMinutes === null ? null : [...p.periodMinutes],
      contactsN: p.contactsN,
      rpe: p.rpe,
      rpeReportedAt: p.rpeReportedAt,
    })),
  );
  inserted.externalMetrics = await insertRows(
    tx,
    externalMetric,
    data.externalMetrics.map((m) => {
      const metric = must(metrics.get(m.metricCode), `metric ${m.metricCode}`);
      return {
        id: m.id,
        clientUuid: m.clientUuid,
        clubId,
        playerId: m.playerId as PlayerId,
        trainingSessionId: m.trainingSessionId,
        metricDefinitionId: metric.id,
        localDate: m.localDate,
        value: m.value,
        unit: metric.unit,
        source: m.source,
        externalRef: m.externalRef,
      };
    }),
  );
  inserted.wellness = await insertRows(
    tx,
    wellness,
    data.wellness.map((w) => ({ ...w, playerId: w.playerId as PlayerId, clubId })),
  );

  // Tests and anthropometry.
  inserted.testSessions = await insertRows(
    tx,
    testSession,
    data.testSessions.map((s) => ({
      id: s.id,
      clientUuid: s.clientUuid,
      clubId,
      sport: s.sport,
      testWindowId: s.testWindowId === null ? null : (windowId.get(s.testWindowId) ?? null),
      categoryId: categoryId(s.category),
      scheduledOn: s.scheduledOn,
      status: s.status,
      location: s.location,
      conditions: s.conditions,
      notes: s.notes,
      evaluatorId: uid(s.evaluatorId),
      startedAt: s.startedAt,
      completedAt: s.completedAt,
    })),
  );
  inserted.testResults = await insertRows(
    tx,
    testResult,
    data.testResults.map((r) => ({
      id: r.id,
      clientUuid: r.clientUuid,
      clubId,
      playerId: r.playerId as PlayerId,
      testDefinitionId: must(tests.get(r.testCode), `test ${r.testCode}`),
      testSessionId: r.testSessionId,
      measuredOn: r.measuredOn,
      status: r.status,
      notDoneReason: r.notDoneReason,
      method: r.method,
      evaluatorId: uid(r.evaluatorId),
      deviceId: r.deviceId,
      exercise: r.exercise,
      conditions: r.conditions,
    })),
  );
  inserted.testValues = await insertRows(
    tx,
    testResultValue,
    data.testValues.map((v) => {
      const m = metric(v.metricCode);
      return {
        id: v.id,
        clientUuid: v.clientUuid,
        clubId,
        testResultId: v.testResultId,
        metricDefinitionId: m.id,
        attemptNumber: v.attemptNumber,
        entryId: v.entryId,
        inputs: v.inputs,
        value: v.value,
        unit: m.unit,
        recordedAt: v.recordedAt,
      };
    }),
  );
  inserted.anthropometry = await insertRows(
    tx,
    anthroMeasurement,
    data.anthropometry.map((a) => ({
      id: a.id,
      clientUuid: a.clientUuid,
      clubId,
      playerId: a.playerId as PlayerId,
      measuredOn: a.measuredOn,
      heightCm: a.heightCm,
      sittingHeightCm: a.sittingHeightCm,
      weightKg: a.weightKg,
      skinfoldsSumMm: a.skinfoldsSumMm,
      method: 'manual' as const,
      evaluatorId: uid(a.evaluatorId),
    })),
  );
  inserted.referenceValues = await insertRows(
    tx,
    referenceValue,
    data.referenceValues.map((r) => {
      const m = metric(r.metricCode);
      return {
        id: r.id,
        clientUuid: r.clientUuid,
        clubId,
        metricDefinitionId: m.id,
        sport: r.sport,
        sex: r.sex,
        lineCode: r.lineCode,
        value: r.value,
        unit: m.unit,
        method: r.method,
        validFrom: r.validFrom,
        source: r.source,
      };
    }),
  );

  // Health data (ADR 0008): the medical schema, logged by its triggers.
  inserted.injuries = await insertRows(
    tx,
    medicalInjury,
    data.injuries.map((i) => ({ ...i, playerId: i.playerId as PlayerId, clubId })),
  );
  inserted.holds = await insertRows(
    tx,
    medicalHold,
    data.holds.map((h) => ({ ...h, playerId: h.playerId as PlayerId, clubId })),
  );

  // Forward transitions of rows the demo wrote earlier, never of anything else.
  const accounts = data.players.filter((p) => p.userId !== null);
  updated.playerAccounts = await move(
    tx,
    sql`update "player" p set "user_id" = v.user_id
          from unnest(${sql.param(accounts.map((p) => p.id))}::uuid[],
                      ${sql.param(accounts.map((p) => uid(p.userId ?? '')))}::text[]) as v(id, user_id)
         where p.club_id = ${clubId} and p.id = v.id and p.user_id is null`,
  );
  const leaving = [
    ...data.players.flatMap((p) =>
      p.leftOn === null || p.archivedAt === null
        ? []
        : [{ id: p.id, leftOn: p.leftOn, archivedAt: p.archivedAt }],
    ),
    ...data.departures.map((d) => ({ id: d.playerId, leftOn: d.leftOn, archivedAt: d.archivedAt })),
  ];
  updated.playerLeaves = await move(
    tx,
    sql`update "player" p set "left_on" = v.left_on, "left_reason" = 'graduated', "archived_at" = v.archived_at
          from unnest(${sql.param(leaving.map((p) => p.id))}::uuid[],
                      ${sql.param(leaving.map((p) => p.leftOn))}::date[],
                      ${sql.param(leaving.map((p) => p.archivedAt.toISOString()))}::timestamptz[]) as v(id, left_on, archived_at)
         where p.club_id = ${clubId} and p.id = v.id and p.left_on is null`,
  );
  // The category of a player who left ends the day after the leave.
  updated.playerCategories = await move(
    tx,
    sql`update "player_category" c set "valid_to" = v.left_on + 1
          from unnest(${sql.param(leaving.map((p) => p.id))}::uuid[],
                      ${sql.param(leaving.map((p) => p.leftOn))}::date[]) as v(id, left_on)
         where c.club_id = ${clubId} and c.player_id = v.id and c.valid_to is null
           and c.valid_from <= v.left_on`,
  );
  const closing = data.playerCategories.filter((c) => c.validTo !== null);
  updated.playerCategories += await move(
    tx,
    sql`update "player_category" c set "valid_to" = v.valid_to
          from unnest(${sql.param(closing.map((c) => c.id))}::uuid[],
                      ${sql.param(closing.map((c) => c.validTo))}::date[]) as v(id, valid_to)
         where c.club_id = ${clubId} and c.id = v.id and c.valid_to is null and v.valid_to > c.valid_from`,
  );
  // An open category of a season the window no longer reaches ends where the next one starts.
  updated.playerCategories += await move(
    tx,
    sql`update "player_category" c set "valid_to" = n.next_from
          from (select c2.id, min(l.valid_from) as next_from
                  from "player_category" c2
                  join "player_category" l on l.club_id = c2.club_id and l.player_id = c2.player_id
                                          and l.valid_from > c2.valid_from
                 where c2.club_id = ${clubId} and c2.valid_to is null
                 group by c2.id) n
         where c.club_id = ${clubId} and c.id = n.id`,
  );
  const healed = data.injuries.filter((i) => i.returnedOn !== null);
  updated.injuries = await move(
    tx,
    sql`update "medical"."injury" i set "returned_on" = v.returned_on
          from unnest(${sql.param(healed.map((i) => i.id))}::uuid[],
                      ${sql.param(healed.map((i) => i.returnedOn))}::date[]) as v(id, returned_on)
         where i.club_id = ${clubId} and i.id = v.id and i.returned_on is null`,
  );
  const completed = data.testSessions.filter((s) => s.status === 'completed');
  updated.testSessions = await move(
    tx,
    sql`update "test_session" s set "status" = 'completed', "started_at" = v.started_at, "completed_at" = v.completed_at
          from unnest(${sql.param(completed.map((s) => s.id))}::uuid[],
                      ${sql.param(completed.map((s) => s.startedAt?.toISOString()))}::timestamptz[],
                      ${sql.param(completed.map((s) => s.completedAt?.toISOString()))}::timestamptz[]) as v(id, started_at, completed_at)
         where s.club_id = ${clubId} and s.id = v.id and s.status = 'scheduled'`,
  );
  return { inserted, updated };
}

async function move(tx: SeedExecutor, statement: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(statement);
  return result.rowCount ?? 0;
}
