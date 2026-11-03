/**
 * Messages of the test day screens of the staff web (B-405): the list of test days and the sheet
 * of a day (stations, attempts, best attempt, not done, plausibility, batch). Merged into the
 * `es-AR` source catalog; same rules as `es-AR.ts`. Every key starts with `testDay.`.
 */
export const webTestDayMessagesEsAR = {
  'testDay.nav': 'Días de test',

  // List of test days
  'testDay.list.title': 'Días de test',
  'testDay.list.subtitle': 'Los días de test de lo que ves, con su ventana y su estado.',
  'testDay.list.upcoming': 'Hoy y próximos',
  'testDay.list.past': 'Anteriores',
  'testDay.list.emptyUpcoming': 'No hay días de test programados.',
  'testDay.list.emptyPast': 'Todavía no hubo días de test.',
  'testDay.list.more': 'Ver más',
  'testDay.list.date': 'Fecha',
  'testDay.list.category': 'Categoría',
  'testDay.list.window': 'Ventana',
  'testDay.list.location': 'Lugar',
  'testDay.list.status': 'Estado',
  'testDay.list.historical': 'Histórico importado',

  // Status of a day
  'testDay.status.scheduled': 'Programado',
  'testDay.status.in_progress': 'En curso',
  'testDay.status.completed': 'Cerrado',
  'testDay.status.cancelled': 'Suspendido',
  'testDay.window.none': 'Sin ventana',

  // Header of a day
  'testDay.title': 'Día de test {category}',
  'testDay.titleNoCategory': 'Día de test',
  'testDay.subtitle': '{window} · {date}',
  'testDay.location': 'Lugar: {location}',
  'testDay.conditions.title': 'Condiciones',
  'testDay.conditions.surface': 'Superficie: {value}',
  'testDay.conditions.footwear': 'Calzado: {value}',
  'testDay.conditions.weather': 'Clima: {value}',
  'testDay.conditions.temperature': 'Temperatura: {value}',
  'testDay.conditions.warmUp': 'Entrada en calor estandarizada',
  'testDay.conditions.noWarmUp': 'Sin entrada en calor estandarizada',
  'testDay.conditions.none': 'Sin condiciones cargadas.',
  'testDay.notes': 'Notas: {notes}',
  'testDay.action.start': 'Empezar el día',
  'testDay.action.complete': 'Cerrar el día',
  'testDay.action.reopen': 'Reabrir el día',
  'testDay.action.conflict':
    'Alguien cambió este día mientras lo mirabas. Ya lo actualizamos: revisalo y probá de nuevo.',
  'testDay.cancelled':
    'Este día está suspendido y no recibe resultados. Para volver a programarlo, usá el calendario.',
  'testDay.readOnly':
    'Ves la planilla en modo lectura: los resultados los carga el preparador físico de la categoría.',
  'testDay.noStations':
    'La batería no programa tests para este día ni hay resultados cargados. Revisá la batería del club.',
  'testDay.noPlayers': 'No hay jugadores de la categoría que puedas ver en este día.',

  // Stations
  'testDay.stations': 'Estaciones',
  'testDay.station.progress': '{done} de {total} con resultado',
  'testDay.station.extra': 'Fuera de la batería del día',
  'testDay.protocol.show': 'Protocolo, versión {version}',
  'testDay.protocol.attempts':
    '{count, plural, one {# intento} other {# intentos}}, {aggregation, select, mean {vale el promedio} other {vale el mejor}}.',
  'testDay.protocol.rest': 'Pausa entre intentos: {duration}.',
  'testDay.protocol.equipment': 'Material: {equipment}.',
  'testDay.mode.label': 'Cómo se carga',
  'testDay.mode.sprint_splits': 'Parciales 10/20/40 m',
  'testDay.mode.cmj_flight_time': 'Tiempo de vuelo',
  'testDay.mode.ift_stage': 'Última etapa completa',
  'testDay.mode.strength_set': 'Serie: peso, repeticiones y RIR',
  'testDay.mode.value': 'Valor medido',
  'testDay.mode.changeLosesDrafts':
    'Cambiar cómo se carga borra lo que escribiste en esta estación y todavía no guardaste.',
  'testDay.mode.unconfirmed':
    'Hay un guardado sin confirmar: guardá de nuevo hasta que se confirme antes de cambiar cómo se carga.',
  'testDay.method.station': 'Método de la estación',
  'testDay.method.row': 'Método de {player}',
  'testDay.exercise.label': 'Ejercicio',
  'testDay.exercise.help':
    'En minúsculas y con guion bajo, por ejemplo goblet_squat o trap_bar_deadlift.',
  'testDay.device.label': 'Equipo',
  'testDay.device.help':
    'Este test solo se compara con el mismo equipo: se guarda con cada resultado.',
  'testDay.device.choose': 'Elegí un equipo',
  'testDay.device.empty':
    'El club no tiene equipos registrados: este test se carga desde la app con el equipo de siempre.',

  // Table of a station
  'testDay.table.caption': '{station}: un renglón por jugador',
  'testDay.table.player': 'Jugador/a',
  'testDay.table.attempt': 'Intento {number}',
  'testDay.table.result': 'Resultado',
  'testDay.table.best': 'Mejor',
  'testDay.table.previous': 'Anterior',
  'testDay.table.method': 'Método',
  'testDay.table.state': 'Estado',
  'testDay.input.label': '{field}, intento {number}, {player}',
  'testDay.best.marker': 'Mejor intento',
  'testDay.best.mean': 'Promedio',
  'testDay.row.done': 'Realizado',
  'testDay.row.notDone': 'No realizado',
  'testDay.row.stateLabel': 'Estado de {player}',
  'testDay.row.pending': 'Pendiente',
  'testDay.row.notInCategory': 'Ya no está en la categoría',
  'testDay.row.notApplicable.not_in_battery': 'No está en la batería de su etapa.',
  'testDay.row.notApplicable.maximal_load_not_allowed': 'Su etapa no hace tests con carga máxima.',
  'testDay.row.missingConsent':
    'Sin consentimiento de datos vigente: no se le pueden cargar resultados.',
  'testDay.row.forbidden': 'No podés cargarle resultados.',
  'testDay.reason.label': 'Motivo de {player}',
  'testDay.reason.choose': 'Elegí el motivo',
  'testDay.reason.absent': 'Ausente',
  'testDay.reason.injured': 'Lesionado/a',
  'testDay.reason.not_applicable_to_stage': 'No corresponde a la etapa',
  'testDay.reason.other': 'Otro motivo',
  'testDay.reason.unavailable': 'No disponible',
  'testDay.note.label': 'Nota del motivo de {player}',
  'testDay.stage.foundation': 'Formación',
  'testDay.stage.development': 'Desarrollo',
  'testDay.stage.performance': 'Rendimiento',
  'testDay.previous.none': 'Sin resultado anterior',
  'testDay.previous.on': '{value}, {date}',
  'testDay.previous.otherMethod': 'Medido con otro método ({method}): no es comparable directo.',
  'testDay.previous.otherVersion': 'Con otra versión del protocolo (v{version}).',

  // Fields typed per attempt (raw inputs) and metric labels (canonical codes)
  'testDay.field.split10S': '10 m (s)',
  'testDay.field.split20S': '20 m (s)',
  'testDay.field.split40S': '40 m (s)',
  'testDay.field.flightTimeMsec': 'Vuelo (ms)',
  'testDay.field.lastCompletedStage': 'Etapa',
  'testDay.field.loadKg': 'Peso (kg)',
  'testDay.field.reps': 'Reps',
  'testDay.field.rir': 'RIR',
  'testDay.metric.sprint_10_s': '10 m',
  'testDay.metric.sprint_20_s': '20 m',
  'testDay.metric.sprint_40_s': '40 m',
  'testDay.metric.sprint_vmax_ms': 'Vmax',
  'testDay.metric.cmj_height_cm': 'Altura',
  'testDay.metric.cod505_left_s': 'Izquierda',
  'testDay.metric.cod505_right_s': 'Derecha',
  'testDay.metric.cod505_asymmetry_pct': 'Asimetría',
  'testDay.metric.vift_kmh': 'VIFT',
  'testDay.metric.bronco_time_s': 'Tiempo',
  'testDay.metric.pushups_n': 'Flexiones',
  'testDay.metric.pullups_n': 'Dominadas',
  'testDay.metric.plank_s': 'Plancha',
  'testDay.metric.technique_score': 'Nota técnica',
  'testDay.metric.e1rm_kg': 'e1RM',
  'testDay.metric.rm1_kg': '1RM',
  'testDay.metric.rm3_kg': '3RM',
  'testDay.metric.relative_strength_kg_kg': 'Fuerza relativa',
  'testDay.metric.knee_to_wall_left_cm': 'Izquierda',
  'testDay.metric.knee_to_wall_right_cm': 'Derecha',
  'testDay.metric.reaction_simple_msec': 'Simple',
  'testDay.metric.reaction_go_no_go_msec': 'Go/no-go',
  'testDay.metric.neck_flexion_newton': 'Flexión',
  'testDay.metric.neck_extension_newton': 'Extensión',
  'testDay.metric.neck_left_newton': 'Lateral izquierda',
  'testDay.metric.neck_right_newton': 'Lateral derecha',
  'testDay.metric.value': '{metric}: {value}',

  // Problems of a row before sending
  'testDay.problem.number': 'Escribí un número, con coma decimal.',
  'testDay.problem.integer': 'Tiene que ser un número entero.',
  'testDay.problem.positive': 'Tiene que ser mayor que cero.',
  'testDay.problem.nonNegative': 'No puede ser negativo.',
  'testDay.problem.required': 'Falta {field}.',
  'testDay.problem.domain':
    'Los valores del intento {number} no cierran: los parciales tienen que crecer y el resto ser positivos.',
  'testDay.problem.attempt': 'Intento {number}: {problem}',
  'testDay.problem.reason': 'Elegí el motivo.',
  'testDay.problem.note': 'Escribí una nota para «Otro motivo».',
  'testDay.problem.exercise': 'Escribí el ejercicio de la estación.',
  'testDay.problem.device': 'Elegí el equipo de la estación.',
  'testDay.plausibility.outOfRange':
    'Intento {number}: {value} está fuera del rango habitual ({min} a {max}). Se puede guardar igual.',
  'testDay.plausibility.suggestion': '¿Quisiste decir {value}?',

  // Problems the API found in the batch
  'testDay.issue.stage': 'No le corresponde a su etapa: cargalo como «No corresponde a la etapa».',
  'testDay.issue.entries': 'Revisá los intentos.',
  'testDay.issue.method': 'Revisá el método.',
  'testDay.issue.device': 'Falta el equipo.',
  'testDay.issue.exercise': 'Revisá el ejercicio.',
  'testDay.issue.note': 'Falta la nota del motivo.',
  'testDay.issue.player': 'No está en la categoría ni el deporte de este día.',
  'testDay.issue.definition': 'La versión del protocolo no está vigente ese día.',
  'testDay.issue.other': 'Revisá esta fila.',
  'testDay.issue.attempt': 'Intento {number}: {problem}',
  'testDay.issue.attemptField': 'Intento {number}: revisá {field}.',

  // Saving
  'testDay.save':
    '{count, plural, =0 {Guardar la estación} one {Guardar # resultado} other {Guardar # resultados}}',
  'testDay.saving': 'Guardando…',
  'testDay.saved':
    '{count, plural, one {Se guardó # resultado.} other {Se guardaron # resultados.}}',
  'testDay.save.nothing': 'No hay nada nuevo para guardar en esta estación.',
  'testDay.save.problems': 'Hay filas para revisar antes de guardar. No se mandó nada.',
  'testDay.save.rejected': 'No se guardó nada: la API marcó filas para revisar.',
  'testDay.save.notApplicable':
    '{count, plural, one {Al guardar, # jugador sin cargar queda como «No corresponde a la etapa».} other {Al guardar, # jugadores sin cargar quedan como «No corresponde a la etapa».}}',
  'testDay.save.replayedStale':
    'Estas filas ya se habían guardado en un envío anterior que no llegó a responder, y quedaron como se mandaron la primera vez, sin los cambios posteriores: {players}. Revisalas y agregá o anulá intentos desde el resultado guardado.',
  'testDay.unsaved':
    '{count, plural, one {# fila con cambios sin guardar.} other {# filas con cambios sin guardar.}}',

  // A recorded result
  'testDay.recorded.notDone': 'No realizado: {reason}',
  'testDay.recorded.note': 'Nota: {note}',
  'testDay.entry.voided': 'Anulado: {reason}',
  'testDay.entry.void': 'Anular',
  'testDay.entry.voidLabel': 'Anular el intento {number} de {player}',
  'testDay.void.reason': 'Motivo de la anulación',
  'testDay.void.confirm': 'Anular el intento',
  'testDay.void.done': 'Intento anulado. Queda en el historial con su motivo.',
  'testDay.addAttempt': 'Agregar intento',
  'testDay.addAttempt.label': 'Agregar el intento {number} de {player}',
  'testDay.addAttempt.save': 'Guardar el intento',
  'testDay.addAttempt.done': 'Intento agregado.',
  'testDay.protocolIssue.reps_below_protocol': 'Menos repeticiones que las del protocolo.',
  'testDay.protocolIssue.reps_above_protocol': 'Más repeticiones que las del protocolo.',
  'testDay.protocolIssue.rir_below_protocol':
    'RIR por debajo del mínimo del protocolo: nunca al fallo.',
} as const;
