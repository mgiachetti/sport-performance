import {
  CANONICAL_TEST_CODES,
  DEFAULT_ATTEMPT_SCORING,
  DEFAULT_E1RM_PROTOCOL,
  DEFAULT_IFT_3015_PROTOCOL,
  DEFAULT_KHAMIS_ROCHE_PARAMS,
  DEFAULT_MATURITY_OFFSET_EQUATION,
  SPRINT_VMAX_SEGMENT,
  STANDARD_GRAVITY_MS2,
  canonicalMetricsOfTest,
  type AttemptAggregation,
  type CanonicalMetricCode,
  type CanonicalTestCode,
  type Sport,
} from '@sport-performance/domain';
import type { TestProtocol } from '../schema/catalog.js';

/**
 * Version 1 of every test of the battery (CLAUDE.md, "Batería de tests" and
 * "Protocolos"). The protocol text is club data shown to the evaluator (and
 * editable by the club as a new version, B-322), so it is written in the
 * club's language (es-AR); numeric settings come from the domain constants
 * the scoring functions use, so seed and formulas never disagree.
 */

export const SEEDED_PROTOCOL_VERSION = 1;

/** Shared conditions of every test (CLAUDE.md, "General"). */
const GENERAL_STEPS = [
  'Entrada en calor estandarizada antes del test.',
  'Misma superficie y calzado que en las mediciones anteriores.',
  'Registrá método, evaluador y condiciones (clima, superficie, horario).',
] as const;

export interface TestDefinitionSeed {
  readonly code: CanonicalTestCode;
  /** Sports where the test applies; `null` means every sport. */
  readonly sports: readonly Sport[] | null;
  readonly attemptCount: number;
  readonly attemptAggregation: AttemptAggregation;
  readonly maximalLoad: boolean;
  readonly protocol: TestProtocol;
  /** Metrics the test produces, in dictionary order. */
  readonly metrics: readonly CanonicalMetricCode[];
}

/**
 * Metrics computed from other metrics of the same result (or from the sets
 * of a strength test), never typed in by the evaluator.
 */
export const DERIVED_TEST_METRIC_CODES = [
  'phv_offset_years',
  'adult_height_pct',
  'growth_velocity_cm_year',
  'sprint_vmax_ms',
  'cod505_asymmetry_pct',
  'e1rm_kg',
  'relative_strength_kg_kg',
] as const satisfies readonly CanonicalMetricCode[];

export function isDerivedTestMetric(code: CanonicalMetricCode): boolean {
  return (DERIVED_TEST_METRIC_CODES as readonly string[]).includes(code);
}

const sprint = DEFAULT_ATTEMPT_SCORING.sprint_40_s;
const cmj = DEFAULT_ATTEMPT_SCORING.cmj_height_cm;
const cod505 = DEFAULT_ATTEMPT_SCORING.cod505_left_s;

type TestSpec = Omit<TestDefinitionSeed, 'code' | 'metrics'>;

