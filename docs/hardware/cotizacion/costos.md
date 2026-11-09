# Costos del pod v0 (B-909)

Planilla de costo de abajo hacia arriba que pide `pod-mecanica-produccion.md` (sección 10), para 5, 10 y 100 placas. Los precios de las partes se leyeron el **08/11/2026** en LCSC, JLCPCB y DigiKey (fuente de cada una en [`partes_pod_v0.csv`](../../../hardware/tools/datos/partes_pod_v0.csv)). El resto (placa, armado, envío, importación, NRE) son **estimaciones** marcadas como tales: se reemplazan con las cotizaciones de [`pedido-pcbway.md`](pedido-pcbway.md).

Todo en US$, sin IVA ni impuestos argentinos.

## 1. Partes

[`costo-partes-pod-v0.csv`](costo-partes-pod-v0.csv) tiene cada fila de la lista (55 partes distintas, 139 componentes montados por placa) con la cantidad que se compra, el precio unitario y el total para 5, 10 y 100 placas. La genera `hardware/tools/bom_pcbway.py` desde la netlist y la planilla de partes, y el CI falla si queda desactualizada.

Reglas del cálculo:

- **Cantidad comprada** = cantidad por placa × placas, más **10 de desperdicio** por fila en resistencias, capacitores, bobinas y ESD (lo que suele pedir el armador). Si queda por debajo del mínimo de venta, se paga el mínimo (el primer escalón de la planilla).
- **Precio** del escalón que corresponde a esa cantidad, de la fuente con stock y menor precio (la columna `fuente_precio`). DigiKey solo muestra el precio de Marketplace de la -P1MV2 a 1 unidad: a 100 se usa ese mismo (**no verificado** a volumen).
- **Variante base**: LC29H(AA), sin UWB, con el patch pasivo. Las variantes, abajo.

Las tablas de abajo las escribe `bom_pcbway.py` en este archivo (entre los marcadores), con los mismos números de [`costo-partes-pod-v0.csv`](costo-partes-pod-v0.csv): no se editan a mano.

<!-- generado por hardware/tools/bom_pcbway.py: no editar a mano -->

| Placas | Partes por placa | Total de partes |
|---|---|---|
| 5 | **85,12** | 425,61 |
| 10 | **74,27** | 742,73 |
| 100 | **61,95** | 6.194,52 |

**Lo que más pesa** (a 100 placas, por placa):

| Parte | Cant. | US$ por placa | Fuente |
|---|---|---|---|
| LC29HAAMD | 1 | 12,25 | digikey |
| GVLB208.A | 1 | 11,79 | digikey |
| W25N02KVZEIR | 1 | 7,81 | lcsc |
| LSM6DSV320XTR | 1 | 6,72 | digikey |
| MDBT50Q-P1MV2 | 1 | 6,00 | digikey |
| E22-900M22S | 1 | 5,11 | jlcpcb |
| Las otras 49 filas | — | 12,25 | — |

**Lo que no se suelda** ([`bom-pod-v0-extras.csv`](bom-pod-v0-extras.csv)), total del pedido:

| Parte | Para qué | 5 placas | 10 placas | 100 placas |
|---|---|---|---|---|
| AGVLB.25B.07.0060A | Rescate y referencia de banco por el U.FL (2 por cada 5 placas); no se suelda | 62,18 | 124,36 | 1.031,70 |
| TX915-FPC-4510 | Antena LoRa FPC pegada en la carcasa, al U.FL del E22; no se suelda | sin precio | sin precio | sin precio |
| LQW15AN10NG00D | Kit de banco: L de entrada del LNA en alta ganancia | 0,48 | 0,96 | 7,90 |
| LQW15AN12NG00D | Kit de banco: L de entrada del LNA en bajo consumo | 0,89 | 0,89 | 7,28 |
| 0402WGF374JTCE | Kit de banco: serie del atenuador de 6 dB con la Taoglas | 0,14 | 0,14 | 0,28 |
| NCP15XH103F03RC | Kit de banco: NTC de 10 kΩ para el TS sin la celda | 0,84 | 0,84 | 3,38 |
| PESD5V0F1BL,315 | Kit de banco: ESD de silicio de 0,4 pF para el nodo del U.FL | 0,86 | 1,72 | 11,70 |
| **Total** | | **65,39** | **128,91** | **1.062,24** |

