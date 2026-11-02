import { DEFAULT_CLUB_TIME_ZONE, type ClubId, type TimeZone } from '@sport-performance/domain';
import { orcPalette } from '@sport-performance/ui-tokens';
import { eq, sql } from 'drizzle-orm';
import { club } from '../schema/tenant.js';
import { bootstrapClub, type BootstrapClubReport, type ClubBranch } from './bootstrap.js';
import type { SeedExecutor } from './executor.js';

/** What a tenant needs to exist: identity, zone, brand and branches. */
export interface TenantSeed {
  readonly slug: string;
  readonly name: string;
  readonly timeZone: TimeZone;
  /** Initials for small spaces (`ORC`). */
  readonly shortName: string;
  /** Brand colors, `#rrggbb` lowercase. */
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly branches: readonly ClubBranch[];
}

/**
 * The first tenant (CLAUDE.md): Olivos Rugby Club, Munro, with men's rugby
 * and women's hockey. Brand colors come from `@sport-performance/ui-tokens`
 * (the ORC palette is the product default), not from literals.
 */
export const ORC_TENANT: TenantSeed = {
  slug: 'orc',
  name: 'Olivos Rugby Club',
  timeZone: DEFAULT_CLUB_TIME_ZONE,
  shortName: 'ORC',
  primaryColor: orcPalette.orange,
  secondaryColor: orcPalette.black,
  branches: [
    { sport: 'rugby', sex: 'male' },
    { sport: 'hockey', sex: 'female' },
  ],
};

export interface SeedTenantResult {
  readonly clubId: ClubId;
  /** Whether the club row was created by this run. */
  readonly created: boolean;
  readonly report: BootstrapClubReport;
}

/**
 * Creates the tenant's club if its slug is free and bootstraps it. An
 * existing club is never modified (its name, zone and brand belong to the
 * club's admins); only the missing configuration is added. Atomic.
 */
export async function seedTenant(db: SeedExecutor, tenant: TenantSeed): Promise<SeedTenantResult> {
  return db.transaction(async (tx) => {
    // Serialise concurrent runs on the slug before looking it up.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tenant:${tenant.slug}`}))`);
    const inserted = await tx
      .insert(club)
      .values({
        slug: tenant.slug,
        name: tenant.name,
        timeZone: tenant.timeZone,
        shortName: tenant.shortName,
        primaryColor: tenant.primaryColor,
        secondaryColor: tenant.secondaryColor,
      })
      .onConflictDoNothing({ target: club.slug })
      .returning({ id: club.id });
    const created = inserted[0] !== undefined;
    const clubId =
      inserted[0]?.id ??
      (await tx.select({ id: club.id }).from(club).where(eq(club.slug, tenant.slug)))[0]?.id;
    if (clubId === undefined) throw new Error(`unreachable: club ${tenant.slug} not found`);
    const report = await bootstrapClub(tx, { clubId, branches: tenant.branches });
    return { clubId, created, report };
  });
}
