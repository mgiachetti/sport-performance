# Exposición y lesiones (B-210)

Horas de exposición desde la participación e incidencia de lesiones por 1000 horas, con la metodología del consenso de rugby (Fuller et al. 2007, _Br J Sports Med_ 41:328) y del consenso del IOC (Bahr et al. 2020, _Br J Sports Med_ 54:372). Funciones puras, sin I/O; las entradas inválidas lanzan `DomainValidationError` con `code: 'invalid_argument'` (nunca devuelven `NaN` ni `Infinity`).

## Exposición

- `ExposureEntry`: jugador, día del club (`LocalDate`), contexto (`training` o `match`) y **minutos realmente participados** (`durationMin`, 0 a 1440). Sale de la participación de cada sesión o partido (B-318): un ausente aporta 0, un suplente sus minutos en cancha.
- `exposureHours(entries, period?)` → `{ trainingH, matchH, totalH }` de la población cuyas entradas se pasan (por ejemplo, una categoría), en un período inclusive (`from`/`to` opcionales). Se suma en minutos y se convierte una sola vez.
- `exposureHoursByPlayer(entries, period?)` → las mismas horas por jugador.

## Lesiones

- `InjuryRecord`: jugador, `onsetDate`, contexto (`training`, `match` u `other`) y `returnDate` (vuelta a la participación plena; ausente o `null` si sigue abierta). No lleva diagnóstico: alcanza para las estadísticas agregadas que ve el staff no médico (B-410).
- **Días perdidos** (`injuryTimeLoss`): `returnDate − onsetDate`, con el día de la lesión como día 0 (volver al día siguiente = 1 día). Si la lesión sigue abierta en `asOfDate` (sin vuelta, o con vuelta posterior), se cuentan hasta `asOfDate` y se marca `ongoing` (dato censurado). Así las estadísticas "al día X" son reproducibles.
- **Definición de caso** (`InjuryIncidenceParams.definition`):
  - `time_loss` (por defecto, estándar del rugby): días perdidos ≥ `minTimeLossDays` (por defecto 1). Las lesiones abiertas cuentan siempre: el jugador todavía no volvió. El club que quiera la lectura estricta de "más de 24 h desde el final del día de la lesión" usa 2.
  - `medical_attention`: toda lesión registrada.
- `other` = fuera de la actividad del club: no hay exposición registrada, así que se informa aparte (`otherContextInjuryCount`) y no entra en ninguna tasa.

## Incidencia

`injuryIncidence({ exposures, injuries, asOfDate, period?, params? })` devuelve para `training`, `match` y `overall` (entrenamiento + partido):

| Campo | Qué es |
|---|---|
| `injuryCount`, `ongoingInjuryCount` | Casos con inicio en el período y, de esos, los abiertos en `asOfDate` |
| `exposureH` | Horas de exposición del contexto en el período |
| `incidence` | Casos por `ratePerHours` h (por defecto 1000); `null` sin exposición (no hay tasa, no es 0) |
| `incidenceConfidenceInterval` | Intervalo de Poisson **exacto** (Garwood) al `confidenceLevel` (por defecto 95%); válido con 0 casos |
| `daysLost`, `burden` | Días perdidos de los casos y carga lesional (días perdidos por `ratePerHours` h, IOC 2020) |

Además `excludedByDefinitionCount` (lesiones del período que no cumplen la definición) y `params` (los parámetros efectivos). Las lesiones se asignan al período por fecha de inicio y la exposición por día de la sesión. Exposiciones y lesiones deben ser de la misma población: el filtro (categoría, sexo, temporada) lo hace quien llama.

Parámetros por defecto como datos (`DEFAULT_INJURY_INCIDENCE_PARAMS`), listos para sembrar por club: `time_loss`, `minTimeLossDays = 1`, `ratePerHours = 1000`, `confidenceLevel = 0.95`.

Helpers: `incidencePer1000H`, `ratePerExposureHours`, `poissonMeanConfidenceInterval`, `poissonRateConfidenceInterval`.

## Fuera de alcance

Persistencia de participación y lesiones (B-301, B-304, B-318), permisos sobre datos médicos (B-303/B-304), la UI (B-410), exposición estimada a nivel equipo (jugadores en cancha × duración del partido) cuando no hay minutos por jugador, categorías de severidad y razón de tasas entre contextos.
