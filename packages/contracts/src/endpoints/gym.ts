import {
  GYM_LOAD_KINDS,
  GYM_MEASURES,
  GYM_PLAN_LIMITS,
  GYM_SET_WARNINGS,
  isWellFormedCode,
  type StrengthAssessment,
} from '@sport-performance/domain';
import { z } from 'zod';
import { defineEndpoint } from '../endpoint.js';
import {
  archivedAtSchema,
  archiveStatusQuerySchema,
  clientUuidSchema,
  expectedVersionSchema,
  resourceVersionSchema,
  sortQuerySchema,
  stageSchema,
} from '../primitives/conventions.js';
import { dateTimeSchema, localDateSchema } from '../primitives/dates.js';
import { categoryIdSchema, idOf, playerIdSchema } from '../primitives/ids.js';
import { pageOf, pageQuerySchema } from '../primitives/pagination.js';
import { changeReasonSchema } from './change-history.js';

/**
 * Gym (B-607, ADR 0075): programs by stage (days and exercises with what is
 * prescribed), the sets each player performs (weight × reps × RIR, or a
 * time; a 1–3 technique score from the staff) and the e1RM they give
 * (Epley with RIR, only from the sets of the protocol, never in M13/M14).
 */

export const gymProgramIdSchema = idOf('programa de gimnasio');
export const gymSetIdSchema = idOf('serie de gimnasio');

/** Most sets of one load (a whole session of a player). */
export const GYM_SET_BATCH_MAX = 100;
/** Longest void reason of a set. */
export const GYM_VOID_REASON_MAX_LENGTH = 200;

const STRENGTH_ASSESSMENTS = [
  'technique_reps',
  'estimated_rm',
  'direct_rm',
] as const satisfies readonly StrengthAssessment[];

export const strengthAssessmentSchema = z.enum(STRENGTH_ASSESSMENTS).meta({
  id: 'StrengthAssessment',
  description:
    'Cómo se evalúa la fuerza en la etapa del jugador (y su categoría): `technique_reps` (M13/M14: peso corporal o palo, nota técnica), `estimated_rm` (M15/M16: series submáximas con RIR, e1RM; nunca al fallo) o `direct_rm` (M17/M19, como la primera).',
});

export const gymLoadKindSchema = z.enum(GYM_LOAD_KINDS).meta({
  id: 'GymLoadKind',
  description:
    'Cómo se cuenta la carga: `external` (kg de barra, mancuerna o pesa), `bodyweight` (cuerpo o palo, sin carga) o `bodyweight_plus` (cuerpo más lastre: se cargan los kg agregados).',
});

export const gymMeasureSchema = z.enum(GYM_MEASURES).meta({
  id: 'GymMeasure',
  description:
    '`reps` (repeticiones por serie) o `duration` (segundos sostenidos, como la plancha).',
});

export const gymExerciseCodeSchema = z
  .string()
  .refine(isWellFormedCode, { message: 'An exercise code in snake_case (max 64)' })
  .meta({
    description:
      'Código del ejercicio en `snake_case`: uno de la biblioteca (`goblet_squat`, `trap_bar_deadlift`, `push_up`…) o uno propio del club, con nombre en el programa.',
    examples: ['trap_bar_deadlift'],
  });

const L = GYM_PLAN_LIMITS;
const nameSchema = z.string().trim().min(1).max(L.nameLength);
const notesSchema = z.string().trim().min(1).max(L.notesLength);
const repsSchema = z.int().min(1).max(L.reps);
const rirSchema = z.int().min(0).max(L.rir);
const durationSchema = z.int().min(1).max(L.durationS);
const loadKgSchema = z.number().min(0).max(L.loadKg).meta({ description: 'Kilos (≥ 0).' });

export const gymPlanExerciseSchema = z
  .strictObject({
    exerciseCode: gymExerciseCodeSchema,
    name: nameSchema
      .nullable()
      .meta({ description: 'Nombre de un ejercicio propio del club; `null` para la biblioteca.' }),
    loadKind: gymLoadKindSchema,
    measure: gymMeasureSchema,
    sets: z.int().min(1).max(L.setsPerExercise),
    repsMin: repsSchema.nullable(),
    repsMax: repsSchema.nullable(),
    durationS: durationSchema.nullable(),
    targetRir: rirSchema.nullable().meta({
      description:
        'Repeticiones en reserva a dejar. En M15/M16 es obligatorio en los ejercicios con carga y nunca menor al mínimo del protocolo (2 por defecto): nunca al fallo.',
    }),
    loadKg: loadKgSchema.nullable().meta({
      description: 'Carga sugerida en kg (los kg agregados en `bodyweight_plus`).',
    }),
    restS: z.int().min(0).max(L.restS).nullable(),
    notes: notesSchema.nullable(),
  })
  .meta({ id: 'GymPlanExercise' });

