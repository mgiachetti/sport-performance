import { createHash } from 'node:crypto';
import {
  POD_FIELD_METRIC_CODES,
  POD_METRICS_ALGORITHM_VERSION,
  canonicalJson,
  compareLocalDates,
  computePodSessionMetrics,
  fileObjectKey,
  intersectIntervals,
  parsePodMetricParams,
  resolvePodMetricConfig,
  resolveReferenceVmax,
  resolveSpeedZoneSet,
  sessionWindow,
  DEFAULT_POD_METRIC_PARAMS,
  type ClubId,
  type DatedVmax,
  type LocalDate,
  type PlayerId,
  type PodFieldMetricCode,
  type PodMetricConfig,
  type PodMetricParams,
  type PodSessionPeak,
  type ReferenceVmax,
  type Sex,
  type SpeedZoneConfig,
  type SpeedZoneSet,
  type Sport,
  type TimeInterval,
} from '@sport-performance/domain';
import {
  decodeLog,
  deriveStorageKey,
  fromHex,
  readPodRawFile,
} from '@sport-performance/pod-protocol';
import type { ObjectStorage } from '@sport-performance/storage';
import type pg from 'pg';
import type { Logger } from 'pino';
import { inClubTransaction, type ClubTransaction } from '../database.js';
import type { PodKeyProvider } from '../pod-raw/keys.js';
import { PodMetricsBackoff, processPairs, type StepOutcome } from './batch.js';
import { addSegmentSamples, emptySamples, sortSamples } from './extract.js';

/**
 * The pod's field metrics (B-919, ADR 0110), the `pod-metrics-club` job. Per
 * club, for every player and session with a pod trace (the trim put their
 * data in that session) and for every run marked stale by a correction:
 *
 * 1. Resolve what shapes the values: the definitions in force on the
 *    session's day for the player's sport and sex (`pod_metric_config`, or
 *    the code's defaults when the club has none), the absolute and relative
 *    speed zones, the metrics the club's dictionary has, the inputs (the
 *    player's trimmed files and their windows inside the session) and the
 *    reference Vmax as of that session (`resolveReferenceVmax` over the
 *    player's earlier runs and `sprint_40` results).
 * 2. When the run of that session already has the same definition and inputs
 *    hashes, nothing is done (idempotent; nothing is decoded).
 * 3. Otherwise the trimmed files are decoded with the club's keys, the
 *    samples clipped to the windows, the metrics computed with the domain
 *    (`computePodSessionMetrics`) and written as `external_metric` rows of
 *    source `pod`, variant `pod_log`, the algorithm version and the run;
 *    a metric the definitions no longer give is deleted.
 *
 * **Never from partial or moving data.** A session with a trimmed file that
 * is not ready (expired, deleted, missing from the bucket) is skipped: its
 * values are neither recomputed nor deleted. The write re-reads the trims
 * under a share lock and the run under a row lock and gives up when either
 * changed since the files were read (a correction of the ingestion running
 * at the same time): the next run computes again, and `stale` is only
 * cleared together with inputs that are still the ones computed.
 *
 * **Definitions that cannot be used are reported, never replaced.** A
 * `pod_metric_config` row that does not parse or is for another algorithm
 * version is left out with an issue, and the sessions it would apply to are
 * skipped (not computed with the defaults); two equally specific rows on one
 * day skip that day.
 *
 * A stale run whose session has no input left (a correction moved all of it
 * away) is deleted with its values. A run whose inputs are gone for another
 * reason (the location consent revoked, the traces past their retention) is
 * kept: aggregated metrics follow the data consent (ADR 0106). Sessions are
 * processed in time order, so a later session's reference sees the earlier
 * peaks of the same run. At most {@link POD_METRICS_BATCH} sessions are
 * decoded per run, failures included (`processPairs`): `more` re-enqueues
 * only when the batch filled after progress, a failing session never holds
 * back the rest and waits with an exponential backoff (15 minutes doubling up
 * to a day, `PodMetricsBackoff`) before the sweep tries it again, so it is
 * never re-decoded in a loop and reported once per window. Logs carry ids
 * and counts only.
 */

