import type {
  Child,
  Consent,
  ConsentDocument,
  ConsentTypeStatus,
  ParentHeight,
  Player,
  PlayerConsents,
  PlayerParentHeights,
} from '@sport-performance/contracts';
import {
  CONSENT_TYPES,
  parseLocalDate,
  parsePlayerId,
  parseUuid,
  type ConsentType,
} from '@sport-performance/domain';
import { M15_RUGBY, USER } from './fixtures';

/** Valid payloads of the family area (B-413) for the tests. */

const AT = '2026-11-01T12:00:00.000Z';
const VERSION = '1793586338688123';

export const SOFIA_ID = parsePlayerId('0192e7a0-4444-7000-8000-000000000001');
export const MARTIN_ID = parsePlayerId('0192e7a0-4444-7000-8000-000000000002');

export function child(overrides: Partial<Child> = {}): Child {
  return {
    playerId: SOFIA_ID,
    firstName: 'Sofía',
    lastName: 'Ríos',
    birthDate: parseLocalDate('2012-05-10'),
    ofAge: false,
    guardianId: parseUuid('0192e7a0-5555-7000-8000-000000000001'),
    relationship: 'mother',
    hasAccount: false,
    adultConfirmed: false,
    categories: [{ id: M15_RUGBY.id, name: 'M15', sport: 'rugby' }],
    canManageAccess: true,
    ...overrides,
  };
}

/** An adult child who did not keep the guardian's access: only the link. */
export function hiddenAdult(): Child {
  return child({
    playerId: MARTIN_ID,
    firstName: 'Martín',
    birthDate: parseLocalDate('2000-01-01'),
    ofAge: true,
    guardianId: parseUuid('0192e7a0-5555-7000-8000-000000000002'),
    hasAccount: true,
    categories: [],
    canManageAccess: false,
  });
}

export function player(overrides: Partial<Player> = {}): Player {
  return {
    id: SOFIA_ID,
    firstName: 'Sofía',
    lastName: 'Ríos',
    birthDate: parseLocalDate('2012-05-10'),
    sex: 'male',
    sport: 'rugby',
    dominantSide: null,
    positionIds: [],
    currentCategoryIds: [M15_RUGBY.id],
    joinedOn: parseLocalDate('2020-03-01'),
    leftOn: null,
    leftReason: null,
    leftNote: null,
    hasAccount: false,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: VERSION,
    ...overrides,
  };
}

const DOCUMENT_IDS: Record<ConsentType, string> = {
  data: '0192e7a0-6666-7000-8000-000000000001',
  image: '0192e7a0-6666-7000-8000-000000000002',
  health: '0192e7a0-6666-7000-8000-000000000003',
  menstrual_cycle: '0192e7a0-6666-7000-8000-000000000004',
};

export function consentDocument(type: ConsentType, version = '2026-03'): ConsentDocument {
  return {
    id: parseUuid(DOCUMENT_IDS[type]),
    type,
    version,
    locale: 'es-AR',
    title: `Consentimiento ${type}`,
    bodySha256: 'a'.repeat(64),
    publishedAt: '2026-03-01T15:00:00.000Z',
    current: true,
    body: `Primer párrafo del texto ${type}.\n\nSegundo párrafo: podés revocarlo cuando quieras.`,
  };
}

export function consent(type: ConsentType, overrides: Partial<Consent> = {}): Consent {
  const document = consentDocument(type);
  return {
    id: parseUuid(`0192e7a0-7777-7000-8000-00000000000${String(CONSENT_TYPES.indexOf(type) + 1)}`),
    playerId: SOFIA_ID,
    type,
    documentId: document.id,
    documentVersion: document.version,
    signerKind: 'guardian',
    signedBy: USER.id,
    signedAt: '2026-03-05T13:30:00.000Z',
    revokedAt: null,
    revokedBy: null,
    ...overrides,
  };
}

function summaryOf(document: ConsentDocument): ConsentTypeStatus['currentDocument'] {
  const { id, type, version, locale, title, bodySha256, publishedAt, current } = document;
  return { id, type, version, locale, title, bodySha256, publishedAt, current };
}

export function typeStatus(
  type: ConsentType,
  state: ConsentTypeStatus['state'],
  overrides: Partial<ConsentTypeStatus> = {},
): ConsentTypeStatus {
  const signed = state === 'granted' || state === 'outdated';
  return {
    type,
    state,
    consent: signed ? consent(type) : null,
    currentDocument: summaryOf(consentDocument(type)),
    actions: ['sign', 'revoke'],
    ...overrides,
  };
}

/** Data granted, image missing, health revoked: a guardian of a minor. */
export function playerConsents(
  types: readonly ConsentTypeStatus[] = [
    typeStatus('data', 'granted'),
    typeStatus('image', 'missing'),
    typeStatus('health', 'revoked'),
  ],
  overrides: Partial<PlayerConsents> = {},
): PlayerConsents {
  return {
    playerId: SOFIA_ID,
    playerOfAge: false,
    requiredSigner: 'guardian',
    guardianSignaturesLapseOn: parseLocalDate('2030-06-09'),
    types: [...types],
    ...overrides,
  };
}

export function parentHeight(
  parent: ParentHeight['parent'],
  heightCm: number,
  source: ParentHeight['source'] = 'reported',
): ParentHeight {
  return { parent, heightCm, source, updatedAt: '2026-04-02T12:00:00.000Z', version: VERSION };
}

export function parentHeights(overrides: Partial<PlayerParentHeights> = {}): PlayerParentHeights {
  return { mother: null, father: parentHeight('father', 181, 'measured'), ...overrides };
}
