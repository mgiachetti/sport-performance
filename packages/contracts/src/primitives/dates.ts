import { isLocalDate, isTimeZone } from '@sport-performance/domain';
import { z } from 'zod';

/**
 * Instant in time: ISO 8601 / RFC 3339 with an explicit offset.
 * The server always emits UTC with millisecond precision (`Date#toISOString()`);
 * clients may send any offset. Kept as a string in the contract (no `Date`
 * transform) so the schema is representable in JSON Schema and symmetric
 * between client and server; it is the wire form of the domain `Instant`
 * (`new Date(value)` on either side).
 */
export const dateTimeSchema = z.iso.datetime({ offset: true }).meta({
  description:
    'Fecha y hora ISO 8601 con zona (`Z` u offset). El servidor emite UTC con milisegundos.',
  examples: ['2026-11-01T12:00:00.000Z'],
});

/**
 * Calendar date without time (`YYYY-MM-DD`), parsed into the domain
 * `LocalDate`. "The day" of a load, wellness entry or streak is always
 * computed in the club's time zone (`localDateInTimeZone` in the domain).
 */
export const localDateSchema = z.iso
  .date()
  .refine(isLocalDate, { message: 'Invalid local date' })
  .meta({
    description: 'Fecha de calendario `YYYY-MM-DD`, en la zona horaria del club.',
    examples: ['2026-11-01'],
  });

/**
 * IANA time zone of a club (`America/Argentina/Buenos_Aires`), parsed into the
 * domain `TimeZone`: only `UTC` or `Area/Location` in IANA spelling, never a
 * fixed offset (`Etc/GMT+3`) or a region-less alias (`EST`).
 */
export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isTimeZone, { message: 'Invalid IANA time zone' })
  .meta({
    description: 'Zona horaria IANA de la región del club (`UTC` o `Área/Lugar`).',
    examples: ['America/Argentina/Buenos_Aires'],
  });
