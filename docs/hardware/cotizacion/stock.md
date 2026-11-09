# Stock de las partes del pod v0 (B-909)

Auditoría de stock de cada parte de la lista de armado ([`bom-pod-v0.csv`](bom-pod-v0.csv)) y de lo que no se suelda ([`bom-pod-v0-extras.csv`](bom-pod-v0-extras.csv)), leída el **09/11/2026** para la corrida de **100 pods más las 5 placas de la v0** (105 placas). Responde dos preguntas: si hoy hay stock de todo (o se consigue en pocas semanas) y, para lo que no, qué alternativas hay y si entran en la placa tal como está.

Parte del paquete de cotización: los precios están en [`costos.md`](costos.md), el pedido en [`pedido-pcbway.md`](pedido-pcbway.md) y los mails en [`consultas.md`](consultas.md).

Con la regla de que cada parte tiene que estar disponible **hoy** (al menos 150 comprables, sin esperar plazos de fábrica), las alternativas en stock para todo lo que no es el bloque de MCU y LoRa, con su costo, están en [`alternativas-en-stock.md`](alternativas-en-stock.md): entre ellas la **LSM6DSV32X** pin a pin en lugar de la LSM6DSV320X y el patch **GVLB258.A** en lugar del GVLB208.A.

## Cómo se leyó

| Fuente | Cómo | Resultado |
|---|---|---|
| LCSC | Página de producto de cada código (`lcsc.com/product-detail/<código>.html`, los mismos datos que su API de la página) | Todas las partes con código LCSC |
| JLCPCB | Buscador de partes de su armado (`jlcpcb.com/parts`) | Las de riesgo y las alternativas. **Ojo**: el stock de JLCPCB es para armar en JLCPCB; PCBWay no lo puede comprar |
| DigiKey | Página de búsqueda o de producto (`digikey.com/en/products/result?keywords=<MPN>`) | Las de riesgo, las alternativas y las integradas con poco stock en LCSC. Las demás quedan con el número del 08/11/2026 (`partes_pod_v0.csv`) |
| Mouser | `mouser.com/ProductDetail/<MPN>` y el buscador | **No se pudo leer**: "Access Denied" con captcha, y dos reintentos agotaron el tiempo. Queda para el mail de la sección 8 de `consultas.md` |
| Findchips | `findchips.com/search/<MPN>` | Lo que muestra sin sesión: el **eStore de ST**, **TME** y brokers (no autorizados) |
| Octopart, TME, st.com | — | 403 o sin respuesta: TME se cita por Findchips |
| ti.com | `ti.com/product/DRV5032/part-details/DRV5032FBDBZR` | Sin stock (la cantidad exacta pide sesión) |

Las hojas de datos para comparar los pines se bajaron de LCSC (las de ST y TI son las mismas revisiones que publican los fabricantes): ST **DS14623 Rev 1** (LSM6DSV320X), **DS14764 Rev 1** (LSM6DSV80X), **DS13510 Rev 4** (LSM6DSV16X); TI **SLVSDC7H** (DRV5032), **ZHCSOO8D** (TMAG5231), **SLVSDO5F** (TPS22916); Infineon BGA525N6.

### Criterio

Lo que hace falta es la cantidad por placa × 105, más 10 por fila en las pasivas chicas (el desperdicio del armador).

- **✓ OK**: una fuente que PCBWay puede comprar (LCSC, DigiKey, TME, la tienda del fabricante) tiene stock para lo que hace falta, y además hay una segunda fuente con stock o esa fuente tiene **10 veces** lo que hace falta (no se agota de un día para otro). Las resistencias y los capacitores de valores comunes cuentan con sus equivalentes genéricos.
- **⚠ LIMITADO**: hay stock para lo que hace falta pero en una sola fuente con menos de 10 veces, o la cifra no se pudo confirmar, o el stock está solo en JLCPCB, un Marketplace o brokers.
- **✗ SIN STOCK**: ninguna fuente que PCBWay pueda comprar cubre lo que hace falta y el plazo es de **más de 4 semanas**.

## Resumen

