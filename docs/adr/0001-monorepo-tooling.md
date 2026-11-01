# 0001. Monorepo y tooling

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #14 (B-101)

## Contexto

`CLAUDE.md` fija pnpm workspaces + Turborepo y TypeScript estricto en todo, con `apps/{api,worker,web,mobile}` y `packages/{domain,contracts,ui-tokens,i18n,config}`. Faltaba decidir los detalles del tooling: versiones, sistema de módulos, cómo se consumen los paquetes internos y dónde vive la configuración compartida.

## Decisión

- **Gestor y orquestador:** pnpm (versión fijada en `packageManager`) y Turborepo. Tareas `build`, `lint`, `typecheck`, `test` y `dev`; todas dependen de `^build` y se cachean.
- **Node 24** (`engines` y `.nvmrc`).
- **TypeScript 6.0** (`~6.0`). TypeScript 7 (compilador nativo) ya salió, pero typescript-eslint todavía exige `< 6.1`. Se sube cuando typescript-eslint lo soporte, en un PR propio.
- **ESM en todo** (`"type": "module"`). Paquetes y servicios Node usan `module`/`moduleResolution` `NodeNext` (imports relativos con extensión `.js`). Web y mobile usan `moduleResolution: Bundler`, porque los compila Vite o Metro.
- **Paquetes internos compilados:** cada librería compila con `tsc` a `dist/` (JS + `.d.ts` + source maps) y publica un `exports` con `types`. Las apps dependen con `workspace:*`. Se eligió compilar, en vez de consumir el `.ts` fuente, porque la API y el worker corren en Node sin bundler y así el mismo artefacto sirve para los tres consumidores.
- **Dos tsconfig por paquete:** `tsconfig.json` (typecheck de fuente, tests y configs, sin emitir) y `tsconfig.build.json` (solo `src/`, sin tests, emite a `dist/`).
- **Flags estrictos** en `packages/config/tsconfig/base.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noUnused*`, `verbatimModuleSyntax`, `isolatedModules`.
- **ESLint 10 flat config** compartida (`createConfig` en `@sport-performance/config/eslint`): `@eslint/js` recommended + typescript-eslint `strictTypeChecked` y `stylisticTypeChecked` con `projectService`, imports de tipos consistentes, `no-console` (se usa pino), `eqeqeq`, y `eslint-config-prettier` al final. Se corre con `--max-warnings 0`.
- **Prettier** en la raíz para código y JSON. Markdown queda afuera: es prosa escrita a mano y el padding de tablas que agrega Prettier ensucia los diffs.
- **Vitest 5** con un preset compartido (`src/**/*.test.ts`, tests junto al código, cobertura v8, falla si no hay tests).
- **Dependencias con versión exacta** y el lockfile commiteado; `pnpm install --frozen-lockfile` en CI.

## Consecuencias

- Antes de typecheck, lint o test de un paquete, Turborepo compila sus dependencias internas; el caché hace que sea barato.
- Agregar un paquete nuevo es copiar la forma de uno existente (`package.json`, dos tsconfig, `eslint.config.js`, `vitest.config.ts`).
- Las apps son esqueletos sin framework; Fastify, pg-boss, Vite/React y Expo entran en sus issues. Expo trae su propio `tsconfig` base, que se combinará con el de `bundler.json` al integrarlo.
- `firmware/` no es parte del workspace: tendrá su propia toolchain.
