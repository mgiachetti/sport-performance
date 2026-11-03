import {
  PANEL_MAX_PLAYERS,
  getWeeklyPanel,
  type PanelAlert,
  type PanelPlayer,
  type WeeklyPanel,
} from '@sport-performance/contracts';
import {
  addDays,
  alertMessageKey,
  compareLocalDates,
  parseLocalDate,
  projectPhvOffsetYears,
  startOfIsoWeek,
  type AcwrStatus,
  type AlertRuleKind,
  type AlertSeverity,
  type AlertStatus,
  type AvailabilityStatus,
  type ListScope,
  type LocalDate,
  type MonotonyStatus,
  type PlayerId,
  type Sex,
  type Sport,
  type Stage,
} from '@sport-performance/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { clubToday, type RequestPermissions } from '../http/permissions.js';

/**
 * Weekly panel of the staff (B-403): one aggregated read for a club week of
 * the players the caller sees. It only reads what the worker derived
 * (`player_load_daily`, `player_wellness_daily`, the maturation stored on
 * `anthro_measurement`, the alerts) and the derived availability of
 * `medical.availability` (status only, audited by the function): nothing is
 * recalculated here. The scope is the intersection of the matrix's list
 * scopes for the three kinds of data it shows; row-level security applies
 * the same rule underneath.
 */

/** The kinds the panel shows, each one authorized with its own cell of the matrix. */
const PANEL_KINDS = [
  ['load_metrics', 'read'],
  ['wellness', 'read'],
  ['alert', 'read'],
] as const;

/** Players the scope reaches, as a condition on `p` (the panel's player alias). */
function scopeCondition(scope: Exclude<ListScope, { kind: 'none' }>): SQL {
  if (scope.rowCheck) {
    // None of the panel's cells has a consent or a condition today; a new one needs a row check.
    throw new Error('getWeeklyPanel: the matrix asks for a row check the panel does not do');
  }
  switch (scope.kind) {
    case 'club':
      return sql`true`;
    case 'assigned': {
      // The same rule as the RLS (`app.visible_player_ids`): players currently in a category of
      // the assignments, or in any category of an assigned sport.
      const byCategory =
        scope.categoryIds.length > 0
          ? sql`spc.category_id = any(${sql.param([...scope.categoryIds])}::uuid[])`
          : sql`false`;
      const bySport =
        scope.sports.length > 0
          ? sql`sc.sport::text = any(${sql.param([...scope.sports])}::text[])`
          : sql`false`;
      return sql`exists (
        select 1 from player_category spc
          join category sc on sc.club_id = spc.club_id and sc.id = spc.category_id
         where spc.club_id = p.club_id and spc.player_id = p.id
           and spc.valid_from <= app.club_today()
           and (spc.valid_to is null or spc.valid_to > app.club_today())
           and (${byCategory} or ${bySport}))`;
    }
    case 'players':
      return sql`p.id = any(${sql.param([...scope.playerIds])}::uuid[])`;
    case 'platform':
      // No cell of the panel is platform-wide: deny instead of guessing.
      return sql`false`;
  }
}

async function panelScope(permissions: RequestPermissions): Promise<SQL | null> {
  const conditions: SQL[] = [];
  for (const [kind, action] of PANEL_KINDS) {
    // `listScope` answers 403 when the role's cell is a denial (players, guardians).
    const scope = await permissions.listScope(kind, action);
    if (scope.kind === 'none') return null;
    conditions.push(scopeCondition(scope));
  }
  return sql.join(conditions, sql` and `);
}

interface PlayerRow extends Record<string, unknown> {
  id: PlayerId;
  first_name: string;
  last_name: string;
  sex: Sex;
  sport: Sport;
  birth_date: string;
  category_ids: string[];
  position_id: string | null;
  position_code: string | null;
  position_label: string | null;
  stage: Stage | null;
  measured_on: string | null;
  phv_offset_years: number | null;
  adult_height_pct: number | null;
  growth_velocity_cm_year: number | null;
}

