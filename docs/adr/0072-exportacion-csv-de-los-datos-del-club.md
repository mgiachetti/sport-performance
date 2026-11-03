# 0072. Exportación CSV de los datos del club: pedido con alcance fijado en la API, ZIP generado por el worker y guardado en el bucket

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #97 (B-608)

## Contexto

B-608 pide exportar en CSV "todos los datos del club": el preparador físico y la administración quieren analizar tests, carga, bienestar y maduración en una planilla, o llevárselos a otra herramienta, con las mismas métricas y definiciones que usa la plataforma.

Ya estaba decidido:

- el derecho de acceso de un jugador (ADR 0051): JSON en la respuesta, generado por la base. El propio ADR deja la entrega asíncrona a un archivo como la forma final para historias grandes;
- los archivos van al bucket con la tabla `file`, URLs firmadas y retención por tipo (ADR 0044);
- el worker con pg-boss, sin grants de la API sobre la cola, y avisos por `pg_notify` con un barrido de respaldo (ADR 0046);
- los datos de salud solo se leen por funciones auditadas del esquema `medical`, que el worker no alcanza; el resto ve la disponibilidad, nunca el motivo (ADR 0029);
- los formatos es-AR (ADR 0019) y la matriz de permisos (ADR 0025).

Faltaba decidir:

- quién exporta y qué alcance tiene;
- si se genera en la API o en el worker;
- qué contiene, en qué formato y cómo se entrega;
- qué pasa con los datos de salud, los consentimientos y la supresión de un jugador incluido.

## Decisión

### Quién y qué alcance

- **Nuevo recurso de la matriz `club_data_export`** (destino `category`), con dos acciones:
  - `run`: la administración, todo el club; el preparador físico (`sc`), sus categorías asignadas. Las dos con consentimiento de **datos** vigente del jugador, fila por fila, igual que `data_export`;
  - `read`: la administración, todas las del club; `sc`, las suyas.
  - Nadie más. El entrenador ve el panel; el staff médico, su módulo. El superadmin de soporte no saca datos de un club (como en el ADR 0051).
- **El alcance se fija al pedir, en la API, con el contexto de quien pide:**
  - la API lee los jugadores que la RLS le muestra y los pasa uno por uno por la matriz (`decide`) con sus hechos (categorías vigentes, consentimientos);
  - guarda la lista (`player_ids`) y cuántos quedaron afuera **por falta de consentimiento** (`excluded_players_n`, sin nombres);
  - el worker exporta esa lista. Así el worker, que ve todo el club, no reinterpreta permisos, y la matriz se evalúa en un solo lugar.
  - **Una sola excepción: el consentimiento de datos se vuelve a mirar al generar**, en la misma foto de la que salen los CSV. Si se revocó entre el pedido y la generación, el jugador queda afuera y se cuenta con los excluidos por falta de consentimiento. No reinterpreta la matriz: solo achica la lista.
  - **Un ZIP ya listo no se retira por una revocación.** Es una copia tomada con el consentimiento vigente, para el staff que la pidió, y vence a los 7 días. La revocación vale desde ese momento (como en el resto de la plataforma, no retroactiva); la supresión, en cambio, sí borra el ZIP (abajo).

### Generación en el worker

- **Elegido: un job del worker** (`data-export-club`, un job por club con política `stately`, reintentos con backoff y cola de muertos). La API solo registra el pedido (`202`, `queued`). Años de carga diaria de un club grande son cientos de miles de filas: no entran en los timeouts de un request (ADR 0031), y un ZIP de cientos de MiB no pasa por la API.
- **Tabla `club_data_export`** (migración `0037`):
  - qué se pidió: conjuntos, rango de días, día del club del pedido;
  - el alcance fijado y la foto de la disponibilidad;
  - estado `queued` / `running` / `ready` / `failed`, intentos, código de error y filas por conjunto;
  - el ZIP, por clave compuesta a `file`.
