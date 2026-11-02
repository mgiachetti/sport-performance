import {
  CANONICAL_METRIC_CODES,
  CANONICAL_TEST_CODES,
  DEFAULT_AGE_BANDS,
  DEFAULT_ALERT_RULES,
  DEFAULT_SPEED_ZONE_SETS,
  KHAMIS_ROCHE_1994_TABLE,
  parseAlertRule,
  predictAdultHeight,
  validateSpeedZoneSet,
  type ClubId,
  type LocalDate,
} from '@sport-performance/domain';
import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alertRule,
  batteryConfig,
  category,
  club,
  khamisRocheCoefficient,
  khamisRocheTable,
  metricDefinition,
  position,
  speedZoneConfig,
  testDefinition,
  testDefinitionMetric,
  user,
} from '../schema/index.js';
import { createDatabase } from '../client.js';
import { TENANT_SETTING_NAMES } from '../roles.js';
import {
  connectAs,
  createMigratedDatabase,
  hasDatabase,
  must,
  type MigratedTestDatabase,
} from '../testing/database.js';
import {
  BootstrapClubError,
  ORC_TENANT,
  bootstrapClub,
  loadKhamisRocheTable,
  runSeed,
  seedTenant,
  totalInserted,
  type BootstrapClubReport,
} from './index.js';

/** Club tables written by the bootstrap. */
const SEEDED_TABLES = [
  'metric_definition',
  'test_definition',
  'test_definition_metric',
  'position',
  'category',
  'battery_config',
  'alert_rule',
  'speed_zone_config',
  'khamis_roche_table',
  'khamis_roche_coefficient',
] as const;

