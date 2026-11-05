# Monitoreo operativo (B-703)

Cómo nos enteramos de que algo de la plataforma anda mal antes que el club, qué hacer ante cada aviso y qué hay que aprovisionar fuera del repo. Decisión en [ADR 0095](../adr/0095-monitoreo-operativo.md); errores y logs en [ADR 0016](../adr/0016-observabilidad-sentry-pino.md).

> Nada de esto lleva datos personales ni de salud: conteos, edades, nombres de colas y códigos. Si un aviso, un tag o un log nuevo trae un nombre, un email, un id de jugador o algo del esquema `medical`, es un bug.

## Qué vigila qué

| Señal | Quién la mide | Por dónde avisa |
|---|---|---|
| API caída o sin base | El monitor de uptime contra `GET /health/ready` | El monitor de uptime |
| Worker caído o pg-boss sin agendar | La API (latido en `/health/ops`) y Sentry Crons (`worker-ops-monitor`) | El monitor de uptime y Sentry |
| Jobs fallidos, en descarte o atrasados, outbox, informes, exportaciones, notificaciones, horizonte de sincronización | El job `ops-monitor` del worker, cada minuto | Sentry (un issue por chequeo) y `/health/ops` |
| Errores de código (API, worker, web, mobile) | Sentry SDK | Reglas de alerta de Sentry |
| Cola de un teléfono trabada, mutaciones rechazadas | El motor de sincronización de la app | Sentry (proyecto mobile) |

## Chequeos

Definidos en `packages/domain/src/ops-checks.ts` (`OPS_CHECKS`). Un valor igual o mayor que el umbral pasa a ese estado. `unknown` = no se pudo medir (la fuente falló; está en el log del worker como `ops monitor: a source could not be measured`).

| Código | Qué mide | Atención | Crítico |
|---|---|---|---|
| `worker_heartbeat_s` | Segundos desde la última pasada del monitor (lo calcula la API; si nunca reportó, crítico) | 180 | 300 |
| `job_dead_letter_n` | Jobs en las colas `*-dead`: agotaron los reintentos | 1 | 10 |
| `job_failed_recent_n` | Jobs que fallaron definitivamente en la última hora (incluye los barridos, que no reintentan) | 1 | 10 |
| `job_backlog_s` | Segundos que espera el job listo más viejo (fuera de las colas de descarte) | 300 | 1800 |
| `derived_refresh_lag_s` | Segundos que espera el recálculo pendiente más viejo (`derived_refresh`) | 900 | 3600 |
| `reports_failed_n` | Informes PDF (jugador y categoría) fallidos en 24 h | 1 | 10 |
| `exports_failed_n` | Exportaciones CSV fallidas en 24 h | 1 | 5 |
| `notifications_failed_n` | Entregas de push y email fallidas en 24 h | 5 | 50 |
| `sync_horizon_stalled_s` | Segundos que el `xmin` del snapshot no avanza con transacciones más nuevas en curso | 600 | 1800 |

`/health/ops` responde `503` si algún chequeo está **crítico**; atención y `unknown` responden `200` (se ven en el cuerpo y en Sentry).

## Qué hacer ante cada aviso

En todos los casos: mirar primero el issue de Sentry (estado, desde cuándo, detalle por cola en `/health/ops`) y los logs del servicio en Railway filtrando por el mensaje del job (`refresh failed`, `notifications failed`, etc., con `clubId` y `jobId`).

### `worker_heartbeat_s` o el monitor `worker-ops-monitor` de Sentry Crons

El worker no corre o no agenda.

1. Railway → servicio `worker` → estado del deploy y logs. Un `ConfigError` al arrancar nombra la variable que falta; `database login is not the worker role` es un `DATABASE_URL` equivocado (ADR 0026).
2. Si el proceso corre pero no hay pasadas: `job queue error` en los logs (pg-boss sin conexión) o la migración de la cola sin aplicar (`db:migrate` instala pg-boss, ADR 0046).
3. Si es un deploy en curso, se resuelve solo en 1–2 minutos (por eso el margen de 3 minutos).
4. Con `OPS_MONITOR=off` en ese entorno el latido siempre falla: o se prende o no se configura el monitor de uptime de `/health/ops` ahí.

### `job_dead_letter_n`

Un job por club agotó los reintentos y quedó en `<cola>-dead` (el detalle dice cuál). El error original ya está en Sentry (`job` y `jobId` en los tags) y en el log.

1. Corregir la causa (deploy, dato inválido, bucket o proveedor caído).
2. Reencolar: los barridos vuelven a encolar el trabajo pendiente del club solos (recálculos, informes, exportaciones, notificaciones), así que normalmente alcanza con borrar el job de descarte. Con un login del worker:
   ```sql
   select id, data->>'clubId' as club_id, created_on from pgboss.job where name = '<cola>-dead' and state = 'created';
   delete from pgboss.job where name = '<cola>-dead' and id = '<id>';
   ```
3. El chequeo vuelve a `ok` en la pasada siguiente; Sentry resuelve el issue a mano o por inactividad.

### `job_failed_recent_n`

Un job falló sin reintentos (un barrido, el monitor) o terminó de fallar. Buscar en Sentry el error con el tag `job`. Si es un barrido (`*-sweep`, `*-daily`), la próxima corrida hace lo mismo: alcanza con corregir la causa.

