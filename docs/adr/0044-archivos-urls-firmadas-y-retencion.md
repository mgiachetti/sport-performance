# 0044. Archivos: bucket S3 con URLs firmadas, tabla `file`, permisos por tipo y retención

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #56 (B-325)

## Contexto

La app tiene que guardar archivos: videos del CMJ (B-604, imágenes de menores), el escudo de cada club (white-label, ADR 0014), informes PDF por jugador (B-602) y planillas a importar (padrón B-330, Catapult B-601). ADR 0003 eligió buckets S3-compatibles de Railway usados por la API S3 genérica, y ADR 0005 que la ruta del objeto incluya el club. ADR 0031 dejó una clase de límites `upload` para los endpoints que entregan URLs de subida y fijó que los archivos nunca pasan por la API (cuerpo JSON de 1 MiB). ADR 0032 dejó `club.logo_file_id` sin clave foránea y `logoUrl` del tema en `null` hasta tener archivos. Faltaba decidir cómo se sube y se baja, qué se guarda de cada archivo, quién lo ve, cuánto se guarda y quién lo borra.

## Decisión

### Bucket y URLs firmadas

- **Paquete `@sport-performance/storage`** con el cliente S3 (AWS SDK v3, cualquier proveedor S3-compatible: Railway, R2, S3, MinIO) detrás de una interfaz chica (`ObjectStorage`: firmar subida, firmar bajada, `stat`, `remove`) y el job de retención. Lo usan la API y el worker; ninguno nombra un proveedor.
- **Configuración solo por entorno**, validada con zod: `STORAGE_ENDPOINT`, `STORAGE_REGION` (`auto` por defecto), `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_FORCE_PATH_STYLE`. Todas o ninguna; en producción todas, `https` y un secreto que no sea de ejemplo. Sin bucket (desarrollo) los endpoints de archivos responden `503` y el tema no tiene escudo. En Railway se referencian las variables del bucket (`${{Bucket.ENDPOINT}}`…).
- **Subida directa al bucket con un `PUT` firmado** que cubre `Content-Type`, `Content-Length` y `x-amz-checksum-sha256`: el bucket rechaza otro tipo, otro tamaño u otro contenido, así el cliente no puede subir otra cosa que lo declarado. Los checksums "flexibles" del SDK se apagan (`WHEN_REQUIRED`): firmarían un CRC que un navegador no puede reproducir. La URL vive 15 minutos (`FILE_UPLOAD_URL_TTL_S`).
- **Confirmación**: `POST /v1/files/{id}/confirm` hace `HEAD` del objeto (con `ChecksumMode: ENABLED`) y compara tamaño, tipo y SHA-256; si no coincide, o el proveedor no devuelve el tipo o el checksum, lo borra y responde `409` (falla cerrado y queda en el log). Solo un archivo confirmado (`ready`) se puede bajar o usar.
- **Bajada con un `GET` firmado de vida corta** (5 minutos, `FILE_DOWNLOAD_URL_TTL_S`), con `Content-Type`, `Content-Disposition` (`inline` para videos y escudos, `attachment` con el nombre original en UTF-8 para PDF y planillas) y `Cache-Control: private` fijados por el servidor en la firma. La URL se pide cada vez (`GET /v1/files/{id}/download`, con permisos); no se guarda.
- **Clave del objeto `clubs/<club>/<tipo>/<id>`** (`fileObjectKey` del dominio): el club al frente (ADR 0005), derivada de la fila, no guardada.

### Tabla `file`

