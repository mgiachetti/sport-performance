/**
 * Messages of the kiosk mode of the app (B-504, ADR 0086): a shared club device where players
 * without a phone load their wellness and RPE under a staff member's session. Merged into the
 * `es-AR` source catalog; same rules as `es-AR.ts` (vos, no key in more than one file). The
 * wellness items and the RPE scale reuse the shared keys (`wellness.item.*`, `rpe.scale.*`).
 */
export const mobileKioskMessagesEsAR = {
  // Entry from Inicio (staff)
  'kiosk.open': 'Abrir el modo kiosco',
  'kiosk.open.hint':
    'Para una tablet o un celular del club: los jugadores sin celular cargan su bienestar y su RPE, sin ver datos de nadie.',

  // Setup
  'kiosk.setup.title': 'Modo kiosco',
  'kiosk.setup.body':
    'Las cargas quedan a tu nombre, marcadas como hechas en el kiosco. Para salir del kiosco hace falta el PIN que elijas acá.',
  'kiosk.setup.categories': 'Categorías del kiosco',
  'kiosk.setup.noCategories': 'No tenés categorías asignadas para cargar en el kiosco.',
  'kiosk.setup.pin': 'PIN para salir (4 a 6 números)',
  'kiosk.setup.pinConfirm': 'Repetí el PIN',
  'kiosk.setup.pin.length': 'El PIN tiene de 4 a 6 números.',
  'kiosk.setup.pin.digits': 'El PIN lleva solo números.',
  'kiosk.setup.pin.weak': 'Elegí un PIN menos fácil de adivinar: ni repetido ni seguido.',
  'kiosk.setup.pin.mismatch': 'Los dos PIN no coinciden.',
  'kiosk.setup.pickCategory': 'Elegí al menos una categoría.',
  'kiosk.setup.pinning':
    'Para que nadie salga de la app, fijala en el equipo: Acceso guiado en iPhone y iPad (Ajustes › Accesibilidad), Fijar pantalla en Android (Ajustes › Seguridad).',
  'kiosk.setup.start': 'Empezar el kiosco',
  'kiosk.setup.starting': 'Preparando el kiosco…',
  'kiosk.setup.needsConnection':
    'Para abrir el kiosco necesitamos conexión una vez, para traer los planteles. Después funciona sin señal.',
  'kiosk.setup.loadError': 'No pudimos traer los planteles. Probá de nuevo.',

  // Player list
  'kiosk.title': 'Kiosco · {categories}',
  'kiosk.pick': 'Tocá tu nombre',
  'kiosk.search': 'Buscá tu nombre',
  'kiosk.search.hint': 'Escribí el principio de tu nombre o apellido.',
  'kiosk.empty': 'No hay jugadores en estas categorías.',
  'kiosk.noMatch': 'No encontramos ese nombre. Revisalo o avisale al staff.',
  'kiosk.kept': 'Plantel guardado el {date} a las {time}.',
  'kiosk.exit': 'Salir del kiosco',

  // Turn of a player
  'kiosk.turn.confirm': '¿Sos {name}?',
  'kiosk.turn.yes': 'Sí, soy yo',
  'kiosk.turn.notMe': 'No soy yo',
  'kiosk.turn.unavailable': 'Todavía no podés cargar desde el kiosco. Avisale a tu entrenador/a.',
  'kiosk.turn.nothingLeft': 'Ya cargaste todo por hoy. ¡Gracias!',
  'kiosk.turn.wellnessDone': 'Ya cargaste tu bienestar de hoy.',
  'kiosk.turn.step': 'Paso {step} de {total}',
  'kiosk.turn.next': 'Siguiente',
  'kiosk.turn.send': 'Enviar',
  'kiosk.turn.missing': 'Te falta responder: {items}.',
  'kiosk.turn.pickRpe': 'Elegí un número del 0 al 10.',
  'kiosk.turn.session': '{title} · {time}',
  'kiosk.turn.sessionUntitled.training': 'Entrenamiento de las {time}',
  'kiosk.turn.sessionUntitled.match': 'Partido de las {time}',
  'kiosk.turn.done': '¡Listo, {name}! Gracias.',
  'kiosk.turn.doneHint': 'En unos segundos aparece la lista para el siguiente.',
  'kiosk.turn.back': 'Volver a la lista',
  'kiosk.turn.idle': 'Pasó un minuto sin respuesta: volvemos a la lista.',
  'kiosk.turn.saveError': 'No pudimos guardar en el equipo. Avisale al staff.',

  // Wellness scale of the kiosk
  'kiosk.face.1': 'Muy mal',
  'kiosk.face.2': 'Mal',
  'kiosk.face.3': 'Normal',
  'kiosk.face.4': 'Bien',
  'kiosk.face.5': 'Muy bien',
  'kiosk.choice.face': '{item}: {label}',
  'kiosk.choice.score': '{item}: {score} de 5',
  'kiosk.choice.rpe': 'RPE {value}',
  'kiosk.choice.rpeLabelled': 'RPE {value}: {label}',
  'kiosk.scale.best': '5 es lo mejor',

  // Exit
  'kiosk.exit.title': 'Salir del kiosco',
  'kiosk.exit.body': 'Ingresá el PIN que se eligió al abrir el kiosco.',
  'kiosk.exit.pin': 'PIN',
  'kiosk.exit.confirm': 'Salir',
  'kiosk.exit.wrong': 'PIN incorrecto.',
  'kiosk.exit.locked': 'Demasiados intentos. Probá de nuevo a las {time}.',
  'kiosk.exit.forgot':
    '¿Nadie sabe el PIN? Cerrá esta sesión desde la web (Cuenta › Sesiones activas) e ingresá de nuevo en el equipo.',
} as const;