export const gymPlanDaySchema = z
  .strictObject({
    key: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_]{0,31}$/)
      .meta({ description: 'Clave estable del día dentro del programa (`a`, `lower_1`).' }),
    name: nameSchema,
    exercises: z.array(gymPlanExerciseSchema).min(1).max(L.exercisesPerDay),
  })
  .meta({ id: 'GymPlanDay' });

export const gymPlanSchema = z
  .strictObject({
    days: z.array(gymPlanDaySchema).min(1).max(L.days),
  })
  .meta({
    id: 'GymPlan',
    description:
      'Días del programa con sus ejercicios. La API valida además las reglas de la etapa (`validation_failed` en `body.plan.days[i].exercises[j].<campo>`).',
  });

export const gymProgramSchema = z
  .object({
    id: gymProgramIdSchema,
    name: z.string(),
    categoryId: categoryIdSchema.nullable(),
    playerId: playerIdSchema.nullable(),
    stage: stageSchema.nullable().meta({
      description: 'Con categoría: solo para los jugadores de la categoría en esa etapa.',
    }),
    plan: gymPlanSchema,
    notes: z.string().nullable(),
    validFrom: localDateSchema,
    validTo: localDateSchema.nullable().meta({ description: 'Fin exclusivo; `null` sin fin.' }),
    archivedAt: archivedAtSchema,
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'GymProgram' });

export type GymProgram = z.output<typeof gymProgramSchema>;
export type GymPlanInput = z.input<typeof gymPlanSchema>;

export const gymSetWarningSchema = z.enum(GYM_SET_WARNINGS).meta({
  id: 'GymSetWarning',
  description:
    '`to_failure` (RIR 0 antes de M17: la etapa nunca va al fallo), `rir_below_protocol` (M15/M16 con menos RIR que el mínimo) o `outside_e1rm_range` (repeticiones fuera del rango: no estima el e1RM).',
});

export type GymSetWarningDto = z.output<typeof gymSetWarningSchema>;

