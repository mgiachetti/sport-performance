# 0002. TypeScript estricto en todo

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #16 (B-103)

## Contexto

El sistema tiene cuatro piezas de software propio (API, worker, web del staff y app mobile) y un núcleo de dominio con fórmulas que no pueden divergir entre ellas: EWMA y ACWR, monotonía y strain, offset de PHV (Mirwald, Moore), e1RM, Vmax, asimetrías. La app tiene que poder calcular sin conexión lo mismo que después recalcula el worker, y la web tiene que mostrar exactamente lo que la API valida. Un solo equipo chico mantiene todo.

## Decisión

- **TypeScript en todas las piezas** (API, worker, web, mobile y paquetes compartidos). La única excepción es `firmware/` (Fase 3), que usa la toolchain del hardware.
- **Modo estricto sin excepciones**, con los flags de `packages/config/tsconfig/base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.; ver ADR 0001). No se desactivan reglas por archivo sin justificarlo en el código.
- **El dominio vive en `packages/domain`** como funciones puras con tests, con la unidad en el nombre (`heightCm`, `speedMs`, `timeS`). Los esquemas de entrada y salida viven en `packages/contracts` (ADR 0009). Las apps importan de ahí; no reimplementan fórmulas.

## Alternativas descartadas

- **Backend en otro lenguaje (Go, Python, Kotlin).** Obliga a duplicar fórmulas y esquemas entre servidor y clientes, justo lo que más se rompe en un sistema con cálculo offline. Python tiene mejor ecosistema científico, pero las fórmulas del dominio son aritmética simple y no lo justifican.
- **JavaScript sin tipos o TypeScript no estricto.** Los errores de unidades y de valores ausentes (un test sin intentos, un jugador sin altura de los padres) son la falla típica de este dominio; `strictNullChecks` y `noUncheckedIndexedAccess` los atrapan en compilación.

## Consecuencias

- Un cambio de fórmula o de contrato se hace una vez y lo ven todos los consumidores en el mismo PR; el typecheck del monorepo muestra a quién rompe.
- El código estricto es más verboso con datos opcionales; se acepta a cambio de no tener `undefined` silenciosos en cálculos de carga o maduración.
- Si alguna vez hace falta un servicio en otro lenguaje (por ejemplo, para procesar el crudo del pod), se escribe un ADR nuevo y se comunica por contratos (OpenAPI o archivos), no compartiendo código.
