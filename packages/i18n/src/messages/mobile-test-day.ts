/**
 * Messages of the field test day of the mobile app (B-505): the days, the stations and the
 * loading of each player without signal. Merged into the `es-AR` source catalog; same rules as
 * `es-AR.ts`. Every key starts with `fieldTest.`; what the staff web says the same way is reused
 * from `testDay.*` (`web-test-day.ts`) and `protocol.*` (`protocols.ts`).
 */
export const mobileTestDayMessagesEsAR = {
  'fieldTest.nav': 'Tests',

  // Days
  'fieldTest.list.intro':
    'Elegí el día para cargar los tests en la cancha. Los días de hoy y de la semana se guardan en el teléfono para usarlos sin señal.',
  'fieldTest.list.loading': 'Cargando los días de test…',
  'fieldTest.day.open': 'Abrir el día de test del {date}, {category}',
  'fieldTest.day.offlineReady': 'Disponible sin señal',
  'fieldTest.day.notDownloaded': 'Sin descargar: abrilo una vez con señal',
  'fieldTest.day.back': 'Volver a los días de test',
  'fieldTest.day.loading': 'Cargando la planilla del día…',
  'fieldTest.day.unavailableOffline':
    'No hay señal y esta planilla todavía no está guardada en el teléfono. Abrila una vez con señal para poder usarla sin conexión.',
  'fieldTest.day.savedAt': 'Planilla guardada en el teléfono el {date}.',
  'fieldTest.day.refreshFailed':
    'No pudimos actualizar la planilla: seguís con la guardada en el teléfono.',
  'fieldTest.day.refresh': 'Actualizar la planilla',

  // Stations
  'fieldTest.station.open': 'Abrir la estación {station}',
  'fieldTest.station.back': 'Volver a las estaciones',
  'fieldTest.station.settings': 'Ajustes de la estación',
  'fieldTest.station.settingsHint': 'Se recuerdan en este teléfono para este día.',
  'fieldTest.device.empty':
    'El club no tiene equipos registrados. Pedile a la administración que cargue el equipo de este test: sin equipo no se puede comparar.',
  'fieldTest.protocol.show': 'Ver el protocolo',
  'fieldTest.protocol.hide': 'Ocultar el protocolo',
  'fieldTest.next': 'Siguiente jugador sin cargar',
  'fieldTest.allDone': 'Todos los jugadores de la estación tienen resultado.',

  // A player at a station
  'fieldTest.player.open': 'Cargar a {player}',
  'fieldTest.player.close': 'Cerrar a {player}',
  'fieldTest.player.summary':
    '{count, plural, =0 {Sin intentos} one {# intento} other {# intentos}}',
  'fieldTest.previous.label': 'Anterior: {value}',
  'fieldTest.attempts.none': 'Sin intentos todavía.',
  'fieldTest.attempts.protocol': '{done} de {count} intentos del protocolo.',
  'fieldTest.attempt.form': 'Intento {number}',
  'fieldTest.attempt.save': 'Guardar el intento {number}',
  'fieldTest.attempt.saveAnyway': 'Guardar igual',
  'fieldTest.attempt.saved': 'Intento {number} guardado en el teléfono.',
  'fieldTest.attempt.pending': 'Sin enviar',
  'fieldTest.plausibility':
    '{field}: {value} está fuera del rango habitual ({min} a {max}). Revisalo; si está bien, tocá «Guardar igual».',
  'fieldTest.multipleResults':
    'Hay más de un resultado de este test para este jugador: lo cargaron varios evaluadores. Se muestran todos los intentos juntos y los nuevos van al primero.',

  // Sync state of a player
  'fieldTest.sync.queued': 'Sin enviar: se manda cuando haya señal',
  'fieldTest.sync.sent': 'Enviado, esperando la confirmación',
  'fieldTest.sync.saved': 'Guardado en el servidor',

  // Not done, not applicable, corrections
  'fieldTest.notDone.open': 'No realizado',
  'fieldTest.notDone.save': 'Guardar como no realizado',
  'fieldTest.notDone.saved': 'Guardado como no realizado en el teléfono.',
  'fieldTest.notDone.toDone':
    'Estaba como no realizado. Para cargarle intentos, escribí el motivo del cambio.',
  'fieldTest.notApplicable.one': 'Registrar como «No corresponde a la etapa»',
  'fieldTest.notApplicable.all':
    '{count, plural, one {Registrar # jugador como «No corresponde a la etapa»} other {Registrar # jugadores como «No corresponde a la etapa»}}',
  'fieldTest.notApplicable.saved':
    '{count, plural, one {# jugador registrado como «No corresponde a la etapa».} other {# jugadores registrados como «No corresponde a la etapa».}}',
  'fieldTest.changeReason.label': 'Motivo del cambio',
  'fieldTest.changeReason.hint': 'Queda en el historial del resultado.',
  'fieldTest.void.saved': 'Intento anulado. Queda en el historial con su motivo.',

  // 30-15 IFT with the signals of the app (B-507)
  'fieldTest.ift.hint':
    'Con las señales de la app: corré el test y, al terminar, guardá acá la etapa de cada jugador. También se puede cargar la última etapa a mano.',
  'fieldTest.ift.run': 'Correr el 30-15 con las señales',
  'fieldTest.ift.running':
    'Hay un 30-15 de esta categoría en curso en el teléfono: terminalo para guardar las etapas.',
  'fieldTest.ift.pending':
    '{count, plural, =0 {El 30-15 terminó sin etapas para guardar.} one {El 30-15 dejó # etapa en el teléfono para guardar en este día.} other {El 30-15 dejó # etapas en el teléfono para guardar en este día.}}',
  'fieldTest.ift.save': 'Guardar las etapas del 30-15',
  'fieldTest.ift.saved':
    '{count, plural, one {Se guardó # etapa en el teléfono.} other {Se guardaron # etapas en el teléfono.}}',
  'fieldTest.ift.skipped':
    '{count, plural, one {# jugador no se pudo guardar (sin consentimiento, fuera de su etapa o no realizado): cargalo a mano.} other {# jugadores no se pudieron guardar (sin consentimiento, fuera de su etapa o no realizados): cargalos a mano.}}',

  // Problems before queuing
  'fieldTest.problem.empty': 'Escribí el valor del intento.',
  'fieldTest.problem.changeReason': 'Escribí el motivo del cambio.',
  'fieldTest.problem.notApplicable':
    'Este test no le corresponde a su etapa: registralo como «No corresponde a la etapa».',
  'fieldTest.problem.hasAttempts':
    'Tiene intentos válidos: anulalos antes de marcarlo como no realizado.',
} as const;
