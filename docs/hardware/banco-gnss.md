# Banco de GNSS del pod: compras y protocolo de prueba (B-901)

Prueba que decide el GNSS del pod de la Fase 3 ([ADR 0105](../adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md), [`pod-f3.md`](pod-f3.md)). Compara:

- el **Quectel LC29H(AA)**, la opción principal;
- el **LC29H(EA)** con RTK en vivo;
- el **u-blox NEO-F10N**, como comparación.

Dos **LG290P**: uno como base fija en trípode y otro en el chaleco como referencia de alta precisión. Al final, la prueba de cancha compara todo contra un Catapult (u-blox EVA-M8Q, de una sola banda) puesto a la vez.

Los precios son de listados de tiendas y agregadores, con fechas distintas y sin envío ni impuestos. Las conversiones a US$ son aproximadas. Lo que no se pudo confirmar dice "no verificado". Antes de comprar se cotiza en vivo.

## Compra reducida (decisión: directo a la v0)

Se decidió ir directo a la placa v0 con módulos ([`pod-v0.md`](pod-v0.md)). El banco se reduce a lo que hace falta **antes de cerrar el esquemático** y a la referencia de la cancha:

| Cant. | Qué | Para qué | ≈ US$ |
|---|---|---|---|
| 1 | LC29H(AA) GPS HAT de Waveshare | Si la AA saca crudo y si da velocidad Doppler a 10 Hz | 50 |
| 2 | LG290P | Base en trípode y referencia en el chaleco | 180 |
| 1 | Antena Taoglas AGVLB.25B.07.0060A + pigtail | La antena del pod, para el HAT | 33 |
| 1 | Dipolo liviano multibanda | Antena del LG290P del chaleco | 77 |
| 2 | Adaptadores USB-serie | Leer los GNSS desde la notebook | 10 |
| 1 | Medidor USB FNB58 | Consumo | 48 |
| 1 | Trípode + soporte de antena | Base al costado | 20 |

**Total: unos US$ 420**, sin envío ni impuestos (precios y fuentes en la tabla de abajo). La EA, el RTK, el consumo del pod y la convivencia con LoRa se prueban en la v0. El NEO-F10N, los RAK y la placa de la IMU quedan opcionales: se compran solo si la AA decepciona o si se quiere adelantar firmware antes de que llegue la v0.

## Lista de compras completa (referencia)

