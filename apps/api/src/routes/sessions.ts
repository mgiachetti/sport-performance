import {
  listMySessions,
  revokeMyOtherSessions,
  revokeMySession,
  type ActiveSession,
} from '@sport-performance/contracts';
import { session } from '@sport-performance/db/schema';
import type { FastifyInstance } from 'fastify';
import type { AuthModule } from '../auth/module.js';
import type { SessionRow } from '../auth/sessions.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';

function toDto(row: SessionRow, currentId: string): ActiveSession {
  return {
    id: row.id as ActiveSession['id'],
    clientType: row.clientType,
    device: { os: row.deviceOs, browser: row.deviceBrowser },
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastSeenAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    current: row.id === currentId,
  };
}

/** Sort keys of the list (ADR 0032): newest first by default. Session ids are UUIDs stored as text. */
const SESSION_KEYS: KeysetSpec<SessionRow, 'createdAt'> = {
  fields: {
    createdAt: { column: session.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: session.id, type: 'text', value: (row) => row.id },
};

/**
 * `/v1/me/sessions`: the user's live sessions on every device and closing
 * them (B-333, ADR 0033; ASVS V3.3.3, V3.3.4). Only the caller's own
 * sessions: every query is scoped by the user of the authenticated session.
 * The queries run on Better Auth's connection (`sport_performance_auth`),
 * outside the per-request transaction of the API's role.
 */
export function registerSessionRoutes(app: FastifyInstance, auth: AuthModule): void {
  registerEndpoint(app, listMySessions, {
    transaction: false,
    handler: async ({ query }, { auth: caller }) => {
      const plan = keysetPage(SESSION_KEYS, query, {});
      const rows = await auth.sessions.list(caller.userId, plan);
      return plan.page(rows, (row) => toDto(row, caller.session.id));
    },
  });

  registerEndpoint(app, revokeMySession, {
    transaction: false,
    handler: async ({ params }, { auth: caller, log }) => {
      if (params.sessionId === caller.session.id) {
        throw new HttpError('conflict', 'This is the current session: sign out instead');
      }
      if (!(await auth.sessions.revoke(caller.userId, params.sessionId))) {
        throw new HttpError('not_found', 'Session not found');
      }
      // Security event (ASVS V7): ids only, never the token (ADR 0016).
      log.info({ userId: caller.userId, revokedSessionId: params.sessionId }, 'session revoked');
      return undefined;
    },
  });

  registerEndpoint(app, revokeMyOtherSessions, {
    transaction: false,
    handler: async (_input, { auth: caller, log }) => {
      const revoked = await auth.sessions.revokeOthers(caller.userId, caller.session.id);
      log.info({ userId: caller.userId, revoked }, 'other sessions revoked');
      return { revoked };
    },
  });
}