export interface PodMetricsDependencies {
  /** Pool of a `sport_performance_worker` login. */
  readonly pool: pg.Pool;
  readonly storage: ObjectStorage;
  readonly keys: PodKeyProvider;
  readonly logger: Logger;
  readonly now?: () => Date;
  /**
   * The sessions that failed and when to try them again: one per worker process, shared by
   * its jobs (a new one per run when omitted, so a run never retries its own failures).
   */
  readonly backoff?: PodMetricsBackoff;
  /** Tests only: runs after the files were read and before the write transaction. */
  readonly beforeWrite?: (pair: { playerId: string; sessionId: string }) => Promise<void>;
}

export type PodMetricsSkip =
  'inputs_unavailable' | 'config_unusable' | 'config_ambiguous' | 'inputs_changed';

export interface PodMetricsReport {
  /** Sessions whose values were (re)written. */
  readonly computed: number;
  /** Sessions already up to date. */
  readonly unchanged: number;
  /** Stale runs deleted with their values (nothing left after a correction). */
  readonly deleted: number;
  /** Sessions left as they are this run, by reason. */
  readonly skipped: Readonly<Partial<Record<PodMetricsSkip, number>>>;
  /** Definition rows that cannot be used (they do not parse, or another algorithm). */
  readonly configIssues: number;
  /** Sessions that failed before and wait for their retry time (not tried). */
  readonly backingOff: number;
  /** Sessions with an unexpected error this run: each waits with a backoff before the next try. */
  readonly failed: number;
  /** The sessions that failed (ids and consecutive failures), for the error report. */
  readonly failures: readonly { playerId: string; sessionId: string; failures: number }[];
  /** The batch filled after progress: the caller enqueues the job again. */
  readonly more: boolean;
}

/** Sessions decoded per run, failures included (each one reads its players' trimmed files). */
export const POD_METRICS_BATCH = 10;

const METHOD_VARIANT = 'pod_log';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** `external_ref` of a pod value: one per variant and session. */
export function podExternalRef(sessionId: string): string {
  return `${METHOD_VARIANT}:${sessionId}`;
}

interface PairRow {
  player_id: PlayerId;
  training_session_id: string;
}

interface SessionRow {
  id: string;
  starts_at: Date;
  planned_duration_min: number | null;
  local_date: LocalDate;
}

interface PlayerRow {
  id: PlayerId;
  sex: Sex;
  sport: Sport;
}

interface TrimRow {
  id: string;
  player_id: PlayerId;
  training_session_id: string;
  pod_raw_upload_id: string;
  file_id: string | null;
  /** `NULL` when the trim has a file that is not ready (expired, deleted). */
  size_bytes: string | null;
  windows: TimeInterval[];
  chip_id: string;
  key_epochs: number[];
  firmware_version: string | null;
  gnss_firmware_version: string | null;
}

interface RunRow {
  id: string;
  player_id: PlayerId;
  training_session_id: string;
  local_date: LocalDate;
  starts_at: Date;
  algorithm_version: string;
  definition_hash: string;
  inputs_hash: string;
  session_vmax_ms: number | null;
  stale: boolean;
  updated_at: Date;
}

/** A definitions row that cannot be used: its scope and validity, to skip what it covers. */
interface UnusableConfig {
  id: string;
  sport: Sport | null;
  sex: Sex | null;
  valid_from: LocalDate;
  valid_to: LocalDate | null;
}

interface ClubState {
  sessions: Map<string, SessionRow>;
  players: Map<string, PlayerRow>;
  trims: Map<string, TrimRow[]>;
  runs: Map<string, RunRow>;
  configs: (PodMetricConfig & { id: string })[];
  unusableConfigs: UnusableConfig[];
  zones: SpeedZoneConfig[];
  sprint40: Map<string, DatedVmax[]>;
  metricIds: Map<PodFieldMetricCode, { id: string; unit: string }>;
}

const pairKey = (playerId: string, sessionId: string) => `${playerId}:${sessionId}`;

