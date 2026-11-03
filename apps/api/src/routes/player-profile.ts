import {
  AVAILABILITY_HISTORY_DEFAULT_DAYS,
  AVAILABILITY_HISTORY_MAX_DAYS,
  CATEGORY_AVERAGE_MIN_PLAYERS,
  DAILY_MONITORING_DEFAULT_DAYS,
  DAILY_MONITORING_MAX_DAYS,
  MATURATION_MEASUREMENTS_MAX,
  PEAK_ZONE_MAX_MEASUREMENT_AGE_DAYS,
  getPlayerAvailability,
  getPlayerDailyMonitoring,
  getPlayerMaturation,
  getPlayerPercentiles,
  getPlayerTestEvolution,
  type AvailabilityPeriod,
  type PlayerPeakZone,
  type PlayerPercentile,
  type TestEvolutionColumn,
  type TestEvolutionMetric,
} from '@sport-performance/contracts';
import {
  anthroMeasurement,
  category,
  derivedRefresh,
  metricDefinition,
  player,
  playerCategory,
  playerLoadDaily,
  playerStage,
  playerWellnessDaily,
  season,
  testWindow,
} from '@sport-performance/db/schema';
import {
  DEFAULT_PEAK_ZONE_PARAMS,
  DEFAULT_PERCENTILE_SETTINGS,
  addDays,
  compareLocalDates,
  computePercentile,
  daysBetween,
  localDate,
  localDateParts,
  parseMetricCode,
  peakHeightVelocityZone,
  resolvePlayerAggregation,
  scoreResultMetrics,
  testComparisonWarnings,
  type AttemptAggregation,
  type AvailabilityStatus,
  type ClubId,
  type LocalDate,
  type MeasurementMethod,
  type MetricDirection,
  type PercentileSample,
  type PercentileSettings,
  type PlayerFacts,
  type PlayerId,
  type Sex,
  type UnitCode,
} from '@sport-performance/domain';
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { clubToday } from './training-shared.js';
import { requirePlayerFacts } from '../http/consents.js';
import { stageContext } from './tests/model.js';

/**
 * Reads of the player profile (B-404, ADR 0060). Every handler loads the
 * player under RLS (`not_found` out of scope), authorizes it with the
 * permission matrix and reads one player's rows; the comparison group of
 * the percentiles and of the category average comes from
 * `app.percentile_samples`, whose other players are anonymous keys and only
 * leave this module as aggregates.
 */

export const FIRST_DAY = '1900-01-01' as LocalDate;

export interface ProfileTarget {
  readonly id: PlayerId;
  readonly sex: Sex;
  /** What the matrix needs: sport, current categories, majority (guardians), consents. */
  readonly facts: PlayerFacts;
}

/** The player under RLS with its facts, or `not_found` (another club, out of scope). */
export async function requirePlayer(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
): Promise<ProfileTarget> {
  const { facts } = await requirePlayerFacts(db, clubId, playerId);
  const [row] = await db
    .select({ sex: player.sex })
    .from(player)
    .where(and(eq(player.clubId, clubId), eq(player.id, playerId)));
  if (row === undefined) throw new HttpError('not_found', 'Player not found');
  return { id: playerId, sex: row.sex, facts };
}

/** `[from, to]` of a query, with its default length and maximum. */
function dayRange(
  query: { from?: LocalDate | undefined; to?: LocalDate | undefined },
  today: LocalDate,
  defaultDays: number,
  maxDays: number,
): { from: LocalDate; to: LocalDate } {
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -(defaultDays - 1));
  if (compareLocalDates(from, to) > 0) {
    throw new HttpError('bad_request', '`from` is after `to`', {
      details: [{ path: ['query', 'from'], code: 'custom', message: '`from` is after `to`' }],
    });
  }
  if (daysBetween(from, to) + 1 > maxDays) {
    throw new HttpError('bad_request', `The range is longer than ${String(maxDays)} days`, {
      details: [
        { path: ['query', 'from'], code: 'custom', message: `At most ${String(maxDays)} days` },
      ],
    });
  }
  return { from, to };
}

/** Whether the worker still has derived data of the player to recompute. */
async function refreshPending(
  db: TenantDatabase,
  clubId: ClubId,
  playerId: PlayerId,
  kind: 'monitoring' | 'maturation',
): Promise<boolean> {
  const pending =
    kind === 'maturation'
      ? eq(derivedRefresh.maturation, true)
      : or(isNotNull(derivedRefresh.loadFrom), isNotNull(derivedRefresh.wellnessFrom));
  const [row] = await db
    .select({ id: derivedRefresh.id })
    .from(derivedRefresh)
    .where(and(eq(derivedRefresh.clubId, clubId), eq(derivedRefresh.playerId, playerId), pending))
    .limit(1);
  return row !== undefined;
}

