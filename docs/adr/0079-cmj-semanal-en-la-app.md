# 0079. CMJ semanal en la app: resultados fuera del día de test por la cola, base de la regla `cmj_drop` calculada con la función del motor y lecturas guardadas en la base local

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #84 (B-506)

## Contexto

En M17/M19 el bienestar se completa con un CMJ semanal (CLAUDE.md, "Etapas": `STAGE_PROFILES.performance.weeklyCmj`), fuera de las ventanas de test, para ver la caída de cada jugador contra su propia base. El motor de alertas ya tiene la regla `cmj_drop` (amarillo si el CMJ queda más de 7 % por debajo de la base, editable por club): la base es el promedio del mejor salto de cada día en los 42 días anteriores, con al menos 3 días, y solo con el método del último salto (principio 4, `cmjMeasurementsForAlerts`).

B-506 pide el flujo rápido en el celular: el preparador físico elige la categoría, cada jugador salta tres veces y la app dice al instante cómo quedó contra su base. Tiene que andar sin señal (principio 5; la cancha o el gimnasio no siempre tienen) y escribir por la cola de ADR 0069. Faltaba decidir qué se guarda, cómo se lee el plantel sin conexión, de dónde sale la etapa de cada jugador, cómo se calcula la base que se muestra sin duplicar la del motor, y cómo se corrige un intento.

## Decisión

- **Quién y dónde:** pantalla `weekly-cmj` abierta desde Inicio por quien puede cargar resultados (`test_result.record` de la matriz: `sc` y la administración). El resto no la ve; si llega por link ve un aviso sin datos.
- **Un resultado de test sin día de test:** cada jugador tiene, por día del club, un resultado del test `cmj` con la versión vigente del protocolo del catálogo (`/v1/catalog/tests`), **sin `testSessionId`**, con `measuredOn` = hoy en la zona horaria del club, método de la sesión (`app` o `manual`; el video es B-604) y evaluador = quien carga. Es `test_result.create` de la cola, con `clientUuid` del resultado y de cada intento, número de intento y `recordedAt`. Los intentos siguientes del mismo día y método van al mismo resultado (`test_result.add_entries`, por `id` o por el `clientUuid` del alta); un salto con otro método es otro resultado, nunca se mezclan. Un intento mal cargado se **anula** con motivo (`test_result.void_entries`), no se edita (append-only, ADR 0015 / 0030). El servidor aplica las mismas reglas que en línea (consentimiento, batería de la etapa, asignaciones).
- **Qué se tipea:** la altura en cm (lo que muestra una app de salto) o el tiempo de vuelo en ms (entrada `cmj_flight_time`; el servidor calcula `h = g·t²/8`). Coma decimal es-AR (`parseNumber`), mayor que cero; fuera del rango plausible del dominio para el sexo se pide "Guardar igual". El método y el modo se guardan en el teléfono por membresía.
- **Lecturas guardadas en la base local (`cached_read`):** lo que no es una colección sincronizada se guarda como un documento JSON por membresía y clave en `cached_read` de la base local cifrada, por `services.readCache` (ADR 0074; la misma tabla y el mismo `ReadCache` de la app del jugador y del día de test en cancha, ADR 0076; cerrar sesión lo borra con el resto del club). Se escribe solo mientras esa membresía sigue siendo la de la sesión (una descarga que termina después de cerrar sesión no escribe nada) y se valida con su contrato al leerla (un documento que ya no cumple es un faltante, nunca un error). No suma una migración local: hay un solo mecanismo. El CMJ semanal guarda:
  - `weekly_cmj:setup`: zona horaria del club, categorías activas (con su etapa por defecto), el test `cmj` del catálogo (id de la versión, intentos, agregación) y las reglas `cmj_drop` del club;
  - `weekly_cmj:roster:<categoría>`: los jugadores de la categoría leídos del **panel semanal** (`/v1/panel/weekly?categoryId=`), que ya trae la **etapa vigente** (maduración + categoría, ADR 0059) y la disponibilidad derivada **sin la causa** (ADR 0029). Se guardan solo nombre, sexo, deporte, etapa y disponibilidad;
  - `weekly_cmj:settings`: método, modo y categoría elegidos.
  Con señal, al abrir la pantalla se actualizan el setup y los planteles de las categorías cuya etapa por defecto lleva CMJ semanal (y la elegida), así quedan listos para usar sin señal; "Actualizar plantel" lo repite. La pantalla dice cuándo se guardó el plantel.
