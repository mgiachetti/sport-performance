import { GUARDIAN_RELATIONSHIPS } from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { idOf, playerIdSchema, userIdSchema, uuidSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { emailSchema, membershipIdSchema, signedInSchema } from './auth.js';
import {
  createdInvitationSchema,
  INVITATION_EXPIRES_IN_DAYS_DEFAULT,
  INVITATION_EXPIRES_IN_DAYS_MAX,
} from './invitations.js';

/**
 * Guardians and accounts of minors (B-310, ADR 0042): the `guardian` link
 * between a parent of the club and a player, what a guardian sees of their
 * children, and how a guardian gives their child access: an invitation by
 * email, or (without email) a short code and a link to open on the child's
 * device, single use and short-lived.
 */

export const guardianRelationshipSchema = z.enum(GUARDIAN_RELATIONSHIPS).meta({
  id: 'GuardianRelationship',
  description: 'Relación del tutor con el jugador/a.',
});

export const guardianIdSchema = idOf('vínculo de tutor');

export const GUARDIAN_LINK_STATUSES = ['current', 'ended', 'all'] as const;
export type GuardianLinkStatus = (typeof GUARDIAN_LINK_STATUSES)[number];

export const guardianLinkSchema = z
  .object({
    id: guardianIdSchema,
    playerId: playerIdSchema,
    guardian: z.object({
      userId: userIdSchema,
      name: z.string().max(200).nullable().meta({
        description: 'Nombre del tutor; `null` si quien pregunta no puede ver su cuenta.',
      }),
      email: emailSchema.nullable().meta({
        description: 'Email del tutor: solo para la administración del club.',
      }),
    }),
    relationship: guardianRelationshipSchema,
    validFrom: localDateSchema.meta({ description: 'Día del club desde el que vale.' }),
    validTo: localDateSchema.nullable().meta({
      description: 'Día del club desde el que ya no vale (exclusivo); `null` mientras sigue.',
    }),
    current: z.boolean().meta({ description: 'Si vale hoy (día del club).' }),
    adultConfirmedAt: dateTimeSchema.nullable().meta({
      description:
        'Cuándo el jugador/a, ya mayor de edad, decidió mantener el acceso de este tutor (B-311); `null` si no lo confirmó. Sin confirmación, el vínculo deja de dar acceso al cumplir 18.',
    }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'GuardianLink' });

export const childSchema = z
  .object({
    playerId: playerIdSchema,
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    birthDate: localDateSchema,
    ofAge: z.boolean().meta({
      description:
        'Mayor de edad hoy (18). Con un hijo/a mayor el tutor ya no gestiona su acceso (B-311).',
    }),
    guardianId: guardianIdSchema,
    relationship: guardianRelationshipSchema,
    hasAccount: z.boolean().meta({ description: 'Si el jugador/a ya tiene su propia cuenta.' }),
    adultConfirmed: z.boolean().meta({
      description:
        'Si el hijo/a, ya mayor, decidió mantener el acceso de este tutor. Con `ofAge: true` y `false`, el tutor no ve sus datos: solo este vínculo.',
    }),
    canManageAccess: z.boolean().meta({
      description:
        'Si este tutor puede invitarlo/a o generarle un código de ingreso (`player_account.invite`).',
    }),
  })
  .meta({
    id: 'Child',
    description:
      'Un hijo/a con vínculo vigente con el tutor. De un hijo/a mayor que no mantuvo el acceso solo se muestran nombre y fecha de nacimiento.',
  });

/**
 * Characters of an access code: digits and uppercase letters without the ones
 * that read alike aloud or on a screen (`0`/`O`, `1`/`I`/`L`), since a child
 * types it: 31 symbols.
 */
const DIGITS_AND_LETTERS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const PLAYER_ACCESS_CODE_ALPHABET = DIGITS_AND_LETTERS.replace(/[01ILO]/g, '');
export const PLAYER_ACCESS_CODE_LENGTH = 8;
/** Lifetime of an access code and its link. */
export const PLAYER_ACCESS_CODE_EXPIRES_IN_S = 15 * 60;

/**
 * An access code as typed: 8 characters, case-insensitive, optionally split
 * in two by a hyphen or a space (`K7QM-2XPA`). The server normalizes it.
 */
export const playerAccessCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{4}[- ]?[A-Za-z0-9]{4}$/)
  .meta({
    description:
      'Código de ingreso que generó el tutor: 8 caracteres, sin distinguir mayúsculas, con o sin guion en el medio.',
    examples: ['K7QM-2XPA'],
  });

/** Token of an access link: 256 random bits, base64url without padding. */
export const playerAccessTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .meta({
    description:
      'Token del link de ingreso (último segmento de `sportperformance://player-access/<token>` o `https://…/player-access/<token>`). Viaja en el body, nunca en la URL de la API.',
  });

export const playerAccessCodeIdSchema = idOf('código de ingreso');

export const PLAYER_ACCESS_CODE_STATUSES = ['pending', 'used', 'revoked', 'expired'] as const;
export type PlayerAccessCodeStatus = (typeof PLAYER_ACCESS_CODE_STATUSES)[number];

export const playerAccessCodeSummarySchema = z
  .object({
    id: playerAccessCodeIdSchema,
    playerId: playerIdSchema,
    status: z.enum(PLAYER_ACCESS_CODE_STATUSES).meta({
      description:
        '`pending` se puede usar; `used` ya abrió una sesión; `revoked` se anuló (a mano o al generar otro); `expired` venció sin usarse.',
    }),
    issuedBy: z.object({
      userId: userIdSchema.nullable().meta({ description: '`null` si se borró esa cuenta.' }),
      name: z.string().max(200).nullable(),
    }),
    expiresAt: dateTimeSchema,
    createdAt: dateTimeSchema,
    usedAt: dateTimeSchema.nullable(),
    revokedAt: dateTimeSchema.nullable(),
  })
  .meta({ id: 'PlayerAccessCode' });

export const playerAccessLinksSchema = z
  .object({
    app: z
      .string()
      .min(1)
      .meta({
        description: 'Deep link de la app (Expo).',
        examples: ['sportperformance://player-access/kB0x…'],
      }),
    web: z.url({ protocol: /^https?$/ }).meta({
      description:
        'Universal link (iOS) / App Link (Android): abre la app si está instalada; si no, la web indica instalarla.',
      examples: ['https://app.example.com/player-access/kB0x…'],
    }),
  })
  .meta({ id: 'PlayerAccessLinks' });

export const issuedPlayerAccessCodeSchema = z
  .object({
    accessCode: playerAccessCodeSummarySchema,
    code: z
      .string()
      .regex(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/)
      .meta({
        description: 'Código para tipear en la app del jugador/a.',
        examples: ['K7QM-2XPA'],
      }),
    links: playerAccessLinksSchema,
  })
  .meta({
    id: 'IssuedPlayerAccessCode',
    description:
      'El código y los links se devuelven solo acá: el servidor guarda sus hashes. Se usan una sola vez y vencen a los 15 minutos.',
  });

export type GuardianLink = z.output<typeof guardianLinkSchema>;
export type Child = z.output<typeof childSchema>;
export type PlayerAccessCodeSummary = z.output<typeof playerAccessCodeSummarySchema>;
export type IssuedPlayerAccessCode = z.output<typeof issuedPlayerAccessCodeSchema>;

const playerParams = z.strictObject({ playerId: playerIdSchema });
const guardianParams = z.strictObject({ guardianId: guardianIdSchema });

export const listPlayerGuardians = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/guardians',
  summary: 'Tutores de un jugador/a',
  description:
    'La administración, el propio jugador/a y sus tutores. El email del tutor solo lo ve la administración. Un jugador/a de otro club o fuera del alcance: `not_found`.',
  tags: ['guardians'],
  auth: 'club',
  params: playerParams,
  query: pageQuerySchema.extend({
    status: z
      .enum(GUARDIAN_LINK_STATUSES)
      .default('current')
      .meta({ description: '`current` (por defecto: vigentes hoy), `ended` o `all`.' }),
    sort: sortQuerySchema(['validFrom', 'createdAt'], 'validFrom'),
  }),
  response: {
    status: 200,
    description: 'Página de vínculos.',
    schema: pageOf(guardianLinkSchema).meta({ id: 'GuardianLinkPage' }),
  },
  errors: ['bad_request', 'not_found'],
});

