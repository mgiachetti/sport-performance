import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { hexColorSchema } from '../primitives/color.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { clubIdSchema, slugSchema } from '../primitives/ids.js';

export const clubSlugSchema = slugSchema.meta({
  description: 'Slug del club, único entre tenants.',
  examples: ['orc'],
});

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** HTTPS, or plain HTTP to a local bucket (MinIO in development and tests). */
function isSecureOrLoopback(value: string): boolean {
  const url = new URL(value);
  return url.protocol === 'https:' || LOOPBACK_HOSTS.has(url.hostname);
}

/** Brand colors a club overrides; `packages/ui-tokens` derives the full palette from them. */
export const clubBrandColorsSchema = z
  .object({
    primary: hexColorSchema.meta({
      description: 'Color de marca principal.',
      examples: ['#F1882A'],
    }),
    onPrimary: hexColorSchema.meta({
      description: 'Texto e íconos sobre `primary` (contraste AA).',
      examples: ['#050505'],
    }),
    secondary: hexColorSchema.meta({
      description: 'Color de marca secundario.',
      examples: ['#050505'],
    }),
    onSecondary: hexColorSchema.meta({
      description: 'Texto e íconos sobre `secondary` (contraste AA).',
      examples: ['#F3EEE7'],
    }),
  })
  .meta({ id: 'ClubBrandColors' });

/** Branding the web and the app apply at runtime for a club (white-label). */
export const clubThemeSchema = z
  .object({
    clubId: clubIdSchema,
    slug: clubSlugSchema,
    name: z
      .string()
      .min(1)
      .max(120)
      .meta({ description: 'Nombre completo.', examples: ['Olivos Rugby Club'] }),
    shortName: z
      .string()
      .min(1)
      .max(16)
      .meta({ description: 'Sigla para espacios chicos.', examples: ['ORC'] }),
    logoUrl: z
      .url({ protocol: /^https?$/ })
      .refine(isSecureOrLoopback, { message: 'The logo URL must be https' })
      .nullable()
      .meta({
        description:
          'Escudo (PNG o WebP): URL firmada del bucket, HTTPS (HTTP solo contra `localhost` en desarrollo), válida al menos una hora. `null` si el club no cargó uno.',
      }),
    colors: clubBrandColorsSchema,
    updatedAt: dateTimeSchema.meta({
      description: 'Última modificación; sirve para invalidar el tema cacheado.',
    }),
  })
  .meta({ id: 'ClubTheme', description: 'Marca del club para aplicar el tema en runtime.' });

export type ClubBrandColors = z.output<typeof clubBrandColorsSchema>;
export type ClubTheme = z.output<typeof clubThemeSchema>;

export const getClubTheme = defineEndpoint({
  method: 'GET',
  path: '/v1/clubs/{clubSlug}/theme',
  summary: 'Tema del club',
  description:
    'Público: la web y la app lo piden antes del login para mostrar la marca del club. No expone datos de personas.',
  tags: ['clubs'],
  auth: 'public',
  params: z.strictObject({ clubSlug: clubSlugSchema }),
  response: { status: 200, description: 'Tema del club.', schema: clubThemeSchema },
  errors: ['not_found'],
});
