# @sport-performance/ui-tokens

Tokens de diseño (B-104): paleta, tipografía, estados, escalas y rayas de la camiseta, con salida a **variables CSS** (web) y a un **tema de React Native** (mobile), y **tema por club en runtime**. Incluye la variante oscura de la identidad ORC (`dark`) y una variante clara de alto contraste para usar el celular al sol (`light-hc`).

TypeScript puro, sin dependencias de React, React Native ni DOM.

## Fuente de los valores

- La paleta sale de `CLAUDE.md`, sección "Identidad visual" (`orcPalette`). La maqueta es solo un boceto.
- Las apps usan **tokens semánticos** de `createTheme()` (`theme.color.text.primary`, `theme.color.status.ok.fg`…), nunca hex sueltos.
- Todo color que se usa como texto se ajusta (manteniendo el tono) hasta cumplir el mínimo de la variante sobre todas las superficies: **4,5:1 (AA) en `dark`, 7:1 (AAA) en `light-hc`**; foco, bordes funcionales y marcas de gráficos ≥ 3:1. Por eso cualquier color de club funciona. Dos consecuencias en ORC oscuro:
  - `text.muted` es `#857b70` aclarado lo justo (el original da 3,9:1 sobre `#24201c`).
  - `status.critical.fg` es `#e5604f` aclarado lo justo para leerse sobre su propio fondo tintado; `status.*.solid` conserva el valor de la identidad.
- Los rellenos de marca (`brand.solid`, rayas) usan el color del club tal cual; el texto encima (`brand.onSolid`) se elige por contraste.

## Estados

`ok`, `warning`, `critical`, cada uno con `fg`, `bg`, `border`, `solid` y `onSolid`. **Siempre con ícono y texto, nunca solo color.** El texto sale de `packages/i18n`.

## Tema por club

```ts
import { createTheme, parseClubBrand } from '@sport-performance/ui-tokens';

const brand = parseClubBrand(apiClub.brand); // valida; lanza InvalidClubBrandError
const theme = createTheme({ brand, variant: 'dark' }); // o 'light-hc'
```

`brand` por defecto es ORC (`#f1882a` / `#050505`). `createThemes(brand)` devuelve las dos variantes.

## Web

```ts
import { applyCssVariables, createStylesheet, createTheme } from '@sport-performance/ui-tokens';

// Estático (SSR o build): :root oscuro y [data-theme="light-hc"]
const css = createStylesheet({ brand });

// En runtime, al cambiar de club o de variante
applyCssVariables(document.documentElement, createTheme({ brand, variant }));
```

Variables `--sp-*`: `--sp-color-text-primary`, `--sp-color-status-ok-fg`, `--sp-text-metric-size`, `--sp-text-metric-numeric` (`tabular-nums`), `--sp-space-lg`, `--sp-radius-md`, `--sp-stripes-md` (gradiente de las rayas), `--sp-chart-reference-dash`… Helpers `cssVar('color', 'text', 'primary')` → `var(--sp-color-text-primary)`.

Las fuentes (Barlow Condensed y Barlow) las carga la app; `webFontStacks` trae las pilas con fallbacks.

## React Native

```ts
import { createTheme, toNativeTheme } from '@sport-performance/ui-tokens';

const native = toNativeTheme(createTheme({ brand, variant }));
native.colors.background; // '#141210'
native.text.metric; // { fontFamily: 'BarlowCondensed_700Bold', fontSize: 32, lineHeight: 36, letterSpacing: 0, fontVariant: ['tabular-nums'] }
native.stripes(24); // [{ color, height }, …] para apilar Views
native.fontFamilies; // familias a cargar con useFonts (@expo-google-fonts/barlow, /barlow-condensed)
```

En RN cada peso es una familia (`Barlow_600SemiBold`); no se usa `fontWeight` porque Android lo ignora o lo sintetiza con fuentes propias.

## Gráficos

`chart.player` (color de marca legible), `chart.categoryAverage` (gris), `chart.reference` (línea blanca en oscuro, negra en claro; punteada con `chartDash.reference`, con etiqueta directa), `chart.grid`, `chart.axis`, `chart.tooltip*`.
