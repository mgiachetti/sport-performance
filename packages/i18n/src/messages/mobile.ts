/**
 * Messages only the mobile app uses (B-501, ADR 0058): sign-in with the family code, club
 * selector, startup, account and invitation links; the 30-15 IFT signals (B-507). Merged into the `es-AR` source catalog; same
 * rules as `es-AR.ts`. A message that the web also needs moves to `es-AR.ts` with one key, one
 * text and one set of arguments for both apps: no key lives in more than one file.
 */
export const mobileMessagesEsAR = {
  // Segmented tabs at the top of a screen (ADR 0104): the accessible name of a tab with its badge.
  'tabs.withBadge': '{label}, {badge}',

  // Sign-in (email OTP, bearer session)
  'auth.email.placeholder': 'nombre@ejemplo.com',
  'auth.otp.title': 'Revisá tu correo',
  'auth.withEmail': 'Ingresar con mi email',

  // Sign-in with the code or link of a parent or guardian
  'auth.playerAccess.link': 'Tengo un código de mi familia',
  'auth.playerAccess.title': 'Ingresá con el código de tu familia',
  'auth.playerAccess.body':
    'Pedile a tu mamá, papá o tutor/a que genere un código desde su cuenta. Sirve una sola vez y vence en {minutes, plural, one {# minuto} other {# minutos}}.',
  'auth.playerAccess.label': 'Código de ingreso',
  'auth.playerAccess.invalidFormat': 'El código tiene 8 letras y números, por ejemplo K7QM-2XPA.',
  'auth.playerAccess.notFound': 'No encontramos ese código. Revisalo o pedí uno nuevo.',
  'auth.playerAccess.unavailable':
    'Ese código o link ya no sirve: se usó, venció o se anuló. Pedí uno nuevo.',
  'auth.playerAccess.signingIn': 'Ingresando…',
  'auth.playerAccess.signedIn':
    'Ya hay una sesión abierta en este teléfono. Cerrala desde Cuenta para ingresar con este link.',

  // Club selector
  'club.select.body':
    'Tenés acceso a más de un club o con más de un rol. Elegí con cuál entrar; lo podés cambiar desde Cuenta.',
  'club.select.current': 'Club actual',
  'club.none.title': 'Todavía no tenés un club',
  'club.none.body':
    'Para usar la app, alguien del club tiene que invitarte. Abrí el link de la invitación que te llegó por email.',
  'club.membershipLost': 'Ya no tenés acceso a ese club con ese rol. Elegí con cuál seguir.',

  // Startup without a cached session snapshot
  'startup.unavailable.title': 'No pudimos conectarnos',
  'startup.unavailable.body':
    'La primera vez después de ingresar necesitamos conexión para traer tus clubes. Revisá la señal y probá de nuevo.',

  // Navigation and home
  'nav.account': 'Cuenta',
  'home.tools': 'Herramientas de cancha',
  'home.kiosk': 'Modo kiosco',

  // Account
  'account.title': 'Cuenta',
  'account.signedInAs': 'Ingresaste como {email}',
  'account.appearance': 'Apariencia',
  'account.highContrast': 'Alto contraste para usar al sol',
  'account.highContrast.hint': 'Fondo claro y textos más marcados.',
  'account.version': 'Versión {version}',
  'account.signOut.offline':
    'Sin conexión: la sesión se cierra en este teléfono. Para cerrarla también en el servidor, entrá desde otro dispositivo a Sesiones activas.',

  'account.signOut.pending':
    '{count, plural, one {Tenés # cambio sin enviar} other {Tenés # cambios sin enviar}}. Si cerrás sesión ahora, se pierden. Conectate y esperá a que se sincronice.',
  'account.signOut.confirm': 'Cerrar sesión igual',

  // Local database and sync (B-502)
  'sync.title': 'Sincronización',
  'sync.now': 'Sincronizar ahora',
  'sync.paused':
    'Sincronización en pausa hasta que vuelvas a ingresar o elijas tu club. Lo que cargues queda guardado en el teléfono.',
  'sync.never': 'Este teléfono todavía no se sincronizó.',
  'sync.lastSyncedNow': 'Sincronizado recién',
  'sync.lastSyncedMinutes':
    '{count, plural, one {Sincronizado hace # minuto} other {Sincronizado hace # minutos}}',
  'sync.lastSyncedHours':
    '{count, plural, one {Sincronizado hace # hora} other {Sincronizado hace # horas}}',
  'sync.lastSyncedDays':
    '{count, plural, one {Sincronizado hace # día} other {Sincronizado hace # días}}',
  // The quiet sync line (ADR 0103): one short line, only when something is off
  'sync.quiet.offline':
    '{count, plural, =0 {Sin conexión} one {Sin conexión · # cambio sin enviar} other {Sin conexión · # cambios sin enviar}}',
  'sync.quiet.offlineNever': 'Sin conexión · Este teléfono todavía no se sincronizó',
  'sync.quiet.sending': '{count, plural, one {Enviando # cambio…} other {Enviando # cambios…}}',
  'sync.quiet.failed':
    '{count, plural, =0 {No pudimos sincronizar} other {No pudimos sincronizar · # sin enviar}}',
  // The mark of an item that waits on the phone (a synced item shows nothing)
  'sync.item.pending': 'Sin enviar',
  'sync.issues.title': 'Cambios que no se aplicaron',
  'sync.issues.summary':
    '{count, plural, one {# cambio no se pudo aplicar. Revisalo en Cuenta.} other {# cambios no se pudieron aplicar. Revisalos en Cuenta.}}',
  'sync.issues.dismissAll': 'Descartar todos',
  'sync.issue.dismiss': 'Entendido',
  'sync.issue.rejected': 'No se guardó. {reason}',
  'sync.issue.superseded':
    'Alguien lo cambió después que vos y quedó su versión. Revisalo si hace falta.',
  'sync.reason.conflict':
    'Ya había una carga de ese dato, desde otro teléfono o la web. Revisá la que quedó y corregila si hace falta.',
  'sync.reason.forbidden': 'No tenés permiso para cargar esto.',
  'sync.reason.not_found': 'Lo que corregiste ya no existe o ya no lo podés ver.',
  'sync.op.wellness.submit': 'Bienestar',
  'sync.op.wellness.correct': 'Corrección de bienestar',
  'sync.op.rpe.submit': 'Esfuerzo de la sesión (RPE)',
  'sync.op.participation.record': 'Participación de la sesión',
  'sync.op.participation.update': 'Corrección de participación',
  'sync.op.test_result.create': 'Resultado de un test',
  'sync.op.test_session.record_results': 'Resultados del día de test',
  'sync.op.test_result.update': 'Corrección de un resultado',
  'sync.op.test_result.add_entries': 'Intentos de un test',
  'sync.op.test_result.void_entries': 'Anulación de intentos',
  'sync.op.pain_report.submit': 'Reporte de dolor',
  'sync.op.anthro.record': 'Medición antropométrica',
  'sync.op.anthro.update': 'Corrección de una medición antropométrica',

  // Invitation links
  'invitation.invalidLink':
    'El link de la invitación no es válido. Abrilo de nuevo desde el email que te llegó.',
  'invitation.goToClub': 'Entrar al club',
  'invitation.signIn': 'Ingresar para aceptar',
  // 30-15 IFT signals (B-507, ADR 0070)
  'ift.open': 'Audio del 30-15 IFT',
  'ift.open.hint': 'Señales del test generadas por la app, sin conexión.',
  'ift.title': '30-15 IFT',
  'ift.notAllowed':
    'El 30-15 IFT lo pasan el preparador físico y la administración del club con este teléfono.',
  'ift.lockScreen': '30-15 IFT en curso',
  'ift.setup.body':
    'La app genera las señales del test: dejala con la pantalla encendida y conectada a un parlante. Marcá a cada jugador cuando no llegue a la zona o se detenga.',
  'ift.setup.protocol':
    'Arranca a {speed} y suma {increment} por etapa: {work} s de carrera ida y vuelta en {shuttle} m y {recovery} s de pausa. Zonas de {zone} m en los extremos y en el centro; {misses, plural, one {# falta termina} other {# faltas seguidas terminan}} el test.',
  'ift.setup.category': 'Categoría',
  'ift.setup.chooseCategory': 'Elegí la categoría que va a correr.',
  'ift.setup.noCategories': 'No tenés categorías asignadas en este club.',
  'ift.setup.players':
    '{selected, plural, =0 {Ningún jugador elegido} one {# jugador elegido} other {# jugadores elegidos}} de {total, number}',
  'ift.setup.selectAll': 'Elegir todos',
  'ift.setup.selectNone': 'No elegir a nadie',
  'ift.setup.noPlayers': 'Esta categoría no tiene jugadores.',
  'ift.setup.start': 'Empezar el test',
  'ift.setup.preparing': 'Preparando el audio…',
  'ift.setup.audioError':
    'No pudimos preparar el audio. Revisá el volumen y que ninguna otra app esté usando el parlante, y probá de nuevo.',
  'ift.phase.lead_in': 'Preparados',
  'ift.phase.run': 'Carrera',
  'ift.phase.recovery': 'Pausa',
  'ift.phase.finished': 'Terminado',
  'ift.run.stage': 'Etapa {stage, number}',
  'ift.run.remaining': '{seconds, number} s',
  'ift.run.next': 'Próxima etapa: {speed}',
  'ift.run.status':
    '{phase}, etapa {stage, number} a {speed}. Quedan {seconds, plural, one {# segundo} other {# segundos}}.',
  'ift.run.miss': 'No llegó',
  'ift.run.miss.a11y': '{name} no llegó a la zona',
  'ift.run.stop': 'Terminó',
  'ift.run.stop.a11y': '{name} terminó el test',
  'ift.run.undo': 'Deshacer',
  'ift.run.undo.a11y': 'Deshacer la última marca de {name}',
  'ift.run.running': 'Corriendo',
  'ift.run.misses': 'Faltas seguidas: {count, number} de {max, number}',
  'ift.run.out': 'Afuera · última etapa completa: {stage, number}',
  'ift.run.finish': 'Terminar el test',
  'ift.run.finishConfirm':
    'Los que siguen corriendo quedan con la última etapa completa hasta ahora. ¿Terminar el test?',
  'ift.run.finishYes': 'Sí, terminar',
  'ift.run.allOut':
    'Ya terminaron todos. Terminá el test, o deshacé la última marca si fue un error.',
  'ift.run.keepGoing': 'Seguir con el test',
  'ift.run.skipped':
    '{count, plural, one {Una señal no sonó a tiempo y se salteó.} other {# señales no sonaron a tiempo y se saltearon.}} Dejá la app abierta durante el test.',
  'ift.interrupted.title': 'El test quedó a mitad de camino',
  'ift.interrupted.body': 'La app se cerró durante el test, en la etapa {stage, number} ({phase}).',
  'ift.interrupted.resumable':
    'Si siguen corriendo, retomalo ya con las marcas que tenías. Si lo terminás, los que seguían corriendo quedan con la última etapa completa cuando se cerró la app.',
  'ift.interrupted.tooLate':
    'Pasó demasiado tiempo para retomarlo. Al terminarlo, los que seguían corriendo quedan con la última etapa completa cuando se cerró la app: revisalas en los resultados.',
  'ift.interrupted.resume': 'Retomar el test',
  'ift.interrupted.finish': 'Terminarlo',
  'ift.results.title': 'Resultados del 30-15 IFT',
  'ift.results.stage': 'Etapa {stage, number}',
  'ift.results.vift': 'VIFT {vift}',
  'ift.results.noStage': 'No completó la etapa 1: no hay VIFT.',
  'ift.results.outcome.missed_lines': 'No llegó a la zona {count, number} veces seguidas',
  'ift.results.outcome.stopped': 'Se detuvo',
  'ift.results.outcome.completed': 'Completó todas las etapas',
  'ift.results.adjusted': 'Etapa corregida a mano',
  'ift.results.interrupted':
    'El test se terminó después de que se cerrara la app: revisá las etapas marcadas antes de cargarlas.',
  'ift.results.cutShort': 'Seguía corriendo cuando se cerró la app',
  'ift.results.stageDown.label': '−',
  'ift.results.stageUp.label': '+',
  'ift.results.stageDown': 'Restar una etapa a {name}',
  'ift.results.stageUp': 'Sumar una etapa a {name}',
  'ift.results.saveHint':
    'Guardá estas etapas desde la estación del 30-15 del día de test de la categoría: la VIFT se calcula sola. Quedan en este teléfono hasta que las guardes o las borres.',
  'ift.results.discard': 'Borrar del teléfono',
  'ift.results.discardConfirm': '¿Borrar estos resultados del teléfono? No se pueden recuperar.',
  'ift.results.discardYes': 'Sí, borrar',
  'ift.player.unknown': 'Jugador/a {number, number}',
} as const;
