import { describe, expect, it } from 'vitest';
import { DEFAULT_AGE_BANDS, type AgeBand } from '../category.js';
import { CONSENT_TYPES, type ConsentType } from '../consent.js';
import type { CategoryId, ClubId, PlayerId, UserId } from '../ids.js';
import { ROLES, type Role } from '../role.js';
import type { Stage } from '../stage.js';
import { decide, listScope, type DenialReason, type PermissionDecision } from './evaluate.js';
import { PERMISSION_MATRIX, permissionCells, type RoleRules } from './matrix.js';
import { PERMISSION_RESOURCES, type ResourceKind } from './resources.js';
import { deny, describeRule, isPermissionScope, isPlayerCondition } from './rules.js';
import type { PermissionResource, PermissionSubject, PlayerFacts } from './subject.js';

/**
 * Specification of every cell, written apart from the matrix on purpose: a
 * permission changes only when both are edited (change control), and each
 * cell is checked with probes derived from this text, not from the matrix.
 *
 * One line per `kind.action`, one token per role in the order of the header
 * (which must be `ROLES`). A token is `-` (denied) or `scope[+requirement…]`, with scopes `platform`,
 * `club`, `assigned`, `self`, `guardian` and requirements `data`, `image`,
 * `health` (consents) and `own_percentiles`, `named_rankings`, `minor`,
 * `adult` (player conditions).
 */
const SPEC_GRID = `
                         player                parent          coach           sc              medical          admin       superadmin
club_registry.read       -                     -               -               -               -                -           platform
club_registry.create     -                     -               -               -               -                -           platform
club_registry.update     -                     -               -               -               -                -           platform
club.read                club                  club            club            club            club             club        club
club.update              -                     -               -               -               -                club        club
support_access.read      -                     -               -               -               -                club        club
membership.read          -                     -               -               -               -                club        club
membership.invite        -                     -               -               -               -                club        club
membership.update        -                     -               -               -               -                club        club
membership.revoke        -                     -               -               -               -                club        club
staff_assignment.read    -                     -               -               -               -                club        club
staff_assignment.manage  -                     -               -               -               -                club        club
category.read            -                     -               assigned        assigned        assigned         club        club
category.manage          -                     -               -               -               -                club        club
season.read              club                  club            club            club            club             club        club
season.manage            -                     -               -               -               -                club        club
season.plan_windows      -                     -               -               club            -                club        club
metric_catalog.read      club                  club            club            club            club             club        club
configuration.read       -                     -               club            club            club             club        club
configuration.update     -                     -               -               club            -                club        club
data_import.run          -                     -               -               assigned        -                club        club
change_history.read      -                     -               assigned        assigned        assigned         club        club
player_profile.read      self                  -               assigned        assigned        assigned         club        club
player_profile.create    -                     -               -               -               -                club        club
player_profile.update    -                     -               assigned        assigned        -                club        club
player_profile.archive   -                     -               -               -               -                club        club
player_summary.read      self                  guardian        assigned        assigned        assigned         club        club
guardian_link.read       self                  guardian        -               -               -                club        club
guardian_link.manage     -                     -               -               -               -                club        club
guardian_link.review     self+adult            -               -               -               -                -           -
player_account.invite    -                     guardian+minor  -               -               -                club        club
consent.read             self                  guardian        assigned        assigned        assigned         club        club
consent.sign             self+adult            guardian+minor  -               -               -                -           -
consent.revoke           self+adult            guardian+minor  -               -               -                -           -
parent_height.read       -                     guardian        -               assigned        -                club        club
parent_height.report     -                     guardian+data+minor -               assigned+data   -                club+data   club+data
wellness.read            self                  -               assigned        assigned        assigned         club        club
wellness.submit          self+data             -               -               -               -                -           -
rpe.read                 self                  -               assigned        assigned        assigned         club        club
rpe.submit               self+data             -               -               -               -                -           -
training_session.read    -                     -               assigned        assigned        assigned         club        club
training_session.manage  -                     -               assigned        -               -                club        club
participation.read       self                  -               assigned        assigned        assigned         club        club
participation.record     -                     -               assigned+data   -               -                club+data   club+data
test_session.read        -                     -               assigned        assigned        assigned         club        club
test_session.manage      -                     -               -               assigned        -                club        club
test_result.read         self                  -               assigned        assigned        assigned         club        club
test_result.record       -                     -               -               assigned+data   -                club+data   club+data
test_result.correct      -                     -               -               assigned+data   -                club+data   club+data
anthropometry.read       self                  -               assigned        assigned        assigned         club        club
anthropometry.record     -                     -               -               assigned+data   -                club+data   club+data
gym_program.read         self                  -               assigned        assigned        -                club        club
gym_program.manage       -                     -               -               assigned        -                club        club
load_metrics.read        self                  -               assigned        assigned        assigned         club        club
alert.read               -                     -               assigned        assigned        assigned         club        club
alert.acknowledge        -                     -               assigned        assigned        assigned         club        club
percentile.read          self+own_percentiles  -               assigned        assigned        assigned         club        club
named_ranking.read       self+named_rankings   -               assigned        assigned        assigned         club        club
group_reference.read     self                  -               assigned        assigned        assigned         club        club
media.read               self+image            -               assigned+image  assigned+image  -                club+image  club+image
media.upload             -                     -               -               assigned+image  -                club+image  club+image
media.delete             -                     -               -               assigned        -                club        club
availability.read        self                  guardian        assigned        assigned        assigned         club        club
medical_record.read      self+health           guardian+health+minor -               -               assigned         -           -
medical_record.record    -                     -               -               -               assigned+health  -           -
medical_record.update    -                     -               -               -               assigned+health  -           -
medical_block.read       -                     -               -               -               assigned         -           -
medical_block.set        -                     -               -               -               assigned         -           -
medical_block.lift       -                     -               -               -               assigned         -           -
data_export.export       self+adult            guardian+minor  -               -               -                club+data   -
player_report.read       self                  guardian        assigned        assigned        assigned         club        club
player_report.generate   -                     -               -               assigned        -                club        club
category_report.read     -                     -               assigned        assigned        assigned         club        club
category_report.generate -                     -               -               assigned        -                club        club
club_data_export.run     -                     -               -               assigned+data   -                club+data   -
club_data_export.read    -                     -               -               assigned        -                club        -
data_erasure.read        self+adult            guardian+minor  -               -               -                club        -
data_erasure.request     self+adult            guardian+minor  -               -               -                club        -
data_erasure.execute     -                     -               -               -               -                club        -
`;

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const CLUB = '00000000-0000-4000-8000-0000000000c1' as ClubId;
const OTHER_CLUB = '00000000-0000-4000-8000-0000000000c2' as ClubId;
const USER = '00000000-0000-4000-8000-0000000000a1' as UserId;
const PLAYER = '00000000-0000-4000-8000-0000000000b1' as PlayerId;
const OTHER_PLAYER = '00000000-0000-4000-8000-0000000000b2' as PlayerId;
const CATEGORY = '00000000-0000-4000-8000-0000000000d1' as CategoryId;
const OTHER_CATEGORY = '00000000-0000-4000-8000-0000000000d2' as CategoryId;

