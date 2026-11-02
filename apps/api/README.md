# @sport-performance/api

API HTTP: Fastify + `zod` con los contratos de `@sport-performance/contracts`, una transacción por request con `SET LOCAL app.club_id / app.user_id / app.role` para RLS, y Better Auth para el ingreso con código por email. Decisiones en [ADR 0009](../../docs/adr/0009-api-fastify-zod.md), [0010](../../docs/adr/0010-auth-better-auth.md), [0020](../../docs/adr/0020-convenciones-contratos-api.md), [0024](../../docs/adr/0024-estructura-de-la-api.md), [0026](../../docs/adr/0026-roles-de-conexion-y-politicas-rls.md) y [0028](../../docs/adr/0028-auth-membresias-e-invitaciones-en-la-api.md).

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

## Sesión y club

- **Web:** `POST /v1/auth/email-otp/verify` con `transport: "cookie"` fija la cookie `HttpOnly` `sp.session_token` (`__Secure-sp.session_token` con `AUTH_BASE_URL` https). El cliente llama con `credentials: 'include'` desde un origen de `WEB_ORIGINS`.
- **Mobile:** `transport: "bearer"` devuelve `session.token`; va en `Authorization: Bearer <token>` y se guarda en el almacenamiento seguro.
- **Club:** el cliente manda `X-Membership-Id` con una membresía de `GET /v1/me/memberships` (si el usuario tiene una sola, no hace falta). Los endpoints `auth: 'club'` responden `403` sin una membresía activa elegida. Su club y su rol son el contexto de tenant.
- **En local sin `RESEND_API_KEY`** los emails no se mandan: el código y los links aparecen en el log (`email not sent`).
- **Deploy (Railway):** en producción la API no arranca sin `AUTH_SECRET`, `AUTH_BASE_URL`, `WEB_APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `AUTH_DATABASE_URL` y `TRUST_PROXY_HOPS` (Railway: 1; `0` se rechaza: la IP sería la del proxy y los límites por IP del ingreso serían globales); cargarlas en el servicio antes de deployar. `WEB_ORIGINS` viene vacío: sin él no se registra CORS y la web no puede llamar a la API con su cookie, así que hay que cargarlo cuando se deploye la web.

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
| `src/http/endpoint.ts` | `registerEndpoint`: ruta del catálogo con validación de entrada y salida. |
| `src/http/errors.ts` | `HttpError` y el manejo de errores con el sobre del contrato. |
| `src/observability/` | pino, id de request, Sentry y su scrubbing. |
| `src/routes/` | Rutas servidas; lista de endpoints del contrato todavía pendientes. |

## Agregar un endpoint

1. Declararlo en `packages/contracts` (ver su README) y sumarlo a `apiEndpoints`.
2. Registrarlo en `src/routes/` y sumarlo a `IMPLEMENTED_ENDPOINTS` (si queda para otro issue, a `PENDING_ENDPOINTS`; si no está en ninguna de las dos, no compila):

   ```ts
   registerEndpoint(app, getClubTheme, {
     transaction: true, // el handler recibe `tx` y `db` (Drizzle) con el contexto de tenant fijado
     // con `auth: 'club'` en el contrato, `auth.membership` no es null en los tipos
     handler: async ({ params }, { db, auth }) => {
       const theme = await findTheme(db, params.clubSlug);
       if (theme === undefined) throw new HttpError('not_found', 'Club not found');
       return theme; // se valida contra el esquema de respuesta antes de enviarse
     },
   });
   ```

- Toda consulta va por `db` / `tx` (o `app.db.transaction`). Nunca un `pg.Pool` aparte: sin el contexto, RLS no deja ver nada. Las políticas validan el rol contra la membresía (ADR 0026), así que un contexto equivocado tampoco ve nada.
- Los errores esperados se tiran como `HttpError(code, message)`; cualquier otro error es `500 internal_error`, se loguea y va a Sentry.
- Nada de datos personales en logs: ids sí; nombres, emails, métricas de jugadores o datos de salud no (ADR 0016).

## Tests

`pnpm --filter @sport-performance/api test`. Los tests `*.pg.test.ts` corren contra Postgres real con `DATABASE_URL` (en CI, el servicio `postgres:16`); sin esa variable se saltean en local y fallan en CI. `DATABASE_URL` es un superusuario: cada archivo crea su base, corre las migraciones con él (que también arma los datos de cada test) y la API se conecta con logins temporales de `sport_performance_app` y `sport_performance_auth`, como en producción. Los de auth usan el transporte de email en memoria.

```sh
docker run -d --rm --name pg-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sport_performance_test -p 5433:5432 postgres:16
DATABASE_URL=postgres://postgres:postgres@localhost:5433/sport_performance_test pnpm --filter @sport-performance/api test
```
