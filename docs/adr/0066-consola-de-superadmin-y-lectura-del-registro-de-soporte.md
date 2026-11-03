# 0066. Consola de superadmin: motivo por sesión, cliente propio, alta de clubes con su primer admin y lectura del registro de soporte por una función auditada

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #77 (B-414)

## Contexto

La API ya tenía el registro de clubes del superadmin (`GET`/`POST /v1/clubs`, con la configuración por defecto sembrada en la misma transacción, ADR 0027), el soporte por headers (`X-Support-Club-Id` + `X-Support-Reason`, ADR 0032) y el registro append-only `support.access_log`, que la base escribe en cada transacción de un superadmin (ADR 0029). La web tenía el modo soporte: un motivo, un club y las pantallas del club (ADR 0057). Faltaba la consola: dar de alta un club, prender o apagar sus módulos, conseguir que alguien lo administre y ver la auditoría del soporte.

Tres huecos concretos:

- Un club recién creado no tiene miembros, y la API solo dejaba invitar al `admin` del club (`requireInvitationManager`, provisorio "hasta que llegue la matriz", ADR 0028). La matriz ya decía `membership.invite` para `admin` y `superadmin` en el club, y la RLS de `invitation` también: nadie podía invitar al primer admin sin tocar la base.
- `support.access_log` no se puede leer desde la aplicación (sin grants sobre el esquema, RLS forzada sin políticas; los tests de catálogo lo exigen). El ADR 0029 dejó la consulta al dueño de la base, pero "acceso de soporte con auditoría" pide que se pueda ver desde el producto, y el club tiene derecho a saber quién entró a sus datos.
- La consola no vive dentro de un club y un superadmin puede ser además miembro de alguno: el cliente de la web le agrega a todo pedido los headers de la selección del club (`X-Membership-Id`), que con `X-Support-Club-Id` la API rechaza.

## Decisión

- **Lectura del registro por una función `SECURITY DEFINER`** (migración `0034_support_access_read`): `app.support_access_entries(club, operador, desde, hasta, keyset, límite)`, `search_path` fijo, sin `PUBLIC`, ejecutable solo por `sport_performance_app`. El esquema `support` sigue sin grants. La función decide el alcance con el contexto validado de la transacción, no con lo que pide la API: con `app.is_superadmin()` (registro de clubes, con su acceso registrado) ve todo, opcionalmente de un club; con `app.current_role()` `admin` o `superadmin` (que registró su acceso a ese club) solo las entradas de ese club, y pedir otro es `42501`; cualquier otro, `42501`. Exige `app.request_id`. Junta el nombre y el email del operador y el club (nombre, slug, zona horaria) para mostrarlos; el registro sigue guardando solo ids. Siempre de la más nueva a la más vieja, con keyset por `(started_at, id)` en microsegundos (`started_at_key`) e índices nuevos para el orden global y por club.
- **Dos endpoints** (`tags: support`): `GET /v1/support-access` con alcance de registro, autorizado con `club_registry.read`, filtra por club, operador y período; `GET /v1/club/support-access` del club activo, autorizado con un recurso nuevo de la matriz, `support_access.read` (`admin` y `superadmin` en el club, con su especificación). Listas por cursor opaco con huella de los filtros, máximo 100, sin otro orden que el cronológico inverso. Leer el registro como superadmin es también un acceso: queda en el mismo registro.
- **Invitaciones por la matriz:** crear, listar y anular invitaciones se autoriza con `membership.invite`, `read` y `revoke`. El superadmin que asiste un club invita a su primer admin desde la consola; el resto del staff sigue sin poder.
- **Consola en `/console`**, hija de la sesión y fuera del layout del club, solo para `isSuperadmin` (el resto va a `/clubs`). Pide un **motivo por sesión** antes de cualquier pedido, que viaja en `X-Support-Reason` en cada uno; vive en `sessionStorage` (se termina con la pestaña, como la selección de soporte) y se puede cambiar. Usa **su propio cliente** (`consoleApi`: el mismo cliente tipado sin los headers de la selección del club), así que cada llamada lleva solo los headers de soporte que le corresponden: de registro, o del club que mira. Sus consultas van bajo la raíz `['console', …]`.
- **Pantallas:** registro de clubes con búsqueda y "Cargar más"; alta de club validada con el esquema del contrato antes de mandarla, slug sugerido desde el nombre, ramas obligatorias y un `clientUuid` por formulario (un reintento no duplica; slug ocupado se marca en el campo); detalle de un club como soporte (perfil, ramas con archivar, restaurar y habilitar, módulos con `version` y aviso de conflicto, invitación del admin y pendientes, entrar como soporte con el mismo motivo); registro de accesos de soporte con filtros por club y días. El club ve sus accesos en `/support-access`, con la entrada de navegación gateada por `support_access.read`. Las fechas van en la zona del club de cada entrada (o la del producto para el registro).

## Alternativas descartadas

- **Grant de `SELECT` sobre `support.access_log` con políticas de RLS.** Rompe la regla de que ningún rol de conexión llega al esquema `support` y obliga a dar lectura de `user` fuera de la membresía para mostrar al operador; la función hace lo mismo con un solo punto de control y mantiene el catálogo como estaba.
- **Una vista sobre el registro.** Una vista del dueño saltea la RLS de todo lo que lee y la condición de alcance queda en un `WHERE` que el planificador puede reordenar; la función es explícita y se prueba igual que las de `medical`.
- **Mostrar los accesos agrupados por sesión de soporte.** Agrupar por operador, club y motivo es una heurística (el mismo motivo puede repetirse días después) y complica el cursor; cada entrada es un pedido real con su request id, que es lo que se cruza con los logs.
- **Reusar el cliente de la web y pisar `X-Membership-Id` por llamada.** Los headers del cliente se combinan y no se pueden sacar por llamada; un cliente sin selección es más simple y no depende de qué club quedó elegido.
- **Una consola dentro del layout del club (modo soporte).** El alta de clubes y la auditoría son del registro, no de un club; mezclarlos obligaría a elegir un club para dar de alta otro.

## Consecuencias

- El test de catálogo de funciones `SECURITY DEFINER` incluye `app.support_access_entries`; los de roles prueban el alcance (registro, admin, superadmin en un club, otros roles, worker, sin request id).
- La matriz suma `support_access.read`; cualquier rol nuevo necesita su celda.
- Las pantallas de configuración del club (otro issue) pueden reusar los campos (`ui/fields.tsx`), las tablas (`sp-table`) y el patrón de módulos con `version`.
- Quedan fuera: suspender o dar de baja un club (`club_registry.update` sigue sin endpoint), editar el perfil o la marca desde la consola (es de la configuración del club) y exportar el registro de soporte.
