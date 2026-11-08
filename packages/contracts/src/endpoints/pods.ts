import {
  POD_ASSIGNMENT_NOTE_MAX_LENGTH,
  POD_CHIP_ID_PATTERN,
  POD_HARDWARE_REVISION_PATTERN,
  POD_LABEL_MAX_LENGTH,
  POD_NUMBER_MAX,
  POD_NUMBER_MIN,
  POD_PROVISIONING_STATES,
  POD_SERIAL_PATTERN,
  POD_SHORT_ID_MAX,
  POD_SHORT_ID_MIN,
  POD_STATUSES,
  normalizePodSerial,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import {
  categoryIdSchema,
  clubIdSchema,
  idOf,
  playerIdSchema,
  slugSchema,
  userIdSchema,
} from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { changeReasonSchema } from './change-history.js';
import { consentTypeSchema } from './consents.js';
import { playerNameSchema } from './players.js';
import { trainingSessionIdSchema } from './training.js';

/**
 * The pod fleet and its assignment to players (B-912, ADR 0106).
 *
 * - The registry of devices is the superadmin's (`/v1/pod-devices`, no club):
 *   serial number, chip id and hardware revision, and the club that owns it.
 * - The club's fleet (`/v1/pods`): S&C and the administration register the
 *   club's devices as pods (number on the vest, short id in the network),
 *   mark them lost or stolen (keys revoked), recover, retire and lend them;
 *   the coach reads it to assign.
 * - Assignments (`/v1/pod-assignments`): which player wears which pod and
 *   when. Never two at once for the same pod nor player (`409`), only with
 *   the player's `data` and `location` consents (`403 consent_required`),
 *   only in the categories with pods. Synced offline: an offline create that
 *   overlaps is rejected with its `409`, never resolved by "last writer wins".
 */

// ─── Primitives ──────────────────────────────────────────────────────────────────────

export const podIdSchema = idOf('pod');
export const podDeviceIdSchema = idOf('dispositivo de pod');
export const podLoanIdSchema = idOf('préstamo de pod');
export const podAssignmentIdSchema = idOf('asignación de pod');

export const podStatusSchema = z.enum(POD_STATUSES).meta({
  id: 'PodStatus',
  description:
    '`active` (en la flota, se puede asignar), `lent` (prestado a otro club), `lost` o `stolen` (sus claves están revocadas) y `retired` (fuera de la flota; también el pod que el club tuvo por un préstamo, cuando termina).',
});

export const podProvisioningStateSchema = z.enum(POD_PROVISIONING_STATES).meta({
  id: 'PodProvisioningState',
  description:
    '`unprovisioned` (de fábrica), `provisioned` (con firmware e identidad cargados) o `decommissioned` (fuera de uso).',
});

export const podSerialNumberSchema = z
  .string()
  .min(1)
  .max(64)
  .transform(normalizePodSerial)
  .pipe(z.string().regex(POD_SERIAL_PATTERN))
  .meta({
    description:
      'Número de serie grabado en el pod y en su QR (4 a 32 caracteres: mayúsculas, dígitos y guiones internos). Se normaliza a mayúsculas.',
    examples: ['SPP-0001'],
  });

const podChipIdSchema = z
  .string()
  .regex(POD_CHIP_ID_PATTERN)
  .meta({
    description: 'Id del chip (FICR `DEVICEID`, 8 bytes en 16 dígitos hex en minúscula).',
    examples: ['0123456789abcdef'],
  });

const podHardwareRevisionSchema = z
  .string()
  .regex(POD_HARDWARE_REVISION_PATTERN)
  .meta({
    description: 'Revisión del hardware (`v0`, `v1.2`).',
    examples: ['v0'],
  });

export const podNumberSchema = z
  .int()
  .min(POD_NUMBER_MIN)
  .max(POD_NUMBER_MAX)
  .meta({
    description: `Número pintado en el pod y en su chaleco (${String(POD_NUMBER_MIN)} a ${String(POD_NUMBER_MAX)}), único entre los pods del club que no están retirados.`,
  });

const podShortIdSchema = z
  .int()
  .min(POD_SHORT_ID_MIN)
  .max(POD_SHORT_ID_MAX)
  .meta({
    description: `Id corto del pod en la red LoRa del club (${String(POD_SHORT_ID_MIN)} a ${String(POD_SHORT_ID_MAX)}), único entre los pods del club que no están retirados.`,
  });

const podLabelSchema = z
  .string()
  .min(1)
  .max(POD_LABEL_MAX_LENGTH)
  .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' })
  .meta({ description: 'Etiqueta libre del staff ("Repuesto").' });

const podAssignmentNoteSchema = z
  .string()
  .min(1)
  .max(POD_ASSIGNMENT_NOTE_MAX_LENGTH)
  .refine((value) => value === value.trim(), { message: 'No leading or trailing whitespace' })
  .meta({ description: 'Nota del staff ("cambió de chaleco en el entretiempo").' });

// ─── Devices (registry) ──────────────────────────────────────────────────────────────

export const podDeviceSchema = z
  .object({
    id: podDeviceIdSchema,
    serialNumber: z.string(),
    chipId: z.string(),
    hardwareRevision: z.string(),
    provisioningState: podProvisioningStateSchema,
    ownerClubId: clubIdSchema.nullable().meta({ description: 'Club dueño; `null` en stock.' }),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'PodDevice' });

export type PodDevice = z.output<typeof podDeviceSchema>;

const REGISTRY_RULES =
  'Solo superadmin, sin club (registro global, con `X-Support-Reason`). Los clubes ven sus dispositivos a través de sus pods.';

export const listPodDevices = defineEndpoint({
  method: 'GET',
  path: '/v1/pod-devices',
  summary: 'Registro de dispositivos de pod',
  description: `${REGISTRY_RULES} Por número de serie.`,
  tags: ['pods'],
  auth: 'session',
  query: pageQuerySchema.extend({
    serialNumber: podSerialNumberSchema.optional().meta({
      description: 'Solo el dispositivo con ese número de serie (leído del QR).',
    }),
    ownerClubId: clubIdSchema.optional().meta({ description: 'Solo los de ese club.' }),
    sort: sortQuerySchema(['serialNumber', 'createdAt'], 'serialNumber'),
  }),
  response: {
    status: 200,
    description: 'Página de dispositivos.',
    schema: pageOf(podDeviceSchema).meta({ id: 'PodDevicePage' }),
  },
  errors: ['bad_request', 'forbidden'],
});

export const registerPodDevice = defineEndpoint({
  method: 'POST',
  path: '/v1/pod-devices',
  summary: 'Registrar un dispositivo de pod',
  description: `${REGISTRY_RULES} Lo hace la estación de programación al grabar el pod. Idempotente por \`clientUuid\`. Número de serie o id de chip repetido: \`conflict\`.`,
  tags: ['pods'],
  auth: 'session',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    serialNumber: podSerialNumberSchema,
    chipId: podChipIdSchema,
    hardwareRevision: podHardwareRevisionSchema,
    provisioningState: podProvisioningStateSchema.optional().meta({
      description: 'Por defecto, `unprovisioned`.',
    }),
    ownerClubId: clubIdSchema.nullable().optional(),
  }),
  response: { status: 201, description: 'Dispositivo registrado.', schema: podDeviceSchema },
  errors: ['conflict', 'forbidden'],
});