// ─── Maturation ──────────────────────────────────────────────────────────────────────

/**
 * The peak zone of the newest derived measurement (offset or growth velocity)
 * of the last {@link PEAK_ZONE_MAX_MEASUREMENT_AGE_DAYS} days, with the
 * domain's default criteria (B-203). Part of the maturation itself, so every
 * role that reads the anthropometry sees it without reading alerts.
 */
export function peakZoneOf(
  measurements: readonly {
    measuredOn: LocalDate;
    phvOffsetYears: number | null;
    growthVelocityCmYear: number | null;
  }[],
  today: LocalDate,
): PlayerPeakZone | null {
  const latest = measurements.find(
    (m) =>
      compareLocalDates(m.measuredOn, today) <= 0 &&
      (m.phvOffsetYears !== null || m.growthVelocityCmYear !== null),
  );
  if (latest === undefined) return null;
  if (daysBetween(latest.measuredOn, today) > PEAK_ZONE_MAX_MEASUREMENT_AGE_DAYS) return null;
  const zone = peakHeightVelocityZone(
    {
      maturityOffsetYears: latest.phvOffsetYears,
      growthVelocityCmYear: latest.growthVelocityCmYear,
    },
    DEFAULT_PEAK_ZONE_PARAMS,
  );
  if (!zone.evaluable) return null;
  return {
    inZone: zone.inZone,
    offset: zone.offset,
    growthVelocity: zone.growthVelocity,
    measuredOn: latest.measuredOn,
  };
}

// ─── Availability ────────────────────────────────────────────────────────────────────

interface AvailabilityDay {
  readonly on_date: LocalDate;
  readonly training: AvailabilityStatus;
  readonly match: AvailabilityStatus;
  readonly overall: AvailabilityStatus;
}

/** Consecutive days with the same statuses, as periods (inclusive ends). */
export function availabilityPeriods(days: readonly AvailabilityDay[]): AvailabilityPeriod[] {
  const periods: AvailabilityPeriod[] = [];
  for (const day of days) {
    const last = periods.at(-1);
    if (
      last?.training === day.training &&
      last.match === day.match &&
      addDays(last.to, 1) === day.on_date
    ) {
      periods[periods.length - 1] = { ...last, to: day.on_date };
    } else {
      periods.push({
        from: day.on_date,
        to: day.on_date,
        training: day.training,
        match: day.match,
        overall: day.overall,
      });
    }
  }
  return periods;
}

// ─── Comparison groups ───────────────────────────────────────────────────────────────

interface SampleValueRow extends Record<string, unknown> {
  player_key: number;
  is_subject: boolean;
  result_key: number;
  test_code: string;
  protocol_version: number;
  exercise: string | null;
  metric_code: string;
  direction: MetricDirection;
  attempt_aggregation: AttemptAggregation;
  sex: Sex;
  age_band_code: string;
  position_code: string | null;
  line_code: string | null;
  measured_on: string;
  season_year: number;
  test_window_id: string | null;
  method: MeasurementMethod;
  attempt_number: number | null;
  value: number;
}

/** One result's score of one metric, placed in the group. */
export interface ScoredSample {
  readonly playerKey: number;
  readonly isSubject: boolean;
  readonly testCode: string;
  readonly protocolVersion: number;
  readonly exercise: string | null;
  readonly metricCode: string;
  readonly direction: MetricDirection;
  readonly sex: Sex;
  readonly ageBandCode: string;
  readonly positionCode: string | null;
  readonly lineCode: string | null;
  readonly measuredOn: LocalDate;
  readonly seasonYear: number;
  readonly testWindowId: string | null;
  readonly method: MeasurementMethod;
  readonly value: number;
}

