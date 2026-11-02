/**
 * Coming of age end to end (B-311, ADR 0048) against Postgres 16, through the
 * real connection roles (ADR 0026): the adult player decides whether each
 * guardian keeps access, what a guardian of an adult sees with and without
 * that confirmation, and the adult's own consents (the guardian's signature
 * counts for a grace period, then lapses and data is refused with
 * `consent_required`). Players, links and the guardian's past signature are
 * fixtures inserted with the owner connection.
 */
import { defineEndpoint } from '@sport-performance/contracts';
import type { ClubId, PlayerId } from '@sport-performance/domain';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { requirePlayerFacts } from '../http/consents.js';
import { registerEndpoint } from '../http/endpoint.js';
import {
  createCategory,
  createClub,
  createMembership,
  createTestDatabase,
  signIn,
  startIdentityApp,
  type IdentityTestApp,
  type SignedIn,
  type TestDatabase,
} from '../testing/identity.js';
import { describeWithPostgres } from '../testing/support.js';

interface ErrorBody {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface LinkBody {
  id: string;
  playerId: string;
  guardian: { userId: string; name: string | null; email: string | null };
  validTo: string | null;
  current: boolean;
  adultConfirmedAt: string | null;
}

interface ChildBody {
  playerId: string;
  firstName: string;
  ofAge: boolean;
  adultConfirmed: boolean;
  canManageAccess: boolean;
}

interface TypeStatusBody {
  type: string;
  state: string;
  consent: { signerKind: string; signedBy: string } | null;
  actions: string[];
}

interface PlayerConsentsBody {
  playerOfAge: boolean;
  requiredSigner: string;
  guardianSignaturesLapseOn: string;
  types: TypeStatusBody[];
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** A test-only route that stores wellness of a player, guarded like the real one. */
const submitWellnessDouble = defineEndpoint({
  method: 'POST',
  path: '/v1/test/players/{playerId}/wellness-double',
  summary: 'Stores wellness (test double)',
  tags: ['system'],
  auth: 'club',
  params: z.strictObject({ playerId: z.uuid() }),
  response: { status: 200, description: 'Stored', schema: z.object({ ok: z.literal(true) }) },
  errors: ['not_found'],
});

function registerGuardedRoutes(app: FastifyInstance): void {
  registerEndpoint(app, submitWellnessDouble, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth }) => {
      const { facts } = await requirePlayerFacts(
        db,
        auth.membership.clubId,
        params.playerId as PlayerId,
      );
      await permissions.authorize('wellness', 'submit', { player: facts });
      return { ok: true as const };
    },
  });
}

const errorOf = (response: LightMyRequestResponse) => response.json<ErrorBody>().error;

