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
   - una marca corta en el ícono de siempre (`IconTile`: "IFT", "ms", "CMJ"…), sin una biblioteca de íconos;
   - un título corto (`home.tile.*`);
   - una línea de una sola fila que se corta si no entra.

   El lector de pantalla oye el título como nombre del botón y el texto completo que tenía la fila como `accessibilityHint`. La tarjeta mide como mínimo dos veces el área táctil (88 dp) y muestra el foco con el anillo y la presión con el tinte del club, todo con tokens del tema. Una herramienta que el rol no tiene no aparece. Un grupo que se queda sin herramientas desaparece con su título. La grilla pasa a una columna si la ventana mide menos de 340 dp o si la letra del sistema está a 1,3× o más (`toolGridColumns`). La aclaración legal y el indicador de sincronización siguen donde estaban.
2. **"Hoy" del jugador: orden por estado.** Primero va lo pendiente, grande. Lo hecho se pliega a una línea. No lleva pestañas, porque es un recorrido de menos de 20 segundos (principio 5 de `CLAUDE.md`), y una pestaña escondería el paso que falta.
3. **"Mis tests" del jugador: pestañas arriba,** "Récords · Historial · Próximos". Los percentiles van dentro de Récords.
4. **Planilla de sesión del entrenador: pestañas arriba por dimensión,** "Asistencia · Minutos · Contactos". Contactos aparece solo si el deporte tiene contactos. El reloj y el resumen de la sesión quedan siempre a la vista, por encima de las pestañas.

**Reglas de las pestañas arriba** (control segmentado dentro de la pantalla):

- Van de 2 a 4 segmentos, arriba y dentro de la pantalla. Nunca son una segunda barra abajo.
- La pantalla recuerda la última pestaña elegida.
- Una pestaña no elegida que tiene algo importante lleva una insignia con la cantidad.
- No se usan en los recorridos guiados: el día de test, la corrida del 30-15 ni la grabación de un video.
- Una alerta nunca queda escondida detrás de una pestaña. Se ve sin tocar nada.

## Consecuencias

- El inicio del staff entra en una pantalla con todas las herramientas. Sumar una herramienta es sumar una entrada a `HOME_TOOLS` y a su grupo en `src/screens/app.tsx`. No se agrega una fila ni una pestaña.
- Los textos `home.tools`, `home.kiosk` y los nombres largos de cada herramienta en el inicio (`ift.open`, `reaction.open`, `weeklyCmj.open`, `sprintVideo.open`, `cmjVideo.open`, `kiosk.open`) se borraron. Las explicaciones largas (`*.open.hint`, `anthropometry.field.subtitle`) siguen como `accessibilityHint` de cada tarjeta.
- Una pantalla nueva con varias dimensiones usa las pestañas arriba con estas reglas. Un recorrido nuevo no las usa.
- Las pantallas 2, 3 y 4 se implementan en sus propios cambios con estas reglas.
