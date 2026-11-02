/**
 * The API's data layer against a migrated Postgres 16, connected as a real
 * login of `sport_performance_app` (ADR 0006, ADR 0025): RLS isolates clubs
 * and fails closed through the real transaction helper, the Drizzle client
 * handlers get runs inside the request transaction, and a pooled connection
 * never leaks a context.
 */
import { randomBytes } from 'node:crypto';
import { defineEndpoint } from '@sport-performance/contracts';
import {
  assertConnectionRole,
  DatabaseRoleError,
  provisionLoginRole,
  runMigrations,
  schema,
} from '@sport-performance/db';
import { parseClubId, parseUserId, type ClubId, type UserId } from '@sport-performance/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { z } from 'zod';
import type { AuthContext } from '../auth/context.js';
import { registerEndpoint } from '../http/endpoint.js';
import { describeWithPostgres, testApp } from '../testing/support.js';
import { createApiPool, createPgDatabase, databaseFromPool, type Database } from './database.js';
import { ANONYMOUS_CONTEXT, TENANT_SETTINGS, type TenantContext } from './tenant-context.js';

interface Club {
  id: ClubId;
  admin: UserId;
  player: string;
}

const playersEndpoint = defineEndpoint({
  method: 'GET',
  path: '/v1/test/players',
  summary: 'Players the caller can see, read with the Drizzle client',
  tags: ['system'],
  auth: 'public',
  response: { status: 200, description: 'Ids', schema: z.object({ ids: z.array(z.string()) }) },
  errors: [],
});

function headerAuth(request: FastifyRequest): Promise<AuthContext | null> {
  const user = request.headers['x-test-user'];
  const club = request.headers['x-test-club'];
  if (typeof user !== 'string' || typeof club !== 'string') return Promise.resolve(null);
  return Promise.resolve({
    userId: parseUserId(user),
    membership: { clubId: parseClubId(club), role: 'admin' },
  });
}

