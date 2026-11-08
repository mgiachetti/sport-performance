/**
 * Consents end to end (B-312, ADR 0043) against Postgres 16, through the real
 * connection roles (ADR 0026): versioned texts, signature by the holder
 * (guardian of a minor, adult player), revocation, status and history, and
 * the `requireConsent` helper other routes use before storing data. Players,
 * categories and links are fixtures inserted with the owner connection
 * (their endpoints belong to other issues).
 */
import { createHash, randomUUID } from 'node:crypto';
import { defineEndpoint } from '@sport-performance/contracts';
import type { ClubId, PlayerId } from '@sport-performance/domain';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { requireConsent, requirePlayerFacts } from '../http/consents.js';
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
  error: { code: string; message: string; details?: { path: (string | number)[]; code: string }[] };
}

interface DocumentBody {
  id: string;
  type: string;
  version: string;
  locale: string;
  title: string;
  body?: string;
  bodySha256: string;
  publishedAt: string;
  current: boolean;
}

interface ConsentBody {
  id: string;
  playerId: string;
  type: string;
  documentId: string | null;
  documentVersion: string;
  signerKind: string;
  signedBy: string;
  signedAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

interface TypeStatusBody {
  type: string;
  state: string;
  consent: ConsentBody | null;
  currentDocument: DocumentBody | null;
  actions: string[];
}

interface PlayerConsentsBody {
  playerId: string;
  playerOfAge: boolean;
  requiredSigner: string;
  types: TypeStatusBody[];
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Consulta del club por consentimientos');

/** Test-only routes that store data of a player, guarded like the real ones will be. */
const uploadCmjVideo = defineEndpoint({
  method: 'POST',
  path: '/v1/test/players/{playerId}/cmj-video',
  summary: 'Stores a CMJ video (test double of #56)',
  tags: ['system'],
  auth: 'club',
  params: z.strictObject({ playerId: z.uuid() }),
  response: { status: 200, description: 'Stored', schema: z.object({ ok: z.literal(true) }) },
  errors: ['not_found'],
});
const recordHealthNote = defineEndpoint({
  method: 'POST',
  path: '/v1/test/players/{playerId}/health-note',
  summary: 'Stores health data (test double of #41)',
  tags: ['system'],
  auth: 'club',
  params: z.strictObject({ playerId: z.uuid() }),
  response: { status: 200, description: 'Stored', schema: z.object({ ok: z.literal(true) }) },
  errors: ['not_found'],
});

const assignPod = defineEndpoint({
  method: 'POST',
  path: '/v1/test/players/{playerId}/pod-assignment',
  summary: 'Assigns a pod (test double of B-912)',
  tags: ['system'],
  auth: 'club',
  params: z.strictObject({ playerId: z.uuid() }),
  response: { status: 200, description: 'Assigned', schema: z.object({ ok: z.literal(true) }) },
  errors: ['not_found'],
});

function registerGuardedRoutes(app: FastifyInstance): void {
  // With the matrix: `pod_assignment.assign` needs `data` and a granted `location` (B-913).
  registerEndpoint(app, assignPod, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth }) => {
      const { facts } = await requirePlayerFacts(
        db,
        auth.membership.clubId,
        params.playerId as PlayerId,
      );
      await permissions.authorize('pod_assignment', 'assign', { player: facts });
      return { ok: true as const };
    },
  });
  // With the matrix: `media.upload` needs an image consent.
  registerEndpoint(app, uploadCmjVideo, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth }) => {
      const { facts } = await requirePlayerFacts(
        db,
        auth.membership.clubId,
        params.playerId as PlayerId,
      );
      await permissions.authorize('media', 'upload', { player: facts });
      return { ok: true as const };
    },
  });
  // Directly with the helper.
  registerEndpoint(app, recordHealthNote, {
    transaction: true,
    handler: async ({ params }, { db, permissions }) => {
      await permissions.authorize('club', 'read');
      await requireConsent(db, params.playerId as PlayerId, ['data', 'health']);
      return { ok: true as const };
    },
  });
}

function errorOf(response: LightMyRequestResponse): ErrorBody['error'] {
  return response.json<ErrorBody>().error;
}