- Tabla del club (ADR 0023) con `kind` (`club_logo`, `cmj_video`, `pdf_report`, `data_import`), `status` (`pending` → `ready` → `deleted`), jugador y categoría opcionales con claves compuestas, `content_type`, `size_bytes`, `checksum_sha256`, nombre original saneado, `uploaded_at`, `expires_at`, `deleted_at` y `purged_at`. El dueño es `created_by`. `CHECK`s de forma (lo que lleva cada tipo sale de la política del dominio) y de ciclo de vida.
- **La política de cada tipo es dato del dominio** (`FILE_KIND_POLICIES`): tipos MIME, tamaño máximo, qué lleva (club, jugador o categoría opcional), retención, disposición y si la sube una persona. El contrato la convierte en una unión discriminada por `kind`, así los límites quedan en el OpenAPI.
- **RLS** con `secure_club_table`: un archivo de un jugador con el alcance por jugador, una importación solo el staff, el escudo todo miembro; escriben `sc`, `admin` y `superadmin` (el worker, los informes); sin `DELETE`.
- **`club.logo_file_id` → `file (club_id, id)`** como clave compuesta `(id, logo_file_id)`: un club solo apunta a un archivo propio. Está en la migración y no en el esquema de Drizzle (declararla ahí haría que `club` y `file` se importen mutuamente). La API además exige que sea un `club_logo` `ready`, y fijar el escudo y borrar el archivo toman el mismo `FOR UPDATE` sobre la fila: nunca quedan los dos (el club apuntando a un archivo borrado). El tema público solo firma el escudo mientras su archivo está `ready`.

### Permisos por tipo

Cada handler autoriza con la matriz (ADR 0025, ADR 0032) usando el recurso que ya protege cada tipo, sin sumar recursos a la matriz:

| Tipo | Subir | Ver y bajar | Borrar |
|---|---|---|---|
| `club_logo` | `club.update` | `club.read` | `club.update` |
| `cmj_video` | `media.upload` | `media.read` | `media.delete` |
| `pdf_report` | (el worker) | `player_summary.read` | `player_profile.archive` |
| `data_import` | `data_import.run` | `data_import.run` | `data_import.run` |

`media` exige consentimiento de **imagen** vigente del jugador para subir y para mostrar: un video subido con consentimiento deja de verse si se revoca. El tutor nunca ve videos. Los escudos pendientes o borrados los ve solo quien puede borrarlos (`club.update`); al resto de los miembros se les listan solo los `ready`. En las listas, las filas que dependen de un consentimiento o de una tutela confirmada se filtran una por una: una página puede traer menos de `limit` (el cursor igual avanza).

### Retención y borrado

- `expires_at` es la única regla: un archivo con `expires_at` vencido (más el margen de reloj, abajo) y sin `purged_at` se borra. Pendiente: 24 horas para confirmar. Confirmado: según su tipo (video del CMJ 180 días, informe 365, planilla 90). Escudo: no vence mientras es el del club; sin usar o reemplazado, vence a los 30 días (el tema cacheado sigue funcionando un rato).
- **Borrar a pedido** (`DELETE /v1/files/{id}`) no borra la fila: la marca `deleted` y deja de poder bajarse en el acto. El escudo en uso no se borra (`409`).
- **Ninguna URL de subida sobrevive al borrado del objeto.** Una URL de subida ya entregada sigue valiendo aunque el archivo se borre: si el job borrara el objeto antes, un `PUT` tardío dejaría en el bucket un objeto que ninguna fila registra (un video de un menor que nunca se borra). Por eso un archivo borrado a pedido vence recién cuando murió toda URL que pudo entregar (`deletedFileExpiresAt`): pendiente, al cerrar su ventana o a `ahora + FILE_UPLOAD_URL_MAX_TTL_S` (una hora, el máximo de `FILE_UPLOAD_URL_TTL_S`, sea cual fuere la configuración al firmar), lo que llegue antes; confirmado, a `uploaded_at` + ese máximo. El job además espera `SIGNED_URL_CLOCK_SKEW_S` (5 minutos) pasado `expires_at`, porque el bucket valida la firma con su propio reloj.
- **El job de retención** (`purgeExpiredFiles`) corre por club con el contexto del worker (ADR 0011): borra el objeto primero y marca la fila después (`deleted`, `purged_at`), con `FOR UPDATE SKIP LOCKED` (dos corridas a la vez se reparten el trabajo), de a 100 archivos y con un presupuesto de 20 s por corrida para que la transacción y sus candados sean cortos (lo que queda sigue vencido para la próxima); reintentarlo es seguro porque borrar un objeto que no existe no falla. Nunca toca el escudo en uso; `PATCH /v1/club` bloquea la fila del escudo nuevo (`FOR UPDATE`) hasta apuntarlo, así el job no lo purga en el medio.
- **El escudo es PNG o WebP**, nunca SVG (puede llevar scripts y se sirve `inline`). La URL firmada del tema fija el `Content-Type` registrado, no el del objeto.
- **Reenviar un alta con el mismo `clientUuid` y otro archivo** (tipo, jugador, categoría, tipo MIME, tamaño, SHA-256 o nombre distintos) es `409`, igual que el mismo `clientUuid` de otro usuario: un reenvío es el mismo pedido (ADR 0032). Reenviar el alta de un archivo borrado devuelve la fila sin URL de subida (`upload: null`), y `DELETE` de un archivo ya borrado o purgado no lo modifica.
- **Tema público**: `logoUrl` es una URL firmada del escudo que vive una hora (`FILE_LOGO_URL_TTL_S`), más que el cache del tema (5 minutos). El contrato acepta `http` solo contra `localhost` (MinIO en desarrollo y tests).

