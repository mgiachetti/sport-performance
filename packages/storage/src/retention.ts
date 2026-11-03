import type { Database } from '@sport-performance/db';
import { club, file, testProtocolMedia } from '@sport-performance/db/schema';
import { SIGNED_URL_CLOCK_SKEW_S, fileObjectKey } from '@sport-performance/domain';
import { and, asc, eq, inArray, isNull, lte, notExists, sql } from 'drizzle-orm';
import type { ObjectStorage } from './storage.js';

/**
 * The retention job of uploaded files (B-325, ADR 0044), one club per run:
 * the worker (ADR 0011, #57) runs it on a schedule inside a transaction with
 * the club's context (`app.club_id`, worker role), like every job.
 *
 * Due is every file with `expires_at <= now - SIGNED_URL_CLOCK_SKEW_S` that
 * was not purged yet: a confirmed file past the retention of its kind, an
 * upload never confirmed (whatever reached the bucket goes too) and a file
 * deleted on request. The crest the club is using and the media of an active
 * protocol (B-415) are never due, whatever `expires_at` says.
 *
 * No upload URL of a due file can still be honored: they never outlive the
 * upload window, and a file deleted on request expires once every URL it
 * handed out is dead (`deletedFileExpiresAt`). The margin covers a bucket
 * whose clock lags. Otherwise a late `PUT` after the purge would leave an
 * object no row tracks.
 *
 * Each object is removed first and its row marked after (`status =
 * 'deleted'`, `purged_at`), so the job is safe to retry: a run that fails
 * between the two leaves the row due, and removing a missing object succeeds.
 * Rows are locked with `SKIP LOCKED`: two runs on the same club split the
 * work instead of waiting.
 */
export interface PurgeOptions {
  /** The run's clock. */
  readonly now?: Date;
  /** Files per run; the next run takes the rest. */
  readonly limit?: number;
  /**
   * Time the run spends removing objects before it stops and commits what it
   * did (the rest stays due): the transaction and its row locks stay short
   * even when the bucket is slow. At least one file is always tried.
   */
  readonly budgetMs?: number;
}

export interface PurgeReport {
  /** Objects removed and rows marked. */
  readonly purged: number;
  /** Files whose object could not be removed: still due, retried next run. */
  readonly failed: number;
  /** Whether there may be more due files (a full batch, or the budget ran out): run again. */
  readonly more: boolean;
}

/** Files per run: each one is a call to the bucket inside the transaction. */
export const PURGE_BATCH_SIZE = 100;
/** Time budget of a run (see {@link PurgeOptions.budgetMs}). */
export const PURGE_BUDGET_MS = 20_000;

export async function purgeExpiredFiles(
  db: Database,
  storage: ObjectStorage,
  options: PurgeOptions = {},
): Promise<PurgeReport> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? PURGE_BATCH_SIZE;
  const budgetMs = options.budgetMs ?? PURGE_BUDGET_MS;
  const started = performance.now();
  const dueBy = new Date(now.getTime() - SIGNED_URL_CLOCK_SKEW_S * 1000);
  const due = await db
    .select({ id: file.id, clubId: file.clubId, kind: file.kind })
    .from(file)
    .where(
      and(
        isNull(file.purgedAt),
        lte(file.expiresAt, dueBy),
        notExists(
          db
            .select({ id: club.id })
            .from(club)
            .where(and(eq(club.id, file.clubId), eq(club.logoFileId, file.id))),
        ),
        notExists(
          db
            .select({ id: testProtocolMedia.id })
            .from(testProtocolMedia)
            .where(
              and(
                eq(testProtocolMedia.clubId, file.clubId),
                eq(testProtocolMedia.fileId, file.id),
                isNull(testProtocolMedia.archivedAt),
              ),
            ),
        ),
      ),
    )
    .orderBy(asc(file.expiresAt), asc(file.id))
    .limit(limit)
    .for('update', { of: file, skipLocked: true });

  const removed: string[] = [];
  let failed = 0;
  let tried = 0;
  for (const row of due) {
    // Out of time: commit what was done; the rows left stay due for the next run.
    if (tried > 0 && performance.now() - started >= budgetMs) break;
    tried += 1;
    try {
      await storage.remove(fileObjectKey({ clubId: row.clubId, kind: row.kind, id: row.id }));
      removed.push(row.id);
    } catch {
      // The bucket is down or refused: the row stays due for the next run.
      failed += 1;
    }
  }
  if (removed.length > 0) {
    await db
      .update(file)
      .set({
        status: 'deleted',
        deletedAt: sql`coalesce(${file.deletedAt}, ${now})`,
        purgedAt: now,
      })
      .where(inArray(file.id, removed));
  }
  return { purged: removed.length, failed, more: due.length === limit || tried < due.length };
}
