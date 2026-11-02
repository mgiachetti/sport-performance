import {
  createAlertRule,
  getAlertRule,
  listAlertRules,
  updateAlertRule,
  type AlertRuleDto,
} from '@sport-performance/contracts';
import { alertRule } from '@sport-performance/db/schema';
import {
  AlertRuleValidationError,
  DEFAULT_ALERT_RULES,
  parseAlertRule,
  type AlertRule,
  type AlertRuleKind,
  type AlertRuleScope,
  type ClubId,
  type Sex,
  type Sport,
  type Stage,
} from '@sport-performance/domain';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import { insertIdempotent, rowVersion, updateAtVersion, versionMatches } from '../http/writes.js';
import { validationError } from './configuration-shared.js';

/**
 * Editable alert rules (B-207, B-322): every rule written goes through the
 * domain's `parseAlertRule`, the same parser the engine trusts. The API has
 * no rule of its own: the defaults are seeded (`DEFAULT_ALERT_RULES`).
 */

const DEFAULT_CODES: ReadonlySet<string> = new Set(DEFAULT_ALERT_RULES.map((rule) => rule.code));

const ruleColumns = {
  id: alertRule.id,
  code: alertRule.code,
  kind: alertRule.kind,
  enabled: alertRule.enabled,
  sports: alertRule.sports,
  sexes: alertRule.sexes,
  stages: alertRule.stages,
  params: alertRule.params,
  createdAt: alertRule.createdAt,
  updatedAt: alertRule.updatedAt,
  version: rowVersion(alertRule.updatedAt),
};

interface RuleRow {
  id: string;
  code: string;
  kind: AlertRuleKind;
  enabled: boolean;
  sports: Sport[] | null;
  sexes: Sex[] | null;
  stages: Stage[] | null;
  params: AlertRule['params'];
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function scopeOf(row: Pick<RuleRow, 'sports' | 'sexes' | 'stages'>): AlertRuleScope {
  return {
    ...(row.sports !== null && { sports: row.sports }),
    ...(row.sexes !== null && { sexes: row.sexes }),
    ...(row.stages !== null && { stages: row.stages }),
  };
}

function scopeColumns(scope: AlertRuleScope | undefined) {
  return {
    sports: scope?.sports === undefined ? null : [...scope.sports],
    sexes: scope?.sexes === undefined ? null : [...scope.sexes],
    stages: scope?.stages === undefined ? null : [...scope.stages],
  };
}

function ruleDto(row: RuleRow): AlertRuleDto {
  return {
    id: row.id as AlertRuleDto['id'],
    code: row.code,
    kind: row.kind,
    enabled: row.enabled,
    appliesTo: scopeOf(row),
    params: row.params,
    isDefault: DEFAULT_CODES.has(row.code),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  } as AlertRuleDto;
}

const RULE_KEYS: KeysetSpec<RuleRow, 'code' | 'createdAt'> = {
  fields: {
    code: { column: alertRule.code, type: 'text', value: (row) => row.code },
    createdAt: { column: alertRule.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: alertRule.id, value: (row) => row.id },
};

/** `params.warningAboveRatio` / `appliesTo.sports[0]` → `['params', 'warningAboveRatio']`. */
export function ruleIssuePath(path: string): (string | number)[] {
  const segments: (string | number)[] = [];
  for (const part of path.split('.')) {
    if (part === '') continue;
    const match = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (match === null) {
      segments.push(part);
      continue;
    }
    if (match[1] !== undefined && match[1] !== '') segments.push(match[1]);
    for (const index of (match[2] ?? '').matchAll(/\[(\d+)\]/g)) segments.push(Number(index[1]));
  }
  return segments;
}

/** The rule, validated by the domain; its problems are `400` on the field. */
function parsedRule(candidate: unknown): AlertRule {
  try {
    return parseAlertRule(candidate);
  } catch (error) {
    if (error instanceof AlertRuleValidationError) {
      throw validationError(error.message, ['body', ...ruleIssuePath(error.path)], error.message);
    }
    throw error;
  }
}

async function readRule(db: TenantDatabase, clubId: ClubId, id: string): Promise<RuleRow> {
  const [row] = await db
    .select(ruleColumns)
    .from(alertRule)
    .where(and(eq(alertRule.clubId, clubId), eq(alertRule.id, id)));
  if (row === undefined) throw new HttpError('not_found', 'Alert rule not found');
  return row;
}

async function authorizedRule(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  id: string,
  action: 'read' | 'update',
): Promise<RuleRow> {
  await permissions.authorize('configuration', action);
  return readRule(db, clubId, id);
}

export function registerAlertRuleRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listAlertRules, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('configuration', 'read');
      const plan = keysetPage(RULE_KEYS, query, { kind: query.kind, enabled: query.enabled });
      const rows = await db
        .select(ruleColumns)
        .from(alertRule)
        .where(
          and(
            eq(alertRule.clubId, caller.membership.clubId),
            query.kind === undefined ? undefined : eq(alertRule.kind, query.kind),
            query.enabled === undefined
              ? undefined
              : eq(alertRule.enabled, query.enabled === 'true'),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, ruleDto);
    },
  });

  registerEndpoint(app, getAlertRule, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) =>
      ruleDto(
        await authorizedRule(db, permissions, caller.membership.clubId, params.alertRuleId, 'read'),
      ),
  });

  registerEndpoint(app, createAlertRule, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('configuration', 'update');
      const { clubId } = caller.membership;
      const rule = parsedRule({
        code: body.code,
        kind: body.kind,
        enabled: body.enabled ?? true,
        ...(body.appliesTo !== undefined && { appliesTo: body.appliesTo }),
        params: body.params,
      });
      const { row } = await insertIdempotent({
        clientUuid: body.clientUuid,
        reply,
        insert: async () =>
          (
            await db
              .insert(alertRule)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                code: rule.code,
                kind: rule.kind,
                enabled: rule.enabled,
                ...scopeColumns(rule.appliesTo),
                params: rule.params,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [alertRule.clubId, alertRule.clientUuid] })
              .returning(ruleColumns)
          )[0],
        findByClientUuid: async (clientUuid) =>
          (
            await db
              .select(ruleColumns)
              .from(alertRule)
              .where(and(eq(alertRule.clubId, clubId), eq(alertRule.clientUuid, clientUuid)))
          )[0],
      });
      return ruleDto(row);
    },
  });

  registerEndpoint(app, updateAlertRule, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const current = await authorizedRule(db, permissions, clubId, params.alertRuleId, 'update');
      // `null` clears the scope (everyone); absent keeps the stored one.
      const appliesTo =
        body.appliesTo === undefined ? scopeOf(current) : (body.appliesTo ?? undefined);
      const rule = parsedRule({
        code: current.code,
        kind: current.kind,
        enabled: body.enabled ?? current.enabled,
        ...(appliesTo !== undefined && Object.keys(appliesTo).length > 0 && { appliesTo }),
        params: body.params ?? current.params,
      });
      const where = and(eq(alertRule.clubId, clubId), eq(alertRule.id, current.id));
      const row = await updateAtVersion({
        resource: 'Alert rule',
        update: async () =>
          (
            await db
              .update(alertRule)
              .set({
                enabled: rule.enabled,
                ...scopeColumns(rule.appliesTo),
                params: rule.params,
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(alertRule.updatedAt, body.version)))
              .returning(ruleColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: alertRule.id }).from(alertRule).where(where)).length > 0,
      });
      return ruleDto(row);
    },
  });
}
