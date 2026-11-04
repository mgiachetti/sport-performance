/**
 * Texts of the PDF report of a player for a test window (B-602, ADR 0071),
 * rendered by the worker for the player and their family. Plain language,
 * never a diagnosis; values arrive already formatted (es-AR, with their unit).
 * Metric, test, method and equation names come from the shared catalog.
 */
export const reportMessagesEsAR = {
  'report.title': 'Informe de rendimiento',
  'report.window': '{season} · Ventana V{number}',
  'report.windowDates': 'Del {from} al {to}',
  'report.generatedOn': 'Generado el {date}',
  'report.player.birth':
    'Nacimiento: {date} · {age, plural, one {# año} other {# años}} al cierre de la ventana',
  'report.player.categories': 'Categoría: {categories}',
  'report.player.sport': 'Deporte: {sport}',
  'report.windowOpen':
    'La ventana todavía no había terminado cuando se generó este informe: el promedio de la categoría aparece en un informe pedido después del cierre.',

  'report.tests.title': 'Tests de la ventana',
  'report.tests.metric': 'Test',
  'report.tests.value': 'Resultado',
  'report.tests.previous': 'Anterior',
  'report.tests.change': 'Cambio',
  'report.tests.category': 'Promedio categoría',
  'report.tests.firstTeam': 'Primera',
  'report.tests.empty': 'No tiene resultados de tests en esta ventana.',
  'report.tests.methods': 'Medido con: {methods} · protocolo v{version}.',
  'report.tests.previousNote': '{window} · {methods} · protocolo v{version}',
  'report.change.better': '{change} · mejor',
  'report.change.worse': '{change} · peor',
  'report.change.same': 'Igual',
  'report.change.neutral': '{change}',

  'report.warning.mixed_methods':
    'Ojo: su serie de {metric} mezcla métodos de medición y puede no ser comparable.',
  'report.warning.mixed_protocol_versions':
    'Ojo: su serie de {metric} mezcla versiones del protocolo del test.',
  'report.warning.mixed_devices': 'Ojo: su serie de {metric} se midió con equipos distintos.',
  'report.warning.mixed_exercises': 'Ojo: su serie de {metric} mezcla ejercicios.',
  'report.warning.categoryMethods':
    'El promedio de la categoría de {metric} mezcla métodos de medición.',
  'report.warning.categoryProtocols':
    'El promedio de la categoría de {metric} usa solo la versión del protocolo de su último resultado.',

  'report.notDone.title': 'Tests no realizados',
  'report.notDone.item': '{test} ({date}): {reason}',
  'report.notDone.reason.absent': 'ausente',
  'report.notDone.reason.injured': 'no disponible',
  'report.notDone.reason.unavailable': 'no disponible',
  'report.notDone.reason.not_applicable_to_stage': 'no corresponde a su etapa',
  'report.notDone.reason.other': 'otro motivo',

  'report.evolution.title': 'Evolución por ventana',
  'report.evolution.description':
    'Su resultado en cada ventana; debajo, en gris, el promedio de la categoría cuando lo hay.',
  'report.evolution.window': 'V{number} {season}',
  'report.evolution.day': 'Día {date}',
  'report.evolution.empty': 'Todavía no tiene resultados para comparar.',

  'report.maturation.title': 'Crecimiento y maduración',
  'report.maturation.measuredOn': 'Medición del {date}',
  'report.maturation.height': 'Talla',
  'report.maturation.sittingHeight': 'Talla sentado',
  'report.maturation.weight': 'Peso',
  'report.maturation.offset': 'Años desde el pico de crecimiento (PHV)',
  'report.maturation.offsetValue': '{value} ({equation})',
  'report.maturation.adultHeightPct': '% de la talla adulta predicha',
  'report.maturation.predictedAdultHeight': 'Talla adulta predicha',
  'report.maturation.growthVelocity': 'Velocidad de crecimiento',
  'report.maturation.peakZone':
    'Está en la etapa de mayor crecimiento: el staff ajusta el volumen de saltos y sprints y presta atención a molestias en rodilla y talón.',
  'report.maturation.empty': 'No hay mediciones hasta el cierre de la ventana.',

  'report.notes.title': 'Cómo leer este informe',
  'report.notes.method':
    'Cada resultado guarda cómo se midió (manual, video, fotocélula…). Resultados medidos con métodos o versiones del test distintos pueden no ser comparables: el informe lo avisa.',
  'report.notes.average':
    'El promedio de la categoría es el de jugadores de su misma categoría, sexo y versión del test, uno por jugador. Solo aparece con al menos 5 jugadores y con la ventana terminada. Nunca se muestran nombres ni resultados de otros jugadores.',
  'report.notes.firstTeam':
    'Primera es la referencia del plantel superior del club para la misma métrica: sirve para ver el camino, no es una meta para su edad.',
  'report.notes.offset':
    'Los años desde el pico de crecimiento son una estimación: negativo, antes del pico; positivo, después.',
  'report.legal':
    'Este informe resume tests y mediciones de entrenamiento. No diagnostica ni reemplaza al staff médico.',
  'report.footer': '{club} · {player} · {window}',
  'report.page': 'Página {page} de {pages}',
  'report.fileName': 'Informe {season} V{number} - {player}.pdf',
} as const;
