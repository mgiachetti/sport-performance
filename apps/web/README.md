# @sport-performance/web

Web del staff (B-401): React 19 + Vite + TanStack Router + TanStack Query ([ADR 0012](../../docs/adr/0012-web-staff-react-vite-tanstack.md)). La estructura está decidida en [ADR 0057](../../docs/adr/0057-estructura-de-la-web-del-staff.md); esto es la guía para trabajar.

## Correr

```sh
cp apps/web/.env.example apps/web/.env.local   # VITE_API_URL=http://localhost:3000
pnpm --filter @sport-performance/web dev       # http://localhost:5173
```

La API se levanta como dice [su README](../api/README.md#correr); en desarrollo ya acepta `http://localhost:5173` en `WEB_ORIGINS`. Sin `RESEND_API_KEY` la API escribe el código de ingreso en su log. `pnpm --filter @sport-performance/web build` deja los estáticos en `dist/` (`preview` los sirve); el deploy es de B-701.

## Mapa

| Carpeta | Qué hay |
|---|---|
| `src/router.tsx` | Árbol de rutas: `/login`, `_authed` (sesión), `/clubs`, `/support`, `_club` (layout del club) y sus pantallas. |
| `src/app/` | `createWebApp` (stores, cliente, caché, router), `App` (providers) y `useServices()`. |
| `src/api/` | Cliente web (`createWebApiClient`), selección de club y sus headers, estado de conexión, errores (`describeError`), política de reintentos y consultas compartidas (`queries.ts`). |
| `src/club/` | `ActiveClub` (`useActiveClub()`), carga y validación del club, deporte y categoría (`useScope()`). |
| `src/permissions/` | `useCan`, `<Can>`, `<RequirePermission>`, `canSomewhere` sobre la matriz de `packages/domain`. |
| `src/layout/` | Shell del club (`AppShell`), navegación (`navigation.ts`), selectores de alcance y de colores. |
| `src/pages/` | Ingreso, selector de club, soporte, inicio, "la web es para el staff", 404 y error. `pages/panel/`: panel semanal (B-403, [ADR 0059](../../docs/adr/0059-panel-semanal-lectura-agregada-y-bio-banding.md)). |
| `src/pages/players/` | Plantel (`/players`) y ficha del jugador (`/players/$playerId`, B-404, [ADR 0060](../../docs/adr/0060-lecturas-de-la-ficha-del-jugador.md)): un bloque por permiso de la matriz, cada uno con su consulta. |
| `src/status/` | Estado de conexión, monitor (`onlineManager` + `/v1/health`) y aviso de pestaña vieja. |
| `src/theme/` | Tema en runtime (`ThemeStore`, `ThemeController`). |
| `src/lib/` | Utilidades sin UI: `alertText` (texto de una alerta con sus valores formateados es-AR). |
| `src/ui/` | Componentes base (`Button`, `TextField`, `Notice`, `ErrorNotice`, `Page`, `Stripes`, `Icon`) y campos de formulario (`SelectField`, `TextAreaField`, `StatusLabel`, en `fields.tsx`). |
| `src/training/` | Sesiones y carga del entrenador (B-407): lista, alta, detalle con bloques y planilla de participación. |
| `src/field-sessions/` | Vista de sesión en cancha (B-408, [ADR 0061](../../docs/adr/0061-vista-de-sesion-en-cancha.md)): lista de sesiones con datos de cancha y la vista de una sesión (resumen, barras por jugador, tabla). |
| `src/test/` | Setup de Vitest, API falsa, fixtures y `renderApp`. |

## Agregar una pantalla

1. **Ruta:** hija de `clubRoute` en `src/router.tsx` (hereda sesión, club, tema y `?sport&category`). Los search params propios se validan con `validateSearch`.
2. **Navegación:** una entrada en `NAV_ITEMS` (`src/layout/navigation.ts`) con el permiso de la matriz (`navItem({ to, labelKey, icon, permission: { kind: 'test_session', action: 'read' } })`). Un rol que no puede hacerlo en nada de lo que ve no la ve.
3. **Datos:** consultas con `clubQueryKey(selection, …)` y el cliente tipado (`useServices().api`); nada de `fetch` suelto. Las altas mandan `clientUuid` y las ediciones `expectedVersion` (ADR 0032): las mutaciones se reintentan cuando no hubo respuesta.
4. **Permisos:** `useCan(kind, action, { category | player })` o `<RequirePermission>` con la categoría o el jugador concreto; la API decide igual.
5. **Alcance:** `useScope()` da el deporte y la categoría elegidos (`null` = todo lo que ve).
6. **Textos:** en `packages/i18n` (es-AR, vos); fechas y cifras con sus formateadores y `useActiveClub().club.timeZone`. Estados siempre con ícono y texto (`Notice`).
7. **Errores:** `<ErrorNotice error={query.error} />`; el error boundary de la ruta cubre lo que tire una consulta con suspense.
8. **Página:** `<Page title=…>` pone el título del documento y mueve el foco al navegar.
9. **Tests:** `renderApp({ path, handlers: { ...signedIn({ memberships: [membership('sc')] }), listTests: () => page([...]) } })` y Testing Library por rol y texto. Los fixtures pasan por la validación del cliente: tienen que cumplir el contrato. `api.callsTo('operationId')` muestra qué se pidió con qué headers.

## Tests

```sh
pnpm --filter @sport-performance/web test
pnpm --filter @sport-performance/web exec vitest run src/app/app.test.tsx
```

jsdom, sin red: todo pasa por la API falsa. `api.unhandled` lista los pedidos que ningún handler contestó.
