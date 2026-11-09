import type { Sport } from '../../sport.js';
import { speedZoneBandsMs, type AbsoluteSpeedZoneSet } from '../../speed-zones/zones.js';
import type {
  PodLiveAverageMetric,
  PodLiveSignalKind,
  PodLiveSignalRule,
  PodLiveSignalSeverity,
  PodMetricParams,
  RepeatedHighIntensityParams,
} from './params.js';

/**
 * Live effort signals (B-906, ADR 0106): what the tablet shows next to each
 * player during a session, from the cumulative counters of the LoRa live
 * packet (`LiveSummary` of `pod-protocol`, one every 2 s). Shared by the
 * tablet and the worker (which replays the live packets of a pod whose log
 * never arrived). **Approximate** and said so: the report uses `pod_log`.
 *
 * Every signal is a declarative rule of the club (`params.live.rules`, seeded
 * defaults) with its severity, icon and text key: they suggest a look
 * ("sugiere revisar"), never a diagnosis, and never rank players.
 */

/** One of the two per-second summaries of a packet. `null` = no value that second. */
export interface LiveSecondSample {
  readonly vmaxMs: number | null;
  readonly distanceM: number | null;
}

/** A live packet in SI units, at the time of its second `t` (UTC ms). */
export interface LiveCounterSample {
  readonly atMs: number;
  readonly vestOn: boolean;
  readonly sessionDistanceM: number;
  /** Distance in each of the 4 speed bands of the applied configuration. */
  readonly speedBandDistancesM: readonly [number, number, number, number];
  readonly accelerationsN: number;
  readonly decelerationsN: number;
  readonly accelLoadAu: number;
  /** Ignored outside the sports with contacts (hockey: never stored nor shown). */
  readonly impactsN: number;
  /** Second `t − 1`, then second `t`. */
  readonly seconds: readonly [LiveSecondSample, LiveSecondSample];
}

/** The fields of `pod-protocol`'s `LiveSummary` the signals read, in its units. */
export interface LiveSummaryFields {
  readonly vestOn: boolean;
  readonly sessionDistanceDm: number;
  readonly speedBandDistancesM: readonly [number, number, number, number];
  readonly accelerationsN: number;
  readonly decelerationsN: number;
  readonly accelLoadCentiAu: number;
  readonly impactsN: number;
  readonly seconds: readonly [
    { readonly vmaxCmS: number | null; readonly distanceDm: number | null },
    { readonly vmaxCmS: number | null; readonly distanceDm: number | null },
  ];
}

/** Converts a decoded live summary (cm/s, dm, centi-AU) to SI units. */
export function liveCounterSample(summary: LiveSummaryFields, atMs: number): LiveCounterSample {
  const second = (s: LiveSummaryFields['seconds'][number]): LiveSecondSample => ({
    vmaxMs: s.vmaxCmS === null ? null : s.vmaxCmS / 100,
    distanceM: s.distanceDm === null ? null : s.distanceDm / 10,
  });
  return {
    atMs,
    vestOn: summary.vestOn,
    sessionDistanceM: summary.sessionDistanceDm / 10,
    speedBandDistancesM: summary.speedBandDistancesM,
    accelerationsN: summary.accelerationsN,
    decelerationsN: summary.decelerationsN,
    accelLoadAu: summary.accelLoadCentiAu / 100,
    impactsN: summary.impactsN,
    seconds: [second(summary.seconds[0]), second(summary.seconds[1])],
  };
}

/**
 * Adds a packet to a series kept sorted by time. A packet of the same time
 * replaces the one there (the edge re-sends what the tablet missed).
 */
export function appendLiveSample(
  series: readonly LiveCounterSample[],
  sample: LiveCounterSample,
): LiveCounterSample[] {
  const out = series.filter((s) => s.atMs !== sample.atMs);
  let i = out.length;
  while (i > 0 && (out[i - 1]?.atMs ?? 0) > sample.atMs) i -= 1;
  out.splice(i, 0, sample);
  return out;
}

/** Packets further apart than this are a gap (the pod out of range or off): no play counted. */
export const LIVE_MAX_GAP_S = 10;

/** Seconds played: time between consecutive packets with the vest on, without gaps. */
export function livePlayedS(series: readonly LiveCounterSample[]): number {
  let total = 0;
  for (let i = 1; i < series.length; i += 1) {
    const a = series[i - 1];
    const b = series[i];
    if (a === undefined || b === undefined || !a.vestOn || !b.vestOn) continue;
    const dt = (b.atMs - a.atMs) / 1000;
    if (dt <= LIVE_MAX_GAP_S) total += dt;
  }
  return total;
}