function band(code: string): AgeBand {
  const found = DEFAULT_AGE_BANDS.find((b) => b.code === code);
  if (found === undefined) throw new Error(`No band ${code}`);
  return found;
}

/** The player of the resource: rugby, in CATEGORY, every fact present. */
function player(overrides: Partial<PlayerFacts> = {}): PlayerFacts {
  return {
    id: PLAYER,
    sport: 'rugby',
    categoryIds: [CATEGORY],
    stage: 'performance' satisfies Stage,
    ageBand: band('m17'),
    ofAge: false,
    consents: CONSENT_TYPES,
    ...overrides,
  };
}

interface Probe {
  readonly name: string;
  readonly subject: PermissionSubject;
  readonly resource: PermissionResource;
  readonly allowed: boolean;
  readonly reason?: DenialReason;
}

interface Token {
  readonly scope: string;
  readonly requirements: readonly string[];
}

function parseToken(token: string): Token | null {
  if (token === '-') return null;
  const [scope = '', ...requirements] = token.split('+');
  if (!isPermissionScope(scope)) throw new Error(`Unknown scope in spec: ${token}`);
  for (const r of requirements) {
    if (!isPlayerCondition(r) && !(CONSENT_TYPES as readonly string[]).includes(r)) {
      throw new Error(`Unknown requirement in spec: ${token}`);
    }
  }
  return { scope, requirements };
}

/** The subject that is "in scope" for a token's scope. */
function subjectInScope(role: Role, scope: string): PermissionSubject {
  const base = { userId: USER, role, clubId: CLUB };
  switch (scope) {
    case 'platform':
      return { ...base, clubId: null };
    case 'assigned':
      return { ...base, assignments: [{ kind: 'category', categoryId: CATEGORY }] };
    case 'self':
      return { ...base, playerId: PLAYER };
    case 'guardian':
      return { ...base, guardianships: [{ playerId: PLAYER, confirmedByAdultPlayer: false }] };
    default:
      return base;
  }
}

