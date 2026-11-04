import type { SecureStorage } from '../platform/storage.ts';

/**
 * The id this installation registers as a measuring device of the club
 * (B-606, ADR 0076): the `serialNumber` of its `device` row, so the phone
 * finds itself in the club's list without creating another device. A random
 * UUID of its own, never the `deviceId` of the sign-in (ADR 0033): the
 * club's staff reads the device list, and the two stay unlinkable.
 *
 * Kept in the secure storage, which is not migrated by a backup (ADR 0058):
 * a restored or new phone is a new device, as it should be (its touch
 * latency is not the old one's).
 */
export const MEASURING_INSTALLATION_ID_KEY = 'measuring.installation-id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface MeasuringInstallation {
  /** Created on first use; one promise per process, so two callers never create two. */
  id(): Promise<string>;
}

export function createMeasuringInstallation(
  storage: SecureStorage,
  randomUUID: () => string,
): MeasuringInstallation {
  let pending: Promise<string> | null = null;
  async function read(): Promise<string> {
    const stored = await storage.getItem(MEASURING_INSTALLATION_ID_KEY);
    if (stored !== null && UUID_PATTERN.test(stored)) return stored.toLowerCase();
    const created = randomUUID().toLowerCase();
    await storage.setItem(MEASURING_INSTALLATION_ID_KEY, created);
    return created;
  }
  return {
    id() {
      pending ??= read().catch((error: unknown) => {
        pending = null;
        throw error;
      });
      return pending;
    },
  };
}

/** What the phone says about itself when it registers (no personal data). */
export interface HardwareInfo {
  readonly kind: 'phone' | 'tablet';
  /** Brand and model, if the system tells (`Pixel 9`, `iPad`). */
  readonly model: string | null;
  /** Operating system and version (`iOS 26.1`, `Android 16`). */
  readonly osVersion: string | null;
}
