# 0094. Backups y recuperación: PITR de Railway verificado por simulacros con marcadores, verificación automática y época de sincronización

- Estado: Aceptado
- Fecha: 2026-11-04
- Issue: #100 (B-702)

## Contexto

ADR 0003 eligió Railway con Postgres en HA y restauración a un punto en el tiempo (PITR), pero un backup que nunca se restauró no es un backup: B-702 pide el PITR **verificado con una restauración de prueba documentada**. La base tiene datos de menores y de salud (esquema `medical`, ADR 0008 y 0029), así que la prueba no puede ser "mirar el panel" ni copiar producción a una máquina para revisarla.

El PITR de Railway (pgBackRest) archiva cada segmento de WAL en un bucket del proyecto, toma una base completa por semana y una diferencial por día y guarda las últimas 4 completas (unas 4 semanas de ventana). Restaurar crea un **servicio hermano** nuevo a partir del archivo, hasta el instante pedido, sin tocar el original; pasar el tráfico a ese servicio es manual. Hay que decidir cómo se prueba que la copia quedó **en el punto pedido** y sana, quién lo hace, cada cuánto, qué se registra, y qué pasa con lo que no vive en la base: los dispositivos que sincronizan sin conexión (ADR 0050) guardan un cursor `(txid, seq)` de una historia que, después de restaurar, la base ya no tiene.

## Decisión

- **Dos capas en Railway.** PITR habilitado en `staging` y `production` (imagen oficial `postgres-ssl` en tag mayor, `:16`, como pide Railway) y además backups de volumen programados (diarios y semanales) como segunda capa. Objetivos: RPO de 5 minutos en producción (el archivado empuja WAL al menos cada 60 s) y RTO de 2 horas hasta tener la copia verificada sirviendo. Los pasos de configuración y de operación están en el runbook [`docs/ops/backups-y-recuperacion.md`](../ops/backups-y-recuperacion.md).
- **Simulacro con marcadores.** Un esquema `ops` solo del dueño de la base (migración `0051_restore_drills`, como `support` en ADR 0029: ningún rol de conexión tiene `USAGE`, RLS habilitada sin políticas, append-only por trigger) guarda `ops.restore_drill_marker`. En la base de origen se escribe un marcador, se elige el instante objetivo, se escribe otro marcador y se restaura al objetivo: la copia **tiene que tener el primero y no el segundo**. Es la prueba de que el PITR restaura al punto pedido y no al último backup ni a "ahora".
- **Verificación automática, sin datos personales.** `sport-performance-db-restore verify` (en `packages/db`) se conecta como dueño a la copia (`RESTORE_DATABASE_URL`, nunca una variable que pueda apuntar al origen) y revisa: servidor promovido, migraciones aplicadas contra las del código, cola de jobs instalada, roles de conexión y sus logins, RLS habilitada y forzada en toda tabla del club y en `medical`, triggers presentes y habilitados, marcadores presentes y ausentes, y punto de recuperación efectivo (la última escritura `created_at` / `updated_at` de cualquier tabla no puede ser posterior al objetivo, con una tolerancia de reloj de 5 s). El informe es JSON con nombres de tablas, conteos y horarios, nunca el contenido de una fila; sale con código distinto de 0 si algo falla. `mark` escribe el marcador en el origen, con el ambiente que declara la base (`app.deployment_environment`, ADR 0055): un marcador de staging no se escribe en producción.
- **Registro del simulacro en el repo.** Cada simulacro se anota en [`docs/ops/registro-de-simulacros.md`](../ops/registro-de-simulacros.md) (fecha, ambiente, objetivo, marcadores, tiempos, resultado de cada chequeo y responsable). Cadencia: trimestral en producción, antes de cada migración riesgosa en staging, y después de cambiar la imagen o la configuración de Postgres.
- **Época de sincronización.** Antes de que una copia restaurada sirva tráfico, `sport-performance-db-restore record` escribe `ops.restore_event` en ella. `app.sync_epoch()` (`SECURITY DEFINER`, solo para el rol de la API) devuelve el id del último evento, y la API lo suma a la huella del cursor de `GET /v1/sync/changes`: todo cursor emitido antes del restore recibe `reset: true` y el dispositivo vuelve a bajar sus colecciones. Una base nunca restaurada tiene época vacía y la huella no cambia (los cursores actuales siguen valiendo). Como red por si alguien se olvida de `record`, un cursor con un `txid` mayor o igual al próximo que asignará el servidor (`pg_snapshot_xmax`) también es `reset`: ninguna transacción leída puede ser tan nueva en esta historia.
- **Privacidad de la copia.** Una copia de producción es producción: queda dentro del proyecto de Railway, con las mismas variables y accesos, nunca se restaura en staging ni en una máquina local, y la del simulacro se borra (servicio y volumen) al terminar. No se abre un proxy TCP público salvo durante la verificación y se cierra al terminar.

## Alternativas descartadas

- **Dar por bueno el PITR del proveedor sin probarlo.** Es exactamente lo que B-702 pide no hacer: una ventana truncada (cola de WAL llena por una caída del bucket), una imagen con versión menor fijada o un archivado roto solo aparecen al restaurar.
- **Comparar conteos de filas con el origen.** El origen siguió escribiendo después del objetivo: los conteos no coinciden aunque la restauración sea perfecta, y reconstruirlos "al instante T" no es posible desde afuera. Los marcadores dan una respuesta exacta de sí o no.
- **Verificar con un `pg_dump` del origen restaurado en Docker local.** Saca datos de salud de menores del proveedor y prueba otra cosa (un backup lógico), no el PITR.
- **Detectar el restore por la línea de tiempo de Postgres (`timeline_id`).** También cambia en cada failover del HA (sin pérdida de datos) y leerla requiere funciones de control con permisos que el rol de la API no debe tener. El evento explícito más el control del `txid` cubren el caso sin depender de eso.
- **Copia lógica cifrada fuera de Railway en este issue.** ADR 0003 la menciona como mitigación de una caída del proveedor; es otro mecanismo (un servicio con `pg_dump`, cifrado y un bucket de otro proveedor) y queda como issue aparte.

## Consecuencias

- Después de restaurar, los dispositivos bajan todo de nuevo una vez. Lo que un dispositivo subió después del objetivo y el servidor ya le había confirmado se pierde (el dispositivo lo sacó de su cola): el runbook pide avisar a los usuarios afectados para que lo vuelvan a cargar.
- La copia restaurada no archiva: hay que habilitar PITR (con su bucket nuevo) y volver a HA antes de darla por terminada; hasta entonces no hay punto de recuperación.
- Los archivos del bucket no vuelven atrás con la base: un archivo subido después del objetivo queda huérfano y uno purgado después del objetivo figura como `ready` sin objeto. El runbook lo incluye en la revisión posterior.
- Lo que pasó entre el objetivo y la restauración en la cola de jobs, las notificaciones y los avisos de email se pierde o se repite (ADR 0046, 0054); el runbook lo enumera.
- El verificador lee el catálogo: una tabla nueva entra sola en los conteos y en el punto de recuperación, y una tabla del club sin RLS forzada hace fallar el simulacro.
