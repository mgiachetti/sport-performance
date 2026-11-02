import { ALERT_RULE_KINDS } from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sexSchema,
  sortQuerySchema,
  sportSchema,
  stageSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { idOf } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { configurationCodeSchema } from './configuration-common.js';

/**
 * Editable alert rules of the club (B-207, B-322, ADR 0022): declarative
 * data the engine evaluates. The contract describes the shape of each kind;
 * the domain (`parseAlertRule`) checks the semantics (severity order,
 * ranges, windows) on every write. The defaults come from the seed
 * (`DEFAULT_ALERT_RULES`), never from the API.
 */

export const alertRuleIdSchema = idOf('regla de alerta');

export const alertRuleKindSchema = z.enum(ALERT_RULE_KINDS).meta({
  id: 'AlertRuleKind',
  description:
    'Qué evalúa la regla: ACWR alto o bajo, bienestar bajo (valor o z-score propio), caída del CMJ contra la base del jugador/a o velocidad de crecimiento en zona de pico.',
});

export const alertRuleCodeSchema = configurationCodeSchema.meta({
  description: 'Código único en el club, inglés `snake_case`.',
  examples: ['acwr_high', 'wellness_low_m15'],
});

const threshold = (description: string) =>
  z
    .number()
    .nullable()
    .meta({ description: `${description} \`null\` = sin esa severidad.` });
const days = (description: string) => z.int().min(0).max(3650).meta({ description });

export const alertRuleParamsSchemas = {
  acwr_high: z
    .strictObject({
      warningAboveRatio: threshold('Amarillo si el ACWR supera este valor.'),
      criticalAboveRatio: threshold('Rojo si el ACWR supera este valor.'),
      minHistoryDays: days('Con menos días de carga: "historia insuficiente", sin alerta.'),
    })
    .meta({ id: 'AcwrHighParams' }),
  acwr_low: z
    .strictObject({
      warningBelowRatio: threshold('Amarillo si el ACWR queda por debajo.'),
      criticalBelowRatio: threshold('Rojo si el ACWR queda por debajo.'),
      minHistoryDays: days('Con menos días de carga: "historia insuficiente", sin alerta.'),
    })
    .meta({ id: 'AcwrLowParams' }),
  wellness_low: z
    .strictObject({
      warningBelowScore: threshold('Amarillo con un bienestar medio (1–5) por debajo.'),
      criticalBelowScore: threshold('Rojo con un bienestar medio (1–5) por debajo.'),
    })
    .meta({ id: 'WellnessLowParams' }),
  wellness_zscore_low: z
    .strictObject({
      warningBelowZScore: threshold('Amarillo con un z-score (negativo) por debajo.'),
      criticalBelowZScore: threshold('Rojo con un z-score (negativo) por debajo.'),
      windowDays: days('Días anteriores que forman la base móvil.'),
      minSamples: days('Días con bienestar necesarios dentro de la ventana.'),
    })
    .meta({ id: 'WellnessZScoreLowParams' }),
  cmj_drop: z
    .strictObject({
      warningDropPct: threshold('Amarillo con una caída mayor a este % de la base.'),
      criticalDropPct: threshold('Rojo con una caída mayor a este % de la base.'),
      baselineWindowDays: days('Días anteriores al último CMJ que forman la base.'),
      minBaselineSamples: days('Días con CMJ necesarios dentro de la base.'),
      maxMeasurementAgeDays: days('El último CMJ se ignora pasada esta antigüedad (días).'),
    })
    .meta({ id: 'CmjDropParams' }),
  growth_peak: z
    .strictObject({
      warningAtOrAboveCmYear: threshold('Amarillo desde esta velocidad de crecimiento (cm/año).'),
      criticalAtOrAboveCmYear: threshold('Rojo desde esta velocidad de crecimiento (cm/año).'),
      maxMeasurementAgeDays: days('La velocidad se ignora pasada esta antigüedad (días).'),
    })
    .meta({ id: 'GrowthPeakParams' }),
} as const satisfies Record<(typeof ALERT_RULE_KINDS)[number], z.ZodType>;

/** Any kind's params (the `PATCH` sends the params of the rule's kind). */
export const alertRuleParamsSchema = z.union([
  alertRuleParamsSchemas.acwr_high,
  alertRuleParamsSchemas.acwr_low,
  alertRuleParamsSchemas.wellness_low,
  alertRuleParamsSchemas.wellness_zscore_low,
  alertRuleParamsSchemas.cmj_drop,
  alertRuleParamsSchemas.growth_peak,
]);

export const alertRuleScopeSchema = z
  .strictObject({
    sports: z.array(sportSchema).min(1).optional(),
    sexes: z.array(sexSchema).min(1).optional(),
    stages: z.array(stageSchema).min(1).optional(),
  })
  .meta({
    id: 'AlertRuleScope',
    description:
      'A quién aplica: tienen que coincidir todas las dimensiones presentes; una dimensión ausente es "todos".',
  });

const ruleFields = {
  id: alertRuleIdSchema,
  code: alertRuleCodeSchema,
  enabled: z.boolean(),
  appliesTo: alertRuleScopeSchema,
  isDefault: z.boolean().meta({
    description: 'Es una de las reglas sembradas por defecto (su código), editada o no.',
  }),
  createdAt: dateTimeSchema,
  updatedAt: dateTimeSchema,
  version: resourceVersionSchema,
};

