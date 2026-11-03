# 0069. Informe PDF del jugador por ventana: instantánea en la API, render en el worker y archivo `pdf_report`

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #91 (B-602)

## Contexto

B-602 pide un informe en PDF del jugador por ventana de test (V1–V4) para el jugador y su familia. Ya estaba decidido:

- el ADR 0044 dejó el tipo de archivo `pdf_report` (365 días de retención, `attachment`, sin subida de una persona), escrito "por el worker con `ObjectStorage` y una fila `pdf_report`", y lo hizo visible con `player_summary.read`;
- el ADR 0060 fijó cómo se leen la evolución por ventana, el promedio de la categoría (mínimo de 5 jugadores, ventana terminada, misma franja, sexo y versión del protocolo, nunca un agregado que se pueda restar) y la zona de pico, con `app.percentile_samples` ejecutable solo por la API y con un rol de staff o el jugador;
- el ADR 0040 dejó la referencia de primera que aplica a un jugador;
- el ADR 0029 dejó que una lesión, para quien no es `medical`, es "no disponible".

Faltaba decidir:

- dónde se genera (en el request o en un job);
- quién decide qué muestra, con qué permisos;
- quién lo pide y quién lo lee, si el tutor no tiene `test_result.read` ni `group_reference.read`;
- cómo se escribe el archivo sin dejar objetos huérfanos en el bucket;
- con qué librería y tipografía se arma el PDF.

## Decisión

### Instantánea en la API, render en el worker

- **La API arma el contenido; el worker solo lo dibuja.** `POST /v1/players/{playerId}/reports` (`testWindowId`, `clientUuid` opcional) lee en la transacción del pedido, con el contexto validado de quien lo pide, lo que va a mostrar el informe, y lo guarda como una **instantánea versionada** (`player_report.content`, `formatVersion = 1`, `playerReportContentSchema` de `packages/contracts`). Responde `202` con el informe `pending`.
  - Reusa las funciones de la ficha (`readSamples`, `evolution`, `groupSpan`, `peakZoneOf`) y de las referencias (`referenceSportOf`, `firstTeamReferencesOf`). No hay una segunda implementación de las reglas de privacidad en el worker, ni hay que darle al worker `app.percentile_samples`.
  - El PDF muestra lo que se decidió al pedirlo: corregir un dato después no cambia en silencio un informe ya entregado. Pedirlo otra vez genera un informe nuevo.
  - El contenido se valida con el mismo esquema antes de guardarlo y otra vez en el worker: un formato que el worker no conoce falla a la vista (`invalid_content`), no se dibuja a medias.
- **El worker dibuja, sube y registra.** Un job por club (`player-reports-club`, `stately`, reintentos y cola de muertos) toma los pedidos vencidos. Lo disparan tres caminos:
  - un trigger que avisa al confirmar el alta (`pg_notify('sport_performance_player_report', club_id)`), escuchado por el mismo listener del outbox (ADR 0046);
  - un barrido cada minuto (`player-reports-sweep`, por `app.worker_report_clubs()`, `SECURITY DEFINER`, solo para el worker, que devuelve ids de club y nada más);
  - el arranque del worker.

  Sin bucket, el job queda apagado, como la retención (ADR 0044).
- **Por qué no en el request:** dibujar un PDF con fuentes embebidas ocupa CPU de la API y su latencia. Subirlo es una llamada a un proveedor dentro de la transacción. Un error del bucket haría fallar el pedido entero. El job tiene reintentos con backoff y no compite con los requests.

### Contenido y privacidad

- **Lo que muestra:**
  - la marca del club (nombre, colores, escudo PNG);
  - el jugador: nombre, nacimiento, edad al cierre, deporte, categorías;
  - la ventana con sus fechas y la fecha de generación;
  - por métrica de los tests de la ventana: su valor (el mejor según el sentido), el de su columna anterior con resultado y el cambio con su sentido en palabras ("mejor" / "peor"), el promedio de su categoría, la referencia de primera, el método y los avisos de métodos o versiones del protocolo mezclados (principio 4);
  - los tests no realizados sin uno hecho después;
  - la evolución de cada métrica en las ventanas del jugador hasta esta (hasta 6 columnas), con el promedio debajo;
  - la última medición antropométrica hasta el cierre (talla, talla sentado, peso, offset de PHV con la ecuación, % y talla adulta predicha, velocidad de crecimiento) y el aviso de zona de pico en lenguaje para la familia;
  - cómo leer el informe y el aviso de que no es un dispositivo médico.