describeWithPostgres('RLS through the API data layer (Postgres)', (url) => {
  const name = `sp_api_rls_${randomBytes(5).toString('hex')}`;
  const login = `sp_test_api_${randomBytes(5).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  let ownerUrl: string;
  let appUrl: string;
  let owner: pg.Pool;
  let db: Database;
  let app: FastifyInstance;
  let a: Club;
  let b: Club;

  const adminOf = (club: Club): TenantContext => ({
    clubId: club.id,
    userId: club.admin,
    role: 'admin',
  });

  async function seedClub(slug: string): Promise<Club> {
    const one = async (sql: string, params: unknown[]) => {
      const { rows } = await owner.query<{ id: string }>(sql, params);
      const row = rows[0];
      if (row === undefined) throw new Error('no row');
      return row.id;
    };
    const id = await one(`insert into club (slug, name) values ($1, $1) returning id`, [slug]);
    const admin = await one(`insert into "user" (name, email) values ('Admin', $1) returning id`, [
      `admin@${slug}.example.com`,
    ]);
    await owner.query(`insert into membership (club_id, user_id, role) values ($1, $2, 'admin')`, [
      id,
      admin,
    ]);
    const player = await one(
      `insert into player (club_id, first_name, last_name, birth_date, sex, joined_on)
       values ($1, 'Juan', $2, '2011-05-04', 'male', '2024-03-01') returning id`,
      [id, slug],
    );
    return { id: parseClubId(id), admin: parseUserId(admin), player };
  }

  const playerIds = (context: TenantContext, database: Database = db) =>
    database.transaction(context, async (tx) => {
      const { rows } = await tx.query<{ id: string }>('select id from player order by id');
      return rows.map((r) => r.id);
    });

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`create database "${name}"`);
    await admin.end();
    const parsed = new URL(url);
    parsed.pathname = `/${name}`;
    ownerUrl = parsed.toString();
    await runMigrations({ connectionString: ownerUrl });
    await provisionLoginRole({ connectionString: url, login, password, role: 'app' });
    parsed.username = login;
    parsed.password = password;
    appUrl = parsed.toString();

    owner = new pg.Pool({ connectionString: ownerUrl, max: 2 });
    a = await seedClub('api-a');
    b = await seedClub('api-b');

    db = createPgDatabase({
      url: appUrl,
      poolMax: 2,
      connectTimeoutMs: 5000,
      statementTimeoutMs: 5000,
    });
    ({ app } = await testApp({
      db,
      authenticate: headerAuth,
      register: (instance) => {
        registerEndpoint(instance, playersEndpoint, {
          transaction: true,
          handler: async (_input, { db: orm }) => {
            const rows = await orm.select({ id: schema.player.id }).from(schema.player);
            return { ids: rows.map((r) => r.id) };
          },
        });
      },
    }));
    // Creating the database and running every migration takes a few seconds.
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await db.close();
    await owner.end();
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.query(`drop role if exists "${login}"`);
    await admin.end();
  });

  it('writes the settings the policies read', () => {
    expect(TENANT_SETTINGS).toEqual(['app.club_id', 'app.user_id', 'app.role']);
  });

  it('isolates clubs and fails closed through the transaction helper', async () => {
    expect(await playerIds(adminOf(a))).toEqual([a.player]);
    expect(await playerIds(adminOf(b))).toEqual([b.player]);
    expect(await playerIds(ANONYMOUS_CONTEXT)).toEqual([]);
    expect(await playerIds({ clubId: null, userId: a.admin, role: null })).toEqual([]);
    // A member of A claiming to act in B.
    expect(await playerIds({ clubId: b.id, userId: a.admin, role: 'admin' })).toEqual([]);
  });

  it('runs the Drizzle client of a handler inside the request transaction', async () => {
    const as = (club: Club | null) =>
      app.inject({
        url: '/v1/test/players',
        headers: club === null ? {} : { 'x-test-user': club.admin, 'x-test-club': club.id },
      });
    const [anonymous, ofA, ofB] = await Promise.all([as(null), as(a), as(b)]);
    expect(anonymous.json()).toEqual({ ids: [] });
    expect(ofA.json()).toEqual({ ids: [a.player] });
    expect(ofB.json()).toEqual({ ids: [b.player] });
  });

  it('never leaks a context through a pooled connection, even one set at session level', async () => {
    const pool = createApiPool({
      url: appUrl,
      poolMax: 1,
      connectTimeoutMs: 5000,
      statementTimeoutMs: 5000,
    });
    const single = databaseFromPool(pool);
    try {
      expect(await playerIds(adminOf(a), single)).toEqual([a.player]);
      expect(await playerIds(ANONYMOUS_CONTEXT, single)).toEqual([]);
      // A bug sets the context for the whole session (is_local = false) on the only connection.
      await pool.query(
        `select set_config('app.club_id', $1, false), set_config('app.user_id', $2, false),
                set_config('app.role', 'admin', false)`,
        [a.id, a.admin],
      );
      expect(await playerIds(ANONYMOUS_CONTEXT, single)).toEqual([]);
      expect(await playerIds(adminOf(b), single)).toEqual([b.player]);
    } finally {
      await single.close();
    }
  });

  it('accepts the application login and rejects the owner at startup', async () => {
    const appPool = createApiPool({
      url: appUrl,
      poolMax: 1,
      connectTimeoutMs: 5000,
      statementTimeoutMs: 5000,
    });
    const ownerPool = createApiPool({
      url: ownerUrl,
      poolMax: 1,
      connectTimeoutMs: 5000,
      statementTimeoutMs: 5000,
    });
    try {
      await assertConnectionRole(appPool, 'app');
      await expect(assertConnectionRole(ownerPool, 'app')).rejects.toBeInstanceOf(
        DatabaseRoleError,
      );
    } finally {
      await appPool.end();
      await ownerPool.end();
    }
  });
});
