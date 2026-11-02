import { memberGuard, memberParser } from './enum.js';

/**
 * Kinds of consent (Ley 25.326, B-312): personal data, image (CMJ videos,
 * photos) and health. Without a current consent of a type, data of that type
 * is not collected, and images are neither shown nor uploaded (permission
 * matrix, B-303, ADR 0025). `packages/db` builds the `consent_type` enum from
 * this constant, so a value is never renamed.
 */
export const CONSENT_TYPES = ['data', 'image', 'health'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const isConsentType = memberGuard(CONSENT_TYPES);
export const parseConsentType = memberParser(CONSENT_TYPES, 'invalid_argument', 'consent type');

/**
 * Who signs a consent: a guardian while the player is a minor, the player
 * once of age (B-311). `packages/db` builds the `consent_signer` enum from here.
 */
export const CONSENT_SIGNERS = ['guardian', 'player'] as const;
export type ConsentSigner = (typeof CONSENT_SIGNERS)[number];

export const isConsentSigner = memberGuard(CONSENT_SIGNERS);
export const parseConsentSigner = memberParser(
  CONSENT_SIGNERS,
  'invalid_argument',
  'consent signer',
);

/** Age of majority in Argentina (Código Civil y Comercial, art. 25). */
export const AGE_OF_MAJORITY_YEARS = 18;
