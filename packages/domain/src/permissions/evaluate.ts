import type { ConsentType } from '../consent.js';
import type { CategoryId, ClubId, PlayerId } from '../ids.js';
import type { Sport } from '../sport.js';
import { STAGE_PROFILES } from '../stage.js';
import { ruleFor } from './matrix.js';
import { PERMISSION_RESOURCES, actionsOf, type ActionOf, type ResourceKind } from './resources.js';
import type { AllowRule, PlayerCondition } from './rules.js';
import type { PermissionResource, PermissionSubject, PlayerFacts } from './subject.js';

/**
 * Why a request was denied. Stable and safe to log (no personal data); the
 * API answers 403 for all of them without telling which one (B-303).
 *
 * - `role_denied`: the cell of the role is a denial.
 * - `no_club`: the subject has not picked a club.
 * - `other_club`: the resource belongs to another club.
 * - `missing_target`: the scope needs a player (or category) the request did not give.
 * - `out_of_scope`: not assigned, not the subject's player, no guardian link.
 * - `age_restricted`: the player is not a minor / not of age as the rule needs,
 *   or is of age and did not keep the guardian's access.
 * - `stage_restricted`: stage or age band forbid it (percentiles, named rankings).
 * - `missing_consent`: a required consent is not current.
 * - `missing_fact`: the rule needs a fact about the player the request did not give.
 */
export const DENIAL_REASONS = [
  'role_denied',
  'no_club',
  'other_club',
  'missing_target',
  'out_of_scope',
  'age_restricted',
  'stage_restricted',
  'missing_consent',
  'missing_fact',
] as const;
export type DenialReason = (typeof DENIAL_REASONS)[number];

/**
 * What the caller must do along with an allowed access.
 *
 * - `audit_medical_access`: write the `medical` audit row in the same
 *   transaction (ADR 0008).
 * - `audit_support_access`: record the superadmin's support access (CLAUDE.md:
 *   "soporte con auditoría").
 */
export const PERMISSION_OBLIGATIONS = ['audit_medical_access', 'audit_support_access'] as const;
export type PermissionObligation = (typeof PERMISSION_OBLIGATIONS)[number];

export type PermissionDecision =
  | { readonly allowed: true; readonly obligations: readonly PermissionObligation[] }
  | {
      readonly allowed: false;
      readonly reason: DenialReason;
      /** Consents that were missing, for `missing_consent` (the UI can ask for them). */
      readonly missingConsents?: readonly ConsentType[];
    };

function denied(reason: DenialReason): PermissionDecision {
  return { allowed: false, reason };
}

/**
 * Decides one access with the matrix. Pure and total: never throws for a
 * well-typed input, and denies whenever something it needs is missing.
 */
export function decide<K extends ResourceKind>(
  subject: PermissionSubject,
  action: ActionOf<K>,
  resource: PermissionResource<K>,
): PermissionDecision {
  const rule = ruleFor(resource.kind, action, subject.role);
  if (rule.effect === 'deny') return denied('role_denied');

  if (rule.scope !== 'platform') {
    if ((subject.clubId ?? null) === null) return denied('no_club');
    if (resource.clubId !== subject.clubId) return denied('other_club');
    const scoped = checkScope(rule, subject, resource);
    if (scoped !== null) return scoped;
    const required = checkRequirements(rule, resource.player);
    if (required !== null) return required;
  }

  return { allowed: true, obligations: obligationsFor(subject, resource.kind) };
}

/**
 * Obligations of an allowed access. They depend only on the resource kind and
 * the role, so {@link decide} and {@link listScope} share them.
 */
function obligationsFor(
  subject: PermissionSubject,
  kind: ResourceKind,
): readonly PermissionObligation[] {
  const obligations: PermissionObligation[] = [];
  if (PERMISSION_RESOURCES[kind].medical) obligations.push('audit_medical_access');
  if (subject.role === 'superadmin') obligations.push('audit_support_access');
  return obligations;
}