export const gymSetSchema = z
  .object({
    id: gymSetIdSchema,
    playerId: playerIdSchema,
    gymProgramId: gymProgramIdSchema.nullable(),
    dayKey: z.string().nullable(),
    performedOn: localDateSchema.meta({ description: 'Día del club en que se hizo.' }),
    exerciseCode: z.string(),
    loadKind: gymLoadKindSchema,
    setNumber: z.int().min(1),
    reps: z.int().nullable(),
    loadKg: z.number().nullable(),
    rir: z.int().nullable(),
    techniqueScore: z.int().min(1).max(3).nullable(),
    durationS: z.int().nullable(),
    notes: z.string().nullable(),
    strengthAssessment: strengthAssessmentSchema.nullable().meta({
      description: 'Cómo se evaluaba la fuerza del jugador ese día; `null` sin categoría ese día.',
    }),
    e1rmKg: z.number().nullable().meta({
      description:
        'e1RM Epley con RIR (`peso × (1 + (reps + RIR)/30)`) si la serie cumple el protocolo del test de fuerza del club; nunca en M13/M14. Con lastre suma la masa corporal medida más cercana.',
    }),
    warnings: z.array(gymSetWarningSchema),
    voidedAt: archivedAtSchema.meta({ description: 'Cuándo se anuló; `null` si vale.' }),
    voidReason: z.string().nullable(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
    version: resourceVersionSchema,
  })
  .meta({ id: 'GymSet' });

export type GymSet = z.output<typeof gymSetSchema>;

const programParams = z.strictObject({ gymProgramId: gymProgramIdSchema });
const setParams = z.strictObject({ gymSetId: gymSetIdSchema });

const programTargetShape = {
  categoryId: categoryIdSchema.nullable().optional(),
  playerId: playerIdSchema.nullable().optional(),
  stage: stageSchema.nullable().optional(),
};

export const listGymPrograms = defineEndpoint({
  method: 'GET',
  path: '/v1/gym-programs',
  summary: 'Programas de gimnasio',
  description:
    '`coach` y `sc` ven los de sus categorías asignadas y de sus jugadores; la administración, todo el club; el jugador, los que le aplican hoy (su categoría y etapa, o los suyos).',
  tags: ['gym'],
  auth: 'club',
  query: pageQuerySchema.extend({
    categoryId: categoryIdSchema.optional(),
    playerId: playerIdSchema.optional(),
    status: archiveStatusQuerySchema,
    sort: sortQuerySchema(['name', 'validFrom'], '-validFrom'),
  }),
  response: {
    status: 200,
    description: 'Página de programas.',
    schema: pageOf(gymProgramSchema).meta({ id: 'GymProgramPage' }),
  },
  errors: ['bad_request'],
});

export const getGymProgram = defineEndpoint({
  method: 'GET',
  path: '/v1/gym-programs/{gymProgramId}',
  summary: 'Un programa de gimnasio',
  description: 'Mismo alcance que la lista. Fuera del alcance: `not_found`.',
  tags: ['gym'],
  auth: 'club',
  params: programParams,
  response: { status: 200, description: 'El programa.', schema: gymProgramSchema },
  errors: ['not_found'],
});

export const createGymProgram = defineEndpoint({
  method: 'POST',
  path: '/v1/gym-programs',
  summary: 'Crear un programa de gimnasio',
  description:
    '`sc` de la categoría o del jugador y la administración. Para una categoría (con `stage` opcional: solo los de esa etapa) o para un jugador, nunca ambos. El plan se valida con las reglas de la etapa (la indicada, la de la categoría o la del jugador hoy): M13/M14 sin carga externa ni lastre; M15/M16 con RIR objetivo ≥ el mínimo del protocolo en cada ejercicio con carga. Idempotente por `clientUuid`.',
  tags: ['gym'],
  auth: 'club',
  body: z
    .strictObject({
      clientUuid: clientUuidSchema.optional(),
      name: nameSchema,
      ...programTargetShape,
      plan: gymPlanSchema,
      notes: notesSchema.nullable().optional(),
      validFrom: localDateSchema,
      validTo: localDateSchema.nullable().optional(),
    })
    .superRefine((value, ctx) => {
      const targets = [value.categoryId, value.playerId].filter(
        (v) => v !== undefined && v !== null,
      );
      if (targets.length !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['categoryId'],
          message: 'Exactly one target: a category or a player',
        });
      }
      if (
        value.stage !== undefined &&
        value.stage !== null &&
        (value.categoryId ?? null) === null
      ) {
        ctx.addIssue({ code: 'custom', path: ['stage'], message: 'A stage only with a category' });
      }
      if (
        value.validTo !== undefined &&
        value.validTo !== null &&
        value.validTo <= value.validFrom
      ) {
        ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'After validFrom' });
      }
    }),
  response: { status: 201, description: 'Programa creado.', schema: gymProgramSchema },
  errors: ['conflict'],
});

export const updateGymProgram = defineEndpoint({
  method: 'PATCH',
  path: '/v1/gym-programs/{gymProgramId}',
  summary: 'Editar un programa de gimnasio',
  description:
    'Mismos permisos y reglas que el alta. El destino (categoría o jugador) no cambia; la etapa sí. Con `version` leída: desactualizada o programa archivado, `conflict`. Las series ya cargadas no cambian.',
  tags: ['gym'],
  auth: 'club',
  params: programParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    name: nameSchema.optional(),
    stage: stageSchema.nullable().optional(),
    plan: gymPlanSchema.optional(),
    notes: notesSchema.nullable().optional(),
    validFrom: localDateSchema.optional(),
    validTo: localDateSchema.nullable().optional(),
  }),
  response: { status: 200, description: 'Programa editado.', schema: gymProgramSchema },
  errors: ['not_found', 'conflict'],
});

export const archiveGymProgram = defineEndpoint({
  method: 'POST',
  path: '/v1/gym-programs/{gymProgramId}/archive',
  summary: 'Archivar un programa de gimnasio',
  description: '`sc` y la administración. Deja de aplicar; sus series se conservan. Idempotente.',
  tags: ['gym'],
  auth: 'club',
  params: programParams,
  response: { status: 200, description: 'Programa archivado.', schema: gymProgramSchema },
  errors: ['not_found'],
});

export const restoreGymProgram = defineEndpoint({
  method: 'POST',
  path: '/v1/gym-programs/{gymProgramId}/restore',
  summary: 'Restaurar un programa de gimnasio',
  description: '`sc` y la administración. Idempotente.',
  tags: ['gym'],
  auth: 'club',
  params: programParams,
  response: { status: 200, description: 'Programa restaurado.', schema: gymProgramSchema },
  errors: ['not_found'],
});

export const e1rmProtocolSchema = z
  .object({
    minReps: z.int().min(1),
    maxReps: z.int().min(1),
    minRir: z.number().min(0),
  })
  .meta({
    id: 'E1rmProtocol',
    description:
      'Protocolo del e1RM del test de fuerza del club: rango de repeticiones y RIR mínimo.',
  });

