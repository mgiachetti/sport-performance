# @sport-performance/e2e

Tests de punta a punta (B-108, [ADR 0096](../../docs/adr/0096-tests-de-punta-a-punta.md)): el stack real con el club demo y Playwright sobre la web del staff. El arnés (`@sport-performance/e2e/harness`) lo usan también los tests de punta a punta de mobile (`apps/mobile/e2e`).

## Correr

Hace falta un Postgres 16 (el de los tests de integración sirve: cada corrida crea su propia base al arrancar y la borra, con sus logins, al bajar) y la API, el worker y la web compilados, la web con la URL de la API del stack:

```sh
VITE_API_URL=http://127.0.0.1:3100 pnpm turbo run build \
  --filter=@sport-performance/api --filter=@sport-performance/worker --filter=@sport-performance/web
pnpm --filter @sport-performance/e2e e2e:install-browser   # una vez: Chromium de Playwright

export E2E_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres   # dueño del servidor
pnpm --filter @sport-performance/e2e e2e                     # levanta el stack, corre y lo baja
pnpm --filter @sport-performance/mobile test:e2e             # con un stack corriendo (ver abajo)
```

Para iterar, el stack en una terminal y los tests en otra (Playwright usa el que ya está corriendo):

```sh
pnpm --filter @sport-performance/e2e e2e:stack
pnpm --filter @sport-performance/e2e e2e -- --ui              # o --headed, --debug, -g "coach"
pnpm --filter @sport-performance/e2e exec playwright show-report
```

Con `E2E_STORAGE_URL=http://<usuario>:<clave>@localhost:9000` (el MinIO de los tests de integración; también toma `STORAGE_TEST_URL`) el stack crea un bucket propio de la corrida, se lo pasa a la API y al worker, instala el escudo de ORC (`assets/clubs/orc/escudo.png`) en el club demo con `installClubLogo` (el mismo camino que la subida del admin, [ADR 0097](../../docs/adr/0097-sistema-de-diseno-de-la-web.md)) y borra el bucket al bajar. Sin ella corre sin archivos: el demo muestra su sigla en vez del escudo y las subidas están apagadas. CI la usa.

Variables (todas opcionales salvo la base): `E2E_DATABASE_URL` (o `DATABASE_URL`), `E2E_DATABASE_NAME` (`sport_performance_e2e`, hasta 56 caracteres; se borra al bajar el stack y también al arrancar, por si quedó de una corrida que murió; con otro nombre, dos stacks conviven en el mismo servidor), `E2E_API_PORT` (3100), `E2E_WEB_PORT` (4174), `E2E_RUN_DIR` (`apps/e2e/.e2e-run`). Si se cambia el puerto de la API, la web se compila con esa URL: el stack se niega a arrancar con una web que llama a otra API.

## Qué levanta el stack (`src/stack/main.ts`)

1. Una base nueva que declara su entorno (`app.deployment_environment = 'test'`), todas las migraciones y un login por rol de conexión con el nombre de la base como prefijo (`sport_performance_e2e_api`, `_worker`, `_auth`) con contraseñas al azar por corrida.
2. El club demo `demo-e2e` (semilla `e2e`, 35 días de historia) con `runDemoSeed`, lo mismo que `db:seed:demo` con su guarda (ADR 0055), hasta hoy (la API mide sus ventanas con el reloj real). Más una lesión abierta hoy en un jugador de M17/M19 de rugby con el que ningún escenario ingresa (`src/stack/fixtures.ts`): el demo solo lesiona en temporada.
3. La API compilada (`127.0.0.1:3100`, `NODE_ENV=test`, sin `RESEND_API_KEY`), el worker (notificaciones apagadas) y la web compilada con `vite preview` (`127.0.0.1:4174`).

En `.e2e-run/` quedan `state.json` (día y opciones del demo, para recalcular el dataset, y la lesión del fixture; se valida al leerlo), `mailbox.jsonl` (los emails que la API escribió en su log: los códigos de ingreso) y los logs de cada proceso. En CI se suben como artefacto cuando algo falla, con el reporte, las trazas y los videos de Playwright.

## Capturas para revisar el diseño

Con un stack corriendo (mismas variables `E2E_*`):

```sh
pnpm --filter @sport-performance/e2e screenshots
```

Abre la sesión de cada cuenta del demo (el proyecto `setup`), recorre las secciones de la barra lateral y, desde cada una, el primer detalle de cada tipo (`/players/:id`), y guarda capturas de página completa a 1440 y 390 px, en oscuro y en claro alto contraste, en `<E2E_RUN_DIR>/screenshots/<ancho>-<variante>/<cuenta>-NN-<ruta>.png`. Al terminar `screenshots/index.ts` escribe `index.json`, `index.txt` (archivo y ruta) e `index.html` (hoja de contactos). `SCREENSHOTS_WORKERS` (2) y `SCREENSHOTS_MAX_PAGES` (40 por cuenta y vista) ajustan la carga. No es un test, no corre en CI y las capturas no se commitean (el directorio de la corrida está ignorado).

## Escribir un escenario

- **Sesión:** `test.use({ storageState: sessionFile('coachRugbySenior') })`; las cuentas están en `DEMO_ACCOUNTS` (`src/harness/demo.ts`) y `tests/sessions.setup.ts` abre una sesión por cuenta antes de los escenarios. Para probar el ingreso mismo: `mailboxMark` antes de pedir el código y `waitForSignInCode` después.
- **Datos:** del dataset (`dataset()` en `tests/support.ts`), nunca nombres copiados: `activePlayers`, `recentlyHeldPlayers`, `childrenOf`, `userByEmail`.
- **Textos:** `t('clave')` del catálogo `es-AR`; elementos por rol y nombre accesible (`pageTitle`, `mainNav`, `getByRole`, `getByLabel`).
- **Escrituras:** solo filas propias con un texto único (`E2E <uuid>`): los escenarios corren en paralelo sobre el mismo club.
- Si el calendario del demo no da lo que el escenario necesita todos los días, se agrega como fixture del stack (`src/stack/fixtures.ts`, en `state.json`) y el escenario falla si falta: nunca `test.skip` por el calendario.

## Tests del arnés

`pnpm --filter @sport-performance/e2e test` (Vitest, `src/**/*.test.ts`): configuración, lectura del log de la API con el mailer real y los helpers del dataset. Corren en `pnpm test`; los escenarios no.
