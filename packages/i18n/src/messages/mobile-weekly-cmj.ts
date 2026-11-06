/**
 * Messages of the weekly CMJ in the app (B-506, ADR 0079): the quick M17/M19 flow outside the
 * test days, against each player's baseline. Merged into the `es-AR` source catalog; same rules
 * as `es-AR.ts` (vos, no key in more than one file).
 */
export const mobileWeeklyCmjMessagesEsAR = {
  'weeklyCmj.open': 'CMJ semanal',
  'weeklyCmj.open.hint': 'M17 y M19: tres saltos por jugador contra su base, sin conexión.',
  'weeklyCmj.title': 'CMJ semanal',
  'weeklyCmj.body':
    'Manos en la cintura, 3 intentos, vale el mejor. Se compara con la base de cada jugador medida con el mismo método.',
  'weeklyCmj.notAllowed':
    'El CMJ semanal lo carga el preparador físico o la administración del club.',
  'weeklyCmj.setup.loading': 'Cargando el plantel…',
  'weeklyCmj.setup.missing':
    'Abrí esta pantalla una vez con señal para guardar el plantel y el protocolo en el teléfono.',
  'weeklyCmj.setup.noTest':
    'El catálogo del club no tiene el test CMJ. Avisale a la administración del club.',
  'weeklyCmj.setup.error': 'No pudimos actualizar el plantel: se usa el guardado.',
  'weeklyCmj.savedAt': 'Plantel guardado el {date}. Funciona sin señal.',
  'weeklyCmj.refresh': 'Actualizar plantel',
  'weeklyCmj.protocol':
    'Protocolo v{version}: {count, plural, one {# intento} other {# intentos}}, vale {aggregation, select, mean {el promedio} other {el mejor}}.',

  'weeklyCmj.category': 'Categoría',
  'weeklyCmj.category.none': 'No tenés categorías asignadas.',
  'weeklyCmj.category.pick': 'Elegí una categoría.',
  'weeklyCmj.method': 'Método',
  'weeklyCmj.method.hint':
    'El mismo cada semana: los saltos con otro método no se comparan con la base.',
  'weeklyCmj.mode': 'Qué cargás',
  'weeklyCmj.mode.height_cm': 'Altura (cm)',
  'weeklyCmj.mode.flight_time_ms': 'Tiempo de vuelo (ms)',

  'weeklyCmj.roster.empty': 'Nadie de esta categoría está en la etapa M17/M19.',
  'weeklyCmj.roster.otherStages':
    '{count, plural, one {# jugador de otra etapa no hace} other {# jugadores de otras etapas no hacen}} CMJ semanal.',
  'weeklyCmj.progress': '{done} de {total} con salto hoy',
  'weeklyCmj.next': 'Siguiente sin cargar',
  'weeklyCmj.allDone': 'Todos tienen su salto de hoy.',

  'weeklyCmj.player.unavailable': 'No disponible',
  'weeklyCmj.player.limited': 'Disponibilidad limitada',
  'weeklyCmj.player.record': 'Cargar saltos de {name}',
  'weeklyCmj.player.addAttempt': 'Agregar un intento a {name}',
  'weeklyCmj.player.close': 'Cerrar',

  'weeklyCmj.baseline':
    'Base: {height} ({count, plural, one {# día} other {# días}} en {weeks} semanas)',
  'weeklyCmj.baseline.none':
    'Sin base todavía: {samples} de {min, plural, one {# día} other {# días}} con el mismo método.',
  'weeklyCmj.baseline.otherMethod':
    '{count, plural, one {# día medido} other {# días medidos}} con otro método: no se comparan.',

  'weeklyCmj.today': 'Hoy: {height}',
  'weeklyCmj.today.none': 'Sin salto hoy',
  'weeklyCmj.today.many':
    'Hay {count} resultados de hoy (se cargaron en más de un teléfono sin señal): vale el mejor.',
  'weeklyCmj.verdict.ok': '{pct} contra su base de {baseline}: dentro de lo esperado.',
  'weeklyCmj.verdict.warning':
    '{pct} contra su base de {baseline}: atención. Es una heurística de carga, no un diagnóstico.',
  'weeklyCmj.verdict.critical':
    '{pct} contra su base de {baseline}: crítico. Es una heurística de carga, no un diagnóstico.',
  'weeklyCmj.verdict.noBaseline':
    'Sin base para comparar ({samples} de {min, plural, one {# día} other {# días}} con este método).',
  'weeklyCmj.verdict.noRule': 'El club no tiene una regla de caída de CMJ para este jugador.',

  'weeklyCmj.attempt.label': 'Intento {number}',
  'weeklyCmj.attempt.counts': 'Vale este',
  'weeklyCmj.attempt.voided': 'Anulado: {reason}',
  'weeklyCmj.attempt.invalid': 'Escribí un número mayor que cero, con coma decimal (41,5).',
  'weeklyCmj.attempt.implausible':
    '{height} está fuera del rango esperable. Revisalo o tocá «Guardar igual».',
  'weeklyCmj.attempt.saveAnyway': 'Guardar igual',
  'weeklyCmj.attempt.none': 'Cargá al menos un intento.',
  'weeklyCmj.attempt.void': 'Anular intento {number}',
  'weeklyCmj.attempt.void.reason': 'Motivo',
  'weeklyCmj.attempt.void.defaultReason': 'Intento mal cargado',
  'weeklyCmj.attempt.void.confirm': 'Anular',
  'weeklyCmj.attempt.void.hint':
    'Los intentos no se editan: se anulan con un motivo y queda en el historial.',
  'weeklyCmj.save': 'Guardar saltos',
  'weeklyCmj.saveError': 'No se pudo guardar en el teléfono. Probá de nuevo.',
} as const;
