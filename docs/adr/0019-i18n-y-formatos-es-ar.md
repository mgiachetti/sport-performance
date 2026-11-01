# 0019. i18n y formatos es-AR

- Estado: Aceptado
- Fecha: 2026-11-01
- Issue: #18 (B-105)

## Contexto

`CLAUDE.md` pide textos de UI en español rioplatense (vos) externalizados en `packages/i18n`, y formato `es-AR`: coma decimal, punto de miles, fechas dd/mm/aaaa y unidades SI. Los mismos textos y formatos los usan la web (Vite), la app (Expo / Hermes), la API (emails) y el worker (Node). Además, "el día" se calcula en la zona horaria del club, no en la del dispositivo ni la del servidor, y los clubes son white-label (pueden tener su propia terminología).

## Decisión

- **ICU MessageFormat con FormatJS** (`intl-messageformat`, más `@formatjs/icu-messageformat-parser` para validar). Es el estándar de facto, soporta plurales y `select`, corre en Node, navegador y Hermes, y no ata a un framework: los bindings de React (`useT`, provider) se agregan en cada app cuando entre su framework.
- **`es-AR` es el catálogo fuente**, un objeto TS `as const` con claves planas `namespace.nombre`. El tipo `MessageKey` sale de ese objeto: una clave inexistente no compila, y un mensaje con argumentos exige pasarle valores. Otros locales y los **overrides por club** son catálogos parciales (`MessageCatalog`) con fallback por clave al fuente.
- **`validateCatalog()`** verifica que un catálogo use solo claves existentes, sea ICU válido y tenga los mismos argumentos (con el mismo uso: texto, número, plural, select) que el fuente. Corre en los tests y la API la puede usar al guardar overrides de un club.
- **Los argumentos son solo `string | number`.** Fechas, horas y medidas se formatean antes con los formateadores del paquete y se pasan como texto; los mensajes no pueden usar `{x, date}` / `{x, time}` (el validador lo rechaza). Así ninguna fecha se formatea en la zona horaria del dispositivo por accidente.
- **Formateadores propios sobre `Intl`**: `formatNumber`, `formatUnit`, `formatDuration`, `formatDate`, `formatTime`, `formatDateTime`, `formatDateLong`, `formatLocalDate`, `parseNumber`. Usan `Intl.NumberFormat` y `Intl.DateTimeFormat#formatToParts` y arman la salida a mano (`dd/mm/aaaa`, `HH:mm` en 24 h), para no depender de los patrones de locale de cada motor (por ejemplo, Node da `04:22 p. m.` para `es-AR`). Sin `-0`; `—` para valores faltantes o no finitos.
- **La zona horaria es un parámetro obligatorio** de todo formateador de instantes, con el tipo `TimeZone` de `packages/domain`. Las fechas de calendario son el `LocalDate` del dominio (`YYYY-MM-DD`, como la de nacimiento) y se formatean como texto, sin pasar por una zona horaria. El cálculo de "el día" en la zona del club es del dominio (`localDateInTimeZone`); este paquete solo formatea.
- **Las unidades son los `UnitCode` del dominio** (`s`, `ms`, `msec`, `pct`, `au`, …; el dominio reserva `ms` para m/s y `msec` para milisegundos, así que el código coincide con el sufijo de las métricas sin ambigüedad). La etiqueta es-AR de cada unidad es una clave `unit.<UnitCode>` (el símbolo internacional cuando existe; `años`, `lpm`, `UA` cuando no; vacía para cantidades y puntajes) y cada unidad tiene decimales por defecto según la resolución de la medida. Ambas tablas están tipadas contra todos los `UnitCode`: una unidad nueva en el dominio no compila hasta tener etiqueta y decimales. Número y etiqueta van unidos por espacio no separable (`1,85 s`, `12,5 %`), salvo los grados (`12°`). Las etiquetas no son mensajes ICU ni se pueden sobrescribir por club.
- **El parseo de números es estricto:** en `es-AR` el punto nunca es decimal; `1.85` se rechaza en vez de adivinar.

## Consecuencias

- Agregar un texto es agregar una clave al catálogo `es-AR`; los tests verifican que sea ICU válido, en voseo y sin claves huérfanas.
- Agregar un locale es sumar su código a `SUPPORTED_LOCALES` y un catálogo parcial validado; el armado de fechas largas (`3 de marzo de 2026`) es específico del español y habría que generalizarlo.
- Los formateadores dependen de `Intl` con `timeZone`, `formatToParts` y `PluralRules`; las versiones actuales de Hermes los traen. Si un motor no los tuviera, se agregan los polyfills de FormatJS en esa app.