/** Whether the subject may do `action` on the resource. */
export function can<K extends ResourceKind>(
  subject: PermissionSubject,
  action: ActionOf<K>,
  resource: PermissionResource<K>,
): boolean {
  return decide(subject, action, resource).allowed;
}

/**
 * Thrown by {@link authorize}. Framework-agnostic: the API maps it to its
 * error envelope with a 403 (`forbidden`) and never tells the client the
 * reason, which only goes to logs.
 */
export class PermissionDeniedError extends Error {
  override readonly name = 'PermissionDeniedError';
  readonly code = 'forbidden' as const;
  readonly kind: ResourceKind;
  readonly action: string;
  readonly reason: DenialReason;
  readonly missingConsents: readonly ConsentType[];

  constructor(
    kind: ResourceKind,
    action: string,
    decision: Extract<PermissionDecision, { allowed: false }>,
  ) {
    super(`Permission denied: ${action} on ${kind} (${decision.reason}).`);
    this.kind = kind;
    this.action = action;
    this.reason = decision.reason;
    this.missingConsents = decision.missingConsents ?? [];
  }
}

/**
 * Decides and throws {@link PermissionDeniedError} when denied; returns the
 * obligations otherwise. Endpoint handlers call it before touching data.
 */
export function authorize<K extends ResourceKind>(
  subject: PermissionSubject,
  action: ActionOf<K>,
  resource: PermissionResource<K>,
): readonly PermissionObligation[] {
  const decision = decide(subject, action, resource);
  if (!decision.allowed) throw new PermissionDeniedError(resource.kind, action, decision);
  return decision.obligations;
}

/** Actions the subject may do on the resource, in declaration order (to show or hide UI). */
export function permittedActions<K extends ResourceKind>(
  subject: PermissionSubject,
  resource: PermissionResource<K>,
): ActionOf<K>[] {
  return actionsOf(resource.kind).filter((action) => can(subject, action, resource));
}

/**
 * Which rows of a kind a subject may list, as a filter to translate into SQL
 * (on top of RLS). When `rowCheck` is `true` the rule also has consent or
 * player conditions, so every row must still pass {@link can} with its facts.
 *
 * Every variant but `none` carries the same `obligations` that {@link decide}
 * gives for one row: a list endpoint must fulfil them for the rows it returns
 * (the `medical` audit row for every read, ADR 0008; the superadmin's support
 * audit), in the same transaction.
 */
export type ListScope =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'platform';
      readonly rowCheck: false;
      readonly obligations: readonly PermissionObligation[];
    }
  | {
      readonly kind: 'club';
      readonly clubId: ClubId;
      readonly rowCheck: boolean;
      readonly obligations: readonly PermissionObligation[];
    }
  | {
      readonly kind: 'assigned';
      readonly clubId: ClubId;
      readonly categoryIds: readonly CategoryId[];
      readonly sports: readonly Sport[];
      readonly rowCheck: boolean;
      readonly obligations: readonly PermissionObligation[];
    }
  | {
      readonly kind: 'players';
      readonly clubId: ClubId;
      readonly playerIds: readonly PlayerId[];
      readonly rowCheck: boolean;
      readonly obligations: readonly PermissionObligation[];
    };

