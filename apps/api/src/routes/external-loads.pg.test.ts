/**
 * External load end to end (B-511, ADR 0084) against Postgres 16, through
 * the real connection roles (ADR 0026): the player reports, corrects and
 * archives their own activities outside the club within the window, the
 * staff reads them by scope, corrections carry their reason into the change
 * history (ADR 0030), every write marks the load series for the worker
 * (ADR 0046) and the endpoint conventions hold (ADR 0032).
 */
import { randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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

interface Envelope {
  error: { code: string; message: string; details?: { path: (string | number)[] }[] };
}

interface ExternalLoadBody {
  id: string;
  playerId: string;
  localDate: string;
  activity: string;
  detail: string | null;
  minutes: number;
  rpe: number;
  srpeAu: number;
  reportedBy: string;
  archivedAt: string | null;
  version: string;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const SUPPORT_REASON = encodeURIComponent('Revisión de la carga externa pedida por el club');

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

function paths(response: LightMyRequestResponse): string[] {
  return (errorOf(response).details ?? []).map((d) => d.path.join('.'));
}

describeWithPostgres('external load (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachM15: SignedIn;
  let coachM13: SignedIn;
  let player13: SignedIn;
  let player15: SignedIn;
  let playerNoConsent: SignedIn;
  let parent15: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let p13: string;
  let p15: string;
  let today: string;
  let oldEntry15: string;
  let entry15: ExternalLoadBody;
  let entry13: ExternalLoadBody;

  const supporting = (clubId: string) => ({
    ...superadmin.headers,
    'x-support-club-id': clubId,
    'x-support-reason': SUPPORT_REASON,
  });

  async function addDays(date: string, days: number): Promise<string> {
    const { rows } = await database.admin.query<{ day: string }>(
      `select ($1::date + $2::int)::text as day`,
      [date, days],
    );
    return rows[0]?.day ?? '';
  }

  async function insertCategory(clubId: ClubId, band: string, stage: string): Promise<string> {
    await database.admin.query(
      `insert into club_branch (club_id, sport, sex) values ($1, 'rugby', 'male')
       on conflict (club_id, sport, sex) do nothing`,
      [clubId],
    );
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
       values ($1, 'rugby', 'male', $2, upper($2), $3) returning id`,
      [clubId, band, stage],
    );
    return rows[0]?.id ?? '';
  }

  async function insertPlayer(
    clubId: ClubId,
    user: SignedIn | null,
    birthDate: string,
    categoryId: string,
    consentSigner: SignedIn | null,
  ): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', 'Pérez', $3, 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, user?.userId ?? null, birthDate],
    );
    const playerId = rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, playerId, categoryId],
    );
    if (consentSigner !== null) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, 'data', 'v1', 'guardian', $3)`,
        [clubId, playerId, consentSigner.userId],
      );
    }
    return playerId;
  }

  async function assign(membershipId: string, clubId: ClubId, categoryId: string): Promise<void> {
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, membershipId, categoryId],
    );
  }

  function report(caller: Record<string, string>, payload: unknown) {
    return t.app.inject({
      method: 'POST',
      url: '/v1/external-loads',
      headers: caller,
      payload: payload as Record<string, unknown>,
    });
  }

  function correct(caller: Record<string, string>, id: string, payload: unknown) {
    return t.app.inject({
      method: 'PATCH',
      url: `/v1/external-loads/${id}`,
      headers: { ...caller, 'x-request-id': `req-external-${id.slice(0, 8)}` },
      payload: payload as Record<string, unknown>,
    });
  }

  function archive(caller: Record<string, string>, id: string) {
    return t.app.inject({
      method: 'POST',
      url: `/v1/external-loads/${id}/archive`,
      headers: caller,
    });
  }

  async function list(caller: Record<string, string>, query = ''): Promise<ExternalLoadBody[]> {
    const response = await t.app.inject({ url: `/v1/external-loads${query}`, headers: caller });
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page<ExternalLoadBody>>().items;
  }

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      routeClassLimits: {
        auth: { perIp: { name: 'api_auth_ip', max: 1000, windowS: 60 } },
        write: {
          perIp: { name: 'api_write_ip', max: 10_000, windowS: 60 },
          perUser: { name: 'api_write_user', max: 10_000, windowS: 60 },
        },
      },
    });
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);
    adminA = await signIn(t, 'admin@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    coachM15 = await signIn(t, 'coach15@club-a.example.com');
    coachM13 = await signIn(t, 'coach13@club-a.example.com');
    player13 = await signIn(t, 'player13@club-a.example.com');
    player15 = await signIn(t, 'player15@club-a.example.com');
    playerNoConsent = await signIn(t, 'player-nc@club-a.example.com');
    parent15 = await signIn(t, 'parent15@club-a.example.com');

    clubA = await createClub(database.admin, 'club-a');
    clubB = await createClub(database.admin, 'club-b');
    const { rows } = await database.admin.query<{ today: string }>(
      `select (now() at time zone time_zone)::date::text as today from club where id = $1`,
      [clubA],
    );
    today = rows[0]?.today ?? '';

    const m13 = await insertCategory(clubA, 'm13', 'foundation');
    const m15 = await insertCategory(clubA, 'm15', 'development');
    p13 = await insertPlayer(clubA, player13, '2013-05-04', m13, parent15);
    p15 = await insertPlayer(clubA, player15, '2011-05-04', m15, parent15);
    await insertPlayer(clubA, playerNoConsent, '2011-08-01', m15, null);
    await database.admin.query(
      `insert into guardian (club_id, player_id, user_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, p15, parent15.userId],
    );

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await assign(
      await createMembership(database.admin, coachM15.userId, clubA, 'coach'),
      clubA,
      m15,
    );
    await assign(
      await createMembership(database.admin, coachM13.userId, clubA, 'coach'),
      clubA,
      m13,
    );
    for (const user of [player13, player15, playerNoConsent]) {
      await createMembership(database.admin, user.userId, clubA, 'player');
    }
    await createMembership(database.admin, parent15.userId, clubA, 'parent');

    // An activity of p15 from 10 days ago: outside the window of the player.
    const old = await database.admin.query<{ id: string }>(
      `insert into external_load (club_id, player_id, local_date, activity, minutes, rpe)
       values ($1, $2, $3, 'other_sport', 90, 7) returning id`,
      [clubA, p15, await addDays(today, -10)],
    );
    oldEntry15 = old.rows[0]?.id ?? '';
    // Club B: one activity that club A never sees.
    const mB = await insertCategory(clubB, 'm15', 'development');
    const pB = await insertPlayer(clubB, null, '2011-01-01', mB, adminB);
    await database.admin.query(
      `insert into external_load (club_id, player_id, local_date, activity, minutes, rpe)
       values ($1, $2, $3, 'physical_education', 40, 4)`,
      [clubB, pB, today],
    );
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('reporting', () => {
    it('records an activity of the player, with its load and the mark of who reported it', async () => {
      const clientUuid = randomUUID();
      const payload = {
        clientUuid,
        localDate: await addDays(today, -2),
        activity: 'other_sport',
        detail: 'Fútbol',
        minutes: 60,
        rpe: 6,
      };
      const response = await report(player15.headers, payload);
      expect(response.statusCode, response.body).toBe(201);
      entry15 = response.json<ExternalLoadBody>();
      expect(entry15).toMatchObject({
        playerId: p15,
        localDate: payload.localDate,
        activity: 'other_sport',
        detail: 'Fútbol',
        minutes: 60,
        rpe: 6,
        srpeAu: 360,
        reportedBy: 'player',
        archivedAt: null,
      });
      // Idempotent by clientUuid (the offline queue retries).
      const replay = await report(player15.headers, payload);
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<ExternalLoadBody>().id).toBe(entry15.id);

      // The worker recalculates the load series from that day (ADR 0046).
      await database.admin.query(`delete from derived_refresh where club_id = $1`, [clubA]);
      const moved = await report(player15.headers, { ...payload, clientUuid: randomUUID() });
      expect(moved.statusCode).toBe(201);
      const { rows } = await database.admin.query<{ load_from: string }>(
        `select load_from::text from derived_refresh where club_id = $1 and player_id = $2`,
        [clubA, p15],
      );
      expect(rows).toEqual([{ load_from: payload.localDate }]);
      // The extra activity is archived right away: it was only here to mark the player.
      expect((await archive(player15.headers, moved.json<ExternalLoadBody>().id)).statusCode).toBe(
        200,
      );
    });

    it('takes today by default and accepts the last 7 club days only', async () => {
      const response = await report(player13.headers, {
        activity: 'physical_education',
        minutes: 40,
        rpe: 4,
      });
      expect(response.statusCode, response.body).toBe(201);
      entry13 = response.json<ExternalLoadBody>();
      expect(entry13).toMatchObject({ localDate: today, detail: null, srpeAu: 160 });

      const sixDaysAgo = await report(player13.headers, {
        localDate: await addDays(today, -6),
        activity: 'own_training',
        minutes: 30,
        rpe: 5,
      });
      expect(sixDaysAgo.statusCode, sixDaysAgo.body).toBe(201);
      for (const localDate of [await addDays(today, -7), await addDays(today, 1)]) {
        const outside = await report(player13.headers, {
          localDate,
          activity: 'own_training',
          minutes: 30,
          rpe: 5,
        });
        expect(outside.statusCode, outside.body).toBe(400);
        expect(paths(outside)).toEqual(['body.localDate']);
      }
    });

    it('validates the activity, the minutes, the RPE and the detail', async () => {
      for (const [payload, path] of [
        [{ activity: 'gym', minutes: 30, rpe: 5 }, 'body.activity'],
        [{ activity: 'other', minutes: 0, rpe: 5 }, 'body.minutes'],
        [{ activity: 'other', minutes: 601, rpe: 5 }, 'body.minutes'],
        [{ activity: 'other', minutes: 30, rpe: 11 }, 'body.rpe'],
        [{ activity: 'other', minutes: 30, rpe: 4.5 }, 'body.rpe'],
        [{ activity: 'other', minutes: 30, rpe: 5, detail: ' Fútbol' }, 'body.detail'],
        [{ activity: 'other', minutes: 30, rpe: 5, detail: 'x'.repeat(61) }, 'body.detail'],
      ] as const) {
        const response = await report(player15.headers, payload);
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        expect(paths(response)).toContain(path);
      }
    });

    it('is denied to a player without consent and to every other role', async () => {
      const payload = { activity: 'other_sport', minutes: 60, rpe: 6 };
      const noConsent = await report(playerNoConsent.headers, payload);
      expect(noConsent.statusCode).toBe(403);
      expect(errorOf(noConsent).code).toBe('consent_required');
      for (const caller of [adminA, coachM15, parent15]) {
        expect((await report(caller.headers, payload)).statusCode).toBe(403);
      }
      expect((await report(supporting(clubA), payload)).statusCode).toBe(403);
      const anonymous = await t.app.inject({
        method: 'POST',
        url: '/v1/external-loads',
        payload,
      });
      expect(anonymous.statusCode).toBe(401);
    });
  });

  describe('correcting and archiving', () => {
    it('corrects with the version and a reason, recorded in the change history', async () => {
      const response = await correct(player15.headers, entry15.id, {
        version: entry15.version,
        changeReason: 'Fueron 75 minutos',
        minutes: 75,
        detail: null,
      });
      expect(response.statusCode, response.body).toBe(200);
      const corrected = response.json<ExternalLoadBody>();
      expect(corrected).toMatchObject({ minutes: 75, detail: null, srpeAu: 450 });

      const history = await database.admin.query<{
        reason: string;
        request_id: string;
        changed_columns: string[];
        actor_role: string;
      }>(
        `select reason, request_id, changed_columns, actor_role from change_history
          where table_name = 'external_load' and record_id = $1`,
        [entry15.id],
      );
      expect(history.rows).toEqual([
        {
          reason: 'Fueron 75 minutos',
          request_id: `req-external-${entry15.id.slice(0, 8)}`,
          changed_columns: ['detail', 'minutes', 'srpe_au'],
          actor_role: 'player',
        },
      ]);

      const stale = await correct(player15.headers, entry15.id, {
        version: entry15.version,
        changeReason: 'Otra vez',
        rpe: 5,
      });
      expect(stale.statusCode).toBe(409);
      entry15 = corrected;
    });

    it('needs a reason and a change, and keeps the window', async () => {
      const noReason = await correct(player15.headers, entry15.id, {
        version: entry15.version,
        rpe: 5,
      });
      expect(noReason.statusCode).toBe(400);
      expect(paths(noReason)).toContain('body.changeReason');
      const nothing = await correct(player15.headers, entry15.id, {
        version: entry15.version,
        changeReason: 'Nada',
      });
      expect(nothing.statusCode).toBe(400);
      const moved = await correct(player15.headers, entry15.id, {
        version: entry15.version,
        changeReason: 'Otro día',
        localDate: await addDays(today, -8),
      });
      expect(moved.statusCode).toBe(400);
      expect(paths(moved)).toEqual(['body.localDate']);
      const versionOld = (
        await database.admin.query<{ v: string }>(
          `select ((extract(epoch from updated_at) * 1000000)::bigint)::text as v from external_load where id = $1`,
          [oldEntry15],
        )
      ).rows[0]?.v;
      const old = await correct(player15.headers, oldEntry15, {
        version: versionOld,
        changeReason: 'Tarde',
        rpe: 5,
      });
      expect(old.statusCode).toBe(409);
      expect((await archive(player15.headers, oldEntry15)).statusCode).toBe(409);
    });

    it('lets only the player of the activity correct or archive it', async () => {
      // Not visible to another player (RLS): not found.
      const other = await correct(player13.headers, entry15.id, {
        version: entry15.version,
        changeReason: 'No es mío',
        rpe: 2,
      });
      expect(other.statusCode).toBe(404);
      expect((await archive(player13.headers, entry15.id)).statusCode).toBe(404);
      for (const caller of [coachM15, adminA]) {
        expect((await archive(caller.headers, entry15.id)).statusCode).toBe(403);
      }
    });

    it('archives once and for all: it stops counting and is not corrected again', async () => {
      const response = await archive(player13.headers, entry13.id);
      expect(response.statusCode, response.body).toBe(200);
      const archived = response.json<ExternalLoadBody>();
      expect(archived.archivedAt).not.toBeNull();
      const again = await archive(player13.headers, entry13.id);
      expect(again.statusCode).toBe(200);
      expect(again.json<ExternalLoadBody>().archivedAt).toBe(archived.archivedAt);
      const corrected = await correct(player13.headers, entry13.id, {
        version: archived.version,
        changeReason: 'Me arrepentí',
        minutes: 20,
      });
      expect(corrected.statusCode).toBe(409);
      // Archiving needs no reason (it fills an empty column).
      const history = await database.admin.query<{ reason: string | null }>(
        `select reason from change_history where table_name = 'external_load' and record_id = $1`,
        [entry13.id],
      );
      expect(history.rows).toEqual([{ reason: null }]);
    });
  });

  describe('reading', () => {
    it('the player reads their own, the staff by assignment, the administration the club', async () => {
      const own = await list(player15.headers);
      expect(own.map((e) => e.id).sort()).toEqual([entry15.id, oldEntry15].sort());
      expect((await list(coachM15.headers)).map((e) => e.playerId)).toEqual([p15, p15]);
      // Archived ones are left out unless asked for.
      expect((await list(coachM13.headers)).map((e) => e.playerId)).toEqual([p13]);
      expect(await list(coachM13.headers, '?status=all')).toHaveLength(2);
      expect(
        await list(adminA.headers, `?playerId=${p15}&from=${await addDays(today, -7)}`),
      ).toEqual([expect.objectContaining({ id: entry15.id })]);
      expect(await list(adminB.headers)).toHaveLength(1);
      expect((await list(adminB.headers))[0]?.playerId).not.toBe(p15);
      // Guardians read the summary, never this list.
      const parent = await t.app.inject({ url: '/v1/external-loads', headers: parent15.headers });
      expect(parent.statusCode).toBe(403);
    });

    it('reads one activity in the same scope', async () => {
      const mine = await t.app.inject({
        url: `/v1/external-loads/${entry15.id}`,
        headers: coachM15.headers,
      });
      expect(mine.statusCode, mine.body).toBe(200);
      const outside = await t.app.inject({
        url: `/v1/external-loads/${entry15.id}`,
        headers: coachM13.headers,
      });
      expect(outside.statusCode).toBe(404);
      const otherClub = await t.app.inject({
        url: `/v1/external-loads/${entry15.id}`,
        headers: adminB.headers,
      });
      expect(otherClub.statusCode).toBe(404);
    });
  });
});
