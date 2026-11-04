import {
  getDevice,
  listDevices,
  registerDevice,
  restoreDevice,
  retireDevice,
  updateDevice,
  type Device,
} from '@sport-performance/contracts';
import { device } from '@sport-performance/db/schema';
import type { ClubId } from '@sport-performance/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';
import { keysetPage, type KeysetSpec } from '../http/pagination.js';
import {
  archiveStatusFilter,
  insertIdempotent,
  markReplay,
  rowVersion,
  updateAtVersion,
  versionMatches,
} from '../http/writes.js';

/**
 * Measuring devices of the club (B-606, ADR 0076): the phones and tablets a
 * test is timed on and the shared hardware of Phase 2. Results name them
 * (`test_result.device_id`); the reaction test is compared only on the same
 * one. Retired, never deleted. The RLS of `device` (migration 0004) already
 * lets the staff read and `sc` and the administration write.
 */

const deviceColumns = {
  id: device.id,
  kind: device.kind,
  label: device.label,
  model: device.model,
  serialNumber: device.serialNumber,
  firmwareVersion: device.firmwareVersion,
  retiredAt: device.retiredAt,
  createdAt: device.createdAt,
  updatedAt: device.updatedAt,
  version: rowVersion(device.updatedAt),
};

interface DeviceRow {
  id: string;
  kind: Device['kind'];
  label: string;
  model: string | null;
  serialNumber: string | null;
  firmwareVersion: string | null;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: string;
}