## Alternativas descartadas

- **Subir a través de la API (multipart).** Videos de cientos de MiB ocupando conexiones y memoria de la API, y un cuerpo enorme expuesto a lentitud y abuso (ADR 0031).
- **POST firmado (policy de formulario) en vez de `PUT`.** Permite rangos de tamaño, pero no fija el SHA-256 del contenido, que es lo que garantiza que se sube lo declarado.
- **URL pública del escudo o bucket público.** El bucket guarda imágenes de menores; un bucket con objetos públicos es un error de configuración a un paso. El escudo sale con firma como todo lo demás.
- **Un endpoint que redirige (`302`) al escudo.** URL estable y cacheable, pero los contratos no modelan redirecciones y el cliente tipado no las expone; el tema ya se cachea poco.
- **Borrar la fila del archivo.** Se pierde el registro de qué había, de quién y cuándo se borró; la fila queda como lápida y lo pesado (el objeto) es lo que se va.
- **Un recurso `file` nuevo en la matriz.** Duplicaría reglas que ya existen (`media` con su consentimiento de imagen, `data_import`, `club`) y podrían divergir.

## Consecuencias

- El worker (#57) programa `purgeExpiredFiles` una vez por club y por día, con su login de `sport_performance_worker`.
- Los resultados del CMJ (#52), las importaciones (B-330, B-601) y los informes (B-602, B-603) apuntan a `file` por clave compuesta; los informes los escribe el worker con `ObjectStorage` y una fila `pdf_report`.
- Revocar el consentimiento de imagen ya oculta los videos; borrarlos antes de su vencimiento queda para el flujo de consentimientos (B-312) o el worker.
- CI corre MinIO (fork comunitario `pgsty/minio`, la imagen oficial dejó de publicarse) con `STORAGE_TEST_URL`; sin esa variable los tests contra el bucket se saltean localmente y fallan en CI.
- Los archivos se sirven siempre desde el origen del bucket, nunca desde el de la web o la API, y nunca como SVG: ningún contenido subido corre scripts con las cookies de la app.
- Un archivo borrado a pedido queda en el bucket hasta una hora y cinco minutos (aunque ya no se puede bajar): es el precio de que un `PUT` tardío no deje objetos sin registrar.
- Cambiar la retención de un tipo es cambiar el dominio (y vale para lo que se confirme desde entonces); una retención por club se agrega como configuración del club cuando haga falta.