- **RLS:** la administración lee todas; `sc`, las propias. La API solo inserta como sí misma, en `queued` (política de `INSERT` y grant solo de `INSERT`); solo el worker cambia el estado.
- **Del pedido al job:** un trigger hace `pg_notify('sport_performance_data_export', club_id)` al commit, y el worker lo escucha (el mismo listener del ADR 0046, ahora con el canal como parámetro). Un cron por minuto (`data-export-sweep`) y el arranque encolan los clubes con exportaciones pendientes por `app.worker_data_export_clubs()` (solo ids, solo el worker), por si se perdió el aviso.
- **Una corrida:**
  1. **Toma** la exportación más vieja pendiente: `queued`, o `running` hace más de 30 minutos (un worker que murió). Lo hace en su propia transacción con `FOR UPDATE SKIP LOCKED`, y cuenta el intento.
  2. **Lee** todo en una transacción `REPEATABLE READ READ ONLY`: todos los CSV salen de la misma foto. Cada conjunto se lee con un cursor (`DECLARE … FETCH 2000`), así la memoria no crece con el club.
  3. **Escribe** el ZIP (fflate, deflate) en un archivo temporal, calculando el SHA-256 y cortando si pasa el máximo del tipo.
  4. **Registra** la fila de `file` `pending` (vence en 24 h) **antes** del `PUT`: un objeto que llegó al bucket siempre tiene su fila.
  5. **Sube** con `ObjectStorage.putObject` (nuevo en `packages/storage`: `PUT` del servidor con tamaño y SHA-256 que el bucket verifica, reintentos con un stream nuevo).
  6. **Cierra** en una transacción: el archivo y la exportación pasan a `ready` juntos, y la foto de disponibilidad se borra.
- **Fallas:**
  - una corrida que falla deja la exportación `queued` mientras le queden intentos (3), y el job se reintenta con backoff;
  - una corrida que descarta el ZIP porque la lista se achicó (una supresión) no es una falla: la vuelve a encolar y devuelve el intento, así varias supresiones seguidas no la terminan en `failed`;
  - después del último intento queda `failed` con un código sin datos personales: `generation_failed`, `storage_unavailable`, o `too_large` (este último sin reintentar);
  - el ZIP que haya quedado se marca borrado y lo purga la retención.
- **Sin bucket** la API responde `503` al pedir y el worker no levanta el job (como la retención, ADR 0046).

### Qué contiene y en qué formato

- **Un ZIP** (`datos-<club>-<aaaa-mm-dd>.zip`) con un CSV por conjunto (se pueden elegir; por defecto todos):
  - `jugadores.csv`: ficha, categorías y posición vigentes, etapa y disponibilidad del día del pedido;
  - `categorias_jugadores.csv`: historia por temporada, con el "hasta" inclusive;
  - `antropometria.csv`: medidas y maduración con la ecuación usada;
  - `tests.csv`: una fila por valor válido, con versión del protocolo, método, evaluador, equipo, ventana y si es importado; una fila por resultado no realizado. Un resultado realizado con todos sus valores anulados no sale: no le queda dato, y la métrica vacía se leería como no realizado;
  - `bienestar.csv`, con la media móvil propia y el z-score;
  - `participaciones.csv`;
  - `carga_diaria.csv`: sRPE, EWMA, ACWR con estado, monotonía y strain;
  - `metricas_cancha.csv`: códigos canónicos, nunca "PlayerLoad";
  - `gimnasio.csv`;
  - `metricas.csv`: el diccionario de métricas con los alias de Catapult.

  Además, siempre, `diccionario.csv` (cada columna con tipo, unidad y definición) y `manifiesto.csv` (formato `sport-performance.club-data-csv` versión 1, club, quién pidió, rol, rango, jugadores incluidos y excluidos, filas por archivo).
- **El rango de días** filtra solo los conjuntos con fecha. La ficha, la historia de categorías y el diccionario de métricas van siempre enteros.
- **Formato es-AR para planillas:**
  - UTF-8 con BOM, `;` entre campos, CRLF, comillas RFC 4180;
  - coma decimal **sin separador de miles**: un CSV se vuelve a leer como número, y `1.234` sería otra cosa en una planilla o en `read.csv2`;
  - días `dd/mm/aaaa`; horas `dd/mm/aaaa HH:mm` en la zona del club;
  - `si`/`no`; vacío para lo que falta.
  - Encabezados en español `snake_case` con la unidad en el nombre (`talla_cm`).
  - Los valores de vocabularios cerrados (estados, métodos, métricas) van como código en inglés, el mismo del diccionario común con la primera.
  - Los números se escriben como están guardados; se redondean solo los derivados.
- **Inyección de fórmulas (CWE-1236):** un texto que empieza con `=`, `+`, `-`, `@`, tabulación o retorno lleva un `'` adelante. Los nombres, las notas y las condiciones los escriben personas. Los números y las fechas nunca son texto, así un offset negativo sigue siendo número.
- **Descarga:** `GET /v1/data-exports/{id}/download` firma un `GET` de minutos (ADR 0044) con `attachment` y el nombre del ZIP. El archivo es un tipo nuevo `data_export` de `file`: `application/zip`, hasta 2 GiB, lo escribe el servidor, `attachment`, **retención de 7 días** (son datos de menores fuera de las vistas de la plataforma; se piden de nuevo). La RLS de `file` muestra un ZIP a quien ve su exportación. Por los endpoints genéricos de archivos solo llega la administración.

