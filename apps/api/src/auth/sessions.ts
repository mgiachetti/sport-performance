import type {
  DeviceBrowser,
  DeviceOperatingSystem,
  SessionClientType,
  UserId,
} from '@sport-performance/domain';
import type { Database, TransactionClient } from '../db/database.js';
import { ANONYMOUS_CONTEXT } from '../db/tenant-context.js';
import { hashDeviceId, KNOWN_DEVICE_TTL_DAYS } from './device.js';

/** `last_seen_at` is refreshed at most this often per session (one write, not one per request). */
export const SESSION_TOUCH_INTERVAL_S = 5 * 60;

/** A live session of a user, as "Sesiones activas" lists it (ADR 0033). */
export interface SessionRow {
  readonly id: string;
  readonly clientType: SessionClientType;
  readonly deviceOs: DeviceOperatingSystem | null;
  readonly deviceBrowser: DeviceBrowser | null;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
}

/** Sort key of the list (newest first): the cursor carries the last row's. */
export interface SessionCursor {
  readonly createdAt: Date;
  readonly id: string;
}

/**
 * Sessions and known devices of users (B-333, ADR 0033), on Better Auth's
 * connection (`sport_performance_auth`): the only role that reaches
 * `session` and `known_device` (ADR 0026). The API's own role never sees
 * them. Revoking deletes the row: Better Auth reads the session from the
 * database on every request (no cookie cache), so it ends immediately.
 *
 * Every query is scoped by the user id the caller passes; the handlers pass
 * the id of the authenticated session, never one taken from the request.
 */
export interface SessionStore {
  /** Live sessions of `userId`, newest first, after `cursor`. */
  list(
    userId: UserId,
    page: { readonly limit: number; readonly after?: SessionCursor | undefined },
  ): Promise<SessionRow[]>;
  /** Deletes one live session of `userId`; `false` if there is none with that id. */
  revoke(userId: UserId, sessionId: string): Promise<boolean>;
  /** Deletes every session of `userId` but `keepSessionId`; returns how many. */
  revokeOthers(userId: UserId, keepSessionId: string): Promise<number>;
  /**
   * Deletes every session of `userId`, unless the user is a superadmin (whose
   * access does not come from a membership, ADR 0007); returns how many.
   */
  revokeAllOfMember(userId: UserId): Promise<{ revoked: number; superadmin: boolean }>;
  /** Refreshes `last_seen_at` if it is older than {@link SESSION_TOUCH_INTERVAL_S}. */
  touch(sessionId: string): Promise<void>;
  /**
   * Records that `userId` signed in from the device `deviceId` and tells
   * whether it was already known (used within {@link KNOWN_DEVICE_TTL_DAYS}).
   */
  rememberDevice(userId: UserId, deviceId: string): Promise<{ known: boolean }>;
  /** Deletes expired sessions and devices unused for {@link KNOWN_DEVICE_TTL_DAYS}. */
  prune(): Promise<{ sessions: number; devices: number }>;
}

interface SessionDbRow {
  id: string;
  client_type: SessionClientType;
  device_os: DeviceOperatingSystem | null;
  device_browser: DeviceBrowser | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}

const LIVE = 'expires_at > now()';

export function createSessionStore(authDb: Database): SessionStore {
  const run = <T>(work: (client: TransactionClient) => Promise<T>): Promise<T> =>
    authDb.transaction(ANONYMOUS_CONTEXT, work);

  return {
    list: (userId, { limit, after }) =>
      run<SessionRow[]>(async (client) => {
        const params: unknown[] = [userId, limit];
        let keyset = '';
        if (after !== undefined) {
          params.push(after.createdAt, after.id);
          // `created_at` keeps microseconds; the cursor carries milliseconds.
          keyset = `and (date_trunc('milliseconds', created_at), id) < ($3, $4)`;
        }
        const { rows } = await client.query<SessionDbRow>(
          `select id, client_type, device_os, device_browser, created_at, last_seen_at, expires_at
             from session
            where user_id = $1 and ${LIVE} ${keyset}
            order by date_trunc('milliseconds', created_at) desc, id desc
            limit $2`,
          params,
        );
        return rows.map((row) => ({
          id: row.id,
          clientType: row.client_type,
          deviceOs: row.device_os,
          deviceBrowser: row.device_browser,
          createdAt: row.created_at,
          lastSeenAt: row.last_seen_at,
          expiresAt: row.expires_at,
        }));
      }),

    revoke: (userId, sessionId) =>
      run<boolean>(async (client) => {
        const result = await client.query(
          `delete from session where id = $1 and user_id = $2 and ${LIVE}`,
          [sessionId, userId],
        );
        return (result.rowCount ?? 0) > 0;
      }),

    revokeOthers: (userId, keepSessionId) =>
      run<number>(async (client) => {
        // Expired ones are left to the prune: the count is of sessions that were usable.
        const result = await client.query(
          `delete from session where user_id = $1 and id <> $2 and ${LIVE}`,
          [userId, keepSessionId],
        );
        return result.rowCount ?? 0;
      }),

    revokeAllOfMember: (userId) =>
      run(async (client) => {
        const { rows } = await client.query<{ revoked: number; superadmin: boolean | null }>(
          `with target as (select id, is_superadmin from "user" where id = $1),
           deleted as (
             delete from session s using target t
              where s.user_id = t.id and not t.is_superadmin
             returning 1
           )
           select (select count(*) from deleted)::int as revoked,
                  (select is_superadmin from target) as superadmin`,
          [userId],
        );
        return { revoked: rows[0]?.revoked ?? 0, superadmin: rows[0]?.superadmin === true };
      }),

    touch: async (sessionId) => {
      await run(async (client) => {
        await client.query(
          `update session set last_seen_at = now()
            where id = $1 and last_seen_at < now() - make_interval(secs => $2)`,
          [sessionId, SESSION_TOUCH_INTERVAL_S],
        );
      });
    },

    rememberDevice: (userId, deviceId) =>
      run<{ known: boolean }>(async (client) => {
        // A device unused for longer than the TTL counts as new even before the prune runs.
        const { rows } = await client.query<{ known: boolean }>(
          `with previous as (
             select last_seen_at > now() - make_interval(days => $3) as fresh
               from known_device where user_id = $1 and device_hash = $2
           ), upsert as (
             insert into known_device (user_id, device_hash) values ($1, $2)
             on conflict (user_id, device_hash) do update set last_seen_at = now()
           )
           select coalesce((select fresh from previous), false) as known`,
          [userId, hashDeviceId(deviceId), KNOWN_DEVICE_TTL_DAYS],
        );
        return { known: rows[0]?.known === true };
      }),

    prune: () =>
      run<{ sessions: number; devices: number }>(async (client) => {
        const sessions = await client.query('delete from session where expires_at <= now()');
        const devices = await client.query(
          'delete from known_device where last_seen_at <= now() - make_interval(days => $1)',
          [KNOWN_DEVICE_TTL_DAYS],
        );
        return { sessions: sessions.rowCount ?? 0, devices: devices.rowCount ?? 0 };
      }),
  };
}
