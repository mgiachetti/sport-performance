import {
  CHANGE_OPERATIONS,
  CHANGE_REASON_MAX_LENGTH,
  CHANGE_SOURCES,
  CHANGE_TRACKED_TABLES,
  ROLES,
  parseChangeReason,
} from '@sport-performance/domain';
import { z } from 'zod';
import { dateTimeSchema } from '../primitives/dates.js';
import { playerIdSchema, userIdSchema, uuidSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';

/**
 * Change history of results, sessions and measurements (B-305, ADR 0030).
 * Schemas only: the read endpoints (a record's history, a player's history)
 * and the write endpoints that take a `reason` come with their resources.
 * The history itself is written by the database, never through the API.
 */

export const changeTrackedTableSchema = z.enum(CHANGE_TRACKED_TABLES).meta({
  id: 'ChangeTrackedTable',
  description: 'Tabla cuyos cambios se registran (resultados, sesiones y mediciones).',
});

export const changeOperationSchema = z.enum(CHANGE_OPERATIONS).meta({
  id: 'ChangeOperation',
  description: '`update` (corrección o completado) o `delete`.',
});

export const changeSourceSchema = z.enum(CHANGE_SOURCES).meta({
  id: 'ChangeSource',
  description:
    'Quién hizo el cambio: la API en nombre de un usuario (`app`), el worker (`worker`, valores derivados e importaciones) o un operador (`system`).',
});

/** The reason is already what `parseChangeReason` of the domain would return. */
function isNormalizedChangeReason(value: string): boolean {
  try {
    return parseChangeReason(value) === value;
  } catch {
    return false;
  }
}

/**
 * Reason of a correction, sent by the write endpoints that change submitted
 * values. Already trimmed (no transform in the contract): 1 to 500
 * characters, the same rule as `parseChangeReason` of the domain.
 */
export const changeReasonSchema = z
  .string()
  .min(1)
  .refine(isNormalizedChangeReason, {
    message: `The reason must be 1 to ${String(CHANGE_REASON_MAX_LENGTH)} characters, without leading or trailing whitespace`,
  })
  .meta({
    id: 'ChangeReason',
    description: `Motivo de la corrección (1 a ${String(CHANGE_REASON_MAX_LENGTH)} caracteres, sin espacios al principio ni al final). Obligatorio para corregir un valor ya cargado.`,
    examples: ['Se cargó en el jugador equivocado'],
  });

/** One changed column with its value before and after, as stored (JSON). */
export const changedValueSchema = z
  .object({
    column: z
      .string()
      .min(1)
      .meta({ description: 'Columna (snake_case de la base).', examples: ['notes'] }),
    previous: z.json().meta({ description: 'Valor anterior; `null` si estaba vacío.' }),
    current: z
      .json()
      .meta({ description: 'Valor nuevo; `null` si se vació o si la fila se borró.' }),
  })
  .meta({ id: 'ChangedValue' });

/** A recorded change of a row. */
export const changeHistoryEntrySchema = z
  .object({
    id: uuidSchema,
    tableName: changeTrackedTableSchema,
    recordId: uuidSchema.meta({ description: 'Id de la fila que cambió.' }),
    playerId: playerIdSchema
      .nullable()
      .meta({ description: 'Jugador/a de la fila; `null` para sesiones.' }),
    operation: changeOperationSchema,
    source: changeSourceSchema,
    changedBy: userIdSchema.nullable().meta({
      description: 'Autor/a; `null` para cambios del sistema o si la cuenta se borró.',
    }),
    actorRole: z
      .enum(ROLES)
      .nullable()
      .meta({ description: 'Rol validado con el que se hizo el cambio desde la API.' }),
    changedAt: dateTimeSchema.meta({ description: 'Cuándo se hizo el cambio.' }),
    reason: changeReasonSchema.nullable().meta({
      description: 'Motivo; `null` al completar un valor vacío o en cambios del sistema.',
    }),
    requestId: z
      .string()
      .min(1)
      .max(128)
      .nullable()
      .meta({ description: 'Id del request que hizo el cambio (para cruzar con los logs).' }),
    changes: z.array(changedValueSchema).min(1),
  })
  .meta({
    id: 'ChangeHistoryEntry',
    description:
      'Un cambio registrado: valor anterior y nuevo de cada columna, autor, fecha y motivo.',
  });

/** Query of the history lists: cursor pagination, newest first. */
export const changeHistoryQuerySchema = pageQuerySchema;

export const changeHistoryPageSchema = pageOf(changeHistoryEntrySchema).meta({
  id: 'ChangeHistoryPage',
  description: 'Historial de cambios, del más nuevo al más viejo.',
});

export type ChangeReason = z.output<typeof changeReasonSchema>;
export type ChangedValue = z.output<typeof changedValueSchema>;
export type ChangeHistoryEntry = z.output<typeof changeHistoryEntrySchema>;
export type ChangeHistoryPage = z.output<typeof changeHistoryPageSchema>;
