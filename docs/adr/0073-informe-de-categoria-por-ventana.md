# 0073. Informe de categoría por ventana: agregados del grupo con mínimo, instantánea en la API y archivo `category_report`

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #92 (B-603)

## Contexto

B-603 pide un informe por categoría y ventana de test (V1–V4) para el staff y la subcomisión del club: la evolución del grupo, el cumplimiento de la batería y la tasa de respuesta. Ya estaba decidido:

- el ADR 0071 dejó cómo se arma y se dibuja el informe del jugador: la API congela una instantánea versionada con las reglas de lectura y el worker la dibuja con pdfkit, sube el PDF con la fila `file` antes que el objeto, con reintentos y códigos de fallo sin datos personales;
- el ADR 0060 dejó el mínimo de 5 jugadores para un promedio de la categoría y que una versión del protocolo distinta es otra medición (principio 4);
- el ADR 0029 dejó que una lesión, para quien no es `medical`, es "no disponible";
- el ADR 0044 dejó los tipos de archivo con su sujeto, retención y permisos por tipo.

Faltaba decidir:

- qué muestra el informe y con qué reglas, si lo lee gente fuera del staff (la subcomisión);
- quién lo pide y quién lo lee;
- de quién es el archivo (no es de un jugador) y cómo lo ve quien lee el informe;
- cómo se cuentan la batería "cumplida" y la "tasa de respuesta", que no existían en ninguna pantalla.

## Decisión

### El mismo camino que el informe del jugador

- `POST /v1/categories/{categoryId}/reports` (`testWindowId`, `clientUuid` opcional) arma la instantánea en la transacción del pedido, con el contexto de quien lo pide (su RLS), la valida con `categoryReportContentSchema` (`formatVersion = 1`) y la guarda `pending`. Responde `202`.
- La ventana es de una temporada del deporte de la categoría, ninguna de las dos archivada, ya empezada (`404` si no existe, `400` si es de otro deporte, `409` si no empezó). Una categoría archivada no recibe informes nuevos (`409`).
- `GET /v1/categories/{categoryId}/reports` (cursor, más nuevos primero, filtro por ventana) y `GET /v1/category-reports/{id}`; el PDF se baja por `GET /v1/files/{id}/download`.
- **Un solo job para los dos informes.** `player-reports-club` toma los dos tipos por turno (uno del jugador, uno de categoría, …) mientras los dos tengan pendientes, con el mismo presupuesto por job (10): una cola larga de un tipo nunca deja esperando al otro un job entero. El mismo préstamo (`FOR UPDATE SKIP LOCKED`), los mismos intentos y los mismos códigos de fallo. El alta avisa por el mismo canal (`sport_performance_player_report`) y `app.worker_report_clubs()` lista los clubes con informes pendientes de las dos tablas. El pipeline es uno, parametrizado por tipo (tabla, columna del sujeto, tipo de archivo, esquema y renderer); la página del PDF (rayas del club, fuentes, tablas, pie) se comparte en `apps/worker/src/reports/layout.ts`.
- **El estado y los códigos de fallo** son los del informe del jugador (`player_report_status`, `PLAYER_REPORT_FAILURE_CODES`): es el mismo ciclo de vida.

### Contenido: solo agregados del grupo

El informe sale de la plataforma (se le entrega a la subcomisión), así que **nada en él baja a un jugador**: ningún nombre, id ni valor individual, ningún ranking, ningún dato de salud. Todo promedio o conteo de cambios necesita `CATEGORY_REPORT_MIN_PLAYERS` (5, el mínimo del ADR 0060); por debajo no se dice ni el valor ni cuántos son. Los conteos del plantel, de la batería y de las respuestas se dicen siempre, **sin mínimo**: son cuántos, nunca quién ni con qué valor, y el staff los necesita también en grupos chicos (un cumplimiento de la batería que se oculta por debajo de 5 no sirve para planificar la recuperación de los tests).

**Riesgo aceptado de los conteos sin mínimo.** En una categoría chica, o en un test que la batería programa para pocos jugadores, un "No disponible: 1" en el PDF que llega a la subcomisión puede dejar adivinar a quién se refiere (quien sabe quién está lesionado). Se aceptó porque el informe nunca dice por qué (una lesión es siempre "no disponible", igual que en la disponibilidad que ve el entrenador) y no nombra a nadie; la lista nominal no sale del staff. Si un club lo pide, la alternativa es agrupar los motivos ("sin hacer") cuando `expected` está por debajo de `CATEGORY_REPORT_MIN_PLAYERS`, como regla del informe (no de la UI).

