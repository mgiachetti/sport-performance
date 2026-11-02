/**
 * Unit tests of the endpoint conventions (ADR 0032) without Postgres: the
 * transaction settings each request gets, the superadmin's support reason,
 * the permission errors, the database errors as the envelope answers them,
 * the response sent only after the commit, pagination cursors and the write
 * helpers. The same rules run against Postgres in `routes/clubs.pg.test.ts`.
 */
import { defineEndpoint, type Page } from '@sport-performance/contracts';
import { PermissionDeniedError, parseClubId, parseUserId } from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AuthContext } from '../auth/context.js';
import { parseSupportReason, selectSupportClub } from '../auth/authenticate.js';
import type { Database, TransactionClient } from '../db/database.js';
import type { TenantContext, TransactionSettings } from '../db/tenant-context.js';
import { fakeDatabase, testApp, testAuthContext } from '../testing/support.js';
import { registerEndpoint } from './endpoint.js';
import { filtersFingerprint, keysetPage, likePattern, type KeysetSpec } from './pagination.js';
import { requestPermissions } from './permissions.js';
import { insertIdempotent, updateAtVersion } from './writes.js';

const userId = parseUserId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e10');
const clubId = parseClubId('0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f');

const clubProbe = defineEndpoint({
  method: 'POST',
  path: '/v1/test/club-probe',
  summary: 'Club probe',
  tags: ['system'],
  auth: 'club',
  body: z.strictObject({ changeReason: z.string().optional(), fail: z.string().optional() }),
  response: { status: 200, description: 'Probe', schema: z.object({ secret: z.string() }) },
  errors: [],
});

const registryProbe = defineEndpoint({
  method: 'GET',
  path: '/v1/test/registry-probe',
  summary: 'Registry probe',
  tags: ['system'],
  auth: 'session',
  response: { status: 200, description: 'Probe', schema: z.object({ ok: z.boolean() }) },
  errors: [],
});

function pgError(code: string, constraint?: string): Error {
  // Drizzle wraps the driver's error: the code is on the cause.
  return new Error('Failed query', {
    cause: Object.assign(new Error('driver error with row values'), { code, constraint }),
  });
}

function register(app: FastifyInstance): void {
  registerEndpoint(app, clubProbe, {
    transaction: true,
    changeReason: ({ body }) => body.changeReason,
    handler: ({ body }) => {
      switch (body.fail) {
        case 'permission':
          throw new PermissionDeniedError('club', 'update', {
            allowed: false,
            reason: 'role_denied',
          });
        case 'unique':
          throw pgError('23505', 'category_club_id_sport_sex_name_key');
        case 'reason':
          throw pgError('23514', 'change_history_reason_required');
        case 'policy':
          throw pgError('42501');
        case 'overlap':
          throw pgError('23P01', 'season_no_overlap');
        case 'other-check':
          throw pgError('23514', 'club_name_format');
        case 'deadlock':
          throw pgError('40P01');
        case 'serialization':
          throw pgError('40001');
        default:
          return Promise.resolve({ secret: 'medical data' });
      }
    },
  });
  registerEndpoint(app, registryProbe, {
    transaction: true,
    scope: 'registry',
    handler: () => Promise.resolve({ ok: true }),
  });
}

interface Recorded {
  context: TenantContext;
  settings: TransactionSettings | undefined;
}

