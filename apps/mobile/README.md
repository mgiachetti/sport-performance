# @sport-performance/mobile

App mobile para jugadores, familias y staff: Expo (React Native) con dev builds, EAS Build y EAS Update (ADR 0013), una sola app white-label para todos los clubes (ADR 0014). La base (B-501) está descripta en el [ADR 0058](../../docs/adr/0058-base-de-la-app-mobile.md).

## Correr un dev build

La app usa módulos nativos (Keychain, Sentry, updates), así que corre en un **dev build**, no en Expo Go.

```sh
cp apps/mobile/.env.example apps/mobile/.env   # API local por defecto
# la API en http://localhost:3000: ver apps/api/README.md
pnpm --filter @sport-performance/mobile ios     # o android: genera ios/ o android/ y lo instala
pnpm --filter @sport-performance/mobile start   # después, solo el bundler
```

`expo run:*` genera `ios/` y `android/` (Continuous Native Generation): no se editan ni se commitean. En un teléfono real, `API_BASE_URL` es la IP de la máquina en la red (`http://192.168.x.y:3000`); en el emulador de Android, `http://10.0.2.2:3000`.

`pnpm --filter @sport-performance/mobile config` muestra la config que resulta de las variables.

## Variantes, builds y updates

| Variante | App id | Esquema | Canal de EAS Update | Perfil de `eas.json` |
|---|---|---|---|---|
| `development` | `com.sportperformance.app.dev` | `sportperformance-dev` | `development` | `development`, `development-simulator` |
| `staging` | `com.sportperformance.app.staging` | `sportperformance-staging` | `staging` | `staging` |
| `production` | `com.sportperformance.app` | `sportperformance` | `production` | `production` |

`APP_VARIANT`, `API_BASE_URL`, `WEB_APP_URL`, `EAS_PROJECT_ID` y `SENTRY_*` se explican en [`.env.example`](.env.example). Staging y producción exigen API y web https: sin ellas, la config falla. Las variables de EAS (y `SENTRY_AUTH_TOKEN`, un secreto) se cargan en el proyecto de EAS; este repo solo tiene la configuración. El proyecto de EAS es `@mgiachetti/sport-performance`; el ambiente `preview` (perfil `staging`) tiene `API_BASE_URL`, `WEB_APP_URL` y `EAS_PROJECT_ID`. Un APK de staging para probar: `eas build -p android --profile staging` desde `apps/mobile` con esas tres variables también en el entorno local (EAS lee `app.config.ts` en la máquina antes de subir). EAS lee la config de nuevo en su servidor justo después de instalar, antes de cualquier hook: por eso `postinstall` (`scripts/eas-postinstall.mjs`) compila ahí los paquetes del workspace que importa la app; fuera de EAS no hace nada. La versión nativa sale de `NATIVE_APP_VERSION` (`src/version/release.ts`, ADR 0045) y los números de build los incrementa EAS.

## Estructura

