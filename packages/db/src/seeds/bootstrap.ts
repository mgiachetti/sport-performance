import {
  DEFAULT_AGE_BANDS,
  DEFAULT_ALERT_RULES,
  DEFAULT_POSITION_LINES,
  DEFAULT_SPEED_ZONE_SETS,
  SPEED_ZONE_KINDS,
  defaultCategoryName,
  isLocalDate,
  isSex,
  isSport,
  isUuid,
  parseAlertRuleSet,
  validateSpeedZoneConfig,
  type ClubId,
  type LocalDate,
  type Sex,
  type Sport,
} from '@sport-performance/domain';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { alertRule } from '../schema/alerts.js';
import {
  batteryConfig,
  metricDefinition,
  speedZoneConfig,
  testDefinition,
  testDefinitionMetric,
} from '../schema/catalog.js';
import { khamisRocheCoefficient, khamisRocheTable } from '../schema/maturation.js';
import { category, clubBranch, position } from '../schema/organization.js';
import { consentDocument } from '../schema/players.js';
import { club } from '../schema/tenant.js';
import { batterySeeds } from './battery.js';
import { consentDocumentSeeds } from './consent-documents.js';
import type { SeedExecutor } from './executor.js';
import {
  SEEDED_KHAMIS_ROCHE_TABLES,
  khamisRocheCoefficientSeeds,
  khamisRocheTableSeed,
} from './khamis-roche.js';
import { metricDefinitionSeeds } from './metrics.js';
import {
  SEEDED_PROTOCOL_VERSION,
  isDerivedTestMetric,
  testDefinitionSeeds,
} from './test-definitions.js';

/**
 * Club bootstrap (B-306): the default configuration of a new club, seeded
 * from the domain. Called by the CLI (`db:seed`) and by club creation
 * (B-313) inside its own transaction.
 *
 * **Idempotent and conservative.** Re-running inserts only what is missing
 * and never updates a row, so the club's edits survive: a disabled alert
 * rule stays disabled, a renamed category is not added again, a closed and
 * replaced speed-zone row or battery row is not reopened. Rows are matched by
 * their natural key (code, sport and code, sport + sex + age band…), not by
 * id.
 */

/** A program of the club: a sport and its branch (ADR 0017). ORC: rugby male, hockey female. */
export interface ClubBranch {
  readonly sport: Sport;
  readonly sex: Sex;
}

export interface BootstrapClubOptions {
  readonly clubId: ClubId;
  /** At least one; duplicates are rejected. */
  readonly branches: readonly ClubBranch[];
  /**
   * First day of the seeded protocol versions, battery and speed zones.
   * Defaults to {@link DEFAULT_SEED_VALID_FROM}, so historical results and
   * imported sessions of past seasons resolve to the seeded configuration.
   */
  readonly validFrom?: LocalDate;
  /**
   * Why a superadmin seeds the club (ADR 0029): recorded as the support
   * access to the club when the transaction acts as `superadmin` and has
   * not recorded one for this club yet. The API passes the operator's
   * `X-Support-Reason`; without one, {@link DEFAULT_BOOTSTRAP_SUPPORT_REASON}.
   */
  readonly supportReason?: string;
}

/** Support reason of a superadmin bootstrap that did not say why (scripts, tests). */
export const DEFAULT_BOOTSTRAP_SUPPORT_REASON = 'Configuración inicial del club (bootstrap)';

/** Inserted rows per table. All zero when the club was already bootstrapped. */
export interface BootstrapClubReport {
  readonly branches: number;
  readonly metricDefinitions: number;
  readonly testDefinitions: number;
  readonly testDefinitionMetrics: number;
  readonly positions: number;
  readonly categories: number;
  readonly batteryConfigs: number;
  readonly alertRules: number;
  readonly speedZoneConfigs: number;
  readonly khamisRocheTables: number;
  readonly khamisRocheCoefficients: number;
  readonly consentDocuments: number;
}

/** Long before any club's first imported season. */
export const DEFAULT_SEED_VALID_FROM = '2000-01-01' as LocalDate;

/** Namespace of the per-club advisory lock that serialises bootstraps. */
const BOOTSTRAP_LOCK_NAMESPACE = 306;

export class BootstrapClubError extends Error {
  override readonly name = 'BootstrapClubError';
}

