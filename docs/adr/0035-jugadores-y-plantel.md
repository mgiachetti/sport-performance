# 0035. Jugadores y plantel: deporte del jugador, posiciones, altura de los padres, alta y baja, y pases de categoría

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #46 (B-315)

## Contexto

B-315 trae los endpoints del plantel: la ficha del jugador (CRUD), su posición, el lado dominante, la altura de los padres con su origen (medida o informada, para Khamis-Roche, B-203) y el alta y la baja. Siguen las convenciones de endpoints del ADR 0032. El esquema base (B-301) tenía al jugador con una sola posición (`position_id`), la altura de los padres en cuatro columnas del jugador y `joined_on` / `left_on` sin motivo, y no guardaba el deporte del jugador: salía de su categoría. Eso dejaba huecos:

- La matriz de permisos evalúa al jugador con su deporte (`PlayerFacts.sport`: el `sc` asignado a un deporte ve a sus jugadores), y un jugador sin categoría vigente no tenía deporte.
- Un jugador juega más de una posición (un hooker que también es pilar), y las referencias y percentiles por posición (B-208, B-321) necesitan la principal.
- La matriz deja informar la altura de los padres al tutor (solo `reported`, mientras el jugador es menor y con consentimiento de datos) y al `sc` (B-303), pero la RLS de `player` solo deja escribir a la administración: guardarla en el jugador obligaba a abrirle al tutor la escritura de toda la ficha.
- La matriz deja editar la ficha a `coach` y `sc` en sus asignaciones (`player_profile.update`), y la RLS no.
- La baja no tenía motivo ni archivaba, y las categorías del que se iba quedaban abiertas (y con ellas la visibilidad del entrenador, `app.visible_player_ids`).

## Decisión

### Modelo (migración `0012_players_and_roster`)

- **`player.sport`** obligatorio (ADR 0017). La migración lo completa con el deporte de la última categoría del jugador, si no con la rama del club de su sexo cuando hay una sola, si no con la única rama del club; un jugador que no encaja en ninguna (o con varias ramas posibles) corta la migración. También la cortan, con un mensaje claro, una posición de otro deporte que el del jugador o una altura de padre de 300 cm o más (el check viejo solo pedía > 0). **Fijo una vez creado** (trigger `player_sport_guard`): las categorías, posiciones e historia del jugador son de ese deporte; otro deporte es otro jugador. Al dar de alta, la rama `(sport, sex)` tiene que estar habilitada.
- **Posiciones en `player_position`** (jugador, posición, `sort_order`; la de orden 0 es la principal; únicas por jugador), con hasta 5 por jugador en el contrato. Reemplaza a `player.position_id` (se migra como principal). Es un atributo actual, no historia: editar la ficha reemplaza las filas, así que es la segunda tabla del club con `DELETE` planificado (después de `drill`), para `coach`, `sc` y la administración dentro de sus jugadores.
- **Altura de los padres en `player_parent_height`** (jugador, `mother` / `father`, `height_cm`, origen `measured` / `reported`), una fila por padre. Reemplaza a las columnas del jugador (se migran). Su RLS sigue a la matriz: escriben `parent` (solo `reported`, `CHECK` de la política), `sc` y la administración; lee el alcance de datos del jugador y la API restringe la lectura a `parent_height.read`. Una medida no la pisa un informe del tutor (`409`), y reemplazar una altura cargada exige su `version`.
- **Baja con motivo:** `left_on` (último día, inclusivo), `left_reason` (`graduated`, `transferred`, `quit`, `other`, vocabulario del dominio), `left_note` opcional y `archived_at`, consistentes por `CHECK` (`player_leave`). Las bajas existentes quedan con motivo `other`. Solo la administración registra o deshace una baja (trigger `player_leave_guard` para el rol de la app, además de la matriz).
- **Coherencia de deporte** (trigger `player_sport_matches`, `SECURITY DEFINER`): una pertenencia a categoría y una posición tienen que ser del deporte del jugador. La API lo valida antes (`400`); el trigger es la segunda barrera.
- **RLS de `player`:** el `UPDATE` pasa a `coach`, `sc` y la administración dentro de sus jugadores, como la matriz; el `INSERT` sigue siendo de la administración.
- Los vocabularios `DOMINANT_SIDES`, `HEIGHT_SOURCES`, `PARENTS` y `PLAYER_LEAVE_REASONS` pasan al dominio (los usan los contratos); los enums de Postgres salen de ahí.

### Endpoints (`/v1/players`, tag `players`)