export const playerGymProgramsSchema = z
  .object({
    playerId: playerIdSchema,
    on: localDateSchema,
    stage: stageSchema.nullable(),
    strengthAssessment: strengthAssessmentSchema.nullable(),
    e1rmProtocol: e1rmProtocolSchema,
    programs: z.array(gymProgramSchema).meta({
      description:
        'Programas en vigor ese día: primero los del jugador, después los de su categoría.',
    }),
  })
  .meta({ id: 'PlayerGymPrograms' });

export type PlayerGymPrograms = z.output<typeof playerGymProgramsSchema>;

const playerParams = z.strictObject({ playerId: playerIdSchema });

export const getPlayerGymPrograms = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/gym-programs',
  summary: 'Programas de gimnasio de un jugador',
  description:
    'Los programas en vigor el día pedido (hoy por defecto) para el jugador: los suyos y los de su categoría ese día (todos o los de su etapa), sin archivados. Con la etapa, cómo se evalúa la fuerza y el protocolo del e1RM.',
  tags: ['gym'],
  auth: 'club',
  params: playerParams,
  query: z.strictObject({ on: localDateSchema.optional() }),
  response: { status: 200, description: 'Programas del jugador.', schema: playerGymProgramsSchema },
  errors: ['not_found', 'conflict'],
});

export const gymSetInputSchema = z
  .strictObject({
    clientUuid: clientUuidSchema.optional(),
    exerciseCode: gymExerciseCodeSchema,
    setNumber: z
      .int()
      .min(1)
      .max(L.setsPerExercise * 3),
    reps: repsSchema.nullable().optional(),
    loadKg: loadKgSchema.nullable().optional(),
    rir: rirSchema.nullable().optional(),
    techniqueScore: z.int().min(1).max(3).nullable().optional().meta({
      description: 'Nota técnica 1–3: la pone el staff (el jugador no).',
    }),
    durationS: durationSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
  })
  .meta({ id: 'GymSetInput' });

export const GYM_SET_OUTCOMES = ['created', 'replayed'] as const;

export const gymSetBatchResultSchema = z
  .object({
    items: z.array(
      z.object({
        outcome: z.enum(GYM_SET_OUTCOMES).meta({
          description:
            '`created` o `replayed` (ya estaba por su `clientUuid`: no se cargó de nuevo).',
        }),
        set: gymSetSchema,
      }),
    ),
  })
  .meta({ id: 'GymSetBatchResult' });

export const logGymSets = defineEndpoint({
  method: 'POST',
  path: '/v1/gym-sets',
  summary: 'Cargar series de gimnasio',
  description:
    'El jugador (las suyas, hasta una semana atrás) y el `sc` de sus asignaciones y la administración (cualquier día pasado), con consentimiento `data` vigente. Todas del mismo jugador y día, todo o nada. El ejercicio sale del programa (si se indica) o de la biblioteca. Se validan contra la etapa del jugador ese día: M13/M14 sin carga; desde M15, RIR en cada serie con carga. Los avisos (al fallo, RIR bajo) no frenan. Cada serie es idempotente por `clientUuid` (apta para la cola offline).',
  tags: ['gym'],
  auth: 'club',
  body: z
    .strictObject({
      playerId: playerIdSchema.optional().meta({
        description: 'El jugador; por defecto, el propio (rol `player`).',
      }),
      performedOn: localDateSchema
        .optional()
        .meta({ description: 'Día del club; hoy por defecto.' }),
      gymProgramId: gymProgramIdSchema.nullable().optional(),
      dayKey: z.string().min(1).max(32).nullable().optional(),
      sets: z.array(gymSetInputSchema).min(1).max(GYM_SET_BATCH_MAX),
    })
    .superRefine((value, ctx) => {
      const uuids = new Set<string>();
      value.sets.forEach((set, index) => {
        if (set.clientUuid === undefined) return;
        if (uuids.has(set.clientUuid)) {
          ctx.addIssue({
            code: 'custom',
            path: ['sets', index, 'clientUuid'],
            message: 'Repeated clientUuid',
          });
        }
        uuids.add(set.clientUuid);
      });
      if ((value.dayKey ?? null) !== null && (value.gymProgramId ?? null) === null) {
        ctx.addIssue({ code: 'custom', path: ['dayKey'], message: 'A day only with a program' });
      }
    }),
  response: {
    status: 201,
    description: 'Cada serie, en el orden del pedido.',
    schema: gymSetBatchResultSchema,
  },
  errors: ['not_found', 'conflict'],
});

