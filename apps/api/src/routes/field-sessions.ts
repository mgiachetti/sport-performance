import {
  getTrainingSessionFieldMetrics,
  listFieldSessions,
  type FieldMetricColumn,
  type FieldMetricValue,
  type FieldSession,
  type FieldSessionListItem,
  type FieldSessionPlayer,
  type FieldSessionReference,
} from '@sport-performance/contracts';
import {
  category,
  externalMetric,
  metricDefinition,
  participation,
  player,
  playerPosition,
  position,
  referenceValue,
  trainingSession,
} from '@sport-performance/db/schema';
import {
  CANONICAL_METRIC_CODES,
  FIELD_METRIC_SOURCES,
  can,
  parseMetricCode,
  selectFirstTeamReference,
  type ClubId,
  type FieldMetricSource,
  type FirstTeamReference,
  type MetricCode,
  type MetricDirection,
  type ParticipationStatus,
  type PlayerId,
  type Sex,
  type UnitCode,
} from '@sport-performance/domain';
import { and, desc, eq, gte, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { archiveStatusFilter } from '../http/writes.js';
import {
  authorizeSession,
  loadPlayerFacts,
  readSession,
  sessionDto,
  summaryColumns,
  summaryDto,
  type SessionRow,
  type SummaryRow,
} from './training-shared.js';

/**
 * Field sessions (B-408, ADR 0061): what `external_metric` holds for a
 * session — Catapult imports (B-601), heart-rate bands (Phase 2), pods
 * (Phase 3) — per player and source, next to the participation. The session
 * is authorized with `training_session.read` and every player with
 * `load_metrics.read`; RLS hides the rest anyway (ADR 0026).
 *
 * A session total is the row without a drill (`drill_id IS NULL`); rows of a
 * drill (an OpenField period) are its breakdown. When a source wrote the
 * same total twice, the latest one counts. Sources are never merged.
 */

const SOURCE_ORDER = new Map<FieldMetricSource, number>(
  FIELD_METRIC_SOURCES.map((source, index) => [source, index]),
);
const CANONICAL_ORDER = new Map<string, number>(
  CANONICAL_METRIC_CODES.map((code, index) => [code, index]),
);

/** Canonical metrics in dictionary order, then the club's own by code. */
function compareMetricCodes(a: string, b: string): number {
  const ia = CANONICAL_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
  const ib = CANONICAL_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
  if (ia !== ib) return ia - ib;
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareSources(a: FieldMetricSource, b: FieldMetricSource): number {
  return (SOURCE_ORDER.get(a) ?? 0) - (SOURCE_ORDER.get(b) ?? 0);
}

interface ListRow {
  session: SummaryRow;
  playersN: number;
  sources: FieldMetricSource[];
  metricCodes: string[];
}

const LIST_KEYS: KeysetSpec<ListRow, 'startsAt'> = {
  fields: {
    startsAt: {
      column: trainingSession.startsAt,
      type: 'timestamp',
      value: (row) => row.session.startsAt,
    },
  },
  id: { column: trainingSession.id, value: (row) => row.session.id },
};

interface ValueRow {
  playerId: PlayerId;
  metricCode: string;
  unit: UnitCode;
  direction: MetricDirection;
  source: FieldMetricSource;
  value: number;
}

/** Session totals, one per player, metric and source (the latest one written). */
async function sessionTotals(
  db: TenantDatabase,
  clubId: ClubId,
  sessionId: string,
): Promise<ValueRow[]> {
  return db
    .selectDistinctOn(
      [externalMetric.playerId, externalMetric.metricDefinitionId, externalMetric.source],
      {
        playerId: externalMetric.playerId,
        metricCode: metricDefinition.code,
        unit: metricDefinition.unit,
        direction: metricDefinition.direction,
        source: externalMetric.source,
        value: externalMetric.value,
      },
    )
    .from(externalMetric)
    .innerJoin(
      metricDefinition,
      and(
        eq(metricDefinition.clubId, externalMetric.clubId),
        eq(metricDefinition.id, externalMetric.metricDefinitionId),
      ),
    )
    .where(
      and(
        eq(externalMetric.clubId, clubId),
        eq(externalMetric.trainingSessionId, sessionId),
        isNull(externalMetric.drillId),
      ),
    )
    .orderBy(
      externalMetric.playerId,
      externalMetric.metricDefinitionId,
      externalMetric.source,
      desc(externalMetric.updatedAt),
      desc(externalMetric.createdAt),
      desc(externalMetric.id),
    );
}

interface ParticipationView {
  playerId: PlayerId;
  status: ParticipationStatus;
  minutes: number | null;
  contactsN: number | null;
  rpe: number | null;
  srpeAu: number | null;
}

async function sessionParticipation(
  db: TenantDatabase,
  clubId: ClubId,
  sessionId: string,
): Promise<ParticipationView[]> {
  return db
    .select({
      playerId: participation.playerId,
      status: participation.status,
      minutes: participation.minutes,
      contactsN: participation.contactsN,
      rpe: participation.rpe,
      srpeAu: participation.srpeAu,
    })
    .from(participation)
    .where(and(eq(participation.clubId, clubId), eq(participation.trainingSessionId, sessionId)));
}

interface PlayerRow {
  id: PlayerId;
  firstName: string;
  lastName: string;
  positionCode: string | null;
  positionLabel: string | null;
  lineCode: string | null;
}

/** Name and main position (`sort_order = 0`) of the players. */
async function playerRows(
  db: TenantDatabase,
  clubId: ClubId,
  ids: readonly PlayerId[],
): Promise<PlayerRow[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: player.id,
      firstName: player.firstName,
      lastName: player.lastName,
      positionCode: position.code,
      positionLabel: position.label,
      lineCode: position.lineCode,
    })
    .from(player)
    .leftJoin(
      playerPosition,
      and(
        eq(playerPosition.clubId, player.clubId),
        eq(playerPosition.playerId, player.id),
        eq(playerPosition.sortOrder, 0),
      ),
    )
    .leftJoin(
      position,
      and(eq(position.clubId, playerPosition.clubId), eq(position.id, playerPosition.positionId)),
    )
    .where(and(eq(player.clubId, clubId), inArray(player.id, [...ids])));
}

