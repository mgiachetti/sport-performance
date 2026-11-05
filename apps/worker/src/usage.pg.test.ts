/**
 * Usage retention through the worker's login (B-707, ADR 0093): the weeks
 * past the retention become counts per week, surface, client and role without
 * members, and their per-member rows are deleted; the recent weeks stay
 * untouched; a second run changes nothing; another club is not touched.
 */
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import { USAGE_ACTIVITY_RETENTION_DAYS, parseClubId, type ClubId } from '@sport-performance/domain';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foldClubUsage } from './usage.js';

const serverUrl = process.env.DATABASE_URL;
const hasDatabase = serverUrl !== undefined && serverUrl.trim() !== '';
if (!hasDatabase && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL is required in CI: the worker tests run against real Postgres.');
}

const logger = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('usage retention (Postgres 16)', () => {
  let temporary: TemporaryDatabase;
  let owner: pg.Pool;
  let worker: pg.Pool;
  let clubA: ClubId;
  let clubB: ClubId;
  /** Monday of a week well past the retention, in the club's zone. */
  let oldMonday = '';

  async function club(slug: string): Promise<ClubId> {
    const { rows } = await owner.query<{ id: ClubId }>(
      `insert into club (slug, name, short_name) values ($1, $1, upper($1)) returning id`,
      [slug],
    );
    return parseClubId(rows[0]?.id);
  }

  async function member(clubId: ClubId, email: string, role: string): Promise<string> {
    const { rows: users } = await owner.query<{ id: string }>(
      `insert into "user" (name, email) values ($1, $1) returning id`,
      [email],
    );
    const { rows } = await owner.query<{ id: string }>(
      `insert into membership (club_id, user_id, role) values ($1, $2, $3) returning id`,
      [clubId, users[0]?.id, role],
    );
    return rows[0]?.id ?? '';
  }

  async function use(
    clubId: ClubId,
    membershipId: string,
    role: string,
    day: string,
    client: string,
    events: number,
  ) {
    await owner.query(
      `insert into usage_activity (club_id, membership_id, role, local_date, surface, client,
                                   events_n)
       values ($1, $2, $3, $4, 'panel', $5, $6)`,
      [clubId, membershipId, role, day, client, events],
    );
  }

  beforeAll(async () => {
    if (serverUrl === undefined) return;
    temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_worker_usage' });
    owner = temporary.pool({ max: 2 });
    const workerLogin = await temporary.login('worker');
    worker = temporary.pool({ connectionString: workerLogin.connectionString, max: 2 });
    clubA = await club('usage-a');
    clubB = await club('usage-b');
    const { rows } = await owner.query<{ monday: string }>(
      `select (date_trunc('week', (now() at time zone time_zone)::date - $2::int)::date)::text
              as monday
         from club where id = $1`,
      [clubA, USAGE_ACTIVITY_RETENTION_DAYS + 30],
    );
    oldMonday = rows[0]?.monday ?? '';

    const coach1 = await member(clubA, 'c1@usage.example.com', 'coach');
    const coach2 = await member(clubA, 'c2@usage.example.com', 'coach');
    const player = await member(clubA, 'p1@usage.example.com', 'player');
    const day = (offset: number) =>
      new Date(Date.parse(`${oldMonday}T00:00:00Z`) + offset * 86_400_000)
        .toISOString()
        .slice(0, 10);
    // An old week: coach 1 on Monday and Wednesday (web), coach 2 on Tuesday (web and app),
    // the player on Friday (app).
    await use(clubA, coach1, 'coach', day(0), 'web', 3);
    await use(clubA, coach1, 'coach', day(2), 'web', 1);
    await use(clubA, coach2, 'coach', day(1), 'web', 2);
    await use(clubA, coach2, 'coach', day(1), 'app', 1);
    await use(clubA, player, 'player', day(4), 'app', 4);
    // Today: kept.
    const { rows: today } = await owner.query<{ day: string }>(
      `select ((now() at time zone time_zone)::date)::text as day from club where id = $1`,
      [clubA],
    );
    await use(clubA, coach1, 'coach', today[0]?.day ?? '', 'web', 1);
    // Club B, also old: not touched by club A's job.
    const coachB = await member(clubB, 'cb@usage.example.com', 'coach');
    await use(clubB, coachB, 'coach', day(0), 'web', 1);
  }, 120_000);

  afterAll(async () => {
    await temporary.drop();
  });

  it('folds the old weeks into counts without members and keeps the recent ones', async () => {
    const report = await foldClubUsage({ pool: worker, logger }, clubA, { jobId: 'test-1' });
    expect(report.folded).toBe(5);
    expect(report.weeks).toBe(3);
    const { rows } = await owner.query(
      `select week_start::text, surface::text, client::text, role::text, active_members_n,
              member_days_n, events_n
         from usage_weekly where club_id = $1 order by role, client`,
      [clubA],
    );
    expect(rows).toEqual([
      {
        week_start: oldMonday,
        surface: 'panel',
        client: 'app',
        role: 'coach',
        active_members_n: 1,
        member_days_n: 1,
        events_n: 1,
      },
      {
        week_start: oldMonday,
        surface: 'panel',
        client: 'web',
        role: 'coach',
        active_members_n: 2,
        member_days_n: 3,
        events_n: 6,
      },
      {
        week_start: oldMonday,
        surface: 'panel',
        client: 'app',
        role: 'player',
        active_members_n: 1,
        member_days_n: 1,
        events_n: 4,
      },
    ]);
    const left = await owner.query<{ club_id: string; n: number }>(
      `select club_id, count(*)::int as n from usage_activity group by club_id order by club_id`,
    );
    expect(Object.fromEntries(left.rows.map((r) => [r.club_id, r.n]))).toEqual({
      [clubA]: 1,
      [clubB]: 1,
    });
  });

  it('a second run changes nothing', async () => {
    const report = await foldClubUsage({ pool: worker, logger }, clubA);
    expect(report).toMatchObject({ folded: 0, weeks: 0 });
    const { rows } = await owner.query<{ n: number }>(
      `select sum(events_n)::int as n from usage_weekly where club_id = $1`,
      [clubA],
    );
    expect(rows[0]?.n).toBe(11);
  });
});
