# Alternativas en stock para el pod v0 (B-909)

Regla nueva del usuario (09/11/2026): **el diseño aprobado no está cerrado**. Cada parte tiene que estar **disponible hoy**: al menos **150 unidades** que se puedan comprar ya en una fuente a la que compra PCBWay (LCSC, DigiKey, la tienda del fabricante) o que compremos nosotros y mandemos consignadas, con entrega en unas **2 semanas**. No se espera un plazo de fábrica de 12 semanas o más. Este documento busca, para cada parte que no cumple, una alternativa que sí, y de paso las que **bajan el costo**.

Queda **fuera** el bloque de MCU, BLE y LoRa (Raytac MDBT50Q-P1MV2, Ebyte E22-900M22S) y la antena de LoRa (TX915-FPC-4510): los cubre otro estudio. Su costo se muestra aparte para poder sumarlo.

Complementa a [`stock.md`](stock.md) (auditoría de la placa tal como está, con su criterio de OK, LIMITADO y SIN STOCK) y a [`costos.md`](costos.md) (costo de las partes a 5, 10 y 100 placas). **Nada de esto cambia `diseno.py`**: el usuario decide primero. Las partes evaluadas tienen su fila en [`partes_pod_v0.csv`](../../../hardware/tools/datos/partes_pod_v0.csv) con el stock y los precios leídos.

## Cómo se leyó

Todo el **09/11/2026**:

| Fuente | Cómo | Nota |
|---|---|---|
| LCSC | La API de su página de producto (`wmsc.lcsc.com/ftps/wm/product/detail?productCode=<código>`, los mismos datos que `lcsc.com/product-detail/<código>.html`) | Stock y escalones de precio de cada código |
| JLCPCB | El buscador de partes de su armado (`jlcpcb.com/parts`, por su API), para encontrar los códigos de LCSC de cada MPN | El stock de JLCPCB **es para armar en JLCPCB**: PCBWay no lo puede comprar |
| DigiKey | Página de búsqueda o de producto (`digikey.com/en/products/result?keywords=<MPN>`) | Stock, precio a 100 y plazo de fábrica |
| Hojas de datos | ST DS13511 Rev 2 (LSM6DSV32X, de LCSC), TI SLVSEN5B (TPS22919), TI SNVS798Q (LP5907), TI SBVS338H (TPS7A20), Taoglas SPE-21-8-082-H (GVLB258.A) y SPE-25-8-318-B (GVLB208.A) | Pines, encapsulado y datos eléctricos citados abajo |
| Zephyr | `dts/bindings/sensor` de `nrfconnect/sdk-zephyr` en el tag `ncs-v3.4.1` (el NCS del firmware, `firmware/west.yml`) | Qué sensores tienen driver en el SDK que usamos |
| Mouser, Findchips, Octopart, TME | — | Mouser sigue pidiendo captcha; Findchips hoy no devuelve resultados para ningún MPN (tampoco para los que antes sí). Queda **no verificado** |

Los precios son de la fuente con stock, al escalón de la cantidad (5, 10 o 100 placas), sin envío ni impuestos, como en `costos.md`.

## Resumen

- **IMU**: la **LSM6DSV32X** reemplaza a la LSM6DSV320X **sin tocar la placa** (pin a pin, mismo LGA-14L, driver en el NCS v3.4.1), con **±32 g** en lugar de ±320 g. Hay de sobra (LCSC 3.032, DigiKey 24.971) y cuesta **3,82 menos** por placa a 100. El alto rango que se pierde se cubre, si hace falta, con el **ADXL372** que ya tiene su lugar sin montar (`U403`): se monta en 2 de las 5 placas de la v0 para medir cuánto satura ±32 g en los contactos, y con esos datos se decide si va en las 100.
- **Patch GNSS**: la **Taoglas GVLB258.A** (25 × 25 × 8 mm) reemplaza a la GVLB208.A con **más stock** (DigiKey 895 contra 271), **mejor antena** (eficiencia de 51 % en L5 y 70 % en L1 contra 50 % y 50 %) y **4,75 menos** a 100. **Cambia el footprint** (la zona de la antena ya es de 30 × 30 mm, pensada para 25 × 25) y suma unos 2 g.
- **GNSS LC29H(AA)**: **cumple hoy** (DigiKey 522), pero en una sola fuente: se compran **150 ya**. No hay un reemplazo L1 + L5 en stock que no cambie placa y firmware: el u-blox **MAX-F10S** (DigiKey 10.596) es el respaldo, sin fase portadora ni la ruta de RTK de la EA.
- **LNA BGA525N6 y SAW B39162**: **cumplen hoy** (LCSC 1.801; DigiKey 7.710). No hay LNA L1 + L5 en stock en otro lado: se compran 150 BGA525N6 ya.
- **Load switch TPS22916C**: **cumple hoy** (LCSC 1.040; DigiKey 3.000 el 07/12). Opción más barata y más fácil de armar: **TPS22919DCKR** (SC-70-6, LCSC 20.375, mismo encendido lento y QOD), con cambio de footprint.
- **LDO TPS7A2032P**: cumple (DigiKey 3.348). **Segunda fuente pin a pin: LP5907MFX-3.2** (DigiKey 3.883), con los mismos pines en SOT-23-5 y descarga de la salida.
- **El resto cumple hoy** con más de 150 en LCSC, casi todo con más de 10 veces lo que hace falta. La única que baja el costo con algo de trabajo es la NAND: **GD5F2GM7UEYIGR** (2 Gbit, LCSC 4.145), **1,78 menos** a 100, pero pide soportar otro juego de comandos en el driver.
- **Costo de las partes sin el bloque de MCU y LoRa**, a 5 / 10 / 100 placas: hoy **70,79 / 61,17 / 50,19**; con la recomendación (IMU, patch y load switch), **59,82 / 51,54 / 41,40**. Con el bloque de MCU y LoRa (13,30 / 12,27 / 11,11): **73,12 / 63,81 / 52,51** contra los **84,08 / 73,44 / 61,30** de hoy.

