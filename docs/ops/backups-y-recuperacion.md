# Backups y recuperación (runbook)

B-702 · [ADR 0094](../adr/0094-backups-pitr-y-simulacros-de-restauracion.md) · infraestructura en [ADR 0003](../adr/0003-infra-railway.md).

Este documento dice cómo está respaldada la base, cómo se prueba que el respaldo sirve (simulacro) y qué hacer cuando hay que restaurar de verdad (incidente). Lo ejecuta una persona con acceso de administración al proyecto de Railway. Nada de esto lo hace la app sola.

> Los nombres de servicio (`postgres`, `api`, `worker`, `web`) son los del proyecto de B-701. Si el proyecto usa otros, reemplazalos en los comandos.

## 1. Qué se respalda y con qué objetivos

| Qué | Cómo | Retención |
|---|---|---|
| Base Postgres (todo: club, `medical`, `support`, `ops`, cola `pgboss`, auth) | **PITR de Railway**: pgBackRest archiva cada segmento de WAL en un bucket del proyecto (`Postgres-PITR`), con base completa semanal y diferencial diaria | Últimas 4 completas: unas 4 semanas, a cualquier instante |
| Base Postgres (segunda capa) | **Backups de volumen** programados de Railway, diarios y semanales | Lo que fije el plan de Railway |
| Archivos (bucket de la app) | No se respaldan con la base: son inmutables por clave (ADR 0044) y su vida la manda la retención por tipo | — |

| Objetivo | `production` | `staging` |
|---|---|---|
| RPO (cuánto se puede perder) | 5 min (el archivado empuja WAL cada 60 s como máximo) | 1 h |
| RTO (hasta tener la copia verificada sirviendo) | 2 h | 1 día hábil |

## 2. Configuración inicial (una vez por ambiente)

