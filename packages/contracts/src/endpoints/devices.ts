import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  archiveStatusQuerySchema,
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
} from '../primitives/conventions.js';
import { dateTimeSchema } from '../primitives/dates.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { DEVICE_KINDS } from './test-day-sheet.js';
import { deviceIdSchema } from './tests.js';

/**
 * Measuring devices of the club (B-606, ADR 0076): the phones and tablets a
 * test is timed on and, in Phase 2, the shared hardware. A result names the
 * device it was measured with; tests compared only on the same device (the
 * reaction test) require it. A device is retired, never deleted: its results
 * keep pointing at it.
 */

export const DEVICE_LABEL_MAX_LENGTH = 60;
export const DEVICE_TEXT_MAX_LENGTH = 120;

const trimmed = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' });

export const deviceKindSchema = z.enum(DEVICE_KINDS).meta({
  id: 'DeviceKind',
  description:
    'Tipo de equipo: `phone` y `tablet` (la app), y el hardware compartido de la Fase 2 (`hr_band`, `photocell`, `reaction_lights`, `dynamometer`) y los pods de la Fase 3.',
});

export const deviceLabelSchema = trimmed(DEVICE_LABEL_MAX_LENGTH).meta({
  description: 'Cómo lo nombra el staff.',
  examples: ['Tablet del club 1'],
});

const deviceSerialNumberSchema = trimmed(DEVICE_TEXT_MAX_LENGTH).meta({
  description:
    'Número de serie. En un teléfono o tablet que usa la app, el id de instalación de la app en ese equipo: así el teléfono se reconoce en la lista. Único por tipo en el club.',
});

export const deviceSchema = z
  .object({
    id: deviceIdSchema,
    kind: deviceKindSchema,
    label: deviceLabelSchema,
    model: z.string().nullable().meta({ description: 'Marca y modelo, si se conocen.' }),
    serialNumber: z.string().nullable(),
    firmwareVersion: z
      .string()
      .nullable()
      .meta({ description: 'Versión del firmware o del sistema operativo.' }),
    retiredAt: dateTimeSchema
      .nullable()
      .meta({ description: 'Cuándo se retiró; `null` si está en uso.' }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'Device' });

export type Device = z.output<typeof deviceSchema>;

const deviceParams = z.strictObject({ deviceId: deviceIdSchema });

const READ_RULES =
  'Lo ve el staff (`coach`, `sc`, `medical`) y la administración de todo el club: no tiene datos personales.';
const MANAGE_RULES = 'Solo `sc` y la administración.';

export const listDevices = defineEndpoint({
  method: 'GET',
  path: '/v1/devices',
  summary: 'Equipos del club',
  description: `${READ_RULES} Por defecto, los que están en uso.`,
  tags: ['devices'],
  auth: 'club',
  query: pageQuerySchema.extend({
    kind: deviceKindSchema.optional(),
    serialNumber: deviceSerialNumberSchema.optional().meta({
      description: 'Solo el equipo con ese número de serie (un teléfono buscándose a sí mismo).',
    }),
    status: archiveStatusQuerySchema.meta({
      description: '`active` (en uso, por defecto), `archived` (retirados) o `all`.',
    }),
    sort: sortQuerySchema(['label', 'createdAt'], 'label'),
  }),
  response: {
    status: 200,
    description: 'Página de equipos.',
    schema: pageOf(deviceSchema).meta({ id: 'DevicePage' }),
  },
  errors: ['bad_request'],
});

export const getDevice = defineEndpoint({
  method: 'GET',
  path: '/v1/devices/{deviceId}',
  summary: 'Un equipo',
  description: `${READ_RULES} También uno retirado.`,
  tags: ['devices'],
  auth: 'club',
  params: deviceParams,
  response: { status: 200, description: 'El equipo.', schema: deviceSchema },
  errors: ['not_found'],
});

export const registerDevice = defineEndpoint({
  method: 'POST',
  path: '/v1/devices',
  summary: 'Registrar un equipo',
  description: `${MANAGE_RULES} Idempotente por \`clientUuid\`. Un número de serie que ya tiene otro equipo del mismo tipo (en uso o retirado): \`conflict\`, con el id del existente en el detalle, para usarlo o restaurarlo en vez de duplicarlo.`,
  tags: ['devices'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    kind: deviceKindSchema,
    label: deviceLabelSchema,
    model: trimmed(DEVICE_TEXT_MAX_LENGTH).optional(),
    serialNumber: deviceSerialNumberSchema.optional(),
    firmwareVersion: trimmed(DEVICE_TEXT_MAX_LENGTH).optional(),
  }),
  response: { status: 201, description: 'Equipo registrado.', schema: deviceSchema },
  errors: ['conflict'],
});

export const updateDevice = defineEndpoint({
  method: 'PATCH',
  path: '/v1/devices/{deviceId}',
  summary: 'Editar un equipo',
  description: `${MANAGE_RULES} Nombre, modelo y versión del firmware; el tipo y el número de serie no cambian (otro equipo es otro registro: sus resultados no se comparan con los de este). Un equipo retirado no se edita: se restaura primero (\`conflict\`). \`version\` desactualizada: \`conflict\`.`,
  tags: ['devices'],
  auth: 'club',
  params: deviceParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    label: deviceLabelSchema.optional(),
    model: trimmed(DEVICE_TEXT_MAX_LENGTH).nullable().optional(),
    firmwareVersion: trimmed(DEVICE_TEXT_MAX_LENGTH).nullable().optional(),
  }),
  response: { status: 200, description: 'El equipo actualizado.', schema: deviceSchema },
  errors: ['not_found', 'conflict'],
});

export const retireDevice = defineEndpoint({
  method: 'POST',
  path: '/v1/devices/{deviceId}/retire',
  summary: 'Retirar un equipo',
  description: `${MANAGE_RULES} Deja de ofrecerse para medir; sus resultados lo siguen nombrando. Idempotente.`,
  tags: ['devices'],
  auth: 'club',
  params: deviceParams,
  response: { status: 200, description: 'Equipo retirado.', schema: deviceSchema },
  errors: ['not_found'],
});

export const restoreDevice = defineEndpoint({
  method: 'POST',
  path: '/v1/devices/{deviceId}/restore',
  summary: 'Volver a usar un equipo',
  description: `${MANAGE_RULES} Idempotente.`,
  tags: ['devices'],
  auth: 'club',
  params: deviceParams,
  response: { status: 200, description: 'Equipo en uso.', schema: deviceSchema },
  errors: ['not_found'],
});
