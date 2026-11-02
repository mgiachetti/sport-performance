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

/**
 * Who has to sign a consent of a player now: a guardian while the player is
 * a minor, the player once of age (B-311, permission matrix: `consent.sign`).
 */
export function requiredConsentSigner(playerOfAge: boolean): ConsentSigner {
  return playerOfAge ? 'player' : 'guardian';
}

/**
 * The signer kind a role signs as: `parent` signs as a guardian, `player` as
 * themselves. Every other role never signs a consent (`null`).
 */
export function consentSignerOfRole(role: string): ConsentSigner | null {
  switch (role) {
    case 'parent':
      return 'guardian';
    case 'player':
      return 'player';
    default:
      return null;
  }
}

/**
 * State of one consent type of a player (B-312):
 *
 * - `granted`: a current consent on the current version of the text.
 * - `outdated`: a current consent, but on an older version of the text. It
 *   still counts (data of the type may be collected) until it is revoked;
 *   the UI asks to sign the current version.
 * - `revoked`: every consent of the type was revoked.
 * - `missing`: never signed.
 */
export const CONSENT_STATES = ['granted', 'outdated', 'revoked', 'missing'] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

/** A signed consent, as far as its state is concerned. */
export interface ConsentRecord {
  readonly type: ConsentType;
  /** Text that was signed; `null` for consents recorded before the texts were stored. */
  readonly documentId: string | null;
  readonly documentVersion: string;
  readonly signedAt: Date;
  readonly revokedAt: Date | null;
}

/** The current (last published) text of a type. */
export interface CurrentConsentDocument {
  readonly id: string;
  readonly version: string;
}

export interface ConsentTypeState<R extends ConsentRecord = ConsentRecord> {
  readonly type: ConsentType;
  readonly state: ConsentState;
  /** The most recently signed consent that is not revoked, if any. */
  readonly current: R | null;
}

/**
 * Whether a consent counts at `now`: signed (not in the future) and not
 * revoked. Same definition as `app.current_consent_types` in the database.
 */
export function isCurrentConsent(consent: ConsentRecord, now: Date): boolean {
  return consent.revokedAt === null && consent.signedAt.getTime() <= now.getTime();
}

/**
 * The state of each consent type (in {@link CONSENT_TYPES} order) from the
 * player's consents and the current text of each type.
 */
export function consentStates<R extends ConsentRecord>(
  consents: readonly R[],
  currentDocuments: Readonly<Partial<Record<ConsentType, CurrentConsentDocument>>>,
  now: Date,
): ConsentTypeState<R>[] {
  return CONSENT_TYPES.map((type) => {
    const ofType = consents.filter((c) => c.type === type);
    const current =
      ofType
        .filter((c) => isCurrentConsent(c, now))
        .sort((x, y) => y.signedAt.getTime() - x.signedAt.getTime())[0] ?? null;
    if (current === null) {
      return { type, state: ofType.length === 0 ? 'missing' : 'revoked', current: null };
    }
    const document = currentDocuments[type];
    const onCurrentText =
      document !== undefined &&
      (current.documentId === null
        ? current.documentVersion === document.version
        : current.documentId === document.id);
    return { type, state: onCurrentText ? 'granted' : 'outdated', current };
  });
}

/** Types of the current consents among `consents` (in {@link CONSENT_TYPES} order). */
export function currentConsentTypes(consents: readonly ConsentRecord[], now: Date): ConsentType[] {
  return CONSENT_TYPES.filter((type) =>
    consents.some((c) => c.type === type && isCurrentConsent(c, now)),
  );
}
