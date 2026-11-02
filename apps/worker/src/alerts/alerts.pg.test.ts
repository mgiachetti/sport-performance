/**
 * Alert generation against Postgres 16 (B-327, ADR 0053), through the real
 * connection roles: the club's seeded rules (ADR 0022) are evaluated by the
 * worker's login from the derived tables, episodes open, continue, escalate
 * and resolve, and every change leaves an event.
 */
import { randomUUID } from 'node:crypto';
import { createDatabase, schema, type Database } from '@sport-performance/db';
import { bootstrapClub } from '@sport-performance/db/seeds';
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import {
  addDays,
  parseLocalDate,
  parseTimeZone,
  type ClubId,
  type LocalDate,
  type PlayerId,
} from '@sport-performance/domain';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inClubTransaction } from '../database.js';
import { refreshClub } from '../derived/refresh.js';
import { InvalidAlertRuleError, readAlertRules } from './evaluate.js';

const { club, membership, player, user } = schema;

const serverUrl = process.env.DATABASE_URL;
const hasDatabase = serverUrl !== undefined && serverUrl.trim() !== '';
if (!hasDatabase && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL is required in CI: the worker tests run against real Postgres.');
}

const d = (value: string): LocalDate => parseLocalDate(value);
/** 20:00 in Buenos Aires (UTC−3) on 2026-03-20: the club's day is the 20th. */
const NOW = new Date('2026-03-20T23:00:00Z');
const TODAY = d('2026-03-20');
/** The next club day. */
const TOMORROW_NOW = new Date('2026-03-21T23:00:00Z');
const TOMORROW = d('2026-03-21');

const logger = pino({ level: process.env.TEST_LOG_LEVEL === 'error' ? 'error' : 'silent' });

interface AlertRow {
  kind: string;
  severity: string;
  current_severity: string;
  local_date: string;
  last_seen_on: string;
  resolved_on: string | null;
  observed_on: string;
  status: string;
  values: Record<string, number>;
}

