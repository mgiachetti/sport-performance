import {
  MEASUREMENT_METHODS,
  UNIT_CODES,
  isWellFormedCode,
  type MetricDirection,
  type UnitCode,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
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
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { idOf, playerIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';

/**
 * First-team references (B-321, ADR 0040): the value the first team has for
 * a metric, by sport, sex and scope (a position, a line or the whole squad),
 * with its unit, method, start date and source. They draw the dotted white
 * line of the player profile. The staff reads them; `sc` and the
 * administration load them by hand or as an imported table (the Catapult
 * import, #90, produces the same rows). Players never list them: they see
 * the reference that applies to them, against their own value.
 */

/** Longest `source` (the `reference_value_source_format` check of the database). */
export const REFERENCE_SOURCE_MAX_LENGTH = 200;
/** Most rows of one import. */
export const REFERENCE_IMPORT_MAX_ROWS = 500;

export const referenceValueIdSchema = idOf('referencia de primera');

export const REFERENCE_SCOPES = ['position', 'line', 'squad'] as const;
export const referenceScopeSchema = z.enum(REFERENCE_SCOPES).meta({
  id: 'ReferenceScope',
  description:
    'Alcance: una posición (`position`), una línea (`line`) o todo el plantel (`squad`). Para un jugador aplica la más específica.',
});

const UNIT_VALUES = UNIT_CODES as [UnitCode, ...UnitCode[]];
const unitSchema = z.enum(UNIT_VALUES).meta({
  description: 'Unidad canónica de la métrica (sin conversión: tiene que ser la de la métrica).',
  examples: ['cm'],
});

const methodSchema = z.enum(MEASUREMENT_METHODS).meta({
  description: 'Cómo la midió la primera, si se sabe (principio 4: métodos distintos avisan).',
});

const DIRECTIONS = [
  'higher_is_better',
  'lower_is_better',
  'neutral',
] as const satisfies readonly MetricDirection[];
const directionSchema = z.enum(DIRECTIONS).meta({
  description: 'Sentido de la métrica: si más es mejor, si menos es mejor o neutra.',
});

const codeSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isWellFormedCode, { message: 'Invalid code: English snake_case' });

const metricCodeSchema = codeSchema.meta({
  description: 'Código canónico de la métrica (`metric_definition.code`).',
  examples: ['cmj_height_cm'],
});

const positionCodeSchema = codeSchema.meta({
  description: 'Código de la posición en ese deporte (`GET /v1/positions`).',
  examples: ['hooker'],
});

const lineCodeSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/)
  .meta({
    description: 'Línea de las posiciones del deporte (`Position.lineCode`).',
    examples: ['forwards'],
  });

export const referenceSourceSchema = z
  .string()
  .min(1)
  .max(REFERENCE_SOURCE_MAX_LENGTH)
  .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' })
  .meta({
    description: 'De dónde sale el valor; se muestra en el tooltip.',
    examples: ['Catapult, pretemporada 2026'],
  });

const referenceValueNumberSchema = z
  .number()

  .meta({ description: 'Valor de la primera, en la unidad de la métrica.' });

export const referenceValueSchema = z
  .object({
    id: referenceValueIdSchema,
    metricDefinitionId: idOf('métrica'),
    metricCode: metricCodeSchema,
    sport: sportSchema,
    sex: sexSchema,
    scope: referenceScopeSchema,
    positionId: idOf('posición').nullable(),
    positionCode: positionCodeSchema.nullable(),
    lineCode: lineCodeSchema.nullable(),
    value: referenceValueNumberSchema,
    unit: unitSchema,
    method: methodSchema.nullable(),
    validFrom: localDateSchema.meta({
      description: 'Desde qué día aplica (la más nueva no posterior a la fecha comparada).',
    }),
    source: referenceSourceSchema,
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'ReferenceValue' });

export type ReferenceValue = z.output<typeof referenceValueSchema>;

/** `positionCode` and `lineCode` are exclusive: neither means the whole squad. */
function oneScope(
  row: { positionCode?: string | undefined; lineCode?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (row.positionCode !== undefined && row.lineCode !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['lineCode'],
      message: 'A reference is for a position or for a line, not both',
    });
  }
}

const scopeFields = {
  positionCode: positionCodeSchema.optional().meta({
    description: 'Referencia de una posición. Excluyente con `lineCode`; sin ninguno, plantel.',
  }),
  lineCode: lineCodeSchema.optional().meta({
    description: 'Referencia de una línea. Excluyente con `positionCode`.',
  }),
};

const referenceParams = z.strictObject({ referenceValueId: referenceValueIdSchema });

