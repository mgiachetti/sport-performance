# Pedido de cotización a PCBWay (y a JLCPCB) del pod v0 (B-909)

Todo lo que PCBWay necesita para cotizar la placa y el armado, las preguntas que hay que hacerle, el mail listo para mandar y una versión corta para JLCPCB, para comparar. Los costos estimados están en [`costos.md`](costos.md); las consultas a los demás proveedores, en [`consultas.md`](consultas.md).

**Cuándo mandarlo:** el mail 1 (cotización y revisión de fabricación del apilado) se puede mandar ya, con este archivo y las listas. El pedido en firme sale **con la placa ubicada y ruteada**, después de la revisión previa al pedido de `pod-mecanica-produccion.md` (sección 11). La placa todavía no tiene los footprints: los Gerbers y el pick and place salen de KiBot (`hardware/pod-v0/kibot.yaml`) cuando la tenga.

## Qué se adjunta

| Archivo | Qué es | Estado |
|---|---|---|
| [`bom-pod-v0.csv`](bom-pod-v0.csv) | Lista de armado en las columnas de PCBWay (línea, designadores, cantidad, fabricante, MPN, número de distribuidor, descripción, encapsulado, SMT o THT, instrucciones), con LCSC, DigiKey, la marca de lo que mandamos nosotros y la **alternativa aprobada** de cada fila que la tiene (`Approved Alternate`, de [`stock.md`](stock.md)). 55 filas, 139 componentes | Listo. Las columnas siguen la página de requisitos de armado de PCBWay; que coincidan con su planilla de ejemplo (`Sample_BOM_PCBWay.xlsx`) está **no verificado**: si la piden, se pasan las mismas columnas a esa planilla |
| [`bom-pod-v0-sin-montar.csv`](bom-pod-v0-sin-montar.csv) | Los 26 lugares sin montar (69 componentes): no se arman, pero el armador los ve en el pick and place | Listo |
| [`bom-pod-v0-extras.csv`](bom-pod-v0-extras.csv) | Lo que se compra y no se suelda (Taoglas de rescate, kit de banco con la FPC de LoRa para el A/B) | Listo; no va a PCBWay |
| Gerbers, taladros, pick and place, PDF del esquemático, dibujo de fabricación | KiBot desde `hardware/pod-v0/` | Con la placa ruteada |

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
| Vías en el pad | **Sí: todas las vías de la placa rellenas con resina y tapadas con cobre (POFV), obligatorio**. Hay vías sobre pads en varias partes, por ejemplo **los 4 agujeros metalizados del pad expuesto del TPS63900** (`U103`, WSON-10: los trae el footprint `..._ThermalVias`, en (19,65; 62), (20; 61,25), (20; 62,75) y (20,35; 62)) y **las vías de 0,5/0,2 mm en los pads del BMD-340** (`U301`, el escape del módulo desde el ruteo del 15/11/2026: todos los pads salvo las dos filas de arriba, que salen por L1, el cristal, VREG, VBUS y el par USB). **Hoy son 17**; con las redes del módulo que quedan para rutear a mano (sección 9 de `pod-v0-ubicacion-y-carcasa.md`) llegan a unas 40. Sin relleno y tapa la soldadura del módulo se va por la vía. Además hay vías de costura y de escape que tocan pads de otras partes (lista en la sección 9 de `pod-v0-ubicacion-y-carcasa.md`, "Retoques de la revisión"): por eso **toda la placa**, unas 290 vías hoy (0,5/0,2 y 0,6/0,3), más las del ruteo a mano |
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
| Caras | Todo SMT arriba. Si el Hall (`U406`) termina abajo, una segunda pasada |
| Juntas | Unos 491 pads SMT por placa, 58 partes distintas |
| Paso fino | **DSBGA de 0,4 mm** (`U101` BQ25180), **TSNP-6 de 0,4 mm** (`U205` BGA525N6), SAW de 1,4 × 1,1 mm (`FL201`, `FL202`), **LGA** (`U401` LSM6DSV32X, `U404` BMP581), WSON con pad expuesto (`U103` TPS63900, `U501` NAND), módulos con pads abajo (`U301` BMD-340 de 68 pads de 0,5 mm, `U201` LC29H, `U302` Ra-01SH almenado) |
| Inspección | **Rayos X** de los DSBGA, el TSNP, los LGA y los módulos; AOI del resto |
| Stencil | Con marco; **escalonado o de 0,1 mm** si lo recomiendan por el DSBGA al lado de los pads grandes de los módulos |
| Después del reflujo | **Patch GVLB258.A (`AE201`)**: un pin por agujero metalizado de Ø1,0 mm, soldado a mano desde abajo **después** del SMT. No pasa por el horno |
| Lo que mandamos | `AE201` GVLB258.A (o que lo compren en DigiKey, 931-GVLB258.A-ND, si les conviene). Ya no hay "maybe": el MCU es el BMD-340 (`U301`, DigiKey) y no hace falta comprarlo a Raytac o TME (plan de stock de [`costos.md`](costos.md) y [`stock.md`](stock.md)) |
| Antena LoRa | **Antena chip KYOCERA AVX M620720 (`AE301`) en la placa** desde el 15/11/2026: SMT normal en el reflujo, la consignamos o la compran en DigiKey (478-M620720CT-ND); `C313` y `C314` son Murata GJM de ±0,05 pF (DigiKey). `J302` (U.FL de prueba) y `R327` quedan sin montar. El Ra-01SH (`U302`) puede venir con un **IPEX propio** en paralelo con su pad 1: preguntar si hay variante sin IPEX |
| Humedad (MSL) | **Hornear según su nivel MSL** las partes sensibles antes del reflujo si estuvieron fuera de la bolsa: módulos (BMD-340, LC29H, Ra-01SH), LGA, DSBGA y el SAW |
| Limpieza | Flux sin limpieza; **no lavar** el BMP581 (encapsulado con ventilación) |
| Programación | No: se graba por el Tag-Connect en Buenos Aires |

