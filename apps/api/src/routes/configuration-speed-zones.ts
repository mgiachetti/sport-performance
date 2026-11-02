import {
  archiveSpeedZoneConfig,
  createSpeedZoneConfig,
  getEffectiveSpeedZones,
  getSpeedZoneConfig,
  listSpeedZoneConfigs,
  restoreSpeedZoneConfig,
  updateSpeedZoneConfig,
  type SpeedZoneConfigDto,
} from '@sport-performance/contracts';
import { speedZoneConfig } from '@sport-performance/db/schema';
import {
  DEFAULT_SPEED_ZONE_SETS,
  DomainValidationError,
  findSpeedZoneConfigConflicts,
  resolveSpeedZoneConfig,
  validateSpeedZoneSet,
  type ClubId,
  type LocalDate,
  type PlayerId,
  type Sex,
  type Sport,
  type SpeedZoneConfig,
  type SpeedZoneKind,
  type SpeedZoneSet,
} from '@sport-performance/domain';
import { and, eq, gt, isNotNull, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import {
  archiveStatusFilter,
  insertIdempotent,
  markReplay,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';
import {
  assertValidRange,
  authorizedPlayer,
  clubToday,
  lockConfiguration,
  plannedValidity,
  rowsToClose,
  validationError,
  validityPhase,
  visiblePlayerRows,
} from './configuration-shared.js';

/**
 * Speed zones of the club (B-209, B-322): every zone set is validated by the
 * domain (`validateSpeedZoneSet`), overlaps are found with
 * `findSpeedZoneConfigConflicts` and the zones in force come from
 * `resolveSpeedZoneConfig`, with the seeded defaults as fallback.
 */

/** Stands for "no player" in a domain query once the player rows are filtered out. */
const NO_PLAYER = '00000000-0000-4000-8000-000000000000' as PlayerId;

const zoneColumns = {
  id: speedZoneConfig.id,
  clubId: speedZoneConfig.clubId,
  kind: speedZoneConfig.kind,
  sport: speedZoneConfig.sport,
  sex: speedZoneConfig.sex,
  playerId: speedZoneConfig.playerId,
  zoneSet: speedZoneConfig.zoneSet,
  validFrom: speedZoneConfig.validFrom,
  validTo: speedZoneConfig.validTo,
  archivedAt: speedZoneConfig.archivedAt,
  createdAt: speedZoneConfig.createdAt,
  updatedAt: speedZoneConfig.updatedAt,
  version: rowVersion(speedZoneConfig.updatedAt),
};

interface ZoneRow {
  id: string;
  clubId: ClubId;
  kind: SpeedZoneKind;
  sport: Sport | null;
  sex: Sex | null;
  playerId: PlayerId | null;
  zoneSet: SpeedZoneSet;
  validFrom: LocalDate;
  validTo: LocalDate | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

type ZoneRowConfig = SpeedZoneConfig & { readonly row: ZoneRow };

function toConfig(row: ZoneRow): ZoneRowConfig {
  return {
    clubId: row.clubId,
    sport: row.sport,
    sex: row.sex,
    playerId: row.playerId,
    validFrom: row.validFrom,
    validTo: row.validTo,
    zoneSet: row.zoneSet,
    row,
  };
}

function zoneDto(row: ZoneRow): SpeedZoneConfigDto {
  return {
    id: row.id as SpeedZoneConfigDto['id'],
    kind: row.kind,
    sport: row.sport,
    sex: row.sex,
    playerId: row.playerId,
    zoneSet: row.zoneSet as SpeedZoneConfigDto['zoneSet'],
    validFrom: row.validFrom,
    validTo: row.validTo,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const ZONE_KEYS: KeysetSpec<ZoneRow, 'validFrom' | 'createdAt'> = {
  fields: {
    validFrom: {
      column: sql`${speedZoneConfig.validFrom}::text`,
      type: 'text',
      value: (row) => row.validFrom,
    },
    createdAt: {
      column: speedZoneConfig.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
  },
  id: { column: speedZoneConfig.id, value: (row) => row.id },
};

function validOn(onDate: LocalDate | undefined): SQL | undefined {
  if (onDate === undefined) return undefined;
  return and(
    lte(speedZoneConfig.validFrom, onDate),
    or(isNull(speedZoneConfig.validTo), gt(speedZoneConfig.validTo, onDate)),
  );
}

/** The zone set, validated by the domain; its problems are `400` on `body.zoneSet`. */
function checkedZoneSet(zoneSet: SpeedZoneSet): SpeedZoneSet {
  try {
    validateSpeedZoneSet(zoneSet);
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw validationError(error.message, ['body', 'zoneSet'], error.message);
    }
    throw error;
  }
  return zoneSet;
}

async function readZone(db: TenantDatabase, clubId: ClubId, id: string): Promise<ZoneRow> {
  const [row] = await db
    .select(zoneColumns)
    .from(speedZoneConfig)
    .where(and(eq(speedZoneConfig.clubId, clubId), eq(speedZoneConfig.id, id)));
  if (row === undefined) throw new HttpError('not_found', 'Speed zone configuration not found');
  return row;
}

/** Reads one configuration and checks the caller may `action` it (and see its player). */
async function authorizedZone(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  id: string,
  action: 'read' | 'update',
): Promise<ZoneRow> {
  await permissions.authorize('configuration', action);
  const row = await readZone(db, clubId, id);
  if (row.playerId !== null) await authorizedPlayer(db, permissions, clubId, row.playerId);
  return row;
}

async function sameScopeConfigs(
  db: TenantDatabase,
  clubId: ClubId,
  scope: SpeedZoneConfig,
  excludeId: string | null,
): Promise<ZoneRowConfig[]> {
  const rows = await db
    .select(zoneColumns)
    .from(speedZoneConfig)
    .where(
      and(
        eq(speedZoneConfig.clubId, clubId),
        eq(speedZoneConfig.kind, scope.zoneSet.kind),
        scope.sport === null
          ? isNull(speedZoneConfig.sport)
          : eq(speedZoneConfig.sport, scope.sport),
        scope.sex === null ? isNull(speedZoneConfig.sex) : eq(speedZoneConfig.sex, scope.sex),
        scope.playerId === null
          ? isNull(speedZoneConfig.playerId)
          : eq(speedZoneConfig.playerId, scope.playerId),
        isNull(speedZoneConfig.archivedAt),
        excludeId === null ? undefined : ne(speedZoneConfig.id, excludeId),
      ),
    );
  return rows.map(toConfig);
}

function conflictsWith(candidate: SpeedZoneConfig, others: readonly ZoneRowConfig[]) {
  return findSpeedZoneConfigConflicts<SpeedZoneConfig>([candidate, ...others])
    .filter(([a, b]) => a === candidate || b === candidate)
    .map(([a, b]) => (a === candidate ? b : a) as ZoneRowConfig);
}

const OVERLAP = 'Another speed zone configuration with the same scope is valid on overlapping days';

export function registerSpeedZoneRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listSpeedZoneConfigs, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'read');
      const plan = keysetPage(ZONE_KEYS, query, {
        kind: query.kind,
        sport: query.sport,
        sex: query.sex,
        playerId: query.playerId,
        scope: query.scope,
        validOn: query.validOn,
        status: query.status,
      });
      const rows = await db
        .select(zoneColumns)
        .from(speedZoneConfig)
        .where(
          and(
            eq(speedZoneConfig.clubId, caller.membership.clubId),
            visiblePlayerRows(speedZoneConfig.playerId),
            query.kind === undefined ? undefined : eq(speedZoneConfig.kind, query.kind),
            query.sport === undefined ? undefined : eq(speedZoneConfig.sport, query.sport),
            query.sex === undefined ? undefined : eq(speedZoneConfig.sex, query.sex),
            query.playerId === undefined ? undefined : eq(speedZoneConfig.playerId, query.playerId),
            query.scope === undefined
              ? undefined
              : query.scope === 'group'
                ? isNull(speedZoneConfig.playerId)
                : isNotNull(speedZoneConfig.playerId),
            validOn(query.validOn),
            archiveStatusFilter(speedZoneConfig.archivedAt, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, zoneDto);
    },
  });

  registerEndpoint(app, getEffectiveSpeedZones, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'read');
      const { clubId } = caller.membership;
      const playerId = query.playerId ?? null;
      if (playerId !== null) {
        const scope = await authorizedPlayer(db, permissions, clubId, playerId);
        if (scope.sex !== query.sex) {
          throw validationError('The player is of the other sex', ['query', 'sex']);
        }
      }
      const onDate = query.onDate ?? (await clubToday(db));
      const rows = await db
        .select(zoneColumns)
        .from(speedZoneConfig)
        .where(
          and(
            eq(speedZoneConfig.clubId, clubId),
            eq(speedZoneConfig.kind, query.kind),
            playerId === null
              ? isNull(speedZoneConfig.playerId)
              : or(isNull(speedZoneConfig.playerId), eq(speedZoneConfig.playerId, playerId)),
            isNull(speedZoneConfig.archivedAt),
            validOn(onDate),
          ),
        );
      const resolved = resolveSpeedZoneConfig(rows.map(toConfig), {
        clubId,
        sport: query.sport,
        sex: query.sex,
        playerId: playerId ?? NO_PLAYER,
        onDate,
        kind: query.kind,
      });
      return {
        kind: query.kind,
        onDate,
        source: resolved === null ? ('default' as const) : ('club' as const),
        config: resolved === null ? null : zoneDto(resolved.row),
        zoneSet: (resolved?.zoneSet ??
          DEFAULT_SPEED_ZONE_SETS[query.kind]) as SpeedZoneConfigDto['zoneSet'],
      };
    },
  });

  registerEndpoint(app, getSpeedZoneConfig, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) =>
      zoneDto(
        await authorizedZone(
          db,
          permissions,
          caller.membership.clubId,
          params.speedZoneConfigId,
          'read',
        ),
      ),
  });

  registerEndpoint(app, createSpeedZoneConfig, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      await lockConfiguration(db, 'speed_zone_config', clubId);
      if (body.clientUuid !== undefined) {
        const [replay] = await db
          .select(zoneColumns)
          .from(speedZoneConfig)
          .where(
            and(
              eq(speedZoneConfig.clubId, clubId),
              eq(speedZoneConfig.clientUuid, body.clientUuid),
            ),
          );
        if (replay !== undefined) {
          if (replay.playerId !== null) {
            await authorizedPlayer(db, permissions, clubId, replay.playerId);
          }
          markReplay(reply);
          return zoneDto(replay);
        }
      }
      const playerId = body.playerId ?? null;
      const sex = body.sex ?? null;
      if (playerId !== null) {
        const scope = await authorizedPlayer(db, permissions, clubId, playerId);
        if (sex !== null && sex !== scope.sex) {
          throw validationError('The player is of the other sex', ['body', 'sex']);
        }
      }
      const today = await clubToday(db);
      const validFrom = body.validFrom ?? today;
      const validTo = body.validTo ?? null;
      assertValidRange(validFrom, validTo);
      const zoneSet = checkedZoneSet(body.zoneSet);
      const candidate: SpeedZoneConfig = {
        clubId,
        sport: body.sport ?? null,
        sex,
        playerId,
        validFrom,
        validTo,
        zoneSet,
      };
      const toClose = rowsToClose({
        conflicts: conflictsWith(candidate, await sameScopeConfigs(db, clubId, candidate, null)),
        closePrevious: body.closePrevious ?? false,
        validFrom,
        today,
        resource: 'speed zone configuration',
      });
      for (const previous of toClose) {
        await db
          .update(speedZoneConfig)
          .set({ validTo: validFrom, updatedBy: caller.userId })
          .where(and(eq(speedZoneConfig.clubId, clubId), eq(speedZoneConfig.id, previous.row.id)));
      }
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(speedZoneConfig)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                kind: zoneSet.kind,
                sport: candidate.sport,
                sex: candidate.sex,
                playerId: candidate.playerId,
                zoneSet,
                validFrom,
                validTo,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [speedZoneConfig.clubId, speedZoneConfig.clientUuid] })
              .returning(zoneColumns)
          )[0],
        findByClientUuid: async (clientUuid) =>
          (
            await db
              .select(zoneColumns)
              .from(speedZoneConfig)
              .where(
                and(eq(speedZoneConfig.clubId, clubId), eq(speedZoneConfig.clientUuid, clientUuid)),
              )
          )[0],
      });
      return zoneDto(row);
    },
  });

  registerEndpoint(app, updateSpeedZoneConfig, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const current = await authorizedZone(
        db,
        permissions,
        clubId,
        params.speedZoneConfigId,
        'update',
      );
      await lockConfiguration(db, 'speed_zone_config', clubId);
      if (current.archivedAt !== null) {
        throw new HttpError('conflict', 'The configuration is archived: restore it first');
      }
      if (body.zoneSet !== undefined && body.zoneSet.kind !== current.kind) {
        throw validationError('The kind of a configuration does not change', [
          'body',
          'zoneSet',
          'kind',
        ]);
      }
      const today = await clubToday(db);
      const zoneSet = body.zoneSet === undefined ? current.zoneSet : checkedZoneSet(body.zoneSet);
      const validity = plannedValidity({
        row: current,
        today,
        validFrom: body.validFrom,
        validTo: body.validTo,
        contentChanged:
          body.zoneSet !== undefined && JSON.stringify(zoneSet) !== JSON.stringify(current.zoneSet),
        resource: 'speed zone configuration',
      });
      const candidate: SpeedZoneConfig = { ...toConfig(current), zoneSet, ...validity };
      if (
        conflictsWith(candidate, await sameScopeConfigs(db, clubId, candidate, current.id)).length >
        0
      ) {
        throw new HttpError('conflict', OVERLAP);
      }
      const where = and(eq(speedZoneConfig.clubId, clubId), eq(speedZoneConfig.id, current.id));
      const row = await updateAtVersion({
        resource: 'Speed zone configuration',
        update: async () =>
          (
            await db
              .update(speedZoneConfig)
              .set({
                zoneSet,
                validFrom: validity.validFrom,
                validTo: validity.validTo,
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(speedZoneConfig.updatedAt, body.version)))
              .returning(zoneColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: speedZoneConfig.id }).from(speedZoneConfig).where(where)).length >
          0,
      });
      return zoneDto(row);
    },
  });

  registerEndpoint(app, archiveSpeedZoneConfig, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await authorizedZone(db, permissions, clubId, params.speedZoneConfigId, 'update');
      if (row.archivedAt !== null) return zoneDto(row);
      if (validityPhase(row, await clubToday(db)) !== 'planned') {
        throw new HttpError(
          'conflict',
          'The configuration already applied: close it (validTo) instead of archiving it',
        );
      }
      await db
        .update(speedZoneConfig)
        .set({ archivedAt: sql`now()`, updatedBy: caller.userId })
        .where(and(eq(speedZoneConfig.clubId, clubId), eq(speedZoneConfig.id, row.id)));
      return zoneDto(await readZone(db, clubId, row.id));
    },
  });

  registerEndpoint(app, restoreSpeedZoneConfig, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await authorizedZone(db, permissions, clubId, params.speedZoneConfigId, 'update');
      if (row.archivedAt === null) return zoneDto(row);
      await lockConfiguration(db, 'speed_zone_config', clubId);
      if (validityPhase(row, await clubToday(db)) !== 'planned') {
        throw new HttpError(
          'conflict',
          'The start of the archived configuration already passed: create a new one instead',
        );
      }
      const config = toConfig(row);
      if (conflictsWith(config, await sameScopeConfigs(db, clubId, config, row.id)).length > 0) {
        throw new HttpError('conflict', OVERLAP);
      }
      await db
        .update(speedZoneConfig)
        .set({ archivedAt: null, updatedBy: caller.userId })
        .where(and(eq(speedZoneConfig.clubId, clubId), eq(speedZoneConfig.id, row.id)));
      return zoneDto(await readZone(db, clubId, row.id));
    },
  });
}
