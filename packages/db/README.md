# @sport-performance/db

Esquema de PostgreSQL 16 en Drizzle ORM, migraciones SQL versionadas y el runner de migraciones (ADR 0004, 0006, 0007, 0010, 0015, 0017 y [0023](../../docs/adr/0023-convenciones-del-esquema-de-base.md)).

## Uso

```ts
import { createDatabase, createPool, runMigrations, schema } from '@sport-performance/db';

await runMigrations({ connectionString: process.env.MIGRATIONS_DATABASE_URL! });
const pool = createPool({ connectionString: process.env.DATABASE_URL!, applicationName: 'api' });
const db = createDatabase(pool);
const players = await db.select().from(schema.player);
```

- `@sport-performance/db/schema`: tablas, enums y helpers de columnas (`tenantColumns`, `tenantConstraints`, `tenantReference`).
- `@sport-performance/db/migrate`: solo el runner, sin el cliente.
- Tipos de fila: `Player` / `NewPlayer`, `TestResult` / `NewTestResult`… (`AuthUser` para la tabla `user` de Better Auth).

## Scripts

| Script | Qué hace |
|---|---|
| `pnpm --filter @sport-performance/db db:generate --name=<nombre>` | Genera la migración SQL a partir de los cambios del esquema. Se revisa y se commitea. |
| `pnpm --filter @sport-performance/db db:generate:custom --name=<nombre>` | Crea una migración vacía para SQL a mano (triggers, RLS, grants). |
| `pnpm --filter @sport-performance/db db:migrate` | Aplica las migraciones pendientes con `MIGRATIONS_DATABASE_URL` (o `DATABASE_URL` si la primera falta o está vacía). Requiere `pnpm build`. También está como bin `sport-performance-db-migrate`. |

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

## Fuera de este paquete por ahora

RLS, rol de la aplicación y funciones `app.*` (#33), esquema `medical` (#35), historial de cambios (#36), seeds (#37), columnas HLC y marcas de borrado para la sincronización (B-323), tablas `*_daily` del worker (B-326) y la tabla de importaciones de Catapult (B-601; `external_metric.import_id` ya existe).

## Tests

```sh
docker run -d --rm --name pg-dev -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @sport-performance/db test
```

Cada archivo de integración (`*.integration.test.ts`) crea su propia base temporal y la borra al terminar. Sin `DATABASE_URL` se saltean localmente; en CI (`CI` definido) fallan. Los tests cubren: migración desde cero, idempotencia y concurrencia del runner, convenciones por introspección (de las definiciones y de la base migrada), enums = dominio, índices de las claves compuestas, `CHECK`s, triggers (`updated_at`, `test_result_value` append-only, unidad = la de la métrica), sincronía esquema ↔ migraciones (`drizzle-kit generate` sin cambios) y compatibilidad con Better Auth (alta de usuario con su adaptador de Drizzle).
