import { memberGuard, memberParser } from './enum.js';
import { addDays, compareLocalDates, localDate, localDateParts, type LocalDate } from './time.js';

/**
 * Kinds of consent (Ley 25.326, B-312): personal data, image (CMJ videos,
 * photos), health and, on their own, menstrual cycle tracking (B-806, ADR 0092:
 * a specific consent for an optional module, never implied by `health`) and the
 * position of the pod (B-913, ADR 0106: GNSS traces and raw pod logs, never
 * implied by `data`). Without a current consent of a type, data of that type
 * is not collected, and images are neither shown nor uploaded (permission
 * matrix, B-303, ADR 0025). `packages/db` builds the `consent_type` enum from
 * this constant, so a value is never renamed.
 */
export const CONSENT_TYPES = ['data', 'image', 'health', 'menstrual_cycle', 'location'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/**
 * Types that count only while `granted` (B-913, ADR 0106): a signature on an
 * older version of the text (`outdated`) or only a guardian's signature of an
 * adult within the grace period (`adult_signature_required`) does not count
 * for them. A new version of the location text asks to sign again, and until
 * then the player gets no pod and nothing of theirs is ingested or shown live.
 * `app.current_consent_types` in the database applies the same rule.
 */
export const GRANTED_ONLY_CONSENT_TYPES = ['location'] as const satisfies readonly ConsentType[];

/** Whether a consent of `type` counts only while its state is `granted`. */
export function countsOnlyWhenGranted(type: ConsentType): boolean {
  return (GRANTED_ONLY_CONSENT_TYPES as readonly ConsentType[]).includes(type);
}

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
 * Days a guardian's signature keeps counting once the player is of age
 * (B-311, ADR 0048). The adult becomes the holder of their data and signs
 * their own consents; until then, or for this long, what the guardian signed
 * still counts so that nothing stops being collected on the birthday. After
 * that it lapses: it is not revoked (it stays as evidence) but no longer
 * counts. `app.current_consent_types` in the database uses the same value.
 */
export const ADULT_CONSENT_GRACE_DAYS = 30;

/**
 * The first day a player born on `birthDate` is of age: the 18th birthday,
 * or 1 March when it falls on a 29 February of a common year (the same rule
 * as `ageInCompletedYears`).
 */
export function majorityDate(birthDate: LocalDate): LocalDate {
  const { year, month, day } = localDateParts(birthDate);
  const target = year + AGE_OF_MAJORITY_YEARS;
  if (month === 2 && day === 29 && !isLeapYear(target)) return localDate(target, 3, 1);
  return localDate(target, month, day);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * The first day the guardian's signatures of a player born on `birthDate`
 * no longer count: {@link ADULT_CONSENT_GRACE_DAYS} after the majority.
 */
export function guardianConsentsLapseOn(birthDate: LocalDate): LocalDate {
  return addDays(majorityDate(birthDate), ADULT_CONSENT_GRACE_DAYS);
}

/** Whether the guardian's signatures of a player born on `birthDate` lapsed on `onDate`. */
export function guardianConsentsLapsed(birthDate: LocalDate, onDate: LocalDate): boolean {
  return compareLocalDates(onDate, guardianConsentsLapseOn(birthDate)) >= 0;
}

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
 *   the UI asks to sign the current version. For
 *   {@link GRANTED_ONLY_CONSENT_TYPES} (`location`) it does not count.
 * - `adult_signature_required` (B-311): the player is of age and only a
 *   guardian's signature counts, within the grace period
 *   ({@link ADULT_CONSENT_GRACE_DAYS}). It still counts; the adult has to
 *   sign their own before it lapses. For {@link GRANTED_ONLY_CONSENT_TYPES}
 *   it does not count: the adult signs location themselves.
 * - `lapsed` (B-311): the only signatures left are a guardian's, past the
 *   grace period. They do not count: the adult has to sign.
 * - `revoked`: every consent of the type was revoked.
 * - `missing`: never signed.
 */
export const CONSENT_STATES = [
  'granted',
  'outdated',
  'adult_signature_required',
  'lapsed',
  'revoked',
  'missing',
] as const;
export type ConsentState = (typeof CONSENT_STATES)[number];

/** A signed consent, as far as its state is concerned. */
export interface ConsentRecord {
  readonly type: ConsentType;
  /** Text that was signed; `null` for consents recorded before the texts were stored. */
  readonly documentId: string | null;
  readonly documentVersion: string;
  /** Who signed: a guardian's signature lapses after the player's majority (B-311). */
  readonly signerKind: ConsentSigner;
  readonly signedAt: Date;
  readonly revokedAt: Date | null;
}

/**
 * The holder's side of the state (B-311): whether the player is of age and
 * whether their guardian's signatures already lapsed, on the club's day.
 * Without it (a minor, as before B-311) every signature counts.
 */
export interface ConsentHolder {
  readonly ofAge: boolean;
  readonly guardianConsentsLapsed: boolean;
}

const MINOR_HOLDER: ConsentHolder = { ofAge: false, guardianConsentsLapsed: false };

/** The current (last published) text of a type. */
export interface CurrentConsentDocument {
  readonly id: string;
  readonly version: string;
}

export interface ConsentTypeState<R extends ConsentRecord = ConsentRecord> {
  readonly type: ConsentType;
  readonly state: ConsentState;
  /**
   * The consent that counts: the player's own most recent one, else the most
   * recent one that counts. `null` when none counts.
   */
  readonly current: R | null;
}

/**
 * Whether a consent counts at `now`: signed (not in the future), not revoked
 * and, once the player is of age, not a guardian's signature past the grace
 * period. Same definition as `app.current_consent_types` in the database.
 */
export function isCurrentConsent(
  consent: ConsentRecord,
  now: Date,
  holder: ConsentHolder = MINOR_HOLDER,
): boolean {
  return (
    isSignedAndNotRevoked(consent, now) &&
    !(consent.signerKind === 'guardian' && holder.guardianConsentsLapsed)
  );
}

function isSignedAndNotRevoked(consent: ConsentRecord, now: Date): boolean {
  return consent.revokedAt === null && consent.signedAt.getTime() <= now.getTime();
}

const latestFirst = (x: ConsentRecord, y: ConsentRecord) =>
  y.signedAt.getTime() - x.signedAt.getTime();

/**
 * The state of each consent type (in {@link CONSENT_TYPES} order) from the
 * player's consents, the current text of each type and, once the player is
 * of age, who signed (B-311). The adult's own signature always wins over a
 * guardian's; a guardian's alone asks the adult to sign
 * (`adult_signature_required`) and, past the grace period, no longer counts
 * (`lapsed`).
 */
export function consentStates<R extends ConsentRecord>(
  consents: readonly R[],
  currentDocuments: Readonly<Partial<Record<ConsentType, CurrentConsentDocument>>>,
  now: Date,
  holder: ConsentHolder = MINOR_HOLDER,
): ConsentTypeState<R>[] {
  return CONSENT_TYPES.map((type) => {
    const ofType = consents.filter((c) => c.type === type);
    const counting = ofType.filter((c) => isCurrentConsent(c, now, holder)).sort(latestFirst);
    const own = holder.ofAge ? counting.filter((c) => c.signerKind === 'player') : [];
    const current = own[0] ?? counting[0] ?? null;
    if (current === null) {
      if (ofType.length === 0) return { type, state: 'missing', current: null };
      const lapsed = ofType.some((c) => isSignedAndNotRevoked(c, now));
      return { type, state: lapsed ? 'lapsed' : 'revoked', current: null };
    }
    if (holder.ofAge && current.signerKind === 'guardian') {
      return { type, state: 'adult_signature_required', current };
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

/**
 * Whether a consent type in `state` counts, that is, lets data of the type be
 * collected: `granted`, and also `outdated` and `adult_signature_required`
 * except for {@link GRANTED_ONLY_CONSENT_TYPES} (B-913).
 */
export function consentStateCounts(type: ConsentType, state: ConsentState): boolean {
  if (state === 'granted') return true;
  if (countsOnlyWhenGranted(type)) return false;
  return state === 'outdated' || state === 'adult_signature_required';
}

/**
 * Types of the consents that count among `consents` (in {@link CONSENT_TYPES}
 * order): current ({@link isCurrentConsent}) and, for
 * {@link GRANTED_ONLY_CONSENT_TYPES}, `granted` on the current text in
 * `currentDocuments`. Without the current text a granted-only type never
 * counts (fail closed). Same definition as `app.current_consent_types`.
 */
export function currentConsentTypes(
  consents: readonly ConsentRecord[],
  now: Date,
  holder: ConsentHolder = MINOR_HOLDER,
  currentDocuments: Readonly<Partial<Record<ConsentType, CurrentConsentDocument>>> = {},
): ConsentType[] {
  return consentStates(consents, currentDocuments, now, holder)
    .filter((s) => consentStateCounts(s.type, s.state))
    .map((s) => s.type);
}

/**
 * Whether the pod may collect the player's position (B-913, ADR 0106): assign
 * them a pod, ingest its data and show them live. Only with a `granted`
 * location consent: never on an older text, never with only a guardian's
 * signature of an adult, never revoked or lapsed. Takes the player's state of
 * `location`, or all their states.
 */
export function canCollectLocation(
  states: ConsentTypeState | readonly ConsentTypeState[],
): boolean {
  const list: readonly ConsentTypeState[] = isStateList(states) ? states : [states];
  return list.some((s) => s.type === 'location' && consentStateCounts(s.type, s.state));
}

function isStateList(
  states: ConsentTypeState | readonly ConsentTypeState[],
): states is readonly ConsentTypeState[] {
  return Array.isArray(states);
}
