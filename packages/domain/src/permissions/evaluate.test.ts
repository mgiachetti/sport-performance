import { describe, expect, it } from 'vitest';
import { DEFAULT_AGE_BANDS } from '../category.js';
import {
  CONSENT_SIGNERS,
  CONSENT_TYPES,
  isConsentType,
  parseConsentSigner,
  parseConsentType,
} from '../consent.js';
import { DomainValidationError } from '../errors.js';
import type { CategoryId, ClubId, PlayerId, UserId } from '../ids.js';
import type { LocalDate } from '../time.js';
import {
  PermissionDeniedError,
  authorize,
  can,
  decide,
  listScope,
  permittedActions,
} from './evaluate.js';
import { ruleFor } from './matrix.js';
import { RESOURCE_KINDS, actionsOf, isActionOf, isResourceKind } from './resources.js';
import { allow, describeRule } from './rules.js';
import {
  currentAssignments,
  currentGuardianships,
  isCurrentOn,
  isOfAge,
  type PermissionSubject,
  type PlayerFacts,
} from './subject.js';

const CLUB = '00000000-0000-4000-8000-0000000000c1' as ClubId;
const USER = '00000000-0000-4000-8000-0000000000a1' as UserId;
const PLAYER = '00000000-0000-4000-8000-0000000000b1' as PlayerId;
const SIBLING = '00000000-0000-4000-8000-0000000000b2' as PlayerId;
const M15 = '00000000-0000-4000-8000-0000000000d1' as CategoryId;
const M17 = '00000000-0000-4000-8000-0000000000d2' as CategoryId;
const d = (value: string) => value as LocalDate;

const m15Player: PlayerFacts = {
  id: PLAYER,
  sport: 'rugby',
  categoryIds: [M15],
  stage: 'development',
  ageBand: DEFAULT_AGE_BANDS[2],
  ofAge: false,
  consents: ['data'],
};

const coach: PermissionSubject = {
  userId: USER,
  role: 'coach',
  clubId: CLUB,
  assignments: [{ kind: 'category', categoryId: M15 }],
};

