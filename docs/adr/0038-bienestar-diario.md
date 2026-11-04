# 0038. Bienestar diario: versión de ítems por etapa, ventana de carga y corrección por el jugador

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #50 (B-319)

## Contexto

El bienestar antes de entrenar es la carga más frecuente del producto: el jugador la hace en menos de 20 segundos (principio 5), una vez por día del club, con 3 ítems con caritas en M13/M14 y 5 ítems después (tabla de etapas de `CLAUDE.md`). La tabla `wellness` ya existía (`item_count` 3 o 5, exactamente esa cantidad de ítems respondidos, única por jugador y día) y la matriz de permisos ya decía quién lee y quién carga (`wellness.read`, `wellness.submit`, ADR 0025). Faltaba decidir qué 3 ítems pregunta la versión corta, de dónde sale la etapa del día, hasta cuándo se puede cargar o corregir un día y quién corrige.

## Decisión

- **La versión de ítems es la cantidad.** `WELLNESS_ITEM_SETS` en `packages/domain`: `3` = sueño, fatiga y dolor muscular (lo físico, lo que el staff usa para ajustar la carga); `5` = sueño, fatiga, dolor muscular, estrés y ánimo. La cantidad de cada etapa sale de `STAGE_PROFILES[stage].wellnessItemCount`. Cada carga guarda su `item_count` y conserva su versión para siempre: una versión nueva es una cantidad nueva (y su `CHECK`), nunca un cambio de una existente. Los puntajes se guardan ya orientados (1–5, más alto es mejor) y la media es `meanWellnessScore`, la misma que evalúan las alertas.
- **Etapa del día.** La de `player_stage` vigente ese día (primero un fijado manual del staff) o, si no hay, la etapa por defecto de las categorías del jugador ese día; con varias, la más joven (`wellnessStageOn`). Sin ninguna, no se carga (`409`): falta configurar al jugador.
- **Día del club y ventana.** El día es el de la zona horaria del club (`app.club_today()`). Se carga hoy (por defecto) o ayer, para la cola offline que sincroniza después de medianoche o la carga de la mañana siguiente; nunca un día futuro ni anterior (`400` en `body.localDate`). Una segunda carga del mismo día es `409` (la clave única de la tabla); el mismo `clientUuid` devuelve la ya creada (ADR 0032), también después de que la ventana cerró.
- **Corrección por el propio jugador**, con el permiso `wellness.submit` (consentimiento de datos vigente), dentro de la misma ventana, con `version` y `changeReason` en el body (ADR 0030): queda en `change_history` con el motivo y el request id. La versión de ítems de la carga no cambia. El staff no carga ni corrige bienestar ajeno: la matriz no se lo da (el modo kiosco, B-504, lo resuelve con su propio permiso: [ADR 0086](0086-modo-kiosco.md)).
- **Lectura** según la matriz: el jugador lo suyo, `coach`/`sc`/`medical` sus asignaciones (categoría o deporte, con las categorías vigentes del jugador, igual que `app.visible_player_ids`), la administración y el superadmin en soporte todo el club. **El padre o tutor no lee bienestar**: la matriz y la tabla de roles le dan la ficha resumida y la disponibilidad, no el detalle diario; la RLS le deja ver la fila, pero la API responde `403`. El filtro por categoría de la lista usa la categoría del jugador en el día de cada carga, para que la historia siga en la categoría en la que se midió.

## Alternativas descartadas

- **Una columna `item_set_version` aparte.** Con conjuntos fijos por cantidad sería la misma información dos veces; si un club llega a configurar sus ítems (B-322), esa migración agrega la versión.
- **Aceptar cualquier día pasado.** Permitiría rellenar rachas y reescribir la historia que usan las alertas; la ventana de dos días cubre el offline real.
- **Corrección del staff con motivo.** No está en la matriz (ADR 0025) y mezclaría lo que reporta el jugador con lo que interpreta el staff.
- **Mostrar el bienestar al tutor.** Cambia la tabla de roles y la matriz; si se decide, es un cambio de la matriz con su ADR.

## Consecuencias

- La app del jugador (B-503) pide `GET /v1/wellness/today` para saber qué ítems mostrar y si ya cargó, y manda `POST /v1/wellness` con `clientUuid` desde la cola offline.
- La racha, el modo kiosco (B-504) y el reporte de dolor (B-609) quedan para sus issues; las alertas de bienestar las calcula el worker con la misma media.