export const createPlayerGuardian = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/guardians',
  summary: 'Vincular un tutor',
  description:
    'Solo la administración. Vincula una membresía `parent` activa del club con el jugador/a. Idempotente por `clientUuid`; un vínculo abierto de la misma persona con el mismo jugador/a: `conflict`.',
  tags: ['guardians'],
  auth: 'club',
  params: playerParams,
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    membershipId: membershipIdSchema.meta({
      description: 'Membresía `parent` activa del club (la persona que es tutor).',
    }),
    relationship: guardianRelationshipSchema,
    validFrom: localDateSchema.optional().meta({ description: 'Por defecto, hoy (día del club).' }),
  }),
  response: { status: 201, description: 'Vínculo creado.', schema: guardianLinkSchema },
  errors: ['not_found', 'conflict'],
});

export const updateGuardian = defineEndpoint({
  method: 'PATCH',
  path: '/v1/guardians/{guardianId}',
  summary: 'Editar un vínculo de tutor',
  description:
    'Solo la administración. Se cambia la relación; la persona y el jugador/a no (se termina el vínculo y se crea otro). `version` desactualizada: `conflict`.',
  tags: ['guardians'],
  auth: 'club',
  params: guardianParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    relationship: guardianRelationshipSchema,
  }),
  response: { status: 200, description: 'El vínculo actualizado.', schema: guardianLinkSchema },
  errors: ['not_found', 'conflict'],
});

