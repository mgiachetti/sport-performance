/**
 * Notifications in the worker (B-328, ADR 0054) against Postgres 16, through
 * the worker's real login (ADR 0026), with fake Expo and email services:
 * RPE request and reminder (minors' hours, already answered, consent,
 * preferences), critical alerts to the assigned staff only and only when
 * they appear, the pre-training summary, retries, tokens Expo forgets and
 * retention. Rows are written as the owner: their endpoints belong to other
 * issues.
 */
import { randomUUID } from 'node:crypto';
import { MemoryEmailTransport } from '@sport-performance/email';
import { createTemporaryDatabase, type TemporaryDatabase } from '@sport-performance/db/testing';
import type { ClubId, PlayerId } from '@sport-performance/domain';
import type pg from 'pg';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disabledErrorReporter } from '../observability.js';
import { QUEUES } from '../queues.js';
import { startWorker } from '../worker.js';
import { MemoryPushService } from './expo.js';
import { MAX_NOTIFICATION_ATTEMPTS, runClubNotifications } from './index.js';

const serverUrl = process.env.DATABASE_URL;
const hasDatabase = serverUrl !== undefined && serverUrl.trim() !== '';
if (!hasDatabase && process.env.CI !== undefined && process.env.CI !== '') {
  throw new Error('DATABASE_URL is required in CI: the worker tests run against real Postgres.');
}

const logger = pino({ level: process.env.TEST_LOG_LEVEL === 'error' ? 'error' : 'silent' });

/** Buenos Aires is UTC−3 all year: 18:00 local is 21:00Z. */
const at = (iso: string) => new Date(iso);

interface Fixture {
  readonly clubId: ClubId;
  readonly m15: string;
  readonly m17: string;
  readonly coach: string;
  readonly coachM17: string;
  readonly admin: string;
}

interface PlayerFixture {
  readonly playerId: PlayerId;
  readonly userId: string;
  readonly lastName: string;
  readonly token: string;
}

