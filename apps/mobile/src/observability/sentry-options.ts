import type { Breadcrumb, ErrorEvent, Event, ReactNativeOptions } from '@sentry/react-native';
import type { RuntimeConfig } from '../config/runtime-config.ts';

/**
 * Breadcrumb categories that may leave the device. Everything else (console
 * lines, touches and UI labels, which can carry a player's name or a value
 * typed in a form) is dropped (ADR 0016).
 */
const ALLOWED_BREADCRUMB_CATEGORIES = new Set([
  'navigation',
  'fetch',
  'xhr',
  'http',
  'app.lifecycle',
  'app.state',
  'device.event',
  'device.orientation',
  'sentry.event',
  'sentry.transaction',
]);

/** Link tokens (invitations, player access: 256 bits base64url) and anything after them. */
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_ROUTES = new Set(['invite', 'player-access']);

/**
 * A URL or route without what could identify a person or open a session:
 * no query string or fragment (they may carry search terms or tokens) and
 * link tokens replaced by `:token`. Ids (UUIDs) stay: they are not personal data.
 */
export function scrubUrl(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? '';
  const schemeMatch = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)(.*)$/i.exec(withoutQuery);
  const origin = schemeMatch?.[1] ?? '';
  const path = schemeMatch?.[2] ?? withoutQuery;
  const segments = path.split('/');
  // A custom scheme puts the first segment in the "host": `scheme://invite/<token>`.
  const originHost = origin.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  let previous = TOKEN_ROUTES.has(originHost) ? originHost : '';
  const scrubbed = segments.map((segment) => {
    const replaced =
      TOKEN_SEGMENT.test(segment) || (TOKEN_ROUTES.has(previous) && segment !== '')
        ? ':token'
        : segment;
    previous = segment;
    return replaced;
  });
  return origin + scrubbed.join('/');
}

function scrubData(data: Record<string, unknown>): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of ['method', 'status_code', 'state', 'action'] as const) {
    if (key in data) kept[key] = data[key];
  }
  for (const key of ['url', 'from', 'to'] as const) {
    const value = data[key];
    if (typeof value === 'string') kept[key] = scrubUrl(value);
  }
  return kept;
}

/** `null` drops the breadcrumb. */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category === undefined || !ALLOWED_BREADCRUMB_CATEGORIES.has(crumb.category)) {
    return null;
  }
  const scrubbed: Breadcrumb = { ...crumb };
  if (crumb.data !== undefined) scrubbed.data = scrubData(crumb.data);
  if (typeof crumb.message === 'string') scrubbed.message = scrubUrl(crumb.message);
  return scrubbed;
}

/**
 * Removes from an event what could be personal or health data (ADR 0016):
 * request headers, body and query, user fields other than the internal id,
 * extra data, the device name and tokens in URLs. A second line of defense:
 * the app never attaches that data on purpose.
 */
export function scrubEvent<E extends Event>(event: E): E {
  if (event.request !== undefined) {
    const { method, url } = event.request;
    event.request = {
      ...(method !== undefined && { method }),
      ...(url !== undefined && { url: scrubUrl(url) }),
    };
  }
  if (event.user !== undefined) {
    const { id } = event.user;
    event.user = id === undefined ? {} : { id };
  }
  delete event.extra;
  if (event.contexts?.device !== undefined) {
    const device = { ...event.contexts.device };
    delete device.name;
    event.contexts = { ...event.contexts, device };
  }
  if (event.transaction !== undefined) event.transaction = scrubUrl(event.transaction);
  if (event.breadcrumbs !== undefined) {
    event.breadcrumbs = event.breadcrumbs
      .map((crumb) => scrubBreadcrumb(crumb))
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }
  return event;
}

export interface SentryBuild {
  /** `expo-application`'s id and version, for `release` (`<appId>@<version>+<build>`). */
  readonly appId: string;
  readonly nativeVersion: string;
  readonly buildNumber: string | null;
  /** EAS Update id of the running bundle; `null` for the embedded one. */
  readonly updateId: string | null;
}

/**
 * Options of `Sentry.init`, or `null` when this build has no DSN. Collects
 * nothing personal (`sendDefaultPii: false`, no screenshots, no view
 * hierarchy, no failed-request capture with bodies), and scrubs every event.
 */
export function sentryOptions(
  config: RuntimeConfig,
  build: SentryBuild,
): ReactNativeOptions | null {
  if (config.sentry === null) return null;
  const release = `${build.appId}@${build.nativeVersion}${
    build.buildNumber === null ? '' : `+${build.buildNumber}`
  }`;
  return {
    dsn: config.sentry.dsn,
    environment: config.variant,
    release,
    ...(build.buildNumber !== null && { dist: build.buildNumber }),
    tracesSampleRate: config.sentry.tracesSampleRate,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    reportAccessibilityIdentifier: false,
    enableCaptureFailedRequests: false,
    maxBreadcrumbs: 50,
    initialScope: build.updateId === null ? {} : { tags: { update_id: build.updateId } },
    beforeSend: (event: ErrorEvent) => scrubEvent(event),
    beforeSendTransaction: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  };
}
