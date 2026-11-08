# Pod v0: placa con módulos, directo a PCBWay (B-909)

Primera placa propia del pod de la Fase 3 ([ADR 0105](../adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md), [`pod-f3.md`](pod-f3.md)). No hay placa intermedia de desarrollo: la v0 ya es el pod, hecha **solo con módulos** (ningún chip de radio soldado directo) y con **lugares de rescate** (0 Ω, componentes sin montar y una antena alternativa para soldar) para corregir en la mesa lo que salga mal sin otra vuelta.

**Por qué así:** los módulos traen su RF resuelto y probado, así que el riesgo de la v0 queda en tres cosas que sí se pueden prever: la cadena de la antena GNSS, la convivencia GNSS ↔ LoRa y la asignación de pines. Cada una tiene su rescate. El nRF52840 va en un **Raytac MDBT50Q-P1MV2**, que expone sus 48 GPIO: sobran pines para buses separados y para el LED de estado.

Lo que dice "verificado" se leyó en la hoja del fabricante o en un distribuidor citado. Lo que dice "no verificado" hay que confirmarlo **antes de cerrar el esquemático** (lista al final).

## Diagrama de bloques

```mermaid
flowchart LR
  BAT[LiPo de 500–600 mAh con PCM y NTC, conector con llave] --> CHG[BQ25180 cargador, salida SYS]
  POGO[Pads planos dorados con llave: VBUS, D+, D−, GND, DETECT] --> OVP[Switch de entrada de VBUS: OVP, bloqueo inverso, TVS] --> CHG
  BAT --> BCK[LDO 3,0 V, EN directo de SYS]
  BCK --> VB[V_BCKP del GNSS]
  CHG --> BB[Buck-boost 3,4 V: VREG]
  BAT --> FG[MAX17048 medidor, VDD y CELL en la celda]
  BB --> MCU[Raytac MDBT50Q-P1MV2 nRF52840]
  BB --> SWL[Load switch del LoRa, con 0 Ω de puente] --> LORA[Ebyte E22-900M22S SX1262]
  BB --> IMU[LSM6DSV320X]
  BB --> SWN[Load switch de la NAND sin montar, 0 Ω de puente montado] --> NAND[W25N04KV NAND]
  BB --> BARO[BMP581 barómetro]
  BB --> UWB[DWM3000 sin montar, sin load switch]
  BB --> LDO[LDO bajo ruido 3,2 V con EN y descarga activa] --> GNSS[Quectel LC29H AA o EA]
  ANT1[Taoglas activa por U.FL] --> RFCH[ESD, bias-T, bloqueo DC, SAW, LNA opcional, SAW, atenuador pi]
  ANT2[Patch cerámico plano L1/L5 en la placa, alternativa por altura] --> RFCH
  RFCH --> GNSS
  GNSS <-->|UART 2,8 V con traductor| MCU
  GNSS -->|1PPS con traductor| MCU
  MCU -->|WAKEUP, nivel de 3,4 V| GNSS
  MCU -->|GNSS_EN al EN del LDO| LDO
  MCU <-->|SPIM2 8 MHz, bus propio| LORA
  MCU <-->|SPIM1 8 MHz| IMU
  MCU <-->|SPIM1| UWB
  MCU <-->|SPIM3 hasta 32 MHz| NAND
  MCU <-->|I2C| CHG
  MCU <-->|I2C| FG
  MCU <-->|I2C| BARO
  LORA --> LPF[Pasabajos sin montar] --> ANTL[Antena FPC 915 MHz de 45 × 10 mm por U.FL, en la carcasa]
  MCU <-->|USB por los pads de la base| POGO
  MCU -->|PWM0 por NMOS| LED[LED RGB con guía de luz]
  IMU -->|INT1: despierta por movimiento| MCU
  HALL[Sensor Hall DRV5032FB: pod dentro del chaleco] -->|imán del bolsillo: puesto o no| MCU
  CHG -->|/INT: VBUS conectado| MCU
  CHG -->|SYS| LED
```

## Ubicación en la placa

Tamaño estimado: unos 45 × 65 mm (**no verificado**: sale del ruteo y de la envolvente mecánica, que se define con la carcasa; puede crecer a unos 50 × 70 mm si el plano de tierra del patch lo pide). Vista de arriba; con el chaleco, el borde superior queda hacia la nuca y el GNSS mira al cielo:

```text
 ┌─────────────────────────────────────────────────┐
 │ (LED + guía)   ZONA GNSS: tierra continua L1/L2  │
 │      ┌──────────────────────────────────┐       │
 │      │ carcasa de la Taoglas            │       │
 │      │ 35 × 35 × 12 mm, pegada sobre    │       │
 │      │ la tierra, sin componentes debajo│       │
 │      └──────────────────────────────────┘       │
 │    [LC29H] [cadena RF y atenuador] [LDO GNSS]   │
 │ [MDBT50Q nRF52840]   [IMU al centro]  [DWM3000  │
 │  antena BLE al borde [NAND] [MAX17048] sin      │
 │  izq., sin cobre     [buck-boost]      montar]  │
 │  debajo     (o) agujero de herramienta   (o)    │
 │ [BQ25180, cobre y vías]  [5 pads con llave] [E22] │
 │  pads de prueba en una cara             [U.FL]──┼─► FPC de 45 × 10 mm
 └─────────────────────────────────────────────────┘   en la carcasa
   abajo: LiPo de 500–600 mAh, sin tapar las antenas, con espacio para hincharse
```

- **GNSS arriba**, con la tierra más grande posible debajo. La Taoglas no es solo el patch de 25 × 25 mm: su carcasa mide **35 × 35 × 12 mm y pesa 18 g**, y viene **ajustada sobre un plano de tierra de 70 × 70 mm** (hoja de Taoglas SPE-23-8-223-C). En una placa de unos 45 mm de ancho ocupa toda la zona de arriba con unos 5 mm por lado: el **LC29H, la cadena RF y el LDO van en la franja de abajo de la antena**, no al lado, y el LED pasa a una esquina. La tierra que queda (unos 45 × 40 mm) es menor que la del ajuste y **desafina primero la L5**: se planifica una iteración de ajuste con Taoglas sobre nuestra tierra (lo ofrecen; costo y plazos **no verificados**) o un patch ajustado para un plano chico, y el arranque mide L1 y L5 por separado. El peso y la altura de la antena entran en la envolvente mecánica. **Decisión pendiente por altura**: los 12 mm de la carcasa de la Taoglas probablemente rompen un pod de ≤ 15 mm de espesor; la alternativa es un **patch cerámico plano L1/L5 soldado en la placa** (unos 25 × 25 × 4 mm), con la cadena de LNA y SAW de la placa montada (ver "Antena GNSS").
- **LoRa en el borde opuesto** (abajo a la derecha), con el U.FL y una **antena FPC de 45 × 10 mm** (Ebyte TX915-FPC-4510) pegada en la carcasa del lado opuesto al patch. La FPC de 15 × 65 mm era tan larga como la placa y cruzaba la zona GNSS. La separación entre antenas (objetivo ≥ 40 mm) se recalcula con la envolvente real.
- **Raytac MDBT50Q-P1MV2 en el borde izquierdo**, con su antena PCB en el borde y según la sección 2.3 de su hoja ("RF Layout Suggestion (Keep-Out Area)"): sin cobre ni plano de tierra debajo de la antena en ninguna capa, el módulo en el borde con la punta de la antena hacia afuera, idealmente en una esquina (las medidas están en una figura: **no verificadas**, ver "Pines").
- **LED RGB en una esquina del borde superior** (la nuca, con el chaleco puesto), fuera de la huella de la carcasa de la antena, debajo de una **guía de luz** de la carcasa; el segundo LED, sin montar, en el borde de los pads de la base.
- **IMU cerca del centro**, para que las aceleraciones no sumen rotación por estar lejos del centro del pod.
- **Batería de 500–600 mAh debajo** (decisión del usuario), sin tapar ninguna antena y con espacio para que la celda se hinche.
- **Solo contactos de la base, sin USB-C** (decisión del usuario): en el pod son **pads planos dorados** (los resortes pogo van en la base, que se gasta y se repara aparte) en el borde de abajo: VBUS, D+, D−, GND y **DETECT**, en un **patrón asimétrico con llave** y con **imanes de polaridad elegida**, para que el pod entre en la base en una sola posición; girado, no se pega ni hace contacto. **DETECT** va a GND en el pod por una resistencia: la base **solo habilita VBUS cuando detecta un pod asentado**, así los resortes de la base no quedan con 5 V al aire ni se corroen con sudor. Detrás de VBUS va el **switch de entrada** (OVP y bloqueo de corriente inversa) y hay TVS en los cuatro pads. Sin USB-C, la carcasa queda estanca y no hay dos fuentes de VBUS en paralelo. En el banco se usa un adaptador pogo-USB.
- **UWB sin montar** en el borde derecho, con su keep-out.
- **BQ25180 a ≥ 10 mm de la IMU, el BMP581 y el MAX17048**, con cobre y vías térmicas debajo: es un cargador lineal dentro de una carcasa cerrada (ver "Reglas de diseño").
- **Sensor Hall en la cara que apoya contra el fondo del bolsillo**, frente al imán del chaleco y **lejos de los contactos de la base y sus imanes**: separación mínima a definir en el banco, con la regla de que el campo del imán del conector de la base en el Hall quede por debajo del **umbral de operación mínimo** de la hoja (el caso más sensible); los 4,8 mT son el **máximo**, el que asegura que el imán del bolsillo siempre se detecte. La carcasa lleva una marca o una forma que obliga a meter el pod en una sola posición.
- **Barómetro junto a la ventilación de la carcasa**, en un borde lateral, lejos del buck-boost y del cargador (calientan y la presión se corrige con la temperatura) y fuera de la zona donde aprieta el chaleco. La carcasa lleva una **ventilación con membrana de ePTFE impermeable** (tipo Gore) justo encima: deja pasar la presión y no el sudor ni la lluvia. Entre la ventilación y el sensor va un **canal sellado** (junta o espuma de celda cerrada alrededor del sensor), así el barómetro mide el aire de afuera y no el volumen de adentro de la carcasa, que cambia con la temperatura y con los golpes. Sin la ventilación, la carcasa con junta mide la presión de adentro.
- **Para fabricar y probar**: 3 fiduciales globales, 2 agujeros de herramienta para un jig de prueba con pines pogo, los agujeros de alineación del Tag-Connect TC2030-NL, pads de prueba en una sola cara y un área libre para la etiqueta con número de serie y código QR.

## Partes y alternativas

