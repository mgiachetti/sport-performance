import { DEFAULT_CLUB_TIME_ZONE, SEXES, SPORTS } from '@sport-performance/domain';
import { SUPPORTED_LOCALES } from '@sport-performance/i18n';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { hexColorSchema } from '../primitives/color.js';
import {
  archivedAtSchema,
  archiveStatusQuerySchema,
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sexSchema,
  sortQuerySchema,
  sportSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, timeZoneSchema } from '../primitives/dates.js';
import { clubIdSchema, idOf, uuidSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { clubSlugSchema } from './club-theme.js';

/**
 * Clubs (tenants), their profile and brand, and their branches (B-313,
 * ADR 0032). The registry (`/v1/clubs`) is the superadmin's; the profile of
 * the club the request acts in (`/v1/club`) is the administration's (the
 * club's `admin`, or a superadmin supporting it).
 */

function isTrimmed(value: string): boolean {
  return value === value.trim();
}

export const CLUB_NAME_MAX_LENGTH = 120;
export const CLUB_SHORT_NAME_MAX_LENGTH = 16;

export const clubNameSchema = z
  .string()
  .min(1)
  .max(CLUB_NAME_MAX_LENGTH)
  .refine(isTrimmed, { message: 'No leading or trailing whitespace' })
  .meta({ description: 'Nombre completo del club.', examples: ['Olivos Rugby Club'] });

export const clubShortNameSchema = z
  .string()
  .min(1)
  .max(CLUB_SHORT_NAME_MAX_LENGTH)
  .refine(isTrimmed, { message: 'No leading or trailing whitespace' })
  .meta({ description: 'Sigla para espacios chicos.', examples: ['ORC'] });

export const localeSchema = z.enum(SUPPORTED_LOCALES).meta({
  id: 'Locale',
  description: 'Idioma y formatos de la interfaz del club (ADR 0019).',
});

/** Brand colors the club sets; the readable ink on each one is derived (`ClubTheme`). */
export const clubColorsSchema = z
  .object({
    primary: hexColorSchema.meta({ description: 'Color principal.', examples: ['#f1882a'] }),
    secondary: hexColorSchema.meta({
      description: 'Segundo color de la camiseta.',
      examples: ['#050505'],
    }),
  })
  .meta({ id: 'ClubColors', description: 'Colores de marca, `#rrggbb` en minúsculas.' });

/** Id of an uploaded file (B-325, #56). */
export const fileIdSchema = idOf('archivo');

/** The club as its administration sees it. */
export const clubSchema = z
  .object({
    id: clubIdSchema,
    slug: clubSlugSchema,
    name: clubNameSchema,
    shortName: clubShortNameSchema,
    timeZone: timeZoneSchema,
    locale: localeSchema,
    colors: clubColorsSchema,
    logoFileId: fileIdSchema
      .nullable()
      .meta({ description: 'Escudo: archivo subido (#56); `null` si no hay.' }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'Club', description: 'Perfil y marca de un club.' });

export const clubBranchIdSchema = idOf('rama del club');

/** A sport and its branch (sex) the club runs (ADR 0017): ORC has men's rugby and women's hockey. */
export const clubBranchSchema = z
  .object({
    id: clubBranchIdSchema,
    sport: sportSchema,
    sex: sexSchema,
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'ClubBranch', description: 'Deporte y rama habilitados en el club.' });

const branchKeySchema = z.strictObject({ sport: sportSchema, sex: sexSchema });

const MAX_BRANCHES = SPORTS.length * SEXES.length;

export const createdClubSchema = z
  .object({ club: clubSchema, branches: z.array(clubBranchSchema) })
  .meta({ id: 'CreatedClub' });

export type Club = z.output<typeof clubSchema>;
export type ClubColors = z.output<typeof clubColorsSchema>;
export type ClubBranch = z.output<typeof clubBranchSchema>;
export type CreatedClub = z.output<typeof createdClubSchema>;

export const listClubs = defineEndpoint({
  method: 'GET',
  path: '/v1/clubs',
  summary: 'Registro de clubes',
  description:
    'Solo superadmin, con `X-Support-Reason` (su acceso queda registrado). Filtra por nombre o slug con `q`.',
  tags: ['clubs'],
  auth: 'session',
  query: pageQuerySchema.extend({
    q: z
      .string()
      .min(1)
      .max(120)
      .optional()
      .meta({ description: 'Texto a buscar en el nombre o el slug (sin distinguir mayúsculas).' }),
    sort: sortQuerySchema(['name', 'createdAt'], 'name'),
  }),
  response: {
    status: 200,
    description: 'Página de clubes.',
    schema: pageOf(clubSchema).meta({ id: 'ClubPage' }),
  },
  errors: ['bad_request', 'forbidden'],
});

export const createClub = defineEndpoint({
  method: 'POST',
  path: '/v1/clubs',
  summary: 'Dar de alta un club',
  description:
    'Solo superadmin, con `X-Support-Reason`. Crea el club con sus ramas y le siembra la configuración por defecto (métricas, tests, batería, reglas de alerta, posiciones y categorías M13 a M19 por rama) en la misma transacción. Idempotente por `clientUuid`. Slug ocupado: `conflict`.',
  tags: ['clubs'],
  auth: 'session',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    slug: clubSlugSchema,
    name: clubNameSchema,
    shortName: clubShortNameSchema,
    timeZone: timeZoneSchema.default(DEFAULT_CLUB_TIME_ZONE),
    locale: localeSchema.default('es-AR'),
    colors: z
      .strictObject({ primary: hexColorSchema, secondary: hexColorSchema })
      .optional()
      .meta({ description: 'Colores de marca; por defecto, los del producto.' }),
    branches: z
      .array(branchKeySchema)
      .min(1)
      .max(MAX_BRANCHES)
      .refine(
        (branches) => new Set(branches.map((b) => `${b.sport}:${b.sex}`)).size === branches.length,
        { message: 'Duplicate branch' },
      )
      .meta({ description: 'Deportes y ramas del club; al menos uno.' }),
  }),
  response: { status: 201, description: 'Club creado.', schema: createdClubSchema },
  errors: ['forbidden', 'conflict'],
});

