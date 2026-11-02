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

  // Errors
  'error.generic': 'Algo salió mal. Probá de nuevo.',
  'error.network': 'No hay conexión. Revisá la señal y probá de nuevo.',
  'error.forbidden': 'No tenés permiso para ver esto.',
  'error.notFound': 'No encontramos lo que buscabas.',
  'error.sessionExpired': 'Tu sesión venció. Volvé a ingresar.',
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