describe('decide', () => {
  it('lets an M15 player see their own percentiles but never named rankings', () => {
    const subject: PermissionSubject = {
      userId: USER,
      role: 'player',
      clubId: CLUB,
      playerId: PLAYER,
    };
    expect(can(subject, 'read', { kind: 'percentile', clubId: CLUB, player: m15Player })).toBe(
      true,
    );
    expect(
      decide(subject, 'read', { kind: 'named_ranking', clubId: CLUB, player: m15Player }),
    ).toEqual({
      allowed: false,
      reason: 'stage_restricted',
    });
    expect(can(subject, 'read', { kind: 'group_reference', clubId: CLUB, player: m15Player })).toBe(
      true,
    );
  });

  it('reports the missing consents', () => {
    const sc: PermissionSubject = { ...coach, role: 'sc' };
    expect(decide(sc, 'upload', { kind: 'media', clubId: CLUB, player: m15Player })).toEqual({
      allowed: false,
      reason: 'missing_consent',
      missingConsents: ['image'],
    });
  });

  it('places a category resource through category or sport assignments', () => {
    const session = { kind: 'training_session', clubId: CLUB } as const;
    expect(can(coach, 'manage', { ...session, category: { id: M15, sport: 'rugby' } })).toBe(true);
    expect(can(coach, 'manage', { ...session, category: { id: M17, sport: 'rugby' } })).toBe(false);
    const medical: PermissionSubject = {
      userId: USER,
      role: 'medical',
      clubId: CLUB,
      assignments: [{ kind: 'sport', sport: 'hockey' }],
    };
    expect(can(medical, 'read', { ...session, category: { id: M17, sport: 'hockey' } })).toBe(true);
    expect(can(medical, 'read', { ...session, category: { id: M15, sport: 'rugby' } })).toBe(false);
  });

  it('checks the player before the category when both are given', () => {
    const resource = {
      kind: 'participation',
      clubId: CLUB,
      category: { id: M15, sport: 'rugby' },
      player: { ...m15Player, categoryIds: [M17] },
    } as const;
    expect(decide(coach, 'read', resource)).toEqual({ allowed: false, reason: 'out_of_scope' });
  });

  it('denies an assigned rule with neither player nor category', () => {
    const sc: PermissionSubject = { ...coach, role: 'sc' };
    // The roster import (padrón) has no category: only the administration runs it.
    expect(decide(sc, 'run', { kind: 'data_import', clubId: CLUB })).toEqual({
      allowed: false,
      reason: 'missing_target',
    });
    const admin: PermissionSubject = { userId: USER, role: 'admin', clubId: CLUB };
    expect(can(admin, 'run', { kind: 'data_import', clubId: CLUB })).toBe(true);
  });

  it('denies guardian access when majority is unknown and the link is unconfirmed', () => {
    const parent: PermissionSubject = {
      userId: USER,
      role: 'parent',
      clubId: CLUB,
      guardianships: [{ playerId: PLAYER, confirmedByAdultPlayer: false }],
    };
    const unknownAge = Object.fromEntries(
      Object.entries(m15Player).filter(([key]) => key !== 'ofAge'),
    ) as unknown as PlayerFacts;
    expect(
      decide(parent, 'read', { kind: 'availability', clubId: CLUB, player: unknownAge }),
    ).toEqual({
      allowed: false,
      reason: 'missing_fact',
    });
  });

  it('keeps an adult-confirmed guardian reading, never signing', () => {
    const parent: PermissionSubject = {
      userId: USER,
      role: 'parent',
      clubId: CLUB,
      guardianships: [{ playerId: PLAYER, confirmedByAdultPlayer: true }],
    };
    const adult = { ...m15Player, ofAge: true };
    expect(can(parent, 'read', { kind: 'player_summary', clubId: CLUB, player: adult })).toBe(true);
    expect(decide(parent, 'sign', { kind: 'consent', clubId: CLUB, player: adult })).toEqual({
      allowed: false,
      reason: 'age_restricted',
    });
  });

  it('shows availability to the coach and the medical record only to medical, audited', () => {
    const medical: PermissionSubject = {
      userId: USER,
      role: 'medical',
      clubId: CLUB,
      assignments: [{ kind: 'sport', sport: 'rugby' }],
    };
    expect(can(coach, 'read', { kind: 'availability', clubId: CLUB, player: m15Player })).toBe(
      true,
    );
    expect(can(coach, 'read', { kind: 'medical_record', clubId: CLUB, player: m15Player })).toBe(
      false,
    );
    expect(
      decide(medical, 'read', { kind: 'medical_record', clubId: CLUB, player: m15Player }),
    ).toEqual({ allowed: true, obligations: ['audit_medical_access'] });
    // No health consent: the record cannot be written.
    expect(
      decide(medical, 'record', { kind: 'medical_record', clubId: CLUB, player: m15Player }),
    ).toEqual({ allowed: false, reason: 'missing_consent', missingConsents: ['health'] });
  });

  it('fails closed for an action the kind does not have', () => {
    const admin: PermissionSubject = { userId: USER, role: 'admin', clubId: CLUB };
    expect(decide(admin, 'delete' as never, { kind: 'club', clubId: CLUB })).toEqual({
      allowed: false,
      reason: 'role_denied',
    });
    expect(describeRule(ruleFor('club', 'delete' as never, 'admin'))).toBe('-');
  });
});

