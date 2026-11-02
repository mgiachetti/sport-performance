# 0036. Calendario: temporadas como año de planificación, ventanas sin superponerse y fixture propio

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #48 (B-317)

## Contexto

B-317 pide temporada por deporte, ventanas V1 a V4 con fechas, días de test programados y partidos. El esquema base ya tenía `season`, `test_window` y `test_session`, pero sin endpoints, sin archivado y sin reglas entre filas. Faltaban varias decisiones. CLAUDE.md dice "temporada marzo–octubre", pero la V1 es en febrero y la V4 en noviembre. Había que garantizar que las ventanas no se superpongan. Había que decidir quién gestiona cada parte. Y los partidos no tenían dónde guardar rival, condición (local o visitante) ni competencia: `training_session` de tipo `match` (B-318) es el partido jugado, con participación y carga, y no el fixture que se planifica meses antes.

## Decisión

- **La temporada es el año de planificación del deporte** y contiene sus cuatro ventanas (por ejemplo, de febrero a noviembre). La competencia de marzo a octubre es el fixture. Dura hasta 366 días (`SEASON_MAX_DAYS` del dominio y `CHECK season_max_length`). Las temporadas **activas** de un deporte no se superponen. Lo garantiza una restricción de exclusión (`season_no_overlap`: `club_id`, `sport` y `daterange(starts_on, ends_on, '[]')`, con `WHERE archived_at IS NULL`). Así, un día del club cae en a lo sumo una temporada por deporte, y la temporada de un partido se deriva de su fecha (no se guarda).
- **Las ventanas** (1 = V1 … 4 = V4, número único por temporada, también entre las archivadas) van dentro de su temporada, sin superponerse y en orden: V2 después de V1. La superposición la garantiza la base (`test_window_no_overlap`). La contención y el orden los valida la API con `testWindowProblems` del dominio. Para que esas reglas entre filas no tengan carreras, toda escritura del plan de una temporada (sus fechas, sus ventanas y los días de test en ellas) toma un **lock de advisory por temporada** (`pg_advisory_xact_lock`). No se usa `FOR UPDATE` porque el `sc` escribe ventanas sin poder actualizar la fila de la temporada. Una ventana no se achica si deja afuera días de test programados o en curso, y una temporada no se achica si deja afuera ventanas activas.
- **`btree_gist`** se instala en un esquema propio `extensions` (sin `USAGE` para `PUBLIC`): `public` queda solo con objetos nuestros. Una violación de exclusión (`23P01`) se responde `409 conflict` como la de unicidad.
- **Archivar, no borrar** (ADR 0032): `season.archived_at` y `test_window.archived_at`. Una temporada archivada sale del plan y libera sus fechas. Restaurarla con superposición es `409`. En una temporada archivada no se planifican ventanas.
- **Permisos.** Nuevo recurso `season` (`target: club`) en la matriz. `read` lo tiene todo miembro: el marco del calendario no tiene datos personales, y el invariante de privacidad lo nombra junto a `club` y `metric_catalog`. `manage` (temporadas) es de la administración. `plan_windows` (ventanas) es de la administración y del `sc` (como la RLS de `test_window`). Los días de test usan `test_session` (el `sc` de la categoría) y el fixture usa `training_session` (el entrenador de la categoría), que ya existían.
- **Días de test programados**: siempre de una categoría (el deporte sale de ella). `category_id` sigue siendo nullable para históricos importados, que solo ve el alcance de todo el club. La ventana es opcional. Si se elige una, tiene que estar activa, ser del mismo deporte y contener el día. Reprogramar cambia un dato ya cargado: lo registra el historial de cambios y pide `changeReason` (ADR 0030). Solo se reprograma o suspende un día `scheduled`. Empezarlo y cerrarlo, con los resultados, es B-320.
- **Fixture en su tabla `fixture`**: categoría, rival, `venue` (`home`, `away` o `neutral`), competencia, día y hora de inicio **en la hora local del club** (`match_date` + `kickoff_time` al minuto, `NULL` mientras no está confirmada), lugar, estado (`scheduled`, `postponed` o `cancelled`), notas y archivado. El instante (`startsAt`) no se guarda: se calcula al leer con la zona horaria actual del club. Así nunca contradice lo que dice el fixture, y los saltos de horario de verano los resuelve Postgres. RLS con `secure_club_table`: la lee todo miembro y la escriben coach, sc y admin (la matriz lo limita al entrenador de la categoría y a la administración), sin `DELETE`.
- **Calendario de una categoría** (`GET /v1/calendar`): incluye las ventanas de las temporadas activas del deporte que se cruzan con el rango, los días de test de la categoría y sus partidos activos. El rango va hasta 366 días. Las claves salen de un `UNION ALL` paginado con el mismo `keysetPage` (orden por día y desempate por id), y cada página se lee con las columnas de cada recurso. Cada tipo entra si el rol puede leerlo.

## Alternativas descartadas

- **Temporada de marzo a octubre y ventanas fuera de ella.** Una V1 de febrero no pertenecería a ninguna temporada, o pertenecería a la anterior, y los informes por ventana (B-4xx) no sabrían a qué año comparar.
- **Validar la superposición solo en la API.** Dos altas concurrentes la pasarían. La exclusión es la garantía y la API da el mensaje con el campo.
- **Partidos como `training_session` con columnas nuevas.** Mezclaría el plan (meses antes, se posterga y se suspende) con el registro de lo jugado (participación, minutos, carga), y #49 es dueño de esa tabla. El vínculo partido ↔ sesión jugada lo agrega B-318.
- **Guardar `starts_at` del partido.** Quedaría desfasado si cambia la zona del club o la hora, y obligaría a mantener dos fuentes de verdad.

## Consecuencias

- La web (#69) y la app muestran el calendario de una categoría con una sola lista paginada.
- B-318 puede enlazar una `training_session` de tipo `match` con su `fixture`. B-320 corre los días de test que programa este issue.
- Los informes por ventana (B-4xx) encuentran la temporada de un día sin ambigüedad.
