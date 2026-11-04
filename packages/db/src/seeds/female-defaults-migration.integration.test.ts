/**
 * The data migration `female_defaults` (B-804, ADR 0088) on clubs that were
 * bootstrapped before it: each club is put back in the state the old
 * defaults left (growth rule without scope, no rule or zones for women) and
 * the migration's statements run again on top. The migration is written to
 * be safe to re-run, so running it on an up-to-date club changes nothing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_ALERT_RULES,
  DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES,
  type ClubId,
} from '@sport-performance/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER } from '../migrate.js';
import { alertRule, club, speedZoneConfig } from '../schema/index.js';
import {
  createMigratedDatabase,
  hasDatabase,
  must,
  type MigratedTestDatabase,
} from '../testing/database.js';
import { bootstrapClub, type ClubBranch } from './index.js';

function migrationStatements(): string[] {
  const [file] = readdirSync(MIGRATIONS_FOLDER).filter((f) => f.endsWith('_female_defaults.sql'));
  const sql = readFileSync(join(MIGRATIONS_FOLDER, must(file)), 'utf8');
  return sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

describe.skipIf(!hasDatabase)('female_defaults migration (Postgres 16)', () => {
  let t: MigratedTestDatabase;

  async function newClub(slug: string, branches: readonly ClubBranch[]): Promise<ClubId> {
    const [row] = await t.db
      .insert(club)
      .values({ slug, name: `Club ${slug}`, shortName: slug.slice(0, 3).toUpperCase() })
      .returning({ id: club.id });
    const clubId = must(row).id;
    await bootstrapClub(t.db, { clubId, branches });
    return clubId;
  }

  /** What a club bootstrapped with the old defaults looks like. */
  async function asBeforeTheMigration(clubId: ClubId): Promise<void> {
    await t.pool.query(
      `update alert_rule set sexes = null where club_id = $1 and code = 'growth_peak'`,
      [clubId],
    );
    await t.pool.query(
      `delete from alert_rule where club_id = $1 and code = 'growth_peak_female'`,
      [clubId],
    );
    await t.pool.query(`delete from speed_zone_config where club_id = $1 and sex is not null`, [
      clubId,
    ]);
  }

  async function migrate(): Promise<void> {
    for (const statement of migrationStatements()) await t.pool.query(statement);
  }

  async function growthRules(clubId: ClubId) {
    const rows = await t.db
      .select({
        code: alertRule.code,
        enabled: alertRule.enabled,
        sexes: alertRule.sexes,
        params: alertRule.params,
      })
      .from(alertRule)
      .where(and(eq(alertRule.clubId, clubId), eq(alertRule.kind, 'growth_peak')))
      .orderBy(alertRule.code);
    return rows;
  }

  async function womenZones(clubId: ClubId) {
    return t.db
      .select()
      .from(speedZoneConfig)
      .where(and(eq(speedZoneConfig.clubId, clubId), eq(speedZoneConfig.sex, 'female')));
  }

  const params = (code: string) => must(DEFAULT_ALERT_RULES.find((r) => r.code === code)).params;

  let both: ClubId;
  let edited: ClubId;
  let menOnly: ClubId;
  let current: ClubId;
  let ownBands: ClubId;

  beforeAll(async () => {
    t = await createMigratedDatabase();
    both = await newClub('both', [
      { sport: 'rugby', sex: 'male' },
      { sport: 'hockey', sex: 'female' },
    ]);
    edited = await newClub('edited', [{ sport: 'hockey', sex: 'female' }]);
    menOnly = await newClub('men-only', [{ sport: 'rugby', sex: 'male' }]);
    current = await newClub('current', [{ sport: 'hockey', sex: 'female' }]);
    ownBands = await newClub('own-bands', [
      { sport: 'rugby', sex: 'male' },
      { sport: 'hockey', sex: 'female' },
    ]);
    for (const clubId of [both, edited, menOnly, ownBands]) await asBeforeTheMigration(clubId);
    // This club replaced the seeded club-wide absolute zones with its first team's bands.
    await t.pool.query(
      `update speed_zone_config set valid_to = '2025-12-31'
        where club_id = $1 and kind = 'absolute' and sex is null`,
      [ownBands],
    );
    await t.pool.query(
      `insert into speed_zone_config (club_id, kind, zone_set, valid_from)
       select club_id, kind,
              jsonb_set(zone_set, '{zones,3,minSpeedMs}', '5.8'), '2026-01-01'
         from speed_zone_config
        where club_id = $1 and kind = 'absolute' and sex is null`,
      [ownBands],
    );
    // This club had tuned its growth rule for everyone.
    await t.pool.query(
      `update alert_rule set params = jsonb_set(params, '{warningAtOrAboveCmYear}', '8')
        where club_id = $1 and code = 'growth_peak'`,
      [edited],
    );
    await migrate();
  });

  afterAll(async () => {
    await t.close();
  });

  it('splits the seeded growth rule into one per sex', async () => {
    expect(await growthRules(both)).toEqual([
      { code: 'growth_peak', enabled: true, sexes: ['male'], params: params('growth_peak') },
      {
        code: 'growth_peak_female',
        enabled: true,
        sexes: ['female'],
        params: params('growth_peak_female'),
      },
    ]);
  });

  it('leaves an edited growth rule alone and adds the women rule disabled', async () => {
    const [men, women] = await growthRules(edited);
    expect(men).toMatchObject({ code: 'growth_peak', enabled: true, sexes: null });
    expect(men?.params).toMatchObject({ warningAtOrAboveCmYear: 8 });
    expect(women).toMatchObject({ code: 'growth_peak_female', enabled: false, sexes: ['female'] });
  });

  it('adds the women zones only to clubs with a women branch', async () => {
    const zones = await womenZones(both);
    expect(zones).toHaveLength(1);
    expect(zones[0]).toMatchObject({
      kind: 'absolute',
      sport: null,
      playerId: null,
      validFrom: '2000-01-01',
      validTo: null,
      archivedAt: null,
    });
    expect(zones[0]?.zoneSet).toEqual(DEFAULT_FEMALE_ABSOLUTE_SPEED_ZONES);
    expect(await womenZones(edited)).toHaveLength(1);
    expect(await womenZones(menOnly)).toHaveLength(0);
    // A club with its own club-wide bands keeps them for its women too.
    expect(await womenZones(ownBands)).toHaveLength(0);
    // A men-only club still gets the (scoped) women rule, ready for a women branch.
    expect((await growthRules(menOnly)).map((r) => [r.code, r.enabled])).toEqual([
      ['growth_peak', true],
      ['growth_peak_female', true],
    ]);
  });

  it('changes nothing on a club that already has the new defaults, or when run again', async () => {
    const snapshot = async () => ({
      rules: await growthRules(current),
      zones: (await womenZones(current)).map((z) => [z.id, z.updatedAt.toISOString()]),
      both: await growthRules(both),
    });
    const before = await snapshot();
    await migrate();
    expect(await snapshot()).toEqual(before);
    expect(before.zones).toHaveLength(1);
  });
});
