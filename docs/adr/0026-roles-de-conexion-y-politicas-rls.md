# 0026. Roles de conexión, funciones `app.*` y políticas RLS por club y rol

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #33 (B-302)

## Contexto

El ADR 0006 fija `club_id` en todas las tablas, RLS habilitada y forzada, un rol de conexión que no es dueño ni tiene `BYPASSRLS`, y políticas sobre funciones propias `app.current_club_id()`, `app.current_user_id()` y `app.current_role()`. El ADR 0023 creó el esquema y dejó para #33 la RLS, los grants y los roles. El ADR 0024 dejó en la API el helper que abre una transacción por request y fija `app.club_id`, `app.user_id` y `app.role` con `set_config(..., true)`. Quedaban por decidir: cuántos roles de conexión hay y con qué privilegios, qué tan fino es el filtro por rol en la base frente a la matriz de permisos de la API (B-303), qué pasa si la API fija un rol equivocado, cómo trabaja el `superadmin` y el worker, qué ve Better Auth y cómo se crean los logins sin poner contraseñas en las migraciones.

## Decisión

- **Tres roles de grupo `NOLOGIN`**, creados por la migración `0004_rls_and_roles` (idempotente: los roles son del cluster): `sport_performance_app` (la API), `sport_performance_worker` (el worker) y `sport_performance_auth` (Better Auth). Ninguno es superusuario, dueño de objetos ni tiene `BYPASSRLS`, `CREATEROLE`, `CREATEDB` o `REPLICATION`. Los logins reales se crean con `provisionLoginRole()` / `db:provision-login` como miembros de **exactamente uno** de ellos (la unión de dos, por ejemplo app y worker, anularía el alcance por rol). La contraseña nunca está en el repo y al servidor solo llega su verificador SCRAM-SHA-256, así no queda en el log de sentencias.
- **La API y el worker verifican su login al arrancar** (`assertConnectionRole`): si es superusuario, tiene `BYPASSRLS`, `CREATEROLE` o `CREATEDB`, es dueño de alguna tabla o no es miembro de su rol (o lo es de otro), el proceso no arranca. Con la URL del dueño la RLS no aplicaría y nadie se daría cuenta.
- **Las migraciones corren como superusuario o con `BYPASSRLS`** (la migración lo exige). Las funciones `SECURITY DEFINER` son de ese rol y leen tablas con `FORCE ROW LEVEL SECURITY`.
- **Funciones de contexto** en el esquema `app`: `current_club_id()` (`uuid`; un valor mal formado es un error, nunca una coincidencia), `current_user_id()` (`text`) y `current_role()`. `''` y ausencia valen `NULL`: se deniega.
- **`app.current_role()` no le cree a la API.** Devuelve el rol pedido solo si existe una membresía activa de ese usuario con ese rol en ese club, o si el rol es `superadmin` y el usuario tiene `is_superadmin`. Un bug que fija `admin` para un entrenador no da nada.
- **Aislamiento por club independiente del rol.** Cada tabla con `club_id` tiene una política `RESTRICTIVE` para la API y otra para el worker que exigen `club_id = app.current_club_id()`, para todo comando (incluido el `WITH CHECK`: no se inserta ni se mueve una fila a otro club). Encima van las políticas permisivas por rol. Todo lo arma `app_admin.secure_club_table()`, así toda tabla nueva queda con la misma forma, y los tests de catálogo la verifican.
- **Alcance por rol en la base** (piso de seguridad; la matriz de la API, B-303, es más fina y gana la más restrictiva):
  - `admin`, y `superadmin` con contexto de club: todo el club.
  - `coach`, `sc`, `medical`: los jugadores que **hoy, en el día del club**, están en una categoría de sus `staff_assignment` vigentes (por categoría o por deporte), con toda su historia. Sin asignación no ven jugadores.
  - `player`: su jugador. `parent`: sus hijos (vínculo `guardian` vigente).
  - Catálogos, calendario y sesiones: todo miembro del club. Dispositivos, reglas de alerta, alertas y asignaciones: solo el staff. Usuarios: uno mismo y, para el staff, los miembros del club.
  - Escritura: `admin` la estructura del club y las personas; `sc` (y `admin`) tests, mediciones, catálogos, batería, gimnasio y ventanas; `coach` (y `sc`, `admin`) sesiones, drills y participación; el `player` su bienestar, su RPE y sus series de gimnasio; el tutor y el jugador firman consentimientos como ellos mismos. Solo se escriben filas que el rol puede leer.
