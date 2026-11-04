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

`APP_VARIANT`, `API_BASE_URL`, `WEB_APP_URL`, `EAS_PROJECT_ID` y `SENTRY_*` se explican en [`.env.example`](.env.example). Staging y producción exigen API y web https: sin ellas, la config falla. Las variables de EAS (y `SENTRY_AUTH_TOKEN`, un secreto) se cargan en el proyecto de EAS; este repo solo tiene la configuración. La versión nativa sale de `NATIVE_APP_VERSION` (`src/version/release.ts`, ADR 0045) y los números de build los incrementa EAS.

## Estructura

- `app/`: rutas de Expo Router. `_layout.tsx` arma los servicios una vez, aplica la compuerta de versión y las guardas por estado de la sesión (`(auth)` sin sesión, `select-club` sin club, `(app)` con club); `index.tsx` es el ancla que redirige; `invite/[token]` y `player-access/[token]` son los links; `+native-intent.tsx` normaliza las URLs que abren la app.
- `src/config`: variantes, config de Expo (pura) y config de runtime validada.
- `src/api`: cliente tipado con bearer, club y versión; textos de errores; cliente de TanStack Query.
- `src/auth`, `src/clubs`, `src/branding`, `src/linking`, `src/observability`, `src/version`: lógica sin React Native.
- `src/state`: servicios de la app, controlador de sesión, compuerta de versión y contextos de React (`useServices`, `useApi`, `useSession`, `useClubTheme`).
- `src/offline`: base local y sincronización (B-502, [ADR 0069](../../docs/adr/0069-base-local-y-motor-de-sincronizacion-mobile.md)): driver, esquema Drizzle y migraciones (`db/`), cola y validación (`operations.ts`), lectura con lo pendiente superpuesto (`local-store.ts`, `overlay.ts`), motor (`engine.ts`), disparadores, tarea en segundo plano y textos del indicador.
- `src/test-day`: el día de test en cancha (B-505, [ADR 0076](../../docs/adr/0076-dia-de-test-en-cancha.md)): lo sincronizado y la cola compuestos por jugador y estación, y lo que encola cada acción (`model.ts`, puro), la planilla guardada en el teléfono y la descarga de la semana (`data.ts`), lo que hacen las pantallas fuera de React (`controller.ts`) y el puente con las señales del 30-15 (`ift.ts`). Las reglas de carga (campos, parseo, mejor intento, rango plausible) son las de la web, de `@sport-performance/contracts`.
- `src/coach-session`: la sesión del entrenador en cancha (B-509, [ADR 0080](../../docs/adr/0080-sesion-del-entrenador-en-cancha.md)): modelo puro de la planilla y del reloj de quién está en cancha (`model.ts`), lectura y guardado sobre la base local y la caché de lecturas (`data.ts`), lo que muestran las pantallas (`view.ts`) y los hooks de las rutas `app/(app)/sessions.tsx` y `app/(app)/session.tsx`.
- `src/platform`: lo nativo (`expo-secure-store`, AsyncStorage, `expo-application`, `expo-updates`, `expo-localization`, `expo-sqlite` con SQLCipher, `expo-network`, `expo-background-task`) detrás de interfaces.
- `src/reaction`: test de reacción (B-606, [ADR 0077](../../docs/adr/0077-test-de-reaccion-en-la-app.md)): este teléfono como equipo del club (id de instalación), corrida de las series con el reloj monotónico, resultado por la cola y comparación solo con el mismo jugador en el mismo equipo.
- `src/weekly-cmj`: CMJ semanal de M17/M19 (B-506, [ADR 0079](../../docs/adr/0079-cmj-semanal-en-la-app.md)): reglas puras (`model.ts`: plantel por etapa, resultados de la base local y la cola, base y veredicto con las funciones del motor de alertas, mutaciones) y datos (`data.ts`: lecturas guardadas y escrituras por la cola).
- `src/screens`: pantallas de presentación (datos y callbacks por props); `src/ui`: tema, traductor, primitivas accesibles y fuentes.

Los imports llevan la extensión `.ts` / `.tsx` (ADR 0058).

