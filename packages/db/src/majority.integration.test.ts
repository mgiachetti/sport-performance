import type { PlayerId } from '@sport-performance/domain';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
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
 * Coming of age at the database (B-311, ADR 0048): what the guardian of an
 * adult sees with and without the adult's confirmation, the adult's decision
 * (`app.review_guardian`), the guardian's own view of their links
 * (`app.guardian_children`) and the lapse of a guardian's signatures
 * (`app.current_consent_types`), through the API's real role.
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

describe.skipIf(!hasDatabase)('coming of age (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let player: PlayerId;
  let link: string;

  const as = (who: FixtureUser, club: ClubFixture = a): TestContext => ({
    clubId: club.clubId,
    userId: club.users[who],
    role: who === 'coachM17' ? 'coach' : who,
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);
  const ids = (context: TestContext, sql: string, params: unknown[] = []) =>
    run(context, async (client) => {
      const { rows } = await client.query<{ id: string }>(sql, params);
      return rows.map((r) => r.id).sort();
    });
  const review = (context: TestContext, decision: string, guardianId = link) =>
    run(context, async (client) => {
      const { rows } = await client.query<{ outcome: string }>(
        'select app.review_guardian($1, $2) as outcome',
        [guardianId, decision],
      );
      return must(rows[0]).outcome;
    });
  const consentTypes = (context: TestContext) =>
    run(context, async (client) => {
      const { rows } = await client.query<{ types: string }>(
        'select app.current_consent_types($1)::text as types',
        [player],
      );
      return must(rows[0]).types;
    });

  /** The club's day, as the database computes it. */
  async function clubToday(): Promise<string> {
    const { rows } = await t.pool.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [a.clubId],
    );
    return must(rows[0]).today;
  }
  /** Makes the fixture's player of age `days` days ago (0: today is the 18th birthday). */
  async function ofAgeSince(days: number): Promise<void> {
    await t.pool.query(
      `update player set birth_date = (($2::date - $3::int) - interval '18 years')::date where id = $1`,
      [player, await clubToday(), days],
    );
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'majority-a');
    b = await seedClubFixture(t.db, 'majority-b');
    player = must<PlayerId>(a.players.assigned);
    link = must(a.rows.guardian);
    app = await connectAs(t, 'app');
  });

  afterEach(async () => {
    await t.pool.query(`update player set birth_date = $2 where id = $1`, [
      player,
      MINOR_BIRTH_DATE,
    ]);
    await t.pool.query(
      `update guardian set adult_confirmed_at = null, adult_confirmed_by = null, valid_to = null where id = $1`,
      [link],
    );
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe('what the guardian sees', () => {
    const visible = async () => ({
      players: await ids(as('parent'), 'select id from player'),
      consents: await ids(as('parent'), 'select player_id as id from consent'),
      heights: await ids(as('parent'), 'select player_id as id from player_parent_height'),
      // What the worker derives (ADR 0046) follows the same player scope.
      load: await ids(as('parent'), 'select distinct player_id as id from player_load_daily'),
      wellness: await ids(
        as('parent'),
        'select distinct player_id as id from player_wellness_daily',
      ),
    });

    it('a minor: their child and every row of the child', async () => {
      expect(await visible()).toEqual({
        players: [player],
        consents: [player],
        heights: [player],
        load: [player],
        wellness: [player],
      });
    });

    it('an adult who did not keep the link: nothing of the child, only the link itself', async () => {
      await ofAgeSince(0);
      expect(await ids(as('parent'), 'select id from player')).toEqual([]);
      expect(await ids(as('parent'), 'select id from consent')).toEqual([]);
      expect(await ids(as('parent'), 'select id from player_parent_height')).toEqual([]);
      expect(await ids(as('parent'), 'select id from player_access_code')).toEqual([]);
      expect(await ids(as('parent'), 'select id from player_load_daily')).toEqual([]);
      expect(await ids(as('parent'), 'select id from player_wellness_daily')).toEqual([]);
      expect(await ids(as('parent'), 'select id from guardian')).toEqual([link]);
      // The adult still sees everything of their own.
      expect(await ids(as('player'), 'select id from player')).toEqual([player]);
      expect(await ids(as('player'), 'select id from guardian')).toEqual([link]);
    });

    it('the day before the 18th birthday the guardian still sees the child', async () => {
      await ofAgeSince(-1);
      expect(await ids(as('parent'), 'select id from player')).toEqual([player]);
    });

    it('an adult who kept the link: the guardian sees the child again', async () => {
      await ofAgeSince(10);
      expect(await review(as('player'), 'confirm')).toBe('ok');
      expect(await ids(as('parent'), 'select id from player')).toEqual([player]);
      expect(await ids(as('parent'), 'select player_id as id from consent')).toEqual([player]);
    });

    it('app.guardian_children lists the current links with the little a guardian may know', async () => {
      await ofAgeSince(0);
      const children = await run(as('parent'), async (client) => {
        const { rows } = await client.query<Record<string, unknown>>(
          'select * from app.guardian_children()',
        );
        return rows;
      });
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({
        guardian_id: link,
        player_id: player,
        relationship: 'mother',
        has_account: true,
        adult_confirmed: false,
      });
      expect(Object.keys(must(children[0])).sort()).toEqual(
        [
          'adult_confirmed',
          'birth_date',
          'first_name',
          'guardian_id',
          'has_account',
          'last_name',
          'player_id',
          'relationship',
        ].sort(),
      );
      // Only for the parent role, and only their own links.
      for (const who of ['player', 'admin', 'coach'] as const) {
        expect(
          await ids(as(who), 'select guardian_id as id from app.guardian_children()'),
          who,
        ).toEqual([]);
      }
      expect(
        await ids(as('parent', b), 'select guardian_id as id from app.guardian_children()'),
      ).toEqual([must(b.rows.guardian)]);
    });

    it('the adult sees the name of their guardians, not other users', async () => {
      expect(await ids(as('player'), 'select id from "user"')).toEqual(
        [a.users.player, a.users.parent].sort(),
      );
    });
  });

  describe('app.review_guardian', () => {
    it('only the adult player decides, on their own links', async () => {
      await ofAgeSince(0);
      for (const who of ['parent', 'admin', 'coach', 'medical'] as const) {
        expect(await review(as(who), 'confirm'), who).toBe('not_found');
      }
      // The player of another club, or a link of another club, does not exist.
      expect(await review(as('player', b), 'confirm')).toBe('not_found');
      expect(await review(as('player'), 'confirm', must(b.rows.guardian))).toBe('not_found');
      // A role the membership does not have is not validated.
      expect(await review({ ...as('parent'), role: 'player' }, 'confirm')).toBe('not_found');
    });

    it('a minor cannot decide', async () => {
      expect(await review(as('player'), 'confirm')).toBe('minor');
      expect(await review(as('player'), 'end')).toBe('minor');
    });

    it('rejects an unknown decision', async () => {
      await ofAgeSince(0);
      expect(await pgCode(review(as('player'), 'delete'))).toBe('22023');
    });

    it('confirm and withdraw are idempotent and record who decided', async () => {
      await ofAgeSince(0);
      expect(await review(as('player'), 'confirm')).toBe('ok');
      const first = await t.pool.query<{ at: Date; by: string; updated_by: string }>(
        'select adult_confirmed_at as at, adult_confirmed_by as by, updated_by from guardian where id = $1',
        [link],
      );
      expect(first.rows[0]).toMatchObject({ by: a.users.player, updated_by: a.users.player });
      expect(await review(as('player'), 'confirm')).toBe('ok');
      const second = await t.pool.query<{ at: Date }>(
        'select adult_confirmed_at as at from guardian where id = $1',
        [link],
      );
      // Confirming again keeps the first decision's time.
      expect(must(second.rows[0]).at).toEqual(must(first.rows[0]).at);
      expect(await review(as('player'), 'withdraw')).toBe('ok');
      expect(await review(as('player'), 'withdraw')).toBe('ok');
      expect(await ids(as('parent'), 'select id from player')).toEqual([]);
    });

    it('end closes the link from today and revokes what the guardian left open', async () => {
      await ofAgeSince(0);
      const today = await clubToday();
      expect(await review(as('player'), 'end')).toBe('ok');
      const { rows } = await t.pool.query<{ valid_to: string }>(
        'select valid_to::text from guardian where id = $1',
        [link],
      );
      expect(must(rows[0]).valid_to).toBe(today);
      const code = await t.pool.query<{ revoked_by: string | null }>(
        'select revoked_by from player_access_code where id = $1',
        [must(a.rows.player_access_code)],
      );
      expect(must(code.rows[0]).revoked_by).toBe(a.users.player);
      // Ending again is a no-op; keeping an ended link is refused.
      expect(await review(as('player'), 'end')).toBe('ok');
      expect(await review(as('player'), 'confirm')).toBe('ended');
      // The former guardian keeps seeing the ended link itself, never the adult's data.
      expect(await ids(as('parent'), 'select id from player')).toEqual([]);
      await t.pool.query(
        'update player_access_code set revoked_at = null, revoked_by = null where id = $1',
        [must(a.rows.player_access_code)],
      );
    });

    it('the application cannot write the confirmation directly as the player', async () => {
      await ofAgeSince(0);
      // Not even granted: the columns are written only by app.review_guardian.
      expect(
        await pgCode(
          run(as('player'), (client) =>
            client.query('update guardian set adult_confirmed_at = now() where id = $1', [link]),
          ),
        ),
      ).toBe('42501');
      expect(
        await pgCode(
          run(as('admin'), (client) =>
            client.query('update guardian set adult_confirmed_at = now() where id = $1', [link]),
          ),
        ),
      ).toBe('42501');
    });
  });

  describe('app.current_consent_types', () => {
    it("a guardian's signature counts for 30 days after the majority, then lapses", async () => {
      // The fixture's data consent was signed by the guardian.
      expect(await consentTypes(as('admin'))).toBe('{data}');
      await ofAgeSince(29);
      expect(await consentTypes(as('admin'))).toBe('{data}');
      expect(await consentTypes(as('player'))).toBe('{data}');
      await ofAgeSince(30);
      expect(await consentTypes(as('admin'))).toBe('{}');
      expect(await consentTypes(as('player'))).toBe('{}');
    });

    it("the adult's own signature of the same text coexists and counts", async () => {
      await ofAgeSince(400);
      const sign = (signerKind: string, signedBy: string) =>
        t.pool.query<{ id: string }>(
          `insert into consent (club_id, player_id, type, document_version, document_id, signer_kind, signed_by)
           values ($1, $2, 'data', '2026-01', $3, $4, $5) returning id`,
          [a.clubId, player, must(a.rows.consent_document), signerKind, signedBy],
        );
      const own = await sign('player', a.users.player);
      try {
        expect(await consentTypes(as('player'))).toBe('{data}');
        // Still one current signature per text and signer.
        expect(await pgCode(sign('player', a.users.player))).toBe('23505');
        expect(await pgCode(sign('guardian', a.users.parent))).toBe('23505');
      } finally {
        await t.pool.query(
          'update consent set revoked_at = now(), revoked_by = signed_by where id = $1',
          [must(own.rows[0]).id],
        );
      }
    });
  });
});