- **Lo que nunca muestra:**
  - nombres, ids o valores de otros jugadores: el promedio solo con las reglas del ADR 0060, mínimo de 5 y ventana terminada, sin el tamaño del grupo;
  - percentiles y rankings: el tutor no los ve en la matriz, y un percentil "a hoy" en un documento que se guarda un año envejece mal;
  - datos de salud: una lesión sale como "no disponible" (`notDoneReasonForViewer` con el rol del tutor);
  - la disponibilidad por días: pediría leer el esquema `medical`, y el informe es de tests y maduración.
- **El día de corte** es el fin de la ventana, o hoy mientras está abierta. Con la ventana abierta no hay promedio (ADR 0060) y el informe lo dice.
- **Una ventana válida** es de una temporada del deporte del jugador, ninguna de las dos archivada, ya empezada (`409` si no empezó, `400` si es de otro deporte, `404` si no existe).

### Permisos

- **Recurso nuevo `player_report`** en la matriz:
  - `read`: el jugador lo suyo, el tutor (`guardian`, como `player_summary`), el staff asignado y la administración;
  - `generate`: el `sc` asignado, la administración y el superadmin con su acceso de soporte.

  El informe es lo que el club le entrega a la familia: su contenido ya está acotado por quien lo pidió y por las reglas de arriba. Por eso el tutor lo lee aunque no tenga `test_result.read`.
- **Esto modifica el ADR 0044 en una celda:** ver y bajar un `pdf_report` pide `player_report.read` (antes `player_summary.read`, que daba el mismo alcance por rol).
- **RLS** (`player_report`, migración `0036_player_reports`):
  - lectura con el alcance por jugador (el jugador, el tutor, el staff asignado, la administración);
  - la API inserta como quien lo pide (`created_by` del contexto), `pending`, sin archivo ni intentos, y nunca edita;
  - el worker solo actualiza el resultado: estado, archivo, intentos, próximo intento y código de fallo, por grants de columna;
  - un trigger guard no deja cambiar el jugador, la ventana ni la instantánea, ni tocar un informe terminado, y exige que su archivo sea un `pdf_report` del mismo jugador;
  - nadie borra un informe. Tiene clave al jugador, así que la exportación y la supresión del titular lo cubren solas (ADR 0051).

### El archivo

- **La fila antes que el objeto.** El worker:
  1. reclama el informe (`FOR UPDATE SKIP LOCKED`, `attempts + 1`, `next_attempt_at` 10 minutos adelante como préstamo, así dos workers nunca dibujan el mismo y uno que muere lo deja para otro intento);
  2. lo dibuja;
  3. inserta la fila `file` `pending` con tamaño y SHA-256, que vence en 24 horas;
  4. sube el objeto con `ObjectStorage.put`, nuevo en `packages/storage`, que firma el SHA-256 para que el bucket rechace otro cuerpo;
  5. pasa la fila a `ready` con la retención de `pdf_report` (365 días) y completa el informe, solo si sigue teniendo el préstamo (compara los intentos).

  Si la subida falla o perdió el préstamo, marca la fila `deleted` (`deletedFileExpiresAt`) y la retención borra lo que haya llegado. Nunca queda en el bucket un objeto sin fila: el informe de un menor siempre vence.