- `app/`: rutas de Expo Router. `_layout.tsx` arma los servicios una vez, aplica la compuerta de versión y las guardas por estado de la sesión (`(auth)` sin sesión, `select-club` sin club, `(app)` con club); `index.tsx` es el ancla que redirige; `invite/[token]` y `player-access/[token]` son los links; `+native-intent.tsx` normaliza las URLs que abren la app.
- `src/config`: variantes, config de Expo (pura) y config de runtime validada.
- `src/api`: cliente tipado con bearer, club y versión; textos de errores; cliente de TanStack Query.
- `src/auth`, `src/clubs`, `src/branding`, `src/linking`, `src/observability`, `src/version`: lógica sin React Native.
- `src/state`: servicios de la app, controlador de sesión, compuerta de versión y contextos de React (`useServices`, `useApi`, `useSession`, `useClubTheme`).
- `src/offline`: base local y sincronización (B-502, [ADR 0069](../../docs/adr/0069-base-local-y-motor-de-sincronizacion-mobile.md)): driver, esquema Drizzle y migraciones (`db/`), cola y validación (`operations.ts`), lectura con lo pendiente superpuesto (`local-store.ts`, `overlay.ts`), motor (`engine.ts`), disparadores, tarea en segundo plano y textos del indicador.
- `src/test-day`: el día de test en cancha (B-505, [ADR 0076](../../docs/adr/0076-dia-de-test-en-cancha.md)): lo sincronizado y la cola compuestos por jugador y estación, y lo que encola cada acción (`model.ts`, puro), la planilla guardada en el teléfono y la descarga de la semana (`data.ts`), lo que hacen las pantallas fuera de React (`controller.ts`) y el puente con las señales del 30-15 (`ift.ts`). Las reglas de carga (campos, parseo, mejor intento, rango plausible) son las de la web, de `@sport-performance/contracts`.
- `src/coach-session`: la sesión del entrenador en cancha (B-509, [ADR 0080](../../docs/adr/0080-sesion-del-entrenador-en-cancha.md)): modelo puro de la planilla y del reloj de quién está en cancha (`model.ts`), lectura y guardado sobre la base local y la caché de lecturas (`data.ts`), lo que muestran las pantallas (`view.ts`) y los hooks de las rutas `app/(app)/sessions.tsx` y `app/(app)/session.tsx`.
- `src/staff`: la vista rápida del staff antes de entrenar (B-510, [ADR 0081](../../docs/adr/0081-staff-en-el-celular.md)), pura; `src/notifications`: registro del token push por sesión, ruteo del toque en un aviso (`routing.ts`, el lugar donde una pantalla nueva toma su `data.path`) y el manejador de toques.
- `src/platform`: lo nativo (`expo-secure-store`, AsyncStorage, `expo-application`, `expo-updates`, `expo-localization`, `expo-sqlite` con SQLCipher, `expo-network`, `expo-background-task`) detrás de interfaces.
- `src/reaction`: test de reacción (B-606, [ADR 0077](../../docs/adr/0077-test-de-reaccion-en-la-app.md)): este teléfono como equipo del club (id de instalación), corrida de las series con el reloj monotónico, resultado por la cola y comparación solo con el mismo jugador en el mismo equipo.
- `src/weekly-cmj`: CMJ semanal de M17/M19 (B-506, [ADR 0079](../../docs/adr/0079-cmj-semanal-en-la-app.md)): reglas puras (`model.ts`: plantel por etapa, resultados de la base local y la cola, base y veredicto con las funciones del motor de alertas, mutaciones) y datos (`data.ts`: lecturas guardadas y escrituras por la cola).
- `src/sprint-video`: sprint por video (B-605, [ADR 0082](../../docs/adr/0082-sprint-por-video-foto-finish.md)): permisos y destino del intento, armado de la cancha, marcado cuadro a cuadro, guardado por la cola y videos temporales que se borran.
- `src/anthropometry`: la planilla de antropometría en cancha (B-508, [ADR 0083](../../docs/adr/0083-antropometria-en-cancha.md)): modelo puro (parseo es-AR, reglas, plausibilidad del dominio, entradas de la cola) y lecturas de la base local, de la cola y del contexto en caché.
- `src/external-load`: carga externa del jugador (B-511, [ADR 0084](../../docs/adr/0084-carga-externa-informada-por-el-jugador.md)): formulario, lista de la semana con lo pendiente de la cola y día del club con la zona horaria guardada en el teléfono.
- `src/cmj-video`: CMJ por video (B-604, [ADR 0085](../../docs/adr/0085-cmj-por-video.md)): marcado cuadro a cuadro (`marking.ts`), el intento por la cola (`attempt.ts`), los videos que esperan en el teléfono (`captures.ts`) y su subida cuando el intento está en el servidor (`uploader.ts`, `service.ts`).
- `src/platform`: lo nativo (`expo-secure-store`, AsyncStorage, `expo-application`, `expo-updates`, `expo-localization`, `expo-sqlite` con SQLCipher, `expo-network`, `expo-background-task`, la cámara de `react-native-vision-camera` y los cuadros exactos del módulo propio `modules/cmj-frames`) detrás de interfaces.
- `modules/`: módulos nativos propios de la app (Expo Modules, autolinkeados): `cmj-frames` da el cuadro exacto de un tiempo y la duración de un video (ADR 0085).
- `src/screens`: pantallas de presentación (datos y callbacks por props); `src/ui`: tema (con el escudo del club activo, `useClubMark`), traductor, fuentes y las primitivas del sistema de diseño ([ADR 0098](../../docs/adr/0098-sistema-de-diseno-de-la-app.md)): `primitives.tsx` (`ScreenBody`, `ScreenHeader`, `Card`, `Button`, `StatusMessage`, `TextField`…), `blocks.tsx` (`StatusChip`, `KpiTile`, `ListRow`, `EmptyState`, `SegmentedControl`) y `choices.tsx` (escalas de bienestar y RPE).

Los imports llevan la extensión `.ts` / `.tsx` (ADR 0058).

## Pantallas nuevas

