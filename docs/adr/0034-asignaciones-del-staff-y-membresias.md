# 0034. Asignaciones del staff y membresías: vigencia, fin, superposición y cambio de rol

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #45 (B-314)

## Contexto

Lo que ve cada miembro del staff sale de `staff_assignment` (ADR 0007, ADR 0025): el sujeto de permisos de la API (`loadPermissionSubject`) y `app.visible_player_ids()` de la base toman las asignaciones vigentes en el día del club (`valid_from <= hoy < valid_to`). Hasta B-314 las únicas que se creaban eran las de una invitación aceptada (B-309); faltaba que la administración asigne, cambie y termine asignaciones, y que administre las membresías (listar, cambiar el rol, dar de baja). Quedaban preguntas abiertas: cómo se termina una asignación que todavía no empezó (la tabla no tiene `DELETE` para la aplicación y `valid_to > valid_from` no dejaba cerrarla), si dos asignaciones del mismo miembro al mismo destino pueden superponerse, qué pasa con las asignaciones cuando termina la membresía y si un cambio de rol edita la membresía o abre otra.

## Decisión

- **Destino:** una categoría (`{ kind: 'category', categoryId }`) o todo un deporte (`{ kind: 'sport', sport }`), igual que `AssignmentTarget` del dominio. Entrenador y preparador físico van por categoría (una asignación por cada una) y el médico por deporte; la API no lo restringe por rol (el modelo y la matriz aceptan cualquiera de los dos para `coach`, `sc` y `medical`) y la web propone el destino según el rol. Solo membresías activas de esos tres roles; una categoría activa del club o un deporte con una rama habilitada.
- **Vigencia:** días del club `[validFrom, validTo)`, `validFrom` por defecto el día del club (`app.club_today()`, nunca el del servidor). Se puede cargar historia (rangos pasados).
- **Terminar no es borrar:** `POST /v1/staff-assignments/{id}/end` fija `validTo` en el día del club, así deja de valer ese mismo día; si todavía no empezó, `validTo = validFrom`: rango vacío, cancelada, nunca vigente, y la fila queda como registro. La migración `0011` cambia `staff_assignment_validity` a `valid_to IS NULL OR valid_to >= valid_from` (solo en esta tabla: en el resto un rango vacío sigue siendo un error de carga). Todos los lectores de la vigencia ya tratan un rango vacío como no vigente, sin cambios; un test del dominio lo fija (`staffAssignmentStatus`, `isCurrentOn`, `currentAssignments`).
- **Sin superposición:** dos asignaciones de la misma membresía al mismo destino no comparten días (`409`). Lo chequea la API con el dominio (`validitiesOverlap`) bajo un `SELECT … FOR UPDATE` de la membresía, que serializa altas, ediciones, el fin de una asignación (que la vuelve a leer bajo ese lock, así un `PATCH` que movió `validFrom` no le deja un `validTo` anterior) y la baja del miembro; `staff_assignment_open_category_key` sigue como barrera de la base para las abiertas.
- **Membresía terminada:** `POST /v1/club/members/{id}/end` fija `ended_at = now()` y termina sus asignaciones abiertas en la misma transacción (las vigentes hoy, las futuras quedan canceladas). Desde el request siguiente la persona no actúa con esa membresía (cada request vuelve a leer las activas). Si se queda sin ninguna membresía, `revokeSessionsOfEndedMembership` de B-333 (ADR 0033), enganchado en `onMembershipEnded`, cierra todas sus sesiones.
- **Cambio de rol = terminar y abrir:** `POST /v1/club/members/{id}/role` termina la membresía (con sus asignaciones) y crea otra con el rol nuevo, con el mismo `invited_by`. El período de cada rol queda registrado en `started_at`/`ended_at` y las asignaciones de un rol no pasan a otro (un entrenador que pasa a preparador físico ve lo que se le asigne como tal). El `id` cambia: el cliente vuelve a elegir club. Si la membresía ya tiene ese rol, o la persona ya tiene otra membresía activa con ese rol: `409`.
- **Gobernable siempre:** un admin no termina ni cambia la membresía con la que actúa (`409`) y el club nunca queda sin un admin activo (`409`, también para el superadmin). Cuando el destino es un admin activo, el request bloquea primero todas las membresías de admin activas del club en una sola sentencia ordenada por id y recién después la fila del destino (que ya está entre ellas): dos admins que se dan de baja a la vez toman los mismos locks en el mismo orden, uno espera al otro (sin deadlock `40P01`) y ve su baja, así no quedan los dos afuera ni el club sin admin.
- **Mis asignaciones:** `GET /v1/me/staff-assignments` devuelve las de la membresía con la que actúa el request (son parte de su sujeto de permisos, no un recurso de la matriz: cualquier rol lee las suyas, casi siempre ninguna). El superadmin en soporte no es miembro: lista vacía.
- Las listas de asignaciones (`GET /v1/staff-assignments`) y de miembros (`GET /v1/club/members`) son de la administración (`staff_assignment.read`, `membership.read`), paginadas por cursor y con `status` calculado en el día del club (asignaciones: `active` = vigentes y futuras, `current`, `upcoming`, `ended`, `all`; miembros: `active`, `ended`, `all`).

## Alternativas descartadas

- **Borrar las asignaciones futuras.** Pide una política de `DELETE` solo para filas que no empezaron (con el día del club en la política) y pierde el registro de quién asignó qué; el rango vacío no necesita permisos nuevos.
- **Restricción de exclusión (`EXCLUDE USING gist`) contra la superposición.** Necesita `btree_gist` para comparar los `uuid` y una por destino; con el lock de la membresía alcanza y el mensaje de error es propio.
- **Editar el rol en el lugar.** Pierde desde cuándo tenía cada rol y deja las asignaciones de un rol aplicadas a otro; además la base cachea el rol validado por request, no por membresía.
- **Restringir el destino por rol.** Un preparador físico jefe por deporte o un kinesiólogo por categoría son casos reales; la matriz ya resuelve cualquiera de los dos.

## Consecuencias

- La web arma la pantalla de staff con estos endpoints: miembros, rol, baja y asignaciones por categoría o deporte con fechas.
- Archivar una categoría no termina sus asignaciones (siguen apuntando a una categoría que no se lista); si hace falta, se agrega al archivar de B-313.
- `onMembershipEnded` corre dentro del request pero fuera de su transacción, antes del commit (las sesiones se borran por otra conexión): si la transacción falla después, la membresía sigue activa pero las sesiones ya se cerraron (la persona vuelve a ingresar; no pierde acceso que le corresponda).
- Las rutas de miembros son `/v1/club/members*` (contrato `members.ts`), no `/v1/memberships*` como decía el issue: siguen a `/v1/club/branches` (recurso del club con el que actúa el request).