/**
 * First-team references of the whole squad (no position, no line) for the
 * session's sport and the category's sex, in force on the session day.
 */
async function squadReferences(
  db: TenantDatabase,
  clubId: ClubId,
  session: SessionRow,
  metricCodes: readonly string[],
): Promise<FieldSessionReference[]> {
  if (session.categoryId === null || metricCodes.length === 0) return [];
  const [own] = await db
    .select({ sex: category.sex })
    .from(category)
    .where(and(eq(category.clubId, clubId), eq(category.id, session.categoryId)));
  if (own === undefined) return [];
  const rows = await db
    .select({
      metricCode: metricDefinition.code,
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
    .where(
      and(
        eq(referenceValue.clubId, clubId),
        eq(referenceValue.sport, session.sport),
        eq(referenceValue.sex, own.sex),
        isNull(referenceValue.positionId),
        isNull(referenceValue.lineCode),
        isNull(referenceValue.archivedAt),
        lte(referenceValue.validFrom, session.localDate),
        inArray(metricDefinition.code, [...metricCodes]),
      ),
    );
  const sex: Sex = own.sex;
  const candidates = rows.map((row): FirstTeamReference => ({
    metricCode: parseMetricCode(row.metricCode),
    sport: session.sport,
    sex,
    value: row.value,
    unit: row.unit,
    ...(row.method === null ? {} : { method: row.method }),
    validFrom: row.validFrom,
    source: row.source,
  }));
  const references: FieldSessionReference[] = [];
  for (const code of metricCodes) {
    const selected = selectFirstTeamReference(candidates, {
      metricCode: code as MetricCode,
      sport: session.sport,
      sex,
      asOf: session.localDate,
    });
    if (selected === undefined) continue;
    references.push({
      metricCode: selected.metricCode,
      unit: selected.unit,
      value: selected.value,
      method: selected.method ?? null,
      validFrom: selected.validFrom,
      source: selected.source,
    });
  }
  return references;
}

function compareNames(a: PlayerRow, b: PlayerRow): number {
  return (
    a.lastName.localeCompare(b.lastName, 'es') ||
    a.firstName.localeCompare(b.firstName, 'es') ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function registerFieldSessionRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listFieldSessions, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const scope = await permissions.listScope('training_session', 'read');
      const plan = keysetPage(LIST_KEYS, query, {
        sport: query.sport,
        categoryId: query.categoryId,
        kind: query.kind,
        from: query.from,
        to: query.to,
        status: query.status,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };
      let inScope: SQL | undefined;
      if (scope.kind === 'assigned') {
        inScope = or(
          scope.categoryIds.length > 0
            ? inArray(trainingSession.categoryId, [...scope.categoryIds])
            : undefined,
          scope.sports.length > 0 ? inArray(trainingSession.sport, [...scope.sports]) : undefined,
        );
      } else if (scope.kind !== 'club') {
        // No rule of `training_session.read` scopes by player.
        return { items: [], nextCursor: null };
      }
      // Under RLS the aggregate only counts the players the caller sees (ADR 0026), the same
      // players `load_metrics.read` gives the staff roles of `training_session.read`.
      const totals = db
        .select({
          playersN: sql<number>`count(distinct ${externalMetric.playerId})::int`.as('players_n'),
          sources: sql<FieldMetricSource[]>`array_agg(distinct ${externalMetric.source}::text)`.as(
            'sources',
          ),
          metricCodes: sql<string[]>`array_agg(distinct ${metricDefinition.code})`.as(
            'metric_codes',
          ),
        })
        .from(externalMetric)
        .innerJoin(
          metricDefinition,
          and(
            eq(metricDefinition.clubId, externalMetric.clubId),
            eq(metricDefinition.id, externalMetric.metricDefinitionId),
          ),
        )
        .where(
          and(
            eq(externalMetric.clubId, trainingSession.clubId),
            eq(externalMetric.trainingSessionId, trainingSession.id),
          ),
        )
        .as('totals');
      const rows = await db
        .select({
          session: summaryColumns,
          playersN: totals.playersN,
          sources: totals.sources,
          metricCodes: totals.metricCodes,
        })
        .from(trainingSession)
        .innerJoinLateral(totals, sql`${totals.playersN} > 0`)
        .where(
          and(
            eq(trainingSession.clubId, clubId),
            inScope,
            query.sport === undefined ? undefined : eq(trainingSession.sport, query.sport),
            query.categoryId === undefined
              ? undefined
              : eq(trainingSession.categoryId, query.categoryId),
            query.kind === undefined ? undefined : eq(trainingSession.kind, query.kind),
            query.from === undefined ? undefined : gte(trainingSession.localDate, query.from),
            query.to === undefined ? undefined : lte(trainingSession.localDate, query.to),
            archiveStatusFilter(trainingSession.archivedAt, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, (row): FieldSessionListItem => ({
        session: summaryDto(row.session),
        playersN: row.playersN,
        sources: [...row.sources].sort(compareSources),
        metricCodes: [...row.metricCodes].sort(compareMetricCodes).map(parseMetricCode),
      }));
    },
  });

  registerEndpoint(app, getTrainingSessionFieldMetrics, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }): Promise<FieldSession> => {
      const { clubId } = caller.membership;
      const session = await readSession(db, clubId, params.trainingSessionId);
      await authorizeSession(permissions, session, 'read');

      const values = await sessionTotals(db, clubId, session.id);
      const participations = await sessionParticipation(db, clubId, session.id);
      const ids = [
        ...new Set<PlayerId>([
          ...values.map((v) => v.playerId),
          ...participations.map((p) => p.playerId),
        ]),
      ];
      // Every player through the matrix with their own facts; the ones it denies are left out.
      const subject = await permissions.subject();
      const facts = await loadPlayerFacts(db, clubId, ids, session.sport);
      const visible = new Set<PlayerId>(
        ids.filter((id) => {
          const own = facts.get(id);
          return (
            own !== undefined && can(subject, 'read', { kind: 'load_metrics', clubId, player: own })
          );
        }),
      );

      const columns = new Map<string, FieldMetricColumn>();
      const valuesOf = new Map<PlayerId, FieldMetricValue[]>();
      for (const row of values) {
        if (!visible.has(row.playerId)) continue;
        const metricCode = parseMetricCode(row.metricCode);
        const key = `${row.metricCode}\u0000${row.source}`;
        if (!columns.has(key)) {
          columns.set(key, {
            metricCode,
            source: row.source,
            unit: row.unit,
            direction: row.direction,
          });
        }
        const list = valuesOf.get(row.playerId) ?? [];
        list.push({ metricCode, source: row.source, value: row.value });
        valuesOf.set(row.playerId, list);
      }
      const orderedColumns = [...columns.values()].sort(
        (a, b) =>
          compareMetricCodes(a.metricCode, b.metricCode) || compareSources(a.source, b.source),
      );
      const participationOf = new Map(participations.map((p) => [p.playerId, p]));

      const players = (await playerRows(db, clubId, [...visible]))
        .sort(compareNames)
        .map((row): FieldSessionPlayer => {
          const own = participationOf.get(row.id);
          return {
            playerId: row.id,
            firstName: row.firstName,
            lastName: row.lastName,
            position:
              row.positionCode === null
                ? null
                : { code: row.positionCode, label: row.positionLabel, lineCode: row.lineCode },
            participation:
              own === undefined
                ? null
                : {
                    status: own.status,
                    minutes: own.minutes,
                    contactsN: own.contactsN,
                    rpe: own.rpe,
                    srpeAu: own.srpeAu,
                  },
            values: (valuesOf.get(row.id) ?? []).sort(
              (a, b) =>
                compareMetricCodes(a.metricCode, b.metricCode) ||
                compareSources(a.source, b.source),
            ),
          };
        });

      const metricCodes = [...new Set(orderedColumns.map((c) => c.metricCode))];
      return {
        session: sessionDto(session),
        columns: orderedColumns,
        players,
        references: await squadReferences(db, clubId, session, metricCodes),
      };
    },
  });
}
