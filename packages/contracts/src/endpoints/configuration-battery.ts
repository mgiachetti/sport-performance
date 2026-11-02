import { MAX_BATTERY_CADENCE_WEEKS, TEST_WINDOW_NUMBERS } from '@sport-performance/domain';
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
  stageSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import {
  VALIDITY_RULES_DESCRIPTION,
  closePreviousSchema,
  onDateQuerySchema,
  batteryTestCodeSchema,
  validFromSchema,
  validOnQuerySchema,
  validToSchema,
} from './configuration-common.js';

/**
 * Test battery of the club (B-322): which tests each group does, in which
 * windows (V1 to V4) and/or at which continuous cadence, by sport, sex,
 * stage and category, with validity.
 */

export const batteryEntryIdSchema = idOf('entrada de la batería');

export const batteryWindowSchema = z
  .int()
  .min(1)
  .max(TEST_WINDOW_NUMBERS.length)
  .meta({ description: 'Ventana de tests: 1 = V1 (febrero) … 4 = V4 (noviembre).' });

export const batteryWindowsSchema = z
  .array(batteryWindowSchema)
  .max(TEST_WINDOW_NUMBERS.length)
  .meta({ description: 'Ventanas en las que se hace el test, sin repetir. Vacío: solo cadencia.' });

export const batteryCadenceWeeksSchema = z
  .strictObject({
    min: z.int().min(1).max(MAX_BATTERY_CADENCE_WEEKS),
    max: z.int().min(1).max(MAX_BATTERY_CADENCE_WEEKS),
  })
  .meta({
    id: 'BatteryCadenceWeeks',
    description:
      'Programación continua: una medición cada `min` a `max` semanas (antropometría cada 4–6, CMJ semanal 1–1).',
  });

const scopeDescriptions = {
  sex: 'Rama; `null` = los dos sexos del deporte.',
  stage: 'Etapa del jugador/a (por maduración o fijada); `null` = todas.',
  categoryId: 'Categoría; `null` = todas las del deporte.',
} as const;

export const batteryEntrySchema = z
  .object({
    id: batteryEntryIdSchema,
    sport: sportSchema,
    sex: sexSchema.nullable().meta({ description: scopeDescriptions.sex }),
    stage: stageSchema.nullable().meta({ description: scopeDescriptions.stage }),
    categoryId: categoryIdSchema.nullable().meta({ description: scopeDescriptions.categoryId }),
    testCode: batteryTestCodeSchema,
    windows: batteryWindowsSchema,
    cadenceWeeks: batteryCadenceWeeksSchema.nullable(),
    validFrom: validFromSchema,
    validTo: validToSchema,
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'BatteryEntry' });

export type BatteryEntryDto = z.output<typeof batteryEntrySchema>;

const batteryEntryParams = z.strictObject({ batteryEntryId: batteryEntryIdSchema });

export const listBatteryEntries = defineEndpoint({
  method: 'GET',
  path: '/v1/configuration/battery',
  summary: 'Batería de tests del club',
  description:
    'Lectura: `coach`, `sc`, `medical` y la administración. Los filtros de alcance son exactos (`sex=male` no trae las filas para los dos sexos); para saber qué aplica a un grupo, `GET /v1/configuration/battery/effective`.',
  tags: ['configuration'],
  auth: 'club',
  query: pageQuerySchema.extend({
    sport: sportSchema.optional(),
    sex: sexSchema.optional(),
    stage: stageSchema.optional(),
    categoryId: categoryIdSchema.optional(),
    testCode: batteryTestCodeSchema.optional(),
    validOn: validOnQuerySchema,
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['testCode', 'validFrom', 'createdAt'], 'testCode'),
  }),
  response: {
    status: 200,
    description: 'Página de entradas de la batería.',
    schema: pageOf(batteryEntrySchema).meta({ id: 'BatteryEntryPage' }),
  },
  errors: ['bad_request'],
});

export const effectiveBatteryTestSchema = z
  .object({
    testCode: batteryTestCodeSchema,
    windows: batteryWindowsSchema,
    cadenceWeeks: batteryCadenceWeeksSchema.nullable(),
    entry: batteryEntrySchema.meta({ description: 'La entrada que manda para este test.' }),
  })
  .meta({ id: 'EffectiveBatteryTest' });

export const effectiveBatterySchema = z
  .object({
    sport: sportSchema,
    sex: sexSchema,
    stage: stageSchema,
    categoryId: categoryIdSchema.nullable(),
    onDate: localDateSchema,
    tests: z.array(effectiveBatteryTestSchema).meta({ description: 'Por código de test.' }),
  })
  .meta({ id: 'EffectiveBattery' });

export type EffectiveBattery = z.output<typeof effectiveBatterySchema>;