export const getClub = defineEndpoint({
  method: 'GET',
  path: '/v1/club',
  summary: 'Perfil del club activo',
  description: 'Todo miembro del club activo (o el superadmin que lo asiste).',
  tags: ['clubs'],
  auth: 'club',
  response: { status: 200, description: 'El club.', schema: clubSchema },
  errors: ['not_found'],
});

export const updateClub = defineEndpoint({
  method: 'PATCH',
  path: '/v1/club',
  summary: 'Editar el perfil y la marca del club',
  description:
    'Solo la administración del club (`admin`, o el superadmin que lo asiste). Solo los campos enviados cambian. El `slug` solo lo cambia un superadmin (rompe links viejos). `version` desactualizada: `conflict`.',
  tags: ['clubs'],
  auth: 'club',
  body: z.strictObject({
    version: expectedVersionSchema,
    slug: clubSlugSchema.optional(),
    name: clubNameSchema.optional(),
    shortName: clubShortNameSchema.optional(),
    timeZone: timeZoneSchema.optional(),
    locale: localeSchema.optional(),
    colors: z
      .strictObject({ primary: hexColorSchema.optional(), secondary: hexColorSchema.optional() })
      .optional(),
    logoFileId: uuidSchema
      .nullable()
      .optional()
      .meta({ description: 'Archivo del escudo (#56); `null` lo saca.' }),
  }),
  response: { status: 200, description: 'El club actualizado.', schema: clubSchema },
  errors: ['not_found', 'conflict'],
});

export const listClubBranches = defineEndpoint({
  method: 'GET',
  path: '/v1/club/branches',
  summary: 'Ramas del club',
  description: 'Todo miembro del club activo.',
  tags: ['clubs'],
  auth: 'club',
  query: pageQuerySchema.extend({
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['sport', 'createdAt'], 'sport'),
  }),
  response: {
    status: 200,
    description: 'Página de ramas.',
    schema: pageOf(clubBranchSchema).meta({ id: 'ClubBranchPage' }),
  },
  errors: ['bad_request'],
});

export const enableClubBranch = defineEndpoint({
  method: 'POST',
  path: '/v1/club/branches',
  summary: 'Habilitar un deporte y rama',
  description:
    'Solo la administración. Siembra la configuración por defecto de la rama (posiciones del deporte, categorías M13 a M19, batería). Habilitar una rama activa devuelve la existente; una archivada se restaura con `POST /v1/club/branches/{branchId}/restore` (`conflict`).',
  tags: ['clubs'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    sport: sportSchema,
    sex: sexSchema,
  }),
  response: { status: 201, description: 'Rama habilitada.', schema: clubBranchSchema },
  errors: ['conflict'],
});

const branchParams = z.strictObject({ branchId: clubBranchIdSchema });

export const archiveClubBranch = defineEndpoint({
  method: 'POST',
  path: '/v1/club/branches/{branchId}/archive',
  summary: 'Archivar una rama',
  description:
    'Solo la administración. Archiva la rama y sus categorías activas; los datos se conservan. Idempotente.',
  tags: ['clubs'],
  auth: 'club',
  params: branchParams,
  response: { status: 200, description: 'Rama archivada.', schema: clubBranchSchema },
  errors: ['not_found'],
});

export const restoreClubBranch = defineEndpoint({
  method: 'POST',
  path: '/v1/club/branches/{branchId}/restore',
  summary: 'Restaurar una rama',
  description:
    'Solo la administración. La rama vuelve a estar activa; sus categorías archivadas se restauran una por una. Idempotente.',
  tags: ['clubs'],
  auth: 'club',
  params: branchParams,
  response: { status: 200, description: 'Rama restaurada.', schema: clubBranchSchema },
  errors: ['not_found'],
});
