import { schema } from '@sport-performance/db';
import { loadKhamisRocheTable } from '@sport-performance/db/seeds';
import {
  addDays,
  compareLocalDates,
  deriveMaturation,
  localDateInTimeZone,
  parseLocalDate,
  parseTimeZone,
  resolveDerivedParameters,
  wellnessBaselineSeries,
  wellnessMeanScore,
  type ClubId,
  type DerivedParameters,
  type KhamisRocheTable,
  type LocalDate,
  type PlayerId,
} from '@sport-performance/domain';
import { and, asc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { Logger } from 'pino';
import { inClubTransaction, type ClubTransaction } from '../database.js';
import {
  evaluatePlayerAlerts,
  readAlertRules,
  readAlertsDue,
  type ClubAlertRule,
} from '../alerts/evaluate.js';
import { planLoadDaily, type LoadDailyRow } from './load-rows.js';

const {
  anthroMeasurement,
  club,
  derivedRefresh,
  khamisRocheTable,
  participation,
  player,
  playerLoadDaily,
  playerParentHeight,
  playerWellnessDaily,
  trainingSession,
  wellness,
} = schema;

/** `load_from` / `wellness_from` meaning "the whole series" (migration 0021). */
export const WHOLE_SERIES_FROM = parseLocalDate('1900-01-01');

/** Pending recalculations read per round; a club with more takes several rounds. */
export const REFRESH_BATCH_SIZE = 500;
/** Rounds per job; what is left is picked up by the next job of the club. */
const MAX_ROUNDS = 20;
/** Rows per INSERT (about 20 parameters each, well under Postgres' 65 535). */
const INSERT_CHUNK = 1000;

/** What to recalculate for one player. */
export interface PlayerRefresh {
  readonly playerId: PlayerId;
  readonly loadFrom: LocalDate | null;
  readonly wellnessFrom: LocalDate | null;
  readonly maturation: boolean;
  /**
   * `requested_at` of the pending row, as Postgres prints it (full
   * precision), for the compare-and-delete; `null` for the daily extension,
   * which has no pending row.
   */
  readonly requestedAt: string | null;
}

export interface RefreshDependencies {
  /** Pool of a `sport_performance_worker` login. */
  readonly pool: pg.Pool;
  readonly logger: Logger;
  /** Current instant; injectable so tests can move "today". */
  readonly now?: () => Date;
}

export interface ClubRefreshReport {
  readonly clubId: ClubId;
  /** Today in the club's zone (the last day of every load series); `null` if the club is gone. */
  readonly today: LocalDate | null;
  readonly players: number;
  readonly failed: number;
  /** Pending recalculations left for the next job (more than the rounds of one job). */
  readonly remaining: boolean;
}

/** Thrown at the end of a club job when some players failed: pg-boss retries the job. */
export class ClubRefreshError extends Error {
  override readonly name = 'ClubRefreshError';
  constructor(
    readonly clubId: ClubId,
    readonly failed: number,
  ) {
    super(
      `Derived values of ${String(failed)} player(s) of club ${clubId} could not be refreshed.`,
    );
  }
}

interface ClubState {
  readonly today: LocalDate;
  readonly parameters: DerivedParameters;
}

async function readClubState(tx: ClubTransaction, now: Date): Promise<ClubState | null> {
  const [row] = await tx.db
    .select({ timeZone: club.timeZone, settings: club.settings })
    .from(club)
    .limit(1);
  if (row === undefined) return null;
  const today = localDateInTimeZone(now, parseTimeZone(row.timeZone));
  // An invalid configuration fails the job loudly: a typo never silently falls back.
  const parameters = resolveDerivedParameters(row.settings.derived);
  return { today, parameters };
}

async function readPending(tx: ClubTransaction): Promise<PlayerRefresh[]> {
  const rows = await tx.db
    .select({
      playerId: derivedRefresh.playerId,
      loadFrom: derivedRefresh.loadFrom,
      wellnessFrom: derivedRefresh.wellnessFrom,
      maturation: derivedRefresh.maturation,
      requestedAt: sql<string>`${derivedRefresh.requestedAt}::text`,
    })
    .from(derivedRefresh)
    .orderBy(asc(derivedRefresh.requestedAt))
    .limit(REFRESH_BATCH_SIZE);
  return rows;
}

/**
 * Players whose stored load series ends before today (or before the day they
 * left): the EWMA decays every day even without new load, so the nightly
 * pass extends their series.
 */
async function readStale(tx: ClubTransaction, today: LocalDate): Promise<PlayerRefresh[]> {
  const { rows } = await tx.client.query<{ player_id: PlayerId; last: LocalDate }>(
    `select d.player_id, max(d.local_date)::text as last
       from player_load_daily d
       join player p on p.club_id = d.club_id and p.id = d.player_id
      group by d.player_id, p.left_on
     having max(d.local_date) < least($1::date, coalesce(p.left_on, $1::date))`,
    [today],
  );
  return rows.map((r) => ({
    playerId: r.player_id,
    loadFrom: addDays(r.last, 1),
    wellnessFrom: null,
    maturation: false,
    requestedAt: null,
  }));
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function loadRowValues(clubId: ClubId, playerId: PlayerId, now: Date, row: LoadDailyRow) {
  return {
    clubId,
    playerId,
    localDate: row.date,
    loadAu: row.loadAu,
    hasData: row.hasData,
    sessionsN: row.sessionsN,
    pendingRpeN: row.pendingRpeN,
    historyDays: row.historyDays,
    acuteEwmaAu: row.acuteEwmaAu,
    chronicEwmaAu: row.chronicEwmaAu,
    acwr: row.acwr,
    acwrStatus: row.acwrStatus,
    missingDaysAcute: row.missingDaysInAcuteWindow,
    missingDaysChronic: row.missingDaysInChronicWindow,
    windowLoadAu: row.windowLoadAu,
    monotony: row.monotony,
    strainAu: row.strainAu,
    monotonyStatus: row.monotonyStatus,
    computedAt: now,
  };
}

async function refreshLoad(
  tx: ClubTransaction,
  clubId: ClubId,
  playerId: PlayerId,
  from: LocalDate,
  end: LocalDate,
  state: ClubState,
  now: Date,
): Promise<number> {
  const participations = await tx.db
    .select({
      date: trainingSession.localDate,
      status: participation.status,
      minutes: participation.minutes,
      rpe: participation.rpe,
      srpeAu: participation.srpeAu,
    })
    .from(participation)
    .innerJoin(
      trainingSession,
      and(
        eq(trainingSession.clubId, participation.clubId),
        eq(trainingSession.id, participation.trainingSessionId),
      ),
    )
    .where(
      and(
        eq(participation.playerId, playerId),
        isNull(trainingSession.archivedAt),
        lte(trainingSession.localDate, end),
      ),
    );
  const plan = planLoadDaily({
    participations,
    requestedFrom: from,
    end,
    parameters: state.parameters.load,
  });

  const stale =
    plan.replaceFrom === null || plan.historyStart === null
      ? undefined
      : or(
          gte(playerLoadDaily.localDate, plan.replaceFrom),
          sql`${playerLoadDaily.localDate} < ${plan.historyStart}`,
          sql`${playerLoadDaily.localDate} > ${plan.end}`,
        );
  await tx.db.delete(playerLoadDaily).where(and(eq(playerLoadDaily.playerId, playerId), stale));
  for (const chunk of chunks(plan.rows, INSERT_CHUNK)) {
    await tx.db
      .insert(playerLoadDaily)
      .values(chunk.map((row) => loadRowValues(clubId, playerId, now, row)));
  }
  return plan.rows.length;
}

async function refreshWellness(
  tx: ClubTransaction,
  clubId: ClubId,
  playerId: PlayerId,
  from: LocalDate,
  state: ClubState,
  now: Date,
): Promise<number> {
  const entries = await tx.db
    .select({
      date: wellness.localDate,
      itemCount: wellness.itemCount,
      sleep: wellness.sleep,
      fatigue: wellness.fatigue,
      soreness: wellness.soreness,
      stress: wellness.stress,
      mood: wellness.mood,
    })
    .from(wellness)
    .where(eq(wellness.playerId, playerId));
  const series = wellnessBaselineSeries(
    entries.map((e) => ({ date: e.date, itemCount: e.itemCount, meanScore: wellnessMeanScore(e) })),
    state.parameters.wellnessBaseline,
  ).filter((day) => compareLocalDates(day.date, from) >= 0);

  await tx.db
    .delete(playerWellnessDaily)
    .where(
      and(eq(playerWellnessDaily.playerId, playerId), gte(playerWellnessDaily.localDate, from)),
    );
  for (const chunk of chunks(series, INSERT_CHUNK)) {
    await tx.db.insert(playerWellnessDaily).values(
      chunk.map((day) => ({
        clubId,
        playerId,
        localDate: day.date,
        itemCount: day.itemCount,
        meanScore: day.meanScore,
        baselineSamples: day.baselineSamples,
        baselineMeanScore: day.baselineMeanScore,
        baselineSdScore: day.baselineSdScore,
        zScore: day.zScore,
        computedAt: now,
      })),
    );
  }
  return series.length;
}

interface KhamisRocheReference {
  readonly id: string;
  readonly table: KhamisRocheTable;
}

async function readKhamisRoche(
  tx: ClubTransaction,
  clubId: ClubId,
  code: string,
): Promise<KhamisRocheReference | null> {
  const [header] = await tx.db
    .select({ id: khamisRocheTable.id })
    .from(khamisRocheTable)
    .where(eq(khamisRocheTable.code, code));
  if (header === undefined) return null;
  const table = await loadKhamisRocheTable(tx.db, clubId, code);
  return table === undefined ? null : { id: header.id, table };
}

const same = (a: number | null, b: number | null): boolean =>
  a === b || (a !== null && b !== null && Math.abs(a - b) < 1e-12);

async function refreshMaturation(
  tx: ClubTransaction,
  clubId: ClubId,
  subject: {
    readonly id: PlayerId;
    readonly sex: 'male' | 'female';
    readonly birthDate: LocalDate;
  },
  state: ClubState,
  khamisRoche: KhamisRocheReference | null,
  now: Date,
): Promise<number> {
  const measurements = await tx.db
    .select({
      id: anthroMeasurement.id,
      date: anthroMeasurement.measuredOn,
      heightCm: anthroMeasurement.heightCm,
      sittingHeightCm: anthroMeasurement.sittingHeightCm,
      weightKg: anthroMeasurement.weightKg,
      phvOffsetYears: anthroMeasurement.phvOffsetYears,
      maturityOffsetEquation: anthroMeasurement.maturityOffsetEquation,
      adultHeightPct: anthroMeasurement.adultHeightPct,
      predictedAdultHeightCm: anthroMeasurement.predictedAdultHeightCm,
      khamisRocheTableId: anthroMeasurement.khamisRocheTableId,
      growthVelocityCmYear: anthroMeasurement.growthVelocityCmYear,
      derivedAt: anthroMeasurement.derivedAt,
    })
    .from(anthroMeasurement)
    .where(eq(anthroMeasurement.playerId, subject.id))
    .orderBy(asc(anthroMeasurement.measuredOn), asc(anthroMeasurement.createdAt));
  if (measurements.length === 0) return 0;
  const parents = await tx.db
    .select({ parent: playerParentHeight.parent, heightCm: playerParentHeight.heightCm })
    .from(playerParentHeight)
    .where(eq(playerParentHeight.playerId, subject.id));

  const results = deriveMaturation({
    sex: subject.sex,
    birthDate: subject.birthDate,
    measurements,
    motherHeightCm: parents.find((p) => p.parent === 'mother')?.heightCm ?? null,
    fatherHeightCm: parents.find((p) => p.parent === 'father')?.heightCm ?? null,
    khamisRocheTable: khamisRoche?.table ?? null,
    params: state.parameters.maturation,
  });

  let updated = 0;
  for (const [index, result] of results.entries()) {
    const current = measurements[index];
    if (current === undefined) continue;
    const tableId = result.khamisRocheTableCode === null ? null : (khamisRoche?.id ?? null);
    const unchanged =
      current.derivedAt !== null &&
      same(current.phvOffsetYears, result.phvOffsetYears) &&
      current.maturityOffsetEquation === result.maturityOffsetEquation &&
      same(current.adultHeightPct, result.adultHeightPct) &&
      same(current.predictedAdultHeightCm, result.predictedAdultHeightCm) &&
      current.khamisRocheTableId === tableId &&
      same(current.growthVelocityCmYear, result.growthVelocityCmYear);
    if (unchanged) continue;
    await tx.db
      .update(anthroMeasurement)
      .set({
        phvOffsetYears: result.phvOffsetYears,
        maturityOffsetEquation: result.maturityOffsetEquation,
        adultHeightPct: result.adultHeightPct,
        predictedAdultHeightCm: result.predictedAdultHeightCm,
        khamisRocheTableId: tableId,
        growthVelocityCmYear: result.growthVelocityCmYear,
        derivedAt: now,
      })
      .where(and(eq(anthroMeasurement.clubId, clubId), eq(anthroMeasurement.id, result.id)));
    updated += 1;
  }
  return updated;
}

/**
 * Recalculates one player in one transaction of the club: the load series,
 * the wellness baseline and the maturation that `work` asks for, then closes
 * the pending row only if no write marked it again meanwhile
 * (compare-and-delete on `requested_at`). A per-player advisory lock keeps
 * two replicas from writing the same player at once.
 */
export async function refreshPlayer(
  deps: RefreshDependencies,
  clubId: ClubId,
  work: PlayerRefresh,
  options: {
    readonly requestId?: string;
    readonly khamisRoche?: KhamisRocheReference | null;
    /** The club's alert rules, when the caller already read them (one read per job). */
    readonly alertRules?: readonly ClubAlertRule[];
  } = {},
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  await inClubTransaction(
    deps.pool,
    clubId,
    async (tx) => {
      await tx.client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `derived:${work.playerId}`,
      ]);
      const state = await readClubState(tx, now);
      const [subject] = await tx.db
        .select({
          id: player.id,
          sex: player.sex,
          sport: player.sport,
          birthDate: player.birthDate,
          leftOn: player.leftOn,
        })
        .from(player)
        .where(eq(player.id, work.playerId));
      if (state !== null && subject !== undefined) {
        const end =
          subject.leftOn !== null && compareLocalDates(subject.leftOn, state.today) < 0
            ? subject.leftOn
            : state.today;
        if (work.loadFrom !== null) {
          await refreshLoad(tx, clubId, subject.id, work.loadFrom, end, state, now);
        }
        if (work.wellnessFrom !== null) {
          await refreshWellness(tx, clubId, subject.id, work.wellnessFrom, state, now);
        }
        if (work.maturation) {
          const khamisRoche =
            options.khamisRoche !== undefined
              ? options.khamisRoche
              : await readKhamisRoche(tx, clubId, state.parameters.maturation.khamisRocheTableCode);
          await refreshMaturation(tx, clubId, subject, state, khamisRoche, now);
        }
        // Alerts read what was just derived (ADR 0053): every recalculation evaluates them.
        const rules = options.alertRules ?? (await readAlertRules(tx));
        await evaluatePlayerAlerts(tx, clubId, subject, state.today, rules, now);
      }
      if (work.requestedAt !== null) {
        await tx.client.query(
          'delete from derived_refresh where player_id = $1 and requested_at = $2::timestamptz',
          [work.playerId, work.requestedAt],
        );
      }
    },
    { requestId: options.requestId },
  );
}

