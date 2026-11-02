import {
  getAlert,
  listAlerts,
  reviewAlert,
  type AlertDetailDto,
  type AlertDto,
  type AlertEventDto,
} from '@sport-performance/contracts';
import {
  alert,
  alertEvent,
  alertRule,
  category,
  playerCategory,
} from '@sport-performance/db/schema';
import {
  alertMessageKey,
  alertReviewProblems,
  alertSuggestionKey,
  type AlertEventType,
  type AlertRuleKind,
  type AlertSeverity,
  type AlertStatus,
  type CategoryId,
  type ClubId,
  type LocalDate,
  type PlayerId,
  type Sport,
} from '@sport-performance/domain';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { requirePlayerFacts } from '../http/consents.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import { clubToday } from '../http/permissions.js';
import { rowVersion, updateAtVersion, versionMatches } from '../http/writes.js';

/**
 * Load alerts (B-327, ADR 0053): the worker generates the episodes from the
 * club's declarative rules; the API lists them by the scope of the
 * permission matrix (`alert.read`), shows each one with its history and lets
 * the staff review them (`alert.acknowledge`). Row-level security keeps
 * them to the staff that sees the player; players and guardians never see
 * alerts. The database only lets the API change the review columns, once
 * (`alert_review_guard`).
 */

const alertColumns = {
  id: alert.id,
  playerId: alert.playerId,
  ruleId: alert.alertRuleId,
  ruleCode: alertRule.code,
  kind: alert.kind,
  severity: alert.severity,
  currentSeverity: alert.currentSeverity,
  raisedOn: alert.localDate,
  lastSeenOn: alert.lastSeenOn,
  resolvedOn: alert.resolvedOn,
  observedOn: alert.observedOn,
  values: alert.values,
  status: alert.status,
  acknowledgedAt: alert.acknowledgedAt,
  acknowledgedBy: alert.acknowledgedBy,
  acknowledgementNote: alert.acknowledgementNote,
  createdAt: alert.createdAt,
  updatedAt: alert.updatedAt,
  version: rowVersion(alert.updatedAt),
};