/** The trims whose upload left a trace of the player in the session: the session's inputs. */
const TRIMS_SQL = `select distinct tr.id, tr.player_id, t.training_session_id, tr.pod_raw_upload_id,
        tr.file_id, f.size_bytes, tr.windows, u.chip_id, u.key_epochs, u.firmware_version,
        u.gnss_firmware_version
   from pod_trace_segment t
   join pod_raw_trim tr on tr.club_id = t.club_id and tr.pod_raw_upload_id = t.pod_raw_upload_id
                       and tr.player_id = t.player_id
   join pod_raw_upload u on u.club_id = tr.club_id and u.id = tr.pod_raw_upload_id
   left join file f on f.club_id = tr.club_id and f.id = tr.file_id and f.status = 'ready'
  where t.club_id = $1
    and ($2::uuid is null or t.player_id = $2)
    and ($3::uuid is null or t.training_session_id = $3)`;

const RUN_COLUMNS = `r.id, r.player_id, r.training_session_id, r.local_date::text as local_date,
  s.starts_at, r.algorithm_version, r.definition_hash, r.inputs_hash, r.session_vmax_ms, r.stale,
  r.updated_at`;

async function loadState(
  tx: ClubTransaction,
  clubId: ClubId,
): Promise<{ pairs: PairRow[]; state: ClubState; issues: UnusableConfig[] }> {
  const q = <R extends pg.QueryResultRow>(sql: string, params: unknown[] = [clubId]) =>
    tx.client.query<R>(sql, params).then((r) => r.rows);
  const pairs = await q<PairRow>(
    `select player_id, training_session_id from pod_trace_segment where club_id = $1
     union
     select player_id, training_session_id from pod_metric_run
      where club_id = $1 and method_variant = 'pod_log' and stale`,
  );
  const playerIds = [...new Set(pairs.map((p) => p.player_id))];
  const sessions = await q<SessionRow>(
    `select id, starts_at, planned_duration_min, local_date::text as local_date
       from training_session where club_id = $1 and id = any ($2::uuid[])`,
    [clubId, [...new Set(pairs.map((p) => p.training_session_id))]],
  );
  const players = await q<PlayerRow>(
    `select id, sex::text as sex, sport::text as sport from player
      where club_id = $1 and id = any ($2::uuid[])`,
    [clubId, playerIds],
  );
  const trims = await q<TrimRow>(TRIMS_SQL, [clubId, null, null]);
  // Every run of these players: their peaks are the reference of the later sessions.
  const runs = await q<RunRow>(
    `select ${RUN_COLUMNS}
       from pod_metric_run r
       join training_session s on s.club_id = r.club_id and s.id = r.training_session_id
      where r.club_id = $1 and r.method_variant = 'pod_log' and r.player_id = any ($2::uuid[])`,
    [clubId, playerIds],
  );
  const configRows = await q<UnusableConfig & { algorithm_version: string; params: unknown }>(
    `select id, sport::text as sport, sex::text as sex, valid_from::text as valid_from,
            valid_to::text as valid_to, algorithm_version, params
       from pod_metric_config where club_id = $1 and archived_at is null`,
  );
  const zoneRows = await q<{
    sport: Sport | null;
    sex: Sex | null;
    player_id: PlayerId | null;
    valid_from: LocalDate;
    valid_to: LocalDate | null;
    zone_set: SpeedZoneSet;
  }>(
    `select sport::text as sport, sex::text as sex, player_id, valid_from::text as valid_from,
            valid_to::text as valid_to, zone_set
       from speed_zone_config where club_id = $1 and archived_at is null`,
  );
  const sprintRows = await q<{ player_id: string; measured_on: LocalDate; vmax_ms: number }>(
    `select r.player_id, r.measured_on::text as measured_on, max(v.value) as vmax_ms
       from test_result r
       join test_result_value v on v.club_id = r.club_id and v.test_result_id = r.id
       join metric_definition m on m.club_id = v.club_id and m.id = v.metric_definition_id
      where r.club_id = $1 and r.status = 'done' and v.voided_at is null
        and m.code = 'sprint_vmax_ms' and r.player_id = any ($2::uuid[])
      group by r.player_id, r.measured_on`,
    [clubId, playerIds],
  );
  const metricRows = await q<{ id: string; code: PodFieldMetricCode; unit: string }>(
    `select id, code, unit::text as unit from metric_definition
      where club_id = $1 and code = any ($2::text[]) and archived_at is null`,
    [clubId, [...POD_FIELD_METRIC_CODES]],
  );

  const configs: (PodMetricConfig & { id: string })[] = [];
  const unusableConfigs: UnusableConfig[] = [];
  for (const row of configRows) {
    const scope = {
      id: row.id,
      sport: row.sport,
      sex: row.sex,
      valid_from: row.valid_from,
      valid_to: row.valid_to,
    };
    // Definitions of another algorithm version are not this algorithm's input: never
    // replaced silently by the defaults.
    if (row.algorithm_version !== POD_METRICS_ALGORITHM_VERSION) {
      unusableConfigs.push(scope);
      continue;
    }
    let params: PodMetricParams;
    try {
      params = parsePodMetricParams(row.params);
    } catch {
      unusableConfigs.push(scope);
      continue;
    }
    configs.push({
      id: row.id,
      clubId,
      sport: row.sport,
      sex: row.sex,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      params,
    });
  }
  const trimsByPair = new Map<string, TrimRow[]>();
  for (const trim of trims) {
    const key = pairKey(trim.player_id, trim.training_session_id);
    trimsByPair.set(key, [...(trimsByPair.get(key) ?? []), trim]);
  }
  const sprint40 = new Map<string, DatedVmax[]>();
  for (const s of sprintRows) {
    sprint40.set(s.player_id, [
      ...(sprint40.get(s.player_id) ?? []),
      { localDate: s.measured_on, vmaxMs: s.vmax_ms },
    ]);
  }
  return {
    pairs,
    issues: unusableConfigs,
    state: {
      sessions: new Map(sessions.map((s) => [s.id, s])),
      players: new Map(players.map((p) => [p.id, p])),
      trims: trimsByPair,
      runs: new Map(runs.map((r) => [pairKey(r.player_id, r.training_session_id), r])),
      configs,
      unusableConfigs,
      zones: zoneRows.map((z) => ({
        clubId,
        sport: z.sport,
        sex: z.sex,
        playerId: z.player_id,
        validFrom: z.valid_from,
        validTo: z.valid_to,
        zoneSet: z.zone_set,
      })),
      sprint40,
      metricIds: new Map(metricRows.map((m) => [m.code, { id: m.id, unit: m.unit }])),
    },
  };
}