/** A subject with every possible relationship to the resource. */
function omnipotentSubject(role: Role): PermissionSubject {
  return {
    userId: USER,
    role,
    clubId: CLUB,
    playerId: PLAYER,
    assignments: [
      { kind: 'category', categoryId: CATEGORY },
      { kind: 'sport', sport: 'rugby' },
    ],
    guardianships: [{ playerId: PLAYER, confirmedByAdultPlayer: true }],
  };
}

/** Builds positive and negative probes from the spec token of a cell. */
function probesFor(kind: ResourceKind, role: Role, token: Token | null): Probe[] {
  if (token === null) {
    return [
      {
        name: 'denied even with every relationship and fact',
        subject: omnipotentSubject(role),
        resource: { kind, clubId: CLUB, player: player() },
        allowed: false,
        reason: 'role_denied',
      },
      {
        name: 'denied as platform',
        subject: { ...omnipotentSubject(role), clubId: null },
        resource: { kind },
        allowed: false,
        reason: 'role_denied',
      },
    ];
  }

  const { scope, requirements } = token;
  const ofAge = requirements.includes('adult');
  const basePlayer = player({ ofAge });
  const inScope = subjectInScope(role, scope);
  const probes: Probe[] = [];

  if (scope === 'platform') {
    probes.push(
      { name: 'allowed without a club', subject: inScope, resource: { kind }, allowed: true },
      {
        name: 'allowed with a club context',
        subject: { ...inScope, clubId: CLUB },
        resource: { kind, clubId: OTHER_CLUB },
        allowed: true,
      },
    );
    return probes;
  }

  const resource: PermissionResource = { kind, clubId: CLUB, player: basePlayer };
  probes.push(
    { name: 'allowed in scope', subject: inScope, resource, allowed: true },
    {
      name: 'denied in another club',
      subject: inScope,
      resource: { ...resource, clubId: OTHER_CLUB },
      allowed: false,
      reason: 'other_club',
    },
    {
      name: 'denied without a club context',
      subject: { ...inScope, clubId: null },
      resource,
      allowed: false,
      reason: 'no_club',
    },
  );

  switch (scope) {
    case 'assigned':
      probes.push(
        {
          name: 'allowed through a sport assignment',
          subject: { ...inScope, assignments: [{ kind: 'sport', sport: 'rugby' }] },
          resource,
          allowed: true,
        },
        {
          name: 'denied for another category',
          subject: { ...inScope, assignments: [{ kind: 'category', categoryId: OTHER_CATEGORY }] },
          resource,
          allowed: false,
          reason: 'out_of_scope',
        },
        {
          name: 'denied for another sport',
          subject: { ...inScope, assignments: [{ kind: 'sport', sport: 'hockey' }] },
          resource,
          allowed: false,
          reason: 'out_of_scope',
        },
        {
          name: 'denied without assignments',
          subject: { ...inScope, assignments: [] },
          resource,
          allowed: false,
          reason: 'out_of_scope',
        },
      );
      if (requirements.length === 0) {
        probes.push(
          {
            name: 'allowed for an assigned category',
            subject: inScope,
            resource: { kind, clubId: CLUB, category: { id: CATEGORY, sport: 'rugby' } },
            allowed: true,
          },
          {
            name: 'denied for a category outside the assignments',
            subject: inScope,
            resource: { kind, clubId: CLUB, category: { id: OTHER_CATEGORY, sport: 'hockey' } },
            allowed: false,
            reason: 'out_of_scope',
          },
        );
      }
      break;
    case 'self':
      probes.push(
        {
          name: 'denied for another player',
          subject: { ...inScope, playerId: OTHER_PLAYER },
          resource,
          allowed: false,
          reason: 'out_of_scope',
        },
        {
          name: 'denied without a linked player',
          subject: { ...inScope, playerId: null },
          resource,
          allowed: false,
          reason: 'out_of_scope',
        },
        {
          name: 'denied without a target player',
          subject: inScope,
          resource: { kind, clubId: CLUB },
          allowed: false,
          reason: 'missing_target',
        },
      );
      break;
    case 'guardian':
      probes.push(
        {
          name: 'denied without a guardian link',
          subject: { ...inScope, guardianships: [] },
          resource,
          allowed: false,
          reason: 'out_of_scope',
        },
        {
          name: 'denied for another player',
          subject: {
            ...inScope,
            guardianships: [{ playerId: OTHER_PLAYER, confirmedByAdultPlayer: true }],
          },
          resource,
          allowed: false,
          reason: 'out_of_scope',
        },
        {
          name: 'denied once of age without the adult player confirming',
          subject: inScope,
          resource: { ...resource, player: player({ ofAge: true }) },
          allowed: false,
          reason: 'age_restricted',
        },
        {
          name: 'denied without a target player',
          subject: inScope,
          resource: { kind, clubId: CLUB },
          allowed: false,
          reason: 'missing_target',
        },
      );
      if (!requirements.includes('minor')) {
        probes.push({
          name: 'allowed once of age if the adult player confirmed',
          subject: {
            ...inScope,
            guardianships: [{ playerId: PLAYER, confirmedByAdultPlayer: true }],
          },
          resource: { ...resource, player: player({ ofAge: true }) },
          allowed: true,
        });
      }
      break;
    case 'club':
      probes.push({
        name: 'allowed with no relationship to the player',
        subject: { userId: USER, role, clubId: CLUB, assignments: [] },
        resource,
        allowed: true,
      });
      break;
  }

  if (requirements.length === 0) {
    probes.push({
      name: 'allowed without any consent',
      subject: inScope,
      resource: { ...resource, player: player({ ofAge, consents: [] }) },
      allowed: true,
    });
  }

  for (const requirement of requirements) {
    if ((CONSENT_TYPES as readonly string[]).includes(requirement)) {
      const others = CONSENT_TYPES.filter((c) => c !== requirement);
      probes.push(
        {
          name: `denied without a current ${requirement} consent`,
          subject: inScope,
          resource: { ...resource, player: player({ ofAge, consents: others }) },
          allowed: false,
          reason: 'missing_consent',
        },
        {
          name: `denied when consents are unknown`,
          subject: inScope,
          resource: { ...resource, player: withoutFact(player({ ofAge }), 'consents') },
          allowed: false,
          reason: 'missing_fact',
        },
      );
      continue;
    }
    switch (requirement) {
      case 'minor':
        probes.push({
          name: 'denied once the player is of age',
          subject: inScope,
          resource: { ...resource, player: player({ ofAge: true }) },
          allowed: false,
          reason: 'age_restricted',
        });
        break;
      case 'adult':
        probes.push({
          name: 'denied while the player is a minor',
          subject: inScope,
          resource: { ...resource, player: player({ ofAge: false }) },
          allowed: false,
          reason: 'age_restricted',
        });
        break;
      case 'own_percentiles':
        probes.push(
          ...stageProbes(kind, inScope, [
            ['m15', 'development', true],
            ['m14', 'development', false],
            ['m13', 'foundation', false],
            ['m15', 'foundation', false],
          ]),
        );
        break;
      case 'named_rankings':
        probes.push(
          ...stageProbes(kind, inScope, [
            ['m19', 'performance', true],
            ['m16', 'performance', false],
            ['m15', 'performance', false],
            ['m14', 'performance', false],
            ['m13', 'performance', false],
            ['m17', 'development', false],
          ]),
        );
        break;
    }
  }
  return probes;
}