function merge(
  pending: readonly PlayerRefresh[],
  stale: readonly PlayerRefresh[],
  alertsDue: readonly PlayerId[] = [],
): PlayerRefresh[] {
  const byPlayer = new Map(pending.map((p) => [p.playerId, p]));
  for (const s of stale) {
    const p = byPlayer.get(s.playerId);
    if (p === undefined) {
      byPlayer.set(s.playerId, s);
    } else if (
      p.loadFrom === null ||
      (s.loadFrom !== null && compareLocalDates(s.loadFrom, p.loadFrom) < 0)
    ) {
      byPlayer.set(s.playerId, { ...p, loadFrom: s.loadFrom });
    }
  }
  // The daily evaluation of alerts: nothing to recalculate, only today's evaluation.
  for (const playerId of alertsDue) {
    if (!byPlayer.has(playerId)) {
      byPlayer.set(playerId, {
        playerId,
        loadFrom: null,
        wellnessFrom: null,
        maturation: false,
        requestedAt: null,
      });
    }
  }
  return [...byPlayer.values()];
}

/**
 * The job of a club: every pending recalculation plus the daily extension of
 * the load series to today. One player failing does not stop the others;
 * the job fails at the end (and pg-boss retries it) if any did. Idempotent:
 * running it again recomputes the same values.
 */
