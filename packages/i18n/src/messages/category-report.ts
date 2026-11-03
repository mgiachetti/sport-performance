/**
 * Texts of the PDF report of a category for a test window (B-603, ADR 0073),
 * rendered by the worker for the staff and the club's sub-committee.
 * Aggregates only, never a diagnosis; values arrive already formatted (es-AR,
 * with their unit). Metric, test, sport, sex, stage and method names, the
 * not-done reasons, the window labels, the page and the legal notice come
 * from the shared catalog and the player report.
 */
export const categoryReportMessagesEsAR = {
  'categoryReport.title': 'Informe de categoría',
  'categoryReport.category.detail': '{sport} · {sex}',
  'categoryReport.roster':
    '{players, plural, =0 {Sin jugadores} one {# jugador} other {# jugadores}} en la categoría al cierre de la ventana',
  'categoryReport.roster.byStage': 'Por etapa: {stages}',
  'categoryReport.roster.stage': '{stage}: {players}',
  'categoryReport.stage.foundation': 'Formación (M13 / M14)',
  'categoryReport.stage.development': 'Desarrollo (M15 / M16)',
  'categoryReport.stage.performance': 'Rendimiento (M17 / M19)',
  'categoryReport.windowOpen':
    'La ventana todavía no había terminado cuando se generó este informe: los números de la ventana pueden cambiar.',

  'categoryReport.partialScope':
    'Atención: quien pidió este informe no ve hoy a todos los jugadores que estuvieron en la categoría en este período (por ejemplo, porque pasaron a una categoría que no tiene asignada). El plantel, la batería, la evolución y las respuestas cuentan solo a los que ve, así que los números pueden ser menores que los del informe completo. Para el informe completo, pedíselo a la administración del club.',

  'categoryReport.battery.title': 'Cumplimiento de la batería',
  'categoryReport.battery.description':
    'Por cada test que la batería programa en la ventana para la etapa de cada jugador: cuántos tenían que hacerlo (esperados), cuántos lo hicieron (con el porcentaje) y por qué no el resto.',
  'categoryReport.battery.test': 'Test',
  'categoryReport.battery.expected': 'Esperados',
  'categoryReport.battery.done': 'Hechos',
  'categoryReport.battery.absent': 'Ausentes',
  'categoryReport.battery.unavailable': 'No disponibles',
  'categoryReport.battery.notApplicable': 'No corresponde',
  'categoryReport.battery.other': 'Otro motivo',
  'categoryReport.battery.noRecord': 'Sin registro',
  'categoryReport.battery.total': 'Total de la batería',
  'categoryReport.battery.empty': 'La batería no programa tests para esta ventana.',

  'categoryReport.evolution.title': 'Evolución del grupo',
  'categoryReport.evolution.description':
    'Promedio de los jugadores actuales de la categoría en cada ventana, un valor por jugador (el mejor según el sentido); debajo, en gris, cuántos jugadores entran. Con menos de {min} jugadores no se muestra.',
  'categoryReport.evolution.metric': 'Métrica',
  'categoryReport.evolution.firstTeam': 'Primera',
  'categoryReport.evolution.players': '{players} jug.',
  'categoryReport.evolution.empty': 'Todavía no hay resultados del grupo para comparar.',
  'categoryReport.change.title': 'Cambio contra la ventana anterior',
  'categoryReport.change.description':
    'Cuántos jugadores mejoraron, empeoraron o quedaron igual entre la ventana anterior con resultados y esta, solo con el mismo método de medición y la misma versión del protocolo.',
  'categoryReport.change.item':
    '{metric} (desde {window}): {improved} mejoraron, {worsened} empeoraron, {unchanged} igual, de {paired}.',
  'categoryReport.change.empty': 'No hay suficientes jugadores medidos en las dos ventanas.',
  'categoryReport.warning.mixedMethods':
    'Ojo: el promedio de {metric} en {window} mezcla métodos de medición ({methods}).',
  'categoryReport.warning.mixedProtocols':
    'Ojo: el promedio de {metric} en {window} mezcla versiones del protocolo del test.',

  'categoryReport.responses.title': 'Tasa de respuesta',
  'categoryReport.responses.description':
    'Del {from} al {to}: bienestar de cada jugador en los días con sesión de la categoría (salvo ausentes o no disponibles) y RPE de cada sesión en la que participó.',
  'categoryReport.responses.sessionDays':
    '{days, plural, =0 {Sin días con sesión} one {# día con sesión} other {# días con sesión}}',
  'categoryReport.responses.week': 'Semana del',
  'categoryReport.responses.wellness': 'Bienestar',
  'categoryReport.responses.rpe': 'RPE',
  'categoryReport.responses.total': 'Total',
  'categoryReport.responses.rate': '{rate} ({answered} de {expected})',
  'categoryReport.responses.none': 'Sin datos',
  'categoryReport.responses.empty': 'No hubo sesiones de la categoría en el período.',

  'categoryReport.notes.title': 'Cómo leer este informe',
  'categoryReport.notes.aggregates':
    'El informe muestra solo números del grupo: nunca nombres ni resultados de un jugador. Un promedio o un conteo de cambios aparece con al menos {min} jugadores.',
  'categoryReport.notes.method':
    'Cada resultado guarda cómo se midió. Cuando una ventana mezcla métodos o versiones del test, el informe lo avisa y los cambios se cuentan solo con el mismo método y la misma versión.',
  'categoryReport.notes.unavailable':
    '"No disponible": el jugador no estaba en condiciones de hacer el test; el informe nunca dice por qué.',
  'categoryReport.notes.firstTeam':
    'Primera es la referencia del plantel superior del club para la misma métrica, deporte y sexo.',
  'categoryReport.footer': '{club} · {category} · {window}',
  'categoryReport.fileName': 'Informe {category} {season} V{number}.pdf',
} as const;
