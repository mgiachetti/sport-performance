# Pod v0: placa con módulos, directo a PCBWay (B-909)

Primera placa propia del pod de la Fase 3 ([ADR 0105](../adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md), [`pod-f3.md`](pod-f3.md)). No hay placa intermedia de desarrollo: la v0 ya es el pod, hecha **solo con módulos** (ningún chip de radio soldado directo) y con **lugares de rescate** (0 Ω, componentes sin montar y una antena alternativa para soldar) para corregir en la mesa lo que salga mal sin otra vuelta.

**Por qué así:** los módulos traen su RF resuelto y probado, así que el riesgo de la v0 queda en tres cosas que sí se pueden prever: la cadena de la antena GNSS, la convivencia GNSS ↔ LoRa y la asignación de pines. Cada una tiene su rescate.

Lo que dice "verificado" se leyó en la hoja del fabricante o en un distribuidor citado. Lo que dice "no verificado" hay que confirmarlo **antes de cerrar el esquemático** (lista al final).

## Diagrama de bloques

```mermaid
flowchart LR
  BAT[LiPo ~1000 mAh] --> CHG[BQ25180 cargador + SYS]
  USBC[USB-C / pogo VBUS] --> CHG
  CHG --> BB[Buck-boost 3,3 V digital]
  CHG --> LDO[LDO bajo ruido 3,3 V GNSS]
  CHG --> FG[MAX17048 medidor]
  BB --> MCU[Ebyte E73 nRF52840]
  BB --> LORA[Ebyte E22-900M22S SX1262]
  BB --> IMU[LSM6DSV320X]
  BB --> NAND[W25N04KV NAND]
  BB --> SWU[Load switch UWB] --> UWB[DWM3000 sin montar]
  LDO --> SWG[Load switch GNSS] --> GNSS[Quectel LC29H AA o EA]
  ANT1[Taoglas AGVLB.25B por U.FL] --> RFCH[Cadena RF: ESD, SAW y LNA con 0 Ω, bias-T, pi]
  ANT2[Patch SMD alternativo sin montar] --> RFCH
  RFCH --> GNSS
  GNSS <-->|UART 2,8 V con traductor| MCU
  GNSS -->|1PPS con traductor| MCU
  MCU <-->|SPIM2 8 MHz| LORA
  MCU <-->|SPIM2| IMU
  MCU <-->|SPIM2| UWB
  MCU <-->|SPIM3 hasta 32 MHz| NAND
  MCU <-->|I2C| CHG
  MCU <-->|I2C| FG
  LORA --> ANTL[Antena FPC 915 MHz por U.FL]
  MCU -->|USB| USBC
```

## Ubicación en la placa

Tamaño estimado: unos 45 × 65 mm (**no verificado**: sale del ruteo). Vista de arriba, con el chaleco el borde superior queda hacia la nuca:

```text
 ┌───────────────────────────────────────────────┐
 │  [E22 LoRa]  ── U.FL 915 ──► antena FPC        │  borde superior: LoRa, lejos del GNSS
 │                                                │
 │        ┌──────────────────────────┐            │
 │        │  ZONA GNSS (arriba, centro)│           │
 │        │  plano de tierra continuo │  [LDO GNSS]│
 │        │  patch Taoglas pegado o   │  [LC29H]   │
 │        │  patch SMD alternativo    │  cadena RF │
 │        └──────────────────────────┘            │
 │     [IMU al centro]   [NAND]  [MAX17048]       │
 │ [E73 nRF52840]  ◄── antena BLE en el borde,    │  borde izquierdo: keep-out sin cobre
 │                     sin cobre debajo           │
 │ [DWM3000 sin montar, antena al borde derecho]  │  borde derecho: keep-out UWB
 │  [buck-boost]  [BQ25180]   [USB-C] [pogo ×4]   │  borde inferior: carga y descarga
 └───────────────────────────────────────────────┘
   abajo: batería LiPo pegada, sin tapar las antenas
```

