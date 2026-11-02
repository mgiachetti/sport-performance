# Tests físicos (B-205)

Fórmulas de puntuación de la batería de tests. Funciones puras, sin I/O; las entradas inválidas lanzan `DomainValidationError` con `code: 'invalid_argument'` (nunca devuelven `NaN` ni `Infinity`). Los parámetros configurables son entradas con valores por defecto guardados como datos (`DEFAULT_*`), listos para el seed de las definiciones de test (B-306) y para que cada club los cambie.

| Archivo | Qué calcula | Métricas canónicas |
|---|---|---|
| `attempts.ts` | Agregación de intentos según la definición: `best` (según el sentido de mejora de la métrica) o `mean`. `DEFAULT_ATTEMPT_SCORING`: agregación e intentos previstos por métrica. | todas las medidas por intentos |
| `cmj.ts` | Altura por tiempo de vuelo `h = g·t²/8` (g = 9,81 por defecto), tiempo de vuelo desde cuadros de video, mejor de 3. | `cmj_height_cm` |
| `sprint.ts` | Velocidad de un tramo, Vmax 20–40 `= 20 / (t40 − t20)` por intento, validación de parciales (t10 < t20 < t40), mejor de cada parcial y de la Vmax. | `sprint_10_s`, `sprint_20_s`, `sprint_40_s`, `sprint_vmax_ms` |
| `cod505.ts` | Mejor tiempo por lado y asimetría `|izq − der| / lado más rápido × 100` (Bishop et al. 2018), con el lado más rápido aparte. | `cod505_left_s`, `cod505_right_s`, `cod505_asymmetry_pct` |
| `strength.ts` | e1RM de Epley con RIR `peso × (1 + (reps + RIR)/30)`, avisos de protocolo (3–5 reps, RIR ≥ 2 por defecto), mejor e1RM entre series, fuerza relativa al peso corporal. | `e1rm_kg`, `relative_strength_kg_kg` |
| `recording.ts` | Carga de resultados (B-320, ADR 0039): entradas crudas por test (`scoreTestEntry`: splits del sprint → Vmax, tiempo de vuelo o cuadros → altura, etapa del 30-15 → VIFT, serie → e1RM con avisos), parámetros del protocolo de cada versión (`testScoringSettings`), puntaje por métrica (`scoreResultMetrics`), métricas del resultado (`deriveResultMetrics`: asimetría del 505, fuerza relativa), reglas de etapa (`batteryIncludesTest`, `testApplicability`, `strengthMetricAllowed`) y avisos al comparar (`testComparisonWarnings`). | las de cada test |
| `ift3015.ts` | VIFT del 30-15 IFT (8 km/h + 0,5 km/h por etapa de 45 s, Buchheit 2008) desde la última etapa completada y distancia de pasadas a un % de la VIFT. | `vift_kmh` |

## Decisiones

- **Los intentos no hechos no llegan acá.** El llamador filtra los intentos con estado `not_done`; todo valor recibido cuenta.
- **Empates:** en `best` gana el primer intento; `selectedIndex` siempre indexa los intentos de entrada (también para el parcial de 10 m, que puede faltar en algunos intentos).
- **Sprint:** cada métrica se agrega por separado ("vale el mejor" para cada valor guardado). La Vmax se calcula por intento y después se agrega; nunca se mezclan parciales de intentos distintos.
- **505:** la asimetría se calcula sobre los tiempos agregados de cada lado y es siempre ≥ 0; el lado más rápido va en `fasterSide`.
- **e1RM:** la fórmula se aplica tal cual también con 1 repetición (da 1,033 × carga). Los avisos de protocolo no bloquean la carga; RIR 0 (al fallo) se marca siempre con el protocolo por defecto. Para ejercicios con peso corporal (dominadas) la carga es peso corporal + lastre.
- **Rangos plausibles** (B-206) y **caída del CMJ contra la base** (B-207) no están en este módulo.