export async function refreshClub(
  deps: RefreshDependencies,
  clubId: ClubId,
  options: { readonly jobId?: string } = {},
): Promise<ClubRefreshReport> {
  const now = deps.now?.() ?? new Date();
  const requestId = options.jobId === undefined ? undefined : `job:${options.jobId}`;
  const logger = deps.logger.child({ clubId, ...(options.jobId && { jobId: options.jobId }) });
  let players = 0;
  let failed = 0;
  let today: LocalDate | null = null;
  let remaining = false;
  let khamisRoche: KhamisRocheReference | null | undefined;
  let alertRules: readonly ClubAlertRule[] | undefined;
  const failedPlayers = new Set<PlayerId>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const batch = await inClubTransaction(deps.pool, clubId, async (tx) => {
      const state = await readClubState(tx, now);
      if (state === null) return null;
      khamisRoche ??= await readKhamisRoche(
        tx,
        clubId,
        state.parameters.maturation.khamisRocheTableCode,
      );
      // An invalid rule fails the job loudly, like invalid derived settings.
      alertRules ??= await readAlertRules(tx);
      const pending = await readPending(tx);
      const stale = round === 0 ? await readStale(tx, state.today) : [];
      const alertsDue = round === 0 ? await readAlertsDue(tx, state.today) : [];
      return { state, pending, work: merge(pending, stale, alertsDue) };
    });
    if (batch === null) {
      logger.warn('club not found; nothing to refresh');
      break;
    }
    today = batch.state.today;
    // Players that failed in this job stay pending; do not retry them in a loop.
    const work = batch.work.filter((w) => !failedPlayers.has(w.playerId));
    for (const item of work) {
      try {
        await refreshPlayer(deps, clubId, item, {
          ...(requestId && { requestId }),
          khamisRoche: khamisRoche ?? null,
          ...(alertRules !== undefined && { alertRules }),
        });
        players += 1;
      } catch (error) {
        failed += 1;
        failedPlayers.add(item.playerId);
        logger.error({ err: error, playerId: item.playerId }, 'derived refresh of a player failed');
      }
    }
    remaining = batch.pending.length >= REFRESH_BATCH_SIZE;
    if (!remaining) break;
  }

  const report: ClubRefreshReport = { clubId, today, players, failed, remaining };
  logger.info({ players, failed, today: report.today, remaining }, 'derived values refreshed');
  if (failed > 0) throw new ClubRefreshError(clubId, failed);
  return report;
}
