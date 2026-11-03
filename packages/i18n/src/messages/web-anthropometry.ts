/**
 * Messages of the anthropometry screen of the staff web (B-412): the sheet of a measurement day
 * with the maturation computed while typing, the parents' heights and the latest measurements.
 * Merged into the `es-AR` source catalog; same rules as `es-AR.ts`. Keys under `anthropometry.*`.
 */
export const webAnthropometryMessagesEsAR = {
  'anthropometry.nav': 'Antropometría',
  'anthropometry.title': 'Antropometría',
  'anthropometry.subtitle':
    'Carga del día de mediciones, con el offset de PHV y el % de talla adulta al instante.',
  'anthropometry.pickCategory':
    'Elegí una categoría en el selector de arriba para cargar o ver sus mediciones.',
  'anthropometry.readOnly':
    'Podés ver las mediciones de la categoría; la carga es del preparador físico asignado.',

  // Sheet of the day
  'anthropometry.sheet.title': 'Planilla del día',
  'anthropometry.sheet.caption': 'Mediciones de {category} del {date}',
  'anthropometry.sheet.date': 'Fecha de la medición',
  'anthropometry.sheet.dateHelp': 'Hoy por defecto, en la zona horaria del club.',
  'anthropometry.sheet.empty': 'La categoría no tiene jugadores activos.',
  'anthropometry.sheet.previewing': 'Calculando la maduración…',
  'anthropometry.sheet.save': 'Guardar {count, plural, one {# medición} other {# mediciones}}',
  'anthropometry.sheet.saving': 'Guardando…',
  'anthropometry.sheet.saved':
    '{count, plural, one {Guardaste # medición.} other {Guardaste # mediciones.}} La maduración guardada se recalcula en unos segundos.',
  'anthropometry.sheet.nothingToSave': 'Cargá al menos un valor para guardar.',
  'anthropometry.sheet.fixFirst': 'Hay valores para revisar: corregilos antes de guardar.',
  'anthropometry.sheet.fixDate': 'Revisá la fecha de la medición antes de guardar.',
  'anthropometry.sheet.rejected': 'No se guardó nada: revisá las filas marcadas y volvé a guardar.',

  // Columns and inputs
  'anthropometry.column.player': 'Jugador',
  'anthropometry.column.heightCm': 'Talla (cm)',
  'anthropometry.column.sittingHeightCm': 'Talla sentado (cm)',
  'anthropometry.column.weightKg': 'Peso (kg)',
  'anthropometry.column.skinfoldsSumMm': 'Σ pliegues ISAK (mm)',
  'anthropometry.column.phvOffset': 'Offset de PHV',
  'anthropometry.column.adultHeight': '% de talla adulta',
  'anthropometry.column.growthVelocity': 'Velocidad de crecimiento',
  'anthropometry.column.date': 'Fecha',
  'anthropometry.input.label': '{field} de {player}',

  // Values
  'anthropometry.value.offset': '{value} años',
  'anthropometry.value.adultHeight': '{pct} de {predicted}',
  'anthropometry.value.age': '{age} años',
  'anthropometry.equation.mirwald_2002': 'Mirwald 2002',
  'anthropometry.equation.moore_2015': 'Moore 2015',
  'anthropometry.equation.moore_2015_height': 'Moore 2015 (solo talla)',

  // Why a value is missing
  'anthropometry.gap.invalid_age': 'La fecha es anterior al nacimiento',
  'anthropometry.gap.height_missing': 'Falta la talla',
  'anthropometry.gap.sitting_height_missing': 'Falta la talla sentado',
  'anthropometry.gap.weight_missing': 'Falta el peso',
  'anthropometry.gap.parent_heights_missing': 'Falta la altura de los padres',
  'anthropometry.gap.age_outside_reference': 'Edad fuera de la tabla Khamis-Roche',
  'anthropometry.gap.no_reference_table': 'El club no tiene la tabla Khamis-Roche',
  'anthropometry.gap.prediction_rejected': 'Los datos no dan una predicción creíble',
  'anthropometry.blocked': 'Sin consentimiento de datos vigente: no se puede cargar.',

  // Plausibility and input errors
  'anthropometry.plausibility.below': 'Bajo para la edad (rango {min}–{max})',
  'anthropometry.plausibility.above': 'Alto para la edad (rango {min}–{max})',
  'anthropometry.plausibility.suggestion': '¿Quisiste decir {value}?',
  'anthropometry.error.number': 'Escribí un número con coma decimal (por ejemplo 165,4).',
  'anthropometry.error.range': 'Fuera de rango: entre 0 y {max}.',
  'anthropometry.error.sittingAboveHeight': 'Tiene que ser menor que la talla.',
  'anthropometry.error.skinfoldsStage': 'Los pliegues se miden solo en M17/M19.',
  'anthropometry.error.consent': 'Sin consentimiento de datos vigente.',
  'anthropometry.error.date': 'Revisá la fecha: no puede ser futura ni anterior al nacimiento.',
  'anthropometry.error.player': 'No podés cargar mediciones de este jugador.',
  'anthropometry.error.value': 'Revisá este valor.',

  // Reference table and verification of the coefficients
  'anthropometry.verification.title':
    'Coeficientes sin verificar contra la publicación original: tomá estos valores como orientativos.',
  'anthropometry.verification.khamisRoche': '% de talla adulta (Khamis-Roche): {status}.',
  'anthropometry.verification.offset': 'Offset de PHV ({equation}): {status}.',
  'anthropometry.verification.status.verified_against_publication':
    'verificados contra la publicación',
  'anthropometry.verification.status.cross_checked_secondary_sources':
    'coinciden entre varias fuentes secundarias, falta compararlos con el artículo original',
  'anthropometry.verification.status.unverified': 'sin verificar',
  'anthropometry.reference.none':
    'El club no tiene cargada la tabla Khamis-Roche: no se calcula el % de talla adulta.',

  // Parents' heights
  'anthropometry.parents.action': 'Cargar altura de los padres',
  'anthropometry.parents.title': 'Altura de los padres de {player}',
  'anthropometry.parents.mother': 'Madre (cm)',
  'anthropometry.parents.father': 'Padre (cm)',
  'anthropometry.parents.help': 'Entre {min} y {max} cm. Khamis-Roche usa las dos.',
  'anthropometry.parents.source': 'Origen',
  'anthropometry.parents.source.measured': 'Medida por el staff',
  'anthropometry.parents.source.reported': 'Informada',
  'anthropometry.parents.save': 'Guardar alturas',
  'anthropometry.parents.saved': 'Guardaste la altura de los padres de {player}.',

  // Latest measurements
  'anthropometry.recent.title': 'Últimas mediciones',
  'anthropometry.recent.caption': 'Últimas mediciones de {category}',
  'anthropometry.recent.empty': 'Todavía no hay mediciones de la categoría.',
  'anthropometry.recent.pending': 'Calculando…',
  'anthropometry.recent.more': 'Ver más',
} as const;