export const updatePodDevice = defineEndpoint({
  method: 'PATCH',
  path: '/v1/pod-devices/{podDeviceId}',
  summary: 'Editar un dispositivo de pod',
  description: `${REGISTRY_RULES} Club dueño, estado de aprovisionamiento y revisión del hardware; el número de serie y el id de chip no cambian. \`version\` desactualizada: \`conflict\`.`,
  tags: ['pods'],
  auth: 'session',
  params: z.strictObject({ podDeviceId: podDeviceIdSchema }),
  body: z.strictObject({
    version: expectedVersionSchema,
    hardwareRevision: podHardwareRevisionSchema.optional(),
    provisioningState: podProvisioningStateSchema.optional(),
    ownerClubId: clubIdSchema.nullable().optional(),
  }),
  response: { status: 200, description: 'El dispositivo actualizado.', schema: podDeviceSchema },
  errors: ['not_found', 'conflict', 'forbidden'],
});

// ─── Pods of the club ────────────────────────────────────────────────────────────────

export const podHealthSchema = z
  .object({
    lastSeenAt: dateTimeSchema.nullable().meta({ description: 'Última vez que lo vio una base.' }),
    reportedAt: dateTimeSchema.nullable().meta({ description: 'Cuándo informó esta salud.' }),
    batteryCycles: z.int().nullable().meta({ description: 'Ciclos de la batería (MAX17048).' }),
    batteryCapacityPct: z
      .number()
      .nullable()
      .meta({ description: 'Capacidad estimada de la batería, en % de la nominal.' }),
    nandBadBlocks: z.int().nullable().meta({ description: 'Bloques malos de la NAND.' }),
    firmwareVersion: z.string().nullable(),
    gnssFirmwareVersion: z.string().nullable(),
  })
  .meta({
    id: 'PodHealth',
    description: 'Lo último que informó la base en una conexión; `null` mientras no informó.',
  });