describe('authorize', () => {
  it('returns the obligations when allowed', () => {
    const superadmin: PermissionSubject = { userId: USER, role: 'superadmin', clubId: CLUB };
    expect(authorize(superadmin, 'update', { kind: 'club', clubId: CLUB })).toEqual([
      'audit_support_access',
    ]);
  });

  it('throws a framework-agnostic error without personal data', () => {
    const sc: PermissionSubject = { ...coach, role: 'sc' };
    let error: unknown;
    try {
      authorize(sc, 'upload', { kind: 'media', clubId: CLUB, player: m15Player });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(PermissionDeniedError);
    const denied = error as PermissionDeniedError;
    expect(denied).toMatchObject({
      code: 'forbidden',
      kind: 'media',
      action: 'upload',
      reason: 'missing_consent',
      missingConsents: ['image'],
    });
    expect(denied.message).not.toContain(PLAYER);
    expect(denied.message).not.toContain(USER);
  });
});

describe('permittedActions', () => {
  it('lists the allowed actions in declaration order', () => {
    expect(
      permittedActions(coach, { kind: 'player_profile', clubId: CLUB, player: m15Player }),
    ).toEqual(['read', 'update']);
    const player: PermissionSubject = {
      userId: USER,
      role: 'player',
      clubId: CLUB,
      playerId: PLAYER,
    };
    expect(permittedActions(player, { kind: 'consent', clubId: CLUB, player: m15Player })).toEqual([
      'read',
    ]);
  });
});

describe('listScope', () => {
  it('describes what a role may list', () => {
    expect(listScope(coach, 'test_result', 'read')).toEqual({
      kind: 'assigned',
      clubId: CLUB,
      categoryIds: [M15],
      sports: [],
      rowCheck: false,
      obligations: [],
    });
    expect(listScope(coach, 'participation', 'record')).toMatchObject({ rowCheck: true });
    expect(listScope({ ...coach, assignments: [] }, 'test_result', 'read')).toEqual({
      kind: 'none',
    });
    expect(listScope(coach, 'medical_record', 'read')).toEqual({ kind: 'none' });
    expect(listScope({ ...coach, clubId: null }, 'test_result', 'read')).toEqual({ kind: 'none' });
  });

  it('covers club, self, guardian and platform scopes', () => {
    const admin: PermissionSubject = { userId: USER, role: 'admin', clubId: CLUB };
    expect(listScope(admin, 'media', 'read')).toEqual({
      kind: 'club',
      clubId: CLUB,
      rowCheck: true,
      obligations: [],
    });
    const player: PermissionSubject = {
      userId: USER,
      role: 'player',
      clubId: CLUB,
      playerId: PLAYER,
    };
    expect(listScope(player, 'wellness', 'read')).toEqual({
      kind: 'players',
      clubId: CLUB,
      playerIds: [PLAYER],
      rowCheck: false,
      obligations: [],
    });
    expect(listScope({ ...player, playerId: null }, 'wellness', 'read')).toEqual({ kind: 'none' });
    const parent: PermissionSubject = {
      userId: USER,
      role: 'parent',
      clubId: CLUB,
      guardianships: [
        { playerId: PLAYER, confirmedByAdultPlayer: true },
        { playerId: SIBLING, confirmedByAdultPlayer: false },
      ],
    };
    expect(listScope(parent, 'availability', 'read')).toEqual({
      kind: 'players',
      clubId: CLUB,
      playerIds: [PLAYER, SIBLING],
      rowCheck: true,
      obligations: [],
    });
    expect(listScope({ ...parent, guardianships: [] }, 'availability', 'read')).toEqual({
      kind: 'none',
    });
    const superadmin: PermissionSubject = { userId: USER, role: 'superadmin', clubId: null };
    expect(listScope(superadmin, 'club_registry', 'read')).toEqual({
      kind: 'platform',
      rowCheck: false,
      obligations: ['audit_support_access'],
    });
  });

  it('carries the audit obligations of decide', () => {
    const medical: PermissionSubject = {
      userId: USER,
      role: 'medical',
      clubId: CLUB,
      assignments: [{ kind: 'category', categoryId: M15 }],
    };
    expect(listScope(medical, 'medical_record', 'read')).toEqual({
      kind: 'assigned',
      clubId: CLUB,
      categoryIds: [M15],
      sports: [],
      rowCheck: false,
      obligations: ['audit_medical_access'],
    });
    const superadmin: PermissionSubject = { userId: USER, role: 'superadmin', clubId: CLUB };
    expect(listScope(superadmin, 'test_result', 'read')).toEqual({
      kind: 'club',
      clubId: CLUB,
      rowCheck: false,
      obligations: ['audit_support_access'],
    });
  });
});

describe('untyped input', () => {
  const admin: PermissionSubject = { userId: USER, role: 'admin', clubId: CLUB };

  it('denies actions that are not own keys of the matrix instead of throwing', () => {
    for (const action of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'nope']) {
      expect(ruleFor('club', action as never, 'admin')).toEqual({ effect: 'deny' });
      expect(decide(admin, action as never, { kind: 'club', clubId: CLUB })).toEqual({
        allowed: false,
        reason: 'role_denied',
      });
      expect(listScope(admin, 'club', action as never)).toEqual({ kind: 'none' });
    }
  });

  it('denies unknown roles and kinds instead of throwing', () => {
    for (const role of ['owner', 'constructor', 'toString']) {
      const subject = { ...admin, role } as unknown as PermissionSubject;
      expect(decide(subject, 'read', { kind: 'club', clubId: CLUB })).toEqual({
        allowed: false,
        reason: 'role_denied',
      });
      expect(listScope(subject, 'club', 'read')).toEqual({ kind: 'none' });
    }
    for (const kind of ['constructor', 'nope']) {
      expect(ruleFor(kind as never, 'read' as never, 'admin')).toEqual({ effect: 'deny' });
    }
  });
});

