# @sport-performance/api

API HTTP: Fastify + `zod` con los contratos de `@sport-performance/contracts`, una transacción por request con `SET LOCAL app.club_id / app.user_id / app.role` para RLS, y Better Auth para el ingreso con código por email. Decisiones en [ADR 0009](../../docs/adr/0009-api-fastify-zod.md), [0010](../../docs/adr/0010-auth-better-auth.md), [0020](../../docs/adr/0020-convenciones-contratos-api.md), [0024](../../docs/adr/0024-estructura-de-la-api.md), [0026](../../docs/adr/0026-roles-de-conexion-y-politicas-rls.md), [0028](../../docs/adr/0028-auth-membresias-e-invitaciones-en-la-api.md), [0031](../../docs/adr/0031-endurecimiento-de-la-api.md) y [0032](../../docs/adr/0032-convenciones-de-endpoints.md) (convenciones de endpoints). Revisión OWASP: [`docs/security/api.md`](../../docs/security/api.md).

## Correr

```sh
docker run -d --rm --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sport_performance -p 5432:5432 postgres:16
pnpm --filter @sport-performance/api build   # compila también packages/db
# migraciones con el dueño y un login por rol de conexión (ver packages/db/README.md)
MIGRATIONS_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sport_performance pnpm --filter @sport-performance/db db:migrate
MIGRATIONS_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sport_performance \
  DB_LOGIN_ROLE=app DB_LOGIN_NAME=sp_api DB_LOGIN_PASSWORD=change-me-local-only \
  pnpm --filter @sport-performance/db db:provision-login
MIGRATIONS_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sport_performance \
  DB_LOGIN_ROLE=auth DB_LOGIN_NAME=sp_auth DB_LOGIN_PASSWORD=change-me-local-only \
  pnpm --filter @sport-performance/db db:provision-login
cp apps/api/.env.example apps/api/.env   # y ajustar (AUTH_SECRET)
cd apps/api && node --env-file=.env --enable-source-maps --import ./dist/instrument.js ./dist/main.js
```

`pnpm --filter @sport-performance/api start` hace lo mismo con las variables del entorno (Railway). Los logs son JSON; para leerlos en local: `... | npx pino-pretty`.

Variables: [`.env.example`](.env.example). Se validan al arrancar; si falta o es inválida alguna, el proceso no arranca y el error nombra la variable (nunca su valor). Tampoco arranca si `DATABASE_URL` no es un login de `sport_performance_app` o `AUTH_DATABASE_URL` no es uno de `sport_performance_auth` (superusuario, dueño de tablas, `BYPASSRLS`, miembro de otro rol…; ADR 0026).

## Rutas

