import { addDays, compareLocalDates, type LocalDate } from '../../time.js';
import type { PodReferenceVmaxParams } from './params.js';

/** A dated Vmax: a pod session peak or a `sprint_40` result. */
export interface DatedVmax {
  readonly localDate: LocalDate;
  readonly vmaxMs: number;
}

/** A pod session peak, with when the session started (only earlier sessions count). */
export interface PodSessionPeak extends DatedVmax {
  readonly startsAtMs: number;
}

/**
 * The reference Vmax of the relative metrics and which rule gave it (stored
 * with the run, ADR 0106: "queda registrada cuál se usó"). `null` when no
 * rule had enough data: `hsr_rel_m` and `vmax_pct` are then not computed.
 */
export type ReferenceVmax =
  | { readonly vmaxMs: number; readonly source: 'pod_rolling_max'; readonly sessionsN: number }
  | { readonly vmaxMs: number; readonly source: 'sprint_40'; readonly testedOn: LocalDate }
  | { readonly vmaxMs: null; readonly source: null };

export interface ReferenceVmaxInput {
  readonly params: PodReferenceVmaxParams;
  /** The session's club day and start (UTC ms). */
  readonly onDate: LocalDate;
  readonly sessionStartsAtMs: number;
  /** The session's own peak (`vmax_ms`), `null` without speed data. */
  readonly sessionVmaxMs: number | null;
  /** The player's other pod sessions (any date; the window is applied here). */
  readonly podHistory: readonly PodSessionPeak[];
  /** The player's `sprint_vmax_ms` results (best of each test day). */
  readonly sprint40: readonly DatedVmax[];
}

/**
 * Resolves the reference Vmax "as of" the session: only sessions that started
 * before it (and the session itself) and tests up to its day count, so a later faster session never rewrites an older
 * one's relative metrics beyond its window. The default order is the pod's
 * rolling max (what the pod measures, the same quantity as `vmax_ms`) and,
 * for a player without enough pod sessions yet, the latest 40 m sprint.
 * They are never mixed in one max: the sprint's Vmax is a split mean, not a
 * peak (ADR 0106).
 */
export function resolveReferenceVmax(input: ReferenceVmaxInput): ReferenceVmax {
  const { params, onDate } = input;
  const sprint = latestSprint40(input);
  for (const source of params.sources) {
    if (source === 'pod_rolling_max') {
      const from = addDays(onDate, -params.podWindowDays);
      const values = input.podHistory
        .filter(
          (h) => compareLocalDates(h.localDate, from) > 0 && h.startsAtMs < input.sessionStartsAtMs,
        )
        .map((h) => h.vmaxMs);
      if (input.sessionVmaxMs !== null) values.push(input.sessionVmaxMs);
      if (values.length < params.podMinSessions || values.length === 0) continue;
      const vmaxMs = values.reduce((a, b) => Math.max(a, b));
      // Out of the sanity band of the player's 40 m sprint: not a reference.
      if (
        sprint !== null &&
        params.podMaxAboveSprint40Pct !== null &&
        vmaxMs > (sprint.vmaxMs * params.podMaxAboveSprint40Pct) / 100
      ) {
        continue;
      }
      return { vmaxMs, source, sessionsN: values.length };
    }
    if (sprint !== null) return { vmaxMs: sprint.vmaxMs, source, testedOn: sprint.localDate };
  }
  return { vmaxMs: null, source: null };
}

/** The latest `sprint_40` Vmax up to the session's day, within its maximum age. */
function latestSprint40(input: ReferenceVmaxInput): DatedVmax | null {
  const from = addDays(input.onDate, -input.params.sprint40MaxAgeDays);
  let latest: DatedVmax | null = null;
  for (const s of input.sprint40) {
    if (compareLocalDates(s.localDate, from) <= 0) continue;
    if (compareLocalDates(s.localDate, input.onDate) > 0) continue;
    if (
      latest === null ||
      compareLocalDates(s.localDate, latest.localDate) > 0 ||
      (s.localDate === latest.localDate && s.vmaxMs > latest.vmaxMs)
    ) {
      latest = s;
    }
  }
  return latest;
}
