/**
 * Messages of the CMJ by video in the app (B-604, ADR 0085): choosing the
 * day and the player, the high-speed camera, the frame-by-frame marking and
 * the videos waiting to go up. Merged into the `es-AR` source catalog; same
 * rules as `es-AR.ts` (one key in one file only).
 */
export const mobileCmjVideoMessagesEsAR = {
  'cmjVideo.title': 'CMJ por video',
  'cmjVideo.open': 'CMJ por video',
  'cmjVideo.open.hint': 'Grabá el salto en cámara lenta y marcá el despegue y el aterrizaje.',
  'cmjVideo.notAllowed': 'El CMJ por video lo graban el preparador físico y la administración.',

  // Day and players
  'cmjVideo.days.title': 'Elegí el día de test',
  'cmjVideo.days.empty': 'No hay días de test de hoy en adelante en este teléfono.',
  'cmjVideo.days.item': '{date}{place, select, none {} other { · {place}}}',
  'cmjVideo.day.noCmj': 'Este día no tiene CMJ, o su protocolo no admite video.',
  'cmjVideo.day.needsSignal':
    'Abrí la planilla del día una vez con señal; después grabás y marcás sin conexión.',
  'cmjVideo.day.loadFailed': 'No pudimos abrir la planilla del día.',
  'cmjVideo.players.title': 'Jugadores',
  'cmjVideo.player.attempts':
    '{count, plural, =0 {Sin intentos} one {# intento} other {# intentos}} de {planned}',
  'cmjVideo.player.film': 'Grabar a {name}',
  'cmjVideo.block.missing_image_consent':
    'Sin consentimiento de imagen: no se graba. Cargá el CMJ por tiempo de vuelo.',
  'cmjVideo.block.missing_data_consent': 'Sin consentimiento de datos: no se cargan resultados.',
  'cmjVideo.block.forbidden': 'No podés cargarle resultados.',
  'cmjVideo.block.not_applicable': 'El CMJ no corresponde a su etapa este día.',

  // Recording
  'cmjVideo.record.protocol':
    'Celular fijo a 1,5 m, de costado, con los pies a la vista. Manos en la cintura; {count, plural, one {# intento} other {# intentos con pausa}}.',
  'cmjVideo.record.start': 'Grabar',
  'cmjVideo.record.stop': 'Detener',
  'cmjVideo.record.recording': 'Grabando… se detiene sola a los {seconds} s.',
  'cmjVideo.record.fps': 'Cámara a {fps} cuadros por segundo.',
  'cmjVideo.record.preparing': 'Preparando la cámara…',
  'cmjVideo.record.noPermission':
    'La app no tiene permiso para usar la cámara. Habilitalo en los ajustes del teléfono.',
  'cmjVideo.record.unsupported':
    'La cámara de este teléfono no graba a 120 cuadros por segundo o más: el salto no se puede medir con precisión. Cargá el tiempo de vuelo a mano.',
  'cmjVideo.record.failed': 'No se pudo grabar. Probá de nuevo.',

  // Marking
  'cmjVideo.mark.title': 'Marcá el salto de {name}',
  'cmjVideo.mark.help':
    'Despegue: el primer cuadro con los dos pies en el aire. Aterrizaje: el primer cuadro con un pie de vuelta en el piso.',
  'cmjVideo.mark.frame': 'Cuadro {frame} de {count}',
  'cmjVideo.mark.frameImage': 'Cuadro {frame} del video',
  'cmjVideo.mark.frameLoading': 'Cargando el cuadro…',
  'cmjVideo.mark.frameFailed': 'No se pudo mostrar este cuadro.',
  'cmjVideo.mark.back10': '−10',
  'cmjVideo.mark.back1': '−1',
  'cmjVideo.mark.forward1': '+1',
  'cmjVideo.mark.forward10': '+10',
  'cmjVideo.mark.back10.label': 'Retroceder 10 cuadros',
  'cmjVideo.mark.back1.label': 'Retroceder un cuadro',
  'cmjVideo.mark.forward1.label': 'Avanzar un cuadro',
  'cmjVideo.mark.forward10.label': 'Avanzar 10 cuadros',
  'cmjVideo.mark.takeoff': 'Marcar despegue',
  'cmjVideo.mark.landing': 'Marcar aterrizaje',
  'cmjVideo.mark.takeoffAt': 'Despegue: {frame, select, none {sin marcar} other {cuadro {frame}}}',
  'cmjVideo.mark.landingAt':
    'Aterrizaje: {frame, select, none {sin marcar} other {cuadro {frame}}}',
  'cmjVideo.mark.goTo': 'Ver',
  'cmjVideo.mark.goTo.takeoff': 'Ver el cuadro del despegue',
  'cmjVideo.mark.goTo.landing': 'Ver el cuadro del aterrizaje',
  'cmjVideo.mark.result': 'Vuelo: {flight} · Altura: {height} (± {precision})',
  'cmjVideo.mark.incomplete': 'Marcá el despegue y el aterrizaje para ver la altura.',
  'cmjVideo.mark.invalid': 'El aterrizaje tiene que ser después del despegue.',
  'cmjVideo.mark.implausible':
    'La altura queda fuera del rango esperable. Revisá las marcas antes de guardar.',
  'cmjVideo.mark.save': 'Guardar intento {number}',
  'cmjVideo.mark.saveAnyway': 'Guardar igual',
  'cmjVideo.mark.discard': 'Descartar el video',
  'cmjVideo.mark.saved':
    'Intento {number} guardado. El video se sube solo cuando haya señal y el intento esté en el servidor.',
  'cmjVideo.mark.saveFailed': 'No se pudo guardar el intento. Probá de nuevo.',

  // Videos waiting on the phone
  'cmjVideo.uploads.title': 'Videos en este teléfono',
  'cmjVideo.uploads.empty': 'No hay videos esperando para subir.',
  'cmjVideo.uploads.item': 'Intento {number}',
  'cmjVideo.uploads.waiting': 'Se sube solo cuando haya señal y el intento esté guardado.',
  'cmjVideo.uploads.retrying': 'No se pudo subir; lo volvemos a intentar solos.',
  'cmjVideo.uploads.failed.consent':
    'No se subió: el jugador ya no tiene consentimiento de imagen. El video se borró del teléfono; el intento queda.',
  'cmjVideo.uploads.failed.voided':
    'No se subió: el intento se anuló. El video se borró del teléfono.',
  'cmjVideo.uploads.failed.rejected':
    'No se subió: el servidor no lo aceptó. El video se borró del teléfono; el intento queda.',
  'cmjVideo.uploads.failed.too_large':
    'No se subió: el video es demasiado grande. Se borró del teléfono; el intento queda.',
  'cmjVideo.uploads.failed.missing_file':
    'No se subió: el video ya no estaba en el teléfono. El intento queda.',
  'cmjVideo.uploads.dismiss': 'Entendido',
  'cmjVideo.uploads.count':
    '{count, plural, one {# video esperando para subir} other {# videos esperando para subir}}',
} as const;
