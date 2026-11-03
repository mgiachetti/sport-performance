/**
 * The roster of a training session (B-407) against Postgres 16, through the
 * real connection role of the API (ADR 0026): who is in it on the session's
 * club day, the participation, the derived availability without the cause
 * (ADR 0029, audited) and what the caller may record, by role and
 * assignment. Players, categories, consents and medical rows are fixtures
 * inserted with the owner connection.
 */
import { randomUUID } from 'node:crypto';
import type { ClubId, UserId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
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

interface RosterEntryBody {
  player: { id: string; firstName: string; lastName: string; archivedAt: string | null };
  inCategory: boolean;
  participation: { status: string; minutes: number | null } | null;
  availability: { status: string; staffNotes: string[] } | null;
  hasDataConsent: boolean;
  canRecord: boolean;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const HOUR_MS = 60 * 60 * 1000;
const SUPPORT_REASON = encodeURIComponent('Revisión del plantel de una sesión pedida por el club');

describeWithPostgres('roster of a training session (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachA: SignedIn;
  let scA: SignedIn;
  let playerUser: SignedIn;
  let parentA: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m15: string;
  let m17: string;
  /** M15, data consent, a medical block and an injury with a diagnosis. */
  let p1: string;
  /** M15, no consent. */
  let p2: string;
  /** M17, data consent: called up to the M15 session by the administration. */
  let p3: string;
  /** M15 only from a future day: not in today's session. */
  let p4: string;
  let training: string;
  let match: string;

  async function insertCategory(clubId: ClubId, band: string, name: string): Promise<string> {
    await database.admin.query(
      `insert into club_branch (club_id, sport, sex) values ($1, 'rugby', 'male')
       on conflict (club_id, sport, sex) do nothing`,
      [clubId],
    );
    const stage = band === 'm17' ? 'performance' : 'development';
    const result = await database.admin.query<{ id: string }>(
      `insert into category (club_id, sport, sex, age_band_code, name, default_stage)
       values ($1, 'rugby', 'male', $2, $3, $4) returning id`,
      [clubId, band, name, stage],
    );
    return result.rows[0]?.id ?? '';
  }

  async function insertPlayer(
    clubId: ClubId,
    categoryId: string,
    names: { first: string; last: string },
    options: { userId?: UserId; consentSigner?: UserId; validFrom?: string } = {},
  ): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, $3, $4, '2011-04-02', 'male', 'rugby', '2024-01-01') returning id`,
      [clubId, options.userId ?? null, names.first, names.last],
    );
    const id = result.rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, $4)`,
      [clubId, id, categoryId, options.validFrom ?? '2020-01-01'],
    );
    if (options.consentSigner !== undefined) {
      await database.admin.query(
        `insert into consent (club_id, player_id, type, document_version, signer_kind, signed_by)
         values ($1, $2, 'data', 'v1', 'guardian', $3)`,
        [clubId, id, options.consentSigner],
      );
    }
    return id;
  }

  async function createSession(
    caller: SignedIn,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/training-sessions',
      headers: caller.headers,
      payload,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ id: string }>().id;
  }

  function roster(
    headers: Record<string, string>,
    sessionId: string,
    query = '',
  ): Promise<LightMyRequestResponse> {
    return t.app.inject({
      method: 'GET',
      url: `/v1/training-sessions/${sessionId}/roster${query}`,
      headers,
    });
  }

  async function rosterOf(caller: SignedIn, sessionId: string): Promise<RosterEntryBody[]> {
    const response = await roster(caller.headers, sessionId);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Page<RosterEntryBody>>().items;
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
    coachA = await signIn(t, 'coach@club-a.example.com');
    scA = await signIn(t, 'sc@club-a.example.com');
    playerUser = await signIn(t, 'player@club-a.example.com', 'bearer');
    parentA = await signIn(t, 'parent@club-a.example.com');

    clubA = await createClub(database.admin, 'club-a');
    clubB = await createClub(database.admin, 'club-b');
    m15 = await insertCategory(clubA, 'm15', 'M15');
    m17 = await insertCategory(clubA, 'm17', 'M17');
    await insertCategory(clubB, 'm15', 'M15');

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    const coachMembership = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    const scMembership = await createMembership(database.admin, scA.userId, clubA, 'sc');
    await createMembership(database.admin, playerUser.userId, clubA, 'player');
    await createMembership(database.admin, parentA.userId, clubA, 'parent');
    for (const membership of [coachMembership, scMembership]) {
      await database.admin.query(
        `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
         values ($1, $2, $3, '2020-01-01')`,
        [clubA, membership, m15],
      );
    }

    p1 = await insertPlayer(
      clubA,
      m15,
      { first: 'Juan', last: 'Álvarez' },
      { userId: playerUser.userId, consentSigner: parentA.userId },
    );
    p2 = await insertPlayer(clubA, m15, { first: 'Tomás', last: 'Benítez' });
    p3 = await insertPlayer(
      clubA,
      m17,
      { first: 'Lucas', last: 'Castro' },
      { consentSigner: parentA.userId },
    );
    p4 = await insertPlayer(
      clubA,
      m15,
      { first: 'Mateo', last: 'Díaz' },
      { consentSigner: parentA.userId, validFrom: '2099-01-01' },
    );

    // The medical staff blocked p1: limited in training, out of matches; with an injury.
    await database.admin.query(
      `insert into medical.injury (club_id, player_id, onset_on, context, body_region, side, onset, mechanism, diagnosis)
       values ($1, $2, '2026-03-10', 'match', 'knee', 'left', 'acute', 'contact', 'Esguince LCM')`,
      [clubA, p1],
    );
    await database.admin.query(
      `insert into medical.hold (club_id, player_id, training, match, valid_from, staff_note)
       values ($1, $2, 'limited', 'unavailable', '2020-01-01', 'Sin contacto')`,
      [clubA, p1],
    );

    const startsAt = new Date(Date.now() - HOUR_MS).toISOString();
    training = await createSession(coachA, {
      kind: 'training',
      categoryId: m15,
      startsAt,
      plannedDurationMin: 90,
    });
    match = await createSession(coachA, {
      kind: 'match',
      categoryId: m15,
      startsAt,
      opponent: 'CASI',
    });
    // The administration calls p3 (M17) up to the M15 training.
    const callUp = await t.app.inject({
      method: 'POST',
      url: `/v1/training-sessions/${training}/participations/batch`,
      headers: adminA.headers,
      payload: { rows: [{ clientUuid: randomUUID(), playerId: p3, status: 'full', minutes: 90 }] },
    });
    expect(callUp.statusCode, callUp.body).toBe(200);
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('gives the coach the category of the session day, by name, with availability and no cause', async () => {
    const response = await roster(coachA.headers, training);
    expect(response.statusCode, response.body).toBe(200);
    // Never the diagnosis or anything clinical, only the derived status and the staff note.
    expect(response.body).not.toContain('Esguince');
    expect(response.body).not.toContain('knee');
    const items = response.json<Page<RosterEntryBody>>().items;
    // p3 is called up but outside the coach's assignment; p4 joins the category later.
    expect(items.map((entry) => entry.player.id)).toEqual([p1, p2]);
    expect(items.map((entry) => entry.player.id)).not.toContain(p4);
    expect(items[0]).toMatchObject({
      inCategory: true,
      participation: null,
      availability: { status: 'limited', staffNotes: ['Sin contacto'] },
      hasDataConsent: true,
      canRecord: true,
    });
    expect(items[1]).toMatchObject({
      availability: { status: 'available', staffNotes: [] },
      hasDataConsent: false,
      canRecord: false,
    });
  });

  it('logs the availability read in the medical access log', async () => {
    await rosterOf(coachA, training);
    const log = await database.admin.query<{ player_id: string | null; actor_role: string }>(
      `select player_id, actor_role from medical.access_log
        where actor_user_id = $1 and resource = 'availability'`,
      [coachA.userId],
    );
    expect(log.rows.map((row) => row.player_id)).toEqual(expect.arrayContaining([p1, p2]));
    expect(log.rows.every((row) => row.actor_role === 'coach')).toBe(true);
  });

  it('uses the match availability for a match', async () => {
    const items = await rosterOf(coachA, match);
    expect(items.find((entry) => entry.player.id === p1)?.availability?.status).toBe('unavailable');
  });

  it('shows the administration the called-up players, outside the category', async () => {
    const items = await rosterOf(adminA, training);
    expect(items.map((entry) => entry.player.id)).toEqual([p1, p2, p3]);
    expect(items[2]).toMatchObject({
      inCategory: false,
      participation: { status: 'full', minutes: 90 },
      canRecord: true,
    });
  });

  it('is read-only for the S&C staff', async () => {
    const items = await rosterOf(scA, training);
    expect(items.map((entry) => entry.player.id)).toEqual([p1, p2]);
    expect(items.every((entry) => !entry.canRecord)).toBe(true);
  });

  it('pages by cursor', async () => {
    const first = await roster(adminA.headers, training, '?limit=2');
    expect(first.statusCode, first.body).toBe(200);
    const page1 = first.json<Page<RosterEntryBody>>();
    expect(page1.items.map((entry) => entry.player.id)).toEqual([p1, p2]);
    expect(page1.nextCursor).not.toBeNull();
    const second = await roster(
      adminA.headers,
      training,
      `?limit=2&cursor=${encodeURIComponent(page1.nextCursor ?? '')}`,
    );
    const page2 = second.json<Page<RosterEntryBody>>();
    expect(page2.items.map((entry) => entry.player.id)).toEqual([p3]);
    expect(page2.nextCursor).toBeNull();
  });

  it('denies players and parents, and hides another club’s session', async () => {
    expect((await roster(playerUser.headers, training)).statusCode).toBe(403);
    expect((await roster(parentA.headers, training)).statusCode).toBe(403);
    expect((await roster(adminB.headers, training)).statusCode).toBe(404);
    expect((await roster(adminA.headers, randomUUID())).statusCode).toBe(404);
  });

  it('lets a superadmin read with a support reason, never without', async () => {
    const supported = await roster(
      { ...superadmin.headers, 'x-support-club-id': clubA, 'x-support-reason': SUPPORT_REASON },
      training,
    );
    expect(supported.statusCode, supported.body).toBe(200);
    expect(supported.json<Page<RosterEntryBody>>().items).toHaveLength(3);
    expect((await roster(superadmin.headers, training)).statusCode).toBe(403);
  });
});
