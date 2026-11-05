import { createHash, timingSafeEqual } from 'node:crypto';
import {
  getHealth,
  healthSchema,
  opsHealthSchema,
  type Health,
  type OpsHealth,
} from '@sport-performance/contracts';
import {
  OPS_CHECKS,
  evaluateOpsCheck,
  isOpsCheckCode,
  isOpsCheckStatus,
  opsCheckDefinition,
  opsStatusFails,
  overallOpsStatus,
  workerHeartbeatAgeS,
  type OpsCheckStatus,
} from '@sport-performance/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';

export interface HealthOptions {
  version: string;
  databaseTimeoutMs: number;
  /**
   * Bearer token of `GET /health/ops` (B-703, ADR 0095). `null` or unset: the
   * route does not exist (`404`), so nothing about the platform is exposed.
   */
  opsMonitorToken?: string | null | undefined;
}

/** A row of `app.ops_status()`. */
interface OpsStatusRow {
  readonly code: string;
  readonly status: string;
  readonly value: number | null;
  readonly detail: unknown;
  readonly status_since: Date;
  readonly checked_at: Date;
}

const ANONYMOUS = { clubId: null, userId: null, role: null } as const;

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/** Constant-time check of `Authorization: Bearer <token>` (hashes first: equal lengths). */
export function bearerMatches(request: FastifyRequest, expected: Buffer): boolean {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer ([\x21-\x7e]{1,512})$/.exec(header);
  if (match?.[1] === undefined) return false;
  return timingSafeEqual(digest(match[1]), expected);
}

/** Per-queue counts of a stored detail; anything else is dropped. */
function countsOf(detail: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return counts;
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) counts[key] = value;
  }
  return counts;
}

/**
 * The body of `/health/ops` from what the worker recorded and the time of
 * its last pass: the heartbeat is the API's own check (a worker that stopped
 * cannot report it), and a check of a definition this API does not know
 * (a newer worker) is left out.
 */
export function opsHealthOf(rows: readonly OpsStatusRow[], now: Date, version: string): OpsHealth {
  let lastCheckedAt: Date | null = null;
  for (const row of rows) {
    if (lastCheckedAt === null || row.checked_at > lastCheckedAt) lastCheckedAt = row.checked_at;
  }
  const heartbeat = opsCheckDefinition('worker_heartbeat_s');
  const heartbeatS = workerHeartbeatAgeS(lastCheckedAt, now);
  const checks: OpsHealth['checks'] = [
    {
      code: heartbeat.code,
      status: evaluateOpsCheck(heartbeat, heartbeatS),
      value: heartbeatS,
      unit: heartbeat.unit,
      warning: heartbeat.warning,
      critical: heartbeat.critical,
      since: lastCheckedAt?.toISOString() ?? null,
      detail: {},
    },
  ];
  const byCode = new Map(rows.map((r) => [r.code, r]));
  for (const definition of OPS_CHECKS) {
    if (definition.measuredBy !== 'worker') continue;
    const row = byCode.get(definition.code);
    const status: OpsCheckStatus =
      row !== undefined && isOpsCheckCode(row.code) && isOpsCheckStatus(row.status)
        ? row.status
        : 'unknown';
    checks.push({
      code: definition.code,
      status,
      value: row?.value ?? null,
      unit: definition.unit,
      warning: definition.warning,
      critical: definition.critical,
      since: row?.status_since.toISOString() ?? null,
      detail: countsOf(row?.detail),
    });
  }
  return opsHealthSchema.parse({
    status: overallOpsStatus(checks.map((c) => c.status)),
    version,
    time: now.toISOString(),
    workerCheckedAt: lastCheckedAt?.toISOString() ?? null,
    checks,
  });
}

/**
 * Probes for the platform (ADR 0003): outside `/v1` and the public contract,
 * like `/openapi.json`, because they describe the process, not the API.
 *
 * - `GET /health/live`: the process answers. Never touches dependencies, so a
 *   database outage does not get the container restarted.
 * - `GET /health/ready`: the process can serve: not shutting down and the
 *   database answers within `databaseTimeoutMs`. Otherwise `503`.
 * - `GET /v1/health` (contract `getHealth`): same check as readiness, for
 *   monitors and clients that only speak the contract.
 */
export function registerHealthRoutes(app: FastifyInstance, options: HealthOptions): void {
  const healthy = (): Health =>
    healthSchema.parse({ status: 'ok', version: options.version, time: new Date().toISOString() });

  const ready = async (): Promise<Health> => {
    if (app.lifecycle.draining) {
      throw new HttpError('service_unavailable', 'The server is shutting down');
    }
    try {
      await app.db.ping(options.databaseTimeoutMs);
    } catch (error) {
      app.log.warn({ err: error }, 'readiness: database ping failed');
      throw new HttpError('service_unavailable', 'The database is not answering', { cause: error });
    }
    return healthy();
  };

  // Probes run often: keep them out of the info logs unless they fail.
  // Probes are exempt from the rate limits: a limited probe would get a healthy replica restarted.
  // Any app version reaches them (ADR 0045): they describe the process, not the contract.
  const probe = {
    logLevel: 'warn',
    config: { rateLimit: 'exempt', appVersionCheck: 'skip' },
  } as const;
  app.get('/health/live', probe, () => Promise.resolve(healthy()));
  app.get('/health/ready', probe, ready);
  registerEndpoint(app, getHealth, { transaction: false, handler: ready });

  // Operational checks (B-703, ADR 0095), for an uptime monitor with its token. Counted
  // as a public route per IP: the token is long, but a guesser is still bounded.
  const token = options.opsMonitorToken;
  if (token !== null && token !== undefined && token !== '') {
    const expected = digest(token);
    app.get(
      '/health/ops',
      { logLevel: 'warn', config: { rateLimit: 'public', appVersionCheck: 'skip' } },
      async (request, reply) => {
        if (!bearerMatches(request, expected)) {
          throw new HttpError('unauthenticated', 'A valid ops monitor token is required', {
            headers: { 'www-authenticate': 'Bearer realm="ops"' },
          });
        }
        if (app.lifecycle.draining) {
          throw new HttpError('service_unavailable', 'The server is shutting down');
        }
        let rows: OpsStatusRow[];
        try {
          rows = await app.db.transaction(ANONYMOUS, async (client) => {
            await client.query(`select set_config('statement_timeout', $1, true)`, [
              String(options.databaseTimeoutMs),
            ]);
            return (await client.query<OpsStatusRow>('select * from app.ops_status()')).rows;
          });
        } catch (error) {
          app.log.warn({ err: error }, 'ops health: the database did not answer');
          throw new HttpError('service_unavailable', 'The database is not answering', {
            cause: error,
          });
        }
        const body = opsHealthOf(rows, new Date(), options.version);
        if (opsStatusFails(body.status)) {
          app.log.warn(
            {
              failing: body.checks.filter((c) => opsStatusFails(c.status)).map((c) => c.code),
            },
            'ops health: critical',
          );
        }
        void reply
          .code(opsStatusFails(body.status) ? 503 : 200)
          .header('cache-control', 'no-store');
        return body;
      },
    );
  }
}