function deviceDto(row: DeviceRow): Device {
  return {
    id: row.id as Device['id'],
    kind: row.kind,
    label: row.label,
    model: row.model,
    serialNumber: row.serialNumber,
    firmwareVersion: row.firmwareVersion,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

const DEVICE_KEYS: KeysetSpec<DeviceRow, 'label' | 'createdAt'> = {
  fields: {
    label: { column: device.label, type: 'text', value: (row) => row.label },
    createdAt: { column: device.createdAt, type: 'timestamp', value: (row) => row.createdAt },
  },
  id: { column: device.id, value: (row) => row.id },
};

async function readDevice(
  db: TenantDatabase,
  clubId: ClubId,
  deviceId: string,
): Promise<DeviceRow> {
  const [row] = await db
    .select(deviceColumns)
    .from(device)
    .where(and(eq(device.clubId, clubId), eq(device.id, deviceId)));
  if (row === undefined) throw new HttpError('not_found', 'Device not found');
  return row;
}

function serialTaken(): HttpError {
  return new HttpError('conflict', 'A device of this kind already has this serial number', {
    details: [
      {
        path: ['body', 'serialNumber'],
        code: 'custom',
        message: 'Already registered: find it with GET /v1/devices?serialNumber=…&status=all',
      },
    ],
  });
}

/** `23505` on the serial number's unique index: a concurrent registration of the same device. */
function isSerialViolation(error: unknown): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause ?? error;
  const pg = cause as { code?: unknown; constraint?: unknown } | null;
  return pg?.code === '23505' && pg.constraint === 'device_serial_number_key';
}

export function registerDeviceRoutes(app: FastifyInstance): void {
  registerEndpoint(app, listDevices, {
    transaction: true,
    handler: async ({ query }, { db, permissions, auth: caller }) => {
      await permissions.authorize('device', 'read');
      const plan = keysetPage(DEVICE_KEYS, query, {
        kind: query.kind,
        serialNumber: query.serialNumber,
        status: query.status,
      });
      const rows = await db
        .select(deviceColumns)
        .from(device)
        .where(
          and(
            eq(device.clubId, caller.membership.clubId),
            query.kind === undefined ? undefined : eq(device.kind, query.kind),
            query.serialNumber === undefined
              ? undefined
              : eq(device.serialNumber, query.serialNumber),
            archiveStatusFilter(device.retiredAt, query.status),
            plan.where,
          ),
        )
        .orderBy(...plan.orderBy)
        .limit(plan.limit);
      return plan.page(rows, deviceDto);
    },
  });

  registerEndpoint(app, getDevice, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('device', 'read');
      return deviceDto(await readDevice(db, caller.membership.clubId, params.deviceId));
    },
  });

  registerEndpoint(app, registerDevice, {
    transaction: true,
    handler: async ({ body }, { db, permissions, auth: caller, reply }) => {
      await permissions.authorize('device', 'manage');
      const { clubId } = caller.membership;
      const findByClientUuid = async (clientUuid: string) =>
        (
          await db
            .select(deviceColumns)
            .from(device)
            .where(and(eq(device.clubId, clubId), eq(device.clientUuid, clientUuid)))
        )[0];
      // A retry of the same registration answers the row it made, before the serial check.
      if (body.clientUuid !== undefined) {
        const replay = await findByClientUuid(body.clientUuid);
        if (replay !== undefined) {
          markReplay(reply);
          return deviceDto(replay);
        }
      }
      if (body.serialNumber !== undefined) {
        const [taken] = await db
          .select({ id: device.id })
          .from(device)
          .where(
            and(
              eq(device.clubId, clubId),
              eq(device.kind, body.kind),
              eq(device.serialNumber, body.serialNumber),
            ),
          );
        if (taken !== undefined) throw serialTaken();
      }
      try {
        const { row } = await insertIdempotent({
          clientUuid: body.clientUuid,
          reply,
          insert: async () =>
            (
              await db
                .insert(device)
                .values({
                  clubId,
                  ...(body.clientUuid !== undefined && { clientUuid: body.clientUuid }),
                  kind: body.kind,
                  label: body.label,
                  model: body.model ?? null,
                  serialNumber: body.serialNumber ?? null,
                  firmwareVersion: body.firmwareVersion ?? null,
                  createdBy: caller.userId,
                  updatedBy: caller.userId,
                })
                .onConflictDoNothing({ target: [device.clubId, device.clientUuid] })
                .returning(deviceColumns)
            )[0],
          findByClientUuid,
        });
        return deviceDto(row);
      } catch (error) {
        if (isSerialViolation(error)) throw serialTaken();
        throw error;
      }
    },
  });

  registerEndpoint(app, updateDevice, {
    transaction: true,
    handler: async ({ params, body }, { db, permissions, auth: caller }) => {
      await permissions.authorize('device', 'manage');
      const { clubId } = caller.membership;
      const current = await readDevice(db, clubId, params.deviceId);
      if (current.retiredAt !== null) {
        throw new HttpError('conflict', 'The device is retired: restore it first');
      }
      const where = and(eq(device.clubId, clubId), eq(device.id, params.deviceId));
      const row = await updateAtVersion({
        resource: 'Device',
        update: async () =>
          (
            await db
              .update(device)
              .set({
                ...(body.label !== undefined && { label: body.label }),
                ...(body.model !== undefined && { model: body.model }),
                ...(body.firmwareVersion !== undefined && {
                  firmwareVersion: body.firmwareVersion,
                }),
                updatedBy: caller.userId,
              })
              .where(
                and(
                  where,
                  sql`${device.retiredAt} is null`,
                  versionMatches(device.updatedAt, body.version),
                ),
              )
              .returning(deviceColumns)
          )[0],
        exists: async () =>
          (await db.select({ id: device.id }).from(device).where(where)).length > 0,
      });
      return deviceDto(row);
    },
  });

  registerEndpoint(app, retireDevice, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('device', 'manage');
      const { clubId } = caller.membership;
      const row = await readDevice(db, clubId, params.deviceId);
      if (row.retiredAt !== null) return deviceDto(row);
      await db
        .update(device)
        .set({ retiredAt: sql`now()`, updatedBy: caller.userId })
        .where(and(eq(device.clubId, clubId), eq(device.id, params.deviceId)));
      return deviceDto(await readDevice(db, clubId, params.deviceId));
    },
  });

  registerEndpoint(app, restoreDevice, {
    transaction: true,
    handler: async ({ params }, { db, permissions, auth: caller }) => {
      await permissions.authorize('device', 'manage');
      const { clubId } = caller.membership;
      const row = await readDevice(db, clubId, params.deviceId);
      if (row.retiredAt === null) return deviceDto(row);
      await db
        .update(device)
        .set({ retiredAt: null, updatedBy: caller.userId })
        .where(and(eq(device.clubId, clubId), eq(device.id, params.deviceId)));
      return deviceDto(await readDevice(db, clubId, params.deviceId));
    },
  });
}