- **GNSS arriba y al centro**, con el plano de tierra más grande posible debajo del patch. El patch Taoglas va pegado sobre la cara de arriba (o en la tapa de la carcasa, justo encima) y se conecta por su cable de 60 mm al U.FL.
- **LoRa en el borde opuesto** al ruteo de RF del GNSS, con la antena FPC saliendo de la placa. La separación GNSS ↔ LoRa es lo que más pesa en la convivencia.
- **E73 en un borde**, con su antena cerámica asomada y sin cobre en ninguna capa debajo de la antena ([manual del E73](https://www.rcscomponents.kiev.ua/datasheets/e73-2g4m08s1c_usermanual_v1_9.pdf), sección 5.1).
- **IMU cerca del centro**, para que las aceleraciones no sumen rotación por estar lejos del centro del pod.
- **Batería debajo**, sin tapar ninguna antena.
- **USB-C y 4 pines pogo** (VBUS, GND, D+, D−) en el borde de abajo, para la base de carga y descarga (B-907).
- **UWB sin montar** en el otro borde, con su keep-out.

## Partes y alternativas

| Bloque | Elegida | Alternativa o rescate | Datos clave | Fuente | Verificado |
|---|---|---|---|---|---|
| GNSS | Quectel **LC29H(AA)** | **LC29H(EA)** en el mismo lugar (RTK en vivo) | 24 pines LCC, 12,2 × 16,0 mm. VCC 3,1–3,6 V. **Las E/S son de 2,8 V** (VIH máx. 3,08 V; VOH mín. 2,1 V). UART hasta 921600 bps, sin control de flujo | [LC29H Series Hardware Design V1.0](https://forums.quectel.com/uploads/short-url/6AJSfkCWZOBEg7psU3USNgfcBqm.pdf), tablas 5 y 10 | Sí |
| AA ↔ EA | Mismo lugar | — | El Hardware Design trae **una sola tabla de pines para las cinco variantes** (AA, BA, CA, DA, EA). La única diferencia: los pines 2 (FWD) y 4 (WHEELTICK) son reservados en la AA y se usan en las variantes con navegación a estima | Mismo documento, figura 4 y tabla 5 | Sí, según esa versión del documento (V1.0, 2022). Confirmar con la versión vigente |
| MCU + BLE | Ebyte **E73-2G4M08S1C** (nRF52840, 13 × 18 mm, antena cerámica) | — | 43 pines de borde. Expone casi todos los GPIO del nRF52840, **sin cristal de 32,768 kHz** (XL1/XL2 salen a pines) | [Manual del E73 V1.9](https://www.rcscomponents.kiev.ua/datasheets/e73-2g4m08s1c_usermanual_v1_9.pdf) | Sí |
| LoRa | Ebyte **E22-900M22S** (SX1262, 14 × 20 mm) | — | RXEN pin 6 y TXEN pin 7 (activos en alto; TXEN puede ir a DIO2), DIO1 pin 13, BUSY pin 14. DIO2 pin 8, VCC pin 9 y NRST pin 15 según un foro | [Manual del E22-900M22S](https://hubtronics.in/docs/E22-900M22S.pdf) (no se pudo descargar, datos del índice de búsqueda) · [foro de Mischianti](https://mischianti.org/forums/topic/e22-900m22s-wiring-dio1-dio2-and-busy/) | Parcial: RXEN, TXEN, DIO1 y BUSY sí; DIO2, VCC, NRST, los pines SPI y el rango de VCC, **no verificados** |
| MCU + LoRa juntos | — | **RAK4630 no es alternativa en la v0**: integra nRF52840 + SX1262 en otro encapsulado y otros pines, no entra en el lugar del E73 ni del E22. Haría falta su propio lugar y no hay espacio | — | — | — |
| IMU | **LSM6DSV320X** (LGA-14, 3 × 2,5 mm) | **ICM-42688-P + ADXL372** en lugares propios sin montar (mismo bus, otros CS) | VDD 1,71–3,6 V; VDDIO hasta 3,6 V con SPI. INT1 pin 4, INT2 pin 9, VDD pin 8, VDDIO pin 5 | [RS](https://my.rs-online.com/web/p/motion-sensor-ics/0396400) · [Future Electronics](https://www.futureelectronics.com/resources/featured-products/stmicroelectronics-lsm6dsv320x-6-axis-inertial-measurement-unit) | Parcial: datos de distribuidores; la hoja de ST, **no verificada** |
| Memoria | **W25N04KV** (4 Gbit) | **W25N02KV** (2 Gbit) en el mismo lugar | Los dos: WSON-8 de 8 × 6 mm, 2,7–3,6 V | [DigiKey W25N04KVZEIR](https://www.digikey.fi/en/products/detail/winbond-electronics/W25N04KVZEIR/15182086) · [DigiKey W25N02KVZEIR](https://www.digikey.ie/en/products/detail/winbond-electronics/W25N02KVZEIR/14560446) | Encapsulado y tensión sí. Que los pines sean idénticos, **no verificado** (es el patrón estándar de Winbond) |
| Cargador | **BQ25180** (I2C, salida SYS, modo envío) | — | — | [LCSC](https://www.lcsc.com/product-detail/C3682423.html) | Encapsulado (WCSP de bolas finas) y dirección I2C, **no verificados** |
| Medidor de carga | **MAX17048** (I2C, ALRT de drenador abierto) | Divisor de tensión al AIN4 del nRF, sin montar | — | [LCSC](https://lcsc.com/product-detail/image/MAX17048G-T10_C2682616.html) | Dirección I2C, **no verificada** |
| 3,3 V digital | Buck-boost (candidatos: TPS63802, TPS63900) | 0 Ω para alimentar desde un LDO si el buck-boost mete ruido | La LiPo baja de 3,3 V antes de vaciarse, por eso buck-boost | — | **No verificado** (a elegir) |
| 3,3 V GNSS | **LDO de bajo ruido aparte**, desde SYS (candidatos: TPS7A20, TLV757P) | 0 Ω para tomar el GNSS del 3,3 V digital | El LC29H pide VCC limpio y 3,1–3,6 V | Hardware Design, sección 3.2.1 | Parte **no verificada** |
| Load switches | GNSS y UWB (candidato: TPS22916) | 0 Ω de puente en cada uno | Apagar el GNSS entre sesiones; el UWB, si no se monta | — | **No verificado** |
| Traductor de niveles | 3,3 V ↔ 2,8 V para TXD, RXD y 1PPS del GNSS (candidatos: 3 × SN74LVC1T45 de dirección fija, o uno de 4 canales) | 0 Ω de puente en cada línea, sin montar | El nRF a 3,3 V lee "alto" desde 2,31 V y el GNSS da 2,1 V mínimo: **sin traductor no es confiable**. Al revés, 3,3 V supera el VIH máximo del GNSS (3,08 V) | Hardware Design, tabla 10 y nota de la sección 4.1.1 | El problema, sí. Las partes, **no verificadas** |
| RESET del GNSS | NPN o NMOS en drenador abierto, como recomienda Quectel | — | RESET_N bajo ≤ 0,1 V, al menos 100 ms | Hardware Design, sección 4.2.2 y tabla 10 | Sí |
| ESD | TVS en USB, pines pogo y entrada RF del GNSS (≤ 0,6 pF en RF) | — | — | Hardware Design, sección 5.1.3 (RF) | RF sí. USB y pogo, partes **no verificadas** |
| Antena GNSS | **Taoglas AGVLB.25B.07.0060A**: patch activo L1/L5 de 25 × 25 mm, con cable de 60 mm y conector I-PEX MHF1 | **Patch SMD de doble banda** soldado en la placa (por ejemplo Pulse ANT1825JB01BGNL5A), sin montar, con LNA propio sin montar | Alimentación de la antena activa desde VDD_RF (= VCC) | [DigiKey Taoglas](https://www.digikey.ie/en/products/detail/taoglas-limited/AGVLB-25B-07-0060A/21777673) · [LCSC Pulse C3284896](https://www.lcsc.com/product-detail/C3284896.html) | Conector y cable sí. Tensión de la Taoglas, que tenga SAW y las dimensiones del patch Pulse, **no verificados** |
| Cadena RF del GNSS | ESD → SAW (con 0 Ω de puente) → LNA (sin montar, con 0 Ω de puente) → SAW (con 0 Ω de puente) → red pi → RF_IN | — | Bias-T para la antena activa: L ≥ 68 nH, R 10 Ω, capacitores de 100 pF y 100 nF, y control por ANT_ON con dos transistores (o siempre encendida con un 0 Ω) | Hardware Design, figura 15 y sección 5.1.3 | Esquema de Quectel sí. Partes de SAW y LNA, **no verificadas** |
| Antena LoRa | FPC de 915 MHz por U.FL | Lugar para SMA de borde o antena chip, sin montar | — | [Core Electronics](https://core-electronics.com.au/915mhz-ufl-antenna.html) | Si el E22-900M22S trae U.FL propio o solo pad, **no verificado** |
| UWB | **DWM3000** sin montar (23 × 13 mm, 24 pines, antena integrada) | — | ≤ 3,6 V | [Hoja breve del DWM3000](https://www.mouser.com/datasheet/2/412/DWM3000_Data_Sheet_Brief-2399958.pdf) | Tamaño sí. Pines (IRQ, RSTn, WAKEUP, EXTON) y rango de tensión, **no verificados** |
| USB-serie para el GNSS | Puente USB-UART sin montar (candidatos: CP2102N, CH9102) con VIO a 2,8 V desde VDD_EXT del LC29H | — | Para hablar directo con el módulo desde QGNSS | — | **No verificado** |

## Pines del nRF52840 (E73)

**Restricciones del E73 y del nRF52840:**

- **Pines solo de baja frecuencia** (señales de hasta unos 10 kHz, porque meten ruido en la radio): P1.10, P0.03, P1.13, P0.02, P0.29, P0.31, P0.30, P1.04 y P1.06, más los de NFC (P0.09, P0.10). Verificado en la tabla del [manual del E73](https://www.rcscomponents.kiev.ua/datasheets/e73-2g4m08s1c_usermanual_v1_9.pdf); el criterio de 10 kHz, en el [foro de Nordic](https://devzone.nordicsemi.com/f/nordic-q-a/36367/using-gpios-marked-as-standard-drive-low-frequency-for-spi-on-nrf52840/140191). Ahí van solo interrupciones, enables, reset, LED y botón.
- **SPIM3** llega a 32 MHz; SPIM0–2 a 8 MHz ([Adafruit](https://learn.adafruit.com/introducing-the-adafruit-nrf52840-feather/caution-using-spi-on-battery-power)). Hay erratas conocidas del SPIM3 (cuáles aplican, **no verificado**): el rescate es bajar la NAND a SPIM2 a 8 MHz, que alcanza (unos 2–3 kB/s de registro). Si el SPIM3 necesita pines dedicados para 32 MHz, **no verificado**.
- **QSPI no se puede usar**: el E73 no saca P0.19, P0.21 ni P0.23 (verificado en su tabla de pines). La NAND va por SPI común.
- **P0.18 es RESET** y queda como reset.
- **NFC como GPIO**: P0.09/P0.10 hay que liberarlos en la UICR. Se dice que tienen fuga si quedan en niveles distintos (**no verificado**): por eso van dos salidas que cambian juntas (las del UWB).
- **XL1/XL2 sin cristal**: se usan como LED y botón, y el nRF corre con el oscilador RC de baja frecuencia calibrado. Rescate: lugar para el cristal de 32,768 kHz sin montar, con 0 Ω para desconectar LED y botón.
- **Conteo**: el E73 saca 31 GPIO (18 rápidos, 9 de baja frecuencia, 2 de NFC y 2 del cristal) más el reset. La v0 usa los 31. Si hace falta uno más, se libera VBAT_ADC (hay medidor), después el LED.

**Asignación:**

| Señal | Pin nRF | Pin del E73 | Periférico | A dónde va | Nota |
|---|---|---|---|---|---|
| NAND_CS | P0.15 | 28 | SPIM3 | W25N /CS | Bus propio de la NAND |
| NAND_SCK | P0.17 | 30 | SPIM3 | W25N CLK | Hasta 32 MHz; resistencia serie de 22–33 Ω sin ajustar |
| NAND_MOSI | P0.20 | 32 | SPIM3 | W25N DI | |
| NAND_MISO | P0.22 | 34 | SPIM3 | W25N DO | /WP y /HOLD a 3,3 V con 10 kΩ |
| BUS_SCK | P0.24 | 35 | SPIM2 | E22, IMU, ADXL372, DWM3000 | Bus compartido a 8 MHz |
| BUS_MOSI | P1.00 | 36 | SPIM2 | idem | |
| BUS_MISO | P1.02 | 38 | SPIM2 | idem | |
| LORA_NSS | P0.13 | 33 | GPIO | E22 NSS | |
| IMU_CS | P1.09 | 17 | GPIO | LSM6DSV320X CS (o ICM-42688-P con 0 Ω) | |
| HG_CS | P0.26 | 12 | GPIO | ADXL372 CS, sin montar | Libre si el ADXL372 no va |
| UWB_CS | P0.04 | 18 | GPIO | DWM3000 SPICSn, sin montar | |
| GNSS_TX (MCU → GNSS RXD) | P0.06 | 14 | UARTE1 | traductor → LC29H RXD (pin 21) | Configuración y RTCM para la EA |
| GNSS_RX (GNSS TXD → MCU) | P0.08 | 16 | UARTE1 | LC29H TXD (pin 20) → traductor | NMEA o binario a 10 Hz, hasta 921600 bps |
| I2C_SDA | P0.12 | 20 | TWIM0 | BQ25180, MAX17048 | Pull-ups de 4,7 kΩ |
| I2C_SCL | P0.07 | 22 | TWIM0 | idem | |
| PWR_INT | P1.11 | 1 | GPIO (entrada) | /INT del BQ25180 + /ALRT del MAX17048 en OR cableado | Los dos son de drenador abierto (**no verificado** para el BQ25180) |
| UWB_IRQ | P0.05 | 15 | GPIO (entrada) | DWM3000 IRQ, sin montar | |
| VBAT_ADC | P0.28 | 4 | AIN4 | Divisor de la batería, sin montar | Rescate si falla el MAX17048 |
| GNSS_PPS | P1.10 | 2 | GPIOTE | LC29H 1PPS (pin 3) → traductor | 1 Hz: va bien en un pin de baja frecuencia |
| GNSS_RST | P0.03 | 3 | GPIO | NPN/NMOS → LC29H RESET_N (pin 8) | |
| GNSS_EN | P1.13 | 6 | GPIO | Load switch o EN del LDO del GNSS | |
| LORA_BUSY | P0.02 | 7 | GPIO (entrada) | E22 BUSY (pin 14) | |
| LORA_DIO1 | P0.29 | 8 | GPIOTE | E22 DIO1 (pin 13) | Interrupción de fin de TX/RX |
| LORA_NRST | P0.31 | 9 | GPIO | E22 NRST | |
| LORA_RXEN | P0.30 | 10 | GPIO | E22 RXEN (pin 6) | TXEN (pin 7) va a DIO2 (pin 8) por 0 Ω, como sugiere Ebyte |
| IMU_INT1 | P1.04 | 40 | GPIOTE | LSM6DSV320X INT1 | INT2 a un pad de prueba con 0 Ω sin montar |
| HG_INT | P1.06 | 42 | GPIOTE | ADXL372 INT1, sin montar | |
| UWB_RST | P0.09 (NFC1) | 41 | GPIO (drenador abierto) | DWM3000 RSTn, sin montar | Que RSTn no se maneje en alto, **no verificado** |
| UWB_EN | P0.10 (NFC2) | 43 | GPIO | Load switch del UWB | |
| LED | P0.00 (XL1) | 11 | GPIO | LED de estado | |
| BOTÓN | P0.01 (XL2) | 13 | GPIO | Botón a GND | |
| USB D+ / D− / VBUS | — | 31 / 29 / 27 | USBD | USB-C y pogo, con 0 Ω para pasar D± al puente USB-UART del GNSS | |
| SWDIO / SWDCLK / RESET | — | 37 / 39 / 26 | SWD | Tag-Connect + pads | La consola va por RTT, sin UART |

**Pines del LC29H** (de la tabla 5 del Hardware Design): WAKEUP 1, FWD 2, 1PPS 3, WHEELTICK 4, reservados 5–6, VDD_EXT 7 (salida 2,8 V, 100 mA), RESET_N 8, VDD_RF 9, GND 10, RF_IN 11, GND 12–13, ANT_ON 14, reservados 15–17, I2C_SDA 18, I2C_SCL 19, TXD 20, RXD 21, V_BCKP 22, VCC 23, GND 24.

- **WAKEUP** queda sin conectar (el datasheet lo permite si no se usa el modo backup), con un 0 Ω sin montar a un pad. Si se conecta, su nivel alto es de 3,0–3,6 V, no de 2,8 V.
- **V_BCKP** va siempre alimentado (desde SYS por un LDO o del mismo riel antes del load switch) para el arranque en caliente.
- **VDD_EXT** alimenta el lado de 2,8 V del traductor y el VIO del puente USB-UART.
- **I2C del LC29H** queda a un pad, sin conectar al bus del nRF (otro nivel).

**¿El LC29H entra en el lugar de un NEO de u-blox?** Los dos miden 12,2 × 16 mm y la disposición se parece (RESET_N 8, RF_IN 11, GND 10/12/13, UART en 20/21, V_BCKP 22, VCC 23), pero hay diferencias que impiden un lugar doble sin cambios: el pin 7 es VDD_EXT (salida) en el LC29H y reservado en el NEO-F10N; el 14 es ANT_ON en el LC29H y LNA_EN en el F10N; y las E/S del LC29H son de 2,8 V, mientras que en el F10N siguen a VCC ([manual de integración del NEO-F10N](https://manualshive.com/en/manual/ublox/neo-f10n/4488978?page=37), copia de terceros). La compatibilidad pin a pin está **no verificada**: la v0 no la usa.

## Reglas de diseño

- **4 capas en PCBWay con impedancia controlada**: L1 señales y RF, L2 tierra continua, L3 alimentación y señales lentas, L4 señales y tierra. El ancho de la línea de 50 Ω (coplanar con tierra, referida a L2) sale de la calculadora de PCBWay con su apilado real (**no verificado**; con un dieléctrico de unos 0,2 mm suele dar una pista de unos 0,3 mm con separación de 0,15–0,2 mm).
- **RF del GNSS**: del U.FL (o del patch alternativo) a RF_IN lo más corto posible, sin vías, todo en L1 sobre la tierra de L2. Vías de cerco a los dos lados cada 2 mm o menos (cerca del UWB, cada 1 mm: λ/20 a 8 GHz en FR4 es unos 0,9 mm).
- **Plano de tierra del patch**: un patch de 25 mm rinde mejor con un plano grande. El tamaño que pide la Taoglas está **no verificado**; la placa deja toda la zona de arriba al centro como tierra continua en L1 y L2.
- **Separación GNSS ↔ LoRa**: antenas en bordes opuestos, lo más lejos que permita la placa (objetivo ≥ 40 mm, **no verificado** que alcance). SAW antes del módulo y pruebas con LoRa transmitiendo (ver arranque).
- **Antenas de módulos**: sin cobre en ninguna capa debajo de la antena del E73 ni de la del DWM3000.
- **Alimentación**: el buck-boost lejos de la zona GNSS, con su nodo de conmutación chico. El LDO del GNSS al lado del módulo. Sin cortes en la tierra de L2 debajo de las señales rápidas ni de la RF: no hace falta tierra en estrella, sí caminos de retorno continuos.
- **Lugar para una tapa blindada** sobre el GNSS y su cadena RF, sin montar.
- **Térmica**: el pod consume unos 40–50 mA; lo único que calienta es el cargador al cargar. Va lejos de la IMU.

## Lugares de rescate

**GNSS**
- [ ] Selección de antena: U.FL (Taoglas) o patch SMD, con 0 Ω o un capacitor que se gira.
- [ ] SAW antes y después del LNA, cada uno con 0 Ω de puente.
- [ ] LNA sin montar, con 0 Ω de puente.
- [ ] Red pi en RF_IN (0 Ω y dos capacitores sin montar), como en la referencia de Quectel.
- [ ] Bias-T con control por ANT_ON y 0 Ω para dejar la antena siempre alimentada.
- [ ] VCC del GNSS desde su LDO o desde el 3,3 V digital (0 Ω).
- [ ] Traductor de niveles con 0 Ω de puente por línea, sin montar.
- [ ] **TXD y RXD del GNSS a un conector de 4 pines** (TXD, RXD, VDD_EXT, GND) por puentes de soldadura, para desconectar el nRF y hablar con QGNSS desde una notebook.
- [ ] Puente USB-UART sin montar, con D± del USB-C seleccionables por 0 Ω entre el nRF y el puente.
- [ ] WAKEUP, I2C y ANT_ON del LC29H a pads.
- [ ] Lugar para tapa blindada.

**LoRa y BLE**
- [ ] TXEN desde DIO2 por 0 Ω (por defecto) o desde un pad.
- [ ] Antena LoRa por U.FL, con lugar para SMA de borde o antena chip.
- [ ] Red de adaptación sin montar en la salida de antena del E22 (si es pad).
- [ ] Cristal de 32,768 kHz sin montar, con 0 Ω para soltar LED y botón.

**IMU**
- [ ] ICM-42688-P en su propio lugar (CS e INT por 0 Ω con los del LSM6DSV320X).
- [ ] ADXL372 en su lugar, con su CS e INT propios.
- [ ] INT2 del LSM6DSV320X a un pad.

**Alimentación**
- [ ] 0 Ω en serie en cada riel (3,3 V digital, GNSS, V_BCKP, LoRa, UWB) para medir corriente con un amperímetro.
- [ ] Puente de cada load switch.
- [ ] Divisor de batería al AIN4.
- [ ] Lugar para un capacitor de entrada grande en el E22 (picos de TX).

**Depuración**
- [ ] Tag-Connect TC2030 sin patas + pads de SWD.
- [ ] Pads de prueba en PPS, DIO1, BUSY, INT de la IMU y cada riel.
- [ ] LED de estado y botón.

## Fabricación

- **PCBWay**, con armado y compra de partes: consigue de DigiKey o Mouser lo que no está en LCSC (la EA, la Taoglas). Que la EA tenga stock es **no verificado** (no se encontró el módulo suelto con precio).
- **Pedido**: 10 placas desnudas y **5 armadas**: 3 con AA, 2 con EA (si se consigue) y 1 de ellas con el UWB montado, para probar ese lugar. Las 5 restantes quedan para rescates o para armar a mano.
- **Stencil con marco.** El LGA de la IMU y el WCSP del BQ25180 (**no verificado**) piden inspección por rayos X: pedirla. Los módulos de borde se pueden retocar a mano.
- **Panel**: si PCBWay lo pide por tamaño, que arme el panel con rieles y fiduciales.
- **Envío a Argentina**: courier, con un despachante (ver `banco-gnss.md`).

## Arranque de la placa (en orden)

1. Sin módulos encendidos: medir cada riel (SYS, 3,3 V digital, 3,3 V GNSS, V_BCKP, VDD_EXT) y su corriente por los 0 Ω.
2. SWD: leer el nRF52840, grabar un firmware mínimo.
3. BLE: anunciar y conectar desde un celular.
4. GNSS por el conector de 4 pines con **QGNSS**: que arranque, que dé posición a 10 Hz, y si la AA saca crudo.
5. PPS: ver el pulso en el pad y en la interrupción del nRF.
6. GNSS por el nRF (con el traductor): NMEA o binario a 921600 bps sin errores.
7. IMU: leer ID, configurar alto rango, ver el canal de ±320 g.
8. NAND: escribir, leer y borrar bloques; medir tasa.
9. LoRa: TX y RX contra un RAK o el gateway, en 915–928 MHz.
10. **Desensibilización del GNSS**: C/N0 de los satélites con LoRa apagado y transmitiendo a la potencia máxima prevista. Si cae, probar el SAW, la tapa blindada y la ubicación del patch.
11. Antena alternativa: cambiar al patch SMD por el 0 Ω y comparar C/N0 en el mismo lugar.
12. Consumo total y autonomía con la batería real.

## Compra mínima de banco que se mantiene

Antes de cerrar el esquemático hace falta saber si la AA saca crudo y si su velocidad es Doppler a 10 Hz. Para eso, y para la validación posterior, se mantiene de [`banco-gnss.md`](banco-gnss.md):

- **1 LC29H(AA)** en placa (el HAT de Waveshare): responde lo del crudo y el Doppler en días.
- **2 LG290P**: base en trípode y referencia en el chaleco.

## Lo que hay que confirmar antes de cerrar el esquemático

1. Pines del E22-900M22S: SPI, NRST, VCC y su rango; si trae U.FL o solo pad de antena.
2. Pines y tensión del DWM3000 (IRQ, RSTn, WAKEUP, EXTON).
3. Hoja de ST del LSM6DSV320X (pines y tensiones confirmados solo por distribuidores).
4. Encapsulado y dirección I2C del BQ25180; dirección del MAX17048; si el /INT del BQ25180 es de drenador abierto.
5. Pines idénticos entre W25N02KV y W25N04KV.
6. Erratas del SPIM3 y si necesita pines dedicados para 32 MHz.
7. Fuga de los pines de NFC usados como GPIO.
8. Partes de alimentación, traductor de niveles, load switches, SAW, LNA y puente USB-UART.
9. Tensión de alimentación de la Taoglas, si trae SAW, y el plano de tierra que pide.
10. Dimensiones y footprint del patch SMD alternativo.
11. Stock y precio de la LC29H(EA) suelta.
12. Que la tabla de pines del Hardware Design V1.0 siga igual en la versión vigente para AA y EA.
13. Si la AA saca crudo y si da velocidad Doppler sin filtrado de más (banco con el HAT).