Requiere la [CLI de Railway](https://docs.railway.com/cli) con `railway login` y el proyecto enlazado (`railway link`).

1. **Imagen.** El servicio de Postgres usa la imagen oficial `ghcr.io/railwayapp-templates/postgres-ssl:16` (o la de HA `postgres-ha/postgres-patroni:16`), **en tag mayor**: con una versión menor fijada (`:16.10`) PITR no funciona. Sin comando de arranque propio.
2. **Ambiente declarado en la base** (ADR 0055), conectado como dueño:
   ```sql
   ALTER DATABASE railway SET app.deployment_environment = 'production'; -- o 'staging'
   ```
3. **Habilitar PITR:**
   ```bash
   railway postgres pitr enable --service postgres --environment production
   railway postgres pitr status --service postgres --environment production
   ```
   `status` tiene que mostrar el archivador sano y, después de unos minutos, la primera base tomada. La ventana empieza ahí: no es retroactiva.
4. **Backups de volumen programados:**
   ```bash
   railway postgres pitr schedule set --daily --weekly --service postgres --environment production
   railway postgres pitr schedule list --service postgres --environment production
   ```
5. **HA en producción** (si todavía no lo está): `railway postgres ha convert --service postgres --environment production`. Habilitar PITR en un clúster HA hace un failover de pocos segundos: hacelo fuera del horario de entrenamiento.
6. **Primer simulacro** en `staging` y después en `production` (sección 3), y anotarlos en el [registro](registro-de-simulacros.md).

Advertencia del proveedor: la credencial del bucket de PITR es de lectura y escritura, y las variables de un servicio restaurado la incluyen. Solo quien administra el proyecto debe ver las variables de los servicios de Postgres.

## 3. Simulacro de restauración

Cadencia: **trimestral en producción**, en staging antes de cada migración riesgosa, y siempre después de cambiar la imagen o la configuración de Postgres. Dura unos 45 minutos, casi todo espera.

Los comandos `sport-performance-db-restore` vienen de `packages/db` (`pnpm --filter @sport-performance/db db:restore …` desde el repo, con `pnpm build` hecho). Escriben JSON y nunca imprimen la cadena de conexión. Ver la sección 5 para dónde correrlos.

1. **Chequeo previo.** `railway postgres pitr status --service postgres --environment <amb>`: archivador sano y ventana que cubre ahora. Anotá la hora de inicio.
2. **Marcador "antes"**, en la base de **origen**, como dueño (`MIGRATIONS_DATABASE_URL`):
   ```bash
   sport-performance-db-restore mark --environment <amb> --label "simulacro AAAA-MM-DD antes"
   ```
   Guardá el `id` y el `createdAt`.
3. **Esperá 2 minutos** (que el WAL del marcador llegue al bucket) y elegí el **objetivo T**: la hora actual en UTC, con segundos, por ejemplo `2026-11-04T15:30:00Z`. T tiene que ser posterior al `createdAt` del marcador "antes".
4. **Esperá 1 minuto y escribí el marcador "después"** en el origen:
   ```bash
   sport-performance-db-restore mark --environment <amb> --label "simulacro AAAA-MM-DD después"
   ```
   Su `createdAt` tiene que ser posterior a T. Esperá 2 minutos más.
5. **Restaurá a T** en un servicio hermano (el origen no se toca):
   ```bash
   railway postgres pitr restore --service postgres --environment <amb> \
     --at 2026-11-04T15:30:00Z --new-service-name postgres-simulacro-AAAAMMDD
   ```
   Anotá la hora: desde acá corre el RTO del simulacro. Esperá a que el servicio nuevo esté desplegado y promovido.
6. **Verificá la copia** con su URL de dueño en `RESTORE_DATABASE_URL` (la del servicio `postgres-simulacro-…`, **nunca** la del origen):
   ```bash
   RESTORE_DATABASE_URL='…' sport-performance-db-restore verify \
     --target 2026-11-04T15:30:00Z --present <id-antes> --absent <id-después>
   ```
   Tiene que salir con `"ok": true` y código 0. Qué mira cada chequeo:

   | Chequeo | Falla si |
   |---|---|
   | `recovery_finished` | El servidor sigue en recuperación (esperá y repetí) |
   | `migrations` | No hay migraciones registradas. *Aviso* si faltan o sobran respecto del código |
   | `job_queue` | Falta el esquema `pgboss` |
   | `connection_roles` | Falta un rol de conexión. *Aviso* si un rol no tiene login |
   | `row_level_security` | Una tabla del club o de `medical` no tiene RLS habilitada y forzada |
   | `triggers` | No hay triggers o alguno está deshabilitado (auditoría, historial, append-only) |
   | `drill_markers` | Falta el marcador "antes" o está el "después": no restauró a T |
   | `recovery_point` | Hay una fila escrita después de T (más de 5 s): no es una copia a T |

   El informe trae además los conteos por tabla y `secondsBetweenLatestWriteAndTarget` (cuánto antes de T fue la última escritura).
7. **Registrá** el simulacro en el [registro](registro-de-simulacros.md): fecha, ambiente, T, ids de los marcadores, hora de inicio de la restauración y de la verificación correcta (RTO), resultado de cada chequeo, avisos y responsable. Pegá el informe sin la sección `tables` si es muy largo; nunca pegues filas de datos.
8. **Borrá la copia**: servicio `postgres-simulacro-…` y su volumen, desde el panel o la CLI. Tiene datos de menores y de salud. Si abriste un proxy TCP para verificar, se va con el servicio.
9. Si algo falló: no se da por bueno el respaldo. Abrí un issue `area:infra` con el informe y repetí el simulacro después de corregir.

Los marcadores quedan en el origen para siempre (son append-only y no tienen datos personales): son la historia de los simulacros.

## 4. Restauración por un incidente

Casos: una migración que rompió datos, un borrado o una corrección masiva por error, un script que escribió de más. **No** es para una caída del servidor (eso lo cubre el HA) ni para deshacer la carga de un solo usuario (eso se corrige con el historial de cambios, ADR 0030).

1. **Pará las escrituras** que empeoran el daño: si el culpable es un job o un deploy, frená el `worker` o volvé el deploy atrás. Anotá la hora.
2. **Elegí T**: el último instante sano, antes del primer efecto del problema. Ayudan los logs (pino/Sentry: hora del deploy o del primer error) y el historial de cambios (`change_history.created_at`). En la duda, un poco antes.
3. **Restaurá a T** en un servicio hermano (`--new-service-name postgres-restore-AAAAMMDD`), igual que el paso 5 del simulacro.
4. **Verificá** la copia sin marcadores:
   ```bash
   RESTORE_DATABASE_URL='…' sport-performance-db-restore verify --target <T>
   ```
   Tiene que dar `"ok": true`. Revisá los conteos de las tablas afectadas contra lo que esperás.
5. **Decidí cómo recuperar:**
   - **Rescatar filas** (el daño es acotado, el origen sigue sano en lo demás): se leen de la copia las filas afectadas y se corrigen en el origen **por la API o con SQL como dueño fijando `app.change_reason`**, para que quede en el historial de cambios. El origen sigue sirviendo; la copia se borra al terminar. Es lo preferido: no se pierde nada de lo escrito después de T.
   - **Pasar el tráfico a la copia** (el daño es general): seguí con el paso 6.
6. **Pasar el tráfico a la copia:**
   1. Poné en mantenimiento: escalá `api` y `worker` a 0 réplicas.
   2. En la copia, como dueño: `RESTORE_DATABASE_URL='…' sport-performance-db-restore record --kind incident --environment production --target <T> --reason "<qué pasó, sin datos personales>"`. Esto cambia la época de sincronización: todos los dispositivos bajan sus datos de nuevo al conectarse.
   3. Cambiá las variables de `api` y `worker` (`DATABASE_URL`, `MIGRATIONS_DATABASE_URL`, la del rol `auth`) para que apunten al servicio restaurado. Los logins y sus contraseñas vienen en la copia (la restauración es física): solo cambia el host.
   4. Si el código desplegado tiene migraciones posteriores a T, `db:migrate` las aplica al arrancar (el chequeo `migrations` lo avisaba). Si la causa fue una migración, desplegá antes la corrección.
   5. Levantá `api` y `worker`. Revisá `/health/ready`, Sentry y los logs del worker.
   6. **Habilitá PITR en la copia** (`railway postgres pitr enable --service postgres-restore-AAAAMMDD`) y, en producción, **convertila a HA**. Hasta que `pitr status` muestre la primera base no hay punto de recuperación: no hagas cambios riesgosos mientras tanto.
   7. Mantené el servicio viejo **detenido, no borrado**, hasta que el club confirme que está todo bien (mínimo una semana); después borralo con su volumen.
7. **Después del corte, revisá lo que no vuelve atrás con la base:**
   - **Dispositivos:** lo que la app subió entre T y el corte y el servidor ya le había confirmado se perdió (la app lo sacó de su cola). Avisá al staff y a los jugadores de las categorías que cargaron en ese rango para que lo vuelvan a cargar. La lista sale de `change_history` y `sync_change` del servicio viejo (por categoría y día, sin exportar datos de salud).
   - **Cola de jobs y derivados:** los jobs pendientes vuelven al estado de T. Los recálculos por outbox (ADR 0046) se rehacen solos; revisá en los logs del worker que la cola se vacíe.
   - **Notificaciones** (ADR 0054): un aviso enviado entre T y el corte puede repetirse porque su registro de entrega se perdió.
   - **Archivos** (ADR 0044): uno subido después de T queda huérfano en el bucket (sin fila en `file`); uno purgado después de T figura `ready` sin objeto. Listá los dos casos comparando `file` con el bucket para ese rango y resolvelos (borrar el huérfano, marcar el faltante).
   - **Sesiones e invitaciones** creadas después de T no existen: algunos usuarios tendrán que ingresar de nuevo.
8. **Registrá** el incidente en el [registro](registro-de-simulacros.md) (tipo `incident`) y escribí el postmortem en el issue.

## 5. Dónde correr `sport-performance-db-restore`

Las bases de Railway están en la red privada del proyecto. Dos opciones, en este orden:

1. **Dentro del proyecto**: `railway ssh --service worker --environment <amb>` y correr el comando ahí (la imagen del worker incluye `@sport-performance/db`). Las URLs internas (`*.railway.internal`) funcionan y nada sale del proyecto.
2. **Desde la máquina del operador**, con el repo y `pnpm build`: abrí un proxy TCP **solo en el servicio restaurado**, solo mientras verificás, y usá esa URL con `sslmode=require`. El verificador solo lee agregados (nombres de tablas, conteos y horarios); no copies datos a la máquina. Cerrá el proxy al terminar (se cierra solo si borrás el servicio).

`mark` necesita la URL de dueño del **origen** (`MIGRATIONS_DATABASE_URL`); `verify` y `record`, la del **restaurado** en `RESTORE_DATABASE_URL`, que no tiene valor por defecto a propósito.

## 6. Reglas de privacidad

- Una copia de producción **es producción**: queda en el proyecto de Railway, con los mismos accesos. Nunca se restaura producción en staging, en otro proyecto ni en una máquina local.
- La copia de un simulacro se borra al terminar (servicio y volumen).
- Los informes, el registro y los issues llevan nombres de tablas, conteos, horarios e ids de marcadores; nunca filas, nombres de jugadores ni datos de salud.
- El motivo de `record` y las etiquetas de `mark` no llevan datos personales.

## 7. Qué queda por hacer (dueño de la cuenta de Railway)

Este repo trae la configuración, las herramientas y el procedimiento; **no** crea nada en Railway. Para dar por cumplido B-702 en el piloto:

- [ ] Con el proyecto de B-701 creado: pasos 1 a 5 de la sección 2 en `staging` y `production`.
- [ ] Primer simulacro en `staging` y anotarlo en el registro.
- [ ] Primer simulacro en `production` antes de cargar datos reales del club piloto y anotarlo.
- [ ] Recordatorio trimestral del simulacro de producción en el calendario del responsable.
