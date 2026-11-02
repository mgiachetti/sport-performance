/**
 * Season change end to end (B-316, ADR 0049) against Postgres 16, through
 * the real connection roles: the proposal by birth year, the manual review,
 * applying it into `player_category` (history kept), the outcomes of players
 * whose state changed since the draft, and who may do it (the administration).
 */
import { randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
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

interface RolloverBody {
  id: string;
  seasonId: string;
  sport: string;
  effectiveOn: string;
  seasonYear: number;
  status: string;
  counts: {
    players: number;
    moving: number;
    staying: number;
    pendingReview: number;
    outcomes: Record<string, number> | null;
  };
  appliedAt: string | null;
  cancelledAt: string | null;
  version: string;
}

interface ItemBody {
  id: string;
  player: { id: string; firstName: string; lastName: string; birthDate: string; sex: string };
  previousCategoryIds: string[];
  ageInSeasonYear: number;
  ageBandCode: string | null;
  proposal: string;
  proposedCategoryId: string | null;
  needsReview: boolean;
  decision: string;
  targetCategoryId: string | null;
  reviewedAt: string | null;
  outcome: string | null;
  membershipId: string | null;
  version: string;
}

interface MembershipBody {
  id: string;
  categoryId: string;
  seasonId: string | null;
  validFrom: string;
  validTo: string | null;
}

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

vi.setConfig({ testTimeout: 30_000 });

const SUPPORT_REASON = encodeURIComponent('Alta de clubes para el cambio de temporada');
const EFFECTIVE_ON = '2027-02-01';

function clubToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date());
}

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

