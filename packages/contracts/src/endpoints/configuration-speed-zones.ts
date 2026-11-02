import { MAX_ABSOLUTE_ZONE_SPEED_MS, MAX_RELATIVE_ZONE_VMAX_PCT } from '@sport-performance/domain';
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
import {
  VALIDITY_RULES_DESCRIPTION,
  closePreviousSchema,
  configurationCodeSchema,
  onDateQuerySchema,
  validFromSchema,
  validOnQuerySchema,
  validToSchema,
} from './configuration-common.js';

/**
 * Speed zones of the club (B-209, B-322): absolute (m/s, comparable with the
 * first team's Catapult bands) and relative (% of the player's Vmax), scoped
 * by sport, sex or player, with validity. The domain validates every zone
 * set (`validateSpeedZoneSet`).
 */

/** Most zones a set may have (Catapult uses 5 to 8 velocity bands). */
export const SPEED_ZONES_MAX = 12;

export const speedZoneConfigIdSchema = idOf('configuración de zonas de velocidad');

export const speedZoneKindSchema = z.enum(['absolute', 'relative']).meta({
  id: 'SpeedZoneKind',
  description: '`absolute`: límites en m/s. `relative`: límites en % de la Vmax del jugador/a.',
});

const zoneCodeSchema = configurationCodeSchema.meta({
  description: 'Código de la zona (el texto sale de i18n o de la terminología del club).',
  examples: ['high_speed_running'],
});

const highSpeedZoneCodeSchema = configurationCodeSchema.meta({
  description:
    'Zona desde la que se cuenta alta velocidad (`hsr_abs_m` o `hsr_rel_m`); no puede ser la primera.',
});

export const absoluteSpeedZoneSetSchema = z
  .strictObject({
    kind: z.literal('absolute'),
    zones: z
      .array(
        z.strictObject({
          code: zoneCodeSchema,
          minSpeedMs: z
            .number()
            .min(0)
            .max(MAX_ABSOLUTE_ZONE_SPEED_MS)
            .meta({ description: 'Límite inferior (inclusive), m/s.' }),
        }),
      )
      .min(1)
      .max(SPEED_ZONES_MAX)
      .meta({ description: 'De menor a mayor; la primera empieza en 0.' }),
    highSpeedZoneCode: highSpeedZoneCodeSchema,
  })
  .meta({ id: 'AbsoluteSpeedZoneSet' });

export const relativeSpeedZoneSetSchema = z
  .strictObject({
    kind: z.literal('relative'),
    zones: z
      .array(
        z.strictObject({
          code: zoneCodeSchema,
          minVmaxPct: z
            .number()
            .min(0)
            .max(MAX_RELATIVE_ZONE_VMAX_PCT)
            .meta({ description: 'Límite inferior (inclusive), % de la Vmax.' }),
        }),
      )
      .min(1)
      .max(SPEED_ZONES_MAX)
      .meta({ description: 'De menor a mayor; la primera empieza en 0.' }),
    highSpeedZoneCode: highSpeedZoneCodeSchema,
  })
  .meta({ id: 'RelativeSpeedZoneSet' });

export const speedZoneSetSchema = z
  .discriminatedUnion('kind', [absoluteSpeedZoneSetSchema, relativeSpeedZoneSetSchema])
  .meta({ id: 'SpeedZoneSet' });

export const speedZoneConfigSchema = z
  .object({
    id: speedZoneConfigIdSchema,
    kind: speedZoneKindSchema,
    sport: sportSchema.nullable().meta({ description: '`null` = todos los deportes.' }),
    sex: sexSchema.nullable().meta({ description: '`null` = los dos sexos.' }),
    playerId: playerIdSchema
      .nullable()
      .meta({ description: 'Umbral propio de un jugador/a; `null` = un grupo.' }),
    zoneSet: speedZoneSetSchema,
    validFrom: validFromSchema,
    validTo: validToSchema,
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'SpeedZoneConfig' });

export type SpeedZoneConfigDto = z.output<typeof speedZoneConfigSchema>;

const speedZoneConfigParams = z.strictObject({ speedZoneConfigId: speedZoneConfigIdSchema });

export const listSpeedZoneConfigs = defineEndpoint({
  method: 'GET',
  path: '/v1/configuration/speed-zones',
  summary: 'Zonas de velocidad del club',
  description:
    'Lectura: `coach`, `sc`, `medical` y la administración; las filas de un jugador/a, solo si quien llama lo ve. Filtros de alcance exactos; `scope` separa las de grupo de las de jugador/a.',
  tags: ['configuration'],
  auth: 'club',
  query: pageQuerySchema.extend({
    kind: speedZoneKindSchema.optional(),
    sport: sportSchema.optional(),
    sex: sexSchema.optional(),
    playerId: playerIdSchema.optional(),
    scope: z
      .enum(['group', 'player'])
      .optional()
      .meta({ description: '`group`: sin jugador/a; `player`: umbrales individuales.' }),
    validOn: validOnQuerySchema,
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['validFrom', 'createdAt'], 'validFrom'),
  }),
  response: {
    status: 200,
    description: 'Página de configuraciones de zonas.',
    schema: pageOf(speedZoneConfigSchema).meta({ id: 'SpeedZoneConfigPage' }),
  },
  errors: ['bad_request'],
});