| Cant. | Qué | Para qué | Precio | Fuente | Verificado |
|---|---|---|---|---|---|
| 2 | **LC29H(AA) GPS HAT** de Waveshare | Candidato principal del pod. Dos, para tener uno en el chaleco y otro de repuesto o en paralelo | £38,40 sin IVA cada uno (≈ US$ 50) | [The Pi Hut](https://thepihut.com/collections/raspberry-pi-store/products/lc29h-series-dual-band-gps-module-for-raspberry-pi-aa-gps-hat) · [Abra (WAVE-25278)](https://abra-electronics.com/robotics-embedded-electronics/raspberry-pi-en-3/wireless-en-3/wave-25278-series-dual-band-gps-module-for-raspberry-pi-dual-band-l1l5-positioning-technology.html) | Precio sí. Si la placa trae USB o solo UART, **no verificado** |
| 1 | **LC29H(EA)**: módulo suelto + placa adaptadora propia, o una placa que lo traiga | RTK en vivo a 10 Hz con la base del LG290P | ≈ US$ 40–60 | [Future Electronics (LC29HEATA)](https://www.futureelectronics.com/p/semiconductors--analog--sensors--gyro-angular-rate/lc29heata-quectel-3214812) · [hoja de datos EA](https://xonstorage.blob.core.windows.net/pdf/quectelwireless_lc29heamd_apr22_nocat_xonlink.pdf) | **No verificado**: no se encontró una placa de Waveshare con la EA (hay AA, BS y DA) ni el precio del módulo suelto |
| 2 | **LG290P** (Waveshare, breakout de 4 bandas) | Uno como base fija en trípode y otro en el chaleco como referencia: un mismo equipo no puede ser las dos cosas a la vez | US$ 89,99 cada uno en la tienda de Waveshare (nov. 2025) | [CNX Software](https://www.cnx-software.com/2025/11/25/waveshare-low-cost-lg290p-gnss-rtk-breakout-board-rtc-battery-support/) · [OpenELAB, 89,95 €](https://openelab.io/a/s/products/waveshare-33000) | Precio de una nota de prensa y de un revendedor sin stock. Alternativa: la placa de evaluación de Quectel [LG290P03AATA](https://www.digikey.de/en/products/detail/quectel/LG290P03AATA/24351207) |
| 1 | **u-blox NEO-F10N**: el EVK-F10N-00 de u-blox o la placa de ArduSimple | Comparación con otra marca, con crudo `RXM-RAWX` | EVK: US$ 179–187,95 ([Future](https://www.futureelectronics.com/p/4181430)), unos €159–161 ([DigiKey](https://www.digikey.ch/en/products/detail/u-blox/EVK-F10N-00/21363352)). ArduSimple AS-GNSS-F10N-L1L5-NH: US$ 113,85, sin antena ([DigiKey](https://www.digikey.com.mx/en/products/detail/ardusimple/AS-GNSS-F10N-L1L5-NH/26255746)) | Precios sí. **Ojo:** solo la variante **-00B-20** saca crudo. Qué variante lleva cada placa está **no verificado**. La placa de SparkFun trae la -00B-00, sin crudo: no sirve. Confirmar con el vendedor antes de comprar |
| 3 | **Antena patch activa L1/L5 de 25 × 25 mm** Taoglas AGVLB.25B.07.0060A | La misma antena que iría en el pod, para los dos LC29H(AA) y la EA | €27,60 sin IVA @1 (≈ US$ 30); €21,03 es el precio @120 | [DigiKey](https://www.digikey.ie/en/products/detail/taoglas-limited/AGVLB-25B-07-0060A/21777673) | Precio sí. Conector I-PEX MHF1 con cable de 60 mm, verificado: hace falta un pigtail a SMA. Que tenga SAW, **no verificado** |
| 4 | Pigtails IPEX (u.FL) → SMA | Conectar las antenas del pod a las placas | ≈ US$ 2–3 cada uno | — | **No verificado** |
| 1 | **Antena multibanda liviana** (dipolo Taoglas, de ArduSimple; bandas L1/L2/L5, y si incluye L6 está **no verificado**: la página dice "tripleband") | Para el LG290P del chaleco: pesa menos de 7 g, así no cambia cómo se lleva el chaleco frente al Catapult | 71 € | [ArduSimple](https://www.ardusimple.com/product/ultralight-dipole-tripleband-gnss-antenna/) | Precio sí (tienda) |
| 1 | *Opcional:* **antena de topografía L1/L2/L5** (ArduSimple AS-ANT3B-BUDSUR) | Base fija al costado de la cancha, con mejor rechazo del multicamino. Si no se compra, la base usa la antena del kit del LG290P, si la trae (**no verificado**) | €191,51 sin IVA | [DigiKey](https://www.digikey.ie/en/products/detail/ardusimple/AS-ANT3B-BUDSUR-L1L2L5-25SMA/26255752) | Sí |
| 1 | **STEVAL-MKI251A** (LSM6DSV320X en placa DIL24) | Probar la IMU de alto rango conectada al RAK4631 por I2C/SPI | €16,71 | [DigiKey](https://www.digikey.be/en/products/detail/stmicroelectronics/STEVAL-MKI251A/26419489) · [ST](https://www.st.com/en/evaluation-tools/steval-mki251a.html) | Sí. La plataforma STEVAL-MKI109D es opcional (precio **no verificado**) |
| 2 | **WisBlock Starter Kit** (RAK19007 + RAK4631), versión **915 MHz** | Uno como pod de prueba y otro como receptor LoRa en la mesa | US$ 19,50–24,99 cada uno | [RAK](https://store.rakwireless.com/products/wisblock-starter-kit) | Sí. Elegir la banda de 915 al comprar |
| 4 | Adaptadores USB-serie (CP2102 o FT232) | Leer cada GNSS desde la notebook | ≈ US$ 5 cada uno | — | **No verificado** |
| 1 | **Medidor USB FNIRSI FNB58** | Consumo de la placa entera por USB. El consumo del módulo solo se mide en el riel de 3,3 V (con un multímetro en serie o una resistencia de medición) | 44,49 € | [aio.lv](https://aio.lv/en/product--fnirsi-fnb58--12426867) | Sí |
| 2 | Trípodes de cámara + soporte de antena | Prueba estática y base al costado | ≈ US$ 20 cada uno | — | **No verificado** |
| 1 | Chaleco de prueba con bolsillo entre los omóplatos | Llevar los equipos junto al Catapult | — | Del club o hecho a mano | — |

### Total

- **Sin lo opcional, con la placa de ArduSimple: unos US$ 810**, con estas cuentas:
  - LC29H(AA) ×2: US$ 100;
  - EA: US$ 50;
  - LG290P ×2: US$ 180;
  - F10N: US$ 114;
  - antenas y pigtails: US$ 177 (3 Taoglas a ≈ US$ 30, el dipolo y los pigtails);
  - IMU: US$ 18;
  - RAK ×2: US$ 50;
  - USB-serie: US$ 20;
  - medidor: US$ 48;
  - trípodes: US$ 40.
- **Con el EVK-F10N de u-blox** en vez de ArduSimple: unos US$ 870–885.
- **Con la antena de topografía** (unos US$ 205 más): unos US$ 1.015 sobre el caso de ArduSimple, o unos US$ 1.090 sobre el del EVK.
- Quedan afuera el envío y la importación.

### Envío a Argentina

Se compra por courier (DHL, FedEx o el correo de cada tienda). Antes de pedir hay que revisar con un despachante:
- los límites del régimen de courier;
- los impuestos;
- si conviene juntar todo en un envío o separar por proveedor.

Las placas con radio (los RAK de 915 MHz) son equipos de prueba de uso propio. La homologación de la Fase 3 se trata aparte en B-903.

## Protocolo de prueba

Cada etapa decide si se sigue con la siguiente. Los datos se guardan como se describe al final.

### a) Banco (una tarde, con QGNSS de Quectel, u-center 2 de u-blox y RTKLIB)

1. **10 Hz estables:**
   - Configurar cada GNSS a 10 Hz con GPS, Galileo, BeiDou y GLONASS.
   - Registrar 30 min con el cielo despejado.
   - Contar las épocas perdidas: el objetivo es menos del 0,1 %.
   - Ver qué satélites usa en L5: GPS L5, Galileo E5a y BeiDou B2a.
2. **Crudo del LC29H(AA):** la especificación de protocolo V1.5 dice que **sí sale, como RTCM3 MSM4/MSM7 más efemérides, sin modo base**. En la AA el modo base no existe: `$PQTMCFGRCVRMODE` es solo de BA, CA, DA y EA. Se prende con:
   - `$PAIR432,1` (MSM7);
   - `$PAIR436,1` (efemérides);
   - la salida RTCM3 en el UART (`$PQTMCFGPROT,W,1,1,1,5`).

   No hay crudo propio de Quectel. Detalle y citas en [`lc29h-protocolo.md`](lc29h-protocolo.md). Lo que la especificación no dice y mide el banco:
   - ¿A qué tasa salen los MSM a 10 Hz de posición? La página del producto dice "GNSS raw data 1 Hz".
   - ¿Traen L5, E5a y B2a?
   - ¿La posición sigue a 10 Hz sin épocas perdidas mientras sale el crudo?
   - ¿La configuración sobrevive a un corte de energía?
   - ¿RTKLIB lo convierte (`convbin`) y da PPK contra el LG290P?

   Si el crudo no anda en la práctica, el AA sigue en carrera solo por el Doppler, y la corrección de su traza con el PPK no es posible.
3. **Velocidad por Doppler del LC29H:** la especificación da la velocidad en `$PQTMPVT` y `$PQTMVEL` (norte, este y abajo, más la precisión estimada), pero no dice que salga del Doppler. El banco:
   - lo confirma contra el Doppler de los MSM7;
   - mide el filtrado que aplica el módulo y la latencia de la velocidad frente a la posición;
   - compara el modo de navegación normal (`$PAIR080,0`) con el de fitness (`$PAIR080,1`) en los sprints.
4. **Crudo del F10N:** que la placa tenga la -00B-20 y hasta qué tasa sale `UBX-RXM-RAWX`.
5. **RTK con la EA:**
   - El LG290P como base, con la posición fija promediada 30 min, manda RTCM a la EA. Primero por cable serie, después por un RAK4631 de 915 MHz como enlace.
   - Medir cuánto tarda en pasar a "fixed", qué % del tiempo está en "fixed" y los **bytes/s de RTCM** necesarios.
   - **Si las correcciones entran por LoRa está no verificado.** El presupuesto:
     - MSM7 con 4 constelaciones y doble banda son de varios cientos de bytes a 1 kB/s, contra unos 680 B/s de SF7 / 125 kHz, con tramas de hasta 255 B y límites de permanencia por canal.
     - El gateway SX1302 es half-duplex: mientras difunde, **no recibe en ninguno de los 8 canales**, y eso le quita turnos a los 160 pods / 2 s de B-905.
     - Mitigaciones a probar: MSM4 en vez de MSM7, menos constelaciones, correcciones cada 2–5 s, un canal de bajada de 500 kHz o una radio aparte para transmitir.
6. **Consumo:** cada módulo GNSS a 10 Hz en su riel de 3,3 V, y con el FNB58 la placa entera, el LG290P y el RAK transmitiendo.

### b) Estático (1–2 h por lugar)

- **Lugares:** cielo despejado en el medio de la cancha del club; después, junto a las tribunas y a los árboles.
- **Montaje:** todos los equipos en trípodes a 1 m entre sí, con el LG290P como base a menos de 100 m.
- **Posprocesado con RTKLIB:**
  - contra la base propia (el LG290P);
  - contra el RINEX de 1 s de RAMSAC IGM0, como respaldo.
- **Se mide:**
  - la dispersión de la posición sola de cada uno (desvío horizontal);
  - el error del PPK (AA a 1 Hz, F10N);
  - el % de soluciones "fixed" del RTK de la EA.

### c) Dinámico, con referencia

1. **Sprints de 40 m:**
   - Medidos con fotocélulas o con el sprint por video de la app, que ya mide 10/20/40 m ([ADR 0082](../adr/0082-sprint-por-video-foto-finish.md)).
   - Al menos 10 sprints.
   - Se compara la **velocidad media de cada GNSS entre los 20 y los 40 m** contra `20 / (t40 − t20)`, no el pico de velocidad.
2. **Vueltas de distancia conocida:** un recorrido medido con cinta sobre las líneas de la cancha, con trote, cambios de ritmo y frenadas. Se compara la distancia de cada GNSS.
3. **Lado a lado con Catapult:**
   - Un jugador de primera lleva en el chaleco, a la vez, el AA, la EA y el F10N con sus antenas patch, el **LG290P de referencia** con el dipolo liviano, y el Catapult (EVA-M8Q). El otro LG290P queda como base en el trípode.
   - En un entrenamiento real, y si se puede en un partido.

**Métricas, por equipo y contra la referencia:**
- error de distancia en %;
- error de Vmax en m/s;
- distancia HSR (más de 5,5 m/s en varones);
- conteo de aceleraciones y desaceleraciones de más de 2 m/s²;
- en la EA, % de "fixed" en movimiento;
- bytes/s de RTCM;
- consumo.

### Cómo se decide

| Resultado | Decisión |
|---|---|
| El AA queda parejo con el F10N y con Catapult en Vmax, distancia y HSR (diferencias dentro de la variabilidad entre dos Catapult, según la bibliografía, o menos del 2–3 % en distancia y unos 0,2 m/s en Vmax; criterio a confirmar con el preparador físico) | **AA en la tanda de 100.** El ADR 0105 se acepta con el AA |
| El AA no alcanza y el F10N sí | Se evalúa el F10N con su costo, sumando unos US$ 12–14 por pod, y su stock |
| El club quiere análisis táctico en vivo, la EA mantiene "fixed" en movimiento y el presupuesto de LoRa cierra (correcciones más los turnos de B-905, con el gateway half-duplex; hoy **no verificado**) | **EA en la tanda**, o en las categorías que lo pidan. La placa queda lista para la EA |
| Nadie alcanza a Catapult | Revisar la antena y la ubicación en el chaleco antes de cambiar de GNSS |

### Registro de los datos

- **Qué se guarda:** cada sesión, en una carpeta con fecha, lugar, equipo y configuración (firmware, tasa, constelaciones). Incluye:
  - los archivos crudos (NMEA, RTCM, UBX y RINEX);
  - los CSV exportados del Catapult;
  - las fotocélulas o el video del sprint;
  - una nota de condiciones: clima, cielo, quién llevó el chaleco.
- **Dónde va:** en el bucket del proyecto, bajo `research/gnss-bench/` y no en el repo. Los resultados resumidos van a este documento y al ADR que acepta o reemplaza el 0105.
- **Privacidad:** son datos de un jugador real, así que van **sin nombre**, con un código, y con el consentimiento del jugador para la prueba. Nada de claves ni credenciales en el repo.
