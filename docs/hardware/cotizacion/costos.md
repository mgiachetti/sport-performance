# Costos del pod v0 (B-909)

Planilla de costo de abajo hacia arriba que pide `pod-mecanica-produccion.md` (sección 10), para 5, 10 y 100 placas. Los precios de las partes se leyeron el **08/11/2026** en LCSC, JLCPCB y DigiKey (fuente de cada una en [`partes_pod_v0.csv`](../../../hardware/tools/datos/partes_pod_v0.csv)). El resto (placa, armado, envío, importación, NRE) son **estimaciones** marcadas como tales: se reemplazan con las cotizaciones de [`pedido-pcbway.md`](pedido-pcbway.md).

Todo en US$, sin IVA ni impuestos argentinos.

## 1. Partes

[`costo-partes-pod-v0.csv`](costo-partes-pod-v0.csv) tiene cada fila de la lista (55 partes distintas, 139 componentes montados por placa) con la cantidad que se compra, el precio unitario y el total para 5, 10 y 100 placas. La genera `hardware/tools/bom_pcbway.py` desde la netlist y la planilla de partes, y el CI falla si queda desactualizada.

Reglas del cálculo:

- **Cantidad comprada** = cantidad por placa × placas, más **10 de desperdicio** por fila en resistencias, capacitores, bobinas y ESD (lo que suele pedir el armador). Si queda por debajo del mínimo de venta, se paga el mínimo (por eso a 5 placas sobran, por ejemplo, 5 NAND: LCSC vende de a 10).
- **Precio** del escalón que corresponde a esa cantidad, de la fuente con stock y menor precio (la columna `fuente_precio`). DigiKey solo muestra el precio de Marketplace de la -P1MV2 a 1 unidad: a 100 se usa ese mismo (**no verificado** a volumen).
- **Variante base**: LC29H(AA), sin UWB, con el patch pasivo. Las variantes, abajo.

| Placas | Partes por placa | Total de partes |
|---|---|---|
| 5 | **104,73** | 523,66 |
| 10 | **79,68** | 796,85 |
| 100 | **68,83** | 6.883,01 |

**Lo que más pesa** (a 100 placas, por placa):

| Parte | US$ | Fuente | Nota |
|---|---|---|---|
| NAND W25N04KVZEIR | 14,59 | LCSC | La W25N02KVZEIR (2 Gbit) entra en el mismo lugar a 7,81: ahorra 6,78 |
| GNSS LC29H(AA) | 12,25 | DigiKey | 523 en stock; JLCPCB 91 |
| Patch Taoglas GVLB208.A | 11,79 | DigiKey | Solo DigiKey; va consignado o lo compra PCBWay |
| IMU LSM6DSV320X | 6,72 | DigiKey | **Sin stock** en DigiKey y LCSC (JLCPCB 3): riesgo principal |
| Raytac MDBT50Q-P1MV2 | 6,00 | DigiKey Marketplace | 37 en stock; LCSC sin stock |
| LoRa E22-900M22S | 5,11 | JLCPCB | No está en DigiKey |
| BMP581, MAX17048, 2 SAW, BQ25180 | 6,66 | LCSC y DigiKey | — |
| Las otras 44 filas | 5,71 | — | Alimentación, ESD, conectores, pasivos |

**Variantes** (a 100 placas, por placa): LC29H(EA) en lugar de la AA, **+12,41** (24,66 en LCSC contra 12,25); UWB DWM3000 montado, **+19,84** más dos capacitores (DigiKey). Con la W25N02 en lugar de la W25N04, **−6,78**. En el pedido de 5 (3 AA, 2 EA, una con UWB) las partes suben unos **+11,0 por placa** promedio: (2 × (31,78 − 16,04) + 23,46) / 5, con los precios a 1 unidad.

**Riesgos de stock** (detalle en `partes_pod_v0.csv`): LSM6DSV320X (24 semanas en DigiKey), DRV5032FB (solo JLCPCB, 286; DigiKey en julio de 2027), BGA525N6 (solo LCSC, 1.801; DigiKey 40 semanas), TPS7A2032P (solo DigiKey, 3.358), MDBT50Q-P1MV2 (DigiKey Marketplace, 37), TPS22916C (LCSC 1.060, DigiKey en diciembre), SAW (LCSC 218, DigiKey 7.710). Para los 5 y los 10 alcanza; para los 100 hay que **reservar** el LSM6DSV320X, el BGA525N6 y el DRV5032FB al pedir la v0.

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
| Partes | 104,73 | 79,68 | 68,83 |
| Placa desnuda (se piden 10 para armar 5) | 28–70 | 14–35 | 4–9 |
| Armado | 30–70 | 20–35 | 12–20 |
| Envío desde China y consignados | 14–28 | 8–15 | 2–4 |
| **Placa armada en Buenos Aires, sin impuestos** | **unos 175–275** | **unos 120–165** | **unos 87–102** |
| Batería certificada, carcasa MJF con junta y etiqueta (de `pod-f3.md`, **no verificado**) | 12–18 | 12–18 | 11–16 |
| **Pod completo, sin impuestos** | **unos 189–291** | **unos 134–183** | **unos 98–118** |

- A 100, el pod queda **arriba de los US$ 80** del ADR 0105 y de los 85–95 a nivel de placa de `pod-mecanica-produccion.md`. Lo que más mueve: la **NAND de 4 Gbit** (−6,78 con la de 2 Gbit), el **patch** (11,79 de DigiKey; con Taoglas directo a 500 o más, unos 10,8) y el armado.
- Con la EA en todas: **+12,41** por pod a 100.
- Con los impuestos argentinos (supuesto de 50 %), multiplicar por 1,5 lo que viene de afuera.

## 6. NRE (una vez, estimación)

| Concepto | US$ | Nota |
|---|---|---|
| v0: 10 placas, 5 armadas, partes y envío | 1.000–1.500 | Secciones 1–4 con 5 placas |
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
3. Actualizar las tablas de este archivo con los totales nuevos y las cotizaciones de PCBWay y JLCPCB.
