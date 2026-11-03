/**
 * Messages of the gym screen of the mobile app (B-607, ADR 0075): the player's program of
 * the day and the sets they log offline. Merged into the `es-AR` source catalog; the names of
 * the exercises and the warnings are shared with the web (`gym.ts`).
 */
export const mobileGymMessagesEsAR = {
  'gym.mobile.title': 'Gimnasio',
  'gym.mobile.staffOnWeb':
    'Desde el teléfono cargan el gimnasio los jugadores. Las rutinas y las series del plantel se cargan en la web.',
  'gym.mobile.loading': 'Cargando tu programa…',
  'gym.mobile.loadError': 'No pudimos leer tu programa en el teléfono.',
  'gym.mobile.noProgram':
    'No tenés un programa de gimnasio vigente. Cuando el preparador físico te asigne uno, aparece acá (se baja con la próxima sincronización).',
  'gym.mobile.program': 'Programa',
  'gym.mobile.day': 'Día',
  'gym.mobile.pickProgram': 'Elegir el programa {name}',
  'gym.mobile.pickDay': 'Elegir el día {name}',
  'gym.mobile.prescription': 'Indicado: {text}',
  'gym.mobile.sets.none': 'Todavía no cargaste series de este ejercicio hoy.',
  'gym.mobile.set.pending': 'Pendiente de sincronizar',
  'gym.mobile.set.e1rm': 'e1RM {value}',
  'gym.mobile.field.reps': 'Repeticiones',
  'gym.mobile.field.loadKg': 'Kilos',
  'gym.mobile.field.addedKg': 'Kilos de lastre',
  'gym.mobile.field.rir': 'RIR (repeticiones en reserva)',
  'gym.mobile.field.durationS': 'Segundos',
  'gym.mobile.error.required': 'Completalo.',
  'gym.mobile.error.integer': 'Un número entero.',
  'gym.mobile.error.number': 'Un número, con coma para los decimales (por ejemplo 62,5).',
  'gym.mobile.error.range': 'Fuera del rango posible.',
  'gym.mobile.log': 'Cargar la serie {number}',
  'gym.mobile.logged': 'Serie cargada. Se sube sola cuando haya conexión.',
  'gym.mobile.logFailed': 'No pudimos guardar la serie en el teléfono. Probá de nuevo.',
  'gym.mobile.toFailure':
    'RIR 0 es una serie al fallo. Hasta M16 nunca se va al fallo: dejá repeticiones en reserva.',
  'gym.mobile.best.title': 'Tus mejores e1RM',
  'gym.mobile.best.none':
    'Todavía no hay e1RM: se estima con series de 3 a 5 repeticiones con RIR, desde M15.',
  'gym.mobile.best.row': '{exercise}: {value} ({date})',
} as const;