### `job_backlog_s`

Hay trabajo esperando y nadie lo toma: el worker está caído (ver latido), saturado (subir `WORKER_CLUB_CONCURRENCY` o réplicas) o trabado en un job largo (ver `job_backlog_s.detail` en `/health/ops` para la cola). `expireInSeconds` de cada cola corta un job colgado.

### `derived_refresh_lag_s`

Los recálculos de carga, bienestar y maduración se atrasan: ACWR, monotonía y alertas no están al día. Suele acompañar a `job_backlog_s` o `job_dead_letter_n` de `derived-refresh-club`. Si no, revisar el log `refresh failed` (un jugador con datos que rompen el cálculo deja su marca pendiente y el resto avanza, ADR 0046).

### `reports_failed_n`, `exports_failed_n`

Un informe PDF o una exportación terminó en `failed` (el `failure_code` / `error_code` de la fila dice por qué: `storage_failed`, `too_large`, `render_failed`…). Con `storage_failed`, revisar el bucket (credenciales, cuota). El staff puede pedirlo de nuevo desde la web.

### `notifications_failed_n`

Muchas entregas fallidas: Resend (dominio, API key, cuota) o Expo (token de acceso, recibos con `DeviceNotRegistered` masivos). Unas pocas por día son normales (apps desinstaladas).

### `sync_horizon_stalled_s`

Una transacción con xid quedó abierta y el pull de sincronización de **todos** los dispositivos no avanza más allá de ella (ADR 0050). Como dueño:

```sql
select pid, usename, application_name, state, now() - xact_start as age, backend_xid
  from pg_stat_activity where backend_xid is not null order by xact_start limit 5;
select pg_terminate_backend(<pid>); -- solo si es una sesión manual o colgada
```

Las conexiones de la API y del worker tienen `idle_in_transaction_session_timeout`; lo habitual es una consola abierta a mano o un `BEGIN` de una migración interrumpida.

### Avisos de la app: `sync-queue-stalled` y `sync-mutation-rejected`

- `sync-queue-stalled`: un teléfono tiene mutaciones de más de una hora que el servidor responde con error (`5xx`, `429`, respuesta fuera del contrato). Ver los errores del endpoint `POST /v1/sync/push` en Sentry de la API a la misma hora. Los tags dicen cuántas y qué tan viejas, en rangos.
- `sync-mutation-rejected`: el servidor rechazó una operación (tag `sync_op`) con un código (`sync_error`). Algunos son normales (`forbidden` tras revocar un consentimiento); un pico después de un release es un desajuste de contrato entre app y API.

## Aprovisionamiento (lo hace una persona, no el repo)

Nada de esto lo crea el código. Por entorno (`staging`, `production`):

1. **Sentry.** Proyectos `api`, `worker`, `web` y `mobile` (ADR 0016) y su DSN en `SENTRY_DSN` de cada servicio. Revisar que el scrubbing de datos esté activo en la organización.
2. **Reglas de alerta de Sentry** (proyecto `worker`):
   - Issue nuevo o regresión con tag `ops_status` igual a `critical` → notificar de inmediato (email del equipo o Slack).
   - Issue nuevo o regresión con tag `ops_status` igual a `warning` → notificar en horario hábil o en un canal de baja prioridad.
   - Proyecto `mobile`: issue con huella `sync-queue-stalled` visto más de 5 veces en 1 hora; `sync-mutation-rejected` más de 20 veces en 1 hora.
3. **Sentry Crons.** El monitor `worker-ops-monitor` se crea solo con el primer check-in (agenda, margen y umbrales van en cada check-in, `apps/worker/src/ops/monitor.ts`). Asignarle el destino de alerta (mismo que el crítico).
4. **Token del probe.** Generar uno por entorno (`openssl rand -base64 48`), distinto de `AUTH_SECRET`, y cargarlo como `OPS_MONITOR_TOKEN` en el servicio `api` de Railway. Nunca en el repo.
5. **Monitor de uptime** (Better Stack, UptimeRobot, Sentry Uptime u otro), cada 1–3 minutos, desde fuera de Railway:
   - `GET https://<api>/health/ready` → alerta si no es `200`.
   - `GET https://<api>/health/ops` con header `Authorization: Bearer <OPS_MONITOR_TOKEN>` → alerta si no es `200`. Guardar el cuerpo del fallo: dice qué chequeo está crítico.
   - Opcional: la web (`https://<web>/`) → `200`.
6. **Variables del worker:** `OPS_MONITOR=on` y `OPS_RENOTIFY_MINUTES` (60 por defecto) en `apps/worker/.env.example`.
7. **Healthchecks de Railway:** el `healthcheckPath` del servicio `api` debe ser `/health/ready` (no `/health/ops`: un job atrasado no debe reiniciar la API).

## Cambiar un umbral o agregar un chequeo

1. Editar `OPS_CHECKS` (umbral) o agregar la entrada con su código en `OPS_CHECK_CODES`.
2. Medirlo en `apps/worker/src/ops/monitor.ts` (y, si necesita una tabla entre clubes, sumar la columna a `app.worker_ops_backlog` en una migración nueva: solo conteos y edades).
3. Agregar su fila y su sección en este documento.
4. Desplegar primero la API y después el worker: una API vieja deja fuera los códigos que no conoce.
