import type { FastifyRequest } from 'fastify';
import { HttpError } from '../http/errors.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defense for the web session cookie (ADR 0028). The cookie is
 * `SameSite=Lax` and every body is JSON (a cross-site form cannot send it
 * without a CORS preflight that only the web origins pass); on top of that,
 * a state-changing request that carries cookies and an `Origin` header must
 * come from the web app or the API itself. Requests without cookies (mobile
 * with a bearer token, servers) are not affected: they cannot be forged by
 * a browser on someone else's behalf.
 */
export function createOriginGuard(trustedOrigins: Iterable<string>) {
  const trusted = new Set(trustedOrigins);
  return function guardOrigin(request: FastifyRequest): void {
    if (!UNSAFE_METHODS.has(request.method)) return;
    if (request.headers.cookie === undefined) return;
    const origin = request.headers.origin;
    if (origin === undefined) return;
    if (!trusted.has(origin)) {
      throw new HttpError(
        'forbidden',
        'Cross-origin request with cookies from an untrusted origin',
      );
    }
  };
}
