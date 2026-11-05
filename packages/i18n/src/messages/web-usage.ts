/**
 * Messages of the usage metrics page of the staff web (B-707, ADR 0093): the club's adoption by
 * week for its administration. Merged into the `es-AR` source catalog; same rules as `es-AR.ts`.
 */
export const webUsageMessagesEsAR = {
  'usage.nav': 'Uso',
  'usage.title': 'Uso de la plataforma',
  'usage.subtitle':
    'Adopción de {clubName} por semana: bienestar, RPE, días de test y uso de cada pantalla. Solo conteos, sin nombres.',
  'usage.privacy':
    'La plataforma mide su uso por su cuenta, sin herramientas de terceros: registra qué pantalla usó cada miembro y qué día, nunca qué miró, desde qué IP ni con qué dispositivo. Ese detalle se guarda {days} días; después quedan solo conteos por semana.',
  'usage.retained':
    'Antes del {date} solo hay conteos por semana: los miembros activos de cada pantalla no se pueden sumar entre semanas.',
  'usage.demo':
    'Este es el club demo: los datos son ficticios y no se mezclan con los clubes reales.',
  'usage.weeks.label': 'Período',
  'usage.weeks.option': '{weeks, plural, one {Última semana} other {Últimas # semanas}}',
  'usage.week': 'Semana del {from} al {to}',
  'usage.noCategory': 'Sin categoría',
  'usage.share': '{part} de {whole} ({percent})',
  'usage.share.none': 'Sin datos esperados',

  'usage.training.title': 'Bienestar y RPE en días de sesión',
  'usage.training.help':
    'Por cada jugador que fue a una sesión: si cargó el bienestar ese día y el RPE de la sesión. El RPE puede llegar hasta la mañana siguiente.',
  'usage.training.caption': 'Bienestar y RPE por semana y categoría',
  'usage.training.empty': 'No hubo sesiones en el período.',
  'usage.column.week': 'Semana',
  'usage.column.category': 'Categoría',
  'usage.column.sessions': 'Sesiones',
  'usage.column.wellness': 'Bienestar en días de sesión',
  'usage.column.rpe': 'RPE cargado',
  'usage.column.kiosk': 'En el kiosco',

  'usage.wellness.title': 'Bienestar cargado',
  'usage.wellness.caption': 'Bienestar por semana y categoría',
  'usage.wellness.empty': 'No hubo bienestar cargado en el período.',
  'usage.column.roster': 'Jugadores',
  'usage.column.respondents': 'Cargaron alguno',
  'usage.column.responses': 'Cargas',

  'usage.tests.title': 'Días de test cargados',
  'usage.tests.caption': 'Días de test por semana y categoría',
  'usage.tests.empty': 'No se cargaron resultados de tests en el período.',
  'usage.column.testDays': 'Días de test',
  'usage.column.results': 'Resultados',
  'usage.column.playersTested': 'Jugadores medidos',
  'usage.column.imported': 'Importados',

  'usage.surfaces.title': 'Uso de las pantallas',
  'usage.surfaces.help':
    'Miembros distintos que usaron cada pantalla en la semana, sobre los miembros con ese rol. La consulta de soporte del superadmin no cuenta.',
  'usage.surfaces.caption': 'Uso de las pantallas por semana, rol y desde dónde',
  'usage.surfaces.empty': 'Nadie usó las pantallas medidas en el período.',
  'usage.column.surface': 'Pantalla',
  'usage.column.role': 'Rol',
  'usage.column.client': 'Desde',
  'usage.column.activeMembers': 'Miembros activos',
  'usage.column.memberDays': 'Días de uso',
  'usage.column.events': 'Veces',
  'usage.surface.panel': 'Panel semanal',
  'usage.surface.player_profile': 'Ficha del jugador',
  'usage.surface.test_day_sheet': 'Planilla del día de test',
  'usage.surface.player_home': 'Inicio del jugador (app)',
  'usage.surface.guardian_home': 'Hijos/as del tutor',
  'usage.surface.kiosk': 'Kiosco del club',
  'usage.client.web': 'Web',
  'usage.client.app': 'App',
} as const;
