import {
  categoryReportContentSchema,
  type CategoryReportBatteryTest,
  type CategoryReportColumn,
  type CategoryReportContent,
  type CategoryReportMetric,
  type CategoryReportResponseCount,
  type PlayerFirstTeamReference,
} from '@sport-performance/contracts';
import {
  club,
  player,
  playerCategory,
  participation,
  season,
  testDefinition,
  testResult,
  testSession,
  testWindow,
  trainingSession,
  wellness,
} from '@sport-performance/db/schema';
import {
  CATEGORY_REPORT_EVOLUTION_COLUMNS,
  CATEGORY_REPORT_FORMAT_VERSION,
  STAGES,
  addDays,
  compareLocalDates,
  groupAverage,
  notDoneReasonForViewer,
  pairedChange,
  participationCarriesLoad,
  resolvePlayerAggregation,
  startOfIsoWeek,
  type CategoryId,
  type ClubId,
  type LocalDate,
  type MeasurementMethod,
  type MetricDirection,
  type ParticipationStatus,
  type PlayerId,
  type Sex,
  type Sport,
  type Stage,
  type TestNotDoneReason,
  type UnitCode,
} from '@sport-performance/domain';
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { TenantDatabase } from '../db/database.js';
import { testMetrics } from '../routes/player-profile.js';
import { firstTeamReferencesOf } from '../routes/reference-values.js';
import { batteryEntries, scheduledTests } from '../routes/test-session-sheet.js';
import {
  loadStageSources,
  stageContextOn,
  testResultColumns,
  testResultDtos,
} from '../routes/tests/model.js';

/**
 * The snapshot of a category report (B-603, ADR 0073), read in the
 * transaction of the request with the context of the staff member who asks
 * for it: the roster, the battery done in the window, the evolution of the
 * group over the windows of the sport and the response rate of wellness and
 * RPE since the previous window. Aggregates only: the pure functions below
 * take the rows of each player and give counts and averages, and no name, id
 * or value of a player reaches the content. An average or a count of changes
 * needs {@link CATEGORY_REPORT_MIN_PLAYERS} players; an injury is
 * `unavailable` (ADR 0029).
 */

export interface ReportCategory {
  readonly id: CategoryId;
  readonly name: string;
  readonly sport: Sport;
  readonly sex: Sex;
  readonly ageBandCode: string;
}

export interface CategoryReportWindow {
  readonly id: string;
  readonly seasonId: string;
  readonly seasonName: string;
  readonly seasonStartsOn: LocalDate;
  readonly number: number;
  readonly startsOn: LocalDate;
  readonly endsOn: LocalDate;
}

const within = (day: LocalDate, from: LocalDate, to: LocalDate) =>
  compareLocalDates(day, from) >= 0 && compareLocalDates(day, to) <= 0;

const validOn = (row: { validFrom: LocalDate; validTo: LocalDate | null }, day: LocalDate) =>
  compareLocalDates(row.validFrom, day) <= 0 &&
  (row.validTo === null || compareLocalDates(row.validTo, day) > 0);

// ─── Battery ─────────────────────────────────────────────────────────────────────────

/** A result of a player in the window, as the caller may see it (`injured` is `unavailable`). */
export interface WindowResultRow {
  readonly playerId: string;
  readonly testCode: string;
  readonly measuredOn: LocalDate;
  readonly status: 'done' | 'not_done';
  readonly reason: TestNotDoneReason | 'unavailable' | null;
}

/**
 * The battery of the window counted per test: each player the battery
 * schedules a test for is `done` with a done result in the window, else in
 * the bucket of the reason of their latest not-done result, else without a
 * record. `expected` maps each player to the tests scheduled for them.
 */
