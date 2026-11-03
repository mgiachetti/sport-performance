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
| `roles.ts` | Roles de una membresía (`MEMBERSHIP_ROLES`: `player`, `parent`, `coach`, `sc`, `medical`, `admin`). `superadmin` no es un rol de club sino un atributo global del usuario (ADR 0007). |
| `test-result.ts` | Estado de un resultado de test (`done`, `not_done`) y motivo de "no realizado" (`absent`, `injured`, `not_applicable_to_stage`, `other`), B-301 / B-320. |
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
- **Automática:** parte de la etapa de la categoría (`AgeBand.defaultStage`) y la maduración la mueve si el offset de PHV proyectado al día (`offset + años transcurridos`, porque el offset es edad − edad del PHV) cruza los umbrales `developmentFromPhvOffsetYears` / `performanceFromPhvOffsetYears` **por al menos** `uncertaintyMarginYears` (el error de Mirwald/Moore ronda 0,5–0,6 años). Los intervalos son semiabiertos como los umbrales: sube con `offset ≥ umbral + margen` (justo en el borde ya sube: con los valores por defecto un M14 con offset 1,2 pasa a `development`) y baja con `offset < umbral − margen`. Como mucho se mueve `maxStageStepsFromCategory` etapas (por defecto 1: un M13/M14 maduro temprano llega a `development`, nunca a `performance`). Una estimación más vieja que `maxPhvOffsetEstimateAgeDays` (365) o posterior al día se ignora.
- **Parámetros por defecto como datos** (`DEFAULT_STAGE_ASSIGNMENT_PARAMS_BY_SEX`, para sembrar en la base y editar por club): varones 0,7 / 2,7 años: con el margen de 0,5, el madurador promedio (PHV ≈ 13,8 años) sube recién en offset 1,2 / 3,2 y baja recién bajo 0,2 / 2,2, que son justo los bordes de edad de M13–M14, M15–M16 y M17+ (una banda abarca la edad cumplida en el año de la temporada, así que un M14 tiene de 13,0 a 15,0 años), así que el jugador promedio queda en la etapa de su categoría todos los días de cada banda; mujeres corridas 2 años (PHV ≈ 11,8), **pendientes de validar** (B-805). No hay sexo por defecto: el llamador elige `params` según el sexo del jugador. `parseStageAssignmentParams` valida una configuración.
- **Fijación manual** (`StagePin`: etapa, `fromDate`, `untilDate` opcional, inclusivos): manda sobre la automática (`reason: pinned`) y puede ser cualquier etapa; si hay varias vigentes gana la que empezó último.
- **La etapa no relaja las reglas de la categoría:** percentiles propios y rankings con nombres también dependen de la categoría (`AgeBand`); la matriz de permisos (B-303) combina ambas.
- **Cargas máximas (principio 3):** una fijación o un tope de 2 pasos pueden poner a un M13/M14 en `performance`, pero los tests máximos con carga también dependen de la categoría (`AgeBand.maximalLoadTestsForPlayers`, falso en M13/M14). Los protocolos de test usan `maximalLoadTestsAllowed(stage, ageBand)` y `strengthAssessmentFor(stage, ageBand)` (que baja un 1RM directo a estimado), nunca `STAGE_PROFILES[stage]` solo.
- **Bio-banding:** esquemas como datos, por offset de PHV (`DEFAULT_PHV_OFFSET_BIO_BANDING`: pre < −1, circa −1 a < +1, post ≥ +1) o por % de talla adulta predicha (`DEFAULT_PCT_ADULT_HEIGHT_BIO_BANDING`, Cumming et al. 2017: < 85, 85–90, 90–95, ≥ 95). `bioBandFor` da la banda de un valor (valida el esquema en cada llamada; `createBioBandLookup(scheme)` lo valida una vez) y `groupByBioBand` agrupa jugadores en el orden del esquema, con los que no tienen dato (`null`/`undefined`) en `unbanded`; un `NaN` o infinito es un error y aborta todo el agrupamiento. `parseBioBandScheme` exige bandas contiguas, sin huecos ni solapamientos y abiertas en los extremos.
- El cálculo del offset y del % de talla adulta es de B-203; este módulo recibe los números.
## Carga de entrenamiento (B-202, `src/load/`)

