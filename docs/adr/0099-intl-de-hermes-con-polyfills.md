# 0099. La app completa el `Intl` de Hermes con los polyfills de FormatJS

- Estado: Aceptado
- Fecha: 2026-11-06
- Issue: #250 (B-501)

## Contexto

La app corre sobre Hermes. En Android, Hermes trae `Intl.Collator`, `Intl.NumberFormat` (con `formatToParts`), `Intl.DateTimeFormat` (solo `format` y `resolvedOptions`) e `Intl.getCanonicalLocales`, pero no `Intl.PluralRules`, `Intl.Locale` ni `DateTimeFormat.prototype.formatToParts`/`formatRange` (documentación de Hermes, `doc/IntlAPIs.md`). Los mensajes de `packages/i18n` usan `plural` de ICU (`intl-messageformat` necesita `Intl.PluralRules`), y el día del club (`packages/domain`, `time.ts`) y el formato de fechas (`packages/i18n`, `format/date.ts`) usan `formatToParts` con `timeZone`. Los tests corren en Node, que tiene el `Intl` completo, así que no lo veían: en el primer APK de staging la pantalla del código de ingreso ("El código vence en {minutes, plural, …}") tiraba al renderizar y la app se cerraba.

## Decisión

- `apps/mobile/src/platform/intl.ts` importa, en este orden, los polyfills de FormatJS `intl-getcanonicallocales`, `intl-locale`, `intl-pluralrules`, `intl-numberformat` e `intl-datetimeformat`, con todas las zonas IANA (un club puede estar en cualquiera; `add-golden-tz` deja afuera zonas reales).
  - Datos de idioma: `es-AR` y `en` para números y fechas, `es` y `en` para plurales. `es-AR` va explícito porque CLDR `es` separa los miles recién desde 5 dígitos (`1234`) y `es-AR` desde 4 (`1.234`), y los `{x, number}` de los mensajes usan la agrupación por defecto.
  - Se usa la entrada condicional `polyfill.js` de cada uno, que se instala solo si el `Intl` del motor falta o está incompleto (`shouldPolyfill`). En Node y en un motor completo no cambia nada. En Hermes se instalan `Locale`, `PluralRules`, `DateTimeFormat` (le faltan `formatToParts` y `formatRange`) y también `NumberFormat`, porque la detección pide opciones de ES2020 y ES2023 que Hermes no tiene. La detección corre al abrir la app (unas pocas construcciones de prueba). Se eligió en lugar de `polyfill-force.js` para no reemplazar lo que un motor sí trae.
  - La excepción es `intl-getcanonicallocales`, que va forzado: su detección prueba una etiqueta de uso privado sin `try`, y si el analizador del motor la rechazara, la app se cerraría al abrir.
- La entrada de la app es `apps/mobile/index.ts` (`"main"` del paquete): importa `src/platform/intl-native.ts` y después `expo-router/entry`. Así los polyfills corren antes de cualquier ruta o módulo que formatee por construcción, no por cómo carga expo-router.
- El `DateTimeFormat` del polyfill usa UTC por defecto. `intl-native.ts` le fija la zona del teléfono (`expo-localization`) con `__setDefaultTimeZone`, el gancho documentado de FormatJS (las versiones van fijas en `package.json`). Así `Intl.DateTimeFormat().resolvedOptions().timeZone` sigue siendo la zona del teléfono, como con el nativo. Se fija al abrir la app: si el usuario cambia la zona del teléfono con la app abierta, la toma en el próximo arranque. Los cálculos del día usan la zona del club, no esta.
- `src/platform/intl.test.ts` saca de `Intl` lo que Hermes no tiene, instala el `NumberFormat` del polyfill (el de Node está completo) y carga los polyfills. Después verifica un mensaje con `plural`, los números en `es-AR` (`1.234`), el día en la zona del club y la zona por defecto.

## Consecuencias

- El paquete de JS de la app crece unos 2,5 MB sin comprimir (las zonas son 1,4 MB y cada archivo de idioma unos 220 KB). A cambio, mensajes, fechas y el día del club dan lo mismo en el teléfono que en la web y los tests.
- Si un código nuevo usa otra API de `Intl` (por ejemplo `RelativeTimeFormat`, `ListFormat` o `DisplayNames`), primero se revisa si Hermes la trae. Si no la trae, se agrega su polyfill en `intl.ts` y se suma al test.
