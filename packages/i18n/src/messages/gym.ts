/**
 * Messages of the gym (B-607, ADR 0075) that the web and the mobile app share: the names of
 * the exercises of the library (`gym.exercise.<code>`), load kinds, measures, how strength is
 * assessed in each stage and the warnings of a set. Merged into the `es-AR` source catalog;
 * the screens of each app keep their own texts in `web-gym.ts` and `mobile-gym.ts`.
 */
export const gymMessagesEsAR = {
  'nav.gym': 'Gimnasio',

  // Exercises of the library (GYM_EXERCISE_LIBRARY of the domain)
  'gym.exercise.push_up': 'Flexiones de brazos',
  'gym.exercise.pull_up': 'Dominadas',
  'gym.exercise.inverted_row': 'Remo invertido',
  'gym.exercise.bodyweight_squat': 'Sentadilla con peso corporal',
  'gym.exercise.stick_overhead_squat': 'Sentadilla con palo arriba',
  'gym.exercise.stick_romanian_deadlift': 'Peso muerto rumano con palo',
  'gym.exercise.split_squat': 'Sentadilla búlgara sin carga',
  'gym.exercise.walking_lunge': 'Estocadas caminando',
  'gym.exercise.glute_bridge': 'Puente de glúteos',
  'gym.exercise.nordic_curl': 'Curl nórdico',
  'gym.exercise.copenhagen_plank': 'Plancha Copenhague',
  'gym.exercise.plank': 'Plancha',
  'gym.exercise.side_plank': 'Plancha lateral',
  'gym.exercise.goblet_squat': 'Sentadilla goblet',
  'gym.exercise.trap_bar_deadlift': 'Peso muerto con barra hexagonal',
  'gym.exercise.back_squat': 'Sentadilla trasera',
  'gym.exercise.front_squat': 'Sentadilla frontal',
  'gym.exercise.romanian_deadlift': 'Peso muerto rumano',
  'gym.exercise.hip_thrust': 'Hip thrust',
  'gym.exercise.bench_press': 'Press de banca',
  'gym.exercise.overhead_press': 'Press militar',
  'gym.exercise.dumbbell_row': 'Remo con mancuerna',
  'gym.exercise.power_clean': 'Cargada de potencia',
  'gym.exercise.weighted_pull_up': 'Dominadas con lastre',
  'gym.exercise.weighted_dip': 'Fondos con lastre',

  // Load kinds and measures
  'gym.loadKind.external': 'Con carga',
  'gym.loadKind.bodyweight': 'Peso corporal o palo',
  'gym.loadKind.bodyweight_plus': 'Peso corporal con lastre',
  'gym.measure.reps': 'Repeticiones',
  'gym.measure.duration': 'Tiempo',

  // How strength is assessed in the stage
  'gym.assessment.technique_reps': 'Técnica con peso corporal o palo (M13/M14)',
  'gym.assessment.estimated_rm': 'Fuerza submáxima con RIR, e1RM (M15/M16)',
  'gym.assessment.direct_rm': 'Como la primera (M17/M19)',

  // Warnings of a set (advisory: the set is stored as done)
  'gym.warning.to_failure': 'Serie al fallo (RIR 0): en esta etapa nunca se va al fallo.',
  'gym.warning.rir_below_protocol': 'Menos repeticiones en reserva que las del protocolo.',
  'gym.warning.outside_e1rm_range':
    'Fuera del rango de repeticiones del protocolo: no estima el e1RM.',

  // Values of a set
  'gym.e1rm': 'e1RM',
  'gym.e1rm.help':
    'Máximo estimado con la fórmula de Epley con RIR: peso × (1 + (repeticiones + RIR) / 30). Solo con series del protocolo; nunca en M13/M14.',
  'gym.rir': 'RIR',
  'gym.rir.help': 'Repeticiones en reserva: cuántas más podrías haber hecho con buena técnica.',
  'gym.set.number': 'Serie {number}',
  'gym.set.reps': '{reps, plural, one {# repetición} other {# repeticiones}}',
  'gym.set.repsLoad': '{reps} × {load}',
  'gym.set.rir': 'RIR {rir}',
  'gym.set.technique': 'Técnica {score}/3',
  'gym.set.voided': 'Anulada',
  'gym.prescription.reps': '{sets} × {min}–{max} rep.',
  'gym.prescription.repsExact': '{sets} × {reps} rep.',
  'gym.prescription.duration': '{sets} × {duration}',
  'gym.prescription.rir': 'RIR {rir}',
  'gym.prescription.load': '{load} sugeridos',
  'gym.prescription.rest': 'Pausa {rest}',
} as const;