## Tabla por parte

Lo que no cumple o tiene un equivalente más barato, con la opción recomendada. "Δ a 100" es por placa, contra la parte actual. Stock del 09/11/2026.

| Parte (lugar) | Hoy | Recomendada en stock | ¿Mismo footprint? | Δ US$ a 100 | Stock de la recomendada |
|---|---|---|---|---|---|
| LSM6DSV320X (`U401`) | ✗ LCSC 0, DigiKey 0 (24 semanas), eStore de ST 26 | **LSM6DSV32XTR** | **Sí** (pin a pin, mismo LGA-14L) | **−3,82** | LCSC 3.032, DigiKey 24.971 |
| — alto rango (`U403`, hoy sin montar) | — | ADXL372 montado solo si la v0 lo pide | Sí (lugar ya en la placa) | +15,00 si se monta | LCSC 1.534, DigiKey 232 |
| GVLB208.A (`AE201`) | ⚠ DigiKey 271 (16 semanas) | **GVLB258.A** | **No** (25 × 25, otro pin) | **−4,75** | DigiKey 895 (LCSC 0) |
| LC29H(AA) (`U201`) | ✓ DigiKey 522 (14 semanas detrás) | **La misma**: comprar 150 ya | Sí | 0 | DigiKey 522, JLCPCB 91 |
| BGA525N6 (`U205`) | ✓ LCSC 1.801, DigiKey 0 (40 semanas) | **La misma**: comprar 150 ya | Sí | 0 | LCSC 1.801 |
| B39162B8389P810 (`FL201`, `FL202`) | ✓ DigiKey 7.710, LCSC 218 | **La misma** | Sí | 0 | DigiKey 7.710 |
| TPS22916C (`U303`) | ⚠ LCSC 1.040, DigiKey 0 hasta el 07/12 | La misma (150 ya) o **TPS22919DCKR** | **No** con la TPS22919 (SC-70-6) | **−0,22** con la TPS22919 | LCSC 20.375 |
| TPS7A2032P (`U104`) | ✓ DigiKey 3.348, LCSC 0 | La misma + **LP5907MFX-3.2** de segunda fuente | **Sí** (pin a pin) | +0,12 si se usa la LP5907 | DigiKey 3.883 (LCSC 48) |
| W25N02KV (`U501`) | ✓ LCSC 1.660 + 7.267 | La misma; **GD5F2GM7UEYIGR** si se suma al driver | Sí (WSON-8 8 × 6; pad expuesto a confirmar) | −1,78 con la GD5F2GM7 | LCSC 4.145 |
| El resto (sección 6) | ✓ | Las mismas | — | 0 | Más de 150 en LCSC |

## 1. IMU (`U401`)

**Qué hace falta**: un canal de **±16 g** o algo más para la carrera (Vmax, aceleraciones, `accel_load_au`) y un canal de **alto rango** para los impactos (`contacts_n`, `scrums_n`, solo rugby; ADR 0105), con ODR de 400 Hz o más para el movimiento y 1,6 kHz o más para los impactos, bajo consumo y driver en Zephyr.

### Opciones