/** Cumulative session distance at `atMs`, interpolated between packets; `null` before the first. */
function distanceAt(series: readonly LiveCounterSample[], atMs: number): number | null {
  const first = series[0];
  if (first === undefined || atMs < first.atMs) return null;
  for (let i = 1; i < series.length; i += 1) {
    const a = series[i - 1];
    const b = series[i];
    if (a === undefined || b === undefined) continue;
    if (atMs <= b.atMs) {
      const f = b.atMs === a.atMs ? 1 : (atMs - a.atMs) / (b.atMs - a.atMs);
      return a.sessionDistanceM + (b.sessionDistanceM - a.sessionDistanceM) * f;
    }
  }
  return series.at(-1)?.sessionDistanceM ?? null;
}

/**
 * Metres per minute over the `windowS` before `atMs` (5 min); `null` until a
 * whole window was seen.
 */
export function livePaceMMin(
  series: readonly LiveCounterSample[],
  atMs: number,
  windowS: number,
): number | null {
  const now = distanceAt(series, atMs);
  const before = distanceAt(series, atMs - windowS * 1000);
  if (now === null || before === null) return null;
  return Math.max(0, now - before) / (windowS / 60);
}

/**
 * The session's peak pace: the highest {@link livePaceMMin} at any packet,
 * in one pass (the start of the window only moves forward: O(1) per packet).
 */
export function livePeakPaceMMin(
  series: readonly LiveCounterSample[],
  windowS: number,
): number | null {
  const windowMs = windowS * 1000;
  const first = series[0];
  if (first === undefined) return null;
  let peak: number | null = null;
  let j = 0;
  for (const s of series) {
    const from = s.atMs - windowMs;
    if (from < first.atMs) continue;
    while (j + 1 < series.length && (series[j + 1]?.atMs ?? 0) < from) j += 1;
    const a = series[j];
    const b = series[j + 1] ?? a;
    if (a === undefined || b === undefined) continue;
    const f = b.atMs === a.atMs ? 1 : (from - a.atMs) / (b.atMs - a.atMs);
    const before = a.sessionDistanceM + (b.sessionDistanceM - a.sessionDistanceM) * f;
    const pace = Math.max(0, s.sessionDistanceM - before) / (windowS / 60);
    if (peak === null || pace > peak) peak = pace;
  }
  return peak;
}

/** The per-second max speeds with their time (second `t − 1` is a second before the packet). */
function perSecond(series: readonly LiveCounterSample[]): { atMs: number; vmaxMs: number }[] {
  const out = new Map<number, number>();
  for (const s of series) {
    s.seconds.forEach((second, i) => {
      if (second.vmaxMs === null) return;
      const at = s.atMs - (1 - i) * 1000;
      out.set(at, Math.max(out.get(at) ?? 0, second.vmaxMs));
    });
  }
  return [...out.entries()].sort(([a], [b]) => a - b).map(([atMs, vmaxMs]) => ({ atMs, vmaxMs }));
}

/** The highest per-second max speed in the last `windowS` before the last packet. */
export function liveRecentMaxSpeedMs(
  series: readonly LiveCounterSample[],
  windowS: number,
): number | null {
  const last = series.at(-1);
  if (last === undefined) return null;
  let best: number | null = null;
  for (const s of perSecond(series)) {
    if (s.atMs <= last.atMs - windowS * 1000 || s.atMs > last.atMs) continue;
    if (best === null || s.vmaxMs > best) best = s.vmaxMs;
  }
  return best;
}

export type LiveEffortKind = 'sprint' | 'acceleration' | 'contact';

