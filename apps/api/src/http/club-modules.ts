import { club } from '@sport-performance/db/schema';
import { resolveClubModules, type ClubId, type ClubModules } from '@sport-performance/domain';
import { eq } from 'drizzle-orm';
import type { TenantDatabase } from '../db/database.js';
import { HttpError } from './errors.js';

/** The modules of the club of the request (B-322, ADR 0041), with the defaults filled in. */
export async function clubModules(db: TenantDatabase, clubId: ClubId): Promise<ClubModules> {
  const [row] = await db.select({ settings: club.settings }).from(club).where(eq(club.id, clubId));
  if (row === undefined) throw new HttpError('forbidden', 'The club of the request is not visible');
  return resolveClubModules(row.settings.modules);
}
