import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { user } from './schema/index.js';
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
 * The pod fleet in the database (B-912, ADR 0106): the global registry of
 * devices (superadmin only), the club's pods (read by the staff that assigns
 * them, written by S&C and the administration), loans between clubs (only
 * through `app.lend_pod` / `app.end_pod_loan`) and assignments (no overlap
 * per pod nor per player, the `data` and `location` consents to create one,
 * never the guardian nor the medical staff, change history with a reason).
 */

interface PgFailure {
  code?: string;
  constraint?: string;
  cause?: { code?: string; constraint?: string };
}

async function failure(
  promise: Promise<unknown>,
): Promise<{ code?: string | undefined; constraint?: string | undefined }> {
  try {
    await promise;
  } catch (error) {
    const e = error as PgFailure;
    return { code: e.code ?? e.cause?.code, constraint: e.constraint ?? e.cause?.constraint };
  }
  return { code: 'no error' };
}

describe.skipIf(!hasDatabase)('pod fleet (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;
  let b: ClubFixture;
  let superadminId: string;
  let serial = 0;

  const as = (who: FixtureUser, club: ClubFixture = a): TestContext => ({
    clubId: club.clubId,
    userId: club.users[who],
    role: who === 'coachM17' ? 'coach' : who,
  });
  const run = <T>(context: TestContext, work: (client: pg.PoolClient) => Promise<T>) =>
    inContext(app.pool, context, work);
  const count = (context: TestContext, sql: string, params: unknown[] = []) =>
    run(context, async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `select count(*)::int as n ${sql}`,
        params,
      );
      return must(rows[0]).n;
    });

  /** A device owned by `club` (as the owner) and its pod in the club, with a free number. */
  async function newPod(club: ClubFixture): Promise<{ deviceId: string; podId: string }> {
    serial += 1;
    const n = 100 + serial;
    const { rows: devices } = await t.pool.query<{ id: string }>(
      `insert into pod_device (serial_number, chip_id, hardware_revision, provisioning_state, owner_club_id)
       values ($1, $2, 'v0', 'provisioned', $3) returning id`,
      [`T-${String(n)}`, n.toString(16).padStart(16, '0'), club.clubId],
    );
    const deviceId = must(devices[0]).id;
    const { rows } = await t.pool.query<{ id: string }>(
      `insert into pod (club_id, device_id, short_id, number) values ($1, $2, $3, $4) returning id`,
      [club.clubId, deviceId, n, n],
    );
    return { deviceId, podId: must(rows[0]).id };
  }

  /** A granted location consent of the fixture's assigned player (current text, as the owner). */
  async function grantLocation(club: ClubFixture): Promise<void> {
    const { rows } = await t.pool.query<{ id: string }>(
      `insert into consent_document (club_id, type, version, locale, title, body, published_at)
       values ($1, 'location', '2026-11', 'es-AR', 'Ubicación', 'Texto', now() - interval '1 day')
       returning id`,
      [club.clubId],
    );
    await t.pool.query(
      `insert into consent (club_id, player_id, type, document_id, document_version, signer_kind,
                            signed_by, signed_at)
       values ($1, $2, 'location', $3, '2026-11', 'guardian', $4, now() - interval '1 hour')`,
      [club.clubId, club.players.assigned, must(rows[0]).id, club.users.parent],
    );
  }

  const insertAssignment = (
    context: TestContext,
    values: { podId: string; playerId: string; startsAt: string; endsAt: string | null },
  ) =>
    run(context, (client) =>
      client.query(
        `insert into pod_assignment (club_id, pod_id, player_id, starts_at, ends_at, created_by)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          context.clubId,
          values.podId,
          values.playerId,
          values.startsAt,
          values.endsAt,
          context.userId,
        ],
      ),
    );

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'pods-a');
    b = await seedClubFixture(t.db, 'pods-b');
    await grantLocation(a);
    superadminId = must(
      (
        await t.db
          .insert(user)
          .values({ name: 'Soporte', email: 'soporte-pods@example.com', isSuperadmin: true })
          .returning({ id: user.id })
      )[0],
    ).id;
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  describe('pod_device (global registry)', () => {
    it('only a superadmin on the registry reads and registers devices', async () => {
      const registry = { userId: superadminId, supportReason: 'Registro de pods' };
      expect(await count(registry, 'from pod_device')).toBeGreaterThanOrEqual(4);
      await run(registry, (client) =>
        client.query(
          `insert into pod_device (serial_number, chip_id, hardware_revision) values ('REG-0001', 'ffffffffffffff01', 'v1')`,
        ),
      );
      for (const who of ['admin', 'sc', 'coach', 'player', 'parent', 'medical'] as const) {
        expect(await count(as(who), 'from pod_device'), who).toBe(0);
        expect(
          (
            await failure(
              run(as(who), (client) =>
                client.query(
                  `insert into pod_device (serial_number, chip_id, hardware_revision) values ($1, $2, 'v1')`,
                  [`X-${who.toUpperCase()}-1`, randomUUID().replaceAll('-', '').slice(0, 16)],
                ),
              ),
            )
          ).code,
          who,
        ).toBe('42501');
      }
      // A superadmin acting in a club (support access) does not reach the registry either.
      expect(
        await count(
          { ...as('admin'), role: 'superadmin', userId: superadminId, supportReason: 'Soporte' },
          'from pod_device',
        ),
      ).toBe(0);
      // The worker never reads it.
      expect(
        (
          await failure(
            inContext(worker.pool, { clubId: a.clubId }, (c) =>
              c.query('select 1 from pod_device'),
            ),
          )
        ).code,
      ).toBe('42501');
    });

    it('serial number and chip id are unique and never change', async () => {
      const registry = { userId: superadminId, supportReason: 'Registro de pods' };
      const [first] = (
        await t.pool.query<{ serial_number: string; chip_id: string }>(
          'select serial_number, chip_id from pod_device where owner_club_id = $1 limit 1',
          [a.clubId],
        )
      ).rows;
      const dup = await failure(
        run(registry, (client) =>
          client.query(
            `insert into pod_device (serial_number, chip_id, hardware_revision) values ($1, 'eeeeeeeeeeeeee01', 'v1')`,
            [must(first).serial_number],
          ),
        ),
      );
      expect(dup).toEqual({ code: '23505', constraint: 'pod_device_serial_number_key' });
      expect(
        (
          await failure(
            run(registry, (client) =>
              client.query(`update pod_device set serial_number = 'NEW-0001' where chip_id = $1`, [
                must(first).chip_id,
              ]),
            ),
          )
        ).code,
      ).toBe('42501');
    });

    it('a club reads its own devices through app.club_pod_devices', async () => {
      const devices = (who: FixtureUser, club: ClubFixture = a) =>
        run(as(who, club), async (client) => {
          const { rows } = await client.query<{ serial_number: string; owned: boolean }>(
            'select serial_number, owned from app.club_pod_devices()',
          );
          return rows;
        });
      const own = await devices('admin');
      expect(own.length).toBeGreaterThanOrEqual(2);
      expect(own.every((d) => d.owned)).toBe(true);
      const ofB = await devices('admin', b);
      expect(ofB.some((d) => own.map((o) => o.serial_number).includes(d.serial_number))).toBe(
        false,
      );
      expect(await devices('coach')).toHaveLength(own.length);
      expect(await devices('player')).toEqual([]);
      expect(await devices('parent')).toEqual([]);
      expect(await devices('medical')).toEqual([]);
    });
  });

  describe('pod', () => {
    it('the staff that assigns reads the fleet; S&C and the administration write it', async () => {
      for (const who of ['admin', 'sc', 'coach', 'coachM17'] as const) {
        expect(await count(as(who), 'from pod where id = $1', [a.rows.pod]), who).toBe(1);
      }
      for (const who of ['player', 'parent', 'medical'] as const) {
        expect(await count(as(who), 'from pod'), who).toBe(0);
      }
      for (const who of ['admin', 'sc'] as const) {
        await run(as(who), (client) =>
          client.query(`update pod set label = $2 where id = $1`, [a.rows.pod, `Pod ${who}`]),
        );
      }
      const coachUpdate = await run(as('coach'), (client) =>
        client.query(`update pod set label = 'x' where id = $1`, [a.rows.pod]),
      );
      expect(coachUpdate.rowCount).toBe(0);
    });

    it('needs a device the club owns', async () => {
      const ofB = must(
        (
          await t.pool.query<{ id: string }>(
            'select id from pod_device where owner_club_id = $1 limit 1',
            [b.clubId],
          )
        ).rows[0],
      ).id;
      const stolen = await failure(
        run(as('admin'), (client) =>
          client.query(
            `insert into pod (club_id, device_id, short_id, number) values ($1, $2, 900, 900)`,
            [a.clubId, ofB],
          ),
        ),
      );
      expect(stolen).toEqual({ code: '23514', constraint: 'pod_device_owner' });
    });

    it('keeps number and short id unique among the pods that are not retired', async () => {
      const { podId } = await newPod(a);
      const taken = await failure(
        run(as('sc'), (client) => client.query(`update pod set number = 1 where id = $1`, [podId])),
      );
      expect(taken).toEqual({ code: '23505', constraint: 'pod_number_live_key' });
    });

    it('never changes its device', async () => {
      const code = (
        await failure(
          run(as('admin'), (client) =>
            client.query(`update pod set device_id = device_id where id = $1`, [a.rows.pod]),
          ),
        )
      ).code;
      expect(code).toBe('42501');
    });

    it('renumbering says why; a status change does not', async () => {
      const { podId } = await newPod(a);
      await run(as('sc'), (client) =>
        client.query(`update pod set status = 'lost', keys_revoked_at = now() where id = $1`, [
          podId,
        ]),
      );
      const noReason = await failure(
        run(as('sc'), (client) =>
          client.query(`update pod set number = 880 where id = $1`, [podId]),
        ),
      );
      expect(noReason.constraint).toBe('change_history_reason_required');
      await run(as('sc'), async (client) => {
        await client.query(`select set_config('app.change_reason', 'chaleco nuevo', true)`);
        await client.query(`update pod set number = 880 where id = $1`, [podId]);
      });
      const { rows } = await t.pool.query<{ reason: string | null }>(
        `select reason from change_history where table_name = 'pod' and record_id = $1 order by seq`,
        [podId],
      );
      expect(rows.map((r) => r.reason)).toEqual([null, 'chaleco nuevo']);
    });
  });

  describe('pod_assignment', () => {
    it('the player reads their own; the assigned staff and the administration theirs; never the guardian nor the medical staff', async () => {
      const id = a.rows.pod_assignment;
      for (const who of ['admin', 'sc', 'coach', 'player'] as const) {
        expect(await count(as(who), 'from pod_assignment where id = $1', [id]), who).toBe(1);
      }
      for (const who of ['coachM17', 'parent', 'medical'] as const) {
        expect(await count(as(who), 'from pod_assignment'), who).toBe(0);
      }
    });

    it('needs the data and location consents to create one', async () => {
      const { podId } = await newPod(b);
      const noLocation = await failure(
        insertAssignment(as('admin', b), {
          podId,
          playerId: b.players.assigned,
          startsAt: '2026-11-01T15:00:00Z',
          endsAt: '2026-11-01T17:00:00Z',
        }),
      );
      expect(noLocation.code).toBe('42501');
      const { podId: other } = await newPod(a);
      await insertAssignment(as('coach'), {
        podId: other,
        playerId: a.players.assigned,
        startsAt: '2026-11-01T15:00:00Z',
        endsAt: '2026-11-01T17:00:00Z',
      });
    });

    it('the player, the guardian and the medical staff never assign', async () => {
      const { podId } = await newPod(a);
      for (const who of ['player', 'parent', 'medical'] as const) {
        const result = await failure(
          insertAssignment(as(who), {
            podId,
            playerId: a.players.assigned,
            startsAt: '2026-11-02T15:00:00Z',
            endsAt: '2026-11-02T17:00:00Z',
          }),
        );
        expect(result.code, who).toBe('42501');
      }
    });

    it('rejects overlaps per pod and per player, but not back-to-back nor voided ones', async () => {
      const { podId } = await newPod(a);
      const { podId: second } = await newPod(a);
      const first = await insertAssignment(as('sc'), {
        podId,
        playerId: a.players.assigned,
        startsAt: '2026-11-03T15:00:00Z',
        endsAt: '2026-11-03T17:00:00Z',
      });
      const firstId = must(first.rows[0] as { id: string }).id;
      const samePlayer = await failure(
        insertAssignment(as('sc'), {
          podId: second,
          playerId: a.players.assigned,
          startsAt: '2026-11-03T16:00:00Z',
          endsAt: null,
        }),
      );
      expect(samePlayer).toEqual({ code: '23P01', constraint: 'pod_assignment_player_no_overlap' });
      // Back to back: [15, 17) and [17, …) share no instant.
      await insertAssignment(as('sc'), {
        podId: second,
        playerId: a.players.assigned,
        startsAt: '2026-11-03T17:00:00Z',
        endsAt: '2026-11-03T18:00:00Z',
      });
      // The other player (M17) is visible to S&C (whole sport): the same pod at once is refused.
      await grantLocationOther();
      const samePod = await failure(
        insertAssignment(as('sc'), {
          podId,
          playerId: a.players.other,
          startsAt: '2026-11-03T16:30:00Z',
          endsAt: '2026-11-03T16:45:00Z',
        }),
      );
      expect(samePod).toEqual({ code: '23P01', constraint: 'pod_assignment_pod_no_overlap' });
      // Voided, it is out of the check.
      await run(as('sc'), (client) =>
        client.query(`update pod_assignment set archived_at = now() where id = $1`, [firstId]),
      );
      await insertAssignment(as('sc'), {
        podId,
        playerId: a.players.other,
        startsAt: '2026-11-03T16:30:00Z',
        endsAt: '2026-11-03T16:45:00Z',
      });
    });

    it('ending fills ends_at freely; correcting the range says why; the pod and the player never change', async () => {
      const { podId } = await newPod(a);
      const created = await insertAssignment(as('coach'), {
        podId,
        playerId: a.players.assigned,
        startsAt: '2026-11-04T15:00:00Z',
        endsAt: null,
      });
      const id = must(created.rows[0] as { id: string }).id;
      await run(as('coach'), (client) =>
        client.query(`update pod_assignment set ends_at = '2026-11-04T17:00:00Z' where id = $1`, [
          id,
        ]),
      );
      const noReason = await failure(
        run(as('coach'), (client) =>
          client.query(`update pod_assignment set ends_at = '2026-11-04T16:30:00Z' where id = $1`, [
            id,
          ]),
        ),
      );
      expect(noReason.constraint).toBe('change_history_reason_required');
      await run(as('coach'), async (client) => {
        await client.query(`select set_config('app.change_reason', 'se cambió de chaleco', true)`);
        await client.query(
          `update pod_assignment set ends_at = '2026-11-04T16:30:00Z', reprocess_requested_at = now() where id = $1`,
          [id],
        );
      });
      for (const column of ['pod_id', 'player_id']) {
        const code = (
          await failure(
            run(as('admin'), (client) =>
              client.query(`update pod_assignment set ${column} = ${column} where id = $1`, [id]),
            ),
          )
        ).code;
        expect(code, column).toBe('42501');
      }
      // The history is the staff's: the coach reads it, the medical staff never.
      const history = `from change_history where table_name = 'pod_assignment' and record_id = $1`;
      expect(await count(as('coach'), history, [id])).toBe(2);
      expect(await count(as('medical'), history, [id])).toBe(0);
    });

    it('is logged for the offline sync under its player', async () => {
      const { rows } = await t.pool.query<{ n: number }>(
        `select count(*)::int as n from sync_change
          where club_id = $1 and collection::text = 'pod_assignment' and player_id = $2`,
        [a.clubId, a.players.assigned],
      );
      expect(must(rows[0]).n).toBeGreaterThanOrEqual(1);
    });
  });

  async function grantLocationOther(): Promise<void> {
    const { rows } = await t.pool.query<{ id: string }>(
      `select id from consent_document where club_id = $1 and type = 'location' limit 1`,
      [a.clubId],
    );
    await t.pool.query(
      `insert into consent (club_id, player_id, type, document_id, document_version, signer_kind,
                            signed_by, signed_at)
       values ($1, $2, 'data', null, '2026-01', 'guardian', $3, now() - interval '1 hour'),
              ($1, $2, 'location', $4, '2026-11', 'guardian', $3, now() - interval '1 hour')`,
      [a.clubId, a.players.other, a.users.parent, must(rows[0]).id],
    );
  }

  describe('loans', () => {
    it('lend and end: two clubs, the next key epoch, only S&C and the administration', async () => {
      const { podId } = await newPod(a);
      for (const who of ['coach', 'player', 'medical'] as const) {
        const result = await failure(
          run(as(who), (client) =>
            client.query('select app.lend_pod($1, $2, null, $3)', [podId, b.slug, randomUUID()]),
          ),
        );
        expect(result.code, who).toBe('42501');
      }
      const clientUuid = randomUUID();
      const lend = () =>
        run(as('sc'), async (client) => {
          const { rows } = await client.query<{ id: string }>(
            'select app.lend_pod($1, $2, null, $3) as id',
            [podId, b.slug, clientUuid],
          );
          return must(rows[0]).id;
        });
      const loanId = await lend();
      expect(await lend()).toBe(loanId);
      const lender = await t.pool.query<{ status: string }>(
        'select status from pod where id = $1',
        [podId],
      );
      expect(must(lender.rows[0]).status).toBe('lent');
      // The receiving club sees its pod for the loan, never the loan itself.
      const borrowed = await run(as('admin', b), async (client) => {
        const { rows } = await client.query<{
          id: string;
          status: string;
          borrowed_from_club_id: string;
        }>('select id, status, borrowed_from_club_id from pod where loan_id = $1', [loanId]);
        return rows;
      });
      expect(borrowed).toHaveLength(1);
      expect(must(borrowed[0]).borrowed_from_club_id).toBe(a.clubId);
      expect(await count(as('admin', b), 'from pod_loan where id = $1', [loanId])).toBe(0);
      expect(await count(as('sc'), 'from pod_loan where id = $1', [loanId])).toBe(1);
      expect(await count(as('coach'), 'from pod_loan')).toBe(0);
      // A lent pod is not lent again; the receiving club cannot lend it on.
      expect(
        (
          await failure(
            run(as('sc'), (client) =>
              client.query('select app.lend_pod($1, $2, null, $3)', [podId, b.slug, randomUUID()]),
            ),
          )
        ).constraint,
      ).toBe('pod_loan_pod_unavailable');
      // The application never writes a loan directly.
      expect(
        (
          await failure(
            run(as('admin'), (client) =>
              client.query('update pod_loan set ended_at = now() where id = $1', [loanId]),
            ),
          )
        ).code,
      ).toBe('42501');

      await run(as('admin'), (client) => client.query('select app.end_pod_loan($1)', [loanId]));
      await run(as('admin'), (client) => client.query('select app.end_pod_loan($1)', [loanId]));
      const after = await t.pool.query<{ status: string; key_epoch: number }>(
        'select status, key_epoch from pod where id = $1',
        [podId],
      );
      expect(must(after.rows[0])).toEqual({ status: 'active', key_epoch: 1 });
      const back = await t.pool.query<{ status: string }>('select status from pod where id = $1', [
        must(borrowed[0]).id,
      ]);
      expect(must(back.rows[0]).status).toBe('retired');
      // Another club's loan is not found.
      expect(
        (
          await failure(
            run(as('admin', b), (client) => client.query('select app.end_pod_loan($1)', [loanId])),
          )
        ).code,
      ).toBe('P0002');
    });
  });
});
