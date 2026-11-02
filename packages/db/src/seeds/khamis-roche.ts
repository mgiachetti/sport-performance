import {
  KHAMIS_ROCHE_1994_TABLE,
  SEXES,
  assertValidKhamisRocheTable,
  type ClubId,
  type KhamisRocheRow,
  type KhamisRocheTable,
  type Sex,
} from '@sport-performance/domain';
import { and, asc, eq } from 'drizzle-orm';
import { khamisRocheCoefficient, khamisRocheTable } from '../schema/maturation.js';
import type { NewKhamisRocheCoefficient, NewKhamisRocheTableRow } from '../types.js';
import type { SeedExecutor } from './executor.js';
import type { ClubSeedRow } from './metrics.js';

/**
 * Khamis-Roche coefficient tables seeded into every club. The values are
 * the domain's (`KHAMIS_ROCHE_1994_TABLE`): the seed only copies them, so a
 * correction to the coefficients is made once, in the domain, as a new table
 * code.
 */
export const SEEDED_KHAMIS_ROCHE_TABLES: readonly KhamisRocheTable[] = [KHAMIS_ROCHE_1994_TABLE];

export function khamisRocheTableSeed(table: KhamisRocheTable): ClubSeedRow<NewKhamisRocheTableRow> {
  assertValidKhamisRocheTable(table);
  return {
    code: table.code,
    citation: table.provenance.citation,
    doi: table.provenance.doi,
    errata: [...table.provenance.errata],
    verification: table.provenance.verification,
    verificationNotes: table.provenance.verificationNotes,
  };
}

export function khamisRocheCoefficientSeeds(
  table: KhamisRocheTable,
): Omit<ClubSeedRow<NewKhamisRocheCoefficient>, 'tableId'>[] {
  assertValidKhamisRocheTable(table);
  return SEXES.flatMap((sex) => table.rows[sex].map((row) => ({ sex, ...row })));
}

/**
 * Reads a club's coefficient table back as a domain `KhamisRocheTable`
 * (validated), ready for `predictAdultHeight(input, { table })`. Returns
 * `undefined` when the club has no table with that code.
 */
export async function loadKhamisRocheTable(
  db: SeedExecutor,
  clubId: ClubId,
  code: string = KHAMIS_ROCHE_1994_TABLE.code,
): Promise<KhamisRocheTable | undefined> {
  const [header] = await db
    .select()
    .from(khamisRocheTable)
    .where(and(eq(khamisRocheTable.clubId, clubId), eq(khamisRocheTable.code, code)));
  if (header === undefined) return undefined;

  const coefficients = await db
    .select()
    .from(khamisRocheCoefficient)
    .where(
      and(eq(khamisRocheCoefficient.clubId, clubId), eq(khamisRocheCoefficient.tableId, header.id)),
    )
    .orderBy(asc(khamisRocheCoefficient.sex), asc(khamisRocheCoefficient.ageYears));

  const rows: Record<Sex, KhamisRocheRow[]> = { male: [], female: [] };
  for (const c of coefficients) {
    rows[c.sex].push({
      ageYears: c.ageYears,
      interceptIn: c.interceptIn,
      heightInCoef: c.heightInCoef,
      weightLbCoef: c.weightLbCoef,
      midparentHeightInCoef: c.midparentHeightInCoef,
    });
  }
  const table: KhamisRocheTable = {
    code: header.code,
    provenance: {
      citation: header.citation,
      doi: header.doi,
      errata: header.errata,
      verification: header.verification,
      verificationNotes: header.verificationNotes,
    },
    rows,
  };
  assertValidKhamisRocheTable(table);
  return table;
}
