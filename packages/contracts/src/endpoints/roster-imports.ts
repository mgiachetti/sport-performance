import {
  ROSTER_GUARDIAN_OUTCOMES,
  ROSTER_IMPORT_ACTIONS,
  ROSTER_IMPORT_MAX_GUARDIANS,
  ROSTER_MATCH_REASONS,
  ROSTER_ROW_ISSUE_CODES,
  ROSTER_ROW_RESULTS,
  type RosterImportGuardian,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sexSchema,
  sortQuerySchema,
  sportSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { validationIssueSchema } from '../primitives/errors.js';
import { categoryIdSchema, idOf, playerIdSchema, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { emailSchema } from './auth.js';
import { positionIdSchema } from './categories.js';
import { guardianRelationshipSchema } from './guardians.js';
import { PLAYER_POSITIONS_MAX, dominantSideSchema, playerNameSchema } from './players.js';

/**
 * Roster import (padrón, B-330, ADR 0047): players, their category and
 * positions, and their guardians, from a spreadsheet. The client reads the
 * file (CSV or Excel) and maps it with `rosterRowsFromTable` of the domain;
 * the API validates the rows against the club, shows a preview with the
 * duplicates it finds, and imports all of them or none. Only the
 * administration imports (`data_import.run` without a category).
 */

/** Most rows of one import (the largest club roster fits several times). */
export const ROSTER_IMPORT_MAX_ROWS = 1000;
/** Longest category cell (the `category_name_format` check: 60). */
export const ROSTER_CATEGORY_MAX_LENGTH = 60;
/** Longest position cell: a code (64) or a club label. */
export const ROSTER_POSITION_MAX_LENGTH = 64;

export const rosterImportIdSchema = idOf('importación de padrón');

export const rosterImportActionSchema = z.enum(ROSTER_IMPORT_ACTIONS).meta({
  id: 'RosterImportAction',
  description:
    '`create` (alta nueva), `skip` (no cambia la ficha; los tutores igual se vinculan al jugador encontrado) o `update` (completa la ficha de un jugador encontrado).',
});

export const rosterMatchReasonSchema = z.enum(ROSTER_MATCH_REASONS).meta({
  id: 'RosterMatchReason',
  description:
    'Por qué una fila puede ser un jugador del club: `same_name_and_birth_date` (coincidencia exacta), `swapped_names`, `same_last_name_and_birth_date`, `similar_name` (un error de tipeo) o `same_name_close_birth_date` (fecha cercana o con día y mes invertidos). Siempre dentro del mismo deporte.',
});

export const rosterGuardianOutcomeSchema = z.enum(ROSTER_GUARDIAN_OUTCOMES).meta({
  id: 'RosterGuardianOutcome',
  description:
    '`linked` (el email es de un `parent` activo del club: queda vinculado), `already_linked`, `invitation_pending` (ya hay una invitación abierta), `invite` (hay que invitarlo: la importación no manda emails) o `skipped` (nadie a quien vincular: fila omitida sin jugador, o jugador dado de baja).',
});

export const rosterRowResultSchema = z.enum(ROSTER_ROW_RESULTS).meta({
  id: 'RosterRowResult',
  description: 'Qué pasó con la fila: `created`, `updated` o `skipped`.',
});

const trimmedText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' });

export const rosterImportGuardianSchema = z
  .strictObject({
    email: emailSchema,
    relationship: guardianRelationshipSchema,
  })
  .meta({ id: 'RosterImportGuardian' }) satisfies z.ZodType<RosterImportGuardian>;

export const rosterImportResolutionSchema = z
  .discriminatedUnion('action', [
    z.strictObject({ action: z.literal('create') }),
    z.strictObject({ action: z.literal('skip') }),
    z.strictObject({
      action: z.literal('update'),
      playerId: playerIdSchema.meta({ description: 'Uno de los candidatos de la vista previa.' }),
      version: expectedVersionSchema,
    }),
  ])
  .meta({
    id: 'RosterImportResolution',
    description:
      'Decisión del staff para la fila. Sin decisión: sin coincidencias se crea, con una exacta se omite, con una posible es `validation_failed` (`resolution_required`).',
  });

export type RosterImportResolution = z.output<typeof rosterImportResolutionSchema>;

const guardiansSchema = z
  .array(rosterImportGuardianSchema)
  .max(ROSTER_IMPORT_MAX_GUARDIANS)
  .refine(
    (guardians) => new Set(guardians.map((g) => g.email.toLowerCase())).size === guardians.length,
    { message: 'Repeated guardian email' },
  )
  .meta({ description: `Hasta ${String(ROSTER_IMPORT_MAX_GUARDIANS)} tutores por jugador.` });

const positionsSchema = z
  .array(trimmedText(ROSTER_POSITION_MAX_LENGTH))
  .max(PLAYER_POSITIONS_MAX)
  .meta({
    description:
      'Posiciones del deporte por código (`hooker`) o por la etiqueta del club, la principal primero.',
  });

const rowShape = {
  sourceRow: z
    .int()
    .min(1)
    .optional()
    .meta({ description: 'Fila de la planilla (para los mensajes); no se guarda.' }),
  firstName: playerNameSchema,
  lastName: playerNameSchema,
  birthDate: localDateSchema,
  sex: sexSchema,
  sport: sportSchema.optional().meta({ description: 'Por defecto, el del lote.' }),
  category: trimmedText(ROSTER_CATEGORY_MAX_LENGTH).optional().meta({
    description:
      'Categoría inicial: el nombre de una categoría activa de la rama del jugador o su franja de edad (`M15`) si hay una sola. Sin tildes ni mayúsculas que importen.',
  }),
  positions: positionsSchema.optional(),
  dominantSide: dominantSideSchema.optional(),
  joinedOn: localDateSchema
    .optional()
    .meta({ description: 'Día de alta; por defecto, hoy en la zona del club.' }),
  guardians: guardiansSchema.optional(),
};

export const rosterImportRowSchema = z
  .strictObject({
    ...rowShape,
    resolution: rosterImportResolutionSchema.optional(),
  })
  .meta({ id: 'RosterImportRow' });

export type RosterImportRow = z.output<typeof rosterImportRowSchema>;

const batchShape = {
  sport: sportSchema.optional().meta({ description: 'Deporte de las filas que no traen el suyo.' }),
  rows: z.array(rosterImportRowSchema).min(1).max(ROSTER_IMPORT_MAX_ROWS),
};

/** Every row has a sport, its own or the batch's. */
function everyRowHasSport(
  batch: { sport?: string | undefined; rows: { sport?: string | undefined }[] },
  ctx: z.RefinementCtx,
): void {
  if (batch.sport !== undefined) return;
  batch.rows.forEach((row, index) => {
    if (row.sport === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rows', index, 'sport'],
        message: 'The row has no sport and the batch has no default',
      });
    }
  });
}