/** The scores of each result, with the same rules as the result itself (attempts, direction). */
export function scoreSamples(rows: readonly SampleValueRow[]): ScoredSample[] {
  const byResult = new Map<number, SampleValueRow[]>();
  for (const row of rows) {
    const list = byResult.get(row.result_key);
    if (list === undefined) byResult.set(row.result_key, [row]);
    else list.push(row);
  }
  const scored: ScoredSample[] = [];
  for (const values of byResult.values()) {
    const first = values[0];
    if (first === undefined) continue;
    const directions = new Map(values.map((v) => [v.metric_code, v.direction]));
    const scores = scoreResultMetrics(
      values.map((v) => ({
        metricCode: v.metric_code,
        value: v.value,
        attemptNumber: v.attempt_number,
      })),
      (code) => ({
        aggregation: first.attempt_aggregation,
        direction: directions.get(code) ?? 'neutral',
      }),
    );
    for (const score of scores) {
      scored.push({
        playerKey: first.player_key,
        isSubject: first.is_subject,
        testCode: first.test_code,
        protocolVersion: first.protocol_version,
        exercise: first.exercise,
        metricCode: score.metricCode,
        direction: directions.get(score.metricCode) ?? 'neutral',
        sex: first.sex,
        ageBandCode: first.age_band_code,
        positionCode: first.position_code,
        lineCode: first.line_code,
        measuredOn: first.measured_on as LocalDate,
        seasonYear: first.season_year,
        testWindowId: first.test_window_id,
        method: first.method,
        value: score.value,
      });
    }
  }
  return scored;
}

export async function readSamples(
  db: TenantDatabase,
  options: {
    subject: PlayerId;
    metricCodes: readonly string[];
    from: LocalDate;
    to: LocalDate;
    sexes: readonly Sex[] | null;
    ageBandCodes: readonly string[] | null;
    /** Only the subject's own rows (a read of the player's series, without the group). */
    onlySubject?: boolean;
  },
): Promise<ScoredSample[]> {
  if (options.metricCodes.length === 0) return [];
  const list = (values: readonly string[]) => sql`string_to_array(${values.join(',')}, ',')`;
  const { rows } = await db.execute<SampleValueRow>(sql`
    select player_key, is_subject, result_key, test_code, protocol_version, exercise, metric_code,
           direction, attempt_aggregation, sex, age_band_code, position_code, line_code,
           measured_on::text as measured_on, season_year, test_window_id, method, attempt_number,
           value
      from app.percentile_samples(
        ${options.subject}::uuid,
        ${list(options.metricCodes)},
        ${options.from}::date,
        ${options.to}::date,
        ${options.sexes === null ? sql`null` : sql`${list(options.sexes)}::sex[]`},
        ${options.ageBandCodes === null ? sql`null` : list(options.ageBandCodes)},
        ${options.onlySubject === true}
      )`);
  return scoreSamples(rows);
}

/** Codes of the club's test metrics (not anthropometry), with their unit and direction. */
export async function testMetrics(
  db: TenantDatabase,
  clubId: ClubId,
  directionalOnly: boolean,
): Promise<Map<string, { unit: UnitCode; direction: MetricDirection }>> {
  const rows = await db
    .select({
      code: metricDefinition.code,
      unit: metricDefinition.unit,
      direction: metricDefinition.direction,
    })
    .from(metricDefinition)
    .where(
      and(
        eq(metricDefinition.clubId, clubId),
        eq(metricDefinition.source, 'test'),
        or(sql`${metricDefinition.testCode} is null`, ne(metricDefinition.testCode, 'anthro')),
        ...(directionalOnly ? [ne(metricDefinition.direction, 'neutral')] : []),
      ),
    );
  return new Map(rows.map((row) => [row.code, { unit: row.unit, direction: row.direction }]));
}

/** Age bands the player has been in (the comparison groups are always within one). */
export async function ageBandsOf(
  db: TenantDatabase,
  clubId: ClubId,
  target: ProfileTarget,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ code: category.ageBandCode })
    .from(playerCategory)
    .innerJoin(
      category,
      and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
    )
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        eq(playerCategory.playerId, target.id),
        eq(category.sport, target.facts.sport),
      ),
    );
  return rows.map((row) => row.code);
}

/** `metricCode` and exercise: a strength metric of two exercises is two comparisons. */
const seriesKey = (s: Pick<ScoredSample, 'metricCode' | 'exercise'>) =>
  `${s.metricCode}|${s.exercise ?? ''}`;

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list === undefined) groups.set(k, [item]);
    else list.push(item);
  }
  return groups;
}

const mean = (values: readonly number[]) => values.reduce((a, v) => a + v, 0) / values.length;

/**
 * The value one player contributes from several results: the best by the
 * direction, or for neutral metrics the latest day (same-day results
 * averaged), like the percentile groups of the domain.
 */
