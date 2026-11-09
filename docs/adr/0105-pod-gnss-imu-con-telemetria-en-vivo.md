# 0105. Pod GNSS + IMU: doble banda L1/L5, telemetría en vivo por LoRa a un gateway en la cancha, cálculo en la tablet con el dominio y posprocesado después de la sesión

- Estado: Propuesto
- Fecha: 2026-11-07
- Issue: #116 (B-901)

## Contexto

La Fase 3 es un pod por jugador con firmware propio sobre hardware genérico. Lo que guarda en storage y en Postgres ya está decidido en [ADR 0005](0005-pod-crudo-en-storage.md). El backlog proponía prototipar con WisBlock: el RAK4631 (nRF52840 + SX1262) y el RAK12500 (u-blox ZOE-M8Q, una sola banda L1), con descarga por BLE.

Con el club se definieron estas condiciones:

- **El GPS tiene que ser bueno en Argentina.** Satélites visibles hay de sobra: GPS, Galileo, GLONASS y BeiDou se ven bien (GLONASS solo en L1). Los problemas son otros tres:
  - **No hay SBAS en Sudamérica**: WAAS y EGNOS no cubren la región.
  - **El retardo ionosférico** es alto: Buenos Aires está bajo la influencia de la cresta sur de la anomalía de ionización ecuatorial, y el ciclo solar viene de su pico. Un receptor de una sola banda no lo cancela.
  - **El multicamino** de tribunas, árboles y el propio cuerpo del jugador.
- **Datos en vivo.** El staff quiere ver durante el partido si un jugador se esforzó de más y hay que cambiarlo. Las bandas de frecuencia cardíaca quedan para el futuro: el esfuerzo se lee de las corridas, los sprints y los contactos.
- **Cantidad y costo:** 100 pods, fabricados en China, a unos US$ 80 por pod o menos (precio en origen).

El relevamiento de partes, precios, regulación y RAMSAC, con sus fuentes, está en [`docs/hardware/pod-f3.md`](../hardware/pod-f3.md). Los precios son de páginas cacheadas o agregadores. Lo que no se pudo confirmar dice "no verificado".

## Decisión

### Hardware del pod

