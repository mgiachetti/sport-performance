# 0110. Métricas del pod: definiciones como datos del club, cálculo desde el log recortado, Vmax de referencia y señales en vivo

- Estado: Aceptado
- Fecha: 2026-11-08
- Issue: #296 (B-919)

## Contexto

Cubre también las señales en vivo de #275 (B-906).

El [ADR 0106](0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md) pidió que las métricas del pod se definan como datos del club copiados de OpenField (filtros, tiempos de permanencia, umbrales por sexo, fórmula de `accel_load_au`), con la variante y las versiones en cada valor, una Vmax de referencia registrada, filtro de plausibilidad, sin contactos en hockey y un vivo aproximado. El [ADR 0108](0108-ingesta-del-log-del-pod.md) dejó por jugador un `pod_raw` recortado (PVT a 10 Hz con velocidad Doppler e IMU) y sus ventanas en `pod_raw_trim`, y las trazas a 1 Hz en `pod_trace_segment`, sin calcular métricas. Faltaba decidir qué fórmula sale de qué parámetro, dónde viven los parámetros, cómo se versiona y recalcula un valor, qué Vmax usan las relativas, dónde se guardan los valores y cómo se arman las señales de la pantalla en vivo con los contadores del paquete LoRa. La configuración de OpenField de primera todavía no llegó (B-002).

## Decisión

### Definiciones como datos del club

- **`pod_metric_config`** (migración `0056`): una fila por alcance (deporte y sexo, `null` = cualquiera) con vigencia `[valid_from, valid_to)` como las zonas de velocidad ([ADR 0041](0041-configuracion-del-club.md)): cambiar una definición vigente cierra la fila y abre otra, así una sesión pasada se recalcula siempre con lo que tenía. `params` es un `PodMetricParams` del dominio (`parsePodMetricParams` rechaza campos desconocidos y valores fuera de rango, con la ruta), `algorithm_version` dice para qué algoritmo son y `verification` es `unverified` hasta que el club cargue su OpenField (`club_openfield`). La leen todos los miembros y la escriben `sc` y la administración; la pantalla y los endpoints quedan para B-409/B-919 cuando llegue la exportación.
- **Lo que ya era dato del club no se repite**: `hsr_abs_m` usa la zona de alta velocidad de las zonas absolutas del jugador (5,5 m/s varones, 5,28 m/s mujeres, B-209 y [ADR 0088](0088-umbrales-y-referencias-femeninas.md)); `hsr_rel_m`, la de las relativas (60 % de la Vmax de referencia); los sprints, la zona que nombra `sprints.zoneCode` (`sprinting`: 7 m/s varones, 6,25 m/s mujeres).
- **Valores por defecto** (`DEFAULT_POD_METRIC_PARAMS`, sembrados en todo club, sin verificar, con su fuente en `DEFAULT_POD_METRIC_PARAMS_SOURCE`):

  | Parámetro | Por defecto |
  |---|---|
  | Fix aceptado | 3D o mejor (`fix_3d`, `dgnss`, `rtk_float`, `rtk_fixed`) |
  | Precisión horizontal / de velocidad máximas | 5 m / 1 m/s |
  | Velocidad máxima plausible | 12,5 m/s |
  | Cambio de velocidad máximo entre épocas (pico de multicamino) | 10 m/s² |
  | Hueco que corta la serie | 1 s |
| Cadena mínima (más corta es un pico) | 0,5 s |
  | Filtro de velocidad (media móvil centrada) | 0,3 s |
  | Filtro de aceleración (media móvil centrada) | 0,3 s |
  | Ventana de `vmax_ms` | 1 s |
  | Aceleraciones / desaceleraciones | ±2 m/s², permanencia 0,5 s |
  | Sprints | zona `sprinting`, permanencia 1 s |
  | `accel_load_au` | 100 Hz, escala 0,01, hueco 0,05 s |
  | Impactos (alto rango) | solo rugby, 8 g, separación 1 s |
  | Vmax de referencia | `pod_rolling_max` (180 días, 3 sesiones, como mucho 15 % sobre el `sprint_40`), después `sprint_40` (365 días) |