## Pantallas nuevas

1. Ruta en `app/(app)/…` que lee datos con `useApi()` y `useQuery` (query key que empiece por la membresía activa) y los pasa a un componente de `src/screens`.
2. Textos en `packages/i18n` (es-AR, vos); estados siempre con `StatusMessage` (ícono + texto).
3. Test del componente con `renderScreen` (`src/test/render.tsx`) y, si hay lógica, test en Node.

## Datos sin conexión (B-502)

La app lee de la base local y la red solo sincroniza (ADR 0015, 0050 y 0069). Una pantalla:

- **escribe** con `services.sync.enqueue(op, input)`: `op` es una de `SYNC_OPERATIONS` y `input` lo que pide `SYNC_OPERATION_INPUTS` (el mismo contrato del servidor), con `clientUuid` en cada alta, fila de lote e intento. Se valida, se guarda con su HLC en una transacción y se pide una sincronización;
- **lee** con `services.sync.store.list(membershipId, collection, filtro)` / `get`: la fila del servidor con las ediciones pendientes superpuestas (`pending: true`), y las altas que todavía no volvieron con `store.pending(membershipId, [op])`;
- **muestra el estado** con `useSyncStatus()` y `SyncIndicator`.
- lee de la base local con `useLocalRead` (se repite al cambiar la cola o terminar un ciclo) y las lecturas de la API que no viajan por la sincronización con `useOfflineRead` (`src/state/offline-reads.ts`): la última respuesta queda en `cached_read` por membresía y se muestra sin señal ([ADR 0074](../../docs/adr/0074-app-del-jugador-lecturas-propias-y-cache-local.md)).

La app del jugador (B-503) está en `src/player` (racha, récords, sesiones a puntuar: funciones puras), `src/screens/player-*.tsx` y `src/state/player-screens.tsx`; sus pestañas ("Hoy", "Mis tests") y Consentimientos solo aparecen con el rol `player`.

Lo que una pantalla necesita sin señal y no es una colección va a `services.readCache` (la misma `cached_read`): las lecturas del jugador por `useOfflineRead` y, en el día de test, la planilla de cada día y el contexto del club (`put` con la membresía, `get` y `list` con su contrato, ADR 0076), en el CMJ semanal, el plantel, el protocolo y los ajustes (ADR 0079), y en la sesión del entrenador, el plantel de cada sesión, la zona horaria del club y los borradores (ADR 0080); se borra con la membresía al cerrar sesión.

Una operación que no vuelve en un pull (el reporte de dolor, datos de salud: ADR 0078) se marca `forgetOnAck` en `OPERATION_SPECS` y sale de la cola apenas el servidor la aplica. Una operación de edición nueva suma su superposición en `src/offline/overlay.ts` y sus filas en `OPERATION_SPECS`; un cambio del esquema local es una migración nueva al final de `src/offline/db/migrations.ts` (el test la compara con `schema.ts`). Cerrar sesión borra todo lo del club en el teléfono.

## Tests

`pnpm --filter @sport-performance/mobile test`. Vitest en Node para la lógica (con el cliente tipado real contra un `fetch` falso, `src/test/fake-api.ts`; la base local sobre `node:sqlite` real, `src/test/node-sqlite.ts`, y el protocolo de sincronización en memoria, `src/test/fake-sync-server.ts`) y Testing Library sobre `react-native-web` en jsdom para las pantallas (`// @vitest-environment jsdom`). Para verificar que el bundle arma: `pnpm --filter @sport-performance/mobile exec expo export --platform ios --output-dir /tmp/sp-export`.

## Versiones (B-324, ADR 0045)

`src/version` tiene la versión nativa (`NATIVE_APP_VERSION`, fuente única de `expo.version`), la política de `runtimeVersion` (`appVersion`), los headers de versión del cliente tipado, el chequeo de compatibilidad con caché para usar sin conexión y el modelo de la pantalla "Actualizá la app", que `app/_layout.tsx` muestra al iniciar, al volver al primer plano y ante un `426`. Cada release a las tiendas sube `NATIVE_APP_VERSION`.
