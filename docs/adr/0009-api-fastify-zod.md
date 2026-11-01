# 0009. API con Fastify, zod y contratos compartidos

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

La API es la única puerta a la base (ADR 0003, 0006): la usan la web del staff, la app mobile (incluida la sincronización offline, ADR 0015) y, más adelante, importaciones e integraciones. Los clientes necesitan tipos exactos de requests y responses, y la validación de entrada tiene que ser la misma que conocen los clientes.

## Decisión

- **Fastify** como servidor HTTP en `apps/api`, con Better Auth montado como plugin (ADR 0010).
- **zod** para validar toda entrada y salida. Los esquemas viven en `packages/contracts` y son la única definición: la API los usa para validar y serializar, y los clientes para tipar.
- **OpenAPI generado** desde esos esquemas, y un **cliente tipado** generado o derivado de los mismos contratos para web y mobile. El OpenAPI documenta la API para integraciones externas.
- Cada request corre dentro de la transacción con contexto RLS (ADR 0006); un hook de Fastify la abre y la cierra.
- Errores con un formato único definido en los contratos; los mensajes visibles al usuario salen de `packages/i18n`, no de la API.

## Alternativas descartadas

- **tRPC.** Excelente tipado entre TS, pero acopla los clientes al servidor, no produce un contrato HTTP estándar y complica la API pública para integraciones.
- **NestJS.** Mucha estructura (decoradores, módulos, inyección) para un equipo chico; el tipado con zod queda en segundo plano.
- **Express.** Sin validación ni serialización por esquema de fábrica, y más lento.
- **Hono.** Muy bueno y liviano, pero Fastify tiene un ecosistema de plugins más maduro para lo que necesitamos (auth, rate limiting, multipart, OpenAPI).

## Consecuencias

- Un cambio de contrato rompe en compilación a la API y a los clientes en el mismo PR.
- El OpenAPI generado se versiona o se publica en CI para detectar cambios incompatibles.
- La lógica de dominio no vive en los handlers: los handlers validan, abren contexto y llaman a `packages/domain` y a la capa de datos.