export const endGuardian = defineEndpoint({
  method: 'POST',
  path: '/v1/guardians/{guardianId}/end',
  summary: 'Terminar un vínculo de tutor',
  description:
    'La administración, o el propio jugador/a mayor de edad (`guardian_link.review`, B-311). Deja de valer desde hoy (día del club); si empezaba hoy o después, no llega a valer. Se anulan los códigos e invitaciones que ese tutor dejó abiertos. No se borra: queda en la historia. Idempotente.',
  tags: ['guardians'],
  auth: 'club',
  params: guardianParams,
  response: { status: 200, description: 'El vínculo terminado.', schema: guardianLinkSchema },
  errors: ['not_found'],
});

export const confirmGuardianAsAdult = defineEndpoint({
  method: 'POST',
  path: '/v1/guardians/{guardianId}/adult-confirmation',
  summary: 'Mantener el acceso de un tutor (jugador/a mayor)',
  description:
    'Solo el propio jugador/a, mayor de edad (`guardian_link.review`, B-311): decide que este tutor siga viendo sus datos. El tutor recupera solo la lectura (resumen, disponibilidad, consentimientos, vínculos); lo que la matriz reserva a menores (firmar, revocar, códigos de ingreso, alturas, datos médicos) sigue negado. Idempotente. Un menor, otro rol u otro jugador/a: `forbidden`; vínculo terminado: `conflict`.',
  tags: ['guardians'],
  auth: 'club',
  params: guardianParams,
  response: { status: 200, description: 'El vínculo confirmado.', schema: guardianLinkSchema },
  errors: ['not_found', 'conflict'],
});

export const withdrawGuardianAdultConfirmation = defineEndpoint({
  method: 'DELETE',
  path: '/v1/guardians/{guardianId}/adult-confirmation',
  summary: 'Retirar el acceso de un tutor (jugador/a mayor)',
  description:
    'Solo el propio jugador/a, mayor de edad (`guardian_link.review`, B-311): el tutor deja de ver sus datos; el vínculo sigue (lo ve el tutor, sin datos) y se puede volver a confirmar. Para terminarlo: `POST /v1/guardians/{guardianId}/end`. Idempotente. Vínculo terminado: `conflict`.',
  tags: ['guardians'],
  auth: 'club',
  params: guardianParams,
  response: { status: 200, description: 'El vínculo sin confirmar.', schema: guardianLinkSchema },
  errors: ['not_found', 'conflict'],
});

export const listMyChildren = defineEndpoint({
  method: 'GET',
  path: '/v1/me/children',
  summary: 'Mis hijos/as',
  description:
    'Solo con rol `parent`: los jugadores/as con los que el tutor tiene un vínculo vigente en el club activo, también un hijo/a mayor que no mantuvo su acceso (`ofAge: true`, `adultConfirmed: false`), para que el tutor entienda por qué ya no lo ve. Cualquier otro rol: `forbidden`.',
  tags: ['guardians', 'me'],
  auth: 'club',
  query: pageQuerySchema.extend({
    sort: sortQuerySchema(['name'], 'name'),
  }),
  response: {
    status: 200,
    description: 'Página de hijos/as.',
    schema: pageOf(childSchema).meta({ id: 'ChildPage' }),
  },
  errors: ['bad_request'],
});

