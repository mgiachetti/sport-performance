import { CONSENT_TYPES, type ConsentType } from '../consent.js';
import { memberGuard } from '../enum.js';

/**
 * Where an allowed role may act (B-303, ADR 0025). Every scope except
 * `platform` also requires the resource to be in the subject's club.
 *
 * - `platform`: anywhere; only for the registry of clubs (superadmin).
 * - `club`: anything of the club.
 * - `assigned`: players and categories in the subject's current staff
 *   assignments (`staff_assignment`: by category, or by sport).
 * - `self`: the subject's own player.
 * - `guardian`: a player the subject has a current guardian link with; once
 *   the player is of age, only if the adult player kept the link (B-311).
 */
export const PERMISSION_SCOPES = ['platform', 'club', 'assigned', 'self', 'guardian'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];
export const isPermissionScope = memberGuard(PERMISSION_SCOPES);

/**
 * Conditions on the player of the resource, on top of the scope.
 *
 * - `own_percentiles`: the player may see their own percentiles: stage
 *   (`StageProfile.playerSeesOwnPercentiles`) **and** age band
 *   (`AgeBand.ownPercentilesForPlayers`, from M15).
 * - `named_rankings`: the player may see rankings with names: stage
 *   (`StageProfile.playerSeesNamedRankings`) **and** age band
 *   (`AgeBand.namedRankingsForPlayers`, never M13–M16).
 * - `minor` / `adult`: the player is under / at least `AGE_OF_MAJORITY_YEARS`.
 */
export const PLAYER_CONDITIONS = ['own_percentiles', 'named_rankings', 'minor', 'adult'] as const;
export type PlayerCondition = (typeof PLAYER_CONDITIONS)[number];
export const isPlayerCondition = memberGuard(PLAYER_CONDITIONS);

/** A requirement of an allow rule: a current consent of a type, or a player condition. */
export type RuleRequirement = ConsentType | PlayerCondition;

export interface DenyRule {
  readonly effect: 'deny';
}

export interface AllowRule {
  readonly effect: 'allow';
  readonly scope: PermissionScope;
  /** Consents the player must have current (all of them). */
  readonly consents: readonly ConsentType[];
  /** Conditions the player must meet (all of them). */
  readonly conditions: readonly PlayerCondition[];
}

/** One cell of the matrix. */
export type PermissionRule = DenyRule | AllowRule;

/** The explicit denial. Every cell is declared: a missing cell does not compile. */
export const deny: DenyRule = Object.freeze({ effect: 'deny' });

/**
 * Builds an allow rule: `allow('assigned', 'data')` is "in the subject's
 * assignments, with a current data consent".
 */
export function allow(scope: PermissionScope, ...requirements: RuleRequirement[]): AllowRule {
  const consents = CONSENT_TYPES.filter((c) => requirements.includes(c));
  const conditions = PLAYER_CONDITIONS.filter((c) => requirements.includes(c));
  if (new Set(requirements).size !== requirements.length) {
    throw new TypeError(`Duplicated requirement in allow(${scope}, ${requirements.join(', ')}).`);
  }
  if (conditions.includes('minor') && conditions.includes('adult')) {
    throw new TypeError('A rule cannot require both a minor and an adult player.');
  }
  if (scope === 'platform' && requirements.length > 0) {
    throw new TypeError('Platform rules have no player to check requirements on.');
  }
  return Object.freeze({
    effect: 'allow',
    scope,
    consents: Object.freeze(consents),
    conditions: Object.freeze(conditions),
  });
}

/** Requirements of a rule, consents first, in vocabulary order. */
export function ruleRequirements(rule: AllowRule): readonly RuleRequirement[] {
  return [...rule.consents, ...rule.conditions];
}

/** Compact notation of a rule: `-`, `club`, `assigned+data`, `self+adult`. */
export function describeRule(rule: PermissionRule): string {
  if (rule.effect === 'deny') return '-';
  return [rule.scope, ...ruleRequirements(rule)].join('+');
}
