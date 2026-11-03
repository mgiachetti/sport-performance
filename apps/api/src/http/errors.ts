import {
  apiError,
  errorCodeForStatus,
  type ErrorCode,
  type ValidationIssue,
} from '@sport-performance/contracts';
import { PermissionDeniedError, type ConsentType } from '@sport-performance/domain';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { SupportAccessError } from '../db/tenant-context.js';
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

/**
 * `details` of a `consent_required` error (B-312, ADR 0043): one entry per
 * missing consent type, so the UI can ask the holder to sign it.
 */
export function consentRequiredDetails(types: readonly ConsentType[]): ValidationIssue[] {
  return types.map((type) => ({
    path: ['consents', type],
    code: 'consent_required',
    message: `The player has no current ${type} consent`,
  }));
}

const GENERIC_MESSAGES: Partial<Record<ErrorCode, string>> = {
  internal_error: 'Internal server error',
  service_unavailable: 'Service unavailable',
};

/** The Postgres error behind a thrown value (Drizzle wraps the driver's in `cause`). */
export function databaseErrorOf(
  error: unknown,
): { code: string; constraint: string | undefined } | undefined {
  let candidate: unknown = error;
  for (let depth = 0; depth < 3 && candidate instanceof Error; depth += 1) {
    const { code, constraint } = candidate as { code?: unknown; constraint?: unknown };
    // SQLSTATE: five characters, digits and uppercase letters.
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return { code, constraint: typeof constraint === 'string' ? constraint : undefined };
    }
    candidate = candidate.cause;
  }
  return undefined;
}

/** Constraint the change history trigger raises without `app.change_reason` (ADR 0030). */
export const CHANGE_REASON_REQUIRED_CONSTRAINT = 'change_history_reason_required';

/**
 * Database errors that are the client's doing, as the envelope answers them
 * (ADR 0032). Messages are generic: the Postgres detail carries row values.
 * Anything else stays a server error.
 */
function classifyDatabaseError(error: unknown):
  | {
      code: ErrorCode;
      message: string;
      details?: ValidationIssue[];
      headers?: Readonly<Record<string, string>>;
    }
  | undefined {
  const found = databaseErrorOf(error);
  if (found === undefined) return undefined;
  switch (found.code) {
    case '23505':
      return { code: 'conflict', message: 'Another resource already has these unique values' };
    case '23P01':
      // An exclusion constraint: the row overlaps another one (seasons, testing windows).
      return { code: 'conflict', message: 'Another resource already takes these dates' };
    case '23503':
      return {
        code: 'validation_failed',
        message: 'The request references a resource that does not exist in this club',
      };
    case '23514':
      return found.constraint === CHANGE_REASON_REQUIRED_CONSTRAINT
        ? {
            code: 'validation_failed',
            message: 'Correcting a submitted value needs a reason',
            details: [
              {
                path: ['body', 'changeReason'],
                code: 'custom',
                message: 'Required to correct a submitted value (ADR 0030)',
              },
            ],
          }
        : undefined;
    case '40P01':
    case '40001':
      // A deadlock or a serialization failure: Postgres rolled the transaction back and the
      // same request succeeds when sent again (two offline pushes that lock the same rows in
      // another order, ADR 0050). Not a bug to report: a retryable 503.
      return {
        code: 'service_unavailable',
        message: 'The request ran into a concurrent one: send it again',
        headers: { 'retry-after': '1' },
      };
    case '55P03':
      // lock_not_available: a lock was not granted within the `lock_timeout` of the
      // transaction (another request holds it, ADR 0052). Rolled back; retryable.
      return {
        code: 'service_unavailable',
        message: 'The request waited too long for a concurrent one: send it again',
        headers: { 'retry-after': '5' },
      };
    case '42501':
      // A row-level policy or a guard of the database refused: the second line of defense.
      return { code: 'forbidden', message: 'The database policies do not allow this' };
    default:
      return undefined;
  }
}

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
  if (error instanceof PermissionDeniedError && error.reason === 'missing_consent') {
    // Only reached once the caller is in scope for the player (the evaluator checks the
    // scope first): the missing consent is what the holder has to sign (ADR 0043).
    return {
      code: 'consent_required',
      message: 'The player has no current consent of a type this needs',
      details: consentRequiredDetails(error.missingConsents),
      headers: {},
      unexpected: false,
    };
  }
  if (error instanceof PermissionDeniedError) {
    // The reason goes to the logs only (B-303): the client is not told which rule denied.
    return {
      code: 'forbidden',
      message: 'You are not allowed to do this',
      details: undefined,
      headers: {},
      unexpected: false,
    };
  }
  if (error instanceof SupportAccessError) {
    return {
      code: 'forbidden',
      message: 'The superadmin cannot support this club',
      details: undefined,
      headers: {},
      unexpected: false,
    };
  }
  const database = classifyDatabaseError(error);
  if (database !== undefined) {
    return {
      code: database.code,
      message: database.message,
      details: database.details,
      headers: database.headers ?? {},
      unexpected: false,
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
      // Client errors are expected: no stack, no message (it may echo input). Ids and
      // names of rules or constraints only, never values. A deadlock or a serialization
      // failure is retryable and not a bug (no Sentry), but it is lock contention worth
      // watching (two pushes on the same rows, ADR 0050): a warning, not an info.
      const sqlState = databaseErrorOf(error)?.code;
      const contention = sqlState === '40P01' || sqlState === '40001';
      request.log[contention ? 'warn' : 'info'](
        {
          code,
          ...(error instanceof PermissionDeniedError && {
            permission: { kind: error.kind, action: error.action, reason: error.reason },
          }),
          ...(databaseErrorOf(error) !== undefined && {
            sqlState: databaseErrorOf(error)?.code,
            constraint: databaseErrorOf(error)?.constraint,
          }),
        },
        contention ? 'request ran into a concurrent one' : 'request rejected',
      );
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