describe.skipIf(!hasDatabase)('alert generation in the worker (Postgres 16)', () => {
  let temporary: TemporaryDatabase;
  let owner: pg.Pool;
  let ownerDb: Database;
  let app: pg.Pool;
  let worker: pg.Pool;
  let clubId: ClubId;
  let adminId: string;
  const players: Record<string, PlayerId> = {};

  async function asApi<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query(
        `select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', 'admin', true)`,
        [clubId, adminId],
      );
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async function newPlayer(birthDate = '2009-04-15'): Promise<PlayerId> {
    const [row] = await ownerDb
      .insert(player)
      .values({
        clubId,
        firstName: 'Jugador',
        lastName: randomUUID().slice(0, 8),
        birthDate: d(birthDate),
        sex: 'male',
        sport: 'rugby',
        joinedOn: d('2025-01-01'),
      })
      .returning({ id: player.id });
    if (row === undefined) throw new Error('no player');
    return row.id;
  }

  /** One training per day in `[from, to]` with the same RPE and minutes. */
  async function trainDaily(
    playerId: PlayerId,
    from: string,
    to: string,
    rpe: number,
    minutes: number,
  ) {
    await owner.query(
      `with s as (
         insert into training_session (club_id, sport, kind, starts_at, local_date)
         select $1, 'rugby', 'training', (day + time '15:00') at time zone 'UTC', day::date
           from generate_series($3::date, $4::date, interval '1 day') as day
         returning id)
       insert into participation (club_id, training_session_id, player_id, status, minutes, rpe, rpe_reported_at)
       select $1, s.id, $2, 'full', $5, $6, now() from s`,
      [clubId, playerId, from, to, minutes, rpe],
    );
  }

  async function wellnessOn(playerId: PlayerId, day: LocalDate, score: number) {
    await owner.query(
      `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness, stress, mood)
       values ($1, $2, $3, 5, $4, $4, $4, $4, $4)
       on conflict (club_id, player_id, local_date)
       do update set sleep = $4, fatigue = $4, soreness = $4, stress = $4, mood = $4`,
      [clubId, playerId, day, score],
    );
  }

  async function cmjOn(playerId: PlayerId, day: string, heightsCm: number[], method = 'app') {
    const { rows } = await owner.query<{ id: string }>(
      `insert into test_result (club_id, player_id, test_definition_id, measured_on, status, method)
       select $1, $2, d.id, $3, 'done', $4
         from test_definition d where d.club_id = $1 and d.code = 'cmj' and d.version = 1
       returning id`,
      [clubId, playerId, day, method],
    );
    const resultId = rows[0]?.id;
    if (resultId === undefined) throw new Error('no cmj test definition');
    for (const [index, height] of heightsCm.entries()) {
      await owner.query(
        `insert into test_result_value (club_id, test_result_id, metric_definition_id, attempt_number, value, unit)
         select $1, $2, m.id, $3, $4, 'cm'
           from metric_definition m where m.club_id = $1 and m.code = 'cmj_height_cm'`,
        [clubId, resultId, index + 1, height],
      );
    }
  }

  async function alertsOf(playerId: PlayerId): Promise<AlertRow[]> {
    const { rows } = await owner.query<AlertRow>(
      `select kind::text, severity::text, current_severity::text, local_date::text,
              last_seen_on::text, resolved_on::text, observed_on::text, status::text, values
         from alert where player_id = $1 order by kind, local_date`,
      [playerId],
    );
    return rows;
  }

  async function eventsOf(playerId: PlayerId) {
    const { rows } = await owner.query<{ kind: string; type: string; local_date: string }>(
      `select a.kind::text, e.type::text, e.local_date::text
         from alert_event e join alert a on a.id = e.alert_id
        where e.player_id = $1 order by e.seq`,
      [playerId],
    );
    return rows;
  }

  async function skippedOf(playerId: PlayerId) {
    const { rows } = await owner.query<{
      evaluated_on: string;
      skipped: { ruleCode: string; reason: string }[];
    }>('select evaluated_on::text, skipped from player_alert_evaluation where player_id = $1', [
      playerId,
    ]);
    return rows[0];
  }

  const deps = (now: Date = NOW) => ({ pool: worker, logger, now: () => now });

  beforeAll(async () => {
    if (serverUrl === undefined) return;
    temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_worker_alerts' });
    owner = temporary.pool({ max: 3 });
    ownerDb = createDatabase(owner);
    app = temporary.pool({ connectionString: (await temporary.login('app')).connectionString });
    worker = temporary.pool({
      connectionString: (await temporary.login('worker')).connectionString,
      max: 4,
    });
    const [row] = await ownerDb
      .insert(club)
      .values({
        slug: 'club-alertas',
        name: 'Club Alertas',
        shortName: 'CA',
        timeZone: parseTimeZone('America/Argentina/Buenos_Aires'),
      })
      .returning({ id: club.id });
    clubId = row?.id as ClubId;
    await bootstrapClub(ownerDb, { clubId, branches: [{ sport: 'rugby', sex: 'male' }] });
    adminId = `admin-${randomUUID()}`;
    await ownerDb
      .insert(user)
      .values({ id: adminId, name: 'Admin', email: `${adminId}@example.com` });
    await ownerDb.insert(membership).values({ clubId, userId: adminId, role: 'admin' });

    players.shortHistory = await newPlayer();
    players.spike = await newPlayer();
    players.wellness = await newPlayer();
    players.cmj = await newPlayer();
    players.growth = await newPlayer('2012-05-10');
  });

  afterAll(async () => {
    await temporary.drop();
  });

  it('evaluates the seeded rules: no ACWR alert with insufficient history, red with a spike', async () => {
    await trainDaily(players.shortHistory ?? never(), '2026-03-11', '2026-03-20', 9, 100);
    await trainDaily(players.spike ?? never(), '2026-02-10', '2026-03-13', 4, 60);
    await trainDaily(players.spike ?? never(), '2026-03-14', '2026-03-20', 9, 100);
    await refreshClub(deps(), clubId);

    const short = players.shortHistory ?? never();
    expect((await alertsOf(short)).filter((a) => a.kind.startsWith('acwr'))).toEqual([]);
    const evaluation = await skippedOf(short);
    expect(evaluation?.evaluated_on).toBe('2026-03-20');
    expect(evaluation?.skipped).toContainEqual(
      expect.objectContaining({ ruleCode: 'acwr_high', reason: 'insufficient_history' }),
    );

    const spike = players.spike ?? never();
    const { rows } = await owner.query<{ acwr: number; history_days: number }>(
      `select acwr, history_days from player_load_daily where player_id = $1 and local_date = $2`,
      [spike, TODAY],
    );
    const acwr = rows[0]?.acwr ?? 0;
    expect(rows[0]?.history_days).toBeGreaterThanOrEqual(28);
    expect(acwr).toBeGreaterThan(1.4);
    const alerts = await alertsOf(spike);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'acwr_high',
      severity: 'critical',
      current_severity: 'critical',
      local_date: '2026-03-20',
      last_seen_on: '2026-03-20',
      resolved_on: null,
      status: 'open',
      values: { acwrRatio: acwr, thresholdRatio: 1.4 },
    });
    expect(await eventsOf(spike)).toEqual([
      { kind: 'acwr_high', type: 'raised', local_date: '2026-03-20' },
    ]);
  });

  it('wellness: absolute and against the player’s own baseline; a same-day correction escalates', async () => {
    const id = players.wellness ?? never();
    for (let i = 0; i < 12; i++) {
      await wellnessOn(id, addDays(d('2026-03-08'), i), i % 2 === 0 ? 4 : 5);
    }
    await wellnessOn(id, TODAY, 3);
    await refreshClub(deps(), clubId);
    const alerts = await alertsOf(id);
    expect(alerts.map((a) => [a.kind, a.severity])).toEqual([
      ['wellness_low', 'warning'],
      ['wellness_zscore_low', 'warning'],
    ]);
    const zscore = alerts[1]?.values;
    expect(zscore?.wellnessScore).toBe(3);
    expect(zscore?.meanScore).toBeCloseTo(4.5, 9);
    expect(zscore?.zScore).toBeLessThan(-1.5);

    // The player corrects today's check-in: below 3.0 is red, and the episode escalates.
    await wellnessOn(id, TODAY, 2);
    await refreshClub(deps(), clubId);
    const after = await alertsOf(id);
    expect(after.map((a) => [a.kind, a.severity, a.local_date])).toEqual([
      ['wellness_low', 'critical', '2026-03-20'],
      ['wellness_zscore_low', 'warning', '2026-03-20'],
    ]);
    expect((await eventsOf(id)).map((e) => `${e.kind}:${e.type}`)).toEqual([
      'wellness_low:raised',
      'wellness_zscore_low:raised',
      'wellness_low:escalated',
    ]);
  });

  it('CMJ against the baseline of the same method only (principle 4)', async () => {
    const id = players.cmj ?? never();
    await cmjOn(id, '2026-03-01', [39, 40, 38]);
    await cmjOn(id, '2026-03-06', [40]);
    await cmjOn(id, '2026-03-10', [40, 39]);
    // Another method: with it the baseline would be 37,5 cm and the drop under 7 %.
    await cmjOn(id, '2026-03-12', [30], 'video');
    await cmjOn(id, '2026-03-18', [35, 36]);
    const { rows } = await owner.query<{ alerts: boolean }>(
      'select alerts from derived_refresh where player_id = $1',
      [id],
    );
    expect(rows[0]?.alerts).toBe(true);
    await refreshClub(deps(), clubId);
    const alerts = await alertsOf(id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: 'cmj_drop',
      severity: 'warning',
      observed_on: '2026-03-18',
      values: { heightCm: 36, baselineHeightCm: 40, dropPct: 10, baselineSamples: 3 },
    });
  });

  it('growth velocity in the peak zone, and a disabled rule resolves its alerts', async () => {
    const id = players.growth ?? never();
    await owner.query(
      `insert into anthro_measurement (club_id, player_id, measured_on, height_cm, sitting_height_cm, weight_kg)
       values ($1, $2, '2025-11-20', 150, 78, 42), ($1, $2, '2026-03-20', 153.5, 80, 44)`,
      [clubId, id],
    );
    await refreshClub(deps(), clubId);
    const alerts = await alertsOf(id);
    expect(alerts.map((a) => [a.kind, a.severity, a.observed_on])).toEqual([
      ['growth_peak', 'warning', '2026-03-20'],
    ]);
    expect(alerts[0]?.values.velocityCmYear).toBeCloseTo(3.5 / (120 / 365.25), 9);

    // The club turns the rule off (as the API): every player is marked, the episode resolves.
    await asApi((client) =>
      client.query(`update alert_rule set enabled = false where code = 'growth_peak'`),
    );
    await refreshClub(deps(), clubId);
    expect((await alertsOf(id))[0]).toMatchObject({ resolved_on: '2026-03-20' });
    expect((await skippedOf(id))?.skipped).toContainEqual(
      expect.objectContaining({ ruleCode: 'growth_peak', reason: 'disabled' }),
    );
    // On again the same day: the same episode reopens instead of a second one.
    await asApi((client) =>
      client.query(`update alert_rule set enabled = true where code = 'growth_peak'`),
    );
    await refreshClub(deps(), clubId);
    expect((await alertsOf(id)).map((a) => a.resolved_on)).toEqual([null]);
    expect((await eventsOf(id)).map((e) => e.type)).toEqual(['raised', 'resolved', 'reopened']);
  });

  it('is idempotent: evaluating the same day again changes nothing', async () => {
    const before = await owner.query<{ n: number }>('select count(*)::int as n from alert_event');
    const alerts = await owner.query('select * from alert order by id');
    // Force a re-evaluation of everyone (as a rule edit would), then the plain job.
    await asApi((client) =>
      client.query(`update alert_rule set params = params where code = 'acwr_high'`),
    );
    await refreshClub(deps(), clubId);
    await refreshClub(deps(), clubId);
    const after = await owner.query<{ n: number }>('select count(*)::int as n from alert_event');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
    expect((await owner.query('select * from alert order by id')).rows).toEqual(alerts.rows);
  });

  it('an invalid rule edited by hand fails the job loudly', async () => {
    await owner.query(
      `update alert_rule set params = params || '{"warningAboveRatoi": 1.2}' where club_id = $1 and code = 'acwr_high'`,
      [clubId],
    );
    try {
      await expect(
        inClubTransaction(worker, clubId, (tx) => readAlertRules(tx)),
      ).rejects.toBeInstanceOf(InvalidAlertRuleError);
      await expect(refreshClub(deps(), clubId)).rejects.toThrow(/acwr_high/);
    } finally {
      await owner.query(
        `update alert_rule set params = params - 'warningAboveRatoi' where club_id = $1 and code = 'acwr_high'`,
        [clubId],
      );
    }
    await refreshClub(deps(), clubId);
  });

  it('the next club day: the daily pass continues, resolves and stops at a leave', async () => {
    // The CMJ player leaves the club tomorrow.
    await owner.query(
      'update player set left_on = $2, left_reason = $3, archived_at = now() where id = $1',
      [players.cmj, TOMORROW, 'other'],
    );
    const report = await refreshClub(deps(TOMORROW_NOW), clubId);
    expect(report.today).toBe(TOMORROW);
    for (const id of Object.values(players)) {
      expect((await skippedOf(id))?.evaluated_on).toBe('2026-03-21');
    }
    // No check-in today: yesterday's wellness alerts resolve.
    const wellness = await alertsOf(players.wellness ?? never());
    expect(wellness.map((a) => a.resolved_on)).toEqual(['2026-03-21', '2026-03-21']);
    // The growth measurement is still recent: the same episode continues.
    expect((await alertsOf(players.growth ?? never()))[0]).toMatchObject({
      local_date: '2026-03-20',
      last_seen_on: '2026-03-21',
      resolved_on: null,
    });
    // A player who left is no longer evaluated: their alert resolves.
    expect((await alertsOf(players.cmj ?? never()))[0]).toMatchObject({
      resolved_on: '2026-03-21',
    });
    // Going back to yesterday never rewrites what the episodes already know.
    const events = await owner.query<{ n: number }>('select count(*)::int as n from alert_event');
    await refreshClub(deps(NOW), clubId);
    const again = await owner.query<{ n: number }>('select count(*)::int as n from alert_event');
    expect(again.rows[0]?.n).toBe(events.rows[0]?.n);
  });
});

function never(): never {
  throw new Error('missing fixture');
}