| Ruta | Qué hace |
|---|---|
| `GET /health/live` | El proceso responde. No toca la base. |
| `GET /health/ready` | No se está apagando y Postgres responde (`HEALTH_DB_TIMEOUT_MS`); si no, `503`. Es el healthcheck de Railway. |
| `GET /v1/health` | Contrato `getHealth`: mismo chequeo que readiness. |
| `GET /openapi.json` | OpenAPI 3.1 generado desde el catálogo de contratos. |
| `POST /v1/auth/email-otp` | Manda el código de ingreso (limitado por email e IP). |
| `POST /v1/auth/email-otp/verify` | Verifica el código y abre la sesión: cookie (web) o token bearer (mobile). |
| `POST /v1/auth/sign-out` | Revoca la sesión. |
| `GET /v1/me`, `GET /v1/me/memberships` | Usuario, superadmin, membresía activa y selector de club. |
| `POST /v1/invitations`, `GET /v1/invitations`, `DELETE /v1/invitations/{id}` | Invitaciones del club (solo `admin`). |
| `POST /v1/invitations/preview`, `POST /v1/invitations/accept` | Ver una invitación por su token (público) y aceptarla (con sesión del email invitado). |
| `GET /v1/clubs/{slug}/theme` | Tema del club (público, antes del login): nombre, sigla y colores con su tinte legible. |
| `GET /v1/clubs`, `POST /v1/clubs` | Registro de clubes (solo superadmin, con `X-Support-Reason`): lista y alta con la configuración por defecto. |
| `GET /v1/club`, `PATCH /v1/club` | Perfil y marca del club activo (lectura: todo miembro; edición: la administración, con `version`). |
| `GET /v1/club/branches`, `POST /v1/club/branches`, `POST …/{id}/archive`, `POST …/{id}/restore` | Deportes y ramas del club; habilitar una siembra sus posiciones, categorías y batería. |
| `GET /v1/categories`, `POST /v1/categories`, `GET`/`PATCH /v1/categories/{id}`, `POST …/{id}/archive`, `POST …/{id}/restore` | Categorías (el staff ve sus asignadas; la administración edita). |
| `GET`/`POST /v1/players`, `GET`/`PATCH /v1/players/{id}`, `POST …/{id}/archive` (baja), `POST …/{id}/restore`, `GET`/`POST …/{id}/categories`, `PATCH …/{id}/categories/{membershipId}`, `GET …/{id}/parent-heights`, `PUT …/{id}/parent-heights/{parent}` | Plantel (B-315, ADR 0035): ficha, posiciones, alta y baja, pases de categoría y altura de los padres con origen. |
| `GET /v1/positions` | Posiciones por deporte (todo miembro). |
| `GET /v1/training-sessions`, `POST /v1/training-sessions`, `GET`/`PATCH /v1/training-sessions/{id}`, `POST …/{id}/archive`, `POST …/{id}/restore` | Sesiones y partidos con sus bloques (el staff ve sus asignadas; el `coach` y la administración las manejan). |
| `POST /v1/training-sessions/{id}/drills`, `PATCH`/`DELETE /v1/drills/{id}` | Bloques con nivel de contacto. |
| `POST /v1/training-sessions/{id}/participations/batch`, `PATCH /v1/participations/{id}`, `GET /v1/participations` | Participación: carga masiva idempotente por fila, correcciones con `changeReason`, listas por alcance. |
| `POST /v1/training-sessions/{id}/rpe`, `GET /v1/me/training-sessions` | RPE del jugador dentro de su ventana y sus sesiones pendientes ([ADR 0037](../../docs/adr/0037-sesiones-participacion-y-rpe.md)). |
| `POST /v1/test-sessions/{id}/results` | Carga por lote de la cancha de un día de test, todo o nada (ADR 0039). El día se programa y se corre (estado, condiciones, evaluador) con los endpoints del calendario. |
| `GET`/`POST /v1/test-results`, `GET`/`PATCH /v1/test-results/{id}`, `POST …/{id}/entries`, `POST …/{id}/void` | Resultados con entradas crudas puntuadas por el dominio, reglas de etapa de la batería, `not_done` con motivo (`injured` se ve `unavailable` salvo para `medical`) y anulación con motivo. |
| `GET /v1/players/{id}/test-metrics/{metricCode}` | Serie de una métrica del jugador con el aviso de métodos, versiones o equipos distintos. |
| `GET`/`POST /v1/reference-values`, `GET`/`PATCH /v1/reference-values/{id}`, `POST …/{id}/archive`, `POST …/{id}/restore`, `POST /v1/reference-values/import` | Referencias de primera (el staff lee; `sc` y la administración cargan, corrigen e importan; ADR 0040). |
| `GET /v1/players/{playerId}/first-team-references` | La referencia de primera que aplica al jugador por métrica (el propio jugador, el staff asignado, la administración). |
| `GET`/`POST /v1/players/{id}/guardians`, `PATCH /v1/guardians/{id}`, `POST …/{id}/end` | Tutores de un jugador/a (la administración vincula; ven la administración, el jugador/a y sus tutores). |
| `GET /v1/me/children` | Los hijos/as del tutor (`parent`) en el club activo. |
| `POST /v1/players/{id}/invitations` | El tutor de un menor (o la administración) invita al jugador/a por email. |
| `POST`/`GET /v1/players/{id}/access-codes`, `DELETE …/{codeId}` | Código y link de un solo uso (15 min) para el dispositivo de un jugador/a sin email. |
| `POST /v1/auth/player-access` | Público: canjea el código o el link y abre la sesión mobile del jugador/a (ADR 0042). |
| `GET /v1/consent-documents`, `GET …/{id}`, `POST /v1/consent-documents` | Textos de consentimiento versionados del club (lectura: todo miembro; publicar: la administración). |
| `GET /v1/players/{id}/consents`, `GET …/consents/history`, `POST …/consents`, `POST …/consents/{type}/revoke` | Estado, historial, firma y revocación de los consentimientos de un jugador (firma y revoca el titular: tutor de un menor o jugador mayor). Sin consentimiento vigente, las rutas que guardan datos responden `403 consent_required` (`requireConsent`, ADR 0043). |
| `POST /v1/files`, `POST /v1/files/{id}/confirm`, `GET /v1/files`, `GET /v1/files/{id}`, `GET …/{id}/download`, `DELETE /v1/files/{id}` | Archivos ([ADR 0044](../../docs/adr/0044-archivos-urls-firmadas-y-retencion.md)): subida directa al bucket con `PUT` firmado y confirmación, bajada con URL firmada de minutos, permisos por tipo (video del CMJ con consentimiento de imagen) y borrado que completa el job de retención. Sin `STORAGE_*`, `503`. |
| `POST /v1/players/{id}/data-exports` | Derecho de acceso (Ley 25.326, art. 14): todos los datos del jugador/a en JSON para descargar (el jugador/a mayor, el tutor de un menor o la administración; salud solo para el titular con consentimiento, por las lecturas auditadas). Queda registrado como pedido `access`. |
| `POST /v1/players/{id}/erasure-requests`, `GET /v1/data-subject-requests`, `GET …/{id}`, `POST …/{id}/cancel`, `POST …/{id}/reject`, `POST …/{id}/execute` | Supresión (art. 16): pide el titular o la administración, con vencimiento a 5 días hábiles; la administración ejecuta (`app.erase_player`, borra todo lo que referencia al jugador/a, también su historial; pide una sesión de menos de 10 minutos; un reintento devuelve el pedido completado; `409` si una fila ajena apunta a sus datos) o rechaza con motivo ([ADR 0051](../../docs/adr/0051-derechos-del-titular.md)). |
| `POST /v1/me/account-deletion` | Borra la cuenta de la sesión (Apple 5.1.1(v)); la anonimiza si es evidencia legal (firmó consentimientos). Pide una sesión de menos de 10 minutos (`403 reauthentication_required`) y, con `requestErasure`, pide la supresión de los jugadores/as de los que es titular. |

