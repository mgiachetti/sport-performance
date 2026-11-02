import { MEMBERSHIP_ROLES } from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { clubIdSchema, idOf, slugSchema, userIdSchema } from '../primitives/ids.js';

/** Digits of the sign-in code sent by email (ADR 0010). */
export const SIGN_IN_CODE_LENGTH = 6;

/** Email of a person. The server compares and stores it in lowercase. */
export const emailSchema = z
  .email()
  .max(254)
  .meta({
    description: 'Email. El servidor lo guarda y lo compara en minúsculas.',
    examples: ['ana@example.com'],
  });

export const signInCodeSchema = z
  .string()
  .regex(new RegExp(`^[0-9]{${String(SIGN_IN_CODE_LENGTH)}}$`))
  .meta({
    description: `Código de ${String(SIGN_IN_CODE_LENGTH)} dígitos que llegó por email.`,
    examples: ['482913'],
  });

/** Role of a membership in a club (ADR 0007); `superadmin` is global, never a membership. */
export const membershipRoleSchema = z.enum(MEMBERSHIP_ROLES).meta({
  id: 'MembershipRole',
  description: 'Rol en el club. `superadmin` no es una membresía: es un atributo del usuario.',
});

export const membershipIdSchema = idOf('membresía');

/** Club as the club selector shows it. */
export const clubSummarySchema = z
  .object({
    id: clubIdSchema,
    slug: slugSchema,
    name: z
      .string()
      .min(1)
      .max(120)
      .meta({ examples: ['Olivos Rugby Club'] }),
  })
  .meta({ id: 'ClubSummary' });

/** A membership of the signed-in user: what the club selector lists. */
export const membershipSchema = z
  .object({
    id: membershipIdSchema,
    club: clubSummarySchema,
    role: membershipRoleSchema,
    startedAt: dateTimeSchema,
  })
  .meta({
    id: 'Membership',
    description:
      'Membresía activa: el `id` es lo que se manda en `X-Membership-Id` para actuar en ese club con ese rol.',
  });

/** The signed-in user. Users are global: no club here (ADR 0007). */
export const sessionUserSchema = z
  .object({
    id: userIdSchema,
    email: emailSchema,
    name: z.string().max(200).meta({ description: 'Nombre; vacío hasta que el usuario lo carga.' }),
    isSuperadmin: z.boolean().meta({ description: 'Soporte de la plataforma (todos los clubes).' }),
  })
  .meta({ id: 'SessionUser' });

export const SESSION_TRANSPORTS = ['cookie', 'bearer'] as const;
export type SessionTransport = (typeof SESSION_TRANSPORTS)[number];

export const signInCodeSentSchema = z
  .object({
    expiresInS: z
      .int()
      .positive()
      .meta({ description: 'Segundos de validez del código.', examples: [300] }),
  })
  .meta({ id: 'SignInCodeSent' });

export const signedInSchema = z
  .object({
    user: sessionUserSchema,
    session: z.object({
      expiresAt: dateTimeSchema.meta({
        description: 'Vence si no se usa antes; con el uso se renueva.',
      }),
      token: z.string().min(1).nullable().meta({
        description:
          'Con `transport: "bearer"`: token para `Authorization: Bearer`. Con `cookie`: `null` (la sesión viaja en una cookie `HttpOnly`).',
      }),
    }),
  })
  .meta({ id: 'SignedIn' });

export type SessionUser = z.output<typeof sessionUserSchema>;
export type MembershipSummary = z.output<typeof membershipSchema>;
export type SignedIn = z.output<typeof signedInSchema>;

export const sendSignInCode = defineEndpoint({
  method: 'POST',
  path: '/v1/auth/email-otp',
  summary: 'Pedir código de ingreso',
  description:
    'Manda un código de un solo uso al email. Responde igual exista o no la cuenta (la cuenta se crea al verificar el código). Pedir un código nuevo invalida el anterior. Limitado por email y por IP.',
  tags: ['auth'],
  auth: 'public',
  body: z.object({ email: emailSchema }),
  response: { status: 202, description: 'Código enviado.', schema: signInCodeSentSchema },
  errors: ['rate_limited', 'service_unavailable'],
});

export const verifySignInCode = defineEndpoint({
  method: 'POST',
  path: '/v1/auth/email-otp/verify',
  summary: 'Ingresar con el código',
  description:
    'Verifica el código y abre una sesión. La web usa `transport: "cookie"` (cookie `HttpOnly`); mobile usa `"bearer"` y guarda el token en el almacenamiento seguro. Código incorrecto o vencido: `unauthenticated`. Cada código admite 3 intentos; después, `rate_limited` sin `Retry-After`: no hay que esperar sino pedir otro código. Los límites por email y por IP también responden `rate_limited`, con `Retry-After`.',
  tags: ['auth'],
  auth: 'public',
  body: z.object({
    email: emailSchema,
    code: signInCodeSchema,
    transport: z
      .enum(SESSION_TRANSPORTS)
      .default('cookie')
      .meta({ description: 'Cómo viaja la sesión: cookie (web) o token bearer (mobile).' }),
  }),
  response: { status: 200, description: 'Sesión abierta.', schema: signedInSchema },
  errors: ['unauthenticated', 'rate_limited'],
});

export const signOut = defineEndpoint({
  method: 'POST',
  path: '/v1/auth/sign-out',
  summary: 'Cerrar sesión',
  description: 'Revoca la sesión en el servidor (cookie o token bearer) y borra la cookie.',
  tags: ['auth'],
  auth: 'session',
  response: { status: 204, description: 'Sesión cerrada.', schema: undefined },
  errors: [],
});
