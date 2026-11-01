import type { Brand } from './brand.js';
import { DomainValidationError, describeValue } from './errors.js';

/** RFC 9562 UUID (any version), canonical lowercase hyphenated form. */
export type Uuid = Brand<string, 'Uuid'>;

export type ClubId = Brand<Uuid, 'ClubId'>;
export type UserId = Brand<Uuid, 'UserId'>;
export type PlayerId = Brand<Uuid, 'PlayerId'>;
export type CategoryId = Brand<Uuid, 'CategoryId'>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Accepts upper or lower case and returns the canonical lowercase form. */
export function parseUuid(value: unknown): Uuid {
  const normalized = typeof value === 'string' ? value.toLowerCase() : value;
  if (isUuid(normalized)) return normalized;
  throw new DomainValidationError('invalid_uuid', `Invalid UUID: ${describeValue(value)}.`, value);
}

export const parseClubId = (value: unknown): ClubId => parseUuid(value) as ClubId;
export const parseUserId = (value: unknown): UserId => parseUuid(value) as UserId;
export const parsePlayerId = (value: unknown): PlayerId => parseUuid(value) as PlayerId;
export const parseCategoryId = (value: unknown): CategoryId => parseUuid(value) as CategoryId;
