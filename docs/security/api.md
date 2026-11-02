# Revisión de seguridad de la API (OWASP)

Checklist previo a producción de `apps/api` contra **OWASP API Security Top 10 (2023)** y **OWASP ASVS 4.0.3, nivel 2** (las secciones equivalen a los capítulos de ASVS 5.0). Cada ítem apunta a código y tests, o a un issue abierto cuando falta. Decisiones en [ADR 0028](../adr/0028-auth-membresias-e-invitaciones-en-la-api.md) (ingreso), [ADR 0031](../adr/0031-endurecimiento-de-la-api.md) (endurecimiento) y [ADR 0033](../adr/0033-sesiones-activas-por-dispositivo.md) (sesiones por dispositivo). La seguridad del repositorio (dependencias, secretos en git, workflows) está en [`docs/security.md`](../security.md).

Estados: **Hecho** (código + test), **Parcial** (lo base está, falta algo que se nombra), **Pendiente** (issue abierto), **N/A** (no aplica, con el motivo).

## Cuándo se revisa

- Antes del primer deploy a `production` (#99): se recorre la tabla entera y se actualiza el estado.
- En cada issue que agregue superficie: archivos (#56), importaciones (#61, #62, #90), exportación (#97), notificaciones (#59), sincronización offline (#54), consola de superadmin (#77). Ese PR actualiza las filas que toca.
- Si una fila pasa de **Hecho** a otra cosa, el PR lo dice.

## OWASP API Security Top 10 (2023)

| Riesgo | Control | Dónde | Estado |
|---|---|---|---|
| **API1 Broken Object Level Authorization** | Toda consulta corre en una transacción con `app.club_id / app.user_id / app.role` y RLS forzada en cada tabla del club; un objeto de otro club es `404`, nunca `403`. | `apps/api/src/db/database.ts`, `apps/api/src/http/endpoint.ts`; `apps/api/src/db/rls.pg.test.ts`, `apps/api/src/auth/club-access.pg.test.ts`, `packages/db/src/rls.*.integration.test.ts` | Hecho |
| | La membresía del header `X-Membership-Id` se valida contra la base en cada request. | `apps/api/src/auth/authenticate.ts`, `apps/api/src/auth/identity.ts`; `club-access.pg.test.ts` | Hecho |
| | Cada endpoint de recursos aplica la matriz de permisos (`authorize` de `packages/domain`) además de la RLS. | Matriz en `packages/domain/src/permissions` (#34). Endpoints: #44, #45, #46 y siguientes; las invitaciones todavía usan un chequeo de `admin` propio (`apps/api/src/routes/invitations.ts`). | Parcial |
| **API2 Broken Authentication** | OTP de 6 dígitos (CSPRNG de Better Auth), 5 min, hasheado, un solo uso, 3 intentos por código; límites por email y por IP con claves HMAC. | `apps/api/src/auth/better-auth.ts`, `apps/api/src/auth/rate-limit.ts`; `apps/api/src/auth/sign-in.pg.test.ts` | Hecho |
| | Sesión por cookie `HttpOnly`, `SameSite=Lax`, `Secure` y `__Secure-` con https; bearer solo en el body; sin cache de sesión (cerrar sesión corta en el request siguiente). | `apps/api/src/auth/better-auth.ts`, `apps/api/src/routes/auth.ts`; `sign-in.pg.test.ts` | Hecho |
| | Listar y cerrar sesiones de otros dispositivos (web y mobile, sin IP); cierre de todas las sesiones de un miembro al darlo de baja si no le queda otra membresía; aviso por email de un ingreso desde un dispositivo nuevo. | `apps/api/src/routes/sessions.ts`, `apps/api/src/auth/sessions.ts`, `apps/api/src/auth/member-sessions.ts`, `apps/api/src/routes/auth.ts`; `apps/api/src/auth/sessions.pg.test.ts` ([ADR 0033](../adr/0033-sesiones-activas-por-dispositivo.md)) | Hecho |
| **API3 Broken Object Property Level Authorization** | Entradas `z.strictObject` en todos los niveles: una clave desconocida es `400` (sin asignación masiva). `defineEndpoint` falla al cargar si un esquema de entrada no es estricto. | `packages/contracts/src/strict-input.ts`, `packages/contracts/src/endpoint.ts`; `packages/contracts/src/endpoint.test.ts`, `apps/api/src/security/security.test.ts` | Hecho |
| | Respuestas validadas contra el contrato antes de salir: un campo que el contrato no declara no sale (zod lo descarta) y una respuesta fuera de contrato es `500` con rollback. | `apps/api/src/http/endpoint.ts`; `apps/api/src/app.test.ts` | Hecho |
| | Datos de salud solo para `medical` y con auditoría de cada lectura. | #35 | Pendiente |
| **API4 Unrestricted Resource Consumption** | Límites generales por IP y por usuario por clase de ruta, `429` con `Retry-After`. | `apps/api/src/security/rate-limit.ts`; `security.test.ts`, `apps/api/src/security/rate-limit.pg.test.ts` | Hecho |
| | Body máximo global (1 MiB) y de 16 KiB en la clase `auth`; `413`. Params de hasta 100 caracteres; headers de hasta 16 KiB (`431`). Paginación con `limit` máximo 100. | `apps/api/src/app.ts`, `apps/api/src/http/endpoint.ts`, `packages/contracts/src/primitives/pagination.ts`; `security.test.ts` | Hecho |
| | Timeouts de request, headers, keep-alive y socket; máximo de conexiones; `statement_timeout` e `idle_in_transaction_session_timeout` en Postgres; timeout del envío a Resend. | `apps/api/src/app.ts`, `apps/api/src/config/env.ts`, `apps/api/src/db/database.ts`, `apps/api/src/email/resend.ts`; `security.test.ts`, `apps/api/src/email/email.test.ts` | Hecho |
| | Archivos: tamaño máximo firmado en la URL de subida, nunca por el body de la API. | #56 (clase `upload` reservada) | Pendiente |
| **API5 Broken Function Level Authorization** | Tres niveles de auth por endpoint en el contrato (`public`, `session`, `club`) aplicados por `registerEndpoint` (`401`/`403` antes de validar o tocar la base). | `apps/api/src/http/endpoint.ts`; `apps/api/src/app.test.ts`, `packages/contracts/src/endpoints/access.test.ts` | Hecho |
| | Acciones por rol con la matriz de permisos en cada endpoint. | Igual que API1 (#44 y siguientes) | Parcial |
| | Soporte de `superadmin` dentro de un club, con auditoría. | #77 | Pendiente |
| **API6 Unrestricted Access to Sensitive Business Flows** | Ingreso e invitaciones: límites propios además de los generales; respuesta igual exista o no la cuenta. | `apps/api/src/routes/auth.ts`, `apps/api/src/routes/invitations.ts`; `sign-in.pg.test.ts` | Hecho |
| | Invitaciones masivas, importaciones y exportaciones con sus propios límites. | #61, #62, #97 | Pendiente |
| **API7 Server Side Request Forgery** | La API no pide URLs que mande el cliente: solo habla con Postgres, Resend y Sentry, con destinos fijos por configuración. | — | N/A hoy; revisar en #56 (URLs firmadas) y #90 |
| **API8 Security Misconfiguration** | Headers de seguridad en toda respuesta (CSP estricta, `nosniff`, `DENY`, `no-referrer`, COOP/CORP, `no-store`), HSTS en producción, sin `X-Powered-By` ni `Server`. | `apps/api/src/security/headers.ts`, `apps/api/src/app.ts`; `security.test.ts` | Hecho |
| | CORS con lista exacta de orígenes (https en producción), credenciales solo para ellos; guard de origen contra CSRF; solo JSON. | `apps/api/src/app.ts`, `apps/api/src/auth/origin-guard.ts`, `apps/api/src/config/env.ts`; `security.test.ts`, `sign-in.pg.test.ts`, `apps/api/src/config/env.test.ts` | Hecho |
| | Errores con sobre genérico: un `5xx` nunca muestra internos; errores del router sin eco del path. | `apps/api/src/http/errors.ts`, `apps/api/src/app.ts`; `app.test.ts`, `security.test.ts` | Hecho |
| | Logins de base que no son dueños ni tienen `BYPASSRLS`; la API no arranca con otro. | `apps/api/src/main.ts`, `packages/db` (`assertConnectionRole`) | Hecho |
| | Configuración de Railway (TLS, dominios, variables por ambiente, red privada a Postgres). | #99 | Pendiente |
| **API9 Improper Inventory Management** | Un solo catálogo de endpoints genera rutas, OpenAPI y cliente; compilar falla si un endpoint del contrato no está servido ni pendiente. | `packages/contracts/src/endpoints/index.ts`, `apps/api/src/routes/index.ts`; `packages/contracts/src/openapi/document.test.ts` | Hecho |
| | Versión de la API, versión mínima de la app y ambientes separados. | #55, #99 | Pendiente |
| **API10 Unsafe Consumption of APIs** | Resend: respuesta validada, errores sin destinatario, timeout. Sentry: sin datos personales ni de salud. | `apps/api/src/email/resend.ts`, `apps/api/src/observability/sentry.ts`; `email.test.ts`, `apps/api/src/observability/sentry.test.ts` | Hecho |
| | Importaciones de Catapult y planillas: validación de cada fila, límites de tamaño, sin fórmulas en exportaciones (CSV injection). | #90, #62, #97 | Pendiente |

## OWASP ASVS 4.0.3 (nivel 2), lo que aplica a la API

| ASVS | Requisito | Dónde | Estado |
|---|---|---|---|
| V2.2.1 | Controles contra automatización (fuerza bruta, credential stuffing). | Límites de ADR 0028 + generales de ADR 0031 | Hecho |
| V2.7.2, V2.7.3 | Código fuera de banda que vence (5 min) y se usa una vez. | `better-auth.ts`; `sign-in.pg.test.ts` | Hecho |
| V2.7.6 | Código generado con CSPRNG, al menos 20 bits. | Better Auth email OTP, 6 dígitos (~20 bits) + 3 intentos por código | Hecho |
| V2.5.x | Recuperación de cuenta. | No hay contraseñas: el ingreso es el código por email | N/A |
| V3.1.1 | Tokens de sesión nunca en la URL. | Cookie o `Authorization`; el token de invitación va en el body | Hecho |
| V3.2.1, V3.2.3 | Token nuevo al ingresar; guardado seguro en el navegador. | Better Auth; cookie `HttpOnly` | Hecho |
| V3.3.1 | Cerrar sesión invalida el token en el servidor. | `POST /v1/auth/sign-out`; `sign-in.pg.test.ts` | Hecho |
| V3.3.2 | Vencimiento de la sesión. | 30 días renovables (`SESSION_EXPIRES_IN_DAYS`) | Hecho |
| V3.3.3, V3.3.4 | Cerrar las demás sesiones; ver las sesiones activas. | `GET /v1/me/sessions`, `DELETE /v1/me/sessions/{sessionId}`, `POST /v1/me/sessions/revoke-others`; baja de un miembro con `revokeSessionsOfEndedMembership`; `sessions.pg.test.ts` | Hecho |
| V3.4.1–V3.4.3 | Cookie `Secure`, `HttpOnly`, `SameSite`. | `better-auth.ts`; `sign-in.pg.test.ts` | Hecho |
| V3.4.4 | Prefijo `__Host-`. | Se usa `__Secure-` (Better Auth); `__Host-` exige `Path=/` sin `Domain`, revisar al configurar dominios en #99 | Parcial |
| V4.1.1, V4.1.3 | Control de acceso en el servidor, mínimo privilegio. | RLS por rol + niveles de auth del contrato; roles de conexión (ADR 0026) | Hecho |
| V4.2.1 | IDOR. | RLS (API1) | Hecho |
| V4.2.2 | CSRF. | `origin-guard.ts`, `SameSite`, solo JSON | Hecho |
| V4.3.1 | MFA para administración. | Consola de superadmin | #77 |
| V5.1.1–V5.1.4 | Validación positiva, tipada, sin asignación masiva ni contaminación de parámetros. | Contratos zod estrictos; `security.test.ts` | Hecho |
| V5.3.4 | Consultas parametrizadas. | Drizzle y `pg` con parámetros; sin SQL armado con strings de entrada | Hecho |
| V5.5.2 | Parser JSON sin contaminación de prototipo. | `onProtoPoisoning` / `onConstructorPoisoning: 'error'`; `security.test.ts` | Hecho |
| V6.2.1, V6.3.1 | Algoritmos aprobados; aleatoriedad con CSPRNG. | SHA-256 de tokens, HMAC-SHA-256 de claves, `randomBytes` | Hecho |
| V6.4.1, V6.4.2 | Secretos fuera del código; no expuestos. | Variables de Railway validadas con zod; en producción largo, entropía y valores de ejemplo controlados; `env.test.ts`, `apps/api/src/security/secrets.test.ts` | Hecho |
| V7.1.1, V7.1.2 | Sin credenciales, tokens ni datos sensibles en logs. | Serializadores y `redact` de pino; resumen de config sin secretos; `secrets.test.ts`, `env.test.ts` | Hecho |
| V7.4.1 | Error genérico con id para soporte. | Sobre con `requestId`; `app.test.ts` | Hecho |
| V8.1.1 | Datos sensibles fuera de caches. | `Cache-Control: no-store` por defecto; `security.test.ts` | Hecho |
| V8.3.1 | Datos sensibles en el body o headers, no en la query. | Email, código y tokens en el body; los logs no guardan la query | Hecho |
| V8.3.4 | Datos de salud identificados y protegidos. | #35 | Pendiente |
| V8.3.x | Exportar y borrar los datos de un titular. | #60 | Pendiente |
| V9.1.1, V9.2.x | TLS en todo el tráfico, también a la base. | Railway termina TLS; HSTS en producción; TLS a Postgres en #99 | Parcial |
| V10.3.2, V14.2.1 | Dependencias al día y sin vulnerabilidades conocidas. | Dependabot, `pnpm audit` (ADR 0021) | Hecho |
| V11.1.4 | Límites de negocio contra automatización. | Clases de ruta (ADR 0031); flujos masivos en #61, #62, #97 | Parcial |
| V12.1.1 | Tamaño máximo de archivos. | #56 | Pendiente |
| V13.1.3 | URLs sin datos sensibles. | Tokens en el body; ids opacos | Hecho |
| V13.2.1 | Solo los métodos declarados. | El router solo registra el método del contrato; otros son `404` | Hecho |
| V13.2.2 | Validación de esquema JSON de la entrada. | Contratos zod | Hecho |
| V13.2.3 | CSRF en APIs con cookie. | `origin-guard.ts` | Hecho |
| V13.2.5 | `Content-Type` validado. | Solo `application/json`; otro es `400` | Hecho |
| V14.3.2 | Sin modos de debug en producción. | `NODE_ENV=production`; `LOG_LEVEL` | Hecho |
| V14.3.3 | Headers sin versiones de componentes. | Sin `Server` ni `X-Powered-By`; `security.test.ts` | Hecho |
| V14.4.1 | `Content-Type` con charset. | `application/json; charset=utf-8` | Hecho |
| V14.4.2 | `Content-Disposition: attachment` en respuestas de API. | Mitigado por CSP `sandbox` + `nosniff`; los archivos de B-325 se sirven desde el bucket con su propio header | Parcial |
| V14.4.3–V14.4.7 | CSP, `nosniff`, HSTS, `Referrer-Policy`, `frame-ancestors`. | `headers.ts`; `security.test.ts` | Hecho |
| V14.5.2 | `Origin` no se usa para autenticar. | El guard de origen solo rechaza; la identidad sale de la sesión | Hecho |
| V14.5.3 | CORS con lista estricta. | `app.ts`, `env.ts`; `security.test.ts` | Hecho |

## Límites por defecto

| Clase | Rutas | Por IP / min | Por usuario / min |
|---|---|---|---|
| `public` | GET públicos, `/openapi.json`, 404 | 300 | — |
| `auth` | Públicos que cambian estado (código, verificación, invitaciones) | 60 | — |
| `read` | GET con sesión | 1200 | 600 |
| `write` | POST, PUT, PATCH, DELETE con sesión | 600 | 120 |
| `upload` | URLs de subida (B-325) | 120 | 30 |
| `exempt` | `/health/live`, `/health/ready`, preflights | — | — |

Además, los del ingreso de ADR 0028 (por email y por IP, cada 15 minutos). Valores en `apps/api/src/security/rate-limit.ts`.
