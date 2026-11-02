import {
  listMySessions,
  revokeMyOtherSessions,
  revokeMySession,
  type ActiveSession,
} from '@sport-performance/contracts';
import { isUuid } from '@sport-performance/domain';
import type { FastifyInstance } from 'fastify';
import type { AuthModule } from '../auth/module.js';
import type { SessionCursor, SessionRow } from '../auth/sessions.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';

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

/** Opaque cursor: the sort key (`created_at`, `id`) of the last item, base64url JSON. */
function encodeCursor(row: SessionRow): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString('base64url');
}

function decodeCursor(cursor: string): SessionCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [createdAt, id] = parsed as unknown[];
      const date = typeof createdAt === 'string' ? new Date(createdAt) : new Date(Number.NaN);
      if (!Number.isNaN(date.getTime()) && isUuid(id)) return { createdAt: date, id };
    }
  } catch {
    // Falls through to the error below.
  }
  throw new HttpError('bad_request', 'Invalid cursor');
}

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
      const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
      const rows = await auth.sessions.list(caller.userId, { limit: query.limit + 1, after });
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => toDto(row, caller.session.id)),
        nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
      };
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
