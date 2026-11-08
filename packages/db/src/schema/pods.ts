import {
  POD_ASSIGNMENT_NOTE_MAX_LENGTH,
  POD_LABEL_MAX_LENGTH,
  POD_NUMBER_MAX,
  POD_NUMBER_MIN,
  POD_PROVISIONING_STATES,
  POD_SHORT_ID_MAX,
  POD_SHORT_ID_MIN,
  POD_STATUSES,
  type ClubId,
  type PlayerId,
} from '@sport-performance/domain';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth.js';
import { timestamptz } from './columns.js';
import { player } from './players.js';
import { auditColumns, club, tenantColumns, tenantConstraints, tenantReference } from './tenant.js';
import { trainingSession } from './training.js';

/**
 * The pod fleet and its assignment to players (B-912, ADR 0106). The
 * exclusion constraints of `pod_assignment` (no overlap per pod nor per
 * player) and the RLS are written by hand in migration `0054_pod_fleet`.
 */

export const podProvisioningStateEnum = pgEnum('pod_provisioning_state', POD_PROVISIONING_STATES);
export const podStatusEnum = pgEnum('pod_status', POD_STATUSES);

/**
 * A physical pod, global to the platform (no `club_id`, like the identity
 * tables): the serial number printed on it and in its QR (unique in the whole
 * system), the chip id (FICR `DEVICEID`, from which the club's keys are
 * derived, ADR 0106; no per-device key is stored) and the hardware revision.
 * Only the superadmin (registry context) reads and writes it; a club reads its
 * own devices through `app.club_pod_devices()`.
 */
export const podDevice = pgTable(
  'pod_device',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serialNumber: text('serial_number').notNull(),
    chipId: text('chip_id').notNull(),
    hardwareRevision: text('hardware_revision').notNull(),
    provisioningState: podProvisioningStateEnum('provisioning_state')
      .notNull()
      .default('unprovisioned'),
    /** The club that owns it; `NULL` while it is in stock. */
    ownerClubId: uuid('owner_club_id')
      .references(() => club.id, { onDelete: 'restrict' })
      .$type<ClubId>(),
    ...auditColumns(),
  },
  (t) => [
    unique('pod_device_serial_number_key').on(t.serialNumber),
    unique('pod_device_chip_id_key').on(t.chipId),
    unique('pod_device_client_uuid_key').on(t.clientUuid),
    index('pod_device_owner_club_id_idx')
      .on(t.ownerClubId)
      .where(sql`${t.ownerClubId} is not null`),
    check('pod_device_serial_format', sql`${t.serialNumber} ~ '^[A-Z0-9][A-Z0-9-]{2,30}[A-Z0-9]$'`),
    check('pod_device_chip_id_format', sql`${t.chipId} ~ '^[0-9a-f]{16}$'`),
    check(
      'pod_device_hardware_revision_format',
      sql`${t.hardwareRevision} ~ '^[a-z0-9][a-z0-9._-]{0,15}$'`,
    ),
  ],
);

/**
 * A club's pod: a device in the club's fleet. The short id in the club's
 * LoRa network and the number painted on the pod and its vest are unique
 * among the club's pods that are not retired. A pod the club received on
 * loan names the lending club and the loan (`borrowed_from_club_id`,
 * `loan_id`: no foreign key, the loan is a row of the other club). Health is
 * the last snapshot the base reported (MAX17048 battery, NAND bad blocks,
 * versions). Never deleted: retired.
 */
