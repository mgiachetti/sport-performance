# 0037. Sesiones, participación y RPE: ventana del jugador, carga masiva idempotente y sesiones archivables

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #49 (B-318)

## Contexto

B-318 trae los endpoints de sesiones de entrenamiento y partidos, sus bloques (drills) con nivel de contacto, la participación de cada jugador (estado, minutos, contactos) y el RPE que carga el jugador. El esquema ya existía (`training_session`, `drill`, `participation` con `srpe_au` generada, historial por trigger, ADR 0030), pero quedaban decisiones abiertas: hasta cuándo puede un jugador cargar o corregir su RPE, qué pasa si lo carga antes de que el staff tome asistencia, cómo es la carga masiva del staff para que la cola offline (B-323) la pueda reenviar sin duplicar, y cómo se archiva una sesión suspendida si la tabla no tenía `archived_at` (ADR 0032: archivar, no borrar).

## Decisión

- **Ventana del RPE (regla pura del dominio, `rpeSubmissionWindow`).** Se abre al empezar la sesión y se cierra al terminar el día del club siguiente al de la sesión (zona horaria del club; parámetro `closeAfterClubDays`, por defecto 1). Cubre "15–30 min después o a la mañana siguiente" (CLAUDE.md) con margen, y deja afuera los recuerdos de días después. Fuera de la ventana: `409 conflict`. Dentro, corregir un RPE ya enviado es una corrección y pide `changeReason` (lo exige el trigger del historial).
- **El jugador no espera al staff.** `POST /v1/training-sessions/{id}/rpe` lo usa solo el jugador para sí mismo (`rpe.submit`, con consentimiento `data`). Si el staff no cargó su participación y la sesión es de una de sus categorías vigentes ese día, se crea como `full` con los minutos planificados; el staff la corrige después (con motivo). Si el staff lo marcó ausente o no disponible: `409`. Lo que el staff no puede hacer es cargar el RPE por el jugador: la matriz se lo da solo al jugador.
- **Los jugadores ven sus sesiones por un endpoint propio.** `training_session.read` es del staff; `GET /v1/me/training-sessions` (con `rpe.read` propio) devuelve las sesiones activas de sus categorías de ese día y las que tienen su participación, con lo cargado, la ventana y si puede cargar ahora.
- **Carga masiva del staff.** `POST /v1/training-sessions/{id}/participations/batch`: hasta 100 filas `{ clientUuid, playerId, status, minutes, contactsN, version? }`, todo o nada, con un `changeReason` para las correcciones del lote. Crea o actualiza por `(sesión, jugador)`, con las filas existentes bloqueadas (`FOR UPDATE`). Cada fila es idempotente: una fila cuyo `clientUuid` ya creó una participación vuelve como `replayed` sin tocarla; una fila con los mismos valores que la actual vuelve como `unchanged` sin mirar la versión, así que reenviar una actualización ya aplicada tampoco falla. `version` es opcional (la cola offline resolverá por campo con HLC, ADR 0015); si viene y la fila cambiaría, tiene que ser la actual. `participation.record` se evalúa por jugador: un jugador sin consentimiento `data` es `403`, uno que la RLS no deja ver (otro club o fuera de las asignaciones) es `400` en `body.rows[i].playerId`.
- **Sin carga para ausentes.** `absent` y `unavailable` no llevan minutos, contactos ni RPE (el contrato los rechaza y el handler los limpia; limpiar un RPE enviado es una corrección). Los estados son los del dominio (`PARTICIPATION_STATUSES`, que pasan de `packages/db` a `packages/domain` junto con `CONTACT_LEVELS`, sin migración): presente (`full`), limitado (`partial`), ausente y no disponible; el entrenador nunca ve la causa médica.
- **La sesión pide categoría.** La API exige `categoryId` (activa) y toma el deporte de ella; la columna sigue admitiendo `NULL` para importaciones de todo un deporte, que solo ve y maneja la administración (la matriz no tiene categoría que comparar). `localDate` se calcula con la zona horaria del club en la API y se recalcula si cambia `startsAt`.
- **Archivar sesiones** (migración `0014_training_session_archive`): `training_session.archived_at`, con su `GRANT UPDATE` (las de `secure_club_table` son por columna) y el trigger del historial recreado con `archived_at` como columna libre: archivar y restaurar quedan registrados pero no son correcciones. Una sesión archivada conserva su participación y no acepta bloques, participación ni RPE nuevos (`409`). Los bloques se borran (`DELETE /v1/drills/{id}`, la única tabla donde la base lo permite); si ya tienen métricas de campo, `409`.

## Alternativas descartadas

- **Ventana fija en horas (por ejemplo 36 h desde el final).** Depende de la duración planificada, que puede faltar o no cumplirse, y corta a la mitad de la mañana siguiente según la hora de la sesión; el día del club es lo que entiende el jugador.
- **RPE solo sobre una participación que cargó el staff.** Si el entrenador no toma asistencia, el jugador no puede cargar: contradice el principio de fricción mínima.
- **`PUT` por jugador en vez de un lote.** Una sesión de 40 jugadores serían 40 requests y 40 transacciones; el lote es atómico y es la forma que reenvía la cola offline.
- **Exigir `version` en cada fila del lote.** Obliga a releer antes de reenviar desde la cola offline y hace fallar reintentos ya aplicados; la idempotencia por valor y por `clientUuid` lo resuelve sin perder la detección de ediciones pisadas cuando el cliente manda la versión.
- **Estado `cancelled` en la sesión.** Es otra forma de archivar con un vocabulario propio; ADR 0032 ya define `archive` / `restore` para todo recurso.

## Consecuencias

- La app del jugador arma la pantalla de RPE con `GET /v1/me/training-sessions` y las notificaciones de B-328 usan la misma ventana del dominio.
- La sincronización offline (B-323) reemplazará la precondición opcional de `version` por la resolución por campo con HLC, sobre el mismo `clientUuid` por fila.
- Cuando el módulo médico marque bloqueos, la carga masiva podrá sugerir `unavailable` para esos jugadores; hoy el staff lo elige.
- La ventana es un parámetro del dominio: hacerla configurable por club (B-322) es leerla de la configuración, sin cambiar los endpoints.