- **GNSS de doble banda L1 + L5** a 10 Hz, con las 4 constelaciones a la vez.
  - **Por qué doble banda:** medir en dos frecuencias cancela el retardo ionosférico y rechaza mejor el multicamino. En L5 se ven desde acá Galileo E5a, GPS L5 y BeiDou B2a. GLONASS aporta solo en L1.
  - **Qué usa Catapult:** según las fotos internas de su presentación ante la FCC (2ADAL-S7401), que revisó el equipo, el Vector S7 lleva un **u-blox EVA-M8Q**, de una sola banda (L1), con 10 Hz en varias constelaciones o 18 Hz solo con GPS. Un receptor de doble banda puede igualarlo o superarlo en la medición cruda; lo que hay que alcanzar es su procesamiento.
  - **Por qué 10 Hz:** es la frecuencia de Catapult Vector. Subir a 18 o 25 Hz aporta poco frente a la precisión.
  - **Quectel LC29H(AA), opción principal del pod**, a unos US$ 7,40 contra unos US$ 19–21 del F10N-20 ([página de la serie](https://www.quectel.com/product/gnss-lc29h)).
    - Posiciona a 10 Hz y se supone que da la **velocidad por Doppler a 10 Hz** (el banco lo confirma, con el filtrado y la latencia del módulo), que es lo que importa para la carga: Vmax, HSR, sprints y aceleraciones. La distancia también se integra mejor desde esa velocidad que desde diferencias de posición.
    - **Crudo de la AA**, según la *LC29H&LC79H Series GNSS Protocol Specification* V1.5 ([`lc29h-protocolo.md`](../hardware/lc29h-protocolo.md)):
      - **La AA no tiene modo base**: `$PQTMCFGRCVRMODE` es solo de BA, CA, DA, EA y EL (§2.3.14).
      - **Saca RTCM3 MSM4 o MSM7** con `$PAIR432` y **efemérides** con `$PAIR436` (§2.4.39 y §2.4.43; tabla 8, sin restricción de variante en la salida), con la salida RTCM3 del UART prendida por `$PQTMCFGPROT` (§2.3.38).
      - La tasa (la página de la serie dice crudo a 1 Hz), si se guarda y si afecta el PVT a 10 Hz **se verifican en el banco**.
      - Sin crudo, el AA sigue sirviendo por el Doppler.
  - **Placa lista para la EA.**
    - Todas las variantes del LC29H tienen el mismo encapsulado, de 12,2 × 16,0 × 2,5 mm ([especificación V1.8](https://quectel.com.cn/wp-content/uploads/2021/08/Quectel_LC29H系列_GNSS_模块产品规格书_V1.8.pdf), [V1.2](https://quectel.com/content/uploads/sites/3/2022/06/Quectel_LC29H_GNSS_Specification_V1.2.pdf)). Que los pines sean iguales uno a uno está **no verificado**: antes de dibujar la placa se compara en el *LC29H Hardware Design* o se consulta a Quectel.
    - La placa conecta el **RX de la UART del GNSS** a la segunda UART del nRF52840, más el PPS y el reset. Así, una tanda lleva AA o EA sin rediseñar. Lo que cambia con la EA es el firmware: pasar el RTCM de LoRa al módulo y leer el estado del RTK.
  - **LC29H(EA) con RTK en vivo, como opción para uso táctico** (distancias entre jugadores, formaciones):
    - Hace RTK a 1–10 Hz con correcciones de una base en la cancha; la EA está a la venta ([Future Electronics](https://www.futureelectronics.com/p/semiconductors--analog--sensors--gyro-angular-rate/lc29heata-quectel-3214812), [hoja de datos](https://xonstorage.blob.core.windows.net/pdf/quectelwireless_lc29heamd_apr22_nocat_xonlink.pdf)).
    - El gateway difunde el RTCM **una sola vez para todos los pods** por LoRa, y los pods escuchan, lo que suma unos pocos mA. **Que entre está no verificado:**
      - MSM7 con 4 constelaciones y doble banda son de varios cientos de bytes a 1 kB/s, contra unos 680 B/s de SF7 / 125 kHz, con tramas de hasta 255 B y límites de permanencia por canal.
      - El gateway SX1302 es half-duplex: mientras difunde, no recibe en ninguno de los 8 canales, y le quita turnos a los 160 pods / 2 s del vivo.
      - Mitigaciones a medir en el banco: MSM4, menos constelaciones, correcciones cada 2–5 s, un canal de bajada de 500 kHz o una radio aparte para transmitir.
    - Con la EA, el PPK pasa a ser un respaldo opcional, para los tramos en que se perdieron correcciones.
  - **u-blox NEO-F10N-00B-20, solo como comparación en el banco.** Es la única variante del F10N con fase portadora (`UBX-RXM-RAWX`). La -00B-00 no tiene salida cruda.
  - **Quectel LG290P como base de la cancha y como referencia** (una por cancha, no por jugador):
    - Recibe 4 bandas (L1/L2/L5/E6) y saca fase portadora a 10–20 Hz según el [foro de Quectel](https://forums.quectel.com/t/lg290p-10-20-hz-raw-carrier-phase-observations-and-multi-receiver-synchronization/61346), **no verificado** contra la hoja de datos ([especificación](https://www.quectel.com.cn/wp-content/uploads/2024/12/Quectel_LG290P系列_GNSS_模块产品规格书_V1.4.pdf)).
    - Consume unos 98 mA y cuesta US$ 67–107 en DigiKey ([LG290P](https://www.digikey.bg/en/product-highlight/q/quectel/lg290p-03-gnss-module)): no entra en el pod.
    - Es la **base principal del PPK y del RTK**, con línea de base casi nula. RAMSAC queda como respaldo.
    - En el banco y en la cancha es la **referencia** para medir qué tan lejos están el AA, la EA y el F10N.
  - **Descartados:**
    - LC79H: generación anterior, con crudo a 1 Hz (AL) o a 1/2/5 Hz (EL), y nada que haga mejor que el LC29H.
    - LG69T: automotriz, más grande y sin precio. Trae funciones que no sirven en un jugador (navegación a estima, rumbo).
    - LC29H BA y CA: navegación a estima pensada para vehículos.
    - LC29H BS como base: el LG290P tiene más bandas y calidad de referencia, y una sola base sirve para PPK, RTK y validación.
    - LC29H DA: RTK solo a 1 Hz.
    - Allystar TAU1201/1202, sin salida cruda confirmada. Unicore UM620N, sin precio ni salida cruda confirmados.
  - **El banco** ([`banco-gnss.md`](../hardware/banco-gnss.md)) se reduce a lo mínimo: un LC29H(AA) en placa para saber si tiene crudo y velocidad Doppler, y los dos LG290P (base y referencia). El RTK de la EA, el consumo y la convivencia con LoRa se miden en la v0.
- **Prototipo: directo a la placa v0 con módulos** ([`pod-v0.md`](../hardware/pod-v0.md)), sin placa intermedia de desarrollo.
  - Solo módulos (Raytac MDBT50Q-P1MV2 con nRF52840, E22-900M22S con SX1262, LC29H), ningún chip de radio soldado directo: el RF de cada módulo ya viene resuelto. El MDBT50Q expone los 48 GPIO del nRF52840, así que el LoRa va en su propio bus SPI, la IMU y el UWB en otro, la NAND en el SPIM3, y queda margen.
  - **LED RGB de estado** con guía de luz en el borde de la nuca: arranque, GNSS, enlace, grabación, batería, base, DFU y "buscar mi pod", siempre con color y patrón; el club elige apagarlo durante el juego. Buzzer opcional sin montar.
  - **Lugares de rescate** para corregir en la mesa sin otra vuelta: 0 Ω y componentes sin montar en la cadena RF del GNSS (SAW, LNA, red pi, bias-T), la antena activa por U.FL como alternativa al patch, IMU de respaldo, puentes en cada riel y el UART del GNSS a un conector para hablar con QGNSS.
  - Las E/S del LC29H son de 2,8 V: hace falta traductor de niveles con el nRF52840, que corre a unos 3,4 V del riel del sistema (Hardware Design del LC29H, tabla 10). V_BCKP, necesario para que el LC29H arranque, lleva su propio LDO de 3,0 V desde la batería con el EN directo de SYS (se corta en modo envío), y el VCC del GNSS sale de un LDO fijo de 3,2 V con EN y descarga activa, que hace el corte. **WAKEUP va al nRF**: sin él el GNSS no vuelve del backup.
  - Se fabrica en PCBWay (compra las partes que no están en LCSC): 10 placas, 5 armadas.
- **Antena:**
  - **Patch cerámico pasivo apilado L1 + L5 soldado en la placa, con la cadena de SAW y LNA de la placa montada** (decisión del usuario, 08/11/2026). Candidatos: **Taoglas GVLB208.A** (20 × 20 × 8,8 mm) y una opción de 25 × 25 × 8 mm como la **Quectel YFGC000WWAM** (medidas, banda y footprint **no verificados**). Los dos piden un plano de tierra grande (70 × 70 mm el GVLB208): el ajuste sobre la tierra de la placa se mide en el arranque.
  - **No es plano**: un patch de una capa de unos 4 mm pierde alrededor de 6 dB en L5, así que un pod de ≤ 15 mm con L5 no se puede. El espesor objetivo pasa a **unos 19–21 mm** (`pod-mecanica-produccion.md`). **Solo L1** (un patch plano de una banda) **se descartó**: el usuario mantiene L1 + L5.
  - **Cadena por defecto**: patch → ESD → bloqueo de DC → SAW L1 + L5 → LNA BGA525N6 (modo estándar, unos 17 dB) → SAW → atenuador en 0 Ω → red pi → RF_IN. Ganancia total típica de unos 13 dB en L1 y 16 dB en L5, debajo de los < 17 dB que acepta el LC29H; en alta ganancia del LNA, L5 llega a unos 17 dB y va un atenuador de 2–3 dB. El SAW va **antes del LNA** porque el pod transmite LoRa a centímetros del receptor.
  - La **Taoglas AGVLB.25B** (patch activo de 25 × 25 mm en una carcasa de 35 × 35 × 12 mm, 18 g, LNA de unos 29 dB) queda como **referencia de banco y rescate** por el U.FL que ya está en la placa, con su bias-T, el LNA de la placa puenteado y un **atenuador** de 6–10 dB. La DC de su bias-T queda del lado del U.FL, detrás de un capacitor: nunca llega al patch ni al SAW (`pod-v0.md`).
  - **Separación física** entre la antena GNSS (arriba, mirando al cielo) y la antena de LoRa (FPC de 45 × 10 mm en la carcasa, del lado opuesto). El riesgo de convivencia es el ruido de banda ancha del PA del LoRa dentro de las bandas del GNSS: lo cubren la separación y un pasabajos sin montar del lado del LoRa; los SAW del lado del GNSS sacan lo que está fuera de banda.
  - **Costo y peso**: patch + 2 SAW + LNA + adaptación cuestan unos €8–10 menos que la Taoglas y pesan unos 5–8 g menos (estimaciones, `pod-f3.md`).
- **IMU:**
  - **ST LSM6DSV320X:** en un solo chip, 6 ejes con un canal de ±2–16 g y otro canal de alto rango de ±32–320 g, independientes.
  - El canal de alto rango es para los impactos: con ±16 g los tackles saturan. De esos impactos salen `contacts_n` y `scrums_n`, **solo en rugby**. En hockey no hay contactos ([ADR 0017](0017-deporte-y-sexo-en-el-modelo.md), [ADR 0091](0091-datos-de-cancha-de-hockey.md)).
  - **Respaldo si no hay stock** (LCSC tenía 45 unidades): ICM-42688-P más ADXL372.
- **Barómetro: Bosch BMP581** (respaldo: Infineon DPS368) en el bus I2C, para la altura del pod fusionada con la IMU: la levantada en el line, los saltos y el apoyo a `time_to_feet_s`. Cuesta unos US$ 1,23 y usa el pin que quedaba libre. Necesita una **ventilación con membrana de ePTFE** en la carcasa. Una métrica de altura nueva se define con el club en el diccionario de métricas antes de usarla (`pod-v0.md`).
- **MCU y radio:** nRF52840 (BLE) + SX1262 (LoRa).
  - **nRF52840 en el módulo Raytac MDBT50Q-P1MV2** (antena PCB, los 48 GPIO, cristal de 32 MHz y bobina del DC/DC adentro), unos US$ 6,65–8,50: uno a tres dólares más que el Ebyte E73, que se descartó porque saca solo 31 GPIO y la v0 los usaba todos. FCC ID SH6MDBT50Q; que cubra la -P1MV2, y CE e IC, **no verificados**. La -U1MV2 (U.FL) es el rescate si el cuerpo tapa el BLE.
  - **LoRa con el Ebyte E22-900M22S**, unos US$ 4,63. Sus certificaciones FCC/CE no están verificadas.
  - **Sin interruptor mecánico**: el pod pasa solo entre base, activo, espera, System OFF (despierta por movimiento de la IMU, al conectar la base o al meterlo en el chaleco) y modo envío (sale solo al conectar la base). Un **sensor Hall omnipolar (DRV5032FB) frente a un imán encapsulado en el bolsillo del chaleco** dice si el pod está puesto: solo con el chaleco puesto y movimiento prende el GNSS y graba, y ponerse o sacarse el chaleco marca el inicio y el fin de la sesión. El pod no tiene magnetómetro, así que el imán no afecta los cálculos. Los tiempos entre estados (incluido el de gracia fuera del chaleco) son configuración del club. El GNSS se corta con el EN de su LDO; el E22, con un load switch (para recuperar la radio, no por consumo), y la NAND tiene uno sin montar. Antes de entrar en modo envío (también por batería crítica), el firmware espera que la NAND termine de escribir. En System OFF el pod consume unos 50–70 µA (estimación; lo domina el backup del GNSS), lo que da meses de reposo; para almacenamiento largo está el modo envío (`pod-v0.md`, "Estados de energía y consumo").
  - Por qué nRF52840 y no un STM32: BLE en el mismo chip, USB, AES en hardware, PPI para capturar el PPS sin la CPU, bajo consumo y drivers en Zephyr para el SX126x, la IMU y el barómetro. El procesamiento pesado va en la tablet y el worker, no en el pod. El RAK4630 no entra en la v0 (otro encapsulado).
- **Memoria:** NAND SPI de **2 Gbit**, la **Winbond W25N02KV** (decisión del usuario del 09/11/2026: alcanza si entran unas 8 sesiones; antes era de 4 Gbit). El cálculo está en `pod-f3.md`:
  - Una sesión de 3 h son unos 27 MB sin las mediciones crudas del GNSS, y unos 49 MB con crudo a 1 Hz (con el barómetro). Con los registros del formato v1 del log ([ADR 0106](0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md)), unos 2,9 kB/s y 4,9 kB/s.
  - En 2 Gbit (256 MB, 2048 bloques) entran **8 sesiones de 3 h** sin crudo y 4 con crudo, después del índice y de los bloques malos que admite la hoja.
  - La **W25N04KV de 4 Gbit** entra en el mismo lugar con el mismo driver (16 sesiones, 9 con crudo) para una variante de más capacidad; cuesta unos US$ 6,78 más por placa a 100.
- **Batería: LiPo de 500–600 mAh** (decisión del usuario), protegida, de un proveedor con informe UN38.3 e IEC 62133, con NTC y conector con llave. Objetivo de 4–5 h de sesión. Cargador BQ25180 a 300–350 mA (es lineal, dentro de una carcasa cerrada) y medidor de carga MAX17048.
  - El consumo estimado era de unos 50–60 mA en actividad con la Taoglas: la rama del GNSS con el LNA de la antena son unos 42–48 mA, más el nRF52840, la IMU, la NAND y unos pocos mA de promedio de LoRa. Con el patch pasivo, el LNA de la placa toma 2,3 mA en modo estándar contra unos 18 mA del de la Taoglas: unos 15 mA menos (estimación, se mide en el banco).
  - Con 500–600 mAh eso da unas 8–12 h: de 1,6 a 3 veces la sesión, con margen para frío y envejecimiento (se mide en el banco).
- **Conexión externa: solo los contactos de la base** (decisión del usuario): pads planos dorados en el pod (VBUS, D+, D−, GND y DETECT; los resortes van en la base, que da VBUS solo con un pod asentado), con llave mecánica e imanes polarizados, switch de entrada con OVP y ESD de ±8 kV por contacto. Sin USB-C, la carcasa queda estanca y no hay dos fuentes de VBUS en paralelo.
- **UWB opcional para deportes bajo techo** (Qorvo DW3110 o su sucesor QM33, canales 5 y 9):
  - La placa lleva **el lugar para el chip, su antena y su cristal**, sin montar en la tanda de 100. Montarlo después no obliga a rediseñar la placa **siempre que el lugar se haya probado**: algunos prototipos de B-909 lo llevan montado para validar el diseño de RF a 6,5–8 GHz.
  - **Encapsulado:** el DW3110 es WLCSP, que puede exigir paso fino o vías en el pad en todas las placas aunque no se monte. Hay que comparar con el DW3210 o el QM33 en un encapsulado más simple antes de cerrar la placa (**no verificado**).
  - **Para qué:** bajo techo (gimnasio, cancha cubierta, deportes indoor) no hay GNSS, y UWB da posición de 10–30 cm. Afuera, el GNSS de doble banda alcanza.
  - **Costo estimado por pod si se monta:** unos US$ 9–12. El chip cuesta US$ 6,64 @100 en LCSC o US$ 8,77 @100 en RFMW, sin stock en ninguno de los dos al relevarlo; se suman antena chip, cristal, pasivos y el armado, cuyo costo **no está verificado**.
  - **Modo TDoA:** el pod solo emite pulsos cortos y las anclas escuchan. El límite de potencia de UWB aplica a quien transmite, así que las anclas pueden usar antenas directivas de más ganancia **en recepción** y recuperar alcance. Si las anclas se sincronizan por el aire, esas tramas sí cuentan contra el límite. Las anclas van altas y alcanza con que cada pod vea al menos 4.
  - **DW3000 y no DW1000, salvo que la prueba diga otra cosa:** consume cerca de un tercio, tiene seguridad 802.15.4z (STS), es más chico y es el producto vigente. El DW1000 tiene más alcance (modo de 110 kbps y canales bajos), pero esos canales tienen restricciones en varios países, y su ciclo de vida es un riesgo.
    - Según las fotos internas de su presentación ante la FCC (2ADAL-S7401), que revisó el equipo, el Catapult Vector S7 usa un DW1000 con antena Taoglas. Es un diseño de 2019–2020, anterior al DW3000.
    - B-911 compara los dos en el mismo lugar bajo techo, con el pod en la espalda de un jugador: alcance y proporción de paquetes recibidos.
  - **Sin GNSS no hay hora para los turnos de LoRa.** Bajo techo, los pods toman la hora de una **baliza LoRa del gateway**: así el pod sigue solo emitiendo en UWB, sin el consumo de escuchar a las anclas.
  - **Anclas e instalación** (unas 4–6 en una cancha cubierta de 40 × 20 m; **no verificado**) se compran solo para el lugar que las necesite. Quedan fuera del objetivo de US$ 80.
- **Ubicación:** en un chaleco, **entre los omóplatos**, con la antena hacia arriba. Es la misma ubicación de Catapult, así lo medido se compara con primera.
- **Objetivo de costo: US$ 80 por pod en origen, para 100 unidades.**
  - El relevamiento da unos **US$ 75–85** en el caso optimista, que es el de la decisión: LC29H(AA), MDBT50Q + E22, LSM6DSV320X, antena Taoglas y NAND de 2 Gbit, con el PCB y la carcasa en el extremo bajo o alto de su rango.
  - **Con la EA**, se suma la diferencia de precio con la AA. La EA no tiene precio relevado; como referencia, la DA cuesta €20,53 @100 contra US$ 7,40 de la AA. La diferencia de unos US$ 12–15 por pod está **no verificada**.
  - Da unos **US$ 113** en el caso pesimista (los extremos altos de la tabla): F10N-20, RAK4630 y antena Linx, cuyo precio está **no verificado**. Queda como referencia, porque el F10N ya no es el GNSS del pod.
  - **Lo que más pesa es la antena GNSS de marca**, de €19,87–21,03 la Taoglas en DigiKey. Hasta con la opción barata, los US$ 80 quedan justos. Con el patch pasivo como antena principal, la antena y su cadena cuestan unos €8–10 menos (estimación): el caso de la decisión baja en esa cifra. Con el F10N, los US$ 80 solo se alcanzan con una antena L1/L5 activa china de unos US$ 4–8, cuyo precio no está verificado.

### Telemetría en vivo

- **Radio y banda:** LoRa en **915–928 MHz únicamente**. La Res. ENACOM 581/2018 declaró esa banda de uso compartido sin autorización para usarla (citada por la Res. 1132/2023). El tramo 902–915 MHz tiene otro régimen y no se usa. La potencia máxima en Argentina **no está verificada**: el pod se configura con la potencia que surja de la norma, no con la del plan AU915.
- **Protocolo propio, no LoRaWAN, con turnos (TDMA)** sincronizados por la hora del GNSS: todos los pods la tienen al microsegundo con el PPS (bajo techo, con la baliza del gateway; ver UWB). Cada pod transmite en su turno, así los paquetes no chocan.
  - **Riesgo regulatorio:** canales fijos podrían no cumplir las reglas de salto de frecuencia o de tiempo de permanencia por canal de la norma Q2-63.03, parecidas a las de la FCC 15.247. La banda útil es de solo 13 MHz. Si la norma lo pide, cada trama cambia de canal siguiendo una secuencia conocida por todos. Es una pregunta explícita de B-903.
- **Qué se transmite:** cada pod arma un resumen por segundo y manda **dos resúmenes juntos cada 2 s**, en unos 40 bytes. El resumen incluye:
  - metros recorridos;
  - velocidad máxima;
  - aceleraciones y desaceleraciones de más de 2 m/s²;
  - impactos de la IMU;
  - carga acelerométrica (`accel_load_au`);
  - posición.
- **Capacidad:**
  - Un paquete de 40 B en SF7 / 125 kHz ocupa unos 82 ms en el aire.
  - Con turnos de unos 100 ms (paquete más tiempo de guarda), una trama de 2 s tiene 20 turnos por canal: **unos 160 pods en 8 canales**. Con el paquete completo (encabezado, estado y MIC) y la bajada, la capacidad baja a **unos 120 pods sin RTK**: ver [ADR 0106](0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md). Alcanza para entrenar una categoría entera a la vez.
  - 30 pods ocupan cerca del 15 % de cada canal. Cada 1 s sería el 31 %, con capacidad para unos 80 pods: por eso la cadencia es de 2 s.
- **Gateway de 8 canales SX1302** (RAK7268V2, unos US$ 139–170), en un **mástil de 3–5 m** al costado de la cancha, para quedar por encima de los jugadores.
  - Se conecta a la **tablet del staff** por Ethernet o por Wi-Fi local, con un packet forwarder, y **funciona sin internet**.
  - El forwarder tiene que dejar pasar tramas que no son LoRaWAN, con una sync word privada. Se verifica en B-905.
  - Solo si hay conexión al exterior (Wi-Fi del club o 4G), el vivo sube al servidor para que también lo vea quien no está en la cancha.
- **Privacidad y seguridad (son datos de menores):**
  - **Cifrado y autenticación:** cada paquete va cifrado y autenticado con AES-CCM. Las claves por pod, la rotación y el contador persistente están en el [ADR 0106](0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md).
  - **Sin datos personales en el aire:** el paquete lleva solo el id del pod. Qué pod usa cada jugador lo sabe solo la app, que lo asigna en cada sesión.
  - **Quién ve la pantalla en vivo:** solo el staff, según la matriz de permisos ([ADR 0025](0025-matriz-de-permisos.md)): el entrenador y el preparador físico asignados a la categoría, y la administración. Ningún jugador ve nombres de otros.
  - **Consentimiento:** reemplazado por el consentimiento propio `location` del [ADR 0106](0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md). Texto anterior: el seguimiento por GNSS necesita el consentimiento de datos del jugador. Si el texto vigente no menciona la ubicación, se publica una versión nueva del texto ([ADR 0043](0043-consentimientos.md)). Sin consentimiento, el pod no se asigna.
  - **Retención:** las trazas de posición tienen una retención propia (ADR 0044), que se define en B-908. Las cubren la exportación y el borrado del titular.
- **El cálculo del vivo se hace en la tablet**, con **las mismas funciones de `packages/domain`** que usa el worker después. El pod solo resume y no decide nada. Así, cambiar una regla no exige actualizar el firmware de 100 pods, y el vivo y el informe calculan igual.
- **Las señales de esfuerzo son reglas declarativas por club**, con valores por defecto en seeds, como el motor de alertas ([ADR 0022](0022-motor-de-reglas-de-alerta.md)):
  - **Volumen del partido, como % del promedio propio por partido:**
    - HSR absoluto (5,5 m/s en varones y 5,28 m/s en mujeres, o el umbral de primera);
    - HSR relativo (más del 60 % de la Vmax del jugador);
    - sprints, aceleraciones y desaceleraciones de más de 2 m/s²;
    - `accel_load_au`.

    Nunca se usa el nombre "PlayerLoad".
  - **Caída de intensidad:** los metros/min de los últimos 5 min frente al pico del partido.
  - **Velocidad máxima reciente frente a la Vmax propia**, que sale del `sprint_40` o del máximo de la temporada.
  - **Esfuerzos repetidos sin recuperar:**
    - en rugby, RHIE: sprint, contacto de la IMU y sprint con poca pausa;
    - en hockey no hay contactos ([ADR 0091](0091-datos-de-cancha-de-hockey.md)), así que se cuentan esfuerzos de alta intensidad repetidos solo con corridas y aceleraciones.
  - **Jugador sin promedio propio todavía:** el estado es "historia insuficiente", como el ACWR con menos de 28 días, y se usan su Vmax y los umbrales absolutos.
- **Es una heurística.** La pantalla dice "sugiere revisar", con ícono y texto. Correr menos puede ser táctico y no fatiga: **el cambio lo decide el entrenador**. No es un dispositivo médico (principio 7).

### Después de la sesión

- **El pod graba todo a tasa completa:** GNSS a 10 Hz, la IMU a 100 Hz o más y las ráfagas de impacto.
- **Se descarga por una base con resortes pogo contra los pads del pod** (el pod no tiene USB-C), que también carga el pod. Por BLE, una sesión de 49 MB con crudo son unos 8 min por pod: con 100 pods no es viable.
- El crudo va a storage como dice [ADR 0005](0005-pod-crudo-en-storage.md).
- **Posprocesado PPK en el worker**, con dos fuentes de corrección:
  - la **base de la cancha (LG290P)**, grabando crudo con la línea de base casi nula;
  - **o, como respaldo, el RINEX de 1 s de RAMSAC** (IGN), de las estaciones IGM0/IGM1 de CABA, a unos 15 km de Munro según una estimación.
- **Cómo se corrige el AA con crudo a 1 Hz:**
  - El error de la posición sola es sobre todo **lento** (ionosfera, órbitas y relojes cambian en minutos). Cada segundo, el PPK da una posición corregida, y la diferencia con la posición propia del pod es un **desvío**. Ese desvío se interpola entre segundos, en tramos que se cortan cuando cambia el conjunto de satélites usados, y se resta a la traza de 10 Hz. **Solo es posible si el AA saca crudo** (no verificado); si no, el AA queda con la posición sola de doble banda.
  - No corrige el multicamino rápido, que filtran la IMU y el procesamiento.
  - La velocidad y la distancia salen del Doppler a 10 Hz, sin depender del crudo.
  - En un jugador en movimiento se espera precisión de **decímetros, no centímetros**: el cuerpo tapa satélites y hace perder la fase portadora, y con crudo a 1 Hz se recupera más lento. Para el mapa de calor y la trayectoria alcanza.
- **Con la EA**, el RTK en vivo ya da centímetros y el PPK es un respaldo opcional.

  Que RAMSAC rastree L5/E5a y si el servicio tiene costo están **no verificados**.
- **Métodos:** el método es `pod` (CLAUDE.md, principio 4), con dos variantes que se guardan las dos:
  - `pod_live`: lo calculado en vivo con los resúmenes;
  - `pod_ppk`: lo procesado después con el crudo y el PPK;
  - `pod_rtk`: la posición RTK en vivo de la EA, si se monta;
  - `pod_uwb`: posición por UWB bajo techo, si se monta (B-911).

  Los informes, el panel y las alertas usan `pod_rtk` cuando su proporción de soluciones "fixed" en la sesión supera el umbral del club; si no, `pod_ppk`; y si no hay ninguno, `pod_live`. Nunca se comparan las variantes entre sí, ni contra Catapult, sin avisar.
- **Bandas de FC:** quedan diferidas, pero el firmware conserva el rol de central BLE para leer una banda estándar y retransmitirla por LoRa, sin cambiar el hardware.

## Alternativas descartadas

- **BLE, Wi-Fi o 2,4 GHz propietario para el vivo.** El cuerpo absorbe mucho los 2,4 GHz, así que con 30 jugadores en 100 × 70 m el alcance hasta el costado no es confiable. Wi-Fi además gasta mucha batería.
- **4G en cada pod.** Tiene costo por jugador, consumo y depende de la cobertura de cada club.
- **GNSS de una sola banda (L1)**, por ejemplo el RAK12500 / ZOE-M8Q del backlog. Ahorra unos US$ 5–10, pero no resuelve la ionosfera ni la falta de SBAS, que son el problema en Argentina.
- **Sin acelerómetro de alto rango.** Ahorra unos US$ 2–4, pero en rugby los contactos saturan un acelerómetro de ±16 g.
- **RTK en vivo en toda la tanda.** Que las correcciones entren por LoRa, con el gateway half-duplex, está **no verificado**; la EA cuesta más que el AA, y la carga no necesita centímetros. Queda como opción para uso táctico, con la placa lista para la EA.
- **LG290P en cada pod.** Tiene el mejor crudo, pero cuesta US$ 67–107 y consume unos 98 mA: va solo como base y referencia.
- **Descarga solo por BLE.** No escala a 100 pods (ver arriba).

## Consecuencias

- **Mecánica, producción y certificación** (solo contactos para la base de pogo, batería de 500–600 mAh, IP67, base, prueba de fin de línea, programación de producción, ENACOM antes del piloto, dos vueltas de placa): `docs/hardware/pod-mecanica-produccion.md`.
- **Homologación ante ENACOM.** El nuevo RAMATEL (Res. 57/2026, vigente desde el 01/12/2026 según la Res. 843/2026) define "comercializar" incluyendo **dar en comodato**. Si prestamos los pods a los clubes, el equipo final necesita **Homologación**, con certificado de una agencia reconocida y ensayo de laboratorio. El FCC/CE de los módulos probablemente no alcanza: lo que se registra es el equipo final.
  - Para **uso propio** existe la Autorización por modelo, con una Declaración de Conformidad.
  - Antes de la tanda de 100 hay que definir el modelo de entrega y presupuestar la homologación.
- **El precio de US$ 80 es en origen.** Quedan afuera:
  - la importación a Argentina, con impuestos y régimen de courier, a revisar con un despachante;
  - los chalecos, las bases, el gateway y la base GNSS propia;
  - las vueltas de prototipo y la homologación.
- **Validación propia obligatoria.** No hay estudios publicados de GNSS de doble banda de bajo costo en deportes. El plan de prototipos compara en la cancha del club contra un Catapult puesto a la vez, y contra fotocélulas en el sprint (`pod-f3.md`).
- **Riesgos de suministro:**
  - el F10N-00B-20 tiene stock incierto (Avnet pide un mínimo de 500 unidades y 19 semanas), pero ya no es el GNSS principal;
  - el LSM6DSV320X tiene stock bajo.

  Los dos tienen respaldo definido.
- **Firmware nuevo** (`firmware/`, en C): turnos LoRa sincronizados por el PPS (o por la baliza del gateway bajo techo), resumen por segundo, cifrado AES-CCM con contador, registro en NAND, descarga por la base y DFU.
- **App:** tiene que recibir el gateway y mostrar la pantalla en vivo. Las métricas y señales del vivo son funciones nuevas del dominio, con tests, y las usan la tablet y el worker.
- El ADR va asociado a B-901: `pnpm docs:check` exige un `B-xxx` en la línea del issue, y el epic #116 no tiene uno propio.
- Este ADR queda **Propuesto** hasta que los tests de banco y de cancha confirmen el GNSS y la antena. Con esos datos se escribe un ADR que lo acepta o lo reemplaza.
- El sistema alrededor del pod (alcance M19 y primera, flota, consentimiento `location`, protocolo, seguridad, base de tiempo, log y variantes del método) está en el [ADR 0106](0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md).

## Registro de decisiones

Decisiones posteriores sobre el hardware del pod, en orden. Lo de arriba queda como se decidió; estas entradas lo reemplazan donde dicen.

### 2026-11-09: placa v0 solo con partes en stock

**Regla del usuario:** cada parte tiene que poder comprarse **hoy**, con 150 unidades o más en una fuente que PCBWay compra (o que consignamos) y unas 2 semanas de entrega; nada que espere un plazo de fábrica de 12 semanas o más. Estudio en [`alternativas-en-stock.md`](../hardware/cotizacion/alternativas-en-stock.md) y [`alternativas-mcu-radio.md`](../hardware/cotizacion/alternativas-mcu-radio.md) (stock y precios leídos ese día). Decisiones:

1. **MCU + BLE: u-blox BMD-340-A-R-10** (nRF52840) en lugar del Raytac MDBT50Q-P1MV2. Por qué: el Raytac no tenía 150 confirmadas (DigiKey Marketplace 37; TME sin confirmar) y el BMD-340 tiene 10.055 en DigiKey, hoja completa con FCC 2AA9B10, IC 12208A-10, CE y MIC, los 48 GPIO y USB, y casi el mismo tamaño (15,0 × 10,2 mm). Mismo SoC: el firmware solo cambia comentarios de pads (las asignaciones P0.x/P1.x quedan). Modo LV (VCC y VCCH a VREG de 3,4 V); cristal de 32,768 kHz externo como antes. Footprint dibujado desde la figura 12 de su hoja con el keep-out de 4,4 mm de la antena.
2. **LoRa: Ai-Thinker Ra-01SH** (SX1262) en lugar del Ebyte E22-900M22S. Por qué: el E22 tenía una sola fuente con 517; el Ra-01SH tiene 2.239 en LCSC y cuesta 2,12 menos. Tiene **cristal común, sin TCXO**: el error de frecuencia se controla con una puerta de banco de 10 muestras antes de las 100 y, si falla, va el **NiceRF LoRa1262-915TCXO** (respaldo documentado, no está en la placa). La antena pasa a la **Molex 2111400100** (DigiKey 5.706), fuera de la placa.
3. **IMU: ST LSM6DSV32X** (±32 g de doble canal) en lugar de la LSM6DSV320X (sin stock), pin a pin en el mismo LGA-14L. Se pierde el canal de ±320 g: el **ADXL372** (±200 g) se monta en **2 de las 5 placas de la v0** (variante de armado `pod-v0-highg`, con su propia lista para PCBWay) para medir cuánto satura ±32 g en los contactos; con esos datos se decide si va en las 100 (+15 por pod). `contacts_n` y `scrums_n` se cuentan con un umbral debajo de 32 g.
4. **Patch GNSS: Taoglas GVLB258.A** (25 × 25 × 8,12 mm, 18 g) en lugar de la GVLB208.A (20 × 20, DigiKey 271). Por qué: 895 en DigiKey, más eficiencia en L1 (70 % contra 50 %) y 4,75 menos. Footprint nuevo (pin a 2,5 mm del centro, **a verificar contra el DXF** de Taoglas); la zona de 30 × 30 mm ya estaba pensada para 25 × 25. La carcasa tiene que apretar la cerámica (`pod-mecanica-produccion.md`).
5. **Load switches: TI TPS22919DCKR** (SC-70-6) en `U105`, `U303` y `U502` en lugar de la TPS22916C (DSBGA de 0,4 mm, stock limitado), con el **pin QOD atado a VOUT** en los tres.
6. **Pendiente: LP5907MFX-3.2/NOPB como segunda fuente del LDO de 3,2 V del GNSS.** La decisión era bajar el 10 µF del VCC del LC29H (por ejemplo a 4,7 µF) para entrar en el COUT de 0,7–10 µF de la LP5907, salvo que la guía de Quectel pidiera 10 µF o más. Lo pide: el Hardware Design del LC29H (sección 3.2.1, figura 6) indica 10 µF + 100 nF + 33 pF en VCC. Así que **no se tocó**: el riel sigue con 10 µF y el TPS7A2032P (DigiKey 3.348) es la única parte aprobada. Queda para el usuario: consultar a Quectel si acepta 4,7 µF, o aprobar la LP5907 contando la capacidad efectiva con la tensión del 10 µF en 0603.

**Costo de las partes por placa** con estos cambios (`bom_pcbway.py`, 09/11/2026): **74,05 / 65,13 / 53,98** a 5 / 10 / 100 placas, contra 84,08 / 73,44 / 61,30 antes. Esquemático, footprints, listas, placa (zonas `BLE_ANTENA` y `PATCH_FEED`) y firmware (`pod_v0`) actualizados en el mismo cambio.
