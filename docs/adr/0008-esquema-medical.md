# 0008. Datos de salud en un esquema `medical` separado y auditado

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

Lesiones, conmociones, altas y bloqueos son datos de salud de menores: datos sensibles según la Ley 25.326, con el estándar de protección más alto. Al mismo tiempo, el entrenador necesita saber si un jugador está disponible para planificar la sesión, sin ver el diagnóstico. El producto no es un dispositivo médico: monitorea carga, nunca diagnostica, y la conmoción la gestiona el staff médico con su protocolo.

## Decisión

- **Esquema de Postgres `medical` separado** para todos los datos de salud. Ninguna tabla del esquema general guarda diagnósticos ni notas clínicas.
- **Políticas propias.** Además de la RLS por club (ADR 0006), las tablas de `medical` solo son visibles para el rol `medical` del club. Los grants del esquema también se restringen, como segunda barrera.
- **Disponibilidad sin diagnóstico.** El resto de los roles ve solo un estado derivado (disponible, no disponible, con restricciones), expuesto por una vista o función que no revela la causa. El `coach` ve "no disponible", nunca el porqué.
- **Auditoría de cada lectura y escritura.** Todo acceso a datos de `medical` deja un registro append-only (quién, cuándo, qué jugador, qué operación) en la misma transacción. El rol de la aplicación no puede modificar ni borrar ese registro.
- Lo que el jugador o su tutor ven de su propia salud se define en el issue correspondiente, con el mismo esquema y la misma auditoría.

## Consecuencias

- Es posible dar acceso, respaldar, exportar o borrar los datos de salud por separado del resto.
- Cada endpoint que toca `medical` tiene tests de RLS por rol y tests de que la auditoría se escribe.
- El soporte del `superadmin` sobre datos de salud queda auditado igual que cualquier otro acceso.
- Logs y Sentry nunca reciben datos de `medical` (ADR 0016).
