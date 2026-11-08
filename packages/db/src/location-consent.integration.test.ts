import { LOCATION_ERASURE_CHANGE_REASON, type PlayerId } from '@sport-performance/domain';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  inContext,
  must,
  type MigratedTestDatabase,
  type RoleConnection,
  type TestContext,
} from './testing/database.js';
import { seedClubFixture, type ClubFixture, type FixtureUser } from './testing/tenant-fixture.js';

/**
 * The location consent of the pod in the database (B-913, ADR 0106):
 * `app.current_consent_types` counts it only while granted (current text;
 * the adult's own signature once of age), revoking it queues one erasure of
 * the player's position data, the erasures are read by the administration
 * and the holder only, the application never writes them, and the worker's
 * completion is recorded in the change history with the counts only.
 */

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    const failure = error as { code?: string; cause?: { code?: string } };
    return failure.code ?? failure.cause?.code;
  }
  return 'no error';
}

const MINOR_BIRTH_DATE = '2011-05-04';

describe.skipIf(!hasDatabase)('location consent (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let player: PlayerId;

  const as = (who: FixtureUser, club: ClubFixture = a): TestContext => ({
    clubId: club.clubId,
    userId: club.users[who],
    role: who === 'coachM17' ? 'coach' : who,
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);
  const consentTypes = (context: TestContext = as('admin')) =>
    run(context, async (client) => {
      const { rows } = await client.query<{ types: string[] }>(
        'select app.current_consent_types($1)::text[] as types',
        [player],
      );
      return must(rows[0]).types;
    });

  /** Publishes a location text of the club (as the owner) and returns its id. */
  async function publish(version: string, club: ClubFixture = a): Promise<string> {
    const { rows } = await t.pool.query<{ id: string }>(
      `insert into consent_document (club_id, type, version, locale, title, body, published_at)
       values ($1, 'location', $2, 'es-AR', 'Ubicación', 'Texto de ubicación ' || $2,
               now() - interval '1 day' + (select count(*) from consent_document
                                            where club_id = $1 and type = 'location') * interval '1 minute')
       returning id`,
      [club.clubId, version],
    );
    return must(rows[0]).id;
  }

  /** Signs a location text for the player (as the owner) and returns the consent id. */
  async function sign(
    documentId: string,
    signer: 'guardian' | 'player',
    version: string,
  ): Promise<string> {
    const { rows } = await t.pool.query<{ id: string }>(
      `insert into consent (club_id, player_id, type, document_id, document_version, signer_kind,
                            signed_by, signed_at)
       values ($1, $2, 'location', $3, $4, $5, $6, now() - interval '1 hour') returning id`,
      [
        a.clubId,
        player,
        documentId,
        version,
        signer,
        signer === 'guardian' ? a.users.parent : a.users.player,
      ],
    );
    return must(rows[0]).id;
  }

  async function clubToday(): Promise<string> {
    const { rows } = await t.pool.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [a.clubId],
    );
    return must(rows[0]).today;
  }

  async function ofAgeSince(days: number): Promise<void> {
    await t.pool.query(
      `update player set birth_date = (($2::date - $3::int) - interval '18 years')::date where id = $1`,
      [player, await clubToday(), days],
    );
  }

  const revoke = (who: FixtureUser) =>
    run(as(who), (client) =>
      client.query(
        `update consent set revoked_at = now(), revoked_by = $2, updated_by = $2
          where player_id = $1 and type = 'location' and revoked_at is null`,
        [player, a.users[who]],
      ),
    );

  /** The erasures of the test's club, but the fixture's completed one. */
  async function erasures() {
    const { rows } = await t.pool.query<{
      id: string;
      player_id: string;
      status: string;
      reason: string;
      requested_by: string | null;
      deleted_rows: Record<string, number> | null;
    }>(
      `select id, player_id, status::text, reason::text, requested_by, deleted_rows
         from location_erasure where club_id = $1 and id <> $2
        order by created_at`,
      [a.clubId, a.rows.location_erasure],
    );
    return rows;
  }

  let clubs = 0;

  beforeAll(async () => {
    t = await createMigratedDatabase();
    b = await seedClubFixture(t.db, 'location-b');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
  });

  // Consents and texts are evidence (no deletes): every test gets a club of its own.
  beforeEach(async () => {
    clubs += 1;
    a = await seedClubFixture(t.db, `location-a${String(clubs)}`);
    player = must<PlayerId>(a.players.assigned);
    await t.pool.query(`update player set birth_date = $2 where id = $1`, [
      player,
      MINOR_BIRTH_DATE,
    ]);
  });

  afterEach(async () => {
    // A pending erasure is the worker's: leave none for the sweep test of another club.
    await t.pool.query(
      `update location_erasure set status = 'completed', completed_at = now(), deleted_rows = '{}'
        where status = 'pending'`,
    );
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  describe('app.current_consent_types', () => {
    it("counts a guardian's signature of a minor on the current text", async () => {
      const v1 = await publish('2026-11');
      await sign(v1, 'guardian', '2026-11');
      expect(await consentTypes()).toEqual(['data', 'location']);
      // The holder and the assigned staff see the same answer.
      expect(await consentTypes(as('parent'))).toEqual(['data', 'location']);
      expect(await consentTypes(as('coach'))).toEqual(['data', 'location']);
    });

    it('stops counting it on a new version of the text (outdated), unlike data', async () => {
      const v1 = await publish('2026-11');
      await sign(v1, 'guardian', '2026-11');
      await publish('2026-12');
      // The fixture's data consent is on an older text too, and still counts.
      expect(await consentTypes()).toEqual(['data']);
      const v2 = must(
        (
          await t.pool.query<{ id: string }>(
            `select id from consent_document where club_id = $1 and type = 'location' and version = '2026-12'`,
            [a.clubId],
          )
        ).rows[0],
      ).id;
      await sign(v2, 'guardian', '2026-12');
      expect(await consentTypes()).toEqual(['data', 'location']);
    });

    it("an adult needs their own signature: a guardian's does not count, even in the grace period", async () => {
      const v1 = await publish('2026-11');
      await sign(v1, 'guardian', '2026-11');
      await ofAgeSince(0);
      // `data` still counts on the guardian's signature within the grace period.
      expect(await consentTypes()).toEqual(['data']);
      await sign(v1, 'player', '2026-11');
      expect(await consentTypes()).toEqual(['data', 'location']);
    });

    it('a text of another club is never the current one', async () => {
      const v1 = await publish('2026-11');
      await sign(v1, 'guardian', '2026-11');
      await publish('2027-01', b);
      expect(await consentTypes()).toEqual(['data', 'location']);
    });
  });

  describe('revoking queues the erasure of the position data', () => {
    it('one pending erasure per player, with who revoked, for the worker to find', async () => {
      const v1 = await publish('2026-11');
      await sign(v1, 'guardian', '2026-11');
      await sign(v1, 'player', '2026-11');
      await revoke('parent');
      const rows = await erasures();
      expect(rows).toEqual([
        expect.objectContaining({
          player_id: player,
          status: 'pending',
          reason: 'consent_revoked',
          requested_by: a.users.parent,
          deleted_rows: null,
        }),
      ]);
      const clubs = await inContext(worker.pool, {}, async (c) => {
        const { rows: found } = await c.query<{ club: string }>(
          'select c as club from app.worker_location_erasure_clubs() c',
        );
        return found.map((r) => r.club);
      });
      expect(clubs).toEqual([a.clubId]);
      // Signing and revoking again while it is pending adds nothing.
      const again = await sign(v1, 'guardian', '2026-11');
      await revoke('parent');
      expect(again).toBeDefined();
      expect((await erasures()).filter((r) => r.status === 'pending')).toHaveLength(1);
    });

    it('revoking another type queues nothing', async () => {
      await run(as('parent'), (client) =>
        client.query(
          `update consent set revoked_at = now(), revoked_by = $2, updated_by = $2
            where player_id = $1 and type = 'data' and revoked_at is null`,
          [player, a.users.parent],
        ),
      );
      expect(await erasures()).toEqual([]);
    });
  });

  describe('RLS of the erasures', () => {
    let erasure: string;

    async function queue(): Promise<void> {
      const v1 = await publish('2026-11');
      await sign(v1, 'guardian', '2026-11');
      await revoke('parent');
      erasure = must((await erasures())[0]).id;
    }

    const visible = (context: TestContext) =>
      run(context, async (client) => {
        const { rows } = await client.query<{ id: string }>(
          'select id from location_erasure where id = $1',
          [erasure],
        );
        return rows.length;
      });

    it('the administration and the holder read it; the staff and another club do not', async () => {
      await queue();
      expect(await visible(as('admin'))).toBe(1);
      expect(await visible(as('parent'))).toBe(1);
      expect(await visible(as('player'))).toBe(1);
      expect(await visible(as('coach'))).toBe(0);
      expect(await visible(as('sc'))).toBe(0);
      expect(await visible(as('medical'))).toBe(0);
      expect(await visible(as('admin', b))).toBe(0);
    });

    it('the application never inserts, updates nor deletes one', async () => {
      await queue();
      expect(
        await pgCode(
          run(as('admin'), (client) =>
            client.query(
              `insert into location_erasure (club_id, player_id, reason, status)
               values ($1, $2, 'consent_revoked', 'pending')`,
              [a.clubId, a.players.other],
            ),
          ),
        ),
      ).toBe('42501');
      expect(
        await pgCode(
          run(as('admin'), (client) =>
            client.query(
              `update location_erasure set status = 'completed', completed_at = now(),
                      deleted_rows = '{}' where id = $1`,
              [erasure],
            ),
          ),
        ),
      ).toBe('42501');
      expect(
        await pgCode(
          run(as('admin'), (client) =>
            client.query('delete from location_erasure where id = $1', [erasure]),
          ),
        ),
      ).toBe('42501');
    });

    it('the worker completes it in its club only, and the history keeps the counts only', async () => {
      await queue();
      // Another club's worker context does not see it.
      const fromB = await inContext(worker.pool, { clubId: b.clubId }, (c) =>
        c.query(
          `update location_erasure set status = 'completed', completed_at = now(),
                  deleted_rows = '{}' where id = $1`,
          [erasure],
        ),
      );
      expect(fromB.rowCount).toBe(0);
      await inContext(worker.pool, { clubId: a.clubId }, async (c) => {
        await c.query("select set_config('app.change_reason', $1, true)", [
          LOCATION_ERASURE_CHANGE_REASON,
        ]);
        const done = await c.query(
          `update location_erasure set status = 'completed', completed_at = now(),
                  deleted_rows = '{"public.position_trace": 3}' where id = $1`,
          [erasure],
        );
        expect(done.rowCount).toBe(1);
      });
      const { rows } = await t.pool.query<{
        player_id: string;
        source: string;
        reason: string;
        new_values: Record<string, unknown>;
      }>(
        `select player_id, source::text, reason, new_values from change_history
          where table_name = 'location_erasure' and record_id = $1`,
        [erasure],
      );
      expect(rows).toEqual([
        {
          player_id: player,
          source: 'worker',
          reason: LOCATION_ERASURE_CHANGE_REASON,
          new_values: expect.objectContaining({
            status: 'completed',
            deleted_rows: { 'public.position_trace': 3 },
          }) as unknown,
        },
      ]);
      // A completed erasure has its counts; a pending one has none.
      expect(
        await pgCode(
          inContext(worker.pool, { clubId: a.clubId }, (c) =>
            c.query(
              `update location_erasure set status = 'pending', completed_at = null where id = $1`,
              [erasure],
            ),
          ),
        ),
      ).toBe('23514');
    });
  });
});
