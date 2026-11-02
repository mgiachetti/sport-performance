import { describe, expect, it } from 'vitest';
import {
  CONSENT_STATES,
  consentSignerOfRole,
  consentStates,
  currentConsentTypes,
  isCurrentConsent,
  requiredConsentSigner,
  type ConsentRecord,
} from './consent.js';
import { ROLES } from './role.js';

const NOW = new Date('2026-11-02T12:00:00Z');
const at = (iso: string) => new Date(iso);

function record(overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    type: 'data',
    documentId: 'doc-data-1',
    documentVersion: '2026-01',
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
    expect(CONSENT_STATES).toEqual(['granted', 'outdated', 'revoked', 'missing']);
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
    ]);
    expect(states[0]?.current).toBe(data);
    expect(states[2]?.current).toBeNull();
    expect(consentStates([], documents, NOW).map((s) => s.state)).toEqual([
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
