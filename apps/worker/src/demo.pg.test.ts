/**
 * The demo club through the real worker (B-307, ADR 0055; B-326, ADR 0046):
 * the seed only writes raw data and the outbox marks, and the worker's login
 * turns them into the derived tables the panel and the alerts (#58) read,
 * with every scenario of the demo visible there: ACWR above and below the
 * defaults, insufficient history, wellness low in absolute terms and against
 * the player's own mean, and growth velocity of the anthropometry.
 */
import { createDatabase, type Database } from '@sport-performance/db';
import { seedDemoClub } from '@sport-performance/db/seeds';
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import { addDays, parseLocalDate, type ClubId, type LocalDate } from '@sport-performance/domain';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshClub } from './derived/refresh.js';

const serverUrl = process.env.DATABASE_URL;
const hasDatabase = serverUrl !== undefined && serverUrl.trim() !== '';
if (!hasDatabase && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL is required in CI: the worker tests run against real Postgres.');
}

const logger = pino({ level: 'silent' });
const AS_OF: LocalDate = parseLocalDate('2026-06-08');
/** 23:00 in Buenos Aires (UTC−3) on the demo's last day. */
const NOW = new Date('2026-06-09T02:00:00Z');

describe.skipIf(!hasDatabase)('the demo club through the worker (Postgres 16)', () => {
  let temporary: TemporaryDatabase;
  let owner: pg.Pool;
  let ownerDb: Database;
  let worker: pg.Pool;
  let clubId: ClubId;

  const count = async (query: string, params: readonly unknown[] = [clubId]) => {
    const { rows } = await owner.query<{ n: string }>(query, [...params]);
    return Number(rows[0]?.n ?? 0);
  };

  beforeAll(async () => {
    if (serverUrl === undefined) return;
    temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_worker_demo' });
    owner = temporary.pool({ max: 3 });
    ownerDb = createDatabase(owner);
    const workerLogin = await temporary.login('worker');
    worker = temporary.pool({ connectionString: workerLogin.connectionString, max: 3 });
    const report = await seedDemoClub(ownerDb, {
      asOf: AS_OF,
      historyDays: 56,
      seasons: 1,
      playersPerCohort: { rugby: 6, hockey: 6 },
    });
    clubId = report.clubId;
  }, 300_000);

  afterAll(async () => {
    await temporary.drop();
  });

  it('computes every derived value from the outbox and leaves nothing pending', async () => {
    expect(
      await count('select count(*)::text as n from derived_refresh where club_id = $1'),
    ).toBeGreaterThan(0);
    expect(
      await count('select count(*)::text as n from player_load_daily where club_id = $1'),
    ).toBe(0);
    // The seed writes no alerts: the worker derives them (ADR 0053).
    expect(await count('select count(*)::text as n from alert where club_id = $1')).toBe(0);

    const report = await refreshClub({ pool: worker, logger, now: () => NOW }, clubId);
    expect(report.failed).toBe(0);
    expect(report.players).toBeGreaterThan(0);
    expect(await count('select count(*)::text as n from derived_refresh where club_id = $1')).toBe(
      0,
    );

    // Load: yesterday's ACWR is the comparable one (today's RPE is still to come).
    const yesterday = addDays(AS_OF, -1);
    const acwr = async (where: string) =>
      count(
        `select count(*)::text as n from player_load_daily
          where club_id = $1 and local_date = $2::date and ${where}`,
        [clubId, yesterday],
      );
    expect(await acwr(`acwr_status = 'ok' and acwr > 1.3`)).toBeGreaterThan(0);
    expect(await acwr(`acwr_status = 'ok' and acwr < 0.8`)).toBeGreaterThan(0);
    expect(await acwr(`acwr_status = 'insufficient_history'`)).toBeGreaterThan(0);
    // Most of the squad has enough history for an ACWR.
    expect(await acwr(`acwr_status = 'ok'`)).toBeGreaterThan(await acwr(`acwr_status <> 'ok'`));

    // Wellness: low in absolute terms and low against the player's own mean, in the last week.
    const wellness = async (where: string) =>
      count(
        `select count(distinct player_id)::text as n from player_wellness_daily
          where club_id = $1 and local_date > $2::date and ${where}`,
        [clubId, addDays(AS_OF, -7)],
      );
    expect(await wellness('mean_score < 3.0')).toBeGreaterThan(0);
    expect(await wellness('z_score is not null and z_score < -1')).toBeGreaterThan(0);

    // Maturation: the worker derived the PHV offset and the growth velocity.
    expect(
      await count(
        `select count(*)::text as n from anthro_measurement
          where club_id = $1 and phv_offset_years is not null and growth_velocity_cm_year is not null`,
      ),
    ).toBeGreaterThan(0);

    // Alerts: the recalculation evaluated the rules and opened episodes of both severities.
    const openAlerts = async (severity: 'critical' | 'warning') =>
      count(
        `select count(*)::text as n from alert
          where club_id = $1 and resolved_on is null and current_severity = $2`,
        [clubId, severity],
      );
    expect(await openAlerts('critical')).toBeGreaterThan(0);
    expect(await openAlerts('warning')).toBeGreaterThan(0);

    // Running the job again recomputes the same values and finds nothing new to do.
    const again = await refreshClub({ pool: worker, logger, now: () => NOW }, clubId);
    expect(again.failed).toBe(0);
  }, 300_000);
});
