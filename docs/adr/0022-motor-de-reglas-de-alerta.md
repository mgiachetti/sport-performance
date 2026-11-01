# 0022. Motor de reglas de alerta declarativo

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #28 (B-207)

## Contexto

CLAUDE.md fija las alertas por defecto (rojo si ACWR > 1,4 o bienestar < 3,0; amarillo si ACWR > 1,3 o < 0,8, bienestar < 3,3, CMJ más de 7 % por debajo de la base, velocidad de crecimiento en zona de pico; bienestar también contra la media móvil propia) y exige que no haya reglas hardcodeadas: reglas declarativas, editables por club, con valores por defecto en seeds (ADR 0004, ADR 0014). Con menos de 28 días de historia el ACWR está en "historia insuficiente" y no alerta. Las alertas tienen que calcularse igual en el worker (B-326), la API (B-327) y, sin conexión, en el celular (ADR 0002), y no pueden llevar texto de UI (ADR 0019).

Quedaban sin definir la forma de una regla, cómo se combinan las severidades, qué pasa cuando faltan datos y varios valores que CLAUDE.md no da: el umbral del z-score, las ventanas, las muestras mínimas, el umbral de la zona de pico y la antigüedad máxima de un dato.

## Decisión

- **Una regla es un objeto JSON**: `code` (único por club, `snake_case`), `kind` (conjunto cerrado: `acwr_high`, `acwr_low`, `wellness_low`, `wellness_zscore_low`, `cmj_drop`, `growth_peak`), `enabled`, `appliesTo` opcional (`sports`, `sexes`, `stages`; ADR 0017) y `params` con un umbral por severidad (`warning…` / `critical…`, `null` si no se usa) más ventanas y mínimos, con la unidad en el nombre (`warningAboveRatio`, `warningDropPct`, `windowDays`). Se guarda en `alert_rule` (B-301) y se valida con `parseAlertRuleSet` de `packages/domain`, que rechaza campos desconocidos (un typo nunca desactiva un umbral en silencio) y devuelve la ruta del campo inválido.
- **Una regla da a lo sumo una alerta**, con la severidad más alta alcanzada (`critical` > `warning`). Así "ACWR > 1,3 amarillo, > 1,4 rojo" es una sola regla y no dos alertas para el mismo dato.
- **Faltar datos no es una alerta.** Cada regla que no se puede evaluar se informa en `skipped` con un motivo: `disabled`, `not_applicable`, `no_data`, `stale_data`, `insufficient_history`, `no_variance`. La UI usa `insufficient_history` para mostrar "Historia insuficiente".
- **Comparaciones estrictas** como las escribe CLAUDE.md (`>`, `<`, "más de 7 %"), con una tolerancia de 1e-9 para que un valor igual al umbral por error de punto flotante no lo cruce. La zona de pico es "desde" el umbral (`≥`).
- **Sin texto en el dominio:** la alerta lleva `messageKey` y `suggestionKey` (`alert.<kind>.message|suggestion`, derivadas del `kind`) y `values` numéricos sin redondear; los textos es-AR están en el catálogo de `packages/i18n` y un test verifica que existan para cada `kind` y que solo interpolen valores que el motor da.
- **Valores por defecto que CLAUDE.md no fija** (`DEFAULT_ALERT_RULES`, editables por club):
  - ACWR: `minHistoryDays = 28` (CLAUDE.md); sin nivel rojo para ACWR bajo.
  - Bienestar z-score: amarillo si z < −1,5, contra la media y el desvío muestral de los 28 días anteriores (sin contar el día evaluado), con al menos 10 días cargados. Si el desvío es 0 no hay z.
  - CMJ: base = staff la fija (por ejemplo, el test de pretemporada) o, si no, media de los CMJ de los 42 días anteriores al último (mejor del día), con al menos 3; el último CMJ vale 7 días (CMJ semanal de M17/M19).
  - Crecimiento: zona de pico desde 7,2 cm/año, con una medición de altura de hace 120 días o menos (antropometría trimestral). 7,2 cm/año es el umbral de "crecimiento rápido" usado en el seguimiento de academias; hay que validarlo con el staff, igual que los coeficientes de maduración.
- El motor consume lo que calculan otros módulos (ACWR y días de historia de B-202, velocidad de crecimiento de B-203); no recalcula cargas ni maduración.

## Consecuencias

- Un club cambia umbrales, ventanas, alcance o desactiva una regla editando datos (B-322, B-409), sin desplegar código. Agregar un `kind` nuevo sí es código: evaluador en el dominio y textos en i18n (no compila sin ellos).
- Un club que quiere umbrales por sexo o deporte crea reglas con `appliesTo` y acota las generales; si dos reglas del mismo `kind` alcanzan al mismo jugador, las dos pueden alertar.
- El seed (B-306) se genera desde `DEFAULT_ALERT_RULES`; un test asegura que sobrevive `JSON.stringify` → `parseAlertRuleSet` sin cambios.
- El worker reevalúa días pasados pasando la historia completa: el motor ignora datos posteriores al día evaluado.
- Las alertas siguen siendo heurísticas de carga (principio 7): los textos sugieren ajustar la carga y nunca diagnostican.
