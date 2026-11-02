import { z } from 'zod';

/**
 * Closed catalog of error codes and the HTTP status each one maps to.
 * Codes are stable API: clients translate them to UI text (`packages/i18n`),
 * so a code is never renamed or reused with another meaning. New codes may be
 * added; clients must tolerate codes they do not know yet.
 *
 * Rows of another tenant hidden by RLS are reported as `not_found`, never
 * `forbidden`, so the API does not leak whether they exist.
 */
export const ERROR_STATUS = {
  bad_request: 400,
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  /**
   * The player has no current consent of a type the operation needs (B-312,
   * ADR 0043): `details` lists the missing types (`path: ['consents', type]`)
   * so the UI can ask the holder to sign.
   */
  consent_required: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_STATUS;

export const ERROR_CODES = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]];

export const errorCodeSchema = z.enum(ERROR_CODES).meta({
  id: 'ErrorCode',
  description:
    'Código estable del error. La UI lo traduce; los clientes deben tolerar códigos nuevos.',
});

/** HTTP status for an error code. */
export function errorStatus(code: ErrorCode): number {
  return ERROR_STATUS[code];
}

/**
 * Best-effort code for a status when the response carries no envelope
 * (e.g. a proxy answering 502 with HTML).
 */
export function errorCodeForStatus(status: number): ErrorCode {
  const exact = ERROR_CODES.find((code) => ERROR_STATUS[code] === status);
  if (exact !== undefined) return exact;
  if (status >= 500)
    return status === 502 || status === 504 ? 'service_unavailable' : 'internal_error';
  return 'bad_request';
}

/** One problem found while validating a request (one per field). */
export const validationIssueSchema = z
  .object({
    path: z
      .array(z.union([z.string(), z.int().nonnegative()]))
      .meta({ description: 'Ruta al campo, p. ej. `["body", "weightKg"]`.' }),
    code: z.string().min(1).meta({ description: 'Código del problema (códigos de issue de zod).' }),
    message: z.string().meta({ description: 'Detalle para desarrolladores.' }),
  })
  .meta({ id: 'ValidationIssue' });

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const errorBodySchema = z
  .object({
    code: errorCodeSchema,
    message: z.string().meta({
      description: 'Detalle para desarrolladores; no se muestra al usuario.',
    }),
    requestId: z
      .string()
      .min(1)
      .optional()
      .meta({ description: 'Id del request, para cruzar con logs y Sentry.' }),
    details: z.array(validationIssueSchema).optional().meta({
      description:
        'Problemas por campo cuando `code` es `validation_failed`; los consentimientos que faltan (`["consents", tipo]`) cuando es `consent_required`.',
    }),
  })
  .meta({ id: 'ErrorBody' });

/** The single error shape every non-2xx response uses. */
export const errorEnvelopeSchema = z
  .object({ error: errorBodySchema })
  .meta({ id: 'ErrorEnvelope', description: 'Sobre único de error de la API.' });

export type ErrorBody = z.infer<typeof errorBodySchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * Lenient variant clients use to read errors: accepts codes this build does
 * not know yet, so an older mobile build keeps working when the API adds codes.
 */
export const errorEnvelopeReadSchema = z.object({
  error: errorBodySchema.extend({ code: z.string().min(1) }),
});

export interface ApiErrorOptions {
  requestId?: string;
  details?: ValidationIssue[];
}

/** Builds an error envelope and its status; used by the API to answer errors. */
export function apiError(
  code: ErrorCode,
  message: string,
  options: ApiErrorOptions = {},
): { status: number; body: ErrorEnvelope } {
  const body: ErrorBody = { code, message };
  if (options.requestId !== undefined) body.requestId = options.requestId;
  if (options.details !== undefined) body.details = options.details;
  return { status: errorStatus(code), body: { error: body } };
}

/** Maps zod issues to `ValidationIssue`s, prefixing where the input came from. */
export function toValidationIssues(
  issues: readonly z.core.$ZodIssue[],
  prefix: readonly (string | number)[] = [],
): ValidationIssue[] {
  return issues.map((issue) => ({
    path: [...prefix, ...issue.path].map((segment) =>
      typeof segment === 'number' ? segment : String(segment),
    ),
    code: issue.code,
    message: issue.message,
  }));
}