### Cómo se calcula (`pod-metrics/1`, funciones puras del dominio)

- **Por ventana del jugador** dentro de la sesión (el recorte ya cruzó sesión × asignación × consentimiento): nada se integra a través del borde de una ventana ni de un hueco.
- **Plausibilidad**: se descarta la época sin fix aceptado, con precisión mala o desconocida o fuera del rango humano. El resto se parte en **cadenas**: épocas consecutivas (a menos de `maxGapS`) cuyo cambio de velocidad nunca supera `maxAccelerationMs2`, comparando cada época con la inmediatamente anterior y nunca con una conservada más vieja, así el cambio permitido no crece con el tiempo que se pasó rechazando. **Una cadena de menos de `minChainS` (0,5 s) es un pico** (el multicamino dura una o pocas épocas, y esas épocas pueden coincidir entre sí) y se descarta, al principio, después de un hueco o en el medio. Dos cadenas buenas a los lados de una descartada se unen en un tramo si están a menos de `maxGapS` y el cambio entre ellas cabe en `maxAccelerationMs2` sobre como mucho `minChainS`; si no, cada una arranca su tramo y nada se integra entre ellas. Así un pico de una, dos o tres épocas nunca llega a `vmax_ms` ni a la referencia. Las descartadas se cuentan por motivo en el run.
- `dist_m`: trapecios de la velocidad filtrada; `dist_m_min` sobre la duración de las ventanas. `hsr_abs_m` / `hsr_rel_m`: distancia desde el cruce del umbral (interpolado). `vmax_ms`: la mejor media de 1 s; `vmax_pct` contra la referencia.
- `acc_n` / `dec_n`: aceleración por diferencias centrales de la velocidad filtrada y una media móvil; esfuerzo = tramo sobre el umbral (o bajo su negativo) que dura al menos la permanencia, con los cruces interpolados.
- **Sprints, códigos nuevos a confirmar con el club**: `sprints_n` (esfuerzos sobre la zona de sprint con su permanencia) y `sprint_dist_m` (distancia dentro de ellos), en el diccionario y sembrados en todo club con alias tentativos de OpenField. `sprint_dist_m` es la distancia **dentro de los esfuerzos** (con su permanencia), que puede diferir de la "Sprint Distance" de OpenField si esta es toda la distancia en la banda: a confirmar con la exportación.
- **`accel_load_au`** (nunca "PlayerLoad"): la forma publicada de la carga del acelerómetro de Catapult, `Σ √(Δx² + Δy² + Δz²) × 0,01`, con las aceleraciones del canal `accel_gyro` en g en el marco del sensor (la norma del cambio no depende de cómo va el pod en el chaleco), remuestreadas a 100 Hz por interpolación lineal; un hueco de más de 0,05 s corta la suma. La escala y la tasa son parámetros versionados. El valor depende de la tasa y del filtrado del acelerómetro: para compararlo con Catapult hay que igualar su tasa y su filtro (un pasabajos antes de remuestrear si la IMU muestrea más rápido que 100 Hz, a definir en el banco con los datos de primera).
- **Contactos**: solo en rugby, del canal de alto rango (picos de la norma ≥ 8 g separados 1 s). **No se escriben como `contacts_n`**: no son las participaciones en contacto de Catapult. Quedan en las estadísticas del run hasta validarlos contra Catapult. En hockey no se calculan ni se guardan ([ADR 0091](0091-datos-de-cancha-de-hockey.md)).
- Una métrica que no se puede calcular (sin velocidad, sin IMU, sin referencia, sin zona de sprint) queda afuera con su motivo, nunca como 0.

### Vmax de referencia

