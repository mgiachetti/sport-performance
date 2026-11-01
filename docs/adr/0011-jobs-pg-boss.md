# 0011. Jobs en `apps/worker` con pg-boss

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

Hay trabajo que no debe correr dentro del request: recalcular cargas (EWMA, ACWR, monotonía), maduración y alertas después de cada sincronización y cada noche; enviar emails; procesar importaciones de Catapult y de padrón; y, en Fase 3, procesar el crudo del pod (ADR 0005). Los volúmenes son los de clubes deportivos (cientos de jugadores por club), no los de una red social.

## Decisión

- **`apps/worker`** es un servicio separado de la API, de larga vida, que consume la cola.
- **pg-boss** como cola, **sobre la misma Postgres**. No se agrega Redis ni otro broker.
- Los jobs se encolan, siempre que se pueda, **dentro de la misma transacción** que escribe los datos que los disparan: si la transacción se revierte, el job no existe.
- Los jobs se hacen **idempotentes** (se pueden reintentar sin efectos duplicados) y llevan el `club_id`. El worker fija el contexto RLS de ese club antes de tocar datos (ADR 0006).
- Los recálculos periódicos usan las tareas programadas (cron) de pg-boss, partidas en un job por club y calculando "el día" en la zona horaria del club.

## Por qué pg-boss

- Una pieza menos de infraestructura para operar, respaldar y asegurar: la cola tiene la misma HA y PITR que los datos (ADR 0003).
- El encolado transaccional elimina la clase de bugs "se guardó el dato pero no se encoló el recálculo" (o al revés), que con un broker externo obliga a un outbox.
- El volumen esperado está muy por debajo de lo que una cola sobre Postgres (con `SKIP LOCKED`) soporta.

## Alternativas descartadas

- **BullMQ + Redis.** Más rendimiento y herramientas, pero suma un servicio y pierde la transaccionalidad con los datos.
- **SQS u otra cola administrada.** Ata a un proveedor de nube y tampoco es transaccional con la base.
- **Cron del sistema o timers dentro de la API.** Sin reintentos, sin visibilidad y se pierden en cada deploy.

## Consecuencias

- La cola usa conexiones y espacio de la base de producción: se configura la retención de jobs completados y se monitorea el tamaño de las tablas de pg-boss.
- Si algún día el volumen lo exige (por ejemplo, el procesamiento del pod a escala), se escribe un ADR nuevo para mover esos jobs a otra cola, sin cambiar el resto.
