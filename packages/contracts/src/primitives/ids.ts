import {
  type CategoryId,
  type ClubId,
  type PlayerId,
  type Uuid,
  type UserId,
  isUuid,
} from '@sport-performance/domain';
import { z } from 'zod';

/**
 * Entity identifier on the wire: an RFC 9562 UUID string, parsed into the
 * domain `Uuid` (canonical lowercase; input is accepted in any case and
 * lowercased). The server always emits the lowercase form. Offline-created
 * rows (mobile) carry a client-generated UUID as well.
 */
export const uuidSchema = z
  .uuid()
  .toLowerCase()
  .refine(isUuid, { message: 'Invalid UUID' })
  .meta({
    description: 'UUID (RFC 9562). El servidor lo emite en minúsculas.',
    examples: ['0192e7a0-5c1a-7b7e-9f3a-2d4c6b8a1e0f'],
  });

/**
 * Builds an id schema with an entity-specific description whose output is the
 * domain branded id (`idOf<ClubId>('club')`). Same validation as
 * {@link uuidSchema}; the brand only says which entity the UUID points to.
 */
export function idOf<Id extends Uuid = Uuid>(entity: string) {
  return z
    .uuid()
    .toLowerCase()
    .refine((value): value is Id => isUuid(value), { message: 'Invalid UUID' })
    .meta({ description: `Id de ${entity} (UUID, RFC 9562).` });
}

export const clubIdSchema = idOf<ClubId>('club');
export const userIdSchema = idOf<UserId>('usuario');
export const playerIdSchema = idOf<PlayerId>('jugador/a');
export const categoryIdSchema = idOf<CategoryId>('categoría');

/** Pattern for URL-safe slugs: lowercase ASCII letters and digits separated by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** URL-safe identifier chosen by humans (club slug, category slug...). 2 to 63 characters. */
export const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(SLUG_PATTERN)
  .meta({
    description: 'Slug: minúsculas, dígitos y guiones simples, de 2 a 63 caracteres.',
    examples: ['orc'],
  });
