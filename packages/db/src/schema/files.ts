import {
  FILE_KINDS,
  FILE_KIND_POLICIES,
  FILE_NAME_MAX_LENGTH,
  type CategoryId,
  type FileKind,
  type PlayerId,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns.js';
import { fileKindEnum, fileStatusEnum } from './enums.js';
import { category } from './organization.js';
import { player } from './players.js';
import {
  tenantColumns,
  tenantConstraints,
  tenantReference,
  tenantReferenceIndex,
} from './tenant.js';

/** `'a', 'b'` for an `IN (…)` of kinds; the values are the domain's closed vocabulary. */
function kindList(kinds: readonly FileKind[]) {
  return sql.raw(kinds.map((kind) => `'${kind}'`).join(', '));
}

const PLAYER_KINDS = FILE_KINDS.filter((kind) => FILE_KIND_POLICIES[kind].subject === 'player');
/** Kinds that may carry a player (a pending `pod_raw` is of the pod, a trimmed one of a player). */
const OPTIONAL_PLAYER_KINDS = FILE_KINDS.filter(
  (kind) => FILE_KIND_POLICIES[kind].subject === 'player_optional',
);
/** Kinds that may carry a category, with it optional or required. */
const CATEGORY_KINDS = FILE_KINDS.filter((kind) => {
  const { subject } = FILE_KIND_POLICIES[kind];
  return subject === 'category' || subject === 'category_optional';
});
/** Kinds that always belong to a category (the category report, B-603). */
const REQUIRED_CATEGORY_KINDS = FILE_KINDS.filter(
  (kind) => FILE_KIND_POLICIES[kind].subject === 'category',
);

/**
 * An uploaded file (B-325, ADR 0044): the bytes are an object in the
 * S3-compatible bucket under `clubs/<club_id>/<kind>/<id>` (`fileObjectKey`
 * of the domain, ADR 0005), never in Postgres. The owner is `created_by`.
 *
 * - `pending`: the row exists and an upload URL was handed out; the bytes
 *   are not confirmed. `expires_at` is the end of the upload window.
 * - `ready`: the API checked that the bucket holds the declared size, type
 *   and SHA-256 (`uploaded_at`). `expires_at` is the end of the retention of
 *   its kind (`NULL`: kept while in use, the crest of the club).
 * - `deleted`: expired or deleted on request (`deleted_at`); the row stays
 *   as a record. `purged_at` is when the retention job removed the object.
 *
 * The retention job (`purgeExpiredFiles` of `@sport-performance/storage`)
 * removes the object of every row with `expires_at <= now()` and no
 * `purged_at`; deleting on request sets `expires_at` to now.
 */
export const file = pgTable(
  'file',
  {
    ...tenantColumns(),
    kind: fileKindEnum('kind').notNull(),
    status: fileStatusEnum('status').notNull().default('pending'),
    /** The player a CMJ video or a report is of. */
    playerId: uuid('player_id').$type<PlayerId>(),
    /** The category an import is for (a roster import is for the whole club: `NULL`). */
    categoryId: uuid('category_id').$type<CategoryId>(),
    /** MIME type, lowercase without parameters; the bucket serves the object with it. */
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    /** SHA-256 of the content, base64: the bucket checks it on upload (`x-amz-checksum-sha256`). */
    checksumSha256: text('checksum_sha256').notNull(),
    /** Original name, sanitized (no path, no control characters); used on download. */
    fileName: text('file_name'),
    uploadedAt: timestamptz('uploaded_at'),
    expiresAt: timestamptz('expires_at'),
    deletedAt: timestamptz('deleted_at'),
    purgedAt: timestamptz('purged_at'),
    /**
     * The CMJ attempt a video is the evidence of (B-604, ADR 0085): its result and its
     * entry (`test_result_value.entry_id`, the `clientUuid` the evaluator's phone gave the
     * attempt). Set together on insert (the API and `file_test_entry_check`), only for
     * `cmj_video`, never changed. The key to the result is declared in migration `0043` and
     * not here: `ON DELETE SET NULL (test_result_id)` (erasing a player deletes their results
     * while the detached file waits for the retention job; the entry id stays as a record)
     * cannot be expressed in Drizzle.
     */
    testResultId: uuid('test_result_id'),
    testEntryId: uuid('test_entry_id'),
  },
  (t) => [
    ...tenantConstraints('file', t),
    tenantReference('file', t.clubId, t.playerId, player),
    tenantReference('file', t.clubId, t.categoryId, category),
    tenantReferenceIndex('file', t.clubId, t.playerId),
    tenantReferenceIndex('file', t.clubId, t.categoryId),
    index('file_kind_idx').on(t.clubId, t.kind, t.createdAt),
    // The retention job: what is due and not purged yet.
    index('file_purge_idx')
      .on(t.clubId, t.expiresAt)
      .where(sql`${t.purgedAt} is null`),
    check('file_size_positive', sql`${t.sizeBytes} > 0`),
    check('file_checksum_format', sql`${t.checksumSha256} ~ '^[A-Za-z0-9+/]{43}=$'`),
    check('file_content_type_format', sql`${t.contentType} ~ '^[a-z]+/[a-z0-9.+-]+$'`),
    check(
      'file_name_format',
      sql`${t.fileName} is null or (${t.fileName} = btrim(${t.fileName}) and char_length(${t.fileName}) between 1 and ${sql.raw(String(FILE_NAME_MAX_LENGTH))} and ${t.fileName} !~ '[[:cntrl:]/\\\\"]')`,
    ),
    // What a file belongs to follows its kind (`FILE_KIND_POLICIES[kind].subject`). A
    // deleted file of an erased player loses its player (`app.erase_player`, ADR 0051): the
    // row stays, without them, until the retention job removes the object. The kind is
    // compared as text: a value added to the enum cannot be used as such in the migration
    // that adds it (`category_report`, 0038).
    check(
      'file_subject',
      sql`(${t.kind}::text in (${kindList(OPTIONAL_PLAYER_KINDS)}) or (${t.kind}::text in (${kindList(PLAYER_KINDS)})) = (${t.playerId} is not null) or (${t.status} = 'deleted' and ${t.playerId} is null)) and (${t.categoryId} is null or ${t.kind}::text in (${kindList(CATEGORY_KINDS)})) and (${t.kind}::text not in (${kindList(REQUIRED_CATEGORY_KINDS)}) or ${t.categoryId} is not null)`,
    ),
    check(
      'file_test_entry',
      sql`(${t.testResultId} is null or ${t.testEntryId} is not null) and (${t.testEntryId} is null or ${t.kind} = 'cmj_video')`,
    ),
    // One live video per attempt; a deleted one leaves room for another. Also covers the key
    // to the result (club, result).
    uniqueIndex('file_test_entry_key')
      .on(t.clubId, t.testResultId, t.testEntryId)
      .where(sql`${t.testEntryId} is not null and ${t.status} <> 'deleted'`),
    index('file_test_result_id_idx')
      .on(t.clubId, t.testResultId)
      .where(sql`${t.testResultId} is not null`),
    check(
      'file_lifecycle',
      sql`(${t.status} <> 'ready' or ${t.uploadedAt} is not null) and (${t.status} = 'deleted') = (${t.deletedAt} is not null) and (${t.purgedAt} is null or ${t.status} = 'deleted')`,
    ),
  ],
);
