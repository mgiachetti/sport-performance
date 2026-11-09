# Alternativas del bloque MCU + radio del pod v0 (B-909)

Relevamiento del **09/11/2026** del bloque de cómputo y radio del pod v0: el módulo BLE con el nRF52840 (`U301`, hoy **Raytac MDBT50Q-P1MV2**), el módulo LoRa (`U302`, hoy **Ebyte E22-900M22S**) y la antena LoRa que no se suelda (hoy **Ebyte TX915-FPC-4510**). Responde a la regla nueva del usuario: **el diseño aprobado no está fijo; cada parte tiene que estar disponible ya**, con **150 unidades o más** comprables hoy en una fuente que PCBWay pueda comprar (o que compremos nosotros y consignemos) y un plazo de **unas 2 semanas como máximo**. Se puede cambiar de módulo, y hasta de MCU (por ejemplo, un MCU sin BLE más un módulo BLE aparte), si el actual sale mucho más caro o no tiene stock.

**Este documento no cambia el diseño**: `hardware/tools/esquematico/diseno.py` sigue con el MDBT50Q-P1MV2 y el E22 hasta que el usuario decida la arquitectura. Parte del paquete de cotización: stock del resto de la placa en [`stock.md`](stock.md), precios en [`costos.md`](costos.md).

## Qué tiene que cumplir el bloque

De [ADR 0105](../../adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md), [ADR 0106](../../adr/0106-sistema-del-pod-flota-ubicacion-protocolo-seguridad-y-datos.md), [ADR 0109](../../adr/0109-firmware-del-pod-zephyr-ncs-y-tests-de-host.md) y [`pod-v0.md`](../pod-v0.md):

| Requisito | Detalle | Qué descarta |
|---|---|---|
| BLE | Enlace con el celular o la tablet, aprovisionamiento, sincronización; rol central para bandas de FC más adelante | — |
| LoRa 915–928 MHz, clase SX126x | Subida de 51 B en **SF7 / 125 kHz**, CR 4/5; rama alternativa de **500 kHz** si ENACOM pide otra cosa; baliza y RTCM de bajada (`packages/pod-protocol`) | Nada que no llegue a SF7 / 125 kHz |
| Periféricos | NAND SPI a 32 MHz (SPIM3), bus SPI de sensores, bus SPI del LoRa, I2C, **2 UART** (GNSS con RTCM y consola), PWM del LED, PPS capturado sin la CPU (GPIOTE → PPI → TIMER) | — |
| GPIO | El diseño usa los **48** del nRF52840; sin lo opcional (UWB 4, ADXL372 2, buzzer 1, consola 2) quedan **unos 39** | Módulos con 31–32 GPIO, salvo sacando funciones |
| USB FS | La base descarga por los pads D+/D− (una sesión de 49 MB a unos 1 MB/s; por BLE serían unos 8 min por pod, ADR 0105) | Sin USB hay que rediseñar la base (UART o SPI por los pads) |
| Reloj de 32,768 kHz | Cristal externo (LFXO) para el TDMA: ±20 ppm, guarda de ±3 ms, holdover de 2,5 min (ADR 0106) | — |
| System OFF | Presupuesto total de **51–71 µA** (lo domina el backup del GNSS); el MCU suma unos 0,4 µA | Nada con más de unos pocos µA |
| Cripto | AES-CCM, AES-CTR, AES-CMAC, HKDF-SHA256 y P-256 (verificar firmas) por PSA; en el nRF52840, el CryptoCell-310 | — |
| Claves | Almacenamiento seguro de la clave del dispositivo, APPROTECT, MCUboot con imágenes firmadas | — |
| Firmware | Zephyr sobre **NCS 3.4.1**; cambiar de SoC tiene costo de port (estimado abajo) | — |
| Certificación | Módulos **precertificados** FCC/IC/CE (camino de homologación del equipo final en ENACOM); nada de radio soldada directo | Chip suelto con RF propio |

**Qué del firmware depende del SoC** (unas 6.500 líneas en `firmware/`): la biblioteca portable (`firmware/lib`, unas 4.800 líneas: formatos, cripto por PSA, máquina de estados) no depende del chip. Lo que sí: la placa (`firmware/app/boards/pod/pod_v0`), `time_base.c` (RTC, TIMER, GPIOTE y PPI por `nrfx`), `power.c` (System OFF y SENSE), el backend de PSA (CryptoCell-310 en `nrf_security`) y la configuración de MCUboot y de la UICR.

