/**
 * Messages of the reaction test in the app (B-606, ADR 0077): this phone as
 * a device of the club, choosing the player, the stimuli and the result
 * against the player's own on this device. Merged into the `es-AR` source
 * catalog; same rules as `es-AR.ts`.
 */
export const mobileReactionMessagesEsAR = {
  'reaction.open.hint': 'Simple y go/no-go en este teléfono, sin conexión.',
  'reaction.title': 'Test de reacción',
  'reaction.notAllowed':
    'El test de reacción lo toma el preparador físico o la administración del club.',
  'reaction.loading': 'Preparando el test…',
  'reaction.loadFailed':
    'No pudimos traer lo que necesita el test y este teléfono todavía no lo tiene guardado. Abrí la pantalla una vez con conexión.',
  'reaction.retry': 'Probar de nuevo',
  'reaction.offlineCopy':
    'Sin conexión: usás lo que este teléfono guardó la última vez. El resultado se envía cuando vuelva la señal.',
  'reaction.noDefinition':
    'El club no tiene una versión vigente del test de reacción. Revisalo en la configuración de la web.',

  // This phone as a device of the club
  'reaction.device.title': 'Este equipo',
  'reaction.device.registered':
    'Se mide con «{label}». Cada jugador se compara solo con sus tiempos en este mismo equipo.',
  'reaction.device.why':
    'La pantalla táctil agrega una demora propia (30 a 80 ms entre equipos): por eso el test se toma siempre en el mismo equipo y se registra cuál es.',
  'reaction.device.notRegistered': 'Este teléfono todavía no está registrado como equipo del club.',
  'reaction.device.retired':
    'Este teléfono estaba registrado como «{label}» y se retiró. Volvé a usarlo para tomar el test.',
  'reaction.device.label': 'Nombre del equipo',
  'reaction.device.labelHint': 'Cómo lo va a reconocer el staff, por ejemplo «Tablet del club 1».',
  'reaction.device.labelRequired': 'Poné un nombre de hasta 60 caracteres.',
  'reaction.device.register': 'Registrar este teléfono',
  'reaction.device.restore': 'Volver a usarlo',
  'reaction.device.needsConnection': 'Registrar el equipo necesita conexión: es una sola vez.',
  'reaction.device.failed': 'No pudimos registrar el equipo. Probá de nuevo con conexión.',
  'reaction.device.notAllowed':
    'Este teléfono no está registrado y tu rol no puede registrar equipos: pedíselo al preparador físico.',

  // Choosing the player
  'reaction.category.title': 'Categoría',
  'reaction.category.none': 'No tenés categorías asignadas.',
  'reaction.player.title': 'Jugador',
  'reaction.player.none': 'La categoría no tiene jugadores.',
  'reaction.player.loadFailed':
    'No pudimos traer el plantel y este teléfono no lo tiene guardado. Probá con conexión.',
  'reaction.player.choose': 'Elegí quién hace el test.',
  'reaction.handOver': 'Pasale el teléfono a {name}.',
  'reaction.cancel': 'Cancelar',

  // A series
  'reaction.task.simple': 'Reacción simple',
  'reaction.task.go_no_go': 'Go / no-go',
  'reaction.intro.simple':
    'Apoyá el teléfono en una mesa y tené el dedo listo. Cuando aparezca el círculo con «Tocá», tocá la pantalla lo más rápido que puedas. No toques antes.',
  'reaction.intro.go_no_go':
    'Ahora aparecen dos señales. Con el círculo «Tocá», tocá lo más rápido que puedas. Con el cuadrado «No toques», no toques nada y esperá la siguiente.',
  'reaction.intro.practice':
    'Los primeros {count, plural, one {# estímulo es de práctica} other {# estímulos son de práctica}}; después siguen hasta juntar {valid}.',
  'reaction.intro.series': 'Serie {number} de {total}',
  'reaction.begin': 'Empezar',
  'reaction.wait': 'Esperá…',
  'reaction.area': 'Zona para tocar',
  'reaction.stimulus.go': 'Tocá',
  'reaction.stimulus.no_go': 'No toques',
  'reaction.progress.practice': 'Práctica',
  'reaction.progress.valid': '{valid} de {needed}',
  'reaction.feedback.valid': '{time}',
  'reaction.feedback.anticipation': 'Antes de tiempo: esperá la señal',
  'reaction.feedback.lapse': 'Sin respuesta',
  'reaction.feedback.commission': 'Era para no tocar',
  'reaction.feedback.correct_rejection': 'Bien, no tocaste',
  'reaction.interrupted': 'La serie se cortó: la app salió de la pantalla. Empezala de nuevo.',

  // The result
  'reaction.result.title': 'Resultado de {name}',
  'reaction.result.mean': 'Promedio: {time}',
  'reaction.result.incomplete':
    'Serie incompleta: no juntó {valid} estímulos válidos. No se guarda; se puede repetir.',
  'reaction.result.errors':
    '{anticipations, plural, one {# anticipación} other {# anticipaciones}}, {lapses, plural, one {# sin respuesta} other {# sin respuesta}}',
  'reaction.result.commissions':
    '{commissions, plural, one {# error} other {# errores}} en {noGo, plural, one {# no-go} other {# no-go}}',
  'reaction.result.firstOnDevice': 'Es su primer resultado en este equipo.',
  'reaction.result.previous': 'Anterior en este equipo: {time} ({date})',
  'reaction.result.best': 'Su mejor en este equipo: {time}',
  'reaction.result.historyTitle': 'Sus resultados en este equipo',
  'reaction.result.historyHint':
    'Solo los suyos y en este mismo equipo: nunca contra otros jugadores.',
  'reaction.result.nothingToSave': 'Ninguna serie quedó completa: no hay nada para guardar.',
  'reaction.save': 'Guardar resultado',
  'reaction.saving': 'Guardando…',
  'reaction.saved': 'Guardado en el teléfono. Se envía con la próxima sincronización.',
  'reaction.saveFailed': 'No pudimos guardar el resultado en el teléfono. Probá de nuevo.',
  'reaction.discard': 'Descartar',
  'reaction.repeat': 'Repetir el test',
  'reaction.nextPlayer': 'Siguiente jugador',
  'reaction.notes.simple':
    'Reacción simple: {anticipations, plural, one {# anticipación} other {# anticipaciones}}, {lapses, plural, one {# sin respuesta} other {# sin respuesta}}.',
  'reaction.notes.go_no_go':
    'Go/no-go: {commissions, plural, one {# error de comisión} other {# errores de comisión}} en {noGo, plural, one {# no-go} other {# no-go}}, {anticipations, plural, one {# anticipación} other {# anticipaciones}}, {lapses, plural, one {# sin respuesta} other {# sin respuesta}}.',
} as const;