interface AlertRow {
  id: string;
  playerId: PlayerId;
  ruleId: string;
  ruleCode: string;
  kind: AlertRuleKind;
  severity: AlertSeverity;
  currentSeverity: AlertSeverity;
  raisedOn: LocalDate;
  lastSeenOn: LocalDate;
  resolvedOn: LocalDate | null;
  observedOn: LocalDate;
  values: Readonly<Record<string, number>>;
  status: AlertStatus;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  acknowledgementNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function alertDto(row: AlertRow): AlertDto {
  return {
    id: row.id as AlertDto['id'],
    playerId: row.playerId,
    ruleId: row.ruleId as AlertDto['ruleId'],
    ruleCode: row.ruleCode,
    kind: row.kind,
    severity: row.severity,
    currentSeverity: row.currentSeverity,
    raisedOn: row.raisedOn,
    lastSeenOn: row.lastSeenOn,
    resolvedOn: row.resolvedOn,
    observedOn: row.observedOn,
    messageKey: alertMessageKey(row.kind),
    suggestionKey: alertSuggestionKey(row.kind),
    values: { ...row.values },
    status: row.status,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: row.acknowledgedBy as AlertDto['acknowledgedBy'],
    acknowledgementNote: row.acknowledgementNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const ALERT_KEYS: KeysetSpec<AlertRow, 'raisedOn' | 'lastSeenOn'> = {
  fields: {
    // `YYYY-MM-DD` sorts as text in calendar order.
    raisedOn: { column: sql`${alert.localDate}::text`, type: 'text', value: (row) => row.raisedOn },
    lastSeenOn: {
      column: sql`${alert.lastSeenOn}::text`,
      type: 'text',
      value: (row) => row.lastSeenOn,
    },
  },
  id: { column: alert.id, value: (row) => row.id },
};

const joinRule = and(eq(alertRule.clubId, alert.clubId), eq(alertRule.id, alert.alertRuleId));

async function readAlert(db: TenantDatabase, clubId: ClubId, alertId: string): Promise<AlertRow> {
  const [row] = await db
    .select(alertColumns)
    .from(alert)
    .innerJoin(alertRule, joinRule)
    .where(and(eq(alert.clubId, clubId), eq(alert.id, alertId)));
  if (row === undefined) throw new HttpError('not_found', 'Alert not found');
  return row;
}

async function readEvents(
  db: TenantDatabase,
  clubId: ClubId,
  alertId: string,
): Promise<AlertEventDto[]> {
  const rows = await db
    .select({
      seq: alertEvent.seq,
      type: alertEvent.type,
      localDate: alertEvent.localDate,
      severity: alertEvent.severity,
      note: alertEvent.note,
      actorId: alertEvent.actorId,
      createdAt: alertEvent.createdAt,
    })
    .from(alertEvent)
    .where(and(eq(alertEvent.clubId, clubId), eq(alertEvent.alertId, alertId)))
    .orderBy(asc(alertEvent.seq));
  return rows.map((row) => ({
    seq: row.seq,
    type: row.type satisfies AlertEventType,
    localDate: row.localDate,
    severity: row.severity,
    note: row.note,
    actorId: row.actorId as AlertEventDto['actorId'],
    createdAt: row.createdAt.toISOString(),
  }));
}

async function alertDetail(
  db: TenantDatabase,
  clubId: ClubId,
  row: AlertRow,
): Promise<AlertDetailDto> {
  return { ...alertDto(row), events: await readEvents(db, clubId, row.id) };
}

/** `valid_from <= day < valid_to` of a player's category (ADR 0023). */
function categoryCurrentOn(day: LocalDate): SQL {
  return sql`(${playerCategory.validFrom} <= ${day}::date and (${playerCategory.validTo} is null or ${playerCategory.validTo} > ${day}::date))`;
}

/** Alerts whose player's current category is in the assignments (as `app.visible_player_ids`). */
function assignedPlayers(
  today: LocalDate,
  categoryIds: readonly CategoryId[],
  sports: readonly Sport[],
): SQL {
  const target = or(
    categoryIds.length > 0 ? inArray(category.id, [...categoryIds]) : undefined,
    sports.length > 0 ? inArray(category.sport, [...sports]) : undefined,
  );
  return sql`exists (
    select 1 from ${playerCategory}
      join ${category} on ${category.clubId} = ${playerCategory.clubId}
                      and ${category.id} = ${playerCategory.categoryId}
     where ${playerCategory.clubId} = ${alert.clubId}
       and ${playerCategory.playerId} = ${alert.playerId}
       and ${categoryCurrentOn(today)}
       and ${target})`;
}

/** Alerts whose player is in `categoryId` today. */
function inCategoryToday(today: LocalDate, categoryId: CategoryId): SQL {
  return sql`exists (
    select 1 from ${playerCategory}
     where ${playerCategory.clubId} = ${alert.clubId}
       and ${playerCategory.playerId} = ${alert.playerId}
       and ${playerCategory.categoryId} = ${categoryId}
       and ${categoryCurrentOn(today)})`;
}

export function registerAlertRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listAlerts, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const scope = await permissions.listScope('alert', 'read');
      const plan = keysetPage(ALERT_KEYS, query, {
        playerId: query.playerId,
        categoryId: query.categoryId,
        state: query.state,
        status: query.status,
        severity: query.severity,
        kind: query.kind,
        from: query.from,
        to: query.to,
      });
      if (scope.kind === 'none') return { items: [], nextCursor: null };
      if (scope.rowCheck) {
        // `alert.read` has no consent or condition today; a new one needs a row check here.
        throw new Error('listAlerts: the matrix asks for a row check the list does not do');
      }
      const needsToday = scope.kind === 'assigned' || query.categoryId !== undefined;
      const today = needsToday ? await clubToday(db) : null;
      let inScope: SQL | undefined;
      switch (scope.kind) {
        case 'club':
          inScope = undefined;
          break;
        case 'assigned':
          inScope = assignedPlayers(today ?? never(), scope.categoryIds, scope.sports);
          break;
        case 'players':
          inScope = inArray(alert.playerId, [...scope.playerIds]);
          break;
        case 'platform':
          // No rule of `alert.read` is platform-wide: deny instead of guessing.
          return { items: [], nextCursor: null };
      }
      const rows = await db
        .select(alertColumns)
        .from(alert)
        .innerJoin(alertRule, joinRule)
        .where(
          and(
            eq(alert.clubId, caller.membership.clubId),
            inScope,
            query.playerId === undefined ? undefined : eq(alert.playerId, query.playerId),
            query.categoryId === undefined
              ? undefined
              : inCategoryToday(today ?? never(), query.categoryId),
            query.state === 'active' ? isNull(alert.resolvedOn) : undefined,
            query.state === 'resolved' ? isNotNull(alert.resolvedOn) : undefined,
            query.status === undefined ? undefined : eq(alert.status, query.status),
            query.severity === undefined ? undefined : eq(alert.severity, query.severity),
            query.kind === undefined ? undefined : eq(alert.kind, query.kind),
            query.from === undefined ? undefined : gte(alert.localDate, query.from),
            query.to === undefined ? undefined : lte(alert.localDate, query.to),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, alertDto);
    },
  });

  registerEndpoint(app, getAlert, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await readAlert(db, clubId, params.alertId);
      const { facts } = await requirePlayerFacts(db, clubId, row.playerId);
      await permissions.authorize('alert', 'read', { player: facts });
      return alertDetail(db, clubId, row);
    },
  });

  registerEndpoint(app, reviewAlert, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await readAlert(db, clubId, params.alertId);
      const { facts } = await requirePlayerFacts(db, clubId, row.playerId);
      await permissions.authorize('alert', 'acknowledge', { player: facts });
      const note = body.note ?? null;
      const problems = alertReviewProblems({
        currentStatus: row.status,
        status: body.status,
        note,
      });
      if (problems.includes('not_open')) {
        throw new HttpError('conflict', 'The alert was already reviewed');
      }
      if (problems.includes('note_required')) {
        throw new HttpError('validation_failed', 'A dismissal says why', {
          details: [{ path: ['body', 'note'], code: 'custom', message: 'Required to dismiss' }],
        });
      }
      const updated = await updateAtVersion({
        resource: 'Alert',
        update: async () => {
          const [changed] = await db
            .update(alert)
            .set({
              status: body.status,
              // The database stamps the time (`alert_review_guard`).
              acknowledgedAt: sql`now()`,
              acknowledgedBy: caller.userId,
              acknowledgementNote: note,
              updatedBy: caller.userId,
            })
            .where(
              and(
                eq(alert.clubId, clubId),
                eq(alert.id, row.id),
                eq(alert.status, 'open'),
                versionMatches(alert.updatedAt, body.version),
              ),
            )
            .returning({ id: alert.id });
          return changed;
        },
        exists: async () =>
          (
            await db
              .select({ id: alert.id })
              .from(alert)
              .where(and(eq(alert.clubId, clubId), eq(alert.id, row.id)))
          ).length > 0,
      });
      return alertDetail(db, clubId, await readAlert(db, clubId, updated.id));
    },
  });
}

function never(): never {
  throw new Error('alerts: the club day was not loaded');
}