## Sesión y club

- **Web:** `POST /v1/auth/email-otp/verify` con `transport: "cookie"` fija la cookie `HttpOnly` `sp.session_token` (`__Secure-sp.session_token` con `AUTH_BASE_URL` https). El cliente llama con `credentials: 'include'` desde un origen de `WEB_ORIGINS`.
- **Mobile:** `transport: "bearer"` devuelve `session.token`; va en `Authorization: Bearer <token>` y se guarda en el almacenamiento seguro.
- **Club:** el cliente manda `X-Membership-Id` con una membresía de `GET /v1/me/memberships` (si el usuario tiene una sola, no hace falta). Los endpoints `auth: 'club'` responden `403` sin una membresía activa elegida. Su club y su rol son el contexto de tenant.
- **Superadmin (ADR 0029, 0032):** para asistir a un club manda `X-Support-Club-Id: <clubId>` y `X-Support-Reason: <motivo>` (UTF-8 con `encodeURIComponent`, 1 a 500 caracteres) en cada request; en el registro de clubes, solo el motivo. Cada transacción registra el acceso con `app.begin_support_access`; sin motivo, `403`.
- **En local sin `RESEND_API_KEY`** los emails no se mandan: el código y los links aparecen en el log (`email not sent`).
- **Deploy (Railway):** en producción la API no arranca sin `AUTH_SECRET`, `AUTH_BASE_URL`, `WEB_APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `AUTH_DATABASE_URL` y `TRUST_PROXY_HOPS` (Railway: 1; `0` se rechaza: la IP sería la del proxy y los límites por IP del ingreso serían globales); cargarlas en el servicio antes de deployar. `WEB_ORIGINS` viene vacío: sin él no se registra CORS y la web no puede llamar a la API con su cookie, así que hay que cargarlo cuando se deploye la web.

## Seguridad (ADR 0031)

- **Límites generales** en todo request, por IP y por usuario, por clase de ruta (`public`, `auth`, `read`, `write`, `upload`, `exempt`); `429 rate_limited` con `Retry-After`. La clase sale del contrato (nivel de auth y método) y se puede fijar con `rateLimit` en `registerEndpoint`. Usan la tabla `auth_rate_limit` (claves HMAC) y fallan abiertos si la base no responde en `RATE_LIMIT_TIMEOUT_MS`. Valores en `src/security/rate-limit.ts` y en [`docs/security/api.md`](../../docs/security/api.md).
- **Headers** en toda respuesta: CSP `default-src 'none'`, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, COOP/CORP, `Cache-Control: no-store` (una ruta cacheable pone el suyo) y HSTS en producción. Nunca `Server` ni `X-Powered-By`.
- **Tamaños:** `BODY_LIMIT_BYTES` (1 MiB) y 16 KiB para los endpoints públicos que cambian estado (`bodyLimitBytes` en `registerEndpoint` para otro valor); `413 payload_too_large`. Los archivos nunca pasan por la API (URLs firmadas, #56).
- **Timeouts:** `HTTP_REQUEST_TIMEOUT_MS`, `HTTP_HEADERS_TIMEOUT_MS`, `HTTP_KEEP_ALIVE_TIMEOUT_MS`, `HTTP_CONNECTION_TIMEOUT_MS`, `HTTP_MAX_CONNECTIONS`, `HTTP_MAX_HEADER_SIZE_BYTES`.
- **Secretos en producción:** `AUTH_SECRET` de 32+ caracteres, 128+ bits estimados y sin pinta de ejemplo (`openssl rand -base64 48`); logins de base con contraseña de 16+ caracteres y distintos entre sí. Si no, la API no arranca y el error nombra la variable, nunca el valor.

## Estructura

| Archivo | |
|---|---|
| `src/main.ts` | Proceso: config, logger, Sentry, pool, `listen`, señales. |
| `src/instrument.ts` | Se carga con `--import` antes que todo; inicia Sentry si hay `SENTRY_DSN`. |
| `src/app.ts` | `buildApp(options)`: la app sin efectos globales (los tests usan `inject`). |
| `src/config/env.ts` | Esquema `zod` del entorno. |
| `src/db/` | `Database` (`transaction`, `ping`, `close`) sobre el pool de `@sport-performance/db`, el contexto de tenant y el cliente Drizzle por transacción. |
| `src/auth/context.ts` | `request.auth` (usuario, superadmin, sesión, membresía elegida) y el tipo `Authenticate`. |
| `src/auth/` | Better Auth (`better-auth.ts`), el hook de sesión y selector de club (`authenticate.ts`), membresías e invitaciones fuera del contexto de un club (`identity.ts`), límites de intentos en Postgres (`rate-limit.ts`), guard de origen (`origin-guard.ts`) y el módulo que los junta (`module.ts`). |
| `src/email/` | `EmailTransport` (Resend, memoria, log), plantillas React Email y `Mailer`. |
| `src/invitations/` | Tokens, links (deep link y universal link) y estado de las invitaciones. |
| `src/guardians/` | Códigos de ingreso de los jugadores/as sin email: generación, normalización, HMAC, links y estado (ADR 0042). |
| `src/http/endpoint.ts` | `registerEndpoint`: ruta del catálogo con validación de entrada y salida, y la transacción del request (contexto, request id, motivo de corrección, soporte del superadmin). |
| `src/http/permissions.ts` | El sujeto de la matriz de permisos por request y `authorize` / `listScope` (ADR 0025, 0032). |
| `src/http/pagination.ts` | `keysetPage`: paginación por cursor con orden permitido y filtros atados al cursor. |
| `src/http/writes.ts` | `insertIdempotent` (`clientUuid`), `rowVersion` / `updateAtVersion` (`409`) y el filtro de archivados. |
| `src/http/errors.ts` | `HttpError` y el manejo de errores con el sobre del contrato (permisos, unicidad, motivo de corrección, políticas de la base). |
| `src/observability/` | pino, id de request, Sentry y su scrubbing. |
| `src/security/` | Límites generales por clase de ruta (`rate-limit.ts`), headers de seguridad (`headers.ts`) y chequeos de secretos de producción (`secrets.ts`). |
| `src/routes/` | Rutas servidas; lista de endpoints del contrato todavía pendientes. |

## Agregar un endpoint

1. Declararlo en `packages/contracts` (ver su README) y sumarlo a `apiEndpoints`.
2. Registrarlo en `src/routes/` y sumarlo a `IMPLEMENTED_ENDPOINTS` (si queda para otro issue, a `PENDING_ENDPOINTS`; si no está en ninguna de las dos, no compila):

   ```ts
   registerEndpoint(app, updateCategory, {
     transaction: true, // el handler recibe `tx`, `db` (Drizzle) y `permissions` con el contexto fijado
     // con `auth: 'club'` en el contrato, `auth.membership` no es null en los tipos
     handler: async ({ params, body }, { db, permissions, auth }) => {
       const row = await readCategory(db, auth.membership.clubId, params.categoryId); // 404
       await permissions.authorize('category', 'manage', { category: { id: row.id, sport: row.sport } }); // 403
       return toDto(
         await updateAtVersion({ resource: 'Category', update, exists }), // 404 / 409 con `version`
       ); // se valida contra el esquema de respuesta y se envía después del commit
     },
   });
   ```

   Las convenciones completas (autorización, listas por cursor, altas idempotentes, `version`, archivar, motivo de corrección, soporte del superadmin) están en el [ADR 0032](../../docs/adr/0032-convenciones-de-endpoints.md); `src/routes/categories.ts` es el ejemplo de referencia.

- Toda consulta va por `db` / `tx` (o `app.db.transaction`). Nunca un `pg.Pool` aparte: sin el contexto, RLS no deja ver nada. Las políticas validan el rol contra la membresía (ADR 0026), así que un contexto equivocado tampoco ve nada.
- Los errores esperados se tiran como `HttpError(code, message)`; `PermissionDeniedError` es `403`, una clave única repetida `409`, una corrección sin motivo `400` en `body.changeReason`; cualquier otro error es `500 internal_error`, se loguea y va a Sentry.
- Nunca `db.transaction()` para abrir otra transacción: en el cliente del request es un savepoint, y un `pg.Pool` aparte no tendría el contexto.
- Nada de datos personales en logs: ids sí; nombres, emails, métricas de jugadores o datos de salud no (ADR 0016).

## Tests

`pnpm --filter @sport-performance/api test`. Los tests `*.pg.test.ts` corren contra Postgres real con `DATABASE_URL` (en CI, el servicio `postgres:16`); sin esa variable se saltean en local y fallan en CI. `DATABASE_URL` es un superusuario: cada archivo crea su base, corre las migraciones con él (que también arma los datos de cada test) y la API se conecta con logins temporales de `sport_performance_app` y `sport_performance_auth`, como en producción. Los de auth usan el transporte de email en memoria. El test de una importación de 1000 filas (`test-imports.pg.test.ts`) tiene un presupuesto de 45 s por pedido; `TEST_IMPORT_BUDGET_MS` lo cambia (ms) en un runner muy cargado o para ajustarlo.

```sh
docker run -d --rm --name pg-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sport_performance_test -p 5433:5432 postgres:16
DATABASE_URL=postgres://postgres:postgres@localhost:5433/sport_performance_test pnpm --filter @sport-performance/api test
```
