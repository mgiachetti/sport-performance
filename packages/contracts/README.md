# @sport-performance/contracts

Contrato HTTP de la API (B-106): esquemas `zod` de requests y responses, catálogo de endpoints, OpenAPI 3.1 generado y cliente tipado para web y mobile. Las decisiones están en [ADR 0020](../../docs/adr/0020-convenciones-contratos-api.md).

## Entradas

| Import | Qué trae |
|---|---|
| `@sport-performance/contracts` | Primitivas, catálogo `apiEndpoints`, `defineEndpoint`, errores, paginación y `createApiClient`. Sin dependencias de Node. |
| `@sport-performance/contracts/openapi` | `buildOpenApiDocument()` y `serializeOpenApiDocument()`. Para la API y el build, no para bundles de cliente. |
| `@sport-performance/contracts/openapi.json` | El documento generado y commiteado. |

## Convenciones

- **Sin transformaciones:** lo que viaja es lo que describe el esquema. `default` y `coerce` sí; `transform` no. La única normalización es pasar los UUID a minúsculas (`toLowerCase`, no cambia el tipo ni el JSON Schema).
- **Tipos del dominio:** los primitivos que el dominio ya define se validan con sus guardas (`isUuid`, `isLocalDate`, `isTimeZone` de `@sport-performance/domain`) y el `z.output` es el tipo con marca del dominio (`Uuid`, `ClubId`, `LocalDate`, `TimeZone`). No hay una segunda definición acá.
- **Claves `camelCase`** con unidades en el nombre (`heightCm`, `speedMs`).
- **IDs:** `uuidSchema` (→ `Uuid`), `clubIdSchema`, `userIdSchema`, `playerIdSchema`, `categoryIdSchema` (→ `ClubId`, …) e `idOf<Id>('entidad')` para el resto. UUID RFC 9562, se aceptan en cualquier caja y se emiten en minúsculas. Slugs: `slugSchema`.
- **Fechas:** `dateTimeSchema` (ISO 8601 con zona; el servidor emite UTC con ms), `localDateSchema` (`YYYY-MM-DD`, en la zona del club → `LocalDate`), `timeZoneSchema` (IANA de la región del club, `UTC` o `Área/Lugar`, sin offsets fijos como `Etc/GMT+3` → `TimeZone`). Son strings, no `Date`: la fecha-hora es la forma en el cable del `Instant` del dominio.
- **Colores:** `hexColorSchema` (`#RRGGBB`).
- **Errores:** todo status no 2xx responde `{ error: { code, message, requestId?, details? } }`. Catálogo y status en `ERROR_STATUS`; la API arma la respuesta con `apiError(code, message, { requestId, details })` y `toValidationIssues(issues, ['body'])`. La UI traduce por `code`; `message` es para desarrolladores.
- **Entradas estrictas:** `params`, `query` y `body` son `z.strictObject` en todos los niveles: una clave que el contrato no describe es `400 validation_failed` (`unrecognized_keys`), nunca se descarta en silencio. `defineEndpoint` falla al cargar si encuentra un objeto de entrada que no lo sea (`nonStrictObjectPaths`, [ADR 0031](../../docs/adr/0031-endurecimiento-de-la-api.md)). Las respuestas siguen abiertas.
- **Paginación:** query `pageQuerySchema` (`cursor?`, `limit` 1–100, por defecto 50) y respuesta `pageOf(item)` → `{ items, nextCursor }`.
- **Convenciones de recursos** ([ADR 0032](../../docs/adr/0032-convenciones-de-endpoints.md), `primitives/conventions.ts`): `clientUuidSchema` en las altas (reenviarla devuelve la fila ya creada, header `X-Idempotent-Replay`), `resourceVersionSchema` en cada recurso editable y `expectedVersionSchema` en sus `PATCH` (`409 conflict` si cambió), `sortQuerySchema(campos, defecto)` para el `sort` de las listas (`campo` / `-campo`), `archiveStatusQuerySchema` y `archivedAtSchema` para lo archivable, y `sportSchema`, `sexSchema`, `stageSchema`. Headers del superadmin: `SUPPORT_CLUB_HEADER` y `SUPPORT_REASON_HEADER`.
- **Auth:** `auth: 'public'` (sin sesión), `'session'` (usuario con sesión: cookie en la web, `Authorization: Bearer` en mobile) o `'club'` (sesión + membresía elegida con el header `X-Membership-Id`, `MEMBERSHIP_HEADER`; implícita si el usuario tiene una sola). Implícitos: `unauthenticated` para `session` y `club`, `forbidden` para `club` ([ADR 0025](../../docs/adr/0025-auth-membresias-e-invitaciones-en-la-api.md)).
- **Historial de cambios** (B-305, [ADR 0030](../../docs/adr/0030-historial-de-cambios.md)): `changeHistoryEntrySchema`, `changeHistoryPageSchema` y `changeHistoryQuerySchema` para las lecturas, y `changeReasonSchema` para el motivo que mandan las escrituras que corrigen datos ya cargados. Todavía sin endpoints: llegan con cada recurso.
- **Compatibilidad:** las respuestas son objetos abiertos; agregar campos o códigos de error no rompe clientes. Quitar o renombrar requiere versión nueva (`/v2`).

## Agregar un endpoint

1. Declararlo en `src/endpoints/<recurso>.ts`:

   ```ts
   export const getClubTheme = defineEndpoint({
     method: 'GET',
     path: '/v1/clubs/{clubSlug}/theme',
     summary: 'Tema del club',
     tags: ['clubs'],
     auth: 'public',
     params: z.strictObject({ clubSlug: clubSlugSchema }),
     response: { status: 200, description: 'Tema del club.', schema: clubThemeSchema },
     errors: ['not_found'],
   });
   ```

   Los esquemas reutilizables llevan `.meta({ id: 'NombreEnPascalCase' })` para salir como componente del OpenAPI. Los errores implícitos (`internal_error` y `rate_limited` siempre, `validation_failed` si hay input, `payload_too_large` si hay body, `unauthenticated` si es `session` o `club`, `forbidden` si es `club`) no se declaran.
2. Sumarlo a `apiEndpoints` en `src/endpoints/index.ts` (la clave es el `operationId`).
3. Regenerar el OpenAPI: `pnpm --filter @sport-performance/contracts openapi`. El test de deriva falla si `openapi.json` quedó viejo.

## Cliente

```ts
import { ApiError, createApiClient } from '@sport-performance/contracts';

const api = createApiClient({
  baseUrl: 'https://api.example.com',
  credentials: 'include', // web: cookie de sesión
  headers: async () => ({
    authorization: `Bearer ${await getToken()}`, // mobile
    'x-membership-id': await getSelectedMembership(), // club elegido en el selector
  }),
});

try {
  const theme = await api.getClubTheme({ params: { clubSlug: 'orc' } });
} catch (error) {
  if (error instanceof ApiError && error.code === 'not_found') {
    // mostrar t('errors.not_found')
  }
}
```

- `ApiError`: la API respondió un error (`status`, `code`, `details`, `requestId`, y `retryAfterS` cuando un `429` trae `Retry-After`). `code` puede ser un código que este build todavía no conoce.
- `ApiNetworkError`: no hubo respuesta (sin conexión, abortado: `aborted`).
- `ApiContractError`: el input no cumple el contrato (`side: 'request'`, no sale a la red) o la respuesta no lo cumple (`side: 'response'`, cliente y servidor desfasados). `validateResponses: false` desactiva la validación de respuestas.