describeWithPostgres('consents (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let clubA: ClubId;
  let clubB: ClubId;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let parentA: SignedIn;
  let minorPlayer: SignedIn;
  let adultPlayer: SignedIn;
  let coachA: SignedIn;
  let coachUnassigned: SignedIn;
  /** M15, a minor: the guardian signs. */
  let minor: PlayerId;
  /** Of age: signs for themselves. */
  let adult: PlayerId;
  const documents: Record<string, DocumentBody> = {};

  const supporting = (clubId: string) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': SUPPORT_REASON,
  });

  async function insertPlayer(
    clubId: ClubId,
    categoryId: string,
    birthDate: string,
    userId: string | null,
  ): Promise<PlayerId> {
    const { rows } = await database.admin.query<{ id: PlayerId }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', 'Pérez', $3, 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, userId, birthDate],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('player not created');
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, id, categoryId],
    );
    return id;
  }

  const publish = (caller: Record<string, string>, payload: Record<string, unknown>) =>
    t.app.inject({ method: 'POST', url: '/v1/consent-documents', headers: caller, payload });
  const status = (caller: Record<string, string>, playerId: string) =>
    t.app.inject({ url: `/v1/players/${playerId}/consents`, headers: caller });
  const sign = (
    caller: Record<string, string>,
    playerId: string,
    payload: Record<string, unknown>,
  ) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/players/${playerId}/consents`,
      headers: caller,
      payload,
    });
  const revoke = (caller: Record<string, string>, playerId: string, type: string) =>
    t.app.inject({
      method: 'POST',
      url: `/v1/players/${playerId}/consents/${type}/revoke`,
      headers: caller,
    });
  const stateOf = async (caller: Record<string, string>, playerId: string, type: string) => {
    const response = await status(caller, playerId);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<PlayerConsentsBody>().types.find((s) => s.type === type);
  };

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
    clubA = await createClub(database.admin, 'consents-a');
    clubB = await createClub(database.admin, 'consents-b');
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    adminA = await signIn(t, 'admin@consents-a.example.com');
    adminB = await signIn(t, 'admin@consents-b.example.com');
    parentA = await signIn(t, 'madre@consents-a.example.com');
    minorPlayer = await signIn(t, 'menor@consents-a.example.com');
    adultPlayer = await signIn(t, 'mayor@consents-a.example.com');
    coachA = await signIn(t, 'coach@consents-a.example.com');
    coachUnassigned = await signIn(t, 'otro-coach@consents-a.example.com');
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await createMembership(database.admin, parentA.userId, clubA, 'parent');
    await createMembership(database.admin, minorPlayer.userId, clubA, 'player');
    await createMembership(database.admin, adultPlayer.userId, clubA, 'player');
    const coachMembership = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await createMembership(database.admin, coachUnassigned.userId, clubA, 'coach');
    const m15 = await createCategory(database.admin, clubA, 'M15');
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, coachMembership, m15],
    );
    minor = await insertPlayer(clubA, m15, '2012-05-01', minorPlayer.userId);
    adult = await insertPlayer(clubA, m15, '2000-01-01', adultPlayer.userId);
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, minor, parentA.userId],
    );
  }, 60_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('consent texts', () => {
    const textUuid = randomUUID();

    it('the administration publishes a text per type; the database hashes it', async () => {
      for (const type of ['data', 'image', 'health']) {
        const body = `Autorizo el tratamiento de ${type} del jugador o la jugadora.`;
        const response = await publish(adminA.headers, {
          ...(type === 'data' && { clientUuid: textUuid }),
          type,
          version: '2026-11',
          title: `Consentimiento ${type}`,
          body,
        });
        expect(response.statusCode, response.body).toBe(201);
        const document = response.json<DocumentBody>();
        expect(document).toMatchObject({
          type,
          version: '2026-11',
          locale: 'es-AR',
          current: true,
          body,
        });
        expect(document.bodySha256).toBe(createHash('sha256').update(body, 'utf8').digest('hex'));
        documents[type] = document;
      }
    });

    it('replays the same publication by clientUuid', async () => {
      const response = await publish(adminA.headers, {
        clientUuid: textUuid,
        type: 'data',
        version: '2026-11',
        title: 'Consentimiento data',
        body: 'Autorizo el tratamiento de data del jugador o la jugadora.',
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.headers['x-idempotent-replay']).toBe('true');
      expect(response.json<DocumentBody>().id).toBe(documents.data?.id);
    });

    it('answers conflict for a version already published in the type', async () => {
      const response = await publish(adminA.headers, {
        type: 'data',
        version: '2026-11',
        title: 'Otro',
        body: 'Otro texto.',
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(errorOf(response).code).toBe('conflict');
    });

    it('validates the body: blank text, bad version, unknown locale', async () => {
      const response = await publish(adminA.headers, {
        type: 'data',
        version: 'con espacios',
        locale: 'en-US',
        title: ' Con espacios ',
        body: '   ',
      });
      expect(response.statusCode).toBe(400);
      expect(
        errorOf(response)
          .details?.map((d) => d.path.join('.'))
          .sort(),
      ).toEqual(['body.body', 'body.locale', 'body.title', 'body.version']);
    });

    it('only the administration publishes', async () => {
      for (const caller of [parentA, coachA, adultPlayer]) {
        const response = await publish(caller.headers, {
          type: 'image',
          version: 'no-admin',
          title: 'x',
          body: 'x',
        });
        expect(response.statusCode, response.body).toBe(403);
        expect(errorOf(response).code).toBe('forbidden');
      }
    });

    it('every member reads the texts; another club does not see them', async () => {
      for (const caller of [parentA, coachA, minorPlayer]) {
        const list = await t.app.inject({
          url: '/v1/consent-documents?status=current',
          headers: caller.headers,
        });
        expect(list.statusCode, list.body).toBe(200);
        expect(
          list
            .json<Page<DocumentBody>>()
            .items.map((d) => d.type)
            .sort(),
        ).toEqual(['data', 'health', 'image']);
      }
      const one = await t.app.inject({
        url: `/v1/consent-documents/${documents.image?.id ?? ''}`,
        headers: parentA.headers,
      });
      expect(one.statusCode).toBe(200);
      expect(one.json<DocumentBody>().body).toContain('image');
      const foreign = await t.app.inject({
        url: `/v1/consent-documents/${documents.image?.id ?? ''}`,
        headers: adminB.headers,
      });
      expect(foreign.statusCode).toBe(404);
      const empty = await t.app.inject({ url: '/v1/consent-documents', headers: adminB.headers });
      expect(empty.json<Page<DocumentBody>>().items).toEqual([]);
    });
  });

  describe('status, signature and revocation', () => {
    const signUuid = randomUUID();
    let signed: ConsentBody;

    it('shows every type missing, who signs and what the caller may do', async () => {
      const response = await status(parentA.headers, minor);
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json<PlayerConsentsBody>();
      expect(body).toMatchObject({
        playerId: minor,
        playerOfAge: false,
        requiredSigner: 'guardian',
      });
      expect(body.types.map((s) => [s.type, s.state, s.actions])).toEqual([
        ['data', 'missing', ['sign', 'revoke']],
        ['image', 'missing', ['sign', 'revoke']],
        ['health', 'missing', ['sign', 'revoke']],
      ]);
      expect(body.types[0]?.currentDocument?.id).toBe(documents.data?.id);
      // The staff reads it without actions; the adult player signs for themselves.
      const coach = await status(coachA.headers, minor);
      expect(coach.json<PlayerConsentsBody>().types.every((s) => s.actions.length === 0)).toBe(
        true,
      );
      const own = await status(adultPlayer.headers, adult);
      expect(own.json<PlayerConsentsBody>()).toMatchObject({
        playerOfAge: true,
        requiredSigner: 'player',
      });
    });

    it('the guardian signs the current text for the minor, as a guardian', async () => {
      const response = await sign(parentA.headers, minor, {
        clientUuid: signUuid,
        documentId: documents.data?.id,
      });
      expect(response.statusCode, response.body).toBe(201);
      signed = response.json<ConsentBody>();
      expect(signed).toMatchObject({
        playerId: minor,
        type: 'data',
        documentId: documents.data?.id,
        documentVersion: '2026-11',
        signerKind: 'guardian',
        signedBy: parentA.userId,
        revokedAt: null,
      });
      expect((await stateOf(parentA.headers, minor, 'data'))?.state).toBe('granted');
    });

    it('replays the signature by clientUuid; signing it again is a conflict', async () => {
      const replay = await sign(parentA.headers, minor, {
        clientUuid: signUuid,
        documentId: documents.data?.id,
      });
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<ConsentBody>().id).toBe(signed.id);
      const again = await sign(parentA.headers, minor, { documentId: documents.data?.id });
      expect(again.statusCode).toBe(409);
      // The same clientUuid for another player is another signature: conflict.
      const reused = await sign(adultPlayer.headers, adult, {
        clientUuid: signUuid,
        documentId: documents.data?.id,
      });
      expect(reused.statusCode).toBe(409);
    });

    it('the adult player signs for themselves, as a player', async () => {
      const response = await sign(adultPlayer.headers, adult, { documentId: documents.image?.id });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json<ConsentBody>()).toMatchObject({ signerKind: 'player', type: 'image' });
    });

    it('nobody else signs: a minor, the staff, the administration, the superadmin', async () => {
      const payload = { documentId: documents.image?.id };
      for (const [caller, playerId] of [
        [minorPlayer.headers, minor],
        [coachA.headers, minor],
        [adminA.headers, minor],
        [supporting(clubA), minor],
      ] as const) {
        const response = await sign(caller, playerId, payload);
        expect(response.statusCode, response.body).toBe(403);
        expect(errorOf(response).code).toBe('forbidden');
      }
      const count = await database.admin.query<{ n: string }>(
        `select count(*) as n from consent where player_id = $1 and type = 'image'`,
        [minor],
      );
      expect(count.rows[0]?.n).toBe('0');
    });

    it('a player out of reach does not exist: other club, other guardian, unassigned staff', async () => {
      for (const [caller, playerId] of [
        [adminB.headers, minor],
        [parentA.headers, adult],
        [coachUnassigned.headers, minor],
      ] as const) {
        expect((await status(caller, playerId)).statusCode).toBe(404);
        expect((await sign(caller, playerId, { documentId: documents.image?.id })).statusCode).toBe(
          404,
        );
      }
      // The text of another club does not exist either.
      const foreignText = await publish(adminB.headers, {
        type: 'image',
        version: '2026-11',
        title: 'Imagen',
        body: 'Texto del club B.',
      });
      expect(foreignText.statusCode).toBe(201);
      const response = await sign(parentA.headers, minor, {
        documentId: foreignText.json<DocumentBody>().id,
      });
      expect(response.statusCode).toBe(404);
    });

    it('the superadmin reads with support headers', async () => {
      const response = await status(supporting(clubA), minor);
      expect(response.statusCode, response.body).toBe(200);
      const log = await database.admin.query<{ n: string }>(
        `select count(*) as n from support.access_log where club_id = $1`,
        [clubA],
      );
      expect(Number(log.rows[0]?.n)).toBeGreaterThan(0);
    });

    it('a new version of the text leaves the signature outdated until signed again', async () => {
      const v2 = await publish(adminA.headers, {
        type: 'data',
        version: '2026-12',
        title: 'Consentimiento data',
        body: 'Versión revisada del texto de datos.',
      });
      expect(v2.statusCode).toBe(201);
      documents.data2 = v2.json<DocumentBody>();
      const outdated = await stateOf(parentA.headers, minor, 'data');
      expect(outdated).toMatchObject({ state: 'outdated', consent: { id: signed.id } });
      expect(outdated?.currentDocument?.version).toBe('2026-12');
      const old = await t.app.inject({
        url: `/v1/consent-documents/${documents.data?.id ?? ''}`,
        headers: parentA.headers,
      });
      expect(old.json<DocumentBody>().current).toBe(false);
      // The superseded text is not signed any more.
      const stale = await sign(parentA.headers, minor, { documentId: documents.data?.id });
      expect(stale.statusCode).toBe(409);
      const fresh = await sign(parentA.headers, minor, { documentId: documents.data2.id });
      expect(fresh.statusCode, fresh.body).toBe(201);
      expect((await stateOf(parentA.headers, minor, 'data'))?.state).toBe('granted');
    });

    it('lists the history by cursor, newest first', async () => {
      const first = await t.app.inject({
        url: `/v1/players/${minor}/consents/history?limit=1`,
        headers: coachA.headers,
      });
      expect(first.statusCode, first.body).toBe(200);
      const page1 = first.json<Page<ConsentBody>>();
      expect(page1.items.map((c) => c.documentVersion)).toEqual(['2026-12']);
      expect(page1.nextCursor).not.toBeNull();
      const second = await t.app.inject({
        url: `/v1/players/${minor}/consents/history?limit=1&cursor=${page1.nextCursor ?? ''}`,
        headers: coachA.headers,
      });
      const page2 = second.json<Page<ConsentBody>>();
      expect(page2.items.map((c) => c.id)).toEqual([signed.id]);
      expect(page2.nextCursor).toBeNull();
      const otherFilter = await t.app.inject({
        url: `/v1/players/${minor}/consents/history?limit=1&type=data&cursor=${page1.nextCursor ?? ''}`,
        headers: coachA.headers,
      });
      expect(otherFilter.statusCode).toBe(400);
      expect(
        (
          await t.app.inject({
            url: `/v1/players/${minor}/consents/history`,
            headers: adminB.headers,
          })
        ).statusCode,
      ).toBe(404);
    });

    it('the guardian revokes every current consent of a type, idempotently', async () => {
      expect((await revoke(coachA.headers, minor, 'data')).statusCode).toBe(403);
      expect((await revoke(adminA.headers, minor, 'data')).statusCode).toBe(403);
      const response = await revoke(parentA.headers, minor, 'data');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<TypeStatusBody>()).toMatchObject({
        type: 'data',
        state: 'revoked',
        consent: null,
      });
      const rows = await database.admin.query<{ revoked_by: string | null }>(
        `select revoked_by from consent where player_id = $1 and type = 'data'`,
        [minor],
      );
      expect(rows.rows.map((r) => r.revoked_by)).toEqual([parentA.userId, parentA.userId]);
      const again = await revoke(parentA.headers, minor, 'data');
      expect(again.statusCode).toBe(200);
      expect(again.json<TypeStatusBody>().state).toBe('revoked');
      // The history keeps both signatures, revoked.
      const history = await t.app.inject({
        url: `/v1/players/${minor}/consents/history`,
        headers: parentA.headers,
      });
      expect(history.json<Page<ConsentBody>>().items.every((c) => c.revokedAt !== null)).toBe(true);
    });
  });

  describe('no data without a current consent', () => {
    const video = (caller: Record<string, string>, playerId: string) =>
      t.app.inject({
        method: 'POST',
        url: `/v1/test/players/${playerId}/cmj-video`,
        headers: caller,
      });
    const healthNote = (caller: Record<string, string>, playerId: string) =>
      t.app.inject({
        method: 'POST',
        url: `/v1/test/players/${playerId}/health-note`,
        headers: caller,
      });

    it('no CMJ video without an image consent (matrix), with the missing type', async () => {
      const response = await video(adminA.headers, minor);
      expect(response.statusCode, response.body).toBe(403);
      expect(errorOf(response)).toMatchObject({
        code: 'consent_required',
        details: [{ path: ['consents', 'image'], code: 'consent_required' }],
      });
      // Out of scope stays a plain denial (the missing consent is not revealed).
      const coach = await video(coachA.headers, minor);
      expect(coach.statusCode).toBe(403);
      expect(errorOf(coach).code).toBe('forbidden');
      // Once the guardian signs, it goes through; after revoking, it stops again.
      expect(
        (await sign(parentA.headers, minor, { documentId: documents.image?.id })).statusCode,
      ).toBe(201);
      expect((await video(adminA.headers, minor)).statusCode).toBe(200);
      expect((await revoke(parentA.headers, minor, 'image')).statusCode).toBe(200);
      expect(errorOf(await video(adminA.headers, minor)).code).toBe('consent_required');
    });

    it('requireConsent lists every missing type and passes once they are signed', async () => {
      const response = await healthNote(adminA.headers, adult);
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).details?.map((d) => d.path)).toEqual([
        ['consents', 'data'],
        ['consents', 'health'],
      ]);
      for (const type of ['data2', 'health']) {
        expect(
          (await sign(adultPlayer.headers, adult, { documentId: documents[type]?.id })).statusCode,
        ).toBe(201);
      }
      expect((await healthNote(adminA.headers, adult)).statusCode).toBe(200);
    });
  });

  describe('location consent of the pod (B-913, ADR 0106)', () => {
    const pod = (caller: Record<string, string>, playerId: string) =>
      t.app.inject({
        method: 'POST',
        url: `/v1/test/players/${playerId}/pod-assignment`,
        headers: caller,
      });
    const setGps = (on: boolean) =>
      database.admin.query(
        `update club set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{modules}',
                coalesce(settings -> 'modules', '{}'::jsonb) || jsonb_build_object('gps', $2::boolean))
          where id = $1`,
        [clubA, on],
      );
    const erasures = async (playerId: string) =>
      (
        await database.admin.query<{ status: string; requested_by: string | null }>(
          `select status::text, requested_by from location_erasure where player_id = $1
            order by created_at`,
          [playerId],
        )
      ).rows;

    it('is not asked outside a category with pods (B-912, ADR 0107)', async () => {
      await setGps(true);
      await database.admin.query(`update category set pods_enabled = false where club_id = $1`, [
        clubA,
      ]);
      expect(await stateOf(adultPlayer.headers, adult, 'location')).toBeUndefined();
      // The M15 of this club has pods for the rest of the suite.
      await database.admin.query(`update category set pods_enabled = true where club_id = $1`, [
        clubA,
      ]);
      await setGps(false);
    });

    it('is asked and signed only with the gps module on', async () => {
      const v1 = await publish(adminA.headers, {
        type: 'location',
        version: '2026-11',
        title: 'Ubicación con el pod',
        body: 'Autorizo registrar la ubicación con el pod durante las sesiones.',
      });
      expect(v1.statusCode, v1.body).toBe(201);
      documents.location = v1.json<DocumentBody>();
      expect(await stateOf(adultPlayer.headers, adult, 'location')).toBeUndefined();
      const refused = await sign(adultPlayer.headers, adult, { documentId: documents.location.id });
      expect(refused.statusCode, refused.body).toBe(409);
      await setGps(true);
      expect(await stateOf(adultPlayer.headers, adult, 'location')).toMatchObject({
        state: 'missing',
        actions: ['sign', 'revoke'],
      });
      // The staff sees whether it is signed (it decides who gets a pod), without actions.
      expect(await stateOf(coachA.headers, adult, 'location')).toMatchObject({
        state: 'missing',
        actions: [],
      });
      expect(await stateOf(parentA.headers, minor, 'location')).toMatchObject({
        state: 'missing',
        actions: ['sign', 'revoke'],
      });
    });

    it('a pod is assigned only with it granted: never on an older text', async () => {
      expect(errorOf(await pod(adminA.headers, adult))).toMatchObject({
        code: 'consent_required',
        details: [{ path: ['consents', 'location'], code: 'consent_required' }],
      });
      const signed = await sign(adultPlayer.headers, adult, {
        documentId: documents.location?.id,
      });
      expect(signed.statusCode, signed.body).toBe(201);
      expect((await stateOf(adultPlayer.headers, adult, 'location'))?.state).toBe('granted');
      expect((await pod(adminA.headers, adult)).statusCode).toBe(200);
      expect((await pod(coachA.headers, adult)).statusCode).toBe(200);

      const v2 = await publish(adminA.headers, {
        type: 'location',
        version: '2026-12',
        title: 'Ubicación con el pod',
        body: 'Versión revisada del texto de ubicación.',
      });
      expect(v2.statusCode).toBe(201);
      documents.location2 = v2.json<DocumentBody>();
      expect((await stateOf(adultPlayer.headers, adult, 'location'))?.state).toBe('outdated');
      expect(errorOf(await pod(adminA.headers, adult))).toMatchObject({
        code: 'consent_required',
        details: [{ path: ['consents', 'location'], code: 'consent_required' }],
      });
      expect(
        (await sign(adultPlayer.headers, adult, { documentId: documents.location2.id })).statusCode,
      ).toBe(201);
      expect((await pod(adminA.headers, adult)).statusCode).toBe(200);
    });

    it('revoking it queues the erasure of the position data, once', async () => {
      expect(await erasures(adult)).toEqual([]);
      const response = await revoke(adultPlayer.headers, adult, 'location');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json<TypeStatusBody>()).toMatchObject({ type: 'location', state: 'revoked' });
      expect(await erasures(adult)).toEqual([
        { status: 'pending', requested_by: adultPlayer.userId },
      ]);
      expect(errorOf(await pod(adminA.headers, adult)).code).toBe('consent_required');
      // Revoking again is idempotent and queues nothing more.
      expect((await revoke(adultPlayer.headers, adult, 'location')).statusCode).toBe(200);
      expect(await erasures(adult)).toHaveLength(1);
      // Still shown with the module off, so a signed one can be revoked; never signed again.
      await setGps(false);
      expect((await stateOf(adultPlayer.headers, adult, 'location'))?.state).toBe('revoked');
      expect(
        (await sign(adultPlayer.headers, adult, { documentId: documents.location2?.id }))
          .statusCode,
      ).toBe(409);
    });
  });
});