export const podSchema = z
  .object({
    id: podIdSchema,
    deviceId: podDeviceIdSchema,
    serialNumber: z.string().meta({ description: 'Número de serie del dispositivo (QR).' }),
    hardwareRevision: z.string(),
    number: podNumberSchema,
    shortId: podShortIdSchema,
    label: z.string().nullable(),
    status: podStatusSchema,
    statusChangedAt: dateTimeSchema,
    keyEpoch: z.int().nonnegative().meta({
      description:
        'Época de las claves del pod: un pod recuperado o devuelto se vuelve a aprovisionar con la siguiente.',
    }),
    keysRevokedAt: dateTimeSchema
      .nullable()
      .meta({ description: 'Cuándo se revocaron sus claves (perdido o robado).' }),
    borrowedFromClubId: clubIdSchema
      .nullable()
      .meta({ description: 'Club que lo prestó, si el club lo tiene por un préstamo.' }),
    health: podHealthSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'Pod' });

export type Pod = z.output<typeof podSchema>;

const podParams = z.strictObject({ podId: podIdSchema });

const FLEET_READ = 'Lo ven el `coach`, el `sc` y la administración (para asignar).';
const FLEET_MANAGE = 'Solo `sc` y la administración.';

export const POD_LIST_STATUSES = ['in_fleet', 'all', ...POD_STATUSES] as const;

export const listPods = defineEndpoint({
  method: 'GET',
  path: '/v1/pods',
  summary: 'Flota de pods del club',
  description: `${FLEET_READ} Por defecto, los de la flota (todos menos los retirados), por número.`,
  tags: ['pods'],
  auth: 'club',
  query: pageQuerySchema.extend({
    status: z.enum(POD_LIST_STATUSES).default('in_fleet').meta({
      description: '`in_fleet` (todos menos `retired`, por defecto), `all` o un estado.',
    }),
    serialNumber: podSerialNumberSchema.optional().meta({
      description: 'Solo el pod de ese número de serie (leído del QR).',
    }),
    sort: sortQuerySchema(['number', 'createdAt'], 'number'),
  }),
  response: {
    status: 200,
    description: 'Página de pods.',
    schema: pageOf(podSchema).meta({ id: 'PodPage' }),
  },
  errors: ['bad_request'],
});

export const getPod = defineEndpoint({
  method: 'GET',
  path: '/v1/pods/{podId}',
  summary: 'Un pod',
  description: FLEET_READ,
  tags: ['pods'],
  auth: 'club',
  params: podParams,
  response: { status: 200, description: 'El pod.', schema: podSchema },
  errors: ['not_found'],
});

