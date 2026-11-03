# 0061. Vista de sesión en cancha: una lectura acotada por sesión, totales por fuente y jugadores por la matriz

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #71 (B-408)

## Contexto

La pantalla 4 de la maqueta muestra una sesión en cancha: tarjetas de resumen (distancia media, HSR media, Vmax del día, contactos), una métrica por jugador en barras ordenadas y la tabla de métricas por jugador con las definiciones de la primera. Los datos están en `external_metric` (una fila por jugador, sesión, métrica y fuente, con bloque opcional), que hoy llena el club demo y después llenarán la importación de Catapult (#90, B-601), las bandas de FC (Fase 2) y el pod (Fase 3). La API no tenía ninguna lectura de esa tabla. Faltaba decidir:

- qué endpoint lee la web;
- qué es "el total de la sesión" cuando hay filas por bloque o más de una exportación;
- cómo se muestran dos fuentes de la misma métrica (principio 4);
- con qué permiso se ve a cada jugador, si la sesión es de una categoría y el jugador puede venir de otra;
- cómo encuentra el staff las sesiones que tienen datos.

## Decisión

- **Dos endpoints de lectura, en `packages/contracts/src/endpoints/field-sessions.ts`.**
  - `GET /v1/training-sessions/{id}/field-metrics` devuelve la vista de una sesión. Tiene la sesión, las columnas presentes (código, unidad, dirección y fuente) y, por jugador, el nombre, la posición principal con su línea, la participación (estado, minutos, contactos, RPE y sRPE) y los valores. También trae las referencias de primera del plantel de esas métricas.
  - Es un recurso acotado (los jugadores de una sesión, decenas), así que no se pagina: es un detalle, como la sesión con sus bloques (ADR 0032).
  - `GET /v1/field-sessions` es la lista por cursor (`-startsAt`, máximo 100) de las sesiones con al menos un valor de cancha visible. Cada sesión trae cuántos jugadores tienen datos, las fuentes y los códigos presentes. Los filtros son los de las sesiones (`sport`, `categoryId`, `kind`, `from`/`to`, `status`).
  - La agregación de la lista es un `JOIN LATERAL` por sesión sobre `external_metric`, nunca un recorrido de todo el club en el navegador.
- **Total de la sesión = fila sin bloque.** La fila con `drill_id` nulo es el total. Las filas con bloque (un período de OpenField) son su desglose y la vista no las suma: sumar períodos no da la Vmax ni los m/min del total. El importador (#90) escribe el total del activity como fila sin bloque.
- **Si una fuente escribió el mismo total más de una vez** (dos exportaciones con distinto `external_ref`), vale la última por `updated_at`, `created_at` e `id`. La unicidad de la tabla ya impide repetir la misma referencia.
- **Cada fuente es su propia columna.** Una métrica medida por Catapult y por el pod son dos columnas (`dist_m` · Catapult y `dist_m` · Pod), nunca un promedio.
  - Las columnas van en el orden del diccionario canónico (las del club al final) y, dentro de una métrica, en el orden de `FIELD_METRIC_SOURCES`, que pasa al dominio como vocabulario y que la base reusa para su enum.
  - La web avisa cuando hay métricas con más de una fuente. Las tarjetas de resumen salen de la primera fuente de la métrica y dicen cuál es.
- **Permisos en dos niveles.**
  - La sesión: `training_session.read` (staff en sus asignaciones, administración en el club). De otro club es `404`; fuera del alcance, `403`.
  - Cada jugador: `load_metrics.read` con sus propios datos (`loadPlayerFacts` + `can`). Los que el usuario no ve quedan afuera sin error, y las columnas que solo tenían esos jugadores también.
  - Así un jugador de M17 que jugó en el partido de la M15 no aparece para el entrenador de M15, igual que en la RLS (`external_metric` por alcance de jugador), que sigue de última barrera. En la lista, el conteo se hace bajo la RLS, que para estos roles coincide con la matriz.
- **Participación sin causa.** Del jugador se muestra el estado de su participación (`unavailable` = "no disponible") y nunca el motivo, que vive en el esquema `medical` (ADR 0008, ADR 0029).
- **Referencia de primera del plantel.** Para el deporte de la sesión y el sexo de su categoría, se elige con `selectFirstTeamReference` sin posición ni línea: la vigente el día de la sesión.
  - No se toman las de línea o posición porque el gráfico tiene una sola línea de referencia para todo el plantel.
  - Una sesión sin categoría no trae referencias.
- **Web.**
  - `/field-sessions` y `/field-sessions/$trainingSessionId` son hijas de `_club` y aparecen en la navegación con `training_session.read`.
  - El gráfico es el `BarChart` de `packages/charts`: backs en el color de la marca y delanteros en gris, con leyenda, solo cuando todos los jugadores con valor tienen línea de rugby; si no, un solo tono. La referencia de primera va punteada con etiqueta, sobre un solo eje y con tabla alternativa.
  - Las cuentas de la pantalla (columnas, tarjetas, barras) son funciones puras sobre esa única respuesta.
  - Si el módulo `gps` del club está apagado, la pantalla lo dice.
  - Los textos están en `web-field-session.ts`, con el prefijo `fieldSession.*`.
- **Datos de demo.** El club demo (ADR 0055) genera los totales de Catapult de las sesiones de rugby M17 y M19 (distancia, m/min, HSR absoluta y relativa, Vmax y % de Vmax, aceleraciones, desaceleraciones, carga acelerométrica y contactos) para quien participó, y prende el módulo `gps`.

## Alternativas descartadas

- **Armar la vista en el navegador con varias llamadas.** La web pediría `GET /v1/training-sessions/{id}`, la participación paginada y una lista de métricas por jugador, y cruzaría todo en el navegador. Son más pedidos, la autorización por jugador queda repartida y la regla del total y de la última exportación termina en cada cliente (web y mobile).
- **Paginar la vista de la sesión.** El conjunto está acotado por la sesión y la pantalla necesita a todos los jugadores para ordenar las barras y resumir.
- **Sumar las filas por bloque cuando no hay total.** Funciona para la distancia, pero no para la Vmax, el % de Vmax ni los m/min. El total lo da la fuente.
- **Una sola columna por métrica eligiendo la "mejor" fuente.** Esconde que hay dos métodos (principio 4) y cambia de método entre jugadores sin avisar.
- **Calcular `vmax_pct` y `hsr_rel_m` en la vista.** Mezclaría la Vmax del test (fotocélula) con la de la sesión (GNSS) sin decir nada. Las métricas relativas las trae la fuente (OpenField o el pod), que las calcula con su propia Vmax del jugador.
- **Mapa de calor de la cancha.** Necesita posiciones x/y por tiempo, que solo da el pod (Fase 3, crudo en storage por ADR 0005). Una métrica por jugador no alcanza para dibujarlo.

## Consecuencias

- El importador de Catapult (#90) escribe una fila sin bloque por jugador, métrica y activity, con `external_ref` estable. Los períodos van con `drill_id`, y la vista los toma cuando se agregue el desglose por bloque.
- Las bandas y el pod no cambian la pantalla: son otra `source` y otras columnas.
- La ficha del jugador y la app pueden reusar el mismo endpoint de la sesión.