## Cómo se leyó

| Fuente | Cómo | Resultado |
|---|---|---|
| DigiKey | Página de producto (`digikey.com/en/products/detail/...`) | **La única fuente con números en vivo** para casi todo. "Marketplace" quiere decir que lo despacha el fabricante (más un flete propio de unos US$ 25) |
| LCSC | La API de su página (`wmsc.lcsc.com/ftps/wm/product/detail?productCode=<código>`) | Funcionó para RAK3172, RAK4630, NiceRF LoRa1262, Ra-01SH, MDBT50Q y nRF52840. Para el **E22 (C411293)**, el E77 y el E73 devolvió vacío (`result: null`): se toma la cifra de [`stock.md`](stock.md), leída hoy |
| Findchips | `findchips.com/search/<MPN>` | Dio TME para el MDBT50Q-1MV2 y el Wio-E5; después devolvió "No results" para todo (parece un bloqueo) |
| Mouser, Octopart, TME, fcc.report | — | Sin respuesta, 403 o tiempo agotado: **no verificado** |
| RAK store, Seeed, Heltec, Ebyte | Página del producto | RAK store: error 429. Seeed: precio unitario sin stock. Ebyte: sin stock ni precio |

Las cifras de un buscador o de una copia vieja de LCSC no cuentan como stock de hoy: quedan como **no verificado**. Todos los precios están en US$, sin impuestos, al escalón de 100 (o el más cercano que se pudo leer, aclarado).

## Hoy: lo que está en el diseño

| Parte | US$ a 100 | Stock hoy | Problema |
|---|---|---|---|
| Raytac MDBT50Q-P1MV2 | 6,00 (DigiKey Marketplace, precio a 1, más flete) | DigiKey Marketplace 37, LCSC 0, **TME 1.239** (por Findchips, **no verificado**) | Con fuente confirmada no llega a 150 |
| Raytac MDBT50Q-1MV2 (antena chip, mismo footprint) | 6,15 (DigiKey Marketplace, a 1); LCSC 18,60 a 10, sin stock | DigiKey Marketplace 50, LCSC 0, **TME 1.274** (por Findchips, US$ 6,92–9,45; **no verificado**) | Lo mismo |
| Ebyte E22-900M22S | 5,11 (JLCPCB) | LCSC 517 según [`stock.md`](stock.md); la API de LCSC devolvió vacío al releer. Fuera de DigiKey | Una sola fuente, con 3,4 veces lo que hace falta: **limitado** |
| Ebyte TX915-FPC-4510 | sin precio (unos 0,65 en Alibaba, **no verificado**) | Sin cifra | No se puede confirmar |
| **Bloque hoy** | **11,11 + la antena** (13,07 con la Molex) | — | **No cumple la regla**: ni el módulo BLE ni la antena tienen 150 confirmados |

## Módulos con nRF52840 (mismo SoC: el firmware casi no cambia)

