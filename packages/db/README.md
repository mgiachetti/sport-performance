# @sport-performance/db

Esquema de PostgreSQL 16 en Drizzle ORM, migraciones SQL versionadas, el runner de migraciones, RLS y los roles de conexión (ADR 0004, 0006, 0007, 0010, 0015, 0017, [0023](../../docs/adr/0023-convenciones-del-esquema-de-base.md) y [0025](../../docs/adr/0025-roles-de-conexion-y-politicas-rls.md)).

## Uso

```ts
import { assertConnectionRole, createDatabase, createPool, runMigrations, schema } from '@sport-performance/db';

await runMigrations({ connectionString: process.env.MIGRATIONS_DATABASE_URL! }); // dueño
const pool = createPool({ connectionString: process.env.DATABASE_URL!, applicationName: 'api' });
await assertConnectionRole(pool, 'app'); // no arranca con el dueño ni con BYPASSRLS

// Toda consulta va en una transacción que primero fija el contexto (la API lo hace por request):
const client = await pool.connect();
await client.query('begin');
await client.query(
  "select set_config('app.club_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true)",
  [clubId, userId, 'coach'],
);
const players = await createDatabase(client).select().from(schema.player); // solo lo que RLS deja ver
await client.query('commit');
client.release();
```

- `@sport-performance/db/schema`: tablas, enums y helpers de columnas (`tenantColumns`, `tenantConstraints`, `tenantReference`).
- `@sport-performance/db/migrate`: solo el runner, sin el cliente.
- `@sport-performance/db/roles`: `DATABASE_ROLES`, `provisionLoginRole`, `assertConnectionRole`.
- Tipos de fila: `Player` / `NewPlayer`, `TestResult` / `NewTestResult`… (`AuthUser` para la tabla `user` de Better Auth).

## Scripts

| Script | Qué hace |
|---|---|
| `pnpm --filter @sport-performance/db db:generate --name=<nombre>` | Genera la migración SQL a partir de los cambios del esquema. Se revisa y se commitea. |
| `pnpm --filter @sport-performance/db db:generate:custom --name=<nombre>` | Crea una migración vacía para SQL a mano (triggers, RLS, grants). |
| `pnpm --filter @sport-performance/db db:migrate` | Aplica las migraciones pendientes con `MIGRATIONS_DATABASE_URL` (o `DATABASE_URL` si la primera falta o está vacía). Requiere `pnpm build`. También está como bin `sport-performance-db-migrate`. |
| `pnpm --filter @sport-performance/db db:provision-login` | Crea o actualiza un login (`DB_LOGIN_NAME`, `DB_LOGIN_PASSWORD`) como miembro de un rol de conexión (`DB_LOGIN_ROLE=app\|worker\|auth`), conectado como dueño. Idempotente; rota la contraseña. Bin `sport-performance-db-provision-login`. |

Nunca `drizzle-kit push` ni `drizzle-kit migrate` contra una base compartida. Una migración aplicada no se edita: el runner se niega a correr si un archivo aplicado cambió o si una migración pendiente es más vieja que la última aplicada (dos ramas que se mergearon fuera de orden). En ese caso se regenera la migración más nueva.

## Modelo

| Módulo | Tablas |
|---|---|
| `auth.ts` | `user`, `session`, `account`, `verification`: esquema core de Better Auth (ids `text` con UUID generado por la base), `is_superadmin` global. Sin `club_id`. |
| `tenant.ts` | `club` (raíz del tenant: zona horaria, marca, módulos) y las convenciones de toda tabla del club. |
| `organization.ts` | `membership` (usuario × club × rol), `season`, `category` (deporte + rama + franja de edad), `position` (por deporte), `staff_assignment` (categoría o deporte). |
| `players.ts` | `player` (sexo obligatorio, altura de los padres con origen), `player_category` (historia), `guardian`, `consent`, `player_stage` (historia y fijaciones). |
| `catalog.ts` | `metric_definition` (con `catapult_aliases`), `test_definition` (una fila por versión de protocolo) y `test_definition_metric`, `battery_config`, `reference_value`, `speed_zone_config`, `device`. |
| `testing.ts` | `test_window` (V1–V4), `test_session`, `test_result` (`done` / `not_done` con motivo, método, evaluador, dispositivo, condiciones), `test_result_value` (varias métricas e intentos, solo se agregan o se anulan), `anthro_measurement`. |
| `training.ts` | `training_session` (entrenamiento o partido), `drill`, `participation` (`srpe_au` generado), `wellness`, `external_metric`, `gym_program`, `gym_set`. |
| `alerts.ts` | `alert_rule` (la `AlertRule` del dominio como datos), `alert`. |

