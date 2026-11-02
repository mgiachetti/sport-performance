# @sport-performance/api

API HTTP: Fastify + `zod` con los contratos de `@sport-performance/contracts`, una transacción por request con `SET LOCAL app.club_id / app.user_id / app.role` para RLS. Decisiones en [ADR 0009](../../docs/adr/0009-api-fastify-zod.md), [0020](../../docs/adr/0020-convenciones-contratos-api.md), [0024](../../docs/adr/0024-estructura-de-la-api.md) y [0025](../../docs/adr/0026-roles-de-conexion-y-politicas-rls.md).

## Correr

```sh
docker run -d --rm --name pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sport_performance -p 5432:5432 postgres:16
pnpm --filter @sport-performance/api build   # compila también packages/db
# migraciones con el dueño y un login del rol de la aplicación (ver packages/db/README.md)
MIGRATIONS_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sport_performance pnpm --filter @sport-performance/db db:migrate
MIGRATIONS_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sport_performance \
  DB_LOGIN_ROLE=app DB_LOGIN_NAME=sp_api DB_LOGIN_PASSWORD=change-me-local-only \
  pnpm --filter @sport-performance/db db:provision-login
cp apps/api/.env.example apps/api/.env   # y ajustar
cd apps/api && node --env-file=.env --enable-source-maps --import ./dist/instrument.js ./dist/main.js
```

`pnpm --filter @sport-performance/api start` hace lo mismo con las variables del entorno (Railway). Los logs son JSON; para leerlos en local: `... | npx pino-pretty`.

Variables: [`.env.example`](.env.example). Se validan al arrancar; si falta o es inválida alguna, el proceso no arranca y el error nombra la variable (nunca su valor). Tampoco arranca si `DATABASE_URL` no es un login de `sport_performance_app` (superusuario, dueño de tablas, `BYPASSRLS`…; ADR 0025).

## Rutas

| Ruta | Qué hace |
|---|---|
| `GET /health/live` | El proceso responde. No toca la base. |
| `GET /health/ready` | No se está apagando y Postgres responde (`HEALTH_DB_TIMEOUT_MS`); si no, `503`. Es el healthcheck de Railway. |
| `GET /v1/health` | Contrato `getHealth`: mismo chequeo que readiness. |
| `GET /openapi.json` | OpenAPI 3.1 generado desde el catálogo de contratos. |

## Estructura

| Archivo | |
|---|---|
| `src/main.ts` | Proceso: config, logger, Sentry, pool, `listen`, señales. |
| `src/instrument.ts` | Se carga con `--import` antes que todo; inicia Sentry si hay `SENTRY_DSN`. |
| `src/app.ts` | `buildApp(options)`: la app sin efectos globales (los tests usan `inject`). |
| `src/config/env.ts` | Esquema `zod` del entorno. |
| `src/db/` | `Database` (`transaction`, `ping`, `close`) sobre el pool de `@sport-performance/db`, el contexto de tenant y el cliente Drizzle por transacción. |
| `src/auth/context.ts` | `request.auth` y el hook `Authenticate` (Better Auth lo implementa en #40). |
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
     handler: async ({ params }, { db, auth }) => {
       const theme = await findTheme(db, params.clubSlug);
       if (theme === undefined) throw new HttpError('not_found', 'Club not found');
       return theme; // se valida contra el esquema de respuesta antes de enviarse
     },
   });
   ```

- Toda consulta va por `db` / `tx` (o `app.db.transaction`). Nunca un `pg.Pool` aparte: sin el contexto, RLS no deja ver nada. Las políticas validan el rol contra la membresía (ADR 0025), así que un contexto equivocado tampoco ve nada.
- Los errores esperados se tiran como `HttpError(code, message)`; cualquier otro error es `500 internal_error`, se loguea y va a Sentry.
- Nada de datos personales en logs: ids sí; nombres, emails, métricas de jugadores o datos de salud no (ADR 0016).

## Tests

`pnpm --filter @sport-performance/api test`. Los tests `*.pg.test.ts` corren contra Postgres real con `DATABASE_URL` (en CI, el servicio `postgres:16`); sin esa variable se saltean en local y fallan en CI. `DATABASE_URL` es un superusuario: `src/db/rls.pg.test.ts` crea su base, corre las migraciones y se conecta con un login temporal de `sport_performance_app`.

```sh
docker run -d --rm --name pg-test -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=sport_performance_test -p 5433:5432 postgres:16
DATABASE_URL=postgres://postgres:postgres@localhost:5433/sport_performance_test pnpm --filter @sport-performance/api test
```