| Módulo | Antena · tamaño | GPIO · USB | US$ a 100 | Stock (09/11/2026) | Certificaciones | Qué cambia en la placa | Port de firmware | Riesgo de RF |
|---|---|---|---|---|---|---|---|---|
| Raytac MDBT50Q-P1MV2 / -1MV2 | PCB / chip · 10,5 × 15,5 | 48 · sí | 6,00–6,50 | TME 1.239 / 1.274 sin confirmar; resto < 150 | FCC SH6MDBT50Q; IC, CE y TELEC por la familia, números **no verificados** | Nada (la -1MV2: keep-out de la antena chip, sección 2.3 de la hoja) | Ninguno | Bajo |
| **Fanstel BT840** ([DigiKey](https://www.digikey.com/en/products/detail/fanstel-corp/BT840/8323661)) | PCB · 14 × 16 × 1,9 | 48 (16 almenados + LGA) · sí (USB en los LGA E4/E5; VDDH F4, DCCH F5, VBUS F6) | **8,93** (500: 8,18) | **DigiKey 10.247** (stock propio, activo; fábrica 10 semanas) | FCC **X8WBT840F** e IC **4100A-BT840F** (compartidos por BT840, BT840F y BT840E) | Footprint nuevo (unos +61 mm²), módulo en el borde. El cristal de 32,768 kHz es **externo** (solo el BT840X y el XE lo traen adentro): `Y301` y sus capacitores quedan. Es la variante de **corto alcance** de Fanstel (+4,9 dBm como máximo; 150 m contra 1.000 m del BT840F, según Fanstel), de sobra para pod ↔ celular. El keep-out con medidas solo está publicado para el BT840F: para el BT840, del Gerber del EV-BT840 o preguntando a Fanstel | **S**: devicetree de la placa con los pines nuevos; mismo SoC, mismo NCS | Bajo |
| u-blox BMD-340-A-R ([DigiKey](https://www.digikey.com/en/products/result?keywords=BMD-340-A-R)) | PCB · 15,0 × 10,2 × 1,9 | 48 · sí (D+, D− y VBUS en los pines 66–68); VCC 1,7–3,6 V y VCCH en el pin 65 | 9,60 (a 1; 1.000: 9,66) | **DigiKey 10.055** (activo; fábrica 20 semanas) | FCC **2AA9B10**, IC **12208A-10**, CE (RED), MIC **R204-B00161** | Footprint nuevo, del tamaño del Raytac. Cristal de 32,768 kHz **externo**: `Y301` queda. Se pide la revisión de producción **BMD-340-A-R-10** (la -00 y la -01 están obsoletas) | **S** | Bajo |
| Minew MS88SF3 | PCB · 18,5 × 12,5 | 48 según LCSC · sí | 7,50 (a 1) | DigiKey Marketplace 1.791, unos 7 días desde Minew, **con límite de compra** sin cifra | FCC 2ABU6-MS88SF3 | Footprint nuevo | **S** | Bajo |
| Minew MS88SF2 | PCB o U.FL · 23,2 × 17,4 | **24** · sí | 6,80–7,50 (a 1) | DigiKey Marketplace 1.051–1.962 | FCC 2ABU6-MS88SF2 | No entra: pocos GPIO | — | — |
| Insight SiP ISP1807 | Integrada · 8 × 8 × 1 | **no verificado** | 13,65 (mínimo 50; 500: 11,15) | DigiKey Marketplace 11.350 | FCC 2AAQS-ISP1807 | Footprint nuevo, más chico | **S** | Bajo |
| Ezurio BL654 451-00001 | PCB · 15 × 10 × 2,2 | **no verificado** · sí | 14,55 (a 1) | DigiKey 21.883 | FCC, ISED, CE, Anatel (números **no verificados**) | Footprint nuevo | **S** | Bajo |
| Ebyte E73-2G4M08S1C | Chip · 13 × 18 | unos 31 (ADR 0105) · sí | **no verificado** | API de LCSC vacía | Sin datos | No entra: el ADR 0105 lo descartó por GPIO | — | — |
| nRF52840-QIAA-R suelto | — | 48 · sí | 5,95 (LCSC) | LCSC 42.898, DigiKey 84.126 | Ninguna: certificación propia | Diseño de RF propio | **S** | **Alto**: descartado por la regla de módulos |

La **E73-2G4M08S1E** es nRF52833, no nRF52840. Holyiot 18010 solo aparece en minoristas de la India: **no verificado**.

## Otros SoC con BLE

| Opción | US$ a 100 | Stock | Qué cambia | Port | Veredicto |
|---|---|---|---|---|---|
| **nRF54L15**: Fanstel BM15C (chip, 10 × 15,8; FCC X8WBM15C, IC 4100A-BM15C) | 5,95 | DigiKey 445 | **Sin USB** (solo los nRF54LM20 lo tienen) y **31–32 GPIO**: la base pasa a hablar por UART por los pads (con 1 Mbaud, una sesión de 49 MB son unos 8 min, como por BLE) y hay que sacar funciones | **M–L**: DPPI y GRTC en lugar de PPI y RTC (`time_base.c`), System OFF (`power.c`), CRACEN y KMU en lugar del CryptoCell-310 (mismo PSA), MCUboot, la placa, y además el firmware y el hardware de la base. Unas 3–5 semanas | Descartado para la v0: rompe la descarga por la base. Es el más barato y el de menor consumo (System OFF 0,6–0,8 µA); una placa futura con el nRF54LM20 (USB) merece revisarse |
| nRF54L15: Insight SiP ISP2454 (8 × 8) | 7,53 | DigiKey 1.248 | Igual que arriba | M–L | Igual |
| nRF54L15: Minew ME54BS01, Raytac AN54LQ/AN54LV, u-blox NORA-B206, Ezurio BL54L15 | 4,62–6,43 (a 1 o 25) | Marketplace 30–954; Ezurio 0 hasta 2027; NORA-B206 171 | Igual | M–L | Igual |
| **nRF5340**: u-blox NORA-B106 | 10,89 (a 1; 500: 8,90) | DigiKey 8.506 | Footprint nuevo; USB sí; dos núcleos (la radio en el núcleo de red) | **M**: otro SoC en NCS, el CryptoCell-312, la placa, `time_base.c` y `power.c` con DPPI; unas 2 semanas | Funciona pero cuesta más que el BT840 sin ganar nada que el pod necesite |

## Módulos con MCU y LoRa juntos

| Módulo | Adentro | US$ a 100 | Stock | Certificaciones | Zephyr | Veredicto |
|---|---|---|---|---|---|---|
| RAK4630 ([DigiKey](https://www.digikey.com/en/products/detail/rakwireless-technology-limited/RAK4630-9-SM-I/17138014)) | nRF52840 + SX1262, 15 × 23 × 3, 44 pads | 25,99 | DigiKey **100** (fábrica 12 semanas); LCSC 0 (19,95 a 10) | FCC 2AF6B-RAK4630, CE, ISED | Placa `rak4631` | **No cumple** (stock y plazo). Además: sin antena BLE en el módulo (sale por un pad), unos 25 pines de GPIO (no alcanzan), 4,2 µA en reposo y más del doble del costo |
| RAK3172 ([DigiKey](https://www.digikey.com/en/products/detail/rakwireless-technology-limited/RAK3172-9-SM-NI/17138034)) | STM32WLE5CC, 15,5 × 15, sin USB, sin BLE | 7,80 (300: 7,34) | DigiKey 769; LCSC 70 | FCC 2AF6B-RAK3172, IC 25908-RAK3172, CE, Anatel | Placa `rak3172` | Solo como radio LoRa o con un BLE aparte: ver "Divididas" |
| Seeed Wio-E5 (317990687) | STM32WLE5JC, 12 × 12, sin USB | 7,11 (a 1) | DigiKey 3.064; Seeed sin stock; TME 75 | CE, FCC, IC, TELEC | `lora_e5_dev_board` | Igual que el RAK3172 |
| Ebyte E77-900M22S | STM32WLE5CC, 14 × 20 | **no verificado** | API de LCSC vacía; fuera de DigiKey | **no verificado** | Sin placa | No cumple: sin stock confirmado |
| Murata Type 1SJ (LBAA0QB1SJ-296) | STM32L072 + SX1262, 10 × 8 | 13,46 (500: 12,35) | DigiKey 1.722 (fábrica 71 semanas) | FCC VPYLB1SJ, IC, CE, Anatel | Sin placa | Sin BLE, caro y con un firmware de módem AT: no |
| Heltec HT-CT62 | ESP32-C3 + SX1262, 17,8 × 17,8 | 6,90 (a 1, tienda de Heltec) | **no verificado** | FCC 2A2GJ-HT-CT62 | ESP32-C3 sí, el módulo no | No: 15 GPIO, sin cripto de PSA equivalente al CC310, unos 10 µA en reposo y otro SDK |
| Módulos con LR1121 (Ebyte E80, Seeed Wio-LR1121) | Solo radio (sin MCU) | — | **no verificado** | — | — | Agregan 2,4 GHz LoRa y escaneo GNSS que el pod no usa |
| Minew ME25LS03 (nRF54L15 + SX1262) | — | — | DigiKey ya no lo vende | — | — | No cumple |

## Divididas: MCU sin BLE más un módulo BLE

La idea del usuario: un MCU (o un SoC LoRa) sin BLE más un módulo BLE chico. Con los números de hoy:

| Variante | Partes y US$ a 100 | Bloque (con la Molex) | Qué implica |
|---|---|---|---|
| **STM32WL como radio + nRF52840 de anfitrión** | Wio-E5 7,11 o RAK3172 7,80 + BT840 8,93 | **unos 18,0–18,7** | Dos firmwares, dos DFU, un protocolo entre los dos chips y dos módulos certificados. El STM32WL no puede ser el anfitrión: los módulos sacan 17–20 GPIO de los unos 39 que hacen falta. Más caro que un SX1262 suelto |
| **STM32U5 o L4 de anfitrión + BLE chico + módulo SX1262** | STM32U5 (precio **no verificado**) + Fanstel BT832 7,12 (nRF52832, DigiKey 6.190) + Ra-01SH 2,99 | **12,07 más el STM32** (su precio, **no verificado**) | El STM32 tiene USB, GPIO y AES; pero el BLE va en otro chip con su firmware (HCI o propio), el PPS y el TDMA con el BLE se coordinan entre dos chips y se pierde todo el código de NCS (MCUboot, `nrf_security`, la placa). Port **L**: unas 6–10 semanas |
| **Módulo BLE chico de coprocesador** (Raytac MDBT42Q, MDBT42T) | 4,80–5,00 (Marketplace, a 1) | — | MDBT42Q 100 y MDBT42T 30 en DigiKey Marketplace, LCSC 0: **no cumplen** stock |

**Conclusión**: con el nRF52840 en módulo a US$ 6–9, dividir no baja el costo y sube el trabajo de firmware y de certificación. Tendría sentido solo si se cortara todo el stock de nRF52840 en módulo, y hoy hay más de 10.000 en DigiKey en dos módulos distintos.

## Módulos LoRa

Todos con SX1262 (o LLCC68), SPI, BUSY y DIO1: el driver de Zephyr (`semtech,sx1262`) es el mismo; cambia el devicetree (pines de RXEN/TXEN o DIO2, tensión del TCXO por DIO3).

| Módulo | Chip · tamaño | Conmutador de RF · oscilador | US$ a 100 | Stock (09/11/2026) | Certificaciones | Qué cambia | Port | Veredicto |
|---|---|---|---|---|---|---|---|---|
| Ebyte E22-900M22S (hoy) | SX1262 · 14 × 20 × 2,8, 22 pads | RXEN y TXEN externos (TXEN desde DIO2) · TCXO por DIO3 | 5,11 | LCSC 517 (de [`stock.md`](stock.md)); relectura de la API vacía | Ebyte dice CE y FCC; FCC ID **no verificado** (el código de Ebyte es 2ALPH; no aparece el del E22-900M22S) | Nada | Ninguno | **Limitado**: una sola fuente, 3,4 veces lo necesario |
| **Ai-Thinker Ra-01SH** ([LCSC C2764087](https://www.lcsc.com/product-detail/C2764087.html)) | SX1262 · 17 × 16 × 3,2, 16 pads almenados (1 ANT … 16 GND); VDD 2,7–3,6 V | RXEN y TXEN externos, como el E22 · la hoja no dice el oscilador; lo que publica la comunidad indica **cristal común** (sin TCXO): devicetree **sin** `dio3-tcxo-voltage` | **2,99** (500: 2,81) | **LCSC 2.239**; DigiKey 0 (8 semanas) | Ai-Thinker dice CE (RED) y FCC; la hoja dice "Certificate: /": números **no verificados** | Footprint nuevo (un poco menos de área que el E22) | **S**: devicetree (RXEN, TXEN, DIO2) | **Medio**: hoja descuidada (rango de 410–525 MHz copiado, tablas del SX127x, standby de 1,6 mA y el sleep sin especificar; queda detrás de `U303`). Puerta de banco con 10 muestras antes de las 100 (ver "Presupuesto de frecuencia") |
| NiceRF LoRa1262-915TCXO ([LCSC C5356643](https://www.lcsc.com/product-detail/C5356643.html)) | SX1262 · 16 × 16 | **no verificado** · TCXO de 0,5 ppm | 7,36 (a 10) | **LCSC 1.232** | NiceRF dice FCC; número **no verificado** | Footprint nuevo | **S** (con `dio3-tcxo-voltage` si el TCXO va por DIO3, **no verificado**) | **Bajo**: el respaldo sin riesgo de frecuencia (TCXO), a +4,37 contra el Ra-01SH |
| Seeed Wio-SX1262 (114993390) | SX1262 · 12 pads | DIO2 interno (sin RXEN/TXEN) · TCXO por DIO3 | 4,86 (a 1.000) | DigiKey 7; Seeed sin cifra | CE, FCC, TELEC (números **no verificados**) | Footprint nuevo | S | No cumple stock |
| Ebyte E22-900MM22S | SX1262 · 10 × 10 | **no verificado** | **no verificado** | API de LCSC vacía | — | Footprint nuevo | S | Sin stock confirmado |
| Ebyte E220-900M22S, Ai-Thinker Ra-01SCH | **LLCC68** · cristal (no TCXO) | — | 4,19 (Ra-01SCH a 1, OpenELAB) | **no verificado** | — | Footprint nuevo | S (`semtech,llcc68`) | El LLCC68 llega a **SF5–SF9 con 125 kHz, SF5–SF10 con 250 kHz y SF5–SF11 con 500 kHz** (binding de Zephyr; la tabla de la hoja de Semtech, **no verificada**): **SF7 / 125 kHz y la rama de 500 kHz entran**. Se pierde SF10–SF12 para un alcance largo que hoy no se usa. Sin stock confirmado: no |
| HopeRF RFM95W-915 | **SX1276** | — | — | DigiKey ya no lo vende | — | Otro driver (`semtech,sx1276`) | M | La misma subida dura lo mismo en el aire (SF7 / 125 kHz), pero recibe con unos 10 mA contra unos 5 del SX1262 y no tiene SF5/6. Sin stock: no |
| RAK3172 como radio | STM32WLE5 | — | 7,80 | DigiKey 769 | FCC 2AF6B-RAK3172 | Footprint nuevo y un segundo firmware (módem) | L | No: más caro y dos firmwares |

### Presupuesto de frecuencia con un cristal común

LoRa tolera un error de frecuencia entre transmisor y receptor de unos **±25 % del ancho de banda**: con 125 kHz son **±31 kHz**, unos **±34 ppm a 915 MHz** sumando los dos lados. El gateway (SX1302) tiene TCXO, así que el cristal del pod se lleva casi todo el presupuesto:

| Cristal del pod | Error a 915 MHz | Veredicto con SF7 / 125 kHz |
|---|---|---|
| ±10 ppm | ±9 kHz | Bien |
| ±20 ppm | ±18 kHz | Bien, con margen para el gateway |
| ±30 ppm o más (con temperatura y envejecimiento) | ±27 kHz o más | Marginal |

- La rama de **500 kHz** tolera cuatro veces más: sin problema.
- Si hiciera falta, el pod puede corregir con la **baliza** del gateway: el SX126x mide el error de frecuencia de cada paquete recibido (registros FEI 0x076B–0x076D) y se compensa al transmitir (AFC por firmware).
- **Puerta de banco** antes de comprar las 100: 10 módulos a 0, 25 y 50 °C, leyendo en el gateway el error de frecuencia de cada paquete. Si alguno pasa de ±20 ppm, se cambia al **NiceRF LoRa1262-915TCXO** (respaldo sin riesgo, LCSC 1.232, +4,37 por pod) o se suma el AFC.

## Antena LoRa (no se suelda)

| Antena | Tipo · conector | US$ a 100 | Stock (09/11/2026) | Veredicto |
|---|---|---|---|---|
| Ebyte TX915-FPC-4510 (hoy) | FPC 45 × 10 · IPEX | sin precio | Sin cifra | No se puede confirmar |
| **Molex 2111400100** ([DigiKey](https://www.digikey.com/en/products/detail/molex/2111400100/9953925)) | FPC 868/915 de 38 × 10 × 0,1 mm, cable de 100 mm · U.FL (MHF1); 1,0 dBi y más de 60 % de eficiencia a 902 MHz (datos del distribuidor) | **1,96** | **DigiKey 5.706** (fábrica 13 semanas) | **La que cumple**: mismo conector, otro tamaño (ajustar el lugar en la carcasa). Depende del plano de tierra: medir la sintonía y la eficiencia dentro de la carcasa |
| Taoglas FXP890.07.0100C | FPC 860–928 compacta, 100 mm · MHF1/U.FL | 3,67 | DigiKey 197 | Segunda fuente (justo arriba de 150) |
| Taoglas FXP290.07.0100A | FPC 915, 100 mm · **MHF2** (no U.FL) | 8,39 | DigiKey 1.280 | Otro conector: no |
| Ignion NN03-310 | Chip para la placa, 400 MHz–8 GHz, con red de adaptación | 1,91 | DigiKey 53.129 | Cambia la placa: la antena LoRa pasaría a la placa, cerca del GNSS (contra la separación del ADR 0105). No para la v0 |
| Johanson 0915AT43A0026001E | Chip 902–928 | 0,67 | DigiKey 57 | No cumple stock, y el mismo problema de lugar |

## Comparación del bloque (MCU + LoRa + antena, a 100)

| Opción | Partes | US$ a 100 | Stock confirmado ≥ 150 | Certificaciones | Firmware | Riesgo de RF | Cambios de placa |
|---|---|---|---|---|---|---|---|
| Hoy | MDBT50Q-P1MV2 + E22 + TX915 | 11,11 + antena | **No** (Raytac 37, antena sin cifra) | FCC del Raytac; E22 sin ID verificado | — | Bajo | — |
| **A. Raytac por TME** | MDBT50Q-P1MV2 o -1MV2 + E22 + Molex | **13,57** (Raytac a 6,50 en TME, **no verificado**) | **Solo si TME confirma** (1.239 / 1.274 por Findchips); E22 limitado | FCC SH6MDBT50Q | Ninguno | Bajo | Ninguno |
| **B. BT840 + E22** | BT840 + E22 + Molex | **16,00** | BT840 sí (10.247); E22 limitado (517) | FCC X8WBT840F; E22 sin ID | **S** | Bajo | Footprint del MCU |
| **C. BT840 + Ra-01SH** | BT840 + Ra-01SH + Molex | **13,88** | **Sí, las tres** (DigiKey 10.247, LCSC 2.239, DigiKey 5.706) | FCC X8WBT840F, IC 4100A-BT840F; Ra-01SH FCC y CE sin número verificado | **S + S** | Bajo (MCU) · medio (LoRa) | Footprints del MCU y del LoRa |
| **D. BMD-340 + Ra-01SH** | BMD-340 + Ra-01SH + Molex | **14,55** | **Sí, las tres** (10.055, 2.239, 5.706) | FCC 2AA9B10, IC 12208A-10, CE, MIC; Ra-01SH sin número verificado | S + S | Bajo · medio | Footprints del MCU (del tamaño del Raytac) y del LoRa |
| E. Raytac por TME + Ra-01SH | MDBT50Q + Ra-01SH + Molex | **11,45** | Solo si TME confirma | FCC SH6MDBT50Q | S | Bajo · medio | Footprint del LoRa |
| F. BT840 + NiceRF LoRa1262 | BT840 + LoRa1262 + Molex | 18,25 | Sí (10.247, 1.232, 5.706) | NiceRF dice FCC | S + S | Bajo | Footprints del MCU y del LoRa |
| G. RAK4630 | RAK4630 + Molex + antena BLE | **unos 28** | **No** (100, 12 semanas) | FCC 2AF6B-RAK4630 | S | Bajo | Todo el bloque; no alcanzan los GPIO |
| H. nRF54L15 (BM15C) + Ra-01SH | BM15C + Ra-01SH + Molex | **10,90** | Sí (445, 2.239, 5.706) | FCC X8WBM15C, IC 4100A-BM15C | **M–L** y la base nueva | Bajo · medio | Todo el bloque y la base: sin USB, 32 GPIO |
| I. Dividida STM32WL + nRF52840 | Wio-E5 + BT840 + Molex | **18,00** | Sí (3.064, 10.247, 5.706) | Dos módulos certificados | **L** (dos firmwares) | Bajo | Todo el bloque |

"S" es de 1 a 3 días (devicetree y bring-up), "M" de 2 a 3 semanas, "L" más de 6 semanas. Contra hoy con la Molex (13,07): A +0,50, B +2,93, C +0,81, D +1,48, E −1,62, H −2,17.

## Recomendación

**1.ª: opción D, u-blox BMD-340 + Ai-Thinker Ra-01SH + Molex 2111400100, a US$ 14,55 por pod a 100 (+1,48 contra hoy con la Molex).**

- **Todo confirmado hoy**: las tres partes tienen stock propio de un distribuidor que PCBWay compra, con más de 10 veces lo que hace falta (DigiKey 10.055, LCSC 2.239 y DigiKey 5.706). Ninguna depende de un Marketplace, de TME sin confirmar o de una sola fuente con 3 veces lo necesario.
- **La placa no crece**: el BMD-340 mide 15,0 × 10,2 mm, casi el lugar del Raytac (10,5 × 15,5).
- **Hoja completa con los números de certificación** (FCC 2AA9B10, IC 12208A-10, CE RED, MIC R204-B00161), que es lo que pide el camino de ENACOM. Se pide la revisión de producción **BMD-340-A-R-10**.
- **Mismo SoC**: nRF52840 con los 48 GPIO y USB (pines 66–68). El firmware, NCS 3.4.1, el CryptoCell-310, MCUboot, el PPS por PPI y el presupuesto de System OFF no cambian; solo el devicetree de `pod_v0` (pines nuevos) y el bring-up. El Ra-01SH tiene RXEN y TXEN externos como el E22: el driver y la lógica del conmutador quedan iguales (sin `dio3-tcxo-voltage`).
- **El ahorro del LoRa paga más de la mitad del sobreprecio del MCU**: el Ra-01SH cuesta 2,12 menos que el E22 y el BMD-340 3,60 más que el Raytac.
- **Lo que cambia en `diseno.py`** (cuando el usuario lo decida): `NRF_PINS` pasa al pinout del BMD-340 (VCC y VCCH al riel, USB en 66–68; rayos X como hoy); `Y301` y sus capacitores quedan (el cristal de 32,768 kHz es externo); `E22_PINS` pasa a los 16 pads del Ra-01SH (1 ANT … 16 GND: ANT, GND, 3V3, RESET, TXEN, DIO1, DIO2, DIO3, GND, BUSY, RXEN, SCK, MISO, MOSI, NSS, GND); el load switch `U303`, el pull-up de NSS y el pull-down del EN quedan.
- **Antes del layout**: el keep-out de la antena del BMD-340 en su hoja, y la puerta de banco del Ra-01SH (10 muestras a 0, 25 y 50 °C con el error de frecuencia por paquete, más potencia, sensibilidad y espurias en L1 y L5). Comprar **10 BMD-340 y 10 Ra-01SH ya** (unos US$ 136).

**2.ª: opción C, Fanstel BT840 en lugar del BMD-340, a US$ 13,88** (0,67 menos). También con todo confirmado (DigiKey 10.247), con FCC X8WBT840F e IC 4100A-BT840F. La placa crece unos 53 mm², el cristal de 32,768 kHz también es externo, y el keep-out con medidas solo está publicado para el BT840F: para el BT840 hay que sacarlo del Gerber del EV-BT840 o pedirlo a Fanstel. Es la variante de corto alcance (+4,9 dBm), de sobra para pod ↔ celular.

**Respaldo del LoRa sin riesgo de frecuencia**: **NiceRF LoRa1262-915TCXO** (LCSC 1.232, +4,37 por pod), si la puerta de banco del Ra-01SH falla.

**Si TME confirma por escrito 150 Raytac en menos de 2 semanas**, la **opción E** (Raytac + Ra-01SH + Molex, **11,45**) pasa a primera: deja el footprint del MCU como está y es la más barata con módulos de nRF52840. Es un mail a TME (o un carrito en su página) antes de tocar el layout; si no responde en 48 horas, se sigue con la D. Con el E22 en lugar del Ra-01SH (opción A), solo si LCSC sigue mostrando los 517 al reservar.

**Descartadas y por qué**: el RAK4630 (sin stock, 12 semanas, el doble de precio y pocos GPIO); el nRF54L15 (sin USB y con 31–32 GPIO: rediseña la base; queda para una placa futura con el nRF54LM20, que tiene USB); las divididas con STM32 (más caras, dos firmwares y dos certificaciones); los LLCC68 y el RFM95 (sin stock confirmado, aunque el LLCC68 cumple SF7 / 125 kHz); el nRF52840 suelto (RF y certificación propios).

## Cómo actualizar

1. Releer el stock en las fuentes de arriba (DigiKey por página de producto; LCSC por la API de su página).
2. Las filas de las partes evaluadas que podrían entrar en la placa están en [`partes_pod_v0.csv`](../../../hardware/tools/datos/partes_pod_v0.csv) como alternativas (no se montan); `python3 hardware/tools/bom_pcbway.py --check` tiene que seguir en verde.
3. Si el usuario elige una opción, se cambia `diseno.py` en un PR aparte, con los pines verificados contra la hoja del módulo nuevo.
