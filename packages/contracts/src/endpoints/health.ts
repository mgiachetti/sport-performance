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
});