### Salud, privacidad y supresión

- **El esquema `medical` nunca se exporta.**
  - La disponibilidad (entrenamiento y partido, sin el motivo ni las notas del bloqueo) se lee **en la API al pedir**, con `medical.availability` y el contexto de quien pide. La lectura queda en `medical.access_log` a su nombre, como cualquier otra.
  - Se guarda como foto en la exportación, que el worker borra al terminar. Así el worker sigue sin llegar al esquema `medical` (ADR 0029).
  - `test_result.not_done_reason = injured` sale como `unavailable` (`app.not_done_reason_for_viewer`), y su nota no sale.
- **Quedan afuera, con motivo:**
  - tutores y altura de los padres: datos de otras personas; la talla adulta predicha sí sale;
  - cuentas y emails;
  - consentimientos firmados;
  - archivos y videos;
  - historial de cambios, log de sincronización y notificaciones.
- **Supresión (ADR 0051).** Un trigger `BEFORE DELETE` sobre `player` (que solo borra `app.erase_player`):
  - borra los ZIP listos que incluyen al jugador (el archivo pasa a `deleted` y vence en el acto: lo escribió el servidor, no hay URLs de subida pendientes);
  - lo saca de la lista y de la foto de disponibilidad de toda exportación.
  - El orden importa con `READ COMMITTED`: primero actualiza (y bloquea) las exportaciones, y recién después, en otra sentencia con una foto nueva, borra los ZIP cuyos `file_id` devolvió. Si el worker está marcando una lista en ese momento, la supresión espera su commit y ve el ZIP que dejó; al revés, un ZIP que se confirma entre las dos sentencias quedaría listo con el jugador suprimido.

  Si una exportación se estaba generando, el worker compara al cerrar la lista con la que usó: si se achicó, descarta el ZIP y la vuelve a encolar sin ese jugador.

## Alternativas descartadas

- **Generar en la API y devolver el CSV en la respuesta** (como la exportación del titular). Sirve para un jugador, no para el club. Además ataría la duración al request y obligaría a pasar cientos de MiB por la API.
- **Que el worker aplique la matriz** con el rol de quien pidió. El worker no tiene usuario ni rol (ADR 0026); repetir el alcance en SQL del worker sería una segunda definición que puede divergir. La lista fijada al pedir es la que la matriz dio en ese momento.
- **Darle al worker una función del esquema `medical`** para la disponibilidad. Rompe el ADR 0029 (el worker no llega a salud) y la lectura quedaría a nombre de nadie. La foto al pedir queda auditada a nombre de quien pide.
- **Un CSV por archivo del bucket** (una descarga por conjunto). Diez descargas y diez filas de `file` por exportación; el ZIP es una sola descarga con su manifiesto.
- **Separador de miles en los números** (`1.234,5`). Es formato de pantalla: al reabrir el CSV con otra herramienta, el punto es ambiguo.
- **XLSX.** Pide una librería pesada y los CSV son el formato que leen todas las herramientas de análisis. Una planilla con varias hojas se puede sumar después sobre los mismos conjuntos.
- **Exportar también a los jugadores sin consentimiento de datos.** La exportación saca datos de menores de la plataforma: la regla es la de `data_export`, consentimiento vigente.

## Consecuencias

- **Pendientes:**
  - la web del staff necesita una pantalla para pedir una exportación, ver su estado y bajarla (queda para la administración y la configuración);
  - un aviso por notificación cuando está lista queda para una iteración de B-328 (hoy el cliente consulta `GET /v1/data-exports/{id}`).
- **Una tabla nueva con datos de jugadores** que el staff analiza tiene que sumar su conjunto en `apps/worker/src/exports/datasets.ts`, con sus columnas descritas (un test exige descripción, encabezados únicos y el filtro por club). Cambiar columnas de un conjunto existente sube `CLUB_DATA_EXPORT_FORMAT_VERSION`.
- **`packages/storage` suma `putObject`:** el servidor escribe objetos propios. Lo pueden usar también los informes PDF (B-602, B-603).
- **El tipo `data_export` de `file`** no se sube desde un cliente. Su RLS sigue a la de `club_data_export`. Quien puede leer el ZIP también puede borrarlo antes de tiempo por los endpoints genéricos: es una copia, borrarla no pierde datos y se puede pedir de nuevo.
- **Los pedidos son evidencia de qué datos salieron y quién los pidió.** No se borran; la lista de jugadores se achica con cada supresión.