1. Ruta en `app/(app)/…` que lee datos con `useApi()` y `useQuery` (query key que empiece por la membresía activa) y los pasa a un componente de `src/screens`.
2. Textos en `packages/i18n` (es-AR, vos); la pantalla compone las primitivas de `src/ui` (encabezado con `ScreenHeader`, tarjetas con título, estados siempre con `StatusMessage` o `StatusChip`: ícono + texto), sin colores ni tamaños sueltos; una escena en la galería para mirarla.
3. Test del componente con `renderScreen` (`src/test/render.tsx`) y, si hay lógica, test en Node.

## Datos sin conexión (B-502)

La app lee de la base local y la red solo sincroniza (ADR 0015, 0050 y 0069). Una pantalla:

- **escribe** con `services.sync.enqueue(op, input)`: `op` es una de `SYNC_OPERATIONS` y `input` lo que pide `SYNC_OPERATION_INPUTS` (el mismo contrato del servidor), con `clientUuid` en cada alta, fila de lote e intento. Se valida, se guarda con su HLC en una transacción y se pide una sincronización;
- **lee** con `services.sync.store.list(membershipId, collection, filtro)` / `get`: la fila del servidor con las ediciones pendientes superpuestas (`pending: true`), y las altas que todavía no volvieron con `store.pending(membershipId, [op])`;
- **muestra el estado** con `useSyncStatus()` y `SyncIndicator`.
- lee de la base local con `useLocalRead` (se repite al cambiar la cola o terminar un ciclo) y las lecturas de la API que no viajan por la sincronización con `useOfflineRead` (`src/state/offline-reads.ts`): la última respuesta queda en `cached_read` por membresía y se muestra sin señal ([ADR 0074](../../docs/adr/0074-app-del-jugador-lecturas-propias-y-cache-local.md)).
- **guarda lo que no es una colección** (categorías, plantel, contexto de cada jugador) con `services.readCache.put(scope, key, value)` y lo lee con `readCache.get(membershipId, key, schema)`: se lee primero lo guardado y se refresca con señal; se borra con la membresía.

La app del jugador (B-503) está en `src/player` (racha, récords, sesiones a puntuar: funciones puras), `src/screens/player-*.tsx` y `src/state/player-screens.tsx`; sus pestañas ("Hoy", "Mis tests") y Consentimientos solo aparecen con el rol `player`.

Lo que una pantalla necesita sin señal y no es una colección va a `services.readCache` (la misma `cached_read`): las lecturas del jugador por `useOfflineRead` y, en el día de test, la planilla de cada día y el contexto del club (`put` con la membresía, `get` y `list` con su contrato, ADR 0076), en el CMJ semanal, el plantel, el protocolo y los ajustes (ADR 0079), y en la sesión del entrenador, el plantel de cada sesión, la zona horaria del club y los borradores (ADR 0080); se borra con la membresía al cerrar sesión.

Una operación que no vuelve en un pull (el reporte de dolor, datos de salud: ADR 0078) se marca `forgetOnAck` en `OPERATION_SPECS` y sale de la cola apenas el servidor la aplica. Una operación de edición nueva suma su superposición en `src/offline/overlay.ts` y sus filas en `OPERATION_SPECS`; un cambio del esquema local es una migración nueva al final de `src/offline/db/migrations.ts` (el test la compara con `schema.ts`). Cerrar sesión borra todo lo del club en el teléfono.

## Notificaciones (B-510)

El worker manda los avisos (ADR 0054); la app registra el token de Expo de la sesión (`services.push`) cuando el sistema lo permite y nunca pide el permiso al abrir: lo pide cuando la persona activa las notificaciones (vista del staff o Cuenta → Notificaciones). Recibir push necesita `EAS_PROJECT_ID` y, para un build real, las credenciales de APNs y FCM cargadas en EAS; sin proyecto, la app dice que el build no recibe push. Un toque abre la ruta de `data.path` (`src/notifications/routing.ts`).

## Modo kiosco (B-504)

Un `coach`, `sc` o `admin` abre el kiosco desde Inicio ([ADR 0086](../../docs/adr/0086-modo-kiosco.md)): elige categorías y un PIN, la app trae los planteles (`GET /v1/categories/{id}/kiosk-roster`, guardados en la caché local) y desde ahí la raíz solo muestra `app/kiosk.tsx`, también después de matar la app. Cada jugador toca su nombre, confirma y carga bienestar y RPE por la cola (`wellness.submit` y `rpe.submit` con `playerId`); el turno se descarta al terminar, con "No soy yo" o tras un minuto sin tocar. Para salir hace falta el PIN (`src/kiosk/controller.ts`: hash con sal en el almacenamiento seguro, espera creciente después de 5 intentos). Lógica pura en `src/kiosk`, pantallas en `src/screens/kiosk.tsx`, contenedores en `src/state/kiosk-screens.tsx`. En el equipo del club conviene fijar la app con Acceso guiado (iOS) o Fijar pantalla (Android).