export function playerValue(samples: readonly ScoredSample[], direction: MetricDirection): number {
  const aggregation = resolvePlayerAggregation(direction);
  const values = samples.map((s) => s.value);
  if (aggregation === 'best') {
    return direction === 'lower_is_better' ? Math.min(...values) : Math.max(...values);
  }
  const latest = latestDay(samples);
  return mean(samples.filter((s) => s.measuredOn === latest).map((s) => s.value));
}

function latestDay(samples: readonly ScoredSample[]): LocalDate {
  let latest = FIRST_DAY;
  for (const s of samples) if (compareLocalDates(s.measuredOn, latest) > 0) latest = s.measuredOn;
  return latest;
}

/** Roles that read the club's groups as staff (not the player nor the guardian). */
const isStaffRole = (role: string) => role !== 'player' && role !== 'parent';

/** Whether every grouping of the settings matches on a dimension (so the read can narrow). */
function alwaysGroupedBy(settings: PercentileSettings, dimension: 'sex' | 'category'): boolean {
  return settings.groupings.every((g) => g.dimensions.includes(dimension));
}

/** Percentile of the player's latest value of each metric in their group. */
export function percentileItems(
  samples: readonly ScoredSample[],
  target: Pick<ProfileTarget, 'facts'>,
  metrics: ReadonlyMap<string, { unit: UnitCode; direction: MetricDirection }>,
  asOf: LocalDate,
  settings: PercentileSettings,
): PlayerPercentile[] {
  const items: PlayerPercentile[] = [];
  const series = groupBy(samples, seriesKey);
  for (const group of series.values()) {
    const mine = group.filter((s) => s.isSubject);
    const first = mine[0];
    if (first === undefined) continue;
    const metric = metrics.get(first.metricCode);
    if (metric === undefined || metric.direction === 'neutral') continue;
    const day = latestDay(mine);
    // Only results of the protocol version of the player's latest one are compared
    // (principle 4): another version of the protocol is another measurement.
    const protocolVersion = Math.max(
      ...mine.filter((s) => s.measuredOn === day).map((s) => s.protocolVersion),
    );
    const latest = mine.filter(
      (s) => s.measuredOn === day && s.protocolVersion === protocolVersion,
    );
    const subjectSample = latest[0] ?? first;
    const value = mean(latest.map((s) => s.value));
    const metricCode = parseMetricCode(first.metricCode);
    const key = (playerKey: number) => `k${String(playerKey)}` as PlayerId;
    const comparable = group.filter((s) => s.protocolVersion === protocolVersion);
    const others: PercentileSample[] = comparable.map((s) => ({
      playerId: key(s.playerKey),
      metricCode,
      sport: target.facts.sport,
      sex: s.sex,
      categoryCode: s.ageBandCode,
      ...(s.positionCode === null ? {} : { positionCode: s.positionCode }),
      ...(s.lineCode === null ? {} : { lineCode: s.lineCode }),
      seasonYear: s.seasonYear,
      measuredOn: s.measuredOn,
      method: s.method,
      value: s.value,
    }));
    const result = computePercentile(
      others,
      {
        playerId: key(subjectSample.playerKey),
        metricCode,
        sport: target.facts.sport,
        sex: subjectSample.sex,
        categoryCode: subjectSample.ageBandCode,
        ...(subjectSample.positionCode === null
          ? {}
          : { positionCode: subjectSample.positionCode }),
        ...(subjectSample.lineCode === null ? {} : { lineCode: subjectSample.lineCode }),
        seasonYear: subjectSample.seasonYear,
        asOf,
        method: subjectSample.method,
        value,
      },
      metric.direction,
      settings,
    );
    const base = {
      metricCode: first.metricCode,
      testCode: first.testCode,
      exercise: first.exercise,
      unit: metric.unit,
      direction: metric.direction,
      value,
      measuredOn: day,
      method: subjectSample.method,
      protocolVersion,
    } as const;
    items.push(
      result.status === 'ok'
        ? {
            ...base,
            status: 'ok',
            percentile: result.percentile,
            sampleSize: result.sampleSize,
            grouping: {
              dimensions: [...result.grouping.dimensions],
              seasonsAccumulated: result.grouping.seasonsAccumulated,
            },
            seasonFrom: result.seasonFrom,
            seasonTo: result.seasonTo,
            median: result.summary.p50,
            mixedMethods: result.mixedMethods,
          }
        : {
            ...base,
            status: 'insufficient_sample',
            percentile: null,
            // Below the minimum not even the size is told, like the window average.
            sampleSize: null,
            grouping: null,
            seasonFrom: null,
            seasonTo: null,
            median: null,
            mixedMethods: false,
          },
    );
  }
  return items.sort(
    (a, b) =>
      a.testCode.localeCompare(b.testCode) ||
      a.metricCode.localeCompare(b.metricCode) ||
      (a.exercise ?? '').localeCompare(b.exercise ?? ''),
  );
}

