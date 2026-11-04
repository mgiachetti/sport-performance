import {
  COEFFICIENT_VERIFICATION_STATUSES,
  MATURITY_OFFSET_EQUATIONS,
  MENARCHE_DATE_PRECISIONS,
  MENARCHE_OFFSET_VERDICTS,
  MENARCHE_REPORTERS,
  MENARCHE_STATUSES,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import { clientUuidSchema } from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { idOf, playerIdSchema, userIdSchema } from '../primitives/ids.js';

/**
 * Menarche of a girl (B-805, ADR 0089): optional health data in the
 * `medical` schema. The player, her guardian while she is a minor and the
 * assigned medical staff tell it and read it, all of them with a current
 * health consent; the coach, the S&C staff and the administration never do,
 * nor anything derived from it. It validates the somatic maturity offset of
 * the girl (`offsetCheck`), which the rest of the staff keeps seeing as is.
 */

export const menarcheReportIdSchema = idOf('reporte de menarca');

export const menarcheStatusSchema = z.enum(MENARCHE_STATUSES).meta({
  id: 'MenarcheStatus',
  description:
    '`not_yet`: todavía no, al día del reporte; `occurred`: ya ocurrió, en `occurredOn` con su precisión.',
});

export const menarcheDatePrecisionSchema = z.enum(MENARCHE_DATE_PRECISIONS).meta({
  id: 'MenarcheDatePrecision',
  description:
    'Qué tan precisa es la fecha: `day`, `month` (se guarda el primer día del mes) o `year` (el 1 de enero). Los cálculos usan el medio del período.',
});

export const menarcheReporterSchema = z.enum(MENARCHE_REPORTERS).meta({
  id: 'MenarcheReporter',
  description: 'Quién lo informó: la jugadora (`player`), su tutor (`parent`) o el staff médico.',
});

export const menarcheReportSchema = z
  .object({
    id: menarcheReportIdSchema,
    clientUuid: clientUuidSchema,
    playerId: playerIdSchema,
    status: menarcheStatusSchema,
    occurredOn: localDateSchema.nullable().meta({
      description: 'Fecha, truncada a su precisión; `null` con `not_yet`.',
    }),
    precision: menarcheDatePrecisionSchema.nullable(),
    reportedOn: localDateSchema.meta({
      description: 'Día del club del reporte: el "al día de" de `not_yet`.',
    }),
    reportedBy: menarcheReporterSchema,
    reportedByUserId: userIdSchema.nullable().meta({
      description: 'Usuario que lo informó; `null` si borró su cuenta.',
    }),
    reportedAt: dateTimeSchema,
    ageAtMenarcheYears: z.number().nullable().meta({
      description: 'Edad decimal a la menarca (medio del período), con `occurred`.',
    }),
  })
  .meta({ id: 'MenarcheReport' });

export type MenarcheReport = z.output<typeof menarcheReportSchema>;

export const menarcheOffsetCheckSchema = z
  .object({
    measuredOn: localDateSchema.meta({
      description: 'Día de la última antropometría con offset de maduración.',
    }),
    phvOffsetYears: z
      .number()
      .meta({ description: 'Offset somático de ese día (años desde el PHV).' }),
    maturityOffsetEquation: z.enum(MATURITY_OFFSET_EQUATIONS),
    impliedPhvOffsetYears: z.number().nullable().meta({
      description:
        'Offset que implica la menarca con el intervalo medio PHV → menarca (solo con `occurred`).',
    }),
    impliedMinPhvOffsetYears: z.number().nullable().meta({
      description: 'Cota inferior del offset según la menarca; `null` sin cota.',
    }),
    impliedMaxPhvOffsetYears: z.number().nullable().meta({
      description: 'Cota superior del offset según la menarca.',
    }),
    verdict: z.enum(MENARCHE_OFFSET_VERDICTS).meta({
      description:
        '`consistent`; `offset_below_reference`: la ecuación la da menos madura de lo que permite la menarca (típico de una maduradora temprana); `offset_above_reference`: más madura (típico de una tardía). Nunca un diagnóstico.',
    }),
    referenceVerification: z.enum(COEFFICIENT_VERIFICATION_STATUSES).meta({
      description:
        'Estado de verificación de la referencia PHV → menarca contra sus fuentes; todo lo que no sea `verified_against_publication` se muestra con aviso.',
    }),
  })
  .meta({ id: 'MenarcheOffsetCheck' });

export const menarcheRecordSchema = z
  .object({
    playerId: playerIdSchema,
    canReport: z.boolean().meta({
      description:
        'Si quien consulta puede informar la menarca ahora (rol, consentimientos de datos y salud y módulo `maturation` del club).',
    }),
    latest: menarcheReportSchema
      .nullable()
      .meta({ description: 'El último reporte: el que vale.' }),
    history: z.array(menarcheReportSchema).meta({
      description: 'Los reportes, del más nuevo al más viejo (hasta 20).',
    }),
    offsetCheck: menarcheOffsetCheckSchema.nullable().meta({
      description:
        'El último offset somático contra la menarca; `null` sin reporte, sin offset, con el módulo `maturation` apagado o si quien consulta no lee la antropometría (el tutor).',
    }),
  })
  .meta({ id: 'MenarcheRecord' });

export type MenarcheRecord = z.output<typeof menarcheRecordSchema>;

export const getMenarche = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/menarche',
  summary: 'Menarca de una jugadora',
  description:
    'La jugadora, su tutor mientras es menor y el staff médico asignado, todos con consentimiento de salud vigente; nadie más (`forbidden`). Solo para jugadoras (`conflict` si no). Cada lectura queda en el registro de accesos a datos de salud.',
  tags: ['players'],
  auth: 'club',
  params: z.strictObject({ playerId: playerIdSchema }),
  response: { status: 200, description: 'El registro de menarca.', schema: menarcheRecordSchema },
  errors: ['not_found', 'conflict', 'consent_required'],
});

export const reportMenarche = defineEndpoint({
  method: 'POST',
  path: '/v1/players/{playerId}/menarche',
  summary: 'Informar la menarca',
  description:
    'Opcional. La jugadora o su tutor mientras es menor (consentimientos de datos y de salud) o el staff médico asignado (salud), con el módulo `maturation` del club prendido. Solo para jugadoras (`conflict` si no). `occurred` lleva fecha y precisión (la fecha se trunca a la precisión), no posterior a hoy y con una edad plausible; `not_yet` no lleva fecha y vale al día de hoy. Nunca se edita: un reporte nuevo reemplaza al anterior. Idempotente por `clientUuid`.',
  tags: ['players'],
  auth: 'club',
  params: z.strictObject({ playerId: playerIdSchema }),
  body: z.strictObject({
    clientUuid: clientUuidSchema.optional(),
    status: menarcheStatusSchema,
    occurredOn: localDateSchema.nullable().optional(),
    precision: menarcheDatePrecisionSchema.nullable().optional(),
  }),
  response: { status: 201, description: 'Reporte registrado.', schema: menarcheReportSchema },
  errors: ['not_found', 'conflict', 'consent_required'],
});