export const pod = pgTable(
  'pod',
  {
    ...tenantColumns(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => podDevice.id, { onDelete: 'restrict' }),
    shortId: integer('short_id').notNull(),
    number: smallint('number').notNull(),
    label: text('label'),
    status: podStatusEnum('status').notNull().default('active'),
    statusChangedAt: timestamptz('status_changed_at').notNull().defaultNow(),
    /** Key epoch of the pod (ADR 0106): a recovered pod is provisioned again with the next one. */
    keyEpoch: integer('key_epoch').notNull().default(0),
    /** When its keys were revoked (lost, stolen); `NULL` while they are valid. */
    keysRevokedAt: timestamptz('keys_revoked_at'),
    borrowedFromClubId: uuid('borrowed_from_club_id')
      .references(() => club.id, { onDelete: 'restrict' })
      .$type<ClubId>(),
    loanId: uuid('loan_id'),
    firmwareVersion: text('firmware_version'),
    gnssFirmwareVersion: text('gnss_firmware_version'),
    lastSeenAt: timestamptz('last_seen_at'),
    batteryCycles: integer('battery_cycles'),
    batteryCapacityPct: real('battery_capacity_pct'),
    nandBadBlocks: integer('nand_bad_blocks'),
    healthReportedAt: timestamptz('health_reported_at'),
  },
  (t) => [
    ...tenantConstraints('pod', t),
    index('pod_device_id_idx').on(t.deviceId),
    index('pod_borrowed_from_club_id_idx')
      .on(t.borrowedFromClubId)
      .where(sql`${t.borrowedFromClubId} is not null`),
    uniqueIndex('pod_device_live_key')
      .on(t.clubId, t.deviceId)
      .where(sql`${t.status} <> 'retired'`),
    uniqueIndex('pod_short_id_live_key')
      .on(t.clubId, t.shortId)
      .where(sql`${t.status} <> 'retired'`),
    uniqueIndex('pod_number_live_key')
      .on(t.clubId, t.number)
      .where(sql`${t.status} <> 'retired'`),
    check(
      'pod_short_id_range',
      sql`${t.shortId} between ${sql.raw(String(POD_SHORT_ID_MIN))} and ${sql.raw(String(POD_SHORT_ID_MAX))}`,
    ),
    check(
      'pod_number_range',
      sql`${t.number} between ${sql.raw(String(POD_NUMBER_MIN))} and ${sql.raw(String(POD_NUMBER_MAX))}`,
    ),
    check(
      'pod_label_format',
      sql`${t.label} is null or (${t.label} = btrim(${t.label}) and char_length(${t.label}) between 1 and ${sql.raw(String(POD_LABEL_MAX_LENGTH))})`,
    ),
    check('pod_key_epoch', sql`${t.keyEpoch} >= 0`),
    check(
      'pod_loan_pair',
      sql`(${t.borrowedFromClubId} is null) = (${t.loanId} is null) and ${t.borrowedFromClubId} is distinct from ${t.clubId}`,
    ),
    check(
      'pod_health_values',
      sql`(${t.batteryCycles} is null or ${t.batteryCycles} >= 0)
          and (${t.batteryCapacityPct} is null or ${t.batteryCapacityPct} between 0 and 100)
          and (${t.nandBadBlocks} is null or ${t.nandBadBlocks} >= 0)`,
    ),
    check(
      'pod_versions_format',
      sql`(${t.firmwareVersion} is null or char_length(${t.firmwareVersion}) between 1 and 32)
          and (${t.gnssFirmwareVersion} is null or char_length(${t.gnssFirmwareVersion}) between 1 and 32)`,
    ),
  ],
);

/**
 * A loan of the club's pod to another club (ADR 0106), a row of the lending
 * club: the receiving club gets a pod of its own for the loan
 * (`borrower_pod_id`, a row of that club) and the lender's pod is `lent`.
 * The data generated during the loan belongs to the receiving club. Created
 * and ended by `app.lend_pod` / `app.end_pod_loan`, which write both clubs.
 */