export interface LiveEffort {
  readonly kind: LiveEffortKind;
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Sprints from the per-second max speeds: consecutive seconds at or above
 * `thresholdMs` lasting at least `minDwellS`. A per-second max only says the
 * peak of that second passed the threshold, so the count is conservative:
 * `n` consecutive seconds last `n − 1` s (a single second is no 1 s sprint).
 */
export function liveSprintEfforts(
  series: readonly LiveCounterSample[],
  thresholdMs: number,
  minDwellS: number,
): LiveEffort[] {
  const out: LiveEffort[] = [];
  let start: number | null = null;
  let last = 0;
  const flush = () => {
    if (start !== null && (last - start) / 1000 >= minDwellS - 1e-9) {
      out.push({ kind: 'sprint', startMs: start, endMs: last });
    }
    start = null;
  };
  for (const s of perSecond(series)) {
    const contiguous = start !== null && s.atMs - last <= 1000;
    if (s.vmaxMs >= thresholdMs) {
      if (!contiguous) {
        flush();
        start = s.atMs;
      }
      last = s.atMs;
    } else flush();
  }
  flush();
  return out;
}

/** Efforts from a cumulative counter: one per unit it went up, at the packet that brought it. */
function counterEfforts(
  series: readonly LiveCounterSample[],
  kind: LiveEffortKind,
  value: (s: LiveCounterSample) => number,
): LiveEffort[] {
  const out: LiveEffort[] = [];
  for (let i = 1; i < series.length; i += 1) {
    const a = series[i - 1];
    const b = series[i];
    if (a === undefined || b === undefined) continue;
    const added = Math.max(0, value(b) - value(a));
    for (let k = 0; k < added; k += 1) out.push({ kind, startMs: b.atMs - 2000, endMs: b.atMs });
  }
  return out;
}

/**
 * The high-intensity efforts of the series for the repeated-effort analysis:
 * sprints, accelerations (an acceleration that opens or is inside a sprint is
 * that sprint) and, only in a sport with contacts, the impacts.
 */
export function liveEfforts(
  series: readonly LiveCounterSample[],
  options: {
    readonly sprintThresholdMs: number | null;
    readonly sprintMinDwellS: number;
    readonly withContacts: boolean;
  },
): LiveEffort[] {
  const sprints =
    options.sprintThresholdMs === null
      ? []
      : liveSprintEfforts(series, options.sprintThresholdMs, options.sprintMinDwellS);
  const accelerations = counterEfforts(series, 'acceleration', (s) => s.accelerationsN).filter(
    (a) => !sprints.some((s) => a.endMs >= s.startMs - 2000 && a.startMs <= s.endMs),
  );
  const contacts = options.withContacts ? counterEfforts(series, 'contact', (s) => s.impactsN) : [];
  return [...sprints, ...accelerations, ...contacts].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );
}

/**
 * Repeated high-intensity bouts: chains of efforts each starting within
 * `maxRecoveryS` of the previous one's end, with at least `minEfforts`; with
 * `requireContact`, only chains with a contact that has a sprint or an
 * acceleration before and after it (sprint → contact → sprint).
 */
export function repeatedHighIntensityBouts(
  efforts: readonly LiveEffort[],
  params: Pick<RepeatedHighIntensityParams, 'minEfforts' | 'maxRecoveryS' | 'requireContact'>,
): LiveEffort[][] {
  const bouts: LiveEffort[][] = [];
  let chain: LiveEffort[] = [];
  let chainEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    if (chain.length >= params.minEfforts && (!params.requireContact || hasContactBetween(chain))) {
      bouts.push(chain);
    }
    chain = [];
  };
  for (const e of efforts) {
    if (chain.length > 0 && e.startMs - chainEnd > params.maxRecoveryS * 1000) flush();
    chain.push(e);
    chainEnd = chain.length === 1 ? e.endMs : Math.max(chainEnd, e.endMs);
  }
  flush();
  return bouts;
}

function hasContactBetween(chain: readonly LiveEffort[]): boolean {
  return chain.some(
    (e, i) =>
      e.kind === 'contact' &&
      chain.slice(0, i).some((x) => x.kind !== 'contact') &&
      chain.slice(i + 1).some((x) => x.kind !== 'contact'),
  );
}

/** A finished match of the player with its minutes and totals (any method, same variant). */
export interface LiveMatchRecord {
  readonly playedS: number;
  readonly values: Partial<Record<PodLiveAverageMetric, number>>;
}

export type MatchAverageComparison =
  | { readonly status: 'ok'; readonly pct: number; readonly matchesN: number }
  | { readonly status: 'insufficient_history'; readonly matchesN: number };

/**
 * The player's pace of a metric so far as % of their match average pace
 * (total over minutes, pooled over the matches with that metric), so a
 * player at minute 30 compares with 30 minutes of a usual match. Fewer than
 * `minMatches` matches: "historia insuficiente".
 */
export function matchAveragePct(input: {
  readonly metric: PodLiveAverageMetric;
  readonly current: number;
  readonly playedS: number;
  readonly history: readonly LiveMatchRecord[];
  readonly minMatches: number;
}): MatchAverageComparison {
  const matches = input.history.filter(
    (m) => m.playedS > 0 && m.values[input.metric] !== undefined,
  );
  if (matches.length < input.minMatches || input.playedS <= 0) {
    return { status: 'insufficient_history', matchesN: matches.length };
  }
  const total = matches.reduce((sum, m) => sum + (m.values[input.metric] ?? 0), 0);
  const seconds = matches.reduce((sum, m) => sum + m.playedS, 0);
  if (total <= 0) return { status: 'insufficient_history', matchesN: matches.length };
  return {
    status: 'ok',
    pct: (input.current / input.playedS / (total / seconds)) * 100,
    matchesN: matches.length,
  };
}