/** The player's other pod peaks (for the reference Vmax), from the runs as they are now. */
function podHistory(state: ClubState, playerId: string, sessionId: string): PodSessionPeak[] {
  const out: PodSessionPeak[] = [];
  for (const run of state.runs.values()) {
    if (run.player_id !== playerId || run.training_session_id === sessionId) continue;
    if (run.session_vmax_ms === null) continue;
    out.push({
      localDate: run.local_date,
      vmaxMs: run.session_vmax_ms,
      startsAtMs: run.starts_at.getTime(),
    });
  }
  return out;
}

interface Plan {
  session: SessionRow;
  player: PlayerRow;
  params: PodMetricParams;
  configId: string | null;
  absolute: Extract<SpeedZoneSet, { kind: 'absolute' }>;
  relative: Extract<SpeedZoneSet, { kind: 'relative' }>;
  trims: { row: TrimRow; windows: TimeInterval[] }[];
  inputsHash: string;
  definitionCore: Record<string, unknown>;
}

function covers(c: UnusableConfig, sport: Sport, sex: Sex, onDate: LocalDate): boolean {
  return (
    (c.sport === null || c.sport === sport) &&
    (c.sex === null || c.sex === sex) &&
    compareLocalDates(c.valid_from, onDate) <= 0 &&
    (c.valid_to === null || compareLocalDates(onDate, c.valid_to) < 0)
  );
}

/** The windows of the session's trims, and their hash (what the values are computed from). */
function sessionInputs(
  trims: readonly TrimRow[],
  session: SessionRow,
): { trims: { row: TrimRow; windows: TimeInterval[] }[]; inputsHash: string } {
  const window = sessionWindow({
    startsAt: session.starts_at,
    plannedDurationMin: session.planned_duration_min,
  });
  const inside = trims
    .map((row) => ({ row, windows: intersectIntervals(row.windows, [window]) }))
    .filter((t) => t.windows.length > 0)
    .sort((a, b) => (a.row.id < b.row.id ? -1 : 1));
  const inputsHash = sha256(
    canonicalJson(
      inside.map((t) => ({
        trim: t.row.id,
        file: t.row.file_id,
        ready: t.row.size_bytes !== null,
        windows: t.windows,
      })),
    ),
  );
  return { trims: inside, inputsHash };
}

