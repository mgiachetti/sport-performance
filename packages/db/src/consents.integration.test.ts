import { createHash } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { guardian, membership, user } from './schema/index.js';
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
 * Consents and their texts (B-312, ADR 0043): published texts are immutable
 * (also for the owner) and carry the hash the database computes; a signed
 * consent only changes to be revoked, once, and references a text of the
 * same type and version; only the holder signs and revokes (RLS behind the
 * matrix); `app.current_consent_types` is the single definition of a current
 * consent, also for the medical schema.
 */
/** A pool or a client in a transaction. */
type Queryable = Pick<pg.Pool, 'query'>;

describe.skipIf(!hasDatabase)('consents (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let secondParent: string;

  const as = (who: FixtureUser | 'secondParent', club: ClubFixture = a): TestContext => {
    if (who === 'secondParent')
      return { clubId: club.clubId, userId: secondParent, role: 'parent' };
    return {
      clubId: club.clubId,
      userId: club.users[who],
      role: who === 'coachM17' ? 'coach' : who,
    };
  };
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);

  async function publish(
    client: Queryable,
    clubId: string,
    type: string,
    version: string,
    body = `Texto ${type} ${version}.`,
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into consent_document (club_id, type, version, title, body)
       values ($1, $2, $3, 'Consentimiento', $4) returning id`,
      [clubId, type, version, body],
    );
    return must(rows[0]).id;
  }

  async function sign(
    client: Queryable,
    values: {
      playerId: string;
      documentId: string | null;
      type: string;
      version: string;
      by: string;
      kind?: string;
    },
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `insert into consent (club_id, player_id, type, document_version, document_id, signer_kind, signed_by)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        a.clubId,
        values.playerId,
        values.type,
        values.version,
        values.documentId,
        values.kind ?? 'guardian',
        values.by,
      ],
    );
    return must(rows[0]).id;
  }

  const currentTypes = (context: TestContext, playerId: string) =>
    run(context, async (client) => {
      const { rows } = await client.query<{ types: string }>(
        'select app.current_consent_types($1)::text as types',
        [playerId],
      );
      return must(rows[0]).types;
    });

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'consents-a');
    b = await seedClubFixture(t.db, 'consents-b');
    secondParent = must(
      (
        await t.db
          .insert(user)
          .values({ name: 'Padre', email: 'padre@consents-a.example.com' })
          .returning({ id: user.id })
      )[0],
    ).id;
    await t.db
      .insert(membership)
      .values({ clubId: a.clubId, userId: secondParent, role: 'parent' });
    await t.db.insert(guardian).values({
      clubId: a.clubId,
      playerId: a.players.assigned,
      userId: secondParent,
      relationship: 'father',
      validFrom: '2020-01-01' as never,
    });
    app = await connectAs(t, 'app');
  });

  afterAll(async () => {
    await app.close();
    await t.close();
  });

  describe('consent texts', () => {
    it('the database computes the hash of the body, whatever the client sends', async () => {
      const body = 'Autorizo el uso de imágenes de mi hijo/a para el análisis del salto.';
      const { rows } = await t.pool.query<{ body_sha256: string }>(
        `insert into consent_document (club_id, type, version, title, body, body_sha256)
         values ($1, 'image', 'hash-1', 'Imagen', $2, 'forged') returning body_sha256`,
        [a.clubId, body],
      );
      expect(must(rows[0]).body_sha256).toBe(
        createHash('sha256').update(body, 'utf8').digest('hex'),
      );
    });

    it('a published text never changes nor disappears, not even for the owner', async () => {
      const id = await publish(t.pool, a.clubId, 'image', 'frozen-1');
      for (const statement of [
        `update consent_document set body = 'otro texto' where id = $1`,
        `update consent_document set version = 'frozen-2' where id = $1`,
        `update consent_document set body_sha256 = 'x' where id = $1`,
        `delete from consent_document where id = $1`,
      ]) {
        expect(await pgErrorOf(t.pool.query(statement, [id])), statement).toEqual({
          code: '23514',
          constraint: 'consent_document_immutable',
        });
      }
    });

    it('the administration publishes, every member reads, nobody else writes', async () => {
      const id = await run(as('admin'), (client) => publish(client, a.clubId, 'data', 'admin-1'));
      for (const who of ['coach', 'sc', 'medical', 'player', 'parent'] as const) {
        const seen = await run(as(who), async (client) => {
          const { rows } = await client.query('select id from consent_document where id = $1', [
            id,
          ]);
          return rows.length;
        });
        expect(seen, who).toBe(1);
        expect(
          (await pgErrorOf(run(as(who), (client) => publish(client, a.clubId, 'data', `${who}-1`))))
            .code,
          who,
        ).toBe('42501');
      }
      // No UPDATE grant for the application.
      expect(
        (
          await pgErrorOf(
            run(as('admin'), (client) =>
              client.query(`update consent_document set title = 'x' where id = $1`, [id]),
            ),
          )
        ).code,
      ).toBe('42501');
    });

    it('a version is unique per club and type', async () => {
      await publish(t.pool, a.clubId, 'health', 'dup-1');
      expect((await pgErrorOf(publish(t.pool, a.clubId, 'health', 'dup-1'))).code).toBe('23505');
      // Another type or another club may reuse it.
      await publish(t.pool, a.clubId, 'image', 'dup-1');
      await publish(t.pool, b.clubId, 'health', 'dup-1');
    });
  });

  describe('signed consents', () => {
    let imageDocument: string;

    beforeAll(async () => {
      imageDocument = await publish(t.pool, a.clubId, 'image', 'sign-1');
    });

    it('reference a text of the same type and version', async () => {
      expect(
        await pgErrorOf(
          sign(t.pool, {
            playerId: a.players.assigned,
            documentId: imageDocument,
            type: 'health',
            version: 'sign-1',
            by: a.users.parent,
          }),
        ),
      ).toEqual({ code: '23514', constraint: 'consent_document_match' });
      expect(
        await pgErrorOf(
          sign(t.pool, {
            playerId: a.players.assigned,
            documentId: imageDocument,
            type: 'image',
            version: 'sign-0',
            by: a.users.parent,
          }),
        ),
      ).toEqual({ code: '23514', constraint: 'consent_document_match' });
      // A text of another club does not exist for this one.
      const foreign = await publish(t.pool, b.clubId, 'image', 'sign-1');
      expect(
        (
          await pgErrorOf(
            sign(t.pool, {
              playerId: a.players.assigned,
              documentId: foreign,
              type: 'image',
              version: 'sign-1',
              by: a.users.parent,
            }),
          )
        ).code,
      ).toBe('23503');
    });

    it('through the application always reference a text', async () => {
      expect(
        await pgErrorOf(
          run(as('parent'), (client) =>
            sign(client, {
              playerId: a.players.assigned,
              documentId: null,
              type: 'image',
              version: 'sign-1',
              by: a.users.parent,
            }),
          ),
        ),
      ).toEqual({ code: '23514', constraint: 'consent_document_required' });
    });

    it('are signed once per text while current', async () => {
      const values = {
        playerId: a.players.assigned,
        documentId: imageDocument,
        type: 'image',
        version: 'sign-1',
        by: a.users.parent,
      };
      const first = await run(as('parent'), (client) => sign(client, values));
      expect(
        (
          await pgErrorOf(
            run(as('secondParent'), (client) => sign(client, { ...values, by: secondParent })),
          )
        ).code,
      ).toBe('23505');
      // Any guardian revokes it, as themselves; then it can be signed again.
      expect(
        (
          await pgErrorOf(
            run(as('secondParent'), (client) =>
              client.query(`update consent set revoked_at = now(), revoked_by = $2 where id = $1`, [
                first,
                a.users.parent,
              ]),
            ),
          )
        ).code,
      ).toBe('42501');
      const revoked = await run(as('secondParent'), (client) =>
        client.query(`update consent set revoked_at = now(), revoked_by = $2 where id = $1`, [
          first,
          secondParent,
        ]),
      );
      expect(revoked.rowCount).toBe(1);
      await run(as('secondParent'), (client) => sign(client, { ...values, by: secondParent }));
    });

    it('only change to be revoked, once, not even for the owner', async () => {
      const id = await sign(t.pool, {
        playerId: a.players.other,
        documentId: await publish(t.pool, a.clubId, 'data', 'frozen-consent'),
        type: 'data',
        version: 'frozen-consent',
        by: a.users.parent,
      });
      const immutable = { code: '23514', constraint: 'consent_immutable' };
      expect(
        await pgErrorOf(t.pool.query(`update consent set type = 'health' where id = $1`, [id])),
      ).toEqual(immutable);
      expect(
        await pgErrorOf(t.pool.query(`update consent set signed_at = now() where id = $1`, [id])),
      ).toEqual(immutable);
      await t.pool.query(
        `update consent set revoked_at = now(), revoked_by = signed_by where id = $1`,
        [id],
      );
      expect(
        await pgErrorOf(
          t.pool.query(`update consent set revoked_at = null, revoked_by = null where id = $1`, [
            id,
          ]),
        ),
      ).toEqual(immutable);
      expect(
        await pgErrorOf(
          t.pool.query(`update consent set revoked_at = now() + interval '1 day' where id = $1`, [
            id,
          ]),
        ),
      ).toEqual(immutable);
      // Nobody deletes a consent: no DELETE grant.
      expect(
        (
          await pgErrorOf(
            run(as('parent'), (client) => client.query('delete from consent where id = $1', [id])),
          )
        ).code,
      ).toBe('42501');
    });

    it('the administration reads consents but never signs or revokes them', async () => {
      const updated = await run(as('admin'), (client) =>
        client.query(
          `update consent set revoked_at = now(), revoked_by = $2
            where club_id = $1 and revoked_at is null`,
          [a.clubId, a.users.admin],
        ),
      );
      expect(updated.rowCount).toBe(0);
      const seen = await run(as('admin'), async (client) => {
        const { rows } = await client.query('select id from consent where club_id = $1', [
          a.clubId,
        ]);
        return rows.length;
      });
      expect(seen).toBeGreaterThan(0);
    });

    it('the player signs as a player', async () => {
      const documentId = await publish(t.pool, a.clubId, 'health', 'player-1');
      const values = {
        playerId: a.players.assigned,
        documentId,
        type: 'health',
        version: 'player-1',
        by: a.users.player,
      };
      expect((await pgErrorOf(run(as('player'), (client) => sign(client, values)))).code).toBe(
        '42501',
      );
      await run(as('player'), (client) => sign(client, { ...values, kind: 'player' }));
      // Not for another player.
      expect(
        (
          await pgErrorOf(
            run(as('player'), (client) =>
              sign(client, { ...values, playerId: a.players.other, kind: 'player' }),
            ),
          )
        ).code,
      ).toBe('42501');
    });
  });

  describe('app.current_consent_types', () => {
    it('answers the current types of a player the context sees, and nothing otherwise', async () => {
      // The fixture's `data` consent, the image consent re-signed and the player's health one.
      expect(await currentTypes(as('parent'), a.players.assigned)).toBe('{data,image,health}');
      expect(await currentTypes(as('admin'), a.players.assigned)).toBe('{data,image,health}');
      expect(await currentTypes(as('coach'), a.players.assigned)).toBe('{data,image,health}');
      // Not visible: the coach of M17, the parent for another player, another club.
      expect(await currentTypes(as('coachM17'), a.players.assigned)).toBe('{}');
      expect(await currentTypes(as('admin', b), a.players.assigned)).toBe('{}');
      expect(await currentTypes(as('parent'), a.players.other)).toBe('{}');
      // Without a context: nothing.
      expect(await currentTypes({}, a.players.assigned)).toBe('{}');
    });

    it('drops a type once revoked; the medical schema asks the same question', async () => {
      const hasHealth = (context: TestContext) =>
        run(context, async (client) => {
          const { rows } = await client.query<{ ok: boolean }>(
            'select medical.has_health_consent($1) as ok',
            [a.players.assigned],
          );
          return must(rows[0]).ok;
        });
      // Owner-only function: the API never calls it directly.
      expect((await pgErrorOf(hasHealth(as('medical')))).code).toBe('42501');
      const viaOwner = async () => {
        const client = await t.pool.connect();
        try {
          await client.query('begin');
          await client.query(
            `select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true),
                    set_config('app.role', 'admin', true)`,
            [a.clubId, a.users.admin],
          );
          const { rows } = await client.query<{ ok: boolean }>(
            'select medical.has_health_consent($1) as ok',
            [a.players.assigned],
          );
          await client.query('rollback');
          return must(rows[0]).ok;
        } finally {
          client.release();
        }
      };
      expect(await viaOwner()).toBe(true);
      await run(as('player'), (client) =>
        client.query(
          `update consent set revoked_at = now(), revoked_by = $3
            where club_id = $1 and player_id = $2 and type = 'health' and revoked_at is null`,
          [a.clubId, a.players.assigned, a.users.player],
        ),
      );
      expect(await currentTypes(as('parent'), a.players.assigned)).toBe('{data,image}');
      expect(await viaOwner()).toBe(false);
    });
  });
});
