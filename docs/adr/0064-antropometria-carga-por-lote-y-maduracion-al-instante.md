# 0064. Antropometría: carga por lote del día de mediciones y maduración al instante calculada por la API

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #75 (B-412)

## Contexto

`anthro_measurement` existía desde el esquema base (talla, talla sentado, peso, Σ de pliegues ISAK, método, evaluador, condiciones) y el worker deriva la maduración de cada medición (ADR 0046): offset de PHV con la ecuación usada, talla adulta predicha y % por Khamis-Roche con la tabla sembrada del club (ADR 0027) y velocidad de crecimiento, con `deriveMaturation` del dominio y los parámetros de `club.settings.derived`. No había endpoints para cargarla ni leerla.

B-412 pide la carga por lote del día de mediciones "con offset de PHV y % de talla adulta al instante". El valor guardado lo escribe el worker después del commit (segundos); el staff necesita verlo mientras tipea para detectar un error (una talla sentado mal tomada cambia el offset) y saber qué le falta a cada jugador (la altura de los padres) antes de que se vaya.

## Decisión

- **Endpoints de antropometría** (ADR 0032, matriz `anthropometry`): `POST /v1/anthro-measurements` (lote de hasta 200, todo o nada, idempotente por `clientUuid` por fila), `GET` lista por cursor (filtros jugador, categoría del jugador el día de la medición, día de test, fechas) y uno, `PATCH` con `version` y `changeReason` obligatorio (historial de cambios, ADR 0030). Reglas de los valores: al menos uno, talla sentado menor que la talla, ni futura ni anterior al nacimiento, en la fecha del día de test si la medición es de uno (también al corregirla), y **Σ de pliegues solo en la etapa `performance`** (M17/M19, principio 3). El método de una carga es `manual` por defecto y nunca `historical` (eso entra por las importaciones, ADR 0052).
- **La maduración al instante la calcula la API:** `POST /v1/anthro-measurements/preview` corre la misma `deriveMaturation` que el worker, con los parámetros del club, la tabla Khamis-Roche sembrada y la historia del jugador (para la velocidad de crecimiento), sin escribir nada. Devuelve por qué falta cada valor (`maturationGaps` del dominio: falta talla, talla sentado si ninguna ecuación del club calcula solo con la talla, peso, altura de los padres, edad fuera de la tabla, club sin tabla, predicción rechazada), los avisos de plausibilidad por campo con la sugerencia de coma corrida, la etapa del jugador ese día y el estado de verificación de los coeficientes: el de la tabla Khamis-Roche y el de la ecuación de offset usada en cada fila. La web avisa de todo lo que no esté `verified_against_publication` (hoy, la tabla y las ecuaciones sembradas están `cross_checked_secondary_sources`). La web le manda todo el plantel (con o sin valores) con debounce, así la planilla vacía ya dice a quién le falta la altura de los padres; la respuesta no vence por tiempo (la invalidan la carga y la altura de los padres).
- **Lo guardado dice si está al día:** la medición trae `maturation.derivedAt = null` mientras el outbox (`derived_refresh.maturation`) tiene un recálculo pendiente del jugador; la API nunca escribe columnas derivadas.
- **Consentimiento por fila:** un jugador sin consentimiento de datos vigente no tumba el lote ni la vista previa del plantel: en la carga es un problema de su fila (`consent_required` en `body.measurements.<i>.playerId`, como en las importaciones) y en la vista previa vuelve con `blockedBy: 'consent_required'` sin procesar nada suyo. Cualquier otra negación de la matriz sigue siendo `403` del pedido entero.
- **Web:** `/anthropometry` cuelga del club con la categoría del selector de alcance; navegación y planilla se habilitan con `canOnCategoryPlayers` (un recurso de jugador evaluado sobre "un jugador de la categoría", consentimiento aparte: la API lo decide fila por fila). La altura de los padres se carga desde la misma fila con los endpoints de B-315.

## Alternativas descartadas

- **Calcular en el navegador con las funciones del dominio:** habría que bajar a la web la tabla Khamis-Roche del club, sus parámetros, la historia de cada jugador y la altura de los padres de todo el plantel; dos implementaciones del armado de entradas (web y worker) terminan divergiendo, y CLAUDE.md pide que los datos derivados salgan del servidor.
- **Esperar al worker y refrescar la lista:** no es "al instante" y no dice qué falta antes de guardar.
- **`403` del lote si un jugador no tiene consentimiento:** un solo jugador sin firma bloquearía la planilla de toda la categoría sin decir cuál.

## Consecuencias

- La vista previa es una lectura que se hace por `POST` (el cuerpo es el plantel); no escribe, así que cuenta en la clase de límites de lectura (ADR 0031), no en la de escritura.
- La app mobile (B-502) puede usar el mismo endpoint con conexión; sin conexión la maduración aparece al sincronizar. La sincronización de antropometría por `POST /v1/sync/push` queda para cuando la app cargue mediciones.
- Si un club cambia la ecuación o la tabla, la vista previa y el worker cambian juntos: leen la misma configuración.
