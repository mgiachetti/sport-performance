# 0023. Estructura de la API: transacción con contexto de tenant, errores, probes y apagado

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #39 (B-308)

## Contexto

ADR 0006 fija que cada request corre en una transacción con `SET LOCAL app.club_id / app.user_id / app.role`, ADR 0009 que la API es Fastify + `zod` con los contratos de `packages/contracts`, ADR 0016 que hay Sentry y pino sin datos personales y ADR 0020 el sobre de error y el catálogo de endpoints. Faltaba decidir cómo se arma eso en `apps/api`: cómo se abre la transacción, qué interfaz de base ve la API mientras `packages/db` (#32) se construye en paralelo, dónde se enchufa la autenticación (#40), qué healthchecks hay, cómo se propaga el id de request y cómo se apaga el proceso en Railway (ADR 0003).

## Decisión

- **Interfaz de base chica** (`Database`): `transaction(context, work)`, `ping(timeoutMs)` y `close()`, implementada sobre un `pg.Pool` de node-postgres. `work` recibe el `PoolClient` de la transacción, así el cliente Drizzle de `packages/db` lo envuelve (`drizzle(client)`) sin cambiar la API. No hay otra forma de consultar la base desde la API.
- **La transacción fija el contexto antes de cualquier consulta:** `begin`, una sola sentencia `select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true)` (es `SET LOCAL`, con parámetros: nada interpolado), el trabajo y `commit`. Los tres valores se escriben siempre, con `''` cuando no hay valor, así un `set_config` de sesión hecho por error en esa conexión queda pisado dentro de cada transacción. Las funciones `app.current_*()` de `packages/db` tienen que leer `''` como `NULL` (`nullif(current_setting('app.club_id', true), '')`): Postgres también devuelve `''` para un setting propio cuando termina la transacción que lo fijó. El contexto se valida (UUID en minúsculas, rol conocido de `ROLES` de `packages/domain`, club y rol juntos) antes de pedir una conexión.
- **Errores de la transacción:** si `work` falla se hace `rollback`; si el rollback falla, la conexión se descarta del pool en vez de devolverla. Un `commit` que Postgres responde como `ROLLBACK` (porque `work` se tragó un error de SQL) se reporta como `TransactionAbortedError`, nunca como éxito. Una conexión que se cae mientras está en uso no tira el proceso.
- **Transacción por endpoint, no por hook:** cada ruta del catálogo declara `transaction: true | false`. Con `true`, el handler y la verificación de la respuesta contra el contrato corren dentro de la misma transacción (una respuesta fuera de contrato hace rollback). Con un hook `onRequest`/`onResponse` la transacción quedaría abierta en rutas que no la usan y no habría un punto claro donde hacer rollback.
- **Contexto del request:** `request.auth: AuthContext | null` (`userId` y `membership { clubId, role }` o `null`) lo resuelve en `onRequest` una función `Authenticate` inyectable. Hoy es siempre anónimo; Better Auth (#40) la reemplaza. Los endpoints `session` responden `unauthenticated` sin usuario y sus handlers reciben `auth` no nulo en los tipos.
- **Rutas desde el catálogo:** `registerEndpoint` valida params, query y body con los esquemas del contrato (todos los problemas juntos en `details`, con `["params" | "query" | "body", ...]`) y la respuesta con el esquema de salida. Cada endpoint de `apiEndpoints` está servido o listado como pendiente con su issue; si no, no compila.
- **Errores:** todo status no 2xx usa el sobre de ADR 0020, incluidos 404 de ruta y los errores de Fastify (JSON inválido, content-type no soportado, body demasiado grande → `bad_request`). Los 5xx responden un mensaje genérico, se loguean con `error` y se reportan a Sentry con ids (request, usuario, club, ruta); los 4xx no se reportan y se loguean sin mensaje.
- **Id de request:** se reusa el `x-request-id` entrante si tiene de 8 a 128 caracteres `[A-Za-z0-9._:-]` (web, worker o proxy pueden correlacionar); si no, UUID nuevo. Va en cada línea de log (`requestId`), en el header de respuesta y en el sobre de error.
- **Logs:** pino en JSON con `service`, `version` y `env`. Del request se loguea método, path sin query y patrón de ruta; nada de IP, headers ni bodies. Redacción de `authorization`, `cookie`, `set-cookie` y del `detail` de los errores de Postgres (trae valores de filas) como segunda defensa.
- **Sentry opcional:** sin `SENTRY_DSN` no se inicializa. Con DSN se carga antes que el resto (`node --import ./dist/instrument.js`) para instrumentar http, Fastify y pg, con `dataCollection` en mínimo (sin headers, cookies, bodies, query, datos de consultas ni variables locales) y un `beforeSend` que deja solo método, path e id de usuario.
- **Probes fuera del contrato:** `GET /health/live` (el proceso responde; no toca la base, para que una caída de Postgres no reinicie contenedores) y `GET /health/ready` (no se está apagando y la base responde un ping con timeout; si no, `503 service_unavailable`). `GET /v1/health` (contrato `getHealth`) hace el mismo chequeo que readiness. El OpenAPI se sirve en `GET /openapi.json`, generado al arrancar desde el mismo catálogo.
- **Configuración:** variables de entorno validadas con `zod` al arrancar; si una falla, el proceso no arranca y el error nombra la variable sin mostrar el valor. Todas están en `apps/api/.env.example`.
- **Apagado:** con `SIGTERM`/`SIGINT` la API deja de estar ready, responde `503` con `Connection: close` a requests nuevos, cierra cada conexión keep-alive al terminar su request en curso, cierra el servidor, después el pool y por último hace flush de Sentry. Si tarda más de `SHUTDOWN_TIMEOUT_MS` sale con código 1. `uncaughtException` y `unhandledRejection` se loguean, se reportan y apagan el proceso con código 1.

## Alternativas descartadas

- **Esperar a `packages/db` para la transacción.** Bloquea la API y deja el punto más sensible del aislamiento (ADR 0006) para el final; la interfaz chica permite probarlo ya contra Postgres real.
- **`SET LOCAL app.club_id = '...'` armado como texto.** `SET` no acepta parámetros: habría que interpolar. `set_config(..., true)` es equivalente y va parametrizado.
- **`fastify-type-provider-zod` para validar.** Valida con los esquemas pero arma sus propios errores y su JSON Schema; el catálogo y el OpenAPI ya salen de `packages/contracts` (ADR 0020).
- **`DISCARD ALL` o `RESET ALL` al devolver cada conexión.** Una ida y vuelta más por request; escribir siempre los tres settings dentro de la transacción ya cubre el caso.

## Consecuencias

- `packages/db` (#32) aporta el cliente Drizzle sobre el `TransactionClient` y las funciones `app.current_*()`, que leen `''` como `NULL`. Los tests de RLS de cada tabla usan la misma transacción.
- Better Auth (#40) solo implementa `Authenticate` y monta sus rutas; el resto de la API no cambia.
- Agregar un endpoint es declararlo en el contrato y registrarlo con `registerEndpoint`; olvidarse no compila.
- El worker (ADR 0011) puede reusar el mismo helper por job, con el club del job.