## Preguntas a PCBWay

1. **Apilado:** materiales, espesores, εr del prepreg y del núcleo a 1–1,5 GHz, espesor y εr de la máscara sobre la pista y en la ranura. Con eso, el ancho y la ranura de la CPWG de 50 Ω en L1 referida a L2, y la pista y la separación del par de 90 Ω, con la tolerancia. ¿Incluyen el cupón y el informe de impedancia?
2. **Cobre de las capas internas (L2 a L5):** ¿0,5 oz o 1 oz con ese apilado? (fija el ancho de las pistas de potencia en capas internas). ¿Pueden dejar L1–L2 y L5–L6 iguales (simétrico)?
3. **Mínimos** que pueden hacer sin recargo: pista/separación, vía (0,45/0,2), anillo, agujero a agujero, cobre al borde, puente de máscara entre pads de 0,4 mm, y la tolerancia del espesor terminado.
4. **Vías en el pad rellenas y tapadas** en 6 capas: costo y plazo extra. ¿Lo hacen en todas las vías o solo en las marcadas?
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

**Para:** service@pcbway.com · **Adjuntos:** `bom-pod-v0.csv`, `bom-pod-v0-sin-montar.csv`, este archivo en PDF (o el texto de abajo), y los Gerbers cuando estén.

> **Subject:** Quote request: 6-layer impedance-controlled PCB + turnkey assembly, 5 / 10 / 100 pcs (wearable GNSS/BLE/LoRa tracker)
>
> Hello PCBWay team,
>
> We would like a quote and an engineering (DFM) review for a small wearable tracker board. We are finishing placement and routing; we would like to fix the stack-up and the impedance geometry with you first, then send the Gerbers.
>
> **PCB**
> - 6 layers (signal / GND / signal / power / GND / signal), FR4 Tg150+, 1.6 mm finished, about 50 × 70 mm, 1 oz outer copper. We assume 0.2 mm 7628 prepreg between L1–L2 and L5–L6, and 0.3 mm cores; please keep it symmetric.
> - Impedance control: 50 Ω grounded coplanar waveguide on L1 referenced to L2 (GNSS 1176/1575 MHz, LoRa 915 MHz) and on L6 referenced to L5, and a 90 Ω differential pair on L1 and L6 (USB). Our current geometry is 0.33 mm track with 0.20 mm gap to coplanar ground (CPWG), and 0.25 mm / 0.15 mm for the pair. Please tell us the stack-up you would use (materials, thicknesses, Dk of prepreg, core and solder mask at 1–1.5 GHz, inner copper weight) and the track/gap you recommend for 50 Ω and 90 Ω from your field solver, with tolerance. With the outer prepreg of your published 4-layer 1.6 mm "Design 1" (7628 prepreg 0.1855 mm, Dk 4.74) our own estimate gives 49 Ω and 84 Ω.
> - Minimums: 0.1/0.1 mm track/space, vias 0.45 mm pad / 0.2 mm drill.
> - Via-in-pad, resin filled and copper capped (POFV): **every via on the board filled and capped (POFV), mandatory**. There are vias in pads on several parts, for example 4 holes in the exposed pad of a WSON-10 and about 40 vias (0.5 mm / 0.2 mm drill) in the 0.5 mm pads of a BLE module (u-blox BMD-340).
> - ENIG finish on the whole board.
> - One plated through hole of Ø1.0 mm (antenna pin), three plated M2 mounting holes of Ø2.2 mm with a via ring, two NPTH tooling holes of 2.1 mm.
>
> **Assembly (partial turnkey)**
> - 5 boards assembled out of 10 bare boards; also please quote 10 and 100 assembled.
> - Single-side SMT, about 142 parts and 491 pads per board, 58 unique parts. BOM attached (MPN, LCSC and DigiKey numbers). All 5 boards are assembled from the same bom-pod-v0.csv. Optionally, LC29HEAMD instead of LC29HAAMD in the same position. The LoRa antenna is a KYOCERA AVX M620720 ceramic chip (DigiKey 478-M620720CT-ND, not at LCSC), placed at the board edge in normal reflow; we can ship it to you.
> - Fine pitch: 0.4 mm DSBGA (TI BQ25180YBGR), 0.4 mm TSNP-6 (Infineon BGA525N6), 1.4 × 1.1 mm SAW filters, LGA sensors (ST LSM6DSV32XTR, Bosch BMP581), WSON with exposed pad, modules with bottom pads (u-blox BMD-340 68 pads of 0.5 mm, Quectel LC29H, castellated Ai-Thinker Ra-01SH). We would like X-ray inspection of the BGA/LGA/module joints. Please advise on stencil thickness or a step stencil.
> - After reflow: one through-hole ceramic patch antenna (Taoglas GVLB258.A, 25 × 25 mm, single pin) hand-soldered from the bottom. It must not go through reflow. We can ship it to you, or you can buy it at DigiKey (931-GVLB258.A-ND).
> - No-clean flux; please do not wash the board (the barometer has a vent hole). Please bake moisture-sensitive parts (modules, LGA, DSBGA) per their MSL before reflow.
> - Solder-mask dams between 0.4 mm-pitch pads if your process allows it; please tell us your minimum dam and the finished-thickness tolerance.
> - Some parts have a single source (LC29HAAMD, BGA525N6E6327XTSA1, TPS7A2032PDBVR, GVLB258.A): please confirm availability, and whether you can reserve them for a later run of 100. The "Approved Alternate" column lists drop-in substitutes you may use without asking (e.g. DRV5032FBDBZR for U406; there is no alternate for U301, the u-blox BMD-340); please do not substitute anything else without our written approval.
>
> **Please quote**
> 1. PCB and assembly for 5 / 10 / 100 boards, with lead times, X-ray, hand soldering and via-in-pad as separate lines if possible.
> 2. Shipping by DHL or FedEx to Buenos Aires, Argentina (no batteries in the shipment).
> 3. Whether the DFM review is free, and how long it takes.
>
> Thank you,
> [Name] · [Company] · Buenos Aires, Argentina · [phone]

