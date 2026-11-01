# 0016. Observabilidad con Sentry y logs estructurados con pino

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

Los errores pueden pasar en cuatro lugares (web, mobile, API, worker), y en mobile muchas veces offline y lejos de quien lo puede arreglar. Un error en la sincronización o en un recálculo de cargas puede producir alertas falsas o esconder alertas reales. Al mismo tiempo, los datos son de menores y en parte de salud: no pueden terminar en un servicio de terceros por accidente.

## Decisión

- **Sentry** para errores y trazas en web, mobile, API y worker, con un proyecto por pieza y un ambiente por `staging` / `production`. Releases y source maps se suben en el build (incluidos los de EAS Update, ADR 0013).
- **pino** para logs estructurados en JSON en la API y el worker, con un id de request o de job en cada línea y propagado entre API, cola y worker. `console` está prohibido por lint (ADR 0001).
- **Sin datos personales ni de salud** en logs ni en Sentry: se loguean ids, nunca nombres, emails, métricas de un jugador ni nada del esquema `medical` (ADR 0008). Se configura el scrubbing de Sentry y la redacción de campos de pino como defensa adicional, no como único control.
- Los usuarios se identifican en Sentry solo por id interno.

## Alternativas descartadas

- **Solo logs.** No sirve para mobile ni para la web, donde el error ocurre en el dispositivo.
- **Stack de observabilidad propio (Grafana, Loki, OpenTelemetry Collector).** Más control, pero es otro sistema que operar; se puede sumar más adelante sin cambiar el código de logs, porque pino emite JSON estándar.

## Consecuencias

- Revisar en cada PR que un log o un breadcrumb nuevo no agregue datos personales.
- Los acuerdos de tratamiento de datos con Sentry entran en la revisión legal junto con los de Railway (ADR 0003).
