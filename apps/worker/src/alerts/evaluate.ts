import { schema } from '@sport-performance/db';
import type { StoredSkippedAlertRule } from '@sport-performance/db/schema';
import {
  AlertRuleValidationError,
  CMJ_ALERT_SOURCE,
  addDays,
  cmjMeasurementsForAlerts,
  compareLocalDates,
  evaluateAlertRules,
  nextAlertEpisode,
  parseAlertRule,
  scoreResultMetrics,
  wellnessStageOn,
  type AlertEpisode,
  type AlertEvaluation,
  type AlertRule,
  type AlertRuleKind,
  type AlertRuleOf,
  type AlertSeverity,
  type AlertStatus,
  type AttemptAggregation,
  type ClubId,
  type CmjResultForAlerts,
  type LocalDate,
  type MetricDirection,
  type PlayerDailyState,
  type PlayerId,
  type Sex,
  type Sport,
  type Stage,
} from '@sport-performance/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { ClubTransaction } from '../database.js';

const { alert, alertRule, playerAlertEvaluation } = schema;

/**
 * Alert generation (B-327, ADR 0053): after the derived values of a player
 * are written, the worker evaluates the club's declarative rules (ADR 0022)
 * for the club's today, from the derived tables, and moves each rule's
 * episode forward with the domain's `nextAlertEpisode`. Alerts are load
 * heuristics, never a diagnosis (principle 7).
 */

/** A rule of the club, validated by the domain, with its row id. */
export interface ClubAlertRule {
  readonly id: string;
  readonly rule: AlertRule;
}

