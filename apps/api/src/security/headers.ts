import type { FastifyReply } from 'fastify';

/**
 * CSP of a JSON API: nothing it serves may load, embed, frame or submit
 * anything. If a response is ever rendered by a browser (an error page
 * opened in a tab, a sniffed upload), it is inert.
 */
export const API_CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox";

/** Two years, the value of the HSTS preload list; subdomains of the API included. */
export const HSTS_VALUE = 'max-age=63072000; includeSubDomains';

/** Headers of every response (ADR 0031), helmet's set narrowed to a JSON API. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': API_CONTENT_SECURITY_POLICY,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  // Only no-cors loads (`<img>`, `<script>`) are refused; the web's CORS fetches are unaffected.
  'cross-origin-resource-policy': 'same-origin',
  'x-permitted-cross-domain-policies': 'none',
  'x-dns-prefetch-control': 'off',
  // The legacy XSS auditor is a source of bugs; CSP replaces it.
  'x-xss-protection': '0',
};

/** Headers that only advertise the stack. */
export const BANNER_HEADERS = ['x-powered-by', 'server'] as const;

export interface SecurityHeadersOptions {
  /** `Strict-Transport-Security`: production only (behind TLS). */
  hsts: boolean;
}

/**
 * Sets the security headers on a reply, before the handler runs, so errors,
 * 404s and preflights carry them too. `Cache-Control: no-store` is the
 * default: responses carry personal data and sessions; a route that is safe
 * to cache (`/openapi.json`) sets its own.
 */
export function createSecurityHeaders(options: SecurityHeadersOptions) {
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'cache-control': 'no-store',
    ...(options.hsts && { 'strict-transport-security': HSTS_VALUE }),
  };
  return {
    apply(reply: FastifyReply): void {
      void reply.headers(headers);
    },
    /** Removes the stack banners right before sending (`onSend`). */
    strip(reply: FastifyReply): void {
      for (const name of BANNER_HEADERS) void reply.removeHeader(name);
    },
  };
}
