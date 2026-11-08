import { describe, expect, it } from 'vitest';
import {
  ADULT_CONSENT_GRACE_DAYS,
  CONSENT_STATES,
  CONSENT_TYPES,
  GRANTED_ONLY_CONSENT_TYPES,
  canCollectLocation,
  consentSignerOfRole,
  consentStateCounts,
  consentStates,
  countsOnlyWhenGranted,
  currentConsentTypes,
  guardianConsentsLapseOn,
  guardianConsentsLapsed,
  isCurrentConsent,
  majorityDate,
  requiredConsentSigner,
  type ConsentRecord,
  type ConsentTypeState,
} from './consent.js';
import { ROLES } from './role.js';
import { isOfAge } from './permissions/subject.js';
import { addDays, parseLocalDate } from './time.js';

const NOW = new Date('2026-11-02T12:00:00Z');
const at = (iso: string) => new Date(iso);

function record(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    type: 'data',
    documentId: 'doc-data-1',
    documentVersion: '2026-01',
    signerKind: 'guardian',
    signedAt: at('2026-03-01T10:00:00Z'),
    revokedAt: null,
    ...overrides,
  };
}

const documents = {
  data: { id: 'doc-data-2', version: '2026-11' },
  image: { id: 'doc-image-1', version: '2026-01' },
  health: { id: 'doc-health-1', version: '2026-01' },
};

describe('consent signers', () => {
  it('a guardian signs for a minor, the player once of age', () => {
    expect(requiredConsentSigner(false)).toBe('guardian');
    expect(requiredConsentSigner(true)).toBe('player');
  });

  it('only the parent and player roles sign, each as its kind', () => {
    const signers = Object.fromEntries(ROLES.map((role) => [role, consentSignerOfRole(role)]));
    expect(signers).toEqual({
      player: 'player',
      parent: 'guardian',
      coach: null,
      sc: null,
      medical: null,
      admin: null,
      superadmin: null,
    });
  });
});

describe('current consents', () => {
  it('counts a signed, not revoked consent; not one signed in the future', () => {
    expect(isCurrentConsent(record(), NOW)).toBe(true);
    expect(isCurrentConsent(record({ revokedAt: at('2026-04-01T00:00:00Z') }), NOW)).toBe(false);
    expect(isCurrentConsent(record({ signedAt: at('2026-11-03T00:00:00Z') }), NOW)).toBe(false);
  });

  it('lists current types in vocabulary order, once each', () => {
    expect(
      currentConsentTypes(
        [
          record({ type: 'health' }),
          record({ type: 'data' }),
          record({ type: 'data', documentId: 'doc-data-2' }),
          record({ type: 'image', revokedAt: at('2026-05-01T00:00:00Z') }),
        ],
        NOW,
      ),
    ).toEqual(['data', 'health']);
    expect(currentConsentTypes([], NOW)).toEqual([]);
  });
});

describe('consentStates', () => {
  it('has the four states', () => {
    expect(CONSENT_STATES).toEqual([
      'granted',
      'outdated',
      'adult_signature_required',
      'lapsed',
      'revoked',
      'missing',
    ]);
  });

  it('tells granted, outdated, revoked and missing apart', () => {
    const data = record({ type: 'data', documentId: 'doc-data-1' });
    const image = record({ type: 'image', documentId: 'doc-image-1' });
    const health = record({
      type: 'health',
      documentId: 'doc-health-1',
      revokedAt: at('2026-06-01T00:00:00Z'),
    });
    const states = consentStates([data, image, health], documents, NOW);
    expect(states.map((s) => [s.type, s.state])).toEqual([
      ['data', 'outdated'],
      ['image', 'granted'],
      ['health', 'revoked'],
      ['menstrual_cycle', 'missing'],
      ['location', 'missing'],
    ]);
    expect(states[0]?.current).toBe(data);
    expect(states[2]?.current).toBeNull();
    expect(consentStates([], documents, NOW).map((s) => s.state)).toEqual([
      'missing',
      'missing',
      'missing',
      'missing',
      'missing',
    ]);
  });

  it('takes the most recent current consent of a type', () => {
    const older = record({ documentId: 'doc-data-1', signedAt: at('2026-03-01T00:00:00Z') });
    const newer = record({
      documentId: 'doc-data-2',
      documentVersion: '2026-11',
      signedAt: at('2026-11-01T00:00:00Z'),
    });
    const [data] = consentStates([older, newer], documents, NOW);
    expect(data).toEqual({ type: 'data', state: 'granted', current: newer });
    // Revoking the newer one leaves the older, outdated one.
    const [afterRevoke] = consentStates(
      [older, { ...newer, revokedAt: at('2026-11-02T00:00:00Z') }],
      documents,
      NOW,
    );
    expect(afterRevoke).toEqual({ type: 'data', state: 'outdated', current: older });
  });

  it('matches a consent recorded before the texts by version; without a text it is outdated', () => {
    const legacy = record({ type: 'image', documentId: null, documentVersion: '2026-01' });
    expect(consentStates([legacy], documents, NOW)[1]?.state).toBe('granted');
    expect(consentStates([legacy], {}, NOW)[1]?.state).toBe('outdated');
  });
});

