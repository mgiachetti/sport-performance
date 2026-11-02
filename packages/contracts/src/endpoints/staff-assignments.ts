import { STAFF_ASSIGNMENT_ROLES, STAFF_ASSIGNMENT_STATUSES } from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
  sportSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { membershipIdSchema, membershipRoleSchema } from './auth.js';

/**
 * Staff assignments (B-314): what each staff member sees. A coach to one or
 * more categories, an S&C coach to several, a medical staff member to a
 * whole sport; the permission matrix scopes `coach`, `sc` and `medical` by
 * their current assignments (ADR 0025). Validity is a range of club days
 * `[validFrom, validTo)`; an assignment is ended, never deleted (ADR 0034).
 */

export const staffAssignmentIdSchema = idOf('asignación del staff');

export const staffAssignmentRoleSchema = z.enum(STAFF_ASSIGNMENT_ROLES).meta({
  id: 'StaffAssignmentRole',
  description: 'Roles del staff que ven según sus asignaciones.',
});

export const staffAssignmentStatusSchema = z.enum(STAFF_ASSIGNMENT_STATUSES).meta({
  id: 'StaffAssignmentStatus',
  description:
    'En el día del club: `upcoming` empieza más adelante, `current` está vigente, `ended` terminó (o se canceló antes de empezar).',
});

const TARGET_DESCRIPTION =
  '`category`: una categoría (entrenador, preparador físico). `sport`: todas las categorías de un deporte (médico).';

/** What an assignment points at: one category, or every category of a sport. */
export const staffAssignmentTargetSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('category'), categoryId: categoryIdSchema }),
    z.object({ kind: z.literal('sport'), sport: sportSchema }),
  ])
  .meta({ id: 'StaffAssignmentTarget', description: TARGET_DESCRIPTION });

/** The target of a new assignment (strict: unknown keys are a `400`). */
export const staffAssignmentTargetInputSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('category'), categoryId: categoryIdSchema }),
    z.strictObject({ kind: z.literal('sport'), sport: sportSchema }),
  ])
  .meta({ id: 'StaffAssignmentTargetInput', description: TARGET_DESCRIPTION });

export const staffAssignmentSchema = z
  .object({
    id: staffAssignmentIdSchema,
    membershipId: membershipIdSchema,
    member: z.object({
      userId: userIdSchema,
      name: z.string(),
      role: membershipRoleSchema,
    }),
    target: staffAssignmentTargetSchema,
    validFrom: localDateSchema.meta({ description: 'Primer día en que vale (incluido).' }),
    validTo: localDateSchema.nullable().meta({
      description:
        'Día en que deja de valer (excluido); `null`: sin fin. Igual a `validFrom`: cancelada antes de empezar.',
    }),
    status: staffAssignmentStatusSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'StaffAssignment' });

export const staffAssignmentPageSchema = pageOf(staffAssignmentSchema).meta({
  id: 'StaffAssignmentPage',
});

export type StaffAssignment = z.output<typeof staffAssignmentSchema>;
export type StaffAssignmentTarget = z.output<typeof staffAssignmentTargetSchema>;

export const STAFF_ASSIGNMENT_STATUS_FILTERS = [
  'active',
  'current',
  'upcoming',
  'ended',
  'all',
] as const;
export type StaffAssignmentStatusFilter = (typeof STAFF_ASSIGNMENT_STATUS_FILTERS)[number];

const statusFilterSchema = z.enum(STAFF_ASSIGNMENT_STATUS_FILTERS).default('active').meta({
  description:
    '`active` (por defecto): vigentes y futuras; `current`, `upcoming`, `ended` o `all`, en el día del club.',
});

const listSort = sortQuerySchema(['validFrom', 'createdAt'], 'validFrom');

const endAfterStart = (value: {
  validFrom?: string | undefined;
  validTo?: string | null | undefined;
}) =>
  value.validFrom === undefined ||
  value.validTo === undefined ||
  value.validTo === null ||
  value.validTo > value.validFrom;

const endAfterStartIssue = {
  message: 'validTo must be after validFrom (it is exclusive)',
  path: ['validTo'],
};

const assignmentParams = z.strictObject({ assignmentId: staffAssignmentIdSchema });