describeWithPostgres('coming of age (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let club: ClubId;
  let admin: SignedIn;
  let father: SignedIn;
  let mother: SignedIn;
  let coach: SignedIn;
  /** Martín: the player who comes of age, with his own account. */
  let martinAccount: SignedIn;
  let martin: PlayerId;
  /** Tomás: his younger brother, a minor. */
  let tomas: PlayerId;
  let fatherLink: string;
  let motherLink: string;
  let dataDocument: string;

  const get = (url: string, caller: SignedIn) => t.app.inject({ url, headers: caller.headers });
  const post = (url: string, caller: SignedIn, payload?: object) =>
    t.app.inject({
      method: 'POST',
      url,
      headers: caller.headers,
      ...(payload !== undefined && { payload }),
    });
  const confirm = (caller: SignedIn, link: string) =>
    post(`/v1/guardians/${link}/adult-confirmation`, caller);
  const withdraw = (caller: SignedIn, link: string) =>
    t.app.inject({
      method: 'DELETE',
      url: `/v1/guardians/${link}/adult-confirmation`,
      headers: caller.headers,
    });
  const consents = async (caller: SignedIn) => {
    const response = await get(`/v1/players/${martin}/consents`, caller);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<PlayerConsentsBody>();
  };
  const dataState = async (caller: SignedIn) =>
    (await consents(caller)).types.find((s) => s.type === 'data');
  const submitWellness = () => post(`/v1/test/players/${martin}/wellness-double`, martinAccount);

  async function clubToday(): Promise<string> {
    const { rows } = await database.admin.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [club],
    );
    const today = rows[0]?.today;
    if (today === undefined) throw new Error('no club');
    return today;
  }
  /** Martín turned 18 `days` days ago (negative: he turns 18 in that many days). */
  async function ofAgeSince(days: number): Promise<string> {
    const { rows } = await database.admin.query<{ birth: string }>(
      `update player set birth_date = (($2::date - $3::int) - interval '18 years')::date
        where id = $1 returning birth_date::text as birth`,
      [martin, await clubToday(), days],
    );
    return rows[0]?.birth ?? '';
  }

  async function insertPlayer(firstName: string, userId: string | null, categoryId: string) {
    const { rows } = await database.admin.query<{ id: PlayerId }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, $3, 'Gómez', '2012-02-02', 'male', 'rugby', '2020-01-01') returning id`,
      [club, userId, firstName],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('player not created');
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [club, id, categoryId],
    );
    return id;
  }
  async function link(playerId: string, userId: string, relationship: string) {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, $4, '2020-01-01') returning id`,
      [club, playerId, userId, relationship],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('link not created');
    return id;
  }

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      register: registerGuardedRoutes,
      routeClassLimits: {
        auth: { perIp: { name: 'api_auth_ip', max: 1000, windowS: 60 } },
        write: {
          perIp: { name: 'api_write_ip', max: 10_000, windowS: 60 },
          perUser: { name: 'api_write_user', max: 10_000, windowS: 60 },
        },
      },
    });
    club = await createClub(database.admin, 'majority');
    admin = await signIn(t, 'admin@majority.example.com');
    father = await signIn(t, 'papa@majority.example.com');
    mother = await signIn(t, 'mama@majority.example.com');
    coach = await signIn(t, 'coach@majority.example.com');
    martinAccount = await signIn(t, 'martin@majority.example.com');
    await createMembership(database.admin, admin.userId, club, 'admin');
    await createMembership(database.admin, father.userId, club, 'parent');
    await createMembership(database.admin, mother.userId, club, 'parent');
    await createMembership(database.admin, martinAccount.userId, club, 'player');
    const coachMembership = await createMembership(database.admin, coach.userId, club, 'coach');
    const m19 = await createCategory(database.admin, club, 'M19');
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [club, coachMembership, m19],
    );
    martin = await insertPlayer('Martín', martinAccount.userId, m19);
    tomas = await insertPlayer('Tomás', null, m19);
    fatherLink = await link(martin, father.userId, 'father');
    motherLink = await link(martin, mother.userId, 'mother');
    await link(tomas, father.userId, 'father');

    // The club's data text, and the father's signature of it while Martín was a minor.
    const published = await t.app.inject({
      method: 'POST',
      url: '/v1/consent-documents',
      headers: admin.headers,
      payload: { type: 'data', version: '2026-11', title: 'Datos', body: 'Autorizo los datos.' },
    });
    expect(published.statusCode, published.body).toBe(201);
    dataDocument = published.json<{ id: string }>().id;
    await database.admin.query(
      `insert into consent (club_id, player_id, type, document_version, document_id, signer_kind, signed_by, signed_at)
       values ($1, $2, 'data', '2026-11', $3, 'guardian', $4, now() - interval '1 year')`,
      [club, martin, dataDocument, father.userId],
    );
  }, 60_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('while the player is a minor', () => {
    it('the guardian sees and signs; the player cannot review their guardians', async () => {
      await ofAgeSince(-1);
      expect((await get(`/v1/players/${martin}/consents`, father)).statusCode).toBe(200);
      const children = (await get('/v1/me/children', father)).json<Page<ChildBody>>().items;
      expect(children.map((c) => [c.firstName, c.ofAge, c.canManageAccess])).toEqual([
        ['Martín', false, true],
        ['Tomás', false, true],
      ]);
      const denied = await confirm(martinAccount, fatherLink);
      expect(denied.statusCode).toBe(403);
      expect(errorOf(denied).code).toBe('forbidden');
      expect((await post(`/v1/guardians/${fatherLink}/end`, martinAccount)).statusCode).toBe(403);
    });
  });

  describe('of age, within the grace period', () => {
    it("the guardian's signature still counts and the adult is asked to sign", async () => {
      const birth = await ofAgeSince(10);
      const body = await consents(martinAccount);
      expect(body).toMatchObject({ playerOfAge: true, requiredSigner: 'player' });
      // 30 days after the 18th birthday.
      const majority = new Date(`${birth}T00:00:00Z`);
      majority.setUTCFullYear(majority.getUTCFullYear() + 18);
      majority.setUTCDate(majority.getUTCDate() + 30);
      expect(body.guardianSignaturesLapseOn).toBe(majority.toISOString().slice(0, 10));
      expect(body.types.find((s) => s.type === 'data')).toMatchObject({
        state: 'adult_signature_required',
        consent: { signerKind: 'guardian', signedBy: father.userId },
        actions: ['sign', 'revoke'],
      });
      expect((await submitWellness()).statusCode).toBe(200);
    });

    it('a guardian the adult did not keep sees only the link', async () => {
      await ofAgeSince(10);
      expect((await get(`/v1/players/${martin}/consents`, father)).statusCode).toBe(404);
      expect((await get(`/v1/players/${martin}/guardians`, father)).statusCode).toBe(404);
      const children = (await get('/v1/me/children', father)).json<Page<ChildBody>>().items;
      expect(
        children.map((c) => [c.firstName, c.ofAge, c.adultConfirmed, c.canManageAccess]),
      ).toEqual([
        ['Martín', true, false, false],
        ['Tomás', false, false, true],
      ]);
      const listed = (await get('/v1/players', father)).json<Page<{ id: string }>>().items;
      expect(listed.map((p) => p.id)).toEqual([tomas]);
    });

    it('the adult sees their guardians by name, never their email', async () => {
      await ofAgeSince(10);
      const response = await get(`/v1/players/${martin}/guardians`, martinAccount);
      expect(response.statusCode, response.body).toBe(200);
      const links = response.json<Page<LinkBody>>().items;
      expect(links.map((l) => l.id).sort()).toEqual([fatherLink, motherLink].sort());
      for (const l of links) {
        expect(l.guardian.name).toEqual(expect.any(String) as unknown);
        expect(l.guardian.email).toBeNull();
        expect(l.adultConfirmedAt).toBeNull();
      }
    });
  });

  describe("the adult's decision", () => {
    it('only the adult player decides: not the guardian, the administration or the staff', async () => {
      await ofAgeSince(10);
      for (const caller of [father, mother, admin, coach]) {
        const response = await confirm(caller, fatherLink);
        expect([403, 404]).toContain(response.statusCode);
      }
      // The administration still ends links (`guardian_link.manage`), never confirms them.
      expect((await confirm(admin, fatherLink)).statusCode).toBe(403);
    });

    it('keeping the father: read access comes back, nothing that needs a minor', async () => {
      await ofAgeSince(10);
      const kept = await confirm(martinAccount, fatherLink);
      expect(kept.statusCode, kept.body).toBe(200);
      const body = kept.json<LinkBody>();
      expect(body.adultConfirmedAt).not.toBeNull();
      expect(body.guardian.email).toBeNull();
      // Idempotent: the first decision's time stays.
      const again = await confirm(martinAccount, fatherLink);
      expect(again.json<LinkBody>().adultConfirmedAt).toBe(body.adultConfirmedAt);

      expect((await dataState(father))?.actions).toEqual([]);
      expect((await get(`/v1/players/${martin}/guardians`, father)).statusCode).toBe(200);
      const listed = (await get('/v1/players', father)).json<Page<{ id: string }>>().items;
      expect(listed.map((p) => p.id).sort()).toEqual([martin, tomas].sort());
      const children = (await get('/v1/me/children', father)).json<Page<ChildBody>>().items;
      expect(children.find((c) => c.firstName === 'Martín')).toMatchObject({
        ofAge: true,
        adultConfirmed: true,
        canManageAccess: false,
      });
      // Signing, revoking and issuing access codes still need a minor.
      const signed = await post(`/v1/players/${martin}/consents`, father, {
        documentId: dataDocument,
      });
      expect(signed.statusCode).toBe(403);
      expect((await post(`/v1/players/${martin}/consents/data/revoke`, father)).statusCode).toBe(
        403,
      );
      expect((await post(`/v1/players/${martin}/access-codes`, father)).statusCode).toBe(403);
      // The mother was not kept.
      expect((await get(`/v1/players/${martin}/consents`, mother)).statusCode).toBe(404);
    });

    it('withdrawing the confirmation takes the access back; it can be given again', async () => {
      await ofAgeSince(10);
      const withdrawn = await withdraw(martinAccount, fatherLink);
      expect(withdrawn.statusCode, withdrawn.body).toBe(200);
      expect(withdrawn.json<LinkBody>()).toMatchObject({ adultConfirmedAt: null, current: true });
      expect((await withdraw(martinAccount, fatherLink)).statusCode).toBe(200);
      expect((await get(`/v1/players/${martin}/consents`, father)).statusCode).toBe(404);
    });

    it('the adult ends a link; it stays in the history and cannot be kept any more', async () => {
      await ofAgeSince(10);
      const ended = await post(`/v1/guardians/${motherLink}/end`, martinAccount);
      expect(ended.statusCode, ended.body).toBe(200);
      expect(ended.json<LinkBody>()).toMatchObject({ validTo: await clubToday(), current: false });
      expect((await post(`/v1/guardians/${motherLink}/end`, martinAccount)).statusCode).toBe(200);
      const kept = await confirm(martinAccount, motherLink);
      expect(kept.statusCode).toBe(409);
      const children = (await get('/v1/me/children', mother)).json<Page<ChildBody>>().items;
      expect(children).toEqual([]);
    });
  });

  describe("past the grace period: the adult's own consents", () => {
    it("the guardian's signature lapses: data is refused until the adult signs", async () => {
      await ofAgeSince(30);
      expect(await dataState(martinAccount)).toMatchObject({ state: 'lapsed', consent: null });
      const refused = await submitWellness();
      expect(refused.statusCode).toBe(403);
      expect(errorOf(refused).code).toBe('consent_required');
      expect(errorOf(refused).details?.map((d) => d.path)).toEqual([['consents', 'data']]);
    });

    it('the adult signs the text their guardian signed; once', async () => {
      await ofAgeSince(30);
      const signed = await post(`/v1/players/${martin}/consents`, martinAccount, {
        documentId: dataDocument,
      });
      expect(signed.statusCode, signed.body).toBe(201);
      expect(signed.json<{ signerKind: string }>().signerKind).toBe('player');
      expect(await dataState(martinAccount)).toMatchObject({
        state: 'granted',
        consent: { signerKind: 'player', signedBy: martinAccount.userId },
      });
      expect((await submitWellness()).statusCode).toBe(200);
      const twice = await post(`/v1/players/${martin}/consents`, martinAccount, {
        documentId: dataDocument,
      });
      expect(twice.statusCode).toBe(409);
      // The guardian's signature stays as evidence, not revoked.
      const { rows } = await database.admin.query<{ n: string }>(
        `select count(*)::text as n from consent
          where player_id = $1 and signer_kind = 'guardian' and revoked_at is null`,
        [martin],
      );
      expect(rows[0]?.n).toBe('1');
    });
  });
});
