/**
 * Messages of the pods in the staff web (B-912, ADR 0106): the fleet of the
 * club in the administration (register, lost or stolen, recover, retire,
 * categories with pods) and the assignment of pods to players on a session
 * (consent state, assign, end, correct and void with a reason). Merged into
 * the `es-AR` source catalog; same rules as `es-AR.ts`; every key under
 * `pods.`.
 */
export const webPodsMessagesEsAR = {
  // Fleet
  'pods.fleet.title': 'Flota de pods',
  'pods.fleet.intro':
    'Los pods del club, con el número pintado en el pod y en su chaleco. Un pod perdido o robado deja de funcionar: sus claves se revocan.',
  'pods.fleet.empty': 'Todavía no hay pods en la flota.',
  'pods.fleet.number': 'Número',
  'pods.fleet.serial': 'Número de serie',
  'pods.fleet.status': 'Estado',
  'pods.fleet.lastSeen': 'Última conexión',
  'pods.fleet.battery': 'Batería',
  'pods.fleet.actions': 'Acciones',
  'pods.fleet.never': 'Nunca',
  'pods.fleet.borrowed': 'Prestado por otro club',
  'pods.status.active': 'Activo',
  'pods.status.lent': 'Prestado',
  'pods.status.lost': 'Perdido',
  'pods.status.stolen': 'Robado',
  'pods.status.retired': 'Retirado',
  'pods.action.lost': 'Marcar perdido',
  'pods.action.lostQuestion':
    'El pod {number} queda perdido: se revocan sus claves y termina su asignación en curso.',
  'pods.action.stolen': 'Marcar robado',
  'pods.action.stolenQuestion':
    'El pod {number} queda robado: se revocan sus claves y termina su asignación en curso.',
  'pods.action.recover': 'Recuperar',
  'pods.action.recoverHelp': 'Antes de usarlo, hay que volver a programarlo con claves nuevas.',
  'pods.action.retire': 'Retirar',
  'pods.action.retireQuestion':
    'El pod {number} sale de la flota y libera su número. Sus asignaciones pasadas quedan.',
  'pods.action.conflict':
    'No se pudo: el pod está asignado ahora o más adelante, está prestado o alguien lo cambió recién. Revisá la lista.',

  // Register
  'pods.register.title': 'Sumar un pod',
  'pods.register.intro':
    'Escaneá el QR del pod o escribí su número de serie, y el número que lleva pintado.',
  'pods.register.serial': 'Número de serie (QR)',
  'pods.register.number': 'Número del pod y del chaleco',
  'pods.register.submit': 'Sumar a la flota',
  'pods.register.invalidSerial': 'Revisá el número de serie: de 4 a 32 letras, números y guiones.',
  'pods.register.invalidNumber': 'Ingresá un número entre {min} y {max}.',
  'pods.register.notFound': 'Ese número de serie no es de un pod del club.',
  'pods.register.conflict':
    'Ese pod ya está en la flota, o el número o el id de red ya los tiene otro pod.',
  'pods.register.done': 'El pod {number} ya está en la flota.',

  // Categories with pods
  'pods.categories.title': 'Categorías con pods',
  'pods.categories.intro':
    'En qué categorías se pueden asignar pods (por defecto, M19). Las asignaciones ya hechas quedan.',
  'pods.categories.category': 'Categoría',
  'pods.categories.enabled': 'Con pods',
  'pods.categories.disabled': 'Sin pods',
  'pods.categories.enable': 'Habilitar',
  'pods.categories.disable': 'Deshabilitar',
  'pods.categories.empty': 'No hay categorías activas.',

  // Session
  'pods.session.title': 'Pods',
  'pods.session.intro':
    'Qué pod lleva cada jugador en esta sesión. Solo con el consentimiento de ubicación vigente.',
  'pods.session.notEnabled':
    'Esta categoría no tiene pods. La administración los habilita por categoría.',
  'pods.session.empty': 'No hay jugadores en la categoría de la sesión.',
  'pods.session.player': 'Jugador',
  'pods.session.consent': 'Consentimiento',
  'pods.session.assignment': 'Pod',
  'pods.session.actions': 'Acciones',
  'pods.session.consentOk': 'Ubicación vigente',
  'pods.session.missing.data': 'Falta el consentimiento de datos',
  'pods.session.missing.location': 'Falta el consentimiento de ubicación',
  'pods.session.missing.image': 'Falta el consentimiento de imagen',
  'pods.session.missing.health': 'Falta el consentimiento de salud',
  'pods.session.missing.menstrual_cycle': 'Falta el consentimiento del ciclo menstrual',
  'pods.session.none': 'Sin pod',
  'pods.session.podNumber': 'Pod {number}',
  'pods.session.since': 'desde {time}',
  'pods.session.range': '{start} a {end}',
  'pods.session.reprocess': 'Se reprocesa',
  'pods.session.pickPod': 'Pod para {player}',
  'pods.session.choosePod': 'Elegí un pod',
  'pods.session.noPods': 'No quedan pods libres en la flota.',
  'pods.session.assign': 'Asignar',
  'pods.session.end': 'Terminar',
  'pods.session.correct': 'Corregir',
  'pods.session.void': 'Anular',
  'pods.session.voidQuestion':
    'La asignación deja de contar y sus datos se reprocesan. Contá por qué.',
  'pods.session.startDate': 'Día de inicio',
  'pods.session.startTime': 'Hora de inicio',
  'pods.session.endDate': 'Día de fin',
  'pods.session.endTime': 'Hora de fin',
  'pods.session.endHelp': 'Vacío: lo sigue teniendo puesto.',
  'pods.session.reason': 'Motivo',
  'pods.session.reasonHelp': 'Queda en el historial de cambios.',
  'pods.session.reasonRequired': 'Contá por qué se corrige: queda en el historial.',
  'pods.session.invalidTime': 'Revisá el día y la hora.',
  'pods.session.save': 'Guardar corrección',
  'pods.session.confirmVoid': 'Anular asignación',

  // Errors of an assignment
  'pods.error.pod_overlap':
    'Ese pod ya lo tiene otro jugador en ese horario. Elegí otro pod o corregí la otra asignación.',
  'pods.error.player_overlap':
    'Este jugador ya tiene otro pod en ese horario. Terminá o corregí esa asignación primero.',
  'pods.error.pod_not_active': 'Ese pod no está activo (perdido, robado, prestado o retirado).',
  'pods.error.category_not_enabled': 'La categoría no tiene pods habilitados.',
  'pods.error.consent_required':
    'Falta el consentimiento de ubicación (o de datos) vigente del jugador: firmarlo es del jugador o su tutor.',
  'pods.error.conflict':
    'Alguien cambió esta asignación mientras la mirabas. Ya cargamos los datos de nuevo.',
} as const;
