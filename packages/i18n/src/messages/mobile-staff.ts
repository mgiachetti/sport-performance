/**
 * Messages of the staff on the phone (B-510, ADR 0081): the quick look before training, the
 * detail and review of an alert, and the notifications of the phone (pushes and preferences).
 * Only the app uses them; merged into the `es-AR` source catalog with the same rules as
 * `es-AR.ts`. No key lives in more than one file.
 */
export const mobileStaffMessagesEsAR = {
  'nav.staff': 'Plantel',

  // Quick look before training
  'staff.board.title': 'Antes de entrenar',
  'staff.board.subtitle':
    'Quiénes no están disponibles, quiénes tienen una alerta y quiénes no cargaron el bienestar hoy.',
  'staff.board.loading': 'Cargando el plantel…',
  'staff.board.notAllowed': 'Esta vista es para el staff que sigue a los jugadores.',
  'staff.board.categories': 'Categoría',
  'staff.board.allCategories': 'Todas',
  'staff.board.fromSummary': 'Filtrado por la categoría de la sesión del aviso.',
  'staff.board.fromSummaryTitle': 'Filtrado por la categoría de «{title}».',
  'staff.board.stale':
    'Disponibilidad y alertas del {date}: el teléfono no pudo actualizarlas hoy. El bienestar de hoy es solo el que llegó por la sincronización.',
  'staff.board.counts': 'Resumen del plantel',
  'staff.board.count.unavailable':
    '{count, plural, one {# no disponible} other {# no disponibles}}',
  'staff.board.count.critical':
    '{count, plural, one {# con alerta crítica} other {# con alertas críticas}}',
  'staff.board.count.limited': '{count, plural, one {# limitado/a} other {# limitados/as}}',
  'staff.board.count.warning':
    '{count, plural, one {# con alerta de atención} other {# con alertas de atención}}',
  'staff.board.count.missingWellness':
    '{count, plural, one {# sin bienestar hoy} other {# sin bienestar hoy}}',
  'staff.board.attention': 'Para mirar antes de entrenar',
  'staff.board.missingWellness': 'Sin bienestar de hoy',
  'staff.board.allClear': 'Nadie en alerta ni no disponible.',
  'staff.board.clear':
    '{count, plural, one {# jugador/a sin novedades.} other {# jugadores sin novedades.}}',
  'staff.board.empty': 'No hay jugadores vigentes en lo que estás mirando.',
  'staff.board.wellnessToday': 'Bienestar de hoy cargado',
  'staff.board.wellnessMissing': 'Sin bienestar hoy',
  'staff.board.openAlert': 'Ver alerta',
  'staff.board.openAlertOf': 'Ver la alerta de {name}',
  'staff.board.alertUnknown': 'Alerta de una regla que esta versión de la app todavía no conoce.',
  'staff.board.heuristics':
    'Las alertas son heurísticas de carga, no diagnósticos. La disponibilidad la define el staff médico.',
  'staff.fetched':
    '{since, select, now {Actualizado recién.} minutes {Actualizado hace {count, plural, one {# minuto} other {# minutos}}.} hours {Actualizado hace {count, plural, one {# hora} other {# horas}}.} other {Actualizado hace {count, plural, one {# día} other {# días}}.}}',
  'staff.kept': 'Sin conexión: es lo último que trajo este teléfono.',
  'staff.retry': 'Volver a cargar',

  // An alert and its review
  'staff.alert.title': 'Alerta',
  'staff.alert.loading': 'Cargando la alerta…',
  'staff.alert.since': 'Desde el {raisedOn} · último día: {lastSeenOn}',
  'staff.alert.resolvedOn': 'Dejó de cumplirse el {date}.',
  'staff.alert.suggestion': 'Sugerencia',
  'staff.alert.review': 'Revisión',
  'staff.alert.reviewNote': 'Nota: {note}',
  'staff.alert.history': 'Historial',
  'staff.alert.event': '{date} · {event}',
  'staff.alert.event.raised': 'Se abrió',
  'staff.alert.event.escalated': 'Pasó a una severidad mayor',
  'staff.alert.event.resolved': 'Dejó de cumplirse',
  'staff.alert.event.reopened': 'Volvió a cumplirse',
  'staff.alert.event.acknowledged': 'Marcada como vista',
  'staff.alert.event.dismissed': 'Descartada',
  'staff.alert.note.label': 'Nota',
  'staff.alert.note.hint': 'Opcional para marcarla como vista; obligatoria para descartarla.',
  'staff.alert.note.required': 'Para descartarla, contá por qué no aplica.',
  'staff.alert.acknowledge': 'Marcar como vista',
  'staff.alert.dismiss': 'Descartar',
  'staff.alert.reviewed': 'Listo: la revisión quedó registrada.',
  'staff.alert.conflict':
    'La alerta cambió mientras la mirabas (alguien la revisó o cambió de severidad). La volvimos a cargar.',
  'staff.alert.notFound': 'No encontramos esta alerta. Puede que ya no la puedas ver.',
  'staff.alert.reviewOffline':
    'Sin conexión: para revisar una alerta hace falta señal, así lo hacés sobre su estado actual.',
  'staff.alert.fromBoard':
    'Sin conexión: mostramos lo que trajo la vista del plantel. El historial necesita señal.',
  'staff.alert.back': 'Volver al plantel',

  // Notifications of this phone
  'staff.push.channel': 'Avisos del club',
  'staff.push.prompt.title': 'Avisos en este teléfono',
  'staff.push.prompt.body':
    'Activá las notificaciones para enterarte de una alerta crítica y recibir el resumen antes de cada entrenamiento.',
  'staff.push.enable': 'Activar notificaciones',
  'staff.notifications.title': 'Notificaciones',
  'staff.notifications.open': 'Configurar notificaciones',
  'staff.notifications.privacy':
    'Las notificaciones nunca dicen nombres ni datos de salud: el detalle está en la app.',
  'staff.notifications.device': 'Recibir notificaciones en este teléfono',
  'staff.notifications.device.hint':
    'Si lo apagás, este teléfono deja de recibirlas. El email y tus otros dispositivos siguen como los configures.',
  'staff.notifications.status.unsupported':
    'Esta versión de la app no puede recibir notificaciones push.',
  'staff.notifications.status.off': 'Apagadas en este teléfono.',
  'staff.notifications.status.needsPermission':
    'Falta que el teléfono permita las notificaciones de la app.',
  'staff.notifications.status.denied':
    'El teléfono no permite las notificaciones de la app. Activalas desde los ajustes.',
  'staff.notifications.status.signedOut': 'Se registra este teléfono cuando ingreses.',
  'staff.notifications.status.pending':
    'Todavía no pudimos registrar este teléfono. Lo volvemos a intentar cuando haya conexión.',
  'staff.notifications.status.registered': 'Este teléfono recibe las notificaciones.',
  'staff.notifications.openSettings': 'Abrir los ajustes del teléfono',
  'staff.notifications.kinds': 'Qué te llega y por dónde',
  'staff.notifications.kind.rpe_request': 'Pedido del RPE al terminar la sesión',
  'staff.notifications.kind.rpe_reminder': 'Recordatorio del RPE a la mañana siguiente',
  'staff.notifications.kind.critical_alert': 'Alertas críticas',
  'staff.notifications.kind.pre_training_summary': 'Resumen antes de entrenar',
  'staff.notifications.channel.push': 'Push',
  'staff.notifications.channel.email': 'Email',
  'staff.notifications.switch': '{kind} por {channel}',
  'staff.notifications.none': 'Con tu rol en este club no recibís notificaciones.',
  'staff.notifications.offline':
    'Sin conexión: tus preferencias se ven como estaban y se pueden cambiar cuando vuelva la señal.',
  'staff.notifications.loading': 'Cargando tus preferencias…',
} as const;