| Función | Qué calcula |
|---|---|
| `sessionRpeLoadAu({ rpe, durationMin })` | `sRPE = RPE × minutos` (UA, `srpe_au`). RPE CR-10 en [0, 10] (admite medios puntos), duración en [0, 1440] min. |
| `dailyLoadsFromSessions`, `fillDailyLoads` | Suma las sesiones de cada día del club y rellena con 0 los días sin datos (`hasData: false`). Un descanso registrado es `loadAu: 0, hasData: true`. |
| `ewmaLambda`, `ewmaSeriesAu`, `acuteChronicWorkloadRatio` | EWMA (Williams et al. 2017): `EWMA_hoy = carga_hoy·λ + (1−λ)·EWMA_ayer`, `λ = 2/(N+1)`; `ACWR = aguda / crónica` (`null` si la crónica es 0). |
| `fosterMonotony` | Monotonía de Foster = media diaria / desvío (los días sin carga cuentan como 0); strain = carga de la ventana × monotonía. Con desvío 0 (todos los días iguales) monotonía y strain son `null`, nunca `Infinity`. |
| `computeLoadSeries` | Serie diaria de un jugador: EWMA aguda y crónica, ACWR con estado, días sin datos por ventana y monotonía/strain móviles. |
| `isoWeekLoadSummaries` | Carga semanal, monotonía y strain por semana ISO (lunes a domingo). |

**Parámetros** (`DEFAULT_LOAD_PARAMETERS`; por club con `resolveLoadParameters(json)`, que valida, rechaza claves desconocidas y completa con los valores por defecto):

| Parámetro | Defecto | Nota |
|---|---|---|
| `acuteWindowDays` | 7 | `N` de la EWMA aguda. |
| `chronicWindowDays` | 28 | `N` de la EWMA crónica; mayor que la aguda. |
| `minHistoryDays` | 28 | Con menos días de historia el ACWR es `insufficient_history`: no se informa y no dispara alertas (B-207). |
| `ewmaSeed` | `first_day` | La EWMA del primer día es la carga de ese día. `zero` arranca desde 0 (subestima la crónica durante semanas). |
| `monotonyWindowDays` | 7 | Ventana móvil de monotonía y strain. |
| `monotonyStandardDeviation` | `sample` | Desvío muestral (`n − 1`, el `DESVEST` de las planillas); `population` divide por `n`. |

**Historia y días sin datos:**

- La historia empieza el primer día con carga o en `historyStart` (inicio del monitoreo, si se conoce). `historyDays` cuenta ese día como 1. Los días previos devuelven 0 con `insufficient_history`.
- Los días sin datos cuentan como carga 0 en la EWMA y en la monotonía (Foster); `missingDaysInAcuteWindow` y `missingDaysInChronicWindow` permiten mostrar la cobertura y no confiar en un ACWR armado con pocas respuestas.
- Monotonía y strain solo se informan cuando la ventana completa está dentro de la historia (`monotonyStatus`). La semana ISO que empieza antes de la historia o termina después de `to` es `incomplete_week` (se informa el total de los días conocidos).
- El día de cada sesión se calcula afuera con `localDateInTimeZone` en la zona del club.
## Maduración (B-203)

Módulo `src/maturation/`. Los coeficientes y los parámetros son **datos** tipados (con su fuente y estado de verificación), listos para el seed de B-306; las funciones evalúan cualquier modelo o tabla que cumpla la interfaz.

| Archivo | Qué define |
|---|---|
| `maturity-offset.ts` | Offset de maduración (`phv_offset_years`, años desde el PHV) y edad del PHV. `MATURITY_OFFSET_MODELS` (un modelo lineal por ecuación y sexo), `predictMaturityOffset(model, input)` y `maturityOffset({ sex, equation?, … })`. Ecuación por defecto: `moore_2015`. |
| `khamis-roche.ts`, `khamis-roche-1994.ts` | Talla adulta predicha y % alcanzado (`adult_height_pct`): interfaz `KhamisRocheTable`, `predictAdultHeight`, validación de tablas cargadas desde la base y la tabla por defecto `KHAMIS_ROCHE_1994_TABLE`. |
| `growth-velocity.ts` | Velocidad de crecimiento (`growth_velocity_cm_year`) entre dos mediciones y `latestGrowthVelocity` con intervalo mínimo/máximo configurable (por defecto 84–400 días). |
| `peak-zone.ts` | Zona de pico (`peakHeightVelocityZone`): ventana de offset (por defecto −1 a +1 años) y umbral opcional de velocidad (por defecto apagado). Devuelve qué criterio se cumplió para la regla de B-207. |
| `provenance.ts` | `CoefficientProvenance` y `CoefficientVerificationStatus` (`verified_against_publication`, `cross_checked_secondary_sources`, `unverified`). |