- **Sin club en el contexto** (selector de club, ADR 0007) un usuario ve sus membresías de todos los clubes y esos clubes, nada más. Un `superadmin` sin club ve la lista de clubes y puede dar de alta uno; para ver datos fija el club que asiste (ADR 0006). La auditoría de sus accesos es de B-304 (#35).
- **El worker** (`sport_performance_worker`) ve y escribe todo el club del job y nada sin `app.club_id`. Su identidad es el rol de la base, no un setting que se pueda falsear.
- **Better Auth** (`sport_performance_auth`) solo llega a `user`, `session`, `account` y `verification`. La API y el worker no ven sesiones, cuentas ni verificaciones. `is_superadmin` solo lo cambia un operador conectado como dueño (trigger `user_superadmin_guard`).
- **Mínimo privilegio en los grants.** `SELECT`, `INSERT` y `UPDATE` donde el rol escribe; `UPDATE` nunca sobre `id`, `club_id`, `created_at`, `created_by` ni `client_uuid`; el `slug` del club no se edita desde la aplicación. Sin `TRUNCATE`, `REFERENCES` ni `TRIGGER`. Sin acceso al esquema `drizzle` ni a `app_admin`. **`DELETE` solo en `drill`** (un plan de sesión, sin datos de jugadores): la aplicación cierra, anula o archiva (ADR 0023), y `test_result_value` es append-only también por grants. Una tabla que necesite `DELETE` lo agrega en su migración con su motivo y su test.
- **Tema público del club:** `app.club_theme(slug)` (`SECURITY DEFINER`) devuelve solo id, slug, nombre, marca y fecha de cambio, para el endpoint público que se pide antes del login (B-313).
- **La comprobación de unidades** (`unit_matches_metric`, ADR 0023) corre como dueño: como invocador, un escritor que no viera la métrica salteaba el chequeo.
- **API:** el pool sale de `createPool` de `@sport-performance/db` y los handlers transaccionales reciben, además de `tx`, el cliente Drizzle tipado sobre esa misma conexión (cacheado por conexión del pool).

## Alternativas descartadas

- **Un solo rol para API, worker y Better Auth.** Más simple, pero el worker necesita ver todo el club sin un usuario, y Better Auth necesita leer usuarios y sesiones sin contexto de club: con un solo rol, la API también podría.
- **Confiar en `app.role` tal como lo fija la API.** Un error en la sesión o en el selector de club alcanzaría para escalar privilegios; validar contra `membership` cuesta una consulta por sentencia (un init plan) y cierra esa puerta.
- **Solo aislamiento por club en la base y todo lo demás en la API.** Un jugador o un tutor vería a todo el club ante un `WHERE` olvidado: son datos de menores.
- **La matriz de permisos completa en RLS** (etapa, consentimiento, rankings con nombres). Cambia seguido y depende de reglas del dominio; vive en la API (B-303) con un test por celda.
- **Grants por columna en `user` para `is_superadmin`.** Better Auth escribe `is_superadmin = false` al registrar: un grant por columna lo rompería. El trigger deja pasar `false` y rechaza cualquier cambio.
- **Contraseñas de los logins en una migración o en variables leídas por la migración.** Quedarían en el repo o en el historial de la base; se crean aparte, con el verificador SCRAM.

## Consecuencias

- Toda tabla nueva con `club_id` llama a `app_admin.secure_club_table()` en su migración y suma una fila al fixture de los tests de RLS (`src/testing/tenant-fixture.ts`); si no, fallan los tests de catálogo y de aislamiento, que enumeran las tablas desde la base.
- Desarrollo local y deploy: correr las migraciones con el dueño (`MIGRATIONS_DATABASE_URL`), crear un login por servicio con `db:provision-login` y usar ese login en `DATABASE_URL`. Con el dueño la API no arranca.
- `test_result.not_done_reason = 'injured'` sigue visible para quien ve el resultado; mostrarlo como "no disponible" a los entrenadores es una proyección por columna de la matriz (#34) y del esquema `medical` (#35).
- #40 monta Better Auth con un pool propio sobre un login de `sport_performance_auth`. Las invitaciones que crean membresías sin ser `admin` necesitarán su propia función o política.
- Si una ruta de lectura masiva queda lenta por `app.visible_player_ids()`, se optimiza la función (índices, materialización por request) sin cambiar las políticas.
