# Pedido de cotización a PCBWay (y a JLCPCB) del pod v0 (B-909)

Todo lo que PCBWay necesita para cotizar la placa y el armado, las preguntas que hay que hacerle, el mail listo para mandar y una versión corta para JLCPCB, para comparar. Los costos estimados están en [`costos.md`](costos.md); las consultas a los demás proveedores, en [`consultas.md`](consultas.md).

**Cuándo mandarlo:** el mail 1 (cotización y revisión de fabricación del apilado) se puede mandar ya, con este archivo y las listas. Desde el 27/11/2026 la placa está ubicada y ruteada entera (DRC 0/0) y el paquete de fabricación sale de `hardware/tools/fabricacion.py` (en el CI, artefacto `pod-v0-pcbway`): con él se pide la cotización en línea y la revisión de fabricación (DFM). El pedido en firme sale después de la revisión previa al pedido de `pod-mecanica-produccion.md` (sección 11).

## Qué se adjunta

| Archivo | Qué es | Estado |
|---|---|---|
| [`bom-pod-v0.csv`](bom-pod-v0.csv) | Lista de armado en las columnas de PCBWay (línea, designadores, cantidad, fabricante, MPN, número de distribuidor, descripción, encapsulado, SMT o THT, instrucciones), con LCSC, DigiKey, la marca de lo que mandamos nosotros y la **alternativa aprobada** de cada fila que la tiene (`Approved Alternate`, de [`stock.md`](stock.md)). 57 filas, 141 componentes | Listo. Las columnas siguen la página de requisitos de armado de PCBWay; que coincidan con su planilla de ejemplo (`Sample_BOM_PCBWay.xlsx`) está **no verificado**: si la piden, se pasan las mismas columnas a esa planilla |
| [`bom-pod-v0-sin-montar.csv`](bom-pod-v0-sin-montar.csv) | Los 26 lugares sin montar (69 componentes): no se arman, pero el armador los ve en el pick and place | Listo |
| [`bom-pod-v0-extras.csv`](bom-pod-v0-extras.csv) | Lo que se compra y no se suelda (Taoglas de rescate, kit de banco con la FPC de LoRa para el A/B) | Listo; no va a PCBWay |
| `pod-v0-pcbway.zip`: Gerbers de las 6 capas (con el job file X2), taladros Excellon (PTH y NPTH aparte) con sus mapas, netlist IPC-D-356 para la prueba eléctrica, pick and place (CSV en mm, las dos caras, sin los DNP, origen en la esquina de abajo a la izquierda), las dos listas, el PDF del esquemático y `LEEME-PCBWAY.txt` | `python3 hardware/tools/fabricacion.py` en la imagen de KiCad (`hardware/README.md`, "Salidas de fabricación"); el CI lo genera en cada cambio y lo guarda como artefacto | Listo desde el 27/11/2026. Verifica el pick and place contra la lista y los taladros contra la placa |

Las listas salen de la netlist con `python3 hardware/tools/bom_pcbway.py` (el CI falla si quedan viejas). [`bom-pod-v0-jlcpcb.csv`](bom-pod-v0-jlcpcb.csv) es la misma lista en el formato de JLCPCB.

## Placa