describe('majority (B-311)', () => {
  const d = parseLocalDate;

  it('the majority is the 18th birthday; 29 February turns 18 on 1 March of a common year', () => {
    expect(majorityDate(d('2008-11-02'))).toBe('2026-11-02');
    expect(majorityDate(d('2008-02-29'))).toBe('2026-03-01');
    expect(majorityDate(d('2012-02-29'))).toBe('2030-03-01');
    expect(majorityDate(d('2014-02-28'))).toBe('2032-02-28');
  });

  it('matches isOfAge on both sides of the birthday', () => {
    for (const birth of ['2008-02-29', '2008-03-01', '2008-12-31', '2009-01-01'].map(d)) {
      const majority = majorityDate(birth);
      expect(isOfAge(birth, majority)).toBe(true);
      expect(isOfAge(birth, addDays(majority, -1))).toBe(false);
    }
  });

  it('a guardian signature lapses ADULT_CONSENT_GRACE_DAYS after the majority', () => {
    expect(ADULT_CONSENT_GRACE_DAYS).toBe(30);
    const birth = d('2008-10-01');
    expect(guardianConsentsLapseOn(birth)).toBe('2026-10-31');
    expect(guardianConsentsLapsed(birth, d('2026-10-30'))).toBe(false);
    expect(guardianConsentsLapsed(birth, d('2026-10-31'))).toBe(true);
    // The same as "of age 30 days ago", the definition of the database.
    for (const today of ['2026-10-30', '2026-10-31', '2026-11-01'].map(d)) {
      expect(guardianConsentsLapsed(birth, today)).toBe(
        isOfAge(birth, addDays(today, -ADULT_CONSENT_GRACE_DAYS)),
      );
    }
  });
});

describe('consent states once the player is of age (B-311)', () => {
  const adultInGrace = { ofAge: true, guardianConsentsLapsed: false };
  const adultLapsed = { ofAge: true, guardianConsentsLapsed: true };
  const onCurrentText = { documentId: 'doc-data-2', documentVersion: '2026-11' };

  it('a minor: a guardian signature is granted, as before', () => {
    const [data] = consentStates([record(onCurrentText)], documents, NOW);
    expect(data?.state).toBe('granted');
  });

  it('an adult with only a guardian signature: it counts and asks the adult to sign', () => {
    const guardianSigned = record(onCurrentText);
    const [data] = consentStates([guardianSigned], documents, NOW, adultInGrace);
    expect(data).toEqual({
      type: 'data',
      state: 'adult_signature_required',
      current: guardianSigned,
    });
    expect(currentConsentTypes([guardianSigned], NOW, adultInGrace)).toEqual(['data']);
  });

  it('past the grace period the guardian signature lapses: it no longer counts', () => {
    const guardianSigned = record(onCurrentText);
    expect(isCurrentConsent(guardianSigned, NOW, adultLapsed)).toBe(false);
    const [data] = consentStates([guardianSigned], documents, NOW, adultLapsed);
    expect(data).toEqual({ type: 'data', state: 'lapsed', current: null });
    expect(currentConsentTypes([guardianSigned], NOW, adultLapsed)).toEqual([]);
  });

  it('a revoked guardian signature is revoked, not lapsed', () => {
    const revoked = record({ ...onCurrentText, revokedAt: at('2026-10-01T00:00:00Z') });
    expect(consentStates([revoked], documents, NOW, adultLapsed)[0]?.state).toBe('revoked');
  });

  it("the adult's own signature wins over a more recent guardian one", () => {
    const own = record({
      ...onCurrentText,
      signerKind: 'player',
      signedAt: at('2026-10-01T00:00:00Z'),
    });
    const guardianSigned = record({ ...onCurrentText, signedAt: at('2026-10-15T00:00:00Z') });
    for (const holder of [adultInGrace, adultLapsed]) {
      const [data] = consentStates([guardianSigned, own], documents, NOW, holder);
      expect(data).toEqual({ type: 'data', state: 'granted', current: own });
    }
  });

  it("the adult's own signature on an older text is outdated, and still counts", () => {
    const own = record({ signerKind: 'player' });
    const [data] = consentStates([own], documents, NOW, adultLapsed);
    expect(data?.state).toBe('outdated');
  });

  it('a player signature never lapses', () => {
    expect(isCurrentConsent(record({ signerKind: 'player' }), NOW, adultLapsed)).toBe(true);
  });
});