describe('subject helpers', () => {
  it('computes majority in completed years', () => {
    expect(isOfAge(d('2008-05-10'), d('2026-05-09'))).toBe(false);
    expect(isOfAge(d('2008-05-10'), d('2026-05-10'))).toBe(true);
  });

  it('uses half-open validity windows', () => {
    expect(isCurrentOn({ validFrom: d('2026-03-01') }, d('2026-02-28'))).toBe(false);
    expect(isCurrentOn({ validFrom: d('2026-03-01') }, d('2026-03-01'))).toBe(true);
    expect(
      isCurrentOn({ validFrom: d('2026-03-01'), validTo: d('2026-11-01') }, d('2026-10-31')),
    ).toBe(true);
    expect(
      isCurrentOn({ validFrom: d('2026-03-01'), validTo: d('2026-11-01') }, d('2026-11-01')),
    ).toBe(false);
  });

  it('keeps current, well-formed assignments only', () => {
    expect(
      currentAssignments(
        [
          { validFrom: d('2026-01-01'), categoryId: M15, sport: null },
          { validFrom: d('2026-01-01'), categoryId: null, sport: 'hockey' },
          { validFrom: d('2025-01-01'), validTo: d('2026-01-01'), categoryId: M17 },
          { validFrom: d('2026-01-01'), categoryId: M17, sport: 'rugby' },
          { validFrom: d('2026-01-01') },
        ],
        d('2026-06-01'),
      ),
    ).toEqual([
      { kind: 'category', categoryId: M15 },
      { kind: 'sport', sport: 'hockey' },
    ]);
  });

  it('keeps current guardian links, unconfirmed by default', () => {
    expect(
      currentGuardianships(
        [
          { validFrom: d('2020-01-01'), playerId: PLAYER },
          { validFrom: d('2020-01-01'), validTo: d('2026-01-01'), playerId: SIBLING },
        ],
        d('2026-06-01'),
      ),
    ).toEqual([{ playerId: PLAYER, confirmedByAdultPlayer: false }]);
  });
});

describe('rules and vocabularies', () => {
  it('rejects contradictory or meaningless rules', () => {
    expect(() => allow('self', 'minor', 'adult')).toThrow(TypeError);
    expect(() => allow('club', 'data', 'data')).toThrow(TypeError);
    expect(() => allow('platform', 'data')).toThrow(TypeError);
    expect(describeRule(allow('assigned', 'own_percentiles', 'image'))).toBe(
      'assigned+image+own_percentiles',
    );
  });

  it('exposes kinds and actions as closed sets', () => {
    expect(RESOURCE_KINDS).toContain('medical_record');
    expect(isResourceKind('medical_record')).toBe(true);
    expect(isResourceKind('toString')).toBe(false);
    expect(actionsOf('consent')).toEqual(['read', 'sign', 'revoke']);
    expect(isActionOf('consent', 'sign')).toBe(true);
    expect(isActionOf('consent', 'delete')).toBe(false);
  });

  it('parses consent vocabularies', () => {
    expect(CONSENT_TYPES).toEqual(['data', 'image', 'health', 'menstrual_cycle']);
    expect(CONSENT_SIGNERS).toEqual(['guardian', 'player']);
    expect(isConsentType('image')).toBe(true);
    expect(parseConsentType('health')).toBe('health');
    expect(() => parseConsentType('photo')).toThrow(DomainValidationError);
    expect(parseConsentSigner('player')).toBe('player');
    expect(() => parseConsentSigner('coach')).toThrow(DomainValidationError);
  });
});
