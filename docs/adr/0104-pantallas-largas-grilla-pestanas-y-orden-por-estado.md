# 0104. Pantallas largas de la app: grilla de accesos en el inicio del staff, pestañas arriba donde hay dimensiones y orden por estado en el día del jugador

- Estado: Aceptado
- Fecha: 2026-11-06
- Issue: #79 (B-501)

## Contexto

Probando la app en un teléfono, algunas pantallas quedaron demasiado largas para lo que se hace en ellas. Hay que bajar mucho para encontrar algo, y lo importante queda abajo de lo que ya está hecho. Son cuatro:

- **El inicio del staff** era una tarjeta "Herramientas de cancha" con una fila (título y subtítulo de dos líneas) por herramienta: 30-15, reacción, CMJ semanal, sprint por video, antropometría, CMJ por video y protocolos. Abajo había otra tarjeta aparte para el modo kiosco.
- **"Hoy" del jugador** mostraba en el mismo orden fijo el bienestar, el RPE, la racha y el próximo día de test, estuviera cargado o no.
- **"Mis tests" del jugador** apilaba récords, percentiles, historial y próximos días de test en una sola columna.
- **La planilla de sesión del entrenador** apilaba asistencia, minutos y contactos de todo el plantel.

El staff ya tiene cinco pestañas abajo, que es el máximo ([ADR 0100](0100-navegacion-de-la-app-pila-sobre-pestanas.md)). Sumar una sexta para las herramientas no es una opción. Una segunda barra abajo tampoco: se confunde con la navegación principal.

## Decisión

Cada pantalla se resuelve con el patrón que corresponde a lo que se hace en ella. No se usa un mismo patrón para todo.

1. **Inicio del staff: una grilla de accesos agrupados, no una sexta pestaña.** Las herramientas son tarjetas chicas (`ToolGrid` en `src/ui/tiles.tsx`), de a dos por fila, bajo tres títulos chicos: "Tests en cancha" (30-15, reacción, CMJ semanal, antropometría), "Video" (sprint, CMJ) y "Más" (modo kiosco, protocolos). El kiosco pasa a ser una tarjeta de "Más" y deja de tener su propia tarjeta. Cada tarjeta lleva:
   - una marca corta de texto en el ícono de siempre (`IconTile`: "IFT", "ms", "CMJ", "VID"…), sin una biblioteca de íconos ni glifos que el sistema pueda pintar como emoji;
   - un título corto (`home.tile.*`);
   - una línea de una sola fila que se corta si no entra.

   El lector de pantalla oye el título como nombre del botón, salvo donde el título corto se confunde fuera de su grupo: las tarjetas de video se llaman "Sprint por video" y "CMJ por video" (`accessibilityLabel`), porque "CMJ" a secas se confunde con "CMJ semanal". Como hint oye el texto completo que tenía la fila (`accessibilityHint`). La tarjeta mide como mínimo dos veces el área táctil (88 dp) y muestra el foco con el anillo y la presión con el tinte del club, todo con tokens del tema. Una herramienta que el rol no tiene no aparece. Un grupo que se queda sin herramientas desaparece con su título. La grilla pasa a una columna si la ventana mide menos de 340 dp o si la letra del sistema está a 1,3× o más (`toolGridColumns`). La aclaración legal y el indicador de sincronización siguen donde estaban.
2. **"Hoy" del jugador: orden por estado.** Primero va lo pendiente, grande. Lo hecho se pliega a una línea. No lleva pestañas, porque es un recorrido de menos de 20 segundos (principio 5 de `CLAUDE.md`), y una pestaña escondería el paso que falta.
3. **"Mis tests" del jugador: pestañas arriba,** "Récords · Historial · Próximos". Los percentiles van dentro de Récords.
4. **Planilla de sesión del entrenador: pestañas arriba por dimensión,** "Asistencia · Minutos · Contactos". Contactos aparece solo si el deporte tiene contactos. El reloj y el resumen de la sesión quedan siempre a la vista, por encima de las pestañas.

