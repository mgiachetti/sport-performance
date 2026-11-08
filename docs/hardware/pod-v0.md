# Pod v0: placa con módulos, directo a PCBWay (B-909)

Primera placa propia del pod de la Fase 3 ([ADR 0105](../adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md), [`pod-f3.md`](pod-f3.md)). No hay placa intermedia de desarrollo: la v0 ya es el pod, hecha **solo con módulos** (ningún chip de radio soldado directo) y con **lugares de rescate** (0 Ω, componentes sin montar y una antena alternativa para soldar) para corregir en la mesa lo que salga mal sin otra vuelta.

**Por qué así:** los módulos traen su RF resuelto y probado, así que el riesgo de la v0 queda en tres cosas que sí se pueden prever: la cadena de la antena GNSS, la convivencia GNSS ↔ LoRa y la asignación de pines. Cada una tiene su rescate. El nRF52840 va en un **Raytac MDBT50Q-P1MV2**, que expone sus 48 GPIO: sobran pines para buses separados y para el LED de estado.

Lo que dice "verificado" se leyó en la hoja del fabricante o en un distribuidor citado. Lo que dice "no verificado" hay que confirmarlo **antes de cerrar el esquemático** (lista al final).

## Diagrama de bloques

```mermaid
flowchart LR
  BAT[LiPo ~1000 mAh con PCM y NTC] --> CHG[BQ25180 cargador, salida SYS]
  USBC[USB-C con Rd 5,1 kΩ / pogo VBUS] --> CHG
  BAT --> BCK[LDO 3,0 V, EN desde SYS]
  BCK --> VB[V_BCKP del GNSS]
  CHG --> BB[Buck-boost 3,45 V: VREG]
  CHG --> FG[MAX17048 medidor]
  BB --> MCU[Raytac MDBT50Q-P1MV2 nRF52840]
  BB --> LORA[Ebyte E22-900M22S SX1262]
  BB --> IMU[LSM6DSV320X]
  BB --> NAND[W25N04KV NAND]
  BB --> BARO[BMP581 barómetro]
  BB --> UWB[DWM3000 sin montar, sin load switch]
  BB --> LDO[LDO bajo ruido 3,2 V fijo] --> SWG[Load switch VCC GNSS] --> GNSS[Quectel LC29H AA o EA]
  ANT1[Taoglas activa por U.FL] --> RFCH[ESD, bias-T, bloqueo DC, SAW, LNA opcional, SAW, red pi]
  ANT2[Patch SMD pasivo sin montar] --> RFCH
  RFCH --> GNSS
  GNSS <-->|UART 2,8 V con traductor| MCU
  GNSS -->|1PPS con traductor| MCU
  MCU <-->|SPIM2 8 MHz, bus propio| LORA
  MCU <-->|SPIM1 8 MHz| IMU
  MCU <-->|SPIM1| UWB
  MCU <-->|SPIM3 hasta 32 MHz| NAND
  MCU <-->|I2C| CHG
  MCU <-->|I2C| FG
  MCU <-->|I2C| BARO
  LORA --> ANTL[Antena FPC 915 MHz por U.FL, en la carcasa]
  MCU -->|USB| USBC
  MCU -->|PWM0 por NMOS| LED[LED RGB con guía de luz]
  CHG -->|SYS| LED
```

## Ubicación en la placa

Tamaño estimado: unos 45 × 65 mm (**no verificado**: sale del ruteo). Vista de arriba; con el chaleco, el borde superior queda hacia la nuca y el GNSS mira al cielo:

```text
 ┌───────────────────────────────────────────────┐
 │  (LED + guía)  ZONA GNSS (borde sup., centro)  │
 │   plano de tierra continuo en L1 y L2          │
 │   patch Taoglas pegado arriba / patch SMD      │
 │   [LC29H] [cadena RF] [LDO GNSS]               │
 │                                                │
 │ [MDBT50Q nRF52840]   [IMU al centro]   [DWM3000│
 │  antena BLE al borde [NAND] [MAX17048]  sin    │
 │  izquierdo, sin                          montar,│
 │  cobre debajo        [buck-boost]       antena │
 │                                          al    │
 │ [BQ25180] [USB-C] [pogo ×4]   [E22 LoRa] borde]│
 │                                [U.FL 915] ──►  │  antena FPC pegada en la carcasa,
 └───────────────────────────────────────────────┘  del lado opuesto al GNSS
   abajo: batería LiPo pegada, sin tapar las antenas
```

- **GNSS arriba**, en el borde superior y al centro, con el plano de tierra más grande posible debajo del patch. El patch Taoglas va pegado sobre la cara de arriba (o en la tapa de la carcasa, justo encima) y se conecta por su cable de 60 mm al U.FL.
- **LoRa en el borde opuesto** (abajo a la derecha), con el U.FL y la antena FPC lejos del GNSS. En una placa de unos 45 × 65 mm, **los ≥ 40 mm de separación entre antenas solo se logran con la FPC pegada en la carcasa**, del lado opuesto al patch.
- **Raytac MDBT50Q-P1MV2 en el borde izquierdo**, con su antena PCB en el borde y sin cobre en ninguna capa debajo ni alrededor, según la figura de la sección 7.2 de su hoja (medidas **no verificadas**, ver "Pines").
- **LED RGB en el borde superior** (la nuca, con el chaleco puesto), debajo de una **guía de luz** de la carcasa; el segundo LED, sin montar, en el borde de los pogo.
- **IMU cerca del centro**, para que las aceleraciones no sumen rotación por estar lejos del centro del pod.
- **Batería debajo**, sin tapar ninguna antena.
- **USB-C y 4 pines pogo** (VBUS, GND, D+, D−) en el borde de abajo, para la base de carga y descarga (B-907).
- **UWB sin montar** en el borde derecho, con su keep-out.
- **Barómetro junto a la ventilación de la carcasa**, en un borde lateral, lejos del buck-boost y del cargador (calientan y la presión se corrige con la temperatura) y fuera de la zona donde aprieta el chaleco. La carcasa lleva una **ventilación con membrana de ePTFE impermeable** (tipo Gore) justo encima: deja pasar la presión y no el sudor ni la lluvia. Entre la ventilación y el sensor va un **canal sellado** (junta o espuma de celda cerrada alrededor del sensor), así el barómetro mide el aire de afuera y no el volumen de adentro de la carcasa, que cambia con la temperatura y con los golpes. Sin la ventilación, la carcasa con junta mide la presión de adentro.

## Partes y alternativas