describe.skipIf(!hasDatabase)('seeds (Postgres 16)', () => {
  let t: MigratedTestDatabase;
  let orc: ClubId;
  let firstReport: BootstrapClubReport;

  /** Rows and latest `updated_at` per seeded table of a club, to prove a re-run is a no-op. */
  async function snapshot(clubId: ClubId) {
    const result: Record<string, { rows: number; maxUpdatedAt: string | null }> = {};
    for (const table of SEEDED_TABLES) {
      const { rows } = await t.pool.query<{ rows: string; max: string | null }>(
        `select count(*)::text as rows, max(updated_at)::text as max from "${table}" where club_id = $1`,
        [clubId],
      );
      const [row] = rows;
      result[table] = { rows: Number(row?.rows), maxUpdatedAt: row?.max ?? null };
    }
    return result;
  }

  beforeAll(async () => {
    t = await createMigratedDatabase();
    const result = await seedTenant(t.db, ORC_TENANT);
    expect(result.created).toBe(true);
    orc = result.clubId;
    firstReport = result.report;
  });

  afterAll(async () => {
    await t.close();
  });

  it('creates the ORC club with its zone and brand', async () => {
    const [row] = await t.db.select().from(club).where(eq(club.id, orc));
    expect(row).toMatchObject({
      slug: 'orc',
      name: 'Olivos Rugby Club',
      timeZone: 'America/Argentina/Buenos_Aires',
    });
    expect(row).toMatchObject({
      shortName: 'ORC',
      locale: 'es-AR',
      primaryColor: '#f1882a',
      secondaryColor: '#050505',
      logoFileId: null,
    });
  });

  it('seeds the whole metric dictionary with Catapult aliases', async () => {
    const rows = await t.db.select().from(metricDefinition).where(eq(metricDefinition.clubId, orc));
    expect(rows.map((r) => r.code).sort()).toEqual([...CANONICAL_METRIC_CODES].sort());
    expect(rows.every((r) => r.isCanonical)).toBe(true);
    const dist = rows.find((r) => r.code === 'dist_m');
    expect(dist).toMatchObject({ unit: 'm', source: 'field', sports: null });
    expect(dist?.catapultAliases).toContain('Total Distance');
    expect(rows.find((r) => r.code === 'scrums_n')?.sports).toEqual(['rugby']);
    expect(rows.find((r) => r.code === 'cmj_height_cm')).toMatchObject({
      testCode: 'cmj',
      unit: 'cm',
    });
  });

  it('seeds version 1 of every test with its protocol and metrics', async () => {
    const tests = await t.db.select().from(testDefinition).where(eq(testDefinition.clubId, orc));
    expect(tests.map((r) => r.code).sort()).toEqual([...CANONICAL_TEST_CODES].sort());
    expect(tests.every((r) => r.version === 1 && r.validTo === null)).toBe(true);
    const sprint = must(tests.find((r) => r.code === 'sprint_40'));
    expect(sprint).toMatchObject({ attemptCount: 3, attemptAggregation: 'best' });
    expect(sprint.protocol.restBetweenAttemptsS).toBe(180);
    expect(sprint.protocol.parameters).toMatchObject({ vmaxFromM: 20, vmaxToM: 40 });

    const links = await t.db
      .select({ metric: metricDefinition.code, derived: testDefinitionMetric.isDerived })
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
          eq(testDefinitionMetric.clubId, orc),
          eq(testDefinitionMetric.testDefinitionId, sprint.id),
        ),
      )
      .orderBy(testDefinitionMetric.sortOrder);
    expect(links).toEqual([
      { metric: 'sprint_10_s', derived: false },
      { metric: 'sprint_20_s', derived: false },
      { metric: 'sprint_40_s', derived: false },
      { metric: 'sprint_vmax_ms', derived: true },
    ]);
  });

  it('seeds rugby and hockey positions with their lines', async () => {
    const rows = await t.db.select().from(position).where(eq(position.clubId, orc));
    expect(rows.find((r) => r.sport === 'rugby' && r.code === 'hooker')?.lineCode).toBe('forwards');
    expect(rows.find((r) => r.sport === 'hockey' && r.code === 'goalkeeper')?.lineCode).toBe(
      'goalkeepers',
    );
    expect(rows.filter((r) => r.sport === 'hockey')).toHaveLength(4);
  });

  it('seeds M13–M19 for men’s rugby and women’s hockey', async () => {
    const rows = await t.db.select().from(category).where(eq(category.clubId, orc));
    for (const [sport, sex] of [
      ['rugby', 'male'],
      ['hockey', 'female'],
    ] as const) {
      const branch = rows.filter((r) => r.sport === sport && r.sex === sex);
      expect(branch.map((r) => r.ageBandCode).sort()).toEqual(
        DEFAULT_AGE_BANDS.map((b) => b.code).sort(),
      );
      expect(branch.find((r) => r.ageBandCode === 'm15')?.defaultStage).toBe('development');
    }
    expect(rows.some((r) => r.sport === 'rugby' && r.sex === 'female')).toBe(false);
  });

  it('seeds the battery per branch and stage', async () => {
    const rows = await t.db.select().from(batteryConfig).where(eq(batteryConfig.clubId, orc));
    const find = (sport: string, stage: string, test: string) =>
      rows.find((r) => r.sport === sport && r.stage === stage && r.testCode === test);
    expect(find('rugby', 'foundation', 'cod_505')).toMatchObject({ sex: 'male', windows: [1, 3] });
    expect(find('hockey', 'performance', 'cmj')).toMatchObject({
      sex: 'female',
      windows: [1, 2, 3, 4],
      cadenceWeeksMin: 1,
      cadenceWeeksMax: 1,
    });
    expect(find('rugby', 'performance', 'bronco')).toBeDefined();
    expect(find('hockey', 'performance', 'bronco')).toBeUndefined();
    expect(rows.every((r) => r.categoryId === null && r.validTo === null)).toBe(true);
  });

  it('seeds the default alert rules as valid domain rules', async () => {
    const rows = await t.db.select().from(alertRule).where(eq(alertRule.clubId, orc));
    expect(rows.map((r) => r.code).sort()).toEqual(DEFAULT_ALERT_RULES.map((r) => r.code).sort());
    for (const row of rows) {
      const rule = parseAlertRule({
        code: row.code,
        kind: row.kind,
        enabled: row.enabled,
        params: row.params,
      });
      expect(rule).toEqual(DEFAULT_ALERT_RULES.find((r) => r.code === row.code));
    }
  });

  it('seeds club-wide absolute and relative speed zones', async () => {
    const rows = await t.db.select().from(speedZoneConfig).where(eq(speedZoneConfig.clubId, orc));
    expect(rows.map((r) => r.kind).sort()).toEqual(['absolute', 'relative']);
    for (const row of rows) {
      expect(row).toMatchObject({ sport: null, sex: null, playerId: null, validTo: null });
      validateSpeedZoneSet(row.zoneSet);
      expect(row.zoneSet).toEqual(DEFAULT_SPEED_ZONE_SETS[row.kind]);
    }
  });

  it('stores Khamis-Roche as data and predicts the same as the domain table', async () => {
    const table = must(await loadKhamisRocheTable(t.db, orc));
    expect(table.code).toBe(KHAMIS_ROCHE_1994_TABLE.code);
    expect(table.provenance).toEqual(KHAMIS_ROCHE_1994_TABLE.provenance);
    expect(table.rows).toEqual(KHAMIS_ROCHE_1994_TABLE.rows);
    const input = {
      sex: 'male',
      ageYears: 13.3,
      heightCm: 160,
      weightKg: 48,
      motherHeightCm: 165,
      fatherHeightCm: 180,
    } as const;
    expect(predictAdultHeight(input, { table })).toEqual(predictAdultHeight(input));
    expect(await loadKhamisRocheTable(t.db, orc, 'unknown_table')).toBeUndefined();
  });

  it('reports what it inserted the first time', () => {
    expect(firstReport.metricDefinitions).toBe(CANONICAL_METRIC_CODES.length);
    expect(firstReport.testDefinitions).toBe(CANONICAL_TEST_CODES.length);
    expect(firstReport.alertRules).toBe(DEFAULT_ALERT_RULES.length);
    expect(firstReport.categories).toBe(DEFAULT_AGE_BANDS.length * 2);
    expect(firstReport.khamisRocheTables).toBe(1);
  });

  it('is a no-op when run again, sequentially and concurrently', async () => {
    const before = await snapshot(orc);
    const again = await seedTenant(t.db, ORC_TENANT);
    expect(again.created).toBe(false);
    expect(again.clubId).toBe(orc);
    expect(totalInserted(again.report)).toBe(0);
    const concurrent = await Promise.all([
      seedTenant(t.db, ORC_TENANT),
      seedTenant(t.db, ORC_TENANT),
      bootstrapClub(t.db, { clubId: orc, branches: ORC_TENANT.branches }),
    ]);
    expect(concurrent.map((r) => totalInserted('report' in r ? r.report : r))).toEqual([0, 0, 0]);
    expect(await snapshot(orc)).toEqual(before);
  });

  it('bootstraps two new clubs concurrently without duplicates', async () => {
    const [a, b] = await t.db
      .insert(club)
      .values([
        { slug: 'concurrent-a', name: 'Club A', shortName: 'A' },
        { slug: 'concurrent-b', name: 'Club B', shortName: 'B' },
      ])
      .returning({ id: club.id });
    const branches = [{ sport: 'rugby', sex: 'male' }] as const;
    const reports = await Promise.all([
      bootstrapClub(t.db, { clubId: must(a).id, branches }),
      bootstrapClub(t.db, { clubId: must(a).id, branches }),
      bootstrapClub(t.db, { clubId: must(b).id, branches }),
    ]);
    const inserted = reports.map(totalInserted);
    expect(inserted.filter((n) => n === 0)).toHaveLength(1);
    expect((await snapshot(must(a).id)).metric_definition?.rows).toBe(
      CANONICAL_METRIC_CODES.length,
    );
    // Only the club's sport: no hockey positions or hockey-only rows.
    const [hockeyPositions] = await t.db
      .select({ n: count() })
      .from(position)
      .where(and(eq(position.clubId, must(b).id), eq(position.sport, 'hockey')));
    expect(hockeyPositions?.n).toBe(0);
  });

  it('never overwrites what the club edited', async () => {
    const [editedClub] = await t.db
      .insert(club)
      .values({ slug: 'edited', name: 'Club editado', shortName: 'ED' })
      .returning({ id: club.id });
    const clubId = must(editedClub).id;
    const branches = [{ sport: 'hockey', sex: 'female' }] as const;
    await bootstrapClub(t.db, { clubId, branches });

    // The club disables a rule, renames a category, closes and replaces its
    // absolute zones, changes a battery row and deletes another.
    await t.db
      .update(alertRule)
      .set({ enabled: false })
      .where(and(eq(alertRule.clubId, clubId), eq(alertRule.code, 'acwr_low')));
    await t.db
      .update(category)
      .set({ name: 'Sub 15' })
      .where(and(eq(category.clubId, clubId), eq(category.ageBandCode, 'm15')));
    const day = (value: string) => value as LocalDate;
    await t.db
      .update(speedZoneConfig)
      .set({ validTo: day('2026-03-01') })
      .where(and(eq(speedZoneConfig.clubId, clubId), eq(speedZoneConfig.kind, 'absolute')));
    await t.db.insert(speedZoneConfig).values({
      clubId,
      kind: 'absolute',
      zoneSet: { ...DEFAULT_SPEED_ZONE_SETS.absolute },
      validFrom: day('2026-03-01'),
    });
    await t.db
      .update(batteryConfig)
      .set({ windows: [1, 2, 3, 4] })
      .where(
        and(
          eq(batteryConfig.clubId, clubId),
          eq(batteryConfig.stage, 'foundation'),
          eq(batteryConfig.testCode, 'mobility'),
        ),
      );
    await t.db
      .delete(batteryConfig)
      .where(
        and(
          eq(batteryConfig.clubId, clubId),
          eq(batteryConfig.stage, 'foundation'),
          eq(batteryConfig.testCode, 'reaction'),
        ),
      );
    const before = await snapshot(clubId);

    const report = await bootstrapClub(t.db, { clubId, branches });
    // Only the deleted battery row comes back; nothing else is touched.
    expect(totalInserted(report)).toBe(1);
    expect(report.batteryConfigs).toBe(1);
    const after = await snapshot(clubId);
    expect({ ...after, battery_config: undefined }).toEqual({
      ...before,
      battery_config: undefined,
    });

    const [rule] = await t.db
      .select()
      .from(alertRule)
      .where(and(eq(alertRule.clubId, clubId), eq(alertRule.code, 'acwr_low')));
    expect(rule?.enabled).toBe(false);
    const m15 = await t.db
      .select()
      .from(category)
      .where(and(eq(category.clubId, clubId), eq(category.ageBandCode, 'm15')));
    expect(m15.map((c) => c.name)).toEqual(['Sub 15']);
    const [mobility] = await t.db
      .select()
      .from(batteryConfig)
      .where(
        and(
          eq(batteryConfig.clubId, clubId),
          eq(batteryConfig.stage, 'foundation'),
          eq(batteryConfig.testCode, 'mobility'),
        ),
      );
    expect(mobility?.windows).toEqual([1, 2, 3, 4]);
    const zones = await t.db
      .select()
      .from(speedZoneConfig)
      .where(and(eq(speedZoneConfig.clubId, clubId), eq(speedZoneConfig.kind, 'absolute')));
    expect(zones).toHaveLength(2);
  });

  it('keeps every club’s seeded rows in its own club', async () => {
    const { rows } = await t.pool.query<{ n: string }>(
      `select count(*)::text as n from test_definition_metric tdm
       join test_definition td on td.id = tdm.test_definition_id
       join metric_definition md on md.id = tdm.metric_definition_id
       where td.club_id <> tdm.club_id or md.club_id <> tdm.club_id`,
    );
    expect(rows[0]?.n).toBe('0');
    const [coefficients] = await t.db
      .select({ n: count() })
      .from(khamisRocheCoefficient)
      .innerJoin(khamisRocheTable, eq(khamisRocheTable.id, khamisRocheCoefficient.tableId))
      .where(sql`${khamisRocheTable.clubId} <> ${khamisRocheCoefficient.clubId}`);
    expect(coefficients?.n).toBe(0);
  });

  it('rejects invalid options and unknown clubs before writing', async () => {
    await expect(bootstrapClub(t.db, { clubId: orc, branches: [] })).rejects.toThrow(
      BootstrapClubError,
    );
    await expect(
      bootstrapClub(t.db, {
        clubId: orc,
        branches: [
          { sport: 'rugby', sex: 'male' },
          { sport: 'rugby', sex: 'male' },
        ],
      }),
    ).rejects.toThrow(/Duplicate branch/);
    for (const supportReason of ['   ', 'x'.repeat(501)]) {
      await expect(
        bootstrapClub(t.db, { clubId: orc, branches: ORC_TENANT.branches, supportReason }),
      ).rejects.toThrow(/supportReason/);
    }
    await expect(
      bootstrapClub(t.db, {
        clubId: '00000000-0000-4000-8000-000000000000' as ClubId,
        branches: ORC_TENANT.branches,
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it('rolls back with the caller’s transaction (club creation, B-313)', async () => {
    await expect(
      t.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(club)
          .values({ slug: 'rolled-back', name: 'Club que no se crea', shortName: 'RB' })
          .returning({ id: club.id });
        const report = await bootstrapClub(tx, {
          clubId: must(created).id,
          branches: ORC_TENANT.branches,
        });
        expect(report.metricDefinitions).toBe(CANONICAL_METRIC_CODES.length);
        throw new Error('creation failed after the bootstrap');
      }),
    ).rejects.toThrow('creation failed');
    const [row] = await t.db.select({ n: count() }).from(club).where(eq(club.slug, 'rolled-back'));
    expect(row?.n).toBe(0);
  });

  it('bootstraps through the application role as a superadmin (club creation, B-313)', async () => {
    const superadmin = must(
      (
        await t.db
          .insert(user)
          .values({ name: 'Soporte', email: 'soporte@seeds.example.com', isSuperadmin: true })
          .returning({ id: user.id })
      )[0],
    ).id;
    const app = await connectAs(t, 'app');
    try {
      const create = () =>
        createDatabase(app.pool).transaction(async (tx) => {
          // The request context of club creation: a superadmin, no club yet.
          await tx.execute(
            sql`select set_config(${TENANT_SETTING_NAMES.clubId}, '', true),
                       set_config(${TENANT_SETTING_NAMES.userId}, ${superadmin}, true),
                       set_config(${TENANT_SETTING_NAMES.role}, 'superadmin', true),
                       set_config(${TENANT_SETTING_NAMES.requestId}, 'req-club-creation', true)`,
          );
          await tx.execute(sql`select app.begin_support_access('Alta de club')`);
          const [created] = await tx
            .insert(club)
            .values({ slug: 'via-app', name: 'Club creado por la API', shortName: 'API' })
            .onConflictDoNothing({ target: club.slug })
            .returning({ id: club.id });
          const clubId =
            created?.id ??
            must((await t.db.select({ id: club.id }).from(club).where(eq(club.slug, 'via-app')))[0])
              .id;
          return {
            clubId,
            report: await bootstrapClub(tx, { clubId, branches: ORC_TENANT.branches }),
          };
        });
      const first = await create();
      // Same rows as the owner's first run of the ORC tenant (same branches).
      expect(first.report).toEqual(firstReport);
      const again = await create();
      expect(totalInserted(again.report)).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('runs the db:seed command idempotently', async () => {
    const first = await runSeed({ connectionString: t.connectionString });
    expect(first.created).toBe(false);
    expect(first.summary).toBe('Seed orc: club already existed; 0 rows inserted.');
    expect(first.summary).not.toContain(t.connectionString);

    const other = await runSeed({
      connectionString: t.connectionString,
      tenant: { ...ORC_TENANT, slug: 'cli-club', name: 'Club CLI' },
    });
    expect(other.created).toBe(true);
    expect(other.summary).toMatch(
      /^Seed cli-club: club created; \d+ rows inserted \(branches 2, metricDefinitions /,
    );
  });
});