const SPECS: Readonly<Record<CanonicalTestCode, TestSpec>> = {
  anthro: {
    sports: null,
    attemptCount: 2,
    attemptAggregation: 'mean',
    maximalLoad: false,
    protocol: {
      summary:
        'Talla, talla sentado y peso; en M17/M19 también pliegues (ISAK). Se informa la altura de los padres para la talla adulta predicha.',
      steps: [
        'Sin calzado y con ropa liviana, a la misma hora del día que la medición anterior.',
        'Talla y talla sentado con estadiómetro, en inspiración, con la cabeza en el plano de Frankfurt.',
        'Dos mediciones de cada variable; si difieren más de 0,4 cm (talla) o 0,1 kg (peso), una tercera.',
        'Pliegues (solo etapa de rendimiento): protocolo ISAK, mismo evaluador acreditado.',
      ],
      equipment: ['estadiómetro', 'banco de 40 cm para talla sentado', 'balanza', 'plicómetro'],
      parameters: {
        maturityOffsetEquation: DEFAULT_MATURITY_OFFSET_EQUATION,
        adultHeightTableCode: DEFAULT_KHAMIS_ROCHE_PARAMS.table.code,
        adultHeightAgeMode: DEFAULT_KHAMIS_ROCHE_PARAMS.ageMode,
      },
    },
  },
  sprint_40: {
    sports: null,
    attemptCount: sprint.plannedAttempts,
    attemptAggregation: sprint.aggregation,
    maximalLoad: false,
    protocol: {
      summary: `Sprint de 40 m con parciales a 10 y 20 m. ${String(sprint.plannedAttempts)} intentos, vale el mejor. Vmax del tramo ${String(SPRINT_VMAX_SEGMENT.fromM)}–${String(SPRINT_VMAX_SEGMENT.toM)} m.`,
      steps: [
        ...GENERAL_STEPS,
        'Salida parado, con el pie adelantado a 0,5 m detrás de la línea de salida.',
        'Fotocélulas (o video) en 0, 10, 20 y 40 m.',
        `${String(sprint.plannedAttempts)} intentos con 3 minutos de pausa; vale el mejor.`,
      ],
      restBetweenAttemptsS: 180,
      equipment: ['fotocélulas o cámara a 240 fps', 'conos', 'cinta métrica'],
      parameters: {
        startOffsetM: 0.5,
        vmaxFromM: SPRINT_VMAX_SEGMENT.fromM,
        vmaxToM: SPRINT_VMAX_SEGMENT.toM,
      },
    },
  },
  cmj: {
    sports: null,
    attemptCount: cmj.plannedAttempts,
    attemptAggregation: cmj.aggregation,
    maximalLoad: false,
    protocol: {
      summary: `Salto con contramovimiento, manos en la cintura. ${String(cmj.plannedAttempts)} intentos, vale el mejor. Altura por tiempo de vuelo: h = g·t²/8.`,
      steps: [
        ...GENERAL_STEPS,
        'Manos en la cintura durante todo el salto; caída con piernas extendidas.',
        'Celular fijo a 1,5 m, a la altura de los pies, filmando de costado.',
        `${String(cmj.plannedAttempts)} intentos con 1 minuto de pausa; vale el mejor.`,
      ],
      restBetweenAttemptsS: 60,
      equipment: ['celular con trípode', 'superficie firme y plana'],
      parameters: { gravityMs2: STANDARD_GRAVITY_MS2, cameraDistanceM: 1.5 },
    },
  },
  cod_505: {
    sports: null,
    attemptCount: cod505.plannedAttempts,
    attemptAggregation: cod505.aggregation,
    maximalLoad: false,
    protocol: {
      summary: `505: 10 m de carrera lanzada, giro de 180° y 5 m de vuelta. ${String(cod505.plannedAttempts)} intentos por lado, vale el mejor; se calcula la asimetría.`,
      steps: [
        ...GENERAL_STEPS,
        'Salida a 10 m antes de la línea de giro; se cronometran los 5 m antes y después del giro.',
        'Giro con el pie izquierdo y con el derecho, alternando.',
        `${String(cod505.plannedAttempts)} intentos por lado con 2 minutos de pausa; vale el mejor de cada lado.`,
      ],
      restBetweenAttemptsS: 120,
      equipment: ['fotocélulas o cámara', 'conos', 'cinta métrica'],
    },
  },
  ift_3015: {
    sports: null,
    attemptCount: 1,
    attemptAggregation: 'best',
    maximalLoad: false,
    protocol: {
      summary:
        '30-15 Intermittent Fitness Test: 30 s de carrera ida y vuelta en 40 m y 15 s de pausa, con velocidad creciente. La VIFT se usa para prescribir pasadas.',
      steps: [
        ...GENERAL_STEPS,
        'Audio oficial del test; zonas de 3 m en cada extremo y en el centro.',
        'Fin del test: no llega a la zona tres veces seguidas o se detiene.',
        'Se registra la última etapa completa.',
      ],
      equipment: ['audio del test', 'parlante', 'conos', 'cinta métrica'],
      parameters: { ...DEFAULT_IFT_3015_PROTOCOL },
    },
  },
  bronco: {
    // Rugby conditioning test; hockey uses its own (B-802, for example Yo-Yo IR1).
    sports: ['rugby'],
    attemptCount: 1,
    attemptAggregation: 'best',
    maximalLoad: false,
    protocol: {
      summary:
        'Bronco: 5 series de ida y vuelta a 20, 40 y 60 m (1200 m) sin pausa. Solo si lo usa la primera.',
      steps: [
        ...GENERAL_STEPS,
        'Conos a 0, 20, 40 y 60 m; cada serie es 0-20-0-40-0-60-0.',
        'Se cronometra el tiempo total de las 5 series.',
      ],
      equipment: ['cronómetro', 'conos', 'cinta métrica'],
    },
  },
  strength: {
    sports: null,
    attemptCount: 1,
    attemptAggregation: 'best',
    // Maximal loads depend on the player (stage and age band), not on the test:
    // `strengthAssessmentFor` decides; M13/M14 never do them (principle 3).
    maximalLoad: false,
    protocol: {
      summary:
        'Fuerza según la etapa: M13/M14 flexiones, dominadas y plancha con nota técnica 1–3; M15/M16 1RM estimado (Epley con RIR) desde series submáximas; M17/M19 1RM o 3RM directo.',
      steps: [
        ...GENERAL_STEPS,
        `M15/M16: series de ${String(DEFAULT_E1RM_PROTOCOL.minReps)} a ${String(DEFAULT_E1RM_PROTOCOL.maxReps)} repeticiones con RIR ≥ ${String(DEFAULT_E1RM_PROTOCOL.minRir)}. Nunca al fallo.`,
        'M17/M19: aproximaciones progresivas hasta el 1RM o 3RM, con ayudante.',
        'Se registran ejercicio, peso, repeticiones, RIR y nota técnica.',
      ],
      restBetweenAttemptsS: 180,
      equipment: [
        'barra hexagonal',
        'kettlebell o mancuerna (goblet)',
        'banco',
        'barra de dominadas',
      ],
      parameters: {
        e1rmFormula: 'epley_rir',
        e1rmMinReps: DEFAULT_E1RM_PROTOCOL.minReps,
        e1rmMaxReps: DEFAULT_E1RM_PROTOCOL.maxReps,
        e1rmMinRir: DEFAULT_E1RM_PROTOCOL.minRir,
      },
    },
  },
  mobility: {
    sports: null,
    attemptCount: 3,
    attemptAggregation: 'best',
    maximalLoad: false,
    protocol: {
      summary: 'Knee-to-wall (dorsiflexión de tobillo), por lado. 3 intentos, vale el mejor.',
      steps: [
        'Sin calzado; talón apoyado y rodilla alineada con el segundo dedo.',
        'Se mide la distancia máxima del dedo gordo a la pared con la rodilla tocándola.',
        '3 intentos por lado; vale el mejor.',
      ],
      equipment: ['cinta métrica', 'pared'],
    },
  },
  reaction: {
    sports: null,
    attemptCount: 5,
    attemptAggregation: 'mean',
    maximalLoad: false,
    protocol: {
      summary:
        'Reacción simple y go/no-go en la app. Solo se compara contra el mismo jugador y con el mismo equipo (la latencia táctil varía 30–80 ms entre equipos).',
      steps: [
        'Siempre el mismo celular o tablet: se registra el dispositivo.',
        'Brillo al máximo, modo avión y sin otras apps abiertas.',
        '1 serie de práctica y 5 estímulos válidos; vale el promedio.',
      ],
      equipment: ['celular o tablet del club (siempre el mismo)'],
      parameters: { sameDeviceOnly: true },
    },
  },
  neck: {
    // Contact-sport screening; not in the hockey battery until B-802 says otherwise.
    sports: ['rugby'],
    attemptCount: 3,
    attemptAggregation: 'best',
    maximalLoad: false,
    protocol: {
      summary:
        'Isométrico de cuello en 4 direcciones (flexión, extensión, lateral izquierda y derecha) con dinamómetro (Fase 2). 3 intentos por dirección, vale el mejor.',
      steps: [
        'Sentado, tronco fijo, dinamómetro a la altura de la frente, la nuca o la sien.',
        'Contracción máxima de 3 a 5 s, sin impulso.',
        '3 intentos por dirección con 30 s de pausa; vale el mejor.',
      ],
      restBetweenAttemptsS: 30,
      equipment: ['dinamómetro'],
    },
  },
};

/** Version 1 of every canonical test, in battery order. */
export function testDefinitionSeeds(): TestDefinitionSeed[] {
  return CANONICAL_TEST_CODES.map((code) => ({
    code,
    ...SPECS[code],
    metrics: canonicalMetricsOfTest(code),
  }));
}

/** Whether a seeded test applies to a sport. */
export function testAppliesToSport(
  test: Pick<TestDefinitionSeed, 'sports'>,
  sport: Sport,
): boolean {
  return test.sports === null || test.sports.includes(sport);
}
