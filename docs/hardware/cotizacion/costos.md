# Costos del pod v0 (B-909)

Planilla de costo de abajo hacia arriba que pide `pod-mecanica-produccion.md` (sección 10), para 5, 10 y 100 placas. Los precios de las partes se leyeron el **08/11/2026** en LCSC, JLCPCB y DigiKey (fuente de cada una en [`partes_pod_v0.csv`](../../../hardware/tools/datos/partes_pod_v0.csv)). El resto (placa, armado, envío, importación, NRE) son **estimaciones** marcadas como tales: se reemplazan con las cotizaciones de [`pedido-pcbway.md`](pedido-pcbway.md).

Todo en US$, sin IVA ni impuestos argentinos.

## 1. Partes

**Desde el 09/11/2026 la placa usa solo partes en stock** (BMD-340, Ra-01SH, LSM6DSV32X, GVLB258.A y TPS22919; ADR 0105, "Registro de decisiones"). [`costo-partes-pod-v0.csv`](costo-partes-pod-v0.csv) tiene cada fila de la lista (55 partes distintas, 139 componentes montados por placa) con la cantidad que se compra, el precio unitario y el total para 5, 10 y 100 placas. La genera `hardware/tools/bom_pcbway.py` desde la netlist y la planilla de partes, y el CI falla si queda desactualizada.

Reglas del cálculo:

- **Cantidad comprada** = cantidad por placa × placas, más **10 de desperdicio** por fila en resistencias, capacitores, bobinas y ESD (lo que suele pedir el armador). Si queda por debajo del mínimo de venta, se paga el mínimo (el primer escalón de la planilla).
- **Precio** del escalón que corresponde a esa cantidad, de la fuente con stock y menor precio (la columna `fuente_precio`). DigiKey da el BMD-340 a 9,60 a 1 y 9,66 a 1.000: a 100 se usa el de 1 unidad.
- **Variante base**: LC29H(AA), sin UWB ni ADXL372, con el patch pasivo. La **variante de armado `pod-v0-highg`** (ADXL372 montado, 2 de las 5 placas de la v0) tiene su propia lista para PCBWay ([`bom-pod-v0-highg.csv`](bom-pod-v0-highg.csv)) y su costo en la tabla generada. Las otras variantes, abajo.

Las tablas de abajo las escribe `bom_pcbway.py` en este archivo (entre los marcadores), con los mismos números de [`costo-partes-pod-v0.csv`](costo-partes-pod-v0.csv): no se editan a mano.

<!-- generado por hardware/tools/bom_pcbway.py: no editar a mano -->

| Placas | Partes por placa | Total de partes |
|---|---|---|
| 5 | **74,05** | 370,24 |
| 10 | **65,13** | 651,31 |
| 100 | **53,98** | 5.398,41 |

**Variantes de armado** (BOM aparte para PCBWay, `bom-<variante>.csv`; lo de arriba es la base):

| Variante | Para qué | Lugares que se montan | Placas de la v0 | Partes por placa en la v0 | Si fuera en las 100 |
|---|---|---|---|---|---|
| `pod-v0-highg` | ADXL372 de ±200 g montado, para medir cuánto satura ±32 g de la LSM6DSV32X en los contactos | C404, U403 | 2 de 5 | +19,61 | +15,01 |

**Lo que más pesa** (a 100 placas, por placa):

| Parte | Cant. | US$ por placa | Fuente |
|---|---|---|---|
| LC29HAAMD | 1 | 12,25 | digikey |
| BMD-340-A-R | 1 | 9,60 | digikey |
| W25N02KVZEIR | 1 | 7,81 | lcsc |
| GVLB258.A | 1 | 7,05 | digikey |
| Ra-01SH | 1 | 2,99 | lcsc |
| LSM6DSV32XTR | 1 | 2,90 | lcsc |
| Las otras 49 filas | — | 11,39 | — |

**Lo que no se suelda** ([`bom-pod-v0-extras.csv`](bom-pod-v0-extras.csv)), total del pedido:

