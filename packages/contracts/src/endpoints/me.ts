import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { membershipSchema, sessionUserSchema } from './auth.js';

export const meSchema = z
  .object({
    user: sessionUserSchema,
    session: z.object({ expiresAt: dateTimeSchema }),
    activeMembership: membershipSchema.nullable().meta({
      description:
        'Membresía con la que actúa este request (`X-Membership-Id`, o la única que tiene). `null` si no eligió club o no tiene ninguno.',
    }),
  })
  .meta({ id: 'Me' });

export const membershipListSchema = z
  .object({ items: z.array(membershipSchema) })
  .meta({ id: 'MembershipList' });

export type Me = z.output<typeof meSchema>;
export type MembershipList = z.output<typeof membershipListSchema>;

export const getMe = defineEndpoint({
  method: 'GET',
  path: '/v1/me',
  summary: 'Usuario de la sesión',
  description:
    'Perfil, si es superadmin y la membresía activa. Con un `X-Membership-Id` que no es una membresía activa del usuario, `activeMembership` es `null` (los endpoints de club responden `forbidden`).',
  tags: ['me'],
  auth: 'session',
  response: { status: 200, description: 'Usuario de la sesión.', schema: meSchema },
  errors: [],
});

export const listMyMemberships = defineEndpoint({
  method: 'GET',
  path: '/v1/me/memberships',
  summary: 'Mis membresías (selector de club)',
  description:
    'Membresías activas del usuario en todos sus clubes, ordenadas por club y rol. Si hay más de una, la app muestra el selector y manda la elegida en `X-Membership-Id`.',
  tags: ['me'],
  auth: 'session',
  response: { status: 200, description: 'Membresías activas.', schema: membershipListSchema },
  errors: [],
});
