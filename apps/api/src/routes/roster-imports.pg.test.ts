/**
 * Roster import end to end (B-330, ADR 0047) against Postgres 16, through
 * the real connection roles: only the administration previews and imports,
 * rows are validated against the club, duplicates are found in the file and
 * in the club, decisions are applied all or nothing, guardians are linked or
 * returned as invitations to send, and the import is idempotent and recorded.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { ClubId } from '@sport-performance/domain';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  error: {
    code: string;
    message: string;
    details?: { path: (string | number)[]; code: string; message: string }[];
  };
}

interface PreviewRow {
  index: number;
  sourceRow: number | null;
  issues: { path: (string | number)[]; code: string; message: string }[];
  action: 'create' | 'skip' | 'update' | null;
  resolutionRequired: boolean;
  categoryId: string | null;
  positionIds: string[];
  matches: {
    playerId: string;
    kind: string;
    reason: string;
    archived: boolean;
    version: string;
    currentCategoryIds: string[];
  }[];
  duplicateOfIndex: number | null;
  guardians: { email: string; relationship: string; outcome: string }[];
}

interface Preview {
  rowCount: number;
  invalidCount: number;
  resolutionRequiredCount: number;
  createCount: number;
  updateCount: number;
  skipCount: number;
  guardiansToLinkCount: number;
  invitationsToSendCount: number;
  rows: PreviewRow[];
}

interface ImportRecord {
  id: string;
  clientUuid: string;
  rowCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  guardiansLinkedCount: number;
  invitationsToSendCount: number;
  createdBy: string | null;
  rows: {
    index: number;
    sourceRow: number | null;
    result: string;
    playerId: string | null;
    guardians: string[];
  }[];
}

interface ImportResult {
  import: ImportRecord;
  invitationsToSend: {
    rowIndex: number;
    guardianIndex: number;
    playerId: string;
    email: string;
    relationship: string;
  }[];
}

function errorOf(response: LightMyRequestResponse): Envelope['error'] {
  return response.json<Envelope>().error;
}

const SUPPORT_REASON = encodeURIComponent('Alta del padrón pedida por el club');

describeWithPostgres('roster import (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let superadmin: SignedIn;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let scA: SignedIn;
  let coachA: SignedIn;
  let parentA: SignedIn;
  let clubA: ClubId;
  let clubB: ClubId;
  let m15: string;
  let m17: string;
  /** Rugby M15, Juan Pérez, born 2011-03-05, linked to `parentA`. */
  let juan: string;
  /** Rugby M17, Tomás Gómez, born 2009-07-20. */
  let tomas: string;
  /** Rugby, Lucas Ruiz, born 2011-01-10, without category. */
  let lucas: string;
  /** Rugby, left the club: Mateo Sosa, born 2010-02-02. */
  let mateo: string;

  const registry = () => ({ ...superadmin.headers, 'x-support-reason': SUPPORT_REASON });

  async function newClub(slug: string, branches: { sport: string; sex: string }[]) {
    const response = await t.app.inject({
      method: 'POST',
      url: '/v1/clubs',
      headers: registry(),
      payload: { slug, name: `Club ${slug}`, shortName: slug.toUpperCase(), branches },
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json<{ club: { id: ClubId } }>().club.id;
  }

  async function categoryId(clubId: ClubId, band: string): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      `select id from category where club_id = $1 and sport = 'rugby' and age_band_code = $2`,
      [clubId, band],
    );
    return result.rows[0]?.id ?? '';
  }

  async function insertPlayer(
    clubId: ClubId,
    values: { first: string; last: string; birth: string; categoryId?: string; left?: boolean },
  ): Promise<string> {
    const result = await database.admin.query<{ id: string }>(
      `insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on,
         left_on, left_reason, archived_at)
       values ($1, $2, $3, $4, 'male', 'rugby', '2020-01-01',
         case when $5 then '2024-01-01'::date end, case when $5 then 'quit'::player_leave_reason end,
         case when $5 then now() end)
       returning id`,
      [clubId, values.first, values.last, values.birth, values.left === true],
    );
    const id = result.rows[0]?.id ?? '';
    if (values.categoryId !== undefined) {
      await database.admin.query(
        `insert into player_category (club_id, player_id, category_id, valid_from)
         values ($1, $2, $3, '2020-01-01')`,
        [clubId, id, values.categoryId],
      );
    }
    return id;
  }

  const post = (caller: SignedIn, url: string, payload: object) =>
    t.app.inject({ method: 'POST', url, headers: caller.headers, payload });

  async function preview(payload: object, caller: SignedIn = adminA): Promise<Preview> {
    const response = await post(caller, '/v1/roster-imports/preview', payload);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<Preview>();
  }

  const row = (extra: Record<string, unknown> = {}) => ({
    firstName: 'Bruno',
    lastName: 'Alvarez',
    birthDate: '2011-04-01',
    sex: 'male',
    ...extra,
  });

  const count = async (sql: string, params: unknown[]) =>
    Number(
      (await database.admin.query<{ n: string }>(`select count(*)::text as n ${sql}`, params))
        .rows[0]?.n,
    );

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
    scA = await signIn(t, 'sc@club-a.example.com');
    coachA = await signIn(t, 'coach@club-a.example.com');
    parentA = await signIn(t, 'Madre@club-a.example.com');

    clubA = await newClub('club-a', [
      { sport: 'rugby', sex: 'male' },
      { sport: 'hockey', sex: 'female' },
    ]);
    clubB = await newClub('club-b', [{ sport: 'rugby', sex: 'male' }]);
    await createMembership(database.admin, adminA.userId, clubA, 'admin');
    await createMembership(database.admin, adminB.userId, clubB, 'admin');
    await createMembership(database.admin, scA.userId, clubA, 'sc');
    await createMembership(database.admin, coachA.userId, clubA, 'coach');
    await createMembership(database.admin, parentA.userId, clubA, 'parent');
    m15 = await categoryId(clubA, 'm15');
    m17 = await categoryId(clubA, 'm17');
    juan = await insertPlayer(clubA, {
      first: 'Juan',
      last: 'Pérez',
      birth: '2011-03-05',
      categoryId: m15,
    });
    tomas = await insertPlayer(clubA, {
      first: 'Tomás',
      last: 'Gómez',
      birth: '2009-07-20',
      categoryId: m17,
    });
    lucas = await insertPlayer(clubA, { first: 'Lucas', last: 'Ruiz', birth: '2011-01-10' });
    mateo = await insertPlayer(clubA, {
      first: 'Mateo',
      last: 'Sosa',
      birth: '2010-02-02',
      left: true,
    });
    await database.admin.query(
      `insert into guardian (club_id, user_id, player_id, relationship, valid_from)
       values ($1, $2, $3, 'mother', '2020-01-01')`,
      [clubA, parentA.userId, juan],
    );
    // An open invitation for Tomás's father, sent before the import.
    await database.admin.query(
      `insert into invitation (club_id, email, role, player_id, guardian_relationship, token_hash, expires_at)
       values ($1, 'papa.gomez@example.com', 'parent', $2, 'father', $3, now() + interval '7 days')`,
      [clubA, tomas, createHash('sha256').update('roster-import-invitation').digest('hex')],
    );
  }, 90_000);

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  describe('permissions', () => {
    it.each([
      ['sc', () => scA],
      ['coach', () => coachA],
      ['parent', () => parentA],
    ])('%s cannot preview, import or list', async (_role, caller) => {
      const body = { sport: 'rugby', rows: [row()] };
      expect((await post(caller(), '/v1/roster-imports/preview', body)).statusCode).toBe(403);
      expect(
        (await post(caller(), '/v1/roster-imports', { ...body, clientUuid: randomUUID() }))
          .statusCode,
      ).toBe(403);
      const list = await t.app.inject({ url: '/v1/roster-imports', headers: caller().headers });
      expect(list.statusCode).toBe(403);
    });
  });

  describe('preview', () => {
    it('resolves categories and positions and writes nothing', async () => {
      const before = await count('from player where club_id = $1', [clubA]);
      const result = await preview({
        sport: 'rugby',
        rows: [
          row({ sourceRow: 2, category: 'm15', positions: ['Hooker', 'prop'] }),
          row({ firstName: 'Ana', lastName: 'Luna', sex: 'female', sport: 'hockey' }),
        ],
      });
      expect(result).toMatchObject({ rowCount: 2, createCount: 2, invalidCount: 0 });
      expect(result.rows[0]).toMatchObject({
        index: 0,
        sourceRow: 2,
        issues: [],
        action: 'create',
        categoryId: m15,
        matches: [],
      });
      expect(result.rows[0]?.positionIds).toHaveLength(2);
      expect(await count('from player where club_id = $1', [clubA])).toBe(before);
    });

    it('reports every problem of a row with its path', async () => {
      const result = await preview({
        sport: 'rugby',
        rows: [
          row({ birthDate: '2099-01-01', category: 'Plantel superior', positions: ['arquero'] }),
          row({ firstName: 'Uno', sex: 'female' }),
          row({ firstName: 'Dos', joinedOn: '2010-01-01' }),
          row({ firstName: 'Tres', category: 'M17', positions: ['hooker', 'Hooker'] }),
          row({ firstName: 'TRES', lastName: 'álvarez' }),
        ],
      });
      const paths = result.rows.map((r) => r.issues.map((i) => i.path.slice(3).join('.')));
      expect(paths[0]).toEqual(['birthDate', 'category', 'positions.0']);
      expect(result.rows[0]?.issues[1]?.message).toContain('M15');
      // Rugby female is not a branch of the club.
      expect(paths[1]).toEqual(['sport']);
      expect(paths[2]).toEqual(['joinedOn']);
      expect(paths[3]).toEqual(['positions.1']);
      expect(result.rows[4]?.duplicateOfIndex).toBe(3);
      expect(paths[4]).toEqual(['']);
      expect(result.invalidCount).toBe(5);
    });

    it('finds exact and possible duplicates in the club, also players who left', async () => {
      const result = await preview({
        sport: 'rugby',
        rows: [
          row({ firstName: 'juan', lastName: 'PEREZ', birthDate: '2011-03-05' }),
          row({ firstName: 'Pérez', lastName: 'Juan', birthDate: '2011-03-05' }),
          row({ firstName: 'Tomas', lastName: 'Gomes', birthDate: '2009-07-20' }),
          row({
            firstName: 'Mateo',
            lastName: 'Sosa',
            birthDate: '2010-02-02',
            guardians: [{ email: 'madre@club-a.example.com', relationship: 'mother' }],
          }),
          row({
            firstName: 'Juan',
            lastName: 'Pérez',
            birthDate: '2011-03-05',
            sport: 'hockey',
            sex: 'female',
          }),
        ],
      });
      expect(result.rows[0]).toMatchObject({ action: 'skip', resolutionRequired: false });
      expect(result.rows[0]?.matches).toMatchObject([
        { playerId: juan, kind: 'exact', reason: 'same_name_and_birth_date', archived: false },
      ]);
      expect(result.rows[1]).toMatchObject({ action: null, resolutionRequired: true });
      expect(result.rows[1]?.matches[0]).toMatchObject({ playerId: juan, reason: 'swapped_names' });
      expect(result.rows[1]?.issues.map((i) => i.code)).toEqual(['resolution_required']);
      expect(result.rows[2]?.matches[0]).toMatchObject({ playerId: tomas, reason: 'similar_name' });
      expect(result.rows[3]?.matches[0]).toMatchObject({ playerId: mateo, archived: true });
      // Never linked to a player who left.
      expect(result.rows[3]?.guardians.map((g) => g.outcome)).toEqual(['skipped']);
      // Another sport: another profile, never a match.
      expect(result.rows[4]).toMatchObject({ action: 'create', matches: [] });
      expect(result).toMatchObject({ skipCount: 2, resolutionRequiredCount: 2, invalidCount: 0 });
    });

    it('says what happens to each guardian', async () => {
      const result = await preview({
        sport: 'rugby',
        rows: [
          row({
            firstName: 'Juan',
            lastName: 'Pérez',
            birthDate: '2011-03-05',
            guardians: [
              { email: 'madre@club-a.example.com', relationship: 'mother' },
              { email: 'papa.perez@example.com', relationship: 'father' },
            ],
          }),
          row({
            firstName: 'Tomás',
            lastName: 'Gómez',
            birthDate: '2009-07-20',
            guardians: [{ email: 'Papa.Gomez@example.com', relationship: 'father' }],
          }),
          row({ guardians: [{ email: 'madre@club-a.example.com', relationship: 'mother' }] }),
        ],
      });
      expect(result.rows.map((r) => r.guardians.map((g) => g.outcome))).toEqual([
        ['already_linked', 'invite'],
        ['invitation_pending'],
        ['linked'],
      ]);
      expect(result.rows[1]?.guardians[0]?.email).toBe('papa.gomez@example.com');
      expect(result).toMatchObject({ guardiansToLinkCount: 1, invitationsToSendCount: 1 });
    });
  });

  describe('import', () => {
    it('writes nothing when a row does not validate or needs a decision', async () => {
      const before = await count('from player where club_id = $1', [clubA]);
      const invalid = await post(adminA, '/v1/roster-imports', {
        clientUuid: randomUUID(),
        sport: 'rugby',
        rows: [row({ firstName: 'Nuevo' }), row({ category: 'M99' })],
      });
      expect(invalid.statusCode, invalid.body).toBe(400);
      expect(errorOf(invalid).details?.map((d) => d.path)).toEqual([
        ['body', 'rows', 1, 'category'],
      ]);
      const undecided = await post(adminA, '/v1/roster-imports', {
        clientUuid: randomUUID(),
        sport: 'rugby',
        rows: [
          row({ firstName: 'Nuevo' }),
          row({ firstName: 'Juan', lastName: 'Perez', birthDate: '2011-05-03' }),
        ],
      });
      expect(undecided.statusCode).toBe(400);
      expect(errorOf(undecided).details?.[0]).toMatchObject({
        path: ['body', 'rows', 1, 'resolution'],
        code: 'resolution_required',
      });
      expect(await count('from player where club_id = $1', [clubA])).toBe(before);
    });

    it('never creates an exact duplicate, updates a player who left or a non-candidate', async () => {
      const cases: [object, string][] = [
        [
          row({
            firstName: 'Juan',
            lastName: 'Pérez',
            birthDate: '2011-03-05',
            resolution: { action: 'create' },
          }),
          'skip or update',
        ],
        [
          row({
            firstName: 'Mateo',
            lastName: 'Sosa',
            birthDate: '2010-02-02',
            resolution: { action: 'create' },
          }),
          'restore',
        ],
        [
          row({
            firstName: 'Mateo',
            lastName: 'Sosa',
            birthDate: '2010-02-02',
            resolution: { action: 'update', playerId: mateo, version: '1' },
          }),
          'restore',
        ],
        [row({ resolution: { action: 'update', playerId: juan, version: '1' } }), 'Not a match'],
      ];
      for (const [body, message] of cases) {
        const response = await post(adminA, '/v1/roster-imports', {
          clientUuid: randomUUID(),
          sport: 'rugby',
          rows: [body],
        });
        expect(response.statusCode, response.body).toBe(400);
        expect(errorOf(response).details?.[0]?.message).toContain(message);
      }
    });

    it('imports, links guardians, lists invitations, and is idempotent', async () => {
      const draft = {
        sport: 'rugby',
        rows: [
          row({
            sourceRow: 2,
            firstName: 'Bruno',
            lastName: 'Álvarez',
            category: 'M15',
            positions: ['hooker'],
            dominantSide: 'right',
            joinedOn: '2025-03-01',
            guardians: [
              { email: 'madre@club-a.example.com', relationship: 'mother' },
              { email: 'papa.alvarez@example.com', relationship: 'father' },
            ],
          }),
          row({
            sourceRow: 3,
            firstName: 'Juan',
            lastName: 'Perez',
            birthDate: '2011-03-05',
            guardians: [{ email: 'papa.perez@example.com', relationship: 'father' }],
          }),
          row({
            sourceRow: 4,
            firstName: 'Lucas',
            lastName: 'Ruis',
            birthDate: '2011-01-10',
            category: 'M15',
            positions: ['prop'],
            dominantSide: 'left',
          }),
          row({ sourceRow: 5, firstName: 'Pérez', lastName: 'Juan', birthDate: '2011-03-05' }),
        ],
      };
      const seen = await preview(draft);
      const lucasMatch = seen.rows[2]?.matches[0];
      expect(lucasMatch).toMatchObject({ playerId: lucas, reason: 'similar_name' });
      const body = {
        ...draft,
        clientUuid: randomUUID(),
        rows: draft.rows.map((r, index) =>
          index === 2
            ? {
                ...r,
                resolution: { action: 'update', playerId: lucas, version: lucasMatch?.version },
              }
            : index === 3
              ? { ...r, resolution: { action: 'skip' } }
              : r,
        ),
      };
      const response = await post(adminA, '/v1/roster-imports', body);
      expect(response.statusCode, response.body).toBe(201);
      const result = response.json<ImportResult>();
      expect(result.import).toMatchObject({
        rowCount: 4,
        createdCount: 1,
        updatedCount: 1,
        skippedCount: 2,
        guardiansLinkedCount: 1,
        invitationsToSendCount: 2,
        createdBy: adminA.userId,
      });
      const [created, skipped, updated, undecided] = result.import.rows;
      expect(created).toMatchObject({
        index: 0,
        sourceRow: 2,
        result: 'created',
        guardians: ['linked', 'invite'],
      });
      expect(skipped).toMatchObject({ result: 'skipped', playerId: juan, guardians: ['invite'] });
      expect(updated).toMatchObject({ result: 'updated', playerId: lucas, guardians: [] });
      expect(undecided).toMatchObject({ result: 'skipped', playerId: null });
      const bruno = created?.playerId ?? '';
      expect(result.invitationsToSend).toEqual([
        {
          rowIndex: 0,
          guardianIndex: 1,
          playerId: bruno,
          email: 'papa.alvarez@example.com',
          relationship: 'father',
        },
        {
          rowIndex: 1,
          guardianIndex: 0,
          playerId: juan,
          email: 'papa.perez@example.com',
          relationship: 'father',
        },
      ]);

      // The new player: the profile, the category from the day they joined, the position.
      const profile = await t.app.inject({ url: `/v1/players/${bruno}`, headers: adminA.headers });
      expect(profile.json()).toMatchObject({
        firstName: 'Bruno',
        lastName: 'Álvarez',
        sport: 'rugby',
        dominantSide: 'right',
        joinedOn: '2025-03-01',
        currentCategoryIds: [m15],
      });
      expect(profile.json<{ positionIds: string[] }>().positionIds).toHaveLength(1);
      expect(
        await count(`from guardian where club_id = $1 and player_id = $2 and user_id = $3`, [
          clubA,
          bruno,
          parentA.userId,
        ]),
      ).toBe(1);
      // The updated player: dominant side, positions and the category they lacked (from today).
      const merged = await t.app.inject({ url: `/v1/players/${lucas}`, headers: adminA.headers });
      expect(merged.json()).toMatchObject({
        firstName: 'Lucas',
        lastName: 'Ruiz',
        dominantSide: 'left',
        currentCategoryIds: [m15],
      });

      // Same body: the same result, marked as a replay, nothing written twice.
      const replay = await post(adminA, '/v1/roster-imports', body);
      expect(replay.statusCode).toBe(201);
      expect(replay.headers['x-idempotent-replay']).toBe('true');
      expect(replay.json<ImportResult>()).toEqual(result);
      expect(await count(`from player where club_id = $1 and last_name = 'Álvarez'`, [clubA])).toBe(
        1,
      );
      // Another body with the same clientUuid.
      const other = await post(adminA, '/v1/roster-imports', {
        ...body,
        rows: [row({ firstName: 'Otro' })],
      });
      expect(other.statusCode).toBe(409);

      // The update used the version of the preview: it is stale now.
      const stale = await post(adminA, '/v1/roster-imports', {
        clientUuid: randomUUID(),
        sport: 'rugby',
        rows: [body.rows[2]],
      });
      expect(stale.statusCode, stale.body).toBe(409);

      // Re-importing the same spreadsheet: the new player is an exact match now.
      const again = await preview(draft);
      expect(again.rows[0]).toMatchObject({ action: 'skip' });
      expect(again.rows[0]?.guardians.map((g) => g.outcome)).toEqual(['already_linked', 'invite']);
    });

    it('does not move a player to another category', async () => {
      const seen = await preview({
        sport: 'rugby',
        rows: [row({ firstName: 'Tomás', lastName: 'Gómes', birthDate: '2009-07-20' })],
      });
      const version = seen.rows[0]?.matches[0]?.version;
      const response = await post(adminA, '/v1/roster-imports', {
        clientUuid: randomUUID(),
        sport: 'rugby',
        rows: [
          row({
            firstName: 'Tomás',
            lastName: 'Gómes',
            birthDate: '2009-07-20',
            category: 'M15',
            resolution: { action: 'update', playerId: tomas, version },
          }),
        ],
      });
      expect(response.statusCode).toBe(400);
      expect(errorOf(response).details?.[0]?.message).toContain('transfer');
      // Its own category is fine.
      const same = await post(adminA, '/v1/roster-imports', {
        clientUuid: randomUUID(),
        sport: 'rugby',
        rows: [
          row({
            firstName: 'Tomás',
            lastName: 'Gómes',
            birthDate: '2009-07-20',
            category: 'M17',
            resolution: { action: 'update', playerId: tomas, version },
          }),
        ],
      });
      expect(same.statusCode, same.body).toBe(201);
      expect(m17).not.toBe('');
    });
  });

  describe('the record', () => {
    it('lists and reads the imports of the club only', async () => {
      const list = await t.app.inject({
        url: '/v1/roster-imports?limit=1',
        headers: adminA.headers,
      });
      expect(list.statusCode, list.body).toBe(200);
      const page = list.json<{ items: ImportRecord[]; nextCursor: string | null }>();
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).not.toHaveProperty('rows');
      expect(page.nextCursor).not.toBeNull();
      const id = page.items[0]?.id ?? '';
      const one = await t.app.inject({ url: `/v1/roster-imports/${id}`, headers: adminA.headers });
      expect(one.statusCode).toBe(200);
      expect(one.json<ImportRecord>().rows.length).toBeGreaterThan(0);
      // Nothing personal is stored with the record.
      const stored = await database.admin.query<{ outcomes: unknown }>(
        'select outcomes from roster_import where id = $1',
        [id],
      );
      expect(JSON.stringify(stored.rows[0]?.outcomes)).not.toMatch(/@|Tomás|Gómes/);

      const foreign = await t.app.inject({
        url: `/v1/roster-imports/${id}`,
        headers: adminB.headers,
      });
      expect(foreign.statusCode).toBe(404);
      const listB = await t.app.inject({ url: '/v1/roster-imports', headers: adminB.headers });
      expect(listB.json<{ items: unknown[] }>().items).toEqual([]);
      expect(clubB).not.toBe(clubA);
    });
  });
});
