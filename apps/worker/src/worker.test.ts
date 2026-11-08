import {
  DEFAULT_LOAD_PARAMETERS,
  addDays,
  computeLoadSeries,
  parseLocalDate,
  type LocalDate,
} from '@sport-performance/domain';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigError, configSummary, isReservedEmailDomain, loadConfig } from './config.js';
import { planLoadDaily, type ParticipationLoad } from './derived/load-rows.js';
import {
  FILE_SCHEDULES,
  NOTIFICATION_SCHEDULES,
  QUEUES,
  QUEUE_DEFINITIONS,
  SCHEDULES,
  parseRefreshClubJob,
} from './queues.js';

const d = (value: string): LocalDate => parseLocalDate(value);
const START = d('2026-03-02');

function p(date: LocalDate, values: Partial<Omit<ParticipationLoad, 'date'>>): ParticipationLoad {
  const minutes = values.minutes ?? 60;
  const rpe = values.rpe === undefined ? 5 : values.rpe;
  return {
    date,
    status: values.status ?? 'full',
    minutes,
    rpe,
    srpeAu: values.srpeAu !== undefined ? values.srpeAu : rpe === null ? null : rpe * minutes,
  };
}

describe('loadConfig', () => {
  const base = { DATABASE_URL: 'postgres://sp_worker:pw@localhost:5432/sp' };

  it('applies the defaults', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      nodeEnv: 'development',
      version: 'dev',
      log: { level: 'info' },
      database: { poolMax: 5, statementTimeoutMs: 60_000 },
      jobQueue: { poolMax: 4 },
      clubConcurrency: 2,
      sentry: null,
    });
    expect(JSON.stringify(configSummary(config))).not.toContain('postgres://');
    // Empty optional variables (as in .env.example) are unset.
    expect(loadConfig({ ...base, SENTRY_DSN: '', APP_VERSION: ' ' }).sentry).toBeNull();
  });

  it('names the invalid variables without their values', () => {
    try {
      loadConfig({ DATABASE_URL: 'mysql://secret@host/db', WORKER_CLUB_CONCURRENCY: '0' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('WORKER_CLUB_CONCURRENCY');
      expect(message).not.toContain('secret');
    }
    expect(() => loadConfig({})).toThrow(ConfigError);
    // The bucket: all of its variables or none.
    expect(() => loadConfig({ ...base, STORAGE_BUCKET: 'sp-files' })).toThrow(/STORAGE_ENDPOINT/);
  });

  it('requires a real database password in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: `postgres://sp_worker:${randomBytes(24).toString('base64url')}@db.internal:5432/sp`,
        SENTRY_DSN: 'https://key@sentry.example.com/1',
        RAILWAY_ENVIRONMENT_NAME: 'staging',
        RAILWAY_GIT_COMMIT_SHA: 'abc123',
        STORAGE_ENDPOINT: 'https://storage.example.com',
        STORAGE_BUCKET: 'sp-files',
        STORAGE_ACCESS_KEY_ID: randomBytes(10).toString('hex'),
        STORAGE_SECRET_ACCESS_KEY: randomBytes(30).toString('base64url'),
        RESEND_API_KEY: `re_${randomBytes(20).toString('hex')}`,
        EMAIL_FROM: 'Sport Performance <avisos@example.com>',
        WEB_APP_URL: 'https://app.example.com/',
      }),
    ).toMatchObject({
      version: 'abc123',
      sentry: { environment: 'staging', release: 'abc123' },
      storage: { bucket: 'sp-files', endpoint: 'https://storage.example.com' },
      notifications: {
        webAppUrl: 'https://app.example.com',
        resend: { from: 'Sport Performance <avisos@example.com>' },
      },
    });
  });

  it('configures the notifications (B-328): log transport in development, Resend required in production', () => {
    const local = loadConfig(base);
    expect(local.notifications).toEqual({
      resend: null,
      webAppUrl: 'http://localhost:5173',
      expoAccessToken: undefined,
      demoEmailDomains: [],
    });
    expect(configSummary(local)).toMatchObject({
      notifications: { email: 'log', demoEmailDomains: 0 },
    });
    expect(loadConfig({ ...base, NOTIFICATIONS: 'off' }).notifications).toBeNull();
    expect(() =>
      loadConfig({ ...base, RESEND_API_KEY: `re_${randomBytes(8).toString('hex')}` }),
    ).toThrow(/EMAIL_FROM/);

    const production = {
      NODE_ENV: 'production',
      DATABASE_URL: `postgres://sp_worker:${randomBytes(24).toString('base64url')}@db.internal:5432/sp`,
      STORAGE_ENDPOINT: 'https://storage.example.com',
      STORAGE_BUCKET: 'sp-files',
      STORAGE_ACCESS_KEY_ID: randomBytes(10).toString('hex'),
      STORAGE_SECRET_ACCESS_KEY: randomBytes(30).toString('base64url'),
    };
    expect(() => loadConfig(production)).toThrow(/RESEND_API_KEY[\s\S]*WEB_APP_URL/);
    expect(() =>
      loadConfig({
        ...production,
        RESEND_API_KEY: `re_${randomBytes(12).toString('hex')}`,
        EMAIL_FROM: 'avisos@example.com',
        WEB_APP_URL: 'http://app.example.com',
      }),
    ).toThrow(/WEB_APP_URL: must be https/);
    // Off: nothing to send, nothing required.
    expect(loadConfig({ ...production, NOTIFICATIONS: 'off' }).notifications).toBeNull();
  });

  it('reads the catch-all domains of the demo clubs (#177), never a reserved one', () => {
    const domains = (value: string) =>
      loadConfig({ ...base, DEMO_NOTIFICATION_EMAIL_DOMAINS: value }).notifications
        ?.demoEmailDomains;
    expect(domains(' Demo.Club.app , staging-mail.club.app,demo.club.app,')).toEqual([
      'demo.club.app',
      'staging-mail.club.app',
    ]);
    const summary = configSummary(
      loadConfig({ ...base, DEMO_NOTIFICATION_EMAIL_DOMAINS: 'demo.club.app' }),
    );
    expect(summary).toMatchObject({ notifications: { demoEmailDomains: 1 } });
    expect(JSON.stringify(summary)).not.toContain('demo.club.app');
    for (const reserved of ['example.com', 'mail.example.org', 'demo.test', 'club.invalid']) {
      expect(() => domains(reserved)).toThrow(
        /DEMO_NOTIFICATION_EMAIL_DOMAINS: reserved domains never receive email/,
      );
    }
    for (const invalid of ['user@demo.club.app', 'localhost', 'demo club.app', 'https://x.app']) {
      expect(() => domains(invalid)).toThrow(/DEMO_NOTIFICATION_EMAIL_DOMAINS: expects/);
    }
  });

  it('knows the reserved email domains (RFC 2606, RFC 6761)', () => {
    expect(isReservedEmailDomain('example.com')).toBe(true);
    expect(isReservedEmailDomain('Sub.Example.NET')).toBe(true);
    expect(isReservedEmailDomain('no-email.invalid')).toBe(true);
    expect(isReservedEmailDomain('demo.example')).toBe(true);
    expect(isReservedEmailDomain('examples.com')).toBe(false);
    expect(isReservedEmailDomain('demo.club.app')).toBe(false);
  });
});

