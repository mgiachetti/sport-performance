/**
 * Messages of the weekly panel of the staff web (B-403, `GET /v1/panel/weekly`). Merged into the
 * `es-AR` source catalog; same rules as `es-AR.ts`. Every key starts with `panel.`.
 */
export const webPanelMessagesEsAR = {
  'panel.nav': 'Panel semanal',
  'panel.title': 'Panel semanal',
  'panel.week': 'Semana del {from} al {to}',

  // Week navigation
  'panel.week.label': 'Semana',
  'panel.week.previous': 'Semana anterior',
  'panel.week.next': 'Semana siguiente',
  'panel.week.current': 'Esta semana',
  'panel.week.pastRoster':
    'Semana pasada: los jugadores, sus categorías y posiciones son los de hoy; los datos y las alertas, los del {date}.',

  // Grouping (bio-banding)
  'panel.group.label': 'Agrupar por',
  'panel.group.category': 'Categoría',
  'panel.group.phv_offset': 'Maduración: años desde el pico de crecimiento',
  'panel.group.pct_adult_height': 'Maduración: % de la talla adulta',
  'panel.group.tabs': 'Grupos',
  'panel.group.all': 'Todos ({count})',
  'panel.group.option': '{name} ({count})',
  'panel.group.unbanded': 'Sin datos de maduración',
  'panel.group.maturityNote':
    'Agrupados por maduración y no por edad: el offset de cada jugador se proyecta al {date} desde su última antropometría.',

  // KPIs
  'panel.kpi.label': 'Resumen del grupo',
  'panel.kpi.wellnessToday': 'Respondieron bienestar hoy',
  'panel.kpi.wellnessWeek': 'Cargaron bienestar en la semana',
  'panel.kpi.wellnessTodayDetail': 'Antes del entrenamiento de hoy',
  'panel.kpi.wellnessWeekDetail': 'Al menos un día de la semana',
  'panel.kpi.wellnessMean': 'Bienestar promedio',
  'panel.kpi.wellnessMeanDetail':
    '{count, plural, =0 {Sin cargas en la semana} one {Media de la semana de # jugador} other {Media de la semana de # jugadores}}',
  'panel.kpi.load': 'Carga semanal media',
  'panel.kpi.loadDetail':
    '{count, plural, =0 {Nadie tiene carga en la semana} one {sRPE de # jugador con carga} other {sRPE de # jugadores con carga}}',
  'panel.kpi.alerts': 'Jugadores con alerta',
  'panel.kpi.alertsDetail':
    '{count, plural, =0 {Ninguno en crítico} one {# en crítico} other {# en crítico}}',
  'panel.kpi.outOf': '{value} de {total}',

  // Load chart
  'panel.chart.title':
    '{weeks, plural, one {Carga del grupo, última semana} other {Carga del grupo, últimas # semanas}}',
  'panel.chart.description':
    'sRPE promedio por jugador con carga (UA). La línea es la carga crónica de 28 días llevada a una semana.',
  'panel.chart.bar': 'sRPE medio por jugador',
  'panel.chart.chronic': 'Crónica (equivalente semanal)',
  'panel.chart.weekLabel': 'Semana del {date}',

  // Attention
  'panel.attention.title': 'Requieren atención',
  'panel.attention.subtitle':
    'Alertas activas por carga, bienestar y crecimiento. Son heurísticas de carga, no un diagnóstico.',
  'panel.attention.none': 'Nadie del grupo tiene alertas activas.',
  'panel.attention.more':
    '{count, plural, one {Y # alerta más de este jugador} other {Y # alertas más de este jugador}}',

  // Roster
  'panel.roster.title': 'Plantel',
  'panel.roster.subtitle': 'Por apellido. Sin rankings: el estado sale de las alertas activas.',
  'panel.roster.player': 'Jugador',
  'panel.roster.position': 'Posición',
  'panel.roster.maturity': 'Maduración',
  'panel.roster.wellness': 'Bienestar (semana)',
  'panel.roster.load': 'sRPE semana',
  'panel.roster.acwr': 'ACWR',
  'panel.roster.availability': 'Disponibilidad',
  'panel.roster.status': 'Estado',
  'panel.roster.name': '{lastName}, {firstName}',
  'panel.roster.noWellness': 'Sin respuesta',
  'panel.roster.wellnessValue': '{value} de 5',
  'panel.roster.pendingRpe': '{count, plural, one {# RPE pendiente} other {# RPE pendientes}}',
  'panel.roster.noMaturity': 'Sin datos',
  'panel.roster.phvOffset': '{value} años del PHV',
  'panel.roster.adultHeight': '{value} de la talla adulta',
  'panel.roster.measuredOn': 'Medido el {date}',
  'panel.roster.empty': 'No hay jugadores en este grupo.',

  // ACWR states
  'panel.acwr.insufficient_history': 'Historia insuficiente',
  'panel.acwr.zero_chronic_load': 'Sin carga crónica',
  'panel.acwr.asOf': 'Último cálculo: {date}',

  // Status and availability (always icon + text; never the cause)
  'panel.status.inRange': 'En rango',
  'panel.availability.detail': 'Entrenar: {training} · Partido: {match}',

  // Empty states
  'panel.empty.noCategories':
    'Todavía no tenés categorías asignadas. Pedile a la administración del club que te asigne.',
  'panel.empty.noPlayers': 'No hay jugadores vigentes en lo que estás mirando.',
  'panel.empty.tooMany':
    'Son demasiados jugadores para un solo panel. Elegí un deporte o una categoría arriba.',

  // Default position names (B-306 seeds); a club label overrides them.
  'panel.position.prop': 'Pilar',
  'panel.position.hooker': 'Hooker',
  'panel.position.lock': 'Segunda línea',
  'panel.position.flanker': 'Ala',
  'panel.position.number_eight': 'Octavo',
  'panel.position.scrum_half': 'Medio scrum',
  'panel.position.fly_half': 'Apertura',
  'panel.position.centre': 'Centro',
  'panel.position.wing': 'Wing',
  'panel.position.fullback': 'Fullback',
  'panel.position.goalkeeper': 'Arquera',
  'panel.position.defender': 'Defensora',
  'panel.position.midfielder': 'Volante',
  'panel.position.forward': 'Delantera',
} as const;
