import { recordTestSessionResults, type ValidationIssue } from '@sport-performance/contracts';
import type { ClubId } from '@sport-performance/domain';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import type { RequestPermissions } from '../http/permissions.js';
import {
  collectIssues,
  issue,
  readTestSession,
  readTestResultRow,
  sessionTarget,
  testResultDtos,
  throwIssues,
  type TestSessionRow,
} from './tests/model.js';
import { recordContext, recordResult } from './tests/record.js';

/**
 * The batch of results the staff records in the field on a test day
 * (B-320). Scheduling and running the day (its status, conditions and
 * evaluator) are the calendar endpoints (B-317, `routes/calendar`).
 */

async function authorizedSession(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  testSessionId: string,
  action: 'read' | 'manage',
): Promise<TestSessionRow> {
  const row = await readTestSession(db, clubId, testSessionId);
  if (row === undefined) throw new HttpError('not_found', 'Test day not found');
  await permissions.authorize('test_session', action, sessionTarget(row));
  return row;
}

export function registerTestSessionResultRoutes(app: FastifyInstance): void {
  registerEndpoint(app, recordTestSessionResults, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      // Role first: a role that never records gets 403, not the day's existence.
      await permissions.listScope('test_result', 'record');
      const session = await authorizedSession(
        db,
        permissions,
        clubId,
        params.testSessionId,
        'read',
      );
      const ctx = recordContext(db, permissions, clubId, caller.userId);
      const issues: ValidationIssue[] = [];
      const recorded: { id: string; replayed: boolean }[] = [];
      const seen = new Set<string>();
      for (const [index, input] of body.results.entries()) {
        const path = ['body', 'results', index];
        if (input.clientUuid !== undefined) {
          if (seen.has(input.clientUuid)) {
            issues.push(issue([...path, 'clientUuid'], 'Repeated clientUuid in the batch'));
            continue;
          }
          seen.add(input.clientUuid);
        }
        // Every result is checked, so the field staff fixes the whole batch at once.
        await collectIssues(issues, async () => {
          recorded.push(await recordResult(ctx, input, session, path));
        });
      }
      throwIssues(issues);
      const rows = [];
      for (const { id } of recorded) {
        const row = await readTestResultRow(db, clubId, id);
        if (row === undefined) throw new Error('recordTestSessionResults: result not readable');
        rows.push(row);
      }
      const dtos = await testResultDtos(db, clubId, rows);
      return {
        results: dtos.map((result, index) => ({
          result,
          replayed: recorded[index]?.replayed ?? false,
        })),
      };
    },
  });
}
