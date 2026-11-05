import type { OpsHealth } from '@sport-performance/contracts';
import { OPS_CHECKS } from '@sport-performance/domain';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Database, TransactionClient } from '../db/database.js';
import { fakeDatabase, testApp, testConfig } from '../testing/support.js';
import { opsHealthOf } from './health.js';

/** `GET /health/ops` (B-703, ADR 0095): the operational checks for the uptime monitor. */

const TOKEN = 'ops-token-0123456789abcdefghijklmnopqrstuvwxyz';
const NOW = new Date('2026-11-04T12:00:00.000Z');
const secondsAgo = (s: number) => new Date(Date.now() - s * 1000);

interface Row {
  code: string;
  status: string;
  value: number | null;
  detail: unknown;
  status_since: Date;
  checked_at: Date;
}

const healthyRows = (checkedAt: Date): Row[] =>
  OPS_CHECKS.filter((d) => d.measuredBy === 'worker').map((d) => ({
    code: d.code,
    status: 'ok',
    value: 0,
    detail: {},
    status_since: new Date('2026-11-01T00:00:00Z'),
    checked_at: checkedAt,
  }));

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** A database whose transaction answers `app.ops_status()` with `rows`, recording the SQL. */
function opsDatabase(rows: () => Row[] | Promise<Row[]>, statements: string[] = []): Database {
  return fakeDatabase({
    transaction: async (context, work) => {
      expect(context).toEqual({ clubId: null, userId: null, role: null });
      const client = {
        query: async (text: string) => {
          statements.push(text);
          return { rows: text.includes('app.ops_status') ? await rows() : [] };
        },
      } as unknown as TransactionClient;
      return work(client);
    },
  });
}

async function start(options: { token?: string | null; db?: Database } = {}) {
  await app?.close();
  const built = await testApp({
    config: {
      ...testConfig,
      health: {
        databaseTimeoutMs: 500,
        opsMonitorToken: options.token === undefined ? TOKEN : options.token,
      },
    },
    db: options.db ?? opsDatabase(() => healthyRows(secondsAgo(30))),
  });
  app = built.app;
  return built.app;
}

const auth = { authorization: `Bearer ${TOKEN}` };

describe('GET /health/ops', () => {
  it('does not exist without a configured token', async () => {
    const server = await start({ token: null });
    expect((await server.inject({ url: '/health/ops', headers: auth })).statusCode).toBe(404);
  });

  it.each([
    {},
    { authorization: 'Bearer wrong-token-0123456789abcdefghijklmnopqrs' },
    { authorization: TOKEN },
    { authorization: `Basic ${TOKEN}` },
    { authorization: `Bearer ${TOKEN} ` },
  ])('answers 401 without the right bearer token (%o)', async (headers) => {
    const statements: string[] = [];
    const server = await start({ db: opsDatabase(() => [], statements) });
    const response = await server.inject({ url: '/health/ops', headers });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toBe('Bearer realm="ops"');
    expect(response.json<{ error: { code: string } }>().error.code).toBe('unauthenticated');
    // Nothing reached the database.
    expect(statements).toEqual([]);
  });

  it('answers 200 with every check when the worker reports and nothing is critical', async () => {
    const statements: string[] = [];
    const rows = healthyRows(secondsAgo(30));
    const backlog = rows.find((r) => r.code === 'job_backlog_s');
    if (backlog !== undefined) {
      Object.assign(backlog, {
        status: 'warning',
        value: 400,
        detail: { 'derived-refresh-club': 400, junk: 'x' },
      });
    }
    const server = await start({ db: opsDatabase(() => rows, statements) });
    const response = await server.inject({ url: '/health/ops', headers: auth });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json<OpsHealth>();
    expect(body.status).toBe('warning');
    expect(body.version).toBe('test-version');
    expect(body.checks.map((c) => c.code)).toEqual(OPS_CHECKS.map((d) => d.code));
    expect(body.checks[0]).toMatchObject({ code: 'worker_heartbeat_s', status: 'ok' });
    expect(body.checks.find((c) => c.code === 'job_backlog_s')).toMatchObject({
      status: 'warning',
      value: 400,
      unit: 's',
      warning: 300,
      critical: 1800,
      detail: { 'derived-refresh-club': 400 },
    });
    // The read is bounded by the probe timeout, inside the anonymous transaction.
    expect(statements[0]).toContain('statement_timeout');
  });

  it('answers 503 when a check is critical', async () => {
    const rows = healthyRows(secondsAgo(30));
    const dead = rows.find((r) => r.code === 'job_dead_letter_n');
    if (dead !== undefined) Object.assign(dead, { status: 'critical', value: 12 });
    const server = await start({ db: opsDatabase(() => rows) });
    const response = await server.inject({ url: '/health/ops', headers: auth });
    expect(response.statusCode).toBe(503);
    expect(response.json<OpsHealth>().status).toBe('critical');
  });

  it('answers 503 when the worker stopped reporting', async () => {
    const server = await start({ db: opsDatabase(() => healthyRows(secondsAgo(600))) });
    const response = await server.inject({ url: '/health/ops', headers: auth });
    expect(response.statusCode).toBe(503);
    expect(response.json<OpsHealth>().checks[0]).toMatchObject({
      code: 'worker_heartbeat_s',
      status: 'critical',
    });
  });

  it('answers 503 when the worker never reported', async () => {
    const server = await start({ db: opsDatabase(() => []) });
    const response = await server.inject({ url: '/health/ops', headers: auth });
    expect(response.statusCode).toBe(503);
    const body = response.json<OpsHealth>();
    expect(body.workerCheckedAt).toBeNull();
    expect(body.checks[0]).toMatchObject({ status: 'critical', value: null });
    expect(body.checks.slice(1).every((c) => c.status === 'unknown')).toBe(true);
  });

  it('answers 503 service_unavailable when the database does not answer', async () => {
    const server = await start({
      db: opsDatabase(() => Promise.reject(new Error('connect ECONNREFUSED'))),
    });
    const response = await server.inject({ url: '/health/ops', headers: auth });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('service_unavailable');
  });
});

describe('opsHealthOf', () => {
  it('leaves out checks this API does not define and statuses it does not know', () => {
    const rows: Row[] = [
      ...healthyRows(new Date('2026-11-04T11:59:00Z')),
      {
        code: 'from_a_newer_worker_n',
        status: 'critical',
        value: 1,
        detail: {},
        status_since: NOW,
        checked_at: NOW,
      },
    ];
    const reports = rows.find((r) => r.code === 'reports_failed_n');
    if (reports !== undefined) reports.status = 'bogus';
    const body = opsHealthOf(rows, NOW, 'v1');
    expect(body.status).toBe('unknown');
    expect(body.checks.map((c) => c.code)).not.toContain('from_a_newer_worker_n');
    expect(body.checks.find((c) => c.code === 'reports_failed_n')?.status).toBe('unknown');
    expect(body.workerCheckedAt).toBe(NOW.toISOString());
  });
});