## JLCPCB, para comparar

JLCPCB publica sus apilados y tarifas, así que sirve de referencia de precio. **Lo que cambia frente a PCBWay:**

- **Apilado de impedancia propio:** el de 6 capas que elijamos en su calculador, con el prepreg de afuera lo más cerca posible de 0,2 mm (sin leer todavía). Como referencia, el de 4 capas JLC04161H-7628 (L1 de 35 µm, prepreg 7628 de 0,2104 mm con Dk 4,4, núcleo de 1,065 mm con Dk 4,6, cobre interno de 0,5 oz; máscara de Dk 3,8 y unos 15 µm sobre la pista, según su [calculador](https://jlcpcb.com/impedance), leído el 08/11/2026). Con él, 0,33/0,20 mm da 53,4 Ω y el par 90,3 Ω (`impedancia.py`, sin máscara): habría que angostar la ranura o ensanchar la pista con su calculador.
- **Armado Standard** (el Economic no arma 0,4 mm): rayos X automático en BGA, QFN y LGA; cada parte "extended" paga la carga del alimentador (unas 50 de las 55).
- **Vías en el pad** (POFV): se cobran en 4 capas y son gratis desde 6 (no verificado para este pedido), así que con la placa de 6 capas no se pagan aparte. En el pod es obligatorio en **todas las vías de la placa** (unas 290 hoy); por ejemplo, los 4 agujeros del pad expuesto del TPS63900 y las de los pads del BMD-340 (17 hoy, unas 40 con el ruteo terminado).
- **Partes de afuera de LCSC** (el patch, la Taoglas): por "global sourcing" (DigiKey) o consignadas en su depósito de Hong Kong (2 % de cargo, mínimo US$ 10).
- **Archivos:** [`bom-pod-v0-jlcpcb.csv`](bom-pod-v0-jlcpcb.csv) (Comment, Designator, Footprint, LCSC Part #) y el CPL (Designator, Mid X, Mid Y, Layer, Rotation) de KiBot.

**Mail corto para JLCPCB** (support@jlcpcb.com; en general alcanza con el pedido en línea, el mail es para lo que el calculador no tiene):

> **Subject:** Pre-order questions: 6-layer impedance board with via-in-pad and 0.4 mm DSBGA assembly
>
> Hello JLCPCB team,
>
> Before ordering a 6-layer 1.6 mm board (about 50 × 70 mm, one of your 6-layer impedance stack-ups, ENIG, impedance control for 50 Ω CPWG and a 90 Ω pair) with Standard PCBA (5 / 10 / 100 boards, about 140 parts and 480 pads per board), could you confirm:
> 1. That resin-filled, capped via-in-pad (POFV) is included at no extra cost on a 6-layer board, for every via on the board (about 300, 0.5 mm / 0.2 mm and 0.6 mm / 0.3 mm).
> 2. That Standard PCBA assembles 0.4 mm-pitch DSBGA (TI YBG and YFP packages) and a 0.4 mm TSNP-6, with X-ray.
> 3. Hand soldering of one through-hole antenna pin after reflow, with the part supplied through Global Sourcing (DigiKey 931-GVLB258.A-ND).
> 4. Whether you can reserve low-stock parts (C18337445 BGA525N6, C2764087 Ra-01SH) for a run of 100.
>
> Thank you,
> [Name] · [Company] · Buenos Aires, Argentina