function plan(state: ClubState, clubId: ClubId, pair: PairRow): Plan | PodMetricsSkip | null {
  const session = state.sessions.get(pair.training_session_id);
  const player = state.players.get(pair.player_id);
  if (session === undefined || player === undefined) return null;
  const query = {
    clubId,
    sport: player.sport,
    sex: player.sex,
    onDate: session.local_date,
  };
  if (state.unusableConfigs.some((c) => covers(c, player.sport, player.sex, session.local_date))) {
    return 'config_unusable';
  }
  let config: (PodMetricConfig & { id: string }) | null;
  try {
    config = resolvePodMetricConfig(state.configs, query);
  } catch {
    return 'config_ambiguous';
  }
  const params = config?.params ?? DEFAULT_POD_METRIC_PARAMS;
  const zoneQuery = { ...query, playerId: player.id };
  const absolute = resolveSpeedZoneSet(state.zones, { ...zoneQuery, kind: 'absolute' });
  const relative = resolveSpeedZoneSet(state.zones, { ...zoneQuery, kind: 'relative' });
  const inputs = sessionInputs(state.trims.get(pairKey(player.id, session.id)) ?? [], session);
  return {
    session,
    player,
    params,
    configId: config?.id ?? null,
    absolute,
    relative,
    ...inputs,
    definitionCore: {
      algorithm: POD_METRICS_ALGORITHM_VERSION,
      variant: METHOD_VARIANT,
      sport: player.sport,
      // The live rules do not shape a stored value: changing them recomputes nothing.
      params: { ...params, live: undefined },
      absolute,
      relative,
      // The metrics the club's dictionary has (an archived one is deleted, a new one added).
      metrics: [...state.metricIds.keys()].sort(),
    },
  };
}

function referenceOf(state: ClubState, p: Plan, sessionVmaxMs: number | null): ReferenceVmax {
  return resolveReferenceVmax({
    params: p.params.referenceVmax,
    onDate: p.session.local_date,
    sessionStartsAtMs: p.session.starts_at.getTime(),
    sessionVmaxMs,
    podHistory: podHistory(state, p.player.id, p.session.id),
    sprint40: state.sprint40.get(p.player.id) ?? [],
  });
}

function definitionHash(p: Plan, reference: ReferenceVmax): string {
  return sha256(canonicalJson({ ...p.definitionCore, reference }));
}

/**
 * Inside the write transaction: locks the session's trims (a correction of
 * the ingestion waits for the commit) and the run, and tells whether they
 * are still what the plan read. Returns the run's current id when unchanged.
 */
async function stillTheSame(
  tx: ClubTransaction,
  clubId: ClubId,
  p: { player: PlayerRow; session: SessionRow; inputsHash: string },
  loaded: RunRow | undefined,
): Promise<boolean> {
  await tx.client.query(
    `select id from pod_raw_trim where club_id = $1 and player_id = $2 for share`,
    [clubId, p.player.id],
  );
  const { rows: trims } = await tx.client.query<TrimRow>(TRIMS_SQL, [
    clubId,
    p.player.id,
    p.session.id,
  ]);
  if (sessionInputs(trims, p.session).inputsHash !== p.inputsHash) return false;
  const { rows } = await tx.client.query<{ id: string; updated_at: Date }>(
    `select id, updated_at from pod_metric_run
      where club_id = $1 and player_id = $2 and training_session_id = $3
        and method_variant = 'pod_log'
      for update`,
    [clubId, p.player.id, p.session.id],
  );
  const current = rows[0];
  if (loaded === undefined) return current === undefined;
  return current?.id === loaded.id && current.updated_at.getTime() === loaded.updated_at.getTime();
}

async function deleteRun(tx: ClubTransaction, clubId: ClubId, run: RunRow): Promise<void> {
  await tx.client.query(
    `delete from external_metric where club_id = $1 and pod_metric_run_id = $2 and source = 'pod'`,
    [clubId, run.id],
  );
  await tx.client.query(`delete from pod_metric_run where club_id = $1 and id = $2`, [
    clubId,
    run.id,
  ]);
}

