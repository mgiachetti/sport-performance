import { createHash } from 'node:crypto';
import {
  archiveReferenceValue,
  createReferenceValue,
  getPlayerFirstTeamReferences,
  getReferenceValue,
  importReferenceValues,
  listReferenceValues,
  restoreReferenceValue,
  updateReferenceValue,
  type PlayerFirstTeamReference,
  type ReferenceValue,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  category,
  metricDefinition,
  player,
  playerCategory,
  playerPosition,
  position,
  referenceValue,
} from '@sport-performance/db/schema';
import {
  compareLocalDates,
  parseLocalDate,
  parseMetricCode,
  referenceScope,
  selectFirstTeamReference,
  type ClubId,
  type FirstTeamReference,
  type LocalDate,
  type MeasurementMethod,
  type MetricDirection,
  type Sex,
  type Sport,
  type UnitCode,
} from '@sport-performance/domain';
import { and, asc, eq, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import {
  archiveStatusFilter,
  insertIdempotent,
  markReplay,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';

/**
 * First-team references (B-321, ADR 0040): read by the staff with
 * `configuration.read`, loaded by `sc` and the administration with
 * `configuration.update` (one by one or as an imported table), and shown to
 * a player only as the reference that applies to them (`group_reference`).
 */

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const referenceColumns = {
  id: referenceValue.id,
  metricDefinitionId: referenceValue.metricDefinitionId,
  metricCode: metricDefinition.code,
  sport: referenceValue.sport,
  sex: referenceValue.sex,
  positionId: referenceValue.positionId,
  positionCode: position.code,
  lineCode: referenceValue.lineCode,
  value: referenceValue.value,
  unit: referenceValue.unit,
  method: referenceValue.method,
  validFrom: referenceValue.validFrom,
  source: referenceValue.source,
  archivedAt: referenceValue.archivedAt,
  createdAt: referenceValue.createdAt,
  updatedAt: referenceValue.updatedAt,
  version: rowVersion(referenceValue.updatedAt),
};

interface ReferenceRow {
  id: string;
  metricDefinitionId: string;
  metricCode: string;
  sport: Sport;
  sex: Sex;
  positionId: string | null;
  positionCode: string | null;
  lineCode: string | null;
  value: number;
  unit: UnitCode;
  method: MeasurementMethod | null;
  validFrom: LocalDate;
  source: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function scopeOf(row: { positionId: string | null; lineCode: string | null }) {
  if (row.positionId !== null) return 'position' as const;
  if (row.lineCode !== null) return 'line' as const;
  return 'squad' as const;
}

function referenceDto(row: ReferenceRow): ReferenceValue {
  return {
    id: row.id as ReferenceValue['id'],
    metricDefinitionId: row.metricDefinitionId as ReferenceValue['metricDefinitionId'],
    metricCode: row.metricCode,
    sport: row.sport,
    sex: row.sex,
    scope: scopeOf(row),
    positionId: row.positionId as ReferenceValue['positionId'],
    positionCode: row.positionCode,
    lineCode: row.lineCode,
    value: row.value,
    unit: row.unit,
    method: row.method,
    validFrom: row.validFrom,
    source: row.source,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const REFERENCE_KEYS: KeysetSpec<ReferenceRow, 'validFrom' | 'createdAt' | 'metricCode'> = {
  fields: {
    // ISO dates order as text.
    validFrom: {
      column: sql`${referenceValue.validFrom}::text`,
      type: 'text',
      value: (row) => row.validFrom,
    },
    createdAt: {
      column: referenceValue.createdAt,
      type: 'timestamp',
      value: (row) => row.createdAt,
    },
    metricCode: { column: metricDefinition.code, type: 'text', value: (row) => row.metricCode },
  },
  id: { column: referenceValue.id, value: (row) => row.id },
};

/** References with their metric code and position code (the composite keys stay in the club). */
function selectReferences(db: TenantDatabase) {
  return db
    .select(referenceColumns)
    .from(referenceValue)
    .innerJoin(
      metricDefinition,
      and(
        eq(metricDefinition.clubId, referenceValue.clubId),
        eq(metricDefinition.id, referenceValue.metricDefinitionId),
      ),
    )
    .leftJoin(
      position,
      and(eq(position.clubId, referenceValue.clubId), eq(position.id, referenceValue.positionId)),
    );
}

async function readReference(
  db: TenantDatabase,
  clubId: ClubId,
  referenceValueId: string,
): Promise<ReferenceRow> {
  const [row] = await selectReferences(db).where(
    and(eq(referenceValue.clubId, clubId), eq(referenceValue.id, referenceValueId)),
  );
  if (row === undefined) throw new HttpError('not_found', 'Reference value not found');
  return row;
}

async function readReferencesByClientUuid(
  db: TenantDatabase,
  clubId: ClubId,
  clientUuids: readonly string[],
): Promise<(ReferenceRow & { clientUuid: string })[]> {
  if (clientUuids.length === 0) return [];
  return db
    .select({ ...referenceColumns, clientUuid: referenceValue.clientUuid })
    .from(referenceValue)
    .innerJoin(
      metricDefinition,
      and(
        eq(metricDefinition.clubId, referenceValue.clubId),
        eq(metricDefinition.id, referenceValue.metricDefinitionId),
      ),
    )
    .leftJoin(
      position,
      and(eq(position.clubId, referenceValue.clubId), eq(position.id, referenceValue.positionId)),
    )
    .where(
      and(eq(referenceValue.clubId, clubId), inArray(referenceValue.clientUuid, [...clientUuids])),
    );
}

// ─── Resolving codes to club rows ──────────────────────────────────────────────────────

/** What a manual entry or an imported row says, before resolving its codes. */
interface ReferenceInput {
  metricCode: string;
  sport: Sport;
  sex: Sex;
  positionCode?: string | undefined;
  lineCode?: string | undefined;
  value: number;
  unit: UnitCode;
  method?: MeasurementMethod | undefined;
  validFrom: LocalDate;
  source: string;
}

/** A reference ready to insert. */
interface ResolvedReference {
  metricDefinitionId: string;
  sport: Sport;
  sex: Sex;
  positionId: string | null;
  lineCode: string | null;
  value: number;
  unit: UnitCode;
  method: MeasurementMethod | null;
  validFrom: LocalDate;
  source: string;
}

interface MetricFacts {
  id: string;
  unit: UnitCode;
  sports: Sport[] | null;
  archivedAt: Date | null;
}

/**
 * The club's metrics, positions and lines the inputs name, read once (an
 * import resolves up to 500 rows with three queries).
 */
class ReferenceResolver {
  private constructor(
    private readonly metrics: ReadonlyMap<string, MetricFacts>,
    private readonly positions: ReadonlyMap<string, { id: string }>,
    private readonly lines: ReadonlySet<string>,
  ) {}

  static async load(
    db: TenantDatabase,
    clubId: ClubId,
    inputs: readonly Pick<ReferenceInput, 'metricCode' | 'positionCode'>[],
  ): Promise<ReferenceResolver> {
    const metricCodes = [...new Set(inputs.map((input) => input.metricCode))];
    const positionCodes = [...new Set(inputs.flatMap((input) => input.positionCode ?? []))];
    const metricRows =
      metricCodes.length === 0
        ? []
        : await db
            .select({
              id: metricDefinition.id,
              code: metricDefinition.code,
              unit: metricDefinition.unit,
              sports: metricDefinition.sports,
              archivedAt: metricDefinition.archivedAt,
            })
            .from(metricDefinition)
            .where(
              and(eq(metricDefinition.clubId, clubId), inArray(metricDefinition.code, metricCodes)),
            );
    const positionRows =
      positionCodes.length === 0
        ? []
        : await db
            .select({ id: position.id, sport: position.sport, code: position.code })
            .from(position)
            .where(and(eq(position.clubId, clubId), inArray(position.code, positionCodes)));
    const lineRows = await db
      .selectDistinct({ sport: position.sport, lineCode: position.lineCode })
      .from(position)
      .where(and(eq(position.clubId, clubId), isNotNull(position.lineCode)));
    return new ReferenceResolver(
      new Map(metricRows.map((row) => [row.code, row])),
      new Map(positionRows.map((row) => [`${row.sport}:${row.code}`, { id: row.id }])),
      new Set(lineRows.map((row) => `${row.sport}:${row.lineCode ?? ''}`)),
    );
  }

  /** The row to insert, or the issues of the input (paths under `path`). */
  resolve(
    input: ReferenceInput,
    path: readonly (string | number)[],
  ): { reference: ResolvedReference } | { issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    const issue = (field: string, message: string) =>
      issues.push({ path: [...path, field], code: 'custom', message });
    const metric = this.metrics.get(input.metricCode);
    if (metric === undefined) {
      issue('metricCode', 'Unknown metric code in this club');
    } else {
      if (metric.archivedAt !== null) issue('metricCode', 'The metric is archived');
      if (metric.sports !== null && !metric.sports.includes(input.sport)) {
        issue('metricCode', `The metric does not apply to ${input.sport}`);
      }
      if (metric.unit !== input.unit) {
        issue('unit', `The metric is measured in ${metric.unit}: convert the value first`);
      }
    }
    let positionId: string | null = null;
    if (input.positionCode !== undefined) {
      const found = this.positions.get(`${input.sport}:${input.positionCode}`);
      if (found === undefined) issue('positionCode', `Unknown position of ${input.sport}`);
      else positionId = found.id;
    }
    if (input.lineCode !== undefined && !this.lines.has(`${input.sport}:${input.lineCode}`)) {
      issue('lineCode', `No position of ${input.sport} is in this line`);
    }
    if (issues.length > 0 || metric === undefined) return { issues };
    return {
      reference: {
        metricDefinitionId: metric.id,
        sport: input.sport,
        sex: input.sex,
        positionId,
        lineCode: input.lineCode ?? null,
        value: input.value,
        unit: input.unit,
        method: input.method ?? null,
        validFrom: input.validFrom,
        source: input.source,
      },
    };
  }
}

/** The unique key of an active reference (index `reference_value_active_key`). */
function activeKey(reference: ResolvedReference): string {
  return [
    reference.metricDefinitionId,
    reference.sport,
    reference.sex,
    reference.positionId ?? NIL_UUID,
    reference.lineCode ?? '',
    reference.validFrom,
  ].join('|');
}

/** Condition "an active reference with the same key as `reference`". */
function sameActiveKey(reference: ResolvedReference): SQL | undefined {
  return and(
    isNull(referenceValue.archivedAt),
    eq(referenceValue.metricDefinitionId, reference.metricDefinitionId),
    eq(referenceValue.sport, reference.sport),
    eq(referenceValue.sex, reference.sex),
    reference.positionId === null
      ? isNull(referenceValue.positionId)
      : eq(referenceValue.positionId, reference.positionId),
    reference.lineCode === null
      ? isNull(referenceValue.lineCode)
      : eq(referenceValue.lineCode, reference.lineCode),
    eq(referenceValue.validFrom, reference.validFrom),
  );
}

/**
 * `client_uuid` of row `index` of an import: a UUIDv5 (RFC 9562) of the
 * batch's `clientUuid`, so re-sending the same import finds the same rows.
 */
export function importRowClientUuid(batchClientUuid: string, index: number): string {
  const namespace = Buffer.from(batchClientUuid.replace(/-/g, ''), 'hex');
  const bytes = createHash('sha1')
    .update(namespace)
    .update(`reference_value:${String(index)}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function invalid(issues: ValidationIssue[]): never {
  throw new HttpError('validation_failed', 'The references do not match the club', {
    details: issues,
  });
}

// ─── What a player sees ────────────────────────────────────────────────────────────────

async function clubToday(db: TenantDatabase): Promise<LocalDate> {
  const { rows } = await db.execute<{ today: string | null }>(
    sql`select app.club_today()::text as today`,
  );
  const today = rows[0]?.today ?? null;
  if (today === null) throw new HttpError('forbidden', 'The club of the request is not visible');
  return parseLocalDate(today);
}

function coversDay(row: { validFrom: LocalDate; validTo: LocalDate | null }, day: LocalDate) {
  return (
    compareLocalDates(row.validFrom, day) <= 0 &&
    (row.validTo === null || compareLocalDates(day, row.validTo) < 0)
  );
}

type SelectableReference = FirstTeamReference & {
  readonly direction: MetricDirection;
  readonly method?: MeasurementMethod;
};

export function registerReferenceValueRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listReferenceValues, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      // Club configuration: the matrix gives it to the staff for the whole club.
      await permissions.authorize('configuration', 'read');
      const plan = keysetPage(REFERENCE_KEYS, query, {
        metricCode: query.metricCode,
        sport: query.sport,
        sex: query.sex,
        scope: query.scope,
        positionCode: query.positionCode,
        lineCode: query.lineCode,
        status: query.status,
      });
      const scopeFilter =
        query.scope === 'position'
          ? isNotNull(referenceValue.positionId)
          : query.scope === 'line'
            ? isNotNull(referenceValue.lineCode)
            : query.scope === 'squad'
              ? and(isNull(referenceValue.positionId), isNull(referenceValue.lineCode))
              : undefined;
      const rows = await selectReferences(db)
        .where(
          and(
            eq(referenceValue.clubId, caller.membership.clubId),
            query.metricCode === undefined
              ? undefined
              : eq(metricDefinition.code, query.metricCode),
            query.sport === undefined ? undefined : eq(referenceValue.sport, query.sport),
            query.sex === undefined ? undefined : eq(referenceValue.sex, query.sex),
            scopeFilter,
            query.positionCode === undefined ? undefined : eq(position.code, query.positionCode),
            query.lineCode === undefined ? undefined : eq(referenceValue.lineCode, query.lineCode),
            archiveStatusFilter(referenceValue.archivedAt, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, referenceDto);
    },
  });

  registerEndpoint(app, getReferenceValue, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'read');
      return referenceDto(
        await readReference(db, caller.membership.clubId, params.referenceValueId),
      );
    },
  });

  registerEndpoint(app, createReferenceValue, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      if (body.clientUuid !== undefined) {
        const [previous] = await readReferencesByClientUuid(db, clubId, [body.clientUuid]);
        if (previous !== undefined) {
          markReplay(reply);
          return referenceDto(previous);
        }
      }
      const input: ReferenceInput = { ...body, validFrom: parseLocalDate(body.validFrom) };
      const resolver = await ReferenceResolver.load(db, clubId, [input]);
      const resolved = resolver.resolve(input, ['body']);
      if ('issues' in resolved) invalid(resolved.issues);
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(referenceValue)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                ...resolved.reference,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [referenceValue.clubId, referenceValue.clientUuid] })
              .returning({ id: referenceValue.id })
          )[0],
        findByClientUuid: async (clientUuid) =>
          (await readReferencesByClientUuid(db, clubId, [clientUuid]))[0],
      });
      return referenceDto(await readReference(db, clubId, row.id));
    },
  });

  registerEndpoint(app, updateReferenceValue, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      const where = and(
        eq(referenceValue.clubId, clubId),
        eq(referenceValue.id, params.referenceValueId),
      );
      const row = await updateAtVersion({
        resource: 'Reference value',
        update: async () =>
          (
            await db
              .update(referenceValue)
              .set({
                ...(body.value !== undefined && { value: body.value }),
                ...(body.method !== undefined && { method: body.method }),
                ...(body.validFrom !== undefined && { validFrom: parseLocalDate(body.validFrom) }),
                ...(body.source !== undefined && { source: body.source }),
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(referenceValue.updatedAt, body.version)))
              .returning({ id: referenceValue.id })
          )[0],
        exists: async () =>
          (await db.select({ id: referenceValue.id }).from(referenceValue).where(where)).length > 0,
      });
      return referenceDto(await readReference(db, clubId, row.id));
    },
  });

  registerEndpoint(app, archiveReferenceValue, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      const row = await readReference(db, clubId, params.referenceValueId);
      if (row.archivedAt !== null) return referenceDto(row);
      await db
        .update(referenceValue)
        .set({ archivedAt: sql`now()`, updatedBy: caller.userId })
        .where(and(eq(referenceValue.clubId, clubId), eq(referenceValue.id, row.id)));
      return referenceDto(await readReference(db, clubId, row.id));
    },
  });

  registerEndpoint(app, restoreReferenceValue, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      const row = await readReference(db, clubId, params.referenceValueId);
      if (row.archivedAt === null) return referenceDto(row);
      // Another active reference with the same key: `reference_value_active_key` → 409.
      await db
        .update(referenceValue)
        .set({ archivedAt: null, updatedBy: caller.userId })
        .where(and(eq(referenceValue.clubId, clubId), eq(referenceValue.id, row.id)));
      return referenceDto(await readReference(db, clubId, row.id));
    },
  });

  registerEndpoint(app, importReferenceValues, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      const clientUuids = body.rows.map((_, index) => importRowClientUuid(body.clientUuid, index));
      const order = new Map(clientUuids.map((uuid, index) => [uuid, index]));
      const inOrder = (rows: (ReferenceRow & { clientUuid: string })[]) =>
        rows
          .sort((a, b) => (order.get(a.clientUuid) ?? 0) - (order.get(b.clientUuid) ?? 0))
          .map(referenceDto);
      const replay = async () => {
        const previous = await readReferencesByClientUuid(db, clubId, clientUuids);
        if (previous.length === 0) return undefined;
        if (previous.length !== clientUuids.length) {
          throw new HttpError('conflict', 'This clientUuid was already used for another import');
        }
        markReplay(reply);
        // What was archived the first time is not known any more: nothing archived now.
        return { items: inOrder(previous), archivedCount: 0 };
      };
      const replayed = await replay();
      if (replayed !== undefined) return replayed;

      const inputs: ReferenceInput[] = body.rows.map((row) => {
        const validFrom = row.validFrom ?? body.validFrom;
        const source = row.source ?? body.source;
        // The contract rejects rows without a value and without a default of the batch.
        if (validFrom === undefined || source === undefined) {
          throw new Error('importReferenceValues: the contract let a row without defaults in');
        }
        return { ...row, validFrom: parseLocalDate(validFrom), source };
      });
      const resolver = await ReferenceResolver.load(db, clubId, inputs);
      const issues: ValidationIssue[] = [];
      const resolved: ResolvedReference[] = [];
      const seen = new Map<string, number>();
      inputs.forEach((input, index) => {
        const result = resolver.resolve(input, ['body', 'rows', index]);
        if ('issues' in result) {
          issues.push(...result.issues);
          return;
        }
        const key = activeKey(result.reference);
        const first = seen.get(key);
        if (first !== undefined) {
          issues.push({
            path: ['body', 'rows', index],
            code: 'custom',
            message: `Same metric, sport, sex, scope and validFrom as row ${String(first)}`,
          });
          return;
        }
        seen.set(key, index);
        resolved.push(result.reference);
      });
      if (issues.length > 0) invalid(issues);

      let archivedCount = 0;
      if (body.mode === 'replace') {
        const archived = await db
          .update(referenceValue)
          .set({ archivedAt: sql`now()`, updatedBy: caller.userId })
          .where(and(eq(referenceValue.clubId, clubId), or(...resolved.map(sameActiveKey))))
          .returning({ id: referenceValue.id });
        archivedCount = archived.length;
      }
      // In `insert` mode a row that collides with an active reference violates
      // `reference_value_active_key`: 409, and nothing of the batch is written.
      const inserted = await db
        .insert(referenceValue)
        .values(
          resolved.map((reference, index) => ({
            clubId,
            clientUuid: clientUuids[index],
            ...reference,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          })),
        )
        .onConflictDoNothing({ target: [referenceValue.clubId, referenceValue.clientUuid] })
        .returning({ id: referenceValue.id });
      if (inserted.length !== resolved.length) {
        // A concurrent identical import committed first.
        const concurrent = await replay();
        if (concurrent !== undefined) return concurrent;
        throw new HttpError('conflict', 'This clientUuid was already used for another import');
      }
      return {
        items: inOrder(await readReferencesByClientUuid(db, clubId, clientUuids)),
        archivedCount,
      };
    },
  });

  registerEndpoint(app, getPlayerFirstTeamReferences, {
    transaction: true,
    handler: async ({ params, query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      // RLS hides the players outside the caller's reach: the same 404 as another club's.
      const [found] = await db
        .select({ id: player.id, sex: player.sex })
        .from(player)
        .where(and(eq(player.clubId, clubId), eq(player.id, params.playerId)));
      if (found === undefined) throw new HttpError('not_found', 'Player not found');
      const today = await clubToday(db);
      const asOf = query.asOf === undefined ? today : parseLocalDate(query.asOf);
      const categories = await db
        .select({
          categoryId: playerCategory.categoryId,
          sport: category.sport,
          validFrom: playerCategory.validFrom,
          validTo: playerCategory.validTo,
        })
        .from(playerCategory)
        .innerJoin(
          category,
          and(
            eq(category.clubId, playerCategory.clubId),
            eq(category.id, playerCategory.categoryId),
          ),
        )
        .where(and(eq(playerCategory.clubId, clubId), eq(playerCategory.playerId, found.id)))
        .orderBy(asc(playerCategory.validFrom));
      const current = categories.filter((row) => coversDay(row, today));
      // The sport of the references is the one of the category on `asOf`, else the latest one.
      const sportRow =
        categories.filter((row) => coversDay(row, asOf)).at(-1) ??
        current.at(-1) ??
        categories.at(-1);
      if (sportRow === undefined) throw new HttpError('not_found', 'The player has no category');
      await permissions.authorize('group_reference', 'read', {
        player: {
          id: found.id,
          sport: sportRow.sport,
          categoryIds: current.map((row) => row.categoryId),
        },
      });

      // The main position of the player (`sort_order` 0, B-315).
      const [ownPosition] = await db
        .select({ code: position.code, lineCode: position.lineCode, sport: position.sport })
        .from(playerPosition)
        .innerJoin(
          position,
          and(
            eq(position.clubId, playerPosition.clubId),
            eq(position.id, playerPosition.positionId),
          ),
        )
        .where(and(eq(playerPosition.clubId, clubId), eq(playerPosition.playerId, found.id)))
        .orderBy(asc(playerPosition.sortOrder))
        .limit(1);
      const positionOfSport = ownPosition?.sport === sportRow.sport ? ownPosition : undefined;

      const rows = await db
        .select({
          metricCode: metricDefinition.code,
          direction: metricDefinition.direction,
          positionCode: position.code,
          lineCode: referenceValue.lineCode,
          value: referenceValue.value,
          unit: referenceValue.unit,
          method: referenceValue.method,
          validFrom: referenceValue.validFrom,
          source: referenceValue.source,
        })
        .from(referenceValue)
        .innerJoin(
          metricDefinition,
          and(
            eq(metricDefinition.clubId, referenceValue.clubId),
            eq(metricDefinition.id, referenceValue.metricDefinitionId),
          ),
        )
        .leftJoin(
          position,
          and(
            eq(position.clubId, referenceValue.clubId),
            eq(position.id, referenceValue.positionId),
          ),
        )
        .where(
          and(
            eq(referenceValue.clubId, clubId),
            eq(referenceValue.sport, sportRow.sport),
            eq(referenceValue.sex, found.sex),
            isNull(referenceValue.archivedAt),
            isNull(metricDefinition.archivedAt),
            lte(referenceValue.validFrom, asOf),
            query.metricCode === undefined
              ? undefined
              : eq(metricDefinition.code, query.metricCode),
          ),
        );

      const byMetric = new Map<string, SelectableReference[]>();
      for (const row of rows) {
        const reference: SelectableReference = {
          metricCode: parseMetricCode(row.metricCode),
          sport: sportRow.sport,
          sex: found.sex,
          ...(row.positionCode !== null && { positionCode: row.positionCode }),
          ...(row.lineCode !== null && { lineCode: row.lineCode }),
          value: row.value,
          unit: row.unit,
          ...(row.method !== null && { method: row.method }),
          validFrom: row.validFrom,
          source: row.source,
          direction: row.direction,
        };
        const list = byMetric.get(row.metricCode) ?? [];
        list.push(reference);
        byMetric.set(row.metricCode, list);
      }
      const items: PlayerFirstTeamReference[] = [];
      for (const [metricCode, references] of [...byMetric].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        const selected = selectFirstTeamReference(references, {
          metricCode: parseMetricCode(metricCode),
          sport: sportRow.sport,
          sex: found.sex,
          ...(positionOfSport !== undefined && { positionCode: positionOfSport.code }),
          ...(positionOfSport?.lineCode !== undefined &&
            positionOfSport.lineCode !== null && { lineCode: positionOfSport.lineCode }),
          asOf,
        });
        if (selected === undefined) continue;
        items.push({
          metricCode,
          unit: selected.unit,
          direction: selected.direction,
          scope: referenceScope(selected),
          value: selected.value,
          method: selected.method ?? null,
          validFrom: selected.validFrom,
          source: selected.source,
        });
      }
      return {
        playerId: found.id,
        asOf,
        sport: sportRow.sport,
        sex: found.sex,
        positionCode: positionOfSport?.code ?? null,
        lineCode: positionOfSport?.lineCode ?? null,
        items,
      };
    },
  });
}
