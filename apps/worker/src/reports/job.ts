import { createHash } from 'node:crypto';
import { playerReportContentSchema, type PlayerReportContent } from '@sport-performance/contracts';
import {
  FILE_KIND_POLICIES,
  PLAYER_REPORT_MAX_ATTEMPTS,
  PLAYER_REPORT_RETRY_MINUTES,
  deletedFileExpiresAt,
  fileExpiresAt,
  fileObjectKey,
  pendingUploadExpiresAt,
  sanitizeFileName,
  type ClubId,
  type PlayerReportFailureCode,
} from '@sport-performance/domain';
import { createTranslator, isSupportedLocale, type Translator } from '@sport-performance/i18n';
import type { ObjectStorage } from '@sport-performance/storage';
import type pg from 'pg';
import type { Logger } from 'pino';
import { inClubTransaction } from '../database.js';
import { renderPlayerReport } from './render.js';

/**
 * The report job of one club (B-602, ADR 0069): takes the pending reports
 * that are due, renders each snapshot into a PDF, uploads it and records it
 * as a `pdf_report` file. Each report is claimed with a lease (`FOR UPDATE
 * SKIP LOCKED`, `next_attempt_at` pushed ahead), so two workers never render
 * the same one and a worker that dies leaves it for a later attempt. The
 * file row is written before the upload: an object never lands in the bucket
 * without a row the retention job will purge (ADR 0044).
 */

export interface ReportDependencies {
  /** Pool of a `sport_performance_worker` login. */
  readonly pool: pg.Pool;
  readonly storage: ObjectStorage;
  readonly logger: Logger;
  readonly now?: () => Date;
}

export interface ClubReportsReport {
  readonly clubId: ClubId;
  readonly ready: number;
  readonly retried: number;
  readonly failed: number;
  /** Due reports left for the next job of the club. */
  readonly more: boolean;
}

/** Reports per job; the rest goes to the next job of the club. */
export const REPORTS_PER_JOB = 10;
/** Time a claimed report is kept from other workers while it is rendered and uploaded. */
export const REPORT_LEASE_MINUTES = 10;
/** Largest crest read for a report (the `club_logo` policy). */
const LOGO_MAX_BYTES = FILE_KIND_POLICIES.club_logo.maxSizeBytes;

interface ClaimedReport {
  readonly id: string;
  readonly playerId: string;
  readonly content: unknown;
  readonly attempts: number;
}

/** A failure with its code; `retry` when another attempt may succeed. */
export class ReportFailure extends Error {
  constructor(
    readonly code: PlayerReportFailureCode,
    readonly retry: boolean,
    options?: { cause?: unknown },
  ) {
    super(`Player report failed: ${code}`, options);
    this.name = 'ReportFailure';
  }
}

/**
 * The failure to record for an error of an attempt: its own code, or
 * `internal_error` for anything outside the known steps (the database while
 * recording the file or the outcome, for example), retried like the rest.
 */
export function reportFailureOf(error: unknown): ReportFailure {
  return error instanceof ReportFailure
    ? error
    : new ReportFailure('internal_error', true, { cause: error });
}

const translators = new Map<string, Translator>();
function translatorFor(locale: string): Translator {
  const resolved = isSupportedLocale(locale) ? locale : 'es-AR';
  let translator = translators.get(resolved);
  if (translator === undefined) {
    translator = createTranslator({ locale: resolved });
    translators.set(resolved, translator);
  }
  return translator;
}

