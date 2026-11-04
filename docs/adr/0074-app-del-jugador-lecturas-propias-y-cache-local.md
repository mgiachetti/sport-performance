# 0074. App del jugador: lecturas propias del rol `player`, caché local de lecturas por membresía y escrituras solo por la cola

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #81 (B-503)

## Contexto

B-503 es la app del jugador: bienestar (3 ítems con caritas en M13/M14, 5 después) y RPE CR-10 en menos de 20 segundos, racha, récords, percentiles desde M15, historial de tests, próximos días de test y consentimientos. El principio 5 pide que funcione sin señal. ADR 0069 dejó la base local y la cola: el bienestar, la participación y los resultados propios ya llegan por la sincronización y se escriben con `wellness.submit`, `wellness.correct` y `rpe.submit`. Faltaba:

- **Qué preguntar sin conexión.** El conjunto de ítems depende de la etapa del jugador ese día (ADR 0038), y "hoy" de la zona horaria del club. `GET /v1/wellness/today` lo dice, pero pide el consentimiento de datos y no sirve para saber quién es el jugador si falta.
- **Qué sesiones puntuar.** El jugador no lee `training_session` (la matriz es del staff), así que la sincronización no se las trae; `GET /v1/me/training-sessions` sí, con la ventana del RPE.
- **Próximos días de test.** El jugador tampoco lee `test_session` ni el calendario de su categoría (`category.read` es del staff).
- **Percentiles y consentimientos.** Son lecturas en línea (`GET /v1/players/{id}/percentiles`, `/consents`); hay que mostrarlas también sin señal.

## Decisión

- **Dos lecturas propias del rol `player`**, siempre sobre sí mismo (el id sale de la membresía, nunca del request) y autorizadas con `player_profile.read` del jugador:
  - `GET /v1/me/player`: ficha mínima, día del club y zona horaria, mayoría de edad, etapa e ítems de bienestar de hoy (la misma función con la que el servidor valida la carga, `wellnessStageOf`) y qué le deja hacer la matriz hoy (`wellness.submit`, `rpe.submit`, `percentile.read` con la etapa y la franja de su categoría). La app no repite la matriz: pregunta.
  - `GET /v1/me/test-days`: los días de test programados o en curso de las categorías en las que está ese día, de hoy a 120 días (hasta 20), con la ventana y los tests que la batería le programa según su etapa (la misma resolución que la planilla del día, ADR 0068). Es su vista propia del calendario; no abre `test_session.read` al jugador ni muestra nada de otros jugadores.
- **Caché local de lecturas** (`cached_read`, migración 2 de la base local): la última respuesta de cada lectura que no viaja por la sincronización, por membresía y clave (`me.player`, `me.testDays`, `me.trainingSessions`, `me.percentiles`, `me.consents`), en el mismo archivo cifrado y colgando de `sync_scope` con `ON DELETE CASCADE`: cerrar sesión o que ingrese otra persona la borra como al resto. La clave nombra la lectura y sus parámetros (`me.trainingSessions|["<desde>","<hasta>"]`, `readCacheKey`): guardar una respuesta con otros parámetros borra la anterior de esa lectura. Se guarda solo para la membresía en la que la sesión actúa en ese momento, evaluado dentro de la misma escritura que el borrado al cerrar sesión: una respuesta que llega después de cerrar sesión o de que ingresó otra persona se descarta. Si la primera respuesta después de ingresar le gana al motor de sincronización en marcar al dueño del dispositivo, la caché lo marca igual que `SyncEngine.setScope` (borra lo de cualquier otro usuario) y la guarda. La pantalla muestra lo guardado al instante, pide a la API en segundo plano y, si no hay respuesta, avisa "Sin conexión: te mostramos lo guardado el …" (`useOfflineRead`).
- **"Hoy" en el teléfono** con la zona horaria del club guardada (`localDateInTimeZone`), no la del dispositivo: la carga de un día sin señal lleva su `localDate` del club.
- **Toda escritura por la cola** de ADR 0069, con `clientUuid`: `wellness.submit` con `localDate`, `wellness.correct` solo con los ítems cambiados y el motivo (también sobre un alta que todavía no salió, por su `clientUuid`), y `rpe.submit` (con motivo al corregir). Lo que la cola tiene se muestra como "Guardado en el teléfono" hasta que el servidor lo aplica; cuando el servidor confirma un RPE, la lista de sesiones se vuelve a pedir para que la escala no reaparezca desde la respuesta anterior. Las lecturas de la base local se repiten cuando cambia la cola o termina un ciclo (`useLocalRead`).
- **Lo derivado en el teléfono, puro y testeado** (`src/player`): la racha (días del club seguidos con bienestar, viva hasta que termina el día si falta hoy), los récords (mejor puntaje por métrica y ejercicio según el sentido del diccionario canónico, con fecha y método y aviso si la serie mezcla métodos, principio 4), las sesiones a puntuar (ventana abierta ahora, participación local por encima de la lista guardada, nada para ausentes o no disponibles) y el próximo día de test. Los percentiles no se calculan en el teléfono: vienen agregados de la API (nunca otros jugadores ni rankings). El diccionario de métricas de los récords es el canónico que viaja con la app (`CANONICAL_METRICS` de `packages/domain`), no una lectura guardada: una métrica propia del club (fuera del canónico) no tiene sentido de mejora conocido y no aparece en los récords (sí en el historial). Leer el catálogo del club y guardarlo con `useOfflineRead` queda para cuando haya métricas propias de club en uso.
- **Consentimientos en línea.** El menor los ve (los firma el tutor); el mayor lee el texto vigente, firma y revoca según las acciones que devuelve la API, siempre con conexión: es un acto sobre el texto vigente y no se encola.

## Alternativas descartadas

- **Leer el conjunto de ítems de `GET /v1/wellness/today`.** Sin consentimiento de datos responde `403` y la app no sabría ni quién es el jugador para mostrarle sus consentimientos; además no dice si puede ver percentiles.
- **Sincronizar `training_session` y `test_session` al jugador.** Abriría la lectura de sesiones y días de test de toda la categoría (notas, evaluador, condiciones) a un rol que solo necesita su propia agenda.
- **Persistir la caché de TanStack Query en AsyncStorage.** Quedaría sin cifrar, fuera del borrado por membresía y con datos de menores en un almacenamiento que no se limpia junto con la base.
- **Calcular la etapa o los permisos en el teléfono.** Duplicaría reglas del servidor (maduración, franja de edad) y se desfasaría de lo que valida la API.

## Consecuencias

- La migración 2 de la base local entra con una versión nativa nueva (ADR 0069): un update revertido no puede abrir un archivo migrado.
- Otras pantallas mobile (B-504 en adelante) reutilizan `useOfflineRead` / `useLocalRead` y agregan sus claves; una clave nueva no necesita migración.
- Lo guardado puede estar desactualizado (la etapa cambió, un consentimiento se revocó): el servidor sigue siendo el que valida, y un rechazo vuelve como aviso de la cola (ADR 0069).
- El modo kiosco (B-504), la carga externa (B-511) y el dolor en el bienestar (B-609) se suman sobre estas pantallas.
