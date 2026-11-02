import {
  DEVICE_BROWSERS,
  DEVICE_OPERATING_SYSTEMS,
  SESSION_CLIENT_TYPES,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { idOf } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';

/** Id of a sign-in session. It is not the session token: knowing it opens nothing. */
export const sessionIdSchema = idOf('sesión');

export const sessionClientTypeSchema = z.enum(SESSION_CLIENT_TYPES).meta({
  id: 'SessionClientType',
  description: '`web`: la sesión viaja en una cookie `HttpOnly`; `mobile`: token bearer de la app.',
});

export const deviceOsSchema = z.enum(DEVICE_OPERATING_SYSTEMS).meta({
  id: 'DeviceOs',
  description: 'Sistema operativo del dispositivo, deducido del `User-Agent` al ingresar.',
});

export const deviceBrowserSchema = z.enum(DEVICE_BROWSERS).meta({
  id: 'DeviceBrowser',
  description: 'Navegador de una sesión web; `app` para la app mobile.',
});

/**
 * A session of the signed-in user, as "Sesiones activas" shows it (B-333,
 * ADR 0033): enough to recognize the device, never its IP, its raw
 * `User-Agent` or the token.
 */
export const activeSessionSchema = z
  .object({
    id: sessionIdSchema,
    clientType: sessionClientTypeSchema,
    device: z
      .object({
        os: deviceOsSchema.nullable(),
        browser: deviceBrowserSchema.nullable(),
      })
      .meta({ description: '`null` cuando el `User-Agent` no lo dice.' }),
    createdAt: dateTimeSchema.meta({ description: 'Cuándo se ingresó.' }),
    lastUsedAt: dateTimeSchema.meta({
      description: 'Último uso, con una precisión de unos minutos.',
    }),
    expiresAt: dateTimeSchema.meta({
      description: 'Vence si no se usa antes; con el uso se renueva.',
    }),
    current: z.boolean().meta({ description: 'Es la sesión de este request.' }),
  })
  .meta({ id: 'ActiveSession' });

export const revokedSessionsSchema = z
  .object({
    revoked: z
      .int()
      .min(0)
      .meta({ description: 'Sesiones cerradas.', examples: [2] }),
  })
  .meta({ id: 'RevokedSessions' });

export type ActiveSession = z.output<typeof activeSessionSchema>;
export type RevokedSessions = z.output<typeof revokedSessionsSchema>;

export const listMySessions = defineEndpoint({
  method: 'GET',
  path: '/v1/me/sessions',
  summary: 'Mis sesiones activas',
  description:
    'Sesiones vigentes del usuario en todos sus dispositivos (web y mobile), las más nuevas primero. La del request viene con `current: true`. No incluye IP: no se guarda.',
  tags: ['me'],
  auth: 'session',
  query: pageQuerySchema,
  response: {
    status: 200,
    description: 'Página de sesiones.',
    schema: pageOf(activeSessionSchema).meta({ id: 'ActiveSessionPage' }),
  },
  errors: ['bad_request'],
});

export const revokeMySession = defineEndpoint({
  method: 'DELETE',
  path: '/v1/me/sessions/{sessionId}',
  summary: 'Cerrar una sesión',
  description:
    'Cierra otra sesión del usuario: el dispositivo queda afuera en su próximo request. Una sesión que no es del usuario o ya no está vigente: `not_found`. La sesión actual no se cierra acá (`conflict`): se usa `POST /v1/auth/sign-out`.',
  tags: ['me'],
  auth: 'session',
  params: z.strictObject({ sessionId: sessionIdSchema }),
  response: { status: 204, description: 'Sesión cerrada.', schema: undefined },
  errors: ['not_found', 'conflict'],
});

export const revokeMyOtherSessions = defineEndpoint({
  method: 'POST',
  path: '/v1/me/sessions/revoke-others',
  summary: 'Cerrar las demás sesiones',
  description:
    'Cierra todas las sesiones del usuario menos la de este request (por ejemplo, después de perder un celular).',
  tags: ['me'],
  auth: 'session',
  response: { status: 200, description: 'Sesiones cerradas.', schema: revokedSessionsSchema },
  errors: [],
});