/** Thrown when a stored rule does not pass the domain's parser: the job fails loudly. */
export class InvalidAlertRuleError extends Error {
  override readonly name = 'InvalidAlertRuleError';
  constructor(
    readonly ruleCode: string,
    cause: unknown,
  ) {
    super(
      `Alert rule "${ruleCode}" is invalid: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/**
 * The club's rule set, in a stable order (creation, then code; the engine
 * breaks ties between alerts of the same severity by it). Every rule goes
 * through `parseAlertRule`, the parser the API uses on write: a rule edited
 * by hand into an invalid shape fails the job instead of being skipped.
 */
export async function readAlertRules(tx: ClubTransaction): Promise<ClubAlertRule[]> {
  const rows = await tx.db
    .select({
      id: alertRule.id,
      code: alertRule.code,
      kind: alertRule.kind,
      enabled: alertRule.enabled,
      sports: alertRule.sports,
      sexes: alertRule.sexes,
      stages: alertRule.stages,
      params: alertRule.params,
    })
    .from(alertRule)
    .orderBy(asc(alertRule.createdAt), asc(alertRule.code));
  return rows.map((row) => {
    try {
      const rule = parseAlertRule({
        code: row.code,
        kind: row.kind,
        enabled: row.enabled,
        appliesTo: {
          ...(row.sports !== null && { sports: row.sports }),
          ...(row.sexes !== null && { sexes: row.sexes }),
          ...(row.stages !== null && { stages: row.stages }),
        },
        params: row.params,
      });
      return { id: row.id, rule };
    } catch (error) {
      if (error instanceof AlertRuleValidationError)
        throw new InvalidAlertRuleError(row.code, error);
      throw error;
    }
  });
}

/** The player as the evaluation needs it. */
export interface AlertSubject {
  readonly id: PlayerId;
  readonly sex: Sex;
  readonly sport: Sport;
  readonly leftOn: LocalDate | null;
}

/** The enabled rules of one kind. */
function rulesOf<K extends AlertRuleKind>(
  rules: readonly ClubAlertRule[],
  kind: K,
): AlertRuleOf<K>[] {
  return rules.flatMap(({ rule }) =>
    rule.enabled && rule.kind === kind ? [rule as AlertRuleOf<K>] : [],
  );
}

/**
 * Stage of the player on `day`: the stage assignment valid that day (a
 * staff pin first), else the youngest default stage of their categories that
 * day. Same rule as the item set of wellness (`wellnessStageOn`).
 */
async function stageOn(
  tx: ClubTransaction,
  playerId: PlayerId,
  day: LocalDate,
): Promise<Stage | null> {
  const { rows } = await tx.client.query<{ assigned: Stage | null; defaults: Stage[] }>(
    `select (select s.stage::text from player_stage s
              where s.player_id = $1 and s.valid_from <= $2::date
                and (s.valid_to is null or s.valid_to > $2::date)
              order by (s.basis = 'manual') desc, s.valid_from desc
              limit 1) as assigned,
            array(select c.default_stage::text
                    from player_category pc
                    join category c on c.club_id = pc.club_id and c.id = pc.category_id
                   where pc.player_id = $1 and pc.valid_from <= $2::date
                     and (pc.valid_to is null or pc.valid_to > $2::date)) as defaults`,
    [playerId, day],
  );
  const row = rows[0];
  return wellnessStageOn({
    assignedStage: row?.assigned ?? null,
    categoryDefaultStages: row?.defaults ?? [],
  });
}

/** Best valid CMJ height of each result in `[from, to]`, with its method. */
async function readCmjResults(
  tx: ClubTransaction,
  playerId: PlayerId,
  from: LocalDate,
  to: LocalDate,
): Promise<CmjResultForAlerts[]> {
  const { rows } = await tx.client.query<{
    result_id: string;
    measured_on: LocalDate;
    method: string;
    aggregation: AttemptAggregation;
    direction: MetricDirection;
    value: number;
    attempt_number: number | null;
  }>(
    `select r.id as result_id, r.measured_on::text, r.method::text,
            d.attempt_aggregation::text as aggregation, m.direction::text, v.value, v.attempt_number
       from test_result r
       join test_definition d on d.club_id = r.club_id and d.id = r.test_definition_id
       join test_result_value v on v.club_id = r.club_id and v.test_result_id = r.id
       join metric_definition m on m.club_id = v.club_id and m.id = v.metric_definition_id
      where r.player_id = $1 and r.status = 'done' and r.method is not null
        and d.code = $2 and m.code = $3 and v.voided_at is null
        and r.measured_on between $4::date and $5::date
      order by r.measured_on, r.id, v.recorded_at, v.id`,
    [playerId, CMJ_ALERT_SOURCE.testCode, CMJ_ALERT_SOURCE.metricCode, from, to],
  );
  const byResult = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byResult.get(row.result_id);
    if (list === undefined) byResult.set(row.result_id, [row]);
    else list.push(row);
  }
  const results: CmjResultForAlerts[] = [];
  for (const values of byResult.values()) {
    const first = values[0];
    if (first === undefined) continue;
    const [score] = scoreResultMetrics(
      values.map((v) => ({
        metricCode: CMJ_ALERT_SOURCE.metricCode,
        value: v.value,
        attemptNumber: v.attempt_number,
      })),
      () => ({ aggregation: first.aggregation, direction: first.direction }),
    );
    if (score === undefined || !(score.value > 0)) continue;
    results.push({ date: first.measured_on, heightCm: score.value, method: first.method });
  }
  return results;
}

/**
 * The engine's input for one player on the club day `today`, read from the
 * derived tables (ACWR and history days, daily wellness, growth velocity)
 * and from the CMJ results. Only the blocks some enabled rule needs are read;
 * a missing block skips its rules with `no_data`, never alerts.
 */
export async function readPlayerDailyState(
  tx: ClubTransaction,
  subject: AlertSubject,
  today: LocalDate,
  rules: readonly ClubAlertRule[],
): Promise<PlayerDailyState> {
  const stage = await stageOn(tx, subject.id, today);
  const base: PlayerDailyState = {
    date: today,
    sport: subject.sport,
    sex: subject.sex,
    ...(stage !== null && { stage }),
  };

  let acwr: PlayerDailyState['acwr'] = null;
  if (rulesOf(rules, 'acwr_high').length + rulesOf(rules, 'acwr_low').length > 0) {
    const { rows } = await tx.client.query<{ acwr: number | null; history_days: number }>(
      'select acwr, history_days from player_load_daily where player_id = $1 and local_date = $2::date',
      [subject.id, today],
    );
    const row = rows[0];
    acwr = row === undefined ? null : { ratio: row.acwr, historyDays: row.history_days };
  }

  let wellness: PlayerDailyState['wellness'];
  const zScoreRules = rulesOf(rules, 'wellness_zscore_low');
  if (zScoreRules.length + rulesOf(rules, 'wellness_low').length > 0) {
    const windowDays = Math.max(0, ...zScoreRules.map((r) => r.params.windowDays));
    const { rows } = await tx.client.query<{ local_date: LocalDate; mean_score: number }>(
      `select local_date::text, mean_score from player_wellness_daily
        where player_id = $1 and local_date between $2::date and $3::date
        order by local_date`,
      [subject.id, addDays(today, -windowDays), today],
    );
    wellness = rows.map((r) => ({ date: r.local_date, meanScore: r.mean_score }));
  }

  let cmj: PlayerDailyState['cmj'] = null;
  const cmjRules = rulesOf(rules, 'cmj_drop');
  if (cmjRules.length > 0) {
    const spanDays = Math.max(
      ...cmjRules.map((r) => r.params.maxMeasurementAgeDays + r.params.baselineWindowDays),
    );
    const results = await readCmjResults(tx, subject.id, addDays(today, -spanDays), today);
    // A baseline pinned by the staff has no storage yet: the rolling baseline is used.
    cmj = { measurements: cmjMeasurementsForAlerts(results, today), baselineHeightCm: null };
  }

  let growth: PlayerDailyState['growth'] = null;
  if (rulesOf(rules, 'growth_peak').length > 0) {
    const { rows } = await tx.client.query<{ measured_on: LocalDate; velocity: number }>(
      `select measured_on::text, growth_velocity_cm_year as velocity from anthro_measurement
        where player_id = $1 and measured_on <= $2::date and growth_velocity_cm_year is not null
        order by measured_on desc, created_at desc
        limit 1`,
      [subject.id, today],
    );
    const row = rows[0];
    growth =
      row === undefined ? null : { velocityCmYear: row.velocity, measuredOn: row.measured_on };
  }

  return {
    ...base,
    acwr,
    ...(wellness !== undefined && { wellness }),
    cmj,
    growth,
  };
}

interface StoredEpisode extends AlertEpisode {
  readonly id: string;
  readonly alertRuleId: string;
}

/** The most recent episode of every rule for the player. */
async function readLatestEpisodes(
  tx: ClubTransaction,
  playerId: PlayerId,
): Promise<Map<string, StoredEpisode>> {
  const { rows } = await tx.client.query<{
    id: string;
    alert_rule_id: string;
    raised_on: LocalDate;
    last_seen_on: LocalDate;
    resolved_on: LocalDate | null;
    severity: AlertSeverity;
    current_severity: AlertSeverity;
    status: AlertStatus;
    observed_on: LocalDate;
    values: Record<string, number>;
  }>(
    `select distinct on (alert_rule_id)
            id, alert_rule_id, local_date::text as raised_on, last_seen_on::text,
            resolved_on::text, severity::text, current_severity::text, status::text,
            observed_on::text, values
       from alert
      where player_id = $1
      order by alert_rule_id, local_date desc`,
    [playerId],
  );
  return new Map(
    rows.map((r) => [
      r.alert_rule_id,
      {
        id: r.id,
        alertRuleId: r.alert_rule_id,
        raisedOn: r.raised_on,
        lastSeenOn: r.last_seen_on,
        resolvedOn: r.resolved_on,
        severity: r.severity,
        currentSeverity: r.current_severity,
        status: r.status,
        observedOn: r.observed_on,
        values: r.values,
      },
    ]),
  );
}

/** What one evaluation changed, for the logs and the tests. */
export interface PlayerAlertsReport {
  readonly raised: number;
  readonly updated: number;
  /** Rules that fired today. */
  readonly firing: number;
}

/**
 * Evaluates the player's alerts on the club day `today` and persists the
 * episodes that changed, in the caller's transaction. A player who left the
 * club (`left_on` on or before today) is no longer evaluated: their active
 * episodes resolve. Idempotent: the same day with the same data writes no
 * episode (only the evaluation's timestamp).
 */
export async function evaluatePlayerAlerts(
  tx: ClubTransaction,
  clubId: ClubId,
  subject: AlertSubject,
  today: LocalDate,
  rules: readonly ClubAlertRule[],
  now: Date,
): Promise<PlayerAlertsReport> {
  const active = subject.leftOn === null || compareLocalDates(subject.leftOn, today) > 0;
  let evaluation: AlertEvaluation;
  if (active) {
    const state = await readPlayerDailyState(tx, subject, today, rules);
    evaluation = evaluateAlertRules(
      rules.map((r) => r.rule),
      state,
    );
  } else {
    evaluation = {
      date: today,
      alerts: [],
      skipped: rules.map(({ rule }) => ({
        ruleCode: rule.code,
        kind: rule.kind,
        reason: 'not_applicable' as const,
      })),
    };
  }

  const latest = await readLatestEpisodes(tx, subject.id);
  let raised = 0;
  let updated = 0;
  for (const { id: ruleId, rule } of rules) {
    const fired = evaluation.alerts.find((a) => a.ruleCode === rule.code) ?? null;
    const current = latest.get(ruleId) ?? null;
    const change = nextAlertEpisode(current, today, fired);
    if (change.type === 'none') continue;
    const { episode } = change;
    if (change.type === 'raise') {
      await tx.db.insert(alert).values({
        clubId,
        alertRuleId: ruleId,
        playerId: subject.id,
        kind: rule.kind,
        severity: episode.severity,
        currentSeverity: episode.currentSeverity,
        localDate: episode.raisedOn,
        lastSeenOn: episode.lastSeenOn,
        resolvedOn: episode.resolvedOn,
        observedOn: episode.observedOn,
        values: episode.values,
        status: episode.status,
      });
      raised += 1;
      continue;
    }
    if (current === null) continue;
    const reopenReview = episode.status === 'open' && current.status !== 'open';
    await tx.db
      .update(alert)
      .set({
        severity: episode.severity,
        currentSeverity: episode.currentSeverity,
        lastSeenOn: episode.lastSeenOn,
        resolvedOn: episode.resolvedOn,
        observedOn: episode.observedOn,
        values: episode.values,
        ...(reopenReview && {
          status: 'open' as const,
          acknowledgedAt: null,
          acknowledgedBy: null,
          acknowledgementNote: null,
        }),
      })
      .where(and(eq(alert.clubId, clubId), eq(alert.id, current.id)));
    updated += 1;
  }

  const skipped: StoredSkippedAlertRule[] = evaluation.skipped.map((s) => ({
    ruleCode: s.ruleCode,
    kind: s.kind,
    reason: s.reason,
  }));
  await tx.db
    .insert(playerAlertEvaluation)
    .values({ clubId, playerId: subject.id, evaluatedOn: today, evaluatedAt: now, skipped })
    .onConflictDoUpdate({
      target: [playerAlertEvaluation.clubId, playerAlertEvaluation.playerId],
      set: { evaluatedOn: today, evaluatedAt: now, skipped },
      // Episodes only move forward: an older day never overwrites a newer evaluation.
      setWhere: sql`${playerAlertEvaluation.evaluatedOn} <= excluded.evaluated_on`,
    });

  return { raised, updated, firing: evaluation.alerts.length };
}

/**
 * Players of the club due for the daily evaluation on `today`: never
 * evaluated, or last evaluated before today, and either still in the club
 * or with an active alert to resolve.
 */
export async function readAlertsDue(tx: ClubTransaction, today: LocalDate): Promise<PlayerId[]> {
  const { rows } = await tx.client.query<{ id: PlayerId }>(
    `select p.id
       from player p
       left join player_alert_evaluation e on e.club_id = p.club_id and e.player_id = p.id
      where (e.evaluated_on is null or e.evaluated_on < $1::date)
        and ((p.left_on is null or p.left_on > $1::date)
             or exists (select 1 from alert a
                         where a.club_id = p.club_id and a.player_id = p.id and a.resolved_on is null))
      order by p.id`,
    [today],
  );
  return rows.map((r) => r.id);
}