interface WeekLoadRow extends Record<string, unknown> {
  player_id: PlayerId;
  week_from: string;
  load_au: number;
  has_data: boolean;
  chronic_ewma_au: number | null;
  pending_rpe_n: number;
}

interface LatestLoadRow extends Record<string, unknown> {
  player_id: PlayerId;
  local_date: string;
  history_days: number;
  acute_ewma_au: number;
  chronic_ewma_au: number;
  acwr: number | null;
  acwr_status: AcwrStatus;
  monotony: number | null;
  strain_au: number | null;
  monotony_status: MonotonyStatus;
}

interface WellnessRow extends Record<string, unknown> {
  player_id: PlayerId;
  week_entries: number;
  week_mean_score: number | null;
  latest_on: string | null;
  latest_mean_score: number | null;
  latest_z_score: number | null;
  submitted_today: boolean;
}

interface AvailabilityRow extends Record<string, unknown> {
  player_id: PlayerId;
  training: AvailabilityStatus;
  match: AvailabilityStatus;
  overall: AvailabilityStatus;
}

interface AlertRow extends Record<string, unknown> {
  id: string;
  player_id: PlayerId;
  kind: AlertRuleKind;
  current_severity: AlertSeverity;
  status: AlertStatus;
  raised_on: string;
  last_seen_on: string;
  values: Record<string, number>;
}

interface PanelRange {
  readonly today: LocalDate;
  readonly weekFrom: LocalDate;
  readonly weekTo: LocalDate;
  readonly referenceDate: LocalDate;
  readonly historyFrom: LocalDate;
  readonly weekStarts: readonly LocalDate[];
}

function panelRange(today: LocalDate, weekOf: LocalDate | undefined, weeks: number): PanelRange {
  const weekFrom = startOfIsoWeek(weekOf ?? today);
  if (compareLocalDates(weekFrom, today) > 0) {
    throw new HttpError('bad_request', 'The week has not started yet in the club', {
      details: [{ path: ['query', 'weekOf'], code: 'custom', message: 'Future week' }],
    });
  }
  const weekTo = addDays(weekFrom, 6);
  const referenceDate = compareLocalDates(weekTo, today) > 0 ? today : weekTo;
  const weekStarts = Array.from({ length: weeks }, (_, index) =>
    addDays(weekFrom, -7 * (weeks - 1 - index)),
  );
  return {
    today,
    weekFrom,
    weekTo,
    referenceDate,
    historyFrom: weekStarts[0] ?? weekFrom,
    weekStarts,
  };
}

const date = (value: LocalDate) => sql`${value}::date`;

