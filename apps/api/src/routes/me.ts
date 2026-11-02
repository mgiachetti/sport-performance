import { getMe, listMyMemberships } from '@sport-performance/contracts';
import type { FastifyInstance } from 'fastify';
import { membershipSummary } from '../auth/identity.js';
import type { AuthModule } from '../auth/module.js';
import { registerEndpoint } from '../http/endpoint.js';

/** `/v1/me`: the signed-in user and the club selector (ADR 0007). */
export function registerMeRoutes(app: FastifyInstance, auth: AuthModule): void {
  registerEndpoint(app, getMe, {
    transaction: false,
    handler: async (_input, { auth: caller }) => {
      const selected = caller.membership;
      const active =
        selected === null
          ? undefined
          : (await auth.identity.activeMemberships(caller.userId)).find(
              (m) => m.id === selected.membershipId,
            );
      return {
        user: {
          id: caller.userId,
          email: caller.email,
          name: caller.name,
          isSuperadmin: caller.isSuperadmin,
        },
        session: { expiresAt: caller.session.expiresAt.toISOString() },
        activeMembership: active === undefined ? null : membershipSummary(active),
      };
    },
  });

  registerEndpoint(app, listMyMemberships, {
    transaction: false,
    handler: async (_input, { auth: caller }) => ({
      items: (await auth.identity.activeMemberships(caller.userId)).map(membershipSummary),
    }),
  });
}
