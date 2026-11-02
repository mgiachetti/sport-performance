# @sport-performance/db

Esquema de PostgreSQL 16 en Drizzle ORM, migraciones SQL versionadas, el runner de migraciones, RLS y los roles de conexión, y los seeds (ADR 0004, 0006, 0007, 0010, 0015, 0017, [0023](../../docs/adr/0023-convenciones-del-esquema-de-base.md), [0026](../../docs/adr/0026-roles-de-conexion-y-politicas-rls.md), [0027](../../docs/adr/0027-seeds-y-bootstrap-de-club.md) y [0030](../../docs/adr/0030-historial-de-cambios.md)).

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
- `@sport-performance/db/seeds`: `bootstrapClub`, `seedTenant` / `ORC_TENANT`, `loadKhamisRocheTable` y los datos de cada seed (ver [Seeds](#seeds)).
- Tipos de fila: `Player` / `NewPlayer`, `TestResult` / `NewTestResult`… (`AuthUser` para la tabla `user` de Better Auth).

## Scripts

| Script | Qué hace |
|---|---|
| `pnpm --filter @sport-performance/db db:generate --name=<nombre>` | Genera la migración SQL a partir de los cambios del esquema. Se revisa y se commitea. |
| `pnpm --filter @sport-performance/db db:generate:custom --name=<nombre>` | Crea una migración vacía para SQL a mano (triggers, RLS, grants). |
| `pnpm --filter @sport-performance/db db:seed` | Crea el tenant ORC si no existe y siembra su configuración por defecto (rugby masculino y hockey femenino). Idempotente. Mismas variables que `db:migrate`; requiere las migraciones aplicadas y `pnpm build`. También está como bin `sport-performance-db-seed`. |
| `pnpm --filter @sport-performance/db db:migrate` | Aplica las migraciones pendientes con `MIGRATIONS_DATABASE_URL` (o `DATABASE_URL` si la primera falta o está vacía). Requiere `pnpm build`. También está como bin `sport-performance-db-migrate`. |
| `pnpm --filter @sport-performance/db db:provision-login` | Crea o actualiza un login (`DB_LOGIN_NAME`, `DB_LOGIN_PASSWORD`) como miembro de un rol de conexión (`DB_LOGIN_ROLE=app\|worker\|auth`), conectado como dueño. Idempotente; rota la contraseña. Bin `sport-performance-db-provision-login`. |

Nunca `drizzle-kit push` ni `drizzle-kit migrate` contra una base compartida. Una migración aplicada no se edita: el runner se niega a correr si un archivo aplicado cambió o si una migración pendiente es más vieja que la última aplicada (dos ramas que se mergearon fuera de orden). En ese caso se regenera la migración más nueva.

## Modelo

| Módulo | Tablas |
|---|---|
| `auth.ts` | `user`, `session`, `account`, `verification`: esquema core de Better Auth (ids `text` con UUID generado por la base), `is_superadmin` global. Sin `club_id`. |
| `tenant.ts` | `club` (raíz del tenant: zona horaria, marca, módulos) y las convenciones de toda tabla del club. |
| `organization.ts` | `membership` (usuario × club × rol), `season`, `category` (deporte + rama + franja de edad), `position` (por deporte), `staff_assignment` (categoría o deporte). |
| `players.ts` | `player` (sexo y deporte obligatorios; alta y baja con motivo), `player_position` (posiciones en orden, la principal primero), `player_parent_height` (altura de cada padre con origen), `player_category` (historia), `guardian`, `player_access_code` (B-310), `consent`, `player_stage` (historia y fijaciones). B-315, [ADR 0035](../../docs/adr/0035-jugadores-y-plantel.md). |
| `catalog.ts` | `metric_definition` (con `catapult_aliases`), `test_definition` (una fila por versión de protocolo) y `test_definition_metric`, `battery_config`, `reference_value`, `speed_zone_config`, `device`. |
| `testing.ts` | `test_window` (V1–V4), `test_session`, `test_result` (`done` / `not_done` con motivo, método, evaluador, dispositivo, condiciones), `test_result_value` (varias métricas e intentos, solo se agregan o se anulan), `anthro_measurement`. |
| `training.ts` | `training_session` (entrenamiento o partido), `drill`, `participation` (`srpe_au` generado), `wellness`, `external_metric`, `gym_program`, `gym_set`. |
| `alerts.ts` | `alert_rule` (la `AlertRule` del dominio como datos), `alert`. |
| `history.ts` | `change_history`: historial de cambios de resultados, sesiones y mediciones (B-305, ADR 0030), con sus enums. Lo escribe un trigger, nunca la aplicación. |
| `maturation.ts` | `khamis_roche_table` (procedencia y estado de verificación) y `khamis_roche_coefficient` (por sexo y edad): los coeficientes de Khamis-Roche como datos (B-203, B-306). |
| `access.ts` | `invitation` (invitación por link: email, rol, vencimiento, solo el SHA-256 del token; aceptada o anulada, nunca las dos), `invitation_category` (alcance por categoría que se convierte en `staff_assignment`) y `auth_rate_limit` (contadores de intentos del ingreso, global, claves HMAC). B-309, [ADR 0028](../../docs/adr/0028-auth-membresias-e-invitaciones-en-la-api.md). |
| `medical.ts` | Esquema `medical` (B-304, [ADR 0029](../../docs/adr/0029-esquema-medical-acceso-y-auditoria.md)): `injury`, `concussion` + `concussion_stage` (GRTP, alta obligatoria), `hold` (bloqueo para entrenamiento y partido), `note` (append-only, `medical` o `shared`) y `access_log` (append-only). Las referencias entre filas médicas llevan el jugador: `(club_id, x_id, player_id)`. |

Convenciones (ADR 0023): `club_id NOT NULL` y auditoría (`created_at`, `updated_at` con trigger, `created_by`, `updated_by`, `client_uuid` único por club) en toda tabla del club; claves foráneas compuestas `(club_id, x_id)` para que nada apunte a otro club; enums creados desde las constantes de `@sport-performance/domain`; días del club como `date` (`LocalDate`) y vigencias `[valid_from, valid_to)`.

## RLS y roles de conexión (ADR 0026)

| Rol (`NOLOGIN`) | Quién | Qué ve |
|---|---|---|
| `sport_performance_app` | API | Lo que permite el contexto de la transacción (`app.club_id`, `app.user_id`, `app.role`). |
| `sport_performance_worker` | worker | Todo el club del job (`app.club_id`), nada sin él. |
| `sport_performance_auth` | Better Auth | Solo `user`, `session`, `account`, `verification` y `auth_rate_limit` (contadores de intentos del ingreso). |

- Cada login real es miembro de **un solo** rol y se crea con `db:provision-login`; la contraseña nunca va al repo. La API verifica su login al arrancar.
- `app.current_role()` solo devuelve el rol si hay una membresía activa que lo respalde (o `is_superadmin` para `superadmin`). Sin contexto, todo se deniega.
- Asignaciones del staff (B-314, migración `0011_staff_assignment_ending`, [ADR 0034](../../docs/adr/0034-asignaciones-del-staff-y-membresias.md)): se terminan con `valid_to`, nunca se borran; una que no empezó queda con rango vacío (`valid_to = valid_from`, cancelada), lo único que `staff_assignment_validity` permite y el resto de las vigencias no.
- Tutores y cuentas de menores (migración `0018_guardians_and_player_access`, [ADR 0042](../../docs/adr/0042-tutores-y-cuentas-de-menores.md)): `player_access_code` (código y link de un solo uso para el dispositivo de un jugador/a sin email; solo hashes, vencimiento tope de 1 hora, uno abierto por jugador/a; RLS: la administración y los tutores del jugador/a), `invitation.player_id` / `guardian_relationship` (invitación del jugador/a o de un tutor atada a un jugador/a; un `parent` escribe las de sus hijos/as) y las funciones `app.redeem_player_access()` y `app.accept_invitation()` (reemplazada). `guardian_validity` admite el rango vacío: un vínculo terminado el día que empieza nunca vale.
- Las ramas del club (`club_branch`: deporte y sexo, migración `0009_clubs_branches_and_brand`, ADR 0032) son la raíz de las categorías: `category (club_id, sport, sex)` referencia a su rama por la clave natural. La marca del club está en columnas tipadas (`short_name`, `locale`, `primary_color`, `secondary_color`, `logo_file_id`); el slug solo lo cambia un superadmin (trigger `club_slug_guard`).
- El calendario (migración `0013_calendar`, ADR 0036): `season` y `test_window` se archivan (`archived_at`); las temporadas activas de un deporte y las ventanas activas de una temporada no se superponen (restricciones de exclusión con `btree_gist`, instalado en el esquema `extensions`). `fixture` guarda los partidos de una categoría con día y hora locales del club.
- Toda tabla con `club_id` tiene RLS forzada, una política `RESTRICTIVE` por club y políticas por rol, creadas con `app_admin.secure_club_table()`. Una tabla nueva la llama en su migración y suma una fila al fixture `src/testing/tenant-fixture.ts`; si no, los tests de RLS fallan.
- Tests (migración `0015_test_result_entries`, ADR 0039): `test_session.evaluator_id` (evaluador responsable del día), `test_result.exercise` (ejercicio de un resultado de fuerza) y, en `test_result_value`, `entry_id` (los valores de una misma entrada del evaluador) e `inputs` (lo que tipeó cuando el valor lo calculó el servidor), congelados por el guard append-only.
- `DELETE` solo en `drill`; `test_result_value` es append-only también por grants.
- `superadmin` solo vale en una transacción que registró su acceso con `app.begin_support_access(motivo)` (`support.access_log`, append-only). Sin `app.request_id` el registro se rechaza.

### Esquema `medical` (ADR 0029)

- Los roles de conexión **no leen** columnas clínicas (solo `id`, para filtrar un `UPDATE`). Se lee con `medical.read_injuries`, `read_concussions`, `read_concussion_stages`, `read_holds`, `read_notes` y `medical.availability(player_ids, on_date)`, que escriben `medical.access_log` en la misma transacción. Todo exige `app.request_id` (`TENANT_SETTING_NAMES.requestId`).
- Escriben (INSERT/UPDATE, sin `RETURNING` ni `DELETE`) solo el rol `medical` sobre jugadores de sus asignaciones; lesiones, conmociones, etapas y notas piden consentimiento `health` vigente. Un trigger registra cada fila escrita con los nombres de las columnas cambiadas.
- Leen: `medical` (asignados), el jugador lo suyo y el tutor de un menor, con consentimiento `health` (solo notas `shared`, sin bloqueos en detalle). El resto del staff, `admin` y `superadmin` ven solo `medical.availability()`: `available` / `limited` / `unavailable` para entrenamiento y partido, sin causa.
- `app.not_done_reason_for_viewer(reason)` muestra `injured` como `unavailable` a todo rol que no sea `medical`.
- El log no se modifica ni se borra, tampoco como dueño. El worker no llega al esquema.
- Invitaciones (B-309, [ADR 0028](../../docs/adr/0028-auth-membresias-e-invitaciones-en-la-api.md)): `invitation` e `invitation_category` las leen y escriben solo `admin` y `superadmin` del club, y de una invitación la API solo puede cambiar su anulación (grant de `UPDATE` por columna). Un solo link abierto por club, email y rol (`invitation_pending_key`) y una sola asignación abierta por membresía y categoría (`staff_assignment_open_category_key`). Quien abre el link todavía no es miembro: `app.invitation_by_token(hash)` y `app.accept_invitation(hash)` (`SECURITY DEFINER`, solo para `sport_performance_app`) encuentran exactamente la invitación de ese hash; aceptar exige `app.user_id` sin club, valida estado y email en la base y crea la membresía y las asignaciones de staff.
- `change_history`: solo `SELECT` para la API y el worker; sin `INSERT`, `UPDATE` ni `DELETE` para nadie más que el trigger (ver [Historial de cambios](#historial-de-cambios)).
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

## Historial de cambios

Todo `UPDATE` o `DELETE` de `test_session`, `test_result`, `test_result_value`, `anthro_measurement`, `training_session`, `participation`, `wellness`, `external_metric` y `gym_set` (`CHANGE_TRACKED_TABLES` del dominio) deja una fila en `change_history`, escrita por el trigger `change_history_record` (migración `0008_change_history`, ADR 0030): columnas cambiadas con valor anterior y nuevo, autor (`app.user_id`), fecha, motivo, request id, rol validado y origen (`app` / `worker` / `system`).

```ts
import { listRecordChangeHistory, setChangeContext } from '@sport-performance/db';

// Dentro de la transacción del request, después del contexto de tenant y antes de escribir:
await setChangeContext(db, { reason: body.reason, requestId: request.id });
await db.update(schema.testResult).set({ notes }).where(eq(schema.testResult.id, id));

// Lectura (RLS: el staff que ve al jugador), del más nuevo al más viejo, paginada por `seq`:
const { entries, nextBeforeSeq } = await listRecordChangeHistory(db, { tableName: 'test_result', recordId: id });
```

- **Motivo obligatorio** cuando la API corrige un dato ya cargado (borra, o cambia una columna que tenía valor): sin `app.change_reason` la sentencia falla con `23514` / `change_history_reason_required`. Completar un valor vacío (el RPE del jugador, una anulación) y las columnas de ciclo de vida o derivadas no lo piden. El worker y el dueño quedan registrados; para ellos es opcional.
- `test_result_value` sigue append-only: se anula y se agrega otro valor; la anulación queda en el historial con su `void_reason`.
- Inmutable: guard que rechaza todo `UPDATE`/`DELETE`, también al dueño, salvo el `ON DELETE SET NULL` del autor.
- Lectura: `test_result.not_done_reason = 'injured'` sale como `unavailable` para todo rol que no sea `medical` (`app.not_done_reason_for_viewer`, ADR 0029).
- El esquema `medical` no se sigue: tiene su propio log (`medical.access_log`, ADR 0029).

## Seeds

`bootstrapClub(db, { clubId, branches })` deja un club listo con la configuración por defecto, copiada de `@sport-performance/domain` (ADR 0027). La creación de clubes (B-313) la llama dentro de su transacción.

| Tabla | Qué siembra | Fuente |
|---|---|---|
| `metric_definition` | Todo el diccionario canónico, con `catapult_aliases` de las columnas de OpenField | `CANONICAL_METRICS` + `seeds/catapult-aliases.ts` |
| `test_definition`, `test_definition_metric` | Versión 1 de los 10 tests de la batería con su protocolo (texto es-AR y `parameters`) y sus métricas (derivadas marcadas) | `CANONICAL_TEST_CODES`, `DEFAULT_ATTEMPT_SCORING`, `DEFAULT_IFT_3015_PROTOCOL`, `DEFAULT_E1RM_PROTOCOL`, `SPRINT_VMAX_SEGMENT` |
| `battery_config` | Batería por rama y etapa ("2 V" = V1 y V3; antropometría continua; CMJ semanal en `performance`; bronco y cuello solo rugby) | `seeds/battery.ts` + `STAGE_PROFILES` |
| `club_branch` | Las ramas (deporte y sexo) del club; una archivada no se reabre | `branches` del llamado |
| `position` | Posiciones de los deportes del club con su línea | `DEFAULT_POSITION_LINES` |
| `category` | M13–M19 por rama | `DEFAULT_AGE_BANDS` |
| `alert_rule` | Reglas por defecto, validadas con `parseAlertRuleSet` | `DEFAULT_ALERT_RULES` |
| `speed_zone_config` | Zonas absolutas y relativas del club | `DEFAULT_SPEED_ZONE_SETS` |
| `khamis_roche_table`, `khamis_roche_coefficient` | Tabla de 1994 con su procedencia | `KHAMIS_ROCHE_1994_TABLE` |

Volver a correr solo inserta lo que falta y nunca actualiza: no pisa lo que el club editó (reglas deshabilitadas, categorías renombradas, zonas o baterías cerradas). Corre en una transacción con `pg_advisory_xact_lock` por club y `app.club_id` fijado. Con RLS (ADR 0026) hay dos formas de correrlo: `db:seed` se conecta como el dueño de las migraciones (`MIGRATIONS_DATABASE_URL`: superusuario o `BYPASSRLS`; ningún rol de conexión puede crear el club sin contexto), y la creación de clubes (B-313) lo llama con el login de `sport_performance_app` dentro de una transacción con `app.user_id` de un superadmin y `app.role = 'superadmin'`, que las políticas dejan escribir en todas las tablas sembradas. No siembra jugadores ni datos de prueba (#38).

## Fuera de este paquete por ahora

Datos de prueba y club demo (#38), columnas HLC y marcas de borrado para la sincronización (B-323), tablas `*_daily` del worker (B-326) y la tabla de importaciones de Catapult (B-601; `external_metric.import_id` ya existe).

## Tests

```sh
docker run -d --rm --name pg-dev -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm --filter @sport-performance/db test
```

Cada archivo de integración (`*.integration.test.ts`) crea su propia base temporal y la borra al terminar. Sin `DATABASE_URL` se saltean localmente; en CI (`CI` definido) fallan. Los tests cubren: migración desde cero, idempotencia y concurrencia del runner, convenciones por introspección (de las definiciones y de la base migrada), enums = dominio, índices de las claves compuestas, `CHECK`s, triggers (`updated_at`, `test_result_value` append-only, unidad = la de la métrica), RLS (catálogo: toda tabla forzada, roles sin privilegios, grants mínimos; aislamiento entre clubes por cada tabla con `club_id` enumerada desde la base; fail-closed; conexiones del pool; alcance por rol, `superadmin` con acceso de soporte registrado, worker y Better Auth), esquema `medical` (catálogo sin lecturas directas, escrituras por rol, asignación y consentimiento, lecturas y disponibilidad por rol, una fila de log por cada lectura y escritura, log inmutable, aislamiento entre clubes, reglas del GRTP y del alta), sincronía esquema ↔ migraciones (`drizzle-kit generate` sin cambios), compatibilidad con Better Auth (alta de usuario con su adaptador de Drizzle), historial de cambios (qué se registra, motivo obligatorio y opcional, `test_result_value` append-only, visibilidad por rol, inmutabilidad también para el dueño, borrado del autor, worker, paginación, triggers en exactamente las tablas seguidas) y seeds (bootstrap desde cero, re-corrida y corridas concurrentes sin cambios, ediciones del club preservadas, Khamis-Roche leída de la base igual a la del dominio, bootstrap con el rol de la aplicación como superadmin, comando `db:seed`).

### Bases temporales (`@sport-performance/db/testing`)

`createTemporaryDatabase({ serverUrl })` es el helper común de `packages/db` y `apps/api` (lo usan `src/testing/database.ts` y `apps/api/src/testing/identity.ts`):

- Una base migrada es una copia (`CREATE DATABASE ... TEMPLATE`) de `sp_tpl_<hash>`, una plantilla migrada una sola vez por servidor y por conjunto de migraciones (el hash cambia con cualquier archivo de `drizzle/`). Se arma bajo un advisory lock, queda con `ALLOW_CONNECTIONS false` y se conserva entre corridas. Con `migrate: false` la base queda vacía (ahí migran los tests del runner).
- Todo pool sobre la base se registra (`database.pool()`, o `database.track(pool)` para los pools de la API): listener de `error` en el pool y en cada cliente. `drop()` cierra cada pool **esperando que se cierre cada socket** (`pool.end()` resuelve antes) y recién ahí hace `DROP DATABASE ... WITH (FORCE)` y borra los logins de `database.login(role)`. El `57P01` de una conexión terminada se absorbe; cualquier otro error de una conexión ociosa, o un cliente nunca liberado, hace fallar `drop()` (después de borrar la base) en vez de aparecer como error no manejado (#147).