- **Dos partes sin stock**: la IMU **LSM6DSV320X** (`U401`) y el Hall **DRV5032FB** (`U406`). El Hall se resuelve en el diseño: **la DRV5032FA pasa a ser la montada** (misma hoja, pines, umbrales y footprint; +0,9 µA) y la FB queda como alternativa aprobada para cuando vuelva. La IMU tiene dos respaldos pin a pin, en este orden: la **LSM6DSV80X** (mismo die, ±80 g; hoy 194 entre el eStore de ST y un distribuidor no verificado) y la **LSM6DSV16X con el ADXL372** (en stock); ninguno se monta sin decidirlo al cerrar la v0.
- **Seis limitadas**: el patch **GVLB208.A**, el GNSS **LC29H(AA)**, el **MDBT50Q-P1MV2**, el **E22-900M22S**, el load switch **TPS22916C** y la FPC de LoRa **TX915-FPC-4510**. Todas tienen stock para las 105 hoy, pero en una sola fuente o sin cifra: se reservan.
- **El resto, OK**. El **BGA525N6** y el **TPS7A2032P** dan OK por cantidad pero dependen de **una sola fuente** (LCSC y DigiKey) y no tienen alternativa directa: se compran ya.
- **La placa no cambia de footprint ni de netlist**: solo cambia el número de parte del Hall (`U406`). Se agregan como **alternativas aprobadas** para el armador (columna `Approved Alternate` de la lista) solo las verificadas pin a pin, en el mismo footprint y con la misma función: DRV5032FB (de la FA), Yageo RC0402FR-0722RL (22 Ω), el cristal ABS06 y la bobina DFE201610E; y la **MDBT50Q-1MV2** con una condición (solo con nuestro OK, por el keep-out de la antena). Las demás quedan documentadas con lo que cambia.

## Tabla por parte

La genera `hardware/tools/bom_pcbway.py` desde las columnas de stock de [`partes_pod_v0.csv`](../../../hardware/tools/datos/partes_pod_v0.csv) (`stock_*`, `plazo`, `estado_stock`, `alternativa_directa`, `alternativas_otras`); el CI falla si queda desactualizada. Primero lo que no tiene stock.

<!-- generado por hardware/tools/bom_pcbway.py: no editar a mano -->

