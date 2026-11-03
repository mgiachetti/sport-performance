# @sport-performance/worker

Jobs en segundo plano con pg-boss (cola sobre la misma Postgres, ADR 0011, ADR 0045): el recálculo de los valores derivados para el panel (B-326), con la generación de alertas (B-327, ADR 0053) como paso del mismo recálculo, la retención de archivos (B-325) y las notificaciones push y por email (B-328, [ADR 0054](../../docs/adr/0054-notificaciones-push-y-email.md)).

## Cómo funciona

1. **Marca en la transacción del dato.** Los triggers de la base (`derived_refresh_trigger`, migración `0021`) marcan al jugador en `derived_refresh` cuando cambia una participación, una sesión, un bienestar, una antropometría, la altura de los padres, el jugador o `club.settings.derived`, sin importar quién escribe (API, sync offline, importaciones). Si la transacción se revierte, no hay marca.
2. **De la marca a la cola.** Al commit sale `pg_notify('sport_performance_derived_refresh', club_id)`; el worker la escucha y encola `derived-refresh-club` para ese club (política `stately`: a lo sumo un job en cola y uno activo por club). Un cron cada minuto (`derived-sweep`) encola los clubes con marcas pendientes por si se perdió una notificación, y el worker hace lo mismo al arrancar.
3. **Recálculo por club.** Cada job fija `app.club_id` y, por cada jugador marcado, en su propia transacción: serie de carga (`player_load_daily`, `computeLoadSeries` del dominio), bienestar contra la media móvil propia (`player_wellness_daily`) y maduración (en `anthro_measurement`). Cierra la marca solo si nadie la renovó mientras calculaba (compare-and-delete sobre `requested_at`).
4. **Cada noche.** Un cron cada hora (`derived-daily`) encola todos los clubes; cada uno extiende hasta **hoy en su zona horaria** las series que terminan antes (el EWMA decae aunque no haya carga) y evalúa las alertas de los jugadores cuyo último día evaluado es anterior a hoy.
5. **Alertas** (B-327, [ADR 0053](../../docs/adr/0053-alertas-episodios-eventos-y-revision.md)). Al final de cada recálculo de un jugador, en la misma transacción, `evaluatePlayerAlerts` (`src/alerts/`) evalúa las reglas del club (`alert_rule`, validadas con `parseAlertRule`; una inválida hace fallar el job) para hoy con lo que se acaba de derivar y mueve el episodio de cada regla con `nextAlertEpisode` del dominio: abre, sigue, escala, resuelve o reabre. Cada cambio deja un `alert_event` (trigger). Un CMJ, una regla, la etapa, la categoría o el deporte marcan `derived_refresh.alerts` para evaluar aunque no cambie ningún derivado.

6. **Retención de archivos** (B-325, ADR 0044). Una vez por día (`files-daily`, 06:17 UTC) se encola `files-purge-club` por club, que corre `purgeExpiredFiles` de `@sport-performance/storage` con el contexto del club; si quedan más, encola otra pasada. Sin las variables `STORAGE_*` (solo fuera de producción) el job queda apagado.

6. **Notificaciones** (B-328, ADR 0054). Un cron cada minuto (`notifications-sweep`) encola `notifications-club` por club, que: planifica (pedido de RPE al terminar la sesión más la demora, recordatorio a la mañana siguiente, alertas críticas cuando aparecen al staff asignado, resumen antes de cada sesión), idempotente por `notification_dedupe_key`; entrega lo vencido (revalida, Expo Push y Resend fuera de la transacción, reintentos con tope); lee los recibos de Expo (`DeviceNotRegistered` borra el token) y borra las entregas de más de 90 días. Respeta el horario permitido del club y el de menores. Los payloads llevan solo textos operativos e ids: nunca datos de salud, valores ni el nombre del jugador junto a una alerta.

Un jugador que falla no frena al resto; el job falla al final, pg-boss lo reintenta con backoff exponencial y, después del último intento, lo deja en `derived-refresh-club-dead`.

## Correr

```sh
pnpm --filter @sport-performance/db db:migrate   # como dueño: migraciones + esquema pgboss
pnpm --filter @sport-performance/worker build
DATABASE_URL=postgres://sp_worker:...@host/db pnpm --filter @sport-performance/worker start
```

`DATABASE_URL` es un login de `sport_performance_worker` creado con `db:provision-login` (`DB_LOGIN_ROLE=worker`). Con el dueño u otro rol el worker no arranca (`assertConnectionRole`). Tampoco arranca si el esquema `pgboss` no está en la versión de pg-boss que espera: el worker nunca migra la cola (no tiene DDL); lo hace `db:migrate`. Variables en [`.env.example`](.env.example).

## Configuración por club

`club.settings.derived` (JSON parcial, validado con `resolveDerivedParameters` del dominio; lo que falta toma el valor por defecto):

```json
{
  "load": { "acuteWindowDays": 7, "chronicWindowDays": 28, "minHistoryDays": 28 },
  "wellnessBaseline": { "windowDays": 28, "minSamples": 10 },
  "maturation": {
    "maturityOffsetEquation": "moore_2015",
    "khamisRocheTableCode": "khamis_roche_1994"
  }
}
```

Un valor inválido hace fallar el job (no cae en silencio a los valores por defecto). Cambiar `derived` marca a todos los jugadores del club.

`club.settings.notifications` (`resolveNotificationSettings`, mismas reglas):

```json
{
  "rpeRequestDelayMin": 20,
  "rpeReminderTime": "08:00",
  "defaultSessionDurationMin": 90,
  "preTrainingSummaryLeadMin": 120,
  "allowedHours": { "from": "07:00", "to": "22:00" },
  "minorAllowedHours": { "from": "08:00", "to": "21:00" }
}
```

## Tests

`pnpm --filter @sport-performance/worker test`: unitarios (entorno, plan de la serie de carga, colas) y, con `DATABASE_URL` de un Postgres 16 (superusuario), `worker.pg.test.ts` contra una base temporal con logins reales de la API y del worker: triggers y rollback, notificación, recálculo e idempotencia, compare-and-delete, sesiones archivadas, extensión al día del club, bienestar, maduración, configuración inválida, aislamiento entre clubes, fallo de un jugador y el circuito completo sobre pg-boss; `notifications/notifications.pg.test.ts` con Expo y email en memoria: pedido y recordatorio de RPE, menores, consentimiento, preferencias, alertas críticas (solo al staff asignado, solo al aparecer, sin nombres ni valores), resumen, reintentos, tokens que Expo olvida, recibos y retención.