async function readPlayers(
  db: TenantDatabase,
  inScope: SQL,
  range: PanelRange,
  filters: { sport: Sport | undefined; categoryId: string | undefined },
): Promise<PlayerRow[]> {
  const ref = date(range.referenceDate);
  const { rows } = await db.execute<PlayerRow>(sql`
    select p.id, p.first_name, p.last_name, p.sex, p.sport, p.birth_date::text as birth_date,
           cats.category_ids,
           pos.id as position_id, pos.code as position_code, pos.label as position_label,
           st.stage, mat.measured_on, mat.phv_offset_years, mat.adult_height_pct,
           mat.growth_velocity_cm_year
      from player p
      cross join lateral (
        select coalesce(array_agg(pc.category_id::text order by pc.valid_from, pc.category_id), '{}')
                 as category_ids
          from player_category pc
         where pc.club_id = p.club_id and pc.player_id = p.id
           and pc.valid_from <= app.club_today()
           and (pc.valid_to is null or pc.valid_to > app.club_today())
      ) cats
      left join lateral (
        select po.id, po.code, po.label
          from player_position pp
          join position po on po.club_id = pp.club_id and po.id = pp.position_id
         where pp.club_id = p.club_id and pp.player_id = p.id
         order by pp.sort_order
         limit 1
      ) pos on true
      left join lateral (
        select s.stage from player_stage s
         where s.club_id = p.club_id and s.player_id = p.id
           and s.valid_from <= ${ref} and (s.valid_to is null or s.valid_to > ${ref})
         order by s.valid_from desc, s.created_at desc
         limit 1
      ) st on true
      left join lateral (
        select a.measured_on::text as measured_on, a.phv_offset_years, a.adult_height_pct,
               a.growth_velocity_cm_year
          from anthro_measurement a
         where a.club_id = p.club_id and a.player_id = p.id and a.measured_on <= ${ref}
           and (a.phv_offset_years is not null or a.adult_height_pct is not null)
         order by a.measured_on desc, a.created_at desc
         limit 1
      ) mat on true
     where p.club_id = app.current_club_id()
       and p.archived_at is null
       and cardinality(cats.category_ids) > 0
       and ${inScope}
       ${filters.sport === undefined ? sql`` : sql`and p.sport::text = ${filters.sport}`}
       ${
         filters.categoryId === undefined
           ? sql``
           : sql`and ${filters.categoryId}::text = any(cats.category_ids)`
       }
     order by p.last_name, p.first_name, p.id
     limit ${PANEL_MAX_PLAYERS + 1}`);
  return rows;
}

async function readWeekLoads(
  db: TenantDatabase,
  ids: readonly PlayerId[],
  range: PanelRange,
): Promise<WeekLoadRow[]> {
  // `date_trunc('week', …)` starts weeks on Monday, like the ISO week of the panel.
  const { rows } = await db.execute<WeekLoadRow>(sql`
    select d.player_id, date_trunc('week', d.local_date)::date::text as week_from,
           sum(d.load_au)::float8 as load_au, bool_or(d.has_data) as has_data,
           (array_agg(d.chronic_ewma_au order by d.local_date desc))[1] as chronic_ewma_au,
           sum(d.pending_rpe_n)::int as pending_rpe_n
      from player_load_daily d
     where d.club_id = app.current_club_id()
       and d.player_id = any(${sql.param([...ids])}::uuid[])
       and d.local_date between ${date(range.historyFrom)} and ${date(range.referenceDate)}
     group by d.player_id, date_trunc('week', d.local_date)`);
  return rows;
}

async function readLatestLoads(
  db: TenantDatabase,
  ids: readonly PlayerId[],
  range: PanelRange,
): Promise<LatestLoadRow[]> {
  const { rows } = await db.execute<LatestLoadRow>(sql`
    select distinct on (d.player_id)
           d.player_id, d.local_date::text as local_date, d.history_days, d.acute_ewma_au,
           d.chronic_ewma_au, d.acwr, d.acwr_status, d.monotony, d.strain_au, d.monotony_status
      from player_load_daily d
     where d.club_id = app.current_club_id()
       and d.player_id = any(${sql.param([...ids])}::uuid[])
       and d.local_date <= ${date(range.referenceDate)}
     order by d.player_id, d.local_date desc`);
  return rows;
}

async function readWellness(
  db: TenantDatabase,
  ids: readonly PlayerId[],
  range: PanelRange,
): Promise<WellnessRow[]> {
  const { rows } = await db.execute<WellnessRow>(sql`
    select pid as player_id,
           coalesce(wk.entries, 0)::int as week_entries, wk.mean_score as week_mean_score,
           last.local_date as latest_on, last.mean_score as latest_mean_score,
           last.z_score as latest_z_score,
           exists (select 1 from player_wellness_daily t
                    where t.club_id = app.current_club_id() and t.player_id = pid
                      and t.local_date = ${date(range.today)}) as submitted_today
      from unnest(${sql.param([...ids])}::uuid[]) as u(pid)
      left join lateral (
        select count(*) as entries, avg(w.mean_score)::float8 as mean_score
          from player_wellness_daily w
         where w.club_id = app.current_club_id() and w.player_id = pid
           and w.local_date between ${date(range.weekFrom)} and ${date(range.referenceDate)}
      ) wk on true
      left join lateral (
        select w.local_date::text as local_date, w.mean_score, w.z_score
          from player_wellness_daily w
         where w.club_id = app.current_club_id() and w.player_id = pid
           and w.local_date <= ${date(range.referenceDate)}
         order by w.local_date desc
         limit 1
      ) last on true`);
  return rows;
}

