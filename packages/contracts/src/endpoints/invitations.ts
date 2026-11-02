import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { clubSummarySchema, emailSchema, membershipRoleSchema, membershipSchema } from './auth.js';

/** Roles whose invitation may carry a category scope (they become staff assignments). */
export const STAFF_ROLES = ['coach', 'sc', 'medical'] as const;

export const INVITATION_EXPIRES_IN_DAYS_DEFAULT = 7;
export const INVITATION_EXPIRES_IN_DAYS_MAX = 30;

/** Token of an invitation link: 256 random bits, base64url without padding. */
export const invitationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .meta({
    description:
      'Token del link de invitación (el último segmento de `sportperformance://invite/<token>` o `https://…/invite/<token>`). Viaja en el body, nunca en la URL de la API.',
  });

export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const invitationStatusSchema = z.enum(INVITATION_STATUSES).meta({
  id: 'InvitationStatus',
  description:
    '`pending` se puede aceptar; `accepted` ya se usó; `revoked` la anuló un administrador; `expired` venció sin usarse.',
});

export const invitationIdSchema = idOf('invitación');

export const invitationSchema = z
  .object({
    id: invitationIdSchema,
    email: emailSchema,
    role: membershipRoleSchema,
    categoryIds: z.array(categoryIdSchema),
    status: invitationStatusSchema,
    expiresAt: dateTimeSchema,
    createdAt: dateTimeSchema,
    acceptedAt: dateTimeSchema.nullable(),
    revokedAt: dateTimeSchema.nullable(),
  })
  .meta({ id: 'Invitation' });

export const invitationLinksSchema = z
  .object({
    app: z
      .string()
      .min(1)
      .meta({
        description: 'Deep link de la app (Expo).',
        examples: ['sportperformance://invite/kB0x…'],
      }),
    web: z.url({ protocol: /^https?$/ }).meta({
      description:
        'Universal link (iOS) / App Link (Android): abre la app si está instalada y si no la web. Es el link del email.',
      examples: ['https://app.example.com/invite/kB0x…'],
    }),
  })
  .meta({ id: 'InvitationLinks' });

export const createdInvitationSchema = z
  .object({ invitation: invitationSchema, links: invitationLinksSchema })
  .meta({
    id: 'CreatedInvitation',
    description: 'Los links solo se devuelven al crearla: el servidor guarda el hash del token.',
  });

export const invitationPreviewSchema = z
  .object({
    club: clubSummarySchema,
    role: membershipRoleSchema,
    status: invitationStatusSchema,
    expiresAt: dateTimeSchema,
    emailHint: z
      .string()
      .min(1)
      .meta({
        description: 'Email invitado, enmascarado.',
        examples: ['a***@example.com'],
      }),
  })
  .meta({ id: 'InvitationPreview' });

export type Invitation = z.output<typeof invitationSchema>;
export type InvitationLinks = z.output<typeof invitationLinksSchema>;
export type CreatedInvitation = z.output<typeof createdInvitationSchema>;
export type InvitationPreview = z.output<typeof invitationPreviewSchema>;

export const createInvitation = defineEndpoint({
  method: 'POST',
  path: '/v1/invitations',
  summary: 'Invitar a alguien al club',
  description:
    'Solo `admin` del club activo. Manda el email con el link y devuelve los links. `categoryIds` (solo para `coach`, `sc` y `medical`) se convierten en asignaciones de staff al aceptar. Invitar de nuevo al mismo email con el mismo rol anula el link anterior.',
  tags: ['invitations'],
  auth: 'club',
  body: z.object({
    email: emailSchema,
    role: membershipRoleSchema,
    categoryIds: z.array(categoryIdSchema).max(50).default([]),
    expiresInDays: z
      .int()
      .min(1)
      .max(INVITATION_EXPIRES_IN_DAYS_MAX)
      .default(INVITATION_EXPIRES_IN_DAYS_DEFAULT),
  }),
  response: { status: 201, description: 'Invitación creada.', schema: createdInvitationSchema },
  errors: ['service_unavailable'],
});

export const listInvitations = defineEndpoint({
  method: 'GET',
  path: '/v1/invitations',
  summary: 'Invitaciones del club',
  description: 'Solo `admin` del club activo. Las más nuevas primero.',
  tags: ['invitations'],
  auth: 'club',
  query: pageQuerySchema.extend({ status: invitationStatusSchema.optional() }),
  response: {
    status: 200,
    description: 'Página de invitaciones.',
    schema: pageOf(invitationSchema).meta({ id: 'InvitationPage' }),
  },
  errors: ['bad_request'],
});

export const revokeInvitation = defineEndpoint({
  method: 'DELETE',
  path: '/v1/invitations/{invitationId}',
  summary: 'Anular una invitación',
  description:
    'Solo `admin` del club activo. El link deja de servir. Una invitación ya aceptada no se anula: `conflict` (para sacar a alguien se cierra su membresía).',
  tags: ['invitations'],
  auth: 'club',
  params: z.object({ invitationId: invitationIdSchema }),
  response: { status: 204, description: 'Invitación anulada.', schema: undefined },
  errors: ['not_found', 'conflict'],
});

export const previewInvitation = defineEndpoint({
  method: 'POST',
  path: '/v1/invitations/preview',
  summary: 'Ver una invitación por su link',
  description:
    'Público: la app lo pide al abrir el link, antes del login, para mostrar el club, el rol y si se puede aceptar. Limitado por IP.',
  tags: ['invitations'],
  auth: 'public',
  body: z.object({ token: invitationTokenSchema }),
  response: { status: 200, description: 'Invitación.', schema: invitationPreviewSchema },
  errors: ['not_found', 'rate_limited'],
});

export const acceptInvitation = defineEndpoint({
  method: 'POST',
  path: '/v1/invitations/accept',
  summary: 'Aceptar una invitación',
  description:
    'Con sesión del mismo email invitado (si no, `forbidden`). Crea la membresía y las asignaciones de staff. Vencida, anulada o ya usada: `conflict`. Si la membresía ya existía, la devuelve sin duplicarla.',
  tags: ['invitations'],
  auth: 'session',
  body: z.object({ token: invitationTokenSchema }),
  response: {
    status: 200,
    description: 'Membresía creada.',
    schema: z.object({ membership: membershipSchema }).meta({ id: 'AcceptedInvitation' }),
  },
  errors: ['not_found', 'conflict', 'forbidden', 'rate_limited'],
});
