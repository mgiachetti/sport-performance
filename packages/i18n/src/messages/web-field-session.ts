/**
 * Messages of the field session view of the staff web (B-408, ADR 0061): the list of sessions
 * with field data and the view of one session (summary, chart and table per player). Merged into
 * the `es-AR` source catalog; same rules as `es-AR.ts`. Every key starts with `fieldSession.`.
 *
 * Metric labels follow the canonical dictionary (`fieldSession.metric.<code>`); a club's own
 * metric without a label shows its code. Never the name "PlayerLoad" (CLAUDE.md).
 */
export const webFieldSessionMessagesEsAR = {
  // Navigation and list
  'fieldSession.nav': 'Sesión en cancha',
  'fieldSession.list.title': 'Sesiones en cancha',
  'fieldSession.list.subtitle':
    'Distancia, velocidad, aceleraciones y contactos de cada jugador, con las mismas definiciones que la primera.',
  'fieldSession.list.kindFilter': 'Tipo',
  'fieldSession.list.kindAll': 'Entrenamientos y partidos',
  'fieldSession.list.date': 'Fecha',
  'fieldSession.list.session': 'Sesión',
  'fieldSession.list.category': 'Categoría',
  'fieldSession.list.players': 'Jugadores con datos',
  'fieldSession.list.sources': 'Fuente',
  'fieldSession.list.metrics': 'Métricas',
  'fieldSession.list.metricsCount': '{count, plural, one {# métrica} other {# métricas}}',
  'fieldSession.list.open': 'Ver {session}',
  'fieldSession.list.loadMore': 'Cargar más',
  'fieldSession.list.empty':
    'Todavía no hay sesiones con datos de cancha. Llegan con la importación de Catapult y, más adelante, con las bandas y los pods.',
  'fieldSession.list.emptyFiltered': 'No hay sesiones con datos de cancha para este filtro.',
  'fieldSession.module.off':
    'El módulo de métricas de cancha (GPS) está apagado en este club. La administración lo prende en Configuración.',

  // Session kinds and sources (principle 4: each source is its own method)
  'fieldSession.kind.training': 'Entrenamiento',
  'fieldSession.kind.match': 'Partido',
  'fieldSession.untitled': '{kind} del {date}',
  'fieldSession.source.catapult': 'Catapult',
  'fieldSession.source.pod': 'Pod',
  'fieldSession.source.hr_band': 'Banda de FC',
  'fieldSession.source.manual': 'Carga manual',
  'fieldSession.sources': 'Fuente: {sources}',
  'fieldSession.mixedSources':
    '{metrics} {count, plural, one {tiene} other {tienen}} valores de más de una fuente ({sources}). Se muestran en columnas separadas: no los compares sin tener en cuenta el método.',

  // One session
  'fieldSession.back': 'Volver a las sesiones en cancha',
  'fieldSession.subtitle': '{category} · {date} · {duration}',
  'fieldSession.subtitleNoCategory': '{date} · {duration}',
  'fieldSession.duration': '{minutes} min',
  'fieldSession.noDuration': 'Sin duración',
  'fieldSession.vs': 'contra {opponent}',
  'fieldSession.empty':
    'Esta sesión todavía no tiene datos de cancha. Llegan con la importación de Catapult y, más adelante, con las bandas y los pods.',
  'fieldSession.noPlayers': 'No hay jugadores que puedas ver en esta sesión.',
  'fieldSession.archived': 'Esta sesión está archivada: sus datos se muestran como historia.',

  // Summary cards
  'fieldSession.kpi.title': 'Resumen de la sesión',
  'fieldSession.kpi.dist_m': 'Distancia media',
  'fieldSession.kpi.hsr_abs_m': 'HSR media',
  'fieldSession.kpi.vmax_ms': 'Vmax del día',
  'fieldSession.kpi.contacts_n': 'Contactos totales',
  'fieldSession.kpi.players': '{count, plural, one {# jugador} other {# jugadores}}',
  'fieldSession.kpi.bestOf': 'De {name}',

  // Chart
  'fieldSession.chart.metric': 'Métrica',
  'fieldSession.chart.title': '{metric} por jugador',
  'fieldSession.chart.titleWithUnit': '{metric} por jugador ({unit})',
  'fieldSession.chart.description': 'Ordenado de mayor a menor. {sources}.',
  'fieldSession.chart.value': 'Valor',
  'fieldSession.chart.empty': 'Nadie tiene datos de esta métrica en la sesión.',
  'fieldSession.line.backs': 'Backs',
  'fieldSession.line.forwards': 'Delanteros',

  // Table
  'fieldSession.table.title': 'Métricas por jugador',
  'fieldSession.table.subtitle':
    'Mismas definiciones que la primera en Catapult: HSR absoluta por encima del umbral de la primera (por defecto 5,5 m/s en varones y 5,28 m/s en mujeres) y relativa a más del 60 % de la Vmax.',
  'fieldSession.table.player': 'Jugador',
  'fieldSession.table.position': 'Posición',
  'fieldSession.table.status': 'Participación',
  'fieldSession.table.minutes': 'Minutos',
  'fieldSession.table.srpe': 'sRPE (UA)',
  'fieldSession.table.noParticipation': 'Sin cargar',
  'fieldSession.table.noData': 'Sin datos de cancha',
  'fieldSession.table.column': '{metric} ({unit})',
  'fieldSession.table.columnWithSource': '{metric} ({unit}) · {source}',
  'fieldSession.table.columnNoUnit': '{metric}',
  'fieldSession.table.columnNoUnitWithSource': '{metric} · {source}',

  // Participation (the coach sees "no disponible", never the cause)
  'fieldSession.status.full': 'Completa',
  'fieldSession.status.partial': 'Parcial',
  'fieldSession.status.absent': 'Ausente',
  'fieldSession.status.unavailable': 'No disponible',

  // Canonical field metrics (CLAUDE.md, Catapult equivalence)
  'fieldSession.metric.dist_m': 'Distancia',
  'fieldSession.metric.dist_m_min': 'Distancia por minuto',
  'fieldSession.metric.hsr_abs_m': 'HSR absoluta',
  'fieldSession.metric.hsr_rel_m': 'HSR relativa',
  'fieldSession.metric.vmax_ms': 'Vmax',
  'fieldSession.metric.vmax_pct': '% de su Vmax',
  'fieldSession.metric.acc_n': 'Aceleraciones',
  'fieldSession.metric.dec_n': 'Desaceleraciones',
  'fieldSession.metric.accel_load_au': 'Carga acelerométrica',
  'fieldSession.metric.contacts_n': 'Contactos',
  'fieldSession.metric.scrums_n': 'Scrums',
  'fieldSession.metric.kicks_n': 'Patadas',
  'fieldSession.metric.time_to_feet_s': 'Tiempo en volver a pararse',
  'fieldSession.metric.big_time_s': 'Tiempo de alta intensidad',
  'fieldSession.metric.hr_avg': 'FC media',
  'fieldSession.metric.hr_max': 'FC máxima',
  'fieldSession.metric.trimp': 'TRIMP',

  // Positions of the seeded catalog (B-306); a club's own wording comes in `Position.label`
  'fieldSession.position.prop': 'Pilar',
  'fieldSession.position.hooker': 'Hooker',
  'fieldSession.position.lock': 'Segunda línea',
  'fieldSession.position.flanker': 'Ala',
  'fieldSession.position.number_eight': 'Octavo',
  'fieldSession.position.scrum_half': 'Medio scrum',
  'fieldSession.position.fly_half': 'Apertura',
  'fieldSession.position.centre': 'Centro',
  'fieldSession.position.wing': 'Wing',
  'fieldSession.position.fullback': 'Fullback',
  'fieldSession.position.goalkeeper': 'Arquera',
  'fieldSession.position.defender': 'Defensora',
  'fieldSession.position.midfielder': 'Volante',
  'fieldSession.position.forward': 'Delantera',
} as const;
