# Pedido de cotización a PCBWay (y a JLCPCB) del pod v0 (B-909)

Todo lo que PCBWay necesita para cotizar la placa y el armado, las preguntas que hay que hacerle, el mail listo para mandar y una versión corta para JLCPCB, para comparar. Los costos estimados están en [`costos.md`](costos.md); las consultas a los demás proveedores, en [`consultas.md`](consultas.md).

**Cuándo mandarlo:** el mail 1 (cotización y revisión de fabricación del apilado) se puede mandar ya, con este archivo y las listas. El pedido en firme sale **con la placa ubicada y ruteada**, después de la revisión de Raytac y de la revisión previa al pedido de `pod-mecanica-produccion.md` (sección 11). La placa todavía no tiene los footprints: los Gerbers y el pick and place salen de KiBot (`hardware/pod-v0/kibot.yaml`) cuando la tenga.

## Qué se adjunta

| Archivo | Qué es | Estado |
|---|---|---|
| [`bom-pod-v0.csv`](bom-pod-v0.csv) | Lista de armado en las columnas de PCBWay (línea, designadores, cantidad, fabricante, MPN, número de distribuidor, descripción, encapsulado, SMT o THT, instrucciones), con LCSC, DigiKey y la marca de lo que mandamos nosotros. 55 filas, 139 componentes | Listo. Las columnas siguen la página de requisitos de armado de PCBWay; que coincidan con su planilla de ejemplo (`Sample_BOM_PCBWay.xlsx`) está **no verificado**: si la piden, se pasan las mismas columnas a esa planilla |
| [`bom-pod-v0-sin-montar.csv`](bom-pod-v0-sin-montar.csv) | Los 27 lugares sin montar (72 componentes): no se arman, pero el armador los ve en el pick and place | Listo |
| [`bom-pod-v0-extras.csv`](bom-pod-v0-extras.csv) | Lo que se compra y no se suelda (Taoglas de rescate, FPC de LoRa, kit de banco) | Listo; no va a PCBWay |
| Gerbers, taladros, pick and place, PDF del esquemático, dibujo de fabricación | KiBot desde `hardware/pod-v0/` | Con la placa ruteada |
| Dibujo del oro duro selectivo | Capa de dibujo con los 5 pads de la base marcados | Con la placa ruteada |

Las listas salen de la netlist con `python3 hardware/tools/bom_pcbway.py` (el CI falla si quedan viejas). [`bom-pod-v0-jlcpcb.csv`](bom-pod-v0-jlcpcb.csv) es la misma lista en el formato de JLCPCB.

## Placa

| Parámetro | Valor |
|---|---|
| Capas | 4, FR4 Tg 150 o más |
| Espesor terminado | 1,6 mm |
| Tamaño | unos 50 × 70 mm (provisorio: hoy el contorno es de 45 × 65 mm) |
| Cobre | 1 oz terminado afuera; adentro, el del apilado de impedancia que propongan (el diseño supone 0,5 oz) |
| Pista y separación mínimas | 0,1 / 0,1 mm (la mayoría a 0,15 mm o más) |
| Vía mínima | 0,45 mm de diámetro con agujero de 0,2 mm; la habitual, 0,5/0,2 y 0,6/0,3 |
| Vías en el pad | **Sí, rellenas con resina y tapadas con cobre** (VIPPO/POFV): las 4 vías térmicas del pad expuesto del TPS63900 (WSON-10) y las vías de los pads de la cadena RF si hace falta |
| Acabado | **ENIG** en toda la placa |
| Oro duro | **Electrolítico selectivo de ≥ 0,5 µm (20 µin) solo en los 5 pads de la base** (`J601`, pads de Ø2,0 mm), sobre níquel; el resto en ENIG. Los resortes pogo de la base hacen miles de ciclos |
| Máscara y serigrafía | Verde y blanca; **puente de máscara entre los pads de 0,4 mm** (DSBGA, TSNP) si su mínimo lo permite, y si no, que lo digan (queda una ventana común) |
| Tolerancia de espesor | 1,6 mm ± 10 % (publican ± 0,18 mm en multicapa): que la confirmen, porque fija el alto de los resortes de la base |
| Impedancia controlada | **Sí**: CPWG de 50 Ω en L1 referida a L2 (GNSS 1176/1575 MHz y LoRa 915 MHz) y par diferencial de 90 Ω (USB) en L1, con su cupón de prueba |
| Agujeros | El pin del patch: agujero metalizado de Ø1,0 mm; dos agujeros de herramienta de 2,1 mm sin metalizar; los agujeros del Tag-Connect TC2030-NL |
| Panel | Si lo piden: rieles con fiduciales y agujeros, **lejos de la antena del Raytac** (borde izquierdo) y **sin V-score ni puentes en ese borde** |