export const registerPod = defineEndpoint({
  method: 'POST',
  path: '/v1/pods',
  summary: 'Sumar un pod a la flota',
  description: `${FLEET_MANAGE} Un dispositivo del club (por su número de serie, leído del QR), con el número de su chaleco. El id corto, por defecto el más bajo libre de la red del club. Idempotente por \`clientUuid\`. Serie que no es del club: \`not_found\`; ya en la flota, número o id corto ocupado: \`conflict\`.`,
  tags: ['pods'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    serialNumber: podSerialNumberSchema,
    number: podNumberSchema,
    shortId: podShortIdSchema.optional(),
    label: podLabelSchema.optional(),
  }),
  response: { status: 201, description: 'Pod en la flota.', schema: podSchema },
  errors: ['not_found', 'conflict'],
});

export const updatePod = defineEndpoint({
  method: 'PATCH',
  path: '/v1/pods/{podId}',
  summary: 'Editar un pod',
  description: `${FLEET_MANAGE} Etiqueta, número y id corto. Cambiar el número o el id corto pide \`changeReason\` (cambia a quién se atribuyen los datos). Un pod retirado no se edita. \`version\` desactualizada, número u id corto ocupado: \`conflict\`.`,
  tags: ['pods'],
  auth: 'club',
  params: podParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    changeReason: changeReasonSchema.optional(),
    number: podNumberSchema.optional(),
    shortId: podShortIdSchema.optional(),
    label: podLabelSchema.nullable().optional(),
  }),
  response: { status: 200, description: 'El pod actualizado.', schema: podSchema },
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const markPodMissing = defineEndpoint({
  method: 'POST',
  path: '/v1/pods/{podId}/missing',
  summary: 'Marcar un pod perdido o robado',
  description: `${FLEET_MANAGE} Revoca sus claves (la base deja de aceptarlo y se rotan las de baliza en la próxima conexión) y termina su asignación en curso; las que no empezaron se anulan. Idempotente con el mismo estado. Un pod prestado, retirado o de un préstamo recibido: \`conflict\`.`,
  tags: ['pods'],
  auth: 'club',
  params: podParams,
  body: z.strictObject({
    status: z.enum(['lost', 'stolen']),
  }),
  response: { status: 200, description: 'El pod, perdido o robado.', schema: podSchema },
  errors: ['not_found', 'conflict'],
});

export const recoverPod = defineEndpoint({
  method: 'POST',
  path: '/v1/pods/{podId}/recover',
  summary: 'Recuperar un pod perdido o robado',
  description: `${FLEET_MANAGE} Vuelve a la flota con la época de claves siguiente: hay que aprovisionarlo de nuevo antes de usarlo. Idempotente.`,
  tags: ['pods'],
  auth: 'club',
  params: podParams,
  response: { status: 200, description: 'El pod, activo.', schema: podSchema },
  errors: ['not_found', 'conflict'],
});

export const retirePod = defineEndpoint({
  method: 'POST',
  path: '/v1/pods/{podId}/retire',
  summary: 'Retirar un pod de la flota',
  description: `${FLEET_MANAGE} Libera su número y su id corto; sus asignaciones pasadas quedan. Asignado ahora o más adelante, prestado o de un préstamo recibido: \`conflict\`. Idempotente.`,
  tags: ['pods'],
  auth: 'club',
  params: podParams,
  response: { status: 200, description: 'El pod, retirado.', schema: podSchema },
  errors: ['not_found', 'conflict'],
});

// ─── Categories with pods ────────────────────────────────────────────────────────────

export const podCategorySchema = z
  .object({
    categoryId: categoryIdSchema,
    podsEnabled: z.boolean(),
  })
  .meta({ id: 'PodCategory' });

export const listPodCategories = defineEndpoint({
  method: 'GET',
  path: '/v1/pods/categories',
  summary: 'Categorías con pods',
  description: `${FLEET_READ} Cada categoría activa del club y si sus jugadores pueden tener pod (por defecto, M19).`,
  tags: ['pods'],
  auth: 'club',
  response: {
    status: 200,
    description: 'Las categorías activas.',
    schema: z.object({ items: z.array(podCategorySchema) }).meta({ id: 'PodCategoryList' }),
  },
  errors: [],
});