/** The download name: `Informe Temporada 2026 V2 - Martín Núñez.pdf`. */
export function reportFileName(content: PlayerReportContent, translator: Translator): string {
  const name = translator.t('report.fileName', {
    season: content.window.seasonName,
    number: content.window.number,
    player: `${content.player.firstName} ${content.player.lastName}`,
  });
  return sanitizeFileName(name.replace(/[\\/]/g, '-'));
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('base64');

/**
 * Claims the next due report. First gives up on the due ones that already
 * spent every attempt without finishing any: a worker that died while
 * rendering never recorded the failure, and a PDF that crashes the process
 * would otherwise come back after every lease, forever.
 */
async function claim(
  deps: ReportDependencies,
  clubId: ClubId,
  requestId: string | undefined,
  now: Date,
): Promise<{ report: ClaimedReport | null; exhausted: number }> {
  return inClubTransaction(
    deps.pool,
    clubId,
    async ({ client }) => {
      const exhausted = await client.query(
        `update player_report set status = 'failed', failure_code = 'attempts_exhausted'
          where id in (select id from player_report
                        where status = 'pending' and next_attempt_at <= $1 and attempts >= $2
                        for update skip locked)`,
        [now, PLAYER_REPORT_MAX_ATTEMPTS],
      );
      const { rows } = await client.query<{
        id: string;
        player_id: string;
        content: unknown;
        attempts: number;
      }>(
        `update player_report r
            set attempts = r.attempts + 1,
                next_attempt_at = $1::timestamptz + make_interval(mins => $2)
          where r.id = (select id from player_report
                         where status = 'pending' and next_attempt_at <= $1 and attempts < $3
                         order by next_attempt_at, created_at, id
                         limit 1 for update skip locked)
          returning r.id, r.player_id, r.content, r.attempts`,
        [now, REPORT_LEASE_MINUTES, PLAYER_REPORT_MAX_ATTEMPTS],
      );
      const row = rows[0];
      return {
        report:
          row === undefined
            ? null
            : { id: row.id, playerId: row.player_id, content: row.content, attempts: row.attempts },
        exhausted: exhausted.rowCount ?? 0,
      };
    },
    { requestId },
  );
}

/** The crest as PNG bytes when the club has one ready; any trouble leaves it out. */
async function readLogo(
  deps: ReportDependencies,
  clubId: ClubId,
  logoFileId: string | null,
  requestId: string | undefined,
): Promise<Uint8Array | null> {
  if (logoFileId === null) return null;
  try {
    const file = await inClubTransaction(
      deps.pool,
      clubId,
      async ({ client }) =>
        (
          await client.query<{ content_type: string }>(
            `select content_type from file
              where id = $1 and kind = 'club_logo' and status = 'ready'`,
            [logoFileId],
          )
        ).rows[0],
      { requestId },
    );
    // pdfkit embeds PNG and JPEG: a WebP crest is left out rather than converted.
    if (file?.content_type !== 'image/png') return null;
    return await deps.storage.get(
      fileObjectKey({ clubId, kind: 'club_logo', id: logoFileId }),
      LOGO_MAX_BYTES,
    );
  } catch (error) {
    deps.logger.warn({ err: error, clubId }, 'report crest unavailable; rendering without it');
    return null;
  }
}

async function produce(
  deps: ReportDependencies,
  clubId: ClubId,
  report: ClaimedReport,
  requestId: string | undefined,
  now: Date,
): Promise<void> {
  const parsed = playerReportContentSchema.safeParse(report.content);
  if (!parsed.success) throw new ReportFailure('invalid_content', false, { cause: parsed.error });
  const content = parsed.data;
  const translator = translatorFor(content.locale);
  const logoPng = await readLogo(deps, clubId, content.club.logoFileId, requestId);

  let pdf: Uint8Array;
  try {
    pdf = await renderPlayerReport(content, { translator, logoPng, now });
  } catch (error) {
    throw new ReportFailure('render_failed', true, { cause: error });
  }
  if (pdf.byteLength > FILE_KIND_POLICIES.pdf_report.maxSizeBytes) {
    throw new ReportFailure('too_large', false);
  }
  const checksum = sha256(pdf);
  const contentType = FILE_KIND_POLICIES.pdf_report.contentTypes[0];

  // The row first: whatever reaches the bucket has a row that expires (ADR 0044).
  const fileId = await inClubTransaction(
    deps.pool,
    clubId,
    async ({ client }) =>
      (
        await client.query<{ id: string }>(
          `insert into file (club_id, kind, status, player_id, content_type, size_bytes,
                             checksum_sha256, file_name, expires_at)
           values ($1, 'pdf_report', 'pending', $2, $3, $4, $5, $6, $7) returning id`,
          [
            clubId,
            report.playerId,
            contentType,
            pdf.byteLength,
            checksum,
            reportFileName(content, translator),
            pendingUploadExpiresAt(now),
          ],
        )
      ).rows[0]?.id,
    { requestId },
  );
  if (fileId === undefined) throw new Error('The report file row was not created.');

  try {
    await deps.storage.put({
      key: fileObjectKey({ clubId, kind: 'pdf_report', id: fileId }),
      contentType,
      body: pdf,
      checksumSha256: checksum,
    });
  } catch (error) {
    await discardFile(deps, clubId, fileId, requestId, now);
    throw new ReportFailure('storage_failed', true, { cause: error });
  }

  const completed = await inClubTransaction(
    deps.pool,
    clubId,
    async ({ client }) => {
      const uploadedAt = new Date();
      await client.query(
        `update file set status = 'ready', uploaded_at = $2, expires_at = $3
          where id = $1 and status = 'pending'`,
        [fileId, uploadedAt, fileExpiresAt('pdf_report', uploadedAt)],
      );
      // Only while this worker still holds the claim: a lease that ran out and was taken
      // by another worker leaves this file to the retention job.
      const { rowCount } = await client.query(
        `update player_report set status = 'ready', file_id = $2, generated_at = $3
          where id = $1 and status = 'pending' and attempts = $4`,
        [report.id, fileId, uploadedAt, report.attempts],
      );
      return rowCount === 1;
    },
    { requestId },
  );
  if (!completed) {
    deps.logger.warn({ clubId, reportId: report.id }, 'report claim lost; discarding its file');
    await discardFile(deps, clubId, fileId, requestId, now);
  }
}

/** Marks a file of a report that will not be used as deleted: the retention job removes it. */
async function discardFile(
  deps: ReportDependencies,
  clubId: ClubId,
  fileId: string,
  requestId: string | undefined,
  now: Date,
): Promise<void> {
  try {
    await inClubTransaction(
      deps.pool,
      clubId,
      async ({ client }) => {
        const { rows } = await client.query<{
          status: 'pending' | 'ready';
          expires_at: Date | null;
          uploaded_at: Date | null;
        }>(
          `select status, expires_at, uploaded_at from file
            where id = $1 and status <> 'deleted' for update`,
          [fileId],
        );
        const file = rows[0];
        if (file === undefined) return;
        const expiresAt = deletedFileExpiresAt(
          { status: file.status, expiresAt: file.expires_at, uploadedAt: file.uploaded_at },
          now,
        );
        await client.query(
          `update file set status = 'deleted', deleted_at = $2, expires_at = $3 where id = $1`,
          [fileId, now, expiresAt],
        );
      },
      { requestId },
    );
  } catch (error) {
    // The pending row still expires on its own (24 hours) and is purged then.
    deps.logger.warn({ err: error, clubId, fileId }, 'could not discard a report file');
  }
}

/** After a failure: retry later with backoff, or give up with the code. */
async function recordFailure(
  deps: ReportDependencies,
  clubId: ClubId,
  report: ClaimedReport,
  failure: ReportFailure,
  requestId: string | undefined,
  now: Date,
): Promise<'retried' | 'failed'> {
  const giveUp = !failure.retry || report.attempts >= PLAYER_REPORT_MAX_ATTEMPTS;
  await inClubTransaction(
    deps.pool,
    clubId,
    async ({ client }) => {
      if (giveUp) {
        await client.query(
          `update player_report set status = 'failed', failure_code = $2
            where id = $1 and status = 'pending' and attempts = $3`,
          [report.id, failure.code, report.attempts],
        );
      } else {
        await client.query(
          `update player_report
              set next_attempt_at = $2::timestamptz + make_interval(mins => $3)
            where id = $1 and status = 'pending' and attempts = $4`,
          [report.id, now, report.attempts * PLAYER_REPORT_RETRY_MINUTES, report.attempts],
        );
      }
    },
    { requestId },
  );
  return giveUp ? 'failed' : 'retried';
}

export async function runClubReports(
  deps: ReportDependencies,
  clubId: ClubId,
  options: { readonly jobId?: string } = {},
): Promise<ClubReportsReport> {
  const requestId = options.jobId === undefined ? undefined : `job:${options.jobId}`;
  let ready = 0;
  let retried = 0;
  let failed = 0;
  for (let i = 0; i < REPORTS_PER_JOB; i += 1) {
    const now = deps.now?.() ?? new Date();
    const { report, exhausted } = await claim(deps, clubId, requestId, now);
    if (exhausted > 0) {
      failed += exhausted;
      deps.logger.warn(
        { clubId, count: exhausted, code: 'attempts_exhausted' },
        'reports given up after their attempts',
      );
    }
    if (report === null) return { clubId, ready, retried, failed, more: false };
    try {
      await produce(deps, clubId, report, requestId, now);
      ready += 1;
      deps.logger.info({ clubId, reportId: report.id, jobId: options.jobId }, 'report ready');
    } catch (error) {
      const failure = reportFailureOf(error);
      const outcome = await recordFailure(deps, clubId, report, failure, requestId, now);
      if (outcome === 'failed') failed += 1;
      else retried += 1;
      // Codes and ids only: the snapshot has personal data and never reaches the logs.
      deps.logger.warn(
        {
          clubId,
          reportId: report.id,
          code: failure.code,
          attempt: report.attempts,
          outcome,
          err: failure.cause instanceof Error ? { name: failure.cause.name } : undefined,
        },
        'report not generated',
      );
    }
  }
  return { clubId, ready, retried, failed, more: true };
}