export const getEffectiveBattery = defineEndpoint({
  method: 'GET',
  path: '/v1/configuration/battery/effective',
  summary: 'Batería que le toca a un grupo',
  description:
    'Por test, la entrada vigente más específica para el deporte, el sexo, la etapa y la categoría (categoría > etapa > sexo > club). Sin `categoryId`, solo las entradas para todas las categorías. Mismo permiso que la lista.',
  tags: ['configuration'],
  auth: 'club',
  query: z.strictObject({
    sport: sportSchema,
    sex: sexSchema,
    stage: stageSchema,
    categoryId: categoryIdSchema.optional(),
    onDate: onDateQuerySchema,
  }),
  response: { status: 200, description: 'La batería resuelta.', schema: effectiveBatterySchema },
  errors: ['not_found'],
});

export const getBatteryEntry = defineEndpoint({
  method: 'GET',
  path: '/v1/configuration/battery/{batteryEntryId}',
  summary: 'Una entrada de la batería',
  tags: ['configuration'],
  auth: 'club',
  params: batteryEntryParams,
  response: { status: 200, description: 'La entrada.', schema: batteryEntrySchema },
  errors: ['not_found'],
});

export const createBatteryEntry = defineEndpoint({
  method: 'POST',
  path: '/v1/configuration/battery',
  summary: 'Programar un test para un grupo',
  description: `Solo \`sc\` y la administración. El test tiene que existir en el catálogo del club y aplicar al deporte; la categoría, ser del deporte (y del sexo, si se indica). Un test con cargas máximas solo con la etapa \`performance\` y una franja que las permita (principio 3). Al menos una ventana o una cadencia. ${VALIDITY_RULES_DESCRIPTION} Idempotente por \`clientUuid\`.`,
  tags: ['configuration'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    sport: sportSchema,
    sex: sexSchema.nullable().optional().meta({ description: scopeDescriptions.sex }),
    stage: stageSchema.nullable().optional().meta({ description: scopeDescriptions.stage }),
    categoryId: categoryIdSchema
      .nullable()
      .optional()
      .meta({ description: scopeDescriptions.categoryId }),
    testCode: batteryTestCodeSchema,
    windows: batteryWindowsSchema.optional(),
    cadenceWeeks: batteryCadenceWeeksSchema.nullable().optional(),
    validFrom: validFromSchema.optional().meta({ description: 'Por defecto, hoy en el club.' }),
    validTo: validToSchema.optional(),
    closePrevious: closePreviousSchema,
  }),
  response: { status: 201, description: 'Entrada creada.', schema: batteryEntrySchema },
  errors: ['conflict'],
});

export const updateBatteryEntry = defineEndpoint({
  method: 'PATCH',
  path: '/v1/configuration/battery/{batteryEntryId}',
  summary: 'Editar una entrada de la batería',
  description: `Solo \`sc\` y la administración. El alcance y el test no cambian. ${VALIDITY_RULES_DESCRIPTION} \`version\` desactualizada: \`conflict\`.`,
  tags: ['configuration'],
  auth: 'club',
  params: batteryEntryParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    windows: batteryWindowsSchema.optional(),
    cadenceWeeks: batteryCadenceWeeksSchema.nullable().optional(),
    validFrom: validFromSchema.optional(),
    validTo: validToSchema.optional(),
  }),
  response: { status: 200, description: 'La entrada actualizada.', schema: batteryEntrySchema },
  errors: ['not_found', 'conflict'],
});

export const archiveBatteryEntry = defineEndpoint({
  method: 'POST',
  path: '/v1/configuration/battery/{batteryEntryId}/archive',
  summary: 'Retirar una entrada que todavía no empezó',
  description:
    'Solo `sc` y la administración. Una entrada vigente o pasada no se archiva (`conflict`): se cierra con `validTo`. Idempotente.',
  tags: ['configuration'],
  auth: 'club',
  params: batteryEntryParams,
  response: { status: 200, description: 'Entrada archivada.', schema: batteryEntrySchema },
  errors: ['not_found', 'conflict'],
});

export const restoreBatteryEntry = defineEndpoint({
  method: 'POST',
  path: '/v1/configuration/battery/{batteryEntryId}/restore',
  summary: 'Restaurar una entrada archivada',
  description:
    'Solo `sc` y la administración. Tiene que seguir sin empezar; si ya pasó su inicio, si se superpone con otra del mismo alcance o si la categoría está archivada: `conflict`. Idempotente.',
  tags: ['configuration'],
  auth: 'club',
  params: batteryEntryParams,
  response: { status: 200, description: 'Entrada restaurada.', schema: batteryEntrySchema },
  errors: ['not_found', 'conflict'],
});