- **Plantel:** jugadores de la categoría al cierre de la ventana (o hoy, si sigue abierta) y cuántos hay por etapa.
- **Cumplimiento de la batería:** por cada test que la batería del club (`resolveBattery`, la misma lectura que la planilla del día de test, ADR 0068) programa en esa ventana para la etapa de cada jugador del plantel:
  - `expected`: a cuántos les tocaba (columna "Esperados" del PDF, aparte de "Hechos" con su porcentaje);
  - `done`: cuántos tienen un resultado hecho en la ventana;
  - `notDone` por motivo del **último** registro sin hacerlo (ausente, no disponible, no corresponde a la etapa, otro). Una lesión es siempre "no disponible";
  - `noRecord`: cuántos no tienen ningún registro.

  Un resultado "es de la ventana" con la regla del informe del jugador: el día de test de la ventana, o sin ventana con la fecha dentro de ella.
- **Evolución del grupo:** por métrica (y ejercicio), el promedio en la ventana y hasta 5 ventanas anteriores del deporte (`CATEGORY_REPORT_EVOLUTION_COLUMNS = 6`), siempre del **plantel actual**: muestra cómo evolucionó este grupo, no a otros jugadores que pasaron por la categoría.
  - Un valor por jugador, como los grupos de percentiles: el mejor según el sentido, o el último día en métricas neutras.
  - Una serie por test, métrica y ejercicio: dos tests con el mismo código de métrica no se mezclan.
  - Cada columna lleva sus métodos y versiones del protocolo; el PDF avisa cuando el promedio de una columna mezcla (principio 4). Si el promedio no se muestra (menos del mínimo), tampoco el aviso: no hay número que advertir.
  - **Cambio contra la ventana anterior con resultados:** cuántos mejoraron, empeoraron o quedaron igual, contando solo los pares con **el mismo método y la misma versión del protocolo** en las dos ventanas (cada valor de un jugador sale de un solo método y una sola versión). Así, V1 toda manual y V2 toda con fotocélula no dan pares aunque ninguna columna mezcle métodos.
  - El cambio es siempre **hasta la ventana del informe**: si la métrica no tiene resultados en ella (por ejemplo, 505 o 30-15 en un informe de V2 de M13/M14, que los miden 2 veces por año), no hay cambio, en vez de contar uno entre dos ventanas anteriores.
  - La referencia de primera del plantel para el deporte y el sexo (`firstTeamReferencesOf` sin jugador: alcance `squad`).
  - **Solo en series sin ejercicio.** `reference_value` es por métrica, no por ejercicio: un e1RM de primera no dice de qué ejercicio es, y ponerlo junto a la banca y a la sentadilla a la vez compararía cosas distintas. Las series de fuerza por ejercicio salen sin referencia ("—" en la columna Primera) hasta que la referencia tenga ejercicio; agregarlo es un cambio de `reference_value` y de la ficha del jugador, no de este informe.
- **Tasa de respuesta:** del día siguiente al cierre de la ventana anterior de la temporada (o el inicio de la temporada) al cierre de esta (o hoy). Es el bloque de entrenamiento que la ventana evalúa.
  - Bienestar: un cuestionario esperado por jugador de la categoría ese día y día con sesión de la categoría (no archivada, ya empezada), salvo que todas sus participaciones de ese día sean ausente o no disponible; respondido si tiene bienestar ese día.
  - RPE: una por participación completa o parcial en una sesión de la categoría; respondida si tiene RPE.
  - Total y por semana ISO.

### Permisos

- **Recurso nuevo `category_report`** (alcance por categoría):
  - `read`: el staff asignado a la categoría (coach, sc, medical) y la administración;
  - `generate`: el `sc` asignado, la administración y el superadmin con su acceso de soporte.

  Nunca el jugador ni el tutor: es un informe del club sobre el grupo. La subcomisión no es un rol: el club le entrega el PDF.
- **RLS** (`category_report`, migración `0038_category_reports`):
  - lectura por categoría: `app.sees_whole_club()` o la categoría en `app.assigned_category_ids()`;
  - la API inserta como quien lo pide, `pending`, sin archivo ni intentos, y nunca edita;
  - el worker solo completa el resultado, por grants de columna;
  - un guard no deja cambiar la categoría, la ventana ni la instantánea, ni tocar un informe terminado, y exige que su archivo sea un `category_report` de la misma categoría;
  - nadie lo borra. No tiene datos de ningún jugador, así que la exportación y la supresión del titular (ADR 0051) no lo alcanzan.

### El archivo: tipo nuevo `category_report`

