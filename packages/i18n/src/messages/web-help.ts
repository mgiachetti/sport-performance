/**
 * Help section of the staff web (B-415): the protocols of the club's tests with their images and
 * videos, and the usage guide for the staff. Merged into the `es-AR` source catalog; same rules
 * as `es-AR.ts`. The protocol vocabulary shared with the app lives in `protocols.ts`.
 */
export const webHelpMessagesEsAR = {
  'nav.help': 'Ayuda',

  'help.title': 'Ayuda',
  'help.subtitle': 'Cómo se mide cada test y cómo usar la plataforma.',
  'help.sections': 'Secciones de la ayuda',
  'help.tab.protocols': 'Protocolos',
  'help.tab.guide': 'Guía de uso',

  // Protocols
  'help.protocols.intro':
    'Así se hace cada test, con la misma definición que usa la primera. Leelo antes del día de test: cambiar el protocolo cambia la versión y los resultados dejan de compararse sin aviso.',
  'help.protocols.sportFilter': 'Mostrando los tests de {sport}.',
  'help.protocol.documentTitle': 'Protocolo: {test}',

  // Images and videos of a protocol
  'help.media.title': 'Imágenes y videos',
  'help.media.empty': 'Este protocolo todavía no tiene imágenes ni videos.',
  'help.media.staffOnly':
    'Las imágenes y los videos los ve solo el staff: pueden mostrar a una persona.',
  'help.media.loadFailed': 'No pudimos cargar este archivo.',
  'help.media.add.title': 'Agregar una imagen o un video',
  'help.media.add.file': 'Archivo',
  'help.media.add.fileHelp': 'PNG, JPEG o WebP; video MP4 o WebM. Hasta {maxMb} MB.',
  'help.media.add.caption': 'Descripción',
  'help.media.add.captionHelp':
    'Qué se ve, para quien no puede verlo (por ejemplo: "Posición de salida, pie adelantado a 0,5 m").',
  'help.media.add.submit': 'Agregar',
  'help.media.add.uploading': 'Subiendo…',
  'help.media.add.done': 'Listo: agregamos «{caption}».',
  'help.media.add.missingFile': 'Elegí un archivo.',
  'help.media.add.missingCaption': 'Escribí una descripción.',
  'help.media.add.wrongType': 'Ese tipo de archivo no se acepta. Usá PNG, JPEG, WebP, MP4 o WebM.',
  'help.media.add.tooBig': 'El archivo pesa más de {maxMb} MB.',
  'help.media.edit': 'Editar la descripción de «{caption}»',
  'help.media.saved': 'Guardamos la descripción.',
  'help.media.archive': 'Sacar del protocolo',
  'help.media.archiveLabel': 'Sacar «{caption}» del protocolo',
  'help.media.archived': 'Sacamos «{caption}» del protocolo.',
  'help.media.video': 'Video: {caption}',

  // Usage guide for the staff
  'help.guide.intro':
    'Lo básico para trabajar con la plataforma. Cada club ajusta umbrales, batería y módulos en la configuración.',
  'help.guide.roles.title': 'Qué ve cada uno',
  'help.guide.roles.body':
    'Cada persona ve solo las categorías que tiene asignadas; la administración ve todo el club. Los jugadores ven lo suyo y la familia, la ficha resumida y los consentimientos. Si te falta una categoría, pedile a la administración que te la asigne.',
  'help.guide.wellness.title': 'Bienestar y RPE',
  'help.guide.wellness.body':
    'Antes de entrenar, cada jugador carga su bienestar desde la app: 5 ítems de 1 a 5 (sueño, fatiga, dolor muscular, estrés y ánimo); en M13/M14, 3 ítems con caritas. Entre 15 y 30 minutos después de la sesión carga el RPE (escala CR-10). Le lleva menos de 20 segundos: pedilo todos los días a la misma hora.',
  'help.guide.load.title': 'Sesiones y carga',
  'help.guide.load.body':
    'Creá la sesión con su duración y cargá los minutos de cada jugador. La carga de la sesión es RPE × minutos (UA). La carga aguda (7 días) y la crónica (28 días) se calculan con medias móviles exponenciales; el ACWR es su cociente. Con menos de 28 días de historia se muestra "historia insuficiente" y no hay alertas de ACWR.',
  'help.guide.tests.title': 'Días de test',
  'help.guide.tests.body':
    'Seguí el protocolo de cada test tal como está en esta ayuda. Por cada resultado registrá el método (manual, video, fotocélula, pod, app), el evaluador y las condiciones. Si alguien no hace el test, marcalo "no realizado" con el motivo. M13/M14 no hacen tests máximos con carga.',
  'help.guide.maturation.title': 'Maduración',
  'help.guide.maturation.body':
    'Con la talla, la talla sentado, el peso y la altura de los padres se estiman los años desde el pico de crecimiento (PHV) y el % de la talla adulta. La etapa se asigna por maduración además de la categoría, y el staff la puede fijar a mano. En la zona de pico conviene bajar saltos y sprints y vigilar rodilla y talón.',
  'help.guide.alerts.title': 'Alertas',
  'help.guide.alerts.body':
    'Las alertas son avisos para mirar a un jugador (carga alta o baja respecto de lo habitual, bienestar bajo, caída del CMJ, crecimiento rápido): no predicen lesiones ni diagnostican. Siempre traen el motivo y una sugerencia; revisalas y dejá registrado qué hiciste.',
  'help.guide.privacy.title': 'Menores y privacidad',
  'help.guide.privacy.body':
    'Para cargar datos de un jugador menor hace falta el consentimiento de su familia; los videos, además, el consentimiento de imagen. Los jugadores de M13 a M16 nunca ven rankings con nombres. Las lesiones y conmociones las gestiona el staff médico: el resto ve "no disponible", nunca el diagnóstico.',
} as const;