describe('location consent (B-913, ADR 0106)', () => {
  const locationDocuments = {
    ...documents,
    location: { id: 'doc-location-2', version: '2026-12' },
  };
  const onCurrent = {
    type: 'location' as const,
    documentId: 'doc-location-2',
    documentVersion: '2026-12',
  };
  const onOlder = {
    type: 'location' as const,
    documentId: 'doc-location-1',
    documentVersion: '2026-11',
  };
  const adultInGrace = { ofAge: true, guardianConsentsLapsed: false };
  const adultLapsed = { ofAge: true, guardianConsentsLapsed: true };
  const locationState = (states: readonly ConsentTypeState[]) =>
    states.find((s) => s.type === 'location');

  it('is its own type, the only one that counts only while granted', () => {
    expect(CONSENT_TYPES).toContain('location');
    expect(GRANTED_ONLY_CONSENT_TYPES).toEqual(['location']);
    expect(CONSENT_TYPES.filter(countsOnlyWhenGranted)).toEqual(['location']);
  });

  it('counts only granted; outdated and adult_signature_required count for the other types', () => {
    for (const state of CONSENT_STATES) {
      expect(consentStateCounts('location', state), state).toBe(state === 'granted');
      expect(consentStateCounts('data', state), state).toBe(
        ['granted', 'outdated', 'adult_signature_required'].includes(state),
      );
    }
  });

  it("a guardian's signature of a minor on the current text allows collecting", () => {
    const states = consentStates([record(onCurrent)], locationDocuments, NOW);
    expect(locationState(states)?.state).toBe('granted');
    expect(canCollectLocation(states)).toBe(true);
    expect(currentConsentTypes([record(onCurrent)], NOW, undefined, locationDocuments)).toEqual([
      'location',
    ]);
  });

  it('a signature on an older text does not (unlike data)', () => {
    const consents = [record(onOlder), record({ type: 'data' })];
    const states = consentStates(consents, locationDocuments, NOW);
    expect(locationState(states)?.state).toBe('outdated');
    expect(states[0]?.state).toBe('outdated');
    expect(canCollectLocation(states)).toBe(false);
    expect(currentConsentTypes(consents, NOW, undefined, locationDocuments)).toEqual(['data']);
  });

  it("an adult with only a guardian's signature does not: the adult signs it", () => {
    const states = consentStates([record(onCurrent)], locationDocuments, NOW, adultInGrace);
    const location = locationState(states);
    expect(location?.state).toBe('adult_signature_required');
    expect(location !== undefined && canCollectLocation(location)).toBe(false);
    const own = record({ ...onCurrent, signerKind: 'player' });
    expect(canCollectLocation(consentStates([own], locationDocuments, NOW, adultInGrace))).toBe(
      true,
    );
  });

  it('revoked, lapsed, missing or without the current text: never', () => {
    const revoked = record({ ...onCurrent, revokedAt: at('2026-10-01T00:00:00Z') });
    expect(canCollectLocation(consentStates([revoked], locationDocuments, NOW))).toBe(false);
    expect(
      canCollectLocation(consentStates([record(onCurrent)], locationDocuments, NOW, adultLapsed)),
    ).toBe(false);
    expect(canCollectLocation(consentStates([], locationDocuments, NOW))).toBe(false);
    expect(canCollectLocation([])).toBe(false);
    // Without the current text it cannot be granted: fail closed.
    expect(currentConsentTypes([record(onCurrent)], NOW)).toEqual([]);
  });

  it('only the location state decides, never a granted state of another type', () => {
    const data = record({ type: 'data', documentId: 'doc-data-2' });
    expect(canCollectLocation(consentStates([data], locationDocuments, NOW))).toBe(false);
  });
});
