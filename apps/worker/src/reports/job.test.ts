import { describe, expect, it } from 'vitest';
import { ReportFailure, reportFailureOf } from './job.js';

describe('player report failures (B-602)', () => {
  it('keeps the code of a known failure', () => {
    const failure = new ReportFailure('too_large', false);
    expect(reportFailureOf(failure)).toBe(failure);
  });

  it('records an unexpected error as internal, never as a layout failure', () => {
    const cause = new Error('connection terminated');
    const failure = reportFailureOf(cause);
    expect(failure).toMatchObject({ code: 'internal_error', retry: true });
    expect(failure.cause).toBe(cause);
  });
});
