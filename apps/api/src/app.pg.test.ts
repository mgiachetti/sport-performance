/**
 * The request transaction end to end against Postgres 16: concurrent HTTP
 * requests with different callers each see only their own tenant context,
 * on a pool smaller than the number of requests.
 */
import { randomUUID } from 'node:crypto';
import { defineEndpoint } from '@sport-performance/contracts';
import { isRole, parseClubId, parseUserId } from '@sport-performance/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import type { AuthContext } from './auth/context.js';
import { createPgDatabase, type Database } from './db/database.js';
import { registerEndpoint } from './http/endpoint.js';
import { describeWithPostgres, testApp, testAuthContext } from './testing/support.js';

const settingsSchema = z.object({
  clubId: z.string(),
  userId: z.string(),
  role: z.string(),
  pid: z.number(),
});

const settingsEndpoint = defineEndpoint({
  method: 'GET',
  path: '/v1/test/settings',
  summary: 'Tenant settings seen by the request transaction',
  tags: ['system'],
  auth: 'public',
  response: { status: 200, description: 'Settings', schema: settingsSchema },
  errors: [],
});

const writeEndpoint = defineEndpoint({
  method: 'POST',
  path: '/v1/test/write',
  summary: 'Writes a row and answers outside the contract',
  tags: ['system'],
  auth: 'public',
  body: z.object({ table: z.string().regex(/^api_tx_[0-9a-f]{32}$/) }),
  response: { status: 201, description: 'Never', schema: z.object({ ok: z.literal(true) }) },
  errors: [],
});

/** Test-only authentication: the caller comes in headers. */
function headerAuth(request: FastifyRequest): Promise<AuthContext | null> {
  const user = request.headers['x-test-user'];
  if (typeof user !== 'string') return Promise.resolve(null);
  const club = request.headers['x-test-club'];
  const role = request.headers['x-test-role'];
  return Promise.resolve(
    testAuthContext(
      parseUserId(user),
      typeof club === 'string' && isRole(role) ? { clubId: parseClubId(club), role } : null,
    ),
  );
}

describeWithPostgres('request transaction (HTTP + Postgres)', (url) => {
  let db: Database;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = createPgDatabase({ url, poolMax: 2, connectTimeoutMs: 5000, statementTimeoutMs: 5000 });
    ({ app } = await testApp({
      db,
      authenticate: headerAuth,
      register: (instance) => {
        registerEndpoint(instance, settingsEndpoint, {
          transaction: true,
          handler: async (_input, { tx }) => {
            await tx.query('select pg_sleep(0.005)');
            const { rows } = await tx.query<z.input<typeof settingsSchema>>(
              `select current_setting('app.club_id', true) as "clubId",
                current_setting('app.user_id', true) as "userId",
                current_setting('app.role', true) as "role",
                pg_backend_pid() as pid`,
            );
            return rows[0] ?? { clubId: '?', userId: '?', role: '?', pid: -1 };
          },
        });
        registerEndpoint(instance, writeEndpoint, {
          transaction: true,
          handler: async ({ body }, { tx }) => {
            await tx.query(`insert into ${body.table} values (1)`);
            return { ok: false } as unknown as { ok: true };
          },
        });
      },
    }));
  });

  afterAll(async () => {
    await app.close();
    await db.close();
  });

  it('gives every concurrent request its own context and nothing to anonymous ones', async () => {
    const callers = Array.from({ length: 30 }, (_, index) => {
      if (index % 3 === 0) return null;
      const caller = {
        user: randomUUID(),
        club: randomUUID(),
        role: index % 2 === 0 ? 'coach' : 'player',
      };
      return index % 3 === 1 ? caller : { ...caller, club: undefined, role: undefined };
    });
    const responses = await Promise.all(
      callers.map((caller) =>
        app.inject({
          url: '/v1/test/settings',
          headers:
            caller === null
              ? {}
              : {
                  'x-test-user': caller.user,
                  ...(caller.club !== undefined && { 'x-test-club': caller.club }),
                  ...(caller.role !== undefined && { 'x-test-role': caller.role }),
                },
        }),
      ),
    );
    const pids = new Set<number>();
    responses.forEach((response, index) => {
      expect(response.statusCode).toBe(200);
      const seen = settingsSchema.parse(response.json());
      pids.add(seen.pid);
      const caller = callers[index];
      expect({ clubId: seen.clubId, userId: seen.userId, role: seen.role }).toEqual({
        clubId: caller?.club ?? '',
        userId: caller?.user ?? '',
        role: caller?.role ?? '',
      });
    });
    expect(pids.size).toBeLessThanOrEqual(2);
  });

  it('rolls back the transaction when the response breaks the contract', async () => {
    const table = `api_tx_${randomUUID().replaceAll('-', '')}`;
    await db.transaction({ clubId: null, userId: null, role: null }, (tx) =>
      tx.query(`create table ${table} (value int not null)`),
    );
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/test/write',
        payload: { table },
      });
      expect(response.statusCode).toBe(500);
      const count = await db.transaction({ clubId: null, userId: null, role: null }, async (tx) => {
        const { rows } = await tx.query<{ n: string }>(`select count(*) as n from ${table}`);
        return Number(rows[0]?.n);
      });
      expect(count).toBe(0);
    } finally {
      await db.transaction({ clubId: null, userId: null, role: null }, (tx) =>
        tx.query(`drop table ${table}`),
      );
    }
  });

  it('is ready when the database answers', async () => {
    const response = await app.inject({ url: '/health/ready' });
    expect(response.statusCode).toBe(200);
  });
});
