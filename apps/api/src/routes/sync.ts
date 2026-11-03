import { pullSyncChanges, pushSyncMutations } from '@sport-performance/contracts';
import {
  SYNC_COLLECTIONS,
  formatHlc,
  parseSyncCollection,
  serverHlc,
  type SyncCollection,
} from '@sport-performance/domain';
import type { FastifyInstance } from 'fastify';
import { registerEndpoint, transactionalRouteOf } from '../http/endpoint.js';
import { SYNC_ENDPOINTS } from '../sync/operations.js';
import {
  decodePullCursor,
  encodePullCursor,
  pullFingerprint,
  pullPage,
  pullScopes,
} from '../sync/pull.js';
import { databaseNowMs, pushMutations } from '../sync/push.js';

/**
 * Offline sync (B-323, ADR 0015, ADR 0050): the device pushes its queue of
 * mutations and pulls the changes since its cursor. Registered after the
 * routes whose handlers the push runs.
 */
export function registerSyncRoutes(app: FastifyInstance): void {
  // Fail at startup, not on the first push, if an operation's endpoint is not served.
  for (const endpoint of SYNC_ENDPOINTS) transactionalRouteOf(app, endpoint);

  registerEndpoint(app, pushSyncMutations, {
    transaction: true,
    handler: async ({ body }, ctx) => {
      const nowMs = await databaseNowMs(ctx.db);
      const results = await pushMutations({ ...ctx, app }, body.mutations, nowMs);
      return { serverHlc: formatHlc(serverHlc(await databaseNowMs(ctx.db))), results };
    },
  });

  registerEndpoint(app, pullSyncChanges, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const requested: SyncCollection[] =
        query.collections === undefined
          ? [...SYNC_COLLECTIONS]
          : [...new Set(query.collections.split(',').map((c) => parseSyncCollection(c)))];
      const subject = await permissions.subject();
      const scopes = pullScopes(subject, requested);
      const view = await pullFingerprint(db, subject, scopes);
      const { fingerprint } = view;
      const { at, reset } = decodePullCursor(query.cursor, clubId, fingerprint);
      const page = await pullPage(db, clubId, scopes, view, at, query.limit);
      return {
        items: page.items,
        cursor: encodePullCursor(clubId, fingerprint, page.at),
        hasMore: page.hasMore,
        reset,
        collections: SYNC_COLLECTIONS.filter((c) => scopes.has(c)),
        serverHlc: formatHlc(serverHlc(await databaseNowMs(db))),
      };
    },
  });
}
