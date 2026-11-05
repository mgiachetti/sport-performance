import { getUsageSummary, type UsageSummary } from '@sport-performance/contracts';
import {
  addDays,
  compareLocalDates,
  parseTimeZone,
  startOfIsoWeek,
  trainingAdoptionRates,
  usageRetainedFrom,
  type CategoryId,
  type LocalDate,
  type MembershipRole,
  type UsageClient,
  type UsageSurface,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { clubToday } from '../http/permissions.js';

/**
 * Usage metrics of the club (B-707, ADR 0093): adoption by club week, counts
 * only, for the administration. The outcomes are counted from their own
 * tables (participation and wellness, test results); the use of the surfaces
 * from `usage_activity` (per member, within the retention) and `usage_weekly`
 * (the counts the worker kept of older weeks). No row names a member or a
 * player; the administration sees the whole club under RLS, so the counts are
 * the club's.
 */

/** The weeks of the summary: `weeks` ISO weeks ending with the one of `weekOf`. */
export interface UsageRange {
  readonly today: LocalDate;
  readonly weekStarts: readonly LocalDate[];
  readonly from: LocalDate;
  readonly to: LocalDate;
}

export function usageRange(
  today: LocalDate,
  weekOf: LocalDate | undefined,
  weeks: number,
): UsageRange {
  const lastWeek = startOfIsoWeek(weekOf ?? today);
  if (compareLocalDates(lastWeek, today) > 0) {
    throw new HttpError('bad_request', 'The week asked for has not started yet');
  }
  const weekStarts = Array.from({ length: weeks }, (_, i) =>
    addDays(lastWeek, (i - weeks + 1) * 7),
  );
  const from = weekStarts[0] ?? lastWeek;
  return { today, weekStarts, from, to: addDays(lastWeek, 6) };
}

const week = (column: string) => sql.raw(`(date_trunc('week', ${column}::timestamp))::date::text`);

interface ClubRow extends Record<string, unknown> {
  time_zone: string;
  is_demo: boolean;
}

interface TrainingRow extends Record<string, unknown> {
  week_start: LocalDate;
  category_id: CategoryId | null;
  sessions: number;
  attended_player_days: number;
  attended_player_days_with_wellness: number;
  attended_participations: number;
  participations_with_rpe: number;
  rpe_via_kiosk: number;
}

/**
 * Sessions and matches of the range up to today (a future session expects
 * nothing yet), not archived, by the session's category: attended
 * participations (full or partial), how many have an RPE and, per player and
 * club day, whether the player loaded their wellness that day.
 */
async function readTraining(db: TenantDatabase, range: UsageRange): Promise<TrainingRow[]> {
  const { rows } = await db.execute<TrainingRow>(sql`
    select ${week('s.local_date')} as week_start, s.category_id,
           count(distinct s.id)::int as sessions,
           count(distinct p.player_id::text || ':' || s.local_date::text)
             filter (where p.status in ('full', 'partial'))::int as attended_player_days,
           count(distinct p.player_id::text || ':' || s.local_date::text)
             filter (where p.status in ('full', 'partial') and w.id is not null)::int
             as attended_player_days_with_wellness,
           count(p.id) filter (where p.status in ('full', 'partial'))::int as attended_participations,
           count(p.id) filter (where p.status in ('full', 'partial') and p.rpe is not null)::int
             as participations_with_rpe,
           count(p.id) filter (where p.rpe_via_kiosk)::int as rpe_via_kiosk
      from training_session s
      left join participation p on p.club_id = s.club_id and p.training_session_id = s.id
      left join wellness w on w.club_id = p.club_id and w.player_id = p.player_id
                          and w.local_date = s.local_date
     where s.archived_at is null
       and s.local_date between ${range.from}::date and least(${range.to}::date, ${range.today}::date)
     group by 1, 2
     order by 1, 2 nulls last`);
  return rows;
}

interface WellnessRow extends Record<string, unknown> {
  week_start: LocalDate;
  category_id: CategoryId | null;
  roster_players: number;
  responses: number;
  respondents: number;
  via_kiosk: number;
}

/**
 * Wellness check-ins of the range by the player's category that day, next to
 * the roster of each category in each week (players in it some day of the
 * week, without those who had left before it started).
 */
async function readWellness(db: TenantDatabase, range: UsageRange): Promise<WellnessRow[]> {
  const { rows } = await db.execute<WellnessRow>(sql`
    with weeks as (
      select d::date as week_start, (d + interval '6 days')::date as week_end
        from generate_series(${range.from}::date, ${range.to}::date, interval '7 days') d
    ), roster as (
      select wk.week_start, pc.category_id, count(distinct pc.player_id)::int as roster_players
        from weeks wk
        join player_category pc on pc.valid_from <= wk.week_end
                               and (pc.valid_to is null or pc.valid_to > wk.week_start)
        join player pl on pl.club_id = pc.club_id and pl.id = pc.player_id
       where pl.archived_at is null and (pl.left_on is null or pl.left_on >= wk.week_start)
       group by 1, 2
    ), responses as (
      select ${week('w.local_date')}::date as week_start, cat.category_id,
             count(*)::int as responses, count(distinct w.player_id)::int as respondents,
             count(*) filter (where w.via_kiosk)::int as via_kiosk
        from wellness w
        left join lateral (
          select pc.category_id from player_category pc
            join category c on c.club_id = pc.club_id and c.id = pc.category_id
           where pc.club_id = w.club_id and pc.player_id = w.player_id
             and pc.valid_from <= w.local_date
             and (pc.valid_to is null or pc.valid_to > w.local_date)
           order by c.sort_order, c.id limit 1
        ) cat on true
       where w.local_date between ${range.from}::date and ${range.to}::date
       group by 1, 2
    )
    select coalesce(r.week_start, x.week_start)::text as week_start,
           coalesce(r.category_id, x.category_id) as category_id,
           coalesce(r.roster_players, 0) as roster_players,
           coalesce(x.responses, 0) as responses, coalesce(x.respondents, 0) as respondents,
           coalesce(x.via_kiosk, 0) as via_kiosk
      from roster r
      full join responses x on x.week_start = r.week_start
                           and x.category_id is not distinct from r.category_id
     order by 1, 2 nulls last`);
  return rows;
}

interface TestRow extends Record<string, unknown> {
  week_start: LocalDate;
  category_id: CategoryId | null;
  test_days: number;
  results: number;
  players_tested: number;
  imported_results: number;
}

/**
 * Test results measured in the range, by the category of their test day:
 * test days with a result, results loaded (done or not done) and players; the
 * imported historical results apart (an import is not a test day loaded).
 */
async function readTests(db: TenantDatabase, range: UsageRange): Promise<TestRow[]> {
  const { rows } = await db.execute<TestRow>(sql`
    select ${week('r.measured_on')} as week_start, ts.category_id,
           count(distinct r.test_session_id) filter (where r.import_id is null)::int as test_days,
           count(*) filter (where r.import_id is null)::int as results,
           count(distinct r.player_id) filter (where r.import_id is null)::int as players_tested,
           count(*) filter (where r.import_id is not null)::int as imported_results
      from test_result r
      left join test_session ts on ts.club_id = r.club_id and ts.id = r.test_session_id
     where r.measured_on between ${range.from}::date and ${range.to}::date
     group by 1, 2
     order by 1, 2 nulls last`);
  return rows;
}

interface SurfaceRow extends Record<string, unknown> {
  week_start: LocalDate;
  surface: UsageSurface;
  client: UsageClient;
  role: MembershipRole;
  active_members: number;
  member_days: number;
  events: number;
}

/**
 * Use of the surfaces by week, surface, client and role: distinct members
 * from the activity rows of the weeks within the retention, the counts the
 * worker kept for the older ones. A week is folded whole, so it comes from one
 * source; if both had rows (a club that changed its time zone), they add up.
 */
async function readSurfaces(db: TenantDatabase, range: UsageRange): Promise<SurfaceRow[]> {
  const { rows } = await db.execute<SurfaceRow>(sql`
    select week_start::text as week_start, surface, client, role,
           sum(active_members)::int as active_members, sum(member_days)::int as member_days,
           sum(events)::int as events
      from (
        select (date_trunc('week', a.local_date::timestamp))::date as week_start, a.surface,
               a.client, a.role, count(distinct a.membership_id) as active_members,
               count(*) as member_days, sum(a.events_n) as events
          from usage_activity a
         where a.local_date between ${range.from}::date and ${range.to}::date
         group by 1, 2, 3, 4
        union all
        select u.week_start, u.surface, u.client, u.role, u.active_members_n, u.member_days_n,
               u.events_n
          from usage_weekly u
         where u.week_start between ${range.from}::date and ${range.to}::date
      ) x
     group by 1, 2, 3, 4
     order by 1, 2, 3, 4`);
  return rows;
}

interface MembersRow extends Record<string, unknown> {
  week_start: LocalDate;
  role: MembershipRole;
  members: number;
}

/** Memberships active some time of each week, by role (the denominators of the use). */
async function readMembers(db: TenantDatabase, range: UsageRange, timeZone: string) {
  const { rows } = await db.execute<MembersRow>(sql`
    with weeks as (
      select d::date as week_start from generate_series(
        ${range.from}::date, ${range.to}::date, interval '7 days') d
    )
    select wk.week_start::text as week_start, m.role, count(*)::int as members
      from weeks wk
      join membership m
        on m.started_at < ((wk.week_start + 7)::timestamp at time zone ${timeZone})
       and (m.ended_at is null or m.ended_at > (wk.week_start::timestamp at time zone ${timeZone}))
     group by 1, 2
     order by 1, 2`);
  return rows;
}

interface CategoryRow extends Record<string, unknown> {
  id: CategoryId;
  name: string;
  sport: UsageSummary['categories'][number]['sport'];
  sex: UsageSummary['categories'][number]['sex'];
}

async function readCategories(db: TenantDatabase, ids: readonly CategoryId[]) {
  if (ids.length === 0) return [];
  const { rows } = await db.execute<CategoryRow>(sql`
    select id, name, sport, sex from category
     where id = any(${`{${ids.join(',')}}`}::uuid[])
     order by sport, sex, sort_order, name`);
  return rows;
}

export function registerUsageRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getUsageSummary, {
    transaction: true,
    handler: async ({ query }, { db, permissions }): Promise<UsageSummary> => {
      await permissions.authorize('usage_metrics', 'read');
      const range = usageRange(await clubToday(db), query.weekOf, query.weeks);
      const { rows: clubs } = await db.execute<ClubRow>(
        sql`select time_zone, is_demo from club where id = app.current_club_id()`,
      );
      const club = clubs[0];
      if (club === undefined)
        throw new HttpError('forbidden', 'The club of the request is not visible');

      const training = await readTraining(db, range);
      const wellness = await readWellness(db, range);
      const tests = await readTests(db, range);
      const surfaces = await readSurfaces(db, range);
      const members = await readMembers(db, range, club.time_zone);
      const categoryIds = [
        ...new Set(
          [...training, ...wellness, ...tests]
            .map((r) => r.category_id)
            .filter((id): id is CategoryId => id !== null),
        ),
      ].sort();

      return {
        timeZone: parseTimeZone(club.time_zone),
        today: range.today,
        isDemo: club.is_demo,
        weeks: range.weekStarts.map((weekStart) => ({ weekStart, weekEnd: addDays(weekStart, 6) })),
        usageRetainedFrom: usageRetainedFrom(range.today),
        categories: await readCategories(db, categoryIds),
        training: training.map((r) => {
          const counts = {
            attendedPlayerDays: r.attended_player_days,
            attendedPlayerDaysWithWellness: r.attended_player_days_with_wellness,
            attendedParticipations: r.attended_participations,
            participationsWithRpe: r.participations_with_rpe,
          };
          const rates = trainingAdoptionRates(counts);
          return {
            weekStart: r.week_start,
            categoryId: r.category_id,
            sessions: r.sessions,
            ...counts,
            rpeViaKiosk: r.rpe_via_kiosk,
            wellnessOnSessionDaysRate: rates.wellnessOnSessionDays,
            rpeRate: rates.rpe,
          };
        }),
        wellness: wellness.map((r) => ({
          weekStart: r.week_start,
          categoryId: r.category_id,
          rosterPlayers: r.roster_players,
          responses: r.responses,
          respondents: r.respondents,
          viaKiosk: r.via_kiosk,
        })),
        tests: tests
          .filter((r) => r.results > 0 || r.imported_results > 0)
          .map((r) => ({
            weekStart: r.week_start,
            categoryId: r.category_id,
            testDays: r.test_days,
            results: r.results,
            playersTested: r.players_tested,
            importedResults: r.imported_results,
          })),
        surfaces: surfaces.map((r) => ({
          weekStart: r.week_start,
          surface: r.surface,
          client: r.client,
          role: r.role,
          activeMembers: r.active_members,
          memberDays: r.member_days,
          events: r.events,
        })),
        members: members.map((r) => ({
          weekStart: r.week_start,
          role: r.role,
          members: r.members,
        })),
      };
    },
  });
}