### Apilado e impedancia (lo primero que hay que cerrar)

El diseño supone hoy (`hardware/README.md`, "Apilado"): L1 de 35 µm, prepreg 7628 de 0,2 mm con εr 4,4, L2 de 17,5 µm, núcleo de 1,065 mm con εr 4,6, L3, prepreg igual y L4. Con eso, `hardware/tools/impedancia.py` da:

| Línea | Geometría | Con el apilado supuesto | Con el "Design 1" de PCBWay (prepreg 7628 de 0,1855 mm, Dk 4,74) | Con el JLC04161H-7628 (0,2104 mm, Dk 4,4) |
|---|---|---|---|---|
| CPWG de 50 Ω | pista de 0,33 mm, ranura de 0,20 mm | 52,3 Ω (unos 51 con máscara) | **49,0 Ω** sin máscara | 53,4 Ω |
| Par USB de 90 Ω | 0,25 mm, separación de 0,15 mm | 88,9 Ω | **84,0 Ω** | 90,3 Ω |

El "Design 1" es el apilado de 1,6 mm que PCBWay publica en su [página de apilados](https://www.pcbway.com/multi-layer-laminated-structure.html) (leída el 08/11/2026): L1 de 0,5 oz más plateado, prepreg 7628 de 0,1855 mm después de laminar (Dk 4,74), núcleo de 1,03 mm (Dk 4,6) con 1 oz por lado, y simétrico. Con ese apilado la CPWG queda un poco baja y el par USB en 84 Ω: **se le pide a PCBWay que calcule con su solver (SI9000 o el que usen) con la máscara** y que proponga el ancho y la ranura para 50 Ω y para 90 Ω, con su tolerancia (publican ±10 %, ±5 Ω en 50 Ω). Con su respuesta se corrigen el apilado de `pod-v0.kicad_pcb`, las clases de red, `pod-v0.kicad_dru` y `impedancia.py`.

## Armado

| Parámetro | Valor |
|---|---|
| Tipo | **Turnkey parcial**: compran todo menos lo que dice "Customer Supplied = yes" |
| Cantidad | 5 armadas de las 10 placas (las otras 5 desnudas, para rescates) |
| Variantes | 3 con LC29H(AA) (`U201`, LC29HAAMD) y 2 con **LC29H(EA)** (LC29HEAMD, mismo lugar); 1 de las 5 con el **UWB DWM3000** (`U701`, `C701` y `C702` montados; `R702` solo si el banco lo pide). La lista base es la de la AA sin UWB |
| Caras | Todo SMT arriba. Si el Hall (`U406`) termina abajo, una segunda pasada |
| Juntas | Unos 481 pads SMT por placa, 55 partes distintas |
| Paso fino | **DSBGA de 0,4 mm** (`U101` BQ25180, `U303` TPS22916C del LoRa), **TSNP-6 de 0,4 mm** (`U205` BGA525N6), SAW de 1,4 × 1,1 mm (`FL201`, `FL202`), **LGA** (`U401` LSM6DSV320X, `U404` BMP581), WSON con pad expuesto (`U103` TPS63900, `U501` NAND), módulos con pads abajo (`U301` MDBT50Q de 61 pads, `U201` LC29H, `U302` E22) |
| Inspección | **Rayos X** de los DSBGA, el TSNP, los LGA y los módulos; AOI del resto |
| Stencil | Con marco; **escalonado o de 0,1 mm** si lo recomiendan por el DSBGA al lado de los pads grandes de los módulos |
| Después del reflujo | **Patch GVLB208.A (`AE201`)**: un pin por agujero metalizado de Ø1,0 mm, soldado a mano desde abajo **después** del SMT. No pasa por el horno |
| Lo que mandamos | `AE201` GVLB208.A (o que lo compren en DigiKey, 931-GVLB208.A-ND, si les conviene). **Quizás** ("maybe" en la lista): el MDBT50Q-P1MV2 (`U301`), si lo compramos a Raytac; y el DRV5032FB (`U406`), si lo compramos en ti.com (plan de stock de [`costos.md`](costos.md)) |
| Humedad (MSL) | **Hornear según su nivel MSL** las partes sensibles antes del reflujo si estuvieron fuera de la bolsa: módulos (MDBT50Q, LC29H, E22), LGA, DSBGA y el SAW |
| Limpieza | Flux sin limpieza; **no lavar** el BMP581 (encapsulado con ventilación) |
| Programación | No: se graba por el Tag-Connect en Buenos Aires |

## Preguntas a PCBWay

1. **Apilado:** materiales, espesores, εr del prepreg y del núcleo a 1–1,5 GHz, espesor y εr de la máscara sobre la pista y en la ranura. Con eso, el ancho y la ranura de la CPWG de 50 Ω en L1 referida a L2, y la pista y la separación del par de 90 Ω, con la tolerancia. ¿Incluyen el cupón y el informe de impedancia?
2. **Cobre de L2 y L3:** ¿0,5 oz o 1 oz con ese apilado? (fija el ancho de las pistas de potencia en capas internas).
3. **Mínimos** que pueden hacer sin recargo: pista/separación, vía (0,45/0,2), anillo, agujero a agujero, cobre al borde, puente de máscara entre pads de 0,4 mm, y la tolerancia del espesor terminado.
4. **Vías en el pad rellenas y tapadas** en 4 capas: costo y plazo extra. ¿Lo hacen en todas las vías o solo en las marcadas?
5. **Oro duro selectivo** de ≥ 0,5 µm en 5 pads planos que no están en el borde, con ENIG en el resto: ¿lo hacen?, ¿cómo lo marcamos (capa de dibujo, máscara de plateado)?, ¿necesita un bus de plateado que después cortan?, costo.
6. **DSBGA de 0,4 mm y TSNP de 0,4 mm:** ¿los arman sin problema?, ¿qué apertura de stencil y qué pad recomiendan (NSMD)?, ¿stencil escalonado?
7. **Rayos X:** ¿está incluido?, ¿cuánto cuesta por placa o por componente?
8. **Patch soldado a mano después del reflujo:** ¿lo hacen?, costo.
9. **Partes que mandamos:** dirección, cómo rotular, sobrante que piden (1–5 integrados).
10. **Humedad:** ¿hornean según el MSL las partes abiertas (módulos, LGA, DSBGA) antes del reflujo?
11. **Panel:** ¿hace falta con 50 × 70 mm? Si lo arman ellos, rieles y puentes lejos del borde izquierdo (antena del Raytac).
12. **Revisión de fabricación (DFM)** de los Gerbers y del armado antes de fabricar: ¿gratis?, ¿cuánto tarda?
13. **Plazos y precios** de placa y de armado para 5 armadas (de 10 placas), 10 y 100, con el envío por DHL o FedEx a Buenos Aires (sin batería).
14. **Partes con poco stock** (LSM6DSV320X, BGA525N6, DRV5032FB, TPS7A2032P): ¿las consiguen?, ¿pueden reservarlas para 100?

## Mail para PCBWay (inglés)

**Para:** service@pcbway.com · **Adjuntos:** `bom-pod-v0.csv`, `bom-pod-v0-sin-montar.csv`, este archivo en PDF (o el texto de abajo), y los Gerbers cuando estén.

> **Subject:** Quote request: 4-layer impedance-controlled PCB + turnkey assembly, 5 / 10 / 100 pcs (wearable GNSS/BLE/LoRa tracker)
>
> Hello PCBWay team,
>
> We would like a quote and an engineering (DFM) review for a small wearable tracker board. We are finishing placement and routing; we would like to fix the stack-up and the impedance geometry with you first, then send the Gerbers.
>
> **PCB**
> - 4 layers, FR4 Tg150+, 1.6 mm finished, about 50 × 70 mm, 1 oz outer copper.
> - Impedance control: 50 Ω grounded coplanar waveguide on L1 referenced to L2 (GNSS 1176/1575 MHz, LoRa 915 MHz) and a 90 Ω differential pair on L1 (USB). Our current geometry is 0.33 mm track with 0.20 mm gap to coplanar ground (CPWG), and 0.25 mm / 0.15 mm for the pair. Please tell us the stack-up you would use (materials, thicknesses, Dk of prepreg, core and solder mask at 1–1.5 GHz, inner copper weight) and the track/gap you recommend for 50 Ω and 90 Ω from your field solver, with tolerance. With your published 1.6 mm "Design 1" (7628 prepreg 0.1855 mm, Dk 4.74) our own estimate gives 49 Ω and 84 Ω.
> - Minimums: 0.1/0.1 mm track/space, vias 0.45 mm pad / 0.2 mm drill.
> - Via-in-pad, resin filled and copper capped, under the exposed pad of a WSON-10 (4 vias).
> - ENIG finish, plus selective electrolytic hard gold (≥ 0.5 µm / 20 µin) on 5 flat round pads (Ø2.0 mm) that are not on the board edge (they mate with pogo pins). Can you do selective hard gold together with ENIG, and how should we mark the area?
> - One plated through hole of Ø1.0 mm (antenna pin), two NPTH tooling holes of 2.1 mm.
>
> **Assembly (partial turnkey)**
> - 5 boards assembled out of 10 bare boards; also please quote 10 and 100 assembled.
> - Single-side SMT, about 140 parts and 480 pads per board, 55 unique parts. BOM attached (MPN, LCSC and DigiKey numbers). Two variants: 3 boards with Quectel LC29HAAMD and 2 boards with LC29HEAMD in the same position; one board also with the Qorvo DWM3000TR13 module.
> - Fine pitch: 0.4 mm DSBGA (TI BQ25180YBGR, TPS22916CYFPR), 0.4 mm TSNP-6 (Infineon BGA525N6), 1.4 × 1.1 mm SAW filters, LGA sensors (ST LSM6DSV320XTR, Bosch BMP581), WSON with exposed pad, modules with bottom pads (Raytac MDBT50Q-P1MV2 61 pads, Quectel LC29H, Ebyte E22-900M22S). We would like X-ray inspection of the BGA/LGA/module joints. Please advise on stencil thickness or a step stencil.
> - After reflow: one through-hole ceramic patch antenna (Taoglas GVLB208.A, 20 × 20 mm, single pin) hand-soldered from the bottom. It must not go through reflow. We can ship it to you, or you can buy it at DigiKey (931-GVLB208.A-ND).
> - No-clean flux; please do not wash the board (the barometer has a vent hole). Please bake moisture-sensitive parts (modules, LGA, DSBGA) per their MSL before reflow.
> - Solder-mask dams between 0.4 mm-pitch pads if your process allows it; please tell us your minimum dam and the finished-thickness tolerance.
> - Some parts have low stock (LSM6DSV320XTR, BGA525N6E6327XTSA1, DRV5032FBDBZR, TPS7A2032PDBVR): please confirm availability, and whether you can reserve them for a later run of 100.
>
> **Please quote**
> 1. PCB and assembly for 5 / 10 / 100 boards, with lead times, X-ray, hand soldering, via-in-pad and hard gold as separate lines if possible.
> 2. Shipping by DHL or FedEx to Buenos Aires, Argentina (no batteries in the shipment).
> 3. Whether the DFM review is free, and how long it takes.
>
> Thank you,
> [Name] · [Company] · Buenos Aires, Argentina · [phone]

## JLCPCB, para comparar

JLCPCB publica sus apilados y tarifas, así que sirve de referencia de precio. **Lo que cambia frente a PCBWay:**

- **Apilado de impedancia propio:** el JLC04161H-7628 (L1 de 35 µm, prepreg 7628 de 0,2104 mm con Dk 4,4, núcleo de 1,065 mm con Dk 4,6, cobre interno de 0,5 oz; máscara de Dk 3,8 y unos 15 µm sobre la pista, según su [calculador](https://jlcpcb.com/impedance), leído el 08/11/2026). Con él, 0,33/0,20 mm da 53,4 Ω y el par 90,3 Ω (`impedancia.py`, sin máscara): habría que angostar la ranura o ensanchar la pista con su calculador.
- **Armado Standard** (el Economic no arma 0,4 mm): rayos X automático en BGA, QFN y LGA; cada parte "extended" paga la carga del alimentador (unas 50 de las 55).
- **Vías en el pad** (POFV): se cobran en 4 capas (gratis desde 6).
- **Oro duro selectivo** en pads que no están en el borde: probablemente **no lo hacen** (solo dedos de oro en el borde, **no verificado**). Si no, JLCPCB sirve para la v0 con ENIG en los pads de la base, sabiendo que se gastan, y la tanda de 100 va a PCBWay.
- **Partes de afuera de LCSC** (el patch, la Taoglas): por "global sourcing" (DigiKey) o consignadas en su depósito de Hong Kong (2 % de cargo, mínimo US$ 10).
- **Archivos:** [`bom-pod-v0-jlcpcb.csv`](bom-pod-v0-jlcpcb.csv) (Comment, Designator, Footprint, LCSC Part #) y el CPL (Designator, Mid X, Mid Y, Layer, Rotation) de KiBot.

**Mail corto para JLCPCB** (support@jlcpcb.com; en general alcanza con el pedido en línea, el mail es para lo que el calculador no tiene):

> **Subject:** Pre-order questions: 4-layer impedance board with selective hard gold, via-in-pad and 0.4 mm DSBGA assembly
>
> Hello JLCPCB team,
>
> Before ordering a 4-layer 1.6 mm board (about 50 × 70 mm, JLC04161H-7628, ENIG, impedance control for 50 Ω CPWG and a 90 Ω pair) with Standard PCBA (5 / 10 / 100 boards, about 140 parts and 480 pads per board), could you confirm:
> 1. Can you plate selective electrolytic hard gold (≥ 0.5 µm) on 5 flat pads that are not on the board edge, with ENIG on the rest?
> 2. The price of resin-filled, capped via-in-pad (POFV) on a 4-layer board, for 4 vias under a WSON exposed pad.
> 3. That Standard PCBA assembles 0.4 mm-pitch DSBGA (TI YBG and YFP packages) and a 0.4 mm TSNP-6, with X-ray.
> 4. Hand soldering of one through-hole antenna pin after reflow, with the part supplied through Global Sourcing (DigiKey 931-GVLB208.A-ND).
> 5. Whether you can reserve low-stock parts (C26633007 LSM6DSV320XTR, C2655033 DRV5032FBDBZR) for a run of 100.
>
> Thank you,
> [Name] · [Company] · Buenos Aires, Argentina