export const podLoan = pgTable(
  'pod_loan',
  {
    ...tenantColumns(),
    podId: uuid('pod_id').notNull(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => podDevice.id, { onDelete: 'restrict' }),
    borrowerClubId: uuid('borrower_club_id')
      .notNull()
      .references(() => club.id, { onDelete: 'restrict' })
      .$type<ClubId>(),
    /** The pod of the receiving club (no foreign key: a row of another club). */
    borrowerPodId: uuid('borrower_pod_id').notNull(),
    startsAt: timestamptz('starts_at').notNull().defaultNow(),
    /** When the loan is planned to end; it ends when the lender ends it (`ended_at`). */
    plannedEndsAt: timestamptz('planned_ends_at'),
    endedAt: timestamptz('ended_at'),
    endedBy: text('ended_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    ...tenantConstraints('pod_loan', t),
    tenantReference('pod_loan', t.clubId, t.podId, pod),
    index('pod_loan_pod_idx').on(t.clubId, t.podId, t.startsAt),
    index('pod_loan_device_id_idx').on(t.deviceId),
    index('pod_loan_borrower_club_id_idx').on(t.borrowerClubId),
    index('pod_loan_ended_by_idx')
      .on(t.endedBy)
      .where(sql`${t.endedBy} is not null`),
    uniqueIndex('pod_loan_open_key')
      .on(t.clubId, t.podId)
      .where(sql`${t.endedAt} is null`),
    check('pod_loan_other_club', sql`${t.borrowerClubId} <> ${t.clubId}`),
    check(
      'pod_loan_range',
      sql`(${t.plannedEndsAt} is null or ${t.plannedEndsAt} > ${t.startsAt})
          and (${t.endedAt} is null or ${t.endedAt} >= ${t.startsAt})`,
    ),
  ],
);

/**
 * Which player wears a pod and when: `[starts_at, ends_at)`, open while
 * `ends_at` is `NULL` (ADR 0106). Never two live ones at once for the same
 * pod nor for the same player (exclusion constraints in the migration).
 * Optionally the session it is for. A wrong one is voided (`archived_at`,
 * with a reason) or corrected (with a reason, ADR 0030); either flags it for
 * the worker to reprocess the affected sessions (`reprocess_requested_at`).
 * Synced to the staff's devices; an offline create that overlaps is
 * rejected (`409`), never resolved by "last writer wins".
 */
export const podAssignment = pgTable(
  'pod_assignment',
  {
    ...tenantColumns(),
    podId: uuid('pod_id').notNull(),
    playerId: uuid('player_id').notNull().$type<PlayerId>(),
    trainingSessionId: uuid('training_session_id'),
    startsAt: timestamptz('starts_at').notNull(),
    endsAt: timestamptz('ends_at'),
    note: text('note'),
    /** A correction or a void changed what the pod's data belongs to: the worker reprocesses. */
    reprocessRequestedAt: timestamptz('reprocess_requested_at'),
    /** Voided: entered by mistake (with a reason). Out of the overlap checks. */
    archivedAt: timestamptz('archived_at'),
  },
  (t) => [
    ...tenantConstraints('pod_assignment', t),
    tenantReference('pod_assignment', t.clubId, t.podId, pod),
    tenantReference('pod_assignment', t.clubId, t.playerId, player),
    tenantReference('pod_assignment', t.clubId, t.trainingSessionId, trainingSession),
    index('pod_assignment_pod_idx').on(t.clubId, t.podId, t.startsAt),
    index('pod_assignment_player_idx').on(t.clubId, t.playerId, t.startsAt),
    index('pod_assignment_training_session_id_idx')
      .on(t.clubId, t.trainingSessionId)
      .where(sql`${t.trainingSessionId} is not null`),
    index('pod_assignment_reprocess_idx')
      .on(t.clubId, t.reprocessRequestedAt)
      .where(sql`${t.reprocessRequestedAt} is not null`),
    check('pod_assignment_range', sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
    check(
      'pod_assignment_note_format',
      sql`${t.note} is null or (${t.note} = btrim(${t.note}) and char_length(${t.note}) between 1 and ${sql.raw(String(POD_ASSIGNMENT_NOTE_MAX_LENGTH))})`,
    ),
  ],
);