describe.skipIf(!hasDatabase)('notifications (Postgres 16)', () => {
  let temporary: TemporaryDatabase;
  let owner: pg.Pool;
  let worker: pg.Pool;
  let workerUrl: string;

  async function q<T extends pg.QueryResultRow = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return (await owner.query<T>(sql, params)).rows;
  }

  async function one<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> {
    const [row] = await q<T>(sql, params);
    if (row === undefined) throw new Error(`no row: ${sql}`);
    return row;
  }

  async function newUser(label: string): Promise<string> {
    const id = `${label}-${randomUUID()}`;
    await q(`insert into "user" (id, name, email) values ($1, $2, $3)`, [
      id,
      label,
      `${id}@example.com`,
    ]);
    return id;
  }

  /** A device of the user: a live session and its push token. */
  async function device(userId: string): Promise<string> {
    const { id } = await one<{ id: string }>(
      `insert into session (token, expires_at, user_id, client_type)
       values ($1, now() + interval '30 days', $2, 'mobile') returning id`,
      [randomUUID(), userId],
    );
    const token = `ExponentPushToken[${randomUUID().replaceAll('-', '')}]`;
    await q(
      `insert into push_token (user_id, session_id, token, platform) values ($1, $2, $3, 'ios')`,
      [userId, id, token],
    );
    return token;
  }

  async function staff(clubId: ClubId, role: string, categoryId: string): Promise<string> {
    const userId = await newUser(role);
    const { id } = await one<{ id: string }>(
      `insert into membership (club_id, user_id, role) values ($1, $2, $3) returning id`,
      [clubId, userId, role],
    );
    await q(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, id, categoryId],
    );
    return userId;
  }

  async function newClub(settings: Record<string, unknown> = {}): Promise<Fixture> {
    const slug = `n-${randomUUID().slice(0, 8)}`;
    const { id: clubId } = await one<{ id: ClubId }>(
      `insert into club (slug, name, short_name, time_zone, settings)
       values ($1, $1, 'N', 'America/Argentina/Buenos_Aires', $2) returning id`,
      [slug, JSON.stringify(settings)],
    );
    await q(`insert into club_branch (club_id, sport, sex) values ($1, 'rugby', 'male')`, [clubId]);
    const category = async (name: string, band: string) =>
      (
        await one<{ id: string }>(
          `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
           values ($1, 'rugby', 'male', $2, $3, 'development') returning id`,
          [clubId, band, name],
        )
      ).id;
    const m15 = await category('M15', 'm15');
    const m17 = await category('M17', 'm17');
    const coach = await staff(clubId, 'coach', m15);
    const coachM17 = await staff(clubId, 'coach', m17);
    const admin = await newUser('admin');
    await q(`insert into membership (club_id, user_id, role) values ($1, $2, 'admin')`, [
      clubId,
      admin,
    ]);
    await device(coach);
    await device(coachM17);
    await device(admin);
    return { clubId, m15, m17, coach, coachM17, admin };
  }

  async function newPlayer(
    f: Fixture,
    options: { birthDate?: string; consent?: boolean; categoryId?: string } = {},
  ): Promise<PlayerFixture> {
    const userId = await newUser('player');
    await q(`insert into membership (club_id, user_id, role) values ($1, $2, 'player')`, [
      f.clubId,
      userId,
    ]);
    const lastName = `Apellido${randomUUID().slice(0, 6)}`;
    const { id: playerId } = await one<{ id: PlayerId }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', $3, $4, 'male', 'rugby', '2020-01-01') returning id`,
      [f.clubId, userId, lastName, options.birthDate ?? '2000-01-01'],
    );
    await q(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [f.clubId, playerId, options.categoryId ?? f.m15],
    );
    if (options.consent ?? true) {
      await q(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by, signed_at)
         values ($1, $2, 'data', 'v1', 'player', $3, '2025-01-01')`,
        [f.clubId, playerId, userId],
      );
    }
    return { playerId, userId, lastName, token: await device(userId) };
  }

  async function newSession(
    f: Fixture,
    startsAt: string,
    options: { durationMin?: number; categoryId?: string; kind?: 'training' | 'match' } = {},
  ): Promise<string> {
    const local = new Date(new Date(startsAt).getTime() - 3 * 3600_000).toISOString().slice(0, 10);
    return (
      await one<{ id: string }>(
        `insert into training_session (club_id, sport, kind, category_id, starts_at, local_date, planned_duration_min)
         values ($1, 'rugby', $2, $3, $4, $5, $6) returning id`,
        [
          f.clubId,
          options.kind ?? 'training',
          options.categoryId ?? f.m15,
          startsAt,
          local,
          options.durationMin ?? 90,
        ],
      )
    ).id;
  }

  async function deliveries(clubId: ClubId) {
    return q<{
      id: string;
      user_id: string;
      kind: string;
      channel: string;
      status: string;
      skip_reason: string | null;
      failure_code: string | null;
      attempts: number;
      scheduled_for: Date;
    }>(
      `select id, user_id, kind::text, channel::text, status::text, skip_reason::text,
              failure_code, attempts, scheduled_for
         from notification where club_id = $1 order by created_at, kind, user_id, channel`,
      [clubId],
    );
  }

  function services() {
    return { push: new MemoryPushService(), email: new MemoryEmailTransport() };
  }

  function run(
    clubId: ClubId,
    now: Date,
    s: ReturnType<typeof services>,
  ): ReturnType<typeof runClubNotifications> {
    return runClubNotifications(
      { pool: worker, logger, webAppUrl: 'https://app.example.com', now: () => now, ...s },
      clubId,
      { jobId: randomUUID() },
    );
  }

  beforeAll(async () => {
    if (serverUrl === undefined) return;
    temporary = await createTemporaryDatabase({ serverUrl, prefix: 'sp_notif_test' });
    owner = temporary.pool({ max: 3 });
    const workerLogin = await temporary.login('worker');
    workerUrl = workerLogin.connectionString;
    worker = temporary.pool({ connectionString: workerUrl, max: 3 });
  });

  afterAll(async () => {
    await temporary.drop();
  });

  describe('RPE', () => {
    it('asks the player after the session plus the delay, once, without personal data', async () => {
      const f = await newClub();
      const p = await newPlayer(f);
      // 18:00–19:30 local; asked at 19:50 local (22:50Z).
      const sessionId = await newSession(f, '2026-03-20T21:00:00Z');
      const s = services();
      expect((await run(f.clubId, at('2026-03-20T22:40:00Z'), s)).created).toBe(0);

      const report = await run(f.clubId, at('2026-03-20T22:51:00Z'), s);
      expect(report).toMatchObject({ created: 1, sent: 1 });
      expect(s.push.sent).toHaveLength(1);
      const [message] = s.push.sent;
      expect(message?.to).toBe(p.token);
      expect(message?.title).toBe('¿Qué tan dura fue la sesión?');
      expect(message?.data).toEqual({
        kind: 'rpe_request',
        clubId: f.clubId,
        notificationId: expect.any(String) as string,
        path: `/training-sessions/${sessionId}/rpe`,
      });
      expect(JSON.stringify(message)).not.toContain(p.lastName);
      // The email channel is off by default for the RPE.
      expect(s.email.sent).toHaveLength(0);

      // Again: nothing new.
      const again = await run(f.clubId, at('2026-03-20T22:52:00Z'), s);
      expect(again).toMatchObject({ created: 0, sent: 0 });
      expect(s.push.sent).toHaveLength(1);
      const [row] = await deliveries(f.clubId);
      expect(row).toMatchObject({ kind: 'rpe_request', status: 'sent', attempts: 1 });
      const tickets = await q('select status::text from push_ticket where notification_id = $1', [
        row?.id,
      ]);
      expect(tickets).toEqual([{ status: 'pending' }]);
    });

    it('reminds the next morning only who did not answer, and not the absent', async () => {
      const f = await newClub();
      const answered = await newPlayer(f);
      const silent = await newPlayer(f);
      const absent = await newPlayer(f);
      const sessionId = await newSession(f, '2026-03-20T21:00:00Z');
      const s = services();
      await run(f.clubId, at('2026-03-20T22:51:00Z'), s);
      expect(s.push.sent.map((m) => m.to).sort()).toEqual(
        [answered.token, silent.token, absent.token].sort(),
      );
      await q(
        `insert into participation (club_id, training_session_id, player_id, status, minutes, rpe, rpe_reported_at)
         values ($1, $2, $3, 'full', 90, 6, now()), ($1, $2, $4, 'absent', 0, null, null)`,
        [f.clubId, sessionId, answered.playerId, absent.playerId],
      );
      s.push.sent.length = 0;
      // 07:59 local: not yet; 08:01 local: the reminder.
      expect((await run(f.clubId, at('2026-03-21T10:59:00Z'), s)).created).toBe(0);
      const report = await run(f.clubId, at('2026-03-21T11:01:00Z'), s);
      expect(report).toMatchObject({ created: 1, sent: 1 });
      expect(s.push.sent.map((m) => [m.to, m.title])).toEqual([
        [silent.token, 'Te falta cargar el RPE'],
      ]);
    });

    it('sends only the reminder when the request was never planned before the morning', async () => {
      const f = await newClub();
      const p = await newPlayer(f);
      await newSession(f, '2026-03-20T21:00:00Z');
      const s = services();
      // The worker was down from the end of the session until 08:30 local.
      const report = await run(f.clubId, at('2026-03-21T11:30:00Z'), s);
      expect(report).toMatchObject({ created: 1, sent: 1 });
      expect(s.push.sent.map((m) => [m.to, m.title])).toEqual([
        [p.token, 'Te falta cargar el RPE'],
      ]);
    });

    it('defers a minor to the morning, and then sends no separate reminder', async () => {
      const f = await newClub();
      const minor = await newPlayer(f, { birthDate: '2011-04-15' });
      const adult = await newPlayer(f);
      // 20:00–21:30 local: asked at 21:50 local (00:50Z), inside the adults' hours only.
      await newSession(f, '2026-03-20T23:00:00Z');
      const s = services();
      const report = await run(f.clubId, at('2026-03-21T00:51:00Z'), s);
      expect(report).toMatchObject({ created: 2, sent: 1 });
      expect(s.push.sent.map((m) => m.to)).toEqual([adult.token]);
      const pending = (await deliveries(f.clubId)).find((r) => r.user_id === minor.userId);
      expect(pending).toMatchObject({ kind: 'rpe_request', status: 'pending' });
      // 08:00 local of the next day.
      expect(pending?.scheduled_for.toISOString()).toBe('2026-03-21T11:00:00.000Z');

      s.push.sent.length = 0;
      await run(f.clubId, at('2026-03-21T11:00:30Z'), s);
      // The minor gets the (deferred) request; the adult the reminder; nobody gets both.
      expect(
        s.push.sent.map((m) => [m.to === minor.token ? 'minor' : 'adult', m.title]).sort(),
      ).toEqual([
        ['adult', 'Te falta cargar el RPE'],
        ['minor', '¿Qué tan dura fue la sesión?'],
      ]);
    });

    it('skips a deferred request when the player answered meanwhile', async () => {
      const f = await newClub();
      const minor = await newPlayer(f, { birthDate: '2011-04-15' });
      const sessionId = await newSession(f, '2026-03-20T23:00:00Z');
      const s = services();
      await run(f.clubId, at('2026-03-21T00:51:00Z'), s);
      await q(
        `insert into participation (club_id, training_session_id, player_id, status, minutes, rpe, rpe_reported_at)
         values ($1, $2, $3, 'full', 90, 7, now())`,
        [f.clubId, sessionId, minor.playerId],
      );
      await run(f.clubId, at('2026-03-21T11:00:30Z'), s);
      expect(s.push.sent).toHaveLength(0);
      expect(await deliveries(f.clubId)).toEqual([
        expect.objectContaining({ status: 'skipped', skip_reason: 'already_answered' }),
      ]);
    });

    it('does not ask players without a data consent, nor archived sessions', async () => {
      const f = await newClub();
      await newPlayer(f, { consent: false });
      const archived = await newSession(f, '2026-03-20T21:00:00Z', { categoryId: f.m17 });
      await newPlayer(f, { categoryId: f.m17 });
      await q('update training_session set archived_at = now() where id = $1', [archived]);
      await newSession(f, '2026-03-20T21:00:00Z');
      const s = services();
      expect((await run(f.clubId, at('2026-03-20T22:51:00Z'), s)).created).toBe(0);
    });

    it('follows the preferences: push off, email on', async () => {
      const f = await newClub();
      const p = await newPlayer(f);
      await q(
        `insert into notification_preference (club_id, user_id, kind, push, email)
         values ($1, $2, 'rpe_request', false, true)`,
        [f.clubId, p.userId],
      );
      await newSession(f, '2026-03-20T21:00:00Z', { kind: 'match' });
      const s = services();
      const report = await run(f.clubId, at('2026-03-20T22:51:00Z'), s);
      expect(report).toMatchObject({ created: 1, sent: 1 });
      expect(s.push.sent).toHaveLength(0);
      const [email] = s.email.sent;
      expect(email?.to).toBe(`${p.userId}@example.com`);
      expect(email?.kind).toBe('notification');
      expect(email?.text).toContain('partido');
      expect(email?.html).toContain('https://app.example.com/training-sessions/');
    });

    it('fails the job loudly on invalid club settings', async () => {
      const f = await newClub({ notifications: { rpeRequestDelay: 20 } });
      await expect(run(f.clubId, at('2026-03-20T22:51:00Z'), services())).rejects.toThrow(
        /Unknown notifications parameters/,
      );
    });
  });

  describe('critical alerts', () => {
    async function rule(f: Fixture): Promise<string> {
      return (
        await one<{ id: string }>(
          `insert into alert_rule (club_id, code, kind, params) values ($1, $2, 'acwr_high', '{}') returning id`,
          [f.clubId, `acwr_high_${randomUUID().slice(0, 4)}`],
        )
      ).id;
    }
    /** An alert episode (ADR 0053) raised on `day`; the trigger records its `raised` event. */
    async function alert(
      f: Fixture,
      ruleId: string,
      playerId: PlayerId,
      day: string,
      severity: 'warning' | 'critical' = 'critical',
    ): Promise<string> {
      return (
        await one<{ id: string }>(
          `insert into alert (club_id, alert_rule_id, player_id, kind, severity, current_severity,
                              local_date, last_seen_on, observed_on, values)
           values ($1, $2, $3, 'acwr_high', $4, $4, $5, $5, $5, '{"acwrRatio": 1.6}') returning id`,
          [f.clubId, ruleId, playerId, severity, day],
        )
      ).id;
    }
    /** The worker's next evaluation of the episode on `day`, as `nextAlertEpisode` writes it. */
    async function seen(
      alertId: string,
      day: string,
      severity: 'warning' | 'critical' = 'critical',
    ): Promise<void> {
      const escalates = `$3::alert_severity > severity`;
      await q(
        `update alert set current_severity = $3::alert_severity,
                          severity = greatest(severity, $3::alert_severity),
                          last_seen_on = $2, observed_on = $2, resolved_on = null,
                          status = case when ${escalates} then 'open' else status end,
                          acknowledged_at = case when ${escalates} then null else acknowledged_at end,
                          acknowledged_by = case when ${escalates} then null else acknowledged_by end,
                          acknowledgement_note = case when ${escalates} then null else acknowledgement_note end
          where id = $1`,
        [alertId, day, severity],
      );
    }
    async function pushedAlerts(clubId: ClubId): Promise<string[]> {
      return (
        await q<{ alert_id: string }>(
          `select alert_id from notification where club_id = $1 and channel = 'push' order by created_at`,
          [clubId],
        )
      ).map((r) => r.alert_id);
    }

    it('notifies the staff assigned to the player, by push and email, without names or values', async () => {
      const f = await newClub();
      const p = await newPlayer(f);
      const alertId = await alert(f, await rule(f), p.playerId, '2026-03-20');
      const s = services();
      // 12:00 local.
      const report = await run(f.clubId, at('2026-03-20T15:00:00Z'), s);
      expect(report).toMatchObject({ created: 2, sent: 2 });
      const rows = await deliveries(f.clubId);
      expect(rows.map((r) => [r.user_id, r.channel])).toEqual([
        [f.coach, 'email'],
        [f.coach, 'push'],
      ]);
      const [message] = s.push.sent;
      expect(message).toMatchObject({
        title: 'Alerta crítica en M15',
        priority: 'high',
        data: { kind: 'critical_alert', path: `/alerts/${alertId}` },
      });
      const everything = JSON.stringify([s.push.sent, s.email.sent]);
      expect(everything).not.toContain(p.lastName);
      expect(everything).not.toContain('1.6');
      expect(everything).not.toContain('1,6');
      expect(everything).not.toContain('ACWR');
    });

    it('notifies when the episode appears, not every day it lasts, and never for old days', async () => {
      const f = await newClub();
      const p = await newPlayer(f);
      const old = await alert(f, await rule(f), p.playerId, '2026-03-15');
      await seen(old, '2026-03-20');
      const recent = await alert(f, await rule(f), p.playerId, '2026-03-19');
      await seen(recent, '2026-03-20');
      const s = services();
      await run(f.clubId, at('2026-03-20T15:00:00Z'), s);
      // Only the episode raised on the 19th: the one of the 15th appeared too long ago.
      expect(await pushedAlerts(f.clubId)).toEqual([recent]);
      // It lasts another day: nothing new.
      await seen(recent, '2026-03-21');
      await run(f.clubId, at('2026-03-21T15:00:00Z'), s);
      expect(s.push.sent).toHaveLength(1);
    });

    it('notifies an escalation to critical and a reappearance, never a warning', async () => {
      const f = await newClub();
      const p = await newPlayer(f);
      const alertId = await alert(f, await rule(f), p.playerId, '2026-03-19', 'warning');
      const s = services();
      await run(f.clubId, at('2026-03-19T15:00:00Z'), s);
      expect(s.push.sent).toHaveLength(0);
      // Reviewed as a warning, then it escalates: the review reopens and the staff hears of it.
      await q(
        `update alert set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $2 where id = $1`,
        [alertId, f.coach],
      );
      await seen(alertId, '2026-03-20', 'critical');
      await run(f.clubId, at('2026-03-20T15:00:00Z'), s);
      expect(await pushedAlerts(f.clubId)).toEqual([alertId]);
      // Resolved on the 21st, back on the 22nd (the episode reopens): a new appearance.
      await q(`update alert set resolved_on = '2026-03-21' where id = $1`, [alertId]);
      await run(f.clubId, at('2026-03-21T15:00:00Z'), s);
      await seen(alertId, '2026-03-22');
      await run(f.clubId, at('2026-03-22T15:00:00Z'), s);
      expect(await pushedAlerts(f.clubId)).toEqual([alertId, alertId]);
      const keys = await q<{ dedupe_key: string }>(
        `select dedupe_key from notification where club_id = $1 and channel = 'push'`,
        [f.clubId],
      );
      expect(new Set(keys.map((k) => k.dedupe_key)).size).toBe(2);
    });

    it('skips an alert resolved before the delivery', async () => {
      const f = await newClub();
      const p = await newPlayer(f);
      const alertId = await alert(f, await rule(f), p.playerId, '2026-03-21');
      const s = services();
      // 00:05 local: deferred to 07:00, and resolved before then.
      await run(f.clubId, at('2026-03-21T03:05:00Z'), s);
      await q(`update alert set resolved_on = '2026-03-21' where id = $1`, [alertId]);
      await run(f.clubId, at('2026-03-21T10:01:00Z'), s);
      expect(s.push.sent).toHaveLength(0);
      expect((await deliveries(f.clubId)).map((r) => r.skip_reason)).toEqual([
        'alert_resolved',
        'alert_resolved',
      ]);
    });

    it('waits for the allowed hours and skips an alert acknowledged meanwhile', async () => {
      const f = await newClub();
      const p = await newPlayer(f);
      const alertId = await alert(f, await rule(f), p.playerId, '2026-03-21');
      const s = services();
      // 00:05 local (the nightly pass): deferred to 07:00 local.
      await run(f.clubId, at('2026-03-21T03:05:00Z'), s);
      expect(s.push.sent).toHaveLength(0);
      const rows = await deliveries(f.clubId);
      expect(rows.map((r) => r.scheduled_for.toISOString())).toEqual([
        '2026-03-21T10:00:00.000Z',
        '2026-03-21T10:00:00.000Z',
      ]);
      await q(
        `update alert set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $2 where id = $1`,
        [alertId, f.coach],
      );
      await run(f.clubId, at('2026-03-21T10:01:00Z'), s);
      expect(s.push.sent).toHaveLength(0);
      expect((await deliveries(f.clubId)).map((r) => r.skip_reason)).toEqual([
        'alert_resolved',
        'alert_resolved',
      ]);
    });
  });

  describe('pre-training summary', () => {
    it('sends the assigned staff counts before the session, never names', async () => {
      const f = await newClub();
      const withWellness = await newPlayer(f);
      const other = await newPlayer(f);
      await q(
        `insert into wellness (club_id, player_id, local_date, item_count, sleep, fatigue, soreness, stress, mood)
         values ($1, $2, '2026-03-20', 5, 4, 4, 4, 4, 4)`,
        [f.clubId, withWellness.playerId],
      );
      const ruleId = (
        await one<{ id: string }>(
          `insert into alert_rule (club_id, code, kind, params) values ($1, 'wellness_low', 'wellness_low', '{}') returning id`,
          [f.clubId],
        )
      ).id;
      await q(
        `insert into alert (club_id, alert_rule_id, player_id, kind, severity, current_severity,
                            local_date, last_seen_on, observed_on)
         values ($1, $2, $3, 'wellness_low', 'warning', 'warning', '2026-03-19', '2026-03-20', '2026-03-20')`,
        [f.clubId, ruleId, other.playerId],
      );
      // 18:00 local; the summary goes 2 h before.
      await newSession(f, '2026-03-20T21:00:00Z');
      const s = services();
      expect((await run(f.clubId, at('2026-03-20T18:59:00Z'), s)).created).toBe(0);
      await run(f.clubId, at('2026-03-20T19:00:00Z'), s);
      const summaries = s.push.sent.filter((m) => m.data.kind === 'pre_training_summary');
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.to).not.toBe(withWellness.token);
      expect(summaries[0]?.title).toBe('M15: antes de entrenar');
      expect(summaries[0]?.body).toBe(
        'A las 18:00. Alertas abiertas: ninguna crítica y 1 de atención. Bienestar cargado: 1 de 2.',
      );
      const rows = await deliveries(f.clubId);
      expect(rows.filter((r) => r.kind === 'pre_training_summary').map((r) => r.user_id)).toEqual([
        f.coach,
      ]);
    });
  });

  describe('delivery', () => {
    it('forgets a token Expo reports as not registered, on send and on the receipt', async () => {
      const f = await newClub();
      const p = await newPlayer(f);
      await newSession(f, '2026-03-20T21:00:00Z');
      const s = services();
      s.push.unregistered.add(p.token);
      await run(f.clubId, at('2026-03-20T22:51:00Z'), s);
      expect(await deliveries(f.clubId)).toEqual([
        expect.objectContaining({ status: 'failed', failure_code: 'DeviceNotRegistered' }),
      ]);
      expect(await q('select 1 from push_token where token = $1', [p.token])).toEqual([]);

      const later = await newPlayer(f);
      await newSession(f, '2026-03-21T21:00:00Z');
      await run(f.clubId, at('2026-03-21T22:51:00Z'), s);
      const { ticket_id: ticketId } = await one<{ ticket_id: string }>(
        `select t.ticket_id from push_ticket t join notification n on n.id = t.notification_id
          where n.user_id = $1`,
        [later.userId],
      );
      s.push.pendingReceipts.set(ticketId, { status: 'error', code: 'DeviceNotRegistered' });
      // The ticket was written with the database's clock; the job runs on the test's.
      await q(`update push_ticket set created_at = '2026-03-21T22:51:00Z' where ticket_id = $1`, [
        ticketId,
      ]);
      expect((await run(f.clubId, at('2026-03-21T22:55:00Z'), s)).receipts).toBe(0);
      const report = await run(f.clubId, at('2026-03-21T23:10:00Z'), s);
      expect(report.receipts).toBe(1);
      expect(await q('select 1 from push_token where token = $1', [later.token])).toEqual([]);
      expect(
        await q('select status::text, error_code from push_ticket where ticket_id = $1', [
          ticketId,
        ]),
      ).toEqual([{ status: 'error', error_code: 'DeviceNotRegistered' }]);
    });

    it('skips a recipient without devices', async () => {
      const f = await newClub();
      const p = await newPlayer(f);
      await q('delete from push_token where user_id = $1', [p.userId]);
      await newSession(f, '2026-03-20T21:00:00Z');
      await run(f.clubId, at('2026-03-20T22:51:00Z'), services());
      expect(await deliveries(f.clubId)).toEqual([
        expect.objectContaining({ status: 'skipped', skip_reason: 'no_destination' }),
      ]);
    });

    it('retries a provider failure later and gives up after the last attempt', async () => {
      const f = await newClub();
      await newPlayer(f);
      await newSession(f, '2026-03-20T21:00:00Z');
      const s = services();
      s.push.failing = true;
      let now = at('2026-03-20T22:51:00Z');
      for (let attempt = 1; attempt <= MAX_NOTIFICATION_ATTEMPTS; attempt += 1) {
        await run(f.clubId, now, s);
        const [row] = await deliveries(f.clubId);
        expect(row?.attempts).toBe(attempt);
        expect(row?.status).toBe(attempt < MAX_NOTIFICATION_ATTEMPTS ? 'pending' : 'failed');
        expect(row?.failure_code).toBe('NetworkError');
        now = new Date(now.getTime() + 60 * 60_000);
      }
    });

    it('takes back a delivery left sending by an interrupted run', async () => {
      const f = await newClub();
      const p = await newPlayer(f);
      await newSession(f, '2026-03-20T21:00:00Z');
      const s = services();
      s.push.failing = true;
      await run(f.clubId, at('2026-03-20T22:51:00Z'), s);
      await q(
        `update notification set status = 'sending', last_attempt_at = '2026-03-20T22:51:00Z'
          where club_id = $1`,
        [f.clubId],
      );
      s.push.failing = false;
      await run(f.clubId, at('2026-03-20T23:30:00Z'), s);
      expect(s.push.sent.map((m) => m.to)).toEqual([p.token]);
      expect((await deliveries(f.clubId))[0]).toMatchObject({ status: 'sent', attempts: 2 });
    });

    it('purges deliveries past the retention', async () => {
      const f = await newClub();
      await newPlayer(f);
      await newSession(f, '2026-03-20T21:00:00Z');
      await run(f.clubId, at('2026-03-20T22:51:00Z'), services());
      await q(
        `update notification set created_at = now() - interval '91 days' where club_id = $1`,
        [f.clubId],
      );
      const report = await run(f.clubId, new Date(), services());
      expect(report.purged).toBe(1);
      expect(await deliveries(f.clubId)).toEqual([]);
    });
  });

  it('runs on pg-boss: a club job plans and delivers', async () => {
    const f = await newClub();
    const p = await newPlayer(f);
    await newSession(f, '2026-03-20T21:00:00Z');
    const s = services();
    const running = await startWorker({
      pool: worker,
      connectionString: workerUrl,
      logger,
      reporter: disabledErrorReporter,
      clubConcurrency: 1,
      jobQueuePoolMax: 3,
      pollingIntervalSeconds: 0.5,
      schedule: false,
      storage: null,
      notifications: { ...s, webAppUrl: 'https://app.example.com' },
      now: () => at('2026-03-20T22:51:00Z'),
    });
    try {
      await running.boss.send(QUEUES.notificationsClub, { clubId: f.clubId });
      const deadline = Date.now() + 30_000;
      while (s.push.sent.length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(s.push.sent.map((m) => m.to)).toEqual([p.token]);
    } finally {
      await running.stop(5000);
    }
  });
});
