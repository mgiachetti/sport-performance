import { isWellFormedCode } from '@sport-performance/domain';
import { z } from 'zod';
import { localDateSchema } from '../primitives/dates.js';

/**
 * Building blocks shared by the configuration endpoints of the club (B-322,
 * ADR 0041): codes and the validity range of dated configuration.
 */

/** English `snake_case` code of the domain (test, zone, alert rule), at most 64 characters. */
export const configurationCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isWellFormedCode, { message: 'Expected an English snake_case code' });

export const batteryTestCodeSchema = configurationCodeSchema.meta({
  description: 'Código del test del catálogo del club.',
  examples: ['cmj', 'sprint_40'],
});

export const validFromSchema = localDateSchema.meta({
  description: 'Primer día de vigencia (inclusive), en la zona horaria del club.',
});

export const validToSchema = localDateSchema.nullable().meta({
  description:
    'Fin de la vigencia (exclusivo: ese día ya no vale); `null` mientras siga vigente sin fecha de cierre.',
});

/** `validOn` filter of the dated lists: the rows in force that day. */
export const validOnQuerySchema = localDateSchema.optional().meta({
  description: 'Solo las filas vigentes ese día.',
});

/** `onDate` of the effective views: by default, today in the club's time zone. */
export const onDateQuerySchema = localDateSchema.optional().meta({
  description: 'Día a resolver; por defecto, hoy en la zona horaria del club.',
});

export const closePreviousSchema = z.boolean().optional().meta({
  description:
    'Si `true`, cierra en `validFrom` la fila vigente con el mismo alcance (en la misma transacción) en vez de responder `conflict`. Solo con `validFrom` desde hoy.',
});

export const VALIDITY_RULES_DESCRIPTION =
  'Vigencia `[validFrom, validTo)`. Dos filas con el mismo alcance no se superponen (`conflict`). Una fila que todavía no empezó se edita entera o se archiva; una vigente solo se cierra (`validTo` desde hoy) y se abre otra; una que ya terminó no cambia.';
