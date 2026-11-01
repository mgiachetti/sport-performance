# 0020. Convenciones de los contratos de la API

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #19 (B-106)

## Contexto

`CLAUDE.md` fija que la API usa Fastify + `zod` y que los contratos viven en `packages/contracts`, con OpenAPI generado y cliente tipado para web y mobile. Faltaba decidir cómo se escriben esos contratos: formato de los datos en el cable, errores, paginación, versionado, cómo se genera el OpenAPI y cómo es el cliente. Hay que decidirlo antes del primer endpoint real, porque cambiarlo después rompe clientes mobile ya instalados.

## Decisión

- **Catálogo de endpoints como fuente única.** Cada endpoint se declara con `defineEndpoint` (método, ruta, params, query, body, respuesta, errores posibles, tags, `public` o `session`) y se agrega a `apiEndpoints`, indexado por `operationId` en `camelCase`. La API registra sus rutas desde ahí, el OpenAPI se genera desde ahí y el cliente expone un método por entrada. Los nombres `{param}` de la ruta se verifican contra el esquema de params, en tipos y al cargar el módulo.
- **zod 4, sin transformaciones.** Lo que viaja es lo que describe el esquema; los tipos salen de `z.input` / `z.output`. Se permiten `default` y `coerce` (query strings), no `transform`; la única normalización es pasar los UUID a minúsculas, que no cambia el tipo ni el JSON Schema.
- **Primitivos del dominio, no copias.** IDs, fechas de calendario y zonas horarias se validan con las guardas de `packages/domain` (`isUuid`, `isLocalDate`, `isTimeZone`) y su `z.output` es el tipo con marca del dominio (`Uuid`, `ClubId`, `PlayerId`, …, `LocalDate`, `TimeZone`). `contracts` depende de `domain`, nunca al revés.
- **Formato en el cable:** JSON con claves `camelCase` y unidades en el nombre (`heightCm`). IDs UUID (RFC 9562; el servidor los emite en minúsculas; los registros creados offline traen el UUID del cliente). Fecha-hora ISO 8601 con zona; el servidor emite UTC con milisegundos. Fechas de calendario `YYYY-MM-DD`, en la zona horaria del club. Zonas horarias IANA de una región (`UTC` o `Área/Lugar`; sin offsets fijos). Colores `#RRGGBB`. Las fechas son strings en el contrato, no `Date`.
- **Sobre de error único:** `{ error: { code, message, requestId?, details? } }`. `code` sale de un catálogo cerrado en `snake_case`, cada uno con su status HTTP (`validation_failed` 400, `unauthenticated` 401, `forbidden` 403, `not_found` 404, `conflict` 409, `rate_limited` 429, `internal_error` 500, `service_unavailable` 503, `bad_request` 400). `message` es para desarrolladores: la UI traduce por `code` con `packages/i18n`. `details` lista los problemas por campo (`path`, `code`, `message`). Lo que RLS oculta se responde `not_found`, nunca `forbidden`.
- **Compatibilidad hacia adelante:** las respuestas son objetos abiertos (el cliente ignora campos desconocidos y el OpenAPI no declara `additionalProperties: false`), y el cliente acepta códigos de error que todavía no conoce. Agregar campos opcionales o códigos no es un cambio incompatible; quitar o renombrar sí, y va con una versión nueva.
- **Versionado:** prefijo `/v1` en la ruta. `CONTRACT_VERSION` (semver) va en `info.version` del OpenAPI.
- **Paginación por cursor:** query `cursor?` (opaco) y `limit` (1–100, por defecto 50); respuesta `{ items, nextCursor }`, `null` al final. Es estable frente a inserciones concurrentes, a diferencia del offset.
- **OpenAPI 3.1** generado con `z.toJSONSchema` (JSON Schema 2020-12, el dialecto de 3.1), sin librerías extra. Los esquemas con `.meta({ id })` van a `components/schemas`; si un esquema se usa en request y response y sus formas difieren, el de entrada se llama `<Id>Input`. El documento es determinista, se commitea en `packages/contracts/openapi.json` y un test falla si quedó desactualizado; otro test lo valida contra el meta-esquema de OpenAPI 3.1. El generador está en la entrada `@sport-performance/contracts/openapi` para que no entre en los bundles de web y mobile.
- **Cliente tipado propio** (`createApiClient`), derivado del catálogo en tiempo de compilación, sin generación de código: valida el input antes de enviar y la respuesta al recibir, y usa una interfaz mínima de `fetch` que funciona en navegador, React Native y Node. Errores: `ApiError` (la API respondió un error), `ApiNetworkError` (sin respuesta) y `ApiContractError` (input inválido o respuesta fuera de contrato).

## Alternativas descartadas

- **Generar el cliente desde el OpenAPI** (openapi-typescript, orval). Agrega un paso de generación y una segunda fuente de tipos; con el catálogo en TypeScript los tipos ya están.
- **`@asteasolutions/zod-to-openapi` o `zod-openapi`.** Funcionan, pero zod 4 ya genera JSON Schema 2020-12 y el armado del documento es chico; una dependencia menos que siga las versiones de zod.
- **Paginación por offset.** Duplica o saltea filas cuando se insertan datos entre páginas (cargas del día, bienestar).
- **Fechas como `Date` con `transform`.** No son representables en JSON Schema y hacen que input y output difieran.

## Consecuencias

- Agregar un endpoint es declararlo, sumarlo a `apiEndpoints` y correr `pnpm --filter @sport-performance/contracts openapi`; el diff de `openapi.json` muestra el cambio de contrato en el PR.
- La API (Fastify) tiene que registrar las rutas desde el catálogo y responder errores con `apiError` / `toValidationIssues`; queda para el issue de la API.
- El esquema de seguridad `session` del OpenAPI es provisorio hasta que se integre Better Auth.
