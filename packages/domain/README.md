# @sport-performance/domain

Modelo de dominio y fórmulas puras (métricas, carga, maduración). Sin I/O ni dependencias en runtime: todo función pura con tests y unidades explícitas en los nombres (`heightCm`, `speedMs`, `timeS`).

## Tipos base (B-201)

| Módulo | Qué define |
|---|---|
| `sport.ts`, `sex.ts` | `Sport` (`rugby`, `hockey`) y `Sex` (`male`, `female`). Sin valor por defecto de sexo (ADR 0017). |
| `stage.ts` | `Stage`: `foundation` (M13/M14), `development` (M15/M16), `performance` (M17/M19), su orden y `STAGE_PROFILES` (modo de fuerza, cargas máximas, antropometría, ítems de bienestar, CMJ semanal, percentiles y rankings). |
| `category.ts` | `AgeBand` y `DEFAULT_AGE_BANDS` (M13…M17, M19; no hay M18) con la etapa por defecto y las reglas de visibilidad por categoría (percentiles propios desde M15, rankings con nombres desde M17); `ageBandForBirthYear` asigna por año de nacimiento (`añoTemporada − añoNacimiento`). Los nombres de categoría de cada club son datos. |
| `units.ts` | Catálogo de unidades (`UNITS`: código, símbolo internacional o `null`, dimensión) y conversiones (`kmhToMs`, `msToKmh`, `secondsToMsec`…). Sin texto de UI: las etiquetas es-AR (`años`, `lpm`, `UA`) están en `packages/i18n` (`unit.<UnitCode>`). |
| `codes.ts` | `MetricCode` y `TestCode` (branded, `snake_case` validado), la batería canónica (`CANONICAL_TEST_CODES`) y el diccionario canónico (`CANONICAL_METRICS`) con unidad, origen, sentido de mejora, test y deportes. |
| `measurement.ts` | Método de medición (`manual`, `video`, `photocell`, `pod`, `app`, `historical`) e ítems de bienestar. |
| `ids.ts` | `ClubId`, `UserId`, `PlayerId`, `CategoryId`: UUID branded que no se mezclan entre sí. |
| `time.ts` | `TimeZone`, `LocalDate`, el día del club, aritmética de calendario y edades. |
| `errors.ts` | `DomainValidationError` con `code` estable. |

Toda enumeración cerrada tiene la misma forma: constante `UPPER_CASE` como fuente de verdad, tipo derivado, guard `isX(value): value is X` y parser `parseX(value): X` que lanza `DomainValidationError`. `packages/contracts` arma sus esquemas `zod` sobre estas constantes (`z.enum(SPORTS)`) y guards (`z.string().refine(isLocalDate)`), sin redefinir los valores.

## Rangos plausibles (B-206)

`plausibility/` avisa de errores de tipeo al cargar (un 40 m en 3 s, 512 en vez de 5,12) **sin bloquear la carga**: un valor fuera de rango es un resultado, nunca una excepción.

- `PlausibleRange`: `metricCode`, `sex` (`null` = los dos), `minAgeYears` (inclusivo) y `maxAgeYears` (exclusivo), `null` = abierto, y `minValue` / `maxValue` (inclusivos) en la unidad del código de la métrica. Tiene la forma de una fila para sembrarla en la base (B-306).
- `DEFAULT_PLAUSIBLE_RANGES`: valores por defecto, amplios a propósito, para las métricas canónicas que se cargan a mano. Altura y peso van por edad (`< 14`, `14–17`, `≥ 17`) y por sexo. No incluye métricas derivadas ni de GPS.
- `checkPlausibleValue({ metricCode, value, sex, ageYears }, ranges?)` y `createPlausibilityChecker(ranges?)`, que valida e indexa una vez, devuelven `within`, `below`, `above` o `no_range`, con los límites usados. Gana el rango del mismo sexo sobre el que no tiene sexo. La edad es la decimal a la fecha de la medición (`decimalAgeYears`). Con edad desconocida (`null`) se usa la envolvente de todos los rangos de la métrica para ese sexo. Fuera de rango, `suggestedValues` lista los valores que resultan de correr la coma (×10^k, |k| ≤ 3) y caen dentro del rango.
- `validatePlausibleRanges` rechaza rangos mal formados y rangos de la misma métrica y el mismo sexo que se superponen en edad. `mergePlausibleRanges(defaults, overrides)`: si el club configura una métrica, sus rangos reemplazan a todos los rangos por defecto de esa métrica.