- **Lectura:** la ficha la leen la administración (todo el club), `coach` / `sc` / `medical` en sus asignaciones (mismo criterio que `app.visible_player_ids`: categoría vigente asignada o de un deporte asignado), el jugador la suya y el tutor la de sus tutelados menores. El tutor la lee por `player_summary` (la ficha resumida de la matriz): mismos datos de plantel, sin rankings ni resultados. La lista es un plantel, no un ranking: no tiene condiciones de etapa. Filtros `categoryId` (vigente), `sport`, `sex`, `status` (sin baja por defecto) y `q` (nombre y apellido); orden `name` (apellido y nombre), `birthDate`, `joinedOn`, `createdAt`.
- **Alta** (`POST`, administración), idempotente por `clientUuid`, con posiciones y categoría inicial opcionales (desde el día de alta, por defecto hoy en la zona del club). Fechas en el futuro: `400`.
- **Edición** (`PATCH` con `version`): nombre, fecha de nacimiento, sexo (dentro de una rama habilitada), lado dominante, posiciones (reemplaza la lista) y fecha de alta. Una fecha de alta posterior al inicio de alguna pertenencia a categoría es `409`: se corrige la pertenencia primero. El `UPDATE` siempre toca la fila del jugador, así la `version` cambia también cuando solo cambian las posiciones.
- **Baja** (`POST …/archive`, administración) con `leftOn` (hoy o antes) y motivo: cierra las categorías vigentes al día siguiente (`valid_to` exclusivo), con lo que el entrenador deja de verlo; una pertenencia que empieza después de la baja es `409`. **Restaurar** (`POST …/restore`) deshace la baja con la fecha de alta original y no reabre categorías.
- **Pases de categoría** (`GET` / `POST …/categories`, `PATCH …/categories/{id}`): administración (autoriza `category.manage` sobre la categoría, además de la ficha). Un pase entra a la categoría desde `validFrom` y cierra ese día las vigentes, salvo `keepCurrent` (juega en dos). La categoría tiene que estar activa y ser de la rama del jugador (deporte y sexo): no hay categorías mixtas, la categoría es de una rama (ADR 0017). Corregir el sexo del jugador no mueve sus categorías vigentes: la administración hace el pase a una de la rama nueva; no se superponen dos pertenencias a la misma categoría ni se cierra una el mismo día que empieza (`409`). El `PATCH` corrige fechas o cierra; la categoría no cambia, y con el jugador de baja es `409` (la baja cerró sus categorías y restaurar no las reabre). Un reintento con el mismo `clientUuid` devuelve la fila original aunque la categoría se haya archivado después. Las operaciones del mismo jugador (pases, baja, restauración, cambio de fecha de alta) se serializan con `pg_advisory_xact_lock` y releen al jugador con el lock tomado. El pase masivo de temporada es B-316 y usa la misma tabla.
- **Altura de los padres** (`GET …/parent-heights`, `PUT …/parent-heights/{parent}`): `parent_height.read` / `report` de la matriz con los hechos del jugador (consentimientos vigentes y mayoría de edad en el día del club). Entre 120 y 230 cm.

## Alternativas descartadas

- **Deporte derivado de la categoría vigente.** Un jugador sin categoría (recién dado de alta, o dado de baja) no tendría deporte para la matriz ni para validar posiciones.
- **Una sola posición en el jugador más una lista de secundarias.** Dos fuentes para lo mismo; con orden en una sola tabla la principal es la de orden 0.
- **Altura de los padres en columnas del jugador, con la escritura del tutor por una función `SECURITY DEFINER`.** Funciona, pero la política de la tabla del jugador dejaría de expresar quién escribe qué; una tabla con su propia RLS lo dice en el catálogo y lo prueban los tests de RLS.
- **Historial de cambios (ADR 0030) en las tablas del plantel.** El historial es de datos cargados (resultados, sesiones, mediciones) y exige motivo para corregir; pedirle motivo al tutor que corrige una altura agrega fricción sin ganancia. `updated_by` / `updated_at` quedan en cada fila.
- **Períodos de alta y baja en una tabla aparte.** Un jugador que vuelve al club recupera su ficha con `restore`; la historia comparable está en `player_category` y en los resultados, no en los períodos de socio.

## Consecuencias

- B-316 (pase de temporada) escribe `player_category` con las mismas reglas: una pertenencia por categoría sin superposición, del deporte del jugador.
- Khamis-Roche (B-203) lee `player_parent_height`; puede preferir la medida y avisar cuando la altura es informada.
- Las referencias y percentiles por posición (B-208, B-321) toman la posición principal (`sort_order = 0`).
- El vínculo del jugador con su usuario y los tutores (B-310), la confirmación del adulto para mantener al tutor (B-311) y los consentimientos (B-312) siguen en sus issues; hasta B-311 un tutor no ve a un jugador mayor de edad.
- Un jugador que cambia de deporte se da de alta otra vez; su historia anterior queda en la ficha original.
