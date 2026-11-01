# 0005. Crudo del pod en storage, sin TimescaleDB

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

En Fase 3 cada jugador usa un pod GNSS + IMU con firmware propio. Una sesión genera series de alta frecuencia: posición a decenas de Hz y aceleraciones a cientos de Hz por jugador. Con un plantel de 30 jugadores y una sesión de 90 minutos son decenas de millones de muestras por sesión. De ese crudo salen las métricas de cancha con códigos canónicos (`dist_m`, `hsr_abs_m`, `vmax_ms`, `acc_n`, `accel_load_au`, etc.), que son lo que consulta el staff y lo que se compara con primera.

Los algoritmos que transforman el crudo en métricas (filtrado, detección de aceleraciones, umbrales de HSR relativos a la Vmax del jugador) van a cambiar con el tiempo, y cada cambio puede requerir reprocesar sesiones viejas.

## Decisión

- **El crudo se guarda como archivo en el bucket S3-compatible** (ADR 0003): inmutable, con versión de firmware y de formato. La ruta incluye el club, para que el aislamiento por tenant también rija en storage.
- **En Postgres solo van las métricas derivadas** (por sesión, por tramo y por jugador) y los metadatos del archivo (ubicación, hash, tamaño, versión del algoritmo que lo procesó).
- El procesamiento lo hace el worker (ADR 0011): lee el archivo, calcula y escribe las métricas. Reprocesar es volver a encolar el job con otra versión del algoritmo.
- **No se usa TimescaleDB** ni otra extensión de series temporales.

## Por qué

- Las consultas reales del producto son sobre métricas agregadas (panel, ACWR, comparación con primera), no sobre muestras individuales. Guardar el crudo en tablas haría crecer la base en órdenes de magnitud por datos que casi no se consultan.
- El archivo inmutable es la fuente de verdad para reprocesar; la base queda chica y rápida de respaldar y de restaurar con PITR.
- TimescaleDB es una extensión que no todos los Postgres administrados ofrecen, y parte de sus funciones tiene licencia propia; sumarla ataría la elección de proveedor (en contra de ADR 0003) para resolver un problema que no tenemos.
- El storage de objetos es mucho más barato por GB que el disco de una base con HA.

## Consecuencias

- Ver la traza cruda de una sesión (por ejemplo, para un mapa de calor) requiere leer el archivo, no una consulta SQL. Si eso se vuelve frecuente, se generan derivados livianos (series submuestreadas), también como archivo.
- La retención y el borrado del crudo tienen que cubrir los derechos del titular (exportar y borrar los datos de un jugador).
- El formato concreto del archivo se decide en el issue del pipeline del pod.
