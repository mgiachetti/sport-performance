import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
} from '../primitives/conventions.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { emailSchema, membershipIdSchema, membershipRoleSchema } from './auth.js';

/**
 * Members of the club as its administration manages them (B-314): who
 * belongs with which role, since when and until when (ADR 0007). A
 * membership is never deleted: it ends (`endedAt`), and changing someone's
 * role ends it and opens another with the new role, so the period of each
 * role stays on record (ADR 0034).
 */

export const MEMBER_STATUSES = ['active', 'ended'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const memberStatusSchema = z.enum(MEMBER_STATUSES).meta({
  id: 'MemberStatus',
  description: '`active`: la membresía está vigente; `ended`: terminó (`endedAt`).',
});

export const memberSchema = z
  .object({
    id: membershipIdSchema,
    user: z.object({
      id: userIdSchema,
      name: z.string().meta({ description: 'Nombre del usuario (puede estar vacío).' }),
      email: emailSchema,
    }),
    role: membershipRoleSchema,
    status: memberStatusSchema,
    startedAt: dateTimeSchema,
    endedAt: dateTimeSchema.nullable(),
    invitedBy: userIdSchema.nullable().meta({
      description: 'Quién lo invitó; `null` si no entró por invitación o esa cuenta ya no existe.',
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({
    id: 'Member',
    description: 'Membresía de una persona en el club, con su rol y su período.',
  });

export type Member = z.output<typeof memberSchema>;

const memberParams = z.strictObject({ membershipId: membershipIdSchema });

export const listMembers = defineEndpoint({
  method: 'GET',
  path: '/v1/club/members',
  summary: 'Miembros del club',
  description:
    'Solo la administración. Filtra por rol, estado (`active` por defecto) y texto en el nombre o el email (`q`).',
  tags: ['members'],
  auth: 'club',
  query: pageQuerySchema.extend({
    role: membershipRoleSchema.optional(),
    status: z
      .enum([...MEMBER_STATUSES, 'all'])
      .default('active')
      .meta({
        description: '`active` (por defecto), `ended` o `all`.',
      }),
    q: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .meta({ description: 'Texto a buscar en el nombre o el email (sin distinguir mayúsculas).' }),
    sort: sortQuerySchema(['name', 'email', 'startedAt'], 'name'),
  }),
  response: {
    status: 200,
    description: 'Página de miembros.',
    schema: pageOf(memberSchema).meta({ id: 'MemberPage' }),
  },
  errors: ['bad_request'],
});

export const getMember = defineEndpoint({
  method: 'GET',
  path: '/v1/club/members/{membershipId}',
  summary: 'Un miembro del club',
  description: 'Solo la administración. Una membresía de otro club: `not_found`.',
  tags: ['members'],
  auth: 'club',
  params: memberParams,
  response: { status: 200, description: 'El miembro.', schema: memberSchema },
  errors: ['not_found'],
});

export const changeMemberRole = defineEndpoint({
  method: 'POST',
  path: '/v1/club/members/{membershipId}/role',
  summary: 'Cambiar el rol de un miembro',
  description:
    'Solo la administración. Termina la membresía (y sus asignaciones del staff) y abre otra con el rol nuevo: devuelve la nueva, con otro `id` (la persona vuelve a elegir club con `X-Membership-Id`). `version` desactualizada, membresía terminada, ya tiene ese rol activo, la propia membresía o el último admin del club: `conflict`.',
  tags: ['members'],
  auth: 'club',
  params: memberParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    role: membershipRoleSchema,
  }),
  response: {
    status: 200,
    description: 'La membresía nueva, con el rol nuevo.',
    schema: memberSchema,
  },
  errors: ['not_found', 'conflict'],
});

export const endMember = defineEndpoint({
  method: 'POST',
  path: '/v1/club/members/{membershipId}/end',
  summary: 'Terminar una membresía',
  description:
    'Solo la administración. Fija `endedAt` ahora y termina sus asignaciones del staff en la misma transacción; desde el request siguiente la persona ya no actúa con ella, y si no le queda ninguna membresía activa se cierran todas sus sesiones (B-333). Idempotente. La propia membresía o el último admin del club: `conflict`.',
  tags: ['members'],
  auth: 'club',
  params: memberParams,
  response: { status: 200, description: 'La membresía terminada.', schema: memberSchema },
  errors: ['not_found', 'conflict'],
});
