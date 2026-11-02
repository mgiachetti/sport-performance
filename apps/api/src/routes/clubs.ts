import {
  archiveClubBranch,
  createClub,
  enableClubBranch,
  getClub,
  getClubTheme,
  listClubBranches,
  listClubs,
  restoreClubBranch,
  updateClub,
  type Club,
  type ClubBranch,
  type ClubTheme,
} from '@sport-performance/contracts';
import { category, club, clubBranch } from '@sport-performance/db/schema';
import { bootstrapClub } from '@sport-performance/db/seeds';
import { parseClubId, type ClubId, type Sex, type Sport } from '@sport-performance/domain';
import { createTheme, normalizeHex } from '@sport-performance/ui-tokens';
import { and, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, likePattern, type KeysetSpec } from '../http/pagination.js';
import {
  archiveStatusFilter,
  insertIdempotent,
  markReplay,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';

/**
 * Clubs (B-313): the registry of the superadmin, the profile and brand of
 * the club the request acts in, its public theme and its branches.
 */

const clubColumns = {
  id: club.id,
  slug: club.slug,
  name: club.name,
  shortName: club.shortName,
  timeZone: club.timeZone,
  locale: club.locale,
  primaryColor: club.primaryColor,
  secondaryColor: club.secondaryColor,
  logoFileId: club.logoFileId,
  createdAt: club.createdAt,
  updatedAt: club.updatedAt,
  version: rowVersion(club.updatedAt),
};

interface ClubRow {
  id: ClubId;
  slug: string;
  name: string;
  shortName: string;
  timeZone: Club['timeZone'];
  locale: string;
  primaryColor: string;
  secondaryColor: string;
  logoFileId: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function clubDto(row: ClubRow): Club {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortName: row.shortName,
    timeZone: row.timeZone,
    locale: row.locale as Club['locale'],
    colors: { primary: row.primaryColor, secondary: row.secondaryColor },
    logoFileId: (row.logoFileId ?? null) as Club['logoFileId'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const branchColumns = {
  id: clubBranch.id,
  sport: clubBranch.sport,
  sex: clubBranch.sex,
  archivedAt: clubBranch.archivedAt,
  createdAt: clubBranch.createdAt,
  updatedAt: clubBranch.updatedAt,
  version: rowVersion(clubBranch.updatedAt),
};

interface BranchRow {
  id: string;
  sport: Sport;
  sex: Sex;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function branchDto(row: BranchRow): ClubBranch {
  return {
    id: row.id as ClubBranch['id'],
    sport: row.sport,
    sex: row.sex,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const CLUB_KEYS: KeysetSpec<ClubRow, 'name' | 'createdAt'> = {
  fields: {
    name: { column: club.name, type: 'text', value: (row) => row.name },
    createdAt: { column: club.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: club.id, value: (row) => row.id },
};

const BRANCH_KEYS: KeysetSpec<BranchRow, 'sport' | 'createdAt'> = {
  fields: {
    // Enum order is declaration order; the text sorts the same for every client.
    sport: { column: sql`${clubBranch.sport}::text`, type: 'text', value: (row) => row.sport },
    createdAt: { column: clubBranch.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: clubBranch.id, value: (row) => row.id },
};

async function readClub(db: TenantDatabase, clubId: ClubId): Promise<ClubRow> {
  const [row] = await db.select(clubColumns).from(club).where(eq(club.id, clubId));
  if (row === undefined) throw new HttpError('not_found', 'Club not found');
  return row;
}

async function readBranch(
  db: TenantDatabase,
  clubId: ClubId,
  branchId: string,
): Promise<BranchRow> {
  const [row] = await db
    .select(branchColumns)
    .from(clubBranch)
    .where(and(eq(clubBranch.clubId, clubId), eq(clubBranch.id, branchId)));
  if (row === undefined) throw new HttpError('not_found', 'Branch not found');
  return row;
}

/** Ink candidates and contrast come from `ui-tokens`, the same the web and the app apply. */
function themeColors(primary: string, secondary: string): ClubTheme['colors'] {
  const theme = createTheme({ brand: { primary, secondary } });
  return {
    primary: theme.color.brand.solid,
    onPrimary: theme.color.brand.onSolid,
    secondary: theme.color.brand.secondary,
    onSecondary: theme.color.brand.onSecondary,
  };
}

/** Public theme responses may be cached briefly: the brand changes rarely and is not personal. */
const THEME_CACHE_CONTROL = 'public, max-age=300';

interface ClubThemeRow extends Record<string, unknown> {
  id: string;
  slug: string;
  name: string;
  short_name: string;
  primary_color: string;
  secondary_color: string;
  logo_file_id: string | null;
  updated_at: Date | string;
}

export function registerClubRoutes(app: FastifyInstance): void {
  registerEndpoint(app, getClubTheme, {
    transaction: true,
    handler: async ({ params }, { db, reply }) => {
      // Before login: `app.club_theme` (SECURITY DEFINER) serves only the brand by slug.
      const { rows } = await db.execute<ClubThemeRow>(
        sql`select * from app.club_theme(${params.clubSlug})`,
      );
      const row = rows[0];
      if (row === undefined) throw new HttpError('not_found', 'Club not found');
      void reply.header('cache-control', THEME_CACHE_CONTROL);
      return {
        clubId: parseClubId(row.id),
        slug: row.slug,
        name: row.name,
        shortName: row.short_name,
        // Uploaded crests are served by the files module (#56); until then, none.
        logoUrl: null,
        colors: themeColors(row.primary_color, row.secondary_color),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    },
  });

  registerEndpoint(app, listClubs, {
    transaction: true,
    scope: 'registry',
    handler: async ({ query }, { db, permissions }) => {
      await permissions.authorize('club_registry', 'read');
      const plan = keysetPage(CLUB_KEYS, query, { q: query.q });
      const search =
        query.q === undefined
          ? undefined
          : or(ilike(club.name, likePattern(query.q)), ilike(club.slug, likePattern(query.q)));
      const rows = await db
        .select(clubColumns)
        .from(club)
        .where(and(search, plan.where))
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, clubDto);
    },
  });

  registerEndpoint(app, createClub, {
    transaction: true,
    scope: 'registry',
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('club_registry', 'create');
      const { row, replayed } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(club)
              .values({
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                slug: body.slug,
                name: body.name,
                shortName: body.shortName,
                timeZone: body.timeZone,
                locale: body.locale,
                ...(body.colors !== undefined && {
                  primaryColor: normalizeHex(body.colors.primary),
                  secondaryColor: normalizeHex(body.colors.secondary),
                }),
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: club.clientUuid })
              .returning({ id: club.id })
          )[0],
        findByClientUuid: async (clientUuid) =>
          (await db.select({ id: club.id }).from(club).where(eq(club.clientUuid, clientUuid)))[0],
      });
      const clubId = row.id;
      if (replayed) {
        // The club exists: act in it (as the bootstrap does) to read it back, nothing else.
        await enterCreatedClub(db, clubId, caller.supportReason);
      } else {
        // Seeds the default configuration in this same transaction (ADR 0027): the club and
        // its configuration exist together or not at all. From here on the context's club
        // is the new one, with the superadmin's support access to it recorded.
        await bootstrapClub(db, { clubId, branches: body.branches });
      }
      const branches = await db
        .select(branchColumns)
        .from(clubBranch)
        .where(eq(clubBranch.clubId, clubId))
        .orderBy(sql`${clubBranch.sport}::text`, clubBranch.sex, clubBranch.id);
      return { club: clubDto(await readClub(db, clubId)), branches: branches.map(branchDto) };
    },
  });

  registerEndpoint(app, getClub, {
    transaction: true,
    handler: async (_input, { db, permissions, auth: caller }) => {
      await permissions.authorize('club', 'read');
      return clubDto(await readClub(db, caller.membership.clubId));
    },
  });

  registerEndpoint(app, updateClub, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('club', 'update');
      const { clubId, role } = caller.membership;
      if (body.slug !== undefined && role !== 'superadmin') {
        // Also refused by the database (club_slug_guard): it breaks links and deep links.
        throw new HttpError('forbidden', 'Only a superadmin changes the slug of a club');
      }
      const row = await updateAtVersion({
        resource: 'Club',
        update: async () =>
          (
            await db
              .update(club)
              .set({
                ...(body.slug !== undefined && { slug: body.slug }),
                ...(body.name !== undefined && { name: body.name }),
                ...(body.shortName !== undefined && { shortName: body.shortName }),
                ...(body.timeZone !== undefined && { timeZone: body.timeZone }),
                ...(body.locale !== undefined && { locale: body.locale }),
                ...(body.colors?.primary !== undefined && {
                  primaryColor: normalizeHex(body.colors.primary),
                }),
                ...(body.colors?.secondary !== undefined && {
                  secondaryColor: normalizeHex(body.colors.secondary),
                }),
                ...(body.logoFileId !== undefined && { logoFileId: body.logoFileId }),
                updatedBy: caller.userId,
              })
              .where(and(eq(club.id, clubId), versionMatches(club.updatedAt, body.version)))
              .returning(clubColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: club.id }).from(club).where(eq(club.id, clubId))).length > 0,
      });
      return clubDto(row);
    },
  });

  registerEndpoint(app, listClubBranches, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('club', 'read');
      const plan = keysetPage(BRANCH_KEYS, query, { status: query.status });
      const rows = await db
        .select(branchColumns)
        .from(clubBranch)
        .where(
          and(
            eq(clubBranch.clubId, caller.membership.clubId),
            archiveStatusFilter(clubBranch.archivedAt, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, branchDto);
    },
  });

  registerEndpoint(app, enableClubBranch, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('club', 'update');
      const { clubId } = caller.membership;
      // One enable at a time per club: the natural key check and the seeding do not race.
      await db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`club_branch:${clubId}`}, 0))`,
      );
      if (body.clientUuid !== undefined) {
        const [replay] = await db
          .select(branchColumns)
          .from(clubBranch)
          .where(and(eq(clubBranch.clubId, clubId), eq(clubBranch.clientUuid, body.clientUuid)));
        if (replay !== undefined) {
          markReplay(reply);
          return branchDto(replay);
        }
      }
      const [existing] = await db
        .select(branchColumns)
        .from(clubBranch)
        .where(
          and(
            eq(clubBranch.clubId, clubId),
            eq(clubBranch.sport, body.sport),
            eq(clubBranch.sex, body.sex),
          ),
        );
      if (existing !== undefined && existing.archivedAt !== null) {
        throw new HttpError('conflict', 'The branch is archived: restore it instead');
      }
      if (existing !== undefined) {
        markReplay(reply);
        return branchDto(existing);
      }
      await db.insert(clubBranch).values({
        clubId,
        sport: body.sport,
        sex: body.sex,
        ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
        createdBy: caller.userId,
        updatedBy: caller.userId,
      });
      // Positions of the sport, categories M13 to M19 and the battery of the branch.
      await bootstrapClub(db, { clubId, branches: [{ sport: body.sport, sex: body.sex }] });
      const [created] = await db
        .select(branchColumns)
        .from(clubBranch)
        .where(
          and(
            eq(clubBranch.clubId, clubId),
            eq(clubBranch.sport, body.sport),
            eq(clubBranch.sex, body.sex),
          ),
        );
      if (created === undefined) throw new Error('enableClubBranch: the branch is not visible');
      return branchDto(created);
    },
  });

  registerEndpoint(app, archiveClubBranch, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('club', 'update');
      const { clubId } = caller.membership;
      const branch = await readBranch(db, clubId, params.branchId);
      if (branch.archivedAt !== null) return branchDto(branch);
      await db
        .update(clubBranch)
        .set({ archivedAt: sql`now()`, updatedBy: caller.userId })
        .where(and(eq(clubBranch.clubId, clubId), eq(clubBranch.id, params.branchId)));
      // Its categories go with it; restoring the branch does not bring them back.
      await db
        .update(category)
        .set({ archivedAt: sql`now()`, updatedBy: caller.userId })
        .where(
          and(
            eq(category.clubId, clubId),
            eq(category.sport, branch.sport),
            eq(category.sex, branch.sex),
            isNull(category.archivedAt),
          ),
        );
      return branchDto(await readBranch(db, clubId, params.branchId));
    },
  });

  registerEndpoint(app, restoreClubBranch, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('club', 'update');
      const { clubId } = caller.membership;
      const branch = await readBranch(db, clubId, params.branchId);
      if (branch.archivedAt === null) return branchDto(branch);
      await db
        .update(clubBranch)
        .set({ archivedAt: null, updatedBy: caller.userId })
        .where(and(eq(clubBranch.clubId, clubId), eq(clubBranch.id, params.branchId)));
      return branchDto(await readBranch(db, clubId, params.branchId));
    },
  });
}

/**
 * Moves the registry transaction into a club it just found (a replayed
 * `createClub`): `app.club_id` and the superadmin's support access to it,
 * like `bootstrapClub` does for a new one (ADR 0029).
 */
async function enterCreatedClub(
  db: TenantDatabase,
  clubId: ClubId,
  reason: string | null,
): Promise<void> {
  if (reason === null) throw new HttpError('forbidden', 'A superadmin acts only with a reason');
  await db.execute(sql`select set_config('app.club_id', ${clubId}, true)`);
  await db.execute(sql`select app.begin_support_access(${reason})`);
}