/** Decodes the session's trimmed files and computes its metrics; `null` if a file is gone. */
async function compute(
  deps: PodMetricsDependencies,
  clubId: ClubId,
  masterKey: Uint8Array,
  state: ClubState,
  p: Plan,
) {
  const samples = emptySamples();
  for (const { row, windows } of p.trims) {
    if (row.file_id === null || row.size_bytes === null) continue;
    const bytes = await deps.storage.get(
      fileObjectKey({ clubId, kind: 'pod_raw', id: row.file_id }),
      Number(row.size_bytes),
    );
    // Missing from the bucket: never computed from what is left.
    if (bytes === null) return null;
    const { pages } = readPodRawFile(bytes);
    const deviceId = fromHex(row.chip_id);
    const epochs = new Set(row.key_epochs);
    const decoded = decodeLog({
      pages,
      deviceId,
      keyForEpoch: (epoch) =>
        epochs.has(epoch) ? deriveStorageKey({ masterKey, deviceId, epoch }) : undefined,
    });
    for (const segment of decoded.segments) {
      const base = decoded.timeBases.find((b) => b.bootCounter === segment.bootCounter);
      addSegmentSamples(samples, segment, base, windows);
    }
  }
  const sorted = sortSamples(samples);
  let reference: ReferenceVmax = { vmaxMs: null, source: null };
  const metrics = computePodSessionMetrics({
    params: p.params,
    sport: p.player.sport,
    absoluteZones: p.absolute,
    relativeZones: p.relative,
    windows: p.trims.flatMap((t) => t.windows),
    speed: sorted.speed,
    accel: sorted.accel,
    highG: sorted.highG,
    referenceVmax: (own) => {
      reference = referenceOf(state, p, own);
      return reference;
    },
  });
  return { metrics, reference };
}

