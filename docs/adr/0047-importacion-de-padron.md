# 0047. Importación de padrón: planilla leída en el cliente, vista previa, duplicados, decisiones por fila y registro sin datos personales

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #61 (B-330)

## Contexto

Un club que empieza a usar la plataforma ya tiene su padrón en una planilla: jugadores con su fecha de nacimiento, categoría y posición, y los emails de madres, padres o tutores. Cargarlo a mano jugador por jugador (`POST /v1/players`, ADR 0035) es lento y propenso a errores, y cargarlo dos veces crea fichas duplicadas que después parten la historia comparable de un jugador. Las planillas reales están tipeadas a mano: tildes y mayúsculas que no coinciden, nombre y apellido invertidos, fechas `dd/mm/aaaa`, el CSV de Excel en es-AR separado por `;`. Faltaba decidir:

- dónde se lee el archivo (CSV o Excel) y qué recibe la API;
- cómo se detectan los duplicados y quién decide qué hacer con ellos;
- qué se hace con los tutores, que necesitan una cuenta propia para tener el vínculo `guardian` (ADR 0042);
- qué queda registrado de cada importación sin duplicar datos personales.

## Decisión

### La planilla se lee en el cliente, con funciones del dominio

- Como en la importación de referencias (ADR 0040), **la API no recibe archivos**: recibe filas ya tipadas. El cliente lee el archivo y lo convierte con funciones puras de `packages/domain` (`roster-import/`), las mismas para la web y para cualquier otro cliente:
  - `parseDelimitedText`: CSV RFC 4180 con BOM, comillas, saltos de línea dentro de campos y detección del separador (`;` gana los empates: es lo que escribe Excel en es-AR, donde la coma es decimal).
  - `rosterRowsFromTable`: encabezados en español o inglés sin importar tildes ni mayúsculas (`Apellido`, `Fecha de nacimiento`, `Pie hábil`, `Email madre`, `Email tutor 2`, `Vínculo tutor 2`…), `Apellido, Nombre` en una sola columna (solo con coma: sin coma, separar sería adivinar), fechas `dd/mm/aaaa` o ISO, `M` / `F`, `madre` / `padre` / `tutor legal`, `izquierdo` / `derecho` / `ambos`. Cada celda que no se puede leer es un problema con su fila y su columna; las columnas que no se reconocen se informan y no se leen. Años de dos dígitos y números de serie de Excel no son fechas: el siglo o la época serían una suposición.
- Un Excel lo convierte el cliente a una tabla de texto (`tableFromMatrix`) y pasa por el mismo mapeo. El lector de XLSX es una dependencia de la web, no del dominio.

### Vista previa y validación contra el club

- `POST /v1/roster-imports/preview` no escribe nada. `POST /v1/roster-imports` aplica las mismas reglas y escribe todo o nada: si alguna fila no vale, `400` con el detalle por fila (`body.rows.<i>.<campo>`), como en ADR 0040. Una planilla a medias deja al staff sin saber qué entró.
- Hasta 1000 filas por importación (el plantel más grande entra varias veces; el cuerpo queda muy debajo del límite de 1 MiB).
- Reglas por fila, las mismas del alta (ADR 0035): la rama (deporte y sexo) habilitada; fechas no futuras; el alta no antes del nacimiento. El deporte puede venir por fila o por lote.
- **Categoría por nombre o por franja:** el nombre de una categoría activa de la rama del jugador, o su franja de edad (`M15`) si en la rama hay una sola con esa franja. Comparación sin tildes ni mayúsculas. La importación **no crea categorías**: son configuración del club (B-313), y una categoría mal tipeada en una fila no debe crear otra. El mensaje lista las categorías de la rama.
- **Posiciones por código o por la etiqueta del club**, del deporte del jugador, sin repetir.

### Duplicados y decisiones

- Dentro del archivo, dos filas de la misma persona (nombre, apellido y fecha de nacimiento normalizados, en el mismo deporte) son un error de la segunda.
- Contra el club, `RosterMatcher` compara con todos los jugadores del deporte, **también los dados de baja**: `exact` (mismo nombre, apellido y fecha) o `possible` (nombre y apellido invertidos; mismo apellido y fecha; nombre a dos ediciones o menos con la misma fecha; mismo nombre con la fecha a 31 días o menos, o con día y mes invertidos). Nunca entre deportes: otro deporte es otra ficha (ADR 0035).
- Cada fila puede traer una decisión (`create`, `skip` o `update` con `playerId` y `version`). Sin decisión: sin coincidencias se crea, con una exacta se omite, y con una posible es `400` (`resolution_required`). **Una coincidencia posible siempre la decide una persona**: crear de más parte la historia; fusionar de más mezcla a dos chicos.
- No se crea un duplicado exacto (`skip` o `update`). A un jugador dado de baja no se lo actualiza ni se lo vuelve a crear: se restaura (`POST /v1/players/{id}/restore`). El `playerId` de `update` tiene que ser un candidato de la fila, y su `version` la de la vista previa: si el jugador cambió, `409` y se vuelve a ver.
- **Qué hace cada decisión:** `create` da de alta con lado dominante, posiciones y la categoría desde el día de alta. `update` completa la ficha: lado dominante y posiciones (las reemplaza) si vienen, y la categoría **solo si no tiene ninguna vigente** (desde hoy). Nombre, fecha de nacimiento, sexo y alta no cambian: son la identidad que encontró la coincidencia y se corrigen en la ficha. Un cambio de categoría es un pase (ADR 0035) o el cambio de temporada (B-316), no una importación: `400`. `skip` no cambia la ficha.