export const invitePlayer = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/invitations',
  summary: 'Invitar al jugador/a por email',
  description:
    'El tutor de un menor, o la administración. Manda el link de invitación (rol `player`) al email del jugador/a; al aceptarla con ese email, la cuenta pasa a ser la del jugador/a. Invitar de nuevo anula el link anterior. Si el jugador/a ya tiene cuenta: `conflict`.',
  tags: ['guardians', 'invitations'],
  auth: 'club',
  params: playerParams,
  body: z.strictObject({
    email: emailSchema,
    expiresInDays: z
      .int()
      .min(1)
      .max(INVITATION_EXPIRES_IN_DAYS_MAX)
      .default(INVITATION_EXPIRES_IN_DAYS_DEFAULT),
  }),
  response: { status: 201, description: 'Invitación creada.', schema: createdInvitationSchema },
  errors: ['not_found', 'conflict', 'service_unavailable'],
});

export const issuePlayerAccessCode = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/access-codes',
  summary: 'Generar un código de ingreso para el jugador/a',
  description:
    'El tutor de un menor, o la administración. Para un jugador/a sin email: devuelve un código y un link que abren una sesión en su dispositivo, una sola vez, durante 15 minutos (si no tenía cuenta, se crea al usarlo). Si el jugador/a tiene una cuenta con email, ingresa con ese email: `conflict` (un código nunca abre una cuenta con email); también `conflict` si se dio de baja. Generar otro anula el anterior. No es idempotente a propósito: el código no se guarda, así que un reintento genera otro. Respuesta `no-store`.',
  tags: ['guardians'],
  auth: 'club',
  params: playerParams,
  response: {
    status: 201,
    description: 'Código generado.',
    schema: issuedPlayerAccessCodeSchema,
  },
  errors: ['not_found', 'conflict'],
});

export const listPlayerAccessCodes = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/access-codes',
  summary: 'Códigos de ingreso de un jugador/a',
  description:
    'El tutor o la administración: quién generó cada código, cuándo y si se usó. Los más nuevos primero.',
  tags: ['guardians'],
  auth: 'club',
  params: playerParams,
  query: pageQuerySchema.extend({ sort: sortQuerySchema(['createdAt'], '-createdAt') }),
  response: {
    status: 200,
    description: 'Página de códigos.',
    schema: pageOf(playerAccessCodeSummarySchema).meta({ id: 'PlayerAccessCodePage' }),
  },
  errors: ['bad_request', 'not_found'],
});

export const revokePlayerAccessCode = defineEndpoint({
  method: 'DELETE',
  path: '/v1/players/{playerId}/access-codes/{accessCodeId}',
  summary: 'Anular un código de ingreso',
  description:
    'El tutor o la administración. El código y su link dejan de servir. Uno ya usado no se anula: `conflict` (para cortar el acceso se cierra la sesión del jugador/a). Idempotente.',
  tags: ['guardians'],
  auth: 'club',
  params: z.strictObject({ playerId: playerIdSchema, accessCodeId: playerAccessCodeIdSchema }),
  response: { status: 204, description: 'Código anulado.', schema: undefined },
  errors: ['not_found', 'conflict'],
});

export const redeemPlayerAccess = defineEndpoint({
  method: 'POST',
  path: '/v1/auth/player-access',
  summary: 'Ingresar con el código o el link del tutor',
  description:
    'Público: la app del jugador/a manda el código que tipeó **o** el token del link. Abre una sesión mobile (`bearer`) de la cuenta del jugador/a, y la crea sin email si no la tenía. Un solo uso: código inexistente `not_found`; usado, anulado, vencido o que ya no se puede usar (el tutor dejó de serlo, el jugador/a es mayor, se dio de baja o ya tiene una cuenta con email) `conflict`. Limitado por IP y, para los códigos, también en total.',
  tags: ['auth', 'guardians'],
  auth: 'public',
  body: z.union([
    z.strictObject({
      code: playerAccessCodeSchema,
      deviceId: uuidSchema.optional().meta({
        description: 'UUID de la instalación de la app (el mismo que en el ingreso por email).',
      }),
    }),
    z.strictObject({
      token: playerAccessTokenSchema,
      deviceId: uuidSchema.optional().meta({
        description: 'UUID de la instalación de la app (el mismo que en el ingreso por email).',
      }),
    }),
  ]),
  response: { status: 200, description: 'Sesión abierta.', schema: signedInSchema },
  errors: ['not_found', 'conflict'],
});
