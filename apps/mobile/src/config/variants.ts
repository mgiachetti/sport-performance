/**
 * Build variants of the app (ADR 0058). Each one is its own installable app
 * (bundle id / package), points to its own API and listens to its own EAS
 * Update channel, so a staging build never receives a production update and
 * the staff can have both installed side by side.
 */
export const APP_VARIANTS = ['development', 'staging', 'production'] as const;

export type AppVariant = (typeof APP_VARIANTS)[number];

export function isAppVariant(value: unknown): value is AppVariant {
  return typeof value === 'string' && (APP_VARIANTS as readonly string[]).includes(value);
}

/** Bundle identifier (iOS) and application id (Android) of the production app. */
export const BASE_APP_ID = 'com.sportperformance.app';

/** Deep link scheme; must match `APP_DEEP_LINK_SCHEME` of the API (ADR 0028). */
export const BASE_SCHEME = 'sportperformance';

/** Store name of the production app (white-label: one app for every club, ADR 0014). */
export const BASE_APP_NAME = 'Sport Performance';

export interface VariantIdentity {
  /** iOS bundle identifier and Android application id. */
  readonly appId: string;
  /** Name under the icon. */
  readonly name: string;
  /**
   * URL scheme of this variant. Only production uses the bare scheme of the
   * API links, so an invitation never opens a development build by accident.
   */
  readonly scheme: string;
  /** EAS Update channel the binary listens to (same name as the variant). */
  readonly updateChannel: AppVariant;
}

export function variantIdentity(variant: AppVariant): VariantIdentity {
  switch (variant) {
    case 'production':
      return {
        appId: BASE_APP_ID,
        name: BASE_APP_NAME,
        scheme: BASE_SCHEME,
        updateChannel: 'production',
      };
    case 'staging':
      return {
        appId: `${BASE_APP_ID}.staging`,
        name: `${BASE_APP_NAME} (staging)`,
        scheme: `${BASE_SCHEME}-staging`,
        updateChannel: 'staging',
      };
    case 'development':
      return {
        appId: `${BASE_APP_ID}.dev`,
        name: `${BASE_APP_NAME} (dev)`,
        scheme: `${BASE_SCHEME}-dev`,
        updateChannel: 'development',
      };
  }
}
