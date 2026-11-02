# 0053. Alertas: episodios por regla y jugador, eventos append-only y revisión del staff

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #58 (B-327)

## Contexto

El motor de reglas (ADR 0022) responde "¿esta regla dispara para este jugador este día del club?" y el worker (ADR 0046) ya mantiene las tablas derivadas que necesita (ACWR con días de historia, bienestar diario, velocidad de crecimiento) y dejó previsto que las alertas se enchufen como un paso del recálculo por jugador. El esquema base tenía `alert` con una fila por regla, jugador y día, y la API dejaba que cualquier rol del staff insertara o cambiara cualquier columna.

Faltaba decidir qué es una alerta guardada (un ACWR alto durante cinco días, ¿son cinco alertas?), qué días se evalúan y qué pasa con los datos que llegan tarde, cuándo una alerta deja de estar activa, cómo se acusa y se descarta, dónde queda el historial, qué dispara una evaluación cuando no cambia ningún derivado (un CMJ, una regla, la etapa), cómo se compara el CMJ sin mezclar métodos (principio 4) y qué le deja este issue a las notificaciones (#59).

## Decisión

- **Una alerta es un episodio** de una regla para un jugador: se abre el primer día del club en que la regla dispara (`local_date`), sigue mientras dispare (`last_seen_on`, severidad y valores del último día en `current_severity` y `values`) y se resuelve el primer día evaluado en que no dispara (`resolved_on`): dentro de los umbrales, no evaluable (sin datos, dato vencido, historia insuficiente), regla desactivada o fuera de alcance, o jugador dado de baja. A lo sumo un episodio activo por regla y jugador (`alert_active_key`, índice único parcial). `severity` es la más alta alcanzada y nunca baja. La transición es una función pura del dominio (`nextAlertEpisode`), con tests; el worker solo persiste lo que devuelve.
- **Se evalúa "hoy" en la zona del club, y los episodios solo avanzan.** Cada recálculo de un jugador (por el outbox o por la pasada diaria) evalúa sus reglas para hoy, en la misma transacción en que se escribieron sus derivados. Un día anterior al último que el episodio conoce se ignora: una reevaluación nunca reescribe historia que el staff pudo haber revisado. Los datos que llegan tarde igual cuentan: el CMJ de hace tres días o la talla de la semana pasada se ven hoy con su `observed_on`; el bienestar de un día que ya pasó deja de ser accionable. Una corrección del mismo día actualiza el episodio (escala o lo resuelve) y, si vuelve a disparar el día en que se resolvió, lo reabre en vez de abrir otro. Es idempotente: el mismo día con los mismos datos no escribe nada.
- **Escalar reabre la revisión.** Si un episodio acusado o descartado llega a una severidad mayor (amarillo → rojo), vuelve a `open` y se borra la revisión de la fila (queda en el historial).
- **Revisión del staff** (`alert.acknowledge` de la matriz): `acknowledged` (nota opcional) o `dismissed` (nota obligatoria: por qué no aplica), solo sobre una alerta `open`, con la `version` leída. La base lo hace cumplir: la API no inserta alertas y solo puede actualizar las columnas de la revisión (grants por columna); el trigger `alert_review_guard` solo le deja pasar de `open` a `acknowledged`/`dismissed`, una vez, con `acknowledged_by` = el usuario del request y la hora de la base.
- **Historial en `alert_event`**, append-only (sin `INSERT`, `UPDATE` ni `DELETE` para los roles de conexión y un guard que rechaza cambios también del dueño; solo la cascada de un jugador o alerta borrados lo saca). Lo escribe el trigger `alert_event_record` en la transacción de cada cambio, quien sea que lo haga: `raised`, `escalated`, `resolved`, `reopened`, `acknowledged`, `dismissed`, con día del club, severidad, nota y autor (`NULL` para el worker). `seq` ordena los eventos del club: es el cursor de las notificaciones (#59), que mandan lo nuevo después del último `seq` procesado.
- **Disparadores sin derivados nuevos.** `derived_refresh.alerts` marca a un jugador para evaluar sus alertas aunque no cambie ningún derivado (trigger `alert_refresh_trigger`): un resultado o intento del CMJ, una regla (marca a todo el club), la etapa (`player_stage`), la categoría (`player_category`) y el deporte del jugador. Las marcas existentes (carga, bienestar, maduración, baja) ya llevan a una evaluación, porque todo recálculo de un jugador evalúa sus alertas.
- **Pasada diaria.** El job horario por club (ADR 0046) suma a los jugadores cuyo último día evaluado (`player_alert_evaluation.evaluated_on`) es anterior a hoy: los activos y los que se fueron con alertas activas. Así un episodio se resuelve (o sigue) al cambiar el día aunque no haya datos nuevos. `player_alert_evaluation` guarda también las reglas salteadas con su motivo, para que el panel diga "historia insuficiente" en vez de "sin alertas".
- **Reglas inválidas fallan a la vista.** El worker valida cada regla con `parseAlertRule` (el mismo parser de la API); una editada a mano con un campo desconocido hace fallar el job (reintentos, cola de muertos, Sentry), como la configuración derivada inválida.
- **Entradas del motor**: ACWR y días de historia de `player_load_daily` del día; bienestar medio de `player_wellness_daily` (ventana de la regla de z-score); CMJ de `test_result_value` (`cmj_height_cm` del test `cmj`, puntaje del resultado con la agregación de su versión, intentos anulados fuera); velocidad de crecimiento de la última medición de `anthro_measurement` que la tiene; deporte y sexo del jugador y su etapa del día (la misma regla que la versión de ítems del bienestar). Solo se lee lo que necesita alguna regla activa.
- **Principio 4 en el CMJ**: la base solo usa mediciones con el mismo método que la última (`cmjMeasurementsForAlerts`); un día con dos métodos se queda con el del mejor salto.
- **Privacidad**: alertas, eventos y evaluaciones solo para el staff que ve al jugador (RLS con el alcance del jugador) y la administración; jugadores y tutores nunca (menores, principio 6). Las alertas no llevan texto de UI ni datos de salud: `kind`, `messageKey`, `suggestionKey` y `values` numéricos (media del bienestar, no los ítems).
- **Endpoints** (tag `alerts`, ADR 0032): `GET /v1/alerts` (cursor; filtros por jugador, categoría vigente, `state` activa/resuelta, estado de revisión, severidad, tipo y días; orden por día de apertura o último día), `GET /v1/alerts/{alertId}` (con su historial) y `POST /v1/alerts/{alertId}/review`.

## Alternativas descartadas

- **Una alerta por día** (el esquema base). Un ACWR alto toda la semana son siete alertas y siete avisos; una zona de pico de crecimiento serían 120. El staff acusa lo mismo todos los días.
- **Reconstruir los episodios de una ventana de días hacia atrás en cada recálculo.** Corregiría mejor un dato viejo, pero podría borrar o partir episodios ya acusados y notificados. Los episodios solo avanzan; el dato tardío se ve en la evaluación de hoy.
- **Escribir los eventos desde la API y el worker.** Cada camino tendría que acordarse; el trigger cubre a todos, igual que el outbox (ADR 0046) y el historial de cambios (ADR 0030).
- **Comparar el CMJ con todos los métodos y avisar.** Una alerta no tiene dónde mostrar el aviso de mezcla: con métodos distintos la caída no es comparable, así que no se calcula.

## Consecuencias

- Las notificaciones (#59) leen `alert_event` (`raised`, `escalated`, `reopened`) por `seq`, en el worker; nunca ponen el valor ni la regla de salud en el push.
- La base fijada por el staff para el CMJ (`baselineHeightCm` del motor) no tiene dónde guardarse todavía: se usa la base móvil. Se suma con su columna y su trigger cuando la configuración lo pida.
- Una regla nueva con `appliesTo` o un cambio de umbral reevalúa a todo el club en la próxima pasada del outbox.
- Los derechos del titular (#60) borran al jugador: las evaluaciones y los eventos se van en cascada; `alert` sigue con `ON DELETE RESTRICT` y el borrado tiene que sacarlas explícitamente.
- La web (B-403, B-404) muestra los episodios con `messageKey` / `suggestionKey` del catálogo y el historial; "historia insuficiente" sale de `player_alert_evaluation.skipped` (todavía sin endpoint propio).