<!-- fin de lo generado -->

Notas a las tablas:

- **NAND**: la del diseño es la **W25N02KVZEIR** (2 Gbit, unas 8 sesiones de 3 h; `pod-f3.md`), a 7,81 a 100. Contra la W25N04KVZEIR (4 Gbit, 14,59 a 100) ahorra **6,78** por placa a 100, 5,29 a 10 y 19,48 a 5 (LCSC vende la de 4 Gbit de a 10 y la de 2 Gbit de a 1). La W25N04KVZEIR queda como alternativa en el mismo lugar para una variante de más capacidad (mismos pines y comandos según las hojas de Winbond). La GigaDevice **GD5F4GQ6UEYIGR** (4 Gbit, WSON-8 de 8 × 6) sería la segunda fuente de esa variante, pero hoy **no ahorra**: sin stock en LCSC (14,46 a 100 sin stock) ni en DigiKey (solo el carrete de 3.000 a 20,33, sin pedido pendiente). Sus pines y su juego de comandos (ECC, lectura continua, registros de estado) difieren en detalle de la W25N: si se suma, el driver del firmware tiene que soportar las dos (**no verificado**).
- **Variantes** (a 100 placas, por placa): LC29H(EA) en lugar de la AA, **+12,41** (24,66 en LCSC contra 12,25); UWB DWM3000 montado, **+19,84** más dos capacitores (DigiKey). En el pedido de 5 (3 AA, 2 EA, una con UWB) las partes suben unos **+11,0 por placa** promedio: (2 × (31,78 − 16,04) + 23,46) / 5, con los precios a 1 unidad.
- **Antena LoRa TX915-FPC-4510**: **cotización abierta** (sin precio ni stock en LCSC); se pide a Ebyte (consulta 7 de [`consultas.md`](consultas.md)).

## Plan de stock

Para los 5 y los 10 alcanza con lo que hay; para los 100 hay que comprar o reservar **al pedir la v0** (detalle por parte en `partes_pod_v0.csv`):

| Parte | Stock el 08/11/2026 | Plan | Respaldo |
|---|---|---|---|
| **LSM6DSV320X** (`U401`) | LCSC 0, JLCPCB 3, DigiKey 0 (24 semanas, admite pedido pendiente) | Pedido pendiente de **130** en DigiKey o Mouser ya; preguntar al eStore de ST. v0: las 3 de JLCPCB + 2 de otra fuente | **LSM6DSV16X** (LCSC C5267406, 11.056 en stock, 2,43 a 100) en el mismo lugar, sin el canal de 320 g, con el **ADXL372** montado para el alto rango. Que el 16X sea pin a pin con el 320X: **no verificado** (contra las dos hojas de ST). El ICM-42688-P también escasea (DigiKey en agosto de 2027) |
| **DRV5032FB** (`U406`) | LCSC 0, DigiKey 0 (julio de 2027), JLCPCB 286 | Comprar unas **150 en ti.com** y consignarlas a PCBWay | Calificar ya la **DRV5032FA** (20 Hz, 1,6 µA; LCSC C140921, 47.210 en stock) en el mismo lugar |
| **BGA525N6** (`U205`) | LCSC 1.801, DigiKey 0 (40 semanas) | **Reservar 150 en LCSC** ya; consultar Mouser y Arrow | Ninguno pin a pin: con la Taoglas activa por el U.FL se puentea |
| **MDBT50Q-P1MV2** (`U301`) | LCSC 0, DigiKey Marketplace 37 | Pedir **120 a Raytac** en el mismo mail de la revisión del layout (consulta 1); PCBWay puede recibirlo consignado ("maybe" en la lista) | **MDBT50Q-1MV2** (antena chip, mismo footprint de EasyEDA) |
| TPS7A2032P (`U104`) | LCSC 0, DigiKey 3.358 | Comprar en DigiKey | — |
| TPS22916C (`U303`) | LCSC 1.060, DigiKey en diciembre | LCSC | TPS22917/18 en SOT-23-6 (otro footprint) |
| SAW B39162B8389P810 (`FL201`, `FL202`) | LCSC 218, DigiKey 7.710 | DigiKey | — |

