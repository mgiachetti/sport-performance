# Sport Performance

Plataforma de rendimiento para deportes juveniles (M13 a M19), white-label multi-tenant. Contexto de producto y dominio en [`CLAUDE.md`](CLAUDE.md); backlog en [`docs/backlog.md`](docs/backlog.md); decisiones en [`docs/adr/`](docs/adr/).

## Requisitos

- Node 24 (`.nvmrc`)
- pnpm (versión fijada en `packageManager`; con Corepack: `corepack enable`)
- Docker, para Postgres local en los tests de integración

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm install` | Instala dependencias de todo el workspace |
| `pnpm build` | Compila los paquetes y servicios (`dist/`) en orden de dependencias |
| `pnpm lint` | ESLint con reglas *type-checked*, sin warnings permitidos |
| `pnpm typecheck` | `tsc --noEmit` en cada paquete |
| `pnpm test` | Vitest en cada paquete |
| `pnpm format` / `pnpm format:check` | Prettier en todo el repo |
| `pnpm dev` | Modo watch de cada paquete |

Todas las tareas pasan por Turborepo y se cachean. Para correr una tarea en un solo paquete: `pnpm turbo run test --filter=@sport-performance/domain`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) corre en cada PR y en cada push a `main`, con jobs en paralelo: `format`, `lint`, `typecheck`, `test`, `build` y `workflows` (actionlint y shellcheck). El job `test` tiene un Postgres 16 de servicio y expone `DATABASE_URL` para los tests de integración; localmente se levanta con Docker (`postgres:16`) y se exporta la misma variable.

El job **`ci`** agrega a todos los demás y es el único check requerido en `main`: si agregás un job, sumalo a `needs` de `ci` (el job `workflows` falla si falta). Las acciones de terceros se fijan por SHA de commit.

## Estructura

```
apps/
  api/        API HTTP (Fastify + zod, Better Auth, RLS)
  worker/     Jobs en segundo plano (pg-boss)
  web/        Web del staff (React + Vite + TanStack)
  mobile/     App de jugadores y staff (Expo)
packages/
  domain/     Modelo y fórmulas puras del dominio
  contracts/  Esquemas zod, OpenAPI y cliente tipado
  ui-tokens/  Tokens de diseño y tema por club
  i18n/       Mensajes ICU y formatos es-AR
  config/     tsconfig, ESLint y Vitest compartidos
mockups/      Maqueta de referencia (no es diseño final)
assets/       Marcas por club (assets/clubs/<club>/)
firmware/     Firmware del pod (Fase 3)
docs/         Backlog y ADRs
```

Las apps son por ahora esqueletos: cada framework entra con su propio issue del backlog.