function validateOptions(options: BootstrapClubOptions): LocalDate {
  if (!isUuid(options.clubId)) throw new BootstrapClubError('clubId must be a UUID.');
  if (options.branches.length === 0) {
    throw new BootstrapClubError('A club needs at least one branch (sport and sex).');
  }
  const seen = new Set<string>();
  for (const branch of options.branches) {
    if (!isSport(branch.sport) || !isSex(branch.sex)) {
      throw new BootstrapClubError(`Invalid branch: ${JSON.stringify(branch)}.`);
    }
    const key = `${branch.sport}:${branch.sex}`;
    if (seen.has(key)) throw new BootstrapClubError(`Duplicate branch: ${key}.`);
    seen.add(key);
  }
  const reason = options.supportReason;
  if (reason !== undefined && (reason.trim() === '' || reason.length > 500)) {
    throw new BootstrapClubError('supportReason must be 1 to 500 characters.');
  }
  const validFrom = options.validFrom ?? DEFAULT_SEED_VALID_FROM;
  if (!isLocalDate(validFrom))
    throw new BootstrapClubError(`Invalid validFrom: ${String(validFrom)}.`);
  return validFrom;
}

/**
 * Seeds the default configuration of a club. Runs in a transaction (a
 * savepoint when `db` already is one), serialised per club with an advisory
 * lock, and sets `app.club_id` for the transaction (ADR 0006) so it works
 * under the tenant's row-level security. The branches are recorded in
 * `club_branch` (an archived one is not reopened); enabling a branch later
 * is calling it again with that branch.
 */
