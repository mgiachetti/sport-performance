import * as Sentry from '@sentry/node';
import type { SentryConfig } from '../config/env.js';
import type { ErrorReporter } from './error-reporter.js';
import { pathOf } from './logger.js';

type ScrubbableEvent = Pick<Sentry.Event, 'request' | 'user' | 'breadcrumbs' | 'extra'>;

/**
 * Removes what could carry personal or health data before an event leaves
 * the process (ADR 0016): request headers, cookies, body, query string and
 * any user field other than the internal id. A second line of defense; the
 * code already avoids attaching that data.
 */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.request) {
    const { method, url } = event.request;
    event.request = {
      ...(method !== undefined && { method }),
      ...(url !== undefined && { url: pathOf(url) }),
    };
  }
  if (event.user) {
    const { id } = event.user;
    event.user = id === undefined ? {} : { id };
  }
  delete event.extra;
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => scrubBreadcrumb(crumb));
  }
  return event;
}

export function scrubBreadcrumb(crumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  if (crumb.data === undefined) return crumb;
  const data: Record<string, unknown> = {};
  for (const key of ['method', 'status_code'] as const) {
    if (key in crumb.data) data[key] = crumb.data[key];
  }
  const url: unknown = crumb.data.url;
  if (typeof url === 'string') data.url = pathOf(url);
  return { ...crumb, data };
}

/**
 * Starts Sentry. Call it before importing the rest of the app (see
 * `instrument.ts`) so the HTTP, Fastify and pg instrumentations patch the
 * modules when they load.
 */
export function initSentry(config: SentryConfig): void {
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,
    tracesSampleRate: config.tracesSampleRate,
    // Collect nothing that could be personal or health data (ADR 0016).
    includeServerName: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
    },
    // Errors are reported by our handler with ids only; keep the SDK from logging bodies.
    integrations: (defaults) => defaults.filter((integration) => integration.name !== 'Console'),
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  });
}

/** Reporter backed by the initialized Sentry client. */
export function sentryErrorReporter(): ErrorReporter {
  return {
    enabled: true,
    capture(error, context = {}) {
      Sentry.withScope((scope) => {
        if (context.requestId !== undefined) scope.setTag('request_id', context.requestId);
        if (context.method !== undefined) scope.setTag('http.method', context.method);
        if (context.source !== undefined) scope.setTag('source', context.source);
        if (context.route !== undefined) scope.setTag('route', context.route);
        if (context.clubId !== undefined) scope.setTag('club_id', context.clubId);
        if (context.userId !== undefined) scope.setUser({ id: context.userId });
        Sentry.captureException(error);
      });
    },
    flush: (timeoutMs) => Sentry.flush(timeoutMs),
  };
}

export function isSentryInitialized(): boolean {
  return Sentry.isInitialized();
}