| Parte | Para qué | 5 placas | 10 placas | 100 placas |
|---|---|---|---|---|
| AGVLB.25B.07.0060A | Rescate y referencia de banco por el U.FL (2 por cada 5 placas); no se suelda | 62,18 | 124,36 | 1.031,70 |
| 2111400100 | Antena LoRa FPC pegada en la carcasa, al U.FL del Ra-01SH; no se suelda | 13,05 | 22,54 | 195,70 |
| LQW15AN10NG00D | Kit de banco: L de entrada del LNA en alta ganancia | 0,48 | 0,96 | 7,90 |
| LQW15AN12NG00D | Kit de banco: L de entrada del LNA en bajo consumo | 0,89 | 0,89 | 7,28 |
| 0402WGF374JTCE | Kit de banco: serie del atenuador de 6 dB con la Taoglas | 0,14 | 0,14 | 0,28 |
| NCP15XH103F03RC | Kit de banco: NTC de 10 kΩ para el TS sin la celda | 0,84 | 0,84 | 3,38 |
| PESD5V0F1BL,315 | Kit de banco: ESD de silicio de 0,4 pF para el nodo del U.FL | 0,86 | 1,72 | 11,70 |
| **Total** | | **78,44** | **151,45** | **1.257,94** |

<!-- fin de lo generado -->

Notas a las tablas:

- **NAND**: la del diseño es la **W25N02KVZEIR** (2 Gbit, unas 8 sesiones de 3 h; `pod-f3.md`), a 7,81 a 100. Contra la W25N04KVZEIR (4 Gbit, 14,59 a 100) ahorra **6,78** por placa a 100, 5,29 a 10 y 19,48 a 5 (LCSC vende la de 4 Gbit de a 10 y la de 2 Gbit de a 1). La W25N04KVZEIR queda como alternativa en el mismo lugar para una variante de más capacidad (mismos pines y comandos según las hojas de Winbond). La GigaDevice **GD5F4GQ6UEYIGR** (4 Gbit, WSON-8 de 8 × 6) sería la segunda fuente de esa variante, pero hoy **no ahorra**: sin stock en LCSC (14,46 a 100 sin stock) ni en DigiKey (solo el carrete de 3.000 a 20,33, sin pedido pendiente). Sus pines y su juego de comandos (ECC, lectura continua, registros de estado) difieren en detalle de la W25N: si se suma, el driver del firmware tiene que soportar las dos (**no verificado**).
- **Variantes** (a 100 placas, por placa): LC29H(EA) en lugar de la AA, **+12,41** (24,66 en LCSC contra 12,25); UWB DWM3000 montado, **+19,84** más dos capacitores (DigiKey). En el pedido de 5 (3 AA, 2 EA, una con UWB) las partes suben unos **+11,0 por placa** promedio: (2 × (31,78 − 16,04) + 23,46) / 5, con los precios a 1 unidad.
- **Antena LoRa**: la **Molex 2111400100** (DigiKey 5.706, 1,96 a 100) reemplaza a la Ebyte TX915-FPC-4510, que no tenía precio ni stock confirmados.
- **Contra el diseño anterior** (MDBT50Q, E22, LSM6DSV320X, GVLB208.A, TPS22916C y TX915): **84,08 / 73,44 / 61,30** por placa a 5 / 10 / 100 antes, **74,05 / 65,13 / 53,98** ahora (−10,03 / −8,31 / −7,32).

## Plan de stock

Auditoría completa, parte por parte, en [`stock.md`](stock.md) (leída el **09/11/2026** para 100 pods más las 5 de la v0). Para la v0 alcanza con lo que hay; para las 100 se compra ya lo barato que depende de una sola fuente y se reserva lo caro al aprobar la v0:

| Parte | Estado el 09/11/2026 | Plan | Respaldo |
|---|---|---|---|
| **BMD-340-A-R** (`U301`) | ✓ DigiKey 10.055 (stock propio; fábrica 20 semanas) | **150 en DigiKey** (revisión -10) | Fanstel BT840 (otro footprint; DigiKey 10.247) |
| **Ra-01SH** (`U302`) | ✓ LCSC 2.239 | **10 ya** para la puerta de banco de frecuencia; **150** al pasarla | NiceRF LoRa1262-915TCXO (otro footprint, con TCXO; LCSC 1.232) |
| **LSM6DSV32XTR** (`U401`) | ✓ LCSC 3.032, DigiKey 24.971 | **150 en LCSC** ya | LSM6DSV320X o 80X pin a pin cuando vuelvan (otro `compatible`) |
| **ADXL372** (`U403`, variante `pod-v0-highg`) | ✓ LCSC 1.534 | **10 en LCSC** para las 2 placas de medición | — |
| **GVLB258.A** (`AE201`) | ✓ DigiKey 895 | **150 en DigiKey** ya | Taoglas AGVLB.25B activa por el U.FL |
| **LC29H(AA)** (`U201`) | ⚠ DigiKey 522, una sola fuente | **150 en DigiKey** ya | LC29H(EA) en el mismo lugar (+12,41) |
| **TPS22919DCKR** (`U303`; `U105` y `U502` sin montar) | ✓ LCSC 19.720 | 150 en LCSC (450 si se montan los tres) | TPS22918 / TPS22917 (otro footprint) |
| **DRV5032FA** (`U406`) | ✓ LCSC 47.200 | **150 en LCSC** ya | La **FB**, alternativa aprobada cuando vuelva |
| **2111400100** (antena LoRa, no se suelda) | ✓ DigiKey 5.706 | 150 en DigiKey | Taoglas FXP890.07.0100C (DigiKey 197) |
| BGA525N6 (`U205`) | ✓ LCSC 1.801; DigiKey 0 (40 semanas) | **150 en LCSC** ya | Ninguno pin a pin con L1 + L5: con la Taoglas activa se puentea |
| TPS7A2032P (`U104`) | ✓ DigiKey 3.348; LCSC 0 | **150 en DigiKey** ya | Ninguna aprobada: la LP5907MFX-3.2 queda pendiente (pide menos de 10 µF a la salida; ADR 0105) |
| SAW B39162B8389P810 (`FL201`, `FL202`) | ✓ DigiKey 7.710, LCSC 218 | 300 en DigiKey al aprobar la v0 | — |