export interface WindowInfo {
  readonly id: string;
  readonly seasonName: string;
  readonly number: number;
  readonly startsOn: LocalDate;
  readonly endsOn: LocalDate;
}

const columnKeyOf = (s: Pick<ScoredSample, 'testWindowId' | 'measuredOn'>) =>
  s.testWindowId === null ? `d:${s.measuredOn}` : `w:${s.testWindowId}`;

/**
 * The days a column's comparison group is read over: the whole window (or
 * the whole day out of windows), whatever range the caller asked for. A
 * range that splits a window must not change who is in the average, or two
 * requests could be differenced into one peer's value (ADR 0060).
 */
export function columnSpan(
  column: Pick<ScoredSample, 'testWindowId' | 'measuredOn'>,
  windows: ReadonlyMap<string, Pick<WindowInfo, 'startsOn' | 'endsOn'>>,
): { from: LocalDate; to: LocalDate } {
  const info = column.testWindowId === null ? undefined : windows.get(column.testWindowId);
  return info === undefined
    ? { from: column.measuredOn, to: column.measuredOn }
    : { from: info.startsOn, to: info.endsOn };
}

/** The span covering every column of the player's own samples. */
export function groupSpan(
  own: readonly ScoredSample[],
  windows: ReadonlyMap<string, Pick<WindowInfo, 'startsOn' | 'endsOn'>>,
): { from: LocalDate; to: LocalDate } | null {
  let span: { from: LocalDate; to: LocalDate } | null = null;
  for (const s of own) {
    const { from, to } = columnSpan(s, windows);
    span =
      span === null
        ? { from, to }
        : {
            from: compareLocalDates(from, span.from) < 0 ? from : span.from,
            to: compareLocalDates(to, span.to) > 0 ? to : span.to,
          };
  }
  return span;
}

const within = (day: LocalDate, span: { from: LocalDate; to: LocalDate }) =>
  compareLocalDates(day, span.from) >= 0 && compareLocalDates(day, span.to) <= 0;

/**
 * The player's value in each window (or day out of windows) and their
 * category's average. `own` are the player's samples in the asked range;
 * `group` are everyone's samples (the player included) read over
 * {@link groupSpan}: each column's average uses only the group samples of
 * that column inside its fixed {@link columnSpan}, so it does not depend on
 * `from`/`to`. The peers are those of the player's age band, sex and protocol
 * version in the column. The size is only told from the minimum on, and the
 * average only once the column's days are over (`today` is after its span):
 * while a window is open, reading before and after a peer's result is loaded
 * would give that peer's value (ADR 0060).
 */
