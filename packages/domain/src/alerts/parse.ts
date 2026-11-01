import { isWellFormedCode } from '../codes.js';
import { DomainValidationError, describeValue } from '../errors.js';
import { SEXES, isSex } from '../sex.js';
import { SPORTS, isSport } from '../sport.js';
import { STAGES, isStage } from '../stage.js';
import {
  ALERT_RULE_KINDS,
  isAlertRuleKind,
  type AlertRule,
  type AlertRuleKind,
  type AlertRuleParamsByKind,
  type AlertRuleScope,
} from './rules.js';

/**
 * Thrown when a stored or submitted rule is invalid. `path` points at the
 * offending field (`[2].params.warningAboveRatio`) so the API and the rule
 * editor (B-409) can show it next to the input.
 */
export class AlertRuleValidationError extends DomainValidationError {
  readonly path: string;

  constructor(path: string, message: string, value: unknown) {
    super('invalid_argument', `Invalid alert rule at ${path || '<root>'}: ${message}`, value);
    this.path = path;
  }
}

type JsonObject = Readonly<Record<string, unknown>>;

function fail(path: string, message: string, value: unknown): never {
  throw new AlertRuleValidationError(path, message, value);
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function asObject(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, `expected an object, got ${describeValue(value)}`, value);
  }
  return value as JsonObject;
}

/** Rejects unknown keys so a typo (`warningAbove`) never silently disables a threshold. */
function assertKeys(obj: JsonObject, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      fail(join(path, key), `unknown field (expected one of: ${allowed.join(', ')})`, obj[key]);
    }
  }
}

function finite(obj: JsonObject, key: string, path: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(join(path, key), `expected a finite number, got ${describeValue(value)}`, value);
  }
  return value;
}

function integerAtLeast(obj: JsonObject, key: string, min: number, path: string): number {
  const value = finite(obj, key, path);
  if (!Number.isInteger(value) || value < min) {
    fail(join(path, key), `expected an integer >= ${String(min)}, got ${String(value)}`, value);
  }
  return value;
}

/** A nullable threshold that must satisfy `valid` when set. */
function threshold(
  obj: JsonObject,
  key: string,
  path: string,
  valid: (value: number) => boolean,
  expectation: string,
): number | null {
  if (!(key in obj)) fail(join(path, key), 'missing (use null to leave it unset)', undefined);
  if (obj[key] === null) return null;
  const value = finite(obj, key, path);
  if (!valid(value)) fail(join(path, key), `expected ${expectation}, got ${String(value)}`, value);
  return value;
}

/**
 * Checks that at least one severity is set and, when both are, that the
 * critical threshold is at least as strict as the warning one.
 */
function severityPair(
  warning: number | null,
  critical: number | null,
  direction: 'higher_is_stricter' | 'lower_is_stricter',
  path: string,
  criticalKey: string,
): void {
  if (warning === null && critical === null) {
    fail(path, 'at least one of the warning or critical thresholds must be set', null);
  }
  if (warning === null || critical === null) return;
  const ok = direction === 'higher_is_stricter' ? critical >= warning : critical <= warning;
  if (!ok) {
    fail(
      join(path, criticalKey),
      `critical threshold must be ${direction === 'higher_is_stricter' ? '>=' : '<='} the warning threshold (${String(warning)})`,
      critical,
    );
  }
}

const positive = (v: number): boolean => v > 0;
const WELLNESS_MIN_SCORE = 1;
const WELLNESS_MAX_SCORE = 5;

type ParamsParser<K extends AlertRuleKind> = (
  obj: JsonObject,
  path: string,
) => AlertRuleParamsByKind[K];