| Parámetro | Valor |
|---|---|
| Capas | **6** (desde el 23/11/2026; antes 4), FR4 Tg 150 o más |
| Espesor terminado | 1,6 mm |
| Tamaño | 50 × 70 mm, con esquinas de radio 5 mm y una muesca de radio 2,7 mm en cada esquina (contorno en la placa de KiCad) |
| Cobre | 1 oz terminado afuera; adentro, el del apilado de impedancia que propongan (el diseño supone 0,5 oz) |
| Pista y separación mínimas | 0,1 / 0,1 mm (la mayoría a 0,15 mm o más) |
| Vía mínima | 0,45 mm de diámetro con agujero de 0,2 mm; la habitual, 0,5/0,2 y 0,6/0,3 |
| Vías en el pad | **No hacen falta** (desde el 27/11/2026). Ninguna vía de la placa cae en un pad SMD ni a menos de 0,15 mm de uno: el BMD-340 sale con una pista corta a una vía al lado de cada pad, en columnas fijas al costado de sus cuatro columnas de pads del lado de adentro, y la costura y el escape de GND no se apoyan en los pads. `fabricacion.py` falla si aparece una. Las vías van tapadas con máscara de los dos lados (sin relleno). Lo único con agujeros en un pad son las **4 vías térmicas de Ø0,2 mm del pad expuesto del TPS63900** (`U103`, WSON-10, del footprint `..._ThermalVias`), sin rellenar: con 0,2 mm se llevan poca soldadura; si PCBWay pregunta, se pueden tapar del lado de abajo. **Hasta el 27/11/2026** el escape del BMD-340 ponía la vía en el pad y había que pedir **todas** las vías rellenas con resina y tapadas (POFV): el pedido W237290AS5P2 se mandó así (ver "Precios por variante") |
| Acabado | **ENIG** en toda la placa |
| Oro duro | **No hace falta** (desde el 14/11/2026): los 5 pads de `J601` son pads ENIG donde se sueldan los resortes internos del inserto de contactos; el oro duro va en los pines del inserto, en la carcasa. Oro duro grueso debajo de una soldadura es un problema de confiabilidad (fragiliza la junta) |
| Máscara y serigrafía | Verde y blanca; **puente de máscara entre los pads de 0,4 mm** (DSBGA, TSNP) si su mínimo lo permite, y si no, que lo digan (queda una ventana común) |
| Tolerancia de espesor | 1,6 mm ± 10 % (publican ± 0,18 mm en multicapa): que la confirmen, porque fija el alto de los resortes de la base |
| Impedancia controlada | **Sí**: CPWG de 50 Ω en L1 referida a L2 (GNSS 1176/1575 MHz y LoRa 915 MHz) y en L6 referida a L5 (la alimentación del patch), y par diferencial de 90 Ω (USB) en L1 y L6, con su cupón de prueba |
| Agujeros | El pin del patch: agujero metalizado de Ø1,0 mm; dos agujeros de herramienta de 2,1 mm sin metalizar; tres agujeros M2 de Ø2,2 mm metalizados con anillo de vías (tornillos de la placa, a GND); los agujeros del Tag-Connect TC2030-NL |
| Panel | Si lo piden: rieles con fiduciales y agujeros, **lejos de la antena del BMD-340** (borde izquierdo, 4,4 mm sin cobre) y **sin V-score ni puentes en ese borde** |

### Apilado e impedancia (lo primero que hay que cerrar)

El diseño supone hoy, en **6 capas** desde el 23/11/2026 (`hardware/README.md`, "Apilado"; no verificado): L1 de 35 µm, prepreg 7628 de 0,2 mm con εr 4,4, L2 (GND), núcleo de 0,3 mm con εr 4,6, L3, prepreg de 0,46 mm, L4 (alimentación), núcleo de 0,3 mm, L5 (GND), prepreg de 0,2 mm y L6 de 35 µm; las internas de 17,5 µm. Lo que importa para la impedancia es el prepreg de afuera (L1–L2 y L5–L6), el mismo de la placa de 4 capas, así que la geometría no cambió. Con eso, `hardware/tools/impedancia.py` da (las columnas de PCBWay y JLCPCB son sus apilados publicados de 4 capas, leídos el 08/11/2026; con el de 6 capas que propongan se recalcula):

| Línea | Geometría | Con el apilado supuesto | Con el "Design 1" de PCBWay (prepreg 7628 de 0,1855 mm, Dk 4,74) | Con el JLC04161H-7628 (0,2104 mm, Dk 4,4) |
|---|---|---|---|---|
| CPWG de 50 Ω | pista de 0,33 mm, ranura de 0,20 mm | 52,3 Ω (unos 51 con máscara) | **49,0 Ω** sin máscara | 53,4 Ω |
| Par USB de 90 Ω | 0,25 mm, separación de 0,15 mm | 88,9 Ω | **84,0 Ω** | 90,3 Ω |

