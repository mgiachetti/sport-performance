import { z } from 'zod';
import { SUPPORT_REASON_MAX_LENGTH, defineEndpoint } from '../endpoint.js';
import { dateTimeSchema, timeZoneSchema } from '../primitives/dates.js';
import { clubIdSchema, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { clubSlugSchema } from './club-theme.js';

/**
 * The superadmin's support accesses (ADR 0029, ADR 0066, B-414): one entry
 * per request in which a superadmin acted, with the club (or the registry of
 * clubs), the operator and the reason they stated. Read-only: the log is
 * append-only and only the database writes it.
 */

export const supportAccessEntrySchema = z
  .object({
    id: z.uuid().meta({ description: 'Id de la entrada del registro.' }),
    startedAt: dateTimeSchema.meta({ description: 'Cuándo empezó el pedido.' }),
    operator: z
      .object({
        userId: userIdSchema,
        name: z
          .string()
          .nullable()
          .meta({ description: 'Nombre del superadmin; `null` si la cuenta ya no existe.' }),
        email: z
          .string()
          .nullable()
          .meta({ description: 'Email del superadmin; `null` si la cuenta ya no existe.' }),
      })
      .meta({ description: 'Quién actuó como soporte.' }),
    club: z
      .object({
        id: clubIdSchema,
        name: z.string(),
        slug: clubSlugSchema,
        timeZone: timeZoneSchema,
      })
      .nullable()
      .meta({ description: 'El club en el que actuó; `null`: el registro de clubes.' }),
    reason: z
      .string()
      .min(1)
      .max(SUPPORT_REASON_MAX_LENGTH)
      .meta({ description: 'El motivo que declaró (`X-Support-Reason`).' }),
    requestId: z.string().min(1).meta({ description: 'Id del pedido en los logs de la API.' }),
  })
  .meta({ id: 'SupportAccessEntry', description: 'Un acceso de soporte registrado.' });

export type SupportAccessEntry = z.output<typeof supportAccessEntrySchema>;

const supportAccessFilters = {
  operatorId: userIdSchema.optional().meta({ description: 'Solo los accesos de este superadmin.' }),
  from: dateTimeSchema.optional().meta({ description: 'Desde este instante (inclusive).' }),
  to: dateTimeSchema.optional().meta({ description: 'Hasta este instante (exclusive).' }),
};

function fromBeforeTo(query: { from?: string | undefined; to?: string | undefined }): boolean {
  return (
    query.from === undefined ||
    query.to === undefined ||
    new Date(query.from).getTime() < new Date(query.to).getTime()
  );
}

const fromBeforeToIssue = { message: '`from` must be before `to`', path: ['to'] };

const supportAccessPageSchema = pageOf(supportAccessEntrySchema).meta({
  id: 'SupportAccessPage',
});

export const listSupportAccess = defineEndpoint({
  method: 'GET',
  path: '/v1/support-access',
  summary: 'Accesos de soporte (todos los clubes)',
  description:
    'Solo superadmin, con `X-Support-Reason` (esta lectura también queda registrada). Todos los accesos de soporte, a los clubes y al registro, siempre los más nuevos primero. Filtra por club, superadmin y período.',
  tags: ['support'],
  auth: 'session',
  query: pageQuerySchema
    .extend({
      clubId: clubIdSchema.optional().meta({ description: 'Solo los accesos a este club.' }),
      ...supportAccessFilters,
    })
    .refine(fromBeforeTo, fromBeforeToIssue),
  response: { status: 200, description: 'Página de accesos.', schema: supportAccessPageSchema },
  errors: ['bad_request', 'forbidden'],
});

export const listClubSupportAccess = defineEndpoint({
  method: 'GET',
  path: '/v1/club/support-access',
  summary: 'Accesos de soporte al club',
  description:
    'La administración del club (`admin`, o el superadmin que lo asiste): quién entró al club como soporte, cuándo y por qué. Los más nuevos primero.',
  tags: ['support'],
  auth: 'club',
  query: pageQuerySchema.extend(supportAccessFilters).refine(fromBeforeTo, fromBeforeToIssue),
  response: { status: 200, description: 'Página de accesos.', schema: supportAccessPageSchema },
  errors: ['bad_request'],
});