| Bloque | Elegida | Alternativa o rescate | Datos clave | Fuente | Verificado |
|---|---|---|---|---|---|
| GNSS | Quectel **LC29H(AA)** | **LC29H(EA)** en el mismo lugar (RTK en vivo) | 24 pines LCC, 12,2 × 16,0 mm. VCC 3,1–3,6 V. V_BCKP 2,2–3,6 V, **necesario para arrancar**. **Las E/S son de 2,8 V** (VIH máx. 3,08 V; VOH mín. 2,1 V), salvo **WAKEUP** (pin 1), con nivel alto de 3,0–3,6 V. UART hasta 921600 bps, sin control de flujo. Antena activa con **ganancia total < 17 dB** y NF < 1,5 dB; RF_IN de −15 dBm como máximo. Backup de unos 25 µA en V_BCKP | [LC29H Series Hardware Design V1.0](https://forums.quectel.com/uploads/short-url/6AJSfkCWZOBEg7psU3USNgfcBqm.pdf), tablas 5, 7 y 10, secciones 3.3.3 y 3.5 | Sí |
| AA ↔ EA | Mismo lugar | — | El Hardware Design trae **una sola tabla de pines para las cinco variantes** (AA, BA, CA, DA, EA). La única diferencia: los pines 2 (FWD) y 4 (WHEELTICK) son reservados en la AA y se usan en las variantes con navegación a estima | Mismo documento, figura 4 y tabla 5 | Sí, según esa versión del documento (V1.0, 2022). Confirmar con la versión vigente |
| MCU + BLE | Raytac **MDBT50Q-P1MV2** (nRF52840, 10,5 × 15,5 × 2,05 mm, antena PCB) | **MDBT50Q-U1MV2** (U.FL para antena externa) si el cuerpo tapa el BLE; MDBT50Q-1MV2 (antena chip) | 61 pads, **los 48 GPIO** (QSPI incluida). Cristal de 32 MHz y bobina del DC/DC de VDD adentro; **sin cristal de 32,768 kHz** (se monta afuera). FCC ID SH6MDBT50Q | [Hoja de Raytac Ver.K](https://cdn.sparkfun.com/assets/4/7/4/3/8/_nRF52840__MDBT50Q-1MV2___MDBT50Q-P1MV2_Ver.K_spec.pdf) · [LCSC -1MV2 C5118826](https://www.lcsc.com/product-detail/C5118826.html) · [JLC -P1MV2 C5119772](https://jlcpcb.com/partdetail/RAYTAC-MDBT50QP1MV2/C5119772) · [fcc.report](https://fcc.report/FCC-ID/SH6MDBT50Q/3937502.pdf) | Pines, cristales y DC/DC sí (hoja). Medidas del keep-out, que el FCC ID cubra la -P1MV2, CE/IC y el footprint de la -U1MV2, **no verificados** |
| LoRa | Ebyte **E22-900M22S** (SX1262, 14 × 20 mm) | — | RXEN pin 6 y TXEN pin 7 (activos en alto; TXEN puede ir a DIO2), DIO2 pin 8, VCC pin 9 (1,8–3,7 V), DIO1 pin 13, BUSY pin 14, NRST pin 15, MISO 16, MOSI 17, SCK 18, NSS 19, antena en el pin 21 (pad e IPEX). TCXO de 32 MHz | Página del producto en cdebyte.com (revisión eléctrica) · [foro de Mischianti](https://mischianti.org/forums/topic/e22-900m22s-wiring-dio1-dio2-and-busy/) | Pines, rango de VCC y antena, sí. Tensión de control y arranque del TCXO, **no verificados** (el manual está escaneado) |
| MCU + LoRa juntos | — | **RAK4630 no es alternativa en la v0**: integra nRF52840 + SX1262 en otro encapsulado y otros pines, no entra en el lugar del MDBT50Q ni del E22. Haría falta su propio lugar y no hay espacio | — | — | — |
| Cristal de 32,768 kHz | Montado en XL1/XL2 | Sin montar, con el RC calibrado del nRF | Mejor reloj de baja frecuencia para BLE y menos consumo que calibrar el RC. **CL ≤ 12,5 pF, ESR ≤ 100 kΩ, C0 ≤ 2 pF** (cifras de personal de Nordic en el foro). Ningún pin con PWM al lado: P0.27 (pad 16) y P0.26 (pad 19), vecinos de XL1/XL2, solo llevan CS estáticos | — | Parte y cifras contra el PS, **no verificadas** |
| LED de estado | **XINGLIGHT XL-1615RGBC-RF** (RGB, 1,6 × 1,5 mm, ánodo común), 3 NMOS de nivel lógico, 3 resistencias 0402 y **3 pull-down de 100 kΩ en los gates** | Segundo LED igual, sin montar; ánodo desde VREG por 0 Ω | Ánodo desde SYS; PWM0 en P0.11, P0.05 y P1.08 (ver "LED de estado") | [LCSC C965840](https://www.lcsc.com/product-detail/C965840.html) | Precio sí (LCSC). Ánodo común, caídas por color, NMOS y resistencias, **no verificados** |
| Buzzer | Sin montar: buzzer SMD con NMOS en P0.04 (PWM1) y pull-down de 100 kΩ en el gate | — | Para "buscar mi pod" con sonido; opcional | — | Parte **no verificada** |
| IMU | **LSM6DSV320X** (LGA-14, 3 × 2,5 mm) | **ICM-42688-P + ADXL372** en lugares propios sin montar (mismo bus, otros CS) | VDD 1,71–3,6 V; VDDIO hasta 3,6 V con SPI. INT1 pin 4, INT2 pin 9, VDD pin 8, VDDIO pin 5 | [RS](https://my.rs-online.com/web/p/motion-sensor-ics/0396400) · [Future Electronics](https://www.futureelectronics.com/resources/featured-products/stmicroelectronics-lsm6dsv320x-6-axis-inertial-measurement-unit) | Parcial: datos de distribuidores; la hoja de ST, **no verificada** |
| Memoria | **W25N04KV** (4 Gbit) | **W25N02KV** (2 Gbit) en el mismo lugar | Los dos: WSON-8 de 8 × 6 mm, 2,7–3,6 V | [DigiKey W25N04KVZEIR](https://www.digikey.fi/en/products/detail/winbond-electronics/W25N04KVZEIR/15182086) · [DigiKey W25N02KVZEIR](https://www.digikey.ie/en/products/detail/winbond-electronics/W25N02KVZEIR/14560446) | Encapsulado y tensión sí. Que los pines sean idénticos, **no verificado** (es el patrón estándar de Winbond) |
| Cargador | **BQ25180** (I2C, salida SYS, modo envío) | — | DSBGA de 8 bolas, 1,6 × 1,1 mm: A1 /INT, A2 IN, B1 SCL, B2 SYS, C1 SDA, C2 BAT, **D1 TS/MR** (NTC y reset manual en el mismo pin), D2 GND. **/INT de drenador abierto, pulso de 128 µs**; I2C **0x6A**. **Corriente de carga de 300–350 mA**, escrita por el firmware (arranca en 10 mA): es lineal, y con 500 mA desde 5 V a una celda de 3,4–3,7 V disiparía 0,65–0,8 W (RθJA de 107 °C/W JEDEC, 65 °C/W en el EVM), subiría 45–85 °C y se plegaría por temperatura (TREG de 100 °C). Valores por defecto que el firmware cambia: ver "Pines del LC29H y modo envío" | [Hoja de TI SLUSE99C](https://www.ti.com/lit/ds/symlink/bq25180.pdf) · [mapa de bolas en Flux](https://www.flux.ai/adrian95/bq25180ybgr~vng.md) · [LCSC](https://www.lcsc.com/product-detail/C3682423.html) | Pines TS/MR, /INT, dirección, consumos y valores por defecto, sí (hoja de TI, revisión eléctrica). El resto del mapa de bolas, de una librería de terceros |
| Batería | LiPo de **500–600 mAh** (decisión del usuario) **con PCM** (protección de sobrecarga, sobredescarga y cortocircuito) y **NTC de 10 kΩ en la celda**, de un proveedor que entregue **informe UN38.3, IEC 62133 y MSDS** | — | **Conector con llave y patas asimétricas** (BAT, GND, NTC) al TS/MR del BQ25180: ni el BQ25180 ni el LC29H se protegen contra una batería invertida, y las celdas de hobby suelen venir con el JST al revés. Espacio en la carcasa para que la celda se hinche. Ventana de temperatura de carga con el JEITA del BQ25180 y el NTC | — | Celda, proveedor y conector, **no verificados** |
| Medidor de carga | **MAX17048** (I2C, ALRT de drenador abierto), **alimentado desde BAT** (VDD y CELL en la celda): mide la celda aunque SYS esté cortado, y por eso consume también en modo envío | Divisor de tensión **desde SYS** (no desde BAT) al AIN4 del nRF, sin montar, de **≤ 400 kΩ por rama** (el SAADC pide una impedancia de fuente de hasta 800 kΩ, con TACQ de 40 µs): así no descarga la celda en modo envío | Dirección I2C citada 0x36 | [LCSC](https://lcsc.com/product-detail/image/MAX17048G-T10_C2682616.html) | Dirección, **no verificada** |
| Barómetro | **Bosch BMP581** (LGA de 10 pines, 2 × 2 mm) | **Infineon DPS368** en su propio lugar, sin montar (otra dirección I2C, encapsulado resistente al agua); BMP390 como segunda opción | I2C en el bus del cargador y del medidor: dirección **0x47** con SDO a VDDIO o 0x46 con SDO a GND, sin choque con 0x36 ni 0x6A. **VDD y VDDIO son pines separados**, los dos a VREG. **CSB atado a VDDIO**: si está en bajo al encender, el sensor queda en SPI o I3C. INT configurada de **drenador abierto, activa en bajo** (registro INT_CONFIG). VDD 1,71–3,6 V (1,65 V según otra fuente): VREG de 3,4 V entra. Ruido de menos de 0,1 Pa en alta resolución (1 Pa ≈ 8 cm de altura); hasta 480 Hz en modo continuo según una hoja preliminar. US$ 1,23 en LCSC; el DPS368, US$ 2,59 | [LCSC C5362283](https://www.lcsc.com/product-image/C5362283.html) · [DFRobot BMP581](https://wiki.dfrobot.com/SKU_SEN0667_Fermion:_BMP581_Barometric_Pressure_Sensor) · [Zephyr bosch,bmp581](https://docs.zephyrproject.org/latest/build/dts/api/bindings/sensor/bosch%2Cbmp581-i3c.html) · [LCSC DPS368 C3232508](https://www.lcsc.com/product-image/C3232508.html) · [LCSC BMP390 C5124834](https://www.lcsc.com/product-detail/C5124834.html) | Dirección, rango de tensión, VDDIO separado, CSB en alto para I2C e INT de drenador abierto: de distribuidores, de una hoja preliminar y de conocimiento general del sensor; la hoja vigente de Bosch, **no verificada** |
| Riel del sistema (VREG) | **Buck-boost a 3,4 V** desde SYS: **TPS63900** (salida en pasos de 100 mV entre 1,8 y 5,0 V: 3,4 V existe y 3,45 V no; 75 nA en reposo). Alternativa: TPS63802 (con divisor; unos ±2 % con resistencias de 1 %, **no verificado**) | 0 Ω para probar otro punto de ajuste | Alimenta nRF, E22, IMU, NAND y UWB (todos con máximo de 3,6 V) y el LDO del GNSS. Con 3,4 V + 1,5 % (precisión de la salida del TPS63900) = 3,45 V queda margen al máximo de 3,6 V; el sobrepico ante el escalón de unos 120 mA de una TX de LoRa se mide. La LiPo baja de 3,4 V antes de vaciarse: por eso buck-boost | Hoja de TI del TPS63900 (SLVSET3D) | Pasos del TPS63900, sí (revisión eléctrica). Sobrepico, y precisión del TPS63802, **no verificados** |
| 3,2 V del GNSS | **LDO de bajo ruido fijo a 3,2 V** desde VREG, **con EN y descarga activa de la salida** (candidato: TPS7A20 en su variante con descarga activa, **no verificada**), EN desde **GNSS_EN** con pull-down de 100 kΩ | Load switch después del LDO, sin montar, con 0 Ω de puente; 0 Ω para tomar el GNSS directo de VREG; 0 Ω para atar el EN a VREG | Desde 3,4 V (mínimo 3,37 V), el LDO de 3,2 V (hasta 3,25 V con ±1,5 %) tiene unos 120 mV de margen; el piso de 3,15 V queda sobre el mínimo de 3,1 V del LC29H. **El EN del LDO es el corte del GNSS**: no hace falta otro load switch (se ahorra un DSBGA de 0,4 mm). La descarga activa baja VCC por debajo de 100 mV, como pide Quectel para un ciclo de alimentación (≥ 1 s abajo; subida y bajada en menos de 50 ms) | Hardware Design, secciones 3.2.1 y 3.5 | Reglas de Quectel, sí. Parte y variante, **no verificadas** |
| V_BCKP | **LDO de 3,0 V de consumo ultrabajo desde BAT** (candidato: TPS7A02), con **EN directo de SYS, sin divisor** | 0 Ω para alimentar V_BCKP desde VREG. 0 Ω para atar EN a BAT | El TPS7A02 tiene un **pull-down interno en EN** ("smart enable", de unos 500 kΩ según una copia de la hoja) y VEN(HI) de 1,1 V: con un divisor de 10 MΩ el EN quedaría en 0,3–0,45 V y el LDO **nunca prendería**, y sin V_BCKP **el LC29H no arranca**. El EN admite hasta 6,0 V recomendados (6,5 V máximo, según la misma copia) y SYS llega como mucho a 4,9 V (5,9 V en el peor caso del OVP): va directo. Nunca alimentado desde SYS (más que el máximo de 3,6 V de V_BCKP). **Se corta en modo envío**: sin SYS, el pull-down interno apaga el LDO; a cambio se pierde el arranque en caliente | Hardware Design, sección 3.2.2 y tabla 10 · hoja de TI del TPS7A02 (SBVS277C) | Rango de V_BCKP, sí. Valor del pull-down y máximos del EN, de una copia de la hoja: **no verificados** contra TI |
| Load switches | **VCC del E22** (montado), candidato **TPS22916C** (la variante C tiene descarga rápida de la salida, QOD de 150 Ω; las CN y CNL no) | 0 Ω de puente. **NAND**: el mismo load switch **sin montar**, con su 0 Ω de puente montado. **GNSS**: lugar sin montar después del LDO (el EN del LDO hace el corte) | **Pull-down de 100 kΩ en cada EN** (LORA_EN, GNSS_EN, NAND_EN): el pull-down interno del TPS22916 solo actúa con el pin ya abajo, así que con el nRF en reset, en la DFU o al pasar de System OFF a reset, el EN quedaría flotando. E22: no ahorra corriente (el SX1262 duerme en menos de 1 µA), sirve para **apagar y prender la radio si se cuelga** y para medir su consumo aislado. NAND: solo se monta si el banco muestra que su reposo pesa (ver "Estados de energía y consumo"). El UWB **no** lleva load switch: comparte el SPIM1 con la IMU, y apagarlo lo alimentaría por los pines del bus; queda en VREG y se duerme por software | Hoja de TI del TPS22916 (SLVSDO5F) | Descarga rápida de la variante C, sí (revisión eléctrica). Tiempos de subida y si PCBWay arma su DSBGA de 4 bolas, **no verificados**; alternativa con patas: TPS22917 o TPS22918 en SOT-23, **no verificadas**. Número de LCSC, a buscar |
| Sensor Hall (chaleco) | **TI DRV5032FB** (DRV5032FBDBZR, SOT-23, **omnipolar**, salida **push-pull**, muestrea a **5 Hz**), **montado** | DRV5032FA (20 Hz, si 5 Hz resulta lento) | Detecta el **imán del bolsillo del chaleco**: con el pod puesto, la salida va a bajo. Omnipolar: responde a cualquier polo, así no importa cómo se cosa el imán. Alimentado desde VREG (1,65–5,5 V según distribuidores). Umbral de operación de unos 4,8 mT como máximo para las variantes FA a FD ([hoja de TI SLVSDC7H](https://www.ti.com/lit/pdf/SLVSDC7); el valor exacto de la FB, **no verificado**) | Unos US$ 0,15–0,21 ([LCSC C2655033](https://lcsc.com/product-detail/Hall-Sensor_Texas-Instruments-DRV5032FBDBZR_C2655033.html), disponible en JLCPCB) | Consumo a 5 Hz (se cita alrededor de 0,5 µA), umbral exacto de la FB y distancia de detección a través de carcasa y tela, **no verificados** |
| Traductor de niveles | 3,4 V ↔ 2,8 V para TXD, RXD y 1PPS del GNSS (candidatos: 3 × SN74LVC1T45 de dirección fija, con el lado de 2,8 V desde VDD_EXT) | 0 Ω de puente en cada línea, sin montar | El nRF lee "alto" desde 0,7 × VDD y el GNSS da 2,1 V mínimo: **sin traductor no es confiable**. Al revés, 3,4 V supera el VIH máximo del GNSS (3,08 V). VDD_EXT solo existe con el GNSS encendido: el traductor tiene que aislar con un lado apagado (Ioff del SN74LVC1T45). Con el GNSS apagado, el lado del nRF de GNSS_RX y GNSS_PPS queda en alta impedancia: **pull-up interna del nRF habilitada** en esos dos pines | Hardware Design, tabla 10 y nota de la sección 4.1.1 | El problema, sí. Las partes y su aislamiento, **no verificados** |
| RESET del GNSS | NPN o NMOS en drenador abierto, como recomienda Quectel | — | RESET_N bajo ≤ 0,1 V, al menos 100 ms | Hardware Design, sección 4.2.2 y tabla 10 | Sí |
| Conexión externa | **Solo contactos de la base** (decisión del usuario): en el pod, **5 pads planos dorados** (VBUS, D+, D−, GND y DETECT); los resortes pogo van en la base. Patrón asimétrico con llave e imanes de polaridad elegida | — | **DETECT** a GND en el pod por una resistencia (valor **no verificado**): la base habilita VBUS solo con un pod asentado. **Sin USB-C en el producto**: la carcasa queda estanca y no hay dos fuentes de VBUS en paralelo que se alimenten una a la otra. Con el pod girado en la base, las llaves impiden el contacto (girado, el VBUS caería en D−, y las E/S del nRF admiten como máximo VDD + 0,3 V). D± van al USB del nRF (pads 34 y 35). En el banco, adaptador de resortes a USB | Nordic PS, máximos absolutos | Máximos, sí (revisión eléctrica). Patrón, acabado de los pads, valor de DETECT y polaridad de los imanes, **no verificados** |
| Entrada de VBUS | **Switch de entrada con OVP y bloqueo de corriente inversa** en el VBUS de los pads de la base, antes del BQ25180 y del VBUS del nRF. Candidato: **TI TPS25947** (eFuse de 2,7–23 V con OVP ajustable y bloqueo de corriente inversa; **no verificado**) | 0 Ω de puente, sin montar | **EN desde su propia entrada** por un divisor (374 kΩ / 162 kΩ: UVLO de unos 4,0 V; el EN/UVLO admite 6,5 V como máximo y TI pide ≥ 350 kΩ arriba), nunca desde un GPIO del nRF (con el pod dormido o sin firmware, la carga tiene que andar igual). **OVP típico de 5,6–5,7 V** (OVLO con 374 kΩ / 100 kΩ: unos 5,69 V), por debajo de los **5,8 V** máximos del VBUS del nRF: el OVP del BQ25180 corta recién en 5,5–5,9 V (una fuente de 5,85 V pasa el cargador y castiga al nRF). **Límite de corriente de 0,85–1,15 A** (R_ILM de 3,32 kΩ). En el pad, un **TVS de 12–13 V de stand-off** (clase SMF12A o SMAJ12A, engrape de unos 20 V con 8/20 µs) y un capacitor de entrada de 1 µF / 25 V; aguas abajo protege el OVLO. Que el eFuse admita 23 V es incidental, no un requisito | Nordic PS (máximos absolutos) · hoja del BQ25180 | Cifras, sí (revisión eléctrica). Parte, **no verificada** |
| ESD | TVS en los pads de la base (VBUS, DETECT y D± de baja capacidad) y en la entrada RF del GNSS (≤ 0,6 pF) | — | Objetivo **IEC 61000-4-2: ±8 kV por contacto y ±15 kV por aire** en los pads expuestos (cancha seca en invierno, chalecos de nylon), con una prueba de precompatibilidad en el banco | Hardware Design, sección 5.1.3 (RF) | RF, sí. Partes de los pads de la base, **no verificadas** |
| Antena GNSS | **Taoglas AGVLB.25B.07.0060A**: patch activo L1/L5 de 25 × 25 × 8 mm en una carcasa de **35 × 35 × 12 mm y 18 g**, con cable de 60 mm e I-PEX MHF1 | **Patch cerámico plano L1/L5 soldado en la placa** (unos 25 × 25 × 4 mm; por ejemplo Pulse ANT1825JB01BGNL5A, a confirmar si es pasivo y sus medidas), con la cadena de LNA y SAW de la placa montada. **Es decisión pendiente**: si la envolvente pide un pod de ≤ 15 mm, la Taoglas (12 mm de alto) no entra y va esta | LNA de **28,3–30,3 dB**, NF de 2,4–2,8 dB, 18 mA, 1,8–5,5 V; **ajustada sobre un plano de tierra de 70 × 70 mm**. Alimentada desde VDD_RF (= VCC). Su ganancia pasa el límite de Quectel (< 17 dB): va con el **atenuador** de la cadena RF. Su NF supera el 1,5 dB recomendado: cuesta alrededor de 1 dB de C/N0 | [DigiKey Taoglas](https://www.digikey.ie/en/products/detail/taoglas-limited/AGVLB-25B-07-0060A/21777673) · hoja de Taoglas SPE-23-8-223-C · [LCSC Pulse C3284896](https://www.lcsc.com/product-detail/C3284896.html) | Medidas, ganancia, NF, consumo y plano de tierra, sí (hoja de Taoglas, revisión eléctrica). Dónde va su SAW respecto del LNA (está en una figura) y el patch Pulse, **no verificados** |
| Cadena RF del GNSS | Ver "Cadena RF del GNSS" abajo | — | SAW y LNA tienen que ser **de doble banda L1 + L5** | Hardware Design, figura 15 y sección 5.1.3 | Esquema de Quectel sí. Partes de SAW y LNA, **no verificadas** |
| Antena LoRa | **FPC de 915 MHz de 45 × 10 mm** (Ebyte TX915-FPC-4510) por U.FL, pegada en la carcasa del lado opuesto al GNSS | Lugar para antena chip con su despeje o SMA de borde, sin montar | La FPC de 15 × 65 mm era tan larga como la placa y cruzaba la zona GNSS. El E22 trae pad de antena e IPEX (pin 21) | Página del producto de Ebyte | Medidas, rendimiento en el cuerpo y precio de la de 45 mm, **no verificados** |
| Filtro en la antena del LoRa | **Pasabajos o trampa sin montar** en la salida de antena del E22, con 0 Ω de puente montado | — | El riesgo de convivencia no es la fundamental de 915 MHz sino el **ruido de banda ancha del PA del SX1262 en 1176 y 1575 MHz**, dentro de las bandas del GNSS: ningún SAW del lado del GNSS lo saca (la Taoglas ya filtra fuera de banda), solo la separación de antenas y un filtro del lado de la TX. Además el firmware marca las épocas del GNSS que se superponen con una TX (ver notas) | — | Ruido del SX1262 entre 1,1 y 1,6 GHz, **no verificado** |
| UWB | **Módulo DWM3000** sin montar (23 × 13 mm, 24 pines, antena integrada) | — | ≤ 3,6 V. El chip DW3110/QM33 soldado directo queda para la serie (B-911) | [Hoja breve del DWM3000](https://www.mouser.com/datasheet/2/412/DWM3000_Data_Sheet_Brief-2399958.pdf) | Tamaño sí. Pines (IRQ, RSTn, WAKEUP, EXTON) y rango de tensión, **no verificados** |

### Cadena RF del GNSS

En orden, desde la antena hasta el módulo:

1. **Selector de antena**: U.FL de la Taoglas (activa) o patch cerámico plano en la placa (pasivo), con un 0 Ω o un capacitor que se gira.
2. **ESD** (≤ 0,6 pF) en el nodo de la antena.
3. **Bias-T del lado de la antena**: L ≥ 68 nH desde VDD_RF, con **R de protección de 22–33 Ω en 0805** (o un PTC) y capacitores de 100 pF y 100 nF. Con 10 Ω, un coaxil apretado en el chaleco pondría 3,2 V sobre la R: 320 mA y 1 W en un 0402, y el LDO del GNSS se plegaría. Con 33 Ω y los 18 mA de la Taoglas caen 0,6 V y la antena sigue con unos 2,6 V (su mínimo es 1,8 V). Control por ANT_ON con dos transistores, o siempre encendida con un 0 Ω (Hardware Design, figura 15). **Elegir el patch pasivo abre el bias** (se saca el 0 Ω de alimentación): un pasivo no se alimenta.
4. **Bloqueo de DC** (100 pF) antes del resto: SAW, LNA y atenuador no ven la tensión de la antena.
5. **SAW L1 + L5** con 0 Ω de puente. Con la Taoglas, que ya filtra fuera de banda, sirve sobre todo para la opción pasiva.
6. **LNA L1 + L5 opcional, sin montar con la Taoglas** (que ya trae su LNA: dos ganancias en cascada saturan el módulo). Se monta solo con el patch pasivo. Puente de 0 Ω, con sus bloqueos de DC de entrada y salida según su hoja.
7. **SAW L1 + L5** con 0 Ω de puente.
8. **Atenuador pi resistivo** en RF_IN (3 × 0402, en el lugar de la red pi de la referencia de Quectel): con la Taoglas se monta de **6–10 dB**, para dejar la ganancia total bajo los **17 dB** que acepta el LC29H (la Taoglas da 28,3–30,3 dB; menos unos 4 dB de los SAW y el cable siguen siendo unos 25 dB, que comprimen la entrada y empeoran con LoRa cerca). Con el patch pasivo: 0 Ω en serie y los dos a tierra sin montar. El valor final sale del C/N0 y del AGC en el banco.
9. **RF_IN** del LC29H (pin 11).

## Pines del nRF52840 (Raytac MDBT50Q-P1MV2)

**El módulo** ([hoja de Raytac, Ver.K](https://cdn.sparkfun.com/assets/4/7/4/3/8/_nRF52840__MDBT50Q-1MV2___MDBT50Q-P1MV2_Ver.K_spec.pdf), secciones 2.5, 2.6, 3 y 8):

- **Expone los 48 GPIO del nRF52840** en 61 pads (sección 2.5), incluidos P0.19, P0.21 y P0.23, que el E73 no sacaba: la QSPI queda disponible.
- **Trae adentro el cristal de 32 MHz y la bobina del DC/DC de VDD (Reg1)** (sección 3). **No trae el cristal de 32,768 kHz**: XL1/XL2 (P0.00/P0.01, pads 17/18) salen a pads.
- **Alimentación**: el DC/DC de VDDH (Reg0) se recomienda solo con entrada de 3,6 V o más (sección 8.1). Con VREG de 3,4 V va el **modo de tensión normal**: VDD (pad 28) y VDDH (pad 30) juntos a VREG, Reg1 con el DC/DC habilitado y **DCCH (pad 31) sin conectar**. VBUS (pad 32) al VBUS de los pads de la base, después del switch de entrada.
- **USB**: D− pad 34, D+ pad 35. Con el USB deshabilitado, D± quedan sin conectar (sección 8.5).
- **Reset y depuración**: P0.18 (pad 40) es nRESET; se habilita escribiendo `PSELRESET` en la UICR, junto con `NFCPINS`, en la primera grabación (Raytac entrega los módulos con su firmware de prueba). SWDIO pad 51, SWDCLK pad 53.
- **Masa**: pads 1, 2, 15, 33 y 55.
- **Antena PCB (-P1MV2)** según la sección 2.3 de su hoja ("RF Layout Suggestion (Keep-Out Area)"): sin cobre ni plano de tierra debajo de la antena en ninguna capa, el módulo en el borde con la punta de la antena hacia afuera, idealmente en una esquina. Las medidas del área están en una figura (imagen): **no verificadas** hasta leerla en la hoja impresa. La **-U1MV2** (con U.FL para antena externa) es el rescate si el cuerpo tapa demasiado el BLE en el chaleco, pero **la hoja Ver.K no la cubre** (es de la -1MV2 y la -P1MV2): su footprint y sus datos, **no verificados**.
- **Etiquetas de QSPI de la tabla de Raytac**: parecen corridas (marca P0.18 como "QSPI/CSN" y P1.00 como QSPI). La v0 sigue la asignación de Nordic (CSN en P0.17, SCK en P0.19, IO0–IO3 en P0.20–P0.23) a propósito; P0.18 queda como reset.
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

**¿NAND por QSPI o por SPIM3? SPIM3.** El periférico QSPI del nRF52840 está hecho para memorias NOR: lectura y escritura con códigos y direcciones de 24 o 32 bits fijos, e instrucciones propias de hasta 8 bytes de datos. La W25N es NAND por SPI: cada lectura es "página a la caché" (0x13) y después "leer de la caché" con una dirección de columna de 16 bits y un byte de espera; cada escritura es "cargar la caché" (0x02, columna de 16 bits) y después "ejecutar el programa" (0x10). Eso no entra en las operaciones del QSPI sin trucos frágiles, y no hay driver de Zephyr para NAND por la QSPI del nRF. **SPIM3 a 32 MHz** da unos 3–4 MB/s, de sobra para registrar unos 4,5 kB/s y para descargar por USB (unos 1 MB/s). Igual la NAND va en los **pines recomendados de QSPI** (P0.17, P0.19, P0.20, P0.21), que son de alta velocidad. Una memoria QSPI en una placa futura necesitaría además IO2 e IO3 en P0.22 y P0.23, que en la v0 son la consola UARTE1: no queda armada, solo es posible. **Rescate**: SPIM3 a 8 MHz si las erratas molestan, que también alcanza.

**Asignación:**

| Señal | Pin nRF | Pad del módulo | Tipo de pin | Periférico | A dónde va | Nota |
|---|---|---|---|---|---|---|
| NAND_CS | P0.17 | 41 | Rápido | SPIM3 | W25N /CS | Bus propio de la NAND |
| NAND_SCK | P0.19 | 42 | Rápido | SPIM3 | W25N CLK | Hasta 32 MHz; resistencia serie de 22–33 Ω sin ajustar |
| NAND_MOSI | P0.20 | 44 | Rápido | SPIM3 | W25N DI | |
| NAND_MISO | P0.21 | 43 | Rápido | SPIM3 | W25N DO | /WP y /HOLD con 10 kΩ al **riel de la NAND** (después de su load switch), no a VREG |
| LORA_SCK | P0.24 | 48 | Rápido | SPIM2 | E22 SCK | **Bus propio del LoRa**, 8 MHz |
| LORA_MOSI | P0.25 | 49 | Rápido | SPIM2 | E22 MOSI | |
| LORA_MISO | P1.00 | 47 | Rápido | SPIM2 | E22 MISO | |
| LORA_NSS | P0.16 | 38 | Rápido | GPIO | E22 NSS | |
| SENS_SCK | P0.14 | 36 | Rápido | SPIM1 | LSM6DSV320X, DWM3000 (+ ICM-42688-P y ADXL372 sin montar) | Bus de sensores, 8 MHz |
| SENS_MOSI | P0.13 | 37 | Rápido | SPIM1 | idem | |
| SENS_MISO | P0.15 | 39 | Rápido | SPIM1 | idem | |
| IMU_CS | P1.09 | 26 | Rápido | GPIO | LSM6DSV320X CS (o ICM-42688-P con 0 Ω) | |
| HG_CS | P0.26 | 19 | Rápido | GPIO | ADXL372 CS, sin montar | CS estático, vecino de XL2: nunca PWM ahí. Libre si el ADXL372 no va |
| UWB_CS | P0.27 | 16 | Rápido | GPIO | DWM3000 SPICSn, sin montar | CS estático, vecino de XL1 (antes era el rojo del LED, con PWM). Libre si el UWB no va |
| GNSS_TX (MCU → GNSS RXD) | P0.06 | 22 | Rápido | UARTE0 | traductor → LC29H RXD (pin 21) | Configuración y RTCM para la EA |
| GNSS_RX (GNSS TXD → MCU) | P0.08 | 24 | Rápido | UARTE0 | LC29H TXD (pin 20) → traductor | NMEA o binario a 10 Hz. Pull-up interna del nRF (el traductor queda en alta impedancia con el GNSS apagado) |
| DBG_TX | P0.22 | 46 | Rápido | UARTE1 | Pad de consola | Consola serie de respaldo; la principal va por RTT |
| DBG_RX | P0.23 | 45 | Rápido | UARTE1 | Pad de consola | |
| I2C_SDA | P0.12 | 29 | Rápido | TWIM0 | BQ25180, MAX17048, BMP581, DPS368 (sin montar) | Pull-ups de 4,7 kΩ |
| I2C_SCL | P0.07 | 23 | Rápido | TWIM0 | idem | |
| LED_R | P0.11 | 27 | Rápido | PWM0 canal 0 | Gate del NMOS del rojo | Lejos del cristal (antes en P0.27, pad 16, vecino de XL1). El PWM no puede ir en pines de baja frecuencia |
| LED_G | P0.05 | 21 | Rápido | PWM0 canal 1 | Gate del NMOS del verde | |
| LED_B | P1.08 | 25 | Rápido | PWM0 canal 2 | Gate del NMOS del azul | |
| BUZZER | P0.04 | 20 | Rápido | PWM1 | Gate del NMOS del buzzer, sin montar | Libre si el buzzer no va |
| GNSS_PPS | P1.10 | 3 | Baja frec. | GPIOTE → PPI → TIMER | LC29H 1PPS (pin 3) → traductor | 1 Hz; captura del timer por PPI (ver notas). Pull-up interna del nRF |
| CHG_INT | P1.11 | 4 | Baja frec. | GPIO (entrada) | /INT del BQ25180 (A1) | Pin propio |
| BARO_INT | P1.12 | 5 | Baja frec. | GPIOTE | INT del BMP581 (o del DPS368 con 0 Ω) | Pin propio: ya no se comparte |
| GNSS_EN | P1.13 | 6 | Baja frec. | GPIO | **EN del LDO del GNSS** (con descarga activa) | **Pull-down de 100 kΩ**: con el nRF en reset, en la DFU o al salir de System OFF, el GNSS queda apagado |
| FG_ALRT | P1.14 | 7 | Baja frec. | GPIO (entrada) | /ALRT del MAX17048 | Pin propio |
| BOTÓN | P1.15 | 8 | Baja frec. | GPIO | Botón de banco a GND (el reset manual del BQ25180 va por su propio NMOS, sin montar) | |
| GNSS_RST | P0.03 | 9 | Baja frec. | GPIO | NPN/NMOS → LC29H RESET_N (pin 8) | |
| LORA_DIO1 | P0.29 | 10 | Baja frec. | GPIOTE | E22 DIO1 (pin 13) | Interrupción de fin de TX/RX |
| LORA_BUSY | P0.02 | 11 | Baja frec. | GPIO (entrada) | E22 BUSY (pin 14) | |
| LORA_NRST | P0.31 | 12 | Baja frec. | GPIO | E22 NRST | |
| VBAT_ADC | P0.28 | 13 | Baja frec. | AIN4 | Divisor desde SYS, sin montar, de ≤ 400 kΩ por rama | Rescate si falla el MAX17048. Desde SYS (con batería, SYS sigue a la celda): en modo envío no consume y no alimenta el nRF apagado por el pin. **En la base lee SYS (4,4–4,9 V con VBUS), no la celda**: sirve de respaldo solo fuera de la base |
| LORA_RXEN | P0.30 | 14 | Baja frec. | GPIO | E22 RXEN (pin 6) | TXEN (pin 7) va a DIO2 (pin 8) por 0 Ω, como sugiere Ebyte |
| UWB_IRQ | P1.02 | 50 | Baja frec. | GPIOTE | DWM3000 IRQ, sin montar | Libre si el UWB no va |
| IMU_INT1 | P1.04 | 56 | Baja frec. | GPIOTE | LSM6DSV320X INT1 | |
| IMU_INT2 | P1.06 | 57 | Baja frec. | GPIOTE | LSM6DSV320X INT2 | |
| UWB_RST | P1.07 | 58 | Baja frec. | GPIO (drenador abierto) | DWM3000 RSTn, sin montar | Que RSTn no se maneje en alto, **no verificado** |
| UWB_WAKEUP | P1.05 | 59 | Baja frec. | GPIO | DWM3000 WAKEUP, sin montar | |
| HG_INT | P1.03 | 60 | Baja frec. | GPIOTE | ADXL372 INT1, sin montar; **o NAND_EN** por 0 Ω si se monta el load switch de la NAND | Uno u otro: el ADXL372 y el load switch de la NAND son rescates que no se montan juntos. NAND_EN con pull-down de 100 kΩ. Libre si no va ninguno |
| LORA_EN | P1.01 | 61 | Baja frec. | GPIO | EN del load switch del E22 | Pull-down: el E22 arranca apagado hasta que el firmware lo prende |
| XL1 / XL2 | P0.00 / P0.01 | 17 / 18 | Cristal | LFXO | **Cristal de 32,768 kHz montado** | Mejor reloj de baja frecuencia para BLE y menos consumo que el RC calibrado |
| GNSS_WAKEUP | P0.09 | 52 | NFC liberado (baja frec.) | GPIO | LC29H WAKEUP (pin 1) | Pulso en alto de **≥ 10 ms** al salir del backup; el resto del tiempo, entrada con el buffer desconectado. Nivel alto de 3,0–3,6 V: el nRF a 3,4 V lo maneja directo, sin traductor. Pull-up sin montar al VCC del GNSS (3,2 V) como respaldo |
| HALL_INT | P0.10 | 54 | NFC liberado (baja frec.) | GPIO (SENSE) | Salida del DRV5032FB por una **resistencia en serie montada** (10–100 kΩ, valor **no verificado**) | **Chaleco puesto** (activa en bajo) y despertar. Los pines NFC se liberan en la UICR (`NFCPINS`; ver la nota de la fuga) |
| USB D+ / D− / VBUS | — | 35 / 34 / 32 | — | USBD | Pads de la base (VBUS después del switch de entrada), D± por 0 Ω | Sin USB-C |
| SWDIO / SWDCLK / nRESET | — | 51 / 53 / 40 | — | SWD | Tag-Connect TC2030-NL (con sus agujeros de alineación) + pads | La consola principal va por RTT. nRESET con `PSELRESET` en la UICR |

**Margen de pines:** la v0 usa **los 48** (contando XL1/XL2 con el cristal y P0.18 como reset). P0.09 (NFC) es ahora el **WAKEUP del GNSS** (antes quedaba a un pad, y el GNSS no salía del backup), y el EN del load switch de la NAND, si se monta, va por 0 Ω a P1.03 en lugar del ADXL372. **Libres según cómo se arme:** P0.04 sin buzzer; P0.26 y P1.03 sin ADXL372 (P1.03 solo si tampoco va el load switch de la NAND); P0.27, P1.02, P1.05 y P1.07 sin UWB. Rápidos libres: P0.04, P0.26 y P0.27, y **los dos últimos son vecinos del cristal**: solo para señales estáticas.

**Notas para el firmware:**
- **PPS por PPI**: el flanco del PPS en P1.10 dispara un evento de GPIOTE que, por PPI, captura un TIMER, sin pasar por la CPU. El TIMER corre a **16 MHz como máximo**, derivados del cristal de 32 MHz del módulo (HFXO), y el **HFXO tiene que quedar encendido** mientras se captura: eso cuesta corriente (unos cientos de µA, **no verificado**), que se mide en el banco. Con eso cada segundo se conoce el desvío del reloj del nRF contra el GNSS, y de ahí salen los turnos de LoRa (ADR 0105) y la hora de las muestras de la IMU y el barómetro. Bajo techo, la misma captura toma la baliza del gateway (B-911).
- **LED por PWM0** (tres canales): patrones y brillo por software (tabla del LED más abajo). El brillo y el apagado durante el juego son configuración del club.
- Con TXEN en DIO2, el firmware pone **RXEN en bajo antes de transmitir** y en alto para recibir.
- Si el E22 usa TCXO, se configura con `SetDIO3AsTCXOCtrl` (tensión y tiempo según el módulo, **no verificados**).
- Cada bus SPI con su modo y velocidad por CS (el de sensores comparte LSM6DSV320X y DWM3000).
- Direcciones I2C: BQ25180 **0x6A** (verificada en la hoja de TI); MAX17048 0x36 y BMP581 0x47, **no verificadas** contra la hoja del fabricante.
- **Barómetro**: a 25–50 Hz, con el sobremuestreo y el filtro IIR que dejen el ruido en unos pocos cm sin agregar retardo que borre un salto (el compromiso entre tasa y ruido sale del banco). La altura se calcula **fusionando barómetro e IMU** (filtro complementario o de Kalman): el barómetro fija la altura lenta y la aceleración vertical sigue lo rápido. Usos: levantada en el line, saltos, y apoyo a `time_to_feet_s` (el pod pasa de unos 1,3 m de pie a unos 0,2 m en el suelo). Una métrica nueva (por ejemplo `lineout_lift_m` o `jump_height_cm`) **no se agrega todavía**: se define con el club en el diccionario de métricas, con código, unidad y definición.
- El DWM3000 queda siempre alimentado desde VREG: en las placas que lo tienen, el firmware lo pone en **DEEPSLEEP** al arrancar y entre usos.
- **Pines NFC como GPIO**: se liberan en la UICR (`NFCPINS`), en Zephyr con `CONFIG_NFCT_PINS_AS_GPIOS` (en versiones nuevas del SDK, la propiedad equivalente del devicetree). Entre P0.09 y P0.10 hay una fuga si quedan en niveles distintos (cuánto, **no verificado**). P0.10 (Hall) está en **alto sin imán y en bajo con el pod en el chaleco**. P0.09 (WAKEUP del GNSS) solo se maneja durante el pulso de ≥ 10 ms; el resto del tiempo queda como **entrada con el buffer desconectado**, sin pull, y no hay fuga que importe. Si se monta el pull-up de respaldo del WAKEUP al VCC del GNSS, P0.09 sigue a ese VCC (0 V con el GNSS cortado) y, con el pod fuera del chaleco, aparece el caso con fuga: se mide en el banco. **Antes de escribir `NFCPINS`** (chip borrado o después de un recover), P0.10 sigue siendo un pad de la antena NFC mientras el Hall push-pull lo maneja: por eso la salida del Hall llega por una **resistencia en serie montada en el armado** (entre 10 y 100 kΩ; el valor sale de cuánta corriente admite el pad NFC según el capítulo NFCT del PS del nRF52840, **no verificado**) que limita esa corriente. En uso normal no cuesta nada: es una salida push-pull contra una entrada GPIO sin pull. Se puede sacar para medir.
- **Primera grabación** (paso de programación de producción, por el Tag-Connect): firmware, UICR con `NFCPINS` y `PSELRESET`, número de serie y, al final, **APPROTECT** habilitado. El flujo de producción, las claves por pod y la firma del firmware se definen aparte (B-909).
- **Watchdog**: el WDT del nRF52840 es **obligatorio** en el firmware. Además se usa el **watchdog del BQ25180** (hoja SLUSE99C): el bit 1 del registro SYS_REG (0x0A), `WATCHDOG_15S_ENABLE`, hace un **reset por hardware** (SYS se apaga y vuelve a prender, sección 8.3.8) si no hay I2C dentro de los **15 s después de conectar VIN**. Por defecto está en 0: el firmware lo habilita en cada arranque y tiene que hablarle por I2C dentro de los 15 s de cada vez que el pod entra en la base. Así la base recupera un pod colgado: sin interruptor ni botón accesible, es el único reset de campo.
- **Cristal de 32,768 kHz**: ningún pin con PWM al lado de XL1/XL2 (pads 17 y 18). P0.27 (pad 16) y P0.26 (pad 19) llevan solo CS estáticos.
- **Épocas del GNSS durante una TX de LoRa**: el firmware marca en el registro las épocas que se superponen con una transmisión (unos 82 ms cada 2 s), para que el posprocesado las descarte o les dé menos peso si el banco muestra desensibilización.
- **Backup del GNSS y ciclo de alimentación**: ver "Pines del LC29H y modo envío".
- **Estados de energía, despertares y orden para cortar el E22 o la NAND**: ver "Estados de energía y consumo".

## LED de estado

Un **LED RGB discreto** que da devolución sin abrir la app: en la base, al arrancar, antes de entrar a la cancha y para encontrar un pod.

- **Parte**: XINGLIGHT **XL-1615RGBC-RF** (1,6 × 1,5 mm, ánodo común según LCSC, US$ 0,012–0,016) ([LCSC C965840](https://www.lcsc.com/product-detail/C965840.html)). Que sea de ánodo común y su caída por color, **no verificados** contra la hoja.
- **Excitación**: ánodo común desde **SYS** (con batería, unos 3,0–4,2 V; en la base, 4,4–4,9 V con el SYS_REG por defecto de 4,5 V) y cada cátodo por su **resistencia 0402** a un **NMOS de nivel lógico** (Vgs(th) de alrededor de 1 V) manejado por un canal de PWM. **Por qué no directo del nRF desde VREG**: con 3,4 V, el azul y el verde (caída de unos 2,8–3,2 V) quedan casi sin margen y su brillo cambiaría con cada placa; con SYS hay margen y los pines del nRF nunca ven una tensión mayor a VREG. Con batería muy baja el azul brilla menos: por eso el aviso de batería baja es rojo.
- **Pull-down de unos 100 kΩ en el gate de cada NMOS** (los tres del LED y el del buzzer): durante el reset, el arranque y la DFU los pines del nRF quedan flotando, y sin pull-down el LED o el buzzer se prenderían solos.
- **El brillo depende de la batería**: la corriente de cada color cambia con SYS (unos 3,0–4,2 V con batería). El firmware **escala el PWM según VBAT** leído del MAX17048, para que el brillo se vea parejo (B-904).
- **Brillo**: las resistencias se ajustan en el banco (empezar por unos 1 kΩ, **no verificado**) para unos 1–2 mA por color; el PWM baja el resto. Consumo despreciable frente al GNSS.
- **Guía de luz** (light pipe) en el **borde de la nuca** (el borde superior con el chaleco puesto), para que se vea por encima del chaleco sin abrir la carcasa. La carcasa (B-909) lleva el agujero y la guía.
- **Rescates**: 0 Ω para tomar el ánodo de VREG en lugar de SYS; un **segundo LED sin montar** en paralelo, en el borde de los pads de la base, para verlo con el pod en la base; un **buzzer SMD sin montar** con su NMOS en P0.04, para "buscar mi pod" con sonido.

**Estados.** **Cada estado tiene un patrón que no se repite**: se distinguen sin ver el color (daltonismo, sol de frente). El color refuerza, no define.

| Estado | Patrón (único) | Color |
|---|---|---|
| Arranque y autotest | Fijo 1 s y se apaga | Blanco (R + G + B) |
| Error de un periférico en el autotest | Código: N destellos, pausa de 2 s, se repite (N = periférico) | Rojo |
| Buscando posición GNSS | Parpadeo continuo a 1 Hz | Amarillo (R + G) |
| Listo: posición GNSS y enlace con el gateway | Destello simple cada 2 s | Verde |
| Grabando sesión | Triple destello cada 10 s, o **apagado** si el club elige el modo partido | Verde |
| Grabando sin enlace con el gateway | Destello largo (1 s) cada 5 s | Azul |
| Batería baja (< 20 %) | Dos destellos largos cada 10 s | Rojo |
| Batería crítica (< 5 %) | Parpadeo rápido a 4 Hz durante 5 s y se apaga | Rojo |
| En la base: cargando | Respiración lenta (ciclo de 4 s) | Ámbar (R + poco G) |
| En la base: carga completa | Fijo | Verde |
| En la base: descargando datos | Doble destello continuo (cada 1 s) | Azul |
| En la base: error de descarga | Fijo con un corte cada 2 s | Rojo |
| Actualización de firmware (DFU) | Respiración rápida (ciclo de 1 s) | Violeta (R + B) |
| "Buscar mi pod" (desde la app por BLE) | Ráfaga de 10 destellos rápidos, pausa de 1 s, se repite (más el buzzer si está montado) | Blanco |

- **Modo partido** (configuración del club): durante la sesión, el LED se apaga o queda al mínimo, para no distraer ni encandilar; los estados de error y de batería crítica se pueden dejar visibles.
- Los porcentajes de batería y los tiempos son valores de partida: se ajustan con el firmware (B-904).

## Pines del LC29H y modo envío

**Pines del LC29H** (de la tabla 5 del Hardware Design): WAKEUP 1, FWD 2, 1PPS 3, WHEELTICK 4, reservados 5–6, VDD_EXT 7 (salida 2,8 V, 100 mA), RESET_N 8, VDD_RF 9, GND 10, RF_IN 11, GND 12–13, ANT_ON 14, reservados 15–17, I2C_SDA 18, I2C_SCL 19, TXD 20, RXD 21, V_BCKP 22, VCC 23, GND 24.

- **WAKEUP** va al nRF (P0.09, GNSS_WAKEUP): **sin él el GNSS no vuelve del backup** (ver abajo). Su nivel alto es de 3,0–3,6 V, no de 2,8 V: lo maneja el nRF directo desde 3,4 V, sin traductor.
- **V_BCKP** desde su LDO de 3,0 V con el EN directo de SYS (ver la tabla): **es obligatorio para que el LC29H arranque**, y mantiene el arranque en caliente.
- **VDD_EXT** (solo con el GNSS encendido) alimenta el lado de 2,8 V del traductor y el conector para QGNSS.
- **I2C del LC29H** queda a un pad, sin conectar al bus del nRF (otro nivel).

**Backup del GNSS** (Espera y System OFF), según la sección 3.3.3 del Hardware Design:

1. Para entrar: mandar el comando de software de backup y después cortar VCC (GNSS_EN abajo: el LDO baja la salida con su descarga activa), con V_BCKP prendido.
2. Para salir: volver a dar VCC (GNSS_EN arriba) y poner **WAKEUP en alto al menos 10 ms**; si no, el UART no vuelve a sacar datos.

Cortar VCC **sin** el comando deja al módulo en un estado indefinido y con más consumo (nota 4 de esa sección). Para un **ciclo de alimentación completo** (recuperar un GNSS colgado), VCC queda **por debajo de 100 mV al menos 1 s**, con subida y bajada en menos de 50 ms (sección 3.5): el firmware espera ese segundo antes de volver a prender.

**Valores por defecto del BQ25180 que el firmware cambia al arrancar** (hoja SLUSE99C, revisión eléctrica):

- La **corriente de carga arranca en 10 mA** (registro 0x05) hasta que el firmware escribe los 300–350 mA. El límite de entrada por defecto es de 500 mA.
- **SYS_REG por defecto de 4,5 V**: con VBUS, SYS queda en 4,4–4,9 V (lo usa el cálculo del LED).
- **EN_PUSH = 1** por defecto, con la pulsación larga de 10 s configurada para mandar a modo envío. Con solo el NTC en TS/MR, una celda caliente (NTC por debajo de unos 1,5 kΩ con batería o 2,4 kΩ con adaptador, frente al umbral de 90 mV) se lee como pulsación larga y el pod se va a modo envío. **El firmware pone EN_PUSH en 0 al arrancar.**
- **BUVLO de 3,0 V** con 150 mV de histéresis: SYS cae de golpe y puede entrar en un ciclo de arranques al final de la descarga. El umbral de batería crítica del firmware queda por encima.
- **Watchdog de 15 s** (`WATCHDOG_15S_ENABLE`, bit 1 de SYS_REG, 0x0A) en 0 por defecto: el firmware lo habilita en cada arranque (ver "Notas para el firmware").

**Modo envío y botón:** el BQ25180 entra en modo envío por I2C. Sin SYS, el pull-down interno del EN apaga el LDO de V_BCKP: el pod queda con consumo mínimo y pierde el arranque en caliente del GNSS. **Se configura para salir solo al conectar VBUS** (la base), con `EN_RST_SHIP` en "despertar solo con adaptador": así el BQ25180 consume unos **15 nA**; con la función de botón habilitada consume **3,2–4,5 µA** (cifras de la tabla de características de la [hoja de TI SLUSE99C](https://www.ti.com/lit/ds/symlink/bq25180.pdf) ([visor](https://ti.com/document-viewer/BQ25180/datasheet/GUID-0D5F0B48-24B6-430D-96C4-B266935A8BC7)) verificadas en la revisión eléctrica; hay una discrepancia conocida entre la hoja y la guía del EVM sobre `EN_RST_SHIP`, [foro de TI](https://e2e.ti.com/support/power-management-group/power-management/f/power-management-forum/1260456/bq25180-shipmode): vale la hoja). El **reset manual en TS/MR** queda como rescate: un **NMOS sin montar** con el drenador en TS/MR y la fuente a GND, con el gate desde un pulsador propio a BAT (sin montar) y un pull-down de 100 kΩ. Un diodo desde el botón no sirve: el umbral de MR (V_TSMR) es de unos 90 mV, menos que la caída de cualquier diodo. El gate va desde BAT y no desde el botón de P1.15 (que está en alto con la pull-up del nRF y bajaría TS/MR todo el tiempo), así funciona también en modo envío. Solo sirve si se habilita la función de botón. Riesgos si se monta: cada toque pausa la carga, una pulsación larga puede disparar el reset por hardware del BQ25180, y la fuga del NMOS apagado suma al NTC. Que el NTC y el botón convivan en ese pin, **no verificado**.

**¿El LC29H entra en el lugar de un NEO de u-blox?** Los dos miden 12,2 × 16 mm y la disposición se parece (RESET_N 8, RF_IN 11, GND 10/12/13, UART en 20/21, V_BCKP 22, VCC 23), pero hay diferencias que impiden un lugar doble sin cambios: el pin 7 es VDD_EXT (salida) en el LC29H y reservado en el NEO-F10N; el 14 es ANT_ON en el LC29H y LNA_EN en el F10N; y las E/S del LC29H son de 2,8 V, mientras que en el F10N siguen a VCC ([manual de integración del NEO-F10N](https://manualshive.com/en/manual/ublox/neo-f10n/4488978?page=37), copia de terceros). La compatibilidad pin a pin está **no verificada**: la v0 no la usa.

## Estados de energía y consumo

**Sin interruptor mecánico** (decisión del usuario): la carcasa queda cerrada y estanca. El pod se prende y se apaga solo, según la base, **si está puesto en el chaleco** (sensor Hall frente al imán del bolsillo), el movimiento y la app.

**Puesto o no puesto:** el movimiento solo no distingue un chaleco puesto de un pod que se sacude en un bolso en el micro. El Hall dice si el pod está dentro del bolsillo del chaleco:

| Movimiento | En el chaleco (Hall) | Estado | Qué hace |
|---|---|---|---|
| Sí | Sí | **Activo** | GNSS prendido, graba, telemetría en vivo. **Ponerse el chaleco marca el inicio de la sesión** del jugador |
| Sí | No | **Activo** durante el tiempo de gracia; después **Espera** | Durante la gracia sigue todo prendido (un pod que se reacomoda en el bolsillo no corta nada). Si no vuelve al chaleco, **cierra la sesión con la hora en que salió del chaleco** (la gracia solo confirma) y apaga GNSS y E22: está en un bolso o en la mano |
| No | Sí | **Activo**; pasado el **tiempo de quietud larga**, cierra la sesión y pasa a **Espera** | Jugador quieto en el banco: sigue grabando. Chaleco colgado en el vestuario: la sesión se cierra con la hora en que empezó la quietud |
| No | No | **Espera** y, pasado el segundo tiempo, **System OFF** | Guardado |

**Cierre de la sesión y precedencia** (de mayor a menor): **VBUS** (conectarlo a la base cierra la sesión y pasa a En la base, aunque haya un imán cerca) > **cierre desde la app** por el staff (cierra la sesión de uno o de todos los pods, sin depender de los sensores) > **fuera del chaleco** pasado el tiempo de gracia > **quietud larga** dentro del chaleco. La sesión termina en la hora del evento que la cerró (la salida del chaleco o el comienzo de la quietud), no cuando vence el tiempo que lo confirma.

**Estados:**

| Estado | Cuándo | Qué queda prendido | Cómo sale |
|---|---|---|---|
| **En la base** | VBUS presente (la base) | Todo lo que haga falta: carga, descarga por USB (por los pads de la base), DFU | Al sacarlo de la base (VBUS cae, el /INT del cargador lo avisa) pasa a **Espera**, y a **Activo** cuando se mete en el chaleco |
| **Activo** | Fuera de la base, **en el chaleco** y con movimiento (o dentro del tiempo de gracia fuera del chaleco) | GNSS (buscando o con posición), BLE, LoRa, IMU y barómetro a tasa de sesión, NAND grabando la sesión | Cierre de la sesión según la precedencia de arriba → **Espera** |
| **Espera** | Sin sesión: fuera del chaleco (quieto o moviéndose, por ejemplo en un bolso), o en el chaleco tras la quietud larga | BLE anunciando lento, IMU en bajo consumo con interrupción de movimiento, GNSS en backup (comando de backup y VCC cortado por el EN de su LDO; V_BCKP mantiene el arranque en caliente; al volver, WAKEUP en alto ≥ 10 ms), E22 apagado por su load switch | Movimiento **dentro del chaleco** → **Activo**. Sin movimiento durante el segundo tiempo → **System OFF** |
| **System OFF** | Quieto por más tiempo | Solo lo que despierta: la IMU en bajo consumo con su interrupción de movimiento, el /INT del cargador y el Hall | VBUS, un cambio del Hall (entrar o salir del chaleco) o movimiento (solo si quedó armado) → arranca de nuevo (reset del nRF) y decide el estado según la tabla de arriba |
| **Modo envío** | Almacenamiento largo, por orden de la app, o batería crítica | Nada: el BQ25180 corta SYS | Solo al conectar VBUS (la base) |

- **Tiempos**: el **tiempo de gracia fuera del chaleco**, el de **quietud larga** dentro del chaleco que cierra la sesión, y el de Espera → System OFF son **configuración del club** (sin valores en este documento: se definen con el club), con valores por defecto cargados por configuración; nunca fijos en el código. Lo mismo el umbral de batería crítica que manda a modo envío para proteger la celda (además del PCM); antes de entrar, el firmware espera que la NAND termine cualquier escritura o borrado y cierra el archivo.
- **El imán no afecta los cálculos**: el pod **no tiene magnetómetro** (el LSM6DSV320X es de 6 ejes) y un campo estático no afecta al GNSS, a la IMU ni al barómetro. Si algún día se suma un magnetómetro (rumbo), hay que revisar el imán del chaleco: el pod se mueve un poco dentro del bolsillo y el desvío que agrega el imán no sería constante.
- **Nunca se apaga en medio de una sesión que graba**: solo se pasa a Espera después de cerrar la sesión por alguna de las reglas de precedencia. Un jugador quieto en el banco, con el chaleco puesto, sigue grabando hasta que se cumpla la quietud larga.
- **Sesión falsa al mover un chaleco colgado**: después de la quietud larga el pod duerme con el despertar por movimiento armado (sigue en el chaleco), así que mover el chaleco colgado podría abrir una sesión. Se evita exigiendo **Hall "en el chaleco" y movimiento durante un tiempo mínimo** antes de abrirla (configuración del club), y el staff la puede cerrar desde la app.
- **Fuera del chaleco, System OFF despierta solo con el Hall o VBUS** (opción del club, activada por defecto): la interrupción de movimiento de la IMU no se arma, así un pod en un bolso no despierta en cada bache. Con el chaleco puesto se arma también la IMU.
- **Despertar desde System OFF**: el nRF52840 despierta con la señal DETECT de cualquier GPIO configurado con SENSE (también los de baja frecuencia), con **VBUS** (detección de VBUS, sin pin extra) y con reset ([nRF52840 PS v1.8](https://infocenter.nordicsemi.com/pdf/nRF52840_PS_v1.8.pdf), capítulo POWER, System OFF; [foro de Nordic](https://devzone.nordicsemi.com/f/nordic-q-a/46248/about-usb-function-on-nrf52840/183158): VBUS es la única fuente de USB que despierta, al subir por encima del umbral de detección). Fuentes: **IMU_INT1** (P1.04, movimiento), **VBUS** (al conectar la base), **CHG_INT** (P1.11, /INT del BQ25180) y **HALL_INT** (P0.10, el imán del chaleco). El SENSE de HALL_INT se arma en el **nivel opuesto al actual** (SENSE del nRF52840 es por nivel: bajo si estaba fuera del chaleco, alto si estaba adentro), para cumplir la regla de abajo. Lo que se verifica en el banco: que VBUS despierte al conectar la base (en el foro hay reportes de casos en que no) y el /INT del BQ25180, que es un **pulso corto de drenador abierto**: su pull-up queda activa en System OFF y se mide si el pulso alcanza para el DETECT.
- **Regla antes de System OFF**: leer y limpiar cada fuente con SENSE (IMU, cargador, Hall) y **confirmar que ninguna esté activa**; si alguna queda activa, el nRF despierta de inmediato y entra en un ciclo de despertares. La polaridad del SENSE de cada pin coincide con la de su fuente (IMU: activa en alto, push-pull, por defecto; /INT: activa en bajo); la del **Hall se arma en el nivel opuesto al actual**, así nunca está activa al dormir.
- **Despertar por movimiento**: la IMU queda en un modo de bajo consumo del acelerómetro con la **interrupción de despertar (wake-up)** en INT1: umbral de aceleración y duración mínima configurables, con la interrupción **retenida** (latched) hasta que el firmware la lee. Alternativa: la salida de estado de reposo (sleep status) de la función de actividad e inactividad, con el SENSE en la polaridad que corresponda. Según ST, el bajo consumo del acelerómetro a 15 Hz **no es compatible con el canal de alto rango habilitado**: antes de entrar en Espera, el firmware apaga el canal de ±320 g ([foro de ST](https://community.st.com/mems-sensors-48/lsm6dsv320x-high-accuracy-mode-166602), [AN6119](https://www.st.com/resource/en/application_note/an6119-lsm6dsv320x-6axis-imu-with-ai-highg-accelerometer-and-embedded-sensor-fusion-for-highend-applications-car-crash-detection-stmicroelectronics.pdf)). El umbral de movimiento se ajusta para que un viaje en el bolso no lo despierte cada minuto (se ajusta en el banco).

**Cortar el E22 (load switch del LoRa):**
1. Terminar o cancelar cualquier TX o RX y esperar BUSY en bajo.
2. **Deshabilitar el SPIM2.**
3. **Pasar a entrada desconectada** (sin pull) SCK, MOSI, MISO, NSS, NRST y RXEN del E22, para que los pines del nRF no lo alimenten por sus diodos de protección. BUSY y DIO1 ya son entradas: sin pull.
4. Bajar LORA_EN.

Al prender: subir LORA_EN y esperar la subida del riel; **recién entonces** devolver los pines (NSS en alto, NRST en bajo), habilitar el SPIM2, soltar NRST, esperar BUSY en bajo, configurar el TCXO con `SetDIO3AsTCXOCtrl` y su tiempo de arranque, calibrar y recién después configurar la radio. Los tiempos (subida del load switch, arranque del TCXO, calibración) son **no verificados**: se miden en el banco. El load switch con descarga rápida de la salida evita que quede a medio cargar entre un corte y otro, y su subida controlada limita la corriente de arranque contra los capacitores del E22.

**Regla de los rieles cortables:** toda pull-up, pull-down o componente pasivo del lado del E22 y de la NAND va a **su riel después del load switch**, nunca a VREG; si no, el riel cortado se alimenta por esas resistencias.

**Por qué el E22 lleva load switch si su sueño ya es de nanoamperes:** el SX1262 duerme en unos 160 nA (arranque en frío) o 600 nA (con la configuración retenida), según mediciones de usuarios ([foro de Semtech](https://forum.lora-developers.semtech.com/t/sx1262-deep-sleep/650)); cortarlo **no ahorra corriente que importe**. Lo que da es **recuperar una radio colgada** con un ciclo de alimentación completo, aunque NRST no alcance, y medir el consumo del E22 solo. Se monta en la v0; si en el banco no aporta, en la tanda de 100 queda el puente.

**Por qué la NAND tiene el load switch sin montar:** la familia W25N-KV tiene **modo de bajo consumo profundo** según Winbond ([página de la familia](https://winbond.com/hq/product/code-storage-flash/qspi-nand/w25n-kv/)), pero el reposo sin ese modo se cita en hasta unos 50 µA (dato de un agregador, [FindChips](https://www.findchips.com/detail/w25n02kvtciu/Winbond-Electronics-Corp)): sería lo que más consume en System OFF. El firmware la pone en bajo consumo profundo antes de dormir. Si eso no alcanza (o la W25N04KV no lo tiene), se monta el load switch con EN desde **P1.03** (NAND_EN, en lugar del ADXL372) por 0 Ω. **Regla de datos**: nunca se corta durante una escritura o un borrado, **y tampoco se entra en modo envío** (incluido el modo envío por batería crítica) sin eso: el firmware espera que la NAND termine (bit de ocupado) y cierra el archivo antes. **Para cortarla**: esperar el fin de la escritura o el borrado, deshabilitar el SPIM3 (con el workaround de la errata 195), pasar sus pines a entrada desconectada y recién entonces bajar NAND_EN. **Para prenderla**: subir NAND_EN, esperar el riel, devolver los pines (CS en alto), habilitar el SPIM3, esperar el tiempo de arranque de la NAND y mandar un reset.

**Presupuesto de corriente** (desde la batería, con el buck-boost en unos 90 % de eficiencia en actividad; valores típicos de hojas o de mediciones citadas, el resto **no verificado**):

| Componente | Activo | Espera | System OFF | Modo envío |
|---|---|---|---|---|
| LC29H (GNSS) | 24–30 mA | 0 (backup: ver V_BCKP) | 0 | 0 |
| LNA de la antena Taoglas (desde VDD_RF) | **18 mA** | 0 | 0 | 0 |
| V_BCKP (backup del LC29H + LDO TPS7A02) | incluido | **unos 25 µA** de backup del LC29H, más el consumo propio del LDO (25 nA típicos) | idem | 0 (EN desde SYS) |
| LDO del GNSS (con EN) | incluido | apagado por EN, unos nA (**no verificado**) | idem | 0 |
| nRF52840 | 3–6 mA (CPU, BLE, HFXO para el PPS) | decenas de µA con anuncios BLE lentos | unos 0,4 µA, más la retención de RAM si se usa (**no verificado**) | 0 |
| E22 (LoRa) | unos 5 mA promedio (TX de unos 82 ms cada 2 s a potencia alta) | 0 (load switch) | 0 | 0 |
| LSM6DSV320X | unos 0,67 mA (combo de alto rendimiento, 6 ejes) | unos 4–20 µA (bajo consumo a 1,875–60 Hz, cifras del LSM6DSV, no del 320X) | idem | 0 |
| BMP581 | unos 0,1 mA (25–50 Hz, **no verificado**) | reposo, menos de 1 µA (**no verificado**) | idem | 0 |
| NAND | unos 0,5–1 mA promedio (escrituras) | bajo consumo profundo (**no verificado**); sin él, hasta unos 50 µA | idem | 0 |
| MAX17048 (en BAT) | 23 µA | hibernación, unos 3 µA (**no verificado**) | idem | **modo sleep, unos 0,5 µA** si el firmware lo pone en sleep antes del modo envío (o si entra solo con SDA y SCL en bajo, con `EnSleep`); si queda activo, unos 23 µA (cifras de distribuidor, **no verificadas**) |
| BQ25180 | — | **3–3,5 µA** con batería y la función de botón deshabilitada (4–5 µA habilitada) | idem | **15 nA** (despertar solo con adaptador) |
| Buck-boost (VREG) | pérdidas de conversión | **TPS63900: 75 nA** (TPS63802: 11 µA) | idem | 0 |
| Load switch del E22 (apagado) | — | unos nA (**no verificado**) | idem | 0 |
| DWM3000 (si se monta) | — | DEEPSLEEP, **no verificado** | idem | 0 |
| Hall DRV5032FB | alrededor de 0,5 µA a 5 Hz (**no verificado**) | idem | idem | 0 |
| LED | unos 0,1 mA promedio | apagado o destellos esporádicos | 0 | 0 |
| **Total aproximado (estimación)** | **unos 50–60 mA** desde la celda (la rama del GNSS, con el LNA de la antena, son 42–48 mA a la salida del LDO) | **unos 0,08–0,2 mA** | **unos 50–70 µA**, con la NAND en bajo consumo profundo; lo domina el backup del LC29H en V_BCKP | **el MAX17048 en sleep (unos 0,5 µA) más la fuga del PCM de la celda** (unos µA): todo **no verificado** |

**Autonomía que resulta** con la batería elegida (decisión del usuario):

| Estado | 500 mAh | 600 mAh |
|---|---|---|
| Activo (unos 50–60 mA) | unas 8–10 h | unas 10–12 h |
| Espera (unos 0,08–0,2 mA) | unos 100–260 días en teoría | unos 125–310 días |
| System OFF (unos 50–70 µA) | unos 10–14 meses en teoría | unos 12–16 meses |
| Modo envío | lo limita la autodescarga de la LiPo (unos pocos % por mes, **no verificado**) | idem |

**Qué dice este presupuesto:**
- En **Activo** (estimación), la rama del GNSS con el LNA de la antena es unos tres cuartos del consumo. Con 500–600 mAh, una sesión de 4–5 h queda con un margen de 1,6 a 3 veces, que también cubre frío y envejecimiento (a medir). Ni el load switch del E22 ni el de la NAND cambian la autonomía de una sesión.
- En **System OFF** manda el **backup del LC29H** (unos 25 µA): mantener V_BCKP cuesta más que toda la electrónica dormida, a cambio del arranque en caliente; igual da meses de reposo. El **modo envío** lo corta, para almacenamiento largo y para proteger la celda.
- El **buck-boost** elegido es el TPS63900 (75 nA en reposo, y da 3,4 V).
- Lo que puede arruinar el reposo sigue siendo **la NAND sin bajo consumo profundo** (hasta unos 50 µA): por eso su load switch queda como rescate.
- El bajo consumo de la IMU (y que despierte con el canal de alto rango apagado) se mide en el banco: un hilo de ST sobre otra IMU reporta consumos muy por encima de la hoja después de una interrupción de inactividad, por la comunicación ([foro de ST](https://community.st.com/t5/mems-sensors/high-current-consumption-on-the-lsm6dsm-while-checking-for/td-p/224927)).

## Reglas de diseño

- **4 capas en PCBWay con impedancia controlada**: L1 señales y RF, L2 tierra continua, L3 alimentación y señales lentas, L4 señales y tierra. El ancho de la línea de 50 Ω (coplanar con tierra, referida a L2) sale de la calculadora de PCBWay con su apilado real (**no verificado**; con un dieléctrico de unos 0,2 mm suele dar una pista de unos 0,3 mm con separación de 0,15–0,2 mm).
- **RF del GNSS**: de la antena a RF_IN lo más corto posible, sin vías, todo en L1 sobre la tierra de L2. Vías de cerco a los dos lados cada 2 mm o menos (cerca del UWB, cada 1 mm: λ/20 a 8 GHz es ≈ 1,0 mm).
- **Plano de tierra del patch**: la Taoglas viene ajustada sobre **70 × 70 mm**; en la placa de unos 45 mm de ancho queda una zona de unos 45 × 40 mm, que desafina primero la L5. La zona de arriba es tierra continua en L1 y L2, **sin componentes debajo de la carcasa de la antena**. Se planifica una iteración de ajuste con Taoglas sobre nuestra tierra o un patch ajustado para un plano chico, y el arranque mide el C/N0 de L1 y L5 por separado.
- **Separación GNSS ↔ LoRa**: antenas en bordes opuestos, con la FPC de 45 × 10 mm pegada en la carcasa; la distancia y el aislamiento se recalculan con la envolvente mecánica. Pasabajos sin montar en la salida del E22 y pruebas con LoRa transmitiendo (ver arranque).
- **Antenas de módulos**: sin cobre ni plano de tierra en ninguna capa debajo de la antena del MDBT50Q (sección 2.3 de su hoja, con el módulo en el borde o en una esquina y la antena hacia afuera) ni de la del DWM3000.
- **Alimentación**: el buck-boost lejos de la zona GNSS, con su nodo de conmutación chico. El LDO del GNSS al lado del módulo. Sin cortes en la tierra de L2 debajo de las señales rápidas ni de la RF: no hace falta tierra en estrella, sí caminos de retorno continuos.
- **Lugar para una tapa blindada** sobre el GNSS y su cadena RF, sin montar.
- **Térmica**: el BQ25180 es lineal. Con 500 mA desde 5 V disiparía 0,65–0,8 W en una carcasa cerrada (RθJA de 107 °C/W JEDEC) y subiría 45–85 °C. Por eso la **corriente de carga es de 300–350 mA**, con **cobre y vías térmicas debajo del DSBGA**, y el cargador queda a **≥ 10 mm** de la IMU, el BMP581 y el MAX17048 (los tres sensibles a la temperatura). La base se dimensiona para esa corriente por lugar.
- **Cristal de 32,768 kHz**: pistas cortas, con tierra alrededor y sin señales con flancos al lado (ver "Pines").
- **Para fabricar y probar**: 3 fiduciales globales; 2 agujeros de herramienta para un jig de prueba con pines pogo; pads de prueba de todos los rieles y de las señales clave en una sola cara, en una grilla que el jig pueda tocar; los agujeros de alineación del Tag-Connect TC2030-NL; un área libre para la etiqueta con el número de serie y el código QR.

## Lugares de rescate

**GNSS**
- [ ] Selección de antena: U.FL (Taoglas) o patch SMD, con 0 Ω o un capacitor que se gira; el bias se abre con el pasivo.
- [ ] SAW antes y después del LNA, cada uno con 0 Ω de puente.
- [ ] LNA sin montar (solo con el patch pasivo), con 0 Ω de puente.
- [ ] **Atenuador pi resistivo** en RF_IN (3 × 0402): 6–10 dB con la Taoglas; 0 Ω en serie y los dos a tierra sin montar con el patch pasivo.
- [ ] Bias-T con **R de protección de 22–33 Ω en 0805** (o un PTC), control por ANT_ON y 0 Ω para dejar la antena siempre alimentada.
- [ ] VCC del GNSS desde su LDO o directo de VREG (0 Ω); V_BCKP desde su LDO o desde VREG (0 Ω).
- [ ] Load switch del GNSS después del LDO, sin montar, con 0 Ω de puente (el EN del LDO hace el corte).
- [ ] Traductor de niveles con 0 Ω de puente por línea, sin montar.
- [ ] **TXD y RXD del GNSS a un conector de 4 pines** (TXD, RXD, VDD_EXT, GND) por puentes de soldadura, para desconectar el nRF y hablar con QGNSS desde una notebook.
- [ ] **WAKEUP del LC29H al nRF (P0.09)**, con pull-up sin montar al VCC del GNSS como respaldo; I2C y ANT_ON del LC29H a pads.
- [ ] Lugar para tapa blindada.

**LoRa y BLE**
- [ ] TXEN desde DIO2 por 0 Ω (por defecto) o desde un pad.
- [ ] Antena LoRa por U.FL (FPC de 45 × 10 mm), con lugar para antena chip o SMA de borde.
- [ ] **Pasabajos o trampa sin montar** en la salida de antena del E22, con 0 Ω de puente.
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
- [ ] EN del LDO del GNSS a GNSS_EN (montado), con pull-down de 100 kΩ, o a VREG por 0 Ω (sin montar).
- [ ] **Load switch del E22** montado, con 0 Ω de puente (sin montar) para dejarlo siempre alimentado; pull-down de 100 kΩ en LORA_EN.
- [ ] **Load switch de la NAND sin montar**, con su 0 Ω de puente montado; EN al riel de entrada por 0 Ω (montado) o a NAND_EN en P1.03 por 0 Ω (sin montar, en lugar del ADXL372), con pull-down de 100 kΩ. /WP y /HOLD con pull-up al riel de la NAND.
- [ ] **Sensor Hall DRV5032FB montado** en HALL_INT (P0.10) por una **resistencia en serie de 10–100 kΩ montada** (protege el pad NFC antes de escribir la UICR y se saca para medir la fuga o la corriente), en la cara que apoya contra el bolsillo y lejos de los pads de la base y sus imanes; lugar compatible con la DRV5032FA (20 Hz).
- [ ] EN del LDO de V_BCKP directo a SYS (montado), o a BAT por 0 Ω (sin montar).
- [ ] **Switch de entrada de VBUS** (OVP y bloqueo inverso), con 0 Ω de puente sin montar; TVS en los pads de la base.
- [ ] Resistencia de DETECT a GND (valor a definir con la base), con lugar para cambiarla.
- [ ] Divisor desde SYS al AIN4, de ≤ 400 kΩ por rama (no desde BAT, para no descargar la celda en modo envío).
- [ ] Reset manual al TS/MR del BQ25180 por un NMOS sin montar (gate desde un pulsador a BAT, pull-down de 100 kΩ).
- [ ] Lugar para un capacitor de entrada grande en el E22 (picos de TX).
- [ ] Cobre y vías térmicas debajo del BQ25180.

**Depuración y fabricación**
- [ ] Tag-Connect TC2030-NL con sus agujeros de alineación + pads de SWD.
- [ ] Pads de prueba en PPS, DIO1, BUSY, INT de la IMU, WAKEUP y cada riel, en una sola cara y en grilla para el jig.
- [ ] 2 agujeros de herramienta y 3 fiduciales globales.
- [ ] Área para la etiqueta con el número de serie y el QR.
- [ ] Botón.

**LED y sonido**
- [ ] Ánodo del LED desde SYS (montado) o desde VREG por 0 Ω.
- [ ] Resistencia 0402 por color para ajustar el brillo.
- [ ] **Pull-down de 100 kΩ en el gate de cada NMOS** (LED y buzzer), montadas: que nada se prenda durante el reset, el arranque o la DFU.
- [ ] Segundo LED RGB sin montar, en el borde de los pads de la base, en paralelo con el primero.
- [ ] Buzzer SMD con su NMOS en P0.04, sin montar.

## Fabricación

- **PCBWay**, con armado y compra de partes: consigue de DigiKey o Mouser lo que no está en LCSC (la EA, la Taoglas). Que la EA tenga stock es **no verificado** (no se encontró el módulo suelto con precio).
- **Pedido**: 10 placas desnudas y **5 armadas**: 3 con AA, 2 con EA (si se consigue) y 1 de ellas con el UWB montado, para probar ese lugar. Las 5 restantes quedan para rescates o para armar a mano.
- **Stencil con marco**; el DSBGA de 0,4 mm al lado de los pads grandes de los módulos puede pedir un stencil fino o escalonado (consultarlo con PCBWay). El LGA de la IMU y el DSBGA del BQ25180 piden inspección por rayos X; en un DSBGA de 8 bolas los rayos X dicen poco, así que manda la prueba funcional. Los módulos de borde se pueden retocar a mano.
- **Panel**: si PCBWay lo pide por tamaño, que arme el panel con rieles y fiduciales, sin cortes en V ni puentes junto a la antena del Raytac.
- **Primera grabación**: por el Tag-Connect, con la UICR (`NFCPINS`, `PSELRESET`), el número de serie y APPROTECT al final (ver "Notas para el firmware").
- **Envío a Argentina**: courier, con un despachante (ver `banco-gnss.md`).

## Arranque de la placa (en orden)

1. **Primer encendido con fuente de laboratorio con límite de corriente** (en lugar de la batería), sin módulos habilitados. Sin la batería y su NTC, poner **10 kΩ en TS** para que el BQ25180 no vea una falla de temperatura. Sin USB-C: la fuente entra por el pad VBUS o por los pads de la batería. Medir cada riel (SYS, VREG en 3,4 V, 3,2 V del GNSS, V_BCKP) y su corriente por los 0 Ω.
2. SWD: leer el nRF52840 y grabar un firmware mínimo **con la UICR `NFCPINS` y `PSELRESET` escrita** (igual que en la programación de producción). Ver que arranque el cristal de 32,768 kHz y que P0.10 lea el Hall a través de su resistencia en serie.
3. **LED**: con el nRF en reset y durante la DFU, que el LED y el buzzer queden apagados (pull-down de los gates); después, cada color con el PWM a distintos brillos; repetir con la fuente en 3,0–3,2 V (batería casi vacía) y ver que el azul todavía se distinga. Ajustar las resistencias 0402.
4. I2C: leer el BQ25180 y el MAX17048 (IDs y direcciones). Escribir los valores de arranque del BQ25180 (corriente de carga de 300–350 mA, EN_PUSH en 0, watchdog de I2C) y leerlos de vuelta.
5. **Carga**: por los pads de la base, con la batería real y su NTC; ver el /INT. Medir la temperatura del cargador y de la carcasa cargando a 300–350 mA, y el corrimiento del BMP581 y de la IMU con ese calor. Con el nRF colgado a propósito, que el watchdog del BQ25180 lo recupere en la base.
6. **Modo envío**: entrar por I2C y salir conectando la base (y por TS/MR, si se montó el NMOS del reset manual).
7. **USB**: que el nRF enumere en la computadora por los pads de la base (adaptador de resortes a USB).
8. **Base y protección**: que la base dé VBUS solo con DETECT a GND (pod asentado); que girado no haga contacto (llaves e imanes); que el switch de entrada corte un VBUS de 6 V; prueba de precompatibilidad de ESD (±8 kV por contacto y ±15 kV por aire) en los pads pogo.
9. BLE: anunciar y conectar desde un celular.
10. Encender el GNSS (EN del LDO): ver VDD_EXT a 2,8 V (**solo existe con el GNSS encendido**) y la corriente del riel. **Backup**: comando, corte de VCC, vuelta con WAKEUP en alto ≥ 10 ms, y ver que el UART siga sacando datos. **Ciclo completo**: VCC por debajo de 100 mV durante 1 s (con la descarga activa) y que vuelva limpio.
11. GNSS por el conector de 4 pines con **QGNSS**: que arranque, que dé posición a 10 Hz, y si la AA saca crudo.
12. PPS: ver el pulso en el pad y la captura del TIMER por PPI; medir el desvío del reloj del nRF contra el GNSS durante unos minutos.
13. GNSS por el nRF (con el traductor): NMEA o binario sin errores a la tasa elegida (ver el margen del BAUDRATE).
14. IMU: leer ID, configurar alto rango, ver el canal de ±320 g.
15. **Barómetro**: leer su ID por I2C; en la mesa, ver el ruido de presión a 25–50 Hz; subir y bajar el pod 1 m y ver el cambio (unos 12 Pa); repetir con la carcasa cerrada y la ventilación puesta.
16. NAND: escribir, leer y borrar bloques; medir tasa y la corriente en reposo después de parar el SPIM3 (errata 195).
17. LoRa: TX y RX contra un RAK o el gateway, en 915–928 MHz.
18. **Ruido en el VCC del GNSS**: ripple con el osciloscopio en el VCC del LC29H con LoRa transmitiendo; si sube, comparar con el 0 Ω directo a VREG.
19. **Desensibilización del GNSS**: C/N0 de los satélites **de L1 y de L5 por separado** (la tierra chica desafina primero L5) con LoRa apagado y transmitiendo a la potencia máxima prevista. Si cae, probar el pasabajos del E22, la tapa blindada y la ubicación de las antenas, y ver las épocas marcadas durante la TX.
20. **Atenuador y antena**: con la Taoglas, elegir el atenuador (6–10 dB) con el C/N0 y el AGC; cambiar al patch cerámico plano por el 0 Ω (abriendo el bias, montando el LNA y los SAW, con 0 Ω en el atenuador) y comparar C/N0 en el mismo lugar. Con eso y la envolvente mecánica se decide la antena.
21. **Chaleco y Hall**: con el pod en el bolsillo y un imán de prueba, la **distancia de detección** a través de la carcasa y la tela (con margen para que el pod se mueva en el bolsillo); que los **imanes de la base y del conector** no lo disparen; que el imán del bolsillo de otro jugador pegado (en un scrum o un line) no cambie el estado de un pod que no es el suyo; y que en la base mande VBUS aunque haya un imán cerca. Con eso se elige el tamaño y la fuerza del imán.
22. **Consumo por estado**, con un medidor de corriente de rango de µA en la batería y los 0 Ω de cada riel:
    - **Activo**: total y por riel (GNSS con el LNA de la antena, E22 con TX, IMU, NAND grabando).
    - **Espera**: GNSS en backup y E22 cortado por su load switch; ver que los pines del E22 queden como entradas (sin alimentación por los pines) y que el E22 vuelva a configurarse bien al prenderlo.
    - **System OFF**: total en µA (unos 50–70 µA esperados, sobre todo el backup del LC29H); que ninguna fuente de SENSE quede activa al dormir (sin ciclo de despertares); despertar por movimiento (y que un viaje en el bolso no lo despierte a cada rato), por VBUS (detector del nRF y /INT del cargador) y por el imán del chaleco. Medir la NAND con y sin bajo consumo profundo, el MAX17048 en sleep y la fuga entre P0.09 y P0.10.
    - **Modo envío**: con `EN_RST_SHIP` en "solo adaptador", unos 15 nA del BQ25180 más la fuga del PCM; salir conectando la base.
    - Autonomía de una sesión con la batería de 500–600 mAh, en frío y en calor.

## Compra mínima de banco que se mantiene

Antes de cerrar el esquemático hace falta saber si la AA saca crudo y si su velocidad es Doppler a 10 Hz. Para eso, y para la validación posterior, se mantiene de [`banco-gnss.md`](banco-gnss.md):

- **1 LC29H(AA)** en placa (el HAT de Waveshare): responde lo del crudo y el Doppler en días.
- **2 LG290P**: base en trípode y referencia en el chaleco.

## Lo que hay que confirmar antes de cerrar el esquemático

1. E22-900M22S: tensión de control y arranque del TCXO (`SetDIO3AsTCXOCtrl`). **Pin 12**: el símbolo de LCSC lo da como GND, y alguna tabla de terceros lo cita como NRST; el esquemático lo pone a GND (NRST en el 15): confirmar con la hoja de Ebyte. Los pines, el rango de VCC (1,8–3,7 V) y la antena (pad e IPEX) ya se verificaron en la página de Ebyte.
2. Pines y tensión del DWM3000 (IRQ, RSTn, WAKEUP, EXTON).
3. Hoja de ST del LSM6DSV320X (pines y tensiones confirmados solo por distribuidores).
4. BQ25180: el resto del mapa de bolas en la hoja de TI, y si el NTC y el botón conviven en TS/MR (pausa de carga en cada toque, reset por hardware con pulsación larga, fuga del NMOS del reset manual frente al NTC). La dirección (0x6A), el /INT, los consumos y los valores por defecto ya se verificaron. Dirección del MAX17048.
5. Pines idénticos entre W25N02KV y W25N04KV.
6. Si el SPIM3 necesita pines dedicados para 32 MHz; que los workarounds de las erratas 195 y 198 alcancen.
7. Raytac MDBT50Q: medidas del keep-out de la antena PCB (sección 2.3), que el FCC ID SH6MDBT50Q cubra la -P1MV2, CE e IC, precio y stock de la -P1MV2, y la hoja de la -U1MV2 (no la cubre la Ver.K): footprint y datos.
8. LED: que el XL-1615RGBC-RF sea de ánodo común y sus caídas por color; NMOS de nivel lógico y resistencias 0402; parte del buzzer si se monta; guía de luz de la carcasa.
9. Valor de BAUDRATE propio para 921600 bps en el nRF52840.
10. Partes de alimentación: TPS63900 a 3,4 V, su sobrepico con el escalón de TX y la **carga pico de VREG, de unos 230–250 mA, contra los 400 mA del TPS63900**; variante del TPS7A20 con descarga activa; valor del pull-down y máximos del EN del TPS7A02 contra la hoja de TI; switch de entrada de VBUS (TPS25947 u otro) con OVP típico de 5,6–5,7 V y EN desde su entrada por divisor; TVS de 12–13 V de stand-off en el pad; traductor de niveles (y su Ioff con un lado apagado); TPS22916C y si PCBWay arma su DSBGA (o TPS22917/TPS22918 en SOT-23); SAW y LNA de doble banda; resistencias del atenuador; R de 22–33 Ω en 0805 o PTC del bias-T.
    - **Leído en las hojas de TI al dibujar el esquemático** (2026-11-08): el TPS63900 da 3,4 V **solo como V_O(2), con SEL en alto** (R_CFG1 = 0 Ω y R_CFG2 = 8,25 kΩ sin límite de corriente de entrada, tabla 7-2 de SLVSET3D); con SEL en bajo, la tabla 7-3 salta de 3,3 a 3,6 V. El TPS7A20 (DBV) trae la descarga de 150 Ω de la salida y un pull-down de 500 kΩ en EN (tabla de pines de la hoja); falta confirmar el número de parte de 3,2 V. El EN/UVLO y el OVLO del TPS25947 admiten **6,5 V como máximo**: el EN **no se ata directo a la entrada** y va con un divisor (374 kΩ / 162 kΩ: UVLO de unos 4,0 V; TI pide ≥ 350 kΩ arriba); el OVLO de 1,20 V con 374 kΩ / 100 kΩ da unos 5,69 V. Con un pull-down de 100 kΩ en el EN de la NAND y el EN atado a VREG por el 0 Ω montado, se irían unos 34 µA siempre: en el esquemático el pull-down queda en NAND_EN (P1.03), sin montar, junto con el load switch.
11. Taoglas: dónde va su SAW respecto del LNA (figura de la hoja) y la iteración de ajuste sobre nuestra tierra (costo y plazos). Ganancia, NF, consumo, medidas y plano de tierra ya se verificaron.
12. Patch cerámico plano L1/L5 (Pulse u otro): si es pasivo o activo, sus dimensiones (unos 25 × 25 × 4 mm) y su footprint.
13. Stock y precio de la LC29H(EA) suelta.
14. Que la tabla de pines del Hardware Design V1.0 siga igual en la versión vigente para AA y EA.
15. Si la AA saca crudo y si da velocidad Doppler sin filtrado de más (banco con el HAT).
16. Hoja vigente de Bosch del BMP581 (dirección I2C, rango de VDD y VDDIO, CSB para elegir I2C, INT de drenador abierto, tasa y ruido por modo), la parte de ventilación con membrana para la carcasa, y si el BMP390 entra en el mismo lugar.
17. **Energía**: que el despertar por VBUS del nRF52840 funcione en el banco y que el pulso de 128 µs del /INT alcance para el DETECT; consumo del MAX17048 en sleep y si entra solo con SDA y SCL en bajo; bajo consumo profundo de la W25N04KV y su reposo; corriente de bajo consumo del LSM6DSV320X con la interrupción de movimiento (cifras del 320X, no del LSM6DSV); reposo del BMP581 y del DWM3000; hibernación del MAX17048; fuga entre P0.09 y P0.10 como GPIO; DRV5032FB (consumo a 5 Hz, umbral exacto de la FB, campo del imán a través de carcasa y tela, que los imanes de la base y del conector no lo disparen); imán del chaleco (tamaño, fuerza, recubrimiento que aguante el lavado); tiempos de subida del TPS22916C; tiempos de arranque del TCXO del E22 y de calibración del SX1262; autodescarga de la celda y fuga de su PCM.
18. **Contactos y base**: patrón asimétrico de los 5 pads, su acabado dorado, el valor de la resistencia de DETECT, los resortes de la base, los imanes y su polaridad, y que la base solo admita una posición.
19. **Batería**: proveedor de la celda de 500–600 mAh con UN38.3, IEC 62133 y MSDS, su PCM, su NTC y el conector con llave; ventana de temperatura de carga (JEITA del BQ25180).
20. **Antena LoRa**: la FPC de 45 × 10 mm de Ebyte (medidas, rendimiento en el cuerpo, precio) y los valores del pasabajos o la trampa.
21. **Cristal de 32,768 kHz**: parte con CL ≤ 12,5 pF, ESR ≤ 100 kΩ y C0 ≤ 2 pF, contra el PS.
22. Ruido de banda ancha del SX1262 entre 1,1 y 1,6 GHz.
23. **Antena GNSS por altura**: Taoglas (12 mm) o patch cerámico plano L1/L5 en la placa (unos 25 × 25 × 4 mm); se decide con la envolvente mecánica y el C/N0 del banco.
