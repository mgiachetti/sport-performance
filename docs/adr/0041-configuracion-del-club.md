# 0041. Configuración del club: vigencia de la batería y las zonas, reglas de alerta editables y módulos activos

- Estado: Aceptado
- Fecha: 2026-11-02
- Issue: #53 (B-322)

## Contexto

B-322 abre a la API lo que hasta ahora solo sembraba `bootstrapClub` (ADR 0027): la batería de tests (`battery_config`), las zonas de velocidad (`speed_zone_config`, B-209) y las reglas de alerta (`alert_rule`, B-207, ADR 0022), y agrega los módulos activos por club. Las tablas ya existían, con vigencia `[valid_from, valid_to)` en la batería y las zonas, pero no estaba decidido qué se puede editar de una fila que ya se usó: las zonas vigentes un día son las que calcularon las métricas de cancha de ese día (`hsr_abs_m`, `hsr_rel_m`), y la batería de una temporada es contra lo que se mide si un grupo hizo sus tests. Tampoco había cómo retirar una fila cargada por error (la aplicación no borra, ADR 0023), ni cómo resolver la batería que le toca a un grupo, ni una lista de módulos. Las convenciones de los endpoints son las de ADR 0032.

## Decisión

- **Vigencia como historia.** Una fila de batería o de zonas está *planificada* (empieza después de hoy en el club), *vigente* o *terminada*. La planificada se edita entera (desde hoy en adelante) o se archiva. La vigente no cambia su contenido ni su inicio: se cierra con `validTo` (desde hoy) y se abre otra; `closePrevious` en el alta cierra la anterior del mismo alcance en la misma transacción. La terminada no cambia. Así una sesión pasada se recalcula siempre con las zonas que tenía.
- **Sin solapamientos.** Dos filas activas con el mismo alcance (y el mismo test, en la batería) no comparten días: `409 conflict`. Se chequea con el dominio (`findBatteryEntryConflicts`, `findSpeedZoneConfigConflicts`) bajo un advisory lock por club y tabla, así dos altas concurrentes no pasan las dos. Un alta puede empezar en el pasado si no se superpone (cargar la configuración de primera para importar históricos); `closePrevious` solo desde hoy.
- **Archivar es retirar lo que nunca aplicó.** Migración `0018`: `archived_at` en `battery_config` y `speed_zone_config`. Solo se archiva una fila planificada; restaurarla exige que siga planificada y que no se superponga. La resolución ignora las archivadas.
- **Batería resuelta en el dominio.** `resolveBattery` elige por test la entrada vigente más específica (categoría > etapa > sexo > club), como las zonas. Un test con cargas máximas solo se programa con la etapa `performance` y, si hay categoría, con una franja que las permita (`validateBatteryStage`, principio 3): una entrada sin etapa llegaría también a `foundation`.
- **Reglas de alerta.** Cada alta y edición pasa por `parseAlertRule`; el contrato describe la forma de cada `kind` y el dominio la semántica, con la ruta del error en `details`. `code` y `kind` no cambian; las reglas no se archivan ni se borran (las alertas guardan su referencia y una copia de lo evaluado): se desactivan con `enabled`. `isDefault` marca los códigos sembrados.
- **Módulos activos.** Conjunto cerrado en el dominio (`CLUB_MODULES`: `wellness`, `gym`, `gps`, `maturation`, `pain_report`, `menstrual_cycle`) con sus valores por defecto (los de salud y hardware empiezan apagados), guardado en `club.settings.modules` y resuelto sobre los defaults. Al cambiar uno se guardan todos explícitos, así un cambio futuro de los defaults no da vuelta la elección de un club. Lo lee todo miembro (la web y la app muestran u ocultan áreas) y lo cambia la administración (`club.update`, como la marca y la RLS de `club`), no `sc`: prender el reporte de dolor o el ciclo menstrual es una decisión del club, no de la preparación física. La concurrencia usa la `version` del club.
- **Permisos.** Batería, zonas y reglas con `configuration` de la matriz (leen `coach`, `sc`, `medical` y la administración; escriben `sc` y la administración). Una fila de zonas de un jugador/a exige además `player_profile.read` sobre ese jugador; las listas solo muestran las de jugadores visibles y una fila de un jugador que la RLS oculta es `404`.

## Alternativas descartadas

- **Editar en el lugar cualquier fila.** Reescribe la historia: las métricas de cancha ya calculadas no coincidirían con las zonas que muestran.
- **Restricción de exclusión (`btree_gist`) contra los solapamientos.** Sería el piso más fuerte, pero suma una extensión y una expresión por alcance con columnas nulas; el chequeo en el dominio bajo lock alcanza con una sola API escribiendo.
- **Una tabla `club_module`.** Más filas y políticas para seis booleanos del club; `club.settings` ya estaba pensado para esto y su RLS es la de la administración.
- **Archivar reglas de alerta.** `enabled` ya expresa "no evaluar"; una segunda bandera daría dos maneras de apagar lo mismo.

## Consecuencias

- La pantalla de configuración (B-409) muestra la vigencia y ofrece "cambiar desde…" (`closePrevious`) en vez de editar una fila vigente.
- El worker (B-326) resuelve zonas y batería con las funciones del dominio y filtra `archived_at IS NULL`.
- Un club no puede excluir un test para una categoría si una fila más general lo incluye: tiene que cerrar la general y programar las categorías por separado. Si hace falta, se agrega una entrada de exclusión explícita.
- Los módulos todavía no apagan endpoints: los clientes los leen; cuando lleguen los endpoints de bienestar, gimnasio y GPS, cada uno chequea su módulo.