/** Live `hsr_abs_m`: the distance of the bands from the high-speed zone up; `null` if no band starts there. */
export function liveHsrDistanceM(
  sample: LiveCounterSample,
  bandZoneCodes: readonly string[],
  absoluteZones: AbsoluteSpeedZoneSet,
): number | null {
  const from = bandZoneCodes.indexOf(absoluteZones.highSpeedZoneCode);
  if (from < 0) return null;
  return sample.speedBandDistancesM.slice(from).reduce((a, b) => a + b, 0);
}

export type LiveSignalIcon = 'trend_down' | 'trend_up' | 'speed' | 'repeat';

/** Icon of each kind: a signal is always icon + text, never color alone. */
export const POD_LIVE_SIGNAL_ICONS: Readonly<Record<PodLiveSignalKind, LiveSignalIcon>> = {
  pace_drop: 'trend_down',
  match_average_high: 'trend_up',
  speed_near_vmax: 'speed',
  repeated_high_intensity: 'repeat',
};

export interface LiveSignal {
  readonly ruleCode: string;
  readonly kind: PodLiveSignalKind;
  readonly severity: PodLiveSignalSeverity;
  readonly icon: LiveSignalIcon;
  /** i18n keys (`packages/i18n`, `podLive.*`): the text says "sugiere revisar", never a diagnosis. */
  readonly messageKey: `podLive.signal.${PodLiveSignalKind}`;
  readonly suggestionKey: `podLive.signal.${PodLiveSignalKind}.suggestion`;
  /** Values for the message (rounded by the UI); `metric` is set for the match average. */
  readonly values: Readonly<Record<string, number | string>>;
}

/** Where a reading stands: a value, or why there is none. */
export type LiveReading<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'insufficient_history' | 'not_enough_play' | 'no_data' };

export interface LiveContext {
  readonly sport: Sport;
  readonly params: PodMetricParams;
  readonly absoluteZones: AbsoluteSpeedZoneSet;
  /** The player's reference Vmax (`resolveReferenceVmax`), `null` without one. */
  readonly referenceVmaxMs: number | null;
  /** The player's finished matches (B-906: "promedio propio por partido"). */
  readonly matchHistory: readonly LiveMatchRecord[];
}

export interface LiveEvaluation {
  readonly playedS: number;
  /** One per enabled rule that applies to the sport, by its code. */
  readonly readings: Readonly<Record<string, LiveReading<number>>>;
  readonly signals: readonly LiveSignal[];
}

function signal(rule: PodLiveSignalRule, values: LiveSignal['values']): LiveSignal {
  return {
    ruleCode: rule.code,
    kind: rule.kind,
    severity: rule.severity,
    icon: POD_LIVE_SIGNAL_ICONS[rule.kind],
    messageKey: `podLive.signal.${rule.kind}`,
    suggestionKey: `podLive.signal.${rule.kind}.suggestion`,
    values,
  };
}

/** Sports with contacts: where the high-g impacts count (the impacts rule of the definitions). */
function withContacts(ctx: LiveContext): boolean {
  return ctx.params.impacts.sports.includes(ctx.sport);
}

function sprintThresholdMs(ctx: LiveContext): number | null {
  return (
    speedZoneBandsMs(ctx.absoluteZones).find((b) => b.code === ctx.params.sprints.zoneCode)
      ?.minSpeedMs ?? null
  );
}

/**
 * Evaluates the club's live rules on a player's series. A rule whose input is
 * missing gives a reading with its status ("historia insuficiente" when the
 * player has fewer matches than the rule asks) and no signal.
 */
