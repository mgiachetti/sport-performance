# @sport-performance/charts

Gráficos en SVG propio (sin librería), con las reglas de `CLAUDE.md`: jugador en el color de la marca, promedio de la categoría en gris, referencia de primera punteada con etiqueta directa, un solo eje Y, tooltip, estado con ícono + texto, formato es-AR y tabla alternativa para cada gráfico. Decisión en [ADR 0056](../../docs/adr/0056-graficos-nucleo-compartido-y-renderer-web.md).

| Entrada | Qué tiene | Quién la usa |
|---|---|---|
| `@sport-performance/charts` | Núcleo sin React ni DOM: escalas y ticks, geometría, disposición de cada gráfico, tooltip, leyenda, resumen accesible, tabla alternativa, formato | Web y mobile |
| `@sport-performance/charts/web` | Componentes React DOM: `LineChart`, `BarChart`, `Sparkline`, `Heatmap`, `StatusBadge`, `ChartTableView`, `ChartsProvider` | Web del staff |
| `@sport-performance/charts/web/charts.css` | Estilos; colores por las variables `--sp-*` de `packages/ui-tokens` | Web del staff |

## Uso en la web

```tsx
import '@sport-performance/charts/web/charts.css';
import { ChartsProvider, LineChart } from '@sport-performance/charts/web';

// Una vez, arriba de la app: el traductor del club (catálogo + overrides). Sin él, es-AR.
<ChartsProvider translator={translator}>{app}</ChartsProvider>;

<LineChart
  description="Segundos, mejor de 3 intentos"
  spec={{
    title: 'Sprint 40 m',
    format: { unit: 's', decimals: 2 },
    // Etiquetas ya formateadas por quien llama (fechas en la zona horaria del club).
    categories: [{ key: '2026-v1', label: 'V1 26' }, { key: '2026-v2', label: 'V2 26' }],
    series: [
      { id: 'p', role: 'player', label: 'Tomás Pérez', values: [5.41, 5.31], statuses: [null, 'ok'] },
      { id: 'avg', role: 'categoryAverage', label: 'Promedio M17', values: [5.52, 5.49] },
    ],
    reference: { value: 5.25 }, // "Primera 5,25 s"
  }}
/>;
```

Los colores salen de las variables CSS del tema (`applyCssVariables` / `createStylesheet` de `ui-tokens`): cambiar de club o pasar a la variante clara de alto contraste no requiere volver a renderizar.

## Tipos de gráfico

- **`LineChart`**: roles `player` (marca) y `categoryAverage` (gris), uno por rol. `null` corta la línea. Estados por punto (`statuses`) con ícono sobre el punto.
- **`BarChart`**: columnas desde cero (también negativas), tonos `brand` / `neutral` nombrados en `tones`, línea gris opcional en el mismo eje (`overlay`), una sola etiqueta directa (`directLabel: 'last' | 'max' | 'none'`), estado por barra.
- **`Sparkline`**: mini gráfico para tarjetas y listas, sin ejes ni tooltip; lo nombran su resumen y una tabla oculta visualmente.
- **`Heatmap`**: filas × columnas en un solo tono por pasos (`steps`, `domain` fijo opcional), escala nombrada debajo, celdas sin dato rayadas, valores adentro con `showValues` si entran.
- **`StatusBadge`**: `ok` / `warning` / `critical` con ícono de forma distinta + texto (`Bien`, `Atención`, `Crítico`) o un `label` propio.

## Accesibilidad

- `<figure>` nombrado por el título; el dibujo es `role="img"` con un resumen generado (rango, extremos, referencia, valores con estado).
- La tabla alternativa está siempre en el DOM (oculta visualmente) y "Ver como tabla" la muestra (`aria-expanded`).
- El área del gráfico se enfoca con Tab (foco visible): flechas, Inicio y Fin recorren los valores (también arriba/abajo en el mapa de calor), una región `aria-live` lee el valor y Escape cierra. El tooltip del puntero muestra lo mismo.
- Los textos de los datos se insertan como texto, nunca como HTML. `forced-colors` soportado.

## Tests

`pnpm --filter @sport-performance/charts test`: unitarios del núcleo y de componentes (Vitest + Testing Library en jsdom, con axe-core). Los tests de componentes llevan `// @vitest-environment jsdom`; `src/testing/` tiene los datos de ejemplo y los helpers (no se publican).
