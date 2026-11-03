/**
 * Messages only the mobile app uses (B-501, ADR 0058): sign-in with the family code, club
 * selector, startup, account and invitation links. Merged into the `es-AR` source catalog; same
 * rules as `es-AR.ts`. A message that the web also needs moves to `es-AR.ts` with one key, one
 * text and one set of arguments for both apps: no key lives in more than one file.
 */
export const mobileMessagesEsAR = {
  // Sign-in (email OTP, bearer session)
  'auth.email.placeholder': 'nombre@ejemplo.com',
  'auth.otp.title': 'Revisá tu correo',
  'auth.withEmail': 'Ingresar con mi email',

  // Sign-in with the code or link of a parent or guardian
  'auth.playerAccess.link': 'Tengo un código de mi familia',
  'auth.playerAccess.title': 'Ingresá con el código de tu familia',
  'auth.playerAccess.body':
    'Pedile a tu mamá, papá o tutor/a que genere un código desde su cuenta. Sirve una sola vez y vence en {minutes, plural, one {# minuto} other {# minutos}}.',
  'auth.playerAccess.label': 'Código de ingreso',
  'auth.playerAccess.invalidFormat': 'El código tiene 8 letras y números, por ejemplo K7QM-2XPA.',
  'auth.playerAccess.notFound': 'No encontramos ese código. Revisalo o pedí uno nuevo.',
  'auth.playerAccess.unavailable':
    'Ese código o link ya no sirve: se usó, venció o se anuló. Pedí uno nuevo.',
  'auth.playerAccess.signingIn': 'Ingresando…',
  'auth.playerAccess.signedIn':
    'Ya hay una sesión abierta en este teléfono. Cerrala desde Cuenta para ingresar con este link.',

  // Club selector
  'club.select.body':
    'Tenés acceso a más de un club o con más de un rol. Elegí con cuál entrar; lo podés cambiar desde Cuenta.',
  'club.select.current': 'Club actual',
  'club.none.title': 'Todavía no tenés un club',
  'club.none.body':
    'Para usar la app, alguien del club tiene que invitarte. Abrí el link de la invitación que te llegó por email.',
  'club.membershipLost': 'Ya no tenés acceso a ese club con ese rol. Elegí con cuál seguir.',

  // Startup without a cached session snapshot
  'startup.unavailable.title': 'No pudimos conectarnos',
  'startup.unavailable.body':
    'La primera vez después de ingresar necesitamos conexión para traer tus clubes. Revisá la señal y probá de nuevo.',

  // Navigation and home
  'nav.account': 'Cuenta',
  'home.next':
    'Desde acá vas a cargar tu bienestar y tu esfuerzo, y ver tus tests y lo que tengas pendiente.',

  // Account
  'account.title': 'Cuenta',
  'account.signedInAs': 'Ingresaste como {email}',
  'account.appearance': 'Apariencia',
  'account.highContrast': 'Alto contraste para usar al sol',
  'account.highContrast.hint': 'Fondo claro y textos más marcados.',
  'account.version': 'Versión {version}',
  'account.signOut.offline':
    'Sin conexión: la sesión se cierra en este teléfono. Para cerrarla también en el servidor, entrá desde otro dispositivo a Sesiones activas.',

  // Invitation links
  'invitation.invalidLink':
    'El link de la invitación no es válido. Abrilo de nuevo desde el email que te llegó.',
  'invitation.goToClub': 'Entrar al club',
  'invitation.signIn': 'Ingresar para aceptar',
} as const;