## 2. Placa desnuda (estimación)

Placa de 4 capas, 1,6 mm, unos 50 × 70 mm, FR4 Tg 150+, ENIG, máscara verde, impedancia controlada, **vías en el pad rellenas y tapadas** (las 4 del pad expuesto del TPS63900), **oro duro electrolítico selectivo** en los 5 pads de la base, vía mínima de 0,45/0,2 mm. Ninguno de los dos calculadores se pudo leer en línea: **no verificado**.

| Concepto | 10 placas (para 5 armadas) | 100 placas | Base de la estimación |
|---|---|---|---|
| 4 capas, ENIG, impedancia | 60–120 | 250–450 | Rango habitual de prototipos de 4 capas en PCBWay y JLCPCB; JLCPCB no cobra el control de impedancia |
| Vías en el pad rellenas y tapadas | 30–80 | 60–150 | JLCPCB lo cobra en 4 capas (gratis desde 6) sin publicar el monto; PCBWay dice "puede ser más caro" |
| Oro duro selectivo en 5 pads | 50–150 | 100–300 | Necesita bus de plateado o un proceso aparte; JLCPCB probablemente no lo hace en pads que no están en el borde |
| **Total** | **140–350** | **410–900** | Por placa: 14–35 con 10 y 4–9 con 100 |

## 3. Armado (estimación)

Datos de la placa (de `bom_pcbway.py`): **55 partes distintas**, **139 componentes**, unos **481 pads** soldados, todo SMT de un lado salvo el pin del patch (a mano, después del reflujo) y quizás el Hall, si se lo pone en la cara de abajo (segunda pasada). Encapsulados de riesgo: **DSBGA de 0,4 mm** (BQ25180, TPS22916C), **LGA** (LSM6DSV320X, BMP581), TSNP-6 de 0,4 mm (BGA525N6), SAW de 1,4 × 1,1 mm, WSON con pad expuesto (TPS63900, NAND), módulos con pads abajo (MDBT50Q de 61, LC29H, E22): rayos X en esos 9 por placa.

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
| Partes (tabla generada de la sección 1) | 85,12 | 74,27 | 61,95 |
| Placa desnuda (se piden 10 para armar 5) | 28–70 | 14–35 | 4–9 |
| Armado | 30–70 | 20–35 | 12–20 |
| Envío desde China y consignados | 14–28 | 8–15 | 2–4 |
| **Placa armada en Buenos Aires, sin impuestos** | **unos 155–255** | **unos 115–160** | **unos 80–95** |
| Batería certificada, carcasa MJF con junta y etiqueta (de `pod-f3.md`, **no verificado**) | 12–18 | 12–18 | 11–16 |
| **Pod completo, sin impuestos** | **unos 169–271** | **unos 128–177** | **unos 91–111** |

- A 100, la placa armada (80–95) queda en el orden de los 85–95 a nivel de placa de `pod-mecanica-produccion.md`, y el pod completo, **arriba de los US$ 80** del ADR 0105. Lo que más mueve: el **patch** (11,79 de DigiKey; con Taoglas directo a 500 o más, unos 10,8), el armado y la NAND (la de 2 Gbit ya está en el diseño; la variante de 4 Gbit suma **+6,78**).
- Con la EA en todas: **+12,41** por pod a 100.
- Con los impuestos argentinos (supuesto de 50 %), multiplicar por 1,5 lo que viene de afuera.

## 6. NRE (una vez, estimación)

| Concepto | US$ | Nota |
|---|---|---|
| v0: 10 placas, 5 armadas, partes y envío | 1.000–1.500 | Secciones 1–4 con 5 placas |
| v0: lo que no se suelda (2 Taoglas AGVLB.25B de rescate y el kit de banco) | unos 65 | Tabla generada de la sección 1 (las Taoglas, 62,18); falta la FPC de LoRa, cotización abierta |
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