/** A database whose transactions record their context and can fail at commit. */
function recordingDatabase(options: { failCommit?: boolean } = {}): Database & {
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  return {
    ...fakeDatabase(),
    calls,
    async transaction<T>(
      context: TenantContext,
      work: (client: TransactionClient) => Promise<T>,
      settings?: TransactionSettings,
    ): Promise<T> {
      calls.push({ context, settings });
      const result = await work({} as TransactionClient);
      if (options.failCommit === true) throw new Error('could not commit: connection lost');
      return result;
    },
  };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(auth: AuthContext | null, db = recordingDatabase()) {
  const built = await testApp({ db, register, authenticate: () => Promise.resolve(auth) });
  app = built.app;
  return { ...built, db };
}

const admin = testAuthContext(userId, { clubId, role: 'admin' });
const superadmin = (overrides: Partial<AuthContext> = {}): AuthContext => ({
  ...testAuthContext(userId),
  isSuperadmin: true,
  membership: { membershipId: null, clubId, role: 'superadmin' },
  supportReason: 'Soporte pedido por el club',
  ...overrides,
});

describe('request transactions', () => {
  it('carry the tenant context, the request id and the change reason', async () => {
    const { app, db } = await start(admin);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/test/club-probe',
      headers: { 'x-request-id': 'req-conventions-1' },
      payload: { changeReason: 'Se cargó mal' },
    });
    expect(response.statusCode).toBe(200);
    expect(db.calls).toEqual([
      {
        context: { clubId, userId, role: 'admin' },
        settings: { requestId: 'req-conventions-1', changeReason: 'Se cargó mal' },
      },
    ]);
  });

  it('send nothing when the commit fails (medical data only after COMMIT)', async () => {
    const { app } = await start(admin, recordingDatabase({ failCommit: true }));
    const response = await app.inject({ method: 'POST', url: '/v1/test/club-probe', payload: {} });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('medical data');
  });

  it('record the support reason of a superadmin acting in a club', async () => {
    const { app, db } = await start(superadmin());
    const response = await app.inject({ method: 'POST', url: '/v1/test/club-probe', payload: {} });
    expect(response.statusCode).toBe(200);
    expect(db.calls[0]?.context).toEqual({ clubId, userId, role: 'superadmin' });
    expect(db.calls[0]?.settings?.supportReason).toBe('Soporte pedido por el club');
  });

  it('refuse a superadmin without a support reason before opening a transaction', async () => {
    const { app, db } = await start(superadmin({ supportReason: null }));
    const response = await app.inject({ method: 'POST', url: '/v1/test/club-probe', payload: {} });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { message: string } }>().error.message).toContain(
      'X-Support-Reason',
    );
    expect(db.calls).toEqual([]);
  });

  it('use the registry context only for a superadmin', async () => {
    const registryCaller = superadmin({ membership: null });
    const { app, db } = await start(registryCaller);
    const ok = await app.inject({ url: '/v1/test/registry-probe' });
    expect(ok.statusCode).toBe(200);
    expect(db.calls[0]?.context).toEqual({ clubId: null, userId, role: 'superadmin' });
    await app.close();

    const other = await start(admin);
    const denied = await other.app.inject({ url: '/v1/test/registry-probe' });
    expect(denied.statusCode).toBe(403);
    expect(other.db.calls).toEqual([]);
  });
});

describe('errors of the conventions', () => {
  it.each([
    ['permission', 403, 'forbidden'],
    ['unique', 409, 'conflict'],
    ['reason', 400, 'validation_failed'],
    ['policy', 403, 'forbidden'],
    ['overlap', 409, 'conflict'],
    ['other-check', 500, 'internal_error'],
    ['deadlock', 503, 'service_unavailable'],
    ['serialization', 503, 'service_unavailable'],
  ])('answers %s with %i %s, without the database detail', async (fail, status, code) => {
    const { app, logs } = await start(admin);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/test/club-probe',
      payload: { fail },
    });
    expect(response.statusCode).toBe(status);
    const body = response.json<{ error: { code: string; details?: { path: unknown[] }[] } }>();
    expect(body.error.code).toBe(code);
    expect(response.body).not.toContain('row values');
    if (fail === 'reason') expect(body.error.details?.[0]?.path).toEqual(['body', 'changeReason']);
    if (fail === 'deadlock' || fail === 'serialization') {
      // Retryable, not a bug: no error log (Sentry), a Retry-After.
      expect(response.headers['retry-after']).toBe('1');
      expect(logs.lines().some((l) => l.msg === 'unexpected error')).toBe(false);
    }
    if (fail === 'permission') {
      // The client is not told which rule denied; the logs are.
      expect(response.body).not.toContain('role_denied');
      const line = logs.lines().find((l) => l.msg === 'request rejected');
      expect(line?.permission).toEqual({ kind: 'club', action: 'update', reason: 'role_denied' });
    }
    if (fail === 'unique') {
      const line = logs.lines().find((l) => l.msg === 'request rejected');
      expect(line).toMatchObject({
        sqlState: '23505',
        constraint: 'category_club_id_sport_sex_name_key',
      });
    }
  });
});