Convenciones (ADR 0023): `club_id NOT NULL` y auditoría (`created_at`, `updated_at` con trigger, `created_by`, `updated_by`, `client_uuid` único por club) en toda tabla del club; claves foráneas compuestas `(club_id, x_id)` para que nada apunte a otro club; enums creados desde las constantes de `@sport-performance/domain`; días del club como `date` (`LocalDate`) y vigencias `[valid_from, valid_to)`.

## RLS y roles de conexión (ADR 0025)

| Rol (`NOLOGIN`) | Quién | Qué ve |
|---|---|---|
| `sport_performance_app` | API | Lo que permite el contexto de la transacción (`app.club_id`, `app.user_id`, `app.role`). |
| `sport_performance_worker` | worker | Todo el club del job (`app.club_id`), nada sin él. |
| `sport_performance_auth` | Better Auth | Solo `user`, `session`, `account`, `verification`. |

- Cada login real es miembro de **un solo** rol y se crea con `db:provision-login`; la contraseña nunca va al repo. La API verifica su login al arrancar.
- `app.current_role()` solo devuelve el rol si hay una membresía activa que lo respalde (o `is_superadmin` para `superadmin`). Sin contexto, todo se deniega.
- Toda tabla con `club_id` tiene RLS forzada, una política `RESTRICTIVE` por club y políticas por rol, creadas con `app_admin.secure_club_table()`. Una tabla nueva la llama en su migración y suma una fila al fixture `src/testing/tenant-fixture.ts`; si no, los tests de RLS fallan.
- `DELETE` solo en `drill`; `test_result_value` es append-only también por grants.
- Las migraciones corren como superusuario o con `BYPASSRLS`.

Puesta en marcha local:

```sh
pnpm --filter @sport-performance/db build
MIGRATIONS_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sport_performance pnpm --filter @sport-performance/db db:migrate
MIGRATIONS_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sport_performance \
  DB_LOGIN_ROLE=app DB_LOGIN_NAME=sp_api DB_LOGIN_PASSWORD=<16+ caracteres> \
  pnpm --filter @sport-performance/db db:provision-login
# y en apps/api: DATABASE_URL=postgres://sp_api:<contraseña>@localhost:5432/sport_performance
```

## Fuera de este paquete por ahora

Esquema `medical` (#35), historial de cambios (#36), seeds (#37), columnas HLC y marcas de borrado para la sincronización (B-323), tablas `*_daily` del worker (B-326) y la tabla de importaciones de Catapult (B-601; `external_metric.import_id` ya existe).

## Tests

```sh
docker run -d --rm --name pg-dev -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @sport-performance/db test
```

Cada archivo de integración (`*.integration.test.ts`) crea su propia base temporal y la borra al terminar. Sin `DATABASE_URL` se saltean localmente; en CI (`CI` definido) fallan. Los tests cubren: migración desde cero, idempotencia y concurrencia del runner, convenciones por introspección (de las definiciones y de la base migrada), enums = dominio, índices de las claves compuestas, `CHECK`s, triggers (`updated_at`, `test_result_value` append-only, unidad = la de la métrica), RLS (catálogo: toda tabla forzada, roles sin privilegios, grants mínimos; aislamiento entre clubes por cada tabla con `club_id` enumerada desde la base; fail-closed; conexiones del pool; alcance por rol, `superadmin`, worker y Better Auth), sincronía esquema ↔ migraciones (`drizzle-kit generate` sin cambios) y compatibilidad con Better Auth (alta de usuario con su adaptador de Drizzle).
