import {
  correctPodAssignment,
  createPodAssignment,
  endPodAssignment,
  endPodLoan,
  getPod,
  getPodAssignment,
  getSessionPods,
  lendPod,
  listPodAssignments,
  listPodCategories,
  listPodDevices,
  listPodLoans,
  listPods,
  markPodMissing,
  recoverPod,
  registerPod,
  registerPodDevice,
  retirePod,
  setPodCategory,
  updatePod,
  updatePodDevice,
  voidPodAssignment,
  type Pod,
  type PodAssignment,
  type PodDevice,
  type PodLoan,
  type SessionPodPlayer,
  type ValidationIssue,
} from '@sport-performance/contracts';
import {
  category,
  player,
  playerCategory,
  pod,
  podAssignment,
  podDevice,
  podLoan,
} from '@sport-performance/db/schema';
import {
  POD_ASSIGNMENT_CONSENTS,
  can,
  canChangePodStatus,
  nextPodShortId,
  podAssignmentNeedsReprocess,
  podAssignmentProblem,
  type CategoryId,
  type ClubId,
  type ExistingPodAssignment,
  type PlayerId,
  type PodAssignmentProblem,
  type PodProvisioningState,
  type PodStatus,
  type Sport,
} from '@sport-performance/domain';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { currentConsentTypesOf, requirePlayerFacts } from '../http/consents.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError, databaseErrorOf } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import type { RequestPermissions } from '../http/permissions.js';
import {
  insertIdempotent,
  markReplay,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';
import { lockKeys } from '../sync/locks.js';
import {
  authorizeSession,
  categoryCurrentOn,
  clubTimeZone,
  clubToday,
  readSession,
} from './training-shared.js';

/**
 * The pod fleet and its assignment to players (B-912, ADR 0106).
 *
 * - The registry of devices is global (`pod_device`, the superadmin on the
 *   registry); a club reads its devices through `app.club_pod_devices()`.
 * - The fleet (`pod`): S&C and the administration register, renumber, mark
 *   lost or stolen (keys revoked), recover, retire and lend pods
 *   (`app.lend_pod`, `app.end_pod_loan` write both clubs).
 * - Assignments (`pod_assignment`): the assigned staff and the
 *   administration, with the player's `data` and `location` consents (the
 *   matrix, and a restrictive policy as the last barrier), in categories with
 *   pods. Never two at once for a pod or a player: checked here under advisory
 *   locks and by the exclusion constraints (`409`, never "last writer wins",
 *   also from the offline queue).
 */

// ─── Devices ─────────────────────────────────────────────────────────────────────────

const podDeviceColumns = {
  id: podDevice.id,
  serialNumber: podDevice.serialNumber,
  chipId: podDevice.chipId,
  hardwareRevision: podDevice.hardwareRevision,
  provisioningState: podDevice.provisioningState,
  ownerClubId: podDevice.ownerClubId,
  createdAt: podDevice.createdAt,
  updatedAt: podDevice.updatedAt,
  version: rowVersion(podDevice.updatedAt),
};

interface PodDeviceRow {
  id: string;
  serialNumber: string;
  chipId: string;
  hardwareRevision: string;
  provisioningState: PodProvisioningState;
  ownerClubId: ClubId | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function podDeviceDto(row: PodDeviceRow): PodDevice {
  return {
    id: row.id as PodDevice['id'],
    serialNumber: row.serialNumber,
    chipId: row.chipId,
    hardwareRevision: row.hardwareRevision,
    provisioningState: row.provisioningState,
    ownerClubId: row.ownerClubId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const POD_DEVICE_KEYS: KeysetSpec<PodDeviceRow, 'serialNumber' | 'createdAt'> = {
  fields: {
    serialNumber: {
      column: podDevice.serialNumber,
      type: 'text',
      value: (row) => row.serialNumber,
    },
    createdAt: { column: podDevice.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: podDevice.id, value: (row) => row.id },
};

/** A device of the club (owned, or a pod of it on loan), as `app.club_pod_devices()` shows it. */
interface ClubDevice {
  readonly id: string;
  readonly serialNumber: string;
  readonly hardwareRevision: string;
  readonly owned: boolean;
}

async function clubDevices(db: TenantDatabase): Promise<Map<string, ClubDevice>> {
  const { rows } = await db.execute<{
    id: string;
    serial_number: string;
    hardware_revision: string;
    owned: boolean;
  }>(sql`select id, serial_number, hardware_revision, owned from app.club_pod_devices()`);
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        serialNumber: r.serial_number,
        hardwareRevision: r.hardware_revision,
        owned: r.owned,
      },
    ]),
  );
}

function deviceConflict(error: unknown): HttpError | undefined {
  const found = databaseErrorOf(error);
  if (found?.code !== '23505') return undefined;
  const field =
    found.constraint === 'pod_device_serial_number_key'
      ? 'serialNumber'
      : found.constraint === 'pod_device_chip_id_key'
        ? 'chipId'
        : undefined;
  if (field === undefined) return undefined;
  return new HttpError('conflict', `A device already has this ${field}`, {
    details: [{ path: ['body', field], code: 'taken', message: 'Already registered' }],
  });
}

// ─── Pods ────────────────────────────────────────────────────────────────────────────

const podColumns = {
  id: pod.id,
  deviceId: pod.deviceId,
  number: pod.number,
  shortId: pod.shortId,
  label: pod.label,
  status: pod.status,
  statusChangedAt: pod.statusChangedAt,
  keyEpoch: pod.keyEpoch,
  keysRevokedAt: pod.keysRevokedAt,
  borrowedFromClubId: pod.borrowedFromClubId,
  firmwareVersion: pod.firmwareVersion,
  gnssFirmwareVersion: pod.gnssFirmwareVersion,
  lastSeenAt: pod.lastSeenAt,
  batteryCycles: pod.batteryCycles,
  batteryCapacityPct: pod.batteryCapacityPct,
  nandBadBlocks: pod.nandBadBlocks,
  healthReportedAt: pod.healthReportedAt,
  createdAt: pod.createdAt,
  updatedAt: pod.updatedAt,
  version: rowVersion(pod.updatedAt),
};

interface PodRow {
  id: string;
  deviceId: string;
  number: number;
  shortId: number;
  label: string | null;
  status: PodStatus;
  statusChangedAt: Date;
  keyEpoch: number;
  keysRevokedAt: Date | null;
  borrowedFromClubId: ClubId | null;
  firmwareVersion: string | null;
  gnssFirmwareVersion: string | null;
  lastSeenAt: Date | null;
  batteryCycles: number | null;
  batteryCapacityPct: number | null;
  nandBadBlocks: number | null;
  healthReportedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

function podDto(row: PodRow, devices: ReadonlyMap<string, ClubDevice>): Pod {
  const device = devices.get(row.deviceId);
  return {
    id: row.id as Pod['id'],
    deviceId: row.deviceId as Pod['deviceId'],
    serialNumber: device?.serialNumber ?? '',
    hardwareRevision: device?.hardwareRevision ?? '',
    number: row.number,
    shortId: row.shortId,
    label: row.label,
    status: row.status,
    statusChangedAt: row.statusChangedAt.toISOString(),
    keyEpoch: row.keyEpoch,
    keysRevokedAt: iso(row.keysRevokedAt),
    borrowedFromClubId: row.borrowedFromClubId,
    health: {
      lastSeenAt: iso(row.lastSeenAt),
      reportedAt: iso(row.healthReportedAt),
      batteryCycles: row.batteryCycles,
      batteryCapacityPct: row.batteryCapacityPct,
      nandBadBlocks: row.nandBadBlocks,
      firmwareVersion: row.firmwareVersion,
      gnssFirmwareVersion: row.gnssFirmwareVersion,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const POD_KEYS: KeysetSpec<PodRow, 'number' | 'createdAt'> = {
  fields: {
    number: { column: pod.number, type: 'integer', value: (row) => row.number },
    createdAt: { column: pod.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: pod.id, value: (row) => row.id },
};

async function readPod(db: TenantDatabase, clubId: ClubId, podId: string): Promise<PodRow> {
  const [row] = await db
    .select(podColumns)
    .from(pod)
    .where(and(eq(pod.clubId, clubId), eq(pod.id, podId)));
  if (row === undefined) throw new HttpError('not_found', 'Pod not found');
  return row;
}

async function podResponse(db: TenantDatabase, clubId: ClubId, podId: string): Promise<Pod> {
  return podDto(await readPod(db, clubId, podId), await clubDevices(db));
}

/** Serializes the writes that take short ids and numbers of the club's network (as `app.lend_pod`). */
async function lockClubNetwork(db: TenantDatabase, clubId: ClubId): Promise<void> {
  await db.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`pod_short_id:${clubId}`}, 0))`,
  );
}

function podConflict(error: unknown): HttpError | undefined {
  const found = databaseErrorOf(error);
  if (found?.code !== '23505') return undefined;
  const field = {
    pod_number_live_key: 'number',
    pod_short_id_live_key: 'shortId',
    pod_device_live_key: 'serialNumber',
  }[found.constraint ?? ''];
  if (field === undefined) return undefined;
  return new HttpError('conflict', `Another pod of the fleet already has this ${field}`, {
    details: [{ path: ['body', field], code: 'taken', message: 'Taken by a pod of the fleet' }],
  });
}

/**
 * Whether the pod is worn now or later, by anyone (`app.release_pod_assignments` sees the
 * whole club: S&C runs the fleet but only sees the players of its assignments).
 */
async function podInUse(db: TenantDatabase, podId: string): Promise<boolean> {
  const { rows } = await db.execute<{ n: number }>(
    sql`select app.release_pod_assignments(${podId}::uuid, '', true) as n`,
  );
  return (rows[0]?.n ?? 0) > 0;
}

// ─── Loans ───────────────────────────────────────────────────────────────────────────

const podLoanColumns = {
  id: podLoan.id,
  podId: podLoan.podId,
  borrowerClubId: podLoan.borrowerClubId,
  startsAt: podLoan.startsAt,
  plannedEndsAt: podLoan.plannedEndsAt,
  endedAt: podLoan.endedAt,
  createdAt: podLoan.createdAt,
  updatedAt: podLoan.updatedAt,
};

interface PodLoanRow {
  id: string;
  podId: string;
  borrowerClubId: ClubId;
  startsAt: Date;
  plannedEndsAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function podLoanDto(row: PodLoanRow): PodLoan {
  return {
    id: row.id as PodLoan['id'],
    podId: row.podId as PodLoan['podId'],
    borrowerClubId: row.borrowerClubId,
    startsAt: row.startsAt.toISOString(),
    plannedEndsAt: iso(row.plannedEndsAt),
    endedAt: iso(row.endedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const POD_LOAN_KEYS: KeysetSpec<PodLoanRow, 'startsAt'> = {
  fields: {
    startsAt: { column: podLoan.startsAt, type: 'timestamp', value: (row) => row.startsAt },
  },
  id: { column: podLoan.id, value: (row) => row.id },
};

async function readPodLoan(db: TenantDatabase, clubId: ClubId, id: string): Promise<PodLoanRow> {
  const [row] = await db
    .select(podLoanColumns)
    .from(podLoan)
    .where(and(eq(podLoan.clubId, clubId), eq(podLoan.id, id)));
  if (row === undefined) throw new HttpError('not_found', 'Pod loan not found');
  return row;
}

// ─── Assignments ─────────────────────────────────────────────────────────────────────

export const podAssignmentColumns = {
  id: podAssignment.id,
  clientUuid: podAssignment.clientUuid,
  podId: podAssignment.podId,
  // The pod under its own RLS: the player, who never reads the fleet, gets `null`.
  podNumber: sql<
    number | null
  >`(select p.number from ${pod} p where p.club_id = ${podAssignment.clubId} and p.id = ${podAssignment.podId})`,
  playerId: podAssignment.playerId,
  trainingSessionId: podAssignment.trainingSessionId,
  startsAt: podAssignment.startsAt,
  endsAt: podAssignment.endsAt,
  note: podAssignment.note,
  reprocessRequestedAt: podAssignment.reprocessRequestedAt,
  archivedAt: podAssignment.archivedAt,
  createdBy: podAssignment.createdBy,
  createdAt: podAssignment.createdAt,
  updatedAt: podAssignment.updatedAt,
  version: rowVersion(podAssignment.updatedAt),
};

export interface PodAssignmentRow {
  id: string;
  clientUuid: string;
  podId: string;
  podNumber: number | null;
  playerId: PlayerId;
  trainingSessionId: string | null;
  startsAt: Date;
  endsAt: Date | null;
  note: string | null;
  reprocessRequestedAt: Date | null;
  archivedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

export function podAssignmentDto(row: PodAssignmentRow): PodAssignment {
  return {
    id: row.id as PodAssignment['id'],
    clientUuid: row.clientUuid as PodAssignment['clientUuid'],
    podId: row.podId as PodAssignment['podId'],
    podNumber: row.podNumber,
    playerId: row.playerId,
    trainingSessionId: row.trainingSessionId as PodAssignment['trainingSessionId'],
    startsAt: row.startsAt.toISOString(),
    endsAt: iso(row.endsAt),
    note: row.note,
    reprocessRequestedAt: iso(row.reprocessRequestedAt),
    archivedAt: iso(row.archivedAt),
    createdBy: row.createdBy as PodAssignment['createdBy'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const ASSIGNMENT_KEYS: KeysetSpec<PodAssignmentRow, 'startsAt'> = {
  fields: {
    startsAt: {
      column: podAssignment.startsAt,
      type: 'timestamp',
      value: (row) => row.startsAt,
    },
  },
  id: { column: podAssignment.id, value: (row) => row.id },
};

async function readAssignment(
  db: TenantDatabase,
  clubId: ClubId,
  id: string,
): Promise<PodAssignmentRow> {
  const [row] = await db
    .select(podAssignmentColumns)
    .from(podAssignment)
    .where(and(eq(podAssignment.clubId, clubId), eq(podAssignment.id, id)));
  if (row === undefined) throw new HttpError('not_found', 'Pod assignment not found');
  return row;
}

/** Authorizes an action on the assignments of a player; `404` when the player is not visible. */
async function authorizeAssignment(
  db: TenantDatabase,
  permissions: RequestPermissions,
  clubId: ClubId,
  playerId: PlayerId,
  action: 'read' | 'assign' | 'manage',
) {
  const loaded = await requirePlayerFacts(db, clubId, playerId);
  await permissions.authorize('pod_assignment', action, { player: loaded.facts });
  return loaded;
}

/** `tstzrange(starts_at, ends_at, '[)')` of an assignment overlaps `[startsAt, endsAt)`. */
function overlapsRange(startsAt: Date, endsAt: Date | null): SQL {
  return sql`tstzrange(${podAssignment.startsAt}, ${podAssignment.endsAt}, '[)') && tstzrange(${startsAt.toISOString()}::timestamptz, ${endsAt?.toISOString() ?? null}::timestamptz, '[)')`;
}

/** The live assignments of the pod or the player that overlap the range (as the caller sees them). */
async function overlapping(
  db: TenantDatabase,
  clubId: ClubId,
  podId: string,
  playerId: PlayerId,
  startsAt: Date,
  endsAt: Date | null,
): Promise<ExistingPodAssignment[]> {
  return db
    .select({
      id: podAssignment.id,
      podId: podAssignment.podId,
      playerId: podAssignment.playerId,
      startsAt: podAssignment.startsAt,
      endsAt: podAssignment.endsAt,
    })
    .from(podAssignment)
    .where(
      and(
        eq(podAssignment.clubId, clubId),
        isNull(podAssignment.archivedAt),
        or(eq(podAssignment.podId, podId), eq(podAssignment.playerId, playerId)),
        overlapsRange(startsAt, endsAt),
      ),
    );
}

/** Serializes the assignments of a pod and of a player (online and offline alike). */
async function lockAssignmentKeys(db: TenantDatabase, podId: string, playerId: string) {
  await lockKeys(db, [`pod_assignment:pod:${podId}`, `pod_assignment:player:${playerId}`].sort());
}

const issue = (path: (string | number)[], code: string, message: string): ValidationIssue => ({
  path,
  code,
  message,
});

/** The answer of the API to a problem of an assignment (the consents are the matrix's). */
function assignmentProblemError(problem: PodAssignmentProblem): HttpError {
  switch (problem.code) {
    case 'ends_before_start':
      return new HttpError('validation_failed', 'The assignment ends before it starts', {
        details: [issue(['body', 'endsAt'], 'custom', 'After startsAt')],
      });
    case 'too_long':
      return new HttpError('validation_failed', 'The assignment is too long', {
        details: [issue(['body', 'endsAt'], 'custom', 'At most two weeks after startsAt')],
      });
    case 'pod_not_active':
      return new HttpError('conflict', `The pod is ${problem.status}: only an active pod`, {
        details: [issue(['body', 'podId'], 'pod_not_active', `The pod is ${problem.status}`)],
      });
    case 'category_not_enabled':
      return new HttpError('conflict', 'The category has no pods', {
        details: [
          issue(['body', 'playerId'], 'category_not_enabled', 'Pods are off in this category'),
        ],
      });
    case 'consent_required':
      return new HttpError('consent_required', 'The player has no data and location consents', {
        details: problem.missing.map((type) =>
          issue(
            ['consents', type],
            'consent_required',
            `The player has no current ${type} consent`,
          ),
        ),
      });
    case 'pod_overlap':
      return new HttpError('conflict', `The pod is assigned then: ${problem.assignmentId}`, {
        details: [issue(['body', 'podId'], 'pod_overlap', problem.assignmentId)],
      });
    case 'player_overlap':
      return new HttpError('conflict', `The player has a pod then: ${problem.assignmentId}`, {
        details: [issue(['body', 'playerId'], 'player_overlap', problem.assignmentId)],
      });
  }
}

/**
 * An overlap the exclusion constraints found (another one the caller does
 * not see, or a concurrent write): `409` with the same details.
 */
function exclusionError(error: unknown): HttpError | undefined {
  const found = databaseErrorOf(error);
  if (found?.code !== '23P01') return undefined;
  if (found.constraint === 'pod_assignment_pod_no_overlap') {
    return new HttpError('conflict', 'The pod is assigned then', {
      details: [issue(['body', 'podId'], 'pod_overlap', 'Another assignment of the pod')],
    });
  }
  if (found.constraint === 'pod_assignment_player_no_overlap') {
    return new HttpError('conflict', 'The player has a pod then', {
      details: [issue(['body', 'playerId'], 'player_overlap', 'Another assignment of the player')],
    });
  }
  return undefined;
}

async function withExclusion<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw exclusionError(error) ?? error;
  }
}

/** Whether a category the assignment is for has pods: the session's, else a current one of the player. */
async function categoryHasPods(
  db: TenantDatabase,
  clubId: ClubId,
  categoryIds: readonly CategoryId[],
): Promise<boolean> {
  if (categoryIds.length === 0) return false;
  const rows = await db
    .select({ id: category.id })
    .from(category)
    .where(
      and(
        eq(category.clubId, clubId),
        inArray(category.id, [...categoryIds]),
        eq(category.podsEnabled, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Ends what a pod that leaves the fleet now was assigned to, whoever wore it: the live
 * assignment ends now and those that had not started are voided (flagged for
 * reprocessing). The reason is the event.
 */
async function releasePodAssignments(
  db: TenantDatabase,
  podId: string,
  reason: string,
): Promise<void> {
  await db.execute(sql`select app.release_pod_assignments(${podId}::uuid, ${reason}, false)`);
}

/** The database's clock (the instant `now()` of the transaction), the one the checks compare with. */
async function databaseNow(db: TenantDatabase): Promise<Date> {
  const { rows } = await db.execute<{ ms: string }>(
    sql`select floor(extract(epoch from now()) * 1000)::bigint::text as ms`,
  );
  const value = rows[0]?.ms;
  if (value === undefined) throw new Error('now() returned no row');
  return new Date(Number(value));
}

// ─── Routes ──────────────────────────────────────────────────────────────────────────

export function registerPodRoutes(app: FastifyInstance): void {
  // ── Registry of devices (superadmin) ──

  registerEndpoint(app, listPodDevices, {
    transaction: true,
    scope: 'registry',
    handler: async ({ query }, { db, permissions }) => {
      await permissions.authorize('pod_device', 'read');
      const plan = keysetPage(POD_DEVICE_KEYS, query, {
        serialNumber: query.serialNumber,
        ownerClubId: query.ownerClubId,
      });
      const rows = await db
        .select(podDeviceColumns)
        .from(podDevice)
        .where(
          and(
            query.serialNumber === undefined
              ? undefined
              : eq(podDevice.serialNumber, query.serialNumber),
            query.ownerClubId === undefined
              ? undefined
              : eq(podDevice.ownerClubId, query.ownerClubId),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, podDeviceDto);
    },
  });

  registerEndpoint(app, registerPodDevice, {
    transaction: true,
    scope: 'registry',
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('pod_device', 'manage');
      const findByClientUuid = async (clientUuid: string) =>
        (
          await db
            .select(podDeviceColumns)
            .from(podDevice)
            .where(eq(podDevice.clientUuid, clientUuid))
        )[0];
      try {
        const { row } = await insertIdempotent({
          clientUuid: body.clientUuid,
          reply,
          insert: async () =>
            (
              await db
                .insert(podDevice)
                .values({
                  ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                  serialNumber: body.serialNumber,
                  chipId: body.chipId,
                  hardwareRevision: body.hardwareRevision,
                  ...(body.provisioningState !== undefined && {
                    provisioningState: body.provisioningState,
                  }),
                  ownerClubId: body.ownerClubId ?? null,
                  createdBy: caller.userId,
                  updatedBy: caller.userId,
                })
                .onConflictDoNothing({ target: podDevice.clientUuid })
                .returning(podDeviceColumns)
            )[0],
          findByClientUuid,
        });
        return podDeviceDto(row);
      } catch (error) {
        throw deviceConflict(error) ?? error;
      }
    },
  });

  registerEndpoint(app, updatePodDevice, {
    transaction: true,
    scope: 'registry',
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod_device', 'manage');
      const where = eq(podDevice.id, params.podDeviceId);
      const row = await updateAtVersion({
        resource: 'Pod device',
        update: async () =>
          (
            await db
              .update(podDevice)
              .set({
                ...(body.hardwareRevision !== undefined && {
                  hardwareRevision: body.hardwareRevision,
                }),
                ...(body.provisioningState !== undefined && {
                  provisioningState: body.provisioningState,
                }),
                ...(body.ownerClubId !== undefined && { ownerClubId: body.ownerClubId }),
                updatedBy: caller.userId,
              })
              .where(and(where, versionMatches(podDevice.updatedAt, body.version)))
              .returning(podDeviceColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: podDevice.id }).from(podDevice).where(where)).length > 0,
      });
      return podDeviceDto(row);
    },
  });

  // ── Fleet ──

  registerEndpoint(app, listPods, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'read');
      const { clubId } = caller.membership;
      const plan = keysetPage(POD_KEYS, query, {
        status: query.status,
        serialNumber: query.serialNumber,
      });
      const devices = await clubDevices(db);
      let deviceFilter: SQL | undefined;
      if (query.serialNumber !== undefined) {
        const device = [...devices.values()].find((d) => d.serialNumber === query.serialNumber);
        if (device === undefined) return { items: [], nextCursor: null };
        deviceFilter = eq(pod.deviceId, device.id);
      }
      const statusFilter =
        query.status === 'all'
          ? undefined
          : query.status === 'in_fleet'
            ? ne(pod.status, 'retired')
            : eq(pod.status, query.status);
      const rows = await db
        .select(podColumns)
        .from(pod)
        .where(and(eq(pod.clubId, clubId), statusFilter, deviceFilter, plan.where))
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, (row) => podDto(row, devices));
    },
  });

  registerEndpoint(app, getPod, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'read');
      return podResponse(db, caller.membership.clubId, params.podId);
    },
  });

  registerEndpoint(app, registerPod, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('pod', 'manage');
      const { clubId } = caller.membership;
      const findByClientUuid = async (clientUuid: string) =>
        (
          await db
            .select(podColumns)
            .from(pod)
            .where(and(eq(pod.clubId, clubId), eq(pod.clientUuid, clientUuid)))
        )[0];
      if (body.clientUuid !== undefined) {
        const replay = await findByClientUuid(body.clientUuid);
        if (replay !== undefined) {
          markReplay(reply);
          return podDto(replay, await clubDevices(db));
        }
      }
      const devices = await clubDevices(db);
      const device = [...devices.values()].find(
        (d) => d.owned && d.serialNumber === body.serialNumber,
      );
      if (device === undefined) {
        throw new HttpError('not_found', 'No device of the club has this serial number', {
          details: [issue(['body', 'serialNumber'], 'not_found', 'Not a device of the club')],
        });
      }
      await lockClubNetwork(db, clubId);
      const live = await db
        .select({ id: pod.id, shortId: pod.shortId, deviceId: pod.deviceId })
        .from(pod)
        .where(and(eq(pod.clubId, clubId), ne(pod.status, 'retired')));
      if (live.some((p) => p.deviceId === device.id)) {
        throw new HttpError('conflict', 'The device is already in the fleet', {
          details: [issue(['body', 'serialNumber'], 'taken', 'Already a pod of the fleet')],
        });
      }
      const shortId = body.shortId ?? nextPodShortId(live.map((p) => p.shortId));
      if (shortId === null) throw new HttpError('conflict', 'The network of the club is full');
      try {
        const { row } = await insertIdempotent({
          clientUuid: body.clientUuid,
          reply,
          insert: async () =>
            (
              await db
                .insert(pod)
                .values({
                  clubId,
                  ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                  deviceId: device.id,
                  shortId,
                  number: body.number,
                  label: body.label ?? null,
                  createdBy: caller.userId,
                  updatedBy: caller.userId,
                })
                .onConflictDoNothing({ target: [pod.clubId, pod.clientUuid] })
                .returning(podColumns)
            )[0],
          findByClientUuid,
        });
        return podDto(row, await clubDevices(db));
      } catch (error) {
        throw podConflict(error) ?? error;
      }
    },
  });

  registerEndpoint(app, updatePod, {
    transaction: true,
    changeReason: ({ body }) => body.changeReason,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'manage');
      const { clubId } = caller.membership;
      const current = await readPod(db, clubId, params.podId);
      if (current.status === 'retired') {
        throw new HttpError('conflict', 'The pod is retired');
      }
      const renumbered =
        (body.number !== undefined && body.number !== current.number) ||
        (body.shortId !== undefined && body.shortId !== current.shortId);
      if (renumbered && body.changeReason === undefined) {
        throw new HttpError('validation_failed', 'Renumbering a pod needs a reason', {
          details: [issue(['body', 'changeReason'], 'custom', 'Required to renumber a pod')],
        });
      }
      if (body.shortId !== undefined) await lockClubNetwork(db, clubId);
      const where = and(eq(pod.clubId, clubId), eq(pod.id, current.id));
      try {
        await updateAtVersion({
          resource: 'Pod',
          update: async () =>
            (
              await db
                .update(pod)
                .set({
                  ...(body.number !== undefined && { number: body.number }),
                  ...(body.shortId !== undefined && { shortId: body.shortId }),
                  ...(body.label !== undefined && { label: body.label }),
                  updatedBy: caller.userId,
                })
                .where(and(where, versionMatches(pod.updatedAt, body.version)))
                .returning({ id: pod.id })
            )[0],
          exists: async () => (await db.select({ id: pod.id }).from(pod).where(where)).length > 0,
        });
      } catch (error) {
        throw podConflict(error) ?? error;
      }
      return podResponse(db, clubId, current.id);
    },
  });

  registerEndpoint(app, markPodMissing, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'manage');
      const { clubId } = caller.membership;
      const current = await readPod(db, clubId, params.podId);
      if (current.status === body.status) return podResponse(db, clubId, current.id);
      if (!canChangePodStatus(current.status, body.status)) {
        throw new HttpError('conflict', `A ${current.status} pod is not marked ${body.status}`);
      }
      await releasePodAssignments(db, current.id, `pod marked ${body.status}`);
      // Its keys are revoked (ADR 0106): the base stops accepting it and rotates the beacon
      // keys of the club's gateways on its next connection.
      await db
        .update(pod)
        .set({
          status: body.status,
          statusChangedAt: sql`now()`,
          keysRevokedAt: sql`coalesce(${pod.keysRevokedAt}, now())`,
          updatedBy: caller.userId,
        })
        .where(and(eq(pod.clubId, clubId), eq(pod.id, current.id)));
      return podResponse(db, clubId, current.id);
    },
  });

  registerEndpoint(app, recoverPod, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'manage');
      const { clubId } = caller.membership;
      const current = await readPod(db, clubId, params.podId);
      if (current.status === 'active') return podResponse(db, clubId, current.id);
      if (!canChangePodStatus(current.status, 'active')) {
        throw new HttpError('conflict', `A ${current.status} pod is not recovered`);
      }
      // Provisioned again with the next key epoch before it is used.
      await db
        .update(pod)
        .set({
          status: 'active',
          statusChangedAt: sql`now()`,
          keyEpoch: sql`${pod.keyEpoch} + 1`,
          keysRevokedAt: null,
          updatedBy: caller.userId,
        })
        .where(and(eq(pod.clubId, clubId), eq(pod.id, current.id)));
      return podResponse(db, clubId, current.id);
    },
  });

  registerEndpoint(app, retirePod, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'manage');
      const { clubId } = caller.membership;
      const current = await readPod(db, clubId, params.podId);
      if (current.status === 'retired') return podResponse(db, clubId, current.id);
      if (current.status === 'lent' || current.borrowedFromClubId !== null) {
        throw new HttpError('conflict', 'A pod of a loan is retired by ending the loan');
      }
      if (await podInUse(db, current.id)) {
        throw new HttpError('conflict', 'The pod is assigned now or later: end it first');
      }
      await db
        .update(pod)
        .set({ status: 'retired', statusChangedAt: sql`now()`, updatedBy: caller.userId })
        .where(and(eq(pod.clubId, clubId), eq(pod.id, current.id)));
      return podResponse(db, clubId, current.id);
    },
  });

  // ── Categories with pods ──

  registerEndpoint(app, listPodCategories, {
    transaction: true,
    handler: async (_input, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'read');
      const rows = await db
        .select({ categoryId: category.id, podsEnabled: category.podsEnabled })
        .from(category)
        .where(and(eq(category.clubId, caller.membership.clubId), isNull(category.archivedAt)))
        .orderBy(asc(category.sortOrder), asc(category.name), asc(category.id));
      return { items: rows };
    },
  });

  registerEndpoint(app, setPodCategory, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('category', 'manage');
      const { clubId } = caller.membership;
      const where = and(eq(category.clubId, clubId), eq(category.id, params.categoryId));
      const [current] = await db
        .select({ archivedAt: category.archivedAt })
        .from(category)
        .where(where);
      if (current === undefined) throw new HttpError('not_found', 'Category not found');
      if (current.archivedAt !== null) {
        throw new HttpError('conflict', 'The category is archived: restore it first');
      }
      const [row] = await db
        .update(category)
        .set({ podsEnabled: body.podsEnabled, updatedBy: caller.userId })
        .where(where)
        .returning({ categoryId: category.id, podsEnabled: category.podsEnabled });
      if (row === undefined) throw new HttpError('not_found', 'Category not found');
      return row;
    },
  });

  // ── Loans ──

  registerEndpoint(app, listPodLoans, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'manage');
      const plan = keysetPage(POD_LOAN_KEYS, query, { status: query.status });
      const rows = await db
        .select(podLoanColumns)
        .from(podLoan)
        .where(
          and(
            eq(podLoan.clubId, caller.membership.clubId),
            query.status === 'open' ? isNull(podLoan.endedAt) : undefined,
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, podLoanDto);
    },
  });

  registerEndpoint(app, lendPod, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('pod', 'manage');
      const { clubId } = caller.membership;
      const clientUuid = body.clientUuid ?? randomUUID();
      const [replay] = await db
        .select({ id: podLoan.id })
        .from(podLoan)
        .where(and(eq(podLoan.clubId, clubId), eq(podLoan.clientUuid, clientUuid)));
      if (replay !== undefined) {
        markReplay(reply);
        return podLoanDto(await readPodLoan(db, clubId, replay.id));
      }
      if (
        body.plannedEndsAt !== undefined &&
        new Date(body.plannedEndsAt).getTime() <= Date.now()
      ) {
        throw new HttpError('validation_failed', 'The loan ends in the future', {
          details: [issue(['body', 'plannedEndsAt'], 'custom', 'After now')],
        });
      }
      let loanId: string;
      try {
        const { rows } = await db.execute<{ id: string }>(
          sql`select app.lend_pod(${params.podId}::uuid, ${body.borrowerClubSlug}, ${body.plannedEndsAt ?? null}::timestamptz, ${clientUuid}::uuid) as id`,
        );
        loanId = rows[0]?.id ?? '';
      } catch (error) {
        const found = databaseErrorOf(error);
        if (found?.code === 'P0002') throw new HttpError('not_found', 'Pod or club not found');
        if (found?.code === '23514' && found.constraint === 'pod_loan_pod_in_use') {
          throw new HttpError('conflict', 'The pod is assigned now or later: end it first');
        }
        if (found?.code === '23514' && found.constraint === 'pod_loan_pod_unavailable') {
          throw new HttpError('conflict', 'Only an active pod of the club itself is lent');
        }
        if (found?.code === '23505' && found.constraint === 'pod_number_live_key') {
          throw new HttpError('conflict', 'The receiving club already has a pod with this number');
        }
        throw error;
      }
      return podLoanDto(await readPodLoan(db, clubId, loanId));
    },
  });

  registerEndpoint(app, endPodLoan, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('pod', 'manage');
      const { clubId } = caller.membership;
      await readPodLoan(db, clubId, params.podLoanId);
      await db.execute(sql`select app.end_pod_loan(${params.podLoanId}::uuid)`);
      return podLoanDto(await readPodLoan(db, clubId, params.podLoanId));
    },
  });

  // ── Assignments ──

  registerEndpoint(app, listPodAssignments, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const scope = await permissions.listScope('pod_assignment', 'read');
      const plan = keysetPage(ASSIGNMENT_KEYS, query, {
        trainingSessionId: query.trainingSessionId,
        on: query.on,
        podId: query.podId,
        playerId: query.playerId,
        status: query.status,
      });
      if (scope.kind === 'none' || scope.kind === 'platform')
        return { items: [], nextCursor: null };
      if (scope.rowCheck) {
        // `pod_assignment.read` has no consent or condition today; a new one needs a row check.
        throw new Error('listPodAssignments: the matrix asks for a row check the list does not do');
      }
      let inScope: SQL | undefined;
      switch (scope.kind) {
        case 'club':
          inScope = undefined;
          break;
        case 'assigned':
          inScope = assignedPlayers(await clubToday(db), scope.categoryIds, scope.sports);
          break;
        case 'players':
          inScope = inArray(podAssignment.playerId, [...scope.playerIds]);
          break;
      }
      let onDay: SQL | undefined;
      if (query.on !== undefined) {
        const zone = await clubTimeZone(db, clubId);
        onDay = sql`tstzrange(${podAssignment.startsAt}, ${podAssignment.endsAt}, '[)') && tstzrange((${query.on}::date)::timestamp at time zone ${zone}, (${query.on}::date + 1)::timestamp at time zone ${zone}, '[)')`;
      }
      const rows = await db
        .select(podAssignmentColumns)
        .from(podAssignment)
        .where(
          and(
            eq(podAssignment.clubId, clubId),
            inScope,
            query.status === 'live' ? isNull(podAssignment.archivedAt) : undefined,
            query.trainingSessionId === undefined
              ? undefined
              : eq(podAssignment.trainingSessionId, query.trainingSessionId),
            query.podId === undefined ? undefined : eq(podAssignment.podId, query.podId),
            query.playerId === undefined ? undefined : eq(podAssignment.playerId, query.playerId),
            onDay,
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, podAssignmentDto);
    },
  });

  registerEndpoint(app, getPodAssignment, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await readAssignment(db, clubId, params.podAssignmentId);
      await authorizeAssignment(db, permissions, clubId, row.playerId, 'read');
      return podAssignmentDto(row);
    },
  });

  registerEndpoint(app, createPodAssignment, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply, recordedAt }) => {
      const { clubId } = caller.membership;
      const findByClientUuid = async (clientUuid: string) =>
        (
          await db
            .select(podAssignmentColumns)
            .from(podAssignment)
            .where(and(eq(podAssignment.clubId, clubId), eq(podAssignment.clientUuid, clientUuid)))
        )[0];
      if (body.clientUuid !== undefined) {
        // A retry (or the offline queue) answers what it created, also once the consent lapsed.
        const replay = await findByClientUuid(body.clientUuid);
        if (replay !== undefined) {
          await authorizeAssignment(db, permissions, clubId, replay.playerId, 'read');
          markReplay(reply);
          return podAssignmentDto(replay);
        }
      }
      const { facts } = await authorizeAssignment(db, permissions, clubId, body.playerId, 'assign');
      const current = await readPod(db, clubId, body.podId).catch(() => {
        throw new HttpError('not_found', 'Pod not found', {
          details: [issue(['body', 'podId'], 'not_found', 'Not a pod of the club')],
        });
      });
      let categoryIds: readonly CategoryId[] = facts.categoryIds;
      if (body.trainingSessionId !== undefined) {
        const session = await readSession(db, clubId, body.trainingSessionId);
        if (session.archivedAt !== null) {
          throw new HttpError('conflict', 'The training session is archived: restore it first');
        }
        categoryIds = session.categoryId === null ? [] : [session.categoryId];
      }
      const startsAt =
        body.startsAt === undefined
          ? (recordedAt ?? (await databaseNow(db)))
          : new Date(body.startsAt);
      const endsAt = body.endsAt === undefined ? null : new Date(body.endsAt);
      await lockAssignmentKeys(db, current.id, body.playerId);
      const problem = podAssignmentProblem({
        podId: current.id,
        playerId: body.playerId,
        startsAt,
        endsAt,
        podStatus: current.status,
        categoryPodsEnabled: await categoryHasPods(db, clubId, categoryIds),
        consents: facts.consents ?? [],
        existing: await overlapping(db, clubId, current.id, body.playerId, startsAt, endsAt),
      });
      if (problem !== null) throw assignmentProblemError(problem);
      const { row } = await withExclusion(() =>
        insertIdempotent({
          clientUuid: body.clientUuid,
          reply,
          insert: async () => {
            const [inserted] = await db
              .insert(podAssignment)
              .values({
                clubId,
                ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                podId: current.id,
                playerId: body.playerId,
                trainingSessionId: body.trainingSessionId ?? null,
                startsAt,
                endsAt,
                note: body.note ?? null,
                createdBy: caller.userId,
                updatedBy: caller.userId,
              })
              .onConflictDoNothing({ target: [podAssignment.clubId, podAssignment.clientUuid] })
              .returning({ id: podAssignment.id });
            return inserted === undefined ? undefined : readAssignment(db, clubId, inserted.id);
          },
          findByClientUuid,
        }),
      );
      return podAssignmentDto(row);
    },
  });

  registerEndpoint(app, endPodAssignment, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller, recordedAt }) => {
      const { clubId } = caller.membership;
      const row = await readAssignment(db, clubId, params.podAssignmentId);
      await authorizeAssignment(db, permissions, clubId, row.playerId, 'manage');
      if (row.archivedAt !== null || row.endsAt !== null) {
        throw new HttpError('conflict', 'The assignment already ended or was voided');
      }
      const endsAt =
        body.endsAt === undefined ? (recordedAt ?? (await databaseNow(db))) : new Date(body.endsAt);
      if (endsAt.getTime() <= row.startsAt.getTime()) {
        throw assignmentProblemError({ code: 'ends_before_start' });
      }
      const [updated] = await db
        .update(podAssignment)
        .set({ endsAt, updatedBy: caller.userId })
        .where(
          and(
            eq(podAssignment.clubId, clubId),
            eq(podAssignment.id, row.id),
            isNull(podAssignment.endsAt),
            isNull(podAssignment.archivedAt),
          ),
        )
        .returning({ id: podAssignment.id });
      if (updated === undefined) {
        throw new HttpError('conflict', 'The assignment already ended or was voided');
      }
      return podAssignmentDto(await readAssignment(db, clubId, row.id));
    },
  });

  registerEndpoint(app, correctPodAssignment, {
    transaction: true,
    changeReason: ({ body }) => body.changeReason,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await readAssignment(db, clubId, params.podAssignmentId);
      await authorizeAssignment(db, permissions, clubId, row.playerId, 'manage');
      if (row.archivedAt !== null) {
        throw new HttpError('conflict', 'The assignment was voided');
      }
      const after = {
        startsAt: body.startsAt === undefined ? row.startsAt : new Date(body.startsAt),
        endsAt:
          body.endsAt === undefined
            ? row.endsAt
            : body.endsAt === null
              ? null
              : new Date(body.endsAt),
      };
      const reprocess = podAssignmentNeedsReprocess(row, after);
      if (reprocess && body.changeReason === undefined) {
        throw new HttpError('validation_failed', 'Correcting the range needs a reason', {
          details: [issue(['body', 'changeReason'], 'custom', 'Required to correct the range')],
        });
      }
      if (reprocess) {
        await lockAssignmentKeys(db, row.podId, row.playerId);
        // A correction fixes what happened: the pod, the category and the consents were
        // checked when it was made (a pod lost since, a revoked consent, do not block it).
        // Only the range and the overlaps are checked again.
        const problem = podAssignmentProblem({
          podId: row.podId,
          playerId: row.playerId,
          ...after,
          podStatus: 'active',
          categoryPodsEnabled: true,
          consents: [...POD_ASSIGNMENT_CONSENTS],
          existing: await overlapping(
            db,
            clubId,
            row.podId,
            row.playerId,
            after.startsAt,
            after.endsAt,
          ),
          ignoreId: row.id,
        });
        if (problem !== null) throw assignmentProblemError(problem);
      }
      await withExclusion(() =>
        updateAtVersion({
          resource: 'Pod assignment',
          update: async () =>
            (
              await db
                .update(podAssignment)
                .set({
                  ...(body.startsAt !== undefined && { startsAt: after.startsAt }),
                  ...(body.endsAt !== undefined && { endsAt: after.endsAt }),
                  ...(body.note !== undefined && { note: body.note }),
                  ...(reprocess && { reprocessRequestedAt: sql`now()` }),
                  updatedBy: caller.userId,
                })
                .where(
                  and(
                    eq(podAssignment.clubId, clubId),
                    eq(podAssignment.id, row.id),
                    isNull(podAssignment.archivedAt),
                    versionMatches(podAssignment.updatedAt, body.version),
                  ),
                )
                .returning({ id: podAssignment.id })
            )[0],
          exists: async () =>
            (
              await db
                .select({ id: podAssignment.id })
                .from(podAssignment)
                .where(and(eq(podAssignment.clubId, clubId), eq(podAssignment.id, row.id)))
            ).length > 0,
        }),
      );
      return podAssignmentDto(await readAssignment(db, clubId, row.id));
    },
  });

  registerEndpoint(app, voidPodAssignment, {
    transaction: true,
    changeReason: ({ body }) => body.changeReason,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const row = await readAssignment(db, clubId, params.podAssignmentId);
      await authorizeAssignment(db, permissions, clubId, row.playerId, 'manage');
      if (row.archivedAt !== null) return podAssignmentDto(row);
      await updateAtVersion({
        resource: 'Pod assignment',
        update: async () =>
          (
            await db
              .update(podAssignment)
              .set({
                archivedAt: sql`now()`,
                reprocessRequestedAt: sql`now()`,
                updatedBy: caller.userId,
              })
              .where(
                and(
                  eq(podAssignment.clubId, clubId),
                  eq(podAssignment.id, row.id),
                  isNull(podAssignment.archivedAt),
                  versionMatches(podAssignment.updatedAt, body.version),
                ),
              )
              .returning({ id: podAssignment.id })
          )[0],
        exists: async () =>
          (
            await db
              .select({ id: podAssignment.id })
              .from(podAssignment)
              .where(and(eq(podAssignment.clubId, clubId), eq(podAssignment.id, row.id)))
          ).length > 0,
      });
      return podAssignmentDto(await readAssignment(db, clubId, row.id));
    },
  });

  // ── Pods of a session ──

  registerEndpoint(app, getSessionPods, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      const { clubId } = caller.membership;
      const session = await readSession(db, clubId, params.trainingSessionId);
      await authorizeSession(permissions, session, 'read');
      const subject = await permissions.subject();
      const podsEnabled =
        session.categoryId === null
          ? false
          : await categoryHasPods(db, clubId, [session.categoryId]);
      if (session.categoryId === null) return { podsEnabled, players: [] };
      // The players of the session's category on the session's club day, as the caller sees them.
      const players = await db
        .select({ id: player.id, firstName: player.firstName, lastName: player.lastName })
        .from(playerCategory)
        .innerJoin(
          player,
          and(eq(player.clubId, playerCategory.clubId), eq(player.id, playerCategory.playerId)),
        )
        .where(
          and(
            eq(playerCategory.clubId, clubId),
            eq(playerCategory.categoryId, session.categoryId),
            categoryCurrentOn(session.localDate),
          ),
        )
        .orderBy(asc(player.lastName), asc(player.firstName), asc(player.id));
      const ids = [...new Set(players.map((p) => p.id))];
      const assignments =
        ids.length === 0
          ? []
          : await db
              .select(podAssignmentColumns)
              .from(podAssignment)
              .where(
                and(
                  eq(podAssignment.clubId, clubId),
                  eq(podAssignment.trainingSessionId, session.id),
                  isNull(podAssignment.archivedAt),
                  inArray(podAssignment.playerId, ids),
                ),
              )
              .orderBy(asc(podAssignment.startsAt));
      const seen = new Set<string>();
      const entries: SessionPodPlayer[] = [];
      for (const p of players) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const facts = {
          id: p.id,
          sport: session.sport,
          categoryIds: [session.categoryId],
          consents: await currentConsentTypesOf(db, p.id),
        };
        const resource = { kind: 'pod_assignment' as const, clubId, player: facts };
        if (!can(subject, 'read', resource)) continue;
        const missing = POD_ASSIGNMENT_CONSENTS.filter((t) => !facts.consents.includes(t));
        const own = assignments.filter((a) => a.playerId === p.id);
        const live = own.find((a) => a.endsAt === null) ?? own.at(-1) ?? null;
        entries.push({
          playerId: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          missingConsents: missing,
          canAssign: podsEnabled && missing.length === 0 && can(subject, 'assign', resource),
          assignment: live === null ? null : podAssignmentDto(live),
        });
      }
      return { podsEnabled, players: entries };
    },
  });
}

/** Players whose current category is in the assignments (as `app.visible_player_ids`). */
function assignedPlayers(
  today: string,
  categoryIds: readonly CategoryId[],
  sports: readonly Sport[],
): SQL {
  const target = or(
    categoryIds.length > 0 ? inArray(category.id, [...categoryIds]) : undefined,
    sports.length > 0 ? inArray(category.sport, [...sports]) : undefined,
  );
  return sql`exists (
    select 1 from ${playerCategory}
      join ${category} on ${category.clubId} = ${playerCategory.clubId}
                      and ${category.id} = ${playerCategory.categoryId}
     where ${playerCategory.clubId} = ${podAssignment.clubId}
       and ${playerCategory.playerId} = ${podAssignment.playerId}
       and (${playerCategory.validFrom} <= ${today}::date
            and (${playerCategory.validTo} is null or ${playerCategory.validTo} > ${today}::date))
       and ${target})`;
}