| Opción | Rango | ODR del acelerómetro | Consumo (acel. + giro, alto rendimiento) | Encapsulado y pines | Driver en el NCS v3.4.1 | US$ a 100 | Stock hoy | Veredicto |
|---|---|---|---|---|---|---|---|---|
| LSM6DSV320X (actual) | ±16 g + ±320 g | 7,68 kHz | — | LGA-14L 2,5 × 3 | `st,lsm6dsv320x` | 6,72 (DigiKey) | ✗ LCSC 0, DigiKey 0, eStore de ST 26 | No cumple |
| LSM6DSV80X | ±16 g + ±80 g | 7,68 kHz | igual | Pin a pin | `st,lsm6dsv80x` | 5,48 (eStore de ST) | ✗ LCSC 0, DigiKey 0, eStore de ST 34; IBS 160 (no verificado) | No cumple |
| **LSM6DSV32X** | **±4 a ±32 g, doble canal** (el segundo fijo en ±32 g) | 7,68 kHz | **0,65 mA** (solo acelerómetro 190 µA) | **Pin a pin**, LGA-14L 2,5 × 3,0 × 0,83 | **`st,lsm6dsv32x`** (driver de la familia LSM6DSV16X) | **2,90** (LCSC) | **LCSC 3.032, DigiKey 24.971** (US$ 4,66 a 100) | **Recomendada** |
| LSM6DSV16X + ADXL372 | ±16 g + ±200 g | 7,68 kHz + 6,4 kHz (ADXL372) | IMU 0,65 mA + ADXL372 unos 22 µA (no verificado) | Pin a pin + `U403` | `st,lsm6dsv16x` + `adi,adxl372` | 2,43 + 15,00 = 17,43 | LCSC 11.042 y 1.534 | Respaldo de alto rango (+10,71) |
| LSM6DSV32X + ADXL372 | ±32 g + ±200 g | igual | igual | Pin a pin + `U403` | `st,lsm6dsv32x` + `adi,adxl372` | 2,90 + 15,00 = 17,90 | LCSC 3.032 y 1.534 | Si la v0 muestra que ±32 g no alcanza (+11,18) |
| LSM6DSO32X | ±4 a ±32 g, un canal | 6,66 kHz | unos 0,55 mA (no verificado) | LGA-14L 2,5 × 3; pines iguales a la familia (**no verificado** contra su hoja) | `st,lsm6dso32` | 4,28 (LCSC) | LCSC 358, DigiKey 1.153 (US$ 4,31) | Segunda fuente de ±32 g, si se verifica |
| ICM-45686 (TDK) | ±32 g | no verificado | no verificado | LGA-14 3 × 2,5, **otros pines** | `invensense,icm45686` | 7,10 (LCSC) | LCSC 2.912 | Más cara y cambia la placa |
| BMI323 / BMI270 (Bosch) | ±16 g | 6,4 kHz / 1,6 kHz | — | Otros pines | `bosch,bmi323` / `bosch,bmi270` | 2,20 / 1,35 | LCSC 2.897 / 10.729 | Sin alto rango: igual que la LSM6DSV16X, sin ventaja |
| BMI088 (Bosch) | ±24 g | 1,6 kHz | — | LGA-16 3 × 4,5, otros pines | `bosch,bmi08x` | 4,63 | LCSC 4.535 | Menos rango que la DSV32X, más grande |
| ADXL375 (±200 g) | solo alto rango | 3,2 kHz | — | LGA-14 3 × 5 | **Sin driver** en Zephyr | 15,33–18,40 | LCSC 163 entre 3 códigos | No cumple (stock y driver) |
| H3LIS331DL (±400 g) / LIS331HH (±24 g) | solo alto rango | 1 kHz | — | TFLGA-16 3 × 3 | **Sin driver** | 10,22 / 10,75 | LCSC 53 / 9 | No cumple |
| IIM-42653 (TDK) | ±32 g | — | — | LGA-14 | No verificado | 24,81 | LCSC 86 | No cumple |
| ADXL372 sola | ±200 g, 100 mg/LSB | 6,4 kHz | — | — | `adi,adxl372` | 15,00 | LCSC 1.534 | Sin giróscopo ni resolución para la carrera |
| ICM-42688-P (`U402`, sin montar) | ±16 g | 32 kHz | — | Su propio lugar | `invensense,icm42688` | — | LCSC 0, DigiKey 0 (la de Tokmas, "ICM-42688-P(TOKMAS)", es otra marca: no verificada) | No cumple |