export function evaluateLiveSignals(
  series: readonly LiveCounterSample[],
  ctx: LiveContext,
): LiveEvaluation {
  const playedS = livePlayedS(series);
  const last = series.at(-1);
  const readings: Record<string, LiveReading<number>> = {};
  const signals: LiveSignal[] = [];
  for (const rule of ctx.params.live.rules) {
    if (!rule.enabled || (rule.sports !== null && !rule.sports.includes(ctx.sport))) continue;
    if (last === undefined) {
      readings[rule.code] = { status: 'no_data' };
      continue;
    }
    switch (rule.kind) {
      case 'pace_drop': {
        const { windowS, minPlayedS, atOrBelowPctOfPeak } = rule.params;
        if (playedS < minPlayedS) {
          readings[rule.code] = { status: 'not_enough_play' };
          break;
        }
        const pace = livePaceMMin(series, last.atMs, windowS);
        const peak = livePeakPaceMMin(series, windowS);
        if (pace === null || peak === null || peak <= 0) {
          readings[rule.code] = { status: 'no_data' };
          break;
        }
        const pct = (pace / peak) * 100;
        readings[rule.code] = { status: 'ok', value: pct };
        if (pct <= atOrBelowPctOfPeak) {
          signals.push(signal(rule, { paceMMin: pace, peakMMin: peak, pctOfPeak: pct }));
        }
        break;
      }
      case 'match_average_high': {
        const { metrics, minMatches, minPlayedS, atOrAbovePct } = rule.params;
        if (playedS < minPlayedS) {
          readings[rule.code] = { status: 'not_enough_play' };
          break;
        }
        const sprintMs = sprintThresholdMs(ctx);
        const first = series[0] ?? last;
        // The counters are cumulative since the pod's session started, which can be before the
        // tablet's first packet (it joined late or reconnected): only their increase over the
        // series is compared with the time played in it.
        const hsrNow = liveHsrDistanceM(last, ctx.params.live.bandZoneCodes, ctx.absoluteZones);
        const hsrFirst = liveHsrDistanceM(first, ctx.params.live.bandZoneCodes, ctx.absoluteZones);
        const current: Partial<Record<PodLiveAverageMetric, number | null>> = {
          hsr_abs_m: hsrNow === null || hsrFirst === null ? null : Math.max(0, hsrNow - hsrFirst),
          sprints_n:
            sprintMs === null
              ? null
              : liveSprintEfforts(series, sprintMs, ctx.params.sprints.minDwellS).length,
          acc_n: Math.max(0, last.accelerationsN - first.accelerationsN),
        };
        let highest: { metric: PodLiveAverageMetric; pct: number } | null = null;
        let insufficient = false;
        for (const metric of metrics) {
          const value = current[metric];
          if (value === null || value === undefined) continue;
          const cmp = matchAveragePct({
            metric,
            current: value,
            playedS,
            history: ctx.matchHistory,
            minMatches,
          });
          if (cmp.status === 'insufficient_history') {
            insufficient = true;
            continue;
          }
          if (highest === null || cmp.pct > highest.pct) highest = { metric, pct: cmp.pct };
        }
        if (highest === null) {
          readings[rule.code] = { status: insufficient ? 'insufficient_history' : 'no_data' };
          break;
        }
        readings[rule.code] = { status: 'ok', value: highest.pct };
        if (highest.pct >= atOrAbovePct) {
          signals.push(signal(rule, { metric: highest.metric, pctOfAverage: highest.pct }));
        }
        break;
      }
      case 'speed_near_vmax': {
        const recent = liveRecentMaxSpeedMs(series, rule.params.windowS);
        if (ctx.referenceVmaxMs === null) {
          readings[rule.code] = { status: 'insufficient_history' };
          break;
        }
        if (recent === null) {
          readings[rule.code] = { status: 'no_data' };
          break;
        }
        const pct = (recent / ctx.referenceVmaxMs) * 100;
        readings[rule.code] = { status: 'ok', value: pct };
        if (pct >= rule.params.atOrAbovePct) {
          signals.push(
            signal(rule, { speedMs: recent, vmaxMs: ctx.referenceVmaxMs, pctOfVmax: pct }),
          );
        }
        break;
      }
      case 'repeated_high_intensity': {
        const { windowS, atOrAboveBouts } = rule.params;
        const efforts = liveEfforts(series, {
          sprintThresholdMs: sprintThresholdMs(ctx),
          sprintMinDwellS: ctx.params.sprints.minDwellS,
          withContacts: withContacts(ctx) && rule.params.requireContact,
        });
        const bouts = repeatedHighIntensityBouts(efforts, {
          ...rule.params,
          // A sport without contacts never asks for one (hockey: only runs and accelerations).
          requireContact: rule.params.requireContact && withContacts(ctx),
        }).filter((b) => (b.at(-1)?.endMs ?? 0) > last.atMs - windowS * 1000);
        readings[rule.code] = { status: 'ok', value: bouts.length };
        if (bouts.length >= atOrAboveBouts) {
          signals.push(signal(rule, { bouts: bouts.length, windowMin: windowS / 60 }));
        }
        break;
      }
    }
  }
  return { playedS, readings, signals };
}
