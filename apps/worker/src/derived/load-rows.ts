import {
  addDays,
  compareLocalDates,
  computeLoadSeries,
  participationCarriesLoad,
  type DailyLoadMetrics,
  type DatedLoad,
  type LoadParameters,
  type LocalDate,
  type ParticipationStatus,
} from '@sport-performance/domain';

/** A participation of the player, on the club day of its (not archived) session. */
export interface ParticipationLoad {
  readonly date: LocalDate;
  readonly status: ParticipationStatus;
  readonly minutes: number | null;
  readonly rpe: number | null;
  /** `rpe × minutes` (generated column); `null` without RPE or minutes. */
  readonly srpeAu: number | null;
}

/**
 * An activity outside the club reported by the player (B-511), not archived:
 * `srpeAu` = RPE × minutes (generated column, always set).
 */
export interface ExternalLoadEntry {
  readonly date: LocalDate;
  readonly srpeAu: number;
}

/** A row of `player_load_daily`, before ids and audit columns. */
export interface LoadDailyRow extends DailyLoadMetrics {
  readonly sessionsN: number;
  readonly pendingRpeN: number;
  /** Part of `loadAu` reported by the player outside the club. */
  readonly externalLoadAu: number;
  readonly externalN: number;
}

export interface LoadDailyPlan {
  /** First day of history (first day with load); `null` when the player has none. */
  readonly historyStart: LocalDate | null;
  /** Last day of the series: today in the club's zone, or the day the player left. */
  readonly end: LocalDate;
  /** Rows to write, from {@link replaceFrom} through {@link end}. */
  readonly rows: readonly LoadDailyRow[];
  /**
   * Stored rows on or after this day are replaced by {@link rows}; rows before
   * {@link historyStart} or after {@link end} are stale too. `null` when
   * there is no history (every stored row is stale).
   */
  readonly replaceFrom: LocalDate | null;
}

/**
 * The load series of one player to store, from the earliest day that may have
 * changed (`requestedFrom`, clamped to the first day of history). The EWMA is
 * always computed from the first day of history, so recalculating a suffix
 * gives the same values as a full rebuild. Only participations that carry
 * load and have an RPE count; one with minutes but no RPE yet is reported in
 * `pendingRpeN`, never counted as 0. External load the player reported
 * (B-511) adds to the day's load like a session, and is also counted apart
 * (`externalLoadAu`, `externalN`) so it always reads as "reported by the
 * player".
 */
export function planLoadDaily(input: {
  readonly participations: readonly ParticipationLoad[];
  readonly externalLoads?: readonly ExternalLoadEntry[];
  readonly requestedFrom: LocalDate;
  readonly end: LocalDate;
  readonly parameters: LoadParameters;
}): LoadDailyPlan {
  const { end } = input;
  const counts = new Map<
    LocalDate,
    { sessionsN: number; pendingRpeN: number; externalLoadAu: number; externalN: number }
  >();
  const countOf = (date: LocalDate) =>
    counts.get(date) ?? { sessionsN: 0, pendingRpeN: 0, externalLoadAu: 0, externalN: 0 };
  const loads: DatedLoad[] = [];
  for (const p of input.participations) {
    if (compareLocalDates(p.date, end) > 0 || !participationCarriesLoad(p.status)) continue;
    const count = countOf(p.date);
    if (p.srpeAu !== null) {
      loads.push({ date: p.date, loadAu: p.srpeAu });
      count.sessionsN += 1;
    } else if (p.rpe === null && (p.minutes ?? 0) > 0) {
      count.pendingRpeN += 1;
    }
    counts.set(p.date, count);
  }
  for (const e of input.externalLoads ?? []) {
    if (compareLocalDates(e.date, end) > 0) continue;
    const count = countOf(e.date);
    loads.push({ date: e.date, loadAu: e.srpeAu });
    count.externalLoadAu += e.srpeAu;
    count.externalN += 1;
    counts.set(e.date, count);
  }
  if (loads.length === 0) return { historyStart: null, end, rows: [], replaceFrom: null };

  const series = computeLoadSeries({ loads, to: end, parameters: input.parameters });
  const historyStart = series[0]?.date ?? end;
  const replaceFrom =
    compareLocalDates(input.requestedFrom, historyStart) < 0 ? historyStart : input.requestedFrom;
  const rows = series
    .filter((day) => compareLocalDates(day.date, replaceFrom) >= 0)
    .map((day) => {
      const count = counts.get(day.date);
      return {
        ...day,
        sessionsN: count?.sessionsN ?? 0,
        pendingRpeN: count?.pendingRpeN ?? 0,
        externalLoadAu: count?.externalLoadAu ?? 0,
        externalN: count?.externalN ?? 0,
      };
    });
  return { historyStart, end, rows, replaceFrom };
}

/** The day after `date` (the next day a series that ends on `date` needs). */
export function nextDay(date: LocalDate): LocalDate {
  return addDays(date, 1);
}
