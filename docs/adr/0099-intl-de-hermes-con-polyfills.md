# 0099. La app completa el `Intl` de Hermes con los polyfills de FormatJS

- Estado: Aceptado
- Fecha: 2026-11-06
- Issue: #250 (B-501)

## Contexto

La app corre sobre Hermes. En Android, Hermes trae `Intl.Collator`, `Intl.NumberFormat` (con `formatToParts`), `Intl.DateTimeFormat` (solo `format` y `resolvedOptions`) e `Intl.getCanonicalLocales`, pero no `Intl.PluralRules`, `Intl.Locale` ni `DateTimeFormat.prototype.formatToParts`/`formatRange` (documentación de Hermes, `doc/IntlAPIs.md`). Los mensajes de `packages/i18n` usan `plural` de ICU (`intl-messageformat` necesita `Intl.PluralRules`), y el día del club (`packages/domain`, `time.ts`) y el formato de fechas (`packages/i18n`, `format/date.ts`) usan `formatToParts` con `timeZone`. Los tests corren en Node, que tiene el `Intl` completo, así que no lo veían: en el primer APK de staging la pantalla del código de ingreso ("El código vence en {minutes, plural, …}") tiraba al renderizar y la app se cerraba.

## Decisión

- `apps/mobile/src/platform/intl.ts` importa, en este orden, los polyfills de FormatJS `intl-getcanonicallocales`, `intl-locale`, `intl-pluralrules`, `intl-numberformat` e `intl-datetimeformat` (con los datos de `es` y `en`, y todas las zonas IANA: un club puede estar en cualquiera). Se usa la entrada `polyfill.js` de cada uno, que se instala solo si el `Intl` del motor falta o está incompleto (`shouldPolyfill`): en Node y en un motor completo no cambia nada.
- `app/_layout.tsx` lo importa primero (por `src/platform/intl-native.ts`), antes de cualquier módulo que formatee.
- El `DateTimeFormat` del polyfill usa UTC por defecto; `intl-native.ts` le fija la zona del teléfono (`expo-localization`), así `Intl.DateTimeFormat().resolvedOptions().timeZone` sigue siendo la zona del teléfono, como con el nativo.
- `src/platform/intl.test.ts` saca de `Intl` lo que Hermes no tiene, carga los polyfills y verifica un mensaje con `plural`, el día en la zona del club y la zona por defecto.

## Consecuencias

- El paquete de JS de la app crece (los datos de zonas son lo más pesado). A cambio, mensajes, fechas y el día del club dan lo mismo en el teléfono que en la web y los tests.
- Si un código nuevo usa otra API de `Intl` (por ejemplo `RelativeTimeFormat`, `ListFormat` o `DisplayNames`), primero se revisa si Hermes la trae. Si no la trae, se agrega su polyfill en `intl.ts` y se suma al test.