- **Intentos:** tres (`PLAYER_REPORT_MAX_ATTEMPTS`), con 5 y 10 minutos entre ellos. Una instantánea ilegible o un PDF más grande que la política fallan sin reintento. Los códigos (`invalid_content`, `render_failed`, `too_large`, `storage_failed`) no llevan datos personales, y el log solo lleva ids y códigos.
- **Nombre de descarga:** "Informe Temporada 2026 V2 - Nombre Apellido.pdf" (texto de i18n, saneado con `sanitizeFileName`). Se baja por `GET /v1/files/{id}/download`: URL firmada de minutos, `attachment`.
- **Lectura:** `GET /v1/players/{playerId}/reports` (cursor, más nuevos primero, filtro por ventana) y `GET /v1/player-reports/{id}`. `fileId` es `null` mientras no está listo y también una vez vencida o borrada su retención.

### El PDF

- **pdfkit**, en JavaScript puro, sin navegador ni binarios nativos: arma texto con cortes de línea y páginas, vectores e imágenes PNG/JPEG, y subconjuntos de fuentes.
  - A4, paleta clara de alto contraste para imprimir;
  - las rayas de la camiseta con los colores del club como sello arriba de cada página;
  - Barlow Condensed para títulos y cifras, Barlow para texto: OFL, de los paquetes de Fontsource, embebidas como subconjunto;
  - tablas con encabezado que se repite al cortar página y pie con club, jugador, ventana y "Página n de m";
  - metadatos de título, autor e idioma.
- **Tablas en lugar de gráficos:** se imprimen bien, se leen en voz alta y son la forma accesible de todo gráfico (CLAUDE.md). El estado va siempre en palabras.
- **Textos en `packages/i18n/src/messages/report.ts`** (`report.*`). Los nombres de métricas, deportes y ecuaciones pasan del catálogo de la web al común (`es-AR.ts`, mismas claves): ahora los muestran la web y el informe. Formatos es-AR con los formateadores del paquete.
- **El escudo** se incluye si es un PNG `ready`. pdfkit no lee WebP, y convertirlo pediría una dependencia nativa (sharp). Un escudo WebP o ilegible deja el informe sin escudo, no lo hace fallar.

## Alternativas descartadas

- **Generar en el request y devolver el PDF.** Latencia y CPU en la API, y el archivo igual tiene que quedar en el bucket para bajarlo desde la app y el link de la familia. Un error del proveedor tumba el pedido.
- **Calcular el contenido en el worker.** El worker tendría que repetir la puntuación de resultados, los grupos de comparación y las reglas contra restas del ADR 0060 sin el contexto de un usuario, o recibir `app.percentile_samples` sin las guardas que la protegen. Dos implementaciones de la misma regla de privacidad terminan divergiendo.
- **Renderizar HTML con un navegador headless (Puppeteer, Playwright).** Un Chromium en el worker de Railway, con memoria y arranque pesados, y una superficie de ataque grande para dibujar tablas.
- **`@react-pdf/renderer`.** Reusaría JSX, pero suma un reconciler y un motor de layout propio, y la web no comparte componentes con el PDF. pdfkit alcanza para tablas y texto.
- **Subir primero y registrar después.** Si la transacción falla después de subir, queda un objeto que ninguna fila registra y que la retención nunca borra.
- **Que la familia pida el informe.** El club decide cuándo hay datos para entregar (después de la ventana) y quién lo arma. El tutor y el jugador leen los que el staff pidió.
- **Percentiles en el informe.** El tutor no los ve en la matriz. Un percentil se lee siempre a hoy (ADR 0060) y en un documento guardado envejece.

## Consecuencias

- La web (ficha del jugador y área de familia) y la app suman "Pedir informe" para el staff y "Informes" para el jugador y la familia sobre estos endpoints, y bajan el PDF con la URL firmada de archivos.
- Un cambio del contenido que un renderer anterior no sepa leer sube `PLAYER_REPORT_FORMAT_VERSION`. El worker de la versión nueva tiene que seguir dibujando las anteriores mientras queden pedidos pendientes.
- Un informe vence con su archivo (365 días). La fila queda con su instantánea mientras exista el jugador, y se borra con él en la supresión.
- El informe de categoría (B-603) puede seguir el mismo camino: instantánea en la API con las reglas de agregados y render en el worker.
- Las fuentes cubren el alfabeto latino básico y Latin-1 (español). Un nombre con letras fuera de ese rango necesitaría sumar el subconjunto `latin-ext`.