Lo que se compra ya (BMD-340, LSM6DSV32X, GVLB258.A, LC29H, BGA525N6, TPS7A2032P, 10 Ra-01SH y 10 ADXL372) suma unos **US$ 5.100** (detalle en `stock.md` y en [`alternativas-en-stock.md`](alternativas-en-stock.md)).

## 2. Placa desnuda (estimación)

Placa de 4 capas, 1,6 mm, unos 50 × 70 mm, FR4 Tg 150+, ENIG, máscara verde, impedancia controlada, **vías en el pad rellenas y tapadas** (las 4 del pad expuesto del TPS63900), **oro duro electrolítico selectivo** en los 5 pads de la base, vía mínima de 0,45/0,2 mm. Ninguno de los dos calculadores se pudo leer en línea: **no verificado**.

| Concepto | 10 placas (para 5 armadas) | 100 placas | Base de la estimación |
|---|---|---|---|
| 4 capas, ENIG, impedancia | 60–120 | 250–450 | Rango habitual de prototipos de 4 capas en PCBWay y JLCPCB; JLCPCB no cobra el control de impedancia |
| Vías en el pad rellenas y tapadas | 30–80 | 60–150 | JLCPCB lo cobra en 4 capas (gratis desde 6) sin publicar el monto; PCBWay dice "puede ser más caro" |
| Oro duro selectivo en 5 pads | 50–150 | 100–300 | Necesita bus de plateado o un proceso aparte; JLCPCB probablemente no lo hace en pads que no están en el borde |
| **Total** | **140–350** | **410–900** | Por placa: 14–35 con 10 y 4–9 con 100 |

## 3. Armado (estimación)

Datos de la placa (de `bom_pcbway.py`): **55 partes distintas**, **139 componentes**, unos **484 pads** soldados, todo SMT de un lado salvo el pin del patch (a mano, después del reflujo) y quizás el Hall, si se lo pone en la cara de abajo (segunda pasada). Encapsulados de riesgo: **DSBGA de 0,4 mm** (BQ25180; los load switches pasaron a SC-70-6), **LGA** (LSM6DSV32X, BMP581; el ADXL372 en la variante `pod-v0-highg`), TSNP-6 de 0,4 mm (BGA525N6), SAW de 1,4 × 1,1 mm, WSON con pad expuesto (TPS63900, NAND), módulos con pads abajo (BMD-340 de 68, LC29H) y el Ra-01SH almenado: rayos X en unos 8 por placa.

