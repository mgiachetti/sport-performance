/**
 * The operational monitor (B-703, ADR 0095) against Postgres 16, through the
 * worker's real login: it reads the job queue and the outbox across clubs,
 * records `ops.check_state` only through `app.worker_record_ops_checks`, and
 * announces a failing check once per status (and again after the renotify
 * interval), never once per pass.
 */
import { randomUUID } from 'node:crypto';
import { JOB_QUEUE_SCHEMA, createDatabase, schema } from '@sport-performance/db';
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import { parseLocalDate, parseTimeZone, type ClubId } from '@sport-performance/domain';
import { PgBoss } from 'pg-boss';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CronCheckIn, ErrorReporter, OpsNotice } from '../observability.js';
import { QUEUES, setUpQueues } from '../queues.js';
import { createOpsMonitor, type MeasuredCheck } from './monitor.js';

const serverUrl = process.env.DATABASE_URL;
const hasDatabase = serverUrl !== undefined && serverUrl.trim() !== '';
if (!hasDatabase && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL is required in CI: the worker tests run against real Postgres.');
}

const logger = pino({ level: 'silent' });

describe.skipIf(!hasDatabase)('operational monitor (Postgres 16)', () => {
  let temporary: TemporaryDatabase;
  let owner: pg.Pool;
  let worker: pg.Pool;
  let boss: PgBoss;
  let clubId: ClubId;
  const notices: OpsNotice[] = [];
  const checkIns: CronCheckIn[] = [];
  const reporter: ErrorReporter = {
    enabled: true,
    capture() {
      // Errors fail the test through the thrown error.
    },
    notice: (notice) => notices.push(notice),
    checkIn: (checkIn) => checkIns.push(checkIn),
    flush: () => Promise.resolve(true),
  };

  const byCode = (checks: readonly MeasuredCheck[]) =>
    Object.fromEntries(checks.map((c) => [c.code, c]));

  async function stored() {
    const { rows } = await owner.query<{
      code: string;
      status: string;
      value: number | null;
      status_since: Date;
      notified: boolean;
    }>(
      `select code, status::text, value, status_since, notified_at is not null as notified
         from ops.check_state order by code`,
    );
    return Object.fromEntries(rows.map((r) => [r.code, r]));
  }

  beforeAll(async () => {
    if (serverUrl === undefined) return;
    temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_ops_monitor_test' });
    owner = temporary.pool({ max: 2 });
    const workerLogin = await temporary.login('worker');
    worker = temporary.pool({ connectionString: workerLogin.connectionString, max: 3 });
    // The queues, without workers: nothing takes the jobs the tests leave there.
    boss = new PgBoss({
      connectionString: workerLogin.connectionString,
      schema: JOB_QUEUE_SCHEMA,
      max: 2,
      migrate: false,
      createSchema: false,
      reindex: false,
      supervise: false,
      schedule: false,
      persistWarnings: false,
    });
    boss.on('error', () => undefined);
    await boss.start();
    await setUpQueues(boss, { files: false, notifications: false, opsMonitor: false });

    const [row] = await createDatabase(owner)
      .insert(schema.club)
      .values({
        slug: 'club-ops',
        name: 'Club Ops',
        shortName: 'CO',
        timeZone: parseTimeZone('America/Argentina/Buenos_Aires'),
      })
      .returning({ id: schema.club.id });
    clubId = row?.id as ClubId;
  });

  afterAll(async () => {
    await boss.stop({ graceful: false, timeout: 1000 }).catch(() => undefined);
    await temporary.drop();
  });

  it('a healthy platform records every worker check as ok and checks in', async () => {
    const monitor = createOpsMonitor({ pool: worker, logger, reporter, renotifyMinutes: 60 });
    const checks = await monitor.run();
    expect(checks.every((c) => c.status === 'ok')).toBe(true);
    const rows = await stored();
    expect(Object.keys(rows).sort()).toEqual(checks.map((c) => c.code).sort());
    expect(Object.values(rows).every((r) => r.status === 'ok' && !r.notified)).toBe(true);
    expect(notices).toEqual([]);
    expect(checkIns.at(-1)?.status).toBe('ok');
  });

  it('a dead-lettered job is announced once, then stays quiet until the renotify interval', async () => {
    notices.length = 0;
    const id = await boss.send(QUEUES.refreshClubDead, { clubId });
    const monitor = createOpsMonitor({ pool: worker, logger, reporter, renotifyMinutes: 5 });
    const first = byCode(await monitor.run());
    expect(first.job_dead_letter_n).toMatchObject({
      status: 'warning',
      value: 1,
      detail: { [QUEUES.refreshClubDead]: 1 },
    });
    expect(notices.map((n) => n.fingerprint)).toEqual([['ops-check', 'job_dead_letter_n']]);
    const since = (await stored()).job_dead_letter_n?.status_since;

    await monitor.run();
    expect(notices).toHaveLength(1);
    expect((await stored()).job_dead_letter_n?.status_since).toEqual(since);

    // Past the renotify interval it is announced again, in the same issue.
    await owner.query(
      `update ops.check_state set notified_at = now() - interval '6 minutes' where code = 'job_dead_letter_n'`,
    );
    await monitor.run();
    expect(notices).toHaveLength(2);

    // Redriven or discarded: it recovers, and a recovery is not announced.
    await boss.deleteJob(QUEUES.refreshClubDead, id ?? '');
    const recovered = byCode(await monitor.run());
    expect(recovered.job_dead_letter_n?.status).toBe('ok');
    expect(notices).toHaveLength(2);
    expect((await stored()).job_dead_letter_n).toMatchObject({ status: 'ok', notified: false });
  });

  it('measures recent failures, backlog and the outbox lag across clubs', async () => {
    notices.length = 0;
    const failed = await boss.send(QUEUES.sweep, {});
    const waiting = await boss.send(QUEUES.refreshClub, { clubId }, { singletonKey: clubId });
    await owner.query(
      `update ${JOB_QUEUE_SCHEMA}.job set state = 'failed', started_on = now(), completed_on = now()
        where id = $1`,
      [failed],
    );
    await owner.query(
      `update ${JOB_QUEUE_SCHEMA}.job set start_after = now() - interval '40 minutes',
              created_on = now() - interval '40 minutes'
        where id = $1`,
      [waiting],
    );
    const [player] = await createDatabase(owner)
      .insert(schema.player)
      .values({
        clubId,
        firstName: 'Jugador',
        lastName: randomUUID().slice(0, 8),
        birthDate: parseLocalDate('2011-04-15'),
        sex: 'male',
        sport: 'rugby',
        joinedOn: parseLocalDate('2025-01-01'),
      })
      .returning({ id: schema.player.id });
    await owner.query(
      `insert into derived_refresh (club_id, player_id, maturation, requested_at)
       values ($1, $2, true, now() - interval '20 minutes')`,
      [clubId, player?.id],
    );

    const checks = byCode(
      await createOpsMonitor({ pool: worker, logger, reporter, renotifyMinutes: 60 }).run(),
    );
    expect(checks.job_failed_recent_n).toMatchObject({
      status: 'warning',
      value: 1,
      detail: { [QUEUES.sweep]: 1 },
    });
    expect(checks.job_backlog_s?.status).toBe('critical');
    expect(checks.job_backlog_s?.detail).toHaveProperty(QUEUES.refreshClub);
    expect(checks.derived_refresh_lag_s?.status).toBe('warning');
    expect(checks.derived_refresh_lag_s?.value).toBeGreaterThanOrEqual(20 * 60);
    expect(notices.map((n) => n.tags.ops_check).sort()).toEqual([
      'derived_refresh_lag_s',
      'job_backlog_s',
      'job_failed_recent_n',
    ]);
    expect(notices.find((n) => n.tags.ops_check === 'job_backlog_s')?.level).toBe('error');
    // Nothing of the club or the player reached the stored checks.
    const raw = await owner.query<{ detail: unknown }>('select detail from ops.check_state');
    const text = JSON.stringify(raw.rows);
    expect(text).not.toContain(clubId);
    expect(text).not.toContain(player?.id ?? 'no player');
  });

  it('the worker reaches the checks only through its functions', async () => {
    const code = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return 'no error';
      } catch (error) {
        return (error as { code?: string }).code;
      }
    };
    expect(await code(worker.query('select 1 from ops.check_state'))).toBe('42501');
    expect(await code(worker.query('select * from app.ops_status()'))).toBe('42501');
  });
});
