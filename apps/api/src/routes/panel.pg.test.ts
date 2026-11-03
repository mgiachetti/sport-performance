/**
 * Weekly panel end to end (B-403) against Postgres 16, through the real
 * connection roles: the scope of the permission matrix (staff by assignment,
 * the administration the club, players and guardians never), the weekly
 * aggregates of what the worker derived, the maturation projected to the
 * reference day, the availability without the cause and the active alerts.
 */
import { PANEL_MAX_PLAYERS } from '@sport-performance/contracts';
import type { ClubId } from '@sport-performance/domain';
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

interface PanelBody {
  today: string;
  week: { from: string; to: string };
  referenceDate: string;
  weeks: { from: string; to: string }[];
  players: {
    playerId: string;
    lastName: string;
    categoryIds: string[];
    position: { code: string } | null;
    maturity: {
      measuredOn: string;
      phvOffsetYears: number | null;
      phvOffsetYearsOnDate: number | null;
    } | null;
    wellness: {
      weekEntries: number;
      weekMeanScore: number | null;
      latestOn: string | null;
      latestZScore: number | null;
      submittedToday: boolean;
    };
    load: {
      weekLoadAu: number;
      pendingRpeN: number;
      asOf: string | null;
      acwr: number | null;
      acwrStatus: string;
      weeks: { loadAu: number; hasData: boolean; chronicWeeklyAu: number | null }[];
    };
    availability: Record<string, unknown> | null;
    alerts: { id: string; kind: string; severity: string; status: string; messageKey: string }[];
  }[];
}