describe('superadmin headers', () => {
  it('decodes a percent-encoded support reason and rejects invalid ones', () => {
    expect(parseSupportReason(encodeURIComponent('  Revisión pedida por el club '))).toBe(
      'Revisión pedida por el club',
    );
    for (const value of [undefined, '', '%E0%A4%A', encodeURIComponent(' '), 'x'.repeat(501)]) {
      expect(parseSupportReason(value)).toBeNull();
    }
    expect(parseSupportReason(['a', 'b'])).toBeNull();
  });

  it('lets only a superadmin support a club, without a membership header', () => {
    const header = clubId.toUpperCase();
    expect(selectSupportClub(true, header, undefined)).toEqual({
      membership: { membershipId: null, clubId, role: 'superadmin' },
      rejected: false,
    });
    expect(selectSupportClub(true, undefined, undefined)).toBeUndefined();
    for (const [isSuperadmin, value, membership] of [
      [false, clubId, undefined],
      [true, clubId, '0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e11'],
      [true, 'not-a-uuid', undefined],
    ] as const) {
      expect(selectSupportClub(isSuperadmin, value, membership)).toEqual({
        membership: null,
        rejected: true,
      });
    }
  });
});

describe('permissions', () => {
  it('builds the subject of the administration without reading the database', async () => {
    const permissions = requestPermissions({} as never, admin, 'club');
    expect(await permissions.subject()).toEqual({ userId, role: 'admin', clubId });
    expect(await permissions.listScope('category', 'read')).toMatchObject({ kind: 'club', clubId });
    await expect(permissions.authorize('club_registry', 'create')).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it('denies a list to a role whose cell is a denial', async () => {
    // Never health data for a superadmin (ADR 0025).
    const permissions = requestPermissions({} as never, superadmin(), 'club');
    await expect(permissions.listScope('medical_record', 'read')).rejects.toBeInstanceOf(
      PermissionDeniedError,
    );
  });

  it('refuses the registry to anyone but a superadmin, and a session without club', async () => {
    await expect(
      requestPermissions({} as never, admin, 'registry').subject(),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const noClub = testAuthContext(userId);
    await expect(requestPermissions({} as never, noClub, 'club').subject()).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(
      await requestPermissions(
        {} as never,
        { ...noClub, isSuperadmin: true },
        'registry',
      ).subject(),
    ).toEqual({ userId, role: 'superadmin', clubId: null });
  });
});

interface Row {
  id: string;
  name: string;
  createdAt: Date;
}

const ROWS: Row[] = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'M13', createdAt: new Date('2026-01-01') },
  { id: '00000000-0000-4000-8000-000000000002', name: 'M14', createdAt: new Date('2026-01-02') },
  { id: '00000000-0000-4000-8000-000000000003', name: 'M15', createdAt: new Date('2026-01-03') },
];

const KEYS: KeysetSpec<Row, 'name' | 'createdAt'> = {
  fields: {
    name: { column: sql`name`, type: 'text', value: (row) => row.name },
    createdAt: { column: sql`created_at`, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: sql`id`, value: (row) => row.id },
};

const dialect = new PgDialect();

describe('keyset pagination', () => {
  it('asks for one more row and encodes the key of the last item', () => {
    const plan = keysetPage(KEYS, { sort: 'name', limit: 2 }, { sport: 'rugby' });
    expect(plan.where).toBeUndefined();
    expect(plan.limit).toBe(3);
    const page: Page<string> = plan.page(ROWS, (row) => row.name);
    expect(page.items).toEqual(['M13', 'M14']);
    expect(page.nextCursor).not.toBeNull();

    const next = keysetPage(
      KEYS,
      { sort: 'name', limit: 2, cursor: page.nextCursor ?? '' },
      { sport: 'rugby' },
    );
    const query = dialect.sqlToQuery(next.where ?? sql``);
    expect(query.sql).toBe('(name, id) > ($1::text, $2::uuid)');
    expect(query.params).toEqual(['M14', ROWS[1]?.id]);
    expect(next.page(ROWS.slice(2), (row) => row.name)).toEqual({
      items: ['M15'],
      nextCursor: null,
    });
  });

  it('compares timestamps at the millisecond, descending with "-"', () => {
    const plan = keysetPage(KEYS, { sort: '-createdAt', limit: 1 }, {});
    const cursor = plan.page(ROWS, (row) => row.id).nextCursor ?? '';
    const next = keysetPage(KEYS, { sort: '-createdAt', limit: 1, cursor }, {});
    const query = dialect.sqlToQuery(next.where ?? sql``);
    expect(query.sql).toBe(
      "(date_trunc('milliseconds', created_at), id) < ($1::timestamptz, $2::uuid)",
    );
    expect(query.params).toEqual(['2026-01-01T00:00:00.000Z', ROWS[0]?.id]);
    expect(next.orderBy.map((o) => dialect.sqlToQuery(o).sql)).toEqual([
      "date_trunc('milliseconds', created_at) desc",
      'id desc',
    ]);
  });

  it('rejects a cursor of another sort, other filters or tampered', () => {
    const cursor = keysetPage(KEYS, { sort: 'name', limit: 1 }, { sport: 'rugby' }).page(
      ROWS,
      (row) => row,
    ).nextCursor;
    if (cursor === null) throw new Error('expected a cursor');
    for (const [sort, filters] of [
      ['-name', { sport: 'rugby' }],
      ['name', { sport: 'hockey' }],
      ['name', {}],
    ] as const) {
      expect(() => keysetPage(KEYS, { sort, limit: 1, cursor }, filters)).toThrow(
        'another sort or other filters',
      );
    }
    const forged = Buffer.from(
      JSON.stringify({
        v: 1,
        s: 'name',
        f: filtersFingerprint({ sport: 'rugby' }),
        k: ['x', "1' or 1=1"],
      }),
    ).toString('base64url');
    for (const bad of ['not base64 json', forged]) {
      expect(() =>
        keysetPage(KEYS, { sort: 'name', limit: 1, cursor: bad }, { sport: 'rugby' }),
      ).toThrow('Invalid cursor');
    }
  });

  it('fingerprints filters regardless of key order and undefined values', () => {
    expect(filtersFingerprint({ a: 1, b: undefined, c: 'x' })).toBe(
      filtersFingerprint({ c: 'x', a: 1 }),
    );
    expect(filtersFingerprint({ a: 1 })).not.toBe(filtersFingerprint({ a: 2 }));
  });

  it('escapes LIKE wildcards of a search', () => {
    expect(likePattern('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
  });
});

describe('write helpers', () => {
  const reply = () => {
    const headers: Record<string, string> = {};
    return {
      headers,
      reply: {
        header(name: string, value: string) {
          headers[name] = value;
          return this;
        },
      } as unknown as FastifyReply,
    };
  };

  it('tells a missing row (404) from a stale version (409)', async () => {
    await expect(
      updateAtVersion({
        resource: 'Category',
        update: () => Promise.resolve(undefined),
        exists: () => Promise.resolve(true),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(
      updateAtVersion({
        resource: 'Category',
        update: () => Promise.resolve(undefined),
        exists: () => Promise.resolve(false),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      await updateAtVersion({
        resource: 'Category',
        update: () => Promise.resolve('row'),
        exists: () => Promise.resolve(false),
      }),
    ).toBe('row');
  });

  it('returns the row of a replayed create and marks the response', async () => {
    const first = reply();
    expect(
      await insertIdempotent({
        clientUuid: 'uuid',
        reply: first.reply,
        insert: () => Promise.resolve('new'),
        findByClientUuid: () => Promise.resolve('old'),
      }),
    ).toEqual({ row: 'new', replayed: false });
    expect(first.headers).toEqual({});

    const again = reply();
    expect(
      await insertIdempotent({
        clientUuid: 'uuid',
        reply: again.reply,
        insert: () => Promise.resolve(undefined),
        findByClientUuid: () => Promise.resolve('old'),
      }),
    ).toEqual({ row: 'old', replayed: true });
    expect(again.headers).toEqual({ 'x-idempotent-replay': 'true' });

    await expect(
      insertIdempotent({
        clientUuid: 'uuid',
        reply: reply().reply,
        insert: () => Promise.resolve(undefined),
        findByClientUuid: () => Promise.resolve(undefined),
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });
});