- **Regla por defecto: el máximo móvil del pod.** El pico de 1 s de la velocidad filtrada (`vmax_ms`) de las sesiones del jugador en los últimos 180 días hasta la sesión, incluida, con al menos 3 sesiones; si no alcanzan, el último `sprint_40` (`sprint_vmax_ms`) de hasta un año. **Por qué**: es la misma magnitud que mide el pod (un pico, no una media de tramo), se actualiza sola con la maduración y es lo que hace OpenField con el máximo de la temporada; el `sprint_40` es la media del tramo 20–40 m y subestima el pico, por eso solo cubre al jugador que todavía no tiene historia y **nunca se mezcla en un mismo máximo** con un pico del pod.
- **Banda de sanidad**: un máximo móvil del pod más de 15 % por encima del último `sprint_40` del jugador (dentro de su antigüedad) no es una referencia (un pico que pasó el filtro, un pod en otro jugador) y se pasa a la regla siguiente. Exigir intensidad (al menos una sesión con un sprint) antes de que gane la regla del pod queda para cuando haya datos de primera.
- **"A la fecha"**: solo cuentan las sesiones que empezaron antes (y la propia) y los tests hasta el día de la sesión, así una sesión posterior más rápida nunca reescribe las relativas de una anterior fuera de su ventana. La regla, el orden y las ventanas son datos del club; el run guarda la Vmax usada y la regla que la dio.

### Dónde y cómo se guardan

- **Valores en `external_metric`** (fuente `pod`, como las importaciones de Catapult, [ADR 0061](0061-vista-de-sesion-en-cancha.md)), con `method_variant` (`pod_log`), `algorithm_version` y `pod_metric_run_id` obligatorios para la fuente `pod` (`CHECK`), `external_ref` = `pod_log:<sesión>` (idempotente por la clave única existente). Solo el worker los escribe y borra (políticas restrictivas: la aplicación nunca inserta ni edita un valor `pod`, el worker nunca borra uno de otra fuente).
- **`pod_metric_run`**: uno por jugador, sesión y variante, con la configuración aplicada, `definition_hash` (SHA-256 del JSON canónico de algoritmo, variante, deporte, parámetros, zonas y Vmax de referencia), `inputs_hash` (archivos recortados y ventanas), las subidas, las versiones del firmware y del GNSS, la Vmax del propio pico y la de referencia con su regla, y las estadísticas. Se lee como los valores; lo escribe solo el worker. Sin historial propio: los valores tienen el suyo.
- **Job `pod-metrics-club`** (después de cada recorte o corrección y con un barrido cada 15 minutos): para cada jugador y sesión con traza, si los hashes coinciden no decodifica nada; si no, decodifica el recorte con las claves del club, recorta a las ventanas, calcula y escribe en una transacción con motivo de cambio. Las sesiones se procesan en orden, así la referencia de una sesión ve los picos anteriores de la misma corrida. **Recalcular cuando cambia una definición es automático**: cambia el hash. Una corrección después del recorte marca los runs del jugador en esa subida (`stale`); si no queda nada, se borran con sus valores. Si los datos se fueron por otra causa (revocar `location`, retención de las trazas), los valores quedan: las métricas agregadas siguen el consentimiento de datos (ADR 0106).
- **Nunca con datos parciales ni movidos**: una sesión con un recortado que no está listo (vencido, borrado, ausente del bucket) se saltea sin recalcular ni borrar. La escritura vuelve a leer los recortes con un lock compartido y el run con un lock de fila, y desiste si cambiaron desde que se leyeron los archivos (una corrección de la ingesta en paralelo espera el commit o hace desistir): `stale` solo se limpia junto con entradas que siguen siendo las calculadas.
- **Definiciones que no se pueden usar se informan, nunca se reemplazan**: una fila que no parsea o es de otro algoritmo queda afuera con un aviso y las sesiones que cubriría esperan (no se calculan con los valores por defecto); dos filas igual de específicas el mismo día saltean ese día. El solapamiento se sigue chequeando en el dominio bajo lock al escribir, sin restricción de exclusión (ADR 0041).
- **El hash** cubre lo que da forma a un valor guardado: no incluye las reglas del vivo (cambiarlas no recalcula nada) e incluye las métricas que el diccionario del club tiene (archivar una borra su valor). Un lote decodifica como mucho 10 sesiones, fallas incluidas. Una sesión que falla no frena las demás: espera con un backoff exponencial (15 minutos que se duplican hasta un día, guardado por el proceso del worker) antes de que el barrido la vuelva a intentar, se informa una vez por ventana y nunca se vuelve a decodificar en un bucle. El job se vuelve a encolar solo cuando el lote se llenó después de avanzar; un club cuyas sesiones pendientes solo fallan espera al barrido.