function stageProbes(
  kind: ResourceKind,
  subject: PermissionSubject,
  cases: readonly (readonly [string, Stage, boolean])[],
): Probe[] {
  return [
    ...cases.map(([code, stage, allowed]): Probe => ({
      name: `${allowed ? 'allowed' : 'denied'} in ${code} at ${stage}`,
      subject,
      resource: { kind, clubId: CLUB, player: player({ stage, ageBand: band(code) }) },
      allowed,
      ...(allowed ? {} : { reason: 'stage_restricted' as const }),
    })),
    {
      name: 'denied when the stage is unknown',
      subject,
      resource: { kind, clubId: CLUB, player: withoutFact(player(), 'stage') },
      allowed: false,
      reason: 'missing_fact',
    },
  ];
}

function withoutFact(facts: PlayerFacts, fact: 'consents' | 'stage'): PlayerFacts {
  return Object.fromEntries(
    Object.entries(facts).filter(([key]) => key !== fact),
  ) as unknown as PlayerFacts;
}

function expectedObligations(kind: ResourceKind, role: Role): string[] {
  const obligations: string[] = [];
  if (PERMISSION_RESOURCES[kind].medical) obligations.push('audit_medical_access');
  if (role === 'superadmin') obligations.push('audit_support_access');
  return obligations;
}