export function listScope<K extends ResourceKind>(
  subject: PermissionSubject,
  kind: K,
  action: ActionOf<K>,
): ListScope {
  const none: ListScope = { kind: 'none' };
  const rule = ruleFor(kind, action, subject.role);
  if (rule.effect === 'deny') return none;
  const obligations = obligationsFor(subject, kind);
  if (rule.scope === 'platform') return { kind: 'platform', rowCheck: false, obligations };
  const clubId = subject.clubId ?? null;
  if (clubId === null) return none;
  const hasRequirements = rule.consents.length > 0 || rule.conditions.length > 0;

  switch (rule.scope) {
    case 'club':
      return { kind: 'club', clubId, rowCheck: hasRequirements, obligations };
    case 'assigned': {
      const assignments = subject.assignments ?? [];
      const categoryIds = assignments.flatMap((a) => (a.kind === 'category' ? [a.categoryId] : []));
      const sports = assignments.flatMap((a) => (a.kind === 'sport' ? [a.sport] : []));
      if (categoryIds.length === 0 && sports.length === 0) return none;
      return {
        kind: 'assigned',
        clubId,
        categoryIds,
        sports,
        rowCheck: hasRequirements,
        obligations,
      };
    }
    case 'self': {
      const playerId = subject.playerId ?? null;
      if (playerId === null) return none;
      return {
        kind: 'players',
        clubId,
        playerIds: [playerId],
        rowCheck: hasRequirements,
        obligations,
      };
    }
    case 'guardian': {
      const playerIds = (subject.guardianships ?? []).map((g) => g.playerId);
      if (playerIds.length === 0) return none;
      // Majority (B-311) depends on each player: unconfirmed links need the row's facts.
      const rowCheck =
        hasRequirements || (subject.guardianships ?? []).some((g) => !g.confirmedByAdultPlayer);
      return { kind: 'players', clubId, playerIds, rowCheck, obligations };
    }
  }
}

function checkScope(
  rule: AllowRule,
  subject: PermissionSubject,
  resource: PermissionResource,
): PermissionDecision | null {
  const { player, category } = resource;
  switch (rule.scope) {
    case 'platform':
    case 'club':
      return null;
    case 'assigned': {
      const assignments = subject.assignments ?? [];
      if (player !== undefined) {
        const inScope = assignments.some((a) =>
          a.kind === 'category'
            ? player.categoryIds.includes(a.categoryId)
            : a.sport === player.sport,
        );
        return inScope ? null : denied('out_of_scope');
      }
      if (category !== undefined) {
        const inScope = assignments.some((a) =>
          a.kind === 'category' ? a.categoryId === category.id : a.sport === category.sport,
        );
        return inScope ? null : denied('out_of_scope');
      }
      return denied('missing_target');
    }
    case 'self':
      if (player === undefined) return denied('missing_target');
      return (subject.playerId ?? null) === player.id ? null : denied('out_of_scope');
    case 'guardian': {
      if (player === undefined) return denied('missing_target');
      const link = (subject.guardianships ?? []).find((g) => g.playerId === player.id);
      if (link === undefined) return denied('out_of_scope');
      if (link.confirmedByAdultPlayer) return null;
      if (player.ofAge === undefined) return denied('missing_fact');
      return player.ofAge ? denied('age_restricted') : null;
    }
  }
}

function checkRequirements(
  rule: AllowRule,
  player: PlayerFacts | undefined,
): PermissionDecision | null {
  if (rule.consents.length === 0 && rule.conditions.length === 0) return null;
  if (player === undefined) return denied('missing_target');

  for (const condition of rule.conditions) {
    const failed = checkCondition(condition, player);
    if (failed !== null) return failed;
  }

  if (rule.consents.length > 0) {
    if (player.consents === undefined) return denied('missing_fact');
    const current = player.consents;
    const missingConsents = rule.consents.filter((c) => !current.includes(c));
    if (missingConsents.length > 0) {
      return { allowed: false, reason: 'missing_consent', missingConsents };
    }
  }
  return null;
}

function checkCondition(
  condition: PlayerCondition,
  player: PlayerFacts,
): PermissionDecision | null {
  switch (condition) {
    case 'minor':
    case 'adult': {
      if (player.ofAge === undefined) return denied('missing_fact');
      return player.ofAge === (condition === 'adult') ? null : denied('age_restricted');
    }
    case 'own_percentiles': {
      if (player.stage === undefined || player.ageBand === undefined) return denied('missing_fact');
      const ok =
        STAGE_PROFILES[player.stage].playerSeesOwnPercentiles &&
        player.ageBand.ownPercentilesForPlayers;
      return ok ? null : denied('stage_restricted');
    }
    case 'named_rankings': {
      if (player.stage === undefined || player.ageBand === undefined) return denied('missing_fact');
      const ok =
        STAGE_PROFILES[player.stage].playerSeesNamedRankings &&
        player.ageBand.namedRankingsForPlayers;
      return ok ? null : denied('stage_restricted');
    }
  }
}
