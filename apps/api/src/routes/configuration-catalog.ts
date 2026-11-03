import {
  listCatalogMetrics,
  listCatalogTests,
  type CatalogMetric,
  type CatalogTest,
} from '@sport-performance/contracts';
import {
  metricDefinition,
  testDefinition,
  testDefinitionMetric,
} from '@sport-performance/db/schema';
import type {
  AttemptAggregation,
  LocalDate,
  MetricDirection,
  MetricSource,
  Sport,
  UnitCode,
} from '@sport-performance/domain';
import { and, asc, eq, inArray, sql, type AnyColumn } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { registerEndpoint } from '../http/endpoint.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { archiveStatusFilter, rowVersion } from '../http/writes.js';
import { clubToday } from './configuration-shared.js';

/**
 * Read side of the club's catalog (B-409, ADR 0062): the tests of the
 * catalog, one per code with the protocol version in force, and the metric
 * dictionary. What the configuration screens pick from; written only by the
 * seeds (B-306) for now. `configuration.read`, like the rest of the club
 * configuration; RLS keeps each club's rows.
 */

/** `sports IS NULL` (every sport) or the sport is listed. */
function appliesToSport(column: AnyColumn, sport: Sport | undefined) {
  return sport === undefined
    ? undefined
    : sql`(${column} is null or ${sport}::sport = any(${column}))`;
}

interface CatalogTestRow {
  id: string;
  code: string;
  version: number;
  sports: Sport[] | null;
  maximalLoad: boolean;
  attemptCount: number;
  attemptAggregation: AttemptAggregation;
  validFrom: LocalDate;
  validTo: LocalDate | null;
  inForce: boolean;
}

const TEST_KEYS: KeysetSpec<CatalogTestRow, 'code'> = {
  fields: { code: { column: testDefinition.code, type: 'text', value: (row) => row.code } },
  id: { column: testDefinition.id, value: (row) => row.id },
};

interface CatalogMetricRow {
  id: string;
  code: string;
  unit: UnitCode;
  source: MetricSource;
  direction: MetricDirection;
  testCode: string | null;
  sports: Sport[] | null;
  description: string | null;
  catapultAliases: string[];
  isCanonical: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

const METRIC_KEYS: KeysetSpec<CatalogMetricRow, 'code'> = {
  fields: { code: { column: metricDefinition.code, type: 'text', value: (row) => row.code } },
  id: { column: metricDefinition.id, value: (row) => row.id },
};

function metricDto(row: CatalogMetricRow): CatalogMetric {
  return {
    id: row.id as CatalogMetric['id'],
    code: row.code,
    unit: row.unit,
    source: row.source,
    direction: row.direction,
    testCode: row.testCode,
    sports: row.sports,
    description: row.description,
    catapultAliases: row.catapultAliases,
    isCanonical: row.isCanonical,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

export function registerCatalogRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listCatalogTests, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'read');
      const { clubId } = caller.membership;
      const onDate = query.onDate ?? (await clubToday(db));
      const plan = keysetPage(TEST_KEYS, query, { sport: query.sport, onDate });
      // `table` is one of the two aliases below, never input; the date is a parameter.
      const inForce = (table: 'test_definition' | 'other') => {
        const alias = sql.raw(table);
        return sql`(${alias}.valid_from <= ${onDate}::date and (${alias}.valid_to is null or ${alias}.valid_to > ${onDate}::date))`;
      };
      const rows: CatalogTestRow[] = await db
        .select({
          id: testDefinition.id,
          code: testDefinition.code,
          version: testDefinition.version,
          sports: testDefinition.sports,
          maximalLoad: testDefinition.maximalLoad,
          attemptCount: testDefinition.attemptCount,
          attemptAggregation: testDefinition.attemptAggregation,
          validFrom: testDefinition.validFrom,
          validTo: testDefinition.validTo,
          inForce: sql<boolean>`${inForce('test_definition')}`,
        })
        .from(testDefinition)
        .where(
          and(
            eq(testDefinition.clubId, clubId),
            // One row per code: the version in force that day, else the latest.
            sql`${testDefinition.id} = (
              select other.id from test_definition other
              where other.club_id = ${testDefinition.clubId} and other.code = ${testDefinition.code}
              order by ${inForce('other')} desc, other.version desc
              limit 1
            )`,
            appliesToSport(testDefinition.sports, query.sport),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);

      const ids = rows.map((row) => row.id);
      const metrics =
        ids.length === 0
          ? []
          : await db
              .select({
                testDefinitionId: testDefinitionMetric.testDefinitionId,
                code: metricDefinition.code,
              })
              .from(testDefinitionMetric)
              .innerJoin(
                metricDefinition,
                and(
                  eq(metricDefinition.clubId, testDefinitionMetric.clubId),
                  eq(metricDefinition.id, testDefinitionMetric.metricDefinitionId),
                ),
              )
              .where(
                and(
                  eq(testDefinitionMetric.clubId, clubId),
                  inArray(testDefinitionMetric.testDefinitionId, ids),
                ),
              )
              .orderBy(asc(testDefinitionMetric.sortOrder), asc(metricDefinition.code));
      const metricsOf = new Map<string, string[]>();
      for (const metric of metrics) {
        const list = metricsOf.get(metric.testDefinitionId) ?? [];
        list.push(metric.code);
        metricsOf.set(metric.testDefinitionId, list);
      }

      return plan.page(rows, (row): CatalogTest => ({
        code: row.code,
        testDefinitionId: row.id as CatalogTest['testDefinitionId'],
        protocolVersion: row.version,
        inForce: row.inForce,
        sports: row.sports,
        maximalLoad: row.maximalLoad,
        attemptCount: row.attemptCount,
        attemptAggregation: row.attemptAggregation,
        metricCodes: metricsOf.get(row.id) ?? [],
        validFrom: row.validFrom,
        validTo: row.validTo,
      }));
    },
  });

  registerEndpoint(app, listCatalogMetrics, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'read');
      const plan = keysetPage(METRIC_KEYS, query, {
        sport: query.sport,
        source: query.source,
        testCode: query.testCode,
        status: query.status,
      });
      const rows: CatalogMetricRow[] = await db
        .select({
          id: metricDefinition.id,
          code: metricDefinition.code,
          unit: metricDefinition.unit,
          source: metricDefinition.source,
          direction: metricDefinition.direction,
          testCode: metricDefinition.testCode,
          sports: metricDefinition.sports,
          description: metricDefinition.description,
          catapultAliases: metricDefinition.catapultAliases,
          isCanonical: metricDefinition.isCanonical,
          archivedAt: metricDefinition.archivedAt,
          createdAt: metricDefinition.createdAt,
          updatedAt: metricDefinition.updatedAt,
          version: rowVersion(metricDefinition.updatedAt),
        })
        .from(metricDefinition)
        .where(
          and(
            eq(metricDefinition.clubId, caller.membership.clubId),
            appliesToSport(metricDefinition.sports, query.sport),
            query.source === undefined ? undefined : eq(metricDefinition.source, query.source),
            query.testCode === undefined
              ? undefined
              : eq(metricDefinition.testCode, query.testCode),
            archiveStatusFilter(metricDefinition.archivedAt, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, metricDto);
    },
  });
}
