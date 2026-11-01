/**
 * Preloaded with `node --import ./dist/instrument.js` (see the `start`
 * script) so Sentry patches http, Fastify and pg before they load. Without
 * `SENTRY_DSN` it does nothing (ADR 0016).
 */
import { loadSentryConfig } from './config/env.js';
import { initSentry } from './observability/sentry.js';

const sentry = loadSentryConfig();
if (sentry !== null) initSentry(sentry);