export const listReferenceValues = defineEndpoint({
  method: 'GET',
  path: '/v1/reference-values',
  summary: 'Referencias de primera',
  description:
    'Staff del club (`configuration.read`: coach, sc, medical y la administración). Jugadores y tutores: `forbidden` (ven la que les aplica en `GET /v1/players/{playerId}/first-team-references`).',
  tags: ['references'],
  auth: 'club',
  query: pageQuerySchema.extend({
    metricCode: metricCodeSchema.optional(),
    sport: sportSchema.optional(),
    sex: sexSchema.optional(),
    scope: referenceScopeSchema.optional(),
    positionCode: positionCodeSchema.optional(),
    lineCode: lineCodeSchema.optional(),
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['validFrom', 'createdAt', 'metricCode'], '-validFrom'),
  }),
  response: {
    status: 200,
    description: 'Página de referencias.',
    schema: pageOf(referenceValueSchema).meta({ id: 'ReferenceValuePage' }),
  },
  errors: ['bad_request'],
});

export const getReferenceValue = defineEndpoint({
  method: 'GET',
  path: '/v1/reference-values/{referenceValueId}',
  summary: 'Una referencia de primera',
  description: 'Mismo permiso que la lista. De otro club: `not_found`.',
  tags: ['references'],
  auth: 'club',
  params: referenceParams,
  response: { status: 200, description: 'La referencia.', schema: referenceValueSchema },
  errors: ['not_found'],
});

export const createReferenceValue = defineEndpoint({
  method: 'POST',
  path: '/v1/reference-values',
  summary: 'Cargar una referencia de primera',
  description:
    '`sc` y la administración (`configuration.update`). La métrica tiene que existir, estar activa y aplicar al deporte; la unidad, ser la de la métrica; la posición, del mismo deporte; la línea, una de las posiciones del deporte. Idempotente por `clientUuid`; otra referencia activa con la misma métrica, deporte, sexo, alcance y vigencia: `conflict`.',
  tags: ['references'],
  auth: 'club',
  body: z
    .strictObject({
      clientUuid: clientUuidSchema.optional(),
      metricCode: metricCodeSchema,
      sport: sportSchema,
      sex: sexSchema,
      ...scopeFields,
      value: referenceValueNumberSchema,
      unit: unitSchema,
      method: methodSchema.optional(),
      validFrom: localDateSchema,
      source: referenceSourceSchema,
    })
    .superRefine(oneScope),
  response: { status: 201, description: 'Referencia cargada.', schema: referenceValueSchema },
  errors: ['conflict'],
});

export const updateReferenceValue = defineEndpoint({
  method: 'PATCH',
  path: '/v1/reference-values/{referenceValueId}',
  summary: 'Corregir una referencia de primera',
  description:
    '`sc` y la administración. Se corrigen el valor, el método, la vigencia y la fuente; la métrica, el deporte, el sexo y el alcance no (se archiva y se carga otra). Un período nuevo es otra referencia con otra vigencia, no una edición. `version` desactualizada o choque con otra activa: `conflict`.',
  tags: ['references'],
  auth: 'club',
  params: referenceParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    value: referenceValueNumberSchema.optional(),
    method: methodSchema.nullable().optional().meta({ description: '`null` lo borra.' }),
    validFrom: localDateSchema.optional(),
    source: referenceSourceSchema.optional(),
  }),
  response: { status: 200, description: 'La referencia corregida.', schema: referenceValueSchema },
  errors: ['not_found', 'conflict'],
});

export const archiveReferenceValue = defineEndpoint({
  method: 'POST',
  path: '/v1/reference-values/{referenceValueId}/archive',
  summary: 'Archivar una referencia de primera',
  description: '`sc` y la administración. Deja de aplicar a los jugadores. Idempotente.',
  tags: ['references'],
  auth: 'club',
  params: referenceParams,
  response: { status: 200, description: 'Referencia archivada.', schema: referenceValueSchema },
  errors: ['not_found'],
});

export const restoreReferenceValue = defineEndpoint({
  method: 'POST',
  path: '/v1/reference-values/{referenceValueId}/restore',
  summary: 'Restaurar una referencia de primera',
  description:
    '`sc` y la administración. Si ya hay otra activa con la misma clave y vigencia: `conflict`. Idempotente.',
  tags: ['references'],
  auth: 'club',
  params: referenceParams,
  response: { status: 200, description: 'Referencia restaurada.', schema: referenceValueSchema },
  errors: ['not_found', 'conflict'],
});

export const REFERENCE_IMPORT_MODES = ['insert', 'replace'] as const;