### Ecuaciones de offset de maduración

E = edad decimal (días / 365,25), T = talla (cm), TS = talla sentado (cm, sin el banco), LP = T − TS, P = peso (kg).

| Ecuación | Sexo | Fórmula (años desde el PHV) | SEE | Muestra |
|---|---|---|---|---|
| `mirwald_2002` | varones | −9,236 + 0,0002708·(LP·TS) − 0,001663·(E·LP) + 0,007216·(E·TS) + 0,02292·(P/T·100) | 0,49 | 8–16 años |
| `mirwald_2002` | mujeres | −9,376 + 0,0001882·(LP·TS) + 0,0022·(E·LP) + 0,005841·(E·TS) − 0,002658·(E·P) + 0,07693·(P/T·100) | 0,50 | 8–16 años |
| `moore_2015` | varones | −8,128741 + 0,0070346·(E·TS) | 0,51 | 7,5–17,5 años |
| `moore_2015` | mujeres | −7,709133 + 0,0042232·(E·T) | 0,52 | 7,5–17,5 años |
| `moore_2015_height` | varones | −7,999994 + 0,0036124·(E·T) (sin talla sentado) | — | 7,5–17,5 años |

Fuera del rango de edad de la muestra de desarrollo el resultado se devuelve igual, con el aviso `age_outside_development_sample`. Mirwald et al. recomiendan leer el offset como categoría (antes, cerca o después del PHV) más que como valor continuo.

- Mirwald RL, Baxter-Jones ADG, Bailey DA, Beunen GP. *An assessment of maturity from anthropometric measurements.* Med Sci Sports Exerc. 2002;34(4):689–694. doi:10.1097/00005768-200204000-00020 (PMID 11932580).
- Moore SA, McKay HA, Macdonald H, Nettlefold L, Baxter-Jones ADG, Cameron N, Brasher PMA. *Enhancing a somatic maturity prediction model.* Med Sci Sports Exerc. 2015;47(8):1755–1764. doi:10.1249/MSS.0000000000000588 (PMID 25423445).

### Khamis-Roche

`talla adulta (in) = β0 + β1·talla (in) + β2·peso (lb) + β3·talla media de los padres (in)`, con coeficientes por sexo y edad (4,0 a 17,5 años, cada medio año) y conversión interna desde cm/kg (1 in = 2,54 cm, 1 lb = 0,45359237 kg). La talla media de los padres es el promedio simple de madre y padre (el ajuste por sexo está en los coeficientes). Entre filas se interpola linealmente (`ageMode: 'linear'`, decisión de producto para que las series no salten) o se usa la fila más cercana (`'nearest_row'`). Fuera de 4,0–17,5 años se lanza error: no se extrapola. Si la predicción queda por debajo de la talla actual (posible al final de la tabla) no se recorta: se marca `predictionBelowCurrentHeight` y el % supera 100.

- Khamis HJ, Roche AF. *Predicting adult stature without using skeletal age: the Khamis-Roche method.* Pediatrics. 1994;94(4 Pt 1):504–507 (PMID 7936860). Errata: Pediatrics. 1995;95(3):457 (coeficientes del peso).
- Aplicable a chicos blancos estadounidenses sanos (Fels Longitudinal Study): para otras poblaciones es una aproximación.

### Checklist de verificación de coeficientes

Antes de producción cada fila tiene que pasar a "contrastado con el paper" por una persona con acceso al artículo; recién entonces se cambia `verification` a `verified_against_publication`. Estado al abrir B-203 (no se pudo acceder al texto completo de ningún artículo: paywall o captcha; los resúmenes de PubMed sí):