## Convención de unidades en los nombres

- El sufijo de unidad de un código de métrica y de un identificador es el `code` de la unidad en `UNITS`: `height_cm` / `heightCm`, `vmax_ms` / `vmaxMs`, `vift_kmh` / `viftKmh`.
- **`ms` siempre es m/s.** Los milisegundos son `msec` (`reaction_simple_msec`, `latencyMsec`).
- **`n` siempre es una cantidad** (`acc_n`, `contacts_n`). Los newtons son `newton` (`neck_flexion_newton`).
- Unidades compuestas con guion bajo: `m_min`, `kg_kg`, `cm_year`; `ms2` para m/s².
- Las únicas métricas canónicas sin sufijo son `hr_avg`, `hr_max` y `trimp` (nombres establecidos; `UNITLESS_NAME_METRIC_CODES`). Un test verifica que el resto termine con su unidad.
- Nunca se usa el nombre "PlayerLoad": los parsers rechazan cualquier código que lo contenga.

Las unidades van en los nombres y no en tipos branded por magnitud (`Cm`, `Kg`): las fórmulas son aritmética simple y los brands numéricos obligarían a castear en cada operación sin agregar seguridad real. Los brands se reservan para strings con formato (UUID, fechas, zonas, códigos).

## Tiempo: "el día" es el día del club

- Un **instante** (`Date` o epoch ms) es un punto en UTC; es lo que guardan la base y la cola de sincronización.
- Un **`LocalDate`** (`YYYY-MM-DD`) es un día de calendario sin hora ni zona. Bienestar, rachas, carga diaria y EWMA se agrupan por `LocalDate`.
- El `LocalDate` de un instante se calcula **siempre en la zona IANA del club** (`localDateInTimeZone`), nunca en la del dispositivo ni la del servidor. `dayBoundsInTimeZone` da el intervalo `[start, end)` en UTC para consultar un día, correcto en días de 23 y 25 horas y cuando la medianoche no existe por el cambio de horario.
- `localDateRange` lista los días de un período (para contar como 0 los días sin carga) y `startOfIsoWeek` da el lunes de la semana (monotonía y strain).
- `decimalAgeYears` usa días / 365,25 (la "edad decimal" de Mirwald y Moore); `ageInCompletedYears` cumple los años del 29 de febrero el 1 de marzo en años no bisiestos.
- `dayBoundsRangeInTimeZone` da los intervalos de todos los días de un período (rellenos diarios de B-202) a un tercio del costo de llamar `dayBoundsInTimeZone` día por día.
- `TimeZone` acepta solo `UTC` o nombres `Área/Lugar` en la grafía IANA (`America/Argentina/Buenos_Aires`), tal como vienen y sin canonicalizar. Se rechazan los offsets fijos y los nombres sin región (`+03:00`, `Etc/GMT+3`, `EST`, `MST`, `GMT`) y las grafías con otras mayúsculas que Intl acepta igual (`america/argentina/buenos_aires`), para que una grafía sea siempre el mismo string.
- Rango soportado: `LocalDate` de 0001-01-01 a 9999-12-31, también en `dayBoundsInTimeZone` y `localDateInTimeZone` (un instante es válido si su día en la zona está en ese rango).

## Etapa del jugador (B-204), `player-stage/`