export const correctGymSet = defineEndpoint({
  method: 'PATCH',
  path: '/v1/gym-sets/{gymSetId}',
  summary: 'Corregir una serie de gimnasio',
  description:
    'Quien puede cargarla (el jugador, solo dentro de su semana). Los campos que se mandan; `null` borra. Con la `version` leída y el motivo (queda en el historial). Desactualizada o serie anulada: `conflict`.',
  tags: ['gym'],
  auth: 'club',
  params: setParams,
  body: z.strictObject({
    version: expectedVersionSchema,
    changeReason: changeReasonSchema,
    reps: repsSchema.nullable().optional(),
    loadKg: loadKgSchema.nullable().optional(),
    rir: rirSchema.nullable().optional(),
    techniqueScore: z.int().min(1).max(3).nullable().optional(),
    durationS: durationSchema.nullable().optional(),
    notes: notesSchema.nullable().optional(),
  }),
  response: { status: 200, description: 'La serie corregida.', schema: gymSetSchema },
  errors: ['not_found', 'conflict'],
});

export const voidGymSet = defineEndpoint({
  method: 'POST',
  path: '/v1/gym-sets/{gymSetId}/void',
  summary: 'Anular una serie de gimnasio',
  description:
    'Quien puede corregirla. Una serie cargada por error se anula con motivo, nunca se borra: deja de contar para el e1RM. Idempotente.',
  tags: ['gym'],
  auth: 'club',
  params: setParams,
  body: z.strictObject({
    reason: z.string().trim().min(1).max(GYM_VOID_REASON_MAX_LENGTH),
  }),
  response: { status: 200, description: 'La serie anulada.', schema: gymSetSchema },
  errors: ['not_found'],
});

export const listGymSets = defineEndpoint({
  method: 'GET',
  path: '/v1/gym-sets',
  summary: 'Series de gimnasio',
  description:
    'El jugador ve las suyas; `coach` y `sc` las de sus asignaciones; la administración, todo el club. Sin anuladas salvo `includeVoided`.',
  tags: ['gym'],
  auth: 'club',
  query: pageQuerySchema.extend({
    playerId: playerIdSchema.optional(),
    exerciseCode: gymExerciseCodeSchema.optional(),
    from: localDateSchema.optional().meta({ description: 'Desde este día (inclusive).' }),
    to: localDateSchema.optional().meta({ description: 'Hasta este día (inclusive).' }),
    includeVoided: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    sort: sortQuerySchema(['performedOn'], '-performedOn'),
  }),
  response: {
    status: 200,
    description: 'Página de series.',
    schema: pageOf(gymSetSchema).meta({ id: 'GymSetPage' }),
  },
  errors: ['bad_request'],
});

export const getGymSet = defineEndpoint({
  method: 'GET',
  path: '/v1/gym-sets/{gymSetId}',
  summary: 'Una serie de gimnasio',
  description: 'Mismo alcance que la lista.',
  tags: ['gym'],
  auth: 'club',
  params: setParams,
  response: { status: 200, description: 'La serie.', schema: gymSetSchema },
  errors: ['not_found'],
});

export const gymExerciseSummarySchema = z
  .object({
    exerciseCode: z.string(),
    setsN: z.int().min(1),
    lastPerformedOn: localDateSchema,
    bestE1rmKg: z.number().nullable(),
    bestOn: localDateSchema.nullable(),
    series: z.array(z.object({ on: localDateSchema, e1rmKg: z.number() })).meta({
      description: 'Mejor e1RM de cada día en que se estimó, del más viejo al más nuevo.',
    }),
  })
  .meta({ id: 'GymExerciseSummary' });

export const playerGymSummarySchema = z
  .object({
    playerId: playerIdSchema,
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
    exercises: z.array(gymExerciseSummarySchema).meta({
      description: 'Por ejercicio, del último hecho al más viejo.',
    }),
  })
  .meta({ id: 'PlayerGymSummary' });

export type PlayerGymSummary = z.output<typeof playerGymSummarySchema>;
export type GymExerciseSummaryDto = z.output<typeof gymExerciseSummarySchema>;

export const getPlayerGymSummary = defineEndpoint({
  method: 'GET',
  path: '/v1/players/{playerId}/gym-summary',
  summary: 'Resumen de gimnasio de un jugador',
  description:
    'Por ejercicio: series, último día, mejor e1RM y su evolución por día (sin series anuladas). Mismo alcance que las series.',
  tags: ['gym'],
  auth: 'club',
  params: playerParams,
  query: z.strictObject({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  }),
  response: { status: 200, description: 'El resumen.', schema: playerGymSummarySchema },
  errors: ['not_found'],
});
