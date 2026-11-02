import type { ErrorCode, ValidationIssue } from '../primitives/errors.js';

/**
 * The API answered with an error. `code` is the stable code to translate in
 * the UI; it may be a code this build does not know yet.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly operationId: string;
  readonly status: number;
  readonly code: ErrorCode | (string & {});
  readonly details: ValidationIssue[];
  readonly requestId: string | undefined;
  /**
   * Seconds to wait before retrying, from `Retry-After` (`429 rate_limited`
   * of a window limit). `undefined` when the server sent none: a burnt
   * sign-in code is `429` without it (request a new code instead of waiting).
   */
  readonly retryAfterS: number | undefined;

  constructor(args: {
    operationId: string;
    status: number;
    code: ErrorCode | (string & {});
    message: string;
    details?: ValidationIssue[] | undefined;
    requestId?: string | undefined;
    retryAfterS?: number | undefined;
  }) {
    super(args.message);
    this.operationId = args.operationId;
    this.status = args.status;
    this.code = args.code;
    this.details = args.details ?? [];
    this.requestId = args.requestId;
    this.retryAfterS = args.retryAfterS;
  }
}

/** The request never got a response (offline, DNS, CORS, aborted). */
export class ApiNetworkError extends Error {
  override readonly name = 'ApiNetworkError';
  readonly operationId: string;

  constructor(operationId: string, cause: unknown) {
    super(`Network error calling ${operationId}`, { cause });
    this.operationId = operationId;
  }

  /** True when the caller aborted the request through its `AbortSignal`. */
  get aborted(): boolean {
    return this.cause instanceof Error && this.cause.name === 'AbortError';
  }
}

/**
 * Something broke the contract: the input the caller passed is invalid
 * (`request`), or the server answered something the contract does not
 * describe (`response`), which signals client and server versions drifted.
 */
export class ApiContractError extends Error {
  override readonly name = 'ApiContractError';
  readonly operationId: string;
  readonly side: 'request' | 'response';
  readonly issues: ValidationIssue[];
  readonly status: number | undefined;

  constructor(args: {
    operationId: string;
    side: 'request' | 'response';
    message: string;
    issues?: ValidationIssue[];
    status?: number;
  }) {
    super(args.message);
    this.operationId = args.operationId;
    this.side = args.side;
    this.issues = args.issues ?? [];
    this.status = args.status;
  }
}