export async function bootstrapClub(
  db: SeedExecutor,
  options: BootstrapClubOptions,
): Promise<BootstrapClubReport> {
  const validFrom = validateOptions(options);
  const { clubId, branches } = options;
  const sports = [...new Set(branches.map((b) => b.sport))];

  // Validate the domain defaults before writing anything.
  const alertRules = parseAlertRuleSet(DEFAULT_ALERT_RULES);
  for (const kind of SPEED_ZONE_KINDS) {
    validateSpeedZoneConfig({
      clubId,
      sport: null,
      sex: null,
      playerId: null,
      validFrom,
      validTo: null,
      zoneSet: DEFAULT_SPEED_ZONE_SETS[kind],
    });
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.club_id', ${clubId}, true)`);
    // A superadmin creating the club (B-313) acts in it from here on: the support access
    // to the new club is recorded first, or `app.current_role()` does not grant it (ADR 0029).
    // Already recorded in this transaction (a superadmin supporting the club enables a
    // branch): `app.current_role()` grants it, and a second entry would only repeat it.
    const reason = options.supportReason ?? DEFAULT_BOOTSTRAP_SUPPORT_REASON;
    await tx.execute(
      sql`select app.begin_support_access(${reason})
           where current_setting('app.role', true) = 'superadmin'
             and app.current_role() is distinct from 'superadmin'`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_NAMESPACE}, hashtext(${clubId}))`,
    );
    const [existing] = await tx
      .select({ id: club.id, name: club.name })
      .from(club)
      .where(eq(club.id, clubId));
    if (existing === undefined) throw new BootstrapClubError(`Club ${clubId} does not exist.`);

    // Branches (sport + sex) the categories hang from. An archived branch stays archived.
    const insertedBranches = await tx
      .insert(clubBranch)
      .values(branches.map((b) => ({ clubId, sport: b.sport, sex: b.sex })))
      .onConflictDoNothing({ target: [clubBranch.clubId, clubBranch.sport, clubBranch.sex] })
      .returning({ id: clubBranch.id });

    // Metric dictionary.
    const metrics = await tx
      .insert(metricDefinition)
      .values(metricDefinitionSeeds().map((m) => ({ ...m, clubId })))
      .onConflictDoNothing({ target: [metricDefinition.clubId, metricDefinition.code] })
      .returning({ id: metricDefinition.id });

    // Test definitions (protocol version 1) and, for the ones created now, their metrics.
    const tests = testDefinitionSeeds();
    const insertedTests = await tx
      .insert(testDefinition)
      .values(
        tests.map((t) => ({
          clubId,
          code: t.code,
          version: SEEDED_PROTOCOL_VERSION,
          sports: t.sports === null ? null : [...t.sports],
          attemptCount: t.attemptCount,
          attemptAggregation: t.attemptAggregation,
          maximalLoad: t.maximalLoad,
          protocol: t.protocol,
          validFrom,
        })),
      )
      .onConflictDoNothing({
        target: [testDefinition.clubId, testDefinition.code, testDefinition.version],
      })
      .returning({ id: testDefinition.id, code: testDefinition.code });

    let testDefinitionMetrics = 0;
    if (insertedTests.length > 0) {
      const metricIds = new Map(
        (
          await tx
            .select({ id: metricDefinition.id, code: metricDefinition.code })
            .from(metricDefinition)
            .where(eq(metricDefinition.clubId, clubId))
        ).map((m) => [m.code, m.id]),
      );
      const links = insertedTests.flatMap((inserted) => {
        const seed = tests.find((t) => t.code === inserted.code);
        return (seed?.metrics ?? []).flatMap((code, index) => {
          const metricDefinitionId = metricIds.get(code);
          if (metricDefinitionId === undefined) return [];
          return [
            {
              clubId,
              testDefinitionId: inserted.id,
              metricDefinitionId,
              sortOrder: index,
              isDerived: isDerivedTestMetric(code),
            },
          ];
        });
      });
      if (links.length > 0) {
        const insertedLinks = await tx
          .insert(testDefinitionMetric)
          .values(links)
          .onConflictDoNothing()
          .returning({ id: testDefinitionMetric.id });
        testDefinitionMetrics = insertedLinks.length;
      }
    }

    // Positions of the club's sports.
    const positionRows = DEFAULT_POSITION_LINES.filter((p) =>
      (sports as readonly string[]).includes(p.sport),
    ).map((p, index) => ({
      clubId,
      sport: p.sport,
      code: p.positionCode,
      lineCode: p.lineCode,
      sortOrder: index,
    }));
    const positions =
      positionRows.length === 0
        ? []
        : await tx
            .insert(position)
            .values(positionRows)
            .onConflictDoNothing({ target: [position.clubId, position.sport, position.code] })
            .returning({ id: position.id });

    // Categories: one per default age band and branch, unless the club already
    // has a category of that band (whatever its name).
    const existingCategories = new Set(
      (
        await tx
          .select({ sport: category.sport, sex: category.sex, band: category.ageBandCode })
          .from(category)
          .where(eq(category.clubId, clubId))
      ).map((c) => `${c.sport}:${c.sex}:${c.band}`),
    );
    const categoryRows = branches.flatMap((branch) =>
      DEFAULT_AGE_BANDS.filter(
        (band) => !existingCategories.has(`${branch.sport}:${branch.sex}:${band.code}`),
      ).map((band) => ({
        clubId,
        sport: branch.sport,
        sex: branch.sex,
        ageBandCode: band.code,
        name: defaultCategoryName(branch.sport, band.code),
        defaultStage: band.defaultStage,
        sortOrder: DEFAULT_AGE_BANDS.indexOf(band),
      })),
    );
    const categories =
      categoryRows.length === 0
        ? []
        : await tx
            .insert(category)
            .values(categoryRows)
            .onConflictDoNothing({
              target: [category.clubId, category.sport, category.sex, category.name],
            })
            .returning({ id: category.id });

    // Battery: club-wide rows per branch and stage, unless the club already
    // has a club-wide row (current or closed) for that scope and test.
    const existingBattery = new Set(
      (
        await tx
          .select({
            sport: batteryConfig.sport,
            sex: batteryConfig.sex,
            stage: batteryConfig.stage,
            testCode: batteryConfig.testCode,
          })
          .from(batteryConfig)
          .where(and(eq(batteryConfig.clubId, clubId), isNull(batteryConfig.categoryId)))
      ).map((b) => `${b.sport}:${String(b.sex)}:${String(b.stage)}:${b.testCode}`),
    );
    const batteryRows = branches
      .flatMap((branch) => batterySeeds(branch.sport, branch.sex))
      .filter((b) => !existingBattery.has(`${b.sport}:${b.sex}:${b.stage}:${b.testCode}`))
      .map((b) => ({
        clubId,
        sport: b.sport,
        sex: b.sex,
        stage: b.stage,
        testCode: b.testCode,
        windows: [...b.windows],
        cadenceWeeksMin: b.cadenceWeeksMin,
        cadenceWeeksMax: b.cadenceWeeksMax,
        validFrom,
      }));
    if (batteryRows.length > 0) await tx.insert(batteryConfig).values(batteryRows);

    // Alert rules (validated above with the domain parser).
    const insertedRules = await tx
      .insert(alertRule)
      .values(
        alertRules.map((rule) => ({
          clubId,
          code: rule.code,
          kind: rule.kind,
          enabled: rule.enabled,
          sports: rule.appliesTo?.sports === undefined ? null : [...rule.appliesTo.sports],
          sexes: rule.appliesTo?.sexes === undefined ? null : [...rule.appliesTo.sexes],
          stages: rule.appliesTo?.stages === undefined ? null : [...rule.appliesTo.stages],
          params: rule.params,
        })),
      )
      .onConflictDoNothing({ target: [alertRule.clubId, alertRule.code] })
      .returning({ id: alertRule.id });

    // Speed zones: one club-wide row per kind, unless the club has any.
    const existingZoneKinds = new Set(
      (
        await tx
          .select({ kind: speedZoneConfig.kind })
          .from(speedZoneConfig)
          .where(
            and(
              eq(speedZoneConfig.clubId, clubId),
              isNull(speedZoneConfig.sport),
              isNull(speedZoneConfig.sex),
              isNull(speedZoneConfig.playerId),
            ),
          )
      ).map((z) => z.kind),
    );
    const zoneRows = SPEED_ZONE_KINDS.filter((kind) => !existingZoneKinds.has(kind)).map(
      (kind) => ({
        clubId,
        sport: null,
        sex: null,
        playerId: null,
        kind,
        zoneSet: DEFAULT_SPEED_ZONE_SETS[kind],
        validFrom,
      }),
    );
    if (zoneRows.length > 0) await tx.insert(speedZoneConfig).values(zoneRows);

    // Khamis-Roche coefficient tables (reference data, copied from the domain).
    let khamisRocheTables = 0;
    let khamisRocheCoefficients = 0;
    for (const table of SEEDED_KHAMIS_ROCHE_TABLES) {
      const [inserted] = await tx
        .insert(khamisRocheTable)
        .values({ ...khamisRocheTableSeed(table), clubId })
        .onConflictDoNothing({ target: [khamisRocheTable.clubId, khamisRocheTable.code] })
        .returning({ id: khamisRocheTable.id });
      if (inserted === undefined) continue;
      khamisRocheTables += 1;
      const rows = await tx
        .insert(khamisRocheCoefficient)
        .values(
          khamisRocheCoefficientSeeds(table).map((row) => ({
            ...row,
            clubId,
            tableId: inserted.id,
          })),
        )
        .returning({ id: khamisRocheCoefficient.id });
      khamisRocheCoefficients += rows.length;
    }

    // Consent texts (B-312): one per type the club has no text of yet. Published texts are
    // immutable; the club publishes new versions, these are never rewritten.
    const existingConsentTypes = new Set(
      (
        await tx
          .select({ type: consentDocument.type })
          .from(consentDocument)
          .where(eq(consentDocument.clubId, clubId))
      ).map((d) => d.type),
    );
    const consentRows = consentDocumentSeeds(existing.name)
      .filter((d) => !existingConsentTypes.has(d.type))
      .map((d) => ({ ...d, clubId }));
    const consentDocuments =
      consentRows.length === 0
        ? []
        : await tx
            .insert(consentDocument)
            .values(consentRows)
            .onConflictDoNothing({
              target: [consentDocument.clubId, consentDocument.type, consentDocument.version],
            })
            .returning({ id: consentDocument.id });

    return {
      branches: insertedBranches.length,
      metricDefinitions: metrics.length,
      testDefinitions: insertedTests.length,
      testDefinitionMetrics,
      positions: positions.length,
      categories: categories.length,
      batteryConfigs: batteryRows.length,
      alertRules: insertedRules.length,
      speedZoneConfigs: zoneRows.length,
      khamisRocheTables,
      khamisRocheCoefficients,
      consentDocuments: consentDocuments.length,
    };
  });
}

/** Sum of a report, handy for logs and "nothing to do" checks. */
export function totalInserted(report: BootstrapClubReport): number {
  const counts: readonly number[] = Object.values(report);
  return counts.reduce((sum, n) => sum + n, 0);
}
