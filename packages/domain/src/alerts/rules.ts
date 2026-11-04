import { memberGuard, memberParser } from '../enum.js';
import type { CoefficientProvenance } from '../maturation/provenance.js';
import type { Sex } from '../sex.js';
import type { Sport } from '../sport.js';
import type { Stage } from '../stage.js';

/**
 * Alert rules (B-207).
 *
 * A rule is **data**: a JSON-serialisable object with a stable `code`, a
 * `kind` (which evaluator runs it), thresholds per severity and windows in
 * `params`, and an optional scope. Rules live in the database (`alert_rule`,
 * B-301), are seeded from {@link DEFAULT_ALERT_RULES} (B-306) and edited per
 * club (B-322, B-409). Nothing in this module is a hardcoded alert: the engine
 * only knows how to evaluate each `kind`.
 *
 * Alerts are load-monitoring heuristics, not injury predictors and never a
 * diagnosis (product principle 7).
 */

/** Alert severities, mildest first. `warning` is yellow, `critical` is red. */
export const ALERT_SEVERITIES = ['warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const isAlertSeverity = memberGuard(ALERT_SEVERITIES);
export const parseAlertSeverity = memberParser(
  ALERT_SEVERITIES,
  'invalid_argument',
  'alert severity',
);

/** Negative if `a` is milder than `b`, 0 if equal, positive otherwise. */
export function compareAlertSeverities(a: AlertSeverity, b: AlertSeverity): number {
  return ALERT_SEVERITIES.indexOf(a) - ALERT_SEVERITIES.indexOf(b);
}

/**
 * What a rule evaluates. Closed set: a new kind needs an evaluator in the
 * engine and its texts in `packages/i18n`.
 *
 * - `acwr_high` / `acwr_low`: EWMA acute:chronic workload ratio (B-202) above /
 *   below a threshold. Silent while the history is insufficient.
 * - `wellness_low`: the day's mean wellness score (1–5, higher is better)
 *   below a threshold.
 * - `wellness_zscore_low`: the day's mean wellness score against the player's
 *   own rolling mean and standard deviation (z-score).
 * - `cmj_drop`: latest CMJ height more than X % below the player's baseline.
 * - `growth_peak`: growth velocity (B-203) in the peak zone.
 */
export const ALERT_RULE_KINDS = [
  'acwr_high',
  'acwr_low',
  'wellness_low',
  'wellness_zscore_low',
  'cmj_drop',
  'growth_peak',
] as const;
export type AlertRuleKind = (typeof ALERT_RULE_KINDS)[number];

export const isAlertRuleKind = memberGuard(ALERT_RULE_KINDS);
export const parseAlertRuleKind = memberParser(
  ALERT_RULE_KINDS,
  'invalid_argument',
  'alert rule kind',
);

/**
 * Who a rule applies to. Every listed dimension must match (AND); an omitted
 * dimension matches everyone. A player whose value for a listed dimension is
 * unknown is out of scope.
 */
export interface AlertRuleScope {
  readonly sports?: readonly Sport[];
  readonly sexes?: readonly Sex[];
  readonly stages?: readonly Stage[];
}

/**
 * Thresholds are `null` when a severity is not used by the rule; at least one
 * is set. Comparisons are strict (`>` / `<`) except where the name says
 * `AtOrAbove`.
 */
export interface AcwrHighParams {
  readonly warningAboveRatio: number | null;
  readonly criticalAboveRatio: number | null;
  /** Fewer days of load history than this means "insufficient history": no alert. */
  readonly minHistoryDays: number;
}

export interface AcwrLowParams {
  readonly warningBelowRatio: number | null;
  readonly criticalBelowRatio: number | null;
  readonly minHistoryDays: number;
}

export interface WellnessLowParams {
  /** Mean wellness score on the 1–5 scale. */
  readonly warningBelowScore: number | null;
  readonly criticalBelowScore: number | null;
}

export interface WellnessZScoreLowParams {
  /** Negative z-scores (standard deviations below the player's own mean). */
  readonly warningBelowZScore: number | null;
  readonly criticalBelowZScore: number | null;
  /** Days before the evaluated day that form the rolling baseline. */
  readonly windowDays: number;
  /** Minimum days with wellness inside the window to compute a z-score. */
  readonly minSamples: number;
}

export interface CmjDropParams {
  /** Drop below baseline, in % of the baseline (`7` means 7 %). */
  readonly warningDropPct: number | null;
  readonly criticalDropPct: number | null;
  /** Days before the latest CMJ whose measurements form the rolling baseline. */
  readonly baselineWindowDays: number;
  /** Minimum days with a CMJ inside the baseline window. */
  readonly minBaselineSamples: number;
  /** The latest CMJ is ignored once it is older than this (days). */
  readonly maxMeasurementAgeDays: number;
}

export interface GrowthPeakParams {
  /** Growth velocity in cm/year at or above which the player is in the peak zone. */
  readonly warningAtOrAboveCmYear: number | null;
  readonly criticalAtOrAboveCmYear: number | null;
  /** The growth velocity is ignored once its latest measurement is older than this (days). */
  readonly maxMeasurementAgeDays: number;
}

export interface AlertRuleParamsByKind {
  readonly acwr_high: AcwrHighParams;
  readonly acwr_low: AcwrLowParams;
  readonly wellness_low: WellnessLowParams;
  readonly wellness_zscore_low: WellnessZScoreLowParams;
  readonly cmj_drop: CmjDropParams;
  readonly growth_peak: GrowthPeakParams;
}

/** One rule of a given kind. */
export interface AlertRuleOf<K extends AlertRuleKind> {
  /** Unique within a club's rule set, English `snake_case`. */
  readonly code: string;
  readonly kind: K;
  readonly enabled: boolean;
  readonly appliesTo?: AlertRuleScope;
  readonly params: AlertRuleParamsByKind[K];
}

/** Any alert rule (discriminated on `kind`). */
export type AlertRule = { [K in AlertRuleKind]: AlertRuleOf<K> }[AlertRuleKind];

/** i18n key of the alert text (`alert.acwr_high.message`), interpolated with `Alert.values`. */
export type AlertMessageKey = `alert.${AlertRuleKind}.message`;
/** i18n key of the suggested action (`alert.acwr_high.suggestion`). */
export type AlertSuggestionKey = `alert.${AlertRuleKind}.suggestion`;

export function alertMessageKey(kind: AlertRuleKind): AlertMessageKey {
  return `alert.${kind}.message`;
}

export function alertSuggestionKey(kind: AlertRuleKind): AlertSuggestionKey {
  return `alert.${kind}.suggestion`;
}

/**
 * Default rule set, ready to be seeded for every new club (B-306) and edited
 * per club. Thresholds from CLAUDE.md ("Alertas por defecto"); the values
 * CLAUDE.md does not fix (z-score, windows, sample sizes, growth threshold,
 * data age) are documented in ADR 0022.
 *
 * **By sex (B-804, ADR 0088).** Only growth is sex specific: girls reach a
 * lower peak height velocity than boys, so `growth_peak` applies to boys and
 * `growth_peak_female` to girls, and nobody gets two growth alerts for one
 * measurement. ACWR, wellness and CMJ are read against the player's own
 * load, scale or baseline, so one rule serves both sexes. The source of each
 * sex-specific threshold is in {@link DEFAULT_ALERT_RULE_SOURCES}.
 */
const DEFAULT_RULES = [
  {
    code: 'acwr_high',
    kind: 'acwr_high',
    enabled: true,
    params: { warningAboveRatio: 1.3, criticalAboveRatio: 1.4, minHistoryDays: 28 },
  },
  {
    code: 'acwr_low',
    kind: 'acwr_low',
    enabled: true,
    params: { warningBelowRatio: 0.8, criticalBelowRatio: null, minHistoryDays: 28 },
  },
  {
    code: 'wellness_low',
    kind: 'wellness_low',
    enabled: true,
    params: { warningBelowScore: 3.3, criticalBelowScore: 3.0 },
  },
  {
    code: 'wellness_zscore_low',
    kind: 'wellness_zscore_low',
    enabled: true,
    params: {
      warningBelowZScore: -1.5,
      criticalBelowZScore: null,
      windowDays: 28,
      minSamples: 10,
    },
  },
  {
    code: 'cmj_drop',
    kind: 'cmj_drop',
    enabled: true,
    params: {
      warningDropPct: 7,
      criticalDropPct: null,
      baselineWindowDays: 42,
      minBaselineSamples: 3,
      maxMeasurementAgeDays: 7,
    },
  },
  {
    code: 'growth_peak',
    kind: 'growth_peak',
    enabled: true,
    // Scoped by sex, like `growth_peak_female`: a player without a sex would match
    // neither and get no growth alert. Unreachable today (`player.sex` is NOT NULL);
    // revisit both rules if the sex ever becomes optional.
    appliesTo: { sexes: ['male'] },
    params: {
      warningAtOrAboveCmYear: 7.2,
      criticalAtOrAboveCmYear: null,
      maxMeasurementAgeDays: 120,
    },
  },
  {
    code: 'growth_peak_female',
    kind: 'growth_peak',
    enabled: true,
    appliesTo: { sexes: ['female'] },
    params: {
      warningAtOrAboveCmYear: 6,
      criticalAtOrAboveCmYear: null,
      maxMeasurementAgeDays: 120,
    },
  },
] as const satisfies readonly AlertRule[];

export const DEFAULT_ALERT_RULES: readonly AlertRule[] = DEFAULT_RULES;

/** Code of a rule of {@link DEFAULT_ALERT_RULES}. */
export type DefaultAlertRuleCode = (typeof DEFAULT_RULES)[number]['code'];

/**
 * Where the threshold of each sex-specific default rule comes from and how
 * far it was checked (the same shape as the maturation coefficients). Every
 * rule of {@link DEFAULT_ALERT_RULES} scoped by sex has an entry; a test keeps
 * them in step. **Verify against the papers before production.**
 */
export const DEFAULT_ALERT_RULE_SOURCES: Readonly<
  Partial<Record<DefaultAlertRuleCode, CoefficientProvenance>>
> = {
  growth_peak: {
    citation:
      'Kemper GLJ, van der Sluis A, Brink MS, Visscher C, Frencken WGP, Elferink-Gemser MT. ' +
      'Anthropometric injury risk factors in elite-standard youth soccer. ' +
      'Int J Sports Med. 2015;36(13):1112-1117.',
    doi: '10.1055/s-0035-1555778',
    errata: [],
    verification: 'unverified',
    verificationNotes:
      'Rapid growth from 0.6 cm/month (7.2 cm/year) in male academy players, as quoted by ' +
      'academy growth-monitoring guidance (ADR 0022). Pending: confirm the DOI, compare with the ' +
      'original article and agree the threshold with the staff before production.',
  },
  growth_peak_female: {
    citation:
      'Malina RM, Bouchard C, Bar-Or O. Growth, Maturation, and Physical Activity. 2nd ed. ' +
      'Champaign (IL): Human Kinetics; 2004. Peak height velocity of girls about 8.0 cm/year ' +
      'against about 9.5 cm/year in boys (also Tanner JM, Whitehouse RH, Takaishi M. ' +
      'Arch Dis Child. 1966;41(219):454-471, doi:10.1136/adc.41.219.454).',
    // The main source is a book without a DOI; the DOI of the supporting article is in the citation.
    doi: null,
    errata: [],
    verification: 'unverified',
    verificationNotes:
      'No published injury threshold for girls: 6.0 cm/year is the boys threshold (7.2 cm/year, ' +
      'Kemper et al. 2015) scaled by the ratio of peak height velocities, 7.2 x 8.0 / 9.5 = 6.06, ' +
      'rounded down. Pending: compare the peak velocities with the originals and agree the ' +
      'threshold with the medical and S&C staff, and confirm the DOI of Tanner et al., before production.',
  },
};