const PARAMS_PARSERS: { readonly [K in AlertRuleKind]: ParamsParser<K> } = {
  acwr_high: (obj, path) => {
    assertKeys(obj, ['warningAboveRatio', 'criticalAboveRatio', 'minHistoryDays'], path);
    const warningAboveRatio = threshold(obj, 'warningAboveRatio', path, positive, 'a ratio > 0');
    const criticalAboveRatio = threshold(obj, 'criticalAboveRatio', path, positive, 'a ratio > 0');
    severityPair(
      warningAboveRatio,
      criticalAboveRatio,
      'higher_is_stricter',
      path,
      'criticalAboveRatio',
    );
    const minHistoryDays = integerAtLeast(obj, 'minHistoryDays', 0, path);
    return { warningAboveRatio, criticalAboveRatio, minHistoryDays };
  },
  acwr_low: (obj, path) => {
    assertKeys(obj, ['warningBelowRatio', 'criticalBelowRatio', 'minHistoryDays'], path);
    const warningBelowRatio = threshold(obj, 'warningBelowRatio', path, positive, 'a ratio > 0');
    const criticalBelowRatio = threshold(obj, 'criticalBelowRatio', path, positive, 'a ratio > 0');
    severityPair(
      warningBelowRatio,
      criticalBelowRatio,
      'lower_is_stricter',
      path,
      'criticalBelowRatio',
    );
    const minHistoryDays = integerAtLeast(obj, 'minHistoryDays', 0, path);
    return { warningBelowRatio, criticalBelowRatio, minHistoryDays };
  },
  wellness_low: (obj, path) => {
    assertKeys(obj, ['warningBelowScore', 'criticalBelowScore'], path);
    const inScale = (v: number): boolean => v > WELLNESS_MIN_SCORE && v <= WELLNESS_MAX_SCORE;
    const expectation = `a score in (${String(WELLNESS_MIN_SCORE)}, ${String(WELLNESS_MAX_SCORE)}]`;
    const warningBelowScore = threshold(obj, 'warningBelowScore', path, inScale, expectation);
    const criticalBelowScore = threshold(obj, 'criticalBelowScore', path, inScale, expectation);
    severityPair(
      warningBelowScore,
      criticalBelowScore,
      'lower_is_stricter',
      path,
      'criticalBelowScore',
    );
    return { warningBelowScore, criticalBelowScore };
  },
  wellness_zscore_low: (obj, path) => {
    assertKeys(
      obj,
      ['warningBelowZScore', 'criticalBelowZScore', 'windowDays', 'minSamples'],
      path,
    );
    const negative = (v: number): boolean => v < 0;
    const warningBelowZScore = threshold(obj, 'warningBelowZScore', path, negative, 'a z < 0');
    const criticalBelowZScore = threshold(obj, 'criticalBelowZScore', path, negative, 'a z < 0');
    severityPair(
      warningBelowZScore,
      criticalBelowZScore,
      'lower_is_stricter',
      path,
      'criticalBelowZScore',
    );
    const windowDays = integerAtLeast(obj, 'windowDays', 2, path);
    // A sample standard deviation needs at least two values.
    const minSamples = integerAtLeast(obj, 'minSamples', 2, path);
    if (minSamples > windowDays) {
      fail(join(path, 'minSamples'), `must be <= windowDays (${String(windowDays)})`, minSamples);
    }
    return { warningBelowZScore, criticalBelowZScore, windowDays, minSamples };
  },
  cmj_drop: (obj, path) => {
    assertKeys(
      obj,
      [
        'warningDropPct',
        'criticalDropPct',
        'baselineWindowDays',
        'minBaselineSamples',
        'maxMeasurementAgeDays',
      ],
      path,
    );
    const pct = (v: number): boolean => v > 0 && v < 100;
    const warningDropPct = threshold(obj, 'warningDropPct', path, pct, 'a % in (0, 100)');
    const criticalDropPct = threshold(obj, 'criticalDropPct', path, pct, 'a % in (0, 100)');
    severityPair(warningDropPct, criticalDropPct, 'higher_is_stricter', path, 'criticalDropPct');
    const baselineWindowDays = integerAtLeast(obj, 'baselineWindowDays', 1, path);
    const minBaselineSamples = integerAtLeast(obj, 'minBaselineSamples', 1, path);
    if (minBaselineSamples > baselineWindowDays) {
      fail(
        join(path, 'minBaselineSamples'),
        `must be <= baselineWindowDays (${String(baselineWindowDays)})`,
        minBaselineSamples,
      );
    }
    const maxMeasurementAgeDays = integerAtLeast(obj, 'maxMeasurementAgeDays', 0, path);
    return {
      warningDropPct,
      criticalDropPct,
      baselineWindowDays,
      minBaselineSamples,
      maxMeasurementAgeDays,
    };
  },
  growth_peak: (obj, path) => {
    assertKeys(
      obj,
      ['warningAtOrAboveCmYear', 'criticalAtOrAboveCmYear', 'maxMeasurementAgeDays'],
      path,
    );
    const expectation = 'a velocity > 0 cm/year';
    const warningAtOrAboveCmYear = threshold(
      obj,
      'warningAtOrAboveCmYear',
      path,
      positive,
      expectation,
    );
    const criticalAtOrAboveCmYear = threshold(
      obj,
      'criticalAtOrAboveCmYear',
      path,
      positive,
      expectation,
    );
    severityPair(
      warningAtOrAboveCmYear,
      criticalAtOrAboveCmYear,
      'higher_is_stricter',
      path,
      'criticalAtOrAboveCmYear',
    );
    const maxMeasurementAgeDays = integerAtLeast(obj, 'maxMeasurementAgeDays', 0, path);
    return { warningAtOrAboveCmYear, criticalAtOrAboveCmYear, maxMeasurementAgeDays };
  },
};