describe('planLoadDaily', () => {
  it('writes every day from the first load through the end, with the domain series', () => {
    const participations = [
      p(START, { rpe: 6, minutes: 50 }),
      p(START, { rpe: 3, minutes: 20 }),
      p(addDays(START, 2), { rpe: 7, minutes: 60 }),
    ];
    const end = addDays(START, 9);
    const plan = planLoadDaily({
      participations,
      requestedFrom: d('1900-01-01'),
      end,
      parameters: DEFAULT_LOAD_PARAMETERS,
    });
    const expected = computeLoadSeries({
      loads: [
        { date: START, loadAu: 300 },
        { date: START, loadAu: 60 },
        { date: addDays(START, 2), loadAu: 420 },
      ],
      to: end,
    });
    expect(plan).toMatchObject({ historyStart: START, end, replaceFrom: START });
    expect(plan.rows).toHaveLength(10);
    expect(plan.rows).toEqual(
      expected.map((day, i) => ({
        ...day,
        sessionsN: plan.rows[i]?.sessionsN,
        pendingRpeN: 0,
        externalLoadAu: 0,
        externalN: 0,
      })),
    );
    expect(plan.rows[0]).toMatchObject({ loadAu: 360, sessionsN: 2, pendingRpeN: 0 });
    expect(plan.rows[1]).toMatchObject({ loadAu: 0, hasData: false, sessionsN: 0 });
  });

  it('adds the external load the player reported to the day, counted apart (B-511)', () => {
    const plan = planLoadDaily({
      participations: [p(START, { rpe: 6, minutes: 50 })],
      externalLoads: [
        { date: START, srpeAu: 160 },
        { date: addDays(START, 1), srpeAu: 240 },
        { date: addDays(START, 1), srpeAu: 0 },
        // After the end of the series: not counted.
        { date: addDays(START, 9), srpeAu: 500 },
      ],
      requestedFrom: START,
      end: addDays(START, 2),
      parameters: DEFAULT_LOAD_PARAMETERS,
    });
    const expected = computeLoadSeries({
      loads: [
        { date: START, loadAu: 300 },
        { date: START, loadAu: 160 },
        { date: addDays(START, 1), loadAu: 240 },
        { date: addDays(START, 1), loadAu: 0 },
      ],
      to: addDays(START, 2),
    });
    expect(plan.rows.map((r) => r.acuteEwmaAu)).toEqual(expected.map((day) => day.acuteEwmaAu));
    expect(
      plan.rows.map((r) => [r.loadAu, r.hasData, r.sessionsN, r.externalLoadAu, r.externalN]),
    ).toEqual([
      [460, true, 1, 160, 1],
      [240, true, 0, 240, 2],
      [0, false, 0, 0, 0],
    ]);
  });

  it('starts the history with external load alone', () => {
    const plan = planLoadDaily({
      participations: [],
      externalLoads: [{ date: addDays(START, 1), srpeAu: 200 }],
      requestedFrom: START,
      end: addDays(START, 1),
      parameters: DEFAULT_LOAD_PARAMETERS,
    });
    expect(plan.historyStart).toBe(addDays(START, 1));
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ loadAu: 200, externalLoadAu: 200, sessionsN: 0 });
  });

  it('recalculates a suffix with the same values as a full rebuild', () => {
    const participations = [p(START, {}), p(addDays(START, 3), { rpe: 8 })];
    const input = { participations, end: addDays(START, 6), parameters: DEFAULT_LOAD_PARAMETERS };
    const full = planLoadDaily({ ...input, requestedFrom: START });
    const suffix = planLoadDaily({ ...input, requestedFrom: addDays(START, 3) });
    expect(suffix.replaceFrom).toBe(addDays(START, 3));
    expect(suffix.rows).toEqual(full.rows.slice(3));
  });

  it('counts only participations with load and an RPE; pending RPE is not a 0', () => {
    const plan = planLoadDaily({
      participations: [
        p(START, {}),
        p(addDays(START, 1), { rpe: null }),
        p(addDays(START, 1), { status: 'absent', minutes: 0, rpe: null }),
        p(addDays(START, 1), { status: 'unavailable', minutes: 0, rpe: null }),
        p(addDays(START, 2), { rpe: null, minutes: 0 }),
      ],
      requestedFrom: START,
      end: addDays(START, 2),
      parameters: DEFAULT_LOAD_PARAMETERS,
    });
    expect(plan.rows.map((r) => [r.loadAu, r.hasData, r.sessionsN, r.pendingRpeN])).toEqual([
      [300, true, 1, 0],
      [0, false, 0, 1],
      [0, false, 0, 0],
    ]);
  });

  it('has no rows without load, and ignores load after the end', () => {
    expect(
      planLoadDaily({
        participations: [p(addDays(START, 5), {}), p(START, { rpe: null })],
        requestedFrom: START,
        end: addDays(START, 4),
        parameters: DEFAULT_LOAD_PARAMETERS,
      }),
    ).toEqual({ historyStart: null, end: addDays(START, 4), rows: [], replaceFrom: null });
  });

  it('reports insufficient history before the configured minimum', () => {
    const participations = Array.from({ length: 30 }, (_, i) => p(addDays(START, i), {}));
    const plan = planLoadDaily({
      participations,
      requestedFrom: START,
      end: addDays(START, 29),
      parameters: DEFAULT_LOAD_PARAMETERS,
    });
    expect(plan.rows[26]).toMatchObject({ acwr: null, acwrStatus: 'insufficient_history' });
    expect(plan.rows[27]).toMatchObject({ acwr: 1, acwrStatus: 'ok' });
  });
});