async function write(
  tx: ClubTransaction,
  clubId: ClubId,
  state: ClubState,
  p: Plan,
  result: NonNullable<Awaited<ReturnType<typeof compute>>>,
  now: Date,
): Promise<RunRow> {
  const { metrics, reference } = result;
  const hash = definitionHash(p, reference);
  const versions = (pick: (t: TrimRow) => string | null) =>
    [...new Set(p.trims.map((t) => pick(t.row)).filter((v): v is string => v !== null))].sort();
  const stats = {
    durationS: metrics.stats.durationS,
    speed: metrics.stats.speed,
    runsN: metrics.stats.runsN,
    accelSamplesN: metrics.stats.accelSamplesN,
    impactsN: metrics.stats.impactsN,
    thresholds: metrics.thresholds,
    omitted: metrics.omitted,
    reference,
    trimsN: p.trims.length,
  };
  const sessionVmaxMs = metrics.values.vmax_ms ?? null;
  const { rows } = await tx.client.query<{ id: string; updated_at: Date }>(
    `insert into pod_metric_run (club_id, player_id, training_session_id, local_date,
       method_variant, algorithm_version, pod_metric_config_id, definition_hash, inputs_hash,
       pod_raw_upload_ids, firmware_versions, gnss_firmware_versions, session_vmax_ms,
       reference_vmax_ms, reference_vmax_source, stats, stale, computed_at)
     values ($1, $2, $3, $4, 'pod_log', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb,
             false, $16)
     on conflict (club_id, player_id, training_session_id, method_variant) do update
       set local_date = excluded.local_date, algorithm_version = excluded.algorithm_version,
           pod_metric_config_id = excluded.pod_metric_config_id,
           definition_hash = excluded.definition_hash, inputs_hash = excluded.inputs_hash,
           pod_raw_upload_ids = excluded.pod_raw_upload_ids,
           firmware_versions = excluded.firmware_versions,
           gnss_firmware_versions = excluded.gnss_firmware_versions,
           session_vmax_ms = excluded.session_vmax_ms,
           reference_vmax_ms = excluded.reference_vmax_ms,
           reference_vmax_source = excluded.reference_vmax_source, stats = excluded.stats,
           stale = false, computed_at = excluded.computed_at
     returning id, updated_at`,
    [
      clubId,
      p.player.id,
      p.session.id,
      p.session.local_date,
      POD_METRICS_ALGORITHM_VERSION,
      p.configId,
      hash,
      p.inputsHash,
      [...new Set(p.trims.map((t) => t.row.pod_raw_upload_id))].sort(),
      versions((t) => t.firmware_version),
      versions((t) => t.gnss_firmware_version),
      sessionVmaxMs,
      reference.vmaxMs,
      reference.source,
      JSON.stringify(stats),
      now,
    ],
  );
  const runId = rows[0]?.id ?? '';
  const ref = podExternalRef(p.session.id);
  // A value of a metric the club archived goes with the rest of what is no longer given.
  await tx.client.query(
    `delete from external_metric
      where club_id = $1 and source = 'pod' and external_ref = $2 and player_id = $3
        and not (metric_definition_id = any ($4::uuid[]))`,
    [
      clubId,
      ref,
      p.player.id,
      POD_FIELD_METRIC_CODES.flatMap((code) => {
        const id = state.metricIds.get(code)?.id;
        return id !== undefined && metrics.values[code] !== undefined ? [id] : [];
      }),
    ],
  );
  for (const code of POD_FIELD_METRIC_CODES) {
    const metric = state.metricIds.get(code);
    const value = metrics.values[code];
    if (metric === undefined || value === undefined) continue;
    await tx.client.query(
      `insert into external_metric (club_id, player_id, training_session_id, metric_definition_id,
         local_date, value, unit, source, external_ref, method_variant, algorithm_version,
         pod_metric_run_id)
       values ($1, $2, $3, $4, $5, $6, $7::unit, 'pod', $8, 'pod_log', $9, $10)
       on conflict (club_id, source, external_ref, player_id, metric_definition_id)
         where external_ref is not null
       do update set value = excluded.value, local_date = excluded.local_date,
                     training_session_id = excluded.training_session_id,
                     algorithm_version = excluded.algorithm_version,
                     pod_metric_run_id = excluded.pod_metric_run_id
         where external_metric.value is distinct from excluded.value
            or external_metric.local_date is distinct from excluded.local_date
            or external_metric.algorithm_version is distinct from excluded.algorithm_version
            or external_metric.pod_metric_run_id is distinct from excluded.pod_metric_run_id`,
      [
        clubId,
        p.player.id,
        p.session.id,
        metric.id,
        p.session.local_date,
        value,
        metric.unit,
        ref,
        POD_METRICS_ALGORITHM_VERSION,
        runId,
      ],
    );
  }
  return {
    id: runId,
    player_id: p.player.id,
    training_session_id: p.session.id,
    local_date: p.session.local_date,
    starts_at: p.session.starts_at,
    algorithm_version: POD_METRICS_ALGORITHM_VERSION,
    definition_hash: hash,
    inputs_hash: p.inputsHash,
    session_vmax_ms: sessionVmaxMs,
    stale: false,
    updated_at: rows[0]?.updated_at ?? now,
  };
}

const CHANGE_REASON_SQL = `select set_config('app.change_reason', $1, true)`;
const CHANGE_REASON = 'Recálculo de las métricas del pod (definiciones o datos nuevos)';

