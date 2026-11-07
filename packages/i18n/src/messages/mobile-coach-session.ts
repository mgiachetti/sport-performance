/**
 * Messages of the coach's session on the field in the mobile app (B-509, ADR 0080): the list of
 * today's and the week's sessions, the participation sheet (status, minutes and contacts), the
 * clock of who is on the field and the save through the offline queue. Merged into the `es-AR`
 * source catalog; same rules as `es-AR.ts`. Every key starts with `coachSession.`.
 */
export const mobileCoachSessionMessagesEsAR = {
  'coachSession.nav': 'Sesiones',

  // List
  'coachSession.list.title': 'Sesiones en cancha',
  'coachSession.list.subtitle':
    'Cargá minutos y contactos durante la sesión o después. Funciona sin conexión: se envía cuando haya señal.',
  'coachSession.list.today': 'Hoy',
  'coachSession.list.recent': 'Últimos {days} días',
  'coachSession.list.emptyToday': 'No hay sesiones de tus categorías para hoy.',
  'coachSession.list.emptyRecent': 'No hay sesiones de los últimos días.',
  'coachSession.list.loading': 'Cargando sesiones…',
  'coachSession.list.neverSynced':
    'Todavía no se sincronizaron las sesiones en este teléfono. Conectate un momento para bajarlas.',
  'coachSession.list.drafted': 'Cambios sin guardar',
  'coachSession.list.olderDrafts': 'Sin guardar de días anteriores',
  'coachSession.list.olderDraftsHint':
    'Estas sesiones ya salieron de la lista pero tienen cambios en el teléfono: guardalos o descartalos.',
  'coachSession.list.open': 'Abrir {title}',
  'coachSession.list.rostersFailed':
    'No pudimos bajar el plantel de {count, plural, one {# sesión} other {# sesiones}}. Probamos de nuevo cuando haya señal.',
  'coachSession.notAllowed':
    'La carga de minutos y contactos es del entrenador de la categoría o de la administración del club.',

  // A session
  'coachSession.kind.training': 'Entrenamiento',
  'coachSession.kind.match': 'Partido',
  'coachSession.session.untitledTraining': 'Entrenamiento {category}',
  'coachSession.session.untitledMatch': 'Partido {category}',
  'coachSession.session.matchAgainst': 'Partido contra {opponent}',
  'coachSession.session.noCategory': 'todo el deporte',
  'coachSession.session.when': '{kind} · {date} {time}',
  'coachSession.session.planned': '{minutes} min planificados',
  'coachSession.session.notFound':
    'Esta sesión ya no está en el teléfono: se archivó, cambió de categoría o todavía no se sincronizó.',
  'coachSession.back': 'Volver a sesiones',

  // Roster
  'coachSession.roster.loading': 'Bajando el plantel…',
  'coachSession.roster.missing':
    'El plantel de esta sesión no está en el teléfono. Conectate un momento para bajarlo; después podés cargar sin señal.',
  'coachSession.roster.stale':
    'Plantel guardado el {date} a las {time}: sin conexión no podemos ver si cambió.',
  'coachSession.roster.empty': 'No hay jugadores en esta sesión.',
  'coachSession.roster.retry': 'Bajar el plantel',

  // Player row
  'coachSession.player.calledUp': 'De otra categoría',
  'coachSession.player.leftClub': 'Dado de baja',
  'coachSession.player.noConsent': 'Sin consentimiento de datos: no se puede cargar.',
  'coachSession.player.notAllowed': 'No podés cargar a este jugador.',
  'coachSession.player.availability.available': 'Disponible',
  'coachSession.player.availability.limited': 'Con restricciones',
  'coachSession.player.availability.unavailable': 'No disponible',
  'coachSession.player.availability.unknown': 'Sin dato de disponibilidad',
  'coachSession.player.staffNote': 'Staff médico: {note}',
  'coachSession.player.unavailablePlaying':
    'El staff médico lo marcó no disponible y figura jugando. Revisalo antes de guardar.',
  'coachSession.player.status': 'Estado de {name}',
  'coachSession.player.minutes': 'Minutos',
  'coachSession.player.minutesOf': 'Minutos de {name}',
  'coachSession.player.contacts': 'Contactos',
  'coachSession.player.periods': 'Por tramo: {periods} min',
  'coachSession.player.contactsOf': 'Contactos de {name}',
  'coachSession.player.contactAdd': '+1',
  'coachSession.player.contactAddOf': 'Sumar un contacto a {name}',
  'coachSession.player.contactRemove': '−1',
  'coachSession.player.contactRemoveOf': 'Restar un contacto a {name}',
  'coachSession.player.rpe': 'RPE {rpe} · {srpe} UA',
  'coachSession.player.rpeNoLoad': 'RPE {rpe}',
  'coachSession.player.rpePending': 'RPE pendiente',
  'coachSession.player.edited': 'Sin guardar',
  'coachSession.player.error.minutes': 'Minutos: de 0 a {max}.',
  'coachSession.player.error.contacts': 'Contactos: de 0 a {max}.',
  'coachSession.player.onField': 'En cancha · {minutes} min',
  'coachSession.player.offField': 'Afuera · {minutes} min jugados',
  'coachSession.player.goIn': 'Entra',
  'coachSession.player.goInOf': 'Entra {name}',
  'coachSession.player.goOut': 'Sale',
  'coachSession.player.goOutOf': 'Sale {name}',
  'coachSession.status.full': 'Presente',
  'coachSession.status.partial': 'Limitado',
  'coachSession.status.absent': 'Ausente',
  'coachSession.status.unavailable': 'No disponible',

  // Clock
  'coachSession.clock.title': 'Reloj de la sesión',
  'coachSession.clock.hint':
    'Marcá quién entra y quién sale: los minutos de cada jugador salen del tiempo en cancha. Sigue contando aunque cierres la app.',
  'coachSession.clock.start': 'Arrancar reloj',
  'coachSession.clock.pause': 'Pausar',
  'coachSession.clock.endPeriod': 'Terminar el tramo',
  'coachSession.clock.periodHint':
    'Partido por tramos: cada pausa cierra un tramo y al terminar se pasan los minutos de cada tramo.',
  'coachSession.clock.periods':
    '{count, plural, =0 {Ningún tramo cerrado} one {# tramo cerrado} other {# tramos cerrados}}',
  'coachSession.clock.resume': 'Reanudar',
  'coachSession.clock.finish': 'Terminar y pasar los minutos',
  'coachSession.clock.running': 'Corriendo · {elapsed}',
  'coachSession.clock.paused': 'En pausa · {elapsed}',
  'coachSession.clock.onField':
    '{count, plural, =0 {Nadie en cancha} one {# en cancha} other {# en cancha}}',

  // Sheet actions
  'coachSession.fillPresent': 'Todos presentes ({minutes} min)',
  'coachSession.fillPresentNoMinutes': 'Todos presentes',
  'coachSession.summary.title': 'Resumen',
  'coachSession.tabs.label': 'Qué cargar',
  'coachSession.tabs.attendance': 'Asistencia',
  'coachSession.tabs.minutes': 'Minutos',
  'coachSession.tabs.contacts': 'Contactos',
  'coachSession.tabs.noStatus': '{count} sin estado',
  'coachSession.row.noLoad': '{status}: no suma carga',
  'coachSession.tabs.errors':
    '{count, plural, one {# jugador con error} other {# jugadores con error}}',
  'coachSession.summary.line':
    '{present} presentes · {absent} ausentes · {unavailable} no disponibles · {pending} sin cargar',
  'coachSession.summary.totals': '{minutes} min · {contacts} contactos',
  'coachSession.summary.minutesOnly': '{minutes} min',
  'coachSession.reason.label': 'Motivo de la corrección',
  'coachSession.reason.help':
    'Estás cambiando datos que ya estaban cargados: el cambio queda registrado con este motivo.',
  'coachSession.reason.required': 'Escribí el motivo de la corrección.',
  'coachSession.save':
    '{count, plural, =0 {Guardar} one {Guardar # jugador} other {Guardar # jugadores}}',
  'coachSession.saved':
    '{count, plural, one {Guardamos # jugador en el teléfono.} other {Guardamos # jugadores en el teléfono.}} Se envía cuando haya señal.',
  'coachSession.nothingToSave': 'No hay cambios para guardar.',
  'coachSession.invalidRows':
    'Hay minutos o contactos que no son válidos: revisá los jugadores marcados.',
  'coachSession.saveFailed': 'No pudimos guardar en el teléfono. Probá de nuevo.',
  'coachSession.discard': 'Descartar cambios',
  'coachSession.discardConfirm': 'Sí, descartar (también el reloj)',
  'coachSession.discardCancel': 'Seguir editando',
} as const;
