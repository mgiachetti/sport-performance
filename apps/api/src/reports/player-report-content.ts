import {
  playerReportContentSchema,
  type PlayerFirstTeamReference,
  type PlayerReportContent,
  type PlayerReportTest,
  type TestEvolutionColumn,
  type TestEvolutionMetric,
} from '@sport-performance/contracts';
import {
  anthroMeasurement,
  category,
  club,
  player,
  playerCategory,
  season,
  testDefinition,
  testResult,
  testSession,
  testWindow,
} from '@sport-performance/db/schema';
import {
  PLAYER_REPORT_EVOLUTION_COLUMNS,
  PLAYER_REPORT_FORMAT_VERSION,
  ageInCompletedYears,
  compareLocalDates,
  notDoneReasonForViewer,
  type ClubId,
  type LocalDate,
  type Sport,
  type TestNotDoneReason,
} from '@sport-performance/domain';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import type { TenantDatabase } from '../db/database.js';
import { categoryCurrentOn } from '../routes/training-shared.js';
import {
  FIRST_DAY,
  ageBandsOf,
  evolution,
  groupSpan,
  peakZoneOf,
  readSamples,
  testMetrics,
  type ProfileTarget,
} from '../routes/player-profile.js';
import { firstTeamReferencesOf, referenceSportOf } from '../routes/reference-values.js';

/**
 * The snapshot of a player report (B-602, ADR 0069), read in the transaction
 * of the request with the context of the staff member who asks for it and
 * the same rules as the player profile (ADR 0060): the player's own values,
 * their category's average only once the window is over and with the
 * minimum of players, the first team's references and the maturation. No
 * name or value of another player, no percentile, nothing medical (an
 * injury is `unavailable`, ADR 0029).
 */

export interface ReportWindow {
  readonly id: string;
  readonly seasonName: string;
  readonly sport: Sport;
  readonly number: number;
  readonly startsOn: LocalDate;
  readonly endsOn: LocalDate;
}

const columnKeyOfWindow = (windowId: string) => `w:${windowId}`;

/**
 * The window's tests and the evolution up to it, from the profile's
 * evolution: each metric with a value in the window, its previous column,
 * the category's average and the first team's reference; the evolution keeps
 * the window and up to {@link PLAYER_REPORT_EVOLUTION_COLUMNS} − 1 columns
 * before it.
 */
export function reportTests(
  series: { columns: readonly TestEvolutionColumn[]; metrics: readonly TestEvolutionMetric[] },
  windowId: string,
  references: readonly PlayerFirstTeamReference[],
): {
  tests: PlayerReportTest[];
  evolution: { columns: TestEvolutionColumn[]; metrics: TestEvolutionMetric[] };
} {
  const key = columnKeyOfWindow(windowId);
  const position = series.columns.findIndex((column) => column.key === key);
  const kept =
    position === -1
      ? []
      : series.columns.slice(
          Math.max(0, position - PLAYER_REPORT_EVOLUTION_COLUMNS + 1),
          position + 1,
        );
  const keptKeys = new Set(kept.map((column) => column.key));
  const columnByKey = new Map(series.columns.map((column) => [column.key, column]));
  const referenceOf = new Map(references.map((reference) => [reference.metricCode, reference]));

  const tests: PlayerReportTest[] = [];
  const metrics: TestEvolutionMetric[] = [];
  for (const metric of series.metrics) {
    const index = metric.points.findIndex((point) => point.columnKey === key);
    const point = metric.points[index];
    if (point !== undefined) {
      const before = index > 0 ? metric.points[index - 1] : undefined;
      const previousColumn = before === undefined ? undefined : columnByKey.get(before.columnKey);
      const reference = metric.exercise === null ? referenceOf.get(metric.metricCode) : undefined;
      tests.push({
        testCode: metric.testCode,
        metricCode: metric.metricCode,
        exercise: metric.exercise,
        unit: metric.unit,
        direction: metric.direction,
        value: point.value,
        measuredOn: point.measuredOn,
        methods: point.methods,
        previous:
          before === undefined || previousColumn === undefined
            ? null
            : {
                seasonName: previousColumn.seasonName,
                number: previousColumn.number,
                startsOn: previousColumn.startsOn,
                value: before.value,
                methods: before.methods,
              },
        categoryAverage: point.categoryAverage,
        categoryMixedMethods: point.categoryMixedMethods,
        categoryMixedProtocolVersions: point.categoryMixedProtocolVersions,
        firstTeam:
          reference?.unit !== metric.unit
            ? null
            : { value: reference.value, unit: reference.unit, scope: reference.scope },
        warnings: metric.warnings,
      });
    }
    const points = metric.points.filter((p) => keptKeys.has(p.columnKey));
    if (points.length > 0) metrics.push({ ...metric, points });
  }
  return { tests, evolution: { columns: kept, metrics } };
}

/** The not-done results of the window without a done one of the same test after them. */
export function reportNotDone(
  rows: readonly {
    testCode: string;
    measuredOn: LocalDate;
    status: 'done' | 'not_done';
    reason: TestNotDoneReason | null;
  }[],
): PlayerReportContent['notDone'] {
  const latestDone = new Map<string, LocalDate>();
  for (const row of rows) {
    if (row.status !== 'done') continue;
    const current = latestDone.get(row.testCode);
    if (current === undefined || compareLocalDates(row.measuredOn, current) > 0) {
      latestDone.set(row.testCode, row.measuredOn);
    }
  }
  const latestNotDone = new Map<string, PlayerReportContent['notDone'][number]>();
  for (const row of rows) {
    if (row.status !== 'not_done' || row.reason === null) continue;
    const done = latestDone.get(row.testCode);
    if (done !== undefined && compareLocalDates(done, row.measuredOn) >= 0) continue;
    const current = latestNotDone.get(row.testCode);
    if (current !== undefined && compareLocalDates(current.measuredOn, row.measuredOn) >= 0) {
      continue;
    }
    latestNotDone.set(row.testCode, {
      testCode: row.testCode,
      measuredOn: row.measuredOn,
      // The family reads it: an injury is "not available", never the cause (ADR 0029).
      reason: notDoneReasonForViewer(row.reason, 'parent'),
    });
  }
  return [...latestNotDone.values()].sort((a, b) => a.testCode.localeCompare(b.testCode));
}

