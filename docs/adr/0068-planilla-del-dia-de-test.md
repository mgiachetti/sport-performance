# 0068. Planilla del día de test: una lectura con estaciones, plantel y anterior; carga con la vista previa del dominio

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #68 (B-405)

## Contexto

La pantalla 3 de la maqueta ("Día de test") necesita, para un día de una categoría:

- qué tests se hacen (las estaciones);
- con qué versión del protocolo, cuántos intentos y qué se tipea en cada uno;
- el plantel del día;
- si cada test le corresponde a cada jugador según su etapa (principio 3);
- el resultado anterior de cada test;
- qué equipo usar en los tests que se comparan solo con el mismo equipo.

La API de B-320 carga resultados (ADR 0039), pero no exponía nada de esto como lectura. Las definiciones de test, la batería con sus ventanas, la etapa a la fecha y los equipos no tenían endpoint. Armarlo en el navegador con varias llamadas habría repetido en la web, y después en mobile (B-505), reglas que ya viven en la API y en el dominio: la batería más específica, la etapa por maduración o fijada, `testApplicability` y la versión vigente.

## Decisión

- **`GET /v1/test-sessions/{testSessionId}/sheet`** (planilla del día). Una sola lectura, con el mismo alcance que el día de test (`test_session:read` sobre la categoría, sobre la RLS). Trae:
  - el día y su ventana (`V1`–`V4`);
  - las **estaciones**: cada test que la batería vigente (`resolveBattery`, la entrada más específica) programa en la ventana del día para algún jugador del plantel, más los que ya tienen resultados en el día (`scheduled: false`). Si el día no tiene ventana, entran todos los tests de la batería. Antropometría queda afuera, porque es una medición propia. Van en el orden de la batería. Cada estación trae la **versión del protocolo vigente ese día** para el deporte (la mayor si hay varias): intentos, agregación, carga máxima, `sameDeviceOnly`, tipos de entrada que acepta, resumen, pasos, pausa, material, **parámetros** del protocolo y métricas con unidad, sentido y si son derivadas;
  - el **plantel**: los jugadores de la categoría ese día, más los que tienen resultados en el día. Solo entran los que quien pide puede leer (`test_result:read`, evaluado con `can()` sobre los datos del jugador). Para cada uno: su etapa ese día (`stageContextOn`), cómo se evalúa su fuerza (`strengthAssessmentFor`), si cada estación le corresponde con la misma regla que aplica la carga (`batteryIncludesTest` + `testApplicability`, con `not_in_battery` o `maximal_load_not_allowed`), si quien pide puede cargarle resultados (`recording`: `allowed`, `missing_consent` o `forbidden`, con `decide()` de la matriz) y su **resultado anterior** por test: el último `done` antes del día y de otro día que tenga método y algún valor válido (si el último no tiene, vale uno anterior), con su puntaje, método y versión;
  - los **equipos** vigentes del club (los no retirados).
- La carga sigue por los endpoints de B-320: el lote `POST /v1/test-sessions/{id}/results`, más `…/entries` y `…/void` para agregar o anular un intento de un resultado ya cargado. La planilla no escribe.
- **En la web** (`apps/web/src/test-day/`):
  - una estación se carga de una de las formas que acepta su definición. Se ofrecen parciales del sprint, tiempo de vuelo del CMJ en ms, última etapa del 30-15, serie de fuerza y valor por métrica. Los cuadros de video quedan para mobile. El sprint va siempre por parciales, para no perder la Vmax;
  - la **vista previa** (puntajes, derivadas como la asimetría del 505, mejor intento de cada métrica y avisos de rango plausible) se calcula con las mismas funciones puras del dominio que usa el servidor (`scoreTestEntry`, `scoreResultMetrics`, `deriveResultMetrics`, `aggregateAttempts`, `checkPlausibleValue`), con los parámetros del protocolo de la planilla. El servidor vuelve a calcular y decide;
  - cada fila guarda el `clientUuid` del resultado y de cada intento: un reintento manda los mismos y no duplica. Si un envío se guardó pero su respuesta no llegó, y la fila se editó antes de reintentar, el reintento vuelve `replayed` con el resultado del primer envío, sin los cambios: la web lo detecta (la fila guarda lo que mandó la primera vez) y avisa qué filas revisar, para agregar o anular intentos sobre el resultado guardado. Los problemas que detecta la web frenan el lote antes de mandarlo. Los `validation_failed` del lote vuelven a su fila por `body.results[i]`;
  - un test que no le corresponde al jugador se ofrece solo como «No corresponde a la etapa», y se guarda así con la estación, aunque nadie haya tocado la fila. Antes de guardar, la pantalla dice cuántos jugadores se van a registrar así;
  - el motivo `injured` revela un estado de salud (ADR 0029): todo rol que no sea `medical` lo ve como «No disponible», tanto en un resultado guardado como en las opciones del motivo. La API ya devuelve `unavailable` (y oculta la nota) con `app.not_done_reason_for_viewer`; la web aplica otra vez la misma regla del dominio (`notDoneReasonForViewer`) por si un resultado llega sin proyectar. El staff no médico sigue pudiendo marcar a un jugador como no disponible: elige «No disponible» y se guarda `injured`, así el staff médico ve que no lo hizo por una lesión. No hay un motivo `unavailable` aparte para cargar: sería el mismo dato con otro nombre y le sacaría al staff médico esa señal;
  - el aviso de «otro método» del resultado anterior compara contra el método del resultado ya guardado en el día, o contra el de la fila mientras se carga;
  - los textos de estas pantallas viven en `packages/i18n/src/messages/web-test-day.ts`, con claves `testDay.*`.

## Consecuencias

- La app de cancha (B-505) usa la misma planilla y no repite reglas. Para trabajar sin conexión la guarda en SQLite junto con el día.
- Una regla nueva de la batería o de la etapa cambia en la API y en el dominio; la web no la conoce aparte.
- La planilla es una lectura por día, con pocas consultas (plantel, etapas, batería, definiciones, anterior, equipos). Escala con el tamaño del plantel, no con el historial.
- Los equipos se pueden leer, pero todavía no se pueden dar de alta desde la API. Hasta que haya alta, los tests de mismo equipo (reacción) se cargan desde la app o con equipos cargados por la administración.