export const setPodCategory = defineEndpoint({
  method: 'PUT',
  path: '/v1/pods/categories/{categoryId}',
  summary: 'Habilitar o no los pods en una categoría',
  description:
    'Solo la administración. Las asignaciones ya hechas quedan; las nuevas siguen la configuración.',
  tags: ['pods'],
  auth: 'club',
  params: z.strictObject({ categoryId: categoryIdSchema }),
  body: z.strictObject({ podsEnabled: z.boolean() }),
  response: { status: 200, description: 'La categoría.', schema: podCategorySchema },
  errors: ['not_found', 'conflict'],
});

// ─── Loans ───────────────────────────────────────────────────────────────────────────

export const podLoanSchema = z
  .object({
    id: podLoanIdSchema,
    podId: podIdSchema,
    borrowerClubId: clubIdSchema,
    startsAt: dateTimeSchema,
    plannedEndsAt: dateTimeSchema.nullable(),
    endedAt: dateTimeSchema.nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  })
  .meta({ id: 'PodLoan' });

export type PodLoan = z.output<typeof podLoanSchema>;

export const listPodLoans = defineEndpoint({
  method: 'GET',
  path: '/v1/pod-loans',
  summary: 'Préstamos de pods del club',
  description: `${FLEET_MANAGE} Los que el club hizo a otros clubes, los más recientes primero. Por defecto, los abiertos.`,
  tags: ['pods'],
  auth: 'club',
  query: pageQuerySchema.extend({
    status: z.enum(['open', 'all']).default('open'),
    sort: sortQuerySchema(['startsAt'], 'startsAt'),
  }),
  response: {
    status: 200,
    description: 'Página de préstamos.',
    schema: pageOf(podLoanSchema).meta({ id: 'PodLoanPage' }),
  },
  errors: ['bad_request'],
});

export const lendPod = defineEndpoint({
  method: 'POST',
  path: '/v1/pods/{podId}/loans',
  summary: 'Prestar un pod a otro club',
  description: `${FLEET_MANAGE} El club que lo recibe tiene un pod propio por el préstamo (el mismo número, el id corto más bajo libre de su red) y los datos que genere son suyos; el del club queda \`lent\`. Solo un pod activo del club, sin asignaciones de ahora en adelante. Idempotente por \`clientUuid\`. Club desconocido: \`not_found\`; pod no disponible o número ocupado en el otro club: \`conflict\`.`,
  tags: ['pods'],
  auth: 'club',
  params: podParams,
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    borrowerClubSlug: slugSchema.meta({ description: 'Slug del club que lo recibe.' }),
    plannedEndsAt: dateTimeSchema.optional(),
  }),
  response: { status: 201, description: 'El préstamo.', schema: podLoanSchema },
  errors: ['not_found', 'conflict'],
});

export const endPodLoan = defineEndpoint({
  method: 'POST',
  path: '/v1/pod-loans/{podLoanId}/end',
  summary: 'Terminar un préstamo',
  description: `${FLEET_MANAGE} El pod del otro club se retira (sus asignaciones terminan ahora) y el del club vuelve a la flota con la época de claves siguiente. Idempotente.`,
  tags: ['pods'],
  auth: 'club',
  params: z.strictObject({ podLoanId: podLoanIdSchema }),
  response: { status: 200, description: 'El préstamo terminado.', schema: podLoanSchema },
  errors: ['not_found'],
});

// ─── Assignments ─────────────────────────────────────────────────────────────────────