| Parte | Lugar | Hacen falta (105 placas) | Estado | LCSC | DigiKey | JLCPCB | Otras fuentes | Plazo | Alternativa directa | Otras alternativas |
|---|---|---|---|---|---|---|---|---|---|---|
| `LSM6DSV320XTR` | U401 | 105 | ✗ SIN STOCK | 0 | 0 | 3 | ST eStore 26 | DigiKey 24 semanas (admite pedido pendiente) | — | 1.ª LSM6DSV80XTR (pin a pin, mismo die y WHO_AM_I 73h, ±80 g; ST eStore 34 + IBS 160); 2.ª LSM6DSV16XTR (pin a pin, ±16 g) con el ADXL372 montado en U403 |
| `TX915-FPC-4510` | (no se suelda) | 105 | ⚠ LIMITADO | — | — | 0 | Tienda de Ebyte en Alibaba: 5 días hasta 50, 12 días hasta 1.000 (sin cifra de stock; no verificado) | — | — | Molex 2111400100 (U.FL, otro tamaño; DigiKey 5.706) |
| `GVLB208.A` | AE201 | 105 | ⚠ LIMITADO | — | 271 | — | Taoglas directo (a consultar) | DigiKey 16 semanas | — | Ninguna en el mismo footprint; patch de 25 × 25 mm con otro footprint, o la AGVLB.25B activa por el U.FL |
| `LC29HAAMD` | U201 | 105 | ⚠ LIMITADO | 91 | 522 | 91 | — | DigiKey 14 semanas | — | LC29HEAMD en el mismo footprint (RTK, +12,41 a 100) |
| `MDBT50Q-P1MV2` | U301 | 105 | ⚠ LIMITADO | 0 | 37 | 0 | TME 1.239 (Findchips; la página de TME no abre); Raytac directo | DigiKey Marketplace unos 14 días | `MDBT50Q-1MV2` (only with our written OK (antenna keep-out differs)) | — |
| `E22-900M22S` | U302 | 105 | ⚠ LIMITADO | 517 | — | 517 | Tienda de Ebyte (sin cifra de stock) | — | — | Ninguna en el mismo footprint (otro módulo SX1262 cambia la placa) |
| `TPS22916CYFPR` | U303 | 105 | ⚠ LIMITADO | 1.040 | 0 | 1.042 | Brokers (Bristol 270) | DigiKey: 3.000 el 07/12/2026 (26 semanas) | — | TPS22916BYFPR (mismos pines, encendido rápido); TPS22916CNYFPR (mismos pines, sin QOD) |
| `AGVLB.25B.07.0060A` | (no se suelda) | 42 | ✓ OK | — | 558 | — | — | DigiKey 16 semanas | — | — |
| `LQW15AN10NG00D` | (no se suelda) | 210 | ✓ OK | 88.800 | 1.233 | — | — | — | — | — |
| `LQW15AN12NG00D` | (no se suelda) | 210 | ✓ OK | 17.800 | 88.904 | — | — | — | — | — |
| `0402WGF374JTCE` | (no se suelda) | 210 | ✓ OK | 7.300 | — | — | — | — | — | — |
| `NCP15XH103F03RC` | (no se suelda) | 210 | ✓ OK | 281.050 | — | — | — | — | — | — |
| `PESD5V0F1BL,315` | (no se suelda) | 210 | ✓ OK | 62.835 | — | — | — | — | — | — |
| `CL05A105KA5NQNC` | C101 y otros | 955 | ✓ OK | 2.908.400 | — | — | — | — | — | — |
| `CL10A106KP8NNNC` | C102, C105, C201, C306 | 430 | ✓ OK | 1.019.720 | — | — | — | — | — | — |
| `CL10A226MQ8NRNC` | C106 | 115 | ✓ OK | 3.991.780 | — | — | — | — | — | — |
| `CL05B104KO5NNNC` | C202 y otros | 1.795 | ✓ OK | 3.026.000 | — | — | — | — | — | — |
| `CL05C330JB5NNNC` | C203, C206 | 220 | ✓ OK | 269.900 | — | — | — | — | — | — |
| `CL10A475KO8NNNC` | C204, C301, C303 | 325 | ✓ OK | 755.010 | — | — | — | — | — | — |
| `GRM1555C1H101JA01D` | C217 | 115 | ✓ OK | 993.550 | — | — | — | — | — | — |
| `GRM1555C1H102JA01D` | C218 | 115 | ✓ OK | 570.200 | — | — | — | — | — | — |
| `GRM1555C1H680JA01D` | C219 | 115 | ✓ OK | 39.200 | — | — | — | — | — | — |
| `CL05C180JB5NNNC` | C304, C305 | 220 | ✓ OK | 231.100 | — | — | — | — | — | — |
| `CL10A105KA8NNNC` | C602 | 115 | ✓ OK | 3.645.800 | — | — | — | — | — | — |
| `PGB1010402KR` | D203 | 115 | ✓ OK | 78.320 | 362.611 | — | — | — | — | — |
| `SMF12A` | D601 | 105 | ✓ OK | 7.960 | 51.230 | — | — | — | — | — |
| `PESD5V0S1BL,315` | D602 | 115 | ✓ OK | 73.480 | 18.868 | — | — | — | — | — |
| `B39162B8389P810` | FL201, FL202 | 210 | ✓ OK | 218 | 7.710 | 218 | — | DigiKey 8 semanas | — | Ninguna en el mismo footprint con L1 + L5 (las B39162 de 1109 y 1411 en stock son solo L1) |
| `SM03B-GHS-TB(LF)(SN)` | J101 | 105 | ✓ OK | 25.545 | 0 | — | — | — | — | — |
| `SM04B-SRSS-TB(LF)(SN)` | J201 | 105 | ✓ OK | 71.715 | 104.820 | — | — | — | — | — |
| `U.FL-R-SMT-1(10)` | J202, J302 | 210 | ✓ OK | 17.470 | 332.838 | — | — | — | — | — |
| `DFE201612E-2R2M=P2` | L101 | 115 | ✓ OK | 12.480 | — | — | — | — | `DFE201610E-2R2M=P2` | — |
| `LQW15AN5N1C00D` | L202, L203, L205, L206 | 430 | ✓ OK | 8.280 | 60.810 | — | — | DigiKey 25 semanas | — | — |
| `LQW15AN11NG00D` | L204 | 115 | ✓ OK | 40.680 | 0 | — | — | — | — | — |
| `XL-1615RGBC-RF` | LED301 | 105 | ✓ OK | 693.500 | — | — | — | — | — | — |
| `AO3400A` | Q201, Q301, Q302, Q303 | 420 | ✓ OK | 460.780 | 169.465 | — | — | — | — | — |
| `0402WGF0000TCE` | R103 y otros | 2.740 | ✓ OK | 8.561.100 | — | — | — | — | — | — |
| `0402WGF8251TCE` | R106 | 115 | ✓ OK | 23.200 | — | — | — | — | — | — |
| `0402WGF1622TCE` | R107 | 115 | ✓ OK | 1.900 | — | — | — | — | — | — |
| `0402WGF1003TCE` | R111 y otros | 1.375 | ✓ OK | 1.817.600 | — | — | — | — | — | — |
| `0402WGF4701TCE` | R301, R302 | 220 | ✓ OK | 7.943.400 | — | — | — | — | — | — |
| `0402WGF1001TCE` | R310, R311, R312 | 325 | ✓ OK | 21.584.800 | — | — | — | — | — | — |
| `0402WGF4702TCE` | R409 | 115 | ✓ OK | 4.016.500 | — | — | — | — | — | — |
| `0402WGF220JTCE` | R501 | 115 | ✓ OK | 0 | — | 3.280.248 | — | — | `RC0402FR-0722RL` | — |
| `0402WGF1002TCE` | R502, R503, R601 | 325 | ✓ OK | 1.442.800 | — | — | — | — | — | — |
| `0402WGF3743TCE` | R602, R604 | 220 | ✓ OK | 13.600 | — | — | — | — | — | — |
| `0402WGF1623TCE` | R603 | 115 | ✓ OK | 79.400 | — | — | — | — | — | — |
| `0402WGF3321TCE` | R606 | 115 | ✓ OK | 500 | — | — | — | — | — | Cualquier 3,32 kΩ 1 % 0402 (Yageo RC0402FR-073K32L, LCSC C137993) |
| `TL3342F450QG` | SW301 | 105 | ✓ OK | 814 | 24.789 | — | — | — | — | — |
| `BQ25180YBGR` | U101 | 105 | ✓ OK | 5.836 | 2.902 | — | — | — | — | — |
| `MAX17048G+T10` | U102 | 105 | ✓ OK | 22.150 | 22.120 | — | — | — | — | — |
| `TPS63900DSKR` | U103 | 105 | ✓ OK | 9.618 | 0 | — | — | DigiKey: 3.000 para el 09/11/2026 | — | — |
| `TPS7A2032PDBVR` | U104 | 105 | ✓ OK | 0 | 3.348 | 1 | — | DigiKey 26 semanas | — | TPS7A2033PDBVR (mismos pines a 3,3 V: deja el BGA525N6 en su máximo) |
| `TPS7A0230PDBVR` | U106 | 105 | ✓ OK | 27.633 | 5.363 | — | — | — | — | — |
| `SN74LVC1T45DBVR` | U202, U203, U204 | 315 | ✓ OK | 240.085 | 93.678 | — | — | — | — | — |
| `BGA525N6E6327XTSA1` | U205 | 105 | ✓ OK | 1.801 | 0 | 1.801 | Farnell: sin stock | DigiKey 40 semanas, sin fecha | — | Ninguna pin a pin con L1 + L5: BGA524N6 y BGA123N6 son solo L1 (y sin stock); con la Taoglas activa por el U.FL se puentea |
| `BMP581` | U404 | 105 | ✓ OK | 9.291 | 0 | — | — | — | — | DPS368 en su lugar sin montar (otro footprint, ya en la placa) |
| `DRV5032FADBZR` | U406 | 105 | ✓ OK | 47.205 | 2.156 | 47.105 | — | DigiKey 26 semanas | `DRV5032FBDBZR` | TMAG5231C1DQDBZR (mismos pines, otro umbral y 2 µA) |
| `W25N02KVZEIR` | U501 | 105 | ✓ OK | 1.660 | — | 2.169 | LCSC C17626844 (mismo MPN): 7.267 | — | — | — |
| `USBLC6-2SC6` | U601 | 105 | ✓ OK | 33.195 | 29.057 | — | — | — | — | — |
| `TPS259470ARPWR` | U602 | 105 | ✓ OK | 3.818 | 0 | — | — | DigiKey: 3.000 el 01/02/2027 | — | — |
| `CM8V-T1A-32.768KHZ-12.5PF-20PPM-TA-QC` | Y301 | 105 | ✓ OK | 8.764 | 120.722 | — | — | — | `ABS06-32.768KHZ-T` | — |