export function batteryCompliance(
  expected: ReadonlyMap<string, readonly string[]>,
  results: readonly WindowResultRow[],
  testOrder: (a: string, b: string) => number,
): CategoryReportBatteryTest[] {
  const byPlayerTest = new Map<string, WindowResultRow[]>();
  for (const row of results) {
    const key = `${row.playerId}|${row.testCode}`;
    const list = byPlayerTest.get(key);
    if (list === undefined) byPlayerTest.set(key, [row]);
    else list.push(row);
  }
  const tally = new Map<string, CategoryReportBatteryTest>();
  const bucketOf = (reason: TestNotDoneReason | 'unavailable' | null) => {
    if (reason === null) return 'other' as const;
    // Whoever reads it is not the medical staff: an injury is "not available" (ADR 0029).
    const shown = reason === 'unavailable' ? reason : notDoneReasonForViewer(reason, 'coach');
    switch (shown) {
      case 'absent':
        return 'absent' as const;
      case 'unavailable':
      case 'injured':
        return 'unavailable' as const;
      case 'not_applicable_to_stage':
        return 'notApplicableToStage' as const;
      case 'other':
        return 'other' as const;
    }
  };
  for (const [playerId, testCodes] of expected) {
    for (const testCode of new Set(testCodes)) {
      const current = tally.get(testCode) ?? {
        testCode,
        expected: 0,
        done: 0,
        notDone: { absent: 0, unavailable: 0, notApplicableToStage: 0, other: 0 },
        noRecord: 0,
      };
      const rows = byPlayerTest.get(`${playerId}|${testCode}`) ?? [];
      const notDone = { ...current.notDone };
      let { done, noRecord } = current;
      if (rows.some((row) => row.status === 'done')) {
        done += 1;
      } else {
        let latest: WindowResultRow | undefined;
        for (const row of rows) {
          if (latest === undefined || compareLocalDates(row.measuredOn, latest.measuredOn) > 0) {
            latest = row;
          }
        }
        if (latest === undefined) noRecord += 1;
        else notDone[bucketOf(latest.reason)] += 1;
      }
      tally.set(testCode, { ...current, expected: current.expected + 1, done, notDone, noRecord });
    }
  }
  return [...tally.values()].sort((a, b) => testOrder(a.testCode, b.testCode));
}

// ─── Evolution of the group ──────────────────────────────────────────────────────────

/** One score of a done result of a player of the roster, placed in a column. */
export interface GroupScore {
  readonly playerId: string;
  readonly columnKey: string;
  readonly testCode: string;
  readonly metricCode: string;
  readonly exercise: string | null;
  readonly measuredOn: LocalDate;
  readonly method: MeasurementMethod;
  readonly protocolVersion: number;
  readonly value: number;
}

interface PlayerPoint {
  readonly value: number;
  readonly protocolVersions: ReadonlySet<number>;
}

/**
 * The value a player contributes to a column: the best by the direction, or
 * for neutral metrics the mean of their latest day (the rule of the
 * percentile groups and of the profile's averages).
 */
function playerPoint(scores: readonly GroupScore[], direction: MetricDirection): PlayerPoint {
  const values = scores.map((s) => s.value);
  if (resolvePlayerAggregation(direction) === 'best') {
    const value = direction === 'lower_is_better' ? Math.min(...values) : Math.max(...values);
    const chosen = scores.filter((s) => s.value === value);
    return { value, protocolVersions: new Set(chosen.map((s) => s.protocolVersion)) };
  }
  let latest = scores[0]?.measuredOn;
  for (const s of scores) {
    if (latest === undefined || compareLocalDates(s.measuredOn, latest) > 0) latest = s.measuredOn;
  }
  const day = scores.filter((s) => s.measuredOn === latest);
  return {
    value: day.reduce((sum, s) => sum + s.value, 0) / day.length,
    protocolVersions: new Set(day.map((s) => s.protocolVersion)),
  };
}

const onlyVersion = (point: PlayerPoint) =>
  point.protocolVersions.size === 1 ? [...point.protocolVersions][0] : undefined;

