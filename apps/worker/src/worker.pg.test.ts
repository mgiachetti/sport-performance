/**
 * The worker against Postgres 16 (B-326, ADR 0046), through the real
 * connection roles (ADR 0026): writes as the API mark players in their own
 * transaction, the worker's login recalculates load, wellness and maturation
 * for one club at a time, closes marks with compare-and-delete, extends the
 * series to the club's day, and the whole loop runs on a real pg-boss.
 */
import { randomUUID } from 'node:crypto';
import { assertConnectionRole, createDatabase, schema, type Database } from '@sport-performance/db';
import { khamisRocheCoefficientSeeds, khamisRocheTableSeed } from '@sport-performance/db/seeds';
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import {
  KHAMIS_ROCHE_1994_TABLE,
  addDays,
  computeLoadSeries,
  parseLocalDate,
  parseTimeZone,
  type ClubId,
  type LocalDate,
  type PlayerId,
} from '@sport-performance/domain';
import pg from 'pg';
import type { ObjectStorage } from '@sport-performance/storage';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inClubTransaction } from './database.js';
import { ClubRefreshError, refreshClub, refreshPlayer } from './derived/refresh.js';
import { DERIVED_REFRESH_CHANNEL } from './listener.js';
import { disabledErrorReporter } from './observability.js';
import { purgeClubFiles } from './files.js';
import { listClubs } from './queues.js';
import { startWorker } from './worker.js';

const { club, membership, player, playerParentHeight, trainingSession, user } = schema;

const serverUrl = process.env.DATABASE_URL;
const hasDatabase = serverUrl !== undefined && serverUrl.trim() !== '';
if (!hasDatabase && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL is required in CI: the worker tests run against real Postgres.');
}

const d = (value: string): LocalDate => parseLocalDate(value);
/** 20:00 in Buenos Aires (UTC−3) on 2026-03-20: the club's day is the 20th. */
const NOW = new Date('2026-03-20T23:00:00Z');
const TODAY = d('2026-03-20');
/** A bucket that records what the worker removes. */
function fakeStorage(removed: string[]): ObjectStorage {
  const unused = () => Promise.reject(new Error('not used by the worker'));
  return {
    presignUpload: unused,
    presignDownload: unused,
    stat: unused,
    put: unused,
    get: unused,
    remove: (key: string) => {
      removed.push(key);
      return Promise.resolve();
    },
  };
}

