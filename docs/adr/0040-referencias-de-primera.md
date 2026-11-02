# 0040. Referencias de primera: carga, corrección, archivo, importación y vista del jugador

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #52 (B-321)

## Contexto

La ficha del jugador dibuja la referencia de primera con una línea blanca punteada (CLAUDE.md). El dominio ya elige y compara la referencia (`selectFirstTeamReference`, `compareToFirstTeamReference`, B-208) y la tabla `reference_value` existe desde el esquema base (métrica, deporte, sexo, posición o línea, valor, unidad igual a la de la métrica, método, vigencia y fuente), pero nadie podía cargarla. Faltaba decidir cómo se corrige una referencia mal cargada (el comentario del esquema decía "se reemplazan, nunca se editan"), cómo se evita que dos referencias activas iguales se contradigan, cómo llega una tabla entera (la planilla de la primera o, más adelante, el export de Catapult de #90), y qué ve un jugador, que no tiene permiso sobre la configuración del club (ADR 0025).

## Decisión

- **Permisos.** Listar y leer: `configuration.read` (coach, sc, medical y la administración, todo el club). Cargar, corregir, archivar, restaurar e importar: `configuration.update` (sc y la administración; el superadmin con su acceso de soporte). Jugadores y tutores no listan referencias. La RLS no cambia (todo miembro lee la tabla, sc y la administración escriben): es el piso debajo de la matriz.
- **Una referencia activa por clave.** Índice único parcial `reference_value_active_key` sobre `(club_id, metric_definition_id, sport, sex, posición, línea, valid_from)` con `archived_at IS NULL` (posición y línea con `coalesce`, porque `NULL` no choca en un índice único). Otra referencia con la misma clave es `409`; un período nuevo es otra fila con otra `valid_from`, así la historia de comparaciones queda.
- **Corregir no es reemplazar.** Un error de tipeo se corrige en el lugar (`PATCH` con `version`): valor, método, vigencia y fuente. Métrica, deporte, sexo y alcance son la identidad de la referencia y no se editan: se archiva y se carga otra. `reference_value` no está en `CHANGE_TRACKED_TABLES` (ADR 0030): es configuración del club, no un dato de un jugador, así que no pide `changeReason`.
- **Archivar, no borrar** (`archived_at`, ADR 0032). Una archivada deja de aplicar a los jugadores. Restaurarla cuando ya hay otra activa con la misma clave es `409`.
- **Códigos, no ids, en la entrada.** La carga manual y la importación nombran la métrica por su código canónico y la posición por su código en el deporte, igual que una planilla o un export. La API valida contra el club: métrica existente, activa y aplicable al deporte; unidad igual a la de la métrica (sin conversión silenciosa: el valor llega en la unidad canónica); posición del mismo deporte; línea usada por alguna posición del deporte. Posición y línea son excluyentes; sin ninguna, la referencia es del plantel.
- **Importación: una tabla ya parseada, todo o nada.** `POST /v1/reference-values/import` recibe JSON (hasta 500 filas), con `validFrom` y `source` por defecto para las filas que no traen los suyos. Si alguna fila no vale, `400` con el detalle por fila (`body.rows.<i>.<campo>`) y no se escribe nada: una planilla a medias deja referencias inconsistentes entre posiciones. `insert` falla con `409` si una fila choca con una activa; `replace` archiva la activa de la misma clave y vigencia y deja la importada (re-importar una planilla corregida). Idempotente por el `clientUuid` del lote: el `client_uuid` de cada fila es un UUIDv5 del lote y el índice de la fila, así reenviar el lote devuelve las mismas filas con `X-Idempotent-Replay: true`. El parseo del archivo (CSV, XLSX o el export de OpenField) queda en el cliente o en el import de Catapult (#90), que arman este mismo payload; la API no recibe archivos para esto.
- **Lo que ve el jugador.** `GET /v1/players/{playerId}/first-team-references` con `group_reference.read` (el propio jugador, el staff asignado, la administración; nunca el tutor): por métrica, la referencia que aplica al jugador según el deporte de su categoría (la vigente en `asOf`, si no la actual), su sexo y su posición, elegida con `selectFirstTeamReference` (posición, después la línea de su posición, después el plantel; la vigencia más nueva no posterior a `asOf`). Son valores de la primera: ningún dato de otros jugadores, así que no expone rankings. Es una vista calculada y acotada (una fila por métrica), no una lista paginada.
- **Esquema** (migración `0016_reference_values_archive`): `archived_at`, el índice único parcial, `CHECK` de `line_code` (mismo formato que `position.line_code`) y de `source` (sin espacios al borde, 1 a 200 caracteres), y el `GRANT UPDATE` de la columna nueva para los roles de conexión (los grants de `secure_club_table` son por columna). Las filas previas se normalizan antes de las restricciones y, de dos activas con la misma clave, queda activa la más nueva.

## Alternativas descartadas

- **Referencias inmutables (solo archivar y volver a cargar).** Corregir un tipeo pasaría por dos operaciones y dejaría una fila archivada por cada error; la versión ya protege de pisar una edición ajena.
- **Ids de métrica y posición en la entrada.** Obliga al cliente y al import a resolver códigos antes de mandar, y una planilla no tiene ids.
- **Importación parcial (insertar las filas válidas y devolver las otras).** Deja una tabla de referencias a medio cargar que nadie revisa; el staff corrige la planilla y la reenvía.
- **Subir el CSV a la API.** Otro parser, otro tipo de contenido y otro límite de body para algo que el cliente ya lee; los archivos llegan con #56 si hace falta guardarlos.
- **Listar las referencias para el jugador con `configuration.read`.** Le daría toda la configuración del club; ve solo lo que se compara con su valor.

## Consecuencias

- La web de configuración (B-322) carga, corrige, archiva e importa referencias con estos endpoints; la ficha (#51 y la web) toma la línea de referencia de la vista del jugador y la compara con `compareToFirstTeamReference`, avisando si los métodos difieren.
- El import de Catapult (#90) solo tiene que traducir columnas de OpenField a filas de `ReferenceImportRow` y llamar al endpoint de importación.
- Una métrica archivada deja de mostrar su referencia al jugador; sus referencias quedan para cuando se restaure.
