/**
 * Messages of the player app (B-503, ADR 0074): today's wellness and RPE, the streak, own
 * records, percentiles, test history, upcoming test days and consents. Merged into the `es-AR`
 * source catalog; same rules as `es-AR.ts` (vos, no key in more than one file). The wellness
 * items, the RPE scale, the tests and the consent types and states reuse the shared keys.
 */
export const mobilePlayerMessagesEsAR = {
  // Navigation
  'nav.today': 'Hoy',
  'nav.myTests': 'Mis tests',

  // Data kept on the phone
  'playerApp.kept': 'Sin conexión: te mostramos lo guardado el {date} a las {time}.',
  'playerApp.loadError': 'No pudimos traer tus datos. Conectate y probá de nuevo.',
  'playerApp.firstLoad':
    'La primera vez necesitamos conexión para traer tu ficha. Después funciona sin señal.',
  'playerApp.noPlayer':
    'Tu usuario no tiene una ficha de jugador/a en este club. Avisale al club para que lo arregle.',
  'playerApp.pending': 'Sin enviar: guardado en el teléfono, se envía cuando haya señal',

  // Wellness
  'playerApp.wellness.hintFaces': 'Tocá una carita en cada pregunta. Tarda menos de 20 segundos.',
  'playerApp.wellness.hintScale':
    'Elegí de 1 a 5 en cada pregunta: 5 es lo mejor. Tarda menos de 20 segundos.',
  'playerApp.wellness.face.1': 'Muy mal',
  'playerApp.wellness.face.2': 'Mal',
  'playerApp.wellness.face.3': 'Normal',
  'playerApp.wellness.face.4': 'Bien',
  'playerApp.wellness.face.5': 'Muy bien',
  'playerApp.wellness.faceChoice': '{item}: {label}',
  'playerApp.wellness.scoreChoice': '{item}: {score} de 5',
  'playerApp.wellness.low.sleep': 'Dormí muy mal',
  'playerApp.wellness.high.sleep': 'Dormí muy bien',
  'playerApp.wellness.low.fatigue': 'Muy cansado/a',
  'playerApp.wellness.high.fatigue': 'Descansado/a',
  'playerApp.wellness.low.soreness': 'Mucho dolor',
  'playerApp.wellness.high.soreness': 'Sin dolor',
  'playerApp.wellness.low.stress': 'Muy estresado/a',
  'playerApp.wellness.high.stress': 'Tranquilo/a',
  'playerApp.wellness.low.mood': 'Muy bajo',
  'playerApp.wellness.high.mood': 'Muy bueno',
  'playerApp.wellness.send': 'Enviar',
  'playerApp.wellness.missing': 'Te falta responder: {items}.',
  'playerApp.wellness.today': 'Tu bienestar de hoy',
  'playerApp.wellness.answer': '{item}: {score} de 5',
  'playerApp.wellness.correct': 'Corregir',
  'playerApp.wellness.saveCorrection': 'Guardar la corrección',
  'playerApp.wellness.noConsent':
    'Todavía no podés cargar tu bienestar: falta el consentimiento de datos. Miralo en Cuenta.',
  'playerApp.wellness.noStage':
    'Hoy no tenés una categoría asignada, así que no hay preguntas para vos. Avisale a tu entrenador/a.',

  // Corrections
  'playerApp.reason.label': 'Motivo de la corrección',
  'playerApp.reason.hint': 'Queda en el historial. Por ejemplo: toqué la opción equivocada.',
  'playerApp.reason.required': 'Contá brevemente por qué lo corregís.',

  // RPE
  'playerApp.rpe.none': 'No tenés sesiones para puntuar de hoy ni de ayer.',
  'playerApp.rpe.noConsent':
    'Todavía no podés cargar tu RPE: falta el consentimiento de datos. Miralo en Cuenta.',
  'playerApp.rpe.session':
    '{kind, select, match {Partido} other {Entrenamiento}} del {date} a las {time}',
  'playerApp.rpe.choice': 'RPE {value}',
  'playerApp.rpe.choiceLabelled': 'RPE {value}: {label}',
  'playerApp.rpe.selected': 'Elegiste {value}',
  'playerApp.rpe.selectedLabelled': 'Elegiste {value}: {label}',
  'playerApp.rpe.send': 'Enviar RPE',
  'playerApp.rpe.value': 'Tu RPE: {value}',
  'playerApp.rpe.closesAt': 'Podés cargarlo o corregirlo hasta el {date} a las {time}.',
  'playerApp.rpe.closed': 'La carga de esta sesión ya cerró.',

  // Streak
  'playerApp.streak.title': 'Racha',
  'playerApp.streak.none': 'Cargá tu bienestar hoy para empezar una racha.',
  'playerApp.streak.keepAlive': 'Cargá el de hoy para no cortarla.',
  // The unit next to the streak's figure ("11 · días seguidos").
  'playerApp.streak.unit': '{days, plural, one {día seguido} other {días seguidos}}',

  // Test days
  'playerApp.testDays.title': 'Próximos días de test',
  'playerApp.testDays.next': 'Próximo día de test',
  'playerApp.testDays.none': 'No tenés días de test programados.',
  'playerApp.testDays.inProgress': 'En curso',
  'playerApp.testDays.tests': 'Tests: {tests}',
  'playerApp.testDays.noTests': 'El staff te va a contar qué tests hacés.',

  // Records
  'playerApp.records.title': 'Mis récords',
  'playerApp.records.intro': 'Tu mejor marca en cada test. Solo la ven vos y el staff.',
  'playerApp.records.none': 'Todavía no tenés resultados de tests.',
  'playerApp.records.when': '{date} · {method}',
  'playerApp.records.mixedMethods':
    'Tus resultados de este test se midieron con métodos distintos: pueden no ser comparables.',

  // Percentiles
  'playerApp.percentiles.title': 'Tus percentiles',
  'playerApp.percentiles.intro':
    'Dónde estás dentro de tu grupo: con percentil 70, te fue mejor que al 70 % del grupo. Nunca se muestran nombres.',
  'playerApp.percentiles.fromM15': 'Desde M15 vas a ver acá dónde estás dentro de tu grupo.',
  'playerApp.percentiles.none': 'Todavía no hay percentiles para vos.',
  'playerApp.percentiles.value': 'Percentil {percentile}',
  'playerApp.percentiles.detail':
    'Tu marca: {value} · Mediana del grupo: {median} · {size, plural, one {# jugador/a} other {# jugadores/as}}',
  'playerApp.percentiles.insufficient':
    'Todavía no hay suficientes jugadores/as para compararte en este test.',
  'playerApp.percentiles.mixedMethods': 'El grupo mezcla métodos de medición.',

  // History
  'playerApp.history.title': 'Historial de tests',
  'playerApp.history.none': 'Todavía no hay tests en tu historial.',
  'playerApp.history.notDone': 'No realizado',
  'playerApp.history.when': '{date} · {method}',

  // Consents
  'playerApp.consents.title': 'Mis consentimientos',
  'playerApp.consents.open': 'Ver mis consentimientos',
  'playerApp.consents.intro':
    'Sin un consentimiento vigente de cada tipo, el club no puede cargar esos datos tuyos (Ley 25.326).',
  'playerApp.consents.minor':
    'Como sos menor de edad, los firma tu mamá, papá o tutor/a desde su cuenta.',
  'playerApp.consents.adult': 'Como sos mayor de edad, los firmás vos.',
  'playerApp.consents.accept': 'Leí el texto y doy mi consentimiento.',
  'playerApp.consents.revokeConfirm':
    'Si lo revocás, desde ahora el club no puede cargar {type, select, data {tus datos personales ni de entrenamiento} image {tus imágenes ni videos} other {tus datos de salud}}. Lo cargado antes queda en tu historia. ¿Lo revocás?',
  'playerApp.consents.needsConnection': 'Para firmar o revocar necesitás conexión.',
} as const;
