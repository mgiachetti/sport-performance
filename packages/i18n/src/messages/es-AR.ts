/**
 * Source catalog: Rioplatense Spanish (vos). Every key exists here first; other locales and club
 * overrides are checked against it.
 *
 * Rules for writing messages:
 * - ICU MessageFormat syntax (`{name}`, `{count, plural, ...}`, `{value, select, ...}`).
 * - Arguments are strings or numbers only. Dates, times and measured values are formatted before
 *   being passed (`formatDate`, `formatUnit`, ...) so that they use the club time zone and SI units.
 * - Flat keys, `namespace.name` in camelCase; domain codes keep their `snake_case` (`test.sprint_40`).
 * - Status texts always exist as words: the UI never conveys a state by color alone.
 */
export const esAR = {
  // Shared actions and labels
  'common.save': 'Guardar',
  'common.cancel': 'Cancelar',
  'common.confirm': 'Confirmar',
  'common.retry': 'Reintentar',
  'common.edit': 'Editar',
  'common.delete': 'Eliminar',
  'common.close': 'Cerrar',
  'common.back': 'Volver',
  'common.next': 'Siguiente',
  'common.search': 'Buscar',
  'common.loading': 'Cargando…',
  'common.noData': 'Sin datos',
  'common.notAvailable': 'No disponible',
  'common.today': 'Hoy',
  'common.yesterday': 'Ayer',
  'common.category': 'Categoría {name}',
  'common.showTable': 'Ver como tabla',

  // Status: always shown with icon + text, never color alone
  'status.ok': 'Bien',
  'status.warning': 'Atención',
  'status.critical': 'Crítico',
  'status.insufficientHistory': 'Historia insuficiente',
  'status.insufficientHistoryDetail':
    'Hacen falta al menos {days, plural, one {# día} other {# días}} de carga para calcular este indicador.',

  // Offline and sync
  'sync.offline':
    'Sin conexión. Lo que cargues se guarda en el teléfono y se envía cuando vuelva la señal.',
  'sync.pending':
    '{count, plural, =0 {Nada pendiente de envío} one {# cambio sin enviar} other {# cambios sin enviar}}',
  'sync.syncing': 'Sincronizando…',
  'sync.synced': 'Todo sincronizado',
  'sync.lastSynced': 'Última sincronización: {dateTime}',
  'sync.failed': 'No pudimos sincronizar. Lo volvemos a intentar solos en unos minutos.',
  'sync.pausedForUpdate':
    'Sincronización en pausa hasta que actualices la app. Lo que cargues queda guardado en el teléfono.',

  // App versions (B-324): "actualizá la app"
  'appUpdate.required.title': 'Actualizá la app',
  'appUpdate.required.body':
    'La versión {currentVersion} ya no funciona con el servidor. Instalá la {minVersion} o una más nueva para seguir.',
  'appUpdate.required.action': 'Actualizar',
  'appUpdate.required.noStoreLink': 'Buscá la app en la tienda de tu teléfono y actualizala.',
  'appUpdate.required.offline':
    'Esta versión ya no es compatible. Podés seguir cargando sin conexión: tus datos quedan en el teléfono y se envían cuando actualices la app.',
  'appUpdate.available.title': 'Hay una versión nueva',
  'appUpdate.available.body': 'La versión {latestVersion} ya está en la tienda.',
  'appUpdate.available.action': 'Actualizar',
  'appUpdate.available.dismiss': 'Más tarde',

  // Errors
  'error.generic': 'Algo salió mal. Probá de nuevo.',
  'error.network': 'No hay conexión. Revisá la señal y probá de nuevo.',
  'error.forbidden': 'No tenés permiso para ver esto.',
  'error.notFound': 'No encontramos lo que buscabas.',
  'error.sessionExpired': 'Tu sesión venció. Volvé a ingresar.',
  'error.appUpdateRequired': 'Esta versión de la app ya no es compatible. Actualizala para seguir.',
  'error.validation.required': 'Este dato es obligatorio.',
  'error.validation.number': 'Ingresá un número válido, con coma decimal (por ejemplo, 1,85).',
  'error.validation.range': 'Ingresá un valor entre {min} y {max}.',

  // Auth (email OTP)
  'auth.signIn': 'Ingresar',
  'auth.signOut': 'Cerrar sesión',
  'auth.email.label': 'Email',
  'auth.otp.label': 'Código',
  'auth.otp.sent': 'Te mandamos un código a {email}. Revisá tu correo.',
  'auth.otp.invalid': 'El código no es válido o ya venció. Pedí uno nuevo.',
  'auth.otp.tooManyAttempts': 'Probaste demasiadas veces. Pedí un código nuevo.',
  'auth.rateLimited': 'Hiciste muchos intentos seguidos. Esperá unos minutos y probá de nuevo.',

  // Active sessions per device (B-333)
  'session.title': 'Sesiones activas',
  'session.current': 'Esta sesión',
  'session.clientType.web': 'Web',
  'session.clientType.mobile': 'App',
  'session.signedInAt': 'Ingresó el {date}',
  'session.lastUsedAt': 'Último uso: {date}',
  'session.revoke': 'Cerrar esta sesión',
  'session.revokeOthers': 'Cerrar las demás sesiones',
  'session.revokeOthers.confirm':
    'Se van a cerrar todas tus sesiones menos esta. En esos dispositivos vas a tener que ingresar de nuevo.',
  'session.revoked':
    '{count, plural, =0 {No había otras sesiones abiertas.} one {Se cerró # sesión.} other {Se cerraron # sesiones.}}',
  'device.label': '{browser} en {os}',
  'device.unknown': 'Dispositivo sin identificar',
  'device.os.ios': 'iOS',
  'device.os.android': 'Android',
  'device.os.macos': 'macOS',
  'device.os.windows': 'Windows',
  'device.os.linux': 'Linux',
  'device.os.chromeos': 'ChromeOS',
  'device.browser.chrome': 'Chrome',
  'device.browser.safari': 'Safari',
  'device.browser.firefox': 'Firefox',
  'device.browser.edge': 'Edge',
  'device.browser.opera': 'Opera',
  'device.browser.samsung_internet': 'Samsung Internet',
  'device.browser.app': 'la app',

  // Club selector and invitations
  'club.select.title': 'Elegí el club',
  'club.select.asRole': '{clubName} · {role}',
  'invitation.title': 'Te invitaron a {clubName}',
  'invitation.asRole': 'Para sumarte como {role}.',
  'invitation.accept': 'Aceptar invitación',
  'invitation.signInFirst': 'Ingresá con {emailHint} para aceptarla.',
  'invitation.accepted': 'Listo, ya sos parte de {clubName}.',
  'invitation.status.pending': 'Pendiente',
  'invitation.status.accepted': 'Ya se usó',
  'invitation.status.revoked': 'Anulada',
  'invitation.status.expired': 'Vencida',
  'invitation.error.unavailable':
    'Esta invitación ya no sirve: venció, se anuló o ya se usó. Pedile una nueva a quien te invitó.',
  'invitation.error.wrongEmail':
    'Esta invitación es para otro email. Ingresá con el email al que te llegó.',

  // Emails (React Email templates of apps/api)
  'email.appName': 'Sport Performance',
  'email.footer': 'Este correo lo mandó {appName} automáticamente. No hace falta que lo respondas.',
  'email.signInCode.subject': '{code} es tu código para ingresar',
  'email.signInCode.preview': 'Tu código para ingresar a {appName}',
  'email.signInCode.heading': 'Tu código para ingresar',
  'email.signInCode.body':
    'Escribilo en la app o en la web. Vence en {minutes, plural, one {# minuto} other {# minutos}} y sirve una sola vez.',
  'email.signInCode.ignore':
    'Si no lo pediste, ignorá este correo: sin el código nadie puede entrar a tu cuenta.',
  'email.invitation.subject': 'Te invitaron a {clubName}',
  'email.invitation.preview': 'Sumate a {clubName} en {appName}',
  'email.invitation.heading': 'Te invitaron a {clubName}',
  'email.invitation.body': '{inviterName} te invitó a sumarte a {clubName} como {role}.',
  'email.invitation.bodyNoInviter': 'Te invitaron a sumarte a {clubName} como {role}.',
  'email.invitation.cta': 'Aceptar invitación',
  'email.invitation.expires': 'El link vence el {date} y sirve una sola vez.',
  'email.invitation.fallback': 'Si el botón no anda, copiá este link en el navegador:',
  'email.invitation.ignore': 'Si no esperabas esta invitación, ignorá este correo.',
  'email.newSignIn.subject': 'Ingreso nuevo a tu cuenta',
  'email.newSignIn.preview': 'Se ingresó a tu cuenta de {appName} desde un dispositivo nuevo',
  'email.newSignIn.heading': 'Ingreso nuevo a tu cuenta',
  'email.newSignIn.body': 'Se ingresó a tu cuenta desde un dispositivo nuevo: {device}, el {date}.',
  'email.newSignIn.ifYou': 'Si fuiste vos, no tenés que hacer nada.',
  'email.newSignIn.ifNotYou':
    'Si no fuiste vos, entrá a la app o a la web, abrí Sesiones activas y cerrá esa sesión. Para ingresar hace falta el código que llega a este correo: revisá quién más puede leerlo.',

  // Notifications (B-328): `notification.<kind>.title|body`, the same text for push and email.
  // Operational nudges only: never health data, metric values or a player's name next to an alert.
  'notification.rpe_request.title': '¿Qué tan dura fue la sesión?',
  'notification.rpe_request.body':
    '{session, select, match {Contanos cómo te fue en el partido: cargar el RPE lleva 10 segundos.} other {Contanos cómo te fue en el entrenamiento: cargar el RPE lleva 10 segundos.}}',
  'notification.rpe_reminder.title': 'Te falta cargar el RPE',
  'notification.rpe_reminder.body':
    '{session, select, match {¿Qué tan duro fue el partido de ayer?} other {¿Qué tan duro fue el entrenamiento de ayer?}} Cargalo hoy, antes de que cierre.',
  'notification.critical_alert.title': 'Alerta crítica en {categoryName}',
  'notification.critical_alert.body':
    'Hay una alerta crítica nueva en {categoryName}. Revisala en el panel antes de planificar la carga.',
  'notification.pre_training_summary.title':
    '{categoryName}: {session, select, match {antes del partido} other {antes de entrenar}}',
  'notification.pre_training_summary.body':
    'A las {time}. Alertas abiertas: {critical, plural, =0 {ninguna crítica} one {# crítica} other {# críticas}} y {warning, plural, =0 {ninguna de atención} one {# de atención} other {# de atención}}. Bienestar cargado: {wellnessSubmitted} de {players}.',
  'notification.pre_training_summary.bodyWithoutWellness':
    'A las {time}. Alertas abiertas: {critical, plural, =0 {ninguna crítica} one {# crítica} other {# críticas}} y {warning, plural, =0 {ninguna de atención} one {# de atención} other {# de atención}}.',
  'email.notification.cta': 'Abrir en la web',
  'email.notification.openApp': 'Cargalo desde la app, en la sesión.',
  'email.notification.preferences':
    'Elegí qué avisos te llegan y por dónde en Preferencias de notificaciones, en la app o en la web.',

  // Roles
  'role.player': 'Jugador/a',
  'role.parent': 'Madre, padre o tutor/a',
  'role.coach': 'Entrenador/a',
  'role.sc': 'Preparador/a físico/a',
  'role.medical': 'Staff médico',
  'role.admin': 'Administrador/a',
  'role.superadmin': 'Superadministrador/a',

  // Development stages (by category; the staff can pin a stage by hand)
  'stage.m13_m14': 'M13 / M14',
  'stage.m15_m16': 'M15 / M16',
  'stage.m17_m19': 'M17 / M19',

  // Why a player has a stage (codes from STAGE_REASONS, B-204)
  'stageReason.pinned': 'Fijada a mano por el staff',
  'stageReason.no_maturation_estimate': 'Por categoría: no hay estimación de maduración',
  'stageReason.maturation_estimate_stale':
    'Por categoría: la última estimación de maduración está desactualizada',
  'stageReason.maturation_estimate_after_date':
    'Por categoría: la estimación de maduración es posterior a esta fecha',
  'stageReason.maturation_matches_category': 'La maduración coincide con la categoría',
  'stageReason.within_uncertainty_margin':
    'Por categoría: la maduración está dentro del margen de error',
  'stageReason.maturation_disabled': 'Por categoría: el club no ajusta la etapa por maduración',
  'stageReason.maturation_shift': 'Ajustada por maduración',
  'stageReason.maturation_shift_capped': 'Ajustada por maduración, hasta el máximo permitido',

  // Bio-banding bands (codes from DEFAULT_BIO_BANDING_SCHEMES, B-204)
  'bioBand.pre_phv': 'Antes del pico de crecimiento',
  'bioBand.circa_phv': 'En el pico de crecimiento',
  'bioBand.post_phv': 'Después del pico de crecimiento',
  'bioBand.pre_pubertal': 'Menos del 85 % de la talla adulta',
  'bioBand.early_pubertal': '85 a 90 % de la talla adulta',
  'bioBand.mid_pubertal': '90 a 95 % de la talla adulta',
  'bioBand.late_pubertal': '95 % o más de la talla adulta',

  // Wellness (pre-training) and RPE (post-training)
  'wellness.title': 'Bienestar',
  'wellness.prompt': '¿Cómo llegás hoy?',
  'wellness.item.sleep': 'Sueño',
  'wellness.item.fatigue': 'Fatiga',
  'wellness.item.soreness': 'Dolor muscular',
  'wellness.item.stress': 'Estrés',
  'wellness.item.mood': 'Ánimo',
  'wellness.submitted': '¡Listo! Gracias por cargar tu bienestar.',
  'wellness.streak': '{days, plural, one {# día seguido} other {# días seguidos}}',
  'rpe.title': 'Esfuerzo percibido (RPE)',
  'rpe.prompt': '¿Qué tan dura fue la sesión?',
  'rpe.scale.0': 'Reposo',
  'rpe.scale.1': 'Muy, muy suave',
  'rpe.scale.2': 'Suave',
  'rpe.scale.3': 'Moderado',
  'rpe.scale.4': 'Algo duro',
  'rpe.scale.5': 'Duro',
  'rpe.scale.7': 'Muy duro',
  'rpe.scale.10': 'Máximo',
  'rpe.sessionLoad': 'Carga de la sesión: {load}',

  // Test battery (codes from the metric dictionary)
  'test.anthro': 'Antropometría',
  'test.sprint_40': 'Sprint 10/20/40 m',
  'test.cmj': 'Salto con contramovimiento (CMJ)',
  'test.cod_505': '505 (cambio de dirección)',
  'test.ift_3015': '30-15 IFT',
  'test.bronco': 'Bronco',
  'test.strength': 'Fuerza',
  'test.mobility': 'Movilidad',
  'test.reaction': 'Reacción',
  'test.neck': 'Cuello isométrico',

  // How a result was measured
  'method.manual': 'Manual',
  'method.video': 'Video',
  'method.photocell': 'Fotocélula',
  'method.pod': 'Pod',
  'method.app': 'App',
  'method.historical': 'Histórico',
  'method.mismatchWarning':
    'Ojo: estos resultados se midieron con métodos distintos ({methods}) y pueden no ser comparables.',

  // Alerts (B-207): `alert.<kind>.message|suggestion` from the domain rules engine. Arguments are
  // the keys of `Alert.values`, formatted before being passed. Load heuristics, never a diagnosis;
  // the severity is shown apart with `status.*`.
  'alert.acwr_high.message':
    'Carga aguda alta respecto de la crónica: ACWR {acwrRatio} (umbral {thresholdRatio}).',
  'alert.acwr_high.suggestion':
    'Revisá el volumen de los próximos días y evitá sumar carga de golpe.',
  'alert.acwr_low.message':
    'Carga aguda baja respecto de la crónica: ACWR {acwrRatio} (umbral {thresholdRatio}).',
  'alert.acwr_low.suggestion': 'Subí la carga de forma progresiva para no perder la base.',
  'alert.wellness_low.message': 'Bienestar bajo: {wellnessScore} de 5 (umbral {thresholdScore}).',
  'alert.wellness_low.suggestion':
    'Hablá antes de entrenar y considerá ajustar la carga de la sesión.',
  'alert.wellness_zscore_low.message':
    'Bienestar por debajo de lo habitual: {wellnessScore} contra una media propia de {meanScore} (z = {zScore}).',
  'alert.wellness_zscore_low.suggestion':
    'Preguntá cómo durmió y cómo se siente; si se repite, bajá la carga.',
  'alert.cmj_drop.message':
    'CMJ {dropPct} por debajo de la base: {heightCm} contra {baselineHeightCm}.',
  'alert.cmj_drop.suggestion':
    'Posible fatiga neuromuscular: considerá bajar la intensidad y el volumen de saltos y sprints.',
  'alert.growth_peak.message':
    'Crecimiento rápido: {velocityCmYear} (zona de pico desde {thresholdCmYear}).',
  'alert.growth_peak.suggestion':
    'Bajá el volumen de saltos y sprints y vigilá molestias en rodilla y talón.',

  // Time spans
  'duration.days': '{count, plural, one {# día} other {# días}}',
  'duration.weeks': '{count, plural, one {# semana} other {# semanas}}',
  'duration.years': '{count, plural, one {# año} other {# años}}',

  // Disclaimers
  'legal.notMedicalDevice':
    'Esta app monitorea la carga de entrenamiento. No diagnostica ni reemplaza al staff médico.',
} as const;
