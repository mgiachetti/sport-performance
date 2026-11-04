import {
  MY_TEST_DAYS_HORIZON_DAYS,
  MY_TEST_DAYS_MAX,
  getMyPlayer,
  listMyTestDays,
  type MyPlayer,
  type MyTestDay,
} from '@sport-performance/contracts';
import { player, playerCategory, testSession, testWindow } from '@sport-performance/db/schema';
import {
  addDays,
  can,
  painReportModuleOn,
  wellnessItemSetForStage,
  type ClubId,
  type PermissionSubject,
  type PlayerFacts,
  type TestWindowNumber,
} from '@sport-performance/domain';
import { and, asc, eq, exists, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { loadPlayerFacts, type LoadedPlayer } from '../http/consents.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import type { RequestPermissions } from '../http/permissions.js';
import { batteryEntries, byBatteryOrder, scheduledTests } from './test-session-sheet.js';
import { loadStageSources, stageContext, stageContextOn } from './tests/model.js';
import { clubModules } from './pain-reports.js';
import { clubTimeZone } from './training-shared.js';
import { wellnessStageOf } from './wellness.js';

/**
 * The player app's own reads (B-503, ADR 0074): the caller's player profile
 * with today's stage, wellness item set and permissions, and their upcoming
 * test days. Only the `player` role, about themselves: the player id comes
 * from the membership, never from the request.
 */

interface OwnPlayer {
  readonly subject: PermissionSubject;
  readonly loaded: LoadedPlayer;
  /** The player's row, read once for both reads (name for the profile, sex for the battery). */
  readonly row: {
    readonly id: MyPlayer['player']['id'];
    readonly firstName: string;
    readonly lastName: string;
    readonly sex: MyPlayer['player']['sex'];
  };
}

/** The caller's own player, authorized to read their profile; any other role is `403`. */
async function ownPlayer(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
): Promise<OwnPlayer> {
  const subject = await permissions.subject();
  const playerId = subject.playerId ?? null;
  if (subject.role !== 'player' || playerId === null) {
    throw new HttpError('forbidden', 'Only a player reads their own profile here');
  }
  const loaded = await loadPlayerFacts(db, clubId, playerId);
  if (loaded === undefined) throw new HttpError('forbidden', 'The player is not visible');
  await permissions.authorize('player_profile', 'read', { player: loaded.facts });
  const [row] = await db
    .select({
      firstName: player.firstName,
      lastName: player.lastName,
      sex: player.sex,
    })
    .from(player)
    .where(and(eq(player.clubId, clubId), eq(player.id, playerId)));
  if (row === undefined) throw new HttpError('forbidden', 'The player is not visible');
  return { subject, loaded, row: { ...row, id: loaded.facts.id } };
}

export function registerMePlayerRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getMyPlayer, {
    transaction: true,
    handler: async (_input, { db, permissions, auth: caller }): Promise<MyPlayer> => {
      const { clubId } = caller.membership;
      const { subject, loaded, row } = await ownPlayer(db, permissions, clubId);
      const { facts, today } = loaded;
      // The item set is the one the server validates a check-in of today with.
      const wellnessStage = await wellnessStageOf(db, clubId, facts.id, today);
      // The percentiles depend on the stage and the age band of the category (from M15).
      const context = await stageContext(db, clubId, facts.id, today, null);
      const withStage: PlayerFacts =
        context === undefined
          ? facts
          : { ...facts, stage: context.stage, ageBand: context.ageBand };
      const set = wellnessStage === null ? null : wellnessItemSetForStage(wellnessStage);
      const target = (playerFacts: PlayerFacts) => ({ clubId, player: playerFacts });
      const modules = await clubModules(db, clubId);
      return {
        player: {
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          sport: facts.sport,
          sex: row.sex,
        },
        today,
        timeZone: await clubTimeZone(db, clubId),
        ofAge: facts.ofAge ?? false,
        categoryId: context?.categoryId ?? facts.categoryIds[0] ?? null,
        stage: wellnessStage,
        wellness: set === null ? null : { itemCount: set.itemCount, items: [...set.items] },
        permissions: {
          submitWellness:
            set !== null && can(subject, 'submit', { kind: 'wellness', ...target(facts) }),
          submitRpe: can(subject, 'submit', { kind: 'rpe', ...target(facts) }),
          readPercentiles: can(subject, 'read', { kind: 'percentile', ...target(withStage) }),
          // The pain report of the wellness (B-609): the club's modules and the matrix.
          reportPain:
            painReportModuleOn(modules) &&
            can(subject, 'submit', { kind: 'pain_report', ...target(facts) }),
          // Menstrual cycle tracking (B-806): offered to a female player when the club has
          // the module; the screen tells her what is missing (consents) and whether she uses it.
          menstrualCycle: modules.menstrual_cycle && row.sex === 'female',
        },
      };
    },
  });

  registerEndpoint(app, listMyTestDays, {
    transaction: true,
    handler: async (_input, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const { loaded, row: own } = await ownPlayer(db, permissions, clubId);
      const { facts, today } = loaded;
      const until = addDays(today, MY_TEST_DAYS_HORIZON_DAYS - 1);
      const rows = await db
        .select({
          id: testSession.id,
          sport: testSession.sport,
          categoryId: testSession.categoryId,
          scheduledOn: testSession.scheduledOn,
          status: testSession.status,
          location: testSession.location,
          testWindowId: testSession.testWindowId,
          windowNumber: testWindow.number,
        })
        .from(testSession)
        .leftJoin(
          testWindow,
          and(
            eq(testWindow.clubId, testSession.clubId),
            eq(testWindow.id, testSession.testWindowId),
            isNull(testWindow.archivedAt),
          ),
        )
        .where(
          and(
            eq(testSession.clubId, clubId),
            inArray(testSession.status, ['scheduled', 'in_progress']),
            gte(testSession.scheduledOn, today),
            lte(testSession.scheduledOn, until),
            // A day of a category the player is in on that day (as the sheet's roster).
            exists(
              db
                .select({ one: sql`1` })
                .from(playerCategory)
                .where(
                  and(
                    eq(playerCategory.clubId, testSession.clubId),
                    eq(playerCategory.playerId, facts.id),
                    eq(playerCategory.categoryId, testSession.categoryId),
                    lte(playerCategory.validFrom, testSession.scheduledOn),
                    or(
                      isNull(playerCategory.validTo),
                      sql`${playerCategory.validTo} > ${testSession.scheduledOn}`,
                    ),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(testSession.scheduledOn), asc(testSession.id))
        .limit(MY_TEST_DAYS_MAX);

      // The stage of each day (a category or a pinned stage can change before it).
      const sources = await loadStageSources(db, clubId, [facts.id]);
      const entriesBySport = new Map<string, Awaited<ReturnType<typeof batteryEntries>>>();
      const items: MyTestDay[] = [];
      for (const row of rows) {
        let entries = entriesBySport.get(row.sport);
        if (entries === undefined) {
          entries = await batteryEntries(db, clubId, row.sport);
          entriesBySport.set(row.sport, entries);
        }
        const stage = stageContextOn(sources, facts.id, row.scheduledOn, row.categoryId);
        const number = (row.windowNumber ?? null) as TestWindowNumber | null;
        const testCodes =
          stage === undefined
            ? []
            : scheduledTests(entries, clubId, own.sex, stage, row.scheduledOn, number).sort(
                byBatteryOrder,
              );
        items.push({
          id: row.id as MyTestDay['id'],
          scheduledOn: row.scheduledOn,
          status: row.status,
          location: row.location,
          testWindow:
            row.testWindowId === null || number === null
              ? null
              : {
                  id: row.testWindowId as NonNullable<MyTestDay['testWindow']>['id'],
                  number,
                  label: `V${String(number)}` as NonNullable<MyTestDay['testWindow']>['label'],
                },
          testCodes,
        });
      }
      return { today, items };
    },
  });
}