export async function runClubPodMetrics(
  deps: PodMetricsDependencies,
  clubId: ClubId,
  options: { jobId?: string } = {},
): Promise<PodMetricsReport> {
  const now = deps.now?.() ?? new Date();
  const tx = { requestId: options.jobId };
  const { pairs, state, issues } = await inClubTransaction(
    deps.pool,
    clubId,
    (t) => loadState(t, clubId),
    tx,
  );
  for (const issue of issues) {
    deps.logger.warn(
      { clubId, podMetricConfigId: issue.id },
      'pod metric definitions unusable (do not parse or another algorithm): their sessions wait',
    );
  }
  const ordered = pairs
    .map((pair) => ({ pair, session: state.sessions.get(pair.training_session_id) }))
    .sort(
      (a, b) =>
        (a.session?.starts_at.getTime() ?? 0) - (b.session?.starts_at.getTime() ?? 0) ||
        (a.pair.player_id < b.pair.player_id ? -1 : 1),
    )
    .map((o) => o.pair);
  const masterKey = await deps.keys.masterKey(clubId);
  const skipped: Partial<Record<PodMetricsSkip, number>> = {};
  const skip = (reason: PodMetricsSkip): StepOutcome => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    return 'skipped';
  };

  const step = async (pair: PairRow, takeSlot: () => boolean): Promise<StepOutcome> => {
    const key = pairKey(pair.player_id, pair.training_session_id);
    const existing = state.runs.get(key);
    const p = plan(state, clubId, pair);
    if (p === null) return 'unchanged';
    if (typeof p === 'string') return skip(p);
    // A file that is not ready (expired, deleted): never computed from partial data.
    if (p.trims.some((t) => t.row.file_id !== null && t.row.size_bytes === null)) {
      return skip('inputs_unavailable');
    }
    if (!p.trims.some((t) => t.row.file_id !== null)) {
      // Nothing to compute from. A correction emptied it: its values go too.
      if (existing?.stale !== true) return 'unchanged';
      const done = await inClubTransaction(
        deps.pool,
        clubId,
        async (t) => {
          if (!(await stillTheSame(t, clubId, p, existing))) return false;
          await t.client.query(CHANGE_REASON_SQL, [CHANGE_REASON]);
          await deleteRun(t, clubId, existing);
          return true;
        },
        tx,
      );
      if (!done) return skip('inputs_changed');
      state.runs.delete(key);
      return 'deleted';
    }
    if (
      existing !== undefined &&
      !existing.stale &&
      existing.algorithm_version === POD_METRICS_ALGORITHM_VERSION &&
      existing.inputs_hash === p.inputsHash &&
      existing.definition_hash ===
        definitionHash(p, referenceOf(state, p, existing.session_vmax_ms))
    ) {
      return 'unchanged';
    }
    if (masterKey === null) {
      deps.logger.warn({ clubId }, 'pod metrics waiting: the club has no master key');
      return 'stop';
    }
    if (!takeSlot()) return 'no_slot';
    const result = await compute(deps, clubId, masterKey, state, p);
    if (result === null) return skip('inputs_unavailable');
    await deps.beforeWrite?.({ playerId: p.player.id, sessionId: p.session.id });
    const run = await inClubTransaction(
      deps.pool,
      clubId,
      async (t) => {
        // A correction ran meanwhile: what was read is not the data any more.
        if (!(await stillTheSame(t, clubId, p, existing))) return null;
        await t.client.query(CHANGE_REASON_SQL, [CHANGE_REASON]);
        return write(t, clubId, state, p, result, now);
      },
      tx,
    );
    // Computed again by a later run (the sweep), from the data as it is then.
    if (run === null) return skip('inputs_changed');
    state.runs.set(key, run);
    return 'computed';
  };

  const result = await processPairs({
    pairs: ordered,
    keyOf: (pair) => `${clubId}:${pairKey(pair.player_id, pair.training_session_id)}`,
    batch: POD_METRICS_BATCH,
    backoff: deps.backoff ?? new PodMetricsBackoff(),
    nowMs: now.getTime(),
    step,
  });
  for (const f of result.failures) {
    deps.logger.error(
      {
        err: f.error,
        clubId,
        playerId: f.pair.player_id,
        sessionId: f.pair.training_session_id,
        failures: f.failures,
        retryAt: new Date(f.retryAtMs).toISOString(),
      },
      'pod metrics failed for a session: retried after its backoff',
    );
  }
  const report: PodMetricsReport = {
    computed: result.computed,
    unchanged: result.unchanged,
    deleted: result.deleted,
    skipped,
    backingOff: result.backingOff,
    configIssues: issues.length,
    failed: result.failures.length,
    failures: result.failures.map((f) => ({
      playerId: f.pair.player_id,
      sessionId: f.pair.training_session_id,
      failures: f.failures,
    })),
    more: result.more,
  };
  if (report.computed + report.deleted + report.failed > 0 || Object.keys(skipped).length > 0) {
    deps.logger.info({ clubId, ...report, failures: undefined }, 'pod metrics');
  }
  return report;
}

/** The clubs with pod metric work (`app.worker_pod_metric_clubs()`). */
export async function listPodMetricClubs(pool: pg.Pool): Promise<ClubId[]> {
  const { rows } = await pool.query<{ club_id: ClubId }>(
    'select c as club_id from app.worker_pod_metric_clubs() c',
  );
  return rows.map((r) => r.club_id);
}