describeWithPostgres('weekly panel (Postgres)', (serverUrl) => {
  let database: TestDatabase;
  let t: IdentityTestApp;
  let adminA: SignedIn;
  let adminB: SignedIn;
  let coachM15: SignedIn;
  let player15: SignedIn;
  let parent15: SignedIn;
  let superadmin: SignedIn;
  let clubA: ClubId;
  let m15: string;
  let p15: string;
  let p17: string;

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
    categoryId: string,
    lastName: string,
  ): Promise<string> {
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into player (club_id, user_id, first_name, last_name, birth_date, sex, sport, joined_on)
       values ($1, $2, 'Juan', $3, '2011-05-04', 'male', 'rugby', '2020-01-01') returning id`,
      [clubId, user?.userId ?? null, lastName],
    );
    const playerId = rows[0]?.id ?? '';
    await database.admin.query(
      `insert into player_category (club_id, player_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, playerId, categoryId],
    );
    return playerId;
  }

  /** One day of the load series, as the worker writes it. */
  async function insertLoadDay(
    clubId: ClubId,
    playerId: string,
    day: string,
    values: {
      loadAu: number;
      historyDays: number;
      chronic: number;
      acwr?: number;
      pending?: number;
    },
  ): Promise<void> {
    await database.admin.query(
      `insert into player_load_daily (club_id, player_id, local_date, load_au, has_data, sessions_n,
                                      pending_rpe_n, history_days, acute_ewma_au, chronic_ewma_au,
                                      acwr, acwr_status, missing_days_acute, missing_days_chronic,
                                      window_load_au, monotony, strain_au, monotony_status)
       values ($1, $2, $3, $4::float8, $4::float8 > 0, case when $4::float8 > 0 then 1 else 0 end,
               $5, $6, $7, $7, $8, $9, 0, 0, $4::float8, null, null, 'insufficient_history')`,
      [
        clubId,
        playerId,
        day,
        values.loadAu,
        values.pending ?? 0,
        values.historyDays,
        values.chronic,
        values.acwr ?? null,
        values.acwr === undefined ? 'insufficient_history' : 'ok',
      ],
    );
  }

  async function insertWellnessDay(
    clubId: ClubId,
    playerId: string,
    day: string,
    meanScore: number,
  ): Promise<void> {
    await database.admin.query(
      `insert into player_wellness_daily (club_id, player_id, local_date, item_count, mean_score,
                                          baseline_samples, z_score)
       values ($1, $2, $3, 5, $4, 7, -0.5)`,
      [clubId, playerId, day, meanScore],
    );
  }

  async function assign(membershipId: string, clubId: ClubId, categoryId: string): Promise<void> {
    await database.admin.query(
      `insert into staff_assignment (club_id, membership_id, category_id, valid_from)
       values ($1, $2, $3, '2020-01-01')`,
      [clubId, membershipId, categoryId],
    );
  }

  function panel(caller: Record<string, string>, query = '?weekOf=2026-09-16&weeks=4') {
    return t.app.inject({ url: `/v1/panel/weekly${query}`, headers: caller });
  }

  async function panelOf(caller: Record<string, string>, query?: string): Promise<PanelBody> {
    const response = await panel(caller, query);
    expect(response.statusCode, response.body).toBe(200);
    return response.json<PanelBody>();
  }

  beforeAll(async () => {
    database = await createTestDatabase(serverUrl);
    t = await startIdentityApp(database, {
      routeClassLimits: {
        auth: { perIp: { name: 'api_auth_ip', max: 1000, windowS: 60 } },
      },
    });
    adminA = await signIn(t, 'admin@club-a.example.com');
    adminB = await signIn(t, 'admin@club-b.example.com');
    coachM15 = await signIn(t, 'coach15@club-a.example.com');
    player15 = await signIn(t, 'player15@club-a.example.com');
    parent15 = await signIn(t, 'parent15@club-a.example.com');
    superadmin = await signIn(t, 'soporte@plataforma.example.com');
    await database.admin.query('update "user" set is_superadmin = true where id = $1', [
      superadmin.userId,
    ]);

    clubA = await createClub(database.admin, 'club-a');
    const clubB = await createClub(database.admin, 'club-b');
    m15 = await insertCategory(clubA, 'm15', 'development');
    const m17 = await insertCategory(clubA, 'm17', 'performance');
    p15 = await insertPlayer(clubA, player15, m15, 'Bianchi');
    p17 = await insertPlayer(clubA, null, m17, 'Aguirre');
    const mB = await insertCategory(clubB, 'm15', 'development');
    await insertPlayer(clubB, null, mB, 'Otro');
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
    await createMembership(database.admin, player15.userId, clubA, 'player');
    await createMembership(database.admin, parent15.userId, clubA, 'parent');

    // p15: load in the weeks of 2026-08-31 and 2026-09-14 (the week asked for), none in between.
    await insertLoadDay(clubA, p15, '2026-09-01', { loadAu: 300, historyDays: 20, chronic: 40 });
    await insertLoadDay(clubA, p15, '2026-09-08', { loadAu: 0, historyDays: 27, chronic: 35 });
    await insertLoadDay(clubA, p15, '2026-09-14', {
      loadAu: 400,
      historyDays: 33,
      chronic: 50,
      acwr: 1.2,
    });
    await insertLoadDay(clubA, p15, '2026-09-16', {
      loadAu: 500,
      historyDays: 35,
      chronic: 60,
      acwr: 1.45,
      pending: 1,
    });
    // After the week: never counted for it.
    await insertLoadDay(clubA, p15, '2026-09-21', { loadAu: 900, historyDays: 40, chronic: 90 });
    // p17: a short history, no ACWR yet.
    await insertLoadDay(clubA, p17, '2026-09-15', { loadAu: 200, historyDays: 3, chronic: 10 });

    await insertWellnessDay(clubA, p15, '2026-09-10', 2);
    await insertWellnessDay(clubA, p15, '2026-09-14', 3);
    await insertWellnessDay(clubA, p15, '2026-09-16', 4);

    await database.admin.query(
      `insert into anthro_measurement (club_id, player_id, measured_on, height_cm, phv_offset_years,
                                       maturity_offset_equation)
       values ($1, $2, '2026-03-20', 170, -0.5, 'moore_2015')`,
      [clubA, p15],
    );
    await database.admin.query(
      `insert into medical.hold (club_id, player_id, training, match, valid_from, staff_note)
       values ($1, $2, 'limited', 'unavailable', '2026-09-01', 'Sin contacto')`,
      [clubA, p15],
    );
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into alert_rule (club_id, code, kind, params)
       values ($1, 'acwr_high', 'acwr_high', '{}') returning id`,
      [clubA],
    );
    const ruleId = rows[0]?.id ?? '';
    // Active on the reference day; one resolved before it and one raised after it are not.
    for (const [playerId, raisedOn, resolvedOn] of [
      [p15, '2026-09-15', null],
      [p15, '2026-09-01', '2026-09-05'],
      [p17, '2026-09-25', null],
    ] as const) {
      await database.admin.query(
        `insert into alert (club_id, alert_rule_id, player_id, kind, severity, current_severity,
                            local_date, last_seen_on, resolved_on, observed_on, values)
         values ($1, $2, $3, 'acwr_high', 'critical', 'critical', $4, $4, $5, $4,
                 '{"acwrRatio": 1.45, "thresholdRatio": 1.4}')`,
        [clubA, ruleId, playerId, raisedOn, resolvedOn],
      );
    }
  });

  afterAll(async () => {
    await t.close();
    await database.drop();
  });

  it('aggregates the week from what the worker derived', async () => {
    const body = await panelOf(adminA.headers);
    expect(body.week).toEqual({ from: '2026-09-14', to: '2026-09-20' });
    expect(body.referenceDate).toBe('2026-09-20');
    expect(body.weeks.map((w) => w.from)).toEqual([
      '2026-08-24',
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
    ]);
    // Alphabetical, never a ranking.
    expect(body.players.map((p) => p.lastName)).toEqual(['Aguirre', 'Bianchi']);
    const bianchi = body.players.find((p) => p.playerId === p15);
    expect(bianchi?.categoryIds).toEqual([m15]);
    expect(bianchi?.load).toMatchObject({
      weekLoadAu: 900,
      pendingRpeN: 1,
      asOf: '2026-09-16',
      acwr: 1.45,
      acwrStatus: 'ok',
    });
    expect(bianchi?.load.weeks).toEqual([
      { loadAu: 0, hasData: false, chronicWeeklyAu: null },
      { loadAu: 300, hasData: true, chronicWeeklyAu: 280 },
      { loadAu: 0, hasData: false, chronicWeeklyAu: 245 },
      { loadAu: 900, hasData: true, chronicWeeklyAu: 420 },
    ]);
    expect(bianchi?.wellness).toMatchObject({
      weekEntries: 2,
      weekMeanScore: 3.5,
      latestOn: '2026-09-16',
      latestZScore: -0.5,
      submittedToday: false,
    });
    // Measured in March, projected to the reference day (half a year later).
    expect(bianchi?.maturity?.phvOffsetYears).toBe(-0.5);
    expect(bianchi?.maturity?.phvOffsetYearsOnDate).toBeCloseTo(-0.5 + 184 / 365.25, 6);
    expect(bianchi?.alerts).toEqual([
      expect.objectContaining({
        kind: 'acwr_high',
        severity: 'critical',
        messageKey: 'alert.acwr_high.message',
      }),
    ]);
    const aguirre = body.players.find((p) => p.playerId === p17);
    expect(aguirre?.load).toMatchObject({ acwr: null, acwrStatus: 'insufficient_history' });
    expect(aguirre?.maturity).toBeNull();
    expect(aguirre?.alerts).toEqual([]);
    expect(aguirre?.wellness).toMatchObject({ weekEntries: 0, latestOn: null });
  });

  it('shows the availability, never the cause nor the staff note', async () => {
    const body = await panelOf(coachM15.headers);
    const [bianchi] = body.players;
    expect(bianchi?.availability).toEqual({
      training: 'limited',
      match: 'unavailable',
      overall: 'unavailable',
    });
    expect(JSON.stringify(body)).not.toContain('Sin contacto');
  });

  it('scopes by the matrix: assignments, the club, never players or guardians', async () => {
    expect((await panelOf(coachM15.headers)).players.map((p) => p.playerId)).toEqual([p15]);
    expect((await panelOf(adminB.headers)).players.map((p) => p.lastName)).toEqual(['Otro']);
    for (const caller of [player15, parent15]) {
      expect((await panel(caller.headers)).statusCode).toBe(403);
    }
    const byCategory = await panelOf(adminA.headers, `?weekOf=2026-09-16&categoryId=${m15}`);
    expect(byCategory.players.map((p) => p.playerId)).toEqual([p15]);
    expect(byCategory.weeks).toHaveLength(12);
    const hockey = await panelOf(adminA.headers, '?weekOf=2026-09-16&sport=hockey');
    expect(hockey.players).toEqual([]);
  });

  it('the superadmin sees it only in support, recorded with a reason', async () => {
    const body = await panelOf({
      ...superadmin.headers,
      'x-support-club-id': clubA,
      'x-support-reason': 'Ticket 66: el panel de la M15',
    });
    expect(body.players.map((p) => p.lastName)).toEqual(['Aguirre', 'Bianchi']);
    expect(body.players.find((p) => p.playerId === p15)?.availability).toMatchObject({
      overall: 'unavailable',
    });
    expect((await panel(superadmin.headers)).statusCode).toBe(403);
  });

  it('refuses a future week and malformed queries', async () => {
    expect((await panel(adminA.headers, '?weekOf=2999-01-04')).statusCode).toBe(400);
    expect((await panel(adminA.headers, '?weeks=2')).statusCode).toBe(400);
    expect((await panel(adminA.headers, '?other=1')).statusCode).toBe(400);
    const current = await panelOf(adminA.headers, '');
    expect(current.week.from <= current.today && current.today <= current.week.to).toBe(true);
    expect(current.referenceDate).toBe(current.today);
  });

  /** An episode of a new rule for a player, written as the worker does (events by trigger). */
  async function insertEpisode(
    clubId: ClubId,
    playerId: string,
    code: string,
    episode: { raisedOn: string; severity: 'warning' | 'critical' },
  ): Promise<string> {
    const rule = await database.admin.query<{ id: string }>(
      `insert into alert_rule (club_id, code, kind, params)
       values ($1, $2, 'wellness_low', '{}') returning id`,
      [clubId, code],
    );
    const { rows } = await database.admin.query<{ id: string }>(
      `insert into alert (club_id, alert_rule_id, player_id, kind, severity, current_severity,
                          local_date, last_seen_on, resolved_on, observed_on, values)
       values ($1, $2, $3, 'wellness_low', $5, $5, $4, $4, null, $4, '{"meanScore": 2.5}')
       returning id`,
      [clubId, rule.rows[0]?.id, playerId, episode.raisedOn, episode.severity],
    );
    return rows[0]?.id ?? '';
  }

  it('leaves dismissed alerts out and shows a past week as it was that day', async () => {
    // Raised in the week as a warning, escalated after it: the past week shows the warning.
    const escalated = await insertEpisode(clubA, p17, 'wellness_escalated', {
      raisedOn: '2026-09-15',
      severity: 'warning',
    });
    await database.admin.query(
      `update alert set severity = 'critical', current_severity = 'critical',
                        last_seen_on = '2026-10-01'
        where id = $1`,
      [escalated],
    );
    // Dismissed today (the review's day is the club's today): still open in the past week.
    const dismissedToday = await insertEpisode(clubA, p17, 'wellness_dismissed_today', {
      raisedOn: '2026-09-16',
      severity: 'critical',
    });
    // Dismissed inside the past week: out of it too.
    const dismissedBefore = await insertEpisode(clubA, p17, 'wellness_dismissed_before', {
      raisedOn: '2026-09-15',
      severity: 'critical',
    });
    for (const id of [dismissedToday, dismissedBefore]) {
      await database.admin.query(
        `update alert set status = 'dismissed', acknowledged_by = $2, acknowledged_at = now(),
                          acknowledgement_note = 'No aplica: semana de pretemporada'
          where id = $1`,
        [id, adminA.userId],
      );
    }
    await database.admin.query(
      `insert into alert_event (club_id, alert_id, player_id, type, local_date, severity, note,
                                actor_id)
       values ($1, $2, $3, 'dismissed', '2026-09-17', 'critical', 'No aplica', $4)`,
      [clubA, dismissedBefore, p17, adminA.userId],
    );

    const past = await panelOf(adminA.headers);
    const aguirre = past.players.find((p) => p.playerId === p17);
    expect(aguirre?.alerts.map(({ id, severity, status }) => ({ id, severity, status }))).toEqual(
      expect.arrayContaining([
        { id: escalated, severity: 'warning', status: 'open' },
        { id: dismissedToday, severity: 'critical', status: 'open' },
      ]),
    );
    expect(aguirre?.alerts).toHaveLength(2);

    // This week: the escalation is current and both dismissals are out.
    const current = await panelOf(adminA.headers, '');
    const now = current.players.find((p) => p.playerId === p17);
    expect(now?.alerts.map(({ id, severity }) => ({ id, severity }))).toEqual(
      expect.arrayContaining([{ id: escalated, severity: 'critical' }]),
    );
    expect(now?.alerts.map((a) => a.id)).not.toContain(dismissedToday);
    expect(now?.alerts.map((a) => a.id)).not.toContain(dismissedBefore);
    expect(now?.alerts.every((a) => a.status !== 'dismissed')).toBe(true);
  });

  it(`refuses more than ${String(PANEL_MAX_PLAYERS)} players and asks to narrow`, async () => {
    const adminC = await signIn(t, 'admin@club-c.example.com');
    const clubC = await createClub(database.admin, 'club-c');
    await createMembership(database.admin, adminC.userId, clubC, 'admin');
    const category = await insertCategory(clubC, 'm19', 'performance');
    const addPlayers = (from: number, to: number) =>
      database.admin.query(
        `with inserted as (
           insert into player (club_id, first_name, last_name, birth_date, sex, sport, joined_on)
           select $1, 'Juan', 'Jugador ' || n, '2008-05-04', 'male', 'rugby', '2020-01-01'
             from generate_series($3::int, $4::int) n
           returning id)
         insert into player_category (club_id, player_id, category_id, valid_from)
         select $1, id, $2, '2020-01-01' from inserted`,
        [clubC, category, from, to],
      );
    // Exactly the limit fits.
    await addPlayers(1, PANEL_MAX_PLAYERS);
    expect((await panelOf(adminC.headers)).players).toHaveLength(PANEL_MAX_PLAYERS);
    // One more is a bad request: the web asks to narrow by sport or category.
    await addPlayers(PANEL_MAX_PLAYERS + 1, PANEL_MAX_PLAYERS + 1);
    const tooMany = await panel(adminC.headers);
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json<{ error: { code: string } }>().error.code).toBe('bad_request');
  });
});