export const listStaffAssignments = defineEndpoint({
  method: 'GET',
  path: '/v1/staff-assignments',
  summary: 'Asignaciones del staff del club',
  description:
    'Solo la administración. Filtra por membresía, categoría, deporte y estado en el día del club (`active` por defecto: vigentes y futuras).',
  tags: ['members'],
  auth: 'club',
  query: pageQuerySchema.extend({
    membershipId: membershipIdSchema.optional(),
    categoryId: categoryIdSchema.optional(),
    sport: sportSchema.optional().meta({
      description: 'Solo las asignaciones a todo ese deporte.',
    }),
    status: statusFilterSchema,
    sort: listSort,
  }),
  response: {
    status: 200,
    description: 'Página de asignaciones.',
    schema: staffAssignmentPageSchema,
  },
  errors: ['bad_request'],
});

export const listMyStaffAssignments = defineEndpoint({
  method: 'GET',
  path: '/v1/me/staff-assignments',
  summary: 'Mis asignaciones en el club',
  description:
    'Las asignaciones de la membresía con la que actúa el request: lo que ve en el club. Un rol sin asignaciones (o un superadmin en soporte) recibe la lista vacía.',
  tags: ['me', 'members'],
  auth: 'club',
  query: pageQuerySchema.extend({ status: statusFilterSchema, sort: listSort }),
  response: {
    status: 200,
    description: 'Página de asignaciones propias.',
    schema: staffAssignmentPageSchema,
  },
  errors: ['bad_request'],
});

export const getStaffAssignment = defineEndpoint({
  method: 'GET',
  path: '/v1/staff-assignments/{assignmentId}',
  summary: 'Una asignación del staff',
  description: 'Solo la administración. Una asignación de otro club: `not_found`.',
  tags: ['members'],
  auth: 'club',
  params: assignmentParams,
  response: { status: 200, description: 'La asignación.', schema: staffAssignmentSchema },
  errors: ['not_found'],
});

export const createStaffAssignment = defineEndpoint({
  method: 'POST',
  path: '/v1/staff-assignments',
  summary: 'Asignar a un miembro del staff',
  description:
    'Solo la administración. La membresía tiene que ser `coach`, `sc` o `medical` y estar activa; la categoría, activa; el deporte, una rama habilitada. Una asignación por categoría (para varias, una por cada una). `validFrom` por defecto es el día del club. Idempotente por `clientUuid`. Se superpone con otra de la misma membresía al mismo destino, o la membresía terminó: `conflict`.',
  tags: ['members'],
  auth: 'club',
  body: z
    .strictObject({
      clientUuid: clientUuidSchema.optional(),
      membershipId: membershipIdSchema,
      target: staffAssignmentTargetInputSchema,
      validFrom: localDateSchema.optional().meta({ description: 'Por defecto, el día del club.' }),
      validTo: localDateSchema.nullable().optional().meta({
        description: 'Excluido y posterior a `validFrom`; por defecto, sin fin.',
      }),
    })
    .refine(endAfterStart, endAfterStartIssue),
  response: { status: 201, description: 'Asignación creada.', schema: staffAssignmentSchema },
  errors: ['conflict'],
});

export const updateStaffAssignment = defineEndpoint({
  method: 'PATCH',
  path: '/v1/staff-assignments/{assignmentId}',
  summary: 'Cambiar la vigencia de una asignación',
  description:
    'Solo la administración. Cambia `validFrom` y `validTo` (el destino no: se termina y se crea otra). `version` desactualizada o superposición con otra asignación: `conflict`.',
  tags: ['members'],
  auth: 'club',
  params: assignmentParams,
  body: z
    .strictObject({
      version: expectedVersionSchema,
      validFrom: localDateSchema.optional(),
      validTo: localDateSchema.nullable().optional(),
    })
    .refine(endAfterStart, endAfterStartIssue),
  response: {
    status: 200,
    description: 'La asignación actualizada.',
    schema: staffAssignmentSchema,
  },
  errors: ['not_found', 'conflict'],
});

export const endStaffAssignment = defineEndpoint({
  method: 'POST',
  path: '/v1/staff-assignments/{assignmentId}/end',
  summary: 'Terminar una asignación',
  description:
    'Solo la administración. Deja de valer hoy (`validTo` = el día del club); una que todavía no empezó queda cancelada (`validTo` = `validFrom`). Idempotente.',
  tags: ['members'],
  auth: 'club',
  params: assignmentParams,
  response: { status: 200, description: 'La asignación terminada.', schema: staffAssignmentSchema },
  errors: ['not_found'],
});
