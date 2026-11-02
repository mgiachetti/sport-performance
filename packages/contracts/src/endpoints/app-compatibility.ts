import {
  APP_COMPATIBILITY_STATUSES,
  APP_PLATFORMS,
  APP_VERSION_PATTERN,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { CONTRACT_VERSION } from '../versioning.js';

export const appPlatformSchema = z.enum(APP_PLATFORMS).meta({
  id: 'AppPlatform',
  description: 'Plataforma de la app: `ios` o `android` (la web siempre sirve el último build).',
});

export const appVersionSchema = z
  .string()
  .regex(APP_VERSION_PATTERN)
  .meta({
    id: 'AppVersion',
    description: 'Versión nativa del binario de la app, `MAJOR.MINOR.PATCH` (sin sufijos).',
    examples: ['1.4.0'],
  });

export const appCompatibilityStatusSchema = z.enum(APP_COMPATIBILITY_STATUSES).meta({
  id: 'AppCompatibilityStatus',
  description:
    '`supported`: al día. `update_available`: funciona, pero hay una versión nueva en la tienda (aviso descartable). `update_required`: ya no es compatible; la API responde `426 app_update_required` y la app muestra la pantalla de "actualizá la app".',
});

export const appCompatibilitySchema = z
  .object({
    status: appCompatibilityStatusSchema,
    platform: appPlatformSchema,
    version: appVersionSchema.meta({ description: 'La versión consultada.' }),
    minVersion: appVersionSchema.meta({
      description: 'Versión más vieja que la API todavía atiende en esta plataforma.',
    }),
    latestVersion: appVersionSchema.nullable().meta({
      description: 'Última versión publicada en la tienda; `null` si no se anunció.',
    }),
    storeUrl: z
      .url({ protocol: /^https$/ })
      .nullable()
      .meta({
        description: 'Link a la app en la tienda de la plataforma; `null` si no está configurado.',
        examples: ['https://apps.apple.com/app/id0000000000'],
      }),
    api: z
      .object({
        contractVersion: z
          .string()
          .min(1)
          .meta({
            description:
              'Semver del contrato (`info.version` del OpenAPI, header `X-Api-Version`).',
            examples: [CONTRACT_VERSION],
          }),
        serverVersion: z
          .string()
          .min(1)
          .meta({
            description: 'Versión desplegada del servidor (semver o sha).',
            examples: ['a1b2c3d'],
          }),
      })
      .meta({ id: 'ApiVersionInfo' }),
  })
  .meta({
    id: 'AppCompatibility',
    description: 'Si una versión de la app puede usar la API, y adónde actualizarla.',
  });

export type AppCompatibility = z.output<typeof appCompatibilitySchema>;

export const getAppCompatibility = defineEndpoint({
  method: 'GET',
  path: '/v1/app/compatibility',
  summary: 'Compatibilidad de la versión de la app',
  description:
    'Público y sin sesión: la app lo pide al abrir y al volver a primer plano, y cuando cualquier llamada responde `426 app_update_required`. Nunca responde `426`. La política es la misma para todos los clubes (una sola app, ADR 0014). Cacheable unos minutos.',
  tags: ['system'],
  auth: 'public',
  query: z.strictObject({ platform: appPlatformSchema, version: appVersionSchema }),
  response: { status: 200, description: 'Estado de la versión.', schema: appCompatibilitySchema },
  errors: [],
  skipAppVersionCheck: true,
});