export function evolution(
  own: readonly ScoredSample[],
  group: readonly ScoredSample[],
  metrics: ReadonlyMap<string, { unit: UnitCode; direction: MetricDirection }>,
  windows: ReadonlyMap<string, WindowInfo>,
  today: LocalDate,
): { columns: TestEvolutionColumn[]; metrics: TestEvolutionMetric[] } {
  const columns = new Map<string, TestEvolutionColumn>();
  const result: TestEvolutionMetric[] = [];
  const groupBySeries = groupBy(group, seriesKey);
  for (const [series, mine] of groupBy(
    own.filter((s) => s.isSubject),
    seriesKey,
  )) {
    const first = mine[0];
    if (first === undefined) continue;
    const metric = metrics.get(first.metricCode);
    if (metric === undefined) continue;
    const groupColumns = groupBy(groupBySeries.get(series) ?? [], columnKeyOf);
    const points: TestEvolutionMetric['points'] = [];
    for (const [columnKey, inColumn] of groupBy(mine, columnKeyOf)) {
      const head = inColumn[0];
      if (head === undefined) continue;
      const info = head.testWindowId === null ? undefined : windows.get(head.testWindowId);
      if (!columns.has(columnKey)) {
        columns.set(columnKey, {
          key: columnKey,
          testWindowId: (info?.id ?? null) as TestEvolutionColumn['testWindowId'],
          seasonName: info?.seasonName ?? null,
          number: info?.number ?? null,
          startsOn: info?.startsOn ?? head.measuredOn,
          endsOn: info?.endsOn ?? head.measuredOn,
        });
      }
      const span = columnSpan(head, windows);
      const inSpan = (groupColumns.get(columnKey) ?? []).filter((s) => within(s.measuredOn, span));
      // The player's band and protocol in the whole column (their latest day in it).
      const subjectInSpan = inSpan.filter((s) => s.isSubject);
      const reference = subjectInSpan.length > 0 ? subjectInSpan : inColumn;
      const referenceDay = latestDay(reference);
      const latest = reference.find((s) => s.measuredOn === referenceDay) ?? head;
      const peers = inSpan.filter(
        (s) =>
          s.ageBandCode === latest.ageBandCode &&
          s.sex === head.sex &&
          s.protocolVersion === latest.protocolVersion,
      );
      const byPlayer = groupBy(peers, (s) => String(s.playerKey));
      const groupValues = [...byPlayer.values()].map((list) => playerValue(list, metric.direction));
      const ownMethods = [...new Set(inColumn.map((s) => s.method))].sort();
      const groupMethods = new Set([...ownMethods, ...peers.map((s) => s.method)]);
      // The peers share one version; the flag says the player's own column mixes another.
      const groupVersions = new Set([
        ...inColumn.map((s) => s.protocolVersion),
        ...peers.map((s) => s.protocolVersion),
      ]);
      const closed = compareLocalDates(span.to, today) < 0;
      const enough = closed && groupValues.length >= CATEGORY_AVERAGE_MIN_PLAYERS;
      points.push({
        columnKey,
        value: playerValue(inColumn, metric.direction),
        measuredOn: latestDay(inColumn),
        methods: ownMethods,
        protocolVersion: latest.protocolVersion,
        categoryAverage: enough ? mean(groupValues) : null,
        categorySize: enough ? groupValues.length : null,
        categoryMixedMethods: enough && groupMethods.size > 1,
        categoryMixedProtocolVersions: enough && groupVersions.size > 1,
      });
    }
    result.push({
      metricCode: first.metricCode,
      testCode: first.testCode,
      exercise: first.exercise,
      unit: metric.unit,
      direction: metric.direction,
      points,
      warnings: testComparisonWarnings(
        mine.map((s) => ({
          method: s.method,
          protocolVersion: s.protocolVersion,
          deviceId: null,
          exercise: s.exercise,
        })),
      ),
    });
  }
  const ordered = [...columns.values()].sort(
    (a, b) => compareLocalDates(a.startsOn, b.startsOn) || a.key.localeCompare(b.key),
  );
  const order = new Map(ordered.map((c, i) => [c.key, i]));
  for (const metric of result) {
    metric.points.sort((a, b) => (order.get(a.columnKey) ?? 0) - (order.get(b.columnKey) ?? 0));
  }
  result.sort(
    (a, b) =>
      a.testCode.localeCompare(b.testCode) ||
      a.metricCode.localeCompare(b.metricCode) ||
      (a.exercise ?? '').localeCompare(b.exercise ?? ''),
  );
  return { columns: ordered, metrics: result };
}

// ─── Routes ──────────────────────────────────────────────────────────────────────────