- **A quién se lista:** solo los jugadores cuya etapa vigente tiene `weeklyCmj` (`performance`); los demás de la categoría se cuentan sin datos. Un jugador "No disponible" o "limitado" se marca (ícono + texto) y se puede cargar igual: el staff decide.
- **La base es la del motor, no una copia:** el dominio exporta `cmjRollingBaseline(measurements, date, params)` (mejor salto por día, ventana antes del día, mínimo de días) y `alertRuleAppliesTo(rule, subject)`; el motor (`evaluateCmjDrop`) usa esa misma función. La app toma la primera regla `cmj_drop` activa que aplica al jugador (deporte, sexo, etapa), muestra antes del salto la base con el **método de la sesión** (o "sin base todavía: N de M días") y cuántos días de la ventana se midieron con otro método (no se comparan). Después del salto el veredicto sale de `evaluateAlertRules` con la regla del club y `cmjMeasurementsForAlerts` sobre la historia + hoy: bien / atención / crítico, siempre con ícono y texto y la aclaración de que es una heurística de carga, no un diagnóstico. Sin regla para ese jugador se dice; la base se sigue mostrando con la ventana por defecto.
- **La historia sale de la base local:** los resultados `cmj` hechos (`done`) de la colección sincronizada `test_result` de la ventana más larga de las reglas, con las ediciones de la cola superpuestas por el store, más las altas de la cola que todavía no volvieron con sus intentos y anulaciones posteriores. La altura de cada resultado se recalcula con sus intentos válidos y la agregación del protocolo (las mismas funciones del dominio que usa el servidor), así un intento anulado sin señal ya no cuenta. Cada jugador muestra "Sin enviar / Enviado / Guardado" según la cola.

## Alternativas descartadas

- **Un endpoint propio de "CMJ semanal".** Duplicaría las reglas de carga de resultados (consentimiento, batería, asignaciones, idempotencia) que `test_result.create` ya tiene, y no pasaría por la cola.
- **Un día de test semanal.** Los días de test son la batería de una ventana (V1–V4) con su planilla; crear uno por semana llenaría el calendario y mezclaría el seguimiento con las ventanas.
- **Recalcular la base en la app con otra fórmula.** Dos fórmulas terminan divergiendo; mostrar una base que no es la que dispara la alerta confunde al staff.
- **Leer la etapa de la categoría.** La etapa sigue a la maduración (un M16 maduro puede estar en `performance`); el panel ya la trae calculada.
- **Guardar el plantel en el almacenamiento seguro o en AsyncStorage.** El almacenamiento seguro no es para documentos que crecen con el plantel y AsyncStorage no está cifrado; la base local ya está cifrada (SQLCipher), atada a la membresía y se borra al cerrar sesión.
- **Fijar a mano la base de un jugador.** El motor la admite (`baselineHeightCm`) pero no tiene dónde guardarse en el servidor todavía; queda para cuando exista.

## Consecuencias

- El panel semanal es la fuente del plantel con etapa: si cambia su contrato, cambia el documento guardado (se valida al leerlo y uno viejo se vuelve a descargar).
- Con varios teléfonos sin señal puede haber más de un resultado del mismo jugador ese día; la app muestra el mejor y avisa, el servidor los guarda todos y la alerta usa el mejor del día.
- Lo que el staff cargó aparece en el panel, la ficha del jugador y las alertas como cualquier resultado de CMJ, con su método.