/**
 * The group's evolution: per metric (and exercise), each column's average of
 * one value per player (from the minimum of players, else neither the average
 * nor the size), the methods and protocol versions behind it, and how the
 * players changed against the previous column with results, paired only
 * within one protocol version (principle 4). Metrics without any score are
 * left out; columns keep the given order (oldest first).
 */
export function groupEvolution(
  columns: readonly CategoryReportColumn[],
  scores: readonly GroupScore[],
  metrics: ReadonlyMap<string, { unit: UnitCode; direction: MetricDirection }>,
  references: readonly PlayerFirstTeamReference[],
  testOrder: (a: string, b: string) => number,
): CategoryReportMetric[] {
  const referenceOf = new Map(references.map((r) => [r.metricCode, r]));
  const bySeries = new Map<string, GroupScore[]>();
  for (const score of scores) {
    const key = `${score.metricCode}|${score.exercise ?? ''}`;
    const list = bySeries.get(key);
    if (list === undefined) bySeries.set(key, [score]);
    else list.push(score);
  }
  const result: CategoryReportMetric[] = [];
  for (const series of bySeries.values()) {
    const first = series[0];
    if (first === undefined) continue;
    const metric = metrics.get(first.metricCode);
    if (metric === undefined) continue;
    const perColumn = new Map<string, Map<string, PlayerPoint>>();
    const points: CategoryReportMetric['points'] = [];
    for (const column of columns) {
      const inColumn = series.filter((s) => s.columnKey === column.key);
      if (inColumn.length === 0) continue;
      const byPlayer = new Map<string, GroupScore[]>();
      for (const s of inColumn) {
        const list = byPlayer.get(s.playerId);
        if (list === undefined) byPlayer.set(s.playerId, [s]);
        else list.push(s);
      }
      const players = new Map(
        [...byPlayer].map(([id, list]) => [id, playerPoint(list, metric.direction)] as const),
      );
      perColumn.set(column.key, players);
      const average = groupAverage([...players.values()].map((p) => p.value));
      points.push({
        columnKey: column.key,
        average,
        players: average === null ? null : players.size,
        methods: [...new Set(inColumn.map((s) => s.method))].sort(),
        protocolVersions: [...new Set(inColumn.map((s) => s.protocolVersion))].sort(
          (a, b) => a - b,
        ),
      });
    }
    if (points.length === 0) continue;
    // The last column against the one before it with results.
    const last = points.at(-1);
    const before = points.length > 1 ? points.at(-2) : undefined;
    let change: CategoryReportMetric['change'] = null;
    if (last !== undefined && before !== undefined) {
      const current = perColumn.get(last.columnKey) ?? new Map<string, PlayerPoint>();
      const previous = perColumn.get(before.columnKey) ?? new Map<string, PlayerPoint>();
      const pairs: { previous: number; current: number }[] = [];
      for (const [id, now] of current) {
        const then = previous.get(id);
        const version = onlyVersion(now);
        if (then === undefined || version === undefined || onlyVersion(then) !== version) continue;
        pairs.push({ previous: then.value, current: now.value });
      }
      const counted = pairedChange(metric.direction, pairs);
      change = counted === null ? null : { fromColumnKey: before.columnKey, ...counted };
    }
    const reference = first.exercise === null ? referenceOf.get(first.metricCode) : undefined;
    result.push({
      testCode: first.testCode,
      metricCode: first.metricCode,
      exercise: first.exercise,
      unit: metric.unit,
      direction: metric.direction,
      points,
      change,
      firstTeam:
        reference?.unit !== metric.unit
          ? null
          : { value: reference.value, unit: reference.unit, scope: reference.scope },
    });
  }
  return result.sort(
    (a, b) =>
      testOrder(a.testCode, b.testCode) ||
      a.metricCode.localeCompare(b.metricCode) ||
      (a.exercise ?? '').localeCompare(b.exercise ?? ''),
  );
}

// ─── Response rate ───────────────────────────────────────────────────────────────────

