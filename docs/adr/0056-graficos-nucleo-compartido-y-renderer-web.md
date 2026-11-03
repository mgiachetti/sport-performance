# 0056. Gráficos: núcleo compartido sin plataforma y renderer web en SVG con variables de tema

- Estado: Aceptado
- Fecha: 2026-11-03
- Issue: #65 (B-402)

## Contexto

El ADR 0012 decidió gráficos en SVG propio, sin librería, con reglas fijas: jugador en el color de la marca, promedio de la categoría en gris, referencia de primera con línea punteada y etiqueta directa, un solo eje Y, tooltip, estado con ícono y texto y tabla alternativa. Faltaba decidir dónde viven, cómo los reusa mobile (la ficha y la app del jugador también muestran evoluciones y mini gráficos) y cómo reciben la marca del club, que cambia en runtime (ADR 0014).

Las piezas difíciles de un gráfico no son las etiquetas `<path>`: son las escalas y los ticks redondos, el corte de la línea donde falta un dato, el ancho de las barras, dónde poner la etiqueta de la referencia para que no pise un punto, cuántas etiquetas del eje X entran, el punto más cercano al puntero, el texto que lee un lector de pantalla y la tabla alternativa con el formato es-AR. Todo eso es igual en web y en mobile. Lo que cambia es el dibujo: SVG del DOM en la web, `react-native-svg` en mobile.

En paralelo se construye la base de la web (#64), así que los gráficos no pueden depender de su router, su layout ni su manera de estilar.

## Decisión

**Paquete `packages/charts` (`@sport-performance/charts`) con dos entradas:**

- **Núcleo (`@sport-performance/charts`)**: TypeScript puro, sin React, React Native ni DOM (un test lo verifica). Escalas lineales y ticks de 1, 2, 2,5 y 5 × 10ⁿ; geometría (línea que se corta en los faltantes, columna con punta redondeada de 4 px y base recta, ancho máximo de 24 px); la **disposición** de cada tipo de gráfico (`layoutLineChart`, `layoutBarChart`, `layoutSparkline`, `layoutHeatmap`) como datos en píxeles; el contenido del tooltip; la leyenda; el **resumen accesible**; y la **tabla alternativa**. Los valores se formatean con `formatValue` sobre `formatNumber` / `formatUnit` de `packages/i18n` y la unidad del diccionario (`UnitCode`), y los textos salen del catálogo `es-AR` con el traductor del club. El ancho de los textos se estima (no hay DOM para medir) con un margen a favor.
- **Renderer web (`@sport-performance/charts/web`)**: componentes React DOM (`LineChart`, `BarChart`, `Sparkline`, `Heatmap`, `StatusBadge`, `ChartTableView`, `ChartsProvider`) que dibujan lo que devuelve el núcleo, más `charts.css`. Mobile agregará su renderer (`/native`, con `react-native-svg`) sobre el mismo núcleo cuando la primera pantalla lo necesite.

**Tipos de gráfico y sus reglas:**

- **Líneas**: roles fijos `player` (marca) y `categoryAverage` (gris), uno por rol; el jugador se dibuja arriba. Un `null` corta la línea. Puntos de ≥ 8 px con anillo del color de superficie.
- **Barras**: desde una sola línea base en cero (también negativos); dos tonos como máximo (`brand` / `neutral`) que la leyenda nombra; una línea gris opcional en el mismo eje (por ejemplo, la crónica); **una** etiqueta directa (la última o la más alta), nunca todas.
- **Mini gráfico**: sin ejes ni tooltip, punto final destacado y referencia punteada; lo nombran su resumen y una tabla oculta visualmente.
- **Mapa de calor**: un solo tono (la marca) en 2 a 9 pasos de opacidad, con la escala nombrada debajo ("De 1,0 a 1,8"); las celdas sin dato van rayadas además de pálidas.
- **Referencia de primera**: línea punteada (patrón de `ui-tokens`) con etiqueta directa "Primera 5,25 s" al final; va debajo de la línea si arriba se sale del gráfico o tapa un punto.
- **Un solo eje Y** siempre: ningún gráfico acepta un segundo eje; el dominio cubre las series y la referencia.
- **Estado**: ícono de forma distinta por nivel (tilde, triángulo, cruz en círculo) + texto (`Bien`, `Atención`, `Crítico`); en el dibujo, el ícono sobre el punto o la barra; en el tooltip y la tabla, `StatusBadge`.

**Accesibilidad e interacción (web):** cada gráfico es un `<figure>` nombrado por su título, con el dibujo `role="img"` y el resumen generado como nombre. La tabla alternativa está **siempre en el DOM** (oculta visualmente, no con `display: none`) y el botón "Ver como tabla" (`aria-expanded`) la muestra. El área del gráfico es un grupo enfocable con foco visible: las flechas, Inicio y Fin (y arriba/abajo en el mapa de calor) recorren los valores, una región `aria-live` lee el valor activo y Escape cierra. El puntero se engancha a la X más cercana (líneas) o al área completa de la barra o celda. Los textos de datos se insertan como texto, nunca como HTML. Tests con axe-core por componente.

**Tema:** los colores salen de las variables CSS de `ui-tokens` (`--sp-color-chart-*`, `--sp-color-status-*`, superficies y texto), por clases en `charts.css`. Así la marca del club y la variante clara de alto contraste se aplican en runtime con `applyCssVariables` sin volver a renderizar, y los estilos son una hoja estática (compatible con una CSP sin `unsafe-inline`). Incluye soporte de `forced-colors`.

**Tamaño:** el ancho se mide con `ResizeObserver` y la disposición se recalcula (cantidad de ticks, etiquetas que entran, ancho de barra) en vez de escalar el SVG con el texto adentro; se puede fijar un ancho.

**Fechas:** las categorías del eje X llegan con la etiqueta ya formateada por quien llama, con la zona horaria del club (ADR 0019); los gráficos no interpretan fechas.

## Consecuencias

- La web (#64 y las pantallas desde #66) importa `@sport-performance/charts/web` y `charts.css` una vez, y envuelve la app con `ChartsProvider` para pasar el traductor del club. Este paquete no depende de la estructura de la web.
- Mobile reusa escalas, disposición, resúmenes, tablas y formato; solo escribe el dibujo nativo y su interacción táctil.
- Agregar un tipo de gráfico es agregar su disposición pura con tests y su componente; el núcleo crece sin tocar los renderers existentes.
- El ancho del texto se estima: con fuentes muy distintas a Barlow las etiquetas pueden quedar más separadas de lo necesario, nunca encimadas.
- Las reglas visuales (un eje, roles de serie, un tono por grupo) están en los tipos: un gráfico que las rompa no compila o falla al disponerse.
