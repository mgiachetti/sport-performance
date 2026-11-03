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
- `src/platform`: lo nativo (`expo-secure-store`, AsyncStorage, `expo-application`, `expo-updates`, `expo-localization`) detrás de interfaces.
- `src/screens`: pantallas de presentación (datos y callbacks por props); `src/ui`: tema, traductor, primitivas accesibles y fuentes.

Los imports llevan la extensión `.ts` / `.tsx` (ADR 0058).

## Pantallas nuevas

1. Ruta en `app/(app)/…` que lee datos con `useApi()` y `useQuery` (query key que empiece por la membresía activa) y los pasa a un componente de `src/screens`.
2. Textos en `packages/i18n` (es-AR, vos); estados siempre con `StatusMessage` (ícono + texto).
3. Test del componente con `renderScreen` (`src/test/render.tsx`) y, si hay lógica, test en Node.

## Tests

`pnpm --filter @sport-performance/mobile test`. Vitest en Node para la lógica (con el cliente tipado real contra un `fetch` falso, `src/test/fake-api.ts`) y Testing Library sobre `react-native-web` en jsdom para las pantallas (`// @vitest-environment jsdom`). Para verificar que el bundle arma: `pnpm --filter @sport-performance/mobile exec expo export --platform ios --output-dir /tmp/sp-export`.

## Versiones (B-324, ADR 0045)

`src/version` tiene la versión nativa (`NATIVE_APP_VERSION`, fuente única de `expo.version`), la política de `runtimeVersion` (`appVersion`), los headers de versión del cliente tipado, el chequeo de compatibilidad con caché para usar sin conexión y el modelo de la pantalla "Actualizá la app", que `app/_layout.tsx` muestra al iniciar, al volver al primer plano y ante un `426`. Cada release a las tiendas sube `NATIVE_APP_VERSION`.
