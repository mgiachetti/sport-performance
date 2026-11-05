/**
 * Messages of the staff web's training screens (B-407): the list of sessions and matches, the
 * session form with its drills and the participation sheet of the coach (status, minutes,
 * contacts, the player's RPE and the derived availability). Merged into the `es-AR` source
 * catalog; same rules as `es-AR.ts`. Every key starts with `training.`.
 */
export const webTrainingMessagesEsAR = {
  'training.nav': 'Sesiones',

  // List
  'training.list.title': 'Sesiones y partidos',
  'training.list.subtitle':
    'Entrenamientos y partidos de tus categorías, con la participación de cada jugador.',
  'training.list.new': 'Nueva sesión',
  'training.list.empty': 'No hay sesiones con estos filtros.',
  'training.list.more': 'Ver más',
  'training.list.caption': 'Sesiones, de la más reciente a la más vieja',
  'training.list.when': 'Día y hora',
  'training.list.session': 'Sesión',
  'training.list.kind': 'Tipo',
  'training.list.category': 'Categoría',
  'training.list.duration': 'Duración',
  'training.list.state': 'Estado',
  'training.list.active': 'Activa',
  'training.filter.label': 'Filtros',
  'training.filter.kind': 'Tipo',
  'training.filter.kindAll': 'Entrenamientos y partidos',
  'training.filter.kindTraining': 'Solo entrenamientos',
  'training.filter.kindMatch': 'Solo partidos',
  'training.filter.from': 'Desde',
  'training.filter.to': 'Hasta',
  'training.filter.status': 'Mostrar',
  'training.filter.statusActive': 'Activas',
  'training.filter.statusArchived': 'Archivadas',
  'training.filter.invalidRange': 'La fecha "desde" es posterior a "hasta".',

  // A session
  'training.kind.training': 'Entrenamiento',
  'training.kind.match': 'Partido',
  'training.session.untitledTraining': 'Entrenamiento {category}',
  'training.session.untitledMatch': 'Partido {category}',
  'training.session.matchAgainst': 'Partido contra {opponent}',
  'training.session.noCategory': 'Todo el deporte',
  'training.session.archived': 'Archivada',
  'training.session.minutes': '{minutes} min',

  // Form
  'training.form.kind': 'Tipo',
  'training.form.category': 'Categoría',
  'training.form.categoryPick': 'Elegí una categoría',
  'training.form.date': 'Día',
  'training.form.time': 'Hora de inicio',
  'training.form.timeHelp': 'Hora del club ({timeZone}).',
  'training.form.duration': 'Duración planificada (min)',
  'training.form.durationHelp': 'Opcional. Se usa para "Todos presentes".',
  'training.form.title': 'Título',
  'training.form.titleHelp': 'Opcional. Por ejemplo, "Defensa en el ruck".',
  'training.form.location': 'Lugar',
  'training.form.opponent': 'Rival',
  'training.form.notes': 'Notas',
  'training.form.error.required': 'Completá este dato.',
  'training.form.error.start': 'Ingresá un día y una hora válidos.',
  'training.form.error.duration': 'Un número entero de 1 a {max} minutos.',
  'training.form.error.invalid': 'Revisá este dato.',
  'training.form.noCategories':
    'No tenés categorías donde puedas crear sesiones. Pedile a la administración del club que te asigne.',

  // Create
  'training.new.title': 'Nueva sesión',
  'training.new.subtitle': 'Un entrenamiento o un partido, con sus bloques.',
  'training.new.submit': 'Crear sesión',
  'training.new.drillsHelp': 'Podés agregarlos ahora o después, desde la sesión.',

  // Drills
  'training.drills.title': 'Bloques',
  'training.drills.empty': 'Todavía no hay bloques.',
  'training.drills.total': 'Total de los bloques: {minutes} min',
  'training.drill.legend': 'Bloque {number}',
  'training.drill.name': 'Nombre del bloque',
  'training.drill.duration': 'Duración (min)',
  'training.drill.contactLevel': 'Contacto',
  'training.drill.add': 'Agregar bloque',
  'training.drill.remove': 'Quitar {name}',
  'training.drill.removeConfirm': 'Sí, quitar {name}',
  'training.drill.edit': 'Editar {name}',
  'training.drill.moveUp': 'Subir {name}',
  'training.drill.moveDown': 'Bajar {name}',
  'training.drill.untitled': 'el bloque',
  'training.contact.none': 'Sin contacto',
  'training.contact.controlled': 'Contacto controlado',
  'training.contact.full': 'Contacto pleno',

  // Detail
  'training.detail.back': 'Volver a sesiones',
  'training.detail.edit': 'Editar sesión',
  'training.detail.archive': 'Archivar',
  'training.detail.archiveConfirm': 'Sí, archivar',
  'training.detail.archiveHelp':
    'Archivar una sesión suspendida o cargada por error conserva la participación cargada.',
  'training.detail.restore': 'Restaurar',
  'training.detail.archivedNotice':
    'Esta sesión está archivada: no acepta cambios de bloques ni de participación. Restaurala para cargar.',
  'training.detail.data': 'Datos de la sesión',
  'training.detail.start': 'Inicio',
  'training.detail.saved': 'Guardamos los cambios de la sesión.',
  'training.detail.conflict':
    'Alguien cambió esto mientras lo editabas. Recargá para ver los datos actuales y volvé a intentar.',
  'training.detail.reload': 'Recargar datos',
  'training.reason.label': 'Motivo de la corrección',
  'training.reason.help':
    'Estás cambiando datos que ya estaban cargados: el cambio queda registrado con este motivo.',
  'training.reason.required': 'Escribí el motivo de la corrección.',

  // Participation
  'training.participation.title': 'Participación',
  'training.participation.caption':
    'Participación de la sesión: disponibilidad, estado, minutos, contactos y RPE de cada jugador',
  'training.participation.readOnly':
    'Ves la participación en modo lectura: la cargan el entrenador de la categoría o la administración.',
  'training.participation.empty': 'No hay jugadores en esta sesión.',
  'training.participation.player': 'Jugador',
  'training.participation.availability': 'Disponibilidad',
  'training.participation.status': 'Estado',
  'training.participation.minutes': 'Minutos',
  'training.participation.contacts': 'Contactos',
  'training.participation.rpe': 'RPE',
  'training.participation.srpe': 'sRPE (UA)',
  'training.participation.statusOf': 'Estado de {name}',
  'training.participation.minutesOf': 'Minutos de {name}',
  'training.participation.contactsOf': 'Contactos de {name}',
  'training.participation.period': 'Tramo {number}',
  'training.participation.periodOf': 'Minutos de {name} en el tramo {number}',
  'training.participation.totalMinutes': 'Total (min)',
  'training.participation.calledUp': 'De otra categoría',
  'training.participation.leftClub': 'Dado de baja',
  'training.participation.noConsent': 'Sin consentimiento de datos: no se puede cargar.',
  'training.participation.rpePending': 'Pendiente',
  'training.participation.fillPresent': 'Todos presentes ({minutes} min)',
  'training.participation.fillPresentNoMinutes': 'Todos presentes',
  'training.participation.save': 'Guardar participación',
  'training.participation.discard': 'Descartar cambios',
  'training.participation.pending':
    '{count, plural, one {# cambio sin guardar} other {# cambios sin guardar}}',
  'training.participation.saved':
    '{count, plural, =0 {No había cambios para guardar.} one {Guardamos la participación de # jugador.} other {Guardamos la participación de # jugadores.}}',
  'training.participation.invalidRows':
    'Hay minutos o contactos que no son válidos: revisá las filas marcadas.',
  'training.participation.error.minutes': 'De 0 a {max} minutos.',
  'training.participation.error.contacts': 'De 0 a {max}.',
  'training.participation.error.periods': 'Cada tramo y el total, de 0 a {max} minutos.',
  'training.status.none': 'Sin cargar',
  'training.status.full': 'Presente',
  'training.status.partial': 'Limitado',
  'training.status.absent': 'Ausente',
  'training.status.unavailable': 'No disponible',
  'training.availability.available': 'Disponible',
  'training.availability.limited': 'Con restricciones',
  'training.availability.unavailable': 'No disponible',
  'training.availability.unknown': 'Sin dato',

  // Summary
  'training.summary.title': 'Resumen',
  'training.summary.present': 'Presentes',
  'training.summary.absent': 'Ausentes',
  'training.summary.unavailable': 'No disponibles',
  'training.summary.minutes': 'Minutos jugados',
  'training.summary.rpe': 'RPE cargados',
  'training.summary.rpeOf': 'de {present}',
  'training.summary.load': 'Carga total (sRPE)',
} as const;
