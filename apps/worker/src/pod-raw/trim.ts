import {
  POD_TRACE_CHUNK_MAX_SAMPLES,
  decimateByTime,
  intervalsContain,
  intervalsOverlap,
  type TimeInterval,
} from '@sport-performance/domain';
import {
  FIX_QUALITIES,
  gnssMsToUnixMs,
  tickToGnssMs,
  type DecodedSegment,
  type TimeBase,
} from '@sport-performance/pod-protocol';

/**
 * The pure part of the one-time trim (B-916, ADR 0108): where each page of a
 * segment falls in time, which pages are each player's alone, and the 1 Hz
 * samples of a player's windows.
 */

/** A gap longer than this between two kept samples starts a new trace row. */
export const POD_TRACE_GAP_MS = 10_000;

/** A page and the UTC time of its records (ms, both ends included). */
export interface TimedPage {
  readonly physicalPage: number;
  readonly fromMs: number;
  readonly toMs: number;
}

/** The time of every page of the segment; pages with no record time are counted apart. */
export function timedPages(
  segment: DecodedSegment,
  base: TimeBase | undefined,
): { pages: TimedPage[]; untimed: number } {
  const pages: TimedPage[] = [];
  let untimed = 0;
  const offset = base?.gpsUtcOffsetS;
  for (const span of segment.pageTicks) {
    const from = base && span.firstTick !== null ? tickToGnssMs(base, span.firstTick) : null;
    const to = base && span.lastTick !== null ? tickToGnssMs(base, span.lastTick) : null;
    if (from === null || to === null) {
      untimed += 1;
      continue;
    }
    pages.push({
      physicalPage: span.physicalPage,
      fromMs: Math.floor(gnssMsToUnixMs(from, offset)),
      toMs: Math.ceil(gnssMsToUnixMs(to, offset)),
    });
  }
  return { pages, untimed };
}

/**
 * The pages each player keeps: those whose records overlap that player's
 * windows and **no other player's**. A page shared by two players (the vest
 * handed over between two of its records) goes to neither file: under a
 * second is lost, another player's data is never carried.
 */
export function assignPages(
  pages: readonly TimedPage[],
  windowsByPlayer: ReadonlyMap<string, readonly TimeInterval[]>,
): { byPlayer: Map<string, TimedPage[]>; shared: number } {
  const byPlayer = new Map<string, TimedPage[]>();
  for (const playerId of windowsByPlayer.keys()) byPlayer.set(playerId, []);
  let shared = 0;
  for (const page of pages) {
    const owners = [...windowsByPlayer.entries()].filter(([, windows]) =>
      intervalsOverlap(windows, page.fromMs, page.toMs),
    );
    if (owners.length > 1) {
      shared += 1;
      continue;
    }
    const owner = owners[0];
    if (owner !== undefined) byPlayer.get(owner[0])?.push(page);
  }
  return { byPlayer, shared };
}

/** The pages of `pages` that still overlap `windows` (a correction after the trim). */
export function pagesOverlapping(
  pages: readonly TimedPage[],
  windows: readonly TimeInterval[],
): TimedPage[] {
  return pages.filter((page) => intervalsOverlap(windows, page.fromMs, page.toMs));
}

export interface TraceSample {
  timeMs: number;
  latE7: number;
  lonE7: number;
  speedMmS: number | null;
  hAccMm: number | null;
  fix: number;
}

/** The 1 Hz samples of the windows, from the PVT epochs with a fix. */
export function traceSamples(
  segment: DecodedSegment,
  base: TimeBase | undefined,
  windows: readonly TimeInterval[],
): TraceSample[] {
  const offset = base?.gpsUtcOffsetS;
  const samples: TraceSample[] = [];
  for (const pvt of segment.streams.pvt) {
    if (pvt.fixQuality === 'no_fix') continue;
    const timeMs = Math.round(gnssMsToUnixMs(pvt.gnssTimeMs, offset));
    if (!intervalsContain(windows, timeMs)) continue;
    samples.push({
      timeMs,
      latE7: pvt.latE7,
      lonE7: pvt.lonE7,
      speedMmS: pvt.groundSpeedMmS,
      hAccMm: pvt.hAccMm,
      fix: FIX_QUALITIES.indexOf(pvt.fixQuality),
    });
  }
  samples.sort((x, y) => x.timeMs - y.timeMs);
  return decimateByTime(samples);
}

/** Contiguous stretches of at most {@link POD_TRACE_CHUNK_MAX_SAMPLES}. */
export function traceChunks(samples: readonly TraceSample[]): TraceSample[][] {
  const chunks: TraceSample[][] = [];
  let current: TraceSample[] = [];
  for (const sample of samples) {
    const previous = current.at(-1);
    if (
      previous !== undefined &&
      (sample.timeMs - previous.timeMs > POD_TRACE_GAP_MS ||
        current.length >= POD_TRACE_CHUNK_MAX_SAMPLES)
    ) {
      chunks.push(current);
      current = [];
    }
    current.push(sample);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
