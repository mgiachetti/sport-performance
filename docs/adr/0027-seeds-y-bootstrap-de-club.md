# 0027. Seeds y bootstrap de club

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #37 (B-306)

## Contexto

CLAUDE.md pide que los datos de referencia (diccionario de métricas con `catapult_aliases`, tests con protocolo versionado, batería, reglas de alerta por defecto, posiciones, coeficientes de Khamis-Roche) vivan en la base como seeds y no hardcodeados. ADR 0023 ya decidió que no hay filas globales con `club_id NULL`: todo se siembra por club. El dominio (`@sport-performance/domain`) ya tiene los valores por defecto (`CANONICAL_METRICS`, `DEFAULT_ALERT_RULES`, `DEFAULT_SPEED_ZONE_SETS`, `DEFAULT_ATTEMPT_SCORING`, `STAGE_PROFILES`, `DEFAULT_AGE_BANDS`, `DEFAULT_POSITION_LINES`, `KHAMIS_ROCHE_1994_TABLE`). Faltaba decidir cómo se escriben los seeds, cuándo corren, qué pasa al volver a correrlos sobre un club que ya editó su configuración y dónde se guardan los coeficientes de Khamis-Roche.

## Decisión

- **Seeds en TypeScript, no en SQL.** Viven en `packages/db/src/seeds` y se exportan como `@sport-performance/db/seeds`. Leen las constantes del dominio y solo las copian: ninguna fórmula, umbral ni coeficiente se escribe dos veces. Lo único que no estaba en el dominio (alias de columnas de OpenField, textos de los protocolos para el evaluador, la tabla de frecuencias de la batería) se define en los seeds, una sola vez.
- **`bootstrapClub(db, { clubId, branches })`** siembra la configuración por defecto de un club: métricas, tests versión 1 y sus métricas, posiciones de los deportes del club, categorías M13–M19 por rama, batería por rama y etapa, reglas de alerta, zonas de velocidad y tablas de Khamis-Roche. La creación de clubes (B-313) la llama dentro de su propia transacción; el CLI `db:seed` la usa para el tenant ORC (rugby masculino y hockey femenino).
- **Idempotente y conservador: solo inserta lo que falta, nunca actualiza.** Las filas se reconocen por su clave natural (código; deporte y código; deporte, rama y franja de edad; alcance y test de la batería; tipo de zona del club). Volver a correr sobre un club sin cambios no escribe nada, y sobre un club que editó su configuración no pisa nada: una regla deshabilitada sigue deshabilitada, una categoría renombrada no se vuelve a crear, una zona o una batería cerradas con `valid_to` no se reabren. Para retirar un valor por defecto, el club lo deshabilita o cierra su vigencia; una fila borrada vuelve en la próxima corrida.
- **Cambiar un valor por defecto para clubes existentes no es un re-seed.** Un protocolo corregido es una versión nueva del test; una tabla de coeficientes corregida es un código nuevo (`khamis_roche_1994_v2`); una regla nueva es un código nuevo. Las filas existentes se cambian con una migración de datos explícita y revisada, nunca re-sembrando.
- **Concurrencia.** El bootstrap corre en una transacción (savepoint si ya hay una), toma `pg_advisory_xact_lock` por club y fija `app.club_id` con `set_config(..., true)` (ADR 0006). El CLI se conecta con `MIGRATIONS_DATABASE_URL` (o `DATABASE_URL`), el rol dueño de las migraciones (superusuario o `BYPASSRLS`, ADR 0026), porque no hay contexto de request y ningún rol de conexión crea un club sin él. La creación de clubes (B-313) lo llama en cambio con el login de `sport_performance_app`, en la transacción del request de un superadmin (`app.user_id` y `app.role = 'superadmin'`): las políticas de todas las tablas sembradas dejan escribir a `superadmin`, y el bootstrap fija `app.club_id` al club recién creado.
- **Khamis-Roche como datos por club.** Tablas `khamis_roche_table` (código, cita, DOI, erratas, estado de verificación del dominio como enum `coefficient_verification`) y `khamis_roche_coefficient` (una fila por sexo y edad, en las unidades del paper), con las convenciones de ADR 0023. `loadKhamisRocheTable` las devuelve como `KhamisRocheTable` validada para `predictAdultHeight`. El club no las edita: solo se agregan tablas nuevas.
- **Posiciones de hockey en el dominio.** `DEFAULT_POSITION_LINES` suma hockey sobre césped (arquera, defensora, volante, delantera, B-801) para que el seed tenga una sola fuente; M8 las refina.

## Consecuencias

- Un club nuevo queda operativo con un llamado; los datos de prueba y el club demo (#38) se construyen encima, sin duplicar la configuración.
- Agregar una métrica, un test o una regla por defecto al dominio la siembra en los clubes nuevos y, en los existentes, en la próxima corrida del seed (porque falta), sin tocar lo demás.
- Las tablas de Khamis-Roche son tablas del club: la migración `0005_khamis_roche_reference` las asegura con `app_admin.secure_club_table()` (ADR 0026) como cualquier otra. Las lee cualquier miembro del club (son coeficientes publicados, sin datos personales), las escriben `sc`, `admin` y `superadmin`, el worker lee y escribe las de su club y nadie las borra.
- Los textos de los protocolos están en es-AR dentro de la versión del protocolo (son datos del club, editables como versión nueva), no en `packages/i18n`.
