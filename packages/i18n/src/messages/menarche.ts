/**
 * Vocabulary of the menarche record (B-805, ADR 0087), shared by the screens that show it:
 * the player's and her guardian's in the app and the medical staff's (B-410). Health data:
 * these texts never appear on a screen of the coach, the S&C staff or the administration.
 * Merged into the `es-AR` source catalog; same rules as `es-AR.ts`. Keys under `menarche.*`.
 */
export const menarcheMessagesEsAR = {
  'menarche.title': 'Primera menstruación',
  'menarche.privacy':
    'Es opcional y es un dato de salud: lo ven solo vos, tu familia mientras seas menor y el staff médico. El cuerpo técnico no lo ve.',
  'menarche.question': '¿Ya tuviste tu primera menstruación?',
  'menarche.status.not_yet': 'Todavía no',
  'menarche.status.occurred': 'Sí',
  'menarche.statusAsOf': 'Todavía no, al {date}',
  'menarche.occurredOn': 'Fecha',
  'menarche.precision.day': 'Sé el día exacto',
  'menarche.precision.month': 'Sé el mes',
  'menarche.precision.year': 'Sé solo el año',
  'menarche.reportedBy.player': 'Lo informó la jugadora',
  'menarche.reportedBy.parent': 'Lo informó su familia',
  'menarche.reportedBy.medical': 'Lo informó el staff médico',
  'menarche.ageAtMenarche': '{age} años',

  // Problems of a report
  'menarche.problem.date_required': 'Indicá la fecha, aunque sea el año.',
  'menarche.problem.precision_required': 'Indicá si sabés el día, el mes o solo el año.',
  'menarche.problem.date_without_menarche': 'Sin primera menstruación no va fecha.',
  'menarche.problem.date_after_report': 'La fecha no puede ser posterior a hoy.',
  'menarche.problem.date_before_birth': 'La fecha no puede ser anterior al nacimiento.',
  'menarche.problem.age_implausible': 'Revisá la fecha: la edad que da no es posible.',
  'menarche.problem.not_yet_implausible':
    'Revisá la respuesta con el staff médico: por la edad, no corresponde "todavía no".',

  // Check of the somatic offset (medical staff and the player)
  'menarche.check.title': 'Offset de maduración contra la menarca',
  'menarche.check.verdict.consistent': 'El offset es coherente con la menarca.',
  'menarche.check.verdict.offset_below_reference':
    'El offset da menos madura de lo que indica la menarca: la ecuación suele subestimar a las que maduran temprano.',
  'menarche.check.verdict.offset_above_reference':
    'El offset da más madura de lo que indica la menarca: la ecuación suele sobreestimar a las que maduran tarde.',
  'menarche.check.implied': 'Offset según la menarca: {value} años',
  'menarche.check.notDiagnosis':
    'Es una comparación de estimaciones para el seguimiento, no un diagnóstico.',
} as const;
