/**
 * Messages of the sprint by video in the app (B-605, ADR 0082): the phone films the 40 m from
 * the side and the evaluator marks, frame by frame, the crossing of each line. Merged into the
 * `es-AR` source catalog; same rules as `es-AR.ts`.
 */
export const mobileSprintVideoMessagesEsAR = {
  'sprintVideo.open': 'Sprint por video',
  'sprintVideo.open.hint':
    'Tiempos de 10, 20 y 40 m filmando de costado en cámara lenta, sin conexión.',
  'sprintVideo.title': 'Sprint por video',
  'sprintVideo.intro':
    'Un celular de costado filma los 40 m en cámara lenta y vos marcás, cuadro a cuadro, cuándo el tronco cruza cada línea. El video no sale del teléfono: se borra al guardar el intento.',
  'sprintVideo.notAllowed':
    'El sprint por video lo filma quien carga resultados de tests y puede grabar a los jugadores.',

  // Days
  'sprintVideo.days.title': 'Elegí el día de test',
  'sprintVideo.days.empty':
    'No hay días de test desde ayer en este teléfono. Sincronizá con señal para traerlos.',
  'sprintVideo.days.item': '{place, select, none {{date}} other {{date} · {place}}}',
  'sprintVideo.day.loadFailed': 'No pudimos abrir el día de test.',
  'sprintVideo.day.needsSignal':
    'Para abrir el día la primera vez hace falta señal (de ahí sale a quién se puede filmar). Después funciona sin conexión.',
  'sprintVideo.day.noSprint':
    'Este día no tiene sprint, o su versión del protocolo no acepta tiempos por video.',

  // Layout of the field
  'sprintVideo.setup.title': 'Armado de la cancha',
  'sprintVideo.setup.body':
    'El celular va de costado, frente a la mitad del recorrido (20 m), en un trípode, acostado y quieto. Los conos van del otro lado del carril, un poco corridos para que "alineado con el cono" sea "cruzó la línea".',
  'sprintVideo.setup.cameraDistance': 'Distancia del celular al carril (m)',
  'sprintVideo.setup.cameraDistance.hint':
    'Con la cámara normal, a {distance} o más. Más cerca necesitás el gran angular.',
  'sprintVideo.setup.cameraDistance.invalid': 'Escribí un número, por ejemplo 35 o 32,5.',
  'sprintVideo.setup.cameraDistance.out_of_range': 'Tiene que estar entre 5 y 100 m.',
  'sprintVideo.setup.poleOffset': 'Conos detrás del carril (m)',
  'sprintVideo.setup.poleOffset.hint':
    'Del lado de enfrente, para que nadie los pise. 1 m está bien.',
  'sprintVideo.setup.poleOffset.invalid': 'Escribí un número, por ejemplo 1 o 1,5.',
  'sprintVideo.setup.poleOffset.out_of_range': 'Tiene que estar entre 0 y 10 m.',
  'sprintVideo.setup.cones': 'Dónde va cada cono',
  'sprintVideo.setup.camera': 'Celular: frente a los {at}, a {distance} del carril.',
  'sprintVideo.setup.cone': 'Línea de {line}: cono en los {at}, {behind} detrás del carril.',
  'sprintVideo.setup.coneBefore':
    'Línea de {line}: cono {before} antes de la línea de salida, {behind} detrás del carril.',
  'sprintVideo.setup.fieldOfView':
    'La cámara tiene que ver {angle}° de lado a lado: los cuatro conos en la imagen.',
  'sprintVideo.setup.oblique':
    'Muy cerca: la cámara ve de costado las líneas de los extremos y el cruce se marca peor. Alejá el celular.',
  'sprintVideo.setup.check':
    'Antes de filmar, mirá en la cámara que se vean los cuatro conos y que el celular esté derecho.',
  'sprintVideo.setup.continue': 'Listo, elegir jugador',

  // Players
  'sprintVideo.players.title': '¿A quién filmás?',
  'sprintVideo.players.layout': 'Ver el armado de la cancha',
  'sprintVideo.player.attempts':
    '{count, plural, =0 {Sin intentos de {planned}} one {# intento de {planned}} other {# intentos de {planned}}}',
  'sprintVideo.player.film': 'Filmar',
  'sprintVideo.player.filmName': 'Filmar el sprint de {name}',
  'sprintVideo.block.missing_image_consent':
    'Sin consentimiento de imagen vigente: no se lo puede filmar. Cargá sus tiempos en el día de test.',
  'sprintVideo.block.missing_data_consent':
    'Sin consentimiento de datos vigente: no se le pueden cargar resultados.',
  'sprintVideo.block.forbidden': 'No podés cargarle resultados a este jugador.',
  'sprintVideo.block.not_applicable': 'El sprint no corresponde a su etapa en este día.',

  // Recording
  'sprintVideo.record.how':
    'Poné el celular acostado. Empezá a grabar antes de la salida y pará cuando cruce los 40 m.',
  'sprintVideo.record.preparing': 'Preparando la cámara…',
  'sprintVideo.record.ready':
    'Cámara lista a {fps} cuadros por segundo. Se detiene sola a los {seconds} s.',
  'sprintVideo.record.noPermission':
    'La app no tiene permiso para usar la cámara. Dáselo desde los ajustes del teléfono.',
  'sprintVideo.record.unsupported':
    'La app no puede filmar a 120 cuadros por segundo o más con este teléfono. Filmá el sprint con la cámara lenta del teléfono y elegilo de la galería.',
  'sprintVideo.record.error': 'La cámara falló. Volvé a intentar.',

  // Import from the gallery (ADR 0102)
  'sprintVideo.import.pick': 'Elegir un video en cámara lenta',
  'sprintVideo.import.hint':
    'También podés filmar el sprint con la cámara lenta del teléfono, desde el mismo lugar, y elegirlo de la galería: se mide con los cuadros por segundo reales del archivo.',
  'sprintVideo.import.reading': 'Leyendo el video…',
  'sprintVideo.import.too_slow':
    'El video está a {fps} cuadros por segundo y hacen falta 120 o más. Si lo filmaste en cámara lenta, el teléfono lo guardó ralentizado sin la velocidad real: probá con otro modo de cámara lenta.',
  'sprintVideo.import.variable_rate':
    'El video mezcla tramos en cámara lenta y a velocidad normal: así no se puede medir. Filmalo con la cámara lenta en todo el video.',
  'sprintVideo.import.unreadable': 'No se pudieron leer los cuadros del video. Probá con otro.',
  'sprintVideo.import.too_large': 'El video es demasiado grande. Filmá solo el sprint.',
  'sprintVideo.import.format': 'El archivo no es un video MP4 o MOV.',
  'sprintVideo.import.failed': 'No se pudo abrir el video. Probá de nuevo.',
  'sprintVideo.record.recording': 'Grabando…',
  'sprintVideo.record.start': 'Grabar',
  'sprintVideo.record.stop': 'Parar',

  // Marking
  'sprintVideo.mark.title': '{name} · intento {number}',
  'sprintVideo.mark.how':
    'Buscá el cuadro en que el tronco queda alineado con el cono de cada línea y marcalo. El de 10 m es opcional.',
  'sprintVideo.mark.loadingFrame': 'Cargando el cuadro…',
  'sprintVideo.mark.frameFailed': 'No pudimos mostrar este cuadro. Probá con otro.',
  'sprintVideo.mark.frameImage': 'Cuadro {frame} de {total}',
  'sprintVideo.mark.frame': 'Cuadro {frame} de {total} · {time}',
  'sprintVideo.mark.back':
    '{count, plural, one {Retroceder # cuadro} other {Retroceder # cuadros}}',
  'sprintVideo.mark.forward': '{count, plural, one {Avanzar # cuadro} other {Avanzar # cuadros}}',
  'sprintVideo.mark.line.start': 'Salida ({line})',
  'sprintVideo.mark.line.line10': 'Línea de {line}',
  'sprintVideo.mark.line.line20': 'Línea de {line}',
  'sprintVideo.mark.line.line40': 'Llegada ({line})',
  'sprintVideo.mark.markCurrent': 'Marcar: {line}',
  'sprintVideo.mark.unmarked': 'Sin marcar',
  'sprintVideo.mark.optional': 'Sin marcar (opcional)',
  'sprintVideo.mark.atFrame': 'Cuadro {frame}',
  'sprintVideo.mark.select': 'Elegir',
  'sprintVideo.mark.selectLine': 'Elegir la marca: {line}',
  'sprintVideo.mark.goTo': 'Ir',
  'sprintVideo.mark.goToLine': 'Ir al cuadro de la marca: {line}',
  'sprintVideo.mark.clear': 'Borrar',
  'sprintVideo.mark.clearLine': 'Borrar la marca: {line}',
  'sprintVideo.mark.invalid':
    'Las marcas no siguen el orden de las líneas (salida, 10, 20 y 40 m). Revisalas.',
  'sprintVideo.mark.result': 'Resultado del intento',
  'sprintVideo.mark.split': '{line}: {time}',
  'sprintVideo.mark.vmax': 'Vmax (20–40 m): {speed}',
  'sprintVideo.mark.precision': 'Precisión: ±{split} por tiempo, ±{speed} en la Vmax (un cuadro).',
  'sprintVideo.mark.implausible':
    'Hay valores fuera de lo esperable. Revisá las marcas; si están bien, guardalo igual.',
  'sprintVideo.mark.saveFailed': 'No pudimos guardar el intento en el teléfono. Volvé a intentar.',
  'sprintVideo.mark.save': 'Guardar intento',
  'sprintVideo.mark.saveAnyway': 'Guardar igual',
  'sprintVideo.mark.discard': 'Descartar el video',
  'sprintVideo.mark.saved':
    'Intento {number} guardado. Se manda al servidor cuando haya señal; el video ya se borró.',
} as const;