Stock leído el 09/11/2026 (columnas de stock de [`partes_pod_v0.csv`](../../../hardware/tools/datos/partes_pod_v0.csv)).

<!-- fin de lo generado -->

## Las partes con riesgo

### IMU LSM6DSV320X (`U401`): sin stock

**Stock**: LCSC 0 ([C26633007](https://www.lcsc.com/product-detail/C26633007.html)), JLCPCB 3, DigiKey 0 con **24 semanas** de plazo de fábrica y pedido pendiente admitido ([497-LSM6DSV320XTRCT-ND](https://www.digikey.com/en/products/result?keywords=LSM6DSV320XTR), US$ 6,72 a 100), **eStore de ST 26** (US$ 6,18 a 100, por [Findchips](https://www.findchips.com/search/LSM6DSV320XTR)). Alcanza para la v0, no para las 100.

**Alternativas pin a pin** (las tres hojas, tabla 2 "Pin description"):

| Pin | LSM6DSV320X (DS14623) | LSM6DSV80X (DS14764) | LSM6DSV16X (DS13510) | Red en el pod |
|---|---|---|---|---|
| 1 | SDO/TA0 | SDO/TA0 | SDO/SA0 | SENS_MISO |
| 2 | SDx: en modo 1, a VDDIO o GND | SDx: a VDDIO o GND | SDx/AH1/Qvar1: a Vdd_IO o GND con el hub analógico y Qvar apagados | GND |
| 3 | SCx: idem | SCx: idem | SCx/AH2/Qvar2: idem | GND |
| 4 | INT1 | INT1 | INT1 | IMU_INT1 |
| 5 | VDDIO | VDDIO | Vdd_IO | VREG |
| 6, 7 | GND | GND | GND | GND |
| 8 | VDD | VDD | Vdd | VREG |
| 9 | INT2 | INT2 | INT2/DEN | IMU_INT2 |
| 10 | OCS_aux: a VDDIO o sin conectar | NC: sin conectar | OCS_Aux: a Vdd_IO o sin conectar | sin conectar |
| 11 | SDO_aux: a VDDIO o sin conectar | NC: sin conectar | SDO_Aux: a Vdd_IO o sin conectar | sin conectar |
| 12 | CS | CS | CS | IMU_CS |
| 13 | SCL/SPC | SCL/SPC | SCL/SPC | SENS_SCK |
| 14 | SDA/SDI | SDA/SDI | SDA/SDI | SENS_MOSI |

- **Encapsulado**: el mismo LGA-14L de 2,5 × 3,0 mm con 14 pads de 0,25 × 0,475 mm a 0,5 mm de paso: figura 32 de DS14623 y figura 25 de DS14764 (el mismo dibujo, DM01021587_2, 0,83 mm de alto) y figura 33 de DS13510 (DM00249496_5, 0,86 mm). El footprint `LGA-14_L3.0-W2.5-P0.50-TL` sirve para las tres.
- **LSM6DSV80X** (C46898862): pin a pin y del mismo die que la 320X (WHO_AM_I 73h: el mismo driver, `st,lsm6dsv320x`, con el alto rango a escala de ±80 g en lugar de ±320 g). ±80 g alcanza para los contactos a la altura de la espalda alta según la revisión del diseño (**a confirmar** con los datos de la v0: cuántas muestras saturan a 80 g). **Stock re-leído el 09/11/2026**: eStore de ST **34** ("in stock", US$ 5,48 de 100 a 250), **IBS Electronics 160** (por Findchips, US$ 9,83 a 100; que sea distribuidor autorizado de ST está **no verificado**), DigiKey 0 (24 semanas, también en digikey.co.uk, sin fecha), LCSC 0, JLCPCB 0; Arrow, Future y Mouser no respondieron. Son **194**: llega a las 110 solo con IBS.
- **LSM6DSV16X** (C5267406): pin a pin, **en stock** (LCSC 11.047, DigiKey 9.682, eStore de ST 4.247; US$ 2,43 a 100), pero **solo ±16 g**: el alto rango lo da el **ADXL372** en su lugar sin montar (`U403`, con su capacitor y el 0 Ω de `HG_INT`; LCSC 1.534, DigiKey 232, US$ 15,00 a 100). Los dos tienen driver en Zephyr (`st,lsm6dsv16x` y `adi,adxl372`); la IMU tiene otro WHO_AM_I (70h). El ADXL372 opera con VS de 1,6 a 3,5 V (hoja Rev. B; 3,6 V absoluto): con VREG de 3,4 V ± 1,5 % del TPS63900 llega a 3,45 V, bien; con la alternativa TPS63802 (unos ±2 %, **no verificado**) llegaría a 3,47 V, prácticamente sin margen, y no se combina. Costo a 100: **+10,7 por placa** (2,43 + 15,00 contra 6,72).

**Recomendación**: la v0 con la LSM6DSV320X (comprar **10 en el eStore de ST** ya: 5 placas y repuestos). Para las 100, **pedido pendiente de 110** en DigiKey (o en un distribuidor de ST que confirme fecha). **Al cerrar la v0**, si el pedido no tiene fecha: 1.º **LSM6DSV80X** si se consiguen 110 de fuentes confirmadas (eStore de ST, IBS si confirma que es autorizado, Arrow o Future), sin cambios de placa ni de driver; 2.º **LSM6DSV16X + ADXL372** (reservar 110 de cada una en LCSC), que entran en la placa sin tocarla pero cambian el montaje y el firmware. Por eso ninguna va como alternativa aprobada para el armador.

### Hall DRV5032FB (`U406`): sin stock, la FA pasa a ser la montada

**Stock**: LCSC 0 ([C2655033](https://www.lcsc.com/product-detail/C2655033.html)), DigiKey 0 (33 el 08/03/2027 y 2.967 el 12/07/2027; 26 semanas), ti.com agotado; JLCPCB 271 (solo para armar allá) y brokers (Bristol 557, no autorizado).

**La que se monta ahora: DRV5032FADBZR** (LCSC [C140921](https://www.lcsc.com/product-detail/C140921.html) 47.205, DigiKey 2.156; US$ 0,12 a 150). Es la misma hoja (SLVSDC7H): tabla 4-1, las dos omnipolares push-pull; figura 5-1 y tabla 5-1, el mismo SOT-23 DBZ con VCC 1, OUT 2 y GND 3; los mismos umbrales (BOP máximo de 4,8 mT para FA, FB, FC y FD, sección 6.6). Lo único que cambia es la frecuencia de muestreo, **20 Hz** contra 5 Hz, y el consumo, **1,6 µA** típicos (3,5 máx.) contra 0,69 µA (1,8 máx.) a 3 V (sección 6.5): **+0,9 µA** en todos los estados (el presupuesto de System OFF de `pod-v0.md` sube de 50–70 a 51–71 µA), unos 8 mAh por año sobre la celda de 500–600 mAh. El firmware no cambia (misma salida, mismo nivel: bajo con el imán) y el símbolo de la biblioteca es el mismo.

**Recomendación**: `diseno.py` monta la **DRV5032FA** en `U406` y la lista la pide a ella; se compran **150 en LCSC** ya. La **FB** queda como **alternativa aprobada** (columna `Approved Alternate`) para las corridas siguientes, si DigiKey cumple julio de 2027. Otra opción con los mismos pines, **TMAG5231C1DQDBZR** (LCSC 3.195; tabla 6-1 de ZHCSOO8D), queda como respaldo: activa en bajo como la DRV5032, pero con BOP típico de 3 mT y 2 µA, que hay que medir con el imán del chaleco.

### Load switch TPS22916C (`U303`): limitado

**Stock**: LCSC 1.040, DigiKey 0 hasta el **07/12/2026** (3.000 en camino), brokers. Hace falta 1 por placa (los de `U105` y `U502` están sin montar).

**Alternativas en el mismo DSBGA-4 y con los mismos pines** (SLVSDO5F, tabla de versiones):

- **TPS22916BYFPR** (LCSC 12.240): también con descarga de salida (QOD), pero de encendido **rápido** (115 µs a 5 V contra 1.400 µs). Hay que medir el pico de corriente al cargar los capacitores del E22 desde VREG antes de aprobarla.
- **TPS22916CNYFPR** (LCSC 9.108, DigiKey 37.362): mismo encendido lento, **sin QOD**, que se eligió para que el VCC del E22 baje rápido al apagarlo.

Ninguna se aprueba sin el banco. **Recomendación**: comprar **150 TPS22916C en LCSC** ya (unos US$ 42); con la entrega de DigiKey de diciembre hay segunda fuente.

### LDO TPS7A2032P (`U104`): OK, una sola fuente

**Stock**: LCSC 0, JLCPCB 1, **DigiKey 3.348** (26 semanas). **Alternativa en el mismo footprint**: **TPS7A2033PDBVR** (LCSC 117.270), misma hoja, mismo SOT-23-5 DBV y pines, con descarga activa, pero a **3,3 V**: el BGA525N6 opera hasta 3,3 V, y con la tolerancia de salida del LDO podría quedar sobre su máximo. No se aprueba. **Recomendación**: comprar **120 en DigiKey** ya (unos US$ 24).

### LNA BGA525N6 (`U205`): OK, una sola fuente

**Stock**: LCSC 1.801 ([C18337445](https://www.lcsc.com/product-detail/C18337445.html)), JLCPCB 1.801, DigiKey 0 (**40 semanas**, sin fecha), Farnell sin stock. **Sin alternativa pin a pin con L1 + L5**: BGA524N6 y BGA123N6 son solo de L1 (y no tienen stock); la BGA855N6 tampoco tiene stock en LCSC. Con la Taoglas activa por el U.FL el LNA se puentea (rescate ya en la placa). **Recomendación**: comprar **150 en LCSC** ya (unos US$ 79).

### Módulo MDBT50Q-P1MV2 (`U301`): limitado

**Stock**: LCSC 0, JLCPCB 0, DigiKey Marketplace (Raytac) 37 en unos 14 días a US$ 6,00, **TME 1.239** según Findchips (US$ 6,50 desde 88; la página de TME no abrió). **Alternativa aprobada con condición: MDBT50Q-1MV2** (antena chip; DigiKey Marketplace 50, LCSC 0). **Pines verificados**: la hoja de Raytac Ver.K es común a las dos (una sola tabla de pines, sección 2.5, y el mismo módulo de 15,5 × 10,5 mm), y el footprint de la biblioteca (`COMM-SMD_MDBT50Q-1MV2`) es el de la -1MV2. Falta confirmar el **keep-out** de la antena chip (secciones 2.2 y 2.3) y que el FCC ID SH6MDBT50Q la cubra con nuestro layout: por eso en la lista dice "only with our written OK". Tampoco tiene más stock. **Recomendación**: pedir **120 a Raytac** (consulta 1) o a TME con la revisión del layout; PCBWay puede recibirlas consignadas.

### GNSS LC29H(AA) (`U201`): limitado

**Stock**: DigiKey 522 (14 semanas; US$ 12,25 a 100), JLCPCB 91. **Alternativa en el mismo footprint**: la LC29H(EA) (RTK; DigiKey 227, LCSC 34), que ya es variante de la placa, a **+12,41** por placa. **Recomendación**: reservar **110 en DigiKey** al aprobar la v0 (o antes si baja de 300).

### Patch GVLB208.A (`AE201`): limitado

**Stock**: DigiKey 271 (16 semanas; US$ 11,79 a 100), fuera de LCSC. **Sin alternativa en el mismo footprint**: el patch de 25 × 25 mm cambia el footprint, y la Taoglas AGVLB.25B activa (DigiKey 558) entra por el U.FL como rescate. **Recomendación**: reservar **110 en DigiKey** al aprobar la v0, y preguntar a Taoglas (consulta 6) precio y plazo directos.

### LoRa E22-900M22S (`U302`): limitado

**Stock**: LCSC y JLCPCB 517, no está en DigiKey. **Sin alternativa en el mismo footprint**: otro módulo SX1262 cambia la placa. **Recomendación**: reservar **110 en LCSC** al aprobar la v0 y pedir precio a 100 y 500 a Ebyte (consulta 7).

### Antena LoRa TX915-FPC-4510 (no se suelda): limitado

**Stock**: sin stock ni precio en LCSC y JLCPCB. La tienda de Ebyte en Alibaba la publica a unos US$ 0,65 de muestra, en 5 días hasta 50 y 12 días hasta 1.000 (**no verificado**: la página no abrió; dato del buscador). **Alternativa con el mismo conector**: **Molex 2111400100** (868/915 MHz, cable de 100 mm, U.FL; DigiKey 5.706, US$ 1,96 a 100), de otro tamaño: hay que ajustar el lugar en la carcasa y medir la sintonía. **Recomendación**: pedir muestras a Ebyte (consulta 7) y comprar **10 Molex** para el banco.

### Lo demás que se pidió revisar

- **SAW B39162B8389P810** (`FL201`, `FL202`): OK por DigiKey (7.710, 8 semanas); LCSC 218 alcanza justo para 105 placas. Sin alternativa L1 + L5 en el mismo footprint (las B39162 en stock son solo L1). Comprar 230 en DigiKey.
- **Cristal CM8V-T1A** (`Y301`): OK (LCSC 8.764, DigiKey 120.722). Alternativa aprobada: Abracon ABS06-32.768KHZ-T (mismo 2,0 × 1,2, CL 12,5 pF, ESR 90 kΩ dentro de los 100 kΩ del nRF52840; LCSC 6.454).
- **Bobinas**: DFE201612E OK (LCSC 12.480), alternativa aprobada DFE201610E (mismo land pattern, 1,0 mm de alto); LQW15AN5N1C OK (LCSC 8.280, DigiKey 60.810), LQW15AN11NG OK (LCSC 40.680).
- **NAND W25N02KV** (`U501`): OK, dos códigos de LCSC del mismo MPN (C3010298 con 1.660 y C17626844 con 7.267).
- **Conector de batería JST SM03B-GHS-TB** (`J101`): OK en LCSC (25.545); DigiKey 0.
- **Resistencia de 22 Ω** (`R501`): LCSC 0 hoy (JLCPCB 3.280.248): el **OK descansa en la alternativa aprobada** Yageo **RC0402FR-0722RL** (LCSC C114765, 5.100.700): mismo valor, 1 %, 62,5 mW y 0402.
- **TPS63900** (DigiKey 0, 3.000 para hoy), **TPS259470A** (DigiKey 0 hasta el 01/02/2027) y **BMP581** (DigiKey 0): OK por LCSC con más de 10 veces lo que hace falta.
- **ICM-42688-P** (`U402`, sin montar): **sin stock** (LCSC 0, DigiKey 0): no cuenta como rescate de la IMU.

## Qué comprar o reservar ahora

**Comprar ya** (barato, una sola fuente o sin stock en otra; unos US$ 265 en total):

| Parte | Cantidad | Dónde | US$ aprox. |
|---|---|---|---|
| LSM6DSV320XTR | 10 | eStore de ST | 79 |
| BGA525N6E6327XTSA1 | 150 | LCSC | 79 |
| TPS22916CYFPR | 150 | LCSC | 42 |
| TPS7A2032PDBVR | 120 | DigiKey | 24 |
| DRV5032FADBZR | 150 | LCSC | 18 |
| Molex 2111400100 | 10 | DigiKey | 23 |

**Reservar o pedir al aprobar la v0** (caro: se compra cuando el diseño esté confirmado, vigilando el stock cada semana):

| Parte | Cantidad | Dónde | Nota |
|---|---|---|---|
| LSM6DSV320XTR | 110 | Pedido pendiente en DigiKey (24 semanas) | Se decide al cerrar la v0: si no tiene fecha, el 1.er respaldo |
| LSM6DSV80XTR | 110 | eStore de ST (34), IBS (160, a confirmar), Arrow o Future | 1.er respaldo: solo si se confirman 110 de fuentes autorizadas |
| LSM6DSV16XTR + ADXL372BCCZ-RL7 | 110 + 110 | LCSC (11.047 y 1.534) | 2.º respaldo, en stock: reservar al cerrar la v0 si el 1.º no alcanza |
| LC29HAAMD | 110 | DigiKey | 522 hoy |
| GVLB208.A | 110 | DigiKey o Taoglas | 271 hoy |
| MDBT50Q-P1MV2 | 120 | Raytac o TME | Consignado a PCBWay |
| E22-900M22S | 110 | LCSC | 517 hoy |
| B39162B8389P810 | 230 | DigiKey | 7.710 hoy |
| TX915-FPC-4510 | 110 | Ebyte | Cotización abierta |

Para las 5 placas de la v0 alcanza con lo que hay hoy en todas las partes, con la LSM6DSV320X del eStore de ST y la DRV5032FA.

## Cómo actualizar

1. Leer el stock en las fuentes de arriba y cargarlo en `hardware/tools/datos/partes_pod_v0.csv` (`stock_lcsc`, `stock_digikey`, `stock_jlcpcb`, `stock_otras`, `plazo`, `fecha_stock`), con el estado según el criterio.
2. Una alternativa va en `alternativa_directa` solo si está verificada pin a pin contra las dos hojas, en el mismo footprint y con la misma función; tiene que tener su propia fila en la planilla. Las demás, en `alternativas_otras`, con lo que cambia.
3. Correr `python3 hardware/tools/bom_pcbway.py`: reescribe la tabla de arriba y la columna `Approved Alternate` de las listas.