| Bloque | Elegida | Alternativa o rescate | Datos clave | Fuente | Verificado |
|---|---|---|---|---|---|
| GNSS | Quectel **LC29H(AA)** | **LC29H(EA)** en el mismo lugar (RTK en vivo) | 24 pines LCC, 12,2 × 16,0 mm. VCC 3,1–3,6 V. V_BCKP 2,2–3,6 V. **Las E/S son de 2,8 V** (VIH máx. 3,08 V; VOH mín. 2,1 V). UART hasta 921600 bps, sin control de flujo | [LC29H Series Hardware Design V1.0](https://forums.quectel.com/uploads/short-url/6AJSfkCWZOBEg7psU3USNgfcBqm.pdf), tablas 5 y 10 | Sí |
| AA ↔ EA | Mismo lugar | — | El Hardware Design trae **una sola tabla de pines para las cinco variantes** (AA, BA, CA, DA, EA). La única diferencia: los pines 2 (FWD) y 4 (WHEELTICK) son reservados en la AA y se usan en las variantes con navegación a estima | Mismo documento, figura 4 y tabla 5 | Sí, según esa versión del documento (V1.0, 2022). Confirmar con la versión vigente |
| MCU + BLE | Raytac **MDBT50Q-P1MV2** (nRF52840, 10,5 × 15,5 × 2,05 mm, antena PCB) | **MDBT50Q-U1MV2** (U.FL para antena externa) si el cuerpo tapa el BLE; MDBT50Q-1MV2 (antena chip) | 61 pads, **los 48 GPIO** (QSPI incluida). Cristal de 32 MHz y bobina del DC/DC de VDD adentro; **sin cristal de 32,768 kHz** (se monta afuera). FCC ID SH6MDBT50Q | [Hoja de Raytac Ver.K](https://cdn.sparkfun.com/assets/4/7/4/3/8/_nRF52840__MDBT50Q-1MV2___MDBT50Q-P1MV2_Ver.K_spec.pdf) · [LCSC -1MV2 C5118826](https://www.lcsc.com/product-detail/C5118826.html) · [JLC -P1MV2 C5119772](https://jlcpcb.com/partdetail/RAYTAC-MDBT50QP1MV2/C5119772) · [fcc.report](https://fcc.report/FCC-ID/SH6MDBT50Q/3937502.pdf) | Pines, cristales y DC/DC sí (hoja). Medidas del keep-out, que el FCC ID cubra la -P1MV2, CE/IC y el footprint de la -U1MV2, **no verificados** |
| LoRa | Ebyte **E22-900M22S** (SX1262, 14 × 20 mm) | — | RXEN pin 6 y TXEN pin 7 (activos en alto; TXEN puede ir a DIO2), DIO1 pin 13, BUSY pin 14. DIO2 pin 8, VCC pin 9 y NRST pin 15 según un foro | [Manual del E22-900M22S](https://hubtronics.in/docs/E22-900M22S.pdf) (no se pudo descargar; datos del índice de búsqueda) · [foro de Mischianti](https://mischianti.org/forums/topic/e22-900m22s-wiring-dio1-dio2-and-busy/) | Parcial: RXEN, TXEN, DIO1 y BUSY sí; DIO2, VCC, NRST, los pines SPI, el rango de VCC y el TCXO, **no verificados** |
| MCU + LoRa juntos | — | **RAK4630 no es alternativa en la v0**: integra nRF52840 + SX1262 en otro encapsulado y otros pines, no entra en el lugar del MDBT50Q ni del E22. Haría falta su propio lugar y no hay espacio | — | — | — |
| Cristal de 32,768 kHz | Montado en XL1/XL2 | Sin montar, con el RC calibrado del nRF | Mejor reloj de baja frecuencia para BLE y menos consumo que calibrar el RC | — | Parte **no verificada** |
| LED de estado | **XINGLIGHT XL-1615RGBC-RF** (RGB, 1,6 × 1,5 mm, ánodo común), 3 NMOS de nivel lógico y 3 resistencias 0402 | Segundo LED igual, sin montar; ánodo desde VREG por 0 Ω | Ánodo desde SYS; PWM0 en P0.27, P0.05 y P1.08 (ver "LED de estado") | [LCSC C965840](https://www.lcsc.com/product-detail/C965840.html) | Precio sí (LCSC). Ánodo común, caídas por color, NMOS y resistencias, **no verificados** |
| Buzzer | Sin montar: buzzer SMD con NMOS en P0.11 (PWM1) | — | Para "buscar mi pod" con sonido; opcional | — | Parte **no verificada** |
| IMU | **LSM6DSV320X** (LGA-14, 3 × 2,5 mm) | **ICM-42688-P + ADXL372** en lugares propios sin montar (mismo bus, otros CS) | VDD 1,71–3,6 V; VDDIO hasta 3,6 V con SPI. INT1 pin 4, INT2 pin 9, VDD pin 8, VDDIO pin 5 | [RS](https://my.rs-online.com/web/p/motion-sensor-ics/0396400) · [Future Electronics](https://www.futureelectronics.com/resources/featured-products/stmicroelectronics-lsm6dsv320x-6-axis-inertial-measurement-unit) | Parcial: datos de distribuidores; la hoja de ST, **no verificada** |
| Memoria | **W25N04KV** (4 Gbit) | **W25N02KV** (2 Gbit) en el mismo lugar | Los dos: WSON-8 de 8 × 6 mm, 2,7–3,6 V | [DigiKey W25N04KVZEIR](https://www.digikey.fi/en/products/detail/winbond-electronics/W25N04KVZEIR/15182086) · [DigiKey W25N02KVZEIR](https://www.digikey.ie/en/products/detail/winbond-electronics/W25N02KVZEIR/14560446) | Encapsulado y tensión sí. Que los pines sean idénticos, **no verificado** (es el patrón estándar de Winbond) |
| Cargador | **BQ25180** (I2C, salida SYS, modo envío) | — | DSBGA de 8 bolas, 1,6 × 1,1 mm: A1 /INT, A2 IN, B1 SCL, B2 SYS, C1 SDA, C2 BAT, **D1 TS/MR** (NTC y reset manual en el mismo pin), D2 GND | [Hoja de TI (pines TS/MR)](https://ti.com/document-viewer/ja-jp/BQ25180/datasheet/GUID-56076AC1-C090-40FA-9076-7A93BDD85026) · [mapa de bolas en Flux](https://www.flux.ai/adrian95/bq25180ybgr~vng.md) · [LCSC](https://www.lcsc.com/product-detail/C3682423.html) | TS/MR y encapsulado sí (TI). El resto del mapa, de una librería de terceros. Si /INT es de drenador abierto y la dirección I2C (se cita 0x6A), **no verificados** |
| Batería | LiPo de ~1000 mAh **con PCM** (protección de sobrecarga, sobredescarga y cortocircuito) y **NTC de 10 kΩ en la celda** | — | Conector de 3 vías (BAT, GND, NTC) al TS/MR del BQ25180 | — | El conector y la celda, **no verificados** |
| Medidor de carga | **MAX17048** (I2C, ALRT de drenador abierto) | Divisor de tensión al AIN4 del nRF, sin montar | Dirección I2C citada 0x36 | [LCSC](https://lcsc.com/product-detail/image/MAX17048G-T10_C2682616.html) | Dirección, **no verificada** |
| Barómetro | **Bosch BMP581** (LGA de 10 pines, 2 × 2 mm) | **Infineon DPS368** en su propio lugar, sin montar (otra dirección I2C, encapsulado resistente al agua); BMP390 como segunda opción | I2C en el bus del cargador y del medidor: dirección **0x47** con SDO a VDDIO o 0x46 con SDO a GND, sin choque con 0x36 ni 0x6A. **VDD y VDDIO son pines separados**, los dos a VREG. **CSB atado a VDDIO**: si está en bajo al encender, el sensor queda en SPI o I3C. INT configurada de **drenador abierto, activa en bajo** (registro INT_CONFIG). VDD 1,71–3,6 V (1,65 V según otra fuente): VREG de 3,45 V entra. Ruido de menos de 0,1 Pa en alta resolución (1 Pa ≈ 8 cm de altura); hasta 480 Hz en modo continuo según una hoja preliminar. US$ 1,23 en LCSC; el DPS368, US$ 2,59 | [LCSC C5362283](https://www.lcsc.com/product-image/C5362283.html) · [DFRobot BMP581](https://wiki.dfrobot.com/SKU_SEN0667_Fermion:_BMP581_Barometric_Pressure_Sensor) · [Zephyr bosch,bmp581](https://docs.zephyrproject.org/latest/build/dts/api/bindings/sensor/bosch%2Cbmp581-i3c.html) · [LCSC DPS368 C3232508](https://www.lcsc.com/product-image/C3232508.html) · [LCSC BMP390 C5124834](https://www.lcsc.com/product-detail/C5124834.html) | Dirección, rango de tensión, VDDIO separado, CSB en alto para I2C e INT de drenador abierto: de distribuidores, de una hoja preliminar y de conocimiento general del sensor; la hoja vigente de Bosch, **no verificada** |
| Riel del sistema (VREG) | **Buck-boost a 3,45 V** desde SYS (candidatos: TPS63802, TPS63900) | 0 Ω para probar otro punto de ajuste | Alimenta nRF, E22, IMU, NAND y UWB (todos con máximo de 3,6 V) y el LDO del GNSS. La LiPo baja de 3,45 V antes de vaciarse, por eso buck-boost. Precisión del punto de ajuste de ±1,5 % o mejor (3,40–3,50 V) y sobrepico acotado ante el escalón de unos 120 mA de una TX de LoRa. El TPS63802 se ajusta con divisor; el TPS63900 usa niveles fijos por resistencia, y que tenga 3,45 V está por confirmar | — | Parte **no verificada** |
| 3,2 V del GNSS | **LDO de bajo ruido fijo a 3,2 V** desde VREG (candidatos: TPS7A20, TLV757P), siempre habilitado | 0 Ω para tomar el GNSS directo de VREG (3,45 V, dentro de 3,1–3,6 V) | **3,2 V y no 3,3 V**: desde 3,45 V, un LDO de 3,3 V tendría unos 30 mV de margen en el peor caso, y cerca del dropout su rechazo de ruido (PSRR) se cae. Con ±1,5 %, el piso es 3,15 V, por encima del mínimo de 3,1 V del LC29H. El LDO no se apaga: lo que se corta es VCC, con un load switch después del LDO | Hardware Design, sección 3.2.1 | Parte **no verificada** |
| V_BCKP | **LDO de 3,0 V de consumo ultrabajo desde BAT** (candidato: TPS7A02), con **EN desde SYS por un divisor** | 0 Ω para alimentar V_BCKP desde VREG. 0 Ω para atar EN a BAT | Nunca alimentado desde SYS (4,4–4,6 V con USB conectado, más que el máximo de 3,6 V); SYS solo maneja el EN. Se mantiene con el pod apagado y **se corta en modo envío** (sin SYS): así el modo envío no gasta el consumo propio del LDO ni el de backup del LC29H. A cambio, después de un envío o un almacenamiento en modo envío se pierde el arranque en caliente. Con el EN atado a BAT, V_BCKP sigue en modo envío y descarga la batería | Hardware Design, sección 3.2.2 y tabla 10 | Rango sí. Parte **no verificada** |
| Load switch | VCC del GNSS (candidato: TPS22916) | 0 Ω de puente | El UWB **no** lleva load switch: comparte el SPIM1 con la IMU, y apagarlo lo alimentaría por los pines del bus. Queda en VREG y se duerme por software | — | Parte **no verificada** |
| Traductor de niveles | 3,45 V ↔ 2,8 V para TXD, RXD y 1PPS del GNSS (candidatos: 3 × SN74LVC1T45 de dirección fija, con el lado de 2,8 V desde VDD_EXT) | 0 Ω de puente en cada línea, sin montar | El nRF lee "alto" desde 0,7 × VDD y el GNSS da 2,1 V mínimo: **sin traductor no es confiable**. Al revés, 3,45 V supera el VIH máximo del GNSS (3,08 V). VDD_EXT solo existe con el GNSS encendido: el traductor tiene que aislar con un lado apagado | Hardware Design, tabla 10 y nota de la sección 4.1.1 | El problema, sí. Las partes y su aislamiento, **no verificados** |
| RESET del GNSS | NPN o NMOS en drenador abierto, como recomienda Quectel | — | RESET_N bajo ≤ 0,1 V, al menos 100 ms | Hardware Design, sección 4.2.2 y tabla 10 | Sí |
| USB-C | Receptáculo de 16 pines, solo USB 2.0 | — | **Rd de 5,1 kΩ a GND en CC1 y en CC2** (requisito de USB Type-C para que un cargador entregue VBUS) | — | Requisito estándar. Parte **no verificada** |
| ESD | TVS en USB, pines pogo y entrada RF del GNSS (≤ 0,6 pF en RF) | — | — | Hardware Design, sección 5.1.3 (RF) | RF sí. USB y pogo, partes **no verificadas** |
| Antena GNSS | **Taoglas AGVLB.25B.07.0060A**: patch activo L1/L5 de 25 × 25 mm, con cable de 60 mm y conector I-PEX MHF1 | **Patch SMD pasivo de doble banda** soldado en la placa (por ejemplo Pulse ANT1825JB01BGNL5A), sin montar | Alimentación de la antena activa desde VDD_RF (= VCC) | [DigiKey Taoglas](https://www.digikey.ie/en/products/detail/taoglas-limited/AGVLB-25B-07-0060A/21777673) · [LCSC Pulse C3284896](https://www.lcsc.com/product-detail/C3284896.html) | Conector y cable sí. Tensión de la Taoglas, que tenga SAW, y si el patch Pulse es activo o pasivo y sus dimensiones, **no verificados** |
| Cadena RF del GNSS | Ver "Cadena RF del GNSS" abajo | — | SAW y LNA tienen que ser **de doble banda L1 + L5** | Hardware Design, figura 15 y sección 5.1.3 | Esquema de Quectel sí. Partes de SAW y LNA, **no verificadas** |
| Antena LoRa | FPC de 915 MHz por U.FL, pegada en la carcasa | Lugar para SMA de borde o antena chip, sin montar | — | [Core Electronics](https://core-electronics.com.au/915mhz-ufl-antenna.html) | Si el E22-900M22S trae U.FL propio o solo pad, **no verificado** |
| UWB | **Módulo DWM3000** sin montar (23 × 13 mm, 24 pines, antena integrada) | — | ≤ 3,6 V. El chip DW3110/QM33 soldado directo queda para la serie (B-911) | [Hoja breve del DWM3000](https://www.mouser.com/datasheet/2/412/DWM3000_Data_Sheet_Brief-2399958.pdf) | Tamaño sí. Pines (IRQ, RSTn, WAKEUP, EXTON) y rango de tensión, **no verificados** |
| USB-serie para el GNSS | Puente USB-UART sin montar (candidatos: CP2102N, CH9102) con VIO a 2,8 V desde VDD_EXT del LC29H | — | Para hablar directo con el módulo desde QGNSS | — | **No verificado** |

### Cadena RF del GNSS

En orden, desde la antena hasta el módulo:

1. **Selector de antena**: U.FL de la Taoglas (activa) o patch SMD pasivo, con un 0 Ω o un capacitor que se gira.
2. **ESD** (≤ 0,6 pF) en el nodo de la antena.
3. **Bias-T del lado de la antena**: L ≥ 68 nH desde VDD_RF, con R de 10 Ω de protección y capacitores de 100 pF y 100 nF. Control por ANT_ON con dos transistores, o siempre encendida con un 0 Ω (Hardware Design, figura 15). **Elegir el patch pasivo abre el bias** (se saca el 0 Ω de alimentación): un pasivo no se alimenta.
4. **Bloqueo de DC** (100 pF) antes del resto: SAW y LNA no ven la tensión de la antena.
5. **SAW L1 + L5** con 0 Ω de puente.
6. **LNA L1 + L5 opcional, sin montar con la Taoglas** (que ya trae su LNA: dos ganancias en cascada saturan el módulo). Se monta solo con el patch pasivo. Puente de 0 Ω, con sus bloqueos de DC de entrada y salida según su hoja.
7. **SAW L1 + L5** con 0 Ω de puente.
8. **Red pi** en RF_IN: 0 Ω y dos capacitores sin montar, como en la referencia de Quectel.
9. **RF_IN** del LC29H (pin 11).

## Pines del nRF52840 (Raytac MDBT50Q-P1MV2)

**El módulo** ([hoja de Raytac, Ver.K](https://cdn.sparkfun.com/assets/4/7/4/3/8/_nRF52840__MDBT50Q-1MV2___MDBT50Q-P1MV2_Ver.K_spec.pdf), secciones 2.5, 2.6, 3 y 8):

- **Expone los 48 GPIO del nRF52840** en 61 pads (sección 2.5), incluidos P0.19, P0.21 y P0.23, que el E73 no sacaba: la QSPI queda disponible.
- **Trae adentro el cristal de 32 MHz y la bobina del DC/DC de VDD (Reg1)** (sección 3). **No trae el cristal de 32,768 kHz**: XL1/XL2 (P0.00/P0.01, pads 17/18) salen a pads.
- **Alimentación**: el DC/DC de VDDH (Reg0) se recomienda solo con entrada de 3,6 V o más (sección 8.1). Con VREG de 3,45 V va el **modo de tensión normal**: VDD (pad 28) y VDDH (pad 30) juntos a VREG, Reg1 con el DC/DC habilitado y **DCCH (pad 31) sin conectar**. VBUS (pad 32) al USB.
- **USB**: D− pad 34, D+ pad 35. Con el USB deshabilitado, D± quedan sin conectar (sección 8.5).
- **Reset y depuración**: P0.18 (pad 40) es nRESET. SWDIO pad 51, SWDCLK pad 53.
- **Masa**: pads 1, 2, 15, 33 y 55.
- **Antena PCB (-P1MV2) al borde**, sin cobre en ninguna capa debajo ni alrededor según la figura de la sección 7.2 (la figura es una imagen: sus medidas, **no verificadas** hasta leerla en la hoja impresa). La **-U1MV2** (con U.FL para antena externa) es el rescate si el cuerpo tapa demasiado el BLE en el chaleco; que tenga el mismo footprint, **no verificado**.
- **Certificaciones**: la hoja trae una sección de certificado FCC (9.2, "BLE 1 Mbps y 2 Mbps, IEEE 802.15.4 aprobados"); el FCC ID **SH6MDBT50Q** aparece en [fcc.report](https://fcc.report/FCC-ID/SH6MDBT50Q/3937502.pdf). Que cubra la variante -P1MV2, y CE, IC u otras, **no verificados** (están en páginas de imagen de la hoja). Para Argentina vale lo de ENACOM (ADR 0105): se homologa el equipo final.
- **Tamaño y precio**: 10,5 × 15,5 × 2,05 mm, 0,64 g la -P1MV2. La -1MV2 (antena chip) está en LCSC desde US$ 6,65 ([C5118826](https://www.lcsc.com/product-detail/C5118826.html)); la -P1MV2 en JLC ([C5119772](https://jlcpcb.com/partdetail/RAYTAC-MDBT50QP1MV2/C5119772)), con precio **no verificado**. SparkFun la vende a US$ 8,50 desde 25 unidades ([SparkFun](https://www.sparkfun.com/nordic-nrf52840-ble-module-mdbt50q-1mv2.html)).

**Restricciones del nRF52840:**

- **Pines solo de baja frecuencia** (hasta unos 10 kHz; la hoja de Raytac aclara que SPI, I2C, UART y **PWM no son** baja frecuencia, sección 2.6). Según el [Product Specification del nRF52840](https://docs.nordicsemi.com/r/bundle/ps_nrf52840/page/pin.html) y la tabla de Raytac: **P0.02, P0.03, P0.28–P0.31, P1.01–P1.07 y P1.10–P1.15**, más los de NFC (P0.09, P0.10). Ahí van solo interrupciones, enables, reset, ADC, PPS y botón.
- **Conteo**: 48 GPIO = **24 rápidos**, **19 de baja frecuencia**, **2 de NFC**, **2 del cristal** (XL1/XL2) y **P0.18** (reset).
- **Instancias serie**: la 0 se usa como **TWIM0** (I2C), así que quedan **SPIM1, SPIM2 y SPIM3** para SPI, más **UARTE0 y UARTE1**. El PWM (PWM0) es un periférico aparte.
- **SPIM3** llega a 32 MHz; SPIM0–2 a 8 MHz. Erratas que aplican ([registro de erratas del nRF52840](https://infocenter.nordicsemi.com/topic/errata_nRF52840_Rev1/ERR/nRF52840/Rev1/latest/err_840_changelog.html)):
  - **198, datos de TX corruptos:** los buffers del SPIM3 van en un **bloque de RAM propio**, que ningún otro maestro del bus toque durante la transferencia.
  - **195, sigue consumiendo después de deshabilitarlo:** aplicar el workaround al parar el SPIM3 y medir la corriente en reposo (hay reportes de que no alcanza, [foro de Nordic](https://devzone.nordicsemi.com/f/nordic-q-a/122946/spim3-draws-higher-current-even-with-errata-workaround/542525)).
  - A 32 MHz: pines con **alta corriente de salida (H0H1)** y ajustar **RXDELAY**.
- **UART del GNSS**: con el registro estándar, 921600 bps da en realidad unos 941176 bps (≈ 2 % arriba, [foro de Nordic](https://devzone.nordicsemi.com/f/nordic-q-a/43280/technical-question-regarding-uart-baud-rate-generator-baudrate-register-offset-0x524/557385)). Se usa un valor propio de BAUDRATE (el foro da 0x0EBEE000 para el nRF52832; para el nRF52840, **no verificado**) o se mide el margen en el banco; si no alcanza, 460800 bps.

**¿NAND por QSPI o por SPIM3? SPIM3.** El periférico QSPI del nRF52840 está hecho para memorias NOR: lectura y escritura con códigos y direcciones de 24 o 32 bits fijos, e instrucciones propias de hasta 8 bytes de datos. La W25N es NAND por SPI: cada lectura es "página a la caché" (0x13) y después "leer de la caché" con una dirección de columna de 16 bits y un byte de espera; cada escritura es "cargar la caché" (0x02, columna de 16 bits) y después "ejecutar el programa" (0x10). Eso no entra en las operaciones del QSPI sin trucos frágiles, y no hay driver de Zephyr para NAND por la QSPI del nRF. **SPIM3 a 32 MHz** da unos 3–4 MB/s, de sobra para registrar unos 4,5 kB/s y para descargar por USB (unos 1 MB/s). Igual la NAND va en los **pines recomendados de QSPI** (P0.17, P0.19, P0.20, P0.21), que son de alta velocidad y dejan abierta una memoria QSPI en una placa futura. **Rescate**: SPIM3 a 8 MHz si las erratas molestan, que también alcanza.

**Asignación:**

| Señal | Pin nRF | Pad del módulo | Tipo de pin | Periférico | A dónde va | Nota |
|---|---|---|---|---|---|---|
| NAND_CS | P0.17 | 41 | Rápido | SPIM3 | W25N /CS | Bus propio de la NAND |
| NAND_SCK | P0.19 | 42 | Rápido | SPIM3 | W25N CLK | Hasta 32 MHz; resistencia serie de 22–33 Ω sin ajustar |
| NAND_MOSI | P0.20 | 44 | Rápido | SPIM3 | W25N DI | |
| NAND_MISO | P0.21 | 43 | Rápido | SPIM3 | W25N DO | /WP y /HOLD a VREG con 10 kΩ |
| LORA_SCK | P0.24 | 48 | Rápido | SPIM2 | E22 SCK | **Bus propio del LoRa**, 8 MHz |
| LORA_MOSI | P0.25 | 49 | Rápido | SPIM2 | E22 MOSI | |
| LORA_MISO | P1.00 | 47 | Rápido | SPIM2 | E22 MISO | |
| LORA_NSS | P0.16 | 38 | Rápido | GPIO | E22 NSS | |
| SENS_SCK | P0.14 | 36 | Rápido | SPIM1 | LSM6DSV320X, DWM3000 (+ ICM-42688-P y ADXL372 sin montar) | Bus de sensores, 8 MHz |
| SENS_MOSI | P0.13 | 37 | Rápido | SPIM1 | idem | |
| SENS_MISO | P0.15 | 39 | Rápido | SPIM1 | idem | |
| IMU_CS | P1.09 | 26 | Rápido | GPIO | LSM6DSV320X CS (o ICM-42688-P con 0 Ω) | |
| HG_CS | P0.26 | 19 | Rápido | GPIO | ADXL372 CS, sin montar | Libre si el ADXL372 no va |
| UWB_CS | P0.04 | 20 | Rápido | GPIO | DWM3000 SPICSn, sin montar | Libre si el UWB no va |
| GNSS_TX (MCU → GNSS RXD) | P0.06 | 22 | Rápido | UARTE0 | traductor → LC29H RXD (pin 21) | Configuración y RTCM para la EA |
| GNSS_RX (GNSS TXD → MCU) | P0.08 | 24 | Rápido | UARTE0 | LC29H TXD (pin 20) → traductor | NMEA o binario a 10 Hz |
| DBG_TX | P0.22 | 46 | Rápido | UARTE1 | Pad de consola | Consola serie de respaldo; la principal va por RTT |
| DBG_RX | P0.23 | 45 | Rápido | UARTE1 | Pad de consola | |
| I2C_SDA | P0.12 | 29 | Rápido | TWIM0 | BQ25180, MAX17048, BMP581, DPS368 (sin montar) | Pull-ups de 4,7 kΩ |
| I2C_SCL | P0.07 | 23 | Rápido | TWIM0 | idem | |
| LED_R | P0.27 | 16 | Rápido | PWM0 canal 0 | Gate del NMOS del rojo | El PWM no puede ir en pines de baja frecuencia |
| LED_G | P0.05 | 21 | Rápido | PWM0 canal 1 | Gate del NMOS del verde | |
| LED_B | P1.08 | 25 | Rápido | PWM0 canal 2 | Gate del NMOS del azul | |
| BUZZER | P0.11 | 27 | Rápido | PWM1 | Gate del NMOS del buzzer, sin montar | Libre si el buzzer no va |
| GNSS_PPS | P1.10 | 3 | Baja frec. | GPIOTE → PPI → TIMER | LC29H 1PPS (pin 3) → traductor | 1 Hz; captura del timer por PPI (ver notas) |
| CHG_INT | P1.11 | 4 | Baja frec. | GPIO (entrada) | /INT del BQ25180 (A1) | Pin propio |
| BARO_INT | P1.12 | 5 | Baja frec. | GPIOTE | INT del BMP581 (o del DPS368 con 0 Ω) | Pin propio: ya no se comparte |
| GNSS_EN | P1.13 | 6 | Baja frec. | GPIO | Load switch del VCC del GNSS | El LDO queda siempre habilitado |
| FG_ALRT | P1.14 | 7 | Baja frec. | GPIO (entrada) | /ALRT del MAX17048 | Pin propio |
| BOTÓN | P1.15 | 8 | Baja frec. | GPIO | Botón a GND (y al TS/MR del BQ25180 por diodo, sin montar) | |
| GNSS_RST | P0.03 | 9 | Baja frec. | GPIO | NPN/NMOS → LC29H RESET_N (pin 8) | |
| LORA_DIO1 | P0.29 | 10 | Baja frec. | GPIOTE | E22 DIO1 (pin 13) | Interrupción de fin de TX/RX |
| LORA_BUSY | P0.02 | 11 | Baja frec. | GPIO (entrada) | E22 BUSY (pin 14) | |
| LORA_NRST | P0.31 | 12 | Baja frec. | GPIO | E22 NRST | |
| VBAT_ADC | P0.28 | 13 | Baja frec. | AIN4 | Divisor de la batería, sin montar | Rescate si falla el MAX17048 |
| LORA_RXEN | P0.30 | 14 | Baja frec. | GPIO | E22 RXEN (pin 6) | TXEN (pin 7) va a DIO2 (pin 8) por 0 Ω, como sugiere Ebyte |
| UWB_IRQ | P1.02 | 50 | Baja frec. | GPIOTE | DWM3000 IRQ, sin montar | Libre si el UWB no va |
| IMU_INT1 | P1.04 | 56 | Baja frec. | GPIOTE | LSM6DSV320X INT1 | |
| IMU_INT2 | P1.06 | 57 | Baja frec. | GPIOTE | LSM6DSV320X INT2 | |
| UWB_RST | P1.07 | 58 | Baja frec. | GPIO (drenador abierto) | DWM3000 RSTn, sin montar | Que RSTn no se maneje en alto, **no verificado** |
| UWB_WAKEUP | P1.05 | 59 | Baja frec. | GPIO | DWM3000 WAKEUP, sin montar | |
| HG_INT | P1.03 | 60 | Baja frec. | GPIOTE | ADXL372 INT1, sin montar | Libre si el ADXL372 no va |
| GNSS_WAKEUP | P1.01 | 61 | Baja frec. | GPIO | LC29H WAKEUP (pin 1) por 0 Ω, sin montar | Su nivel alto es de 3,0–3,6 V: VREG entra |
| XL1 / XL2 | P0.00 / P0.01 | 17 / 18 | Cristal | LFXO | **Cristal de 32,768 kHz montado** | Mejor reloj de baja frecuencia para BLE y menos consumo que el RC calibrado |
| NFC1 / NFC2 | P0.09 / P0.10 | 52 / 54 | NFC | — | Sin usar, sin liberar en la UICR | Libres |
| USB D+ / D− / VBUS | — | 35 / 34 / 32 | — | USBD | USB-C y pogo, con 0 Ω para pasar D± al puente USB-UART del GNSS | |
| SWDIO / SWDCLK / nRESET | — | 51 / 53 / 40 | — | SWD | Tag-Connect + pads | La consola principal va por RTT |

**Margen de pines:** la v0 usa **46 de los 48** (contando XL1/XL2 con el cristal y P0.18 como reset). **Libres sin condiciones: P0.09 y P0.10** (NFC, baja frecuencia). **Libres según cómo se arme:** P0.11 sin buzzer; P1.01 sin el WAKEUP del GNSS; P0.26 y P1.03 sin ADXL372; P0.04, P1.02, P1.05 y P1.07 sin UWB. Los **rápidos libres** son pocos (P0.11 sin buzzer, P0.26 y P0.04 sin ADXL ni UWB): si hace falta otro bus, se sacan de ahí.

**Notas para el firmware:**
- **PPS por PPI**: el flanco del PPS en P1.10 dispara un evento de GPIOTE que, por PPI, captura un TIMER que corre con el reloj de 32 MHz del cristal del módulo, sin pasar por la CPU. Con eso cada segundo se conoce el desvío del reloj del nRF contra el GNSS, y de ahí salen los turnos de LoRa (ADR 0105) y la hora de las muestras de la IMU y el barómetro. Bajo techo, la misma captura toma la baliza del gateway (B-911).
- **LED por PWM0** (tres canales): patrones y brillo por software (tabla del LED más abajo). El brillo y el apagado durante el juego son configuración del club.
- Con TXEN en DIO2, el firmware pone **RXEN en bajo antes de transmitir** y en alto para recibir.
- Si el E22 usa TCXO, se configura con `SetDIO3AsTCXOCtrl` (tensión y tiempo según el módulo, **no verificados**).
- Cada bus SPI con su modo y velocidad por CS (el de sensores comparte LSM6DSV320X y DWM3000).
- Direcciones I2C citadas: MAX17048 0x36, BQ25180 0x6A, BMP581 0x47 (todas **no verificadas** contra la hoja del fabricante).
- **Barómetro**: a 25–50 Hz, con el sobremuestreo y el filtro IIR que dejen el ruido en unos pocos cm sin agregar retardo que borre un salto (el compromiso entre tasa y ruido sale del banco). La altura se calcula **fusionando barómetro e IMU** (filtro complementario o de Kalman): el barómetro fija la altura lenta y la aceleración vertical sigue lo rápido. Usos: levantada en el line, saltos, y apoyo a `time_to_feet_s` (el pod pasa de unos 1,3 m de pie a unos 0,2 m en el suelo). Una métrica nueva (por ejemplo `lineout_lift_m` o `jump_height_cm`) **no se agrega todavía**: se define con el club en el diccionario de métricas, con código, unidad y definición.
- El DWM3000 queda siempre alimentado desde VREG: en las placas que lo tienen, el firmware lo pone en **DEEPSLEEP** al arrancar y entre usos.

## LED de estado

Un **LED RGB discreto** que da devolución sin abrir la app: en la base, al arrancar, antes de entrar a la cancha y para encontrar un pod.

- **Parte**: XINGLIGHT **XL-1615RGBC-RF** (1,6 × 1,5 mm, ánodo común según LCSC, US$ 0,012–0,016) ([LCSC C965840](https://www.lcsc.com/product-detail/C965840.html)). Que sea de ánodo común y su caída por color, **no verificados** contra la hoja.
- **Excitación**: ánodo común desde **SYS** (3,4–4,6 V) y cada cátodo por su **resistencia 0402** a un **NMOS de nivel lógico** (Vgs(th) de alrededor de 1 V) manejado por un canal de PWM. **Por qué no directo del nRF desde VREG**: con 3,45 V, el azul y el verde (caída de unos 2,8–3,2 V) quedan casi sin margen y su brillo cambiaría con cada placa; con SYS hay margen y los pines del nRF nunca ven una tensión mayor a VREG. Con batería muy baja el azul brilla menos: por eso el aviso de batería baja es rojo.
- **Brillo**: las resistencias se ajustan en el banco (empezar por unos 1 kΩ, **no verificado**) para unos 1–2 mA por color; el PWM baja el resto. Consumo despreciable frente al GNSS.
- **Guía de luz** (light pipe) en el **borde de la nuca** (el borde superior con el chaleco puesto), para que se vea por encima del chaleco sin abrir la carcasa. La carcasa (B-909) lleva el agujero y la guía.
- **Rescates**: 0 Ω para tomar el ánodo de VREG en lugar de SYS; un **segundo LED sin montar** en paralelo, en el borde de los pogo, para verlo con el pod en la base; un **buzzer SMD sin montar** con su NMOS en P0.11, para "buscar mi pod" con sonido.

**Estados** (siempre **color + patrón**, nunca solo color, para que se distingan también con daltonismo):

| Estado | Color | Patrón |
|---|---|---|
| Arranque y autotest | Blanco (R + G + B) | Fijo 1 s |
| Error de un periférico en el autotest | Rojo | N destellos, pausa, se repite (N = periférico) |
| Buscando posición GNSS | Amarillo (R + G) | Parpadeo lento, 1 Hz |
| Listo: posición GNSS y enlace con el gateway | Verde | Destello corto cada 3 s |
| Grabando sesión | Verde | Destello corto cada 5 s, o **apagado** si el club elige el modo partido |
| Grabando sin enlace con el gateway | Azul | Doble destello cada 5 s |
| Batería baja (< 20 %) | Rojo | Destello cada 5 s |
| Batería crítica (< 5 %) | Rojo | Parpadeo rápido 5 s y se apaga |
| En la base: cargando | Ámbar (R + poco G) | Fijo tenue |
| En la base: carga completa | Verde | Fijo tenue |
| En la base: descargando datos | Azul | "Respira" (sube y baja) |
| En la base: error de descarga | Rojo | Fijo |
| Actualización de firmware (DFU) | Violeta (R + B) | "Respira" |
| "Buscar mi pod" (desde la app por BLE) | Blanco | Parpadeo rápido, más el buzzer si está montado |

- **Modo partido** (configuración del club): durante la sesión, el LED se apaga o queda al mínimo, para no distraer ni encandilar; los estados de error y de batería crítica se pueden dejar visibles.
- Los porcentajes de batería y los tiempos son valores de partida: se ajustan con el firmware (B-904).

## Pines del LC29H y modo envío

**Pines del LC29H** (de la tabla 5 del Hardware Design): WAKEUP 1, FWD 2, 1PPS 3, WHEELTICK 4, reservados 5–6, VDD_EXT 7 (salida 2,8 V, 100 mA), RESET_N 8, VDD_RF 9, GND 10, RF_IN 11, GND 12–13, ANT_ON 14, reservados 15–17, I2C_SDA 18, I2C_SCL 19, TXD 20, RXD 21, V_BCKP 22, VCC 23, GND 24.

- **WAKEUP** queda sin conectar (el datasheet lo permite si no se usa el modo backup), con un 0 Ω sin montar a un pad. Si se conecta, su nivel alto es de 3,0–3,6 V, no de 2,8 V.
- **V_BCKP** desde su LDO de 3,0 V, encendido mientras haya SYS (ver la tabla), para el arranque en caliente.
- **VDD_EXT** (solo con el GNSS encendido) alimenta el lado de 2,8 V del traductor y el VIO del puente USB-UART.
- **I2C del LC29H** queda a un pad, sin conectar al bus del nRF (otro nivel).

**Modo envío y botón:** el BQ25180 entra en modo envío por I2C. Sin SYS, el divisor apaga el LDO de V_BCKP: el pod queda con consumo mínimo y pierde el arranque en caliente del GNSS. Sale **al conectar VBUS** (la base o el USB), que es lo normal en el club, o con un **reset manual en TS/MR**: el botón llega a TS/MR por un diodo, sin montar. Riesgos si se monta: cada toque pausa la carga, una pulsación larga puede disparar el reset por hardware del BQ25180, y el diodo tiene que tener fuga inversa baja y caída directa menor que el umbral bajo de MR (no un BAS16 sin revisarlo). Que el NTC y el botón convivan en ese pin, **no verificado**.

**¿El LC29H entra en el lugar de un NEO de u-blox?** Los dos miden 12,2 × 16 mm y la disposición se parece (RESET_N 8, RF_IN 11, GND 10/12/13, UART en 20/21, V_BCKP 22, VCC 23), pero hay diferencias que impiden un lugar doble sin cambios: el pin 7 es VDD_EXT (salida) en el LC29H y reservado en el NEO-F10N; el 14 es ANT_ON en el LC29H y LNA_EN en el F10N; y las E/S del LC29H son de 2,8 V, mientras que en el F10N siguen a VCC ([manual de integración del NEO-F10N](https://manualshive.com/en/manual/ublox/neo-f10n/4488978?page=37), copia de terceros). La compatibilidad pin a pin está **no verificada**: la v0 no la usa.

## Reglas de diseño

- **4 capas en PCBWay con impedancia controlada**: L1 señales y RF, L2 tierra continua, L3 alimentación y señales lentas, L4 señales y tierra. El ancho de la línea de 50 Ω (coplanar con tierra, referida a L2) sale de la calculadora de PCBWay con su apilado real (**no verificado**; con un dieléctrico de unos 0,2 mm suele dar una pista de unos 0,3 mm con separación de 0,15–0,2 mm).
- **RF del GNSS**: de la antena a RF_IN lo más corto posible, sin vías, todo en L1 sobre la tierra de L2. Vías de cerco a los dos lados cada 2 mm o menos (cerca del UWB, cada 1 mm: λ/20 a 8 GHz es ≈ 1,0 mm).
- **Plano de tierra del patch**: un patch de 25 mm rinde mejor con un plano grande. El tamaño que pide la Taoglas está **no verificado**; la placa deja toda la zona de arriba como tierra continua en L1 y L2.
- **Separación GNSS ↔ LoRa**: antenas en bordes opuestos; los ≥ 40 mm solo con la FPC pegada en la carcasa (ver ubicación). SAW antes del módulo y pruebas con LoRa transmitiendo (ver arranque).
- **Antenas de módulos**: sin cobre en ninguna capa debajo de la antena del MDBT50Q (figura 7.2 de su hoja) ni de la del DWM3000.
- **Alimentación**: el buck-boost lejos de la zona GNSS, con su nodo de conmutación chico. El LDO del GNSS al lado del módulo. Sin cortes en la tierra de L2 debajo de las señales rápidas ni de la RF: no hace falta tierra en estrella, sí caminos de retorno continuos.
- **Lugar para una tapa blindada** sobre el GNSS y su cadena RF, sin montar.
- **Térmica**: el pod consume unos 40–50 mA; lo único que calienta es el cargador al cargar. Va lejos de la IMU.

## Lugares de rescate

**GNSS**
- [ ] Selección de antena: U.FL (Taoglas) o patch SMD, con 0 Ω o un capacitor que se gira; el bias se abre con el pasivo.
- [ ] SAW antes y después del LNA, cada uno con 0 Ω de puente.
- [ ] LNA sin montar (solo con el patch pasivo), con 0 Ω de puente.
- [ ] Red pi en RF_IN (0 Ω y dos capacitores sin montar), como en la referencia de Quectel.
- [ ] Bias-T con control por ANT_ON y 0 Ω para dejar la antena siempre alimentada.
- [ ] VCC del GNSS desde su LDO o directo de VREG (0 Ω); V_BCKP desde su LDO o desde VREG (0 Ω).
- [ ] Traductor de niveles con 0 Ω de puente por línea, sin montar.
- [ ] **TXD y RXD del GNSS a un conector de 4 pines** (TXD, RXD, VDD_EXT, GND) por puentes de soldadura, para desconectar el nRF y hablar con QGNSS desde una notebook.
- [ ] Puente USB-UART sin montar, con D± del USB-C seleccionables por 0 Ω entre el nRF y el puente.
- [ ] WAKEUP, I2C y ANT_ON del LC29H a pads.
- [ ] Lugar para tapa blindada.

**LoRa y BLE**
- [ ] TXEN desde DIO2 por 0 Ω (por defecto) o desde un pad.
- [ ] Antena LoRa por U.FL, con lugar para SMA de borde o antena chip.
- [ ] Red de adaptación sin montar en la salida de antena del E22 (si es pad).
- [ ] Cristal de 32,768 kHz montado, con lugar para sacarlo y usar el RC calibrado.
- [ ] **MDBT50Q-U1MV2** (U.FL para antena BLE externa) en el mismo lugar si el cuerpo tapa el BLE (mismo footprint, **no verificado**).

**IMU**
- [ ] ICM-42688-P en su propio lugar (CS e INT por 0 Ω con los del LSM6DSV320X).
- [ ] ADXL372 en su lugar, con su CS e INT propios.
- [ ] HG_INT a INT2 del LSM6DSV320X por 0 Ω.

**Barómetro**
- [ ] DPS368 en su propio lugar, sin montar (mismo bus I2C, otra dirección).
- [ ] SDO del BMP581 a VDDIO o a GND por 0 Ω (dirección 0x47 o 0x46).
- [ ] CSB del BMP581 a VDDIO (I2C), con 0 Ω.
- [ ] INT del BMP581 a BARO_INT (P1.12) por 0 Ω; la del DPS368 al mismo pin por su propio 0 Ω.

**Alimentación**
- [ ] 0 Ω en serie en cada riel (VREG, 3,2 V del GNSS, V_BCKP, LoRa, UWB) para medir corriente con un amperímetro.
- [ ] Puente del load switch del GNSS.
- [ ] **Rd de 5,1 kΩ en CC1 y CC2** del USB-C (montadas), con lugar para cambiarlas.
- [ ] Divisor de batería al AIN4.
- [ ] Botón al TS/MR del BQ25180 por diodo, sin montar.
- [ ] Lugar para un capacitor de entrada grande en el E22 (picos de TX).

**Depuración**
- [ ] Tag-Connect TC2030 sin patas + pads de SWD.
- [ ] Pads de prueba en PPS, DIO1, BUSY, INT de la IMU y cada riel.
- [ ] Botón.

**LED y sonido**
- [ ] Ánodo del LED desde SYS (montado) o desde VREG por 0 Ω.
- [ ] Resistencia 0402 por color para ajustar el brillo.
- [ ] Segundo LED RGB sin montar, en el borde de los pogo, en paralelo con el primero.
- [ ] Buzzer SMD con su NMOS en P0.11, sin montar.

## Fabricación

- **PCBWay**, con armado y compra de partes: consigue de DigiKey o Mouser lo que no está en LCSC (la EA, la Taoglas). Que la EA tenga stock es **no verificado** (no se encontró el módulo suelto con precio).
- **Pedido**: 10 placas desnudas y **5 armadas**: 3 con AA, 2 con EA (si se consigue) y 1 de ellas con el UWB montado, para probar ese lugar. Las 5 restantes quedan para rescates o para armar a mano.
- **Stencil con marco.** El LGA de la IMU y el DSBGA del BQ25180 piden inspección por rayos X: pedirla. Los módulos de borde se pueden retocar a mano.
- **Panel**: si PCBWay lo pide por tamaño, que arme el panel con rieles y fiduciales.
- **Envío a Argentina**: courier, con un despachante (ver `banco-gnss.md`).

## Arranque de la placa (en orden)

1. **Primer encendido con fuente de laboratorio con límite de corriente** (en lugar de la batería), sin módulos habilitados. Sin la batería y su NTC, poner **10 kΩ en TS** para que el BQ25180 no vea una falla de temperatura. Medir cada riel (SYS, VREG, 3,2 V del GNSS, V_BCKP) y su corriente por los 0 Ω.
2. SWD: leer el nRF52840, grabar un firmware mínimo. Ver que arranque el cristal de 32,768 kHz.
3. **LED**: cada color con el PWM a distintos brillos; repetir con la fuente en 3,4 V (batería casi vacía) y ver que el azul todavía se distinga. Ajustar las resistencias 0402.
4. I2C: leer el BQ25180 y el MAX17048 (IDs y direcciones).
5. **Carga**: por USB-C y por los pines pogo, con la batería real y su NTC; ver el /INT.
6. **Modo envío**: entrar por I2C y salir conectando VBUS (y por TS/MR, si se montó el diodo).
7. **USB**: que el nRF enumere en la computadora.
8. BLE: anunciar y conectar desde un celular.
9. Encender el GNSS (load switch): ver VDD_EXT a 2,8 V (**solo existe con el GNSS encendido**) y la corriente del riel.
10. GNSS por el conector de 4 pines con **QGNSS**: que arranque, que dé posición a 10 Hz, y si la AA saca crudo.
11. PPS: ver el pulso en el pad y la captura del TIMER por PPI; medir el desvío del reloj del nRF contra el GNSS durante unos minutos.
12. GNSS por el nRF (con el traductor): NMEA o binario sin errores a la tasa elegida (ver el margen del BAUDRATE).
13. IMU: leer ID, configurar alto rango, ver el canal de ±320 g.
14. **Barómetro**: leer su ID por I2C; en la mesa, ver el ruido de presión a 25–50 Hz; subir y bajar el pod 1 m y ver el cambio (unos 12 Pa); repetir con la carcasa cerrada y la ventilación puesta.
15. NAND: escribir, leer y borrar bloques; medir tasa y la corriente en reposo después de parar el SPIM3 (errata 195).
16. LoRa: TX y RX contra un RAK o el gateway, en 915–928 MHz.
17. **Ruido en el VCC del GNSS**: ripple con el osciloscopio en el VCC del LC29H con LoRa transmitiendo; si sube, comparar con el 0 Ω directo a VREG.
18. **Desensibilización del GNSS**: C/N0 de los satélites con LoRa apagado y transmitiendo a la potencia máxima prevista. Si cae, probar el SAW, la tapa blindada y la ubicación de las antenas.
19. Antena alternativa: cambiar al patch SMD por el 0 Ω (abriendo el bias y montando el LNA) y comparar C/N0 en el mismo lugar.
20. Consumo total y autonomía con la batería real.

## Compra mínima de banco que se mantiene

Antes de cerrar el esquemático hace falta saber si la AA saca crudo y si su velocidad es Doppler a 10 Hz. Para eso, y para la validación posterior, se mantiene de [`banco-gnss.md`](banco-gnss.md):

- **1 LC29H(AA)** en placa (el HAT de Waveshare): responde lo del crudo y el Doppler en días.
- **2 LG290P**: base en trípode y referencia en el chaleco.

## Lo que hay que confirmar antes de cerrar el esquemático

1. Pines del E22-900M22S: SPI, NRST, VCC y su rango, TCXO; si trae U.FL o solo pad de antena.
2. Pines y tensión del DWM3000 (IRQ, RSTn, WAKEUP, EXTON).
3. Hoja de ST del LSM6DSV320X (pines y tensiones confirmados solo por distribuidores).
4. BQ25180: mapa de bolas completo en la hoja de TI, si /INT es de drenador abierto, dirección I2C, y si el NTC y el botón conviven en TS/MR (pausa de carga en cada toque, reset por hardware con pulsación larga, fuga y caída del diodo frente al umbral de MR). Dirección del MAX17048.
5. Pines idénticos entre W25N02KV y W25N04KV.
6. Si el SPIM3 necesita pines dedicados para 32 MHz; que los workarounds de las erratas 195 y 198 alcancen.
7. Raytac MDBT50Q: medidas del keep-out de la antena PCB (figura 7.2), que el FCC ID SH6MDBT50Q cubra la -P1MV2, CE e IC, precio y stock de la -P1MV2, y que la -U1MV2 use el mismo footprint.
8. LED: que el XL-1615RGBC-RF sea de ánodo común y sus caídas por color; NMOS de nivel lógico y resistencias 0402; parte del buzzer si se monta; guía de luz de la carcasa.
9. Valor de BAUDRATE propio para 921600 bps en el nRF52840.
10. Partes de alimentación: buck-boost ajustable a 3,45 V con ±1,5 % y su sobrepico con el escalón de TX, LDO del GNSS de 3,2 V, LDO de V_BCKP con EN por divisor; traductor de niveles (y que aísle con un lado apagado), load switch, SAW y LNA de doble banda, puente USB-UART, conector de batería y celda con PCM y NTC.
11. Tensión de alimentación de la Taoglas, si trae SAW, y el plano de tierra que pide.
12. Si el patch Pulse es pasivo o activo, sus dimensiones y su footprint.
13. Stock y precio de la LC29H(EA) suelta.
14. Consumo de backup del LC29H en V_BCKP y consumo propio del LDO de V_BCKP.
15. Que la tabla de pines del Hardware Design V1.0 siga igual en la versión vigente para AA y EA.
16. Si la AA saca crudo y si da velocidad Doppler sin filtrado de más (banco con el HAT).
17. Hoja vigente de Bosch del BMP581 (dirección I2C, rango de VDD y VDDIO, CSB para elegir I2C, INT de drenador abierto, tasa y ruido por modo), la parte de ventilación con membrana para la carcasa, y si el BMP390 entra en el mismo lugar.