describeWithPostgres('season change (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachA: SignedIn;
  let scA: SignedIn;
  let clubA: ClubId;
  let seasonId: string;
  const category: Record<string, string> = {};
  const players: Record<string, string> = {};
  let rollover: RolloverBody;
  const createUuid = randomUUID();

  async function inject(
    caller: SignedIn,
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> {
    return t.app.inject({
      method,
      url,
      headers: caller.headers,
      ...(payload !== undefined && { payload: payload as Record<string, unknown> }),
    });
  }

  async function ok<T>(response: Promise<LightMyRequestResponse>, status = 200): Promise<T> {
    const result = await response;
    expect(result.statusCode, result.body).toBe(status);
    return result.json<T>();
  }

  async function items(query = ''): Promise<ItemBody[]> {
    const page = await ok<Page<ItemBody>>(
      inject(adminA, 'GET', `/v1/season-rollovers/${rollover.id}/items?limit=100${query}`),
    );
    return page.items;
  }

  async function itemOf(name: string): Promise<ItemBody> {
    const found = (await items()).find((i) => i.player.firstName === name);
    if (found === undefined) throw new Error(`no item for ${name}`);
    return found;
  }

  async function createPlayer(
    firstName: string,
    birthDate: string,
    categoryKey?: string,
    branch: { sport: string; sex: string } = { sport: 'rugby', sex: 'male' },
  ): Promise<void> {
    const body = await ok<{ id: string }>(
      inject(adminA, 'POST', '/v1/players', {
        firstName,
        lastName: 'Prueba',
        birthDate,
        ...branch,
        joinedOn: '2024-03-01',
        ...(categoryKey !== undefined && { categoryId: category[categoryKey] }),
      }),
      201,
    );
    players[firstName] = body.id;
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
    scA = await signIn(t, 'pf@club-a.example.com');

    let clubB = '' as ClubId;
    for (const [slug, branches] of [
      [
        'club-a',
        [
          { sport: 'rugby', sex: 'male' },
          { sport: 'hockey', sex: 'female' },
        ],
      ],
      ['club-b', [{ sport: 'rugby', sex: 'male' }]],
    ] as const) {
      const response = await t.app.inject({
        method: 'POST',
        url: '/v1/clubs',
        headers: { ...superadmin.headers, 'x-support-reason': SUPPORT_REASON },
        payload: { slug, name: `Club ${slug}`, shortName: slug.toUpperCase(), branches },
      });
      expect(response.statusCode, response.body).toBe(201);
      const id = response.json<{ club: { id: ClubId } }>().club.id;
      if (slug === 'club-a') clubA = id;
      else clubB = id;
    }
    const categories = await database.admin.query<{ id: string; key: string }>(
      `select id, sport || ':' || age_band_code as key from category where club_id = $1`,
      [clubA],
    );
    for (const row of categories.rows) category[row.key] = row.id;

    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    const coach = await createMembership(database.admin, coachA.userId, clubA, 'coach');
    const sc = await createMembership(database.admin, scA.userId, clubA, 'sc');
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubA, coach, category['rugby:m15']],
    );
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, sport, valid_from)
       values ($1, $2, 'rugby', '2020-01-01')`,
      [clubA, sc],
    );

    seasonId = (
      await ok<{ id: string }>(
        inject(adminA, 'POST', '/v1/seasons', {
          sport: 'rugby',
          name: '2027',
          startsOn: EFFECTIVE_ON,
          endsOn: '2027-11-30',
        }),
        201,
      )
    ).id;

    // The 2027 season decides by birth year: 2027 − 2012 = 15 (M15).
    await createPlayer('Juan', '2012-11-30', 'rugby:m14'); // moves up to M15
    await createPlayer('Pedro', '2011-03-03', 'rugby:m16'); // already in M16
    await createPlayer('Tomás', '2007-06-06', 'rugby:m19'); // 20: ages out
    await createPlayer('Luis', '2012-04-04', 'rugby:m17'); // played up: would move down
    await createPlayer('Mateo', '2013-08-08'); // no category yet: M14
    await createPlayer('Carlos', '2012-01-01', 'rugby:m14'); // gets a manual pass later
    await createPlayer('Diego', '2012-02-02', 'rugby:m14'); // leaves the club later
    await createPlayer('Ana', '2012-05-05', 'hockey:m14', { sport: 'hockey', sex: 'female' });
    await createPlayer('Martín', '2012-07-07', 'rugby:m14');
    await ok(
      inject(adminA, 'POST', `/v1/players/${players['Martín'] ?? ''}/archive`, {
        leftOn: clubToday(),
        reason: 'quit',
      }),
    );
  }, 240_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('only the administration of the club proposes a season change', async () => {
    for (const caller of [coachA, scA]) {
      const response = await inject(caller, 'POST', `/v1/seasons/${seasonId}/rollovers`, {});
      expect(response.statusCode, response.body).toBe(403);
    }
    const foreign = await inject(adminB, 'POST', `/v1/seasons/${seasonId}/rollovers`, {});
    expect(foreign.statusCode, foreign.body).toBe(404);
  });

  it('the effective day lies within the season', async () => {
    const response = await inject(adminA, 'POST', `/v1/seasons/${seasonId}/rollovers`, {
      effectiveOn: '2027-12-01',
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(errorOf(response).details?.[0]?.path).toEqual(['body', 'effectiveOn']);
  });

  it('proposes the category of the birth year for every active player of the sport', async () => {
    rollover = await ok<RolloverBody>(
      inject(adminA, 'POST', `/v1/seasons/${seasonId}/rollovers`, { clientUuid: createUuid }),
      201,
    );
    expect(rollover).toMatchObject({
      seasonId,
      sport: 'rugby',
      effectiveOn: EFFECTIVE_ON,
      seasonYear: 2027,
      status: 'draft',
      // Seven active rugby players: not the hockey player, not the one who left.
      counts: { players: 7, moving: 5, staying: 2, pendingReview: 2, outcomes: null },
    });

    const all = await items();
    expect(all.map((i) => i.player.firstName)).toEqual([
      'Carlos',
      'Diego',
      'Juan',
      'Luis',
      'Mateo',
      'Pedro',
      'Tomás',
    ]);
    expect(await itemOf('Juan')).toMatchObject({
      ageInSeasonYear: 15,
      ageBandCode: 'm15',
      proposal: 'birth_year',
      proposedCategoryId: category['rugby:m15'],
      decision: 'move',
      targetCategoryId: category['rugby:m15'],
      needsReview: false,
      previousCategoryIds: [category['rugby:m14']],
      reviewedAt: null,
      outcome: null,
    });
    expect(await itemOf('Pedro')).toMatchObject({ proposal: 'already_there', decision: 'stay' });
    expect(await itemOf('Tomás')).toMatchObject({
      proposal: 'aged_out',
      ageBandCode: null,
      needsReview: true,
    });
    expect(await itemOf('Luis')).toMatchObject({
      proposal: 'birth_year',
      targetCategoryId: category['rugby:m15'],
      needsReview: true,
    });
    expect(await itemOf('Mateo')).toMatchObject({
      targetCategoryId: category['rugby:m14'],
      previousCategoryIds: [],
    });
  });

  it('replays the create by clientUuid and allows one draft per season', async () => {
    const replay = await inject(adminA, 'POST', `/v1/seasons/${seasonId}/rollovers`, {
      clientUuid: createUuid,
    });
    expect(replay.statusCode, replay.body).toBe(201);
    expect(replay.headers['x-idempotent-replay']).toBe('true');
    expect(replay.json<RolloverBody>().id).toBe(rollover.id);
    const second = await inject(adminA, 'POST', `/v1/seasons/${seasonId}/rollovers`, {});
    expect(second.statusCode, second.body).toBe(409);
  });

  it('lists, reads and filters, with cursors', async () => {
    const list = await ok<Page<RolloverBody>>(
      inject(adminA, 'GET', `/v1/seasons/${seasonId}/rollovers`),
    );
    expect(list.items.map((r) => r.id)).toEqual([rollover.id]);
    expect(
      await ok<RolloverBody>(inject(adminA, 'GET', `/v1/season-rollovers/${rollover.id}`)),
    ).toMatchObject({ id: rollover.id, version: rollover.version });

    const pending = await items('&needsReview=true');
    expect(pending.map((i) => i.player.firstName)).toEqual(['Luis', 'Tomás']);
    const toM15 = await items(`&targetCategoryId=${category['rugby:m15'] ?? ''}`);
    expect(toM15.map((i) => i.player.firstName)).toEqual(['Carlos', 'Diego', 'Juan', 'Luis']);

    const first = await ok<Page<ItemBody>>(
      inject(adminA, 'GET', `/v1/season-rollovers/${rollover.id}/items?limit=4&sort=-birthDate`),
    );
    expect(first.items.map((i) => i.player.firstName)).toEqual(['Mateo', 'Juan', 'Luis', 'Diego']);
    const next = await ok<Page<ItemBody>>(
      inject(
        adminA,
        'GET',
        `/v1/season-rollovers/${rollover.id}/items?limit=4&sort=-birthDate&cursor=${first.nextCursor ?? ''}`,
      ),
    );
    expect(next.items.map((i) => i.player.firstName)).toEqual(['Carlos', 'Pedro', 'Tomás']);
    expect(next.nextCursor).toBeNull();

    for (const caller of [coachA, scA]) {
      const response = await inject(caller, 'GET', `/v1/season-rollovers/${rollover.id}/items`);
      expect(response.statusCode, response.body).toBe(403);
    }
    const foreign = await inject(adminB, 'GET', `/v1/season-rollovers/${rollover.id}`);
    expect(foreign.statusCode, foreign.body).toBe(404);
  });

  it('does not apply while players that need a review were not reviewed', async () => {
    const response = await inject(adminA, 'POST', `/v1/season-rollovers/${rollover.id}/apply`, {
      version: rollover.version,
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(errorOf(response).message).toContain('2 player(s)');
  });

  it('reviews a player: a category of their branch, or no change', async () => {
    const luis = await itemOf('Luis');
    const url = `/v1/season-rollovers/${rollover.id}/items/${luis.id}`;
    const otherBranch = await inject(adminA, 'PATCH', url, {
      version: luis.version,
      decision: 'move',
      targetCategoryId: category['hockey:m15'],
    });
    expect(otherBranch.statusCode, otherBranch.body).toBe(400);
    expect(errorOf(otherBranch).details?.[0]?.path).toEqual(['body', 'targetCategoryId']);
    expect(
      (await inject(coachA, 'PATCH', url, { version: luis.version, decision: 'stay' })).statusCode,
    ).toBe(403);

    // He keeps playing up, in M17.
    const reviewed = await ok<ItemBody>(
      inject(adminA, 'PATCH', url, {
        version: luis.version,
        decision: 'move',
        targetCategoryId: category['rugby:m17'],
      }),
    );
    expect(reviewed).toMatchObject({
      decision: 'move',
      targetCategoryId: category['rugby:m17'],
      proposedCategoryId: category['rugby:m15'],
    });
    expect(reviewed.reviewedAt).not.toBeNull();
    const stale = await inject(adminA, 'PATCH', url, { version: luis.version, decision: 'stay' });
    expect(stale.statusCode, stale.body).toBe(409);

    const tomas = await itemOf('Tomás');
    await ok(
      inject(adminA, 'PATCH', `/v1/season-rollovers/${rollover.id}/items/${tomas.id}`, {
        version: tomas.version,
        decision: 'stay',
      }),
    );
    const read = await ok<RolloverBody>(
      inject(adminA, 'GET', `/v1/season-rollovers/${rollover.id}`),
    );
    expect(read.counts.pendingReview).toBe(0);
    // Every review changes the version of the draft: applying the old one is a conflict.
    expect(read.version).not.toBe(rollover.version);
    const old = await inject(adminA, 'POST', `/v1/season-rollovers/${rollover.id}/apply`, {
      version: rollover.version,
    });
    expect(old.statusCode, old.body).toBe(409);
    rollover = read;
  });

  it('applies the reviewed change on the state of each player, keeping the history', async () => {
    // Since the draft: a manual pass of Carlos from the effective day, and Diego left.
    await ok(
      inject(adminA, 'POST', `/v1/players/${players.Carlos ?? ''}/categories`, {
        categoryId: category['rugby:m16'],
        validFrom: EFFECTIVE_ON,
      }),
      201,
    );
    await ok(
      inject(adminA, 'POST', `/v1/players/${players.Diego ?? ''}/archive`, {
        leftOn: clubToday(),
        reason: 'transferred',
      }),
    );
    expect(
      (
        await inject(coachA, 'POST', `/v1/season-rollovers/${rollover.id}/apply`, {
          version: rollover.version,
        })
      ).statusCode,
    ).toBe(403);

    const applied = await ok<RolloverBody>(
      inject(adminA, 'POST', `/v1/season-rollovers/${rollover.id}/apply`, {
        version: rollover.version,
      }),
    );
    expect(applied).toMatchObject({
      status: 'applied',
      counts: {
        players: 7,
        outcomes: {
          moved: 2, // Juan, Mateo
          stayed: 3, // Pedro, Tomás, and Luis (already in M17)
          skipped_left: 1, // Diego
          skipped_later_membership: 1, // Carlos
          skipped_category_unavailable: 0,
        },
      },
    });
    expect(applied.appliedAt).not.toBeNull();
    expect(await itemOf('Luis')).toMatchObject({ outcome: 'stayed', membershipId: null });
    expect(await itemOf('Carlos')).toMatchObject({ outcome: 'skipped_later_membership' });

    const juan = await itemOf('Juan');
    expect(juan.outcome).toBe('moved');
    // After applying, the previous categories are still what he left.
    expect(juan.previousCategoryIds).toEqual([category['rugby:m14']]);
    const history = await ok<Page<MembershipBody>>(
      inject(adminA, 'GET', `/v1/players/${players.Juan ?? ''}/categories?sort=validFrom`),
    );
    expect(history.items).toMatchObject([
      { categoryId: category['rugby:m14'], validFrom: '2024-03-01', validTo: EFFECTIVE_ON },
      {
        id: juan.membershipId,
        categoryId: category['rugby:m15'],
        seasonId,
        validFrom: EFFECTIVE_ON,
        validTo: null,
      },
    ]);
    const pedro = await ok<Page<MembershipBody>>(
      inject(adminA, 'GET', `/v1/players/${players.Pedro ?? ''}/categories`),
    );
    expect(pedro.items).toMatchObject([{ categoryId: category['rugby:m16'], validTo: null }]);
  });

  it('is applied once: retries answer it, nothing changes after', async () => {
    const again = await ok<RolloverBody>(
      inject(adminA, 'POST', `/v1/season-rollovers/${rollover.id}/apply`, {
        version: rollover.version,
      }),
    );
    expect(again.status).toBe('applied');
    const juan = await itemOf('Juan');
    const patch = await inject(
      adminA,
      'PATCH',
      `/v1/season-rollovers/${rollover.id}/items/${juan.id}`,
      { version: juan.version, decision: 'stay' },
    );
    expect(patch.statusCode, patch.body).toBe(409);
    const cancel = await inject(adminA, 'POST', `/v1/season-rollovers/${rollover.id}/cancel`);
    expect(cancel.statusCode, cancel.body).toBe(409);
    const memberships = await database.admin.query<{ n: number }>(
      `select count(*)::int as n from player_category where club_id = $1 and season_id = $2`,
      [clubA, seasonId],
    );
    expect(memberships.rows[0]?.n).toBe(2);
  });

  it('a new draft after applying proposes nothing new, and can be cancelled', async () => {
    const draft = await ok<RolloverBody>(
      inject(adminA, 'POST', `/v1/seasons/${seasonId}/rollovers`, {}),
      201,
    );
    // Diego left: six players. Juan and Mateo are already where their birth year says.
    expect(draft.counts.players).toBe(6);
    const juan = (
      await ok<Page<ItemBody>>(inject(adminA, 'GET', `/v1/season-rollovers/${draft.id}/items`))
    ).items.find((i) => i.player.firstName === 'Juan');
    expect(juan).toMatchObject({ proposal: 'already_there', decision: 'stay' });

    const cancelled = await ok<RolloverBody>(
      inject(adminA, 'POST', `/v1/season-rollovers/${draft.id}/cancel`),
    );
    expect(cancelled).toMatchObject({ status: 'cancelled' });
    expect(cancelled.cancelledAt).not.toBeNull();
    expect(
      (await ok<RolloverBody>(inject(adminA, 'POST', `/v1/season-rollovers/${draft.id}/cancel`)))
        .status,
    ).toBe('cancelled');
    const apply = await inject(adminA, 'POST', `/v1/season-rollovers/${draft.id}/apply`, {
      version: cancelled.version,
    });
    expect(apply.statusCode, apply.body).toBe(409);
    const list = await ok<Page<RolloverBody>>(
      inject(adminA, 'GET', `/v1/seasons/${seasonId}/rollovers?status=cancelled`),
    );
    expect(list.items.map((r) => r.id)).toEqual([draft.id]);
  });
});
