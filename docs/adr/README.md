# Architecture Decision Records

Una decisión por archivo, numerados `NNNN-titulo-corto.md`. Un ADR aceptado no se edita: si la decisión cambia, se escribe uno nuevo que lo reemplaza y se marca el anterior como `Reemplazado por NNNN`.

| # | Título | Estado |
|---|---|---|
| [0001](0001-monorepo-tooling.md) | Monorepo y tooling | Aceptado |
| [0002](0002-typescript-estricto.md) | TypeScript estricto en todo | Aceptado |
| [0003](0003-infra-railway.md) | Infraestructura en Railway | Aceptado |
| [0004](0004-postgres-drizzle.md) | PostgreSQL con Drizzle y migraciones SQL versionadas | Aceptado |
| [0005](0005-pod-crudo-en-storage.md) | Crudo del pod en storage, sin TimescaleDB | Aceptado |
| [0006](0006-multi-tenant-rls.md) | Multi-tenant con `club_id` y RLS sobre funciones propias `app.*` | Aceptado |
| [0007](0007-usuarios-globales-membresias.md) | Usuarios globales con membresías por club | Aceptado |
| [0008](0008-esquema-medical.md) | Datos de salud en un esquema `medical` separado y auditado | Aceptado |
| [0009](0009-api-fastify-zod.md) | API con Fastify, zod y contratos compartidos | Aceptado |
| [0010](0010-auth-better-auth.md) | Auth con Better Auth y OTP por email | Aceptado |
| [0011](0011-jobs-pg-boss.md) | Jobs en `apps/worker` con pg-boss | Aceptado |
| [0012](0012-web-staff-react-vite-tanstack.md) | Web del staff con React, Vite y TanStack; gráficos SVG propios | Aceptado |
| [0013](0013-mobile-expo-eas.md) | Mobile con Expo, dev builds, EAS Build y EAS Update (no PWA) | Aceptado |
| [0014](0014-app-unica-white-label.md) | Una sola app white-label para todos los clubes | Aceptado |
| [0015](0015-offline-sqlite-hlc.md) | Offline en mobile: SQLite, cola de mutaciones y resolución por campo con HLC | Aceptado |
| [0016](0016-observabilidad-sentry-pino.md) | Observabilidad con Sentry y logs estructurados con pino | Aceptado |
| [0017](0017-deporte-y-sexo-en-el-modelo.md) | Deporte y sexo en el modelo desde el día uno | Aceptado |
| [0018](0018-sin-facturacion.md) | Sin facturación por ahora | Aceptado |
| [0019](0019-i18n-y-formatos-es-ar.md) | i18n y formatos es-AR | Aceptado |
| [0020](0020-convenciones-contratos-api.md) | Convenciones de los contratos de la API | Aceptado |
| [0021](0021-seguridad-del-repo.md) | Seguridad del repositorio | Aceptado |
| [0022](0022-motor-de-reglas-de-alerta.md) | Motor de reglas de alerta declarativo | Aceptado |
| [0023](0023-convenciones-del-esquema-de-base.md) | Convenciones del esquema de base y del runner de migraciones | Aceptado |
| [0024](0024-estructura-de-la-api.md) | Estructura de la API: transacción con contexto de tenant, errores, probes y apagado | Aceptado |
| [0025](0025-matriz-de-permisos.md) | Matriz de permisos declarativa en el dominio | Aceptado |
| [0026](0026-roles-de-conexion-y-politicas-rls.md) | Roles de conexión, funciones `app.*` y políticas RLS por club y rol | Aceptado |
| [0027](0027-seeds-y-bootstrap-de-club.md) | Seeds y bootstrap de club | Aceptado |
| [0028](0028-auth-membresias-e-invitaciones-en-la-api.md) | Auth, membresías e invitaciones en la API | Aceptado |
| [0029](0029-esquema-medical-acceso-y-auditoria.md) | Esquema `medical`: acceso por funciones auditadas, disponibilidad derivada y soporte del superadmin auditado | Aceptado |
| [0030](0030-historial-de-cambios.md) | Historial de cambios por triggers en una tabla del club append-only | Aceptado |
| [0031](0031-endurecimiento-de-la-api.md) | Endurecimiento de la API: límites generales, headers, validación estricta, secretos y timeouts | Aceptado |
| [0032](0032-convenciones-de-endpoints.md) | Convenciones de endpoints: autorización, contexto de la transacción, soporte, listas, altas idempotentes, concurrencia y archivado | Aceptado |
| [0033](0033-sesiones-activas-por-dispositivo.md) | Sesiones activas por dispositivo y aviso de ingreso nuevo | Aceptado |
| [0034](0034-asignaciones-del-staff-y-membresias.md) | Asignaciones del staff y membresías: vigencia, fin, superposición y cambio de rol | Aceptado |
| [0035](0035-jugadores-y-plantel.md) | Jugadores y plantel: deporte del jugador, posiciones, altura de los padres, alta y baja, y pases de categoría | Aceptado |
| [0036](0036-calendario-temporadas-ventanas-y-fixture.md) | Calendario: temporadas como año de planificación, ventanas sin superponerse y fixture propio | Aceptado |
| [0037](0037-sesiones-participacion-y-rpe.md) | Sesiones, participación y RPE: ventana del jugador, carga masiva idempotente y sesiones archivables | Aceptado |
| [0038](0038-bienestar-diario.md) | Bienestar diario: versión de ítems por etapa, ventana de carga y corrección por el jugador | Aceptado |
| [0039](0039-tests-entradas-crudas-reglas-de-etapa-y-comparacion.md) | Tests: entradas crudas puntuadas en el servidor, reglas de etapa de la batería y aviso de comparación | Aceptado |
| [0040](0040-referencias-de-primera.md) | Referencias de primera: carga, corrección, archivo, importación y vista del jugador | Aceptado |
| [0041](0041-configuracion-del-club.md) | Configuración del club: vigencia de la batería y las zonas, reglas de alerta editables y módulos activos | Aceptado |
| [0042](0042-tutores-y-cuentas-de-menores.md) | Tutores y cuentas de menores: vínculo, invitación del hijo/a y código o link de un solo uso | Aceptado |

`pnpm docs:check` valida que este índice coincida con los archivos, que cada ADR siga la plantilla y que cada decisión de la tabla de arquitectura de `CLAUDE.md` tenga su ADR.

## Plantilla

```markdown
# NNNN. Título

- Estado: Propuesto | Aceptado | Reemplazado por NNNN
- Fecha: aaaa-mm-dd
- Issue: #N (B-xxx)

## Contexto

## Decisión

## Consecuencias
```
