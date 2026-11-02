import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * Alerts in the database (B-327, ADR 0053): the worker generates episodes,
 * the API only reviews them (column grants and `alert_review_guard`), every
 * change leaves an append-only `alert_event`, and CMJ results, rules,
 * stages and categories mark the player for a new evaluation.
 */

async function pgCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return 'no error';
}

interface EventRow {
  type: string;
  local_date: string;
  severity: string;
  note: string | null;
  actor_id: string | null;
}

describe.skipIf(!hasDatabase)('alerts (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let app: RoleConnection;
  let worker: RoleConnection;
  let a: ClubFixture;

  const as = (
    who: FixtureUser,
    role: string = who === 'coachM17' ? 'coach' : who,
  ): TestContext => ({
    clubId: a.clubId,
    userId: a.users[who],
    role,
  });

  async function events(alertId: string): Promise<EventRow[]> {
    const { rows } = await t.pool.query<EventRow>(
      `select type::text, local_date::text, severity::text, note, actor_id
         from alert_event where alert_id = $1 order by seq`,
      [alertId],
    );
    return rows;
  }

  /** A fresh episode written as the worker. */
  async function raise(values: { rule?: string; day?: string } = {}): Promise<string> {
    return inContext(worker.pool, { clubId: a.clubId }, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into alert (club_id, alert_rule_id, player_id, kind, severity, current_severity,
                            local_date, last_seen_on, observed_on, values)
         values ($1, $2, $3, 'acwr_high', 'warning', 'warning', $4, $4, $4, '{"acwrRatio": 1.35}')
         returning id`,
        [
          a.clubId,
          values.rule ?? must(a.rows.alert_rule),
          a.players.assigned,
          values.day ?? '2026-04-01',
        ],
      );
      return must(rows[0]).id;
    });
  }

  async function resolve(alertId: string, day: string) {
    await inContext(worker.pool, { clubId: a.clubId }, (client) =>
      client.query('update alert set resolved_on = $2 where id = $1', [alertId, day]),
    );
  }

  async function pendingAlerts(playerId: string): Promise<boolean | undefined> {
    const { rows } = await t.pool.query<{ alerts: boolean }>(
      'select alerts from derived_refresh where player_id = $1',
      [playerId],
    );
    return rows[0]?.alerts;
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    a = await seedClubFixture(t.db, 'alerts-a');
    app = await connectAs(t, 'app');
    worker = await connectAs(t, 'worker');
    // The fixture's episode is active; close it so the tests raise their own.
    await resolve(must(a.rows.alert), '2026-03-12');
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await t.close();
  });

  it('the worker raises, escalates and resolves; each change leaves an event', async () => {
    const id = await raise();
    await inContext(worker.pool, { clubId: a.clubId }, (client) =>
      client.query(
        `update alert set severity = 'critical', current_severity = 'critical', last_seen_on = '2026-04-02'
          where id = $1`,
        [id],
      ),
    );
    await resolve(id, '2026-04-03');
    expect(await events(id)).toEqual([
      { type: 'raised', local_date: '2026-04-01', severity: 'warning', note: null, actor_id: null },
      {
        type: 'escalated',
        local_date: '2026-04-02',
        severity: 'critical',
        note: null,
        actor_id: null,
      },
      {
        type: 'resolved',
        local_date: '2026-04-03',
        severity: 'critical',
        note: null,
        actor_id: null,
      },
    ]);
    // Reopened the day it resolved.
    await inContext(worker.pool, { clubId: a.clubId }, (client) =>
      client.query(
        `update alert set resolved_on = null, last_seen_on = '2026-04-03' where id = $1`,
        [id],
      ),
    );
    expect((await events(id)).at(-1)).toMatchObject({ type: 'reopened', local_date: '2026-04-03' });
    await resolve(id, '2026-04-04');
  });

  it('the API never inserts alerts nor changes what the worker computed', async () => {
    const id = await raise({ day: '2026-04-10' });
    expect(
      await pgCode(
        inContext(app.pool, as('admin'), (client) =>
          client.query(
            `insert into alert (club_id, alert_rule_id, player_id, kind, severity, current_severity,
                                local_date, last_seen_on, observed_on)
             values ($1, $2, $3, 'acwr_high', 'warning', 'warning', '2026-04-20', '2026-04-20', '2026-04-20')`,
            [a.clubId, must(a.rows.alert_rule), a.players.assigned],
          ),
        ),
      ),
    ).toBe('42501');
    for (const set of [`severity = 'critical'`, `resolved_on = '2026-04-11'`, `values = '{}'`]) {
      expect(
        await pgCode(
          inContext(app.pool, as('admin'), (client) =>
            client.query(`update alert set ${set} where id = $1`, [id]),
          ),
        ),
        set,
      ).toBe('42501');
    }
    await resolve(id, '2026-04-11');
  });

  it('the staff reviews an open alert once, as itself, and the event keeps the note', async () => {
    const id = await raise({ day: '2026-04-15' });
    // Someone else's name: rejected.
    expect(
      await pgCode(
        inContext(app.pool, as('coach'), (client) =>
          client.query(
            `update alert set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = $2 where id = $1`,
            [id, a.users.admin],
          ),
        ),
      ),
    ).toBe('23514');
    await inContext(app.pool, as('coach'), (client) =>
      client.query(
        `update alert set status = 'acknowledged', acknowledged_at = '2000-01-01', acknowledged_by = $2,
                          acknowledgement_note = 'Bajamos la carga del jueves'
          where id = $1`,
        [id, a.users.coach],
      ),
    );
    const { rows } = await t.pool.query<{ acknowledged_at: Date }>(
      'select acknowledged_at from alert where id = $1',
      [id],
    );
    // The database clock, not the client's.
    expect(must(rows[0]).acknowledged_at.getUTCFullYear()).toBeGreaterThan(2000);
    expect((await events(id)).at(-1)).toMatchObject({
      type: 'acknowledged',
      severity: 'warning',
      note: 'Bajamos la carga del jueves',
      actor_id: a.users.coach,
    });
    // Once.
    expect(
      await pgCode(
        inContext(app.pool, as('admin'), (client) =>
          client.query(
            `update alert set status = 'dismissed', acknowledged_by = $2, acknowledgement_note = 'No aplica'
              where id = $1`,
            [id, a.users.admin],
          ),
        ),
      ),
    ).toBe('23514');
    // A coach outside the player's categories does not see it.
    await inContext(app.pool, as('coachM17'), async (client) => {
      const { rows: visible } = await client.query('select id from alert where id = $1', [id]);
      expect(visible).toEqual([]);
      const { rows: history } = await client.query(
        'select id from alert_event where alert_id = $1',
        [id],
      );
      expect(history).toEqual([]);
    });
    // Players and guardians never see alerts or their history.
    for (const who of ['player', 'parent'] as const) {
      await inContext(app.pool, as(who), async (client) => {
        expect((await client.query('select id from alert')).rows).toEqual([]);
        expect((await client.query('select id from alert_event')).rows).toEqual([]);
        expect((await client.query('select id from player_alert_evaluation')).rows).toEqual([]);
      });
    }
    // An escalation by the worker asks for a new review.
    await inContext(worker.pool, { clubId: a.clubId }, (client) =>
      client.query(
        `update alert set severity = 'critical', current_severity = 'critical', last_seen_on = '2026-04-16',
                          status = 'open', acknowledged_at = null, acknowledged_by = null,
                          acknowledgement_note = null
          where id = $1`,
        [id],
      ),
    );
    expect((await events(id)).map((e) => e.type)).toEqual(['raised', 'acknowledged', 'escalated']);
    await resolve(id, '2026-04-17');
  });

  it('events are append-only, also for the owner', async () => {
    const id = must(a.rows.alert_event);
    expect(
      await pgCode(t.pool.query(`update alert_event set note = 'x' where id = $1`, [id])),
    ).toBe('23514');
    expect(await pgCode(t.pool.query('delete from alert_event where id = $1', [id]))).toBe('23514');
    for (const connection of [app, worker]) {
      expect(
        await pgCode(
          inContext(connection.pool, as('admin'), (client) =>
            client.query(
              `insert into alert_event (club_id, alert_id, player_id, type, local_date, severity)
               values ($1, $2, $3, 'raised', '2026-04-01', 'warning')`,
              [a.clubId, must(a.rows.alert), a.players.assigned],
            ),
          ),
        ),
      ).toBe('42501');
    }
  });

  it('a CMJ, a rule, a stage or a category marks the player for a new evaluation', async () => {
    const player = a.players.assigned;
    const clear = () => t.pool.query('delete from derived_refresh where club_id = $1', [a.clubId]);
    const asSc = <T>(work: (client: pg.PoolClient) => Promise<T>) =>
      inContext(app.pool, as('admin'), work);

    await clear();
    await asSc((client) =>
      client.query(
        `insert into test_result_value (club_id, test_result_id, metric_definition_id, attempt_number, value, unit)
         values ($1, $2, $3, 3, 41, 'cm')`,
        [a.clubId, must(a.rows.test_result), must(a.rows.metric_definition)],
      ),
    );
    expect(await pendingAlerts(player)).toBe(true);

    await clear();
    await asSc((client) =>
      client.query(`update alert_rule set enabled = false where id = $1`, [
        must(a.rows.alert_rule),
      ]),
    );
    expect(await pendingAlerts(player)).toBe(true);
    expect(await pendingAlerts(a.players.other)).toBe(true);

    await clear();
    await asSc((client) =>
      client.query(`update player_stage set valid_to = valid_from + 400 where id = $1`, [
        must(a.rows.player_stage),
      ]),
    );
    expect(await pendingAlerts(player)).toBe(true);

    await clear();
    await t.pool.query(`update player_category set valid_to = valid_from + 500 where id = $1`, [
      must(a.rows.player_category),
    ]);
    expect(await pendingAlerts(player)).toBe(true);
  });
});