export interface ResponseInputs {
  /** The players' memberships of the category over the period (`[validFrom, validTo)`). */
  readonly memberships: readonly {
    readonly playerId: string;
    readonly validFrom: LocalDate;
    readonly validTo: LocalDate | null;
  }[];
  /** Days with a session of the category (already started, not archived). */
  readonly sessionDays: readonly LocalDate[];
  /** Participation in those sessions. */
  readonly participations: readonly {
    readonly playerId: string;
    readonly localDate: LocalDate;
    readonly status: ParticipationStatus;
    readonly rpeReported: boolean;
  }[];
  /** Days each player answered the wellness questionnaire. */
  readonly wellnessDays: readonly { readonly playerId: string; readonly localDate: LocalDate }[];
}

type Count = { -readonly [K in keyof CategoryReportResponseCount]: number };
const emptyCount = (): Count => ({ expected: 0, answered: 0 });

/**
 * How many wellness and RPE questionnaires were expected and answered, in
 * total and per ISO week (Monday first):
 * - wellness: each player of the category on a day with a session, unless
 *   every participation of theirs that day is absent or unavailable;
 *   answered when they submitted their wellness that day;
 * - RPE: each full or partial participation in a session of the category;
 *   answered when it carries an RPE.
 */
export function responseCounts(
  input: ResponseInputs,
): Omit<CategoryReportContent['responses'], 'from' | 'to'> {
  const days = [...new Set(input.sessionDays)].sort(compareLocalDates);
  const daySet = new Set(days);
  const answered = new Set(input.wellnessDays.map((w) => `${w.playerId}|${w.localDate}`));
  const statusesOf = new Map<string, ParticipationStatus[]>();
  for (const p of input.participations) {
    const key = `${p.playerId}|${p.localDate}`;
    const list = statusesOf.get(key);
    if (list === undefined) statusesOf.set(key, [p.status]);
    else list.push(p.status);
  }
  const total = { wellness: emptyCount(), rpe: emptyCount() };
  const weeks = new Map<LocalDate, { wellness: Count; rpe: Count }>();
  const weekOf = (day: LocalDate) => {
    const start = startOfIsoWeek(day);
    let week = weeks.get(start);
    if (week === undefined) {
      week = { wellness: emptyCount(), rpe: emptyCount() };
      weeks.set(start, week);
    }
    return week;
  };
  for (const day of days) {
    const players = new Set(
      input.memberships.filter((m) => validOn(m, day)).map((m) => m.playerId),
    );
    for (const playerId of players) {
      const statuses = statusesOf.get(`${playerId}|${day}`);
      if (statuses?.every((s) => !participationCarriesLoad(s)) === true) continue;
      const week = weekOf(day);
      const done = answered.has(`${playerId}|${day}`) ? 1 : 0;
      total.wellness.expected += 1;
      total.wellness.answered += done;
      week.wellness.expected += 1;
      week.wellness.answered += done;
    }
  }
  for (const p of input.participations) {
    if (!daySet.has(p.localDate) || !participationCarriesLoad(p.status)) continue;
    const week = weekOf(p.localDate);
    const done = p.rpeReported ? 1 : 0;
    total.rpe.expected += 1;
    total.rpe.answered += done;
    week.rpe.expected += 1;
    week.rpe.answered += done;
  }
  return {
    sessionDays: days.length,
    wellness: total.wellness,
    rpe: total.rpe,
    weeks: [...weeks]
      .sort(([a], [b]) => compareLocalDates(a, b))
      .map(([weekStart, counts]) => ({ weekStart, ...counts })),
  };
}

/**
 * The days the response rate covers: from the day after the previous window
 * of the season ends (or the season's first day) to the end of the window,
 * or today while it is open.
 */
