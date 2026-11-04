/**
 * Messages of the player profile and the roster of the staff web (B-404): `players.*` for the
 * list, `player.*` for the profile. Merged into the `es-AR` source catalog; same rules as
 * `es-AR.ts`. Values (dates, measures) arrive already formatted in es-AR and the club's day.
 */
export const webPlayerMessagesEsAR = {
  // Navigation and roster
  'nav.players': 'Jugadores',
  'players.title': 'Jugadores',
  'players.subtitle': 'Elegí un jugador para abrir su ficha.',
  'players.search': 'Buscar por nombre o apellido',
  'players.empty': 'No hay jugadores con ese filtro en lo que ves.',
  'players.count': '{count, plural, one {# jugador} other {# jugadores}}',
  'players.more': 'Mostrar más',
  'players.table.name': 'Jugador',
  'players.table.category': 'Categoría',
  'players.table.birthDate': 'Nacimiento',

  // Profile header
  'player.title': 'Ficha del jugador',
  'player.subtitle': 'Evolución en las ventanas de test y comparación con su categoría.',
  'player.back': 'Volver a jugadores',
  'player.age': '{age} años',
  'player.lastMeasure': '{height} · {weight} ({date})',
  'player.noCategory': 'Sin categoría vigente',
  'player.left': 'De baja desde el {date}',
  'player.availabilityNow': 'Disponibilidad de hoy',
  'player.notFound': 'No encontramos a este jugador en lo que ves.',
  'player.section.unavailable': 'No tenés permiso para ver esta sección de la ficha.',
  'player.refreshPending': 'Hay datos nuevos que se están recalculando. Volvé a mirar en un rato.',

  // Stages
  'player.stage.foundation': 'Etapa de base (M13/M14)',
  'player.stage.development': 'Etapa de desarrollo (M15/M16)',
  'player.stage.performance': 'Etapa de rendimiento (M17/M19)',
  'player.stage.basis.maturation': 'asignada por maduración',
  'player.stage.basis.manual': 'fijada por el staff',
  'player.stage.basis.category': 'la de su categoría',

  // Availability
  'player.availability.title': 'Disponibilidad',
  'player.availability.subtitle':
    'Estado para entrenar y para jugar. La causa la maneja el staff médico.',
  'player.availability.status.available': 'Disponible',
  'player.availability.status.limited': 'Limitado',
  'player.availability.status.unavailable': 'No disponible',
  'player.availability.training': 'Entrenamiento: {status}',
  'player.availability.match': 'Partido: {status}',
  'player.availability.notes': 'Notas del staff',
  'player.availability.history': 'Últimos 90 días',
  'player.availability.period': '{from} al {to}',
  'player.availability.allAvailable': 'Disponible todos los días del período.',
  'player.availability.table.period': 'Período',
  'player.availability.table.training': 'Entrenamiento',
  'player.availability.table.match': 'Partido',

  // Maturation
  'player.maturation.title': 'Maduración',
  'player.maturation.subtitle': 'Años desde el pico de velocidad de crecimiento (PHV).',
  'player.maturation.before': 'Antes del PHV',
  'player.maturation.peak': 'Pico',
  'player.maturation.after': 'Después',
  'player.maturation.offset':
    '{offset, select, positive {+{years} años desde el PHV} negative {{years} años desde el PHV} other {En el PHV}}',
  'player.maturation.offsetTrack': 'Posición respecto del PHV: {value}',
  'player.maturation.adultHeight': '{pct} de la talla adulta estimada ({height})',
  'player.maturation.adultHeightMissing':
    'Sin % de talla adulta: hace falta la altura de los dos padres.',
  'player.maturation.velocity': 'Crece {velocity} (medición del {date})',
  'player.maturation.peakZone':
    'En zona de pico de crecimiento: bajá saltos y sprints y vigilá rodilla y talón.',
  'player.maturation.measuredOn': 'Medición del {date} · {equation}',
  'player.maturation.noOffset':
    'Sin offset de PHV: hacen falta talla, talla sentado y peso del mismo día.',
  'player.maturation.empty': 'Todavía no tiene mediciones antropométricas.',

  // Evolution by window
  'player.evolution.title': 'Evolución por ventana',
  'player.evolution.subtitle':
    'Su valor en cada ventana de test, el promedio de su categoría y la referencia de primera.',
  'player.evolution.metric': 'Métrica',
  'player.evolution.window': 'V{number} {season}',
  'player.evolution.categoryAverage': 'Promedio {category}',
  'player.evolution.categoryAverageGeneric': 'Promedio de la categoría',
  'player.evolution.description':
    '{direction, select, higher_is_better {Más es mejor} lower_is_better {Menos es mejor} other {Sin sentido de mejora}}. El promedio aparece con al menos {min} jugadores.',
  'player.evolution.mixedMethods':
    'Ojo: la serie mezcla métodos de medición y puede no ser comparable.',
  'player.evolution.mixedProtocols': 'Ojo: la serie mezcla versiones del protocolo del test.',
  'player.evolution.mixedGroupMethods':
    'El promedio de alguna ventana mezcla métodos de medición distintos al del jugador.',
  'player.evolution.mixedGroupProtocols':
    'El promedio de alguna ventana mezcla versiones del protocolo distintas a la del jugador.',
  'player.evolution.empty': 'Todavía no tiene resultados de tests.',

  // Percentiles
  'player.percentiles.title': 'Percentiles en su grupo',
  'player.percentiles.subtitle':
    'Su último valor contra su grupo de comparación. La marca es la mediana; más alto es mejor.',
  'player.percentiles.value': 'Percentil {percentile}',
  'player.percentiles.detail': '{value} el {date} · {group}, {count} jugadores',
  'player.percentiles.median': 'Mediana {value}',
  'player.percentiles.insufficient': 'Muestra insuficiente: hacen falta al menos {min} jugadores.',
  'player.percentiles.mixedMethods': 'El grupo mezcla métodos de medición.',
  'player.percentiles.empty': 'Sin valores para comparar todavía.',
  'player.percentiles.group.sex': 'sexo',
  'player.percentiles.group.category': 'categoría',
  'player.percentiles.group.line': 'línea',
  'player.percentiles.group.position': 'posición',
  'player.percentiles.group.seasons': '{count, plural, one {esta temporada} other {# temporadas}}',

  // Load of the last 28 days
  'player.load.title': 'Carga de los últimos 28 días',
  'player.load.subtitle': 'sRPE diario (UA). La línea gris es la carga crónica (EWMA de 28 días).',
  'player.load.daily': 'sRPE del día',
  'player.load.chronic': 'Carga crónica',
  'player.load.acwr': 'ACWR {value}',
  'player.load.acwrLabel': 'Relación aguda:crónica',
  'player.load.acwrZeroChronic': 'Sin carga crónica para comparar',
  'player.load.week': 'Carga de la semana',
  'player.load.monotony': 'Monotonía',
  'player.load.strain': 'Strain',
  'player.load.pendingRpe':
    '{count, plural, one {# sesión sin RPE} other {# sesiones sin RPE}} en el período.',
  'player.load.external':
    'Incluye {load} informadas por el jugador fuera del club ({count, plural, one {# actividad} other {# actividades}}: otro deporte, educación física).',
  'player.load.empty': 'Sin carga registrada en los últimos 28 días.',
  'player.load.wellness': 'Bienestar de hoy',
  'player.load.wellnessValue': '{score} de 5',
  'player.load.wellnessNone': 'Sin bienestar cargado hoy',

  // Alerts history
  'player.alerts.title': 'Historial de alertas',
  'player.alerts.subtitle':
    'Heurísticas de carga, no predicciones de lesión. Las más recientes primero.',
  'player.alerts.empty': 'Sin alertas.',
  'player.alerts.raisedOn': 'Desde el {date}',
  'player.alerts.resolvedOn': 'Resuelta el {date}',
  'player.alerts.active': 'Activa',
  'player.alerts.more': 'Ver más alertas',
} as const;