const logger = pino({ level: process.env.TEST_LOG_LEVEL === 'error' ? 'error' : 'silent' });

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
}

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for the worker');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe.skipIf(!hasDatabase)('worker and derived values (Postgres 16)', () => {
  let temporary: TemporaryDatabase;
  let owner: pg.Pool;
  let ownerDb: Database;
  let app: pg.Pool;
  let workerUrl: string;
  let worker: pg.Pool;
  let clubId: ClubId;
  let otherClubId: ClubId;
  let adminId: string;
  const sessions = new Map<string, string>();

  /** A transaction as the API's login, acting as the club's admin. */
  async function asApi<T>(work: (client: pg.PoolClient) => Promise<T>, commit = true): Promise<T> {
    const client = await app.connect();
    try {
      await client.query('begin');
      await client.query(
        `select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', 'admin', true)`,
        [clubId, adminId],
      );
      const result = await work(client);
      await client.query(commit ? 'commit' : 'rollback');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async function newPlayer(values: { sex?: 'male' | 'female'; birthDate?: string } = {}) {
    const [row] = await ownerDb
      .insert(player)
      .values({
        clubId,
        firstName: 'Jugador',
        lastName: randomUUID().slice(0, 8),
        birthDate: d(values.birthDate ?? '2011-04-15'),
        sex: values.sex ?? 'male',
        sport: 'rugby',
        joinedOn: d('2025-01-01'),
      })
      .returning({ id: player.id });
    if (row === undefined) throw new Error('no player');
    return row.id;
  }

  /** A training session on the club day (`slot` tells apart several on the same day). */
  async function sessionOn(date: LocalDate, slot = 0): Promise<string> {
    const key = `${date}#${String(slot)}`;
    const existing = sessions.get(key);
    if (existing !== undefined) return existing;
    const [row] = await ownerDb
      .insert(trainingSession)
      .values({
        clubId,
        sport: 'rugby',
        kind: 'training',
        startsAt: new Date(`${date}T${String(12 + slot).padStart(2, '0')}:00:00Z`),
        localDate: date,
      })
      .returning({ id: trainingSession.id });
    if (row === undefined) throw new Error('no session');
    sessions.set(key, row.id);
    return row.id;
  }

  async function participate(
    playerId: PlayerId,
    date: LocalDate,
    rpe: number,
    minutes = 60,
    slot = 0,
  ) {
    const sessionId = await sessionOn(date, slot);
    await asApi((client) =>
      client.query(
        `insert into participation (club_id, training_session_id, player_id, status, minutes, rpe, rpe_reported_at)
         values ($1, $2, $3, 'full', $4, $5, now())`,
        [clubId, sessionId, playerId, minutes, rpe],
      ),
    );
  }

  async function pending(playerId: PlayerId) {
    const { rows } = await owner.query<{
      load_from: string | null;
      wellness_from: string | null;
      maturation: boolean;
    }>(
      `select load_from::text, wellness_from::text, maturation from derived_refresh where player_id = $1`,
      [playerId],
    );
    return rows[0];
  }

  async function loadRows(playerId: PlayerId) {
    const { rows } = await owner.query<{
      local_date: string;
      load_au: number;
      acute_ewma_au: number;
      chronic_ewma_au: number;
      acwr: number | null;
      acwr_status: string;
      history_days: number;
      sessions_n: number;
    }>(
      `select local_date::text, load_au, acute_ewma_au, chronic_ewma_au, acwr, acwr_status::text,
              history_days, sessions_n
         from player_load_daily where player_id = $1 order by local_date`,
      [playerId],
    );
    return rows;
  }

  const deps = (now: Date = NOW) => ({ pool: worker, logger, now: () => now });

  beforeAll(async () => {
    if (serverUrl === undefined) return;
    temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_worker_test' });
    owner = temporary.pool({ max: 3 });
    ownerDb = createDatabase(owner);
    const appLogin = await temporary.login('app');
    const workerLogin = await temporary.login('worker');
    workerUrl = workerLogin.connectionString;
    app = temporary.pool({ connectionString: appLogin.connectionString, max: 3 });
    worker = temporary.pool({ connectionString: workerUrl, max: 4 });

    const clubs = await ownerDb
      .insert(club)
      .values([
        {
          slug: 'club-worker',
          name: 'Club Worker',
          shortName: 'CW',
          timeZone: parseTimeZone('America/Argentina/Buenos_Aires'),
        },
        {
          slug: 'club-otro',
          name: 'Club Otro',
          shortName: 'CO',
          timeZone: parseTimeZone('Europe/Madrid'),
        },
      ])
      .returning({ id: club.id });
    clubId = clubs[0]?.id as ClubId;
    otherClubId = clubs[1]?.id as ClubId;
    adminId = `admin-${randomUUID()}`;
    await ownerDb
      .insert(user)
      .values({ id: adminId, name: 'Admin', email: `${adminId}@example.com` });
    await ownerDb.insert(membership).values({ clubId, userId: adminId, role: 'admin' });
  });

  afterAll(async () => {
    await temporary.drop();
  });

  it('the worker login is a proper worker role and the queue schema is installed', async () => {
    await assertConnectionRole(worker, 'worker');
    const { rows } = await worker.query<{ version: number }>(
      'select max(version)::int as version from pgboss.version',
    );
    expect(rows[0]?.version).toBeGreaterThan(0);
    expect(await pgCode(app.query('select 1 from pgboss.job limit 1'))).toBe('42501');
  });

  it('a write as the API marks the player in its transaction, and a rollback marks nothing', async () => {
    const playerId = await newPlayer();
    const sessionId = await sessionOn(d('2026-03-02'));
    const insert = (client: pg.PoolClient) =>
      client.query(
        `insert into participation (club_id, training_session_id, player_id, status, minutes, rpe, rpe_reported_at)
         values ($1, $2, $3, 'full', 60, 5, now())`,
        [clubId, sessionId, playerId],
      );
    await asApi(insert, false);
    expect(await pending(playerId)).toBeUndefined();

    const listener = new pg.Client({ connectionString: workerUrl });
    await listener.connect();
    try {
      const notified = new Promise<string>((resolve) => {
        listener.on('notification', (message) => {
          resolve(message.payload ?? '');
        });
      });
      await listener.query(`listen ${DERIVED_REFRESH_CHANNEL}`);
      await asApi(insert);
      expect(await notified).toBe(clubId);
    } finally {
      await listener.end();
    }
    expect(await pending(playerId)).toEqual({
      load_from: '2026-03-02',
      wellness_from: null,
      maturation: false,
    });
    // The API reads the pending marks (staff) but never writes them or the derived tables.
    await asApi(async (client) => {
      const { rows } = await client.query('select player_id from derived_refresh');
      expect(rows.map((r: { player_id: string }) => r.player_id)).toContain(playerId);
    });
    expect(
      await pgCode(
        asApi((client) =>
          client.query(
            `insert into player_load_daily (club_id, player_id, local_date, load_au, has_data, sessions_n,
               pending_rpe_n, history_days, acute_ewma_au, chronic_ewma_au, acwr_status,
               missing_days_acute, missing_days_chronic, window_load_au, monotony_status)
             values ($1, $2, '2026-03-02', 1, true, 1, 0, 1, 1, 1, 'insufficient_history', 0, 0, 1, 'insufficient_history')`,
            [clubId, playerId],
          ),
        ),
      ),
    ).toBe('42501');
    expect(await listClubs(worker, true)).toEqual([clubId]);
  });

  it('recalculates the load series through the club day, idempotently', async () => {
    const playerId = await newPlayer();
    await participate(playerId, d('2026-03-03'), 6, 50);
    await participate(playerId, d('2026-03-05'), 7, 60);
    await participate(playerId, d('2026-03-05'), 3, 20, 1);

    const report = await refreshClub(deps(), clubId);
    expect(report).toMatchObject({ today: TODAY, failed: 0, remaining: false });
    const rows = await loadRows(playerId);
    const expected = computeLoadSeries({
      loads: [
        { date: d('2026-03-03'), loadAu: 300 },
        { date: d('2026-03-05'), loadAu: 420 },
        { date: d('2026-03-05'), loadAu: 60 },
      ],
      to: TODAY,
    });
    expect(rows.map((r) => r.local_date)).toEqual(expected.map((e) => e.date));
    expect(rows.at(-1)?.local_date).toBe('2026-03-20');
    for (const [i, row] of rows.entries()) {
      expect(row.load_au).toBe(expected[i]?.loadAu);
      expect(row.acute_ewma_au).toBeCloseTo(expected[i]?.acuteEwmaAu ?? Number.NaN, 9);
      expect(row.chronic_ewma_au).toBeCloseTo(expected[i]?.chronicEwmaAu ?? Number.NaN, 9);
      expect(row.acwr_status).toBe('insufficient_history');
    }
    expect(rows.find((r) => r.local_date === '2026-03-05')?.sessions_n).toBe(2);
    expect(await pending(playerId)).toBeUndefined();

    // Again: nothing pending, nothing to extend, same values.
    await refreshClub(deps(), clubId);
    expect(await loadRows(playerId)).toEqual(rows);
    // Forcing a full recalculation gives the same values too.
    await refreshPlayer(deps(), clubId, {
      playerId,
      loadFrom: d('1900-01-01'),
      wellnessFrom: null,
      maturation: false,
      requestedAt: null,
    });
    expect(await loadRows(playerId)).toEqual(rows);
  });

  it('keeps a mark that a write renewed while the worker was computing', async () => {
    const playerId = await newPlayer();
    await participate(playerId, d('2026-03-10'), 5);
    const { rows } = await owner.query<{ requested_at: string }>(
      'select requested_at::text from derived_refresh where player_id = $1',
      [playerId],
    );
    const seen = rows[0]?.requested_at ?? null;
    // A later write lands after the worker read the mark.
    await participate(playerId, d('2026-03-08'), 4);
    await refreshPlayer(deps(), clubId, {
      playerId,
      loadFrom: d('2026-03-10'),
      wellnessFrom: null,
      maturation: false,
      requestedAt: seen,
    });
    expect(await pending(playerId)).toMatchObject({ load_from: '2026-03-08' });
    await refreshClub(deps(), clubId);
    expect(await pending(playerId)).toBeUndefined();
    expect((await loadRows(playerId))[0]?.local_date).toBe('2026-03-08');
  });

  it('moves the series with archived sessions and when history starts later', async () => {
    const playerId = await newPlayer();
    await participate(playerId, d('2026-03-11'), 5);
    await participate(playerId, d('2026-03-12'), 5);
    await refreshClub(deps(), clubId);
    expect((await loadRows(playerId))[0]?.local_date).toBe('2026-03-11');
    // Archiving the first session (as the API) marks every participant from its day.
    await asApi((client) =>
      client.query('update training_session set archived_at = now() where id = $1', [
        sessions.get('2026-03-11#0'),
      ]),
    );
    expect(await pending(playerId)).toMatchObject({ load_from: '2026-03-11' });
    await refreshClub(deps(), clubId);
    const rows = await loadRows(playerId);
    expect(rows[0]).toMatchObject({ local_date: '2026-03-12', history_days: 1 });
    await asApi((client) =>
      client.query('update training_session set archived_at = null where id = $1', [
        sessions.get('2026-03-11#0'),
      ]),
    );
    await refreshClub(deps(), clubId);
  });

  it('extends every series to the club’s new day without new load', async () => {
    const playerId = await newPlayer();
    await participate(playerId, d('2026-03-19'), 8, 90);
    await refreshClub(deps(), clubId);
    const before = await loadRows(playerId);
    expect(before.map((r) => r.local_date)).toEqual(['2026-03-19', '2026-03-20']);
    // 02:00 UTC on the 22nd is still the 21st in Buenos Aires.
    const report = await refreshClub(deps(new Date('2026-03-22T02:00:00Z')), clubId);
    expect(report.today).toBe('2026-03-21');
    const after = await loadRows(playerId);
    expect(after.map((r) => r.local_date)).toEqual(['2026-03-19', '2026-03-20', '2026-03-21']);
    const last = after.at(-1);
    expect(last?.load_au).toBe(0);
    expect(last?.acute_ewma_au).toBeCloseTo((before.at(-1)?.acute_ewma_au ?? 0) * 0.75, 9);
    // Back to "today" for the rest of the suite.
    await owner.query('delete from player_load_daily where local_date > $1', [TODAY]);
  });

  it('compares wellness with the player’s own baseline', async () => {
    const playerId = await newPlayer();
    for (let i = 0; i < 11; i++) {
      const score = i === 10 ? 1 : i % 2 === 0 ? 4 : 3;
      await owner.query(
        `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness, stress, mood)
         values ($1, $2, $3, 5, $4, $4, $4, $4, $4)`,
        [clubId, playerId, addDays(d('2026-03-01'), i), score],
      );
    }
    expect(await pending(playerId)).toMatchObject({ wellness_from: '2026-03-01' });
    await refreshClub(deps(), clubId);
    const { rows } = await owner.query<{
      local_date: string;
      mean_score: number;
      baseline_samples: number;
      z_score: number | null;
    }>(
      `select local_date::text, mean_score, baseline_samples, z_score
         from player_wellness_daily where player_id = $1 order by local_date`,
      [playerId],
    );
    expect(rows).toHaveLength(11);
    expect(rows[9]).toMatchObject({ baseline_samples: 9, z_score: null });
    const sd = Math.sqrt((10 * 0.25) / 9);
    expect(rows[10]?.baseline_samples).toBe(10);
    expect(rows[10]?.z_score).toBeCloseTo((1 - 3.5) / sd, 9);
  });

  it('derives maturation on the measurement, with its equation and table, without marking again', async () => {
    const playerId = await newPlayer({ birthDate: '2012-05-10' });
    const [table] = await ownerDb
      .insert(schema.khamisRocheTable)
      .values({ clubId, ...khamisRocheTableSeed(KHAMIS_ROCHE_1994_TABLE) })
      .returning({ id: schema.khamisRocheTable.id });
    await ownerDb.insert(schema.khamisRocheCoefficient).values(
      khamisRocheCoefficientSeeds(KHAMIS_ROCHE_1994_TABLE).map((row) => ({
        clubId,
        tableId: table?.id ?? '',
        ...row,
      })),
    );
    await ownerDb.insert(playerParentHeight).values([
      { clubId, playerId, parent: 'mother', heightCm: 165, source: 'reported' },
      { clubId, playerId, parent: 'father', heightCm: 180, source: 'reported' },
    ]);
    await owner.query(
      `insert into anthro_measurement (club_id, player_id, measured_on, height_cm, sitting_height_cm, weight_kg)
       values ($1, $2, '2025-11-10', 157, null, 47), ($1, $2, '2026-03-10', 160, 82, 50)`,
      [clubId, playerId],
    );
    expect(await pending(playerId)).toMatchObject({ maturation: true });
    await refreshClub(deps(), clubId);
    const { rows } = await owner.query<{
      measured_on: string;
      phv_offset_years: number | null;
      maturity_offset_equation: string | null;
      adult_height_pct: number | null;
      khamis_roche_table_id: string | null;
      growth_velocity_cm_year: number | null;
      derived_at: Date | null;
    }>(
      `select measured_on::text, phv_offset_years, maturity_offset_equation::text, adult_height_pct,
              khamis_roche_table_id, growth_velocity_cm_year, derived_at
         from anthro_measurement where player_id = $1 order by measured_on`,
      [playerId],
    );
    expect(rows[0]).toMatchObject({ maturity_offset_equation: 'moore_2015_height' });
    expect(rows[1]).toMatchObject({
      maturity_offset_equation: 'moore_2015',
      khamis_roche_table_id: table?.id,
    });
    expect(rows[1]?.adult_height_pct).toBeGreaterThan(80);
    expect(rows[1]?.growth_velocity_cm_year).toBeCloseTo(3 / (120 / 365.25), 9);
    expect(rows.every((r) => r.derived_at !== null)).toBe(true);
    // The worker's own writes do not mark the player again.
    expect(await pending(playerId)).toBeUndefined();
  });

  it('fails the job loudly on invalid club settings; a settings change marks every player', async () => {
    await owner.query(
      `update club set settings = jsonb_set(settings, '{derived}', '{"load": {"acuteWindowDays": 0}}') where id = $1`,
      [clubId],
    );
    const { rows } = await owner.query<{ n: number }>(
      `select count(*)::int as n from derived_refresh where club_id = $1`,
      [clubId],
    );
    const { rows: players } = await owner.query<{ n: number }>(
      `select count(*)::int as n from player where club_id = $1`,
      [clubId],
    );
    expect(rows[0]?.n).toBe(players[0]?.n);
    await expect(refreshClub(deps(), clubId)).rejects.toThrow(/acuteWindowDays/);
    await owner.query(
      `update club set settings = jsonb_set(settings, '{derived}', '{"load": {"acuteWindowDays": 3}}') where id = $1`,
      [clubId],
    );
    const report = await refreshClub(deps(), clubId);
    expect(report.failed).toBe(0);
    const { rows: left } = await owner.query<{ n: number }>(
      `select count(*)::int as n from derived_refresh where club_id = $1`,
      [clubId],
    );
    expect(left[0]?.n).toBe(0);
    await owner.query(`update club set settings = settings - 'derived' where id = $1`, [clubId]);
    await refreshClub(deps(), clubId);
  });

  it('never reaches another club', async () => {
    await inClubTransaction(worker, otherClubId, async ({ client }) => {
      const { rows } = await client.query('select 1 from player_load_daily');
      expect(rows).toEqual([]);
      const pendingRows = await client.query('select 1 from derived_refresh');
      expect(pendingRows.rows).toEqual([]);
    });
    expect(await refreshClub(deps(), otherClubId)).toMatchObject({ players: 0, failed: 0 });
  });

  it('a failing player does not stop the others and fails the job for a retry', async () => {
    const good = await newPlayer();
    await participate(good, d('2026-03-15'), 5);
    const bad = await newPlayer();
    await participate(bad, d('2026-03-15'), 5);
    // The database refuses the bad player's rows (a stand-in for any per-player failure).
    await owner.query(
      `alter table player_load_daily add constraint test_fail check (player_id <> '${bad}')`,
    );
    try {
      const error = await refreshClub(deps(), clubId).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ClubRefreshError);
      expect((error as ClubRefreshError).failed).toBe(1);
      expect(await pending(good)).toBeUndefined();
      expect(await pending(bad)).toBeDefined();
      expect((await loadRows(good)).length).toBeGreaterThan(0);
    } finally {
      await owner.query('alter table player_load_daily drop constraint test_fail');
    }
    await refreshClub(deps(), clubId);
    expect(await pending(bad)).toBeUndefined();
  });

  it('purges the club’s expired files from the bucket and marks them (B-325)', async () => {
    const playerId = await newPlayer();
    const { rows } = await owner.query<{ id: string }>(
      `insert into file (club_id, kind, player_id, content_type, size_bytes, checksum_sha256, expires_at)
       values ($1, 'cmj_video', $2, 'video/mp4', 1024, '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=', $3),
              ($1, 'cmj_video', $2, 'video/mp4', 1024, '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=', $4)
       returning id`,
      [clubId, playerId, new Date('2026-03-19T00:00:00Z'), new Date('2026-04-30T00:00:00Z')],
    );
    const removed: string[] = [];
    const report = await purgeClubFiles(
      { pool: worker, storage: fakeStorage(removed), logger, now: () => NOW },
      clubId,
    );
    expect(report).toMatchObject({ purged: 1, failed: 0, more: false });
    expect(removed).toEqual([`clubs/${clubId}/cmj_video/${rows[0]?.id ?? ''}`]);
    const { rows: state } = await owner.query<{ id: string; status: string; purged: boolean }>(
      `select id, status::text, purged_at is not null as purged from file where player_id = $1`,
      [playerId],
    );
    expect(state.find((f) => f.id === rows[0]?.id)).toMatchObject({
      status: 'deleted',
      purged: true,
    });
    expect(state.find((f) => f.id === rows[1]?.id)).toMatchObject({ purged: false });
  });

  it('runs end to end on pg-boss: a write as the API reaches player_load_daily', async () => {
    const running = await startWorker({
      pool: worker,
      connectionString: workerUrl,
      logger,
      reporter: disabledErrorReporter,
      clubConcurrency: 2,
      jobQueuePoolMax: 3,
      pollingIntervalSeconds: 0.5,
      storage: fakeStorage([]),
      notifications: null,
      now: () => NOW,
    });
    try {
      const playerId = await newPlayer();
      await participate(playerId, d('2026-03-18'), 6, 45);
      const rows = await waitFor(async () => {
        const found = await loadRows(playerId);
        return found.length > 0 && (await pending(playerId)) === undefined ? found : undefined;
      });
      expect(rows.map((r) => r.local_date)).toEqual(['2026-03-18', '2026-03-19', '2026-03-20']);
      expect(rows[0]?.load_au).toBe(270);
      // pg-boss marks the job completed right after the handler returns.
      await waitFor(async () => {
        const { rows: jobs } = await owner.query<{ state: string }>(
          `select state::text from pgboss.job where name = 'derived-refresh-club' and data->>'clubId' = $1`,
          [clubId],
        );
        return jobs.some((j) => j.state === 'completed') ? true : undefined;
      });
      const { rows: schedules } = await owner.query<{ name: string }>(
        'select name from pgboss.schedule order by name',
      );
      expect(schedules.map((s) => s.name)).toEqual([
        'derived-daily',
        'derived-sweep',
        'files-daily',
        'player-reports-sweep',
      ]);
    } finally {
      await running.stop(10_000);
    }
    // The derived rows are visible to the API with the player scope.
    await asApi(async (client) => {
      const { rows } = await client.query<{ n: number }>(
        'select count(*)::int as n from player_load_daily',
      );
      expect(rows[0]?.n).toBeGreaterThan(0);
    });
  });
});
