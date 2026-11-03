/**
 * How a test protocol is shown (B-415), the same on the staff web and in the app: attempts,
 * which one counts, rest, equipment and the metrics a version produces. The protocol text itself
 * is club data and comes from the API in the club's language. Merged into the `es-AR` source
 * catalog; same rules as `es-AR.ts`.
 */
export const protocolMessagesEsAR = {
  'nav.protocols': 'Protocolos',

  'protocol.version': 'Versión {version}',
  'protocol.validFrom': 'Vigente desde el {date}',
  'protocol.validRange': 'Vigente del {from} al {to}',
  'protocol.allSports': 'Todos los deportes',
  'protocol.summary': 'Resumen',
  'protocol.steps': 'Cómo se hace',
  'protocol.noSteps': 'Este protocolo no tiene pasos cargados.',
  'protocol.attempts':
    '{count, plural, one {# intento} other {# intentos}}, {aggregation, select, mean {vale el promedio} other {vale el mejor}}',
  'protocol.rest': 'Pausa entre intentos: {duration}',
  'protocol.restSeconds': '{seconds, plural, one {# segundo} other {# segundos}}',
  'protocol.restMinutes': '{minutes, plural, one {# minuto} other {# minutos}}',
  'protocol.equipment': 'Equipo',
  'protocol.metrics': 'Qué se registra',
  'protocol.metricDerived': 'se calcula',
  'protocol.maximalLoad':
    'Test máximo con carga: nunca en M13/M14. En M15/M16 se estima desde series submáximas.',
  'protocol.recordHow':
    'Registrá siempre el método, el evaluador y las condiciones (clima, superficie, horario). Resultados con métodos o versiones distintas no se comparan sin aviso.',
  'protocol.empty': 'No hay protocolos vigentes para lo que estás mirando.',
  'protocol.notFound': 'No encontramos ese protocolo.',
  'protocol.back': 'Volver a los protocolos',
  'protocol.open': 'Ver el protocolo de {test}',
  'protocol.intro': 'Cómo se hace cada test, con la misma definición que usa la primera.',
} as const;