**Reglas de las pestañas arriba** (control segmentado dentro de la pantalla):

- Van de 2 a 4 segmentos, arriba y dentro de la pantalla. Nunca son una segunda barra abajo.
- La pantalla recuerda la última pestaña elegida.
- Una pestaña no elegida que tiene algo importante lleva una insignia con la cantidad.
- No se usan en los recorridos guiados: el día de test, la corrida del 30-15 ni la grabación de un video.
- Una alerta nunca queda escondida detrás de una pestaña. Se ve sin tocar nada.

### En la web del staff

Las mismas reglas valen para la web. Las pestañas de la web son los enlaces de `.sp-tabs` que ya usan Administración y Configuración: un `<nav>` con un enlace por sección y `aria-current="page"` en la abierta. Como son enlaces y no un `tablist`, se recorren con Tab y no con las flechas. La sección abierta va en la URL (`?tab=`), así que se puede compartir y el botón Atrás vuelve a la anterior.

- **Ficha del jugador (`/players/$playerId`):** antes eran siete bloques seguidos, cuatro de ellos a todo el ancho con gráficos y tablas. Ahora:
  - Arriba, siempre a la vista, quedan la cabecera y las tres tarjetas cortas: disponibilidad, maduración (con el aviso de pico de crecimiento) e historial de alertas.
  - Debajo van las pestañas "Carga · Evolución · Percentiles · Gimnasio".
  - Solo aparecen las pestañas que el rol puede ver. Si puede ver una sola, no hay barra.
  - Si hay una alerta de ACWR activa, Carga lleva la insignia "Alerta" (ícono + texto). La alerta también está en el historial, a la vista.
  - Un bloque que está detrás de una pestaña no se pide hasta que se abre.
- **Memoria:** si la URL no trae `?tab=`, se abre la última pestaña usada en esa pantalla, por club (`src/ui/tab-memory.ts`). Así, abrir otro jugador desde el plantel mantiene la pestaña. La memoria vive solo en la página abierta y se borra al cerrar sesión.
- **Pantallas que quedan como están:**
  - El detalle de una sesión ya pone sus datos y ejercicios en dos columnas, y la planilla de participación es lo principal.
  - El panel semanal es un tablero: KPIs, atención y plantel se leen juntos, y "Atención" es una alerta.
  - La sesión de cancha (KPIs, gráfico, tabla) es un informe que se lee de arriba abajo.
  - La consola del club solo la usa el superadmin, y sus tarjetas son cortas.
  - La ficha de familia tiene dos bloques.
  - El calendario es una vista propia.
  - Los editores (programa de gimnasio, día de test, estaciones) son recorridos, y en un recorrido no se usan pestañas.

## Consecuencias

- El inicio del staff entra en una pantalla con todas las herramientas. Sumar una herramienta no agrega una fila ni una pestaña. Se suma su miembro a `HomeToolKey`, su entrada en `HOME_TOOLS` y en su grupo de `HOME_GROUPS` (`src/screens/app.tsx`), la prop `onOpen…` de `HomeScreen` que la ruta pasa según la matriz, y sus textos `home.tile.*` en `packages/i18n`.
- Los textos `home.tools`, `home.kiosk` y los nombres largos de cada herramienta en el inicio (`ift.open`, `reaction.open`, `weeklyCmj.open`, `sprintVideo.open`, `cmjVideo.open`, `kiosk.open`) se borraron. Las explicaciones largas (`*.open.hint`, `anthropometry.field.subtitle`) siguen como `accessibilityHint` de cada tarjeta.
- Una pantalla nueva con varias dimensiones usa las pestañas arriba con estas reglas. Un recorrido nuevo no las usa.
- Las pantallas 2, 3 y 4 se implementan en sus propios cambios con estas reglas.