function scopeList<T extends string>(
  obj: JsonObject,
  key: string,
  allowed: readonly T[],
  isMember: (value: unknown) => value is T,
  path: string,
): readonly T[] | undefined {
  if (!(key in obj)) return undefined;
  const value = obj[key];
  const listPath = join(path, key);
  if (!Array.isArray(value) || value.length === 0) {
    fail(listPath, 'expected a non-empty array (omit the field to match everyone)', value);
  }
  const items: unknown[] = value;
  const out: T[] = [];
  items.forEach((item, index) => {
    if (!isMember(item)) {
      fail(
        `${listPath}[${String(index)}]`,
        `expected one of: ${allowed.join(', ')}, got ${describeValue(item)}`,
        item,
      );
    }
    if (!out.includes(item)) out.push(item);
  });
  return out;
}

function parseScope(value: unknown, path: string): AlertRuleScope {
  const obj = asObject(value, path);
  assertKeys(obj, ['sports', 'sexes', 'stages'], path);
  const sports = scopeList(obj, 'sports', SPORTS, isSport, path);
  const sexes = scopeList(obj, 'sexes', SEXES, isSex, path);
  const stages = scopeList(obj, 'stages', STAGES, isStage, path);
  return {
    ...(sports !== undefined && { sports }),
    ...(sexes !== undefined && { sexes }),
    ...(stages !== undefined && { stages }),
  };
}

function parseRuleAt(value: unknown, path: string): AlertRule {
  const obj = asObject(value, path);
  assertKeys(obj, ['code', 'kind', 'enabled', 'appliesTo', 'params'], path);

  const code = obj.code;
  if (!isWellFormedCode(code)) {
    fail(join(path, 'code'), `expected English snake_case, got ${describeValue(code)}`, code);
  }
  const kind = obj.kind;
  if (!isAlertRuleKind(kind)) {
    fail(
      join(path, 'kind'),
      `expected one of: ${ALERT_RULE_KINDS.join(', ')}, got ${describeValue(kind)}`,
      kind,
    );
  }
  const enabled = obj.enabled;
  if (typeof enabled !== 'boolean') {
    fail(join(path, 'enabled'), `expected a boolean, got ${describeValue(enabled)}`, enabled);
  }
  const appliesTo =
    obj.appliesTo === undefined ? undefined : parseScope(obj.appliesTo, join(path, 'appliesTo'));
  const paramsPath = join(path, 'params');
  const params = PARAMS_PARSERS[kind](asObject(obj.params, paramsPath), paramsPath);

  // The cast is sound: `params` was produced by the parser of `kind`.
  return {
    code,
    kind,
    enabled,
    ...(appliesTo !== undefined && { appliesTo }),
    params,
  } as AlertRule;
}

/**
 * Validates one rule from untrusted input (database JSON, API body) and
 * returns a fresh, normalised copy. Throws {@link AlertRuleValidationError}.
 */
export function parseAlertRule(value: unknown): AlertRule {
  return parseRuleAt(value, '');
}

/**
 * Validates a club's whole rule set: every rule, plus unique codes. Rule order
 * is kept (it breaks ties when sorting alerts of the same severity).
 */
export function parseAlertRuleSet(value: unknown): readonly AlertRule[] {
  if (!Array.isArray(value)) fail('', `expected an array, got ${describeValue(value)}`, value);
  const items: unknown[] = value;
  const seen = new Set<string>();
  return items.map((item, index) => {
    const path = `[${String(index)}]`;
    const rule = parseRuleAt(item, path);
    if (seen.has(rule.code)) fail(join(path, 'code'), `duplicate code "${rule.code}"`, rule.code);
    seen.add(rule.code);
    return rule;
  });
}
