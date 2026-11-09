# Pod GNSS + IMU (Fase 3): partes, costos y plan de prototipos

Este documento acompaña al [ADR 0105](../adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md). El relevamiento es del 07/11/2026.

**Sobre los precios:** salen de páginas cacheadas o de agregadores, y muchas no tienen fecha. LCSC devolvió 429 o "part not found" en varias consultas directas. "Sí" quiere decir que la cifra se vio en la fuente citada. **Hay que cotizar en vivo antes de comprar.** Lo que no se pudo confirmar dice "no verificado".

## Partes por pod (100 unidades, US$)


> **Actualización del 09/11/2026**: la placa v0 usa ahora solo partes en stock: u-blox **BMD-340** en lugar del Raytac MDBT50Q, Ai-Thinker **Ra-01SH** en lugar del E22, **LSM6DSV32X** en lugar de la LSM6DSV320X (con el ADXL372 en 2 placas), patch **GVLB258.A**, load switches **TPS22919** y la antena LoRa **Molex 2111400100**. La tabla de abajo es el relevamiento original: lo vigente está en el "Registro de decisiones" del [ADR 0105](../adr/0105-pod-gnss-imu-con-telemetria-en-vivo.md) y en [`pod-v0.md`](pod-v0.md).

| Parte | Elegida | Alternativa | Precio @100 | Fuente | Verificado |
|---|---|---|---|---|---|
| GNSS L1 + L5 | **Quectel LC29H(AA)** (principal; placa lista para la EA) | LC29H(EA) para RTK en vivo; u-blox NEO-F10N-00B-20 solo como comparación en el banco | F10N-20: US$ 18,69–21,36. LC29H(AA): US$ 7,40 | [findchips NEO-F10N](https://www.findchips.com/search/NEO-F10N-00B) · [Ozdisan LC29H(AA)](https://www.ozdisan.com/en/p/gsm-and-gnss-modules-650/quectel-lc29haamd-1574222) | Sí (F10N por agregador) |
| GNSS, otras opciones | LC29H(DA) | Allystar TAU1201 | DA: €20,53. TAU1201: US$ 11–16 | [DigiKey LC29H(DA)](https://www.digikey.jp/en/products/detail/quectel/LC29HDAMD/21272459) · [ichome TAU1201](https://ichome.com/product-detail/allystar/tau1201-1216a00) | Sí |
| GNSS, otras opciones | Unicore UM620N (UC6580A) | — | — | [manual UM620N](https://manuals.plus/unicorecomm/um620n-automotive-grade-dual-frequency-multi-gnss-positioning-module-manual-2) | **No verificado** (sin precio) |
| Antena L1/L5 pasiva en la placa (**principal**, decisión del usuario del 08/11/2026) | Patch apilado **Taoglas GVLB208.A** (20 × 20 × 8,8 mm) + 2 × SAW **B39162B8389P810** (C5556161) + LNA **BGA525N6** (C18337445) + adaptación (4 L de 5,1 nH, 1 L de 10–12 nH, 1 nF, 68 pF, ESD) | Patch de 25 × 25 × 8 mm (Quectel YFGC000WWAM, **no verificado**) | **Estimación**: unos €8–10 menos por pod que la Taoglas activa, y unos 5–8 g menos (sin la carcasa de 35 × 35 × 12 mm ni el cable). Los precios del patch, de los SAW y del LNA a 100 unidades, **no verificados** | [Hoja del GVLB208.A](https://www.taoglas.com/datasheets/GVLB208.A.pdf) | **No verificado** (estimación de costo y peso) |
| Antena L1/L5 activa de 25 × 25 mm (**rescate y referencia de banco**, por el U.FL) | Taoglas AGVLB.25B.07.0060A (LNA de 2 etapas) | Linx ANT-GNCP-C25L15100; Pulse ANT1825JB01BGNL5A (LCSC C3284896, sin precio) | €21,03 @120 / €19,87 @360 (DigiKey). Linx: precio **no verificado** | [DigiKey Taoglas](https://www.digikey.ie/en/products/detail/taoglas-limited/AGVLB-25B-07-0060A/21777673) · [DigiKey Linx](https://www.digikey.fi/en/products/detail/te-connectivity-linx/ANT-GNCP-C25L15100/15294130) | Precio sí. Que tenga SAW, **no verificado** |
| Antena L1/L5 activa china | — | — | US$ 4–8 | — | **No verificado**. Define si se llega a US$ 80 con el F10N |
| MCU + BLE + LoRa | Raytac MDBT50Q-P1MV2 (nRF52840, 48 GPIO) + Ebyte E22-900M22S (SX1262) | Ebyte E73-2G4M08S1C (descartado: 31 GPIO); RAK4630 (otro encapsulado) | MDBT50Q: desde US$ 6,65 (LCSC, -1MV2) a US$ 8,50 @25 (SparkFun); la -P1MV2, precio **no verificado**. E22: desde US$ 4,63. Juntos, unos US$ 11–13, uno a tres dólares más que con el E73 (US$ 5,52) | [LCSC MDBT50Q-1MV2](https://www.lcsc.com/product-detail/C5118826.html) · [JLC MDBT50Q-P1MV2](https://jlcpcb.com/partdetail/RAYTAC-MDBT50QP1MV2/C5119772) · [SparkFun](https://www.sparkfun.com/nordic-nrf52840-ble-module-mdbt50q-1mv2.html) · [LCSC E22](https://www.lcsc.com/product-detail/C411293.html) · [LCSC E73](https://lcsc.com/product-detail/C356849.html) | Precios de la -1MV2, del E22 y del E73 sí. Certificaciones del MDBT50Q -P1MV2 y de los Ebyte, **no verificadas** |
| Load switches y Hall | TPS22916C en el GNSS y en el E22 (montados) y en la NAND (sin montar); **DRV5032FA montado** (Hall del chaleco; la FB no tiene stock el 09/11/2026, [`cotizacion/stock.md`](cotizacion/stock.md)) | DRV5032FB (5 Hz, 0,69 µA), alternativa aprobada cuando vuelva | TPS22916CYFPR: US$ 0,32 @50 y 0,23 @500 en LCSC (C2680319); en la v0 solo va montado el del E22 (el GNSS se corta por el EN de su LDO). DRV5032FA: US$ 0,12 @150 en LCSC (C140921, 47.205 en stock); la FB, sin stock en LCSC y DigiKey hasta 2027 | [LCSC C2680319](https://www.lcsc.com/product-detail/C2680319.html) · [JLCPCB C2655033](https://jlcpcb.com/partdetail/C2655033) | Sí (08/11/2026, [`cotizacion/`](cotizacion/costos.md)) |
| LED de estado | XINGLIGHT XL-1615RGBC-RF (RGB) + 3 NMOS + 3 resistencias 0402 | Segundo LED y buzzer sin montar | LED: US$ 0,012–0,016 (LCSC); con los NMOS y las resistencias, unos US$ 0,10–0,20 (**no verificado**) | [LCSC C965840](https://www.lcsc.com/product-detail/C965840.html) | Precio del LED sí; el resto, **no verificado** |
| IMU con alto rango | ST LSM6DSV320X (±2–16 g y ±32–320 g, canales independientes) | ICM-42688-P + ADXL372 | US$ 7,25 (LCSC C26633007). Alternativa: ICM US$ 2,1–3,4 (datos contradictorios) + ADXL372 US$ 11,65 | [ST](https://estore.st.com/en/lsm6dsv320xtr-cpn.html) · [LCSC LSM6DSV320X](https://www.lcsc.com/product-image/C26633007.html) · [LCSC ADXL372](https://www.lcsc.com/product-detail/C579465.html) | Sí. Stock bajo (45 en LCSC) |
| Barómetro | Bosch BMP581 | Infineon DPS368; BMP390 | US$ 1,23 (LCSC C5362283). DPS368: US$ 2,59 (C3232508) | [LCSC C5362283](https://www.lcsc.com/product-image/C5362283.html) · [LCSC DPS368 C3232508](https://www.lcsc.com/product-image/C3232508.html) | Precio sí; la hoja vigente de Bosch, **no verificada** |
| Memoria NAND SPI | Winbond W25N02KVZEIR (2 Gbit, la del diseño: unas 8 sesiones de 3 h) | W25N04KVZEIR (4 Gbit, en el mismo lugar, para una variante de más capacidad) o GigaDevice GD5F4GQ6UEYIGR | US$ 7,81 a 100 y 11,57 a 1 (LCSC C3010298, 08/11/2026). La W25N04KV, 14,59 a 100 (C6750381) | [LCSC W25N02](https://www.lcsc.com/product-detail/C3010298.html) · [hoja W25N02KV](https://www.winbond.com/resource-files/W25N02KVxxIRU_Datasheet_20210625_G.pdf) · [hoja W25N04KV](https://www.winbond.com/resource-files/W25N04KVxxIRU_Datasheet_20220207_RevC.pdf) | Precios sí. Geometría, pines y comandos de las dos Winbond, sí (hojas Rev. G y Rev. C). GigaDevice, **no verificada** |
| Cargador | TI BQ25180 | TP4056 | US$ 1,52–2,20 | [LCSC BQ25180](https://www.lcsc.com/product-detail/C3682423.html) | Sí |
| Medidor de carga | MAX17048G+T10 | — | ≈ US$ 1,35 | [LCSC MAX17048](https://lcsc.com/product-detail/image/MAX17048G-T10_C2682616.html) | Sí |
| Batería | LiPo de **500–600 mAh** (decisión del usuario) con PCM y NTC, de un proveedor con informe **UN38.3 e IEC 62133** y MSDS | — | ≈ US$ 5 (precio minorista de una celda de 1000 mAh; la de 500–600 mAh de un proveedor con informes, **no verificado**) | [Core Electronics](https://core-electronics.com.au/catalog/product/view/sku/CE06795) | Parcial: precio y proveedor, **no verificados** |
| Antena LoRa 915 | **FPC de 45 × 10 mm** (Ebyte TX915-FPC-4510) | FPC de 15 × 65 mm con IPEX (≈ US$ 1,2; demasiado larga para la placa) | Precio de la de 45 mm, **no verificado** | [Core Electronics](https://core-electronics.com.au/915mhz-ufl-antenna.html) (la de 65 mm) | Medidas y precio de la de 45 mm, **no verificados** |
| Contactos del pod (única conexión, sin USB-C) | **5 pads planos dorados** en la placa (VBUS, D+, D−, GND, DETECT); los resortes pogo (por ejemplo Xinyangze YZ103915020T, C6276862) van en la base | Switch de entrada de VBUS con OVP y TVS en los pads | Pads: costo del acabado dorado del PCB. Switch y TVS: **no verificados** | — | **No verificado** |
| PCB de 4 capas + armado | JLCPCB Standard | PCBWay | US$ 25 de setup por cara y US$ 1,5–3 por parte extendida: unos US$ 6–10 por placa | [JLCPCB](https://jlcpcb.com/help/article/40-pcb-assembly-price) | Tarifas sí. El total por placa es una **estimación** |
| Carcasa | MJF PA12 en JLC3DP, con junta | — | US$ 0,275/g, unos US$ 6–10 con 20–35 g | [JLC3DP](https://jlc3dp.com/blog/drastic-material-price-cuts-and-adjusted-post-processing-service-fees) | Precio por gramo sí. Los gramos son **estimados** |
| UWB opcional (sin montar en la primera tanda) | Qorvo DW3110 + antena chip + cristal | QM33110 (sucesor, sin precio); DW1000 descartado | Chip: US$ 6,64 @100 (LCSC; precio no confirmado en la revisión) / US$ 8,77 @100 (RFMW). Con antena, cristal, pasivos y armado: unos US$ 9–12 | [LCSC DW3110](https://www.lcsc.com/product-detail/C3040882.html) · [RFMW DW3110](https://www.rfmw.com/ProductDetail/DW3110-Qorvo/691974) · [Qorvo QM33110W](https://www.qorvo.com/products/p/QM33110W) | Chip sí. El resto, **no verificado** |

### Total por pod

Sin pasivos de detalle, chaleco ni banda de FC:

- **De abajo hacia arriba, con la lista completa de la v0** ([`cotizacion/costos.md`](cotizacion/costos.md), precios de LCSC, JLCPCB y DigiKey del 08/11/2026): las **partes** (139 componentes, 55 distintos, con el patch pasivo, sin UWB, con la AA) dan **US$ 84,08 por placa con 5, 73,44 con 10 y 61,30 con 100** (con la DRV5032FA del 09/11/2026), con la NAND de 2 Gbit. Con la placa, el armado y el envío estimados, la placa armada queda en unos **US$ 80–95 a 100** y el pod completo (batería, carcasa y etiqueta) en unos **US$ 91–111**, sin impuestos argentinos: arriba de la meta de US$ 80. Lo que más pesa es la LC29H(AA) (12,25), el patch GVLB208.A (11,79, solo DigiKey), la **NAND** W25N02KV (7,81 a 100 en LCSC; la de 4 Gbit costaría 14,59, +6,78), la LSM6DSV320X (6,72, sin stock) y el MDBT50Q-P1MV2 (6,00, DigiKey Marketplace). Los totales de abajo quedan como estimación original.

- **Optimista y de la decisión, unos US$ 75–85:** LC29H(AA) + MDBT50Q + E22 + LSM6DSV320X + antena Taoglas, con la **NAND de 2 Gbit** (la del diseño). **Con el patch pasivo como antena principal** (decisión del 08/11/2026), la antena y su cadena cuestan unos €8–10 menos (estimación): unos US$ 66–76. El rango va del PCB y la carcasa en su extremo bajo al alto. La antena se convirtió de € a US$ en forma aproximada. El MDBT50Q en lugar del E73 suma unos US$ 1–3, y el LED con sus NMOS unos centavos.
- **Con la EA:** se suma la diferencia con la AA: **US$ 12,41 por pod a 100** (EA a US$ 24,66 en LCSC, C28453488, contra la AA a 12,25 en DigiKey; leído el 08/11/2026).
- **Pesimista, unos US$ 113 (los extremos altos de la tabla), solo como referencia:** NEO-F10N-20 + RAK4630 + antena Linx, cuyo precio **no está verificado** (se tomó igual al de la Taoglas).
- **Lo que más pesaba era la antena GNSS de marca** (€19,87–21,03); con el patch pasivo en la placa queda como rescate. Con el F10N, los US$ 80 se alcanzan solo con una antena L1/L5 activa china de US$ 4–8, cuyo precio no está verificado. Cambiar el MDBT50Q + E22 por el RAK4630 suma unos US$ 6–12.
- **Con UWB montado** se suman unos US$ 9–12 por pod. Los totales de arriba son sin UWB.

## Equipo compartido

| Equipo | Cantidad | Precio | Fuente |
|---|---|---|---|
| Gateway LoRa de 8 canales SX1302: RAK7268V2 (alternativa: RAK2287 + Raspberry Pi) | 1 por cancha | US$ 139; versión US915 sin LTE, US$ 169,99. RAK2287: US$ 84–99 | [hackster](https://hackster.io/products/buy/97716) · [RAK](https://store.rakwireless.com/products/wislink-concentrator-module-sx1302-rak2287-lorawan) |
| Mástil de 3–5 m para el gateway | 1 por cancha | — | **No verificado** |
| Bases de carga y descarga (resortes pogo contra los pads del pod; VBUS solo con DETECT) | ~5 de 20 lugares | Diseño propio: costo **no verificado** | — |
| Base de la cancha y referencia: **Quectel LG290P** (4 bandas, crudo a 10–20 Hz según el foro, **no verificado**) con antena L1/L2/L5 | 1 por cancha | Módulo US$ 67–107 en DigiKey; breakout de Waveshare unos US$ 90 | [DigiKey](https://www.digikey.bg/en/product-highlight/q/quectel/lg290p-03-gnss-module) · [CNX Software](https://www.cnx-software.com/2025/11/25/waveshare-low-cost-lg290p-gnss-rtk-breakout-board-rtc-battery-support/) |
| Chalecos con bolsillo entre los omóplatos | 100 o más (talles) | **No verificado** | — |
| Imán del bolsillo (neodimio **encapsulado** o recubierto, cosido o pegado en el fondo del bolsillo, en una posición fija frente al Hall del pod) | 1 por chaleco | Centavos por imán; tamaño y fuerza se eligen en el banco; que aguante el lavado, **no verificado** | — |
| Anclas UWB (solo donde haya deporte bajo techo) | unas 4–6 en una cancha cubierta de 40 × 20 m (**no verificado**) | US$ 50–150 cada una en diseño propio, más la sincronización: **no verificado** | — |
| Tablet del staff | 1 por cancha | La del club | — |

**Quedan afuera del precio en origen:** la importación a Argentina (impuestos y régimen de courier, a revisar con un despachante), las vueltas de prototipo y la homologación ante ENACOM.

## Volumen de datos y memoria

| Flujo | Cálculo | Tasa |
|---|---|---|
| IMU (6 ejes, 16 bits, 100 Hz) | 6 × 2 B × 100 Hz | 1,2 kB/s |
| Canal de alto rango (3 ejes, 16 bits, 100 Hz de base; ráfagas al detectar un impacto) | 3 × 2 B × 100 Hz | 0,6 kB/s |
| Solución GNSS (10 Hz, unos 40 B) | 40 B × 10 Hz | 0,4 kB/s |
| Barómetro (presión y temperatura, 50 Hz, unos 6 B) | 6 B × 50 Hz | 0,3 kB/s |
| **Sin crudo GNSS** | | **≈ 2,5 kB/s → unos 27 MB en 3 h** |
| Crudo GNSS (RAWX a 1 Hz, unos 30 satélites × 2 frecuencias × unos 32 B) | ≈ 2 kB por época | ≈ 2 kB/s |
| **Con crudo a 1 Hz** | | **≈ 4,5 kB/s → unos 49 MB en 3 h** |

- **Memoria:** la v0 lleva la **W25N02KV de 2 Gbit** (256 MB: 2048 bloques de 64 páginas de 2048 B más 128 B de repuesto, [hoja de Winbond](https://www.winbond.com/resource-files/W25N02KVxxIRU_Datasheet_20210625_G.pdf)). Con los registros del formato v1 del log (`packages/pod-protocol`: unos 2,9 kB/s, o 4,9 kB/s con crudo a 1 Hz, por los encabezados y las marcas de tiempo), cada sesión de 3 h empieza en un bloque nuevo y ocupa 242 bloques (413 con crudo). Descontando los 8 bloques del índice y 40 de bloques malos (el máximo de la hoja: 2008 válidos como mínimo, unos 2 %), quedan 2000 y entran **8 sesiones de 3 h sin crudo** (unas 25 h) y **4 con crudo** (unas 14,5 h); con las tasas de la tabla, sin encabezados, serían 9 y 5. Es el margen si un pod no pasa por la base entre sesiones. La W25N04KV de 4 Gbit (mismo lugar, mismos comandos, 18 bits de página) da 16 y 9 para una variante de más capacidad. Crudo a 10 Hz serían unos 20 kB/s, unos 216 MB por sesión: impráctico, y además no vale la pena, porque el PPK corrige la trayectoria y la velocidad sale del Doppler a 10 Hz.
- **Descarga:** 49 MB por BLE, a unos 100 kB/s en la práctica, son unos 8 min por pod. Por eso la descarga va por la base.
- **Telemetría en vivo:**
  - Un resumen por segundo de unos 20 B, que se manda de a 2: unos 40 B cada 2 s.
  - 40 B en SF7 / 125 kHz ocupan unos 82 ms en el aire. Con turnos de unos 100 ms (con tiempo de guarda), una trama de 2 s tiene 20 turnos por canal: **unos 160 pods en 8 canales**.
  - 30 pods ocupan cerca del 15 % de cada canal. Cada 1 s sería el 31 %, con capacidad para unos 80 pods.
- **Batería:** 500–600 mAh (decisión del usuario). El consumo estimado en actividad es de unos 35–45 mA con el patch pasivo y el LNA de la placa (2,3 mA), unos 50–60 mA con los 18 mA del LNA de la Taoglas (`pod-v0.md`): unas 11–17 h (8–12 h con la Taoglas) para un objetivo de 4–5 h.

## GNSS: qué se sabe de la salida cruda

- **LC29H** ([Quectel](https://www.quectel.com/product/gnss-lc29h)):
  - Variantes:
    - AA: sin RTK, 24 mA.
    - BA: RTK y dead reckoning, 32 mA.
    - CA: dead reckoning, 30 mA.
    - DA: RTK a 1 Hz como rover, 30 mA.
    - EA: RTK a 1–10 Hz y heading con dos módulos, 30 mA.
    - BS: base.
  - Todas posicionan a 10 Hz. La salida cruda de 1 Hz figura **para la serie**: personal de Quectel confirmó en el foro que la salida RTCM solo sale a 1 Hz.
  - **Para la AA, no verificado:** el hilo del foro es sobre la EA. Ahí el camino es el modo base (`$PQTMCFGRCVRMODE,W,2`) con MSM7 (`$PAIR432,1`). Hay reportes de que la configuración no persiste o vuelve a MSM4 ([foro de Quectel](https://forums.quectel.com/t/lc29h-ea-rtcm3-out/33710)).
- **NEO-F10N:**
  - Solo la variante **-00B-20** da fase portadora (`UBX-RXM-RAWX`). La -00B-00, que es la de la placa de SparkFun, no ([u-blox](https://www.u-blox.com/en/technologies/gnss-raw-data)).
  - Navega a 10 Hz en multi-constelación, con 21–26 mA medidos en la placa ([SparkFun](https://docs.sparkfun.com/SparkFun_u-blox_NEO-F10N/hardware_overview)).
  - La tasa máxima de RAWX **no está verificada**.
- **LG290P** ([especificación](https://www.quectel.com.cn/wp-content/uploads/2024/12/Quectel_LG290P系列_GNSS_模块产品规格书_V1.4.pdf)): 4 bandas (L1/L2/L5/E6), RTK, unos 98 mA. Según el [foro de Quectel](https://forums.quectel.com/t/lg290p-10-20-hz-raw-carrier-phase-observations-and-multi-receiver-synchronization/61346), saca pseudodistancia, fase portadora, Doppler y C/N0 a 10 o 20 Hz (**no verificado** contra la hoja de datos). Va como base y referencia, no en el pod.
- **Placa lista para la EA:** las variantes del LC29H comparten el encapsulado de 12,2 × 16,0 × 2,5 mm ([V1.8](https://quectel.com.cn/wp-content/uploads/2021/08/Quectel_LC29H系列_GNSS_模块产品规格书_V1.8.pdf), [V1.2](https://quectel.com/content/uploads/sites/3/2022/06/Quectel_LC29H_GNSS_Specification_V1.2.pdf)). Los pines uno a uno están **no verificados**: hay que revisar el *LC29H Hardware Design* antes del diseño de la placa.
- **TAU1201/1202:** Allystar los presenta como "standard precision". La salida cruda MSM figura para la TAU1303 ([GPS World](https://www.gpsworld.com/?p=70293)). Se descartan como opción con crudo.
- **UM620N:** salida cruda y precio **no verificados**.

## Argentina: regulación y RAMSAC

- **Banda:** la Res. 581/2018, citada en la [Res. 1132/2023](https://www.boletinoficial.gob.ar/detalleAviso/primera/292414/20230818), declaró **915–928 MHz de uso compartido, sin autorización**. 902–915 MHz tiene otro régimen. Que Argentina use el plan AU915 lo dice una fuente de terceros (Meshtastic), no la LoRa Alliance. Igual el pod no usa LoRaWAN, sino canales propios dentro de 915–928.
- **Normas técnicas:**
  - ENACOM-Q2-60.14 para baja potencia (Res. 551/2021; la V21.1 reemplaza a la V20.1 según Eleos);
  - Q2-63.03 V23.1 para salto de frecuencia (Res. 1132/2023).
  - **La potencia máxima no está verificada.**
  - **Tampoco está verificado si se pueden usar canales fijos.** Las reglas de salto de frecuencia o de tiempo de permanencia por canal (Q2-63.03, parecidas a la FCC 15.247) podrían obligar a cambiar de canal en cada trama. La banda útil es de solo 13 MHz. Los +30 dBm EIRP de AU915 que cita Actility no son el límite argentino.
- **Homologación: nuevo RAMATEL** (Res. 57/2026, vigente desde el 01/12/2026 según la Res. 843/2026; [anexo](https://servicios.infoleg.gob.ar/infolegInternet/anexos/420000-424999/423392/res57-1.pdf)):
  - **Comercializar**, que incluye "dar en comodato", exige **Homologación**: certificado de una agencia reconocida (Clase A) con ensayo de laboratorio.
  - El **uso propio** sin comercializar tiene la **Autorización** por modelo o familia, con la Declaración de Conformidad del fabricante.
  - El reglamento no trata los módulos pre-certificados, y lo que se registra es el equipo final. Que alcance el FCC/CE de un módulo **no está verificado**, y probablemente no alcance.
- **RAMSAC** (IGN):
  - **RINEX de 1 s** en sesiones de 2 h, unos 8 MB por día, además de los de 15 s ([preguntas frecuentes](https://www.ign.gob.ar/NuestrasActividades/Geodesia/Ramsac/faq)). Hay estaciones en CABA (IGM0/IGM1), a unos 15 km de Munro según una estimación.
  - **NTRIP:** el caster es `ntrip.ign.gob.ar:2101`, con registro y un máximo de 8 h continuas, según [una presentación de 2011](https://www.sirgas.org/fileadmin/docs/Boletines/Bol16/Pinon_Cimbaro_RAMSAC-NTRIP_Argentina_2011.pdf).
  - Si las estaciones rastrean L5/E5a y si el servicio tiene costo están **no verificados**. Por eso se suma una base propia en la cancha.

## Validación publicada

No se encontraron estudios de GNSS de doble banda de bajo costo en deportes. Lo más cercano:

- [Padulo et al. 2019](https://pmc.ncbi.nlm.nih.gov/articles/PMC6413575): un receptor económico de 50 Hz y una sola frecuencia, con un error estándar de distancia del 0,73 %.
- [Una revisión de 2018](https://www.frontiersin.org/articles/10.3389/fphys.2018.01425/pdf): la mayoría de los equipos deportivos usan una sola frecuencia, y los receptores baratos a 1 Hz tienen una latencia de hasta 2,16 s.

**La validación es nuestra.**

## Plan de prototipos

1. **Banco mínimo** (unos US$ 420 en origen; ver [`banco-gnss.md`](banco-gnss.md), "Compra reducida"): un LC29H(AA) en placa y los dos LG290P. En paralelo se diseña la **v0** ([`pod-v0.md`](pod-v0.md)). La lista completa de abajo queda como referencia si la v0 no alcanza:
   - LC29H(AA) ×2, LC29H(EA), dos LG290P (base en trípode y referencia en el chaleco), y NEO-F10N para comparar, con las antenas Taoglas, un RAK4631 (WisBlock) y una placa con el LSM6DSV320X.
   - **Medir:**
     - si el AA saca crudo, a qué tasa y si la configuración persiste;
     - el RTK de la EA con el LG290P de base: % de "fixed" y bytes/s de RTCM;
     - hasta qué tasa sale RAWX en el F10N;
     - el consumo real (estimado en 50–60 mA) y que la batería de 500–600 mAh alcance;
     - si transmitir LoRa satura la entrada del GNSS, con y sin el SAW.
2. **Cancha, lado a lado** (en el club):
   - Un jugador de primera lleva **el Catapult y nuestro pod a la vez**, en sesiones de entrenamiento y en un partido.
   - Sprints con **fotocélulas**.
   - El LG290P como base al costado, y el RINEX de RAMSAC del mismo día como respaldo.
   - **Comparar:** distancia, HSR, Vmax, aceleraciones y desaceleraciones, y contactos (estos contra video).
   - Con esos datos se elige el GNSS y la antena, y el ADR 0105 se acepta o se reemplaza.
3. **Placa propia, directo a la v0 con módulos en PCBWay** ([`pod-v0.md`](pod-v0.md)): 10 placas, 5 armadas (AA, EA y una con UWB), con lugares de rescate para no necesitar una vuelta intermedia. Después, las vueltas que hagan falta (en PCBWay o JLCPCB) con la carcasa MJF, la base de carga y descarga y el turno LoRa probado con 10–30 placas.
4. **Piloto con unos 10 pods** en una categoría, en vivo durante los partidos, más la descarga y el PPK.
5. **Tanda de 100**, después de definir el modo de entrega a los clubes y presupuestar la homologación ante ENACOM.

## Riesgos abiertos

1. El crudo del LC29H está limitado a 1 Hz (dato de la serie). Para la AA, el crudo en modo base no está verificado, y en la EA la configuración no es estable entre firmwares.
2. La tasa de RAWX del F10N no está confirmada, y el stock de la variante -20 es incierto (Avnet: mínimo de 500 unidades y 19 semanas).
3. El costo de la antena L1/L5 definía el objetivo de US$ 80; con el patch pasivo baja unos €8–10 (estimación), y el riesgo pasa a ser cuánto pierde el patch en L5 sobre la tierra chica de la placa (se mide en el arranque de la v0 contra la Taoglas).
4. El LSM6DSV320X tiene stock bajo; el respaldo es el ICM-42688-P + ADXL372.
5. Las certificaciones del E22 y de la variante -P1MV2 del MDBT50Q no están verificadas.
6. La homologación ante ENACOM del equipo final, si se presta o se vende.
7. La potencia máxima en 915–928 MHz no está confirmada.
8. No se sabe si RAMSAC rastrea L5.
9. La validación propia es obligatoria.
10. Los turnos en canales fijos podrían no cumplir las reglas de salto o permanencia de la norma.
11. El packet forwarder del gateway tiene que dejar pasar tramas que no son LoRaWAN, con una sync word privada.
12. **Privacidad:** son trazas de posición de menores. Van cifradas por el aire, sin nombres, la pantalla es solo para el staff, con consentimiento y retención definidos (ADR 0105).
13. UWB: no se sabe si ENACOM permite UWB en los canales 5 y 9; el DW3110 estaba sin stock en LCSC y en RFMW y el QM33 no tiene precio relevado.
14. La placa lista para la EA depende de que AA y EA tengan los mismos pines (**no verificado**).
15. No se encontró una placa de prueba con la EA a la venta, ni el precio del módulo suelto.