export function responsePeriod(
  window: Pick<CategoryReportWindow, 'seasonStartsOn' | 'startsOn'>,
  previousWindowEndsOn: LocalDate | null,
  asOf: LocalDate,
): { from: LocalDate; to: LocalDate } {
  let from =
    previousWindowEndsOn === null ? window.seasonStartsOn : addDays(previousWindowEndsOn, 1);
  // A season that starts after its first window (data entered that way): from the window.
  if (compareLocalDates(from, window.startsOn) > 0) from = window.startsOn;
  return { from, to: asOf };
}

// ─── Assembly ────────────────────────────────────────────────────────────────────────

export async function buildCategoryReportContent(
  db: TenantDatabase,
  options: {
    readonly clubId: ClubId;
    readonly category: ReportCategory;
    readonly window: CategoryReportWindow;
    readonly today: LocalDate;
    readonly testOrder: (a: string, b: string) => number;
  },
): Promise<CategoryReportContent> {
  const { clubId, category, window, today, testOrder } = options;
  const closed = compareLocalDates(window.endsOn, today) < 0;
  const asOf = closed ? window.endsOn : today;

  const [clubRow] = await db
    .select({
      name: club.name,
      shortName: club.shortName,
      primaryColor: club.primaryColor,
      secondaryColor: club.secondaryColor,
      logoFileId: club.logoFileId,
      timeZone: club.timeZone,
      locale: club.locale,
    })
    .from(club)
    .where(eq(club.id, clubId));
  if (clubRow === undefined) throw new Error('buildCategoryReportContent: the club is not visible');

  // ─── Roster: the category at the end of the window (or today) ──────────────────────
  const rosterRows = await db
    .select({ playerId: playerCategory.playerId, sex: player.sex })
    .from(playerCategory)
    .innerJoin(
      player,
      and(eq(player.clubId, playerCategory.clubId), eq(player.id, playerCategory.playerId)),
    )
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        eq(playerCategory.categoryId, category.id),
        lte(playerCategory.validFrom, asOf),
        or(isNull(playerCategory.validTo), gt(playerCategory.validTo, asOf)),
      ),
    );
  const roster = [...new Map(rosterRows.map((r) => [r.playerId, r])).values()];
  const rosterIds = roster.map((r) => r.playerId);
  const stageSources = await loadStageSources(db, clubId, rosterIds);
  const stageOf = new Map(
    roster.map((r) => [r.playerId, stageContextOn(stageSources, r.playerId, asOf, category.id)]),
  );
  const byStage = new Map<Stage, number>();
  for (const context of stageOf.values()) {
    if (context === undefined) continue;
    byStage.set(context.stage, (byStage.get(context.stage) ?? 0) + 1);
  }

  // ─── Battery of the window ─────────────────────────────────────────────────────────
  const entries = await batteryEntries(db, clubId, category.sport);
  const expected = new Map<string, string[]>();
  for (const r of roster) {
    const stage = stageOf.get(r.playerId);
    if (stage === undefined) continue;
    expected.set(r.playerId, scheduledTests(entries, clubId, r.sex, stage, asOf, window.number));
  }
  const inWindow = or(
    eq(testSession.testWindowId, window.id),
    and(
      isNull(testSession.testWindowId),
      gte(testResult.measuredOn, window.startsOn),
      lte(testResult.measuredOn, window.endsOn),
    ),
  );
  const windowResults =
    rosterIds.length === 0
      ? []
      : await db
          .select({
            playerId: testResult.playerId,
            testCode: testDefinition.code,
            measuredOn: testResult.measuredOn,
            status: testResult.status,
            reason: testResultColumns.notDoneReason,
          })
          .from(testResult)
          .innerJoin(
            testDefinition,
            and(
              eq(testDefinition.clubId, testResult.clubId),
              eq(testDefinition.id, testResult.testDefinitionId),
            ),
          )
          .leftJoin(
            testSession,
            and(
              eq(testSession.clubId, testResult.clubId),
              eq(testSession.id, testResult.testSessionId),
            ),
          )
          .where(
            and(eq(testResult.clubId, clubId), inArray(testResult.playerId, rosterIds), inWindow),
          );
  const battery = batteryCompliance(expected, windowResults, testOrder);

  // ─── Evolution of the group: this window and the ones before it ────────────────────
  const windowRows = await db
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
    .where(
      and(
        eq(testWindow.clubId, clubId),
        eq(season.sport, category.sport),
        isNull(testWindow.archivedAt),
        isNull(season.archivedAt),
        lte(testWindow.startsOn, window.startsOn),
      ),
    )
    .orderBy(asc(testWindow.startsOn));
  const columns: CategoryReportColumn[] = windowRows
    .slice(-CATEGORY_REPORT_EVOLUTION_COLUMNS)
    .map((w) => ({
      key: `w:${w.id}`,
      testWindowId: w.id as CategoryReportColumn['testWindowId'],
      seasonName: w.seasonName,
      number: w.number,
      startsOn: w.startsOn,
      endsOn: w.endsOn,
    }));
  const metrics = await testMetrics(db, clubId, false);
  const oldest = columns[0];
  const columnOf = (row: { testWindowId: string | null; measuredOn: LocalDate }) =>
    columns.find((c) =>
      row.testWindowId === null
        ? within(row.measuredOn, c.startsOn, c.endsOn)
        : c.testWindowId === row.testWindowId,
    );
  let scores: GroupScore[] = [];
  if (oldest !== undefined && rosterIds.length > 0) {
    const resultRows = await db
      .select({ ...testResultColumns, testWindowId: testSession.testWindowId })
      .from(testResult)
      .innerJoin(
        testDefinition,
        and(
          eq(testDefinition.clubId, testResult.clubId),
          eq(testDefinition.id, testResult.testDefinitionId),
        ),
      )
      .leftJoin(
        testSession,
        and(
          eq(testSession.clubId, testResult.clubId),
          eq(testSession.id, testResult.testSessionId),
        ),
      )
      .where(
        and(
          eq(testResult.clubId, clubId),
          inArray(testResult.playerId, rosterIds),
          eq(testResult.status, 'done'),
          isNotNull(testResult.method),
          or(
            inArray(
              testSession.testWindowId,
              columns.map((c) => c.testWindowId),
            ),
            and(
              isNull(testSession.testWindowId),
              gte(testResult.measuredOn, oldest.startsOn),
              lte(testResult.measuredOn, window.endsOn),
            ),
          ),
        ),
      );
    const placed = new Map(
      resultRows.flatMap((row) => {
        const column = columnOf(row);
        return column === undefined ? [] : [[row.id, column.key] as const];
      }),
    );
    const dtos = await testResultDtos(
      db,
      clubId,
      resultRows.filter((row) => placed.has(row.id)),
    );
    scores = dtos.flatMap((dto) => {
      const columnKey = placed.get(dto.id);
      const { method } = dto;
      if (columnKey === undefined || method === null) return [];
      return dto.scores
        .filter((score) => metrics.has(score.metricCode))
        .map((score) => ({
          playerId: dto.playerId,
          columnKey,
          testCode: dto.testCode,
          metricCode: score.metricCode,
          exercise: dto.exercise,
          measuredOn: dto.measuredOn,
          method,
          protocolVersion: dto.protocolVersion,
          value: score.value,
        }));
    });
  }
  const references = (
    await firstTeamReferencesOf(db, clubId, { id: null, sex: category.sex }, category.sport, asOf)
  ).items;
  const evolutionMetrics = groupEvolution(columns, scores, metrics, references, testOrder);

  // ─── Response rate since the previous window ───────────────────────────────────────
  const [previousWindow] = await db
    .select({ endsOn: testWindow.endsOn })
    .from(testWindow)
    .where(
      and(
        eq(testWindow.clubId, clubId),
        eq(testWindow.seasonId, window.seasonId),
        isNull(testWindow.archivedAt),
        lt(testWindow.endsOn, window.startsOn),
      ),
    )
    .orderBy(sql`${testWindow.endsOn} desc`)
    .limit(1);
  const period = responsePeriod(window, previousWindow?.endsOn ?? null, asOf);
  const memberships = await db
    .select({
      playerId: playerCategory.playerId,
      validFrom: playerCategory.validFrom,
      validTo: playerCategory.validTo,
    })
    .from(playerCategory)
    .innerJoin(
      player,
      and(eq(player.clubId, playerCategory.clubId), eq(player.id, playerCategory.playerId)),
    )
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        eq(playerCategory.categoryId, category.id),
        lte(playerCategory.validFrom, period.to),
        or(isNull(playerCategory.validTo), gt(playerCategory.validTo, period.from)),
      ),
    );
  const sessions = await db
    .select({ id: trainingSession.id, localDate: trainingSession.localDate })
    .from(trainingSession)
    .where(
      and(
        eq(trainingSession.clubId, clubId),
        eq(trainingSession.categoryId, category.id),
        isNull(trainingSession.archivedAt),
        gte(trainingSession.localDate, period.from),
        lte(trainingSession.localDate, period.to),
        // Only sessions that already started: nobody answers for one still ahead.
        lte(trainingSession.startsAt, sql`now()`),
      ),
    );
  const sessionIds = sessions.map((s) => s.id);
  const dayOfSession = new Map(sessions.map((s) => [s.id, s.localDate]));
  const participations =
    sessionIds.length === 0
      ? []
      : await db
          .select({
            playerId: participation.playerId,
            trainingSessionId: participation.trainingSessionId,
            status: participation.status,
            rpe: participation.rpe,
          })
          .from(participation)
          .where(
            and(
              eq(participation.clubId, clubId),
              inArray(participation.trainingSessionId, sessionIds),
            ),
          );
  const memberIds = [...new Set(memberships.map((m) => m.playerId))] as PlayerId[];
  const wellnessDays =
    memberIds.length === 0 || sessions.length === 0
      ? []
      : await db
          .select({ playerId: wellness.playerId, localDate: wellness.localDate })
          .from(wellness)
          .where(
            and(
              eq(wellness.clubId, clubId),
              inArray(wellness.playerId, memberIds),
              gte(wellness.localDate, period.from),
              lte(wellness.localDate, period.to),
            ),
          );
  const responses = responseCounts({
    memberships,
    sessionDays: sessions.map((s) => s.localDate),
    participations: participations.flatMap((p) => {
      const localDate = dayOfSession.get(p.trainingSessionId);
      return localDate === undefined
        ? []
        : [{ playerId: p.playerId, localDate, status: p.status, rpeReported: p.rpe !== null }];
    }),
    wellnessDays,
  });

  const content: CategoryReportContent = {
    formatVersion: CATEGORY_REPORT_FORMAT_VERSION,
    locale: clubRow.locale,
    timeZone: clubRow.timeZone,
    generatedOn: today,
    club: {
      name: clubRow.name,
      shortName: clubRow.shortName,
      primaryColor: clubRow.primaryColor,
      secondaryColor: clubRow.secondaryColor,
      logoFileId: (clubRow.logoFileId ?? null) as CategoryReportContent['club']['logoFileId'],
    },
    category: {
      id: category.id,
      name: category.name,
      sport: category.sport,
      sex: category.sex,
      ageBandCode: category.ageBandCode,
    },
    window: {
      id: window.id as CategoryReportContent['window']['id'],
      seasonName: window.seasonName,
      number: window.number,
      startsOn: window.startsOn,
      endsOn: window.endsOn,
      closed,
    },
    roster: {
      players: roster.length,
      byStage: STAGES.flatMap((stage) => {
        const players = byStage.get(stage) ?? 0;
        return players === 0 ? [] : [{ stage, players }];
      }),
    },
    battery,
    evolution: { columns, metrics: evolutionMetrics },
    responses: { from: period.from, to: period.to, ...responses },
  };
  // The worker renders exactly this format: never store what it could not read.
  return categoryReportContentSchema.parse(content);
}
