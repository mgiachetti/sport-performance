/**
 * Messages of the staff web shell (B-401, ADR 0057): layout, sign-in, club selector, support mode,
 * scope selector, connection status and error envelope. Merged into the `es-AR` source catalog;
 * same rules as `es-AR.ts`. Screens add their own namespace here or next to it.
 */
export const webMessagesEsAR = {
  'app.documentTitle': '{page} · {appName}',

  // Layout and accessibility
  'layout.skipToContent': 'Saltar al contenido',
  'nav.label': 'Secciones',
  'nav.open': 'Abrir el menú',
  'nav.close': 'Cerrar el menú',
  'account.menu': 'Tu cuenta',
  'layout.clubApp': '{shortName} Performance',

  // Home of the club
  'home.title': 'Inicio',
  'home.role': 'Tu rol en {clubName}: {role}',
  'home.scope.title': 'Lo que ves',
  'home.scope.club': 'Todas las categorías del club.',
  'home.scope.assigned':
    '{count, plural, =0 {Todavía no tenés categorías asignadas. Pedile a la administración del club que te asigne.} one {# categoría asignada.} other {# categorías asignadas.}}',
  'home.scope.selected': 'Mirando: {scope}',
  'home.shortcuts.title': 'Accesos',
  'home.shortcuts.subtitle': 'Las secciones que podés abrir con tu rol.',
  'home.shortcuts.open': 'Abrir',

  // Club selector
  'club.select.subtitle': 'Tenés acceso a más de un club. Elegí con cuál querés trabajar.',
  'club.select.none':
    'Tu cuenta no tiene acceso a ningún club. Si te invitaron, abrí el link de la invitación.',
  'club.select.unavailable': 'Ya no tenés acceso a ese club. Elegí otro.',
  'club.staffOnly.title': 'La web es para el staff',
  'club.staffOnly.body':
    'Con tu rol en {clubName} ({role}) usás la app en el teléfono: ahí cargás el bienestar y el RPE y ves la ficha.',

  // File picker (FileField): our own button and file name, in es-AR
  'field.file.choose': 'Elegir archivo',
  'field.file.none': 'Ningún archivo elegido',

  // Standalone screens (sign-in, club selector, errors): the brand panel
  'standalone.productMark': 'SP',
  'standalone.tagline': 'El rendimiento de las juveniles, medido como en la primera.',
  'standalone.point.metrics':
    'Tests, carga, bienestar y maduración con las mismas métricas y definiciones que la primera.',
  'standalone.point.load':
    'Cada semana, quién necesita una mirada: carga, bienestar y crecimiento.',
  'standalone.point.privacy': 'Datos de menores protegidos, con el consentimiento de las familias.',

  // Superadmin support (X-Support-Club-Id + X-Support-Reason, ADR 0032)
  'support.title': 'Modo soporte',
  'support.start': 'Entrar a un club como soporte',
  'support.intro':
    'Como superadministrador/a no sos miembro de los clubes. Para ver uno, contá por qué: el motivo queda registrado con cada pedido que hagas.',
  'support.reason.label': 'Motivo del acceso',
  'support.reason.help': 'Por ejemplo: "Ticket 1234: el preparador físico no ve la M15".',
  'support.reason.required': 'Contá el motivo antes de buscar el club.',
  'support.search.label': 'Buscar club por nombre o sigla',
  'support.search.submit': 'Buscar',
  'support.noClubs': 'No encontramos clubes con esa búsqueda.',
  'support.enter': 'Entrar a {clubName}',
  'support.banner': 'Estás en {clubName} como soporte. Motivo: {reason}',
  'support.exit': 'Salir del modo soporte',

  // Sport and category of the layout
  'scope.label': 'Qué estás mirando',
  'scope.sport.label': 'Deporte',
  'scope.sport.all': 'Todos los deportes',
  'scope.category.label': 'Categoría',
  'scope.category.all': 'Todas las categorías',
  'scope.none': 'Sin categorías para mostrar',
  'scope.ignored':
    'El link pedía un deporte o una categoría que no ves: te mostramos lo que sí ves.',
  'sex.male': 'Masculino',
  'sex.female': 'Femenino',

  // Theme variant
  'theme.label': 'Colores',
  'theme.option.system': 'Automático',
  'theme.option.dark': 'Oscuro',
  'theme.option.lightHc': 'Claro, alto contraste (para el sol)',

  // Connection status (always icon + text)
  'connection.label': 'Estado de la conexión',
  'connection.online': 'En línea',
  'connection.offline': 'Sin conexión',
  'connection.offlineDetail':
    'Lo que guardes queda en espera en esta pestaña y se envía cuando vuelva la conexión. No cierres la pestaña.',
  'connection.unreachable': 'No llegamos al servidor. Reintentando…',
  'connection.updatedAt': 'Actualizado a las {time}',

  // A tab older than the deployed API
  'webUpdate.title': 'Hay una versión nueva de la web',
  'webUpdate.body':
    'Recargá la página para seguir con la última versión. Guardá antes lo que estés cargando.',
  'webUpdate.action': 'Recargar',

  // Errors of the shell (the per-code messages of the envelope are shared, in `es-AR.ts`)
  'error.title': 'No pudimos cargar esto',
  'error.requestId': 'Código para soporte: {requestId}',
  'error.contract': 'La web quedó desactualizada respecto del servidor. Recargá la página.',
  'error.pageNotFound.title': 'Esta página no existe',
  'error.pageNotFound.body': 'Revisá el link o volvé al inicio.',
  'error.reload': 'Recargar',
} as const;
