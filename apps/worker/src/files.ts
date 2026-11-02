import type { ClubId } from '@sport-performance/domain';
import {
  purgeExpiredFiles,
  type ObjectStorage,
  type PurgeReport,
} from '@sport-performance/storage';
import type pg from 'pg';
import type { Logger } from 'pino';
import { inClubTransaction } from './database.js';

export interface PurgeDependencies {
  /** Pool of a `sport_performance_worker` login. */
  readonly pool: pg.Pool;
  readonly storage: ObjectStorage;
  readonly logger: Logger;
  readonly now?: () => Date;
}

/**
 * The retention job of uploaded files for one club (B-325, ADR 0044):
 * `purgeExpiredFiles` in a transaction with the club's context. A report with
 * `more` asks for another run (the caller enqueues it); objects that could not
 * be removed stay due and fail the job so pg-boss retries it.
 */
export async function purgeClubFiles(
  deps: PurgeDependencies,
  clubId: ClubId,
  options: { readonly jobId?: string } = {},
): Promise<PurgeReport> {
  const now = deps.now?.() ?? new Date();
  const report = await inClubTransaction(
    deps.pool,
    clubId,
    ({ db }) => purgeExpiredFiles(db, deps.storage, { now }),
    options.jobId === undefined ? {} : { requestId: `job:${options.jobId}` },
  );
  deps.logger.info({ clubId, jobId: options.jobId, ...report }, 'expired files purged');
  if (report.failed > 0) {
    throw new Error(`${String(report.failed)} file(s) of club ${clubId} could not be removed.`);
  }
  return report;
}
