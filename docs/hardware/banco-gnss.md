# Banco de GNSS del pod: compras y protocolo de prueba (B-901)

Prueba que decide el GNSS del pod de la Fase 3 ([ADR 0105](../adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md), [`pod-f3.md`](pod-f3.md)). Compara:

- el **Quectel LC29H(AA)**, la opción principal;
- el **LC29H(EA)** con RTK en vivo;
- el **u-blox NEO-F10N**, como comparación.

El **LG290P** funciona como base y como referencia. Al final, la prueba de cancha compara todo contra un Catapult (u-blox EVA-M8Q, de una sola banda) puesto a la vez.

Los precios son de listados de tiendas y agregadores, con fechas distintas y sin envío ni impuestos. Las conversiones a US$ son aproximadas. Lo que no se pudo confirmar dice "no verificado". Antes de comprar se cotiza en vivo.

## Lista de compras

| Cant. | Qué | Para qué | Precio | Fuente | Verificado |
|---|---|---|---|---|---|
| 2 | **LC29H(AA) GPS HAT** de Waveshare | Candidato principal del pod. Dos, para tener uno en el chaleco y otro de repuesto o en paralelo | £38,40 sin IVA cada uno (≈ US$ 50) | [The Pi Hut](https://thepihut.com/collections/raspberry-pi-store/products/lc29h-series-dual-band-gps-module-for-raspberry-pi-aa-gps-hat) · [Abra (WAVE-25278)](https://abra-electronics.com/robotics-embedded-electronics/raspberry-pi-en-3/wireless-en-3/wave-25278-series-dual-band-gps-module-for-raspberry-pi-dual-band-l1l5-positioning-technology.html) | Precio sí. Si la placa trae USB o solo UART, **no verificado** |
| 1 | **LC29H(EA)**: módulo suelto + placa adaptadora propia, o una placa que lo traiga | RTK en vivo a 10 Hz con la base del LG290P | ≈ US$ 40–60 | [Future Electronics (LC29HEATA)](https://www.futureelectronics.com/p/semiconductors--analog--sensors--gyro-angular-rate/lc29heata-quectel-3214812) · [hoja de datos EA](https://xonstorage.blob.core.windows.net/pdf/quectelwireless_lc29heamd_apr22_nocat_xonlink.pdf) | **No verificado**: no se encontró una placa de Waveshare con la EA (hay AA, BS y DA) ni el precio del módulo suelto |
| 1 | **LG290P** (Waveshare, breakout de 4 bandas) | Base de la cancha y referencia de alta precisión | US$ 89,99 en la tienda de Waveshare (nov. 2025) | [CNX Software](https://www.cnx-software.com/2025/11/25/waveshare-low-cost-lg290p-gnss-rtk-breakout-board-rtc-battery-support/) · [OpenELAB, 89,95 €](https://openelab.io/a/s/products/waveshare-33000) | Precio de una nota de prensa y de un revendedor sin stock. Alternativa: la placa de evaluación de Quectel [LG290P03AATA](https://www.digikey.de/en/products/detail/quectel/LG290P03AATA/24351207) |
| 1 | **u-blox NEO-F10N**: el EVK-F10N-00 de u-blox o la placa de ArduSimple | Comparación con otra marca, con crudo `RXM-RAWX` | EVK: US$ 179–187,95 ([Future](https://www.futureelectronics.com/p/4181430)), unos €159–161 ([DigiKey](https://www.digikey.ch/en/products/detail/u-blox/EVK-F10N-00/21363352)). ArduSimple AS-GNSS-F10N-L1L5-NH: US$ 113,85, sin antena ([DigiKey](https://www.digikey.com.mx/en/products/detail/ardusimple/AS-GNSS-F10N-L1L5-NH/26255746)) | Precios sí. **Ojo:** solo la variante **-00B-20** saca crudo. Qué variante lleva cada placa está **no verificado**. La placa de SparkFun trae la -00B-00, sin crudo: no sirve. Confirmar con el vendedor antes de comprar |
| 3 | **Antena patch activa L1/L5 de 25 × 25 mm** Taoglas AGVLB.25B.07.0060A | La misma antena que iría en el pod, para los dos LC29H(AA) y la EA | €21,03 @1–120 (≈ US$ 23) | [DigiKey](https://www.digikey.ie/en/products/detail/taoglas-limited/AGVLB-25B-07-0060A/21777673) | Sí. El conector y el largo del cable (`0060` sugiere 60 mm) están **no verificados**: puede hacer falta un pigtail IPEX → SMA |
| 4 | Pigtails IPEX (u.FL) → SMA | Conectar las antenas del pod a las placas | ≈ US$ 2–3 cada uno | — | **No verificado** |
| 1 | **Antena L1/L2/L5/L6** liviana (dipolo Taoglas, de ArduSimple) | Para el LG290P cuando va en el chaleco como referencia | 71 € | [ArduSimple](https://www.ardusimple.com/product/ultralight-dipole-tripleband-gnss-antenna/) | Sí (precio de la tienda) |
| 1 | *Opcional:* **antena de topografía L1/L2/L5** (ArduSimple AS-ANT3B-BUDSUR) | Base fija al costado de la cancha, con mejor rechazo del multicamino | €191,51 sin IVA | [DigiKey](https://www.digikey.ie/en/products/detail/ardusimple/AS-ANT3B-BUDSUR-L1L2L5-25SMA/26255752) | Sí |
| 1 | **STEVAL-MKI251A** (LSM6DSV320X en placa DIL24) | Probar la IMU de alto rango conectada al RAK4631 por I2C/SPI | €14,77 sin IVA | [DigiKey](https://www.digikey.be/en/products/detail/stmicroelectronics/STEVAL-MKI251A/26419489) · [ST](https://www.st.com/en/evaluation-tools/steval-mki251a.html) | Sí. La plataforma STEVAL-MKI109D es opcional (precio **no verificado**) |
| 2 | **WisBlock Starter Kit** (RAK19007 + RAK4631), versión **915 MHz** | Uno como pod de prueba y otro como receptor LoRa en la mesa | US$ 19,50–24,99 cada uno | [RAK](https://store.rakwireless.com/products/wisblock-starter-kit) | Sí. Elegir la banda de 915 al comprar |
| 4 | Adaptadores USB-serie (CP2102 o FT232) | Leer cada GNSS desde la notebook | ≈ US$ 5 cada uno | — | **No verificado** |
| 1 | **Medidor USB FNIRSI FNB58** | Consumo real de cada GNSS y del pod | 44,49 € | [aio.lv](https://aio.lv/en/product--fnirsi-fnb58--12426867) | Sí |
| 2 | Trípodes de cámara + soporte de antena | Prueba estática y base al costado | ≈ US$ 20 cada uno | — | **No verificado** |
| 1 | Chaleco de prueba con bolsillo entre los omóplatos | Llevar los equipos junto al Catapult | — | Del club o hecho a mano | — |

### Total

- **Sin lo opcional, con la placa de ArduSimple: unos US$ 700**, con estas cuentas:
  - LC29H(AA) ×2: US$ 100;
  - EA: US$ 50;
  - LG290P: US$ 90;
  - F10N: US$ 114;
  - antenas y pigtails: US$ 155;
  - IMU: US$ 16;
  - RAK ×2: US$ 50;
  - USB-serie: US$ 20;
  - medidor: US$ 48;
  - trípodes: US$ 40.
- **Con el EVK-F10N de u-blox** en vez de ArduSimple: unos US$ 770.
- **Con la antena de topografía**: unos US$ 980.
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
2. **Crudo del LC29H(AA):**
   - ¿Hay alguna salida cruda? Probar el modo base (`$PQTMCFGRCVRMODE,W,2`) con MSM7 (`$PAIR432,1`), y preguntar a Quectel por firmware.
   - ¿A qué tasa sale?
   - ¿La posición sigue a 10 Hz mientras sale el crudo?
   - ¿La configuración sobrevive a un corte de energía?
   - Si no hay crudo, el AA sigue en carrera solo por el Doppler.
3. **Crudo del F10N:** que la placa tenga la -00B-20 y hasta qué tasa sale `UBX-RXM-RAWX`.
4. **RTK con la EA:**
   - El LG290P como base, con la posición fija promediada 30 min, manda RTCM a la EA. Primero por cable serie, después por un RAK4631 de 915 MHz como enlace.
   - Medir cuánto tarda en pasar a "fixed", qué % del tiempo está en "fixed" y los **bytes/s de RTCM** necesarios. Ese último dato dice si las correcciones entran por el canal de LoRa del gateway.
5. **Consumo:** con el FNB58, cada GNSS a 10 Hz, el LG290P y el RAK transmitiendo.

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
   - Se compara la Vmax de cada GNSS contra la del tramo 20–40 m.
2. **Vueltas de distancia conocida:** un recorrido medido con cinta sobre las líneas de la cancha, con trote, cambios de ritmo y frenadas. Se compara la distancia de cada GNSS.
3. **Lado a lado con Catapult:**
   - Un jugador de primera lleva en el chaleco, a la vez, el AA, la EA y el F10N con sus antenas patch, más el Catapult (EVA-M8Q).
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
| El club quiere análisis táctico en vivo y la EA mantiene "fixed" en movimiento con las correcciones dentro del canal de LoRa | **EA en la tanda**, o en las categorías que lo pidan. La placa queda lista para la EA |
| Nadie alcanza a Catapult | Revisar la antena y la ubicación en el chaleco antes de cambiar de GNSS |

### Registro de los datos

- **Qué se guarda:** cada sesión, en una carpeta con fecha, lugar, equipo y configuración (firmware, tasa, constelaciones). Incluye:
  - los archivos crudos (NMEA, RTCM, UBX y RINEX);
  - los CSV exportados del Catapult;
  - las fotocélulas o el video del sprint;
  - una nota de condiciones: clima, cielo, quién llevó el chaleco.
- **Dónde va:** en el bucket del proyecto, bajo `research/gnss-bench/` y no en el repo. Los resultados resumidos van a este documento y al ADR que acepta o reemplaza el 0105.
- **Privacidad:** son datos de un jugador real, así que van **sin nombre**, con un código, y con el consentimiento del jugador para la prueba. Nada de claves ni credenciales en el repo.
