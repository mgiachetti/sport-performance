import type { UsageClient, UsageSurface } from '@sport-performance/domain';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import type { TransactionClient } from '../db/database.js';
import { clientAppOf } from './app-version.js';

/**
 * First-party usage record (B-707, ADR 0093): when a route marked with a
 * surface is served, the API records the caller's use with
 * `app.record_usage`, in the request transaction (a read that rolls back
 * records nothing). The function takes the membership, the role and the day
 * from the validated context; the API only says which surface and which
 * client. A superadmin's support access is not recorded (the function skips it).
 *
 * The record never fails the request: it runs in a savepoint and, if it
 * fails, the savepoint is rolled back, the failure is logged without data
 * and the response goes on.
 */

/** `app` when the request comes from the mobile app (its client headers, ADR 0045). */
export function usageClientOf(request: FastifyRequest): UsageClient {
  try {
    return clientAppOf(request) === null ? 'web' : 'app';
  } catch {
    // Malformed client headers were already answered by the app version check.
    return 'web';
  }
}

const SAVEPOINT = 'usage_record';

export async function recordUsage(
  tx: TransactionClient,
  surface: UsageSurface,
  client: UsageClient,
  log: FastifyBaseLogger,
): Promise<void> {
  await tx.query(`savepoint ${SAVEPOINT}`);
  try {
    await tx.query('select app.record_usage($1, $2)', [surface, client]);
    await tx.query(`release savepoint ${SAVEPOINT}`);
  } catch (error) {
    await tx.query(`rollback to savepoint ${SAVEPOINT}`);
    log.warn(
      { surface, code: (error as { code?: unknown }).code },
      'usage record failed; the request goes on',
    );
  }
}
