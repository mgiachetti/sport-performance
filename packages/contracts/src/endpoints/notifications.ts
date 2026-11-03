import {
  EXPO_PUSH_TOKEN_MAX_LENGTH,
  EXPO_PUSH_TOKEN_PATTERN,
  NOTIFICATION_KINDS,
  PUSH_PLATFORMS,
  type NotificationKind,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';

/**
 * Notifications (B-328, ADR 0054): the push token of the device and each
 * user's preferences. The worker plans and delivers the notifications; they
 * carry no health data and no metric values.
 */

const KIND_DESCRIPTIONS: Readonly<Record<NotificationKind, string>> = {
  rpe_request: 'Al jugador/a, al terminar la sesión: pedido del RPE.',
  rpe_reminder: 'Al jugador/a, a la mañana siguiente, si todavía no cargó el RPE.',
  critical_alert: 'Al staff asignado, cuando aparece una alerta crítica (sin nombres ni valores).',
  pre_training_summary:
    'Al staff asignado, antes de cada sesión: conteos de alertas y de bienestar cargado.',
};

export const notificationKindSchema = z.enum(NOTIFICATION_KINDS).meta({
  id: 'NotificationKind',
  description: Object.entries(KIND_DESCRIPTIONS)
    .map(([kind, text]) => `\`${kind}\`: ${text}`)
    .join(' '),
});

export const pushPlatformSchema = z
  .enum(PUSH_PLATFORMS)
  .meta({ id: 'PushPlatform', description: 'Sistema del dispositivo.' });

export const pushTokenSchema = z
  .string()
  .max(EXPO_PUSH_TOKEN_MAX_LENGTH)
  .regex(EXPO_PUSH_TOKEN_PATTERN)
  .meta({
    description: 'Token de Expo Push del dispositivo (`ExponentPushToken[…]`).',
    examples: ['ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'],
  });

export const notificationPreferenceSchema = z
  .object({
    kind: notificationKindSchema,
    push: z.boolean().meta({ description: 'Llega como notificación push al celular.' }),
    email: z.boolean().meta({ description: 'Llega por correo.' }),
    isDefault: z.boolean().meta({
      description: 'Los dos canales están en su valor por defecto (el usuario no los cambió).',
    }),
  })
  .meta({ id: 'NotificationPreference' });

export const notificationPreferenceListSchema = z
  .object({
    items: z.array(notificationPreferenceSchema).meta({
      description:
        'Un elemento por cada tipo que recibe el rol de la membresía, en orden fijo. Un tutor no recibe notificaciones: lista vacía.',
    }),
  })
  .meta({ id: 'NotificationPreferenceList' });

export type NotificationPreference = z.output<typeof notificationPreferenceSchema>;
export type NotificationPreferenceList = z.output<typeof notificationPreferenceListSchema>;

export const registerMyPushToken = defineEndpoint({
  method: 'PUT',
  path: '/v1/me/push-token',
  summary: 'Registrar el token push de este dispositivo',
  description:
    'La app lo manda después de ingresar y cada vez que Expo le da un token nuevo. Queda atado a la sesión de este request: al cerrar o revocar la sesión se borra. Si el mismo token estaba registrado por otra sesión (otra persona ingresó en el mismo celular), pasa a esta. Idempotente.',
  tags: ['me', 'notifications'],
  auth: 'session',
  body: z.strictObject({ token: pushTokenSchema, platform: pushPlatformSchema }),
  response: { status: 204, description: 'Token registrado.', schema: undefined },
  errors: [],
});

export const unregisterMyPushToken = defineEndpoint({
  method: 'DELETE',
  path: '/v1/me/push-token',
  summary: 'Borrar el token push de este dispositivo',
  description:
    'Para cuando el usuario apaga las notificaciones en el celular. Idempotente: sin token registrado también responde 204. Cerrar la sesión ya lo borra.',
  tags: ['me', 'notifications'],
  auth: 'session',
  response: { status: 204, description: 'Token borrado (o no había).', schema: undefined },
  errors: [],
});

export const getMyNotificationPreferences = defineEndpoint({
  method: 'GET',
  path: '/v1/me/notification-preferences',
  summary: 'Mis preferencias de notificaciones',
  description:
    'Qué tipos de notificación llegan y por dónde (push, email), para la membresía de este request. Lo que el usuario nunca cambió tiene el valor por defecto: push en todos los tipos, email solo en alertas críticas.',
  tags: ['me', 'notifications'],
  auth: 'club',
  response: {
    status: 200,
    description: 'Las preferencias.',
    schema: notificationPreferenceListSchema,
  },
  errors: [],
});

export const updateMyNotificationPreferences = defineEndpoint({
  method: 'PATCH',
  path: '/v1/me/notification-preferences',
  summary: 'Cambiar mis preferencias de notificaciones',
  description:
    'Se mandan solo los tipos y canales que cambian. Un tipo que el rol de la membresía no recibe (por ejemplo, alertas para un jugador/a) es `validation_failed`. Un valor igual al de por defecto vuelve a seguir el valor por defecto.',
  tags: ['me', 'notifications'],
  auth: 'club',
  body: z.strictObject({
    preferences: z
      .array(
        z.strictObject({
          kind: notificationKindSchema,
          push: z.boolean().optional(),
          email: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(NOTIFICATION_KINDS.length)
      .refine((items) => new Set(items.map((item) => item.kind)).size === items.length, {
        message: 'Each kind at most once',
      })
      .meta({ description: 'Cada tipo a lo sumo una vez.' }),
  }),
  response: {
    status: 200,
    description: 'Las preferencias actualizadas.',
    schema: notificationPreferenceListSchema,
  },
  errors: [],
});