Fuentes: LCSC [C22461202](https://www.lcsc.com/product-detail/C22461202.html) (LSM6DSV32XTR), [C3663738](https://www.lcsc.com/product-detail/C3663738.html) (LSM6DSO32XTR), [C579465](https://www.lcsc.com/product-detail/C579465.html) (ADXL372), [C22459454](https://www.lcsc.com/product-detail/C22459454.html) (ICM-45686), [C5368700](https://www.lcsc.com/product-detail/C5368700.html) (BMI323), [C194919](https://www.lcsc.com/product-detail/C194919.html) (BMI088), [C579466](https://www.lcsc.com/product-detail/C579466.html) (ADXL375), [C2655074](https://www.lcsc.com/product-detail/C2655074.html) (H3LIS331DL), [C30724128](https://www.lcsc.com/product-detail/C30724128.html) (IIM-42653); DigiKey [LSM6DSV32XTR](https://www.digikey.com/en/products/result?keywords=LSM6DSV32XTR) y [LSM6DSO32XTR](https://www.digikey.com/en/products/result?keywords=LSM6DSO32XTR); todo el 09/11/2026.

### LSM6DSV32X: por qué entra sin tocar la placa

- **Pines** (DS13511 Rev 2, tabla 2 "Pin description"): 1 SDO/SA0, 2 SDx/AH1/Qvar1, 3 SCx/AH2/Qvar2, 4 INT1, 5 Vdd_IO, 6 y 7 GND, 8 Vdd, 9 INT2, 10 OCS_Aux, 11 SDO_Aux, 12 CS, 13 SCL, 14 SDA. Es la **misma tabla que la LSM6DSV16X** (DS13510), que `stock.md` ya comparó pin a pin con la 320X: SDx y SCx a GND, OCS_Aux y SDO_Aux sin conectar, como están en `diseno.py`.
- **Encapsulado**: LGA-14L de 2,5 × 3,0 × 0,83 mm (página 1 de DS13511), el del footprint `LGA-14_L3.0-W2.5-P0.50-TL`.
- **Alimentación**: Vdd de 1,71 a 3,6 V y Vdd_IO de 1,08 a 3,6 V: con VREG de 3,4 V entra igual que la 320X.
- **Doble canal** (sección 6.3): con `XL_DualC_EN` el canal 1 va en ±4–32 g y el canal 2 en **±32 g fijo**, a la vez. Es la misma idea que la 320X (un canal fino para la carrera y otro de alto rango), con el techo en 32 g: el canal 1 puede quedar en **±8 o ±16 g** para la resolución de la carrera y el canal 2 en ±32 g para los contactos.
- **WHO_AM_I 70h**, como la LSM6DSV16X (la 320X y la 80X dan 73h).

**Firmware**: en el devicetree cambia el `compatible` a `st,lsm6dsv32x` (binding en el NCS v3.4.1; lo maneja el driver `lsm6dsv16x`) y el autotest de presencia acepta 70h. La lectura de los dos canales por la FIFO (`imu_batch`, todavía pendiente en `firmware/README.md`) se escribe contra el canal 2 de ±32 g en lugar del de alto rango de la 320X. El formato del log no cambia: guarda la escala.

### ¿Alcanza ±32 g?

- Las referencias que usa el club son de equipos de **±16 g a 100 Hz** en la espalda alta (Catapult y GPSports): las zonas de impacto de la bibliografía llegan a "más de 10 g" con esos equipos, y la validación de un acelerómetro de tronco contra captura de movimiento en tackles y choques ([Wundersitz y col. 2015](https://www.pubmed.gov/25849648/)) trabaja en ese rango, con la señal filtrada a 20 Hz. Con ±32 g el pod **duplica el techo** de esos equipos, y las métricas comparables con primera (las del diccionario, a la frecuencia de primera) no saturan.
- Lo que sí puede saturar a 32 g son los **picos crudos a 1,6 kHz o más**, sin filtrar: un golpe del propio pod contra el piso o un choque de espalda puede pasar de 32 g (**no verificado**: no encontramos mediciones de tronco con rango alto). Saturar recorta el pico, **no el conteo**: `contacts_n` y `scrums_n` se cuentan igual con el umbral debajo de 32 g; lo que se pierde es la intensidad de los impactos más fuertes.
- **Plan**: en la v0 se monta el **ADXL372 en `U403` en 2 de las 5 placas** (el lugar, su capacitor y el 0 Ω de `HG_INT` ya están) y se mide, en entrenamientos con contacto, qué fracción de los impactos pasa de 32 g. Si es relevante para las métricas que se definan con el club, las 100 llevan el ADXL372 (+15,00) o la 320X/80X si vuelven con fecha.

**Recomendación**: **LSM6DSV32XTR** en `U401` para la v0 y las 100 (comprar **150 en LCSC** ya, unos US$ 435); 10 ADXL372 para las placas de medición. La 320X pasa a alternativa cuando vuelva. Segunda fuente de ±32 g: la LSM6DSO32X, si se confirman sus pines contra su hoja.

## 2. Módulo GNSS (`U201`)

**Qué hace falta**: L1 + L5 con las 4 constelaciones a 10 Hz, velocidad por Doppler, salida RTCM3 MSM para el posprocesado (opcional), bajo consumo y, si se puede, el mismo footprint con camino a RTK (la EA).

| Opción | Bandas | Hz | Crudo / RTCM MSM | Tamaño y footprint | Consumo | US$ a 100 | Stock hoy | Veredicto |
|---|---|---|---|---|---|---|---|---|
| **LC29H(AA)** (actual) | L1 + L5 | 10 | RTCM3 MSM4/MSM7 por `$PAIR432` (`lc29h-protocolo.md`) | LCC-24 12,2 × 16,0 | — (`pod-v0.md`) | 12,25 (DigiKey) | **DigiKey 522**, JLCPCB 91; LCSC ya no la publica ([C22403415](https://www.lcsc.com/product-detail/C22403415.html) sin ficha) | **Cumple**: comprar 150 ya |
| LC29H(EA) | L1 + L5, RTK | 1–10 | Sí | Mismo lugar | — | 24,66 (LCSC) / 32,72 (DigiKey) | DigiKey 227, LCSC 34 | Cumple con DigiKey, a **+12,41 a +20,47** |
| LC29H(BA), (DA), (CA), (BS) | L1 + L5 | — | — | Mismo lugar | — | — | Solo JLCPCB (201, 102, 14 y 1) | No cumple (PCBWay no compra de JLCPCB); BA y CA son de navegación a estima |
| u-blox **MAX-F10S-00B** | L1 + L5 | hasta 20 Hz según la hoja (R02, no verificado a 10 Hz con 4 constelaciones) | **Sin fase portadora** (la única F10 con `RXM-RAWX` es la NEO-F10N-00B-20, ADR 0105) | LCC de 10,1 × 9,7: **otro footprint** | 57 mW a 3 V con 3 constelaciones (resumen de producto, objetivo) | unos 11–13 (DigiKey: 13,14 a 1, 10,74 a 500) | **DigiKey 10.596** (20 semanas detrás), LCSC 220 | Respaldo si se acaba la AA: cambia placa, alimentación (1,76–3,3 V) y firmware (UBX) |
| Quectel LG290P | L1/L2/L5/E6 | 10–20 | Sí | Otro encapsulado y otros pines (no verificado); unos 98 mA (ADR 0105) | — | 81,40 (LCSC) | LCSC 11 | No cumple (stock, precio y consumo) |
| Quectel LC76G | **Solo L1** | — | — | 10,1 × 9,7 | — | 5,26 | LCSC 205 | Descartada (una banda) |
| Allystar TAU1201/1202/1312, Unicore UM620N/UC6580, Quectel LC02H | — | — | — | — | — | — | Ni en LCSC ni en DigiKey (el UC6580I-00 figura en JLCPCB sin stock) | No cumple |
| Zhongke ATGM336H-6N | Solo L1 | — | — | — | — | 2,03 | LCSC 1.690 | Descartada (una banda) |

Fuentes: DigiKey [LC29HAAMD](https://www.digikey.com/en/products/result?keywords=LC29HAAMD) (522, 16,04 a 1, 13,96 a 10, 12,25 a 100; 14 semanas, sin entradas anunciadas), [LC29HEAMD](https://www.digikey.com/en/products/result?keywords=LC29HEAMD) (227), [MAX-F10S-00B](https://www.digikey.com/en/products/detail/u-blox/MAX-F10S-00B/24708222) (10.596); LCSC [C28453488](https://www.lcsc.com/product-detail/C28453488.html) (EA), [C30005563](https://www.lcsc.com/product-detail/C30005563.html) (MAX-F10S), [C29781241](https://www.lcsc.com/product-detail/C29781241.html) (LG290P); [resumen de producto del MAX-F10S](https://content.u-blox.com/sites/default/files/documents/MAX-F10S_ProductSummary_UBX-23010128.pdf). Todo el 09/11/2026.

**Recomendación**: la **LC29H(AA)** cumple la regla hoy, pero con 522 en una sola fuente y 14 semanas detrás: **comprar 150 en DigiKey ya** (unos US$ 1.840 a 12,25; en carrete de 250, 11,65) y no esperar a aprobar la v0. Si se agotan antes de comprar, la EA cubre 227 en DigiKey en el mismo lugar (+20,47 a ese precio). El MAX-F10S queda documentado como respaldo de otra placa; no se dibuja ahora.

## 3. Antena GNSS (`AE201`)

| Opción | Tipo y tamaño | Eficiencia L5 / L1 | Ganancia pico L5 / L1 | Peso | Footprint | US$ a 100 | Stock hoy | Veredicto |
|---|---|---|---|---|---|---|---|---|
| GVLB208.A (actual) | Patch pasivo apilado, 20 × 20 × 8,8, 1 pin | 49,8 % / 50,2 % | 0,4 / 1,5 dBi | 16 g | Actual | 11,79 (DigiKey) | DigiKey 271 (16 semanas) | Cumple justo, una sola fuente |
| **GVLB258.A** | Patch pasivo apilado, **25 × 25 × 8,12**, 1 pin | **50,9 % / 70,4 %** | **3,3 / 4,3 dBi** | 18 g | **Cambia**: otro tamaño y otra posición del pin | **7,05** (DigiKey: 9,29 a 1, 8,06 a 10) | **DigiKey 895** (16 semanas detrás); LCSC [C3285465](https://www.lcsc.com/product-detail/C3285465.html) 0 (6,96 a 100) | **Recomendada** |
| GVLB256.A | Patch L1/L5, 25 × 25 × 6,5 | no leída | 1,2–2,6 dBi | — | Cambia | 2,91 a 96 | DigiKey 0 (96 el 14/04/2027) | No cumple |
| AGVLB.25B.07.0060A (activa) | 35 × 35 × 12 con LNA y cable | — | — | 18 g | Por el U.FL (rescate) | unos 24 | DigiKey 558 | Solo rescate: tamaño, peso y precio |
| Quectel YFGC000WWAM, Abracon, Inpaq, Harxon, Tallysman, Kyocera AVX, Ignion, 2J | — | — | — | — | — | — | No aparecen en LCSC ni JLCPCB con stock (las L1 + L5 de Eaton TB300-13L1L5 y Susumu GL1L5MS están en 0) | No verificadas en DigiKey: quedan para la consulta 6 |

Fuentes: DigiKey [GVLB208.A](https://www.digikey.com/en/products/detail/taoglas-limited/GVLB208-A/28531831), [GVLB258.A](https://www.digikey.com/en/products/detail/taoglas-limited/GVLB258-A/15284365), [GVLB256.A](https://www.digikey.com/en/products/detail/taoglas-limited/GVLB256-A/26724163); hojas de Taoglas [GVLB258.A SPE-21-8-082-H](https://www.taoglas.com/datasheets/GVLB258.A.pdf) y [GVLB208.A SPE-25-8-318-B](https://www.taoglas.com/datasheets/GVLB208.A.pdf), sección 2. Todo el 09/11/2026.

**Lo que cambia con la GVLB258.A**:

- **Footprint**: 25 × 25 mm en lugar de 20 × 20, un pin de alimentación con despeje de Ø3 mm en la cara de arriba y Ø3,5 mm en la de abajo (sección 4 de su hoja). La posición del pin está en el dibujo de la sección 3 (**a leer del dibujo**, es una imagen). La zona de la antena en la placa (`GNSS_ANTENA`, 30 × 30 mm) ya se dibujó para un patch de 25 × 25, así que **no crece la placa**; la carcasa sí tiene que dejar los 25 × 25 × 8,12.
- **Plano de tierra**: las dos se ajustan sobre 70 × 70 mm. En la placa de unos 45 × 65 mm, la tierra chica desafina primero la L5 en las dos (`pod-v0.md`); un patch más grande sobre la misma tierra queda **relativamente más cerca** del ajuste de 70 × 70 que uno de 20 × 20 (**no verificado**: se mide en la v0, con el servicio de ajuste de Taoglas de la consulta 6).
- **Cadena RF y firmware**: no cambian (mismo 50 Ω, mismas bandas, pasivo).
- **Peso**: +2 g (18 g contra 16 g).

**Recomendación**: **GVLB258.A** en `AE201` (comprar **150 en DigiKey** ya, unos US$ 1.060). Es la que más baja el costo de toda la lista y la que más mejora la señal en L1.

## 4. LNA BGA525N6 (`U205`) y SAW B39162B8389P810 (`FL201`, `FL202`)

| Parte | Stock hoy | Alternativas buscadas | Resultado |
|---|---|---|---|
| **BGA525N6** (LNA L1/L2/L5) | **LCSC 1.801** ([C18337445](https://www.lcsc.com/product-detail/C18337445.html), 0,53 a 100), DigiKey 0 (40 semanas) | Infineon BGA524N6 y BGA123N6 (solo L1; LCSC 0), BGA725L6 (L1; 0), NXP BGU8M1 (L5; 0) y BGU8103 (3), Maxscend MXD8641/MXD8641H (L1 con filtro, 190 y 1.380), MXD8642 (0) | Ninguna L1 + L5 con stock. **Cumple sola**: 1.801 son 17 veces lo que hace falta |
| **B39162B8389P810** (SAW L1 + L5) | **DigiKey 7.710**, LCSC 218 ([C5556161](https://www.lcsc.com/product-detail/C5556161.html), 1,32 a 100) | — | Cumple |
| Antena activa en lugar de la cadena | AGVLB.25B por el U.FL (DigiKey 558) | — | Sacaría LNA y SAW (unos 2–3 por placa con la adaptación) pero suma unos 24 y 18 g: no conviene en serie |

**Recomendación**: sin cambios. **Comprar 150 BGA525N6 en LCSC ya** (unos US$ 79) y los 300 SAW en DigiKey al aprobar la v0 (7.710 hoy).

## 5. Energía

| Parte (lugar) | Stock hoy | Alternativa | Pines | Datos eléctricos | US$ a 100 | Veredicto |
|---|---|---|---|---|---|---|
| **TPS22916C** (`U303`; `U105` y `U502` sin montar) | LCSC 1.040 ([C2680319](https://www.lcsc.com/product-detail/C2680319.html)); DigiKey 0, 3.000 el 07/12/2026 ([búsqueda](https://www.digikey.com/en/products/result?keywords=TPS22916CYFPR)) | — | DSBGA-4 de 0,4 mm | Encendido lento, QOD de 150 Ω | 0,32 | **Cumple**: comprar 150 en LCSC ya |
| ↳ **TPS22919DCKR** | LCSC **20.375** ([C2149796](https://www.lcsc.com/product-detail/C2149796.html)) | Reemplazo con otro footprint | SC-70-6: 1 IN, 2 GND, 3 ON, 4 NC, 5 QOD, 6 VOUT (SLVSEN5B, "Pin Functions") | 1,6–5,5 V, 1,5 A, 90 mΩ; encendido de 1,75 ms a 3,6 V; **QOD de 24 Ω** (QOD atado a VOUT); pull-down inteligente de 530 kΩ en ON; protección de cortocircuito; 2 nA apagado ([ti.com](https://www.ti.com/product/TPS22919)) | **0,10** | Más barata, más stock y saca un DSBGA de 0,4 mm del armado. El pull-down de 100 kΩ de cada EN sigue igual |
| ↳ TPS22918DBVR / TPS22917DBVR | LCSC 69.875 / 2.315 | Otro footprint (SOT-23-6) | — | Tiempo de subida ajustable con capacitor; QOD | 0,25 / 0,28 | Sirven, pero la TPS22919 es más chica y barata |
| ↳ TPS22916B / CN | LCSC 12.240 / 9.108 | Mismos pines | DSBGA-4 | B: encendido rápido; CN: sin QOD (`stock.md`) | 0,14 / 0,24 | No se aprueban sin el banco |
| **TPS7A2032P** (`U104`) | DigiKey 3.348 (26 semanas detrás), LCSC 0 | — | SOT-23-5: 1 IN, 2 GND, 3 EN, 4 NC, 5 OUT (SBVS338H) | 300 mA, 7 µVrms, descarga de 150 Ω, pull-down de 500 kΩ en EN | 0,20 | **Cumple**: comprar 150 en DigiKey ya |
| ↳ **LP5907MFX-3.2/NOPB** | **DigiKey 3.883** ([búsqueda](https://www.digikey.com/en/products/result?keywords=LP5907MFX-3.2%2FNOPB)), LCSC 48 ([C2832238](https://www.lcsc.com/product-detail/C2832238.html)) | **Pin a pin** | SOT-23-5: 1 IN, 2 GND, 3 EN, 4 N/C, 5 OUT (SNVS798Q, tabla 4-2): igual que la TPS7A20 | 2,2–5,5 V, 250 mA, < 6,5 µVrms, PSRR de 82 dB a 1 kHz, caída de 120 mV típica a plena carga, **descarga de 230 Ω** y pull-down de 1 MΩ en EN | 0,32 | **Segunda fuente** en el mismo lugar: con unos 45 mA del GNSS y el LNA la caída queda muy por debajo de los 170 mV de margen (3,37 → 3,2 V). Candidata a alternativa aprobada |
| TPS63900 (`U103`) | LCSC 9.616 | TPS63802 (con divisor, `pod-v0.md`) | — | — | 0,66 | Cumple |
| BQ25180 (`U101`) | LCSC 5.836, DigiKey 2.902 | — | — | — | 1,20 | Cumple, dos fuentes |
| MAX17048 (`U102`) | LCSC 22.150, DigiKey 22.120 | — | — | — | 1,43 | Cumple, dos fuentes |
| TPS259470A (`U602`) | LCSC 3.421; DigiKey 0 hasta el 01/02/2027 | — | — | — | 0,83 | Cumple (22 veces) |
| TPS7A0230P (`U106`) | LCSC 27.633, DigiKey 5.363 | — | — | — | 0,22 | Cumple |

**Recomendación**: comprar ya **150 TPS22916C** (LCSC) y **150 TPS7A2032P** (DigiKey). Si la placa se toca por el patch, pasar los tres lugares del load switch a **TPS22919DCKR** (−0,22 por placa y un DSBGA de 0,4 mm menos para los rayos X). Sumar la **LP5907MFX-3.2** como alternativa aprobada de `U104` (pines verificados en las dos hojas).

## 6. Lo demás

Todo cumple la regla hoy en LCSC (stock re-leído el 09/11/2026), la mayoría con más de 10 veces lo que hace falta y varias con DigiKey de segunda fuente:

| Parte (lugar) | LCSC hoy | DigiKey | Más barata equivalente | Veredicto |
|---|---|---|---|---|
| W25N02KV (`U501`) | 1.660 ([C3010298](https://www.lcsc.com/product-detail/C3010298.html), 7,81) + 7.267 ([C17626844](https://www.lcsc.com/product-detail/C17626844.html), 7,98) | — | **GD5F2GM7UEYIGR** (GigaDevice, 2 Gbit, WSON-8 8 × 6, LCSC **4.145**, [C22412867](https://www.lcsc.com/product-detail/C22412867.html), **6,03**): −1,78 a 100. Pines SPI NAND estándar; el juego de comandos (estado del ECC, lectura continua, ID) difiere en detalle de la W25N: el driver tendría que soportar las dos (**no verificado**) y el pad expuesto se confirma en su hoja. Más caras: Macronix MX35LF2GE4AD (9,05), Micron MT29F2G01 (9,23), Foresee F35SQA002G (12,28), XTX XT26G02E (12,58) | Cumple; la GD5F2GM7 como ahorro con trabajo de firmware |
| BMP581 (`U404`) | 9.293 ([C5362283](https://www.lcsc.com/product-detail/C5362283.html)) | 0 | DPS368 (LCSC 11.363, 3,12: más cara) | Cumple |
| DRV5032FA (`U406`) | 47.200 ([C140921](https://www.lcsc.com/product-detail/C140921.html)) | 2.156 | — | Cumple |
| Cristal CM8V-T1A (`Y301`) | 8.764 | 120.722 | ABS06 (alternativa aprobada) | Cumple |
| LED XL-1615RGBC-RF (`LED301`) | 693.500 | — | — | Cumple |
| JST SM03B-GHS-TB (`J101`) | 25.395 | 0 | — | Cumple |
| JST SM04B-SRSS-TB (`J201`) | 71.715 | 104.820 | — | Cumple |
| U.FL-R-SMT-1 (`J202`, `J302`) | 17.465 | 332.838 | — | Cumple |
| Pulsador TL3342F450QG (`SW301`) | 804 | 24.789 | — | Cumple |
| TVS SMF12A (`D601`) | 7.960 | 51.230 | — | Cumple |
| USBLC6-2SC6 (`U601`) | 33.220 | 29.057 | — | Cumple |
| PESD5V0S1BL (`D602`) | 73.480 | 18.868 | — | Cumple |
| SN74LVC1T45 (`U202`–`U204`), AO3400A, bobinas, pasivas | Ver `stock.md` (todas con decenas de miles o más) | — | — | Cumplen |

## 7. Lista recomendada "en stock hoy" y costo

Tres niveles, del menos al más invasivo. Precios a 5, 10 y 100 placas por placa, con las mismas reglas que `costos.md` (escalón de la cantidad, mínimo de venta, 10 de desperdicio en pasivas).

| Nivel | Cambios contra el diseño de hoy | ¿Toca la placa? | ¿Toca el firmware? |
|---|---|---|---|
| **A** | IMU **LSM6DSV32X** | No | El `compatible` y el WHO_AM_I |
| **B (recomendado)** | A + patch **GVLB258.A** + load switch **TPS22919DCKR** | Sí: footprint del patch y de los tres load switch | Igual que A |
| C | B + NAND **GD5F2GM7UEYIGR** | No (mismo WSON-8, a confirmar el pad) | Sí: el driver de la NAND con las dos memorias |

**Costo de las partes por placa** (US$; el bloque de MCU y LoRa es el MDBT50Q-P1MV2 y el E22-900M22S a los precios de `costos.md`):

| | 5 placas | 10 placas | 100 placas |
|---|---|---|---|
| Hoy, sin el bloque de MCU y LoRa | 70,79 | 61,17 | 50,19 |
| Δ IMU LSM6DSV32X | −4,52 | −3,96 | −3,82 |
| Δ patch GVLB258.A | −6,17 | −5,39 | −4,75 |
| Δ load switch TPS22919DCKR | −0,28 | −0,28 | −0,22 |
| **Nivel A, sin el bloque** | 66,27 | 57,21 | 46,37 |
| **Nivel B, sin el bloque** | **59,82** | **51,54** | **41,40** |
| Δ NAND GD5F2GM7 (nivel C) | −3,20 | −2,89 | −1,78 |
| Nivel C, sin el bloque | 56,62 | 48,65 | 39,62 |
| Bloque de MCU y LoRa (aparte, otro estudio) | 13,30 | 12,27 | 11,11 |
| **Hoy, con el bloque** | 84,08 | 73,44 | 61,30 |
| **Nivel B, con el bloque** | **73,12** | **63,81** | **52,51** |
| Nivel B + ADXL372 montado en todas | 92,57 | 81,55 | 67,51 |

Con el nivel B la placa baja **10,96 por placa a 5**, **9,63 a 10** y **8,79 a 100**, y todas las partes salvo el bloque de MCU y LoRa tienen hoy al menos 150 en una fuente que compra PCBWay o que podemos consignar.

### Qué comprar ya (nivel B, 150 de cada una)

| Parte | Cantidad | Dónde | US$ aprox. | Por qué ya |
|---|---|---|---|---|
| LSM6DSV32XTR | 150 | LCSC | 435 | Reemplaza a la 320X sin stock |
| ADXL372BCCZ-RL7 | 10 | LCSC | 177 | Para medir la saturación de ±32 g en 2 placas de la v0 |
| GVLB258.A | 150 | DigiKey | 1.060 | 895 en una sola fuente |
| LC29HAAMD | 150 | DigiKey | 1.840 | 522 en una sola fuente, 14 semanas detrás |
| BGA525N6E6327XTSA1 | 150 | LCSC | 79 | Única fuente con stock |
| TPS22919DCKR | 450 | LCSC | 38 | Tres lugares por placa (uno montado; 150 si se monta solo `U303`) |
| TPS7A2032PDBVR | 150 | DigiKey | 30 | Única fuente con stock |
| B39162B8389P810 | 300 | DigiKey | 212 | Dos por placa; se puede dejar para la aprobación de la v0 (7.710 hoy) |

Si el usuario prefiere el nivel A (sin tocar la placa), en lugar de la GVLB258.A y la TPS22919 van **150 GVLB208.A** (DigiKey 271 hoy, unos US$ 1.770) y **150 TPS22916C** (LCSC 1.040, unos US$ 48).

## Qué decide el usuario

1. **IMU**: ¿LSM6DSV32X (±32 g) en `U401` y el ADXL372 en 2 placas de la v0 para medir? Es el único cambio sin costo de placa y el que destraba la compra.
2. **Patch**: ¿GVLB258.A de 25 × 25 en `AE201`? Cambia el footprint y la carcasa, baja 4,75 y mejora L1.
3. **Load switch**: ¿TPS22919DCKR en los tres lugares, o se queda la TPS22916C con las 150 de LCSC?
4. **LDO**: ¿la LP5907MFX-3.2 como alternativa aprobada de `U104`?
5. **NAND**: ¿sumar la GD5F2GM7 al driver para bajar 1,78 más, o se queda solo la W25N?
6. **Compra anticipada** de la LC29H(AA) y la BGA525N6 antes de aprobar la v0.

Con las respuestas se actualizan `diseno.py`, las columnas `alternativa_directa` de la planilla y se regenera todo con `python3 hardware/tools/bom_pcbway.py`.
