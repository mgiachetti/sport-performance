# 0100. Navegación de la app: una pila alrededor de las pestañas, como mucho cinco pestañas

- Estado: Aceptado
- Fecha: 2026-11-06
- Issue: #252 (B-501)

## Contexto

La app tenía un solo navegador de pestañas (`app/(app)/_layout.tsx`, `expo-router/js-tabs`). Todo lo que se abre desde una pestaña (las herramientas de cancha, la planilla de una sesión, el detalle de una alerta, los consentimientos, el ciclo, la carga externa) estaba declarado como pestaña oculta (`href: null`) y se abría con `router.push`. En expo-router 58, `href: null` pasa a `hidden: true`, y navegar a una pestaña oculta redirige a la primera: en el primer APK de staging todas esas pantallas volvían a Inicio. Los tests de componentes montan las pantallas sin el router, así que no lo veían.

La barra de pestañas medía 49 dp con el hueco del ícono vacío arriba de la etiqueta, y la etiqueta (línea de 18 dp) quedaba cortada abajo. El staff tenía siete pestañas (Inicio, Gimnasio, Tests, Sesiones, Plantel, Protocolos, Cuenta) y los nombres se truncaban ("Gimn…", "Sesio…"). La pestaña Gimnasio del staff era solo un aviso de que las rutinas se cargan en la web.

## Decisión

- **Pila alrededor de las pestañas.** `app/(app)/_layout.tsx` es un `Stack` con el grupo `(tabs)` (las pestañas) y, encima, cada pantalla que se abre desde una pestaña: `ift-3015`, `reaction`, `weekly-cmj`, `sprint-video`, `anthropometry`, `cmj-video`, `kiosk-setup`, `protocols`, `pain-report`, `menstrual-cycle`, `external-load`, `session`, `alerts/[alertId]`, `consents` y `notifications`. Las rutas (URLs, links y pushes) no cambian, porque los grupos no forman parte de la ruta.
- **Barra de la pila.** Arriba de esas pantallas va `BackBar` (`src/navigation/back-bar.tsx`), el encabezado propio de la pila: solo "‹ Volver", con el `Button` fantasma de la app, del alto de un blanco táctil, sobre el panel del tema. El título lo sigue diciendo el encabezado de la pantalla (`ScreenHeader`). El gesto y el botón "atrás" del sistema también vuelven a la pestaña de origen. La pantalla deja libre la barra del sistema de abajo (`paddingBottom` con el inset), porque ya no tiene la barra de pestañas debajo.
- **Las pantallas que ya tienen su propio "Volver" no llevan la barra:** la planilla de una sesión, el detalle de una alerta y los consentimientos. La sesión pregunta antes de descartar un borrador, así que tampoco se cierra deslizando en iOS (`gestureEnabled: false`).
- **Una pestaña oculta nunca es un destino.** `href: null` queda solo para las pestañas que un rol no tiene (por ejemplo "Mis tests" para el staff), y nada enlaza a ellas. Una pantalla nueva que se abre desde otra va en la pila, no en las pestañas.
- **Como mucho cinco pestañas por rol, para que cada nombre se lea entero.**
  - Staff: Inicio, Tests (días de test), Sesiones, Plantel y Cuenta, según el rol.
  - Jugador: Hoy, Mis tests, Gimnasio y Cuenta.
  - Protocolos deja de ser pestaña. Es una pantalla de la pila que se abre desde las herramientas de cancha de Inicio (staff) y desde "Mis tests" (jugador).
  - Gimnasio queda solo para el jugador, que es quien lo carga desde el teléfono (`canLogGym`), mientras el club tenga el módulo.
- **Barra de pestañas.** El alto es un blanco táctil más `spacing.md` más el inset inferior del sistema, sea la barra de gestos o la de tres botones. No tiene ícono ni deja su hueco (`tabBarIconStyle: display none`), y la etiqueta va centrada.
- Inicio del staff pierde la tarjeta "Desde acá vas a cargar tu bienestar…", que era un texto del jugador que quedó de la primera versión.

## Consecuencias

- Abrir una pantalla desde otra muestra la pantalla y vuelve con "atrás", en Android y en iOS.
- La navegación no la cubren los tests de componentes. Se revisa en un APK de staging, en el emulador de Android o en un teléfono.