| Coeficientes | Fuentes con las que se contrastó | Contrastado con el paper | Notas |
|---|---|---|---|
| Mirwald 2002, varones | J Sports Sci Med 2022;21:640 (tabla 2), explicador sportkid (Substack), CLAUDE.md | [ ] | SEE y R² del resumen de PubMed. CRAN matuR usa 0,0002728 en el primer término; el resto de las fuentes, 0,0002708. |
| Mirwald 2002, mujeres | CRAN matuR (`maturation_cm.R`), sportkid, CLAUDE.md | [ ] | SEE y R² del resumen de PubMed. |
| Moore 2015, varones (E·TS) | Documentación de AthleteMonitoring, sportkid | [ ] | J Sports Sci Med 2022 imprime −8,125741 (errata de esa fuente). CLAUDE.md lo tenía redondeado a −8,1. |
| Moore 2015, mujeres (E·T) | AthleteMonitoring, sportkid, CLAUDE.md | [ ] | |
| Moore 2015, varones (E·T) | J Sports Sci Med 2022 (tabla 2, "Moore-2") | [ ] | Una sola fuente secundaria; falta el SEE. |
| Khamis-Roche 1994, varones (β0, β1, β2, β3) | vilda-calc, 2nk1/performance-monitor, DadosGPS/Ulisses-Dashboard, CRAN matuR | [ ] | β2 con los valores de la errata (×10 sobre la impresión de 1994, que es lo que trae matuR). |
| Khamis-Roche 1994, mujeres (β0, β1, β2, β3) | vilda-calc, 2nk1/performance-monitor, CRAN matuR | [ ] | β0 a los 5,0 años: −5,13582 en dos fuentes, −5,13583 en una. |
| Ejemplo trabajado de Khamis-Roche (p. 507) | — | [ ] | Agregarlo como test al acceder al artículo. Los tests usan los casos de control de vilda-calc. |
## Reglas de alerta (B-207, `src/alerts/`)

Decisiones en [ADR 0022](../../docs/adr/0022-motor-de-reglas-de-alerta.md).

```ts
const rules = parseAlertRuleSet(rowsFromAlertRuleTable); // unknown → AlertRule[] validado
const { alerts, skipped } = evaluateAlertRules(rules, {
  date, // LocalDate del club
  sport, sex, stage, // para `appliesTo`
  acwr: { ratio, historyDays }, // de B-202
  wellness: [{ date, meanScore }], // meanWellnessScore(items) por día
  cmj: { measurements: [{ date, heightCm }], baselineHeightCm }, // base fijada por el staff, opcional
  growth: { velocityCmYear, measuredOn }, // de B-203
});
```

- Una regla es JSON: `code`, `kind`, `enabled`, `appliesTo?` y `params` con umbrales por severidad (`null` si no se usa). `DEFAULT_ALERT_RULES` tiene los valores de CLAUDE.md y es la fuente del seed (B-306).
- Cada regla da a lo sumo una alerta, con la severidad más alta alcanzada; las alertas vienen ordenadas (crítico primero, después el orden de las reglas).
- Una alerta trae `messageKey` / `suggestionKey` (`alert.<kind>.*`, textos en `packages/i18n`) y `values` numéricos para interpolar. Sin texto de UI.
- Lo que no se pudo evaluar va a `skipped` con motivo (`insufficient_history` con < 28 días de carga, `no_data`, `stale_data`, `no_variance`, `disabled`, `not_applicable`): faltar datos nunca es una alerta.
- Los datos posteriores a `date` se ignoran, así se puede reevaluar un día pasado con la historia completa.
- **Episodios** (B-327, [ADR 0053](../../docs/adr/0053-alertas-episodios-eventos-y-revision.md), `src/alerts/episodes.ts`): `nextAlertEpisode(último, día, alerta | null)` dice qué persistir para una regla y un jugador (nada, abrir uno nuevo o actualizar el último): sigue mientras dispare, la severidad máxima nunca baja, escalar reabre la revisión, se resuelve el primer día que no dispara y solo avanza en el tiempo. `alertReviewProblems` valida un acuse o descarte; `cmjMeasurementsForAlerts` deja solo los CMJ del mismo método que el último (principio 4).
## Exposición y lesiones (B-210)

