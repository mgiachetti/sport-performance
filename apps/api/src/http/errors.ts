import {
  apiError,
  errorCodeForStatus,
  type ErrorCode,
  type ValidationIssue,
} from '@sport-performance/contracts';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorReporter } from '../observability/error-reporter.js';
import { pathOf } from '../observability/logger.js';

/**
 * An error the API answers on purpose, with a code of the contract catalog.
 * Handlers throw it (`throw new HttpError('not_found', 'Club not found')`);
 * the error handler turns it into the envelope. `message` is for developers.
 */
export class HttpError extends Error {
  override readonly name = 'HttpError';
  readonly code: ErrorCode;
  readonly details: ValidationIssue[] | undefined;
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      details?: ValidationIssue[];
      headers?: Record<string, string>;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.details = options.details;
    this.headers = options.headers ?? {};
  }
}

const GENERIC_MESSAGES: Partial<Record<ErrorCode, string>> = {
  internal_error: 'Internal server error',
  service_unavailable: 'Service unavailable',
};

/** Status of a client error raised by Fastify (bad JSON, body too large...), if any. */
function clientErrorStatus(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const status = (error as Partial<FastifyError>).statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

/** Answers an error with the envelope of the contract. */
export function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
  details?: ValidationIssue[],
): FastifyReply {
  const { status, body } = apiError(code, message, {
    requestId: request.id,
    ...(details !== undefined && { details }),
  });
  return reply.code(status).type('application/json; charset=utf-8').send(body);
}

/**
 * Classifies any thrown value. Client errors keep their message (Fastify's
 * are generic, e.g. "Body is not valid JSON"). Server errors answer a
 * generic message: internals never reach the client.
 */
export function classifyError(error: unknown): {
  code: ErrorCode;
  message: string;
  details: ValidationIssue[] | undefined;
  headers: Readonly<Record<string, string>>;
  unexpected: boolean;
} {
  if (error instanceof HttpError) {
    const unexpected = error.code === 'internal_error';
    return {
      code: error.code,
      message: unexpected ? (GENERIC_MESSAGES.internal_error ?? '') : error.message,
      details: error.details,
      headers: error.headers,
      unexpected,
    };
  }
  const clientStatus = clientErrorStatus(error);
  if (error instanceof Error && clientStatus !== undefined) {
    return {
      code: errorCodeForStatus(clientStatus),
      message: error.message,
      details: undefined,
      headers: {},
      unexpected: false,
    };
  }
  return {
    code: 'internal_error',
    message: GENERIC_MESSAGES.internal_error ?? '',
    details: undefined,
    headers: {},
    unexpected: true,
  };
}

/** `setErrorHandler` of the app: envelope, logs and Sentry for 5xx. */
export function createErrorHandler(reporter: ErrorReporter) {
  return function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply) {
    const { code, message, details, headers, unexpected } = classifyError(error);
    if (unexpected) {
      request.log.error({ err: error }, 'unexpected error');
      reporter.capture(error, {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url,
        userId: request.auth?.userId,
        clubId: request.auth?.membership?.clubId,
      });
    } else {
      // Client errors are expected: no stack, no message (it may echo input).
      request.log.info({ code }, 'request rejected');
    }
    for (const [name, value] of Object.entries(headers)) void reply.header(name, value);
    return sendError(request, reply, code, message, details);
  };
}

/** `setNotFoundHandler` of the app. */
export function notFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  return sendError(
    request,
    reply,
    'not_found',
    `Route ${request.method} ${pathOf(request.url)} not found`,
  );
}