async function readAvailability(
  db: TenantDatabase,
  ids: readonly PlayerId[],
  range: PanelRange,
): Promise<AvailabilityRow[]> {
  // Status only: the staff notes and the cause stay in the medical schema (ADR 0029).
  const { rows } = await db.execute<AvailabilityRow>(sql`
    select a.player_id, a.training::text as training, a.match::text as match,
           a.overall::text as overall
      from medical.availability(${sql.param([...ids])}::uuid[], ${date(range.referenceDate)}) a`);
  return rows;
}

async function readActiveAlerts(
  db: TenantDatabase,
  ids: readonly PlayerId[],
  range: PanelRange,
): Promise<AlertRow[]> {
  const ref = date(range.referenceDate);
  const { rows } = await db.execute<AlertRow>(sql`
    select a.id, a.player_id, a.kind, a.current_severity, a.status,
           a.local_date::text as raised_on, a.last_seen_on::text as last_seen_on, a.values
      from alert a
     where a.club_id = app.current_club_id()
       and a.player_id = any(${sql.param([...ids])}::uuid[])
       and a.local_date <= ${ref}
       and (a.resolved_on is null or a.resolved_on > ${ref})
     order by a.player_id, (a.current_severity = 'critical') desc, a.local_date desc, a.id`);
  return rows;
}

function groupBy<T extends { player_id: PlayerId }>(rows: readonly T[]): Map<PlayerId, T[]> {
  const map = new Map<PlayerId, T[]>();
  for (const row of rows) {
    const list = map.get(row.player_id);
    if (list === undefined) map.set(row.player_id, [row]);
    else list.push(row);
  }
  return map;
}

function alertDto(row: AlertRow): PanelAlert {
  return {
    id: row.id as PanelAlert['id'],
    kind: row.kind,
    severity: row.current_severity,
    status: row.status,
    raisedOn: parseLocalDate(row.raised_on),
    lastSeenOn: parseLocalDate(row.last_seen_on),
    messageKey: alertMessageKey(row.kind),
    values: { ...row.values },
  };
}

const DAYS_PER_WEEK = 7;

