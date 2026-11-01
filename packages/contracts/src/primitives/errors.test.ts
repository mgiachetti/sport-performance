import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ERROR_CODES,
  ERROR_STATUS,
  apiError,
  errorCodeForStatus,
  errorEnvelopeReadSchema,
  errorEnvelopeSchema,
  errorStatus,
  toValidationIssues,
} from './errors.js';

describe('error catalog', () => {
  it('uses snake_case codes mapped to 4xx/5xx statuses', () => {
    for (const code of ERROR_CODES) {
      expect(code).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
      expect(errorStatus(code)).toBeGreaterThanOrEqual(400);
      expect(errorStatus(code)).toBeLessThan(600);
    }
  });

  it('maps statuses back to a code when there is no envelope', () => {
    expect(errorCodeForStatus(404)).toBe('not_found');
    expect(errorCodeForStatus(401)).toBe('unauthenticated');
    expect(errorCodeForStatus(400)).toBe('bad_request');
    expect(errorCodeForStatus(502)).toBe('service_unavailable');
    expect(errorCodeForStatus(504)).toBe('service_unavailable');
    expect(errorCodeForStatus(507)).toBe('internal_error');
    expect(errorCodeForStatus(418)).toBe('bad_request');
  });
});

describe('error envelope', () => {
  it('builds envelopes with their status', () => {
    const { status, body } = apiError('not_found', 'Club not found', { requestId: 'req-1' });
    expect(status).toBe(ERROR_STATUS.not_found);
    expect(body).toEqual({
      error: { code: 'not_found', message: 'Club not found', requestId: 'req-1' },
    });
    expect(errorEnvelopeSchema.parse(body)).toEqual(body);
  });

  it('carries validation details', () => {
    const schema = z.object({ weightKg: z.number().positive() });
    const result = schema.safeParse({ weightKg: -1 });
    expect(result.success).toBe(false);
    const details = toValidationIssues(result.error?.issues ?? [], ['body']);
    expect(details).toEqual([
      { path: ['body', 'weightKg'], code: 'too_small', message: expect.any(String) as string },
    ]);
    const { status, body } = apiError('validation_failed', 'Invalid body', { details });
    expect(status).toBe(400);
    expect(errorEnvelopeSchema.parse(body).error.details).toEqual(details);
  });

  it('rejects unknown codes in the strict schema but not in the read schema', () => {
    const future = { error: { code: 'consent_required', message: 'Needs consent' } };
    expect(errorEnvelopeSchema.safeParse(future).success).toBe(false);
    expect(errorEnvelopeReadSchema.parse(future).error.code).toBe('consent_required');
  });
});