export async function buildPlayerReportContent(
  db: TenantDatabase,
  options: {
    readonly clubId: ClubId;
    readonly target: ProfileTarget;
    readonly window: ReportWindow;
    readonly today: LocalDate;
  },
): Promise<PlayerReportContent> {
  const { clubId, target, window, today } = options;
  // What the report shows is as of the end of the window, or today while it is open.
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
  const [playerRow] = await db
    .select({
      firstName: player.firstName,
      lastName: player.lastName,
      birthDate: player.birthDate,
      sex: player.sex,
      sport: player.sport,
    })
    .from(player)
    .where(and(eq(player.clubId, clubId), eq(player.id, target.id)));
  if (clubRow === undefined || playerRow === undefined) {
    throw new Error('buildPlayerReportContent: the club or the player is not visible');
  }

  const categories = await db
    .select({ name: category.name })
    .from(playerCategory)
    .innerJoin(
      category,
      and(eq(category.clubId, playerCategory.clubId), eq(category.id, playerCategory.categoryId)),
    )
    .where(
      and(
        eq(playerCategory.clubId, clubId),
        eq(playerCategory.playerId, target.id),
        eq(category.sport, window.sport),
        categoryCurrentOn(asOf),
      ),
    )
    .orderBy(asc(category.sortOrder), asc(category.name));

  // The evolution up to the end of the window, with the profile's rules (ADR 0060).
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
  const own = await read({ from: FIRST_DAY, to: window.endsOn, onlySubject: true });
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
  const span = groupSpan(own, windows);
  const group = span === null ? [] : await read(span);
  const series = evolution(own, group, metrics, windows, today);

  const sportOf = await referenceSportOf(db, clubId, target.id, asOf, today);
  const references =
    sportOf === undefined
      ? []
      : (
          await firstTeamReferencesOf(
            db,
            clubId,
            { id: target.id, sex: target.sex },
            sportOf.sport,
            asOf,
          )
        ).items;
  const { tests, evolution: kept } = reportTests(series, window.id, references);

  const results = await db
    .select({
      testCode: testDefinition.code,
      measuredOn: testResult.measuredOn,
      status: testResult.status,
      reason: testResult.notDoneReason,
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
      and(eq(testSession.clubId, testResult.clubId), eq(testSession.id, testResult.testSessionId)),
    )
    .where(
      and(
        eq(testResult.clubId, clubId),
        eq(testResult.playerId, target.id),
        or(
          eq(testSession.testWindowId, window.id),
          and(
            isNull(testSession.testWindowId),
            gte(testResult.measuredOn, window.startsOn),
            lte(testResult.measuredOn, window.endsOn),
          ),
        ),
      ),
    );

  const [measurement] = await db
    .select({
      measuredOn: anthroMeasurement.measuredOn,
      heightCm: anthroMeasurement.heightCm,
      sittingHeightCm: anthroMeasurement.sittingHeightCm,
      weightKg: anthroMeasurement.weightKg,
      phvOffsetYears: anthroMeasurement.phvOffsetYears,
      maturityOffsetEquation: anthroMeasurement.maturityOffsetEquation,
      predictedAdultHeightCm: anthroMeasurement.predictedAdultHeightCm,
      adultHeightPct: anthroMeasurement.adultHeightPct,
      growthVelocityCmYear: anthroMeasurement.growthVelocityCmYear,
    })
    .from(anthroMeasurement)
    .where(
      and(
        eq(anthroMeasurement.clubId, clubId),
        eq(anthroMeasurement.playerId, target.id),
        lte(anthroMeasurement.measuredOn, asOf),
      ),
    )
    .orderBy(
      desc(anthroMeasurement.measuredOn),
      desc(anthroMeasurement.createdAt),
      desc(anthroMeasurement.id),
    )
    .limit(1);

  const content: PlayerReportContent = {
    formatVersion: PLAYER_REPORT_FORMAT_VERSION,
    locale: clubRow.locale,
    timeZone: clubRow.timeZone,
    generatedOn: today,
    club: {
      name: clubRow.name,
      shortName: clubRow.shortName,
      primaryColor: clubRow.primaryColor,
      secondaryColor: clubRow.secondaryColor,
      logoFileId: (clubRow.logoFileId ?? null) as PlayerReportContent['club']['logoFileId'],
    },
    player: {
      firstName: playerRow.firstName,
      lastName: playerRow.lastName,
      birthDate: playerRow.birthDate,
      sex: playerRow.sex,
      sport: playerRow.sport,
      ageYears: ageInCompletedYears(playerRow.birthDate, asOf),
      categories: categories.map((row) => row.name),
    },
    window: {
      id: window.id as PlayerReportContent['window']['id'],
      seasonName: window.seasonName,
      number: window.number,
      startsOn: window.startsOn,
      endsOn: window.endsOn,
      closed,
    },
    tests,
    notDone: reportNotDone(results),
    evolution: kept,
    maturation:
      measurement === undefined
        ? null
        : {
            ...measurement,
            inPeakZone: peakZoneOf([measurement], asOf)?.inZone ?? null,
          },
  };
  // The worker renders exactly this format: never store what it could not read.
  return playerReportContentSchema.parse(content);
}