### Señales en vivo (B-906)

- **Funciones del dominio compartidas por la tablet y el worker** sobre la serie de paquetes en vivo (`LiveSummary` del protocolo, pasado a SI con `liveCounterSample`): metros por minuto de los últimos 5 minutos frente al pico de la sesión, ritmo de HSR / sprints / aceleraciones como % del promedio propio por partido (por minuto jugado, así el minuto 30 se compara con 30 minutos de un partido habitual; "historia insuficiente" con menos de 3 partidos), velocidad máxima reciente frente a la Vmax de referencia y bloques de esfuerzos repetidos (RHIE: al menos 3 esfuerzos con recuperaciones de hasta 21 s; en rugby con un contacto entre dos carreras, sprint → contacto → sprint; en hockey solo carreras y aceleraciones, los impactos nunca entran). Los contadores del paquete son acumulados desde que el pod abrió su sesión, que puede ser antes del primer paquete de la tablet (llegó tarde o se reconectó): se compara solo su aumento en la serie (último − primero) con el tiempo jugado en ella.
- **Reglas declarativas del club** en `params.live.rules` (código, tipo, severidad `info`/`warning`, deportes, parámetros), sembradas con las definiciones: cada señal sale con su ícono y sus claves de texto (`podLive.signal.<tipo>` y `.suggestion`, "sugiere revisar", nunca un diagnóstico) y una lectura con estado cuando falta el dato. El HSR en vivo sale de las bandas del paquete desde la zona de alta velocidad (`live.bandZoneCodes`); un sprint en vivo con la resolución de 1 s es conservador (`n` segundos seguidos sobre el umbral duran `n − 1` s).
- **Es aproximado y lo dice** (`podLive.approximate`); el informe usa `pod_log`. No hay tabla de posiciones. La pantalla en vivo de la tablet es lo siguiente.

## Alternativas descartadas

- **Parámetros en código con un número de versión.** Un club no podría copiar su OpenField sin un deploy, y dos clubes no podrían tener definiciones distintas.
- **Una columna por parámetro.** El conjunto todavía va a cambiar con la exportación de primera; un JSON validado por el dominio y versionado por vigencia alcanza, como las zonas.
- **Vmax de referencia como el máximo entre el pod y el `sprint_40`.** Mezcla un pico con una media de tramo (ADR 0106) y salta de método sin avisar.
- **Contar los impactos de alto rango como `contacts_n`.** Pondría un número distinto bajo el código que primera lee como las participaciones de Catapult.
- **Calcular las métricas dentro del recorte.** El recálculo por una definición nueva igual necesita decodificar los recortados; un job aparte hace las dos cosas con la misma idempotencia por hash.

## Consecuencias

- **A confirmar con la exportación de OpenField de primera (B-002)**: filtro de velocidad y de aceleración, permanencia de las bandas y de los esfuerzos, umbral de aceleración, la banda de sprint y su permanencia (y los códigos `sprints_n` / `sprint_dist_m` con sus alias), qué Vmax usa primera para las bandas relativas, la escala de `accel_load_au` de su firmware, y después el sesgo y los límites de acuerdo contra Catapult por métrica.
- La pantalla y los endpoints para editar `pod_metric_config`, la lectura de la variante, el algoritmo y el run en las sesiones de cancha (con el aviso de series mezcladas), la variante `pod_live` en el worker, la altura por barómetro, el inicio y fin por el Hall y la pantalla en vivo de la tablet quedan para lo que sigue de B-906, B-917 y B-919.
- Hay que recalcular todo al cambiar `pod-metrics/1`: el job lo hace solo (cambia el hash), por lotes.
