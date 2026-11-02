import { createHash } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  inContext,
  must,
  pgErrorOf,
  type MigratedTestDatabase,
  type RoleConnection,
  type TestContext,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture, type FixtureUser } from './testing/tenant-fixture.js';

/**
 * The record of roster imports (B-330, ADR 0047): only the administration
 * writes and reads it, nobody updates or deletes it, and its counts and
 * outcomes are consistent. Isolation between clubs is in
 * `rls.isolation.integration.test.ts`.
 */
describe.skipIf(!hasDatabase)('roster_import (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;

  const as = (who: FixtureUser): TestContext => ({
    clubId: a.clubId,
    userId: a.users[who],
    role: who === 'coachM17' ? 'coach' : who,
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);

  const sha = (text: string) => createHash('sha256').update(text).digest('hex');

  function insert(
    client: Pick<pg.PoolClient, 'query'>,
    values: { rows?: number; created?: number; skipped?: number; outcomes?: unknown[] } = {},
  ) {
    const outcomes = values.outcomes ?? [
      { index: 0, sourceRow: 2, result: 'created', playerId: a.players.other, guardians: [] },
    ];
    return client.query<{ id: string }>(
      `insert into roster_import (club_id, request_sha256, row_count, created_count, updated_count,
         skipped_count, guardians_linked_count, invitations_to_send_count, outcomes, created_by)
       values ($1, $2, $3, $4, 0, $5, 0, 0, $6, app.current_user_id()) returning id`,
      [
        a.clubId,
        sha(String(Math.random())),
        values.rows ?? 1,
        values.created ?? 1,
        values.skipped ?? 0,
        JSON.stringify(outcomes),
      ],
    );
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'roster-import-a');
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  it('the administration writes and reads the record', async () => {
    const id = await run(as('admin'), async (client) => must((await insert(client)).rows[0]).id);
    const read = await run(as('admin'), (client) =>
      client.query('select id from roster_import where id = $1', [id]),
    );
    expect(read.rowCount).toBe(1);
  });

  it.each(['coach', 'sc', 'medical', 'player', 'parent'] as const)(
    '%s neither reads nor writes it',
    async (who) => {
      const read = await run(as(who), (client) => client.query('select id from roster_import'));
      expect(read.rowCount).toBe(0);
      const written = await pgErrorOf(run(as(who), (client) => insert(client)));
      expect(written.code).toBe('42501');
    },
  );

  it('nobody updates or deletes a record', async () => {
    const id = must(a.rows.roster_import);
    for (const statement of [
      'update roster_import set skipped_count = 1 where id = $1',
      'delete from roster_import where id = $1',
    ]) {
      const error = await pgErrorOf(run(as('admin'), (client) => client.query(statement, [id])));
      expect(error.code, statement).toBe('42501');
    }
  });

  it('keeps counts and outcomes consistent', async () => {
    const counts = await pgErrorOf(
      run(as('admin'), (client) => insert(client, { rows: 2, created: 1, skipped: 0 })),
    );
    expect(counts.constraint).toBe('roster_import_counts');
    const outcomes = await pgErrorOf(
      run(as('admin'), (client) => insert(client, { rows: 1, created: 1, outcomes: [] })),
    );
    expect(outcomes.constraint).toBe('roster_import_outcomes_array');
    const hash = await pgErrorOf(
      t.pool.query(
        `insert into roster_import (club_id, request_sha256, row_count, created_count, updated_count,
           skipped_count, guardians_linked_count, invitations_to_send_count, outcomes)
         values ($1, 'not-a-hash', 1, 1, 0, 0, 0, 0, '[{}]')`,
        [a.clubId],
      ),
    );
    expect(hash.constraint).toBe('roster_import_request_sha256_format');
  });
});