- **`assignPlayerStage({ onDate, categoryStage, phvOffset?, pins?, params })`** da la etapa de un día y por qué: `basis` (`manual`, `maturation`, `category`) y un `reason` estable para la UI y el historial (`STAGE_REASONS`: `pinned` si manda una fijación; si no, el motivo de la automática), la fijación vigente si la hay y siempre la sugerencia automática (`automatic`, con su propio `reason`), para mostrar "fijada en X, sugerida Y". `params` es obligatorio (no hay sexo por defecto, ADR 0017). Para un plantel entero, `createPlayerStageAssigner(params)` valida los parámetros una sola vez.
- **Motivos de la automática** (`AUTOMATIC_STAGE_REASONS`): `no_maturation_estimate`, `maturation_estimate_stale`, `maturation_estimate_after_date`, `maturation_matches_category`, `within_uncertainty_margin`, `maturation_disabled` (el club puso tope 0 y la maduración habría movido la etapa), `maturation_shift` y `maturation_shift_capped`.
- **Automática:** parte de la etapa de la categoría (`AgeBand.defaultStage`) y la maduración la mueve si el offset de PHV proyectado al día (`offset + años transcurridos`, porque el offset es edad − edad del PHV) cruza los umbrales `developmentFromPhvOffsetYears` / `performanceFromPhvOffsetYears` **por al menos** `uncertaintyMarginYears` (el error de Mirwald/Moore ronda 0,5–0,6 años). Los intervalos son semiabiertos como los umbrales: sube con `offset ≥ umbral + margen` (justo en el borde ya sube: un M14 con offset 1,0 pasa a `development`) y baja con `offset < umbral − margen`. Como mucho se mueve `maxStageStepsFromCategory` etapas (por defecto 1: un M13/M14 maduro temprano llega a `development`, nunca a `performance`). Una estimación más vieja que `maxPhvOffsetEstimateAgeDays` (365) o posterior al día se ignora.
- **Parámetros por defecto como datos** (`DEFAULT_STAGE_ASSIGNMENT_PARAMS_BY_SEX`, para sembrar en la base y editar por club): varones 0,5 / 2,5 años, donde el madurador promedio (PHV ≈ 13,8 años) pasa de M14 a M15 y de M16 a M17, así que el jugador promedio queda en la etapa de su categoría; mujeres corridas 2 años (PHV ≈ 11,8), **pendientes de validar** (B-805). No hay sexo por defecto: el llamador elige `params` según el sexo del jugador. `parseStageAssignmentParams` valida una configuración.
- **Fijación manual** (`StagePin`: etapa, `fromDate`, `untilDate` opcional, inclusivos): manda sobre la automática (`reason: pinned`) y puede ser cualquier etapa; si hay varias vigentes gana la que empezó último.
- **La etapa no relaja las reglas de la categoría:** percentiles propios y rankings con nombres también dependen de la categoría (`AgeBand`); la matriz de permisos (B-303) combina ambas.
- **Cargas máximas (principio 3):** una fijación o un tope de 2 pasos pueden poner a un M13/M14 en `performance`, pero los tests máximos con carga también dependen de la categoría (`AgeBand.maximalLoadTestsForPlayers`, falso en M13/M14). Los protocolos de test usan `maximalLoadTestsAllowed(stage, ageBand)` y `strengthAssessmentFor(stage, ageBand)` (que baja un 1RM directo a estimado), nunca `STAGE_PROFILES[stage]` solo.
- **Bio-banding:** esquemas como datos, por offset de PHV (`DEFAULT_PHV_OFFSET_BIO_BANDING`: pre < −1, circa −1 a < +1, post ≥ +1) o por % de talla adulta predicha (`DEFAULT_PCT_ADULT_HEIGHT_BIO_BANDING`, Cumming et al. 2017: < 85, 85–90, 90–95, ≥ 95). `bioBandFor` da la banda de un valor (valida el esquema en cada llamada; `createBioBandLookup(scheme)` lo valida una vez) y `groupByBioBand` agrupa jugadores en el orden del esquema, con los que no tienen dato (`null`/`undefined`) en `unbanded`; un `NaN` o infinito es un error y aborta todo el agrupamiento. `parseBioBandScheme` exige bandas contiguas, sin huecos ni solapamientos y abiertas en los extremos.
- El cálculo del offset y del % de talla adulta es de B-203; este módulo recibe los números.

## Extender

- **Deporte o sexo nuevo:** agregar el valor a `SPORTS` / `SEXES` y una migración. Los `Record<Sport, …>` del código dejan de compilar hasta cubrir el caso nuevo.
- **Métrica o test nuevo del club:** son datos del diccionario (seed B-306, configuración B-322); cualquier código válido es un `MetricCode` / `TestCode`. Solo se agregan a `CANONICAL_METRICS` las métricas que definen las fórmulas del dominio o que son comunes a todos los clubes.
- **Categorías de un club:** se modelan como `AgeBand` propias (con datos extra si hace falta); `ageBandForBirthYear` es genérica.