export const podAssignmentSchema = z
  .object({
    id: podAssignmentIdSchema,
    clientUuid: clientUuidSchema,
    podId: podIdSchema,
    podNumber: podNumberSchema
      .nullable()
      .meta({ description: 'Número del pod; `null` para quien no ve la flota (el jugador).' }),
    playerId: playerIdSchema,
    trainingSessionId: trainingSessionIdSchema.nullable(),
    startsAt: dateTimeSchema,
    endsAt: dateTimeSchema
      .nullable()
      .meta({ description: 'Fin (exclusivo); `null` mientras lo tiene puesto.' }),
    note: z.string().nullable(),
    reprocessRequestedAt: dateTimeSchema.nullable().meta({
      description:
        'Una corrección o una anulación cambió a quién pertenecen los datos: el sistema reprocesa las sesiones afectadas.',
    }),
    archivedAt: dateTimeSchema
      .nullable()
      .meta({ description: 'Anulada (cargada por error): no cuenta.' }),
    createdBy: userIdSchema.nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'PodAssignment' });

export type PodAssignment = z.output<typeof podAssignmentSchema>;

const assignmentParams = z.strictObject({ podAssignmentId: podAssignmentIdSchema });

const ASSIGN_RULES =
  'El `coach` y el `sc` de la categoría del jugador y la administración, con los consentimientos `data` y `location` (vigente sobre el texto actual) del jugador: si falta, `consent_required`.';
const CONFLICTS =
  'Choque con otra asignación del mismo pod o del mismo jugador: `conflict` con el detalle `pod_overlap` o `player_overlap` (y el id de la otra en el mensaje); pod que no está activo: `pod_not_active`; categoría sin pods: `category_not_enabled`.';

export const listPodAssignments = defineEndpoint({
  method: 'GET',
  path: '/v1/pod-assignments',
  summary: 'Asignaciones de pods',
  description:
    'El jugador las suyas; el `coach` y el `sc` las de sus jugadores asignados; la administración, todas. Nunca el tutor ni el staff médico. Por sesión, por día del club, por pod o por jugador; las vigentes primero por inicio.',
  tags: ['pods'],
  auth: 'club',
  query: pageQuerySchema.extend({
    trainingSessionId: trainingSessionIdSchema.optional(),
    on: localDateSchema
      .optional()
      .meta({ description: 'Las que se superponen con ese día del club.' }),
    podId: podIdSchema.optional(),
    playerId: playerIdSchema.optional(),
    status: z.enum(['live', 'all']).default('live').meta({
      description: '`live` (sin las anuladas, por defecto) o `all`.',
    }),
    sort: sortQuerySchema(['startsAt'], 'startsAt'),
  }),
  response: {
    status: 200,
    description: 'Página de asignaciones.',
    schema: pageOf(podAssignmentSchema).meta({ id: 'PodAssignmentPage' }),
  },
  errors: ['bad_request', 'not_found'],
});

export const getPodAssignment = defineEndpoint({
  method: 'GET',
  path: '/v1/pod-assignments/{podAssignmentId}',
  summary: 'Una asignación de pod',
  description: 'Quien puede leer las asignaciones del jugador.',
  tags: ['pods'],
  auth: 'club',
  params: assignmentParams,
  response: { status: 200, description: 'La asignación.', schema: podAssignmentSchema },
  errors: ['not_found'],
});

export const createPodAssignment = defineEndpoint({
  method: 'POST',
  path: '/v1/pod-assignments',
  summary: 'Asignar un pod a un jugador',
  description: `${ASSIGN_RULES} Desde \`startsAt\` (por defecto, ahora) hasta \`endsAt\` (exclusivo; sin él, hasta que se termine). Con \`trainingSessionId\`, la categoría de la sesión tiene que tener pods; sin ella, alguna categoría vigente del jugador. ${CONFLICTS} Idempotente por \`clientUuid\` (sin conexión, obligatorio).`,
  tags: ['pods'],
  auth: 'club',
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    podId: podIdSchema,
    playerId: playerIdSchema,
    trainingSessionId: trainingSessionIdSchema.optional(),
    startsAt: dateTimeSchema.optional(),
    endsAt: dateTimeSchema.optional(),
    note: podAssignmentNoteSchema.optional(),
  }),
  response: { status: 201, description: 'La asignación.', schema: podAssignmentSchema },
  errors: ['not_found', 'conflict', 'consent_required', 'validation_failed'],
});