- **Tipo de archivo `category_report`** (ADR 0044): PDF, 20 MiB, sujeto `category` (nuevo: `category_id` obligatorio), retención de 365 días como el del jugador, `attachment`, sin subida de personas.
- `file_subject` compara el tipo como texto: un valor agregado a un enum no se puede usar como tal en la migración que lo agrega.
- **Quién lo ve:** la RLS de `file` lo muestra a quien ve su informe (`EXISTS` sobre `category_report`), como el ZIP de la exportación sigue a su exportación (ADR 0072). En la API, verlo y bajarlo pide `category_report.read` de su categoría; borrarlo antes de tiempo, `category.manage` (la administración).
- **Nombre de descarga:** "Informe M15 Temporada 2026 V2.pdf".

### Alcance de lo que se cuenta

La instantánea se lee con la RLS de quien la pide: el informe muestra lo que su autor puede ver, y queda guardado quién lo pidió. La administración ve todo el club. Un `sc` (o cualquier staff asignado) ve a los jugadores de las categorías que tiene asignadas **hoy**, con la categoría de **hoy** (`app.visible_player_ids()`); no ve a un jugador que estuvo en la categoría y hoy está en una que no tiene asignada. Para una ventana cerrada eso pasa seguido: una ventana de una temporada anterior (la API acepta cualquier ventana empezada de una temporada no archivada), o jugadores que cambiaron de categoría después del cierre. Esos jugadores faltan en el plantel, la batería y la evolución, y sus respuestas en la tasa: los números son menores que los de la administración para la misma categoría y ventana.

- **El informe lo dice.** `app.category_report_coverage(categoría, desde, hasta)` (SECURITY DEFINER, migración `0038`) responde si quien pide ve a todos los jugadores que estuvieron en la categoría algún día de `[desde, hasta]` (el período de la tasa de respuesta, que termina en el cierre del plantel). Responde solo un booleano (ni quiénes ni cuántos) y solo a la administración o al staff asignado a la categoría (`42501` para el resto). La instantánea guarda `scope.complete`; con `false`, el PDF abre con un aviso: quien lo pidió no ve a todos, los números pueden ser menores y el informe completo lo pide la administración.
- **No se rechaza ni se lee de más.** Rechazar (`409`) dejaría al `sc` sin el informe de las ventanas que más pide (las de la temporada anterior, para planificar); leer los datos de esos jugadores con una función SECURITY DEFINER abriría un camino que salta la RLS para resultados de jugadores que el `sc` hoy no ve. Limitar al `sc` a la temporada actual tampoco alcanza: un cambio de categoría a mitad de temporada deja el mismo hueco.

## Alternativas descartadas

- **Generalizar `player_report` con un jugador o una categoría.** Una tabla con dos sujetos opcionales pide políticas de RLS con `CASE`, un guard con dos ramas y una exportación del titular que filtre filas. Dos tablas con el mismo ciclo de vida y un pipeline común son más claras.
- **Rechazar con `409` o limitar al `sc` a la temporada actual el informe que no vería entero.** Ver "Alcance de lo que se cuenta": deja sin informe al `sc` y no cubre los cambios de categoría a mitad de temporada.
- **Un job y una cola nuevos.** Duplicaría el barrido, el canal, la cola de muertos y su configuración para el mismo trabajo; el presupuesto compartido alcanza (son pocos informes por club).
- **Reusar `pdf_report` para el archivo.** Su sujeto es un jugador: la retención por titular, la supresión y los permisos por jugador no aplican a un informe del grupo.
- **Listar a los jugadores que faltan.** Sirve al staff, pero el informe sale a la subcomisión: la lista nominal ya está en la planilla del día de test y en el plantel de la web.
- **Promedios de todos los que pasaron por la categoría en cada ventana.** Mezcla grupos distintos y no responde "¿cómo evolucionó este grupo?"; el plantel actual sí.
- **Tasa de respuesta sobre todos los días.** El bienestar se pide antes de entrenar: un día sin sesión no espera respuesta.

## Consecuencias

- La web (panel de la categoría, ventanas del calendario) y la app del staff suman "Pedir informe de la categoría" y la lista de informes sobre estos endpoints.
- Un cambio del contenido que un renderer anterior no sepa leer sube `CATEGORY_REPORT_FORMAT_VERSION`; el worker tiene que seguir dibujando las versiones anteriores mientras queden pedidos pendientes.
- La instantánea queda mientras exista la categoría: no tiene datos personales, así que no necesita la retención por titular del informe del jugador.
- `firstTeamReferencesOf` acepta un jugador `null` (referencia del plantel), y la planilla del día de test exporta su lectura de la batería (`batteryEntries`, `scheduledTests`, `byBatteryOrder`) para que el informe cuente lo mismo que la planilla programa.
