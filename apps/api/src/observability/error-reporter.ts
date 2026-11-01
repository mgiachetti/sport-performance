/** What is attached to a reported error: ids only, never personal data (ADR 0016). */
export interface ErrorReportContext {
  requestId?: string | undefined;
  method?: string | undefined;
  /** Route pattern (`/v1/clubs/:clubSlug/theme`), not the concrete URL. */
  route?: string | undefined;
  userId?: string | undefined;
  clubId?: string | undefined;
  /** Where a non-request error came from (`uncaughtException`, ...). */
  source?: string | undefined;
}

/** Destination of unexpected errors (Sentry in production). */
export interface ErrorReporter {
  readonly enabled: boolean;
  capture(error: unknown, context?: ErrorReportContext): void;
  /** Sends what is queued; resolves `false` if `timeoutMs` passed first. */
  flush(timeoutMs: number): Promise<boolean>;
}

/** Used when `SENTRY_DSN` is unset. */
export const disabledErrorReporter: ErrorReporter = {
  enabled: false,
  capture() {
    // Disabled: the error is still logged by the error handler.
  },
  flush: () => Promise.resolve(true),
};