El "Design 1" es el apilado de 1,6 mm que PCBWay publica en su [página de apilados](https://www.pcbway.com/multi-layer-laminated-structure.html) (leída el 08/11/2026): L1 de 0,5 oz más plateado, prepreg 7628 de 0,1855 mm después de laminar (Dk 4,74), núcleo de 1,03 mm (Dk 4,6) con 1 oz por lado, y simétrico. Con ese apilado la CPWG queda un poco baja y el par USB en 84 Ω: **se le pide a PCBWay que calcule con su solver (SI9000 o el que usen) con la máscara** y que proponga el ancho y la ranura para 50 Ω y para 90 Ω, con su tolerancia (publican ±10 %, ±5 Ω en 50 Ω). Se les pide también su apilado de 6 capas de 1,6 mm (espesores de los núcleos y prepregs de adentro), cuidando que L1–L2 y L5–L6 queden iguales. Con su respuesta se corrigen el apilado de `pod-v0.kicad_pcb`, las clases de red, `pod-v0.kicad_dru` y `impedancia.py`.

## Armado

| Parámetro | Valor |
|---|---|
| Tipo | **Turnkey parcial**: compran todo menos lo que dice "Customer Supplied = yes" |
| Cantidad | 5 armadas de las 10 placas (las otras 5 desnudas, para rescates) |
| Variantes | 3 con LC29H(AA) (`U201`, LC29HAAMD) y 2 con **LC29H(EA)** (LC29HEAMD, mismo lugar). La lista base es la de la AA. Sin UWB: el DWM3000 salió de la v0 el 15/11/2026 |
| Caras | **Las dos caras** (desde la ubicación del 15/11/2026): 65 partes arriba (los módulos, la cadena RF, los sensores y la NAND) y 76 abajo (desacoples debajo de sus pines, `U104`, `U106`, `U202` a `U204`, `U406`, `U601`, `U602`, `J101`, `SW301`, `Q201`, `D601`, `D602`): dos pasadas de reflujo |
| Juntas | 491 pads SMT con pasta por placa (508 pads SMD en total; 310 arriba y 198 abajo), 57 partes distintas |
| Paso fino | **DSBGA de 0,4 mm** (`U101` BQ25180), **TSNP-6 de 0,4 mm** (`U205` BGA525N6), SAW de 1,4 × 1,1 mm (`FL201`, `FL202`), **LGA** (`U401` LSM6DSV32X, `U404` BMP581), WSON con pad expuesto (`U103` TPS63900, `U501` NAND), módulos con pads abajo (`U301` BMD-340 de 68 pads de 0,5 mm, `U201` LC29H, `U302` Ra-01SH almenado) |
| Inspección | **Rayos X** de los DSBGA, el TSNP, los LGA y los módulos; AOI del resto |
| Stencil | Con marco; **escalonado o de 0,1 mm** si lo recomiendan por el DSBGA al lado de los pads grandes de los módulos |
| Después del reflujo | **Patch GVLB258.A (`AE201`)**: un pin por agujero metalizado de Ø1,0 mm, soldado a mano desde abajo **después** del SMT. No pasa por el horno |
| Lo que mandamos | `AE201` GVLB258.A (o que lo compren en DigiKey, 931-GVLB258.A-ND, si les conviene). Ya no hay "maybe": el MCU es el BMD-340 (`U301`, DigiKey) y no hace falta comprarlo a Raytac o TME (plan de stock de [`costos.md`](costos.md) y [`stock.md`](stock.md)) |
| Antena LoRa | **Antena chip KYOCERA AVX M620720 (`AE301`) en la placa** desde el 15/11/2026: SMT normal en el reflujo, la consignamos o la compran en DigiKey (478-M620720CT-ND); `C313` y `C314` son Murata GJM de ±0,05 pF (DigiKey). `J302` (U.FL de prueba) y `R327` quedan sin montar. El Ra-01SH (`U302`) puede venir con un **IPEX propio** en paralelo con su pad 1: preguntar si hay variante sin IPEX |
| Humedad (MSL) | **Hornear según su nivel MSL** las partes sensibles antes del reflujo si estuvieron fuera de la bolsa: módulos (BMD-340, LC29H, Ra-01SH), LGA, DSBGA y el SAW |
| Limpieza | Flux sin limpieza; **no lavar** el BMP581 (encapsulado con ventilación) |
| Programación | No: se graba por el Tag-Connect en Buenos Aires |

## Precios por variante

Placa sola, sin armado ni envío, en US$, para 50 × 70 mm, ENIG y S1000H Tg 150. Son los precios en línea de PCBWay del 27/11/2026: el formulario de cotización rápida, con la combinación de opciones de cada fila. 4/4 contra 5/5 mil de pista y 0,2 contra 0,25 mm de agujero no cambian el precio.

| Variante | 10 | 50 | 100 | Plazo |
|---|---|---|---|---|
| 6 capas, vías rellenas y tapadas (POFV), impedancia: **el pedido W237290AS5P2** | 596,69 | 711,14 | 854,28 | 10–11 días |
| 6 capas, POFV, sin impedancia | 594,43 | 699,22 | 830,42 | |
| **6 capas, sin POFV, impedancia: esta placa desde el 27/11/2026** | **234,25** | **267,38** | **317,89** | 5–6 días |
| 6 capas, sin POFV, sin impedancia | 187,72 | 230,52 | 272,99 | |
| 6 capas, HASL, sin POFV | 167,24 | 202,61 | 243,78 | |
| 8 capas, POFV | 736,43 | 898,59 | 1.101,37 | |
| 8 capas, sin POFV, impedancia | 275,24 | 330,02 | 384,57 | |

El relleno de las vías era el costo: unos US$ 360 en 10 placas y US$ 5,36 por placa en 100. Pasar a 8 capas no lo saca: lo que lo pedía eran las vías en los pads del BMD-340 (0,5 mm a 1,055 mm entre centros), no la falta de capas. El pedido W237290AS5P2 (10 placas, US$ 596,69 + DHL US$ 60,31; armado T-5P3W237290A) se mandó a revisión el 27/11/2026 con la placa de antes; para pedir sin POFV hay que cambiar los archivos por los de esta placa y destildar el relleno.

## Preguntas a PCBWay

1. **Apilado:** materiales, espesores, εr del prepreg y del núcleo a 1–1,5 GHz, espesor y εr de la máscara sobre la pista y en la ranura. Con eso, el ancho y la ranura de la CPWG de 50 Ω en L1 referida a L2, y la pista y la separación del par de 90 Ω, con la tolerancia. ¿Incluyen el cupón y el informe de impedancia?
2. **Cobre de las capas internas (L2 a L5):** ¿0,5 oz o 1 oz con ese apilado? (fija el ancho de las pistas de potencia en capas internas). ¿Pueden dejar L1–L2 y L5–L6 iguales (simétrico)?
3. **Mínimos** que pueden hacer sin recargo: pista/separación, vía (0,45/0,2), anillo, agujero a agujero, cobre al borde, puente de máscara entre pads de 0,4 mm, y la tolerancia del espesor terminado.
4. **Vías térmicas abiertas** en el pad expuesto del TPS63900 (4 de Ø0,2 mm): ¿las aceptan sin rellenar, o prefieren taparlas con máscara del lado de abajo?
5. **DSBGA de 0,4 mm y TSNP de 0,4 mm:** ¿los arman sin problema?, ¿qué apertura de stencil y qué pad recomiendan (NSMD)?, ¿stencil escalonado?
6. **Rayos X:** ¿está incluido?, ¿cuánto cuesta por placa o por componente?
7. **Patch soldado a mano después del reflujo:** ¿lo hacen?, costo.
8. **Partes que mandamos:** dirección, cómo rotular, sobrante que piden (1–5 integrados).
9. **Humedad:** ¿hornean según el MSL las partes abiertas (módulos, LGA, DSBGA) antes del reflujo?
10. **Panel:** ¿hace falta con 50 × 70 mm? Si lo arman ellos, rieles y puentes lejos del borde izquierdo (antena del BMD-340).
11. **Revisión de fabricación (DFM)** de los Gerbers y del armado antes de fabricar: ¿gratis?, ¿cuánto tarda?
12. **Plazos y precios** de placa y de armado para 5 armadas (de 10 placas), 10 y 100, con el envío por DHL o FedEx a Buenos Aires (sin batería).
13. **Partes de una sola fuente** (LC29H, BGA525N6, TPS7A2032P, GVLB258.A; desde el 09/11/2026 todo lo demás tiene stock de sobra; [`stock.md`](stock.md)): ¿las consiguen?, ¿pueden reservarlas para 100? Las **alternativas aprobadas** de la columna `Approved Alternate` (la DRV5032FB en `U406`, la de 22 Ω, el cristal y la bobina) se pueden montar sin consultarnos; **`U301` (BMD-340) no tiene alternativa** (el Fanstel BT840 es otro footprint: solo con otra placa); cualquier otro cambio, no

## Mail para PCBWay (inglés)

**Para:** service@pcbway.com · **Adjuntos:** `pod-v0-pcbway.zip` (Gerbers, taladros, pick and place y las dos listas) y este archivo en PDF (o el texto de abajo).

> **Subject:** Quote request: 6-layer impedance-controlled PCB + turnkey assembly, 5 / 10 / 100 pcs (wearable GNSS/BLE/LoRa tracker)
>
> Hello PCBWay team,
>
> We would like a quote and an engineering (DFM) review for a small wearable tracker board. The board is placed and fully routed; the Gerbers, drill files, IPC-D-356 netlist and pick and place are attached. We would like to confirm the stack-up and the impedance geometry with you before production.
>
> **PCB**
> - 6 layers (signal / GND / signal / power / GND / signal), FR4 Tg150+, 1.6 mm finished, about 50 × 70 mm, 1 oz outer copper. We assume 0.2 mm 7628 prepreg between L1–L2 and L5–L6, and 0.3 mm cores; please keep it symmetric.
> - Impedance control: 50 Ω grounded coplanar waveguide on L1 referenced to L2 (GNSS 1176/1575 MHz, LoRa 915 MHz) and on L6 referenced to L5, and a 90 Ω differential pair on L1 and L6 (USB). Our current geometry is 0.33 mm track with 0.20 mm gap to coplanar ground (CPWG), and 0.25 mm / 0.15 mm for the pair. Please tell us the stack-up you would use (materials, thicknesses, Dk of prepreg, core and solder mask at 1–1.5 GHz, inner copper weight) and the track/gap you recommend for 50 Ω and 90 Ω from your field solver, with tolerance. With the outer prepreg of your published 4-layer 1.6 mm "Design 1" (7628 prepreg 0.1855 mm, Dk 4.74) our own estimate gives 49 Ω and 84 Ω.
> - Minimums: 0.1/0.1 mm track/space, vias 0.45 mm pad / 0.2 mm drill.
> - No via-in-pad: no via touches an SMD pad, so no resin filling or capping is needed; vias are tented on both sides. The only holes in a pad are the 4 thermal vias (0.2 mm drill) of the exposed pad of a WSON-10, left open: please tell us if you prefer them tented from the bottom.
> - ENIG finish on the whole board.
> - One plated through hole of Ø1.0 mm (antenna pin), three plated M2 mounting holes of Ø2.2 mm with a via ring, two NPTH tooling holes of 2.1 mm.
>
> **Assembly (partial turnkey)**
> - 5 boards assembled out of 10 bare boards; also please quote 10 and 100 assembled.
> - Double-sided SMT: 141 parts and about 490 solder-paste pads per board (65 parts on top, 76 on the bottom), 57 unique parts. BOM attached (MPN, LCSC and DigiKey numbers). All 5 boards are assembled from the same bom-pod-v0.csv. Optionally, LC29HEAMD instead of LC29HAAMD in the same position. The LoRa antenna is a KYOCERA AVX M620720 ceramic chip (DigiKey 478-M620720CT-ND, not at LCSC), placed at the board edge in normal reflow; we can ship it to you.
> - Fine pitch: 0.4 mm DSBGA (TI BQ25180YBGR), 0.4 mm TSNP-6 (Infineon BGA525N6), 1.4 × 1.1 mm SAW filters, LGA sensors (ST LSM6DSV32XTR, Bosch BMP581), WSON with exposed pad, modules with bottom pads (u-blox BMD-340 68 pads of 0.5 mm, Quectel LC29H, castellated Ai-Thinker Ra-01SH). We would like X-ray inspection of the BGA/LGA/module joints. Please advise on stencil thickness or a step stencil.
> - After reflow: one through-hole ceramic patch antenna (Taoglas GVLB258.A, 25 × 25 mm, single pin) hand-soldered from the bottom. It must not go through reflow. We can ship it to you, or you can buy it at DigiKey (931-GVLB258.A-ND).
> - No-clean flux; please do not wash the board (the barometer has a vent hole). Please bake moisture-sensitive parts (modules, LGA, DSBGA) per their MSL before reflow.
> - Solder-mask dams between 0.4 mm-pitch pads if your process allows it; please tell us your minimum dam and the finished-thickness tolerance.
> - Some parts have a single source (LC29HAAMD, BGA525N6E6327XTSA1, TPS7A2032PDBVR, GVLB258.A): please confirm availability, and whether you can reserve them for a later run of 100. The "Approved Alternate" column lists drop-in substitutes you may use without asking (e.g. DRV5032FBDBZR for U406; there is no alternate for U301, the u-blox BMD-340); please do not substitute anything else without our written approval.
>
> **Please quote**
> 1. PCB and assembly for 5 / 10 / 100 boards, with lead times, X-ray and hand soldering as separate lines if possible.
> 2. Shipping by DHL or FedEx to Buenos Aires, Argentina (no batteries in the shipment).
> 3. Whether the DFM review is free, and how long it takes.
>
> Thank you,
> [Name] · [Company] · Buenos Aires, Argentina · [phone]

## JLCPCB, para comparar

JLCPCB publica sus apilados y tarifas, así que sirve de referencia de precio. **Lo que cambia frente a PCBWay:**

- **Apilado de impedancia propio:** el de 6 capas que elijamos en su calculador, con el prepreg de afuera lo más cerca posible de 0,2 mm (sin leer todavía). Como referencia, el de 4 capas JLC04161H-7628 (L1 de 35 µm, prepreg 7628 de 0,2104 mm con Dk 4,4, núcleo de 1,065 mm con Dk 4,6, cobre interno de 0,5 oz; máscara de Dk 3,8 y unos 15 µm sobre la pista, según su [calculador](https://jlcpcb.com/impedance), leído el 08/11/2026). Con él, 0,33/0,20 mm da 53,4 Ω y el par 90,3 Ω (`impedancia.py`, sin máscara): habría que angostar la ranura o ensanchar la pista con su calculador.
- **Armado Standard** (el Economic no arma 0,4 mm): rayos X automático en BGA, QFN y LGA; cada parte "extended" paga la carga del alimentador (unas 50 de las 55).
- **Vías en el pad** (POFV): ya no hacen falta (27/11/2026, ver la tabla de arriba).
- **Partes de afuera de LCSC** (el patch, la Taoglas): por "global sourcing" (DigiKey) o consignadas en su depósito de Hong Kong (2 % de cargo, mínimo US$ 10).
- **Archivos:** [`bom-pod-v0-jlcpcb.csv`](bom-pod-v0-jlcpcb.csv) (Comment, Designator, Footprint, LCSC Part #) y el CPL (Designator, Mid X, Mid Y, Layer, Rotation): las columnas del pick and place de `fabricacion.py` renombradas (Ref, PosX, PosY, Side, Rot); las rotaciones de JLCPCB pueden diferir de las de KiCad, se revisan en su vista previa.

**Mail corto para JLCPCB** (support@jlcpcb.com; en general alcanza con el pedido en línea, el mail es para lo que el calculador no tiene):

> **Subject:** Pre-order questions: 6-layer impedance board and 0.4 mm DSBGA assembly
>
> Hello JLCPCB team,
>
> Before ordering a 6-layer 1.6 mm board (about 50 × 70 mm, one of your 6-layer impedance stack-ups, ENIG, impedance control for 50 Ω CPWG and a 90 Ω pair) with Standard PCBA (5 / 10 / 100 boards, 141 parts and about 490 pads per board, on both sides), could you confirm:
> 1. That 4 open thermal vias (0.2 mm drill) in the exposed pad of a WSON-10 are fine without filling; there is no other via in a pad.
> 2. That Standard PCBA assembles 0.4 mm-pitch DSBGA (TI YBG and YFP packages) and a 0.4 mm TSNP-6, with X-ray.
> 3. Hand soldering of one through-hole antenna pin after reflow, with the part supplied through Global Sourcing (DigiKey 931-GVLB258.A-ND).
> 4. Whether you can reserve low-stock parts (C18337445 BGA525N6, C2764087 Ra-01SH) for a run of 100.
>
> Thank you,
> [Name] · [Company] · Buenos Aires, Argentina
