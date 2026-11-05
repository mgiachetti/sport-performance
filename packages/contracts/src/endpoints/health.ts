import { OPS_CHECK_CODES, OPS_CHECK_STATUSES } from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { dateTimeSchema } from '../primitives/dates.js';

export const healthSchema = z
  .object({
    status: z.literal('ok'),
    version: z
      .string()
      .min(1)
      .meta({
        description: 'Versión desplegada (semver o sha del commit).',
        examples: ['a1b2c3d'],
      }),
    time: dateTimeSchema.meta({ description: 'Hora del servidor (UTC).' }),
  })
  .meta({ id: 'Health', description: 'El servicio está vivo y sus dependencias responden.' });

export type Health = z.output<typeof healthSchema>;

export const getHealth = defineEndpoint({
  method: 'GET',
  path: '/v1/health',
  summary: 'Estado del servicio',
  description:
    'Lo usan Railway y los monitores. Responde `503 service_unavailable` si una dependencia (base de datos) no responde.',
  tags: ['system'],
  auth: 'public',
  response: { status: 200, description: 'Servicio operativo.', schema: healthSchema },
  errors: ['service_unavailable'],
  skipAppVersionCheck: true,
});

const opsCheckStatusSchema = z.enum(OPS_CHECK_STATUSES);

/**
 * `GET /health/ops` (B-703, ADR 0095): the operational checks for an uptime
 * monitor, outside `/v1` like the other probes and behind its own token.
 * Platform-wide counts and ages only: never a club, a person or health data.
 */
export const opsHealthSchema = z
  .object({
    status: opsCheckStatusSchema.meta({
      description: 'El peor estado de los chequeos: `critical` responde 503.',
    }),
    version: z.string().min(1),
    time: dateTimeSchema,
    workerCheckedAt: dateTimeSchema
      .nullable()
      .meta({ description: 'Última pasada del monitor del worker; `null` si nunca reportó.' }),
    checks: z.array(
      z.object({
        code: z.enum(OPS_CHECK_CODES),
        status: opsCheckStatusSchema,
        value: z.number().nonnegative().nullable(),
        unit: z.enum(['s', 'n']),
        warning: z.number().nonnegative(),
        critical: z.number().nonnegative(),
        since: dateTimeSchema.nullable(),
        detail: z.record(z.string(), z.number()),
      }),
    ),
  })
  .meta({ id: 'OpsHealth', description: 'Chequeos operativos de la plataforma.' });

export type OpsHealth = z.output<typeof opsHealthSchema>;
