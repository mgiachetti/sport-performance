/**
 * Messages of the staff web shell (B-401, ADR 0054): layout, sign-in, club selector, support mode,
 * scope selector, connection status and error envelope. Merged into the `es-AR` source catalog;
 * same rules as `es-AR.ts`. Screens add their own namespace here or next to it.
 */
export const webMessagesEsAR = {
  'app.name': 'Sport Performance',
  'app.documentTitle': '{page} · {appName}',

  // Layout and accessibility
  'layout.skipToContent': 'Saltar al contenido',
  'nav.label': 'Secciones',
  'nav.home': 'Inicio',
  'account.menu': 'Tu cuenta',

  // Home of the club
  'home.title': 'Inicio',
  'home.greeting': 'Hola, {name}',
  'home.greetingAnonymous': 'Hola',
  'home.role': 'Tu rol en {clubName}: {role}',
  'home.scope.title': 'Lo que ves',
  'home.scope.club': 'Todas las categorías del club.',
  'home.scope.assigned':
    '{count, plural, =0 {Todavía no tenés categorías asignadas. Pedile a la administración del club que te asigne.} one {# categoría asignada.} other {# categorías asignadas.}}',
  'home.scope.selected': 'Mirando: {scope}',

  // Sign-in (email OTP, cookie session)
  'auth.signIn.title': 'Ingresá a {appName}',
  'auth.signIn.subtitle': 'Te mandamos un código de un solo uso a tu email. No hay contraseña.',
  'auth.email.submit': 'Mandame el código',
  'auth.email.invalid': 'Ingresá un email válido.',
  'auth.otp.submit': 'Ingresar',
  'auth.otp.format': 'El código tiene {length} dígitos.',
  'auth.otp.expiresIn':
    'El código vence en {minutes, plural, one {# minuto} other {# minutos}} y sirve una sola vez.',
  'auth.otp.resend': 'Mandame otro código',
  'auth.otp.resent': 'Te mandamos un código nuevo. El anterior ya no sirve.',
  'auth.otp.changeEmail': 'Usar otro email',
  'auth.rateLimitedFor':
    'Hiciste muchos intentos seguidos. Probá de nuevo en {seconds, plural, one {# segundo} other {# segundos}}.',

  // Club selector
  'club.select.subtitle': 'Tenés acceso a más de un club. Elegí con cuál querés trabajar.',
  'club.select.none':
    'Tu cuenta no tiene acceso a ningún club. Si te invitaron, abrí el link de la invitación.',
  'club.select.unavailable': 'Ya no tenés acceso a ese club. Elegí otro.',
  'club.switch': 'Cambiar de club',
  'club.logoAlt': 'Escudo de {clubName}',
  'club.staffOnly.title': 'La web es para el staff',
  'club.staffOnly.body':
    'Con tu rol en {clubName} ({role}) usás la app en el teléfono: ahí cargás el bienestar y el RPE y ves la ficha.',

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
  'sport.rugby': 'Rugby',
  'sport.hockey': 'Hockey',
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

  // Error envelope: one message per API error code (packages/contracts ERROR_STATUS)
  'error.title': 'No pudimos cargar esto',
  'error.requestId': 'Código para soporte: {requestId}',
  'error.code.bad_request': 'El pedido no es válido. Revisá los datos y probá de nuevo.',
  'error.code.validation_failed': 'Hay datos que no son válidos. Revisalos y probá de nuevo.',
  'error.code.consent_required':
    'Falta el consentimiento del jugador o de su tutor/a para hacer esto.',
  'error.code.reauthentication_required':
    'Por seguridad, volvé a ingresar con un código nuevo y probá otra vez.',
  'error.code.conflict':
    'Alguien cambió estos datos mientras los editabas. Recargá para ver la última versión.',
  'error.code.payload_too_large': 'Lo que mandaste es demasiado grande.',
  'error.code.rate_limited': 'Hiciste muchos pedidos seguidos. Esperá un momento y probá de nuevo.',
  'error.code.service_unavailable':
    'El servicio no está disponible en este momento. Probá de nuevo en unos minutos.',
  'error.contract': 'La web quedó desactualizada respecto del servidor. Recargá la página.',
  'error.pageNotFound.title': 'Esta página no existe',
  'error.pageNotFound.body': 'Revisá el link o volvé al inicio.',
  'error.goHome': 'Ir al inicio',
  'error.reload': 'Recargar',
} as const;