export function registerPlayerProfileRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getPlayerDailyMonitoring, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const target = await requirePlayer(db, clubId, params.playerId);
      await permissions.authorize('load_metrics', 'read', { player: target.facts });
      await permissions.authorize('wellness', 'read', { player: target.facts });
      const today = await clubToday(db);
      const { from, to } = dayRange(
        query,
        today,
        DAILY_MONITORING_DEFAULT_DAYS,
        DAILY_MONITORING_MAX_DAYS,
      );
      const load = await db
        .select()
        .from(playerLoadDaily)
        .where(
          and(
            eq(playerLoadDaily.clubId, clubId),
            eq(playerLoadDaily.playerId, target.id),
            gte(playerLoadDaily.localDate, from),
            lte(playerLoadDaily.localDate, to),
          ),
        )
        .orderBy(asc(playerLoadDaily.localDate));
      const wellnessDays = await db
        .select()
        .from(playerWellnessDaily)
        .where(
          and(
            eq(playerWellnessDaily.clubId, clubId),
            eq(playerWellnessDaily.playerId, target.id),
            gte(playerWellnessDaily.localDate, from),
            lte(playerWellnessDaily.localDate, to),
          ),
        )
        .orderBy(asc(playerWellnessDaily.localDate));
      return {
        playerId: target.id,
        from,
        to,
        today,
        refreshPending: await refreshPending(db, clubId, target.id, 'monitoring'),
        load: load.map((row) => ({
          date: row.localDate,
          loadAu: row.loadAu,
          hasData: row.hasData,
          sessions: row.sessionsN,
          pendingRpe: row.pendingRpeN,
          historyDays: row.historyDays,
          acuteEwmaAu: row.acuteEwmaAu,
          chronicEwmaAu: row.chronicEwmaAu,
          acwr: row.acwr,
          acwrStatus: row.acwrStatus,
          missingDaysAcute: row.missingDaysAcute,
          missingDaysChronic: row.missingDaysChronic,
          weekLoadAu: row.windowLoadAu,
          monotony: row.monotony,
          strainAu: row.strainAu,
          monotonyStatus: row.monotonyStatus,
        })),
        wellness: wellnessDays.map((row) => ({
          date: row.localDate,
          itemCount: row.itemCount === 3 ? (3 as const) : (5 as const),
          meanScore: row.meanScore,
          baselineSamples: row.baselineSamples,
          baselineMeanScore: row.baselineMeanScore,
          baselineSdScore: row.baselineSdScore,
          zScore: row.zScore,
        })),
      };
    },
  });

  registerEndpoint(app, getPlayerMaturation, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const target = await requirePlayer(db, clubId, params.playerId);
      await permissions.authorize('anthropometry', 'read', { player: target.facts });
      const today = await clubToday(db);
      const measurements = await db
        .select({
          id: anthroMeasurement.id,
          measuredOn: anthroMeasurement.measuredOn,
          heightCm: anthroMeasurement.heightCm,
          sittingHeightCm: anthroMeasurement.sittingHeightCm,
          weightKg: anthroMeasurement.weightKg,
          skinfoldsSumMm: anthroMeasurement.skinfoldsSumMm,
          method: anthroMeasurement.method,
          phvOffsetYears: anthroMeasurement.phvOffsetYears,
          maturityOffsetEquation: anthroMeasurement.maturityOffsetEquation,
          predictedAdultHeightCm: anthroMeasurement.predictedAdultHeightCm,
          adultHeightPct: anthroMeasurement.adultHeightPct,
          growthVelocityCmYear: anthroMeasurement.growthVelocityCmYear,
          derivedAt: anthroMeasurement.derivedAt,
        })
        .from(anthroMeasurement)
        .where(and(eq(anthroMeasurement.clubId, clubId), eq(anthroMeasurement.playerId, target.id)))
        .orderBy(
          desc(anthroMeasurement.measuredOn),
          desc(anthroMeasurement.createdAt),
          desc(anthroMeasurement.id),
        )
        .limit(MATURATION_MEASUREMENTS_MAX);
      const context = await stageContext(db, clubId, target.id, today, null);
      const [pinned] = await db
        .select({ basis: playerStage.basis })
        .from(playerStage)
        .where(
          and(
            eq(playerStage.clubId, clubId),
            eq(playerStage.playerId, target.id),
            lte(playerStage.validFrom, today),
            or(sql`${playerStage.validTo} is null`, sql`${playerStage.validTo} > ${today}::date`),
          ),
        )
        .orderBy(desc(playerStage.validFrom))
        .limit(1);
      return {
        playerId: target.id,
        today,
        stage:
          context === undefined
            ? null
            : {
                stage: context.stage,
                basis: pinned?.basis ?? 'category',
                categoryId: context.categoryId,
              },
        refreshPending: await refreshPending(db, clubId, target.id, 'maturation'),
        peakZone: peakZoneOf(measurements, today),
        measurements: measurements.map((row) => ({
          ...row,
          id: row.id as never,
          derivedAt: row.derivedAt?.toISOString() ?? null,
        })),
      };
    },
  });

  registerEndpoint(app, getPlayerAvailability, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId, role } = caller.membership;
      const target = await requirePlayer(db, clubId, params.playerId);
      await permissions.authorize('availability', 'read', { player: target.facts });
      const today = await clubToday(db);
      const { from, to } = dayRange(
        query,
        today,
        AVAILABILITY_HISTORY_DEFAULT_DAYS,
        AVAILABILITY_HISTORY_MAX_DAYS,
      );
      const { rows: current } = await db.execute<{
        training: AvailabilityStatus;
        match: AvailabilityStatus;
        overall: AvailabilityStatus;
        staff_notes: string[];
      }>(
        sql`select training, match, overall, staff_notes
              from medical.availability(array[${target.id}]::uuid[], ${today}::date)`,
      );
      const { rows: days } = await db.execute<AvailabilityDay & Record<string, unknown>>(
        sql`select on_date::text as on_date, training, match, overall
              from medical.availability_history(${target.id}::uuid, ${from}::date, ${to}::date)`,
      );
      const now = current[0];
      // RLS let the player through but the medical scope did not: same answer as out of scope.
      if (now === undefined) throw new HttpError('not_found', 'Player not found');
      const staff = isStaffRole(role);
      return {
        playerId: target.id,
        today,
        from,
        to,
        current: {
          training: now.training,
          match: now.match,
          overall: now.overall,
          staffNotes: staff ? now.staff_notes : [],
        },
        periods: availabilityPeriods(days),
      };
    },
  });

  registerEndpoint(app, getPlayerPercentiles, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId, role } = caller.membership;
      const target = await requirePlayer(db, clubId, params.playerId);
      const today = await clubToday(db);
      // Never after today; and only the staff picks another day: a player moving `asOf`
      // across a test day would move one peer in or out of the group (ADR 0060).
      const asOf =
        query.asOf === undefined || !isStaffRole(role) || compareLocalDates(query.asOf, today) > 0
          ? today
          : query.asOf;
      // The percentiles depend on the stage and age band (from M15) of the day they are read on.
      const stage = await stageContext(db, clubId, target.id, asOf, null);
      const facts: PlayerFacts =
        stage === undefined
          ? target.facts
          : { ...target.facts, stage: stage.stage, ageBand: stage.ageBand };
      await permissions.authorize('percentile', 'read', { player: facts });
      const settings: PercentileSettings = DEFAULT_PERCENTILE_SETTINGS;
      const metrics = await testMetrics(db, clubId, true);
      const seasons = Math.max(...settings.groupings.map((g) => g.seasonsAccumulated));
      const from = localDate(localDateParts(asOf).year - seasons, 1, 1);
      const samples = await readSamples(db, {
        subject: target.id,
        metricCodes: [...metrics.keys()],
        from,
        to: asOf,
        sexes: alwaysGroupedBy(settings, 'sex') ? [target.sex] : null,
        ageBandCodes: alwaysGroupedBy(settings, 'category')
          ? await ageBandsOf(db, clubId, target)
          : null,
      });
      return {
        playerId: target.id,
        asOf,
        minSampleSize: settings.minSampleSize,
        items: percentileItems(samples, target, metrics, asOf, settings),
      };
    },
  });

  registerEndpoint(app, getPlayerTestEvolution, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const target = await requirePlayer(db, clubId, params.playerId);
      await permissions.authorize('test_result', 'read', { player: target.facts });
      await permissions.authorize('group_reference', 'read', { player: target.facts });
      const today = await clubToday(db);
      const to = query.to ?? today;
      const from = query.from ?? FIRST_DAY;
      if (compareLocalDates(from, to) > 0) {
        throw new HttpError('bad_request', '`from` is after `to`', {
          details: [{ path: ['query', 'from'], code: 'custom', message: '`from` is after `to`' }],
        });
      }
      const metrics = await testMetrics(db, clubId, false);
      const ageBandCodes = await ageBandsOf(db, clubId, target);
      const read = (range: { from: LocalDate; to: LocalDate; onlySubject?: boolean }) =>
        readSamples(db, {
          subject: target.id,
          metricCodes: [...metrics.keys()],
          ...range,
          sexes: [target.sex],
          ageBandCodes,
        });
      // The player's own values in the asked range…
      const own = await read({ from, to, onlySubject: true });
      const windowIds = [
        ...new Set(own.flatMap((s) => (s.testWindowId === null ? [] : [s.testWindowId]))),
      ];
      const windows = new Map(
        (windowIds.length === 0
          ? []
          : await db
              .select({
                id: testWindow.id,
                seasonName: season.name,
                number: testWindow.number,
                startsOn: testWindow.startsOn,
                endsOn: testWindow.endsOn,
              })
              .from(testWindow)
              .innerJoin(
                season,
                and(eq(season.clubId, testWindow.clubId), eq(season.id, testWindow.seasonId)),
              )
              .where(and(eq(testWindow.clubId, clubId), inArray(testWindow.id, windowIds)))
        ).map((w) => [w.id, w]),
      );
      // …and the comparison group of each of their columns over the whole window or day,
      // never cut by `from`/`to` (ADR 0060).
      const span = groupSpan(own, windows);
      const group = span === null ? [] : await read(span);
      const { columns, metrics: series } = evolution(own, group, metrics, windows, today);
      return { playerId: target.id, columns, metrics: series };
    },
  });
}
