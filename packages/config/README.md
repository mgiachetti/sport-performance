# @sport-performance/config

Configuración compartida del monorepo.

| Export                                            | Uso                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `@sport-performance/config/tsconfig/node.json`    | Librerías y servicios Node (ESM, `NodeNext`)                                                                      |
| `@sport-performance/config/tsconfig/bundler.json` | Código que compila un bundler (Vite, Metro): `moduleResolution: Bundler`, DOM                                     |
| `@sport-performance/config/tsconfig/base.json`    | Flags estrictos comunes a las dos anteriores                                                                      |
| `@sport-performance/config/eslint`                | `createConfig({ tsconfigRootDir, browser? })`: flat config con typescript-eslint _strict type-checked_ + Prettier |
| `@sport-performance/config/vitest`                | Preset de Vitest (tests `src/**/*.test.ts`, cobertura v8)                                                         |
