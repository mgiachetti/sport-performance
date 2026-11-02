import { getClubModules, updateClubModules } from '@sport-performance/contracts';
import { club } from '@sport-performance/db/schema';
import { applyClubModuleChanges, resolveClubModules, type ClubId } from '@sport-performance/domain';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { rowVersion, updateAtVersion, versionMatches } from '../http/writes.js';

/**
 * Active modules of the club (B-322): `club.settings.modules`, resolved over
 * the domain's defaults. Read by every member (the web and the app show or
 * hide areas with it); changed by the administration, like the club profile
 * (the `club` row is the administration's under RLS too).
 */

const settingsColumns = { settings: club.settings, version: rowVersion(club.updatedAt) };

async function readSettings(db: TenantDatabase, clubId: ClubId) {
  const [row] = await db.select(settingsColumns).from(club).where(eq(club.id, clubId));
  if (row === undefined) throw new HttpError('not_found', 'Club not found');
  return row;
}

export function registerModuleRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getClubModules, {
    transaction: true,
    handler: async (_input, { db, permissions, auth: caller }) => {
      await permissions.authorize('club', 'read');
      const row = await readSettings(db, caller.membership.clubId);
      return { modules: resolveClubModules(row.settings.modules), version: row.version };
    },
  });

  registerEndpoint(app, updateClubModules, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('club', 'update');
      const { clubId } = caller.membership;
      const current = await readSettings(db, clubId);
      const modules = applyClubModuleChanges(current.settings.modules, body.modules);
      const row = await updateAtVersion({
        resource: 'Club',
        update: async () =>
          (
            await db
              .update(club)
              .set({ settings: { ...current.settings, modules }, updatedBy: caller.userId })
              .where(and(eq(club.id, clubId), versionMatches(club.updatedAt, body.version)))
              .returning(settingsColumns)
          )[0],
        exists: () => Promise.resolve(true),
      });
      return { modules: resolveClubModules(row.settings.modules), version: row.version };
    },
  });
}
