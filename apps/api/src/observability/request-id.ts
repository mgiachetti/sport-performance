import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * An incoming id is reused (so a proxy, the web or the worker can correlate)
 * only when it is short and made of safe characters; otherwise it could
 * inject content into logs or headers.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function isSafeRequestId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value);
}

/** `genReqId` of Fastify: the caller's `x-request-id` if safe, a new UUID otherwise. */
export function requestIdOf(request: IncomingMessage): string {
  const incoming = request.headers[REQUEST_ID_HEADER];
  return isSafeRequestId(incoming) ? incoming : randomUUID();
}