`src/exposure/`: horas de exposición (entrenamiento y partido) desde los minutos de participación e incidencia de lesiones por 1000 h con intervalo de Poisson exacto y carga lesional (días perdidos por 1000 h), según Fuller et al. 2007 y el consenso del IOC 2020. Definición de caso (`time_loss` o `medical_attention`) y demás parámetros con valores por defecto como datos (`DEFAULT_INJURY_INCIDENCE_PARAMS`). Detalle en [`src/exposure/README.md`](src/exposure/README.md).
## Percentiles y referencias de primera (B-208)

Módulo `src/percentiles/`. Todo entra por parámetro (muestras, referencias, configuración); los valores por defecto son datos listos para el seed.

- **Grupo de comparación.** `PercentileGrouping` elige dimensiones (`sex`, `category`, `line`, `position`) y temporadas acumuladas (`seasonsAccumulated`: ventana `[temporada − n + 1, temporada]`, nunca temporadas posteriores). Deporte y métrica siempre se igualan. Las muestras sin la dimensión pedida quedan afuera; si el sujeto no la tiene, el agrupamiento se saltea (`missing_dimension`).
- **Un valor por jugador.** Los resultados de un jugador en la ventana se agregan con `best` (según el sentido de mejora), `latest` (los del mismo día se promedian) o `mean`. Por defecto `best`, o `latest` en métricas neutrales. El jugador evaluado entra una sola vez, con el valor que se evalúa; un sujeto sin `playerId` (por ejemplo, un valor de primera) se ubica en el grupo sin sumarse.
- **Métodos (principio 4).** `same_method` (por defecto) compara solo contra el mismo método; `any_method` compara contra todos y marca `mixedMethods`.
- **Percentil.** Rango medio, `PR = (peores + 0,5 · empates) / N × 100`, respetando el sentido de mejora. `valueAtPercentile` interpola como `PERCENTILE.INC` (tipo 7) y `summarizeDistribution` da media, mínimo, máximo y P10…P90; en ambos P90 es siempre el extremo "mejor".
- **Tamaño mínimo y respaldo.** `computePercentile` prueba los agrupamientos de `PercentileSettings.groupings` en orden y usa el primero con al menos `minSampleSize` jugadores distintos; si ninguno llega, devuelve `insufficient_sample` sin percentil. `DEFAULT_PERCENTILE_SETTINGS`: mínimo 10; posición → línea → línea con 3 temporadas → categoría y sexo con 3 temporadas, siempre con sexo y categoría. El resultado trae el `n` de cada intento y no expone identidades de otros jugadores.
- **Referencias de primera.** `FirstTeamReference` (métrica, deporte, sexo, posición o línea opcional, valor, unidad, método, vigencia y fuente) es una entrada (B-004, B-321). `selectFirstTeamReference` elige la más específica (posición > línea > plantel) vigente a la fecha; `compareToFirstTeamReference` da diferencia absoluta y %, % de la referencia, si la alcanza según el sentido de mejora y si los métodos difieren; rechaza unidades distintas.
- **Posiciones y líneas.** `DEFAULT_POSITION_LINES` mapea las posiciones de rugby a `forwards` / `backs`; `lineForPosition` acepta el mapeo del club. Hockey llega con M8.

## Extender

- **Deporte o sexo nuevo:** agregar el valor a `SPORTS` / `SEXES` y una migración. Los `Record<Sport, …>` del código dejan de compilar hasta cubrir el caso nuevo.
- **Coeficientes de maduración corregidos o nuevos:** son datos (`MATURITY_OFFSET_MODELS`, `KhamisRocheTable`); se agregan con su `CoefficientProvenance` y se actualiza el checklist de arriba.
- **Métrica o test nuevo del club:** son datos del diccionario (seed B-306, configuración B-322); cualquier código válido es un `MetricCode` / `TestCode`. Solo se agregan a `CANONICAL_METRICS` las métricas que definen las fórmulas del dominio o que son comunes a todos los clubes.
- **Categorías de un club:** se modelan como `AgeBand` propias (con datos extra si hace falta); `ageBandForBirthYear` es genérica.