export const referenceImportRowSchema = z
  .strictObject({
    metricCode: metricCodeSchema,
    sport: sportSchema,
    sex: sexSchema,
    ...scopeFields,
    value: referenceValueNumberSchema,
    unit: unitSchema,
    method: methodSchema.optional(),
    validFrom: localDateSchema.optional().meta({ description: 'Por defecto, la del lote.' }),
    source: referenceSourceSchema.optional().meta({ description: 'Por defecto, la del lote.' }),
  })
  .superRefine(oneScope)
  .meta({ id: 'ReferenceImportRow' });

export const importReferenceValues = defineEndpoint({
  method: 'POST',
  path: '/v1/reference-values/import',
  summary: 'Importar una tabla de referencias de primera',
  description: `\`sc\` y la administración. Una tabla ya parseada (el cliente lee la planilla; la importación de Catapult, #90, arma las mismas filas), de 1 a ${String(REFERENCE_IMPORT_MAX_ROWS)} filas. Todo o nada: si alguna fila no vale, \`validation_failed\` con el detalle por fila (\`body.rows.<i>.<campo>\`) y no se escribe nada. \`insert\`: una fila que choca con una referencia activa (misma métrica, deporte, sexo, alcance y vigencia) es \`conflict\`; \`replace\`: la activa se archiva y queda la importada. Idempotente por \`clientUuid\` del lote.`,
  tags: ['references'],
  auth: 'club',
  body: z
    .strictObject({
      clientUuid: clientUuidSchema,
      mode: z
        .enum(REFERENCE_IMPORT_MODES)
        .default('insert')
        .meta({ description: '`insert` (por defecto) o `replace`.' }),
      validFrom: localDateSchema
        .optional()
        .meta({ description: 'Vigencia de las filas que no traen la suya.' }),
      source: referenceSourceSchema
        .optional()
        .meta({ description: 'Fuente de las filas que no traen la suya.' }),
      rows: z.array(referenceImportRowSchema).min(1).max(REFERENCE_IMPORT_MAX_ROWS),
    })
    .superRefine((batch, ctx) => {
      batch.rows.forEach((row, index) => {
        if (row.validFrom === undefined && batch.validFrom === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['rows', index, 'validFrom'],
            message: 'The row has no validFrom and the batch has no default',
          });
        }
        if (row.source === undefined && batch.source === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: ['rows', index, 'source'],
            message: 'The row has no source and the batch has no default',
          });
        }
      });
    }),
  response: {
    status: 201,
    description: 'Referencias importadas.',
    schema: z
      .object({
        items: z.array(referenceValueSchema),
        archivedCount: z
          .int()
          .min(0)
          .meta({ description: 'Referencias activas que archivó el modo `replace`.' }),
      })
      .meta({ id: 'ReferenceImportResult' }),
  },
  errors: ['conflict'],
});

export const playerFirstTeamReferenceSchema = z
  .object({
    metricCode: metricCodeSchema,
    unit: unitSchema,
    direction: directionSchema,
    scope: referenceScopeSchema,
    value: referenceValueNumberSchema,
    method: methodSchema.nullable(),
    validFrom: localDateSchema,
    source: referenceSourceSchema,
  })
  .meta({ id: 'PlayerFirstTeamReference' });

export type PlayerFirstTeamReference = z.output<typeof playerFirstTeamReferenceSchema>;

export const getPlayerFirstTeamReferences = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/first-team-references',
  summary: 'Referencias de primera que aplican a un jugador',
  description:
    'La línea de referencia de la ficha (`group_reference.read`): el propio jugador, el staff asignado y la administración; nunca el tutor. Por métrica, la referencia del deporte de su categoría y su sexo, la más específica (posición, después línea, después plantel) y la vigencia más nueva no posterior a `asOf`. Solo valores de la primera: ningún dato de otros jugadores. Una métrica sin referencia no aparece. Jugador de otro club, fuera del alcance o sin categoría: `not_found`.',
  tags: ['references'],
  auth: 'club',
  params: z.strictObject({ playerId: playerIdSchema }),
  query: z.strictObject({
    asOf: localDateSchema
      .optional()
      .meta({ description: 'Fecha a comparar; por defecto, hoy en la zona del club.' }),
    metricCode: metricCodeSchema.optional(),
  }),
  response: {
    status: 200,
    description: 'Las referencias del jugador, por código de métrica.',
    schema: z
      .object({
        playerId: playerIdSchema,
        asOf: localDateSchema,
        sport: sportSchema,
        sex: sexSchema,
        positionCode: positionCodeSchema.nullable(),
        lineCode: lineCodeSchema.nullable(),
        items: z.array(playerFirstTeamReferenceSchema),
      })
      .meta({ id: 'PlayerFirstTeamReferences' }),
  },
  errors: ['not_found'],
});
