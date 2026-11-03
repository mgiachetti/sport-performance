# @sport-performance/i18n

Mensajes ICU compartidos por web, mobile, API y worker (español rioplatense, voseo) y formateo es-AR de números, fechas y unidades (B-105). Decisiones en [ADR 0019](../../docs/adr/0019-i18n-y-formatos-es-ar.md).

## Mensajes

```ts
import { createTranslator, formatDateTime, formatUnit, resolveLocale } from '@sport-performance/i18n';

const { t } = createTranslator({ locale: resolveLocale(navigator.languages) });

t('common.save'); // 'Guardar'
t('sync.pending', { count: 3 }); // '3 cambios sin enviar'
t('sync.lastSynced', { dateTime: formatDateTime(syncedAt, { timeZone: club.timeZone }) });
t('rpe.sessionLoad', { load: formatUnit(420, 'au') }); // 'Carga de la sesión: 420 UA'
```

- El catálogo fuente es [`src/messages/es-AR.ts`](src/messages/es-AR.ts). Las claves están tipadas: una clave inexistente no compila y un mensaje con argumentos exige valores.
- El catálogo se arma con tres archivos: [`es-AR.ts`](src/messages/es-AR.ts) (lo compartido por la API, la web y la app), [`web.ts`](src/messages/web.ts) (solo la web del staff) y [`mobile.ts`](src/messages/mobile.ts) (solo la app). Cada clave vive en un solo archivo (`files.test.ts` falla si se repite): un concepto que muestran las dos apps tiene una clave, un texto y unos argumentos, en `es-AR.ts`.
- Los argumentos son `string | number`. Fechas y medidas se formatean antes (con la zona horaria del club) y se pasan como texto.
- Overrides por club (terminología white-label): `createTranslator({ overrides })`. Validarlos con `validateCatalog(overrides)` antes de guardarlos.
- Del lado del servidor: `resolveLocale(parseAcceptLanguage(req.headers['accept-language']))`.
- Crear un translator por locale/club y reutilizarlo: cachea los formateadores compilados.

## Formatos

| Función | Ejemplo |
|---|---|
| `formatNumber(1234.5)` | `1.234,5` |
| `formatNumber(3.21, { sign: 'always', decimals: 1 })` | `+3,2` |
| `formatUnit(1.853, 's')` | `1,85 s` |
| `formatUnit(8.2, 'ms')` | `8,20 m/s` |
| `formatUnit(12.5, 'pct')` | `12,5 %` |
| `formatDuration(275)` | `4:35` |
| `formatDate(instant, { timeZone })` | `03/03/2026` |
| `formatTime(instant, { timeZone })` | `18:05` |
| `formatDateTime(instant, { timeZone })` | `03/03/2026 18:05` |
| `formatDateLong(instant, { timeZone })` | `martes 3 de marzo de 2026` |
| `formatLocalDate(birthDate)` | `01/03/2010` (`LocalDate` del dominio, sin zona horaria) |
| `parseNumber('1.234,5')` | `1234.5` (`'1.85'` → `null`) |

- Valores faltantes o no finitos se muestran como `—`; nunca `-0`.
- El número y la unidad van unidos por espacio no separable (`NBSP`).
- `pct` recibe puntos porcentuales (`12.5`), no una proporción.
- Los formateadores de instantes exigen `timeZone` (el `TimeZone` del dominio, la del club). "El día" de un instante en la zona del club se calcula con `localDateInTimeZone` de `@sport-performance/domain`; acá solo se formatea.

## Unidades

Las unidades son los `UnitCode` de `packages/domain` (`s`, `ms` = m/s, `msec` = milisegundos, `pct`, `au`, …). El dominio solo guarda el símbolo internacional de cada unidad (`m/s`, `km/h`, `N`, `%`) o `null` cuando no hay uno. Lo que se muestra al lado de un valor es texto de UI y vive acá: una clave `unit.<UnitCode>` por unidad (`UNIT_MESSAGES_ES_AR`, `unitLabelEsAr`), que usa `formatUnit`. Las unidades sin símbolo internacional llevan su texto es-AR (`años`, `cm/año`, `lpm`, `UA`); las cantidades y los puntajes no llevan etiqueta. Los decimales por defecto están en `UNIT_DEFAULT_DECIMALS`. Etiquetas y decimales están tipados contra todos los `UnitCode`: si se agrega una unidad al dominio, este paquete no compila hasta que tenga las dos cosas.