Con las tarifas publicadas de JLCPCB (Standard PCBA, la única que arma 0,4 mm; [tarifas](https://jlcpcb.com/help/article/pcb-assembly-price), leídas el 08/11/2026) como referencia:

| Concepto | 5 placas | 100 placas |
|---|---|---|
| Setup de una cara + stencil | 25,56 + 8,21 | 25,56 + 8,21 |
| Carga de partes "extended" (unas 50 × 1,53) | 76,50 | 76,50 |
| Colocación y prerreflujo (0,0016 + 0,016 por junta) | 42 | 847 |
| Rayos X (9 por placa: 1,64 hasta 10 piezas, 0,49 de 51 a 200) | 22–74 | 441 |
| Soldadura a mano del patch | 3,66 | 5,22 |
| Fixture, manipulación y por placa | 34 | 104 |
| **Total JLCPCB (cálculo)** | **unos 215–265** (43–53 por placa) | **unos 1.510** (15 por placa) |

**PCBWay** no publica tarifa por junta: se toma el mismo orden, **150–350 para 5 placas** y **12–20 por placa a 100** (**estimación**, a reemplazar con su cotización). El stencil con marco, si no viene incluido: 15–30 (**no verificado**).

## 4. Envío e importación (lugares a completar)

| Concepto | 5 placas | 10 | 100 | Fuente |
|---|---|---|---|---|
| Courier de China (placas armadas, sin batería) | 40–80 | 50–90 | 120–250 | **Estimación**; se cotiza con el pedido |
| Partes que mandamos nosotros (patch desde DigiKey a PCBWay) | 30–60 | 30–60 | 60–120 | **Estimación** |
| Impuestos y despachante en Argentina | **A definir** | **A definir** | **A definir** | Consulta 4 de [`consultas.md`](consultas.md). Para el cálculo de abajo, **supuesto de trabajo** de 50 % sobre el valor en origen más los honorarios, **no verificado** |

## 5. Costo por pod

Placa armada en origen, sin batería, carcasa ni importación (variante base AA; los rangos suman los extremos de cada fila):

| | 5 placas | 10 placas | 100 placas |
|---|---|---|---|
| Partes (tabla generada de la sección 1) | 74,05 | 65,13 | 53,98 |
| Placa desnuda (se piden 10 para armar 5) | 28–70 | 14–35 | 4–9 |
| Armado | 30–70 | 20–35 | 12–20 |
| Envío desde China y consignados | 14–28 | 8–15 | 2–4 |
| **Placa armada en Buenos Aires, sin impuestos** | **unos 145–245** | **unos 105–150** | **unos 72–87** |
| Batería certificada, carcasa MJF con junta y etiqueta (de `pod-f3.md`, **no verificado**) | 12–18 | 12–18 | 11–16 |
| **Pod completo, sin impuestos** | **unos 157–263** | **unos 117–168** | **unos 83–103** |

- A 100, la placa armada (72–87) queda en el orden de los 85–95 a nivel de placa de `pod-mecanica-produccion.md`, y el pod completo, **arriba de los US$ 80** del ADR 0105. Lo que más mueve: la **LC29H** (12,25), el **BMD-340** (9,60), el armado, la NAND y el **patch** (7,05 la GVLB258.A) (la de 2 Gbit ya está en el diseño; la variante de 4 Gbit suma **+6,78**).
- Con la EA en todas: **+12,41** por pod a 100.
- Con los impuestos argentinos (supuesto de 50 %), multiplicar por 1,5 lo que viene de afuera.

## 6. NRE (una vez, estimación)

| Concepto | US$ | Nota |
|---|---|---|
| v0: 10 placas, 5 armadas, partes y envío | 1.000–1.500 | Secciones 1–4 con 5 placas |
| v0: lo que no se suelda (2 Taoglas AGVLB.25B de rescate, las FPC de LoRa y el kit de banco) | unos 78 | Tabla generada de la sección 1 |
| v0.1: segunda vuelta igual | 800–1.300 | Dos vueltas antes del piloto (sección 11 de `pod-mecanica-produccion.md`) |
| Plantilla de prueba con pogo (fin de línea) | 300–800 | **No verificado** |
| Base de carga de prueba (B-907) | 200–500 | **No verificado** |
| Ajuste del patch por Taoglas (servicio CSA.20) o cámara | 1.000–3.000 | **No verificado**; consulta 6 |
| Ensayos de laboratorio y certificado para ENACOM | 3.000–8.000 | **No verificado**; consulta 3 |
| VID de USB-IF | unos 6.000 | De `pod-mecanica-produccion.md`, **no verificado** |
| Despachante (por envío) | A definir | Consulta 4 |

## Cómo actualizar

1. Cambiar el precio o la fuente de una parte en `hardware/tools/datos/partes_pod_v0.csv` (escalones `cantidad:precio` separados por `;`, con la fecha).
2. Correr `python3 hardware/tools/bom_pcbway.py`: reescribe las listas y [`costo-partes-pod-v0.csv`](costo-partes-pod-v0.csv), y muestra los totales por placa.
3. Las tablas de la sección 1 (entre los marcadores) se reescriben solas en el paso 2. A mano: la sección 5 con los totales nuevos y las secciones 2–4 con las cotizaciones de PCBWay y JLCPCB.
