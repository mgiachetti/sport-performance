# 0012. Web del staff con React, Vite y TanStack; gráficos SVG propios

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

La web es para el staff (entrenadores, preparadores físicos, médicos, administradores): paneles por categoría, fichas de jugadores, carga de días de test, configuración del club. Está siempre detrás de login, no necesita SEO y tiene mucha interacción y muchos filtros. Los gráficos tienen reglas propias que no son las de una librería: jugador en el color de la marca del club, promedio de la categoría en gris, referencia de primera con línea blanca punteada y etiqueta directa, un solo eje Y, tooltip, estado con ícono y texto, y tabla alternativa por accesibilidad.

## Decisión

- **SPA con React + Vite**, servida como estáticos.
- **TanStack Router** para rutas con parámetros y search params tipados (los filtros del panel quedan en la URL y se pueden compartir).
- **TanStack Query** para el estado del servidor (caché, revalidación, mutaciones), sobre el cliente tipado de `packages/contracts` (ADR 0009).
- **Gráficos en SVG propio**, como componentes React, siguiendo la maqueta (`mockups/orc-performance.html`) y los tokens de `packages/ui-tokens`. Cada gráfico tiene su tabla alternativa.
- Textos desde `packages/i18n`, formato `es-AR`; marca del club aplicada en runtime por tokens (ADR 0014).

## Alternativas descartadas

- **Next.js / Remix con SSR.** El SSR no aporta en una app autenticada sin SEO y agrega un servidor más que operar; la API ya es el backend.
- **Librerías de gráficos (Recharts, Chart.js, ECharts).** Pesan, y las reglas de arriba (etiqueta directa de la referencia, un solo eje, tabla alternativa, accesibilidad) terminan peleando contra la librería. Los gráficos que necesitamos son pocos tipos (líneas, barras, bandas) y se mantienen mejor propios.
- **React Router.** Viable, pero el tipado de search params de TanStack Router encaja con paneles de muchos filtros.

## Consecuencias

- Los gráficos propios requieren tests (render, accesibilidad, casos sin datos) y más trabajo inicial.
- React en web y React Native en mobile comparten conocimiento, hooks y lógica, aunque no componentes visuales.
- El deploy de la web es estático en Railway (ADR 0003).