### Tutores: vínculo si ya es miembro; si no, invitación a enviar

- Hasta 2 tutores por fila (email y vínculo). Si el email es de un `parent` activo del club, se crea el vínculo `guardian` desde hoy (o se informa `already_linked`). Si no, el resultado dice `invite` (o `invitation_pending`, si ya hay una invitación abierta para ese email y ese jugador). Una fila omitida sin jugador, o cuyo jugador está dado de baja, deja a sus tutores en `skipped`: no se vincula un tutor a una ficha archivada.
- **La importación no manda emails.** El resultado lista `invitationsToSend` (jugador, email, vínculo) y el cliente las manda con `POST /v1/invitations` (rol `parent`, `playerId`, `relationship`), que ya crea el vínculo al aceptarla (ADR 0042). Mandar cientos de emails dentro de la transacción del request (ADR 0028) haría que un fallo del proveedor a mitad deshaga todo el padrón con links ya enviados, y choca con los límites de envío. Cuando exista el worker (#57), la importación puede encolar esos envíos en la misma transacción.
- **Reimportar la misma planilla es la forma de retomar**: los jugadores ya creados son coincidencias exactas (se omiten), sus tutores ya vinculados dicen `already_linked`, y los que faltan invitar vuelven a aparecer.
- La altura de los padres **no** entra por el padrón: cargarla exige un consentimiento de datos vigente (matriz `parent_height.report`, ADR 0035), que un jugador recién dado de alta todavía no tiene. La informa el tutor después de firmar.

### Permisos, idempotencia y registro

- Solo la administración: `data_import.run` (que sin categoría solo pasa la administración, ADR 0025) y `player_profile.create`. El superadmin, con su acceso de soporte auditado.
- Idempotente por el `clientUuid` del lote: el registro guarda el SHA-256 del cuerpo validado. El mismo cuerpo devuelve el mismo resultado con `X-Idempotent-Replay: true` (las invitaciones a enviar se arman otra vez desde el cuerpo); otro cuerpo con el mismo `clientUuid` es `409`. Cada jugador creado lleva un `client_uuid` UUIDv5 del lote y la fila. Las importaciones del mismo club se serializan con un advisory lock: los duplicados se buscan contra lo que escribió la anterior.
- **`roster_import`** (migración `0022_roster_import`): quién, cuándo, los conteos y el resultado por fila (índice, fila de la planilla, `created` / `updated` / `skipped`, id del jugador, resultado de cada tutor). **Ni nombres, ni fechas, ni emails**: esos datos viven en las fichas que se crearon, con sus propias reglas de acceso (y de borrado, B-329). Lee y escribe solo la administración (RLS con `secure_club_table`); sin `UPDATE` ni `DELETE` para los roles de conexión: es un registro. `GET /v1/roster-imports` (resúmenes, paginado por fecha) y `GET /v1/roster-imports/{id}` (con el resultado por fila).

## Alternativas descartadas

- **Subir el archivo a la API y parsearlo ahí.** Otro tipo de contenido, otro límite de body y un parser de XLSX en el servidor para algo que el navegador ya lee; los errores por celda se muestran mejor donde está la planilla. Los archivos llegan con B-325 si hace falta guardarlos.
- **Importación parcial (las filas válidas entran).** Deja un padrón a medio cargar que nadie revisa; el staff corrige la planilla y la reenvía, y la vista previa le muestra todo antes.
- **Fusionar automáticamente las coincidencias posibles.** Dos hermanos o dos chicos con el mismo apellido y la misma fecha existen; una fusión equivocada mezcla historias y datos de salud de dos menores.
- **Guardar la planilla completa en el registro.** Duplicaría datos personales de menores fuera de las fichas, sin su control de acceso ni su borrado.
- **Crear categorías que no existen.** Un tipeo crearía una categoría nueva con su batería y sus asignaciones vacías.
- **Mandar las invitaciones desde la importación.** Ver arriba: emails dentro de la transacción y límites del proveedor; queda para el worker.

## Consecuencias

- La web (pantalla de importación del padrón) lee el CSV con `parseDelimitedText` o el Excel con su lector, muestra los problemas de la planilla y la vista previa con las coincidencias, deja decidir fila por fila y, al importar, manda las invitaciones de `invitationsToSend`.
- El worker (#57) puede tomar el envío de invitaciones de una importación como job encolado en la misma transacción, sin cambiar el contrato (las invitaciones dejarían de volver como pendientes de enviar).
- La importación de históricos (B-331) resuelve jugadores con el mismo `RosterMatcher` y la misma normalización de nombres.
- El cambio de temporada (B-316) es el que mueve jugadores de categoría; la importación solo asigna la primera.