## Galería de pantallas (diseño)

Para mirar el diseño sin simulador ni API ([ADR 0098](../../docs/adr/0098-sistema-de-diseno-de-la-app.md)): `gallery/` monta las pantallas de `src/screens` con props de ejemplo por `react-native-web`, con las fuentes de la app y el escudo de ORC.

```sh
pnpm --filter @sport-performance/mobile gallery                 # http://localhost:4310 (índice de escenas)
pnpm --filter @sport-performance/mobile gallery:shots           # capturas en apps/mobile/.gallery-shots/
pnpm --filter @sport-performance/mobile gallery:shots /tmp/shots player-today-faces staff-board
```

Necesita los paquetes del workspace compilados (`pnpm turbo run build --filter=@sport-performance/mobile^...`) y el Chromium de Playwright (`pnpm --filter @sport-performance/e2e e2e:install-browser`). Cada escena se captura a 390 × 844 (escala 2), en oscuro y en claro alto contraste, a página completa; `?scene=<nombre>&variant=light-hc` la abre en el navegador. Una escena nueva: su nombre (y qué tocar antes de capturar) en `gallery/scene-list.ts` y su render en `gallery/scenes.tsx`. `GALLERY_PORT` cambia el puerto. Es una aproximación (fuentes, sombras y controles nativos difieren un poco): lo que dependa de la plataforma se mira en un dev build.

## Tests

`pnpm --filter @sport-performance/mobile test`. Vitest en Node para la lógica (con el cliente tipado real contra un `fetch` falso, `src/test/fake-api.ts`; la base local sobre `node:sqlite` real, `src/test/node-sqlite.ts`, y el protocolo de sincronización en memoria, `src/test/fake-sync-server.ts`) y Testing Library sobre `react-native-web` en jsdom para las pantallas (`// @vitest-environment jsdom`). Para verificar que el bundle arma: `pnpm --filter @sport-performance/mobile exec expo export --platform ios --output-dir /tmp/sp-export`.

### De punta a punta (B-108, ADR 0096)

- **En CI, sin dispositivo:** `pnpm --filter @sport-performance/mobile test:e2e` (`e2e/*.e2e.test.ts`, `vitest.e2e.config.ts`) corre el cliente de la app, su `SessionController` y su motor de sincronización sobre SQLite real contra la API del stack de [`apps/e2e`](../e2e/README.md), que tiene que estar corriendo (`pnpm --filter @sport-performance/e2e e2e:stack`): ingreso por código con token bearer, bienestar cargado sin red que espera en la cola, se sube al volver la red y vuelve por `/v1/sync/changes`. No es parte de `pnpm test`.
- **UI nativa con Maestro: fuera de CI, todavía sin flujos.** Necesita un dev build (`eas build --profile development` o `expo run:android`) instalado en un emulador o dispositivo, y el stack de `apps/e2e` alcanzable desde ahí (en el emulador de Android, `10.0.2.2` en vez de `127.0.0.1`; `API_BASE_URL` del build apuntando a esa API). Los flujos a cubrir cuando entre: ingreso por código (el código del `mailbox.jsonl` del stack, por `runScript` o `inputText` desde una variable), bienestar y RPE del jugador en menos de 20 segundos, el mismo bienestar sin conexión (modo avión) que se sube al volver, el día de test del staff sin conexión y el modo kiosco con su PIN. Para que corra en CI hace falta un dev build reproducible en el runner (o un artefacto de EAS por commit) y un runner con emulador; queda para cuando eso exista.

## Versiones (B-324, ADR 0045)

`src/version` tiene la versión nativa (`NATIVE_APP_VERSION`, fuente única de `expo.version`), la política de `runtimeVersion` (`appVersion`), los headers de versión del cliente tipado, el chequeo de compatibilidad con caché para usar sin conexión y el modelo de la pantalla "Actualizá la app", que `app/_layout.tsx` muestra al iniciar, al volver al primer plano y ante un `426`. Cada release a las tiendas sube `NATIVE_APP_VERSION`.