export const rosterMatchSchema = z
  .object({
    playerId: playerIdSchema,
    kind: z.enum(['exact', 'possible']),
    reason: rosterMatchReasonSchema,
    firstName: playerNameSchema,
    lastName: playerNameSchema,
    birthDate: localDateSchema,
    sex: sexSchema,
    sport: sportSchema,
    currentCategoryIds: z.array(categoryIdSchema),
    archived: z.boolean().meta({ description: 'Dado de baja: se restaura antes de actualizarlo.' }),
    version: resourceVersionSchema.meta({ description: 'Para decidir `update`.' }),
  })
  .meta({ id: 'RosterMatch' });

export const rosterPreviewGuardianSchema = z
  .object({
    email: emailSchema,
    relationship: guardianRelationshipSchema,
    outcome: rosterGuardianOutcomeSchema,
  })
  .meta({ id: 'RosterPreviewGuardian' });

export const rosterPreviewRowSchema = z
  .object({
    index: z.int().min(0),
    sourceRow: z.int().min(1).nullable(),
    issues: z.array(validationIssueSchema).meta({
      description: `Problemas de la fila (\`["body", "rows", i, campo]\`); vacía si vale. \`code\` es estable para mostrarlo en el idioma del cliente: ${ROSTER_ROW_ISSUE_CODES.map((code) => `\`${code}\``).join(', ')}.`,
    }),
    action: rosterImportActionSchema.nullable().meta({
      description: 'Lo que haría la importación; `null` si la fila no vale o falta decidir.',
    }),
    resolutionRequired: z
      .boolean()
      .meta({ description: 'Hay una coincidencia posible y la fila no trae decisión.' }),
    categoryId: categoryIdSchema.nullable(),
    positionIds: z.array(positionIdSchema),
    matches: z.array(rosterMatchSchema).meta({ description: 'Exactas primero.' }),
    duplicateOfIndex: z
      .int()
      .min(0)
      .nullable()
      .meta({ description: 'Otra fila del archivo con la misma persona.' }),
    guardians: z.array(rosterPreviewGuardianSchema),
  })
  .meta({ id: 'RosterPreviewRow' });

const countSchema = z.int().min(0);

export const rosterPreviewSchema = z
  .object({
    rowCount: countSchema,
    invalidCount: countSchema,
    resolutionRequiredCount: countSchema,
    createCount: countSchema,
    updateCount: countSchema,
    skipCount: countSchema,
    guardiansToLinkCount: countSchema,
    invitationsToSendCount: countSchema,
    rows: z.array(rosterPreviewRowSchema),
  })
  .meta({ id: 'RosterImportPreview' });

export type RosterImportPreview = z.output<typeof rosterPreviewSchema>;

export const rosterImportRowOutcomeSchema = z
  .object({
    index: z.int().min(0),
    sourceRow: z.int().min(1).nullable(),
    result: rosterRowResultSchema,
    playerId: playerIdSchema.nullable().meta({
      description:
        'El jugador creado, actualizado o encontrado; `null` si se omitió sin coincidencia.',
    }),
    guardians: z.array(rosterGuardianOutcomeSchema),
  })
  .meta({ id: 'RosterImportRowOutcome' });

const rosterImportSummaryShape = {
  id: rosterImportIdSchema,
  clientUuid: clientUuidSchema,
  rowCount: countSchema,
  createdCount: countSchema,
  updatedCount: countSchema,
  skippedCount: countSchema,
  guardiansLinkedCount: countSchema,
  invitationsToSendCount: countSchema,
  createdBy: userIdSchema
    .nullable()
    .meta({ description: 'Quién importó (`null`: cuenta borrada).' }),
  createdAt: dateTimeSchema,
};

export const rosterImportSummarySchema = z
  .object(rosterImportSummaryShape)
  .meta({ id: 'RosterImportSummary' });

export const rosterImportSchema = z
  .object({
    ...rosterImportSummaryShape,
    rows: z.array(rosterImportRowOutcomeSchema).meta({
      description: 'Resultado por fila: ids y resultados, nunca nombres ni emails.',
    }),
  })
  .meta({ id: 'RosterImport' });

export type RosterImport = z.output<typeof rosterImportSchema>;

export const rosterInvitationToSendSchema = z
  .object({
    rowIndex: z.int().min(0),
    guardianIndex: z.int().min(0),
    playerId: playerIdSchema,
    email: emailSchema,
    relationship: guardianRelationshipSchema,
  })
  .meta({
    id: 'RosterInvitationToSend',
    description:
      'Invitación a enviar con `POST /v1/invitations` (rol `parent`, `playerId` y `relationship`).',
  });

export type RosterInvitationToSend = z.output<typeof rosterInvitationToSendSchema>;

export const previewRosterImport = defineEndpoint({
  method: 'POST',
  path: '/v1/roster-imports/preview',
  summary: 'Vista previa de una importación de padrón',
  description: `La administración (\`data_import.run\` y \`player_profile.create\`). No escribe nada. Valida cada fila contra el club (rama habilitada, categoría activa de la rama, posiciones del deporte, fechas no futuras), busca duplicados en el archivo y en el club (también dados de baja) y dice qué pasaría con cada fila y cada tutor. Hasta ${String(ROSTER_IMPORT_MAX_ROWS)} filas.`,
  tags: ['imports'],
  auth: 'club',
  body: z.strictObject(batchShape).superRefine(everyRowHasSport),
  response: { status: 200, description: 'La vista previa.', schema: rosterPreviewSchema },
  errors: [],
});

export const importRoster = defineEndpoint({
  method: 'POST',
  path: '/v1/roster-imports',
  summary: 'Importar un padrón',
  description:
    'La administración. Todo o nada: si alguna fila no vale (las mismas reglas que la vista previa) o tiene una coincidencia posible sin decisión, `validation_failed` con el detalle por fila y no se escribe nada. No crea un duplicado exacto ni actualiza a un jugador dado de baja; `update` con un `playerId` que no es candidato de la fila: `validation_failed`; con `version` desactualizada: `conflict`. Crear da de alta con posiciones y categoría inicial desde el alta; actualizar cambia el lado dominante y las posiciones si vienen, y agrega la categoría solo si no tiene ninguna vigente (un cambio de categoría es un pase). Los tutores con un `parent` activo del club se vinculan; los demás vuelven en `invitationsToSend` (la importación no manda emails). Idempotente por `clientUuid`: el mismo cuerpo devuelve el mismo resultado (`X-Idempotent-Replay: true`); otro cuerpo con el mismo `clientUuid`: `conflict`.',
  tags: ['imports'],
  auth: 'club',
  body: z
    .strictObject({ clientUuid: clientUuidSchema, ...batchShape })
    .superRefine(everyRowHasSport),
  response: {
    status: 201,
    description: 'Padrón importado.',
    schema: z
      .object({
        import: rosterImportSchema,
        invitationsToSend: z.array(rosterInvitationToSendSchema),
      })
      .meta({ id: 'RosterImportResult' }),
  },
  errors: ['conflict'],
});

export const listRosterImports = defineEndpoint({
  method: 'GET',
  path: '/v1/roster-imports',
  summary: 'Importaciones de padrón',
  description: 'La administración: quién importó, cuándo y cuántas filas creó, actualizó u omitió.',
  tags: ['imports'],
  auth: 'club',
  query: pageQuerySchema.extend({ sort: sortQuerySchema(['createdAt'], '-createdAt') }),
  response: {
    status: 200,
    description: 'Página de importaciones.',
    schema: pageOf(rosterImportSummarySchema).meta({ id: 'RosterImportPage' }),
  },
  errors: ['bad_request'],
});

export const getRosterImport = defineEndpoint({
  method: 'GET',
  path: '/v1/roster-imports/{rosterImportId}',
  summary: 'Una importación de padrón',
  description: 'La administración, con el resultado por fila. De otro club: `not_found`.',
  tags: ['imports'],
  auth: 'club',
  params: z.strictObject({ rosterImportId: rosterImportIdSchema }),
  response: { status: 200, description: 'La importación.', schema: rosterImportSchema },
  errors: ['not_found'],
});
