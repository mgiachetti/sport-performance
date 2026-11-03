import {
  getMyNotificationPreferences,
  registerMyPushToken,
  unregisterMyPushToken,
  updateMyNotificationPreferences,
} from '@sport-performance/contracts';
import { notificationPreference } from '@sport-performance/db/schema';
import {
  NOTIFICATION_CHANNELS,
  notificationKindsForRole,
  resolveNotificationPreferences,
  storedChannelValue,
  type ClubId,
  type Role,
  type StoredNotificationPreference,
  type UserId,
} from '@sport-performance/domain';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDatabase } from '../db/database.js';
import { registerEndpoint } from '../http/endpoint.js';
import { HttpError } from '../http/errors.js';

/**
 * Notifications (B-328, ADR 0054): the push token of the device, bound to
 * the sign-in session of the request, and the caller's own preferences in
 * the club of the membership. The worker plans and sends; nothing here
 * sends anything.
 */

async function storedPreferences(
  db: TenantDatabase,
  clubId: ClubId,
  userId: UserId,
): Promise<StoredNotificationPreference[]> {
  // RLS also limits the rows to the caller's own (ADR 0026).
  return db
    .select({
      kind: notificationPreference.kind,
      push: notificationPreference.push,
      email: notificationPreference.email,
    })
    .from(notificationPreference)
    .where(
      and(eq(notificationPreference.clubId, clubId), eq(notificationPreference.userId, userId)),
    );
}

async function preferencesOf(db: TenantDatabase, clubId: ClubId, userId: UserId, role: Role) {
  return {
    items: resolveNotificationPreferences(role, await storedPreferences(db, clubId, userId)),
  };
}

export function registerNotificationRoutes(app: FastifyInstance): void {
  registerEndpoint(app, registerMyPushToken, {
    transaction: true,
    handler: async ({ body }, { tx, auth: caller, log }) => {
      await tx.query('select app.register_push_token($1, $2, $3)', [
        caller.session.id,
        body.token,
        body.platform,
      ]);
      // Ids only: the token is a credential to reach the device (ADR 0016).
      log.info({ userId: caller.userId, platform: body.platform }, 'push token registered');
      return undefined;
    },
  });

  registerEndpoint(app, unregisterMyPushToken, {
    transaction: true,
    handler: async (_input, { tx, auth: caller, log }) => {
      const { rows } = await tx.query<{ removed: boolean }>(
        'select app.unregister_push_token($1) as removed',
        [caller.session.id],
      );
      if (rows[0]?.removed === true) log.info({ userId: caller.userId }, 'push token removed');
      return undefined;
    },
  });

  registerEndpoint(app, getMyNotificationPreferences, {
    transaction: true,
    handler: async (_input, { db, auth: caller }) => {
      const { clubId, role } = caller.membership;
      return preferencesOf(db, clubId, caller.userId, role);
    },
  });

  registerEndpoint(app, updateMyNotificationPreferences, {
    transaction: true,
    handler: async ({ body }, { db, auth: caller }) => {
      const { clubId, role, membershipId } = caller.membership;
      // A superadmin supporting the club is not a member: they have no preferences here (and
      // RLS would refuse the write), so it is a clean 403 rather than a failed insert.
      if (membershipId === null) {
        throw new HttpError('forbidden', 'Preferences belong to a membership of the club');
      }
      const allowed = notificationKindsForRole(role);
      body.preferences.forEach((change, index) => {
        if (!allowed.includes(change.kind)) {
          throw new HttpError(
            'validation_failed',
            `The role ${role} does not receive ${change.kind} notifications`,
            {
              details: [
                {
                  path: ['body', 'preferences', index, 'kind'],
                  code: 'kind_not_for_role',
                  message: 'This role does not receive this kind',
                },
              ],
            },
          );
        }
      });
      const current = await storedPreferences(db, clubId, caller.userId);
      for (const change of body.preferences) {
        const previous = current.find((row) => row.kind === change.kind);
        const values = Object.fromEntries(
          NOTIFICATION_CHANNELS.map((channel) => {
            const value = change[channel];
            return [
              channel,
              value === undefined
                ? (previous?.[channel] ?? null)
                : storedChannelValue(change.kind, channel, value),
            ];
          }),
        ) as { push: boolean | null; email: boolean | null };
        await db
          .insert(notificationPreference)
          .values({
            clubId,
            userId: caller.userId,
            kind: change.kind,
            ...values,
            createdBy: caller.userId,
            updatedBy: caller.userId,
          })
          .onConflictDoUpdate({
            target: [
              notificationPreference.clubId,
              notificationPreference.userId,
              notificationPreference.kind,
            ],
            set: { ...values, updatedBy: caller.userId, updatedAt: sql`now()` },
          });
      }
      return preferencesOf(db, clubId, caller.userId, role);
    },
  });
}