export const endPodAssignment = defineEndpoint({
  method: 'POST',
  path: '/v1/pod-assignments/{podAssignmentId}/end',
  summary: 'Terminar una asignación',
  description: `Quien puede asignar (sin pedir el consentimiento: un consentimiento revocado nunca deja un pod asignado). En \`endsAt\` (por defecto, ahora). Una ya terminada o anulada: \`conflict\`.`,
  tags: ['pods'],
  auth: 'club',
  params: assignmentParams,
  body: z.strictObject({
    endsAt: dateTimeSchema.optional(),
  }),
  response: { status: 200, description: 'La asignación terminada.', schema: podAssignmentSchema },
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const correctPodAssignment = defineEndpoint({
  method: 'PATCH',
  path: '/v1/pod-assignments/{podAssignmentId}',
  summary: 'Corregir una asignación',
  description: `Quien puede asignar. Cambia el inicio, el fin o la nota; el pod y el jugador no (una equivocada se anula y se hace otra). Corregir el rango pide \`changeReason\` (queda en el historial) y marca la asignación para reprocesar las sesiones afectadas. ${CONFLICTS} \`version\` desactualizada: \`conflict\`.`,
  tags: ['pods'],
  auth: 'club',
  params: assignmentParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    changeReason: changeReasonSchema.optional(),
    startsAt: dateTimeSchema.optional(),
    endsAt: dateTimeSchema.nullable().optional(),
    note: podAssignmentNoteSchema.nullable().optional(),
  }),
  response: { status: 200, description: 'La asignación corregida.', schema: podAssignmentSchema },
  errors: ['not_found', 'conflict', 'validation_failed'],
});

export const voidPodAssignment = defineEndpoint({
  method: 'POST',
  path: '/v1/pod-assignments/{podAssignmentId}/void',
  summary: 'Anular una asignación',
  description:
    'Quien puede asignar. Una cargada por error (otro jugador, otro pod): deja de contar, con motivo en el historial, y se marca para reprocesar. Idempotente.',
  tags: ['pods'],
  auth: 'club',
  params: assignmentParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    changeReason: changeReasonSchema,
  }),
  response: { status: 200, description: 'La asignación anulada.', schema: podAssignmentSchema },
  errors: ['not_found', 'conflict'],
});

// ─── Pods of a session ───────────────────────────────────────────────────────────────

export const sessionPodPlayerSchema = z
  .object({
    playerId: playerIdSchema,
    firstName: playerNameSchema,
    lastName: playerNameSchema,
    missingConsents: z.array(consentTypeSchema).meta({
      description:
        'Consentimientos que le faltan para tener pod (`data`, `location`); vacío si puede.',
    }),
    canAssign: z.boolean().meta({
      description:
        'Si quien pide le puede asignar un pod ahora (matriz, consentimientos y categoría con pods).',
    }),
    assignment: podAssignmentSchema
      .nullable()
      .meta({ description: 'Su asignación vigente en la sesión, si tiene.' }),
  })
  .meta({ id: 'SessionPodPlayer' });

export type SessionPodPlayer = z.output<typeof sessionPodPlayerSchema>;

export const getSessionPods = defineEndpoint({
  method: 'GET',
  path: '/v1/training-sessions/{trainingSessionId}/pods',
  summary: 'Pods de una sesión',
  description:
    'Quien puede leer la sesión y las asignaciones de sus jugadores: los jugadores de la categoría de la sesión ese día (los que ve por asignación), cada uno con su consentimiento de ubicación y su asignación en la sesión, ordenados por apellido; y si la categoría tiene pods.',
  tags: ['pods'],
  auth: 'club',
  params: z.strictObject({ trainingSessionId: trainingSessionIdSchema }),
  response: {
    status: 200,
    description: 'Los pods de la sesión.',
    schema: z
      .object({
        podsEnabled: z.boolean().meta({ description: 'Si la categoría de la sesión tiene pods.' }),
        players: z.array(sessionPodPlayerSchema),
      })
      .meta({ id: 'SessionPods' }),
  },
  errors: ['not_found'],
});
