import { pino, stdSerializers, type DestinationStream, type Logger } from 'pino';
import type { LogLevel } from '../config/env.js';

/**
 * Paths pino replaces with `[redacted]`. Defense in depth (ADR 0016): the
 * serializers below already keep headers and bodies out of the logs.
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  // node-postgres errors carry row values in `detail` (e.g. `Key (email)=(...)`).
  'err.detail',
  'err.where',
  'err.parameters',
  '*.password',
  '*.token',
  '*.email',
];

/** Path without the query string: query values may carry personal data. */
export function pathOf(url: string): string {
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}

interface RequestLike {
  method: string;
  url: string;
  routeOptions?: { url?: string | undefined };
}

interface ReplyLike {
  statusCode: number;
}

export interface LoggerOptions {
  level: LogLevel;
  version: string;
  environment: string;
  /** Where lines go; stdout by default. Tests pass a memory stream. */
  destination?: DestinationStream;
}

/**
 * JSON logger of the API. Each line of a request carries `requestId` (set
 * by Fastify through `requestIdLogLabel`). Logged request fields are method,
 * path and route pattern only: no query, IP, headers or body.
 */
export function createLogger(options: LoggerOptions): Logger {
  return pino(
    {
      level: options.level,
      base: { service: 'api', version: options.version, env: options.environment },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      serializers: {
        req: (request: RequestLike) => ({
          method: request.method,
          path: pathOf(request.url),
          route: request.routeOptions?.url,
        }),
        res: (reply: ReplyLike) => ({ statusCode: reply.statusCode }),
        err: stdSerializers.err,
      },
    },
    options.destination,
  );
}