function playerDto(
  row: PlayerRow,
  range: PanelRange,
  data: {
    weeks: readonly WeekLoadRow[];
    latest: LatestLoadRow | undefined;
    wellness: WellnessRow | undefined;
    availability: AvailabilityRow | undefined;
    alerts: readonly AlertRow[];
  },
): PanelPlayer {
  const byWeek = new Map(data.weeks.map((w) => [w.week_from, w]));
  const weeks = range.weekStarts.map((from) => {
    const week = byWeek.get(from);
    return {
      loadAu: week?.load_au ?? 0,
      hasData: week?.has_data ?? false,
      chronicWeeklyAu:
        week?.chronic_ewma_au === null || week?.chronic_ewma_au === undefined
          ? null
          : week.chronic_ewma_au * DAYS_PER_WEEK,
    };
  });
  const current = byWeek.get(range.weekFrom);
  const { latest, wellness, availability } = data;
  const measuredOn = row.measured_on === null ? null : parseLocalDate(row.measured_on);
  return {
    playerId: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    sex: row.sex,
    sport: row.sport,
    birthDate: parseLocalDate(row.birth_date),
    categoryIds: row.category_ids as PanelPlayer['categoryIds'],
    position:
      row.position_id === null || row.position_code === null
        ? null
        : {
            id: row.position_id as NonNullable<PanelPlayer['position']>['id'],
            code: row.position_code,
            label: row.position_label,
          },
    stage: row.stage,
    maturity:
      measuredOn === null
        ? null
        : {
            measuredOn,
            phvOffsetYears: row.phv_offset_years,
            phvOffsetYearsOnDate:
              row.phv_offset_years === null
                ? null
                : projectPhvOffsetYears(
                    { phvOffsetYears: row.phv_offset_years, measuredOn },
                    range.referenceDate,
                  ),
            adultHeightPct: row.adult_height_pct,
            growthVelocityCmYear: row.growth_velocity_cm_year,
          },
    wellness: {
      submittedToday: wellness?.submitted_today ?? false,
      weekEntries: wellness?.week_entries ?? 0,
      weekMeanScore: wellness?.week_mean_score ?? null,
      latestOn:
        wellness === undefined || wellness.latest_on === null
          ? null
          : parseLocalDate(wellness.latest_on),
      latestMeanScore: wellness?.latest_mean_score ?? null,
      latestZScore: wellness?.latest_z_score ?? null,
    },
    load: {
      weekLoadAu: current?.load_au ?? 0,
      pendingRpeN: current?.pending_rpe_n ?? 0,
      asOf: latest === undefined ? null : parseLocalDate(latest.local_date),
      historyDays: latest?.history_days ?? 0,
      acwr: latest?.acwr ?? null,
      acwrStatus: latest?.acwr_status ?? 'insufficient_history',
      acuteEwmaAu: latest?.acute_ewma_au ?? null,
      chronicEwmaAu: latest?.chronic_ewma_au ?? null,
      monotony: latest?.monotony ?? null,
      strainAu: latest?.strain_au ?? null,
      monotonyStatus: latest?.monotony_status ?? 'insufficient_history',
      weeks,
    },
    availability:
      availability === undefined
        ? null
        : {
            training: availability.training,
            match: availability.match,
            overall: availability.overall,
          },
    alerts: data.alerts.map(alertDto),
  };
}

export function registerPanelRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getWeeklyPanel, {
    transaction: true,
    handler: async ({ query }, { db, permissions }): Promise<WeeklyPanel> => {
      const inScope = await panelScope(permissions);
      const range = panelRange(await clubToday(db), query.weekOf, query.weeks);
      const base: WeeklyPanel = {
        today: range.today,
        week: { from: range.weekFrom, to: range.weekTo },
        referenceDate: range.referenceDate,
        weeks: range.weekStarts.map((from) => ({ from, to: addDays(from, 6) })),
        players: [],
      };
      if (inScope === null) return base;

      const players = await readPlayers(db, inScope, range, {
        sport: query.sport,
        categoryId: query.categoryId,
      });
      if (players.length > PANEL_MAX_PLAYERS) {
        throw new HttpError(
          'bad_request',
          `More than ${String(PANEL_MAX_PLAYERS)} players: narrow the panel by sport or category`,
        );
      }
      if (players.length === 0) return base;

      const ids = players.map((p) => p.id);
      const [weekLoads, latestLoads, wellness, availability, alerts] = [
        groupBy(await readWeekLoads(db, ids, range)),
        new Map((await readLatestLoads(db, ids, range)).map((r) => [r.player_id, r])),
        new Map((await readWellness(db, ids, range)).map((r) => [r.player_id, r])),
        new Map((await readAvailability(db, ids, range)).map((r) => [r.player_id, r])),
        groupBy(await readActiveAlerts(db, ids, range)),
      ];
      return {
        ...base,
        players: players.map((row) =>
          playerDto(row, range, {
            weeks: weekLoads.get(row.id) ?? [],
            latest: latestLoads.get(row.id),
            wellness: wellness.get(row.id),
            availability: availability.get(row.id),
            alerts: alerts.get(row.id) ?? [],
          }),
        ),
      };
    },
  });
}
