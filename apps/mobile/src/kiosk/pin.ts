/**
 * The PIN that locks the kiosk (B-504, ADR 0086): the staff member who opens
 * the kiosk sets it, and only it takes the device out of the kiosk. It is
 * kept as a salted SHA-256 in the Keychain / Keystore, never in clear, and
 * the attempts are limited ({@link kioskLockoutMs}): with 4 to 6 digits the
 * limit, not the hash, is what stops guessing.
 */

export const KIOSK_PIN_MIN_LENGTH = 4;
export const KIOSK_PIN_MAX_LENGTH = 6;

/** Why a new PIN is not accepted. */
export type KioskPinProblem = 'length' | 'digits' | 'weak' | 'mismatch';

const DIGITS = /^[0-9]+$/;

/** All the same digit, or a run up or down ("1111", "1234", "9876"). */
export function isWeakKioskPin(pin: string): boolean {
  if (!DIGITS.test(pin) || pin.length < 2) return false;
  const steps = new Set<number>();
  for (let i = 1; i < pin.length; i += 1) {
    steps.add(Number(pin[i]) - Number(pin[i - 1]));
  }
  if (steps.size !== 1) return false;
  const [step] = [...steps];
  return step === 0 || step === 1 || step === -1;
}

/** The problem of a new PIN and its confirmation, or `null` when it is accepted. */
export function kioskPinProblem(pin: string, confirmation: string): KioskPinProblem | null {
  if (!DIGITS.test(pin)) return pin.length === 0 ? 'length' : 'digits';
  if (pin.length < KIOSK_PIN_MIN_LENGTH || pin.length > KIOSK_PIN_MAX_LENGTH) return 'length';
  if (isWeakKioskPin(pin)) return 'weak';
  if (pin !== confirmation) return 'mismatch';
  return null;
}

/** SHA-256 of a text as lowercase hex (`expo-crypto` on the phone, `node:crypto` in tests). */
export type Sha256Hex = (text: string) => Promise<string>;

/** The stored hash of a PIN with its salt. */
export function hashKioskPin(pin: string, salt: string, sha256Hex: Sha256Hex): Promise<string> {
  return sha256Hex(`sport-performance:kiosk-pin:v1:${salt}:${pin}`);
}

/** Compares two hashes without stopping at the first different character. */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Wrong PINs allowed before the first wait. */
export const KIOSK_FREE_ATTEMPTS = 5;
export const KIOSK_LOCKOUT_BASE_MS = 30_000;
export const KIOSK_LOCKOUT_MAX_MS = 15 * 60_000;

/**
 * How long the exit stays locked after `failures` wrong PINs in a row: none
 * for the first {@link KIOSK_FREE_ATTEMPTS}, then 30 s doubling on each
 * further one, up to 15 min.
 */
export function kioskLockoutMs(failures: number): number {
  if (failures < KIOSK_FREE_ATTEMPTS) return 0;
  const doublings = failures - KIOSK_FREE_ATTEMPTS;
  return Math.min(KIOSK_LOCKOUT_MAX_MS, KIOSK_LOCKOUT_BASE_MS * 2 ** Math.min(doublings, 10));
}