describe('queues', () => {
  it('defines every queue once, the dead letter queue first', () => {
    const names = QUEUE_DEFINITIONS.map((q) => q.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.sort()).toEqual(Object.values(QUEUES).sort());
    const refresh = QUEUE_DEFINITIONS.find((q) => q.name === QUEUES.refreshClub);
    expect(refresh).toMatchObject({ policy: 'stately', deadLetter: QUEUES.refreshClubDead });
    expect(QUEUE_DEFINITIONS[0]?.name).toBe(QUEUES.refreshClubDead);
    expect(SCHEDULES.map((s) => s.queue).sort()).toEqual(
      [QUEUES.daily, QUEUES.sweep, QUEUES.usageDaily, QUEUES.locationErasureSweep].sort(),
    );
    // The erasure of position data (B-913) runs with or without a bucket.
    expect(QUEUE_DEFINITIONS.find((q) => q.name === QUEUES.locationErasureClub)).toMatchObject({
      policy: 'stately',
      deadLetter: QUEUES.locationErasureClubDead,
    });
    const names2 = QUEUE_DEFINITIONS.map((q) => q.name);
    expect(names2.indexOf(QUEUES.locationErasureClubDead)).toBeLessThan(
      names2.indexOf(QUEUES.locationErasureClub),
    );
    expect(QUEUE_DEFINITIONS.find((q) => q.name === QUEUES.usageFoldClub)).toMatchObject({
      policy: 'stately',
      deadLetter: QUEUES.usageFoldClubDead,
    });
    expect(FILE_SCHEDULES.map((s) => s.queue)).toEqual([
      QUEUES.filesDaily,
      QUEUES.playerReportsSweep,
      QUEUES.dataExportSweep,
    ]);
    const exports = QUEUE_DEFINITIONS.find((q) => q.name === QUEUES.dataExportClub);
    expect(exports).toMatchObject({ policy: 'stately', deadLetter: QUEUES.dataExportClubDead });
    // pg-boss gives up on a stuck export job before another run may take the export over.
    expect(exports?.expireInSeconds).toBeLessThan(30 * 60);
    expect(NOTIFICATION_SCHEDULES.map((s) => s.queue)).toEqual([QUEUES.notificationsSweep]);
    const notifications = QUEUE_DEFINITIONS.find((q) => q.name === QUEUES.notificationsClub);
    expect(notifications).toMatchObject({
      policy: 'stately',
      deadLetter: QUEUES.notificationsClubDead,
    });
  });

  it('only accepts refresh jobs with a club id', () => {
    const clubId = '7a3f0f0e-0000-4000-8000-000000000001';
    expect(parseRefreshClubJob({ clubId })).toEqual({ clubId });
    for (const data of [null, {}, { clubId: 'x' }, { clubId: 1 }]) {
      expect(() => parseRefreshClubJob(data)).toThrow();
    }
  });
});