export const effectiveSpeedZonesSchema = z
  .object({
    kind: speedZoneKindSchema,
    onDate: localDateSchema,
    source: z.enum(['club', 'default']).meta({
      description:
        '`club`: una configuración del club; `default`: las zonas sembradas por defecto.',
    }),
    config: speedZoneConfigSchema
      .nullable()
      .meta({ description: 'La configuración que manda; `null` con `source = default`.' }),
    zoneSet: speedZoneSetSchema,
  })
  .meta({ id: 'EffectiveSpeedZones' });

export type EffectiveSpeedZones = z.output<typeof effectiveSpeedZonesSchema>;

export const getEffectiveSpeedZones = defineEndpoint({
  method: 'GET',
  path: '/v1/configuration/speed-zones/effective',
  summary: 'Zonas de velocidad que aplican',
  description:
    'La configuración vigente más específica (jugador/a > deporte > sexo > club) o, si no hay, las zonas por defecto. Con `playerId`, el jugador/a tiene que ser visible para quien llama y de ese sexo.',
  tags: ['configuration'],
  auth: 'club',
  query: z.strictObject({
    kind: speedZoneKindSchema,
    sport: sportSchema,
    sex: sexSchema,
    playerId: playerIdSchema.optional(),
    onDate: onDateQuerySchema,
  }),
  response: { status: 200, description: 'Las zonas resueltas.', schema: effectiveSpeedZonesSchema },
  errors: ['not_found'],
});

export const getSpeedZoneConfig = defineEndpoint({
  method: 'GET',
  path: '/v1/configuration/speed-zones/{speedZoneConfigId}',
  summary: 'Una configuración de zonas de velocidad',
  tags: ['configuration'],
  auth: 'club',
  params: speedZoneConfigParams,
  response: { status: 200, description: 'La configuración.', schema: speedZoneConfigSchema },
  errors: ['not_found'],
});

export const createSpeedZoneConfig = defineEndpoint({
  method: 'POST',
  path: '/v1/configuration/speed-zones',
  summary: 'Crear una configuración de zonas de velocidad',
  description: `Solo \`sc\` y la administración. Las zonas las valida el dominio: la primera empieza en 0, límites estrictamente crecientes, códigos únicos y la zona de alta velocidad existe y no es la primera. Para un jugador/a, tiene que ser visible para quien llama. ${VALIDITY_RULES_DESCRIPTION} Idempotente por \`clientUuid\`.`,
  tags: ['configuration'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    sport: sportSchema.nullable().optional(),
    sex: sexSchema.nullable().optional(),
    playerId: playerIdSchema.nullable().optional(),
    zoneSet: speedZoneSetSchema,
    validFrom: validFromSchema.optional().meta({ description: 'Por defecto, hoy en el club.' }),
    validTo: validToSchema.optional(),
    closePrevious: closePreviousSchema,
  }),
  response: { status: 201, description: 'Configuración creada.', schema: speedZoneConfigSchema },
  errors: ['conflict'],
});

export const updateSpeedZoneConfig = defineEndpoint({
  method: 'PATCH',
  path: '/v1/configuration/speed-zones/{speedZoneConfigId}',
  summary: 'Editar una configuración de zonas de velocidad',
  description: `Solo \`sc\` y la administración. El alcance y el tipo (\`kind\`) no cambian. ${VALIDITY_RULES_DESCRIPTION} \`version\` desactualizada: \`conflict\`.`,
  tags: ['configuration'],
  auth: 'club',
  params: speedZoneConfigParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    zoneSet: speedZoneSetSchema.optional(),
    validFrom: validFromSchema.optional(),
    validTo: validToSchema.optional(),
  }),
  response: {
    status: 200,
    description: 'La configuración actualizada.',
    schema: speedZoneConfigSchema,
  },
  errors: ['not_found', 'conflict'],
});

export const archiveSpeedZoneConfig = defineEndpoint({
  method: 'POST',
  path: '/v1/configuration/speed-zones/{speedZoneConfigId}/archive',
  summary: 'Retirar una configuración que todavía no empezó',
  description:
    'Solo `sc` y la administración. Una vigente o pasada no se archiva (`conflict`): se cierra con `validTo`, así las sesiones ya calculadas conservan sus zonas. Idempotente.',
  tags: ['configuration'],
  auth: 'club',
  params: speedZoneConfigParams,
  response: { status: 200, description: 'Configuración archivada.', schema: speedZoneConfigSchema },
  errors: ['not_found', 'conflict'],
});

export const restoreSpeedZoneConfig = defineEndpoint({
  method: 'POST',
  path: '/v1/configuration/speed-zones/{speedZoneConfigId}/restore',
  summary: 'Restaurar una configuración archivada',
  description:
    'Solo `sc` y la administración. Tiene que seguir sin empezar; si ya pasó su inicio o se superpone con otra del mismo alcance: `conflict`. Idempotente.',
  tags: ['configuration'],
  auth: 'club',
  params: speedZoneConfigParams,
  response: {
    status: 200,
    description: 'Configuración restaurada.',
    schema: speedZoneConfigSchema,
  },
  errors: ['not_found', 'conflict'],
});