export const alertRuleSchema = z
  .discriminatedUnion('kind', [
    z.object({
      ...ruleFields,
      kind: z.literal('acwr_high'),
      params: alertRuleParamsSchemas.acwr_high,
    }),
    z.object({
      ...ruleFields,
      kind: z.literal('acwr_low'),
      params: alertRuleParamsSchemas.acwr_low,
    }),
    z.object({
      ...ruleFields,
      kind: z.literal('wellness_low'),
      params: alertRuleParamsSchemas.wellness_low,
    }),
    z.object({
      ...ruleFields,
      kind: z.literal('wellness_zscore_low'),
      params: alertRuleParamsSchemas.wellness_zscore_low,
    }),
    z.object({
      ...ruleFields,
      kind: z.literal('cmj_drop'),
      params: alertRuleParamsSchemas.cmj_drop,
    }),
    z.object({
      ...ruleFields,
      kind: z.literal('growth_peak'),
      params: alertRuleParamsSchemas.growth_peak,
    }),
  ])
  .meta({ id: 'AlertRule' });

export type AlertRuleDto = z.output<typeof alertRuleSchema>;

const createFields = {
  clientUuid: clientUuidSchema.optional(),
  code: alertRuleCodeSchema,
  enabled: z.boolean().optional().meta({ description: 'Por defecto, `true`.' }),
  appliesTo: alertRuleScopeSchema.optional(),
};

const createAlertRuleBody = z.discriminatedUnion('kind', [
  z.strictObject({
    ...createFields,
    kind: z.literal('acwr_high'),
    params: alertRuleParamsSchemas.acwr_high,
  }),
  z.strictObject({
    ...createFields,
    kind: z.literal('acwr_low'),
    params: alertRuleParamsSchemas.acwr_low,
  }),
  z.strictObject({
    ...createFields,
    kind: z.literal('wellness_low'),
    params: alertRuleParamsSchemas.wellness_low,
  }),
  z.strictObject({
    ...createFields,
    kind: z.literal('wellness_zscore_low'),
    params: alertRuleParamsSchemas.wellness_zscore_low,
  }),
  z.strictObject({
    ...createFields,
    kind: z.literal('cmj_drop'),
    params: alertRuleParamsSchemas.cmj_drop,
  }),
  z.strictObject({
    ...createFields,
    kind: z.literal('growth_peak'),
    params: alertRuleParamsSchemas.growth_peak,
  }),
]);

const alertRuleParams = z.strictObject({ alertRuleId: alertRuleIdSchema });

export const listAlertRules = defineEndpoint({
  method: 'GET',
  path: '/v1/configuration/alert-rules',
  summary: 'Reglas de alerta del club',
  description:
    'Lectura: `coach`, `sc`, `medical` y la administración. Son heurísticas de monitoreo de carga, no predicen lesiones ni diagnostican.',
  tags: ['configuration'],
  auth: 'club',
  query: pageQuerySchema.extend({
    kind: alertRuleKindSchema.optional(),
    enabled: z
      .enum(['true', 'false'])
      .optional()
      .meta({ description: 'Solo las activas (`true`) o las desactivadas (`false`).' }),
    sort: sortQuerySchema(['code', 'createdAt'], 'code'),
  }),
  response: {
    status: 200,
    description: 'Página de reglas.',
    schema: pageOf(alertRuleSchema).meta({ id: 'AlertRulePage' }),
  },
  errors: ['bad_request'],
});

export const getAlertRule = defineEndpoint({
  method: 'GET',
  path: '/v1/configuration/alert-rules/{alertRuleId}',
  summary: 'Una regla de alerta',
  tags: ['configuration'],
  auth: 'club',
  params: alertRuleParams,
  response: { status: 200, description: 'La regla.', schema: alertRuleSchema },
  errors: ['not_found'],
});

export const createAlertRule = defineEndpoint({
  method: 'POST',
  path: '/v1/configuration/alert-rules',
  summary: 'Crear una regla de alerta',
  description:
    'Solo `sc` y la administración. El dominio valida la regla (umbrales por severidad, el rojo al menos tan estricto como el amarillo, ventanas y muestras). Código repetido: `conflict`. Idempotente por `clientUuid`.',
  tags: ['configuration'],
  auth: 'club',
  body: createAlertRuleBody,
  response: { status: 201, description: 'Regla creada.', schema: alertRuleSchema },
  errors: ['conflict'],
});

export const updateAlertRule = defineEndpoint({
  method: 'PATCH',
  path: '/v1/configuration/alert-rules/{alertRuleId}',
  summary: 'Editar una regla de alerta',
  description:
    'Solo `sc` y la administración. Se cambian `enabled`, `appliesTo` (`null` = a todos) y `params` (completos, del tipo de la regla); el código y el tipo no. Las reglas no se borran (las alertas guardan su referencia): se desactivan. `version` desactualizada: `conflict`.',
  tags: ['configuration'],
  auth: 'club',
  params: alertRuleParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    enabled: z.boolean().optional(),
    appliesTo: alertRuleScopeSchema.nullable().optional(),
    params: alertRuleParamsSchema.optional(),
  }),
  response: { status: 200, description: 'La regla actualizada.', schema: alertRuleSchema },
  errors: ['not_found', 'conflict'],
});
