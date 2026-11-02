/**
 * Versions of the API and of its clients (B-324, ADR 0045).
 *
 * - The route prefix (`/v1`) is the major version of the contract (ADR 0020).
 * - {@link CONTRACT_VERSION} is the semver of the contract: `info.version` of
 *   the OpenAPI, the {@link API_VERSION_HEADER} of every response and
 *   `api.contractVersion` of `GET /v1/app/compatibility`.
 * - The mobile app says which binary and which EAS Update runtime it is in
 *   the client headers below; the API answers `426 app_update_required` when
 *   the binary is older than the minimum supported version of its platform.
 */

/** Semver of the contract; bump minor on additive changes, major together with the `/vN` prefix. */
export const CONTRACT_VERSION = '0.2.0';

/** Response header of every answer of the API (errors and `404` too): {@link CONTRACT_VERSION}. */
export const API_VERSION_HEADER = 'x-api-version';

/** Request header of the mobile app: its platform, `ios` or `android`. The web does not send it. */
export const CLIENT_PLATFORM_HEADER = 'x-client-platform';

/**
 * Request header of the mobile app: native version of the binary
 * (`MAJOR.MINOR.PATCH`, `nativeApplicationVersion`). Sent together with
 * {@link CLIENT_PLATFORM_HEADER}; one without the other is `400`.
 */
export const CLIENT_VERSION_HEADER = 'x-client-version';

/**
 * Request header of the mobile app: `runtimeVersion` of the EAS Update
 * bundle it runs (ADR 0013). Optional; for support and diagnostics.
 */
export const CLIENT_RUNTIME_VERSION_HEADER = 'x-client-runtime-version';

/** Pattern of a runtime version: what EAS accepts, bounded. */
export const RUNTIME_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
