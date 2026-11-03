import {
  ALERT_EVENT_TYPES,
  ALERT_NOTE_MAX_LENGTH,
  ALERT_REVIEW_STATUSES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, playerIdSchema, userIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import {
  alertRuleCodeSchema,
  alertRuleIdSchema,
  alertRuleKindSchema,
} from './configuration-alert-rules.js';

/**
 * Load alerts (B-327, ADR 0053): episodes the worker generates from the
 * club's declarative rules, their history and the staff's review. Alerts are
 * load-monitoring heuristics, never a diagnosis; they carry no UI text
 * (`messageKey`, `suggestionKey` and numeric `values` for `packages/i18n`)
 * and no health data. Only the staff sees them, by the scope of the
 * permission matrix (`alert.read`, `alert.acknowledge`).
 */

export const alertIdSchema = idOf('alerta');

export const alertSeveritySchema = z.enum(ALERT_SEVERITIES).meta({
  id: 'AlertSeverity',
  description: 'Severidad: `warning` (amarillo, atención) o `critical` (rojo).',
});

export const alertStatusSchema = z.enum(ALERT_STATUSES).meta({
  id: 'AlertStatus',
  description:
    'Revisión del staff: `open` (pendiente de acuse), `acknowledged` (vista, con nota opcional) o `dismissed` (descartada, con nota).',
});

export const alertEventTypeSchema = z.enum(ALERT_EVENT_TYPES).meta({
  id: 'AlertEventType',
  description:
    '`raised` (se abrió), `escalated` (llegó a una severidad mayor), `resolved` (dejó de cumplirse), `reopened` (volvió a cumplirse el mismo día que se resolvió), `acknowledged` o `dismissed` (revisión del staff).',
});

const alertNoteSchema = z
  .string()
  .trim()
  .min(1)
  .max(ALERT_NOTE_MAX_LENGTH)
  .meta({ description: `Nota de la revisión (1 a ${String(ALERT_NOTE_MAX_LENGTH)} caracteres).` });

export const alertSchema = z
  .object({
    id: alertIdSchema,
    playerId: playerIdSchema,
    ruleId: alertRuleIdSchema,
    ruleCode: alertRuleCodeSchema,
    kind: alertRuleKindSchema,
    severity: alertSeveritySchema.meta({
      description: 'La severidad más alta del episodio (nunca baja).',
    }),
    currentSeverity: alertSeveritySchema.meta({
      description: 'La severidad del último día en que la regla se cumplió.',
    }),
    raisedOn: localDateSchema.meta({ description: 'Día del club en que se abrió.' }),
    lastSeenOn: localDateSchema.meta({ description: 'Último día del club en que se cumplió.' }),
    resolvedOn: localDateSchema.nullable().meta({
      description: 'Primer día del club en que dejó de cumplirse; `null` mientras está activa.',
    }),
    observedOn: localDateSchema.meta({
      description:
        'Día del dato detrás de la última vez (bienestar, CMJ, talla); el mismo día para el ACWR.',
    }),
    messageKey: z.string().meta({
      description: 'Clave del texto en `packages/i18n` (`alert.<kind>.message`).',
    }),
    suggestionKey: z.string().meta({
      description: 'Clave de la sugerencia en `packages/i18n` (`alert.<kind>.suggestion`).',
    }),
    values: z.record(z.string(), z.number()).meta({
      description:
        'Valor observado, umbral cruzado y contexto de la última vez, sin redondear, para interpolar el texto.',
    }),
    status: alertStatusSchema,
    acknowledgedAt: dateTimeSchema.nullable(),
    acknowledgedBy: userIdSchema.nullable(),
    acknowledgementNote: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'Alert' });

export const alertEventSchema = z
  .object({
    seq: z.int().min(1).meta({ description: 'Orden de los eventos del club.' }),
    type: alertEventTypeSchema,
    localDate: localDateSchema.meta({ description: 'Día del club del evento.' }),
    severity: alertSeveritySchema.meta({
      description: 'Severidad de la alerta después del evento.',
    }),
    note: z.string().nullable(),
    actorId: userIdSchema.nullable().meta({
      description: 'Quién revisó; `null` para lo que hace el sistema (abrir, escalar, resolver).',
    }),
    createdAt: dateTimeSchema,
  })
  .meta({ id: 'AlertEvent' });

export const alertDetailSchema = alertSchema
  .extend({
    events: z
      .array(alertEventSchema)
      .meta({ description: 'Historial, del más viejo al más nuevo.' }),
  })
  .meta({ id: 'AlertDetail' });

export type AlertDto = z.output<typeof alertSchema>;
export type AlertEventDto = z.output<typeof alertEventSchema>;
export type AlertDetailDto = z.output<typeof alertDetailSchema>;

export const ALERT_STATES = ['active', 'resolved', 'all'] as const;

const alertParams = z.strictObject({ alertId: alertIdSchema });

export const listAlerts = defineEndpoint({
  method: 'GET',
  path: '/v1/alerts',
  summary: 'Alertas',
  description:
    '`coach`, `sc` y `medical` ven las de los jugadores de sus asignaciones; la administración, todo el club. Jugadores y tutores nunca. `categoryId` filtra por la categoría vigente hoy; `from`/`to`, por el día en que se abrió. Por defecto, las más recientes primero.',
  tags: ['alerts'],
  auth: 'club',
  query: pageQuerySchema.extend({
    playerId: playerIdSchema.optional(),
    categoryId: categoryIdSchema.optional(),
    state: z.enum(ALERT_STATES).default('all').meta({
      description: '`active` (sin resolver), `resolved` o `all`.',
    }),
    status: alertStatusSchema.optional(),
    severity: alertSeveritySchema.optional().meta({
      description: 'Por la severidad más alta del episodio.',
    }),
    kind: alertRuleKindSchema.optional(),
    from: localDateSchema.optional().meta({ description: 'Abiertas desde este día (inclusive).' }),
    to: localDateSchema.optional().meta({ description: 'Abiertas hasta este día (inclusive).' }),
    sort: sortQuerySchema(['raisedOn', 'lastSeenOn'], '-raisedOn'),
  }),
  response: {
    status: 200,
    description: 'Página de alertas.',
    schema: pageOf(alertSchema).meta({ id: 'AlertPage' }),
  },
  errors: ['bad_request'],
});

export const getAlert = defineEndpoint({
  method: 'GET',
  path: '/v1/alerts/{alertId}',
  summary: 'Una alerta con su historial',
  description:
    'Mismo alcance que la lista. Una alerta de otro club o de un jugador que no se ve: `not_found`.',
  tags: ['alerts'],
  auth: 'club',
  params: alertParams,
  response: { status: 200, description: 'La alerta y sus eventos.', schema: alertDetailSchema },
  errors: ['not_found'],
});

export const reviewAlert = defineEndpoint({
  method: 'POST',
  path: '/v1/alerts/{alertId}/review',
  summary: 'Acusar o descartar una alerta',
  description:
    'Staff con `alert.acknowledge` sobre el jugador. `acknowledged` (vista; nota opcional) o `dismissed` (no aplica; nota obligatoria). Solo una alerta pendiente (`open`) y con la `version` leída: si ya se revisó o cambió, `conflict`. Si después escala a una severidad mayor, vuelve a quedar pendiente. Queda en el historial con quién y cuándo.',
  tags: ['alerts'],
  auth: 'club',
  params: alertParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    status: z.enum(ALERT_REVIEW_STATUSES).meta({
      description: '`acknowledged` o `dismissed`.',
    }),
    note: alertNoteSchema.optional(),
  }),
  response: {
    status: 200,
    description: 'La alerta revisada, con su historial.',
    schema: alertDetailSchema,
  },
  errors: ['not_found', 'conflict'],
});