function describeDecision(decision: PermissionDecision): string {
  return decision.allowed ? 'allowed' : `denied (${decision.reason})`;
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

const cells = permissionCells();

const [specHeader = '', ...specLines] = SPEC_GRID.trim().split('\n');
const SPEC_ROLES = specHeader.trim().split(/\s+/);
const SPEC = new Map(
  specLines.map((line) => {
    const [key = '', ...tokens] = line.trim().split(/\s+/);
    return [key, tokens] as const;
  }),
);

function specTokens(key: string): readonly string[] {
  return SPEC.get(key) ?? [];
}

describe('permission matrix specification', () => {
  it('lists the roles in the order of ROLES', () => {
    expect(SPEC_ROLES).toEqual(ROLES);
  });

  it('specifies every cell of the matrix, and only those, once', () => {
    const matrixKeys = [...new Set(cells.map((c) => `${c.kind}.${c.action}`))];
    expect(specLines).toHaveLength(SPEC.size);
    expect([...SPEC.keys()].sort()).toEqual([...matrixKeys].sort());
    for (const key of matrixKeys) {
      expect(specTokens(key), `tokens of ${key}`).toHaveLength(ROLES.length);
    }
  });

  it('has one cell per resource, action and role', () => {
    const expected = Object.values(PERMISSION_RESOURCES).reduce(
      (sum, r) => sum + r.actions.length * ROLES.length,
      0,
    );
    expect(cells).toHaveLength(expected);
  });

  it('does not compile with a missing role (type-level)', () => {
    // @ts-expect-error every role must be declared, denials included.
    const missing: RoleRules = { player: deny };
    expect(missing).toBeDefined();
  });
});

describe.each(cells.map((c) => [`${c.kind}.${c.action} × ${c.role}`, c] as const))(
  '%s',
  (_, cell) => {
    const key = `${cell.kind}.${cell.action}`;
    const token = specTokens(key)[ROLES.indexOf(cell.role)] ?? '<missing>';

    it(`is "${token}" in the matrix`, () => {
      expect(describeRule(cell.rule)).toBe(token);
    });

    const probes = probesFor(cell.kind, cell.role, parseToken(token));
    it.each(probes.map((p) => [p.name, p] as const))('%s', (_name, probe) => {
      const decision = decide(probe.subject, cell.action as never, {
        ...probe.resource,
        kind: cell.kind,
      });
      expect(describeDecision(decision)).toBe(
        probe.allowed ? 'allowed' : `denied (${probe.reason ?? ''})`,
      );
      if (decision.allowed) {
        expect(decision.obligations).toEqual(expectedObligations(cell.kind, cell.role));
        // A subject allowed on one row can list, with the same obligations.
        const scope = listScope(probe.subject, cell.kind, cell.action as never);
        expect(scope.kind).not.toBe('none');
        expect(scope.kind === 'none' ? null : scope.obligations).toEqual(decision.obligations);
      }
      if (!decision.allowed && decision.reason === 'role_denied') {
        expect(listScope(probe.subject, cell.kind, cell.action as never)).toEqual({ kind: 'none' });
      }
    });
  },
);

describe('listScope and decide agree on obligations', () => {
  it.each(
    cells
      .filter((c) => c.rule.effect === 'allow')
      .map((c) => [`${c.kind}.${c.action} × ${c.role}`, c] as const),
  )('%s', (_, cell) => {
    const platformScope = cell.rule.effect === 'allow' && cell.rule.scope === 'platform';
    const subject = platformScope
      ? { ...omnipotentSubject(cell.role), clubId: null }
      : omnipotentSubject(cell.role);
    const resource = platformScope
      ? { kind: cell.kind }
      : { kind: cell.kind, clubId: CLUB, player: player() };
    const scope = listScope(subject, cell.kind, cell.action as never);
    expect(scope.kind).not.toBe('none');
    const expected = expectedObligations(cell.kind, cell.role);
    expect(scope.kind === 'none' ? null : scope.obligations).toEqual(expected);
    const decision = decide(subject, cell.action as never, resource);
    if (decision.allowed) expect(decision.obligations).toEqual(expected);
  });
});

describe('privacy invariants (independent of the specification)', () => {
  const allowedCells = cells.filter((c) => c.rule.effect === 'allow');

  it('only the medical role writes health data; holders only read their own, with consent', () => {
    const medical = allowedCells.filter((c) => PERMISSION_RESOURCES[c.kind].medical);
    expect(medical.length).toBeGreaterThan(0);
    for (const cell of medical) {
      const key = `${cell.kind}.${cell.action}`;
      if (cell.role === 'medical') continue;
      // ADR 0029: the right of access of the holder (Ley 25.326, art. 14).
      expect(key, cell.role).toBe('medical_record.read');
      expect(['player', 'parent']).toContain(cell.role);
      expect(cell.rule.effect === 'allow' && cell.rule.consents, key).toContain('health');
      expect(cell.rule.effect === 'allow' && cell.rule.scope, key).toBe(
        cell.role === 'player' ? 'self' : 'guardian',
      );
    }
    for (const role of ['coach', 'sc', 'admin', 'superadmin'] as const) {
      expect(medical.filter((c) => c.role === role)).toEqual([]);
    }
  });

  it('a player sees named rankings and own percentiles only through the stage conditions', () => {
    const rule = PERMISSION_MATRIX.named_ranking.read.player;
    expect(rule.effect === 'allow' && rule.conditions).toContain('named_rankings');
    const percentile = PERMISSION_MATRIX.percentile.read.player;
    expect(percentile.effect === 'allow' && percentile.conditions).toContain('own_percentiles');
  });

  it("parents never see rankings or percentiles, and of health only a minor's record", () => {
    for (const kind of ['named_ranking', 'percentile', 'medical_block'] as const) {
      for (const cell of cells.filter((c) => c.kind === kind)) {
        expect(cell.role === 'parent' ? cell.rule.effect : 'deny').toBe('deny');
      }
    }
    for (const cell of cells.filter((c) => c.kind === 'medical_record' && c.role === 'parent')) {
      if (cell.action !== 'read') expect(cell.rule.effect, cell.action).toBe('deny');
      else expect(cell.rule.effect === 'allow' && cell.rule.conditions).toContain('minor');
    }
  });

  it('players and parents act only on their own or linked player', () => {
    for (const cell of allowedCells.filter((c) => c.role === 'player' || c.role === 'parent')) {
      const scope = cell.rule.effect === 'allow' ? cell.rule.scope : null;
      // Club-wide reference data without personal data: the club, its catalog and calendar frame.
      const clubWide =
        cell.kind === 'club' || cell.kind === 'metric_catalog' || cell.kind === 'season';
      expect(clubWide ? 'club' : scope, `${cell.kind}.${cell.action} × ${cell.role}`).toBe(
        clubWide ? 'club' : cell.role === 'player' ? 'self' : 'guardian',
      );
    }
  });

  it('only the superadmin has platform scope, and only on the registry of clubs', () => {
    for (const cell of allowedCells) {
      if (cell.rule.effect === 'allow' && cell.rule.scope === 'platform') {
        expect([cell.kind, cell.role]).toEqual(['club_registry', 'superadmin']);
      }
    }
  });

  it('a guardian writes only while the player is a minor (an adult keeps read access only)', () => {
    const guardianCells = allowedCells.filter(
      (c) => c.rule.effect === 'allow' && c.rule.scope === 'guardian',
    );
    expect(guardianCells.length).toBeGreaterThan(0);
    for (const cell of guardianCells) {
      if (cell.action === 'read') continue;
      expect(
        cell.rule.effect === 'allow' && cell.rule.conditions,
        `${cell.kind}.${cell.action}`,
      ).toContain('minor');
    }
  });

  it('a consent is signed only by its holder: the guardian of a minor or the adult player', () => {
    for (const action of ['sign', 'revoke'] as const) {
      const rules = PERMISSION_MATRIX.consent[action];
      const allowedRoles = ROLES.filter((r) => rules[r].effect === 'allow');
      expect(allowedRoles).toEqual(['player', 'parent']);
    }
  });

  it('every collection of player data requires a current consent', () => {
    const collecting = [
      'wellness.submit',
      'rpe.submit',
      'participation.record',
      'test_result.record',
      'test_result.correct',
      'anthropometry.record',
      'parent_height.report',
      'media.upload',
      'medical_record.record',
      'medical_record.update',
    ];
    const required: Readonly<Record<string, ConsentType>> = {
      'media.upload': 'image',
      'medical_record.record': 'health',
      'medical_record.update': 'health',
    };
    for (const cell of allowedCells) {
      const key = `${cell.kind}.${cell.action}`;
      if (!collecting.includes(key)) continue;
      expect(cell.rule.effect === 'allow' && cell.rule.consents, key).toContain(
        required[key] ?? 'data',
      );
    }
  });
});
